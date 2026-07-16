// Conteudo do artigo: chunking de documento para RAG sem perder contexto.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Chunking mínimo para RAG: em vez de cortar o documento em pedaços de tamanho fixo que partem frases no meio, respeita a estrutura (título, parágrafo, lista), usa sobreposição controlada entre pedaços e anexa metadado de origem, para que cada chunk recuperado chegue ao modelo como uma unidade que se entende sozinha.',
  en: 'Minimal chunking for RAG: instead of cutting the document into fixed-size pieces that split sentences in half, it respects the structure (heading, paragraph, list), uses controlled overlap between pieces and attaches source metadata, so that each retrieved chunk reaches the model as a unit that stands on its own.',
  es: 'Chunking mínimo para RAG: en vez de cortar el documento en pedazos de tamaño fijo que parten frases a la mitad, respeta la estructura (título, párrafo, lista), usa solapamiento controlado entre pedazos y adjunta metadato de origen, para que cada chunk recuperado llegue al modelo como una unidad que se entiende sola.',
};

const repoUrl = 'https://github.com/joaosouz4dev/rag-chunking-mini';

const pt = {
  intro:
    'Todo pipeline de RAG começa com uma decisão que quase ninguém debate e que decide a qualidade de tudo que vem depois: como cortar o documento em pedaços. O reflexo é o mais simples possível, partir o texto a cada N caracteres. Funciona no protótipo e engana na demo, mas em produção ele corta uma definição no meio, separa a pergunta da resposta, tira a tabela do seu cabeçalho e recupera um trecho que, isolado, não quer dizer nada. O modelo então recebe um contexto mutilado e responde com a confiança de sempre, só que sobre um fragmento sem sentido. O problema quase nunca está no modelo nem no embedding; está no chunk. Recuperação boa depende de o pedaço recuperado ser uma unidade que se entende sozinha, e isso não sai de um corte cego por tamanho. Este artigo mostra como cortar respeitando a estrutura do documento, por que a sobreposição entre pedaços existe, qual o tamanho certo de chunk, o metadado que todo pedaço precisa carregar e como medir se o chunking está ajudando ou sabotando o retrieval.',
  sections: [
    {
      title: 'Por que o corte por tamanho fixo quebra o contexto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cortar o documento a cada N caracteres ignora tudo que dá sentido ao texto. O caractere na posição 500 pode estar no meio de uma frase, no meio de uma palavra, entre um número e sua unidade, ou separando o rótulo de uma lista do seu item. O resultado é um chunk que começa e termina no vazio: metade de uma ideia grudada na metade de outra. Na hora do retrieval, esse pedaço tem um embedding confuso, porque representa dois assuntos pela metade, e quando é recuperado chega ao modelo como um trecho que ninguém entenderia lendo isolado. O modelo, que só vê o que foi recuperado, responde a partir de um fragmento truncado.',
        },
        {
          type: 'paragraph',
          value:
            'O caso mais traiçoeiro é a separação entre pergunta e resposta, ou entre afirmação e sua condição. Um manual diz "o reembolso é liberado em 5 dias úteis, exceto quando o pagamento foi por boleto, caso em que o prazo é de 10 dias". Um corte por tamanho no lugar errado guarda a primeira metade num chunk e a exceção em outro. O retrieval traz o primeiro, o modelo responde "5 dias úteis" com toda a certeza, e a exceção que invertia a resposta ficou num pedaço que ninguém recuperou. Não é alucinação do modelo, é amputação na indexação.',
        },
        {
          type: 'table',
          columns: ['Situação', 'Corte por tamanho fixo', 'Corte por estrutura'],
          rows: [
            [
              'Fim do chunk',
              'No meio de frase ou palavra',
              'No fim de parágrafo ou seção',
            ],
            [
              'Definição e sua exceção',
              'Podem cair em chunks diferentes',
              'Ficam juntas na mesma unidade',
            ],
            [
              'Tabela e cabeçalho',
              'Cabeçalho separado das linhas',
              'Tabela preservada como bloco',
            ],
            [
              'Embedding do chunk',
              'Mistura dois assuntos pela metade',
              'Representa um assunto coeso',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A lição é que o tamanho não é a unidade certa de corte; o significado é. Um bom chunk termina onde uma ideia termina, não onde um contador de caracteres estoura. Todo o resto do artigo é sobre como cortar seguindo a estrutura do texto em vez de brigar contra ela.',
        },
      ],
    },
    {
      title: 'Cortar seguindo a estrutura do documento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A estratégia que resolve a maior parte dos casos é o chunking recursivo por estrutura: em vez de partir por caractere, você parte pelos separadores naturais do documento, do maior para o menor. Primeiro tenta quebrar por seção ou título, depois por parágrafo, depois por frase, e só recorre ao corte bruto se um único parágrafo já for maior que o teto. Assim o corte cai sempre na maior fronteira semântica disponível, e um chunk raramente termina no meio de uma frase. O documento manda no corte, não o contador.',
        },
        {
          type: 'code',
          value: `// chunk/recursive.js
// Chunking recursivo por estrutura: quebra pelos separadores naturais
// do documento, do maior para o menor, ate cada pedaco caber no teto.
// So corta "no bruto" quando um bloco unico ja excede o limite.

const SEPARATORS = ['\\n\\n\\n', '\\n\\n', '\\n', '. ', ' '];

export function chunkByStructure(text, { maxChars = 1200, sepIndex = 0 } = {}) {
  // Cabe inteiro: e um chunk coeso, nao precisa dividir mais.
  if (text.length <= maxChars) return [text];

  // Sem mais separadores: bloco unico gigante, corta no bruto como ultimo recurso.
  if (sepIndex >= SEPARATORS.length) {
    const cut = [];
    for (let i = 0; i < text.length; i += maxChars) cut.push(text.slice(i, i + maxChars));
    return cut;
  }

  const parts = text.split(SEPARATORS[sepIndex]).filter(Boolean);

  // Esse separador nao dividiu nada: tenta o proximo, mais fino.
  if (parts.length === 1) return chunkByStructure(text, { maxChars, sepIndex: sepIndex + 1 });

  // Junta os pedacos ate encher um chunk, respeitando a fronteira do separador.
  const chunks = [];
  let buffer = '';
  for (const part of parts) {
    if ((buffer + part).length > maxChars && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    // Parte sozinha ja estoura o teto: desce um nivel de separador nela.
    if (part.length > maxChars) {
      chunks.push(...chunkByStructure(part, { maxChars, sepIndex: sepIndex + 1 }));
    } else {
      buffer += (buffer ? SEPARATORS[sepIndex] : '') + part;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no formato do documento antes de escolher os separadores. Markdown tem títulos (#) e listas que são fronteiras óbvias; um PDF exportado pode ter quebras de linha artificiais no meio de parágrafos que enganam o separador; código quer ser cortado por função, não por linha em branco qualquer. Um chunking que ignora o formato de origem reintroduz pelo lado do parser o problema que estava tentando resolver. A regra geral é: identifique as fronteiras reais daquele tipo de documento e corte nelas, em vez de aplicar um separador único para tudo.',
        },
      ],
    },
    {
      title: 'Sobreposição: costurar a fronteira entre chunks',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo cortando por estrutura, sempre existe uma fronteira: o fim de um chunk e o começo do próximo. Uma informação relevante pode ficar exatamente em cima dessa linha, com a primeira parte no fim de um chunk e a continuação no início do seguinte. A sobreposição (overlap) resolve isso repetindo um pedaço do fim de cada chunk no começo do próximo. Assim, uma frase que atravessa a fronteira aparece inteira em pelo menos um dos dois chunks, e o retrieval consegue recuperá-la como unidade. É uma apólice de seguro barata contra o corte cair no pior lugar possível.',
        },
        {
          type: 'diagram',
          value: `Sobreposição entre chunks costura a fronteira

  documento original
  [....A....][....B....][....C....]  <- fronteiras podem cortar uma ideia

  sem overlap:
    chunk 1: ....A....
    chunk 2: ....B....   <- ideia que estava entre A e B se perde no corte
    chunk 3: ....C....

  com overlap (repete o fim no proximo):
    chunk 1: ....A..[a]
    chunk 2: [a]..B..[b]   <- [a] traz o fim de A junto do comeco de B
    chunk 3: [b]..C....

  [a],[b] = trecho repetido na fronteira
  overlap grande = mais seguranca, mais custo de armazenamento e ruido
  overlap zero   = fronteiras viram pontos cegos do retrieval`,
        },
        {
          type: 'paragraph',
          value:
            'A sobreposição tem um custo: cada trecho repetido é armazenado e embedado duas vezes, o índice cresce e há mais chunks parecidos competindo no retrieval. Overlap grande demais infla o custo e traz ruído; overlap zero transforma toda fronteira num ponto cego. Um valor prático fica entre 10% e 20% do tamanho do chunk, e o ajuste fino depende de quão auto-contido o conteúdo já é: texto muito fragmentado se beneficia de mais overlap, prosa corrida de menos. O ponto é que overlap não é enfeite, é o que impede que a informação certa desapareça justo na emenda entre dois pedaços.',
        },
      ],
    },
    {
      title: 'O tamanho certo do chunk: o trade-off central',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O tamanho do chunk governa um trade-off que aparece nas duas pontas do pipeline. Chunk grande carrega mais contexto por pedaço, mas seu embedding fica difuso: ele representa vários assuntos ao mesmo tempo, e na busca por similaridade um chunk que fala de dez coisas casa mal com uma pergunta sobre uma delas. Chunk pequeno tem embedding preciso e casa bem com a pergunta, mas pode ser específico demais e chegar ao modelo sem o contexto ao redor que dava sentido à resposta. Nenhum extremo é bom: o chunk gigante recupera com baixa precisão, o chunk minúsculo recupera preciso mas incompleto.',
        },
        {
          type: 'list',
          items: [
            'Chunk grande demais: embedding difuso, baixa precisão de retrieval, e ainda ocupa mais espaço da janela de contexto por pedaço recuperado.',
            'Chunk pequeno demais: embedding preciso, mas recupera fragmentos sem contexto; o modelo recebe a frase certa sem o parágrafo que a explicava.',
            'Ajuste por tipo de conteúdo: FAQ e trechos curtos toleram chunk pequeno; documentação técnica densa e contratos pedem chunk maior para não separar cláusula de condição.',
            'Deixe o número calibrável, não hardcoded: o tamanho ideal muda com o corpus e com o modelo de embedding; se está fixo no código, você não consegue medir e ajustar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Não existe um número mágico universal, mas há uma faixa de trabalho: chunks na ordem de algumas centenas de tokens costumam equilibrar precisão de embedding e contexto suficiente para a maioria dos textos. O caminho certo não é adivinhar e sim tratar o tamanho como parâmetro: começar numa faixa razoável, medir a qualidade do retrieval e ajustar por tipo de documento. Um corpus de FAQ curto e um corpus de contratos jurídicos não deveriam usar o mesmo tamanho de chunk, pela mesma razão que não usam a mesma linguagem.',
        },
      ],
    },
    {
      title: 'Metadado: o chunk precisa saber de onde veio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um chunk não é só o texto; é o texto mais a informação de onde ele veio. Sem metadado, um pedaço recuperado é um trecho órfão: o modelo não sabe de qual documento saiu, de qual seção, de qual versão, e você não consegue citar a fonte nem filtrar a busca. Anexar metadado a cada chunk transforma o retrieval de uma busca cega numa busca com procedência. Com o documento de origem e a seção, o modelo pode citar a fonte na resposta; com a data ou versão, você evita recuperar a política antiga; com o tenant ou o idioma, você filtra a busca antes mesmo da similaridade e não vaza dado de um cliente para outro.',
        },
        {
          type: 'code',
          value: `// chunk/withMeta.js
// Cada chunk carrega o texto E a procedencia. Sem metadado, o pedaco
// recuperado e orfao: nao da para citar fonte, filtrar nem versionar.

export function attachMetadata(chunks, doc) {
  return chunks.map((text, index) => ({
    text,
    metadata: {
      docId: doc.id,          // de qual documento veio (permite citar a fonte)
      title: doc.title,       // titulo/secao para dar contexto na resposta
      source: doc.source,     // url ou caminho de origem
      version: doc.version,   // evita recuperar a versao antiga do conteudo
      tenant: doc.tenant,     // filtra a busca por cliente antes da similaridade
      lang: doc.lang,         // nao mistura idiomas no retrieval
      position: index,        // ordem do chunk dentro do documento
    },
  }));
}

// No retrieval: filtre por metadado (tenant, lang, version) ANTES de rankear
// por similaridade. Filtrar por metadado e barato e evita casar chunk errado.`,
        },
        {
          type: 'paragraph',
          value:
            'O filtro por metadado antes do ranqueamento por similaridade é uma das melhorias de retrieval mais baratas que existem. Restringir a busca ao tenant certo, ao idioma certo e à versão vigente elimina de saída chunks que jamais deveriam casar, e o modelo passa a escolher entre candidatos que ao menos pertencem ao contexto da pergunta. Metadado também é o que viabiliza a citação de fonte na resposta, que é muitas vezes a diferença entre um bot que os usuários confiam e um que ninguém audita. O chunk sem procedência economiza cinco minutos na indexação e cobra caro em toda consulta.',
        },
      ],
    },
    {
      title: 'Medir se o chunking está ajudando o retrieval',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Chunking é fácil de mudar e difícil de avaliar no olho, porque o efeito só aparece lá na frente, na qualidade da resposta. Para não ajustar no escuro, você precisa de um conjunto de perguntas com o trecho de resposta esperado e de métricas de retrieval que digam se o chunk certo foi recuperado. A ideia é isolar a camada de chunking: fixando o modelo e o embedding, você troca só a estratégia de corte e mede o impacto no retrieval, sem confundir problema de chunk com problema de modelo.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que revela', 'Quando agir'],
          rows: [
            [
              'Recall@k',
              'Se o chunk certo apareceu entre os k recuperados',
              'Baixo: chunk grande demais ou fronteira cortando a resposta',
            ],
            [
              'Precision@k',
              'Quantos dos k recuperados eram relevantes',
              'Baixa: chunk pequeno demais gerando fragmentos ruidosos',
            ],
            [
              'Fronteira partida',
              'Respostas divididas entre dois chunks',
              'Frequente: aumente o overlap ou corte por estrutura',
            ],
            [
              'Chunk auto-contido',
              'Se o pedaço faz sentido lido isolado',
              'Muitos sem sentido: cortar por estrutura, não por tamanho',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A métrica que mais importa é a recuperação: o chunk que contém a resposta esperada apareceu entre os k primeiros? Se não apareceu, nenhum reranking ou prompt melhora a resposta, porque a informação nem chegou ao modelo. Recall baixo aponta para chunk grande demais (embedding difuso) ou para a resposta partida na fronteira (overlap insuficiente). Antes de trocar de modelo de embedding ou de investir em reranking, vale medir se o problema não está simplesmente no corte, que é a alavanca mais barata do pipeline inteiro.',
        },
      ],
    },
    {
      title: 'Montar a camada de chunking na ordem certa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Chunking é a fundação do RAG: ele é barato de implementar, difícil de perceber quando está errado e responsável por uma fatia enorme da qualidade final. Errar aqui condena tudo que vem depois, porque nenhum modelo responde bem sobre um trecho que foi recuperado pela metade. A ordem de implantação segue do estrutural para o fino.',
        },
        {
          type: 'ordered',
          items: [
            'Comece cortando por estrutura, não por tamanho: respeite título, parágrafo e lista do documento antes de pensar em qualquer número de caracteres.',
            'Adapte os separadores ao formato de origem: markdown, PDF e código têm fronteiras diferentes; um separador único para tudo reintroduz o corte cego.',
            'Adicione overlap moderado (10% a 20%): costure as fronteiras para que informação na emenda não vire ponto cego, sem inflar o índice.',
            'Anexe metadado a todo chunk: docId, seção, versão, tenant e idioma; sem procedência não há citação de fonte nem filtro barato antes da similaridade.',
            'Meça o recall com um conjunto de perguntas rotuladas: só assim você ajusta tamanho e overlap com dado, em vez de trocar de modelo achando que o problema é o embedding.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre um RAG que responde com precisão e um que alucina com confiança começa muito antes do modelo, no jeito de cortar o documento. Corte por estrutura, overlap na medida, metadado em cada pedaço e uma métrica de recall que fecha o ciclo: é isso que transforma um monte de texto num índice de onde o retrieval consegue tirar a resposta certa inteira. O embedding e o modelo são commodities; o chunking bem feito é a parte barata que decide se o resto do pipeline tem chance.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não posso simplesmente cortar o documento a cada N caracteres?',
      answer:
        'Porque o caractere N quase nunca cai numa fronteira de significado. Ele parte frases no meio, separa uma definição da sua exceção, tira uma tabela do cabeçalho e gera chunks que, lidos isolados, não querem dizer nada. Esse pedaço mutilado tem um embedding confuso e, quando recuperado, chega ao modelo como um trecho truncado. O resultado parece alucinação do modelo, mas é amputação feita na indexação. Cortar por estrutura (título, parágrafo, frase) faz o chunk terminar onde uma ideia termina, e é isso que preserva o contexto que o retrieval precisa recuperar.',
    },
    {
      question: 'Para que serve a sobreposição (overlap) entre chunks?',
      answer:
        'A sobreposição repete um pedaço do fim de cada chunk no começo do próximo, para que uma informação que cai exatamente na fronteira entre dois pedaços apareça inteira em pelo menos um deles. Sem overlap, toda fronteira vira um ponto cego: uma frase que atravessa a linha de corte fica pela metade nos dois chunks e o retrieval não consegue recuperá-la como unidade. O custo é armazenar e embedar o trecho repetido duas vezes, então o valor prático fica entre 10% e 20% do tamanho do chunk: o suficiente para costurar a fronteira sem inflar o índice nem encher o retrieval de chunks quase iguais.',
    },
    {
      question: 'Qual o tamanho ideal de chunk?',
      answer:
        'Não há número universal, porque o tamanho governa um trade-off. Chunk grande carrega mais contexto mas tem embedding difuso, que casa mal com perguntas específicas e baixa a precisão do retrieval. Chunk pequeno tem embedding preciso mas recupera fragmentos sem o contexto ao redor. Uma faixa de algumas centenas de tokens costuma equilibrar os dois para textos gerais, mas o certo é tratar o tamanho como parâmetro calibrável: começar numa faixa razoável, medir o recall e ajustar por tipo de documento. FAQ curto e contrato jurídico não deveriam usar o mesmo tamanho, pela mesma razão que não usam a mesma linguagem.',
    },
  ],
  conclusion: {
    title: 'Chunking bem feito é a fundação barata de um RAG que não alucina',
    description:
      'A qualidade do RAG começa no corte do documento: cortar por estrutura em vez de por tamanho, overlap moderado para costurar fronteiras, metadado de procedência em cada chunk e uma métrica de recall que fecha o ciclo. Posso desenhar essa camada de ingestão no seu sistema de IA, do parser ao índice, para que o retrieval recupere a resposta certa inteira em vez de fragmentos truncados.',
    cta: 'Falar sobre chunking e RAG no meu sistema de IA',
  },
  related: [
    { label: 'RAG para atendimento no WhatsApp: produção sem alucinação', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'CAG vs RAG: cache de contexto contra retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-chunking-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Every RAG pipeline starts with a decision almost nobody debates and that decides the quality of everything that follows: how to cut the document into pieces. The reflex is the simplest possible one, splitting the text every N characters. It works in the prototype and fools you in the demo, but in production it cuts a definition in half, separates the question from the answer, pulls the table away from its header and retrieves a passage that, in isolation, means nothing. The model then receives a mutilated context and answers with its usual confidence, only about a meaningless fragment. The problem is almost never in the model or the embedding; it is in the chunk. Good retrieval depends on the retrieved piece being a unit that stands on its own, and that does not come from a blind cut by size. This article shows how to cut respecting the structure of the document, why overlap between pieces exists, what the right chunk size is, the metadata every piece needs to carry and how to measure whether the chunking is helping or sabotaging retrieval.',
  sections: [
    {
      title: 'Why fixed-size cutting breaks the context',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cutting the document every N characters ignores everything that gives the text meaning. The character at position 500 may be in the middle of a sentence, in the middle of a word, between a number and its unit, or separating a list label from its item. The result is a chunk that begins and ends in the void: half of one idea glued to half of another. At retrieval time, that piece has a confused embedding, because it represents two half-subjects, and when it is retrieved it reaches the model as a passage nobody would understand read in isolation. The model, which only sees what was retrieved, answers from a truncated fragment.',
        },
        {
          type: 'paragraph',
          value:
            'The most treacherous case is the separation between question and answer, or between a statement and its condition. A manual says "the refund is released in 5 business days, except when payment was by bank slip, in which case the deadline is 10 days". A size cut in the wrong place keeps the first half in one chunk and the exception in another. Retrieval brings the first, the model answers "5 business days" with full certainty, and the exception that flipped the answer ended up in a piece nobody retrieved. It is not a model hallucination, it is amputation at indexing time.',
        },
        {
          type: 'table',
          columns: ['Situation', 'Fixed-size cut', 'Structure cut'],
          rows: [
            [
              'End of the chunk',
              'In the middle of a sentence or word',
              'At the end of a paragraph or section',
            ],
            [
              'Definition and its exception',
              'May fall into different chunks',
              'Stay together in the same unit',
            ],
            [
              'Table and header',
              'Header split from the rows',
              'Table preserved as a block',
            ],
            [
              'Chunk embedding',
              'Mixes two half-subjects',
              'Represents one cohesive subject',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The lesson is that size is not the right unit of cutting; meaning is. A good chunk ends where an idea ends, not where a character counter overflows. The rest of the article is about how to cut following the structure of the text instead of fighting against it.',
        },
      ],
    },
    {
      title: 'Cutting by the document structure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The strategy that handles most cases is recursive structural chunking: instead of splitting by character, you split by the natural separators of the document, from largest to smallest. First it tries to break by section or heading, then by paragraph, then by sentence, and it only resorts to a raw cut if a single paragraph already exceeds the ceiling. That way the cut always lands on the largest available semantic boundary, and a chunk rarely ends in the middle of a sentence. The document rules the cut, not the counter.',
        },
        {
          type: 'code',
          value: `// chunk/recursive.js
// Recursive structural chunking: split by the document's natural separators,
// from largest to smallest, until each piece fits under the ceiling.
// Only cut "raw" when a single block already exceeds the limit.

const SEPARATORS = ['\\n\\n\\n', '\\n\\n', '\\n', '. ', ' '];

export function chunkByStructure(text, { maxChars = 1200, sepIndex = 0 } = {}) {
  // Fits whole: it is a cohesive chunk, no need to split further.
  if (text.length <= maxChars) return [text];

  // No more separators: a single giant block, cut raw as a last resort.
  if (sepIndex >= SEPARATORS.length) {
    const cut = [];
    for (let i = 0; i < text.length; i += maxChars) cut.push(text.slice(i, i + maxChars));
    return cut;
  }

  const parts = text.split(SEPARATORS[sepIndex]).filter(Boolean);

  // This separator split nothing: try the next, finer one.
  if (parts.length === 1) return chunkByStructure(text, { maxChars, sepIndex: sepIndex + 1 });

  // Join pieces until a chunk fills up, respecting the separator boundary.
  const chunks = [];
  let buffer = '';
  for (const part of parts) {
    if ((buffer + part).length > maxChars && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    // A part alone already exceeds the ceiling: go one separator level deeper.
    if (part.length > maxChars) {
      chunks.push(...chunkByStructure(part, { maxChars, sepIndex: sepIndex + 1 }));
    } else {
      buffer += (buffer ? SEPARATORS[sepIndex] : '') + part;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Look at the document format before choosing the separators. Markdown has headings (#) and lists that are obvious boundaries; an exported PDF may have artificial line breaks in the middle of paragraphs that fool the separator; code wants to be cut by function, not by any blank line. Chunking that ignores the source format reintroduces, on the parser side, the very problem it was trying to solve. The general rule is: identify the real boundaries of that document type and cut on them, instead of applying a single separator to everything.',
        },
      ],
    },
    {
      title: 'Overlap: stitching the boundary between chunks',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even cutting by structure, there is always a boundary: the end of one chunk and the start of the next. A relevant piece of information can sit exactly on that line, with the first part at the end of one chunk and the continuation at the start of the following. Overlap solves this by repeating a piece of the end of each chunk at the start of the next. That way a sentence crossing the boundary appears whole in at least one of the two chunks, and retrieval can recover it as a unit. It is a cheap insurance policy against the cut landing in the worst possible place.',
        },
        {
          type: 'diagram',
          value: `Overlap between chunks stitches the boundary

  original document
  [....A....][....B....][....C....]  <- boundaries may cut an idea

  no overlap:
    chunk 1: ....A....
    chunk 2: ....B....   <- idea sitting between A and B is lost at the cut
    chunk 3: ....C....

  with overlap (repeat the end into the next):
    chunk 1: ....A..[a]
    chunk 2: [a]..B..[b]   <- [a] brings the end of A next to the start of B
    chunk 3: [b]..C....

  [a],[b] = passage repeated at the boundary
  large overlap = more safety, more storage cost and noise
  zero overlap  = boundaries become retrieval blind spots`,
        },
        {
          type: 'paragraph',
          value:
            'Overlap has a cost: every repeated passage is stored and embedded twice, the index grows and more similar chunks compete in retrieval. Too much overlap inflates the cost and adds noise; zero overlap turns every boundary into a blind spot. A practical value sits between 10% and 20% of the chunk size, and the fine tuning depends on how self-contained the content already is: highly fragmented text benefits from more overlap, flowing prose from less. The point is that overlap is not decoration, it is what prevents the right information from vanishing right at the seam between two pieces.',
        },
      ],
    },
    {
      title: 'The right chunk size: the central trade-off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Chunk size governs a trade-off that shows up at both ends of the pipeline. A large chunk carries more context per piece, but its embedding gets diffuse: it represents several subjects at once, and in the similarity search a chunk that talks about ten things matches poorly with a question about one of them. A small chunk has a precise embedding and matches the question well, but may be too specific and reach the model without the surrounding context that gave the answer meaning. Neither extreme is good: the giant chunk retrieves with low precision, the tiny chunk retrieves precise but incomplete.',
        },
        {
          type: 'list',
          items: [
            'Chunk too large: diffuse embedding, low retrieval precision, and it also takes up more of the context window per retrieved piece.',
            'Chunk too small: precise embedding, but retrieves fragments without context; the model gets the right sentence without the paragraph that explained it.',
            'Adjust by content type: FAQ and short passages tolerate a small chunk; dense technical documentation and contracts need a larger chunk so as not to separate a clause from its condition.',
            'Keep the number calibratable, not hardcoded: the ideal size changes with the corpus and the embedding model; if it is fixed in code, you cannot measure and adjust.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is no universal magic number, but there is a working range: chunks on the order of a few hundred tokens tend to balance embedding precision and enough context for most texts. The right path is not to guess but to treat size as a parameter: start in a reasonable range, measure retrieval quality and adjust by document type. A short FAQ corpus and a corpus of legal contracts should not use the same chunk size, for the same reason they do not use the same language.',
        },
      ],
    },
    {
      title: 'Metadata: the chunk needs to know where it came from',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A chunk is not just the text; it is the text plus the information of where it came from. Without metadata, a retrieved piece is an orphan passage: the model does not know which document it came from, which section, which version, and you cannot cite the source or filter the search. Attaching metadata to each chunk turns retrieval from a blind search into a search with provenance. With the source document and section, the model can cite the source in the answer; with the date or version, you avoid retrieving the old policy; with the tenant or the language, you filter the search before similarity even runs and you do not leak one customer data to another.',
        },
        {
          type: 'code',
          value: `// chunk/withMeta.js
// Each chunk carries the text AND the provenance. Without metadata, the
// retrieved piece is an orphan: no way to cite source, filter or version.

export function attachMetadata(chunks, doc) {
  return chunks.map((text, index) => ({
    text,
    metadata: {
      docId: doc.id,          // which document it came from (enables citing the source)
      title: doc.title,       // title/section to give context in the answer
      source: doc.source,     // origin url or path
      version: doc.version,   // avoids retrieving the old version of the content
      tenant: doc.tenant,     // filters the search per customer before similarity
      lang: doc.lang,         // does not mix languages in retrieval
      position: index,        // order of the chunk within the document
    },
  }));
}

// At retrieval: filter by metadata (tenant, lang, version) BEFORE ranking
// by similarity. Filtering by metadata is cheap and avoids matching the wrong chunk.`,
        },
        {
          type: 'paragraph',
          value:
            'Filtering by metadata before ranking by similarity is one of the cheapest retrieval improvements there is. Restricting the search to the right tenant, the right language and the current version eliminates upfront chunks that should never match, and the model gets to choose among candidates that at least belong to the context of the question. Metadata is also what enables source citation in the answer, which is often the difference between a bot users trust and one nobody audits. The chunk without provenance saves five minutes at indexing and charges dearly on every query.',
        },
      ],
    },
    {
      title: 'Measuring whether chunking is helping retrieval',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Chunking is easy to change and hard to evaluate by eye, because the effect only shows up downstream, in the answer quality. To avoid tuning in the dark, you need a set of questions with the expected answer passage and retrieval metrics that tell whether the right chunk was retrieved. The idea is to isolate the chunking layer: fixing the model and the embedding, you swap only the cutting strategy and measure the impact on retrieval, without confusing a chunk problem with a model problem.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it reveals', 'When to act'],
          rows: [
            [
              'Recall@k',
              'Whether the right chunk appeared among the k retrieved',
              'Low: chunk too large or a boundary cutting the answer',
            ],
            [
              'Precision@k',
              'How many of the k retrieved were relevant',
              'Low: chunk too small generating noisy fragments',
            ],
            [
              'Split boundary',
              'Answers divided between two chunks',
              'Frequent: increase overlap or cut by structure',
            ],
            [
              'Self-contained chunk',
              'Whether the piece makes sense read in isolation',
              'Many that do not: cut by structure, not by size',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The metric that matters most is recall: did the chunk containing the expected answer appear among the top k? If it did not, no reranking or prompt improves the answer, because the information never reached the model. Low recall points to a chunk too large (diffuse embedding) or to the answer split at the boundary (insufficient overlap). Before swapping the embedding model or investing in reranking, it is worth measuring whether the problem is simply in the cut, which is the cheapest lever in the whole pipeline.',
        },
      ],
    },
    {
      title: 'Building the chunking layer in the right order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Chunking is the foundation of RAG: it is cheap to implement, hard to notice when it is wrong and responsible for a huge slice of the final quality. Getting it wrong here dooms everything that follows, because no model answers well about a passage retrieved in half. The rollout order goes from structural to fine.',
        },
        {
          type: 'ordered',
          items: [
            'Start by cutting by structure, not by size: respect the document heading, paragraph and list before thinking about any character count.',
            'Adapt the separators to the source format: markdown, PDF and code have different boundaries; a single separator for everything reintroduces the blind cut.',
            'Add moderate overlap (10% to 20%): stitch the boundaries so information at the seam does not become a blind spot, without inflating the index.',
            'Attach metadata to every chunk: docId, section, version, tenant and language; without provenance there is no source citation and no cheap filter before similarity.',
            'Measure recall with a set of labeled questions: only that way do you adjust size and overlap with data, instead of swapping models thinking the problem is the embedding.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between a RAG that answers precisely and one that hallucinates with confidence begins long before the model, in the way the document is cut. Cutting by structure, the right amount of overlap, metadata on every piece and a recall metric that closes the loop: that is what turns a pile of text into an index from which retrieval can pull the whole right answer. The embedding and the model are commodities; well-done chunking is the cheap part that decides whether the rest of the pipeline has a chance.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why can I not simply cut the document every N characters?',
      answer:
        'Because character N almost never lands on a meaning boundary. It splits sentences in half, separates a definition from its exception, pulls a table away from its header and generates chunks that, read in isolation, mean nothing. That mutilated piece has a confused embedding and, when retrieved, reaches the model as a truncated passage. The result looks like a model hallucination, but it is amputation done at indexing time. Cutting by structure (heading, paragraph, sentence) makes the chunk end where an idea ends, and that is what preserves the context retrieval needs to recover.',
    },
    {
      question: 'What is overlap between chunks for?',
      answer:
        'Overlap repeats a piece of the end of each chunk at the start of the next, so that information sitting exactly on the boundary between two pieces appears whole in at least one of them. Without overlap, every boundary becomes a blind spot: a sentence crossing the cut line stays half in both chunks and retrieval cannot recover it as a unit. The cost is storing and embedding the repeated passage twice, so the practical value sits between 10% and 20% of the chunk size: enough to stitch the boundary without inflating the index or filling retrieval with near-identical chunks.',
    },
    {
      question: 'What is the ideal chunk size?',
      answer:
        'There is no universal number, because size governs a trade-off. A large chunk carries more context but has a diffuse embedding, which matches specific questions poorly and lowers retrieval precision. A small chunk has a precise embedding but retrieves fragments without the surrounding context. A range of a few hundred tokens tends to balance the two for general texts, but the right approach is to treat size as a calibratable parameter: start in a reasonable range, measure recall and adjust by document type. A short FAQ and a legal contract should not use the same size, for the same reason they do not use the same language.',
    },
  ],
  conclusion: {
    title: 'Well-done chunking is the cheap foundation of a RAG that does not hallucinate',
    description:
      'RAG quality starts at the document cut: cutting by structure instead of by size, moderate overlap to stitch boundaries, provenance metadata on every chunk and a recall metric that closes the loop. I can design that ingestion layer in your AI system, from the parser to the index, so retrieval recovers the whole right answer instead of truncated fragments.',
    cta: 'Talk about chunking and RAG in my AI system',
  },
  related: [
    { label: 'RAG for WhatsApp support: production design with fewer hallucinations', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'CAG vs RAG: when context cache beats retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-chunking-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Todo pipeline de RAG empieza con una decisión que casi nadie debate y que decide la calidad de todo lo que viene después: cómo cortar el documento en pedazos. El reflejo es el más simple posible, partir el texto cada N caracteres. Funciona en el prototipo y engaña en la demo, pero en producción corta una definición a la mitad, separa la pregunta de la respuesta, saca la tabla de su cabecera y recupera un fragmento que, aislado, no significa nada. El modelo entonces recibe un contexto mutilado y responde con la confianza de siempre, solo que sobre un fragmento sin sentido. El problema casi nunca está en el modelo ni en el embedding; está en el chunk. Una buena recuperación depende de que el pedazo recuperado sea una unidad que se entiende sola, y eso no sale de un corte ciego por tamaño. Este artículo muestra cómo cortar respetando la estructura del documento, por qué existe el solapamiento entre pedazos, cuál es el tamaño correcto de chunk, el metadato que cada pedazo necesita cargar y cómo medir si el chunking está ayudando o saboteando el retrieval.',
  sections: [
    {
      title: 'Por qué el corte por tamaño fijo rompe el contexto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cortar el documento cada N caracteres ignora todo lo que le da sentido al texto. El caracter en la posición 500 puede estar en medio de una frase, en medio de una palabra, entre un número y su unidad, o separando el rótulo de una lista de su ítem. El resultado es un chunk que empieza y termina en el vacío: mitad de una idea pegada a mitad de otra. En el retrieval, ese pedazo tiene un embedding confuso, porque representa dos asuntos a medias, y cuando se recupera llega al modelo como un fragmento que nadie entendería leído aislado. El modelo, que solo ve lo que se recuperó, responde a partir de un fragmento truncado.',
        },
        {
          type: 'paragraph',
          value:
            'El caso más traicionero es la separación entre pregunta y respuesta, o entre una afirmación y su condición. Un manual dice "el reembolso se libera en 5 días hábiles, excepto cuando el pago fue por boleto, en cuyo caso el plazo es de 10 días". Un corte por tamaño en el lugar equivocado guarda la primera mitad en un chunk y la excepción en otro. El retrieval trae el primero, el modelo responde "5 días hábiles" con toda la certeza, y la excepción que invertía la respuesta quedó en un pedazo que nadie recuperó. No es alucinación del modelo, es amputación en la indexación.',
        },
        {
          type: 'table',
          columns: ['Situación', 'Corte por tamaño fijo', 'Corte por estructura'],
          rows: [
            [
              'Fin del chunk',
              'En medio de frase o palabra',
              'Al final de párrafo o sección',
            ],
            [
              'Definición y su excepción',
              'Pueden caer en chunks distintos',
              'Quedan juntas en la misma unidad',
            ],
            [
              'Tabla y cabecera',
              'Cabecera separada de las filas',
              'Tabla preservada como bloque',
            ],
            [
              'Embedding del chunk',
              'Mezcla dos asuntos a medias',
              'Representa un asunto cohesivo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lección es que el tamaño no es la unidad correcta de corte; el significado sí. Un buen chunk termina donde una idea termina, no donde un contador de caracteres se desborda. Todo el resto del artículo es sobre cómo cortar siguiendo la estructura del texto en vez de pelear contra ella.',
        },
      ],
    },
    {
      title: 'Cortar siguiendo la estructura del documento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La estrategia que resuelve la mayor parte de los casos es el chunking recursivo por estructura: en vez de partir por caracter, partís por los separadores naturales del documento, del mayor al menor. Primero intenta quebrar por sección o título, después por párrafo, después por frase, y solo recurre al corte bruto si un único párrafo ya excede el tope. Así el corte cae siempre en la mayor frontera semántica disponible, y un chunk raramente termina en medio de una frase. El documento manda en el corte, no el contador.',
        },
        {
          type: 'code',
          value: `// chunk/recursive.js
// Chunking recursivo por estructura: quiebra por los separadores naturales
// del documento, del mayor al menor, hasta que cada pedazo quepa en el tope.
// Solo corta "en bruto" cuando un bloque unico ya excede el limite.

const SEPARATORS = ['\\n\\n\\n', '\\n\\n', '\\n', '. ', ' '];

export function chunkByStructure(text, { maxChars = 1200, sepIndex = 0 } = {}) {
  // Cabe entero: es un chunk cohesivo, no hace falta dividir mas.
  if (text.length <= maxChars) return [text];

  // Sin mas separadores: bloque unico gigante, corta en bruto como ultimo recurso.
  if (sepIndex >= SEPARATORS.length) {
    const cut = [];
    for (let i = 0; i < text.length; i += maxChars) cut.push(text.slice(i, i + maxChars));
    return cut;
  }

  const parts = text.split(SEPARATORS[sepIndex]).filter(Boolean);

  // Ese separador no dividio nada: prueba el proximo, mas fino.
  if (parts.length === 1) return chunkByStructure(text, { maxChars, sepIndex: sepIndex + 1 });

  // Junta los pedazos hasta llenar un chunk, respetando la frontera del separador.
  const chunks = [];
  let buffer = '';
  for (const part of parts) {
    if ((buffer + part).length > maxChars && buffer) {
      chunks.push(buffer.trim());
      buffer = '';
    }
    // Parte sola ya excede el tope: baja un nivel de separador en ella.
    if (part.length > maxChars) {
      chunks.push(...chunkByStructure(part, { maxChars, sepIndex: sepIndex + 1 }));
    } else {
      buffer += (buffer ? SEPARATORS[sepIndex] : '') + part;
    }
  }
  if (buffer.trim()) chunks.push(buffer.trim());
  return chunks;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en el formato del documento antes de elegir los separadores. Markdown tiene títulos (#) y listas que son fronteras obvias; un PDF exportado puede tener saltos de línea artificiales en medio de párrafos que engañan al separador; el código quiere ser cortado por función, no por cualquier línea en blanco. Un chunking que ignora el formato de origen reintroduce, por el lado del parser, el mismo problema que intentaba resolver. La regla general es: identificá las fronteras reales de ese tipo de documento y cortá en ellas, en vez de aplicar un separador único para todo.',
        },
      ],
    },
    {
      title: 'Solapamiento: coser la frontera entre chunks',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun cortando por estructura, siempre existe una frontera: el fin de un chunk y el comienzo del próximo. Una información relevante puede quedar exactamente sobre esa línea, con la primera parte al final de un chunk y la continuación al inicio del siguiente. El solapamiento (overlap) resuelve esto repitiendo un pedazo del fin de cada chunk al comienzo del próximo. Así, una frase que atraviesa la frontera aparece entera en al menos uno de los dos chunks, y el retrieval logra recuperarla como unidad. Es una póliza de seguro barata contra que el corte caiga en el peor lugar posible.',
        },
        {
          type: 'diagram',
          value: `El solapamiento entre chunks cose la frontera

  documento original
  [....A....][....B....][....C....]  <- las fronteras pueden cortar una idea

  sin overlap:
    chunk 1: ....A....
    chunk 2: ....B....   <- idea que estaba entre A y B se pierde en el corte
    chunk 3: ....C....

  con overlap (repite el fin en el proximo):
    chunk 1: ....A..[a]
    chunk 2: [a]..B..[b]   <- [a] trae el fin de A junto al comienzo de B
    chunk 3: [b]..C....

  [a],[b] = fragmento repetido en la frontera
  overlap grande = mas seguridad, mas costo de almacenamiento y ruido
  overlap cero   = las fronteras se vuelven puntos ciegos del retrieval`,
        },
        {
          type: 'paragraph',
          value:
            'El solapamiento tiene un costo: cada fragmento repetido se almacena y se embeda dos veces, el índice crece y hay más chunks parecidos compitiendo en el retrieval. Overlap demasiado grande infla el costo y trae ruido; overlap cero transforma toda frontera en un punto ciego. Un valor práctico queda entre 10% y 20% del tamaño del chunk, y el ajuste fino depende de cuán auto-contenido ya es el contenido: texto muy fragmentado se beneficia de más overlap, prosa corrida de menos. El punto es que el overlap no es adorno, es lo que impide que la información correcta desaparezca justo en la juntura entre dos pedazos.',
        },
      ],
    },
    {
      title: 'El tamaño correcto del chunk: el trade-off central',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El tamaño del chunk gobierna un trade-off que aparece en las dos puntas del pipeline. Un chunk grande carga más contexto por pedazo, pero su embedding se vuelve difuso: representa varios asuntos al mismo tiempo, y en la búsqueda por similitud un chunk que habla de diez cosas casa mal con una pregunta sobre una de ellas. Un chunk pequeño tiene embedding preciso y casa bien con la pregunta, pero puede ser demasiado específico y llegar al modelo sin el contexto alrededor que le daba sentido a la respuesta. Ningún extremo es bueno: el chunk gigante recupera con baja precisión, el chunk minúsculo recupera preciso pero incompleto.',
        },
        {
          type: 'list',
          items: [
            'Chunk demasiado grande: embedding difuso, baja precisión de retrieval, y encima ocupa más espacio de la ventana de contexto por pedazo recuperado.',
            'Chunk demasiado pequeño: embedding preciso, pero recupera fragmentos sin contexto; el modelo recibe la frase correcta sin el párrafo que la explicaba.',
            'Ajustá por tipo de contenido: FAQ y fragmentos cortos toleran chunk pequeño; documentación técnica densa y contratos piden chunk más grande para no separar cláusula de condición.',
            'Dejá el número calibrable, no hardcodeado: el tamaño ideal cambia con el corpus y con el modelo de embedding; si está fijo en el código, no podés medir y ajustar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'No existe un número mágico universal, pero hay una franja de trabajo: chunks del orden de algunas centenas de tokens suelen equilibrar precisión de embedding y contexto suficiente para la mayoría de los textos. El camino correcto no es adivinar sino tratar el tamaño como parámetro: empezar en una franja razonable, medir la calidad del retrieval y ajustar por tipo de documento. Un corpus de FAQ corto y un corpus de contratos jurídicos no deberían usar el mismo tamaño de chunk, por la misma razón que no usan el mismo lenguaje.',
        },
      ],
    },
    {
      title: 'Metadato: el chunk necesita saber de dónde vino',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un chunk no es solo el texto; es el texto más la información de dónde vino. Sin metadato, un pedazo recuperado es un fragmento huérfano: el modelo no sabe de qué documento salió, de qué sección, de qué versión, y no podés citar la fuente ni filtrar la búsqueda. Adjuntar metadato a cada chunk transforma el retrieval de una búsqueda ciega en una búsqueda con procedencia. Con el documento de origen y la sección, el modelo puede citar la fuente en la respuesta; con la fecha o versión, evitás recuperar la política antigua; con el tenant o el idioma, filtrás la búsqueda antes incluso de la similitud y no filtrás dato de un cliente a otro.',
        },
        {
          type: 'code',
          value: `// chunk/withMeta.js
// Cada chunk carga el texto Y la procedencia. Sin metadato, el pedazo
// recuperado es huerfano: no se puede citar fuente, filtrar ni versionar.

export function attachMetadata(chunks, doc) {
  return chunks.map((text, index) => ({
    text,
    metadata: {
      docId: doc.id,          // de que documento vino (permite citar la fuente)
      title: doc.title,       // titulo/seccion para dar contexto en la respuesta
      source: doc.source,     // url o ruta de origen
      version: doc.version,   // evita recuperar la version antigua del contenido
      tenant: doc.tenant,     // filtra la busqueda por cliente antes de la similitud
      lang: doc.lang,         // no mezcla idiomas en el retrieval
      position: index,        // orden del chunk dentro del documento
    },
  }));
}

// En el retrieval: filtra por metadato (tenant, lang, version) ANTES de rankear
// por similitud. Filtrar por metadato es barato y evita casar el chunk equivocado.`,
        },
        {
          type: 'paragraph',
          value:
            'El filtro por metadato antes del ranqueo por similitud es una de las mejoras de retrieval más baratas que existen. Restringir la búsqueda al tenant correcto, al idioma correcto y a la versión vigente elimina de entrada chunks que jamás deberían casar, y el modelo pasa a elegir entre candidatos que al menos pertenecen al contexto de la pregunta. El metadato también es lo que viabiliza la cita de fuente en la respuesta, que muchas veces es la diferencia entre un bot en el que los usuarios confían y uno que nadie audita. El chunk sin procedencia ahorra cinco minutos en la indexación y cobra caro en cada consulta.',
        },
      ],
    },
    {
      title: 'Medir si el chunking está ayudando al retrieval',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El chunking es fácil de cambiar y difícil de evaluar a ojo, porque el efecto solo aparece más adelante, en la calidad de la respuesta. Para no ajustar a ciegas, necesitás un conjunto de preguntas con el fragmento de respuesta esperado y métricas de retrieval que digan si el chunk correcto fue recuperado. La idea es aislar la capa de chunking: fijando el modelo y el embedding, cambiás solo la estrategia de corte y medís el impacto en el retrieval, sin confundir problema de chunk con problema de modelo.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué revela', 'Cuándo actuar'],
          rows: [
            [
              'Recall@k',
              'Si el chunk correcto apareció entre los k recuperados',
              'Bajo: chunk demasiado grande o frontera cortando la respuesta',
            ],
            [
              'Precision@k',
              'Cuántos de los k recuperados eran relevantes',
              'Baja: chunk demasiado pequeño generando fragmentos ruidosos',
            ],
            [
              'Frontera partida',
              'Respuestas divididas entre dos chunks',
              'Frecuente: aumenta el overlap o corta por estructura',
            ],
            [
              'Chunk auto-contenido',
              'Si el pedazo tiene sentido leído aislado',
              'Muchos sin sentido: cortar por estructura, no por tamaño',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La métrica que más importa es la recuperación: ¿el chunk que contiene la respuesta esperada apareció entre los k primeros? Si no apareció, ningún reranking ni prompt mejora la respuesta, porque la información ni llegó al modelo. Recall bajo apunta a chunk demasiado grande (embedding difuso) o a la respuesta partida en la frontera (overlap insuficiente). Antes de cambiar de modelo de embedding o de invertir en reranking, vale medir si el problema no está simplemente en el corte, que es la palanca más barata de todo el pipeline.',
        },
      ],
    },
    {
      title: 'Montar la capa de chunking en el orden correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El chunking es la fundación del RAG: es barato de implementar, difícil de percibir cuando está mal y responsable de una porción enorme de la calidad final. Errar acá condena todo lo que viene después, porque ningún modelo responde bien sobre un fragmento que fue recuperado a la mitad. El orden de despliegue va de lo estructural a lo fino.',
        },
        {
          type: 'ordered',
          items: [
            'Empezá cortando por estructura, no por tamaño: respetá título, párrafo y lista del documento antes de pensar en cualquier número de caracteres.',
            'Adaptá los separadores al formato de origen: markdown, PDF y código tienen fronteras distintas; un separador único para todo reintroduce el corte ciego.',
            'Agregá overlap moderado (10% a 20%): cosé las fronteras para que la información en la juntura no se vuelva punto ciego, sin inflar el índice.',
            'Adjuntá metadato a todo chunk: docId, sección, versión, tenant e idioma; sin procedencia no hay cita de fuente ni filtro barato antes de la similitud.',
            'Medí el recall con un conjunto de preguntas etiquetadas: solo así ajustás tamaño y overlap con dato, en vez de cambiar de modelo creyendo que el problema es el embedding.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un RAG que responde con precisión y uno que alucina con confianza empieza mucho antes del modelo, en el modo de cortar el documento. Corte por estructura, overlap en la medida, metadato en cada pedazo y una métrica de recall que cierra el ciclo: eso es lo que transforma un montón de texto en un índice del cual el retrieval logra sacar la respuesta correcta entera. El embedding y el modelo son commodities; el chunking bien hecho es la parte barata que decide si el resto del pipeline tiene chance.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no puedo simplemente cortar el documento cada N caracteres?',
      answer:
        'Porque el caracter N casi nunca cae en una frontera de significado. Parte frases a la mitad, separa una definición de su excepción, saca una tabla de su cabecera y genera chunks que, leídos aislados, no significan nada. Ese pedazo mutilado tiene un embedding confuso y, cuando se recupera, llega al modelo como un fragmento truncado. El resultado parece alucinación del modelo, pero es amputación hecha en la indexación. Cortar por estructura (título, párrafo, frase) hace que el chunk termine donde una idea termina, y eso es lo que preserva el contexto que el retrieval necesita recuperar.',
    },
    {
      question: '¿Para qué sirve el solapamiento (overlap) entre chunks?',
      answer:
        'El solapamiento repite un pedazo del fin de cada chunk al comienzo del próximo, para que una información que cae exactamente en la frontera entre dos pedazos aparezca entera en al menos uno de ellos. Sin overlap, toda frontera se vuelve un punto ciego: una frase que atraviesa la línea de corte queda a la mitad en los dos chunks y el retrieval no logra recuperarla como unidad. El costo es almacenar y embedar el fragmento repetido dos veces, así que el valor práctico queda entre 10% y 20% del tamaño del chunk: lo suficiente para coser la frontera sin inflar el índice ni llenar el retrieval de chunks casi iguales.',
    },
    {
      question: '¿Cuál es el tamaño ideal de chunk?',
      answer:
        'No hay número universal, porque el tamaño gobierna un trade-off. Un chunk grande carga más contexto pero tiene embedding difuso, que casa mal con preguntas específicas y baja la precisión del retrieval. Un chunk pequeño tiene embedding preciso pero recupera fragmentos sin el contexto alrededor. Una franja de algunas centenas de tokens suele equilibrar los dos para textos generales, pero lo correcto es tratar el tamaño como parámetro calibrable: empezar en una franja razonable, medir el recall y ajustar por tipo de documento. Un FAQ corto y un contrato jurídico no deberían usar el mismo tamaño, por la misma razón que no usan el mismo lenguaje.',
    },
  ],
  conclusion: {
    title: 'El chunking bien hecho es la fundación barata de un RAG que no alucina',
    description:
      'La calidad del RAG empieza en el corte del documento: cortar por estructura en vez de por tamaño, overlap moderado para coser fronteras, metadato de procedencia en cada chunk y una métrica de recall que cierra el ciclo. Puedo diseñar esa capa de ingesta en tu sistema de IA, del parser al índice, para que el retrieval recupere la respuesta correcta entera en vez de fragmentos truncados.',
    cta: 'Hablar sobre chunking y RAG en mi sistema de IA',
  },
  related: [
    { label: 'RAG para atención en WhatsApp: diseño de producción con menos alucinaciones', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'CAG vs RAG: cuando el cache de contexto le gana al retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-chunking-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
