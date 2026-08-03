// Conteudo do artigo: migrar de embeddings sem reindexar tudo de uma vez.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Migrador de embeddings incremental: mantém dois espaços vetoriais convivendo por versão, faz backfill retomável em lotes com checkpoint durável, escreve nas duas versões enquanto o acervo muda, roda um harness de paridade que compara o top-k do modelo antigo com o do novo sobre um conjunto congelado de consultas e só libera a promoção quando a cobertura e a paridade passam do limiar configurado.',
  en: 'Incremental embedding migrator: it keeps two vector spaces coexisting by version, runs a resumable batched backfill with durable checkpoints, writes to both versions while the corpus changes, runs a parity harness comparing the old model top-k against the new one over a frozen query set and only allows promotion when coverage and parity clear the configured threshold.',
  es: 'Migrador de embeddings incremental: mantiene dos espacios vectoriales conviviendo por versión, hace backfill reanudable en lotes con checkpoint durable, escribe en las dos versiones mientras el acervo cambia, corre un harness de paridad que compara el top-k del modelo viejo con el del nuevo sobre un conjunto congelado de consultas y solo habilita la promoción cuando la cobertura y la paridad superan el umbral configurado.',
};

const repoUrl = 'https://github.com/joaosouz4dev/embedding-migration-kit';

const pt = {
  intro:
    'O modelo de embedding novo saiu, é mais barato, tem mais dimensões e pontua melhor nos benchmarks públicos. Trocar parece uma linha de configuração, e é aí que a migração vira incidente: vetor gerado por um modelo não é comparável com vetor gerado por outro. O espaço é diferente, o cosseno entre um vetor novo e um antigo não significa nada, e no instante em que a sua aplicação passa a embutir a pergunta com o modelo novo contra um índice que ainda tem os vetores antigos, o retrieval não degrada aos poucos: ele vira ruído. A saída óbvia é reindexar tudo antes de trocar, mas reindexar um acervo de milhões de chunks é uma janela longa de custo, throughput e rate limit do provedor, e o acervo não fica parado esperando: documentos entram e mudam enquanto o backfill roda. Este artigo trata da migração incremental: por que os dois espaços não se misturam, como versionar o vetor para os dois conviverem, como fazer o backfill retomável sem duplicar custo, como escrever nas duas versões enquanto o índice ainda está pela metade, como decidir a virada por paridade medida em vez de por sensação e como voltar atrás sem reindexar de novo.',
  sections: [
    {
      title: 'Dois espaços vetoriais não se misturam',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira coisa a internalizar é que um embedding não é uma propriedade do texto, é uma função do par texto e modelo. Cada modelo aprende uma geometria própria: a direção que codifica "prazo de reembolso" no modelo antigo pode ser uma direção sem significado nenhum no modelo novo. Quando você calcula o cosseno entre a pergunta embutida pelo modelo B e um chunk embutido pelo modelo A, a conta roda, retorna um número entre menos um e um, e esse número não tem relação com similaridade semântica. Não existe erro, exceção nem log: o índice devolve os k vizinhos mais próximos de acordo com uma métrica que perdeu o sentido, e o bot passa a responder com trechos aleatoriamente plausíveis. É o pior tipo de falha, a que não aparece em nenhum painel de erro.',
        },
        {
          type: 'paragraph',
          value:
            'Isso vale mesmo quando os dois modelos têm a mesma dimensionalidade, e vale entre versões do mesmo provedor. Dimensão igual só significa que a operação aritmética é possível, não que ela é significativa. Também não existe matriz de tradução confiável entre espaços de propósito geral: até dá para aprender uma projeção aproximada com pares alinhados, mas a perda de qualidade costuma ser maior do que o custo de reindexar direito. A consequência prática é dura e simples: durante toda a migração, a consulta precisa ser embutida com exatamente o mesmo modelo que gerou os vetores que ela vai comparar. Não há meio termo, e é essa regra que dita todo o desenho a seguir.',
        },
        {
          type: 'table',
          columns: ['Combinação', 'A conta roda?', 'O resultado tem sentido?', 'Consequência'],
          rows: [
            [
              'Consulta A contra índice A',
              'Sim',
              'Sim',
              'Comportamento normal, é a linha de base',
            ],
            [
              'Consulta B contra índice B',
              'Sim',
              'Sim',
              'Estado final desejado da migração',
            ],
            [
              'Consulta B contra índice A, mesma dimensão',
              'Sim',
              'Não',
              'Retrieval vira ruído sem levantar erro algum',
            ],
            [
              'Consulta B contra índice A, dimensão diferente',
              'Não',
              'Não aplicável',
              'Erro explícito do banco, falha barulhenta e portanto menos perigosa',
            ],
            [
              'Índice misto com vetores de A e B juntos',
              'Sim',
              'Parcialmente',
              'O pior caso, resultado bom e ruim intercalado sem sinal de qual é qual',
            ],
          ],
        },
      ],
    },
    {
      title: 'Versionar o vetor para os dois conviverem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se os espaços não se misturam, o índice precisa saber a qual espaço cada vetor pertence. A modelagem que resolve isso é tratar a versão do embedding como parte da chave, e não como um metadado informativo. A unidade deixa de ser "o vetor do chunk X" e passa a ser "o vetor do chunk X na versão v2", com o identificador da versão derivado do nome do modelo, da dimensão e de qualquer parâmetro que altere o resultado, como normalização ou o prefixo de instrução que alguns modelos exigem. Duas linhas do mesmo chunk em versões diferentes coexistem sem se atrapalhar, e toda busca passa a filtrar obrigatoriamente por uma versão.',
        },
        {
          type: 'paragraph',
          value:
            'Onde esse filtro vive é uma decisão de infraestrutura, não de semântica. Em banco vetorial com filtro por metadado, a versão é uma coluna indexada e a busca carrega o predicado. Em bancos onde o filtro custa caro ou o índice aproximado se degrada com predicados, a alternativa mais limpa é uma coleção por versão, o que também simplifica o descarte: promover é apontar a leitura para a coleção nova, e limpar é derrubar a antiga inteira. O que não funciona é guardar a versão num campo solto sem obrigar o filtro, porque basta uma consulta esquecer o predicado uma vez para o índice misto entregar o pior caso da tabela anterior. A defesa barata é fazer a camada de acesso exigir a versão como argumento e nunca ter um valor padrão implícito.',
        },
        {
          type: 'code',
          value: `// embeddings/version.js
// A versao do embedding e derivada de tudo que muda o vetor resultante.
// Se algum desses campos mudar, o vetor gerado deixa de ser comparavel
// com os anteriores, entao a versao precisa mudar junto.

import { createHash } from 'node:crypto';

export function embeddingVersion(config) {
  const canonical = JSON.stringify({
    model: config.model,
    dimensions: config.dimensions,
    normalized: Boolean(config.normalized),
    // Alguns modelos exigem prefixo distinto para consulta e documento.
    queryPrefix: config.queryPrefix ?? '',
    documentPrefix: config.documentPrefix ?? '',
  });

  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  return \`\${config.model}@\${digest}\`;
}

// A camada de acesso nunca aceita busca sem versao explicita.
// Sem esse guarda, uma unica consulta esquecida devolve o indice misto.
export async function search(store, { queryVector, version, topK = 8 }) {
  if (!version) {
    throw new Error('search requer version explicita do embedding');
  }

  return store.query({
    vector: queryVector,
    topK,
    filter: { embedding_version: version },
  });
}`,
        },
      ],
    },
    {
      title: 'Backfill retomável em vez de reindexação monolítica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com as duas versões podendo coexistir, o backfill deixa de ser um evento e vira um processo em segundo plano que pode parar e continuar. A diferença entre um script que roda uma vez e um backfill de verdade está em três propriedades. A primeira é o checkpoint durável: o progresso precisa estar gravado fora do processo, não numa variável de laço, porque o job vai cair no meio, o pod vai ser reciclado no deploy e o rate limit do provedor vai forçar uma pausa longa. A segunda é a idempotência da escrita: reprocessar um lote já feito deve sobrescrever a mesma linha, nunca criar uma segunda cópia, porque o backfill sempre reprocessa a fronteira do último checkpoint. A terceira é o controle de vazão, já que o gargalo real quase nunca é o seu banco, é a cota de tokens do provedor de embedding.',
        },
        {
          type: 'paragraph',
          value:
            'A ordem de processamento tem impacto direto no valor entregue por hora de backfill. Processar por identificador crescente é simples e previsível, mas trata igualmente o documento que responde metade das consultas e aquele que ninguém abre desde a ingestão. Priorizar por frequência de acesso, usando o log de retrieval dos últimos trinta dias, faz a maior parte do tráfego real ficar coberta pela versão nova bem antes do backfill terminar, e é isso que permite começar a comparar as duas versões cedo em vez de esperar o acervo inteiro. Vale medir o progresso em duas escalas: a cobertura bruta, que é a fração de chunks migrados, e a cobertura ponderada por tráfego, que é a que realmente diz se já dá para avaliar a virada.',
        },
        {
          type: 'code',
          value: `// embeddings/backfill.js
// Backfill em lotes, retomavel por checkpoint durável e idempotente na escrita.

export async function runBackfill({
  chunks,       // { listPending(version, cursor, limit), }
  embedder,     // { embedDocuments(texts) }
  store,        // { upsertMany(rows) }
  checkpoints,  // { read(job), write(job, cursor) }
  version,
  batchSize = 128,
  onProgress = () => {},
}) {
  const job = \`backfill:\${version}\`;
  let cursor = await checkpoints.read(job);
  let migrated = 0;

  for (;;) {
    const batch = await chunks.listPending(version, cursor, batchSize);
    if (batch.length === 0) break;

    const vectors = await embedder.embedDocuments(batch.map((c) => c.text));

    // Chave composta por chunk e versao: reprocessar o mesmo lote sobrescreve
    // a mesma linha em vez de duplicar, entao retomar do checkpoint e seguro.
    await store.upsertMany(
      batch.map((chunk, i) => ({
        id: \`\${chunk.id}::\${version}\`,
        chunkId: chunk.id,
        vector: vectors[i],
        embedding_version: version,
        documentId: chunk.documentId,
      })),
    );

    cursor = batch[batch.length - 1].id;
    migrated += batch.length;

    // Checkpoint depois da escrita: se cair antes daqui, o pior caso
    // e reprocessar o ultimo lote, nunca pular chunk.
    await checkpoints.write(job, cursor);
    onProgress({ migrated, cursor });
  }

  return { migrated };
}`,
        },
      ],
    },
    {
      title: 'Escrever nas duas versões enquanto o acervo muda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum da migração incremental não está no backfill, está no que acontece com o documento que entra durante ele. Se a ingestão continua gerando só a versão antiga, o backfill nunca converge, porque a fronteira de conteúdo não migrado se renova sozinha. Se a ingestão passa a gerar só a versão nova, o índice antigo apodrece justamente enquanto ainda é ele que serve a produção, e o rollback deixa de existir. A resposta é a escrita dupla: enquanto a migração estiver aberta, todo chunk novo ou alterado é embutido nas duas versões e escrito nas duas. Custa o dobro de embedding na ingestão, e esse custo é temporário e proporcional ao delta, não ao acervo.',
        },
        {
          type: 'paragraph',
          value:
            'A escrita dupla precisa de uma decisão explícita sobre falha parcial. Se a versão nova falhar ao embutir e a antiga tiver sido gravada, o documento fica inconsistente entre os espaços, e a pergunta é qual das duas versões é obrigatória. Enquanto a produção lê da antiga, ela é a que precisa falhar a operação inteira; a nova pode falhar de forma tolerada e ser recuperada pelo próprio backfill, desde que o chunk volte para a fila de pendentes em vez de sumir. Depois da virada, essa relação se inverte. Modelar isso como uma versão primária e uma secundária, com a secundária sempre retomável pelo backfill, evita tanto o índice mudo quanto o incidente de ingestão travada por causa do espaço que ainda nem está em uso.',
        },
        {
          type: 'diagram',
          value: `INGESTAO (durante a migracao)
  documento novo/alterado
        |
        +--> embed v1 (primaria) --> upsert indice v1 --> falha aqui aborta a operacao
        |
        +--> embed v2 (secundaria) -> upsert indice v2 --> falha aqui apenas
                                                          reenfileira o chunk

BACKFILL (segundo plano)
  chunks sem v2 --> lotes --> embed v2 --> upsert v2 --> checkpoint

LEITURA
  fase 1  consulta -> embed v1 -> busca filtrada por v1        (100% do trafego)
  fase 2  consulta -> embed v1 e v2 -> compara em sombra       (v1 responde)
  fase 3  consulta -> embed v2 -> busca filtrada por v2        (fatia crescente)
  fase 4  v1 congelada, so leitura, pronta para descarte`,
        },
      ],
    },
    {
      title: 'Decidir a virada por paridade medida, não por sensação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backfill completo não é critério de virada. O que decide é se o retrieval na versão nova é pelo menos tão bom quanto o da antiga para as consultas que o seu sistema realmente recebe, e isso se mede antes de qualquer cliente ser exposto. O instrumento é um conjunto congelado de consultas reais, amostradas do log de produção e cobrindo as intenções principais, com o resultado da versão antiga guardado como linha de base. Para cada consulta, embuta nas duas versões, busque nas duas e compare. Duas métricas bastam para a decisão: a sobreposição do top-k, que diz o quanto os conjuntos recuperados coincidem, e a mudança de posição do trecho que era o correto, quando você tem essa anotação.',
        },
        {
          type: 'paragraph',
          value:
            'Sobreposição baixa não é automaticamente ruim. O modelo novo pode estar recuperando trechos diferentes e melhores, e é por isso que a comparação puramente estatística não fecha a decisão sozinha. O caminho prático é usar a sobreposição como filtro barato para achar as consultas que mais divergiram e revisar essas manualmente ou com um juiz automático, porque é ali que a regressão real aparece. Um detalhe operacional que evita falso alarme: rode a comparação apenas nas consultas cujos documentos relevantes já estejam cobertos pelo backfill, senão você vai medir cobertura incompleta achando que está medindo qualidade do modelo.',
        },
        {
          type: 'code',
          value: `// embeddings/parity.js
// Compara o retrieval das duas versoes sobre um conjunto congelado de consultas.
// Roda em sombra: nenhum cliente e exposto a versao nova nesta etapa.

const overlapAt = (a, b, k) => {
  const top = new Set(a.slice(0, k).map((hit) => hit.chunkId));
  const hits = b.slice(0, k).filter((hit) => top.has(hit.chunkId)).length;
  return hits / k;
};

export async function measureParity({
  queries,      // [{ id, text, expectedChunkId? }]
  embedder,     // { embedQuery(text, version) }
  search,       // (vector, version) => hits
  from,
  to,
  k = 8,
}) {
  const rows = [];

  for (const query of queries) {
    const [oldVector, newVector] = await Promise.all([
      embedder.embedQuery(query.text, from),
      embedder.embedQuery(query.text, to),
    ]);

    const [oldHits, newHits] = await Promise.all([
      search(oldVector, from),
      search(newVector, to),
    ]);

    const rankOf = (hits) => {
      const index = hits.findIndex((hit) => hit.chunkId === query.expectedChunkId);
      return index === -1 ? null : index + 1;
    };

    rows.push({
      queryId: query.id,
      overlap: overlapAt(oldHits, newHits, k),
      rankBefore: query.expectedChunkId ? rankOf(oldHits) : null,
      rankAfter: query.expectedChunkId ? rankOf(newHits) : null,
    });
  }

  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  const annotated = rows.filter((row) => row.rankBefore !== null);

  return {
    rows,
    meanOverlap: mean(rows.map((row) => row.overlap)),
    // Regressoes sao o sinal que barra a virada: o trecho correto piorou de posicao.
    regressions: annotated.filter(
      (row) => row.rankAfter === null || row.rankAfter > row.rankBefore,
    ),
    // As maiores divergencias sao a fila de revisao manual.
    mostDivergent: [...rows].sort((a, b) => a.overlap - b.overlap).slice(0, 20),
  };
}`,
        },
        {
          type: 'table',
          columns: ['Sinal medido', 'Leitura', 'Decisão'],
          rows: [
            [
              'Sobreposição alta e nenhuma regressão anotada',
              'Versão nova é equivalente na prática',
              'Liberar rollout gradual com segurança',
            ],
            [
              'Sobreposição baixa e regressões anotadas',
              'Versão nova perdeu trechos que importavam',
              'Barrar a virada e revisar chunking ou prefixo de consulta',
            ],
            [
              'Sobreposição baixa e nenhuma regressão anotada',
              'Recuperou trechos diferentes, possivelmente melhores',
              'Revisar manualmente as consultas mais divergentes antes de decidir',
            ],
            [
              'Divergência concentrada em um tipo de documento',
              'Problema de formatação ou prefixo, não do modelo',
              'Corrigir a ingestão daquele tipo e refazer só aquele recorte',
            ],
            [
              'Cobertura ponderada por tráfego ainda baixa',
              'Métrica está medindo backfill, não qualidade',
              'Aguardar cobertura antes de interpretar a paridade',
            ],
          ],
        },
      ],
    },
    {
      title: 'Virar, manter o rollback e descartar no fim',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A virada é uma mudança de configuração de leitura, não um deploy de código, e é isso que torna o rollback instantâneo. A versão de leitura fica num ponteiro consultado a cada requisição, com granularidade por fatia de tráfego, e o rollout sobe em degraus, comparando as métricas de negócio da fatia nova contra a antiga na mesma janela de tempo. O que se observa aqui não é mais sobreposição de top-k, é o efeito no atendimento: taxa de transbordo para humano, reformulação da pergunta pelo cliente e resolução na primeira resposta. Se algum degrau piorar esses números, o ponteiro volta para a versão antiga em segundos, sem redeploy e sem reindexação, porque o índice antigo continua íntegro e alimentado pela escrita dupla.',
        },
        {
          type: 'paragraph',
          value:
            'O descarte é a última etapa e a mais fácil de fazer cedo demais. Enquanto o índice antigo existir e estiver atualizado, a migração é reversível; no momento em que ele for apagado, voltar significa reindexar o acervo inteiro de novo. Vale manter a versão antiga viva por um período que cubra pelo menos um ciclo completo de sazonalidade do seu atendimento, com a escrita dupla ligada, porque regressão de retrieval costuma aparecer em intenção rara, não no caminho feliz. Depois desse período, desligue primeiro a escrita dupla, observe, e só então apague os vetores da versão antiga. E, se o custo de armazenamento pesar antes disso, prefira reduzir a retenção a acelerar o descarte: o vetor antigo é o seu backup de comportamento.',
        },
        {
          type: 'ordered',
          items: [
            'Definir a versão do embedding a partir de modelo, dimensão, normalização e prefixos, e exigir esse filtro em toda busca.',
            'Ligar a escrita dupla na ingestão, com a versão em produção como primária e a nova como secundária retomável.',
            'Rodar o backfill em lotes com checkpoint durável, priorizando os documentos mais acessados pelo log de retrieval.',
            'Medir paridade em sombra sobre um conjunto congelado de consultas, restrito ao que já está coberto pelo backfill.',
            'Revisar manualmente as consultas mais divergentes e corrigir ingestão ou prefixo antes de expor cliente.',
            'Subir o rollout em degraus por fatia de tráfego, comparando transbordo e resolução na mesma janela.',
            'Manter a versão antiga íntegra e alimentada até fechar um ciclo de sazonalidade, e só então desligar a escrita dupla e descartar.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Dá para converter os vetores antigos para o espaço novo em vez de reindexar?',
      answer:
        'Na prática, não de forma confiável. É possível aprender uma projeção linear entre dois espaços usando pares de textos embutidos nos dois modelos, e a literatura mostra que isso funciona parcialmente, mas a perda é distribuída de forma desigual: os casos fáceis continuam funcionando e os difíceis, que são justamente os que o retrieval precisa acertar, degradam. Você acaba com um índice que parece bom na média e falha nas consultas específicas, e o pior é que essa falha não se distingue de um problema de chunking ou de prompt no diagnóstico. Some a isso que a projeção precisa ser recalculada a cada novo modelo e que o custo de embutir de novo costuma ser menor do que o de manter e validar essa camada de tradução. A conversão só se justifica quando reindexar é impossível por restrição de licença ou de dado que não existe mais em texto, e mesmo aí exige a mesma medição de paridade.',
    },
    {
      question: 'Quanto tempo manter as duas versões escrevendo antes de descartar a antiga?',
      answer:
        'O critério não é tempo de calendário, é cobertura de cenários. Enquanto a versão antiga estiver íntegra e atualizada, o rollback custa uma mudança de ponteiro; depois do descarte, custa uma reindexação completa. O período mínimo razoável é o que cobre um ciclo inteiro de sazonalidade do seu atendimento, porque regressão de retrieval raramente aparece na intenção mais comum, que é a mais testada, e sim naquela que só acontece no fechamento do mês ou na campanha trimestral. Um bom marcador operacional é ter visto a versão nova responder com qualidade estável a todas as intenções que aparecem no seu catálogo de casos, não apenas às frequentes. Quando esse marcador for atingido, desligue primeiro a escrita dupla, observe por mais um intervalo, e só então apague os vetores antigos.',
    },
    {
      question: 'A migração de embedding exige refazer o chunking também?',
      answer:
        'São decisões independentes e é melhor mantê-las assim. Modelos novos costumam ter janela de contexto maior, o que tenta a fazer chunks maiores no mesmo movimento, e essa combinação destrói a capacidade de diagnóstico: se a qualidade cair, você não sabe se o culpado é o modelo ou o corte. Migre primeiro o embedding com o chunking congelado, meça a paridade contra a linha de base e conclua a virada. Depois, se houver hipótese de que chunks maiores ajudam, trate como uma segunda migração com o mesmo processo, agora com a versão do chunking fazendo parte da chave de versionamento. A exceção é quando a mudança de modelo exige um formato de entrada diferente, como prefixo de instrução distinto para consulta e documento: isso não é rechunking, é ajuste de ingestão, e precisa entrar na definição da versão.',
    },
  ],
  conclusion: {
    title: 'Migração de embedding é convivência, não substituição',
    description:
      'Trocar o modelo de embedding parece configuração e é migração de dado: dois espaços vetoriais incompatíveis que precisam conviver enquanto o acervo continua mudando. Versionar o vetor e exigir o filtro em toda busca, ligar a escrita dupla para o delta não renovar a fronteira, rodar o backfill retomável priorizando o que o tráfego realmente consulta, decidir a virada por paridade medida em sombra e manter o índice antigo íntegro até fechar um ciclo de sazonalidade transforma uma janela de risco num processo reversível a qualquer momento. Posso conduzir essa migração no seu pipeline de RAG, desenhando o versionamento, o backfill e o harness de paridade com o seu acervo e as suas consultas reais, para que a troca de modelo aconteça sem uma única resposta pior chegando ao cliente.',
    cta: 'Falar sobre migrar os embeddings do meu RAG',
  },
  related: [
    { label: 'Chunking de documento para RAG sem perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Reranking em RAG: melhorar o retrieval sem trocar o modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Migração de modelo sem quebrar o prompt em produção', to: '/blog/migracao-modelo-sem-quebrar-prompt-producao' },
  ],
  repo: { name: 'embedding-migration-kit', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The new embedding model is out, it is cheaper, has more dimensions and scores better on public benchmarks. Switching looks like one configuration line, and that is exactly where the migration becomes an incident: a vector produced by one model is not comparable with a vector produced by another. The space is different, the cosine between a new vector and an old one means nothing, and the moment your application starts embedding the question with the new model against an index that still holds the old vectors, retrieval does not degrade gradually: it turns into noise. The obvious way out is to reindex everything before switching, but reindexing a corpus of millions of chunks is a long window of cost, throughput and provider rate limits, and the corpus does not sit still waiting: documents come in and change while the backfill runs. This article covers the incremental migration: why the two spaces do not mix, how to version the vector so both can coexist, how to make the backfill resumable without duplicating cost, how to write to both versions while the index is still half done, how to decide the cutover by measured parity instead of by feel and how to roll back without reindexing again.',
  sections: [
    {
      title: 'Two vector spaces do not mix',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first thing to internalize is that an embedding is not a property of the text, it is a function of the text and model pair. Each model learns its own geometry: the direction that encodes "refund window" in the old model may be a meaningless direction in the new one. When you compute the cosine between a question embedded by model B and a chunk embedded by model A, the math runs, returns a number between minus one and one, and that number has no relation to semantic similarity. There is no error, no exception and no log: the index returns the k nearest neighbors according to a metric that lost its meaning, and the bot starts answering with randomly plausible passages. It is the worst kind of failure, the one that shows up on no error dashboard.',
        },
        {
          type: 'paragraph',
          value:
            'This holds even when both models share the same dimensionality, and it holds across versions from the same provider. Equal dimensions only mean the arithmetic operation is possible, not that it is meaningful. There is also no reliable translation matrix between general purpose spaces: you can learn an approximate projection from aligned pairs, but the quality loss usually costs more than reindexing properly. The practical consequence is harsh and simple: throughout the migration, the query must be embedded with exactly the same model that produced the vectors it will be compared against. There is no middle ground, and that rule dictates every design decision below.',
        },
        {
          type: 'table',
          columns: ['Combination', 'Does the math run?', 'Is the result meaningful?', 'Consequence'],
          rows: [
            [
              'Query A against index A',
              'Yes',
              'Yes',
              'Normal behavior, this is the baseline',
            ],
            [
              'Query B against index B',
              'Yes',
              'Yes',
              'Desired end state of the migration',
            ],
            [
              'Query B against index A, same dimension',
              'Yes',
              'No',
              'Retrieval turns into noise without raising a single error',
            ],
            [
              'Query B against index A, different dimension',
              'No',
              'Not applicable',
              'Explicit database error, a loud failure and therefore less dangerous',
            ],
            [
              'Mixed index with A and B vectors together',
              'Yes',
              'Partially',
              'The worst case, good and bad results interleaved with no signal of which is which',
            ],
          ],
        },
      ],
    },
    {
      title: 'Versioning the vector so both can coexist',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If the spaces do not mix, the index needs to know which space each vector belongs to. The modeling that solves this is treating the embedding version as part of the key, not as informational metadata. The unit stops being "the vector of chunk X" and becomes "the vector of chunk X in version v2", with the version identifier derived from the model name, the dimension and any parameter that changes the result, such as normalization or the instruction prefix some models require. Two rows for the same chunk in different versions coexist without interfering, and every search is forced to filter by one version.',
        },
        {
          type: 'paragraph',
          value:
            'Where that filter lives is an infrastructure decision, not a semantic one. In a vector database with metadata filtering, the version is an indexed column and the search carries the predicate. In databases where filtering is expensive or the approximate index degrades under predicates, the cleanest alternative is one collection per version, which also simplifies disposal: promoting is pointing reads at the new collection, and cleaning up is dropping the old one whole. What does not work is storing the version in a loose field without enforcing the filter, because one query forgetting the predicate once is enough for the mixed index to deliver the worst case from the previous table. The cheap defense is making the access layer require the version as an argument and never have an implicit default.',
        },
        {
          type: 'code',
          value: `// embeddings/version.js
// The embedding version is derived from everything that changes the resulting vector.
// If any of these fields changes, the generated vector stops being comparable
// with the previous ones, so the version must change with it.

import { createHash } from 'node:crypto';

export function embeddingVersion(config) {
  const canonical = JSON.stringify({
    model: config.model,
    dimensions: config.dimensions,
    normalized: Boolean(config.normalized),
    // Some models require distinct prefixes for query and document.
    queryPrefix: config.queryPrefix ?? '',
    documentPrefix: config.documentPrefix ?? '',
  });

  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  return \`\${config.model}@\${digest}\`;
}

// The access layer never accepts a search without an explicit version.
// Without this guard, a single forgotten query returns the mixed index.
export async function search(store, { queryVector, version, topK = 8 }) {
  if (!version) {
    throw new Error('search requires an explicit embedding version');
  }

  return store.query({
    vector: queryVector,
    topK,
    filter: { embedding_version: version },
  });
}`,
        },
      ],
    },
    {
      title: 'Resumable backfill instead of a monolithic reindex',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With both versions able to coexist, the backfill stops being an event and becomes a background process that can stop and continue. The difference between a script that runs once and a real backfill lies in three properties. The first is the durable checkpoint: progress must be stored outside the process, not in a loop variable, because the job will die halfway, the pod will be recycled on deploy and the provider rate limit will force a long pause. The second is write idempotency: reprocessing an already done batch must overwrite the same row, never create a second copy, because the backfill always reprocesses the boundary of the last checkpoint. The third is throughput control, since the real bottleneck is almost never your database, it is the embedding provider token quota.',
        },
        {
          type: 'paragraph',
          value:
            'Processing order has a direct impact on the value delivered per hour of backfill. Processing by ascending identifier is simple and predictable, but it treats the document that answers half the queries exactly like the one nobody has opened since ingestion. Prioritizing by access frequency, using the retrieval log from the last thirty days, gets most of the real traffic covered by the new version well before the backfill finishes, and that is what lets you start comparing the two versions early instead of waiting for the whole corpus. It pays to measure progress on two scales: raw coverage, which is the fraction of migrated chunks, and traffic-weighted coverage, which is the one that actually says whether the cutover can be evaluated yet.',
        },
        {
          type: 'code',
          value: `// embeddings/backfill.js
// Batched backfill, resumable by durable checkpoint and idempotent on write.

export async function runBackfill({
  chunks,       // { listPending(version, cursor, limit), }
  embedder,     // { embedDocuments(texts) }
  store,        // { upsertMany(rows) }
  checkpoints,  // { read(job), write(job, cursor) }
  version,
  batchSize = 128,
  onProgress = () => {},
}) {
  const job = \`backfill:\${version}\`;
  let cursor = await checkpoints.read(job);
  let migrated = 0;

  for (;;) {
    const batch = await chunks.listPending(version, cursor, batchSize);
    if (batch.length === 0) break;

    const vectors = await embedder.embedDocuments(batch.map((c) => c.text));

    // Key composed of chunk and version: reprocessing the same batch overwrites
    // the same row instead of duplicating, so resuming from the checkpoint is safe.
    await store.upsertMany(
      batch.map((chunk, i) => ({
        id: \`\${chunk.id}::\${version}\`,
        chunkId: chunk.id,
        vector: vectors[i],
        embedding_version: version,
        documentId: chunk.documentId,
      })),
    );

    cursor = batch[batch.length - 1].id;
    migrated += batch.length;

    // Checkpoint after the write: if it dies before this point, the worst case
    // is reprocessing the last batch, never skipping a chunk.
    await checkpoints.write(job, cursor);
    onProgress({ migrated, cursor });
  }

  return { migrated };
}`,
        },
      ],
    },
    {
      title: 'Writing to both versions while the corpus changes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common mistake in an incremental migration is not in the backfill, it is in what happens to the document that arrives during it. If ingestion keeps generating only the old version, the backfill never converges, because the frontier of unmigrated content renews itself. If ingestion starts generating only the new version, the old index rots exactly while it is still the one serving production, and the rollback ceases to exist. The answer is dual write: while the migration is open, every new or changed chunk is embedded in both versions and written to both. It costs double embedding at ingestion, and that cost is temporary and proportional to the delta, not to the corpus.',
        },
        {
          type: 'paragraph',
          value:
            'Dual write needs an explicit decision about partial failure. If the new version fails to embed and the old one was already stored, the document becomes inconsistent across the spaces, and the question is which of the two versions is mandatory. While production reads from the old one, it is the one that must fail the whole operation; the new one may fail in a tolerated way and be recovered by the backfill itself, as long as the chunk goes back to the pending queue instead of disappearing. After the cutover, that relationship inverts. Modeling this as a primary version and a secondary one, with the secondary always recoverable by the backfill, avoids both the silent index and the incident of ingestion stalled by a space that is not even in use yet.',
        },
        {
          type: 'diagram',
          value: `INGESTION (during the migration)
  new/changed document
        |
        +--> embed v1 (primary) ----> upsert index v1 --> a failure here aborts
        |                                                 the whole operation
        +--> embed v2 (secondary) --> upsert index v2 --> a failure here only
                                                          requeues the chunk

BACKFILL (background)
  chunks without v2 --> batches --> embed v2 --> upsert v2 --> checkpoint

READS
  phase 1  query -> embed v1 -> search filtered by v1        (100% of traffic)
  phase 2  query -> embed v1 and v2 -> compare in shadow     (v1 answers)
  phase 3  query -> embed v2 -> search filtered by v2        (growing slice)
  phase 4  v1 frozen, read only, ready for disposal`,
        },
      ],
    },
    {
      title: 'Deciding the cutover by measured parity, not by feel',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A completed backfill is not a cutover criterion. What decides it is whether retrieval on the new version is at least as good as on the old one for the queries your system actually receives, and that is measured before any customer is exposed. The instrument is a frozen set of real queries, sampled from the production log and covering the main intents, with the old version results stored as the baseline. For each query, embed in both versions, search in both and compare. Two metrics are enough for the decision: top-k overlap, which says how much the retrieved sets coincide, and the position change of the passage that was the correct one, when you have that annotation.',
        },
        {
          type: 'paragraph',
          value:
            'Low overlap is not automatically bad. The new model may be retrieving different and better passages, which is why a purely statistical comparison does not close the decision on its own. The practical path is using overlap as a cheap filter to find the queries that diverged the most and reviewing those manually or with an automated judge, because that is where the real regression shows up. One operational detail that avoids false alarms: run the comparison only on queries whose relevant documents are already covered by the backfill, otherwise you will be measuring incomplete coverage while thinking you are measuring model quality.',
        },
        {
          type: 'code',
          value: `// embeddings/parity.js
// Compares retrieval across both versions over a frozen query set.
// Runs in shadow: no customer is exposed to the new version at this stage.

const overlapAt = (a, b, k) => {
  const top = new Set(a.slice(0, k).map((hit) => hit.chunkId));
  const hits = b.slice(0, k).filter((hit) => top.has(hit.chunkId)).length;
  return hits / k;
};

export async function measureParity({
  queries,      // [{ id, text, expectedChunkId? }]
  embedder,     // { embedQuery(text, version) }
  search,       // (vector, version) => hits
  from,
  to,
  k = 8,
}) {
  const rows = [];

  for (const query of queries) {
    const [oldVector, newVector] = await Promise.all([
      embedder.embedQuery(query.text, from),
      embedder.embedQuery(query.text, to),
    ]);

    const [oldHits, newHits] = await Promise.all([
      search(oldVector, from),
      search(newVector, to),
    ]);

    const rankOf = (hits) => {
      const index = hits.findIndex((hit) => hit.chunkId === query.expectedChunkId);
      return index === -1 ? null : index + 1;
    };

    rows.push({
      queryId: query.id,
      overlap: overlapAt(oldHits, newHits, k),
      rankBefore: query.expectedChunkId ? rankOf(oldHits) : null,
      rankAfter: query.expectedChunkId ? rankOf(newHits) : null,
    });
  }

  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  const annotated = rows.filter((row) => row.rankBefore !== null);

  return {
    rows,
    meanOverlap: mean(rows.map((row) => row.overlap)),
    // Regressions are the signal that blocks the cutover: the correct passage got worse.
    regressions: annotated.filter(
      (row) => row.rankAfter === null || row.rankAfter > row.rankBefore,
    ),
    // The largest divergences are the manual review queue.
    mostDivergent: [...rows].sort((a, b) => a.overlap - b.overlap).slice(0, 20),
  };
}`,
        },
        {
          type: 'table',
          columns: ['Measured signal', 'Reading', 'Decision'],
          rows: [
            [
              'High overlap and no annotated regression',
              'The new version is equivalent in practice',
              'Safely release the gradual rollout',
            ],
            [
              'Low overlap and annotated regressions',
              'The new version lost passages that mattered',
              'Block the cutover and review chunking or query prefix',
            ],
            [
              'Low overlap and no annotated regression',
              'It retrieved different passages, possibly better ones',
              'Manually review the most divergent queries before deciding',
            ],
            [
              'Divergence concentrated in one document type',
              'A formatting or prefix problem, not the model',
              'Fix ingestion for that type and redo only that slice',
            ],
            [
              'Traffic-weighted coverage still low',
              'The metric is measuring backfill, not quality',
              'Wait for coverage before interpreting parity',
            ],
          ],
        },
      ],
    },
    {
      title: 'Cutting over, keeping the rollback and disposing at the end',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The cutover is a read configuration change, not a code deploy, and that is what makes the rollback instant. The read version lives in a pointer consulted on every request, with granularity per traffic slice, and the rollout goes up in steps, comparing the business metrics of the new slice against the old one in the same time window. What you observe here is no longer top-k overlap, it is the effect on support: handoff rate to a human, question reformulation by the customer and first-answer resolution. If any step makes those numbers worse, the pointer goes back to the old version in seconds, with no redeploy and no reindexing, because the old index remains intact and fed by the dual write.',
        },
        {
          type: 'paragraph',
          value:
            'Disposal is the last stage and the easiest one to do too early. While the old index exists and stays up to date, the migration is reversible; the moment it is deleted, going back means reindexing the whole corpus again. It pays to keep the old version alive for a period covering at least one full seasonality cycle of your support operation, with dual write on, because retrieval regressions tend to show up in rare intents, not on the happy path. After that period, turn the dual write off first, observe, and only then delete the old version vectors. And if storage cost bites before that, prefer reducing retention over accelerating disposal: the old vector is your behavioral backup.',
        },
        {
          type: 'ordered',
          items: [
            'Define the embedding version from model, dimension, normalization and prefixes, and require that filter on every search.',
            'Turn on dual write at ingestion, with the production version as primary and the new one as a resumable secondary.',
            'Run the backfill in batches with durable checkpoints, prioritizing the documents most accessed according to the retrieval log.',
            'Measure parity in shadow over a frozen query set, restricted to what the backfill already covers.',
            'Manually review the most divergent queries and fix ingestion or prefixes before exposing any customer.',
            'Raise the rollout in steps per traffic slice, comparing handoff and resolution in the same window.',
            'Keep the old version intact and fed until a seasonality cycle closes, and only then turn off dual write and dispose of it.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can the old vectors be converted into the new space instead of reindexing?',
      answer:
        'In practice, not reliably. It is possible to learn a linear projection between two spaces using pairs of texts embedded by both models, and the literature shows it partially works, but the loss is unevenly distributed: the easy cases keep working and the hard ones, which are exactly the ones retrieval needs to get right, degrade. You end up with an index that looks fine on average and fails on specific queries, and the worst part is that this failure is indistinguishable from a chunking or prompt problem during diagnosis. Add to that the fact that the projection must be recomputed for every new model and that re-embedding usually costs less than maintaining and validating that translation layer. Conversion is only justified when reindexing is impossible due to licensing constraints or data that no longer exists as text, and even then it demands the same parity measurement.',
    },
    {
      question: 'How long should both versions keep being written before disposing of the old one?',
      answer:
        'The criterion is not calendar time, it is scenario coverage. While the old version stays intact and up to date, a rollback costs a pointer change; after disposal, it costs a full reindex. The reasonable minimum period is the one covering a full seasonality cycle of your support operation, because retrieval regressions rarely show up in the most common intent, which is the most tested one, and instead appear in the intent that only happens at month end or in the quarterly campaign. A good operational marker is having seen the new version answer with stable quality across every intent in your case catalog, not only the frequent ones. Once that marker is reached, turn off dual write first, observe for another interval, and only then delete the old vectors.',
    },
    {
      question: 'Does an embedding migration require redoing the chunking as well?',
      answer:
        'They are independent decisions and it is better to keep them that way. New models tend to have larger context windows, which tempts you into larger chunks in the same move, and that combination destroys your diagnostic ability: if quality drops, you cannot tell whether the culprit is the model or the cut. Migrate the embedding first with the chunking frozen, measure parity against the baseline and complete the cutover. Then, if there is a hypothesis that larger chunks help, treat it as a second migration with the same process, now with the chunking version being part of the versioning key. The exception is when the model change requires a different input format, such as distinct instruction prefixes for query and document: that is not rechunking, it is an ingestion adjustment, and it must be part of the version definition.',
    },
  ],
  conclusion: {
    title: 'An embedding migration is coexistence, not replacement',
    description:
      'Swapping the embedding model looks like configuration and is a data migration: two incompatible vector spaces that must coexist while the corpus keeps changing. Versioning the vector and requiring the filter on every search, turning on dual write so the delta does not renew the frontier, running a resumable backfill prioritizing what traffic actually queries, deciding the cutover by parity measured in shadow and keeping the old index intact until a seasonality cycle closes turns a risk window into a process reversible at any moment. I can drive this migration in your RAG pipeline, designing the versioning, the backfill and the parity harness with your corpus and your real queries, so the model swap happens without a single worse answer reaching the customer.',
    cta: 'Talk about migrating the embeddings in my RAG',
  },
  related: [
    { label: 'Document chunking for RAG without losing context', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Reranking in RAG: better retrieval without swapping the model', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Model migration without breaking the prompt in production', to: '/blog/migracao-modelo-sem-quebrar-prompt-producao' },
  ],
  repo: { name: 'embedding-migration-kit', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El modelo de embedding nuevo salió, es más barato, tiene más dimensiones y puntúa mejor en los benchmarks públicos. Cambiar parece una línea de configuración, y ahí es donde la migración se vuelve incidente: un vector generado por un modelo no es comparable con un vector generado por otro. El espacio es distinto, el coseno entre un vector nuevo y uno viejo no significa nada, y en el instante en que tu aplicación pasa a embeber la pregunta con el modelo nuevo contra un índice que todavía tiene los vectores viejos, el retrieval no se degrada de a poco: se vuelve ruido. La salida obvia es reindexar todo antes de cambiar, pero reindexar un acervo de millones de chunks es una ventana larga de costo, throughput y rate limit del proveedor, y el acervo no se queda quieto esperando: entran y cambian documentos mientras el backfill corre. Este artículo trata la migración incremental: por qué los dos espacios no se mezclan, cómo versionar el vector para que ambos convivan, cómo hacer el backfill reanudable sin duplicar costo, cómo escribir en las dos versiones mientras el índice está a medias, cómo decidir el cambio por paridad medida en vez de por sensación y cómo volver atrás sin reindexar de nuevo.',
  sections: [
    {
      title: 'Dos espacios vectoriales no se mezclan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Lo primero que hay que internalizar es que un embedding no es una propiedad del texto, es una función del par texto y modelo. Cada modelo aprende su propia geometría: la dirección que codifica "plazo de reembolso" en el modelo viejo puede ser una dirección sin ningún significado en el modelo nuevo. Cuando calculás el coseno entre la pregunta embebida por el modelo B y un chunk embebido por el modelo A, la cuenta corre, devuelve un número entre menos uno y uno, y ese número no tiene relación con la similitud semántica. No hay error, ni excepción, ni log: el índice devuelve los k vecinos más cercanos según una métrica que perdió sentido, y el bot pasa a responder con fragmentos aleatoriamente plausibles. Es el peor tipo de falla, la que no aparece en ningún panel de error.',
        },
        {
          type: 'paragraph',
          value:
            'Esto vale incluso cuando los dos modelos tienen la misma dimensionalidad, y vale entre versiones del mismo proveedor. Dimensión igual solo significa que la operación aritmética es posible, no que sea significativa. Tampoco existe una matriz de traducción confiable entre espacios de propósito general: se puede aprender una proyección aproximada con pares alineados, pero la pérdida de calidad suele ser mayor que el costo de reindexar bien. La consecuencia práctica es dura y simple: durante toda la migración, la consulta debe embeberse con exactamente el mismo modelo que generó los vectores con los que se va a comparar. No hay término medio, y esa regla dicta todo el diseño que sigue.',
        },
        {
          type: 'table',
          columns: ['Combinación', '¿La cuenta corre?', '¿El resultado tiene sentido?', 'Consecuencia'],
          rows: [
            [
              'Consulta A contra índice A',
              'Sí',
              'Sí',
              'Comportamiento normal, es la línea base',
            ],
            [
              'Consulta B contra índice B',
              'Sí',
              'Sí',
              'Estado final deseado de la migración',
            ],
            [
              'Consulta B contra índice A, misma dimensión',
              'Sí',
              'No',
              'El retrieval se vuelve ruido sin levantar ningún error',
            ],
            [
              'Consulta B contra índice A, dimensión distinta',
              'No',
              'No aplica',
              'Error explícito de la base, falla ruidosa y por eso menos peligrosa',
            ],
            [
              'Índice mixto con vectores de A y B juntos',
              'Sí',
              'Parcialmente',
              'El peor caso, resultado bueno y malo intercalado sin señal de cuál es cuál',
            ],
          ],
        },
      ],
    },
    {
      title: 'Versionar el vector para que ambos convivan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si los espacios no se mezclan, el índice necesita saber a qué espacio pertenece cada vector. El modelado que resuelve esto es tratar la versión del embedding como parte de la clave, y no como un metadato informativo. La unidad deja de ser "el vector del chunk X" y pasa a ser "el vector del chunk X en la versión v2", con el identificador de versión derivado del nombre del modelo, la dimensión y cualquier parámetro que altere el resultado, como la normalización o el prefijo de instrucción que algunos modelos exigen. Dos filas del mismo chunk en versiones distintas conviven sin estorbarse, y toda búsqueda pasa a filtrar obligatoriamente por una versión.',
        },
        {
          type: 'paragraph',
          value:
            'Dónde vive ese filtro es una decisión de infraestructura, no de semántica. En una base vectorial con filtro por metadato, la versión es una columna indexada y la búsqueda lleva el predicado. En bases donde el filtro es caro o el índice aproximado se degrada con predicados, la alternativa más limpia es una colección por versión, lo que además simplifica el descarte: promover es apuntar la lectura a la colección nueva, y limpiar es tirar la vieja entera. Lo que no funciona es guardar la versión en un campo suelto sin obligar el filtro, porque basta que una consulta olvide el predicado una vez para que el índice mixto entregue el peor caso de la tabla anterior. La defensa barata es hacer que la capa de acceso exija la versión como argumento y nunca tenga un valor por defecto implícito.',
        },
        {
          type: 'code',
          value: `// embeddings/version.js
// La version del embedding se deriva de todo lo que cambia el vector resultante.
// Si alguno de esos campos cambia, el vector generado deja de ser comparable
// con los anteriores, asi que la version tiene que cambiar junto.

import { createHash } from 'node:crypto';

export function embeddingVersion(config) {
  const canonical = JSON.stringify({
    model: config.model,
    dimensions: config.dimensions,
    normalized: Boolean(config.normalized),
    // Algunos modelos exigen prefijos distintos para consulta y documento.
    queryPrefix: config.queryPrefix ?? '',
    documentPrefix: config.documentPrefix ?? '',
  });

  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 8);
  return \`\${config.model}@\${digest}\`;
}

// La capa de acceso nunca acepta una busqueda sin version explicita.
// Sin ese guarda, una sola consulta olvidada devuelve el indice mixto.
export async function search(store, { queryVector, version, topK = 8 }) {
  if (!version) {
    throw new Error('search requiere version explicita del embedding');
  }

  return store.query({
    vector: queryVector,
    topK,
    filter: { embedding_version: version },
  });
}`,
        },
      ],
    },
    {
      title: 'Backfill reanudable en vez de reindexación monolítica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con las dos versiones pudiendo convivir, el backfill deja de ser un evento y se vuelve un proceso en segundo plano que puede parar y continuar. La diferencia entre un script que corre una vez y un backfill de verdad está en tres propiedades. La primera es el checkpoint durable: el progreso tiene que estar guardado fuera del proceso, no en una variable de bucle, porque el job se va a caer a la mitad, el pod se va a reciclar en el deploy y el rate limit del proveedor va a forzar una pausa larga. La segunda es la idempotencia de la escritura: reprocesar un lote ya hecho debe sobrescribir la misma fila, nunca crear una segunda copia, porque el backfill siempre reprocesa la frontera del último checkpoint. La tercera es el control de caudal, ya que el cuello de botella real casi nunca es tu base, es la cuota de tokens del proveedor de embedding.',
        },
        {
          type: 'paragraph',
          value:
            'El orden de procesamiento impacta directamente en el valor entregado por hora de backfill. Procesar por identificador creciente es simple y previsible, pero trata igual al documento que responde la mitad de las consultas y al que nadie abre desde la ingesta. Priorizar por frecuencia de acceso, usando el log de retrieval de los últimos treinta días, hace que la mayor parte del tráfico real quede cubierta por la versión nueva bastante antes de que el backfill termine, y eso es lo que permite empezar a comparar las dos versiones temprano en vez de esperar el acervo entero. Vale medir el progreso en dos escalas: la cobertura bruta, que es la fracción de chunks migrados, y la cobertura ponderada por tráfico, que es la que realmente dice si ya se puede evaluar el cambio.',
        },
        {
          type: 'code',
          value: `// embeddings/backfill.js
// Backfill en lotes, reanudable por checkpoint durable e idempotente en la escritura.

export async function runBackfill({
  chunks,       // { listPending(version, cursor, limit), }
  embedder,     // { embedDocuments(texts) }
  store,        // { upsertMany(rows) }
  checkpoints,  // { read(job), write(job, cursor) }
  version,
  batchSize = 128,
  onProgress = () => {},
}) {
  const job = \`backfill:\${version}\`;
  let cursor = await checkpoints.read(job);
  let migrated = 0;

  for (;;) {
    const batch = await chunks.listPending(version, cursor, batchSize);
    if (batch.length === 0) break;

    const vectors = await embedder.embedDocuments(batch.map((c) => c.text));

    // Clave compuesta por chunk y version: reprocesar el mismo lote sobrescribe
    // la misma fila en vez de duplicar, asi que reanudar del checkpoint es seguro.
    await store.upsertMany(
      batch.map((chunk, i) => ({
        id: \`\${chunk.id}::\${version}\`,
        chunkId: chunk.id,
        vector: vectors[i],
        embedding_version: version,
        documentId: chunk.documentId,
      })),
    );

    cursor = batch[batch.length - 1].id;
    migrated += batch.length;

    // Checkpoint despues de la escritura: si se cae antes de aqui, el peor caso
    // es reprocesar el ultimo lote, nunca saltear un chunk.
    await checkpoints.write(job, cursor);
    onProgress({ migrated, cursor });
  }

  return { migrated };
}`,
        },
      ],
    },
    {
      title: 'Escribir en las dos versiones mientras el acervo cambia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más común de la migración incremental no está en el backfill, está en lo que le pasa al documento que entra durante él. Si la ingesta sigue generando solo la versión vieja, el backfill nunca converge, porque la frontera de contenido no migrado se renueva sola. Si la ingesta pasa a generar solo la versión nueva, el índice viejo se pudre justo mientras todavía es el que sirve a producción, y el rollback deja de existir. La respuesta es la escritura doble: mientras la migración esté abierta, todo chunk nuevo o modificado se embebe en las dos versiones y se escribe en las dos. Cuesta el doble de embedding en la ingesta, y ese costo es temporal y proporcional al delta, no al acervo.',
        },
        {
          type: 'paragraph',
          value:
            'La escritura doble necesita una decisión explícita sobre la falla parcial. Si la versión nueva falla al embeber y la vieja ya se guardó, el documento queda inconsistente entre los espacios, y la pregunta es cuál de las dos versiones es obligatoria. Mientras producción lee de la vieja, es ella la que tiene que hacer fallar la operación entera; la nueva puede fallar de forma tolerada y ser recuperada por el propio backfill, siempre que el chunk vuelva a la cola de pendientes en vez de desaparecer. Después del cambio, esa relación se invierte. Modelar esto como una versión primaria y una secundaria, con la secundaria siempre recuperable por el backfill, evita tanto el índice mudo como el incidente de ingesta trabada por un espacio que ni siquiera está en uso todavía.',
        },
        {
          type: 'diagram',
          value: `INGESTA (durante la migracion)
  documento nuevo/modificado
        |
        +--> embed v1 (primaria) ---> upsert indice v1 --> una falla aqui aborta
        |                                                  toda la operacion
        +--> embed v2 (secundaria) -> upsert indice v2 --> una falla aqui solo
                                                           reencola el chunk

BACKFILL (segundo plano)
  chunks sin v2 --> lotes --> embed v2 --> upsert v2 --> checkpoint

LECTURA
  fase 1  consulta -> embed v1 -> busqueda filtrada por v1     (100% del trafico)
  fase 2  consulta -> embed v1 y v2 -> compara en sombra       (v1 responde)
  fase 3  consulta -> embed v2 -> busqueda filtrada por v2     (porcion creciente)
  fase 4  v1 congelada, solo lectura, lista para descarte`,
        },
      ],
    },
    {
      title: 'Decidir el cambio por paridad medida, no por sensación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backfill completo no es criterio de cambio. Lo que decide es si el retrieval en la versión nueva es al menos tan bueno como el de la vieja para las consultas que tu sistema realmente recibe, y eso se mide antes de exponer a cualquier cliente. El instrumento es un conjunto congelado de consultas reales, muestreadas del log de producción y cubriendo las intenciones principales, con el resultado de la versión vieja guardado como línea base. Para cada consulta, embebé en las dos versiones, buscá en las dos y compará. Dos métricas alcanzan para la decisión: el solapamiento del top-k, que dice cuánto coinciden los conjuntos recuperados, y el cambio de posición del fragmento que era el correcto, cuando tenés esa anotación.',
        },
        {
          type: 'paragraph',
          value:
            'Solapamiento bajo no es automáticamente malo. El modelo nuevo puede estar recuperando fragmentos distintos y mejores, y por eso la comparación puramente estadística no cierra la decisión sola. El camino práctico es usar el solapamiento como filtro barato para encontrar las consultas que más divergieron y revisar esas manualmente o con un juez automático, porque ahí es donde aparece la regresión real. Un detalle operativo que evita falsa alarma: corré la comparación solo en las consultas cuyos documentos relevantes ya estén cubiertos por el backfill, si no vas a medir cobertura incompleta creyendo que medís calidad del modelo.',
        },
        {
          type: 'code',
          value: `// embeddings/parity.js
// Compara el retrieval de las dos versiones sobre un conjunto congelado de consultas.
// Corre en sombra: ningun cliente es expuesto a la version nueva en esta etapa.

const overlapAt = (a, b, k) => {
  const top = new Set(a.slice(0, k).map((hit) => hit.chunkId));
  const hits = b.slice(0, k).filter((hit) => top.has(hit.chunkId)).length;
  return hits / k;
};

export async function measureParity({
  queries,      // [{ id, text, expectedChunkId? }]
  embedder,     // { embedQuery(text, version) }
  search,       // (vector, version) => hits
  from,
  to,
  k = 8,
}) {
  const rows = [];

  for (const query of queries) {
    const [oldVector, newVector] = await Promise.all([
      embedder.embedQuery(query.text, from),
      embedder.embedQuery(query.text, to),
    ]);

    const [oldHits, newHits] = await Promise.all([
      search(oldVector, from),
      search(newVector, to),
    ]);

    const rankOf = (hits) => {
      const index = hits.findIndex((hit) => hit.chunkId === query.expectedChunkId);
      return index === -1 ? null : index + 1;
    };

    rows.push({
      queryId: query.id,
      overlap: overlapAt(oldHits, newHits, k),
      rankBefore: query.expectedChunkId ? rankOf(oldHits) : null,
      rankAfter: query.expectedChunkId ? rankOf(newHits) : null,
    });
  }

  const mean = (values) => values.reduce((sum, v) => sum + v, 0) / (values.length || 1);
  const annotated = rows.filter((row) => row.rankBefore !== null);

  return {
    rows,
    meanOverlap: mean(rows.map((row) => row.overlap)),
    // Las regresiones bloquean el cambio: el fragmento correcto empeoro de posicion.
    regressions: annotated.filter(
      (row) => row.rankAfter === null || row.rankAfter > row.rankBefore,
    ),
    // Las mayores divergencias son la cola de revision manual.
    mostDivergent: [...rows].sort((a, b) => a.overlap - b.overlap).slice(0, 20),
  };
}`,
        },
        {
          type: 'table',
          columns: ['Señal medida', 'Lectura', 'Decisión'],
          rows: [
            [
              'Solapamiento alto y ninguna regresión anotada',
              'La versión nueva es equivalente en la práctica',
              'Habilitar el rollout gradual con seguridad',
            ],
            [
              'Solapamiento bajo y regresiones anotadas',
              'La versión nueva perdió fragmentos que importaban',
              'Bloquear el cambio y revisar chunking o prefijo de consulta',
            ],
            [
              'Solapamiento bajo y ninguna regresión anotada',
              'Recuperó fragmentos distintos, posiblemente mejores',
              'Revisar manualmente las consultas más divergentes antes de decidir',
            ],
            [
              'Divergencia concentrada en un tipo de documento',
              'Problema de formato o prefijo, no del modelo',
              'Corregir la ingesta de ese tipo y rehacer solo ese recorte',
            ],
            [
              'Cobertura ponderada por tráfico todavía baja',
              'La métrica está midiendo backfill, no calidad',
              'Esperar cobertura antes de interpretar la paridad',
            ],
          ],
        },
      ],
    },
    {
      title: 'Cambiar, mantener el rollback y descartar al final',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio es una modificación de configuración de lectura, no un deploy de código, y eso es lo que vuelve instantáneo el rollback. La versión de lectura vive en un puntero consultado en cada petición, con granularidad por porción de tráfico, y el rollout sube en escalones, comparando las métricas de negocio de la porción nueva contra la vieja en la misma ventana de tiempo. Lo que se observa acá ya no es solapamiento de top-k, es el efecto en la atención: tasa de traspaso a humano, reformulación de la pregunta por parte del cliente y resolución en la primera respuesta. Si algún escalón empeora esos números, el puntero vuelve a la versión vieja en segundos, sin redeploy y sin reindexación, porque el índice viejo sigue íntegro y alimentado por la escritura doble.',
        },
        {
          type: 'paragraph',
          value:
            'El descarte es la última etapa y la más fácil de hacer demasiado pronto. Mientras el índice viejo exista y esté actualizado, la migración es reversible; en el momento en que se borre, volver significa reindexar el acervo entero de nuevo. Vale mantener la versión vieja viva por un período que cubra al menos un ciclo completo de estacionalidad de tu atención, con la escritura doble encendida, porque la regresión de retrieval suele aparecer en la intención rara, no en el camino feliz. Después de ese período, apagá primero la escritura doble, observá, y recién entonces borrá los vectores de la versión vieja. Y si el costo de almacenamiento pesa antes de eso, preferí reducir la retención a acelerar el descarte: el vector viejo es tu respaldo de comportamiento.',
        },
        {
          type: 'ordered',
          items: [
            'Definir la versión del embedding a partir de modelo, dimensión, normalización y prefijos, y exigir ese filtro en toda búsqueda.',
            'Encender la escritura doble en la ingesta, con la versión en producción como primaria y la nueva como secundaria reanudable.',
            'Correr el backfill en lotes con checkpoint durable, priorizando los documentos más accedidos según el log de retrieval.',
            'Medir paridad en sombra sobre un conjunto congelado de consultas, restringido a lo que el backfill ya cubre.',
            'Revisar manualmente las consultas más divergentes y corregir ingesta o prefijo antes de exponer cliente.',
            'Subir el rollout en escalones por porción de tráfico, comparando traspaso y resolución en la misma ventana.',
            'Mantener la versión vieja íntegra y alimentada hasta cerrar un ciclo de estacionalidad, y recién entonces apagar la escritura doble y descartar.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Se pueden convertir los vectores viejos al espacio nuevo en vez de reindexar?',
      answer:
        'En la práctica, no de forma confiable. Es posible aprender una proyección lineal entre dos espacios usando pares de textos embebidos por los dos modelos, y la literatura muestra que funciona parcialmente, pero la pérdida se distribuye de forma despareja: los casos fáciles siguen funcionando y los difíciles, que son justamente los que el retrieval necesita acertar, se degradan. Terminás con un índice que parece bueno en promedio y falla en las consultas específicas, y lo peor es que esa falla no se distingue de un problema de chunking o de prompt en el diagnóstico. Sumá que la proyección debe recalcularse con cada modelo nuevo y que el costo de volver a embeber suele ser menor que el de mantener y validar esa capa de traducción. La conversión solo se justifica cuando reindexar es imposible por restricción de licencia o por dato que ya no existe en texto, y aun así exige la misma medición de paridad.',
    },
    {
      question: '¿Cuánto tiempo mantener las dos versiones escribiendo antes de descartar la vieja?',
      answer:
        'El criterio no es tiempo de calendario, es cobertura de escenarios. Mientras la versión vieja esté íntegra y actualizada, el rollback cuesta un cambio de puntero; después del descarte, cuesta una reindexación completa. El período mínimo razonable es el que cubre un ciclo entero de estacionalidad de tu atención, porque la regresión de retrieval rara vez aparece en la intención más común, que es la más probada, sino en la que solo ocurre en el cierre de mes o en la campaña trimestral. Un buen marcador operativo es haber visto a la versión nueva responder con calidad estable a todas las intenciones que aparecen en tu catálogo de casos, no solo a las frecuentes. Cuando ese marcador se alcance, apagá primero la escritura doble, observá por otro intervalo, y recién entonces borrá los vectores viejos.',
    },
    {
      question: '¿La migración de embedding exige rehacer el chunking también?',
      answer:
        'Son decisiones independientes y conviene mantenerlas así. Los modelos nuevos suelen tener ventana de contexto mayor, lo que tienta a hacer chunks más grandes en el mismo movimiento, y esa combinación destruye la capacidad de diagnóstico: si la calidad cae, no sabés si el culpable es el modelo o el corte. Migrá primero el embedding con el chunking congelado, medí la paridad contra la línea base y completá el cambio. Después, si hay hipótesis de que los chunks más grandes ayudan, tratalo como una segunda migración con el mismo proceso, ahora con la versión del chunking formando parte de la clave de versionado. La excepción es cuando el cambio de modelo exige un formato de entrada distinto, como prefijo de instrucción diferente para consulta y documento: eso no es rechunking, es ajuste de ingesta, y tiene que entrar en la definición de la versión.',
    },
  ],
  conclusion: {
    title: 'La migración de embedding es convivencia, no sustitución',
    description:
      'Cambiar el modelo de embedding parece configuración y es migración de dato: dos espacios vectoriales incompatibles que deben convivir mientras el acervo sigue cambiando. Versionar el vector y exigir el filtro en toda búsqueda, encender la escritura doble para que el delta no renueve la frontera, correr el backfill reanudable priorizando lo que el tráfico realmente consulta, decidir el cambio por paridad medida en sombra y mantener el índice viejo íntegro hasta cerrar un ciclo de estacionalidad transforma una ventana de riesgo en un proceso reversible en cualquier momento. Puedo conducir esa migración en tu pipeline de RAG, diseñando el versionado, el backfill y el harness de paridad con tu acervo y tus consultas reales, para que el cambio de modelo ocurra sin una sola respuesta peor llegando al cliente.',
    cta: 'Hablar sobre migrar los embeddings de mi RAG',
  },
  related: [
    { label: 'Chunking de documento para RAG sin perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Reranking en RAG: mejorar el retrieval sin cambiar el modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Migración de modelo sin romper el prompt en producción', to: '/blog/migracao-modelo-sem-quebrar-prompt-producao' },
  ],
  repo: { name: 'embedding-migration-kit', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
