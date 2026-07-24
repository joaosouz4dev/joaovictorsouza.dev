// Conteudo do artigo: deduplicacao de contexto em RAG para cortar o trecho repetido.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Deduplicador de contexto mínimo: recebe os trechos recuperados por uma busca de RAG, detecta a repetição em três níveis (idêntico por hash, quase idêntico por shingles e sobreposição de janelas do mesmo documento), funde o que se sobrepõe em vez de descartar cegamente e devolve o contexto deduplicado junto de um relatório do que foi fundido, para que a janela carregue passagens distintas em vez da mesma informação cinco vezes.',
  en: 'Minimal context deduplicator: it takes the passages retrieved by a RAG search, detects repetition at three levels (identical by hash, near-identical by shingles and window overlap from the same document), merges what overlaps instead of blindly discarding and returns the deduplicated context alongside a report of what was merged, so the window carries distinct passages instead of the same information five times.',
  es: 'Deduplicador de contexto mínimo: recibe los fragmentos recuperados por una búsqueda de RAG, detecta la repetición en tres niveles (idéntico por hash, casi idéntico por shingles y solapamiento de ventanas del mismo documento), fusiona lo que se solapa en vez de descartar a ciegas y devuelve el contexto deduplicado junto a un reporte de lo que se fusionó, para que la ventana lleve pasajes distintos en vez de la misma información cinco veces.',
};

const repoUrl = 'https://github.com/joaosouz4dev/rag-context-dedup';

const pt = {
  intro:
    'Você monta o RAG, mede o recall, aumenta o top-k para garantir que a resposta está lá dentro, e a qualidade não sobe na proporção. Quando abre o prompt que foi mandado ao modelo, entende por quê: dos oito trechos recuperados, cinco dizem a mesma coisa. É a mesma política de reembolso que aparece no manual, no FAQ, no e-mail de treinamento e em duas versões do mesmo documento que ninguém arquivou. O retriever fez o trabalho dele, achou tudo que é relevante, e o problema é justamente esse: relevante não significa novo. Cada trecho repetido ocupa espaço na janela que um trecho distinto poderia ocupar, e o resultado é um contexto que parece cheio mas é raso, gastando tokens para reafirmar o que já estava dito enquanto a informação que faltava ficou de fora do corte. Este artigo trata da deduplicação de contexto: por que a repetição não é só desperdício mas também viés, os três níveis em que a duplicata aparece, como detectar cada um com o custo certo, por que fundir é melhor do que descartar, onde encaixar o passo no pipeline e como medir se a deduplicação está aumentando a densidade de informação ou cortando sinal.',
  sections: [
    {
      title: 'Repetição não é só desperdício, é viés',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro custo da duplicata é óbvio: token gasto. Se cinco dos oito trechos dizem a mesma coisa, você pagou por oito e recebeu a informação de quatro, e os quatro trechos distintos que ficaram de fora do top-k eram justamente os que poderiam completar a resposta. Mas o custo mais grave é o segundo, e ele quase nunca é medido: a repetição enviesa o modelo. Um fato que aparece cinco vezes no contexto parece mais estabelecido, mais confirmado e mais importante do que um fato que aparece uma vez, e o modelo trata assim, porque é exatamente esse o sinal que a repetição carrega em texto natural. Só que aqui a repetição não vem de consenso, vem de indexação: o mesmo parágrafo foi copiado em quatro documentos, ou o mesmo documento foi ingerido duas vezes com nomes diferentes.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é uma distorção silenciosa da resposta. Quando o contexto tem uma versão antiga da política repetida quatro vezes e a versão nova uma vez só, o modelo tende a responder com a antiga, e não porque ela é melhor, mas porque ela é mais frequente naquele prompt. O retriever não errou, os dois documentos são relevantes, mas a densidade de cópias decidiu o resultado. É por isso que deduplicar não é uma otimização de custo que se faz quando sobra tempo: é uma correção de viés. Sem ela, a sua resposta reflete quantas vezes cada fato foi copiado no seu acervo, e não qual fato está certo.',
        },
        {
          type: 'table',
          columns: ['Sintoma no prompt', 'Causa provável', 'Efeito na resposta'],
          rows: [
            [
              'Mesmo parágrafo palavra por palavra em vários trechos',
              'Documento ingerido duas vezes ou boilerplate copiado',
              'Gasta janela e infla a confiança do modelo naquele fato',
            ],
            [
              'Trechos quase iguais com pequenas diferenças de redação',
              'Versões do mesmo documento coexistindo no índice',
              'Modelo mistura versões e pode responder com a desatualizada',
            ],
            [
              'Trechos consecutivos do mesmo documento com miolo repetido',
              'Chunking com janela sobreposta',
              'Repete o meio e desperdiça o espaço das bordas novas',
            ],
            [
              'Aumentar o top-k não melhora a resposta',
              'Os trechos extras são cópias, não informação nova',
              'Custo sobe, qualidade fica igual ou piora',
            ],
          ],
        },
      ],
    },
    {
      title: 'Os três níveis de duplicata',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Duplicata não é uma coisa só, e tratar todas com a mesma técnica é o erro que faz a deduplicação parecer cara ou imprecisa. O primeiro nível é a duplicata exata: dois trechos com o mesmo texto, caractere por caractere. Isso acontece mais do que se imagina, porque o mesmo PDF entrou duas vezes no índice, ou porque o rodapé jurídico se repete em todo documento e virou chunk. Detectar isso é barato: normaliza o texto e compara um hash. O segundo nível é o quase idêntico: dois trechos que dizem exatamente a mesma coisa com diferenças de formatação, pontuação, uma frase a mais no começo ou uma versão levemente editada do mesmo parágrafo. Hash não pega, porque um caractere diferente muda o hash inteiro, e é aqui que a maioria das duplicatas reais mora.',
        },
        {
          type: 'paragraph',
          value:
            'O terceiro nível é a sobreposição de janelas, e ele é específico de RAG. Se o seu chunking usa janela deslizante com overlap, dois chunks vizinhos do mesmo documento compartilham um pedaço por construção, e quando os dois são recuperados juntos, o miolo comum aparece duas vezes no prompt. Esse caso não é bem uma duplicata para descartar, é uma sobreposição para costurar: os dois trechos têm bordas distintas que você quer manter, e só o meio se repete. E existe ainda a duplicata semântica, dois textos completamente diferentes na letra que afirmam o mesmo fato, que é a mais cara de detectar e a mais perigosa de tratar, porque a fronteira entre "diz o mesmo" e "diz algo parecido mas com uma exceção importante" é tênue.',
        },
        {
          type: 'table',
          columns: ['Nível', 'Como detectar', 'Custo', 'O que fazer'],
          rows: [
            [
              'Exata',
              'Hash do texto normalizado',
              'Muito baixo',
              'Descartar a cópia, manter a de melhor score',
            ],
            [
              'Quase idêntica',
              'Similaridade de shingles (Jaccard) ou MinHash',
              'Baixo',
              'Manter uma, registrar as fontes das outras',
            ],
            [
              'Sobreposição de janela',
              'Sufixo/prefixo comum entre chunks do mesmo doc',
              'Baixo',
              'Fundir num trecho único costurado',
            ],
            [
              'Semântica',
              'Similaridade de embedding acima de um limiar alto',
              'Médio',
              'Agrupar e resumir, nunca descartar cegamente',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detectar barato antes de detectar caro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem importa. Deduplicação bem feita é uma cascata que começa pelo detector mais barato e só usa o mais caro no que sobrou. Primeiro o hash, que elimina as cópias exatas com custo praticamente zero e já limpa uma fatia grande em acervos reais. Depois a similaridade léxica por shingles, que quebra o texto em n-gramas e compara os conjuntos: dois trechos com Jaccard acima de um limiar alto dizem a mesma coisa com outra pontuação. Depois a sobreposição de janela, que só precisa ser testada entre chunks do mesmo documento e é resolvida comparando sufixo com prefixo. E só no fim, se ainda fizer sentido, a comparação por embedding, que é a única que pega paráfrase de verdade e é também a única que custa vetor e tempo.',
        },
        {
          type: 'paragraph',
          value:
            'A tentação de pular direto para o embedding é grande porque ele parece resolver tudo de uma vez, e é justamente aí que a deduplicação vira um passo caro e impreciso. Caro porque você compara todo mundo com todo mundo num conjunto que o hash teria reduzido pela metade em um milissegundo. Impreciso porque similaridade de embedding alta não é sinônimo de conteúdo redundante: dois parágrafos sobre a mesma política, um dizendo que o reembolso vale por trinta dias e outro dizendo que não vale para produto usado, têm embedding altíssimo e são informação complementar, não duplicata. Descartar um deles pelo cosseno é perder exatamente a exceção que o cliente perguntou.',
        },
        {
          type: 'code',
          value: `// rag/dedup.js
// Cascata de deduplicacao: do detector mais barato para o mais caro.
// Cada nivel roda apenas no que sobrou do nivel anterior.

export function dedupPassages(passages, { jaccardThreshold = 0.85 } = {}) {
  const merged = [];
  const report = [];

  // Ordena por score: a passagem que fica e sempre a de melhor score,
  // e as demais viram fontes adicionais dela, nao lixo silencioso.
  const ordered = [...passages].sort((a, b) => b.score - a.score);

  for (const candidate of ordered) {
    // Nivel 1: exata. Hash do texto normalizado, custo quase zero.
    const key = hashNormalized(candidate.text);
    const exact = merged.find((p) => p.hash === key);
    if (exact) {
      exact.sources.push(candidate.source);
      report.push({ level: 'exact', dropped: candidate.id, into: exact.id });
      continue;
    }

    // Nivel 2: quase identica. Shingles + Jaccard, ainda barato.
    const near = merged.find(
      (p) => jaccard(shingles(p.text), shingles(candidate.text)) >= jaccardThreshold,
    );
    if (near) {
      near.sources.push(candidate.source);
      report.push({ level: 'near', dropped: candidate.id, into: near.id });
      continue;
    }

    // Nivel 3: sobreposicao de janela. So entre chunks do MESMO documento,
    // e o tratamento e fundir (costurar bordas), nao descartar.
    const neighbor = merged.find(
      (p) => p.docId === candidate.docId && overlapLength(p.text, candidate.text) > 0,
    );
    if (neighbor) {
      neighbor.text = stitch(neighbor.text, candidate.text);
      neighbor.sources.push(candidate.source);
      report.push({ level: 'overlap', merged: candidate.id, into: neighbor.id });
      continue;
    }

    merged.push({ ...candidate, hash: key, sources: [candidate.source] });
  }

  return { passages: merged, report };
}`,
        },
      ],
    },
    {
      title: 'Fundir é melhor do que descartar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reflexo natural ao encontrar duas passagens parecidas é jogar uma fora. Para a duplicata exata isso está certo, mas para os outros níveis é uma perda de informação disfarçada de limpeza. Dois chunks vizinhos com overlap não são duas cópias, são um trecho maior partido no meio: descartar um deles apaga uma borda que só ele tinha. Duas versões quase iguais de um parágrafo não são redundância pura: a diferença entre elas pode ser exatamente a cláusula que mudou na revisão. A regra que evita esse tipo de perda é simples: quanto menos exata a duplicata, mais a operação certa é fundir em vez de descartar, e a fusão precisa preservar as bordas distintas.',
        },
        {
          type: 'diagram',
          value: `Deduplicacao em cascata: barato -> caro, e funde em vez de descartar

  top-k do retriever (8 trechos, muita repeticao)
     |
     v
  [1] hash do texto normalizado ......... corta copia exata
     |                                     (descarta, guarda a fonte)
     v
  [2] shingles + Jaccard ................ corta quase identica
     |                                     (mantem a de maior score)
     v
  [3] sufixo x prefixo (mesmo doc) ...... FUNDE janelas sobrepostas
     |     A: [....miolo]                  resultado: [....miolo....]
     |     B:     [miolo....]              (as duas bordas sobrevivem)
     v
  [4] embedding (opcional, caro) ........ agrupa parafrase
     |                                     (agrupa e resume, nao descarta)
     v
  contexto denso: trechos distintos, cada um com suas fontes
     |
     +-- espaco liberado -> puxa o proximo trecho da fila do retriever
     |
     v
  prompt final: mesma janela, mais informacao unica dentro dela`,
        },
        {
          type: 'paragraph',
          value:
            'A fusão tem um efeito colateral valioso: ela deixa a citação mais honesta. Quando três passagens dizem o mesmo fato e você funde numa só, essa passagem passa a carregar três fontes, e o modelo pode citar o documento certo sem que o fato ocupe três blocos do prompt. Você separou a densidade de evidência da densidade de texto, que era exatamente o que a repetição bagunçava. E há um segundo ganho, esse direto na qualidade: o espaço liberado pela deduplicação não deve simplesmente sobrar, ele deve puxar o próximo trecho da fila do retriever. Deduplicar sem reabastecer economiza tokens; deduplicar reabastecendo aumenta a quantidade de informação distinta que cabe na mesma janela, que é o objetivo real.',
        },
      ],
    },
    {
      title: 'Onde encaixar o passo no pipeline',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deduplicação pode acontecer em três momentos diferentes, e eles não são alternativas, são camadas complementares. A primeira é na ingestão: antes de indexar, você detecta que aquele documento já está no acervo e não o duplica. É a mais eficiente, porque resolve o problema na origem e nunca mais paga por ele, mas ela só pega o que é duplicata no momento da entrada e não protege contra o boilerplate que se repete legitimamente entre documentos diferentes. A segunda é na recuperação, depois do retriever e antes de montar o prompt, e é a camada indispensável: só ali você sabe quais trechos específicos foram selecionados juntos para esta pergunta e como eles se sobrepõem entre si.',
        },
        {
          type: 'ordered',
          items: [
            'Ingestão: detecta documento já indexado e boilerplate recorrente antes de gerar chunks. Resolve na origem, mas não vê a combinação específica de trechos de cada consulta.',
            'Pós-retrieval, antes do rerank: reduz o conjunto que o reranker vai pontuar, o que barateia o rerank e evita que ele gaste posições com cópias.',
            'Pós-rerank, antes do prompt: a camada indispensável, porque é a última chance de garantir que a janela não carrega o mesmo fato várias vezes.',
            'Reabastecimento: para cada trecho removido, puxe o próximo da fila do retriever, para que a deduplicação aumente informação distinta em vez de só sobrar espaço.',
            'Registro: guarde o relatório do que foi fundido e com quais fontes, para auditar a citação e para depurar quando uma resposta perder um detalhe.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A relação com o reranking merece uma nota, porque os dois passos parecem resolver a mesma coisa e não resolvem. O reranker ordena por relevância, e ele não tem nenhuma obrigação de olhar para redundância: se as cinco cópias da política são todas muito relevantes, um reranker bem calibrado coloca as cinco no topo, e ele está certo pelo critério dele. Deduplicar é o passo ortogonal que otimiza diversidade em vez de relevância. Rodar a deduplicação antes do rerank barateia o rerank e evita que ele desperdice posições; rodar depois garante a limpeza final. Em pipelines exigentes vale rodar nos dois pontos, com limiar mais conservador antes e mais estrito depois.',
        },
      ],
    },
    {
      title: 'O limiar que corta sinal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda deduplicação tem um limiar, e todo limiar erra para os dois lados. Frouxo demais, ele deixa passar quase duplicatas e você não ganha nada. Estrito demais, ele funde ou descarta trechos que eram complementares, e aí a deduplicação passa a destruir exatamente o que o retriever tinha achado. O caso clássico é o de dois parágrafos sobre a mesma regra em que um enuncia o caso geral e o outro a exceção: eles são textualmente parecidíssimos, têm embedding altíssimo, e são a informação mais importante que existe naquela consulta. Um limiar agressivo joga a exceção fora e o bot passa a responder a regra geral em todos os casos, inclusive nos que ela não vale.',
        },
        {
          type: 'paragraph',
          value:
            'A proteção contra esse erro tem três partes. A primeira é a assimetria de tratamento por nível: descarte só é seguro no nível exato, e quanto mais semântica a comparação, mais a operação certa é agrupar e resumir preservando as diferenças, nunca eliminar. A segunda é a proteção por negação e número: se dois trechos parecidos divergem numa negação, num valor, numa data ou numa condição, eles não são duplicatas por definição, e essa checagem barata bloqueia o pior tipo de falso positivo. A terceira é o registro: toda remoção fica no relatório, com o que foi removido e por qual regra, porque uma deduplicação que apaga em silêncio é indepurável quando a resposta sai errada.',
        },
        {
          type: 'code',
          value: `// rag/dedup-guard.js
// Freio contra o falso positivo: trechos parecidos que DIVERGEM
// em negacao, numero, data ou condicao nao sao duplicatas.

const DIVERGENCE_PATTERNS = [
  /\\b(nao|exceto|salvo|desde que|apenas se)\\b/i, // condicao e negacao
  /\\d+([.,]\\d+)?\\s*(dias|meses|%|reais)/i,       // valores e prazos
];

export function isSafeDuplicate(a, b) {
  // Se um dos trechos tem um marcador de divergencia que o outro nao tem,
  // eles podem ser regra geral x excecao. Nunca funda nesse caso.
  for (const pattern of DIVERGENCE_PATTERNS) {
    const inA = extractMatches(a.text, pattern);
    const inB = extractMatches(b.text, pattern);
    if (!sameSet(inA, inB)) return false;
  }
  return true;
}

export function dedupWithGuard(passages, options) {
  const { passages: candidates, report } = dedupPassages(passages, options);

  // Reintroduz o que o guard vetou: melhor gastar janela com uma
  // possivel duplicata do que perder a excecao que muda a resposta.
  const restored = report
    .filter((r) => r.level !== 'exact')
    .filter((r) => !isSafeDuplicate(byId(passages, r.dropped), byId(candidates, r.into)))
    .map((r) => byId(passages, r.dropped));

  return { passages: [...candidates, ...restored], report };
}`,
        },
      ],
    },
    {
      title: 'Medir densidade, não só economia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A métrica errada para avaliar deduplicação é a economia de tokens, porque ela sempre melhora: quanto mais agressivo o limiar, menos tokens, e o gráfico sobe bonito enquanto a qualidade despenca. A métrica certa é a densidade de informação única na janela: quantos fatos distintos e relevantes o contexto carrega depois da deduplicação em relação a antes. Se você deduplica e reabastece, a contagem de tokens fica praticamente igual e o número de fatos distintos sobe, e é exatamente esse o resultado que você quer ver. Se a economia de tokens sobe e a densidade fica igual, você só está gastando menos para entregar o mesmo; se a densidade cai, o limiar está cortando sinal.',
        },
        {
          type: 'ordered',
          items: [
            'Fatos distintos por janela: conte quantas afirmações únicas e relevantes o contexto carrega antes e depois; deduplicar com reabastecimento tem que subir esse número.',
            'Taxa de falso positivo do limiar: em um conjunto rotulado com pares regra geral x exceção, meça quantas exceções a deduplicação removeu. O alvo prático é zero.',
            'Acerto de resposta com e sem o passo: rode o mesmo conjunto de perguntas com e sem deduplicação e compare a resposta final, que é a única métrica que importa de verdade.',
            'Cobertura por nível: acompanhe quanto cada nível remove; se o exato e o quase idêntico cortam muito, o problema real está na ingestão e deve ser resolvido lá.',
            'Fidelidade da citação: verifique que a passagem fundida cita todas as fontes que foram fundidas nela, para que a evidência não desapareça junto com a cópia.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale medir também um sinal de diagnóstico que aponta para fora do RAG: se a deduplicação está cortando uma fração enorme do contexto todo dia, o problema não é de recuperação, é de acervo. Documento ingerido em duplicata, versões antigas que ninguém arquivou, boilerplate que deveria ter sido removido no chunking. A deduplicação em tempo de consulta é uma rede de segurança boa e barata, mas ela paga o mesmo custo repetidamente em toda pergunta para consertar algo que uma limpeza única no índice resolveria de vez. Quando o relatório mostra que o mesmo par de documentos é fundido em toda consulta, a resposta certa não é ajustar o limiar, é arquivar a versão antiga.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que aumentar o top-k do retriever não melhora a resposta?',
      answer:
        'Porque relevância não é novidade. O retriever busca os trechos mais parecidos com a pergunta, e se o seu acervo tem o mesmo fato repetido em quatro documentos, os quatro são igualmente relevantes e todos entram no top-k. Aumentar o k traz mais cópias antes de trazer informação nova, então você paga mais tokens e recebe a mesma informação. Pior: a repetição enviesa o modelo, porque um fato que aparece cinco vezes parece mais confirmado do que um que aparece uma vez, e a resposta passa a refletir quantas vezes cada fato foi copiado no acervo em vez de qual fato está certo. A deduplicação é o passo que separa relevância de novidade, liberando espaço na janela e puxando o próximo trecho distinto da fila.',
    },
    {
      question: 'Deduplicar por similaridade de embedding não corre o risco de cortar informação?',
      answer:
        'Corre, e é o erro mais caro da deduplicação. Similaridade alta de embedding não significa conteúdo redundante: dois parágrafos sobre a mesma política, um enunciando a regra geral e o outro a exceção, têm cosseno altíssimo e são informação complementar, muitas vezes a mais importante da consulta. Descartar um deles pelo limiar faz o bot responder a regra geral inclusive nos casos em que ela não vale. A proteção tem três partes: descarte só é seguro no nível exato, e quanto mais semântica a comparação mais a operação certa é agrupar e resumir preservando as diferenças; uma checagem barata bloqueia a fusão quando os trechos divergem em negação, número, data ou condição; e toda remoção fica registrada, porque deduplicação que apaga em silêncio é indepurável.',
    },
    {
      question: 'Deduplicar substitui o reranking?',
      answer:
        'Não, os dois passos otimizam critérios diferentes e são complementares. O reranker ordena por relevância e não tem obrigação nenhuma de olhar redundância: se as cinco cópias da mesma política são todas muito relevantes, ele coloca as cinco no topo e está certo pelo critério dele. A deduplicação é o passo ortogonal que otimiza diversidade, garantindo que a janela carregue trechos distintos. Rodar a deduplicação antes do rerank reduz o conjunto a pontuar, o que barateia o rerank e evita que ele gaste posições com cópias; rodar depois garante a limpeza final antes de montar o prompt. Em pipelines exigentes vale rodar nos dois pontos, com limiar mais conservador antes e mais estrito depois.',
    },
  ],
  conclusion: {
    title: 'Contexto bom não é contexto cheio, é contexto denso',
    description:
      'Uma janela lotada com o mesmo fato cinco vezes entrega menos do que uma janela menor com cinco fatos distintos, e ainda enviesa o modelo a favor do que foi mais copiado no acervo. Tratar a duplicata em cascata, do hash barato ao embedding caro, fundir em vez de descartar quando a duplicata não é exata, proteger a exceção que parece cópia mas muda a resposta, reabastecer o espaço liberado com o próximo trecho da fila e medir densidade em vez de economia transforma o RAG de um sistema que enche o prompt num que informa. Posso desenhar essa camada de deduplicação no seu pipeline de RAG, calibrando o limiar com o seu acervo, blindando o falso positivo e medindo o ganho na resposta final, para que cada token da sua janela carregue informação que ainda não estava lá.',
    cta: 'Falar sobre deduplicação de contexto no meu RAG',
  },
  related: [
    { label: 'Reranking em RAG: melhorar retrieval sem trocar de modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Chunking de documento para RAG sem perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Compressão de contexto: caber mais na janela sem perder sinal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
  ],
  repo: { name: 'rag-context-dedup', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'You build the RAG, measure recall, raise the top-k to make sure the answer is in there, and quality does not go up proportionally. When you open the prompt that was sent to the model, you understand why: of the eight retrieved passages, five say the same thing. It is the same refund policy showing up in the manual, in the FAQ, in the training email and in two versions of the same document nobody archived. The retriever did its job, it found everything relevant, and that is exactly the problem: relevant does not mean new. Every repeated passage takes up window space a distinct passage could have taken, and the result is a context that looks full but is shallow, spending tokens to restate what was already said while the missing information fell outside the cut. This article is about context deduplication: why repetition is not only waste but also bias, the three levels at which duplicates appear, how to detect each one at the right cost, why merging beats discarding, where to place the step in the pipeline and how to measure whether deduplication is raising information density or cutting signal.',
  sections: [
    {
      title: 'Repetition is not only waste, it is bias',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first cost of a duplicate is obvious: wasted tokens. If five of the eight passages say the same thing, you paid for eight and received the information of four, and the four distinct passages that fell outside the top-k were precisely the ones that could have completed the answer. But the more serious cost is the second one, and it is almost never measured: repetition biases the model. A fact that appears five times in the context looks more established, more confirmed and more important than a fact that appears once, and the model treats it that way, because that is exactly the signal repetition carries in natural text. Except that here the repetition does not come from consensus, it comes from indexing: the same paragraph was copied into four documents, or the same document was ingested twice under different names.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is a silent distortion of the answer. When the context has an old version of the policy repeated four times and the new version only once, the model tends to answer with the old one, not because it is better but because it is more frequent in that prompt. The retriever did not fail, both documents are relevant, but the density of copies decided the outcome. That is why deduplicating is not a cost optimization you do when there is spare time: it is a bias correction. Without it, your answer reflects how many times each fact was copied into your corpus, not which fact is correct.',
        },
        {
          type: 'table',
          columns: ['Symptom in the prompt', 'Likely cause', 'Effect on the answer'],
          rows: [
            [
              'Same paragraph word for word in several passages',
              'Document ingested twice or copied boilerplate',
              'Burns window and inflates the model confidence in that fact',
            ],
            [
              'Nearly identical passages with small wording differences',
              'Versions of the same document coexisting in the index',
              'Model mixes versions and may answer with the outdated one',
            ],
            [
              'Consecutive passages from the same document with a repeated middle',
              'Chunking with an overlapping window',
              'Repeats the middle and wastes the space of the new edges',
            ],
            [
              'Raising the top-k does not improve the answer',
              'The extra passages are copies, not new information',
              'Cost goes up, quality stays flat or gets worse',
            ],
          ],
        },
      ],
    },
    {
      title: 'The three levels of duplicate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A duplicate is not one single thing, and treating them all with the same technique is the mistake that makes deduplication look expensive or imprecise. The first level is the exact duplicate: two passages with the same text, character by character. This happens more than you would think, because the same PDF entered the index twice, or because the legal footer repeats in every document and became a chunk. Detecting that is cheap: normalize the text and compare a hash. The second level is the near-identical: two passages that say exactly the same thing with differences in formatting, punctuation, an extra sentence at the start or a slightly edited version of the same paragraph. Hashing does not catch it, because a single different character changes the whole hash, and this is where most real duplicates live.',
        },
        {
          type: 'paragraph',
          value:
            'The third level is window overlap, and it is specific to RAG. If your chunking uses a sliding window with overlap, two neighboring chunks from the same document share a piece by construction, and when both are retrieved together the common middle appears twice in the prompt. This case is not really a duplicate to discard, it is an overlap to stitch: the two passages have distinct edges you want to keep, and only the middle repeats. And there is still the semantic duplicate, two texts completely different in wording that assert the same fact, which is the most expensive to detect and the most dangerous to handle, because the boundary between "says the same thing" and "says something similar but with an important exception" is thin.',
        },
        {
          type: 'table',
          columns: ['Level', 'How to detect', 'Cost', 'What to do'],
          rows: [
            [
              'Exact',
              'Hash of the normalized text',
              'Very low',
              'Discard the copy, keep the best-scoring one',
            ],
            [
              'Near-identical',
              'Shingle similarity (Jaccard) or MinHash',
              'Low',
              'Keep one, record the sources of the others',
            ],
            [
              'Window overlap',
              'Common suffix/prefix between chunks of the same doc',
              'Low',
              'Merge into a single stitched passage',
            ],
            [
              'Semantic',
              'Embedding similarity above a high threshold',
              'Medium',
              'Group and summarize, never discard blindly',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detect cheap before detecting expensive',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Order matters. Well-made deduplication is a cascade that starts with the cheapest detector and only uses the expensive one on what is left. First the hash, which eliminates exact copies at practically zero cost and already cleans a large slice in real corpora. Then lexical similarity by shingles, which breaks the text into n-grams and compares the sets: two passages with Jaccard above a high threshold say the same thing with different punctuation. Then window overlap, which only needs to be tested between chunks of the same document and is solved by comparing suffix with prefix. And only at the end, if it still makes sense, embedding comparison, which is the only one that catches real paraphrase and also the only one that costs vectors and time.',
        },
        {
          type: 'paragraph',
          value:
            'The temptation to jump straight to embeddings is strong because it looks like it solves everything at once, and that is exactly where deduplication becomes an expensive and imprecise step. Expensive because you compare everyone with everyone in a set the hash would have halved in a millisecond. Imprecise because high embedding similarity is not synonymous with redundant content: two paragraphs about the same policy, one saying the refund is valid for thirty days and the other saying it does not apply to used products, have very high embedding similarity and are complementary information, not duplicates. Discarding one of them by cosine is losing exactly the exception the customer asked about.',
        },
        {
          type: 'code',
          value: `// rag/dedup.js
// Deduplication cascade: from the cheapest detector to the most expensive.
// Each level runs only on what survived the previous one.

export function dedupPassages(passages, { jaccardThreshold = 0.85 } = {}) {
  const merged = [];
  const report = [];

  // Sort by score: the passage that stays is always the best-scoring one,
  // and the others become additional sources of it, not silent garbage.
  const ordered = [...passages].sort((a, b) => b.score - a.score);

  for (const candidate of ordered) {
    // Level 1: exact. Hash of the normalized text, almost zero cost.
    const key = hashNormalized(candidate.text);
    const exact = merged.find((p) => p.hash === key);
    if (exact) {
      exact.sources.push(candidate.source);
      report.push({ level: 'exact', dropped: candidate.id, into: exact.id });
      continue;
    }

    // Level 2: near-identical. Shingles + Jaccard, still cheap.
    const near = merged.find(
      (p) => jaccard(shingles(p.text), shingles(candidate.text)) >= jaccardThreshold,
    );
    if (near) {
      near.sources.push(candidate.source);
      report.push({ level: 'near', dropped: candidate.id, into: near.id });
      continue;
    }

    // Level 3: window overlap. Only between chunks of the SAME document,
    // and the treatment is to merge (stitch the edges), not to discard.
    const neighbor = merged.find(
      (p) => p.docId === candidate.docId && overlapLength(p.text, candidate.text) > 0,
    );
    if (neighbor) {
      neighbor.text = stitch(neighbor.text, candidate.text);
      neighbor.sources.push(candidate.source);
      report.push({ level: 'overlap', merged: candidate.id, into: neighbor.id });
      continue;
    }

    merged.push({ ...candidate, hash: key, sources: [candidate.source] });
  }

  return { passages: merged, report };
}`,
        },
      ],
    },
    {
      title: 'Merging beats discarding',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The natural reflex when you find two similar passages is to throw one away. For the exact duplicate that is right, but for the other levels it is information loss disguised as cleanup. Two neighboring chunks with overlap are not two copies, they are a larger passage split in the middle: discarding one of them erases an edge only it had. Two nearly identical versions of a paragraph are not pure redundancy: the difference between them may be exactly the clause that changed in the revision. The rule that avoids this kind of loss is simple: the less exact the duplicate, the more the correct operation is to merge instead of discard, and the merge must preserve the distinct edges.',
        },
        {
          type: 'diagram',
          value: `Cascading deduplication: cheap -> expensive, and merge instead of discard

  retriever top-k (8 passages, lots of repetition)
     |
     v
  [1] hash of the normalized text ....... cuts the exact copy
     |                                     (discards, keeps the source)
     v
  [2] shingles + Jaccard ................ cuts the near-identical
     |                                     (keeps the best-scoring one)
     v
  [3] suffix x prefix (same doc) ........ MERGES overlapping windows
     |     A: [....middle]                 result: [....middle....]
     |     B:      [middle....]            (both edges survive)
     v
  [4] embedding (optional, expensive) ... groups paraphrase
     |                                     (groups and summarizes, no discard)
     v
  dense context: distinct passages, each with its sources
     |
     +-- freed space -> pulls the next passage from the retriever queue
     |
     v
  final prompt: same window, more unique information inside it`,
        },
        {
          type: 'paragraph',
          value:
            'Merging has a valuable side effect: it makes citation more honest. When three passages state the same fact and you merge them into one, that passage now carries three sources, and the model can cite the right document without the fact taking up three blocks of the prompt. You separated evidence density from text density, which is exactly what repetition was scrambling. And there is a second gain, this one directly on quality: the space freed by deduplication should not simply be left over, it should pull the next passage from the retriever queue. Deduplicating without refilling saves tokens; deduplicating with refilling raises the amount of distinct information that fits in the same window, which is the real goal.',
        },
      ],
    },
    {
      title: 'Where to place the step in the pipeline',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Deduplication can happen at three different moments, and they are not alternatives, they are complementary layers. The first is at ingestion: before indexing, you detect that the document is already in the corpus and do not duplicate it. It is the most efficient one, because it solves the problem at the source and you never pay for it again, but it only catches what is a duplicate at entry time and does not protect against boilerplate that legitimately repeats across different documents. The second is at retrieval, after the retriever and before assembling the prompt, and it is the indispensable layer: only there do you know which specific passages were selected together for this question and how they overlap with each other.',
        },
        {
          type: 'ordered',
          items: [
            'Ingestion: detects an already indexed document and recurring boilerplate before generating chunks. Solves it at the source, but does not see the specific passage combination of each query.',
            'Post-retrieval, before the rerank: shrinks the set the reranker will score, which makes the rerank cheaper and stops it from spending slots on copies.',
            'Post-rerank, before the prompt: the indispensable layer, because it is the last chance to guarantee the window does not carry the same fact several times.',
            'Refilling: for every removed passage, pull the next one from the retriever queue, so deduplication raises distinct information instead of only leaving space over.',
            'Logging: keep the report of what was merged and with which sources, to audit the citation and to debug when an answer loses a detail.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The relationship with reranking deserves a note, because the two steps look like they solve the same thing and they do not. The reranker orders by relevance, and it has no obligation to look at redundancy: if the five copies of the policy are all highly relevant, a well-calibrated reranker puts all five at the top, and it is right by its own criterion. Deduplicating is the orthogonal step that optimizes diversity instead of relevance. Running deduplication before the rerank makes the rerank cheaper and stops it from wasting slots; running it afterwards guarantees the final cleanup. In demanding pipelines it is worth running at both points, with a more conservative threshold before and a stricter one after.',
        },
      ],
    },
    {
      title: 'The threshold that cuts signal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every deduplication has a threshold, and every threshold errs on both sides. Too loose, it lets near-duplicates through and you gain nothing. Too strict, it merges or discards passages that were complementary, and then deduplication starts destroying exactly what the retriever had found. The classic case is two paragraphs about the same rule where one states the general case and the other the exception: they are textually very similar, have very high embedding similarity, and are the most important information in that query. An aggressive threshold throws the exception away and the bot starts answering with the general rule in every case, including the ones where it does not apply.',
        },
        {
          type: 'paragraph',
          value:
            'The protection against this error has three parts. The first is asymmetric treatment per level: discarding is only safe at the exact level, and the more semantic the comparison, the more the correct operation is to group and summarize preserving the differences, never to eliminate. The second is protection by negation and number: if two similar passages diverge in a negation, a value, a date or a condition, they are not duplicates by definition, and this cheap check blocks the worst kind of false positive. The third is logging: every removal stays in the report, with what was removed and by which rule, because a deduplication that erases silently is undebuggable when the answer comes out wrong.',
        },
        {
          type: 'code',
          value: `// rag/dedup-guard.js
// Brake against the false positive: similar passages that DIVERGE
// in negation, number, date or condition are not duplicates.

const DIVERGENCE_PATTERNS = [
  /\\b(not|except|unless|provided that|only if)\\b/i, // condition and negation
  /\\d+([.,]\\d+)?\\s*(days|months|%|dollars)/i,       // values and deadlines
];

export function isSafeDuplicate(a, b) {
  // If one passage has a divergence marker the other does not have,
  // they may be general rule x exception. Never merge in that case.
  for (const pattern of DIVERGENCE_PATTERNS) {
    const inA = extractMatches(a.text, pattern);
    const inB = extractMatches(b.text, pattern);
    if (!sameSet(inA, inB)) return false;
  }
  return true;
}

export function dedupWithGuard(passages, options) {
  const { passages: candidates, report } = dedupPassages(passages, options);

  // Restores what the guard vetoed: better to spend window on a
  // possible duplicate than to lose the exception that changes the answer.
  const restored = report
    .filter((r) => r.level !== 'exact')
    .filter((r) => !isSafeDuplicate(byId(passages, r.dropped), byId(candidates, r.into)))
    .map((r) => byId(passages, r.dropped));

  return { passages: [...candidates, ...restored], report };
}`,
        },
      ],
    },
    {
      title: 'Measure density, not only savings',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The wrong metric to evaluate deduplication is token savings, because it always improves: the more aggressive the threshold, the fewer tokens, and the chart goes up nicely while quality collapses. The right metric is the density of unique information in the window: how many distinct and relevant facts the context carries after deduplication compared to before. If you deduplicate and refill, the token count stays practically the same and the number of distinct facts goes up, and that is exactly the result you want to see. If token savings go up and density stays flat, you are only spending less to deliver the same; if density drops, the threshold is cutting signal.',
        },
        {
          type: 'ordered',
          items: [
            'Distinct facts per window: count how many unique and relevant statements the context carries before and after; deduplicating with refilling must raise this number.',
            'False positive rate of the threshold: on a labeled set with general rule x exception pairs, measure how many exceptions deduplication removed. The practical target is zero.',
            'Answer accuracy with and without the step: run the same question set with and without deduplication and compare the final answer, which is the only metric that truly matters.',
            'Coverage per level: track how much each level removes; if exact and near-identical cut a lot, the real problem is at ingestion and must be solved there.',
            'Citation fidelity: verify that the merged passage cites all the sources merged into it, so the evidence does not disappear along with the copy.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'It is also worth measuring a diagnostic signal that points outside the RAG: if deduplication is cutting a huge fraction of the context every day, the problem is not retrieval, it is the corpus. A document ingested twice, old versions nobody archived, boilerplate that should have been removed at chunking. Query-time deduplication is a good and cheap safety net, but it pays the same cost repeatedly on every question to fix something a single index cleanup would solve for good. When the report shows the same pair of documents being merged on every query, the right answer is not to tune the threshold, it is to archive the old version.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does raising the retriever top-k not improve the answer?',
      answer:
        'Because relevance is not novelty. The retriever fetches the passages most similar to the question, and if your corpus has the same fact repeated in four documents, all four are equally relevant and all of them enter the top-k. Raising the k brings more copies before it brings new information, so you pay more tokens and receive the same information. Worse: repetition biases the model, because a fact that appears five times looks more confirmed than one that appears once, and the answer starts reflecting how many times each fact was copied into the corpus instead of which fact is correct. Deduplication is the step that separates relevance from novelty, freeing window space and pulling the next distinct passage from the queue.',
    },
    {
      question: 'Does deduplicating by embedding similarity risk cutting information?',
      answer:
        'It does, and it is the most expensive mistake in deduplication. High embedding similarity does not mean redundant content: two paragraphs about the same policy, one stating the general rule and the other the exception, have very high cosine similarity and are complementary information, often the most important in the query. Discarding one of them by threshold makes the bot answer with the general rule even in the cases where it does not apply. The protection has three parts: discarding is only safe at the exact level, and the more semantic the comparison the more the correct operation is to group and summarize preserving the differences; a cheap check blocks the merge when the passages diverge in negation, number, date or condition; and every removal is logged, because deduplication that erases silently is undebuggable.',
    },
    {
      question: 'Does deduplicating replace reranking?',
      answer:
        'No, the two steps optimize different criteria and are complementary. The reranker orders by relevance and has no obligation to look at redundancy: if the five copies of the same policy are all highly relevant, it puts all five at the top and it is right by its own criterion. Deduplication is the orthogonal step that optimizes diversity, guaranteeing the window carries distinct passages. Running deduplication before the rerank shrinks the set to be scored, which makes the rerank cheaper and stops it from spending slots on copies; running it afterwards guarantees the final cleanup before assembling the prompt. In demanding pipelines it is worth running at both points, with a more conservative threshold before and a stricter one after.',
    },
  ],
  conclusion: {
    title: 'Good context is not full context, it is dense context',
    description:
      'A window packed with the same fact five times delivers less than a smaller window with five distinct facts, and on top of that biases the model in favor of whatever was copied the most into the corpus. Handling duplicates as a cascade, from the cheap hash to the expensive embedding, merging instead of discarding when the duplicate is not exact, protecting the exception that looks like a copy but changes the answer, refilling the freed space with the next passage in the queue and measuring density instead of savings turns the RAG from a system that fills the prompt into one that informs. I can design this deduplication layer in your RAG pipeline, calibrating the threshold with your corpus, shielding against the false positive and measuring the gain in the final answer, so every token of your window carries information that was not already there.',
    cta: 'Talk about context deduplication in my RAG',
  },
  related: [
    { label: 'Reranking in RAG: improving retrieval without changing the model', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Document chunking for RAG without losing context', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Context compression: fitting more in the window without losing signal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
  ],
  repo: { name: 'rag-context-dedup', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Montas el RAG, mides el recall, subes el top-k para asegurarte de que la respuesta está ahí dentro, y la calidad no sube en la misma proporción. Cuando abres el prompt que se envió al modelo, entiendes por qué: de los ocho fragmentos recuperados, cinco dicen lo mismo. Es la misma política de reembolso que aparece en el manual, en el FAQ, en el correo de capacitación y en dos versiones del mismo documento que nadie archivó. El retriever hizo su trabajo, encontró todo lo relevante, y ese es justamente el problema: relevante no significa nuevo. Cada fragmento repetido ocupa espacio en la ventana que un fragmento distinto podría ocupar, y el resultado es un contexto que parece lleno pero es superficial, gastando tokens para repetir lo que ya estaba dicho mientras la información que faltaba quedó fuera del corte. Este artículo trata de la deduplicación de contexto: por qué la repetición no es solo desperdicio sino también sesgo, los tres niveles en que aparece el duplicado, cómo detectar cada uno con el costo correcto, por qué fusionar es mejor que descartar, dónde encajar el paso en el pipeline y cómo medir si la deduplicación está aumentando la densidad de información o cortando señal.',
  sections: [
    {
      title: 'La repetición no es solo desperdicio, es sesgo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer costo del duplicado es obvio: token gastado. Si cinco de los ocho fragmentos dicen lo mismo, pagaste por ocho y recibiste la información de cuatro, y los cuatro fragmentos distintos que quedaron fuera del top-k eran justamente los que podrían completar la respuesta. Pero el costo más grave es el segundo, y casi nunca se mide: la repetición sesga al modelo. Un hecho que aparece cinco veces en el contexto parece más establecido, más confirmado y más importante que un hecho que aparece una vez, y el modelo lo trata así, porque es exactamente esa la señal que la repetición lleva en texto natural. Solo que aquí la repetición no viene de consenso, viene de indexación: el mismo párrafo fue copiado en cuatro documentos, o el mismo documento fue ingerido dos veces con nombres distintos.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es una distorsión silenciosa de la respuesta. Cuando el contexto tiene una versión antigua de la política repetida cuatro veces y la versión nueva una sola vez, el modelo tiende a responder con la antigua, y no porque sea mejor, sino porque es más frecuente en ese prompt. El retriever no se equivocó, los dos documentos son relevantes, pero la densidad de copias decidió el resultado. Por eso deduplicar no es una optimización de costo que se hace cuando sobra tiempo: es una corrección de sesgo. Sin ella, tu respuesta refleja cuántas veces se copió cada hecho en tu acervo, y no qué hecho es el correcto.',
        },
        {
          type: 'table',
          columns: ['Síntoma en el prompt', 'Causa probable', 'Efecto en la respuesta'],
          rows: [
            [
              'Mismo párrafo palabra por palabra en varios fragmentos',
              'Documento ingerido dos veces o boilerplate copiado',
              'Gasta ventana e infla la confianza del modelo en ese hecho',
            ],
            [
              'Fragmentos casi iguales con pequeñas diferencias de redacción',
              'Versiones del mismo documento coexistiendo en el índice',
              'El modelo mezcla versiones y puede responder con la desactualizada',
            ],
            [
              'Fragmentos consecutivos del mismo documento con el medio repetido',
              'Chunking con ventana solapada',
              'Repite el medio y desperdicia el espacio de los bordes nuevos',
            ],
            [
              'Subir el top-k no mejora la respuesta',
              'Los fragmentos extra son copias, no información nueva',
              'El costo sube, la calidad queda igual o empeora',
            ],
          ],
        },
      ],
    },
    {
      title: 'Los tres niveles de duplicado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El duplicado no es una sola cosa, y tratarlos todos con la misma técnica es el error que hace que la deduplicación parezca cara o imprecisa. El primer nivel es el duplicado exacto: dos fragmentos con el mismo texto, carácter por carácter. Esto pasa más de lo que se cree, porque el mismo PDF entró dos veces al índice, o porque el pie de página legal se repite en todos los documentos y se convirtió en chunk. Detectarlo es barato: normalizas el texto y comparas un hash. El segundo nivel es el casi idéntico: dos fragmentos que dicen exactamente lo mismo con diferencias de formato, puntuación, una frase de más al inicio o una versión levemente editada del mismo párrafo. El hash no lo detecta, porque un carácter distinto cambia el hash entero, y aquí es donde vive la mayoría de los duplicados reales.',
        },
        {
          type: 'paragraph',
          value:
            'El tercer nivel es el solapamiento de ventanas, y es específico de RAG. Si tu chunking usa ventana deslizante con overlap, dos chunks vecinos del mismo documento comparten un pedazo por construcción, y cuando los dos se recuperan juntos, el medio común aparece dos veces en el prompt. Ese caso no es realmente un duplicado para descartar, es un solapamiento para coser: los dos fragmentos tienen bordes distintos que quieres mantener, y solo el medio se repite. Y existe además el duplicado semántico, dos textos completamente distintos en la letra que afirman el mismo hecho, que es el más caro de detectar y el más peligroso de tratar, porque la frontera entre "dice lo mismo" y "dice algo parecido pero con una excepción importante" es muy fina.',
        },
        {
          type: 'table',
          columns: ['Nivel', 'Cómo detectar', 'Costo', 'Qué hacer'],
          rows: [
            [
              'Exacto',
              'Hash del texto normalizado',
              'Muy bajo',
              'Descartar la copia, mantener la de mejor score',
            ],
            [
              'Casi idéntico',
              'Similitud de shingles (Jaccard) o MinHash',
              'Bajo',
              'Mantener una, registrar las fuentes de las otras',
            ],
            [
              'Solapamiento de ventana',
              'Sufijo/prefijo común entre chunks del mismo doc',
              'Bajo',
              'Fusionar en un fragmento único cosido',
            ],
            [
              'Semántico',
              'Similitud de embedding por encima de un umbral alto',
              'Medio',
              'Agrupar y resumir, nunca descartar a ciegas',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detectar barato antes de detectar caro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden importa. Una deduplicación bien hecha es una cascada que empieza por el detector más barato y solo usa el más caro en lo que sobró. Primero el hash, que elimina las copias exactas con costo prácticamente cero y ya limpia una porción grande en acervos reales. Después la similitud léxica por shingles, que rompe el texto en n-gramas y compara los conjuntos: dos fragmentos con Jaccard por encima de un umbral alto dicen lo mismo con otra puntuación. Después el solapamiento de ventana, que solo necesita probarse entre chunks del mismo documento y se resuelve comparando sufijo con prefijo. Y solo al final, si todavía tiene sentido, la comparación por embedding, que es la única que detecta paráfrasis de verdad y también la única que cuesta vector y tiempo.',
        },
        {
          type: 'paragraph',
          value:
            'La tentación de saltar directo al embedding es grande porque parece resolver todo de una vez, y ahí es justamente donde la deduplicación se vuelve un paso caro e impreciso. Caro porque comparas a todos con todos en un conjunto que el hash habría reducido a la mitad en un milisegundo. Impreciso porque una similitud de embedding alta no es sinónimo de contenido redundante: dos párrafos sobre la misma política, uno diciendo que el reembolso vale por treinta días y otro diciendo que no aplica a producto usado, tienen un embedding altísimo y son información complementaria, no duplicado. Descartar uno de ellos por el coseno es perder exactamente la excepción por la que el cliente preguntó.',
        },
        {
          type: 'code',
          value: `// rag/dedup.js
// Cascada de deduplicacion: del detector mas barato al mas caro.
// Cada nivel corre solo sobre lo que sobrevivio al nivel anterior.

export function dedupPassages(passages, { jaccardThreshold = 0.85 } = {}) {
  const merged = [];
  const report = [];

  // Ordena por score: el fragmento que queda es siempre el de mejor score,
  // y los demas se vuelven fuentes adicionales suyas, no basura silenciosa.
  const ordered = [...passages].sort((a, b) => b.score - a.score);

  for (const candidate of ordered) {
    // Nivel 1: exacto. Hash del texto normalizado, costo casi cero.
    const key = hashNormalized(candidate.text);
    const exact = merged.find((p) => p.hash === key);
    if (exact) {
      exact.sources.push(candidate.source);
      report.push({ level: 'exact', dropped: candidate.id, into: exact.id });
      continue;
    }

    // Nivel 2: casi identico. Shingles + Jaccard, todavia barato.
    const near = merged.find(
      (p) => jaccard(shingles(p.text), shingles(candidate.text)) >= jaccardThreshold,
    );
    if (near) {
      near.sources.push(candidate.source);
      report.push({ level: 'near', dropped: candidate.id, into: near.id });
      continue;
    }

    // Nivel 3: solapamiento de ventana. Solo entre chunks del MISMO documento,
    // y el tratamiento es fusionar (coser bordes), no descartar.
    const neighbor = merged.find(
      (p) => p.docId === candidate.docId && overlapLength(p.text, candidate.text) > 0,
    );
    if (neighbor) {
      neighbor.text = stitch(neighbor.text, candidate.text);
      neighbor.sources.push(candidate.source);
      report.push({ level: 'overlap', merged: candidate.id, into: neighbor.id });
      continue;
    }

    merged.push({ ...candidate, hash: key, sources: [candidate.source] });
  }

  return { passages: merged, report };
}`,
        },
      ],
    },
    {
      title: 'Fusionar es mejor que descartar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reflejo natural al encontrar dos fragmentos parecidos es tirar uno. Para el duplicado exacto eso está bien, pero para los otros niveles es una pérdida de información disfrazada de limpieza. Dos chunks vecinos con overlap no son dos copias, son un fragmento mayor partido por la mitad: descartar uno de ellos borra un borde que solo él tenía. Dos versiones casi iguales de un párrafo no son redundancia pura: la diferencia entre ellas puede ser exactamente la cláusula que cambió en la revisión. La regla que evita ese tipo de pérdida es simple: cuanto menos exacto el duplicado, más la operación correcta es fusionar en vez de descartar, y la fusión necesita preservar los bordes distintos.',
        },
        {
          type: 'diagram',
          value: `Deduplicacion en cascada: barato -> caro, y fusiona en vez de descartar

  top-k del retriever (8 fragmentos, mucha repeticion)
     |
     v
  [1] hash del texto normalizado ........ corta la copia exacta
     |                                     (descarta, guarda la fuente)
     v
  [2] shingles + Jaccard ................ corta el casi identico
     |                                     (mantiene el de mayor score)
     v
  [3] sufijo x prefijo (mismo doc) ...... FUSIONA ventanas solapadas
     |     A: [....medio]                  resultado: [....medio....]
     |     B:     [medio....]              (los dos bordes sobreviven)
     v
  [4] embedding (opcional, caro) ........ agrupa parafrasis
     |                                     (agrupa y resume, no descarta)
     v
  contexto denso: fragmentos distintos, cada uno con sus fuentes
     |
     +-- espacio liberado -> jala el proximo fragmento de la cola
     |
     v
  prompt final: misma ventana, mas informacion unica dentro de ella`,
        },
        {
          type: 'paragraph',
          value:
            'La fusión tiene un efecto colateral valioso: deja la cita más honesta. Cuando tres fragmentos dicen el mismo hecho y los fusionas en uno solo, ese fragmento pasa a llevar tres fuentes, y el modelo puede citar el documento correcto sin que el hecho ocupe tres bloques del prompt. Separaste la densidad de evidencia de la densidad de texto, que era exactamente lo que la repetición desordenaba. Y hay una segunda ganancia, esa directa en la calidad: el espacio liberado por la deduplicación no debe simplemente sobrar, debe jalar el próximo fragmento de la cola del retriever. Deduplicar sin reabastecer ahorra tokens; deduplicar reabasteciendo aumenta la cantidad de información distinta que cabe en la misma ventana, que es el objetivo real.',
        },
      ],
    },
    {
      title: 'Dónde encajar el paso en el pipeline',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La deduplicación puede ocurrir en tres momentos distintos, y no son alternativas, son capas complementarias. La primera es en la ingesta: antes de indexar, detectas que ese documento ya está en el acervo y no lo duplicas. Es la más eficiente, porque resuelve el problema en el origen y nunca más lo pagas, pero solo detecta lo que es duplicado en el momento de la entrada y no protege contra el boilerplate que se repite legítimamente entre documentos distintos. La segunda es en la recuperación, después del retriever y antes de armar el prompt, y es la capa indispensable: solo ahí sabes qué fragmentos específicos fueron seleccionados juntos para esta pregunta y cómo se solapan entre sí.',
        },
        {
          type: 'ordered',
          items: [
            'Ingesta: detecta documento ya indexado y boilerplate recurrente antes de generar chunks. Resuelve en el origen, pero no ve la combinación específica de fragmentos de cada consulta.',
            'Post-retrieval, antes del rerank: reduce el conjunto que el reranker va a puntuar, lo que abarata el rerank y evita que gaste posiciones con copias.',
            'Post-rerank, antes del prompt: la capa indispensable, porque es la última oportunidad de garantizar que la ventana no lleva el mismo hecho varias veces.',
            'Reabastecimiento: por cada fragmento removido, jala el próximo de la cola del retriever, para que la deduplicación aumente información distinta en vez de solo dejar espacio libre.',
            'Registro: guarda el reporte de lo que se fusionó y con qué fuentes, para auditar la cita y para depurar cuando una respuesta pierda un detalle.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La relación con el reranking merece una nota, porque los dos pasos parecen resolver lo mismo y no lo hacen. El reranker ordena por relevancia, y no tiene ninguna obligación de mirar la redundancia: si las cinco copias de la política son todas muy relevantes, un reranker bien calibrado pone las cinco arriba, y está en lo correcto según su criterio. Deduplicar es el paso ortogonal que optimiza diversidad en vez de relevancia. Correr la deduplicación antes del rerank abarata el rerank y evita que desperdicie posiciones; correrla después garantiza la limpieza final. En pipelines exigentes vale correrla en los dos puntos, con umbral más conservador antes y más estricto después.',
        },
      ],
    },
    {
      title: 'El umbral que corta señal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda deduplicación tiene un umbral, y todo umbral se equivoca por los dos lados. Demasiado flojo, deja pasar casi duplicados y no ganas nada. Demasiado estricto, fusiona o descarta fragmentos que eran complementarios, y ahí la deduplicación pasa a destruir exactamente lo que el retriever había encontrado. El caso clásico es el de dos párrafos sobre la misma regla en que uno enuncia el caso general y el otro la excepción: son textualmente parecidísimos, tienen un embedding altísimo, y son la información más importante que existe en esa consulta. Un umbral agresivo tira la excepción y el bot pasa a responder la regla general en todos los casos, incluso en los que no aplica.',
        },
        {
          type: 'paragraph',
          value:
            'La protección contra ese error tiene tres partes. La primera es la asimetría de tratamiento por nivel: descartar solo es seguro en el nivel exacto, y cuanto más semántica la comparación, más la operación correcta es agrupar y resumir preservando las diferencias, nunca eliminar. La segunda es la protección por negación y número: si dos fragmentos parecidos divergen en una negación, un valor, una fecha o una condición, no son duplicados por definición, y esa verificación barata bloquea el peor tipo de falso positivo. La tercera es el registro: toda remoción queda en el reporte, con lo que se removió y por qué regla, porque una deduplicación que borra en silencio es indepurable cuando la respuesta sale mal.',
        },
        {
          type: 'code',
          value: `// rag/dedup-guard.js
// Freno contra el falso positivo: fragmentos parecidos que DIVERGEN
// en negacion, numero, fecha o condicion no son duplicados.

const DIVERGENCE_PATTERNS = [
  /\\b(no|excepto|salvo|siempre que|solo si)\\b/i, // condicion y negacion
  /\\d+([.,]\\d+)?\\s*(dias|meses|%|pesos)/i,       // valores y plazos
];

export function isSafeDuplicate(a, b) {
  // Si uno de los fragmentos tiene un marcador de divergencia que el otro no,
  // pueden ser regla general x excepcion. Nunca fusiones en ese caso.
  for (const pattern of DIVERGENCE_PATTERNS) {
    const inA = extractMatches(a.text, pattern);
    const inB = extractMatches(b.text, pattern);
    if (!sameSet(inA, inB)) return false;
  }
  return true;
}

export function dedupWithGuard(passages, options) {
  const { passages: candidates, report } = dedupPassages(passages, options);

  // Reintroduce lo que el guard veto: mejor gastar ventana con un
  // posible duplicado que perder la excepcion que cambia la respuesta.
  const restored = report
    .filter((r) => r.level !== 'exact')
    .filter((r) => !isSafeDuplicate(byId(passages, r.dropped), byId(candidates, r.into)))
    .map((r) => byId(passages, r.dropped));

  return { passages: [...candidates, ...restored], report };
}`,
        },
      ],
    },
    {
      title: 'Medir densidad, no solo ahorro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La métrica equivocada para evaluar la deduplicación es el ahorro de tokens, porque siempre mejora: cuanto más agresivo el umbral, menos tokens, y el gráfico sube bonito mientras la calidad se desploma. La métrica correcta es la densidad de información única en la ventana: cuántos hechos distintos y relevantes lleva el contexto después de la deduplicación en relación con antes. Si deduplicas y reabasteces, el conteo de tokens queda prácticamente igual y el número de hechos distintos sube, y ese es exactamente el resultado que quieres ver. Si el ahorro de tokens sube y la densidad queda igual, solo estás gastando menos para entregar lo mismo; si la densidad cae, el umbral está cortando señal.',
        },
        {
          type: 'ordered',
          items: [
            'Hechos distintos por ventana: cuenta cuántas afirmaciones únicas y relevantes lleva el contexto antes y después; deduplicar con reabastecimiento tiene que subir ese número.',
            'Tasa de falso positivo del umbral: en un conjunto etiquetado con pares regla general x excepción, mide cuántas excepciones removió la deduplicación. El objetivo práctico es cero.',
            'Acierto de respuesta con y sin el paso: corre el mismo conjunto de preguntas con y sin deduplicación y compara la respuesta final, que es la única métrica que de verdad importa.',
            'Cobertura por nivel: sigue cuánto remueve cada nivel; si el exacto y el casi idéntico cortan mucho, el problema real está en la ingesta y debe resolverse ahí.',
            'Fidelidad de la cita: verifica que el fragmento fusionado cite todas las fuentes que se fusionaron en él, para que la evidencia no desaparezca junto con la copia.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale medir también una señal de diagnóstico que apunta hacia afuera del RAG: si la deduplicación está cortando una fracción enorme del contexto todos los días, el problema no es de recuperación, es de acervo. Documento ingerido en duplicado, versiones antiguas que nadie archivó, boilerplate que debería haberse removido en el chunking. La deduplicación en tiempo de consulta es una red de seguridad buena y barata, pero paga el mismo costo repetidamente en cada pregunta para arreglar algo que una limpieza única en el índice resolvería de una vez. Cuando el reporte muestra que el mismo par de documentos se fusiona en cada consulta, la respuesta correcta no es ajustar el umbral, es archivar la versión antigua.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué subir el top-k del retriever no mejora la respuesta?',
      answer:
        'Porque relevancia no es novedad. El retriever busca los fragmentos más parecidos a la pregunta, y si tu acervo tiene el mismo hecho repetido en cuatro documentos, los cuatro son igualmente relevantes y todos entran en el top-k. Subir el k trae más copias antes de traer información nueva, así que pagas más tokens y recibes la misma información. Peor: la repetición sesga al modelo, porque un hecho que aparece cinco veces parece más confirmado que uno que aparece una vez, y la respuesta pasa a reflejar cuántas veces se copió cada hecho en el acervo en vez de qué hecho es el correcto. La deduplicación es el paso que separa relevancia de novedad, liberando espacio en la ventana y jalando el próximo fragmento distinto de la cola.',
    },
    {
      question: '¿Deduplicar por similitud de embedding no corre el riesgo de cortar información?',
      answer:
        'Sí lo corre, y es el error más caro de la deduplicación. Una similitud alta de embedding no significa contenido redundante: dos párrafos sobre la misma política, uno enunciando la regla general y el otro la excepción, tienen un coseno altísimo y son información complementaria, muchas veces la más importante de la consulta. Descartar uno de ellos por el umbral hace que el bot responda la regla general incluso en los casos en que no aplica. La protección tiene tres partes: descartar solo es seguro en el nivel exacto, y cuanto más semántica la comparación más la operación correcta es agrupar y resumir preservando las diferencias; una verificación barata bloquea la fusión cuando los fragmentos divergen en negación, número, fecha o condición; y toda remoción queda registrada, porque una deduplicación que borra en silencio es indepurable.',
    },
    {
      question: '¿Deduplicar sustituye al reranking?',
      answer:
        'No, los dos pasos optimizan criterios distintos y son complementarios. El reranker ordena por relevancia y no tiene obligación de mirar la redundancia: si las cinco copias de la misma política son todas muy relevantes, pone las cinco arriba y está en lo correcto según su criterio. La deduplicación es el paso ortogonal que optimiza diversidad, garantizando que la ventana lleve fragmentos distintos. Correr la deduplicación antes del rerank reduce el conjunto a puntuar, lo que abarata el rerank y evita que gaste posiciones con copias; correrla después garantiza la limpieza final antes de armar el prompt. En pipelines exigentes vale correrla en los dos puntos, con umbral más conservador antes y más estricto después.',
    },
  ],
  conclusion: {
    title: 'Buen contexto no es contexto lleno, es contexto denso',
    description:
      'Una ventana llena con el mismo hecho cinco veces entrega menos que una ventana menor con cinco hechos distintos, y además sesga al modelo a favor de lo que más se copió en el acervo. Tratar el duplicado en cascada, del hash barato al embedding caro, fusionar en vez de descartar cuando el duplicado no es exacto, proteger la excepción que parece copia pero cambia la respuesta, reabastecer el espacio liberado con el próximo fragmento de la cola y medir densidad en vez de ahorro transforma el RAG de un sistema que llena el prompt en uno que informa. Puedo diseñar esa capa de deduplicación en tu pipeline de RAG, calibrando el umbral con tu acervo, blindando el falso positivo y midiendo la ganancia en la respuesta final, para que cada token de tu ventana lleve información que aún no estaba ahí.',
    cta: 'Hablar sobre deduplicación de contexto en mi RAG',
  },
  related: [
    { label: 'Reranking en RAG: mejorar el retrieval sin cambiar de modelo', to: '/blog/reranking-rag-melhorar-retrieval-sem-trocar-modelo' },
    { label: 'Chunking de documento para RAG sin perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Compresión de contexto: caber más en la ventana sin perder señal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
  ],
  repo: { name: 'rag-context-dedup', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
