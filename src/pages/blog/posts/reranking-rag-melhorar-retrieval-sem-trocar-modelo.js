// Conteudo do artigo: reranking em RAG para melhorar o retrieval sem trocar o modelo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Reranking mínimo para RAG: em vez de mandar ao modelo os primeiros vizinhos que o embedding devolveu, busca um conjunto amplo de candidatos, passa cada um por um reranker que compara pergunta e trecho par a par, e entrega ao modelo só os poucos melhores já ordenados por relevância, para que o contexto certo esteja no topo em vez de perdido na décima posição.',
  en: 'Minimal reranking for RAG: instead of handing the model the first neighbors the embedding returned, it fetches a wide set of candidates, runs each through a reranker that compares question and passage pair by pair, and delivers to the model only the few best already ordered by relevance, so the right context sits at the top instead of lost in tenth place.',
  es: 'Reranking mínimo para RAG: en vez de entregar al modelo los primeros vecinos que devolvió el embedding, busca un conjunto amplio de candidatos, pasa cada uno por un reranker que compara pregunta y fragmento par a par, y entrega al modelo solo los pocos mejores ya ordenados por relevancia, para que el contexto correcto esté en la cima en vez de perdido en la décima posición.',
};

const repoUrl = 'https://github.com/joaosouz4dev/rag-reranking-mini';

const pt = {
  intro:
    'Depois de cortar o documento bem e escolher um bom modelo de embedding, muita gente considera o retrieval resolvido: a busca vetorial devolve os vizinhos mais próximos e pronto. Mas há uma etapa entre "recuperar candidatos" e "montar o contexto" que quase todo pipeline pula e que decide se a resposta certa chega ao modelo: a reordenação dos candidatos por relevância real. A busca por similaridade de embedding é rápida e boa para varrer milhões de trechos, mas ela compara vetores comprimidos, não a pergunta contra o texto. O resultado é que o trecho que responde exatamente à pergunta muitas vezes está entre os recuperados, só que na sétima ou décima posição, e você corta o contexto nos três primeiros. O reranking existe para corrigir isso: recuperar um conjunto amplo e barato, e então reordenar com um modelo que de fato lê pergunta e trecho juntos, colocando a resposta certa no topo. Este artigo mostra por que o embedding erra a ordem, o que é um cross-encoder e como ele difere do bi-encoder, o padrão recuperar-amplo-reranquear-estreito, o custo e a latência que o reranking adiciona e como medir se ele está valendo a pena, tudo sem trocar o modelo de geração.',
  sections: [
    {
      title: 'Por que a busca por embedding erra a ordem dos trechos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A busca vetorial funciona assim: no momento da ingestão, cada trecho é transformado em um vetor por um modelo de embedding; no momento da consulta, a pergunta vira outro vetor e você busca os trechos cujo vetor está mais próximo. Isso é chamado de bi-encoder, porque pergunta e trecho são codificados separadamente, cada um sem ver o outro. É extremamente rápido, porque os vetores dos trechos são pré-calculados e a busca é só uma comparação de distância. O problema é justamente esse: pergunta e trecho nunca se olham. O embedding comprime todo o significado de um parágrafo num único vetor de algumas centenas de dimensões, e nessa compressão detalhes se perdem. Dois trechos que falam do mesmo assunto geral ficam próximos da pergunta, mesmo que só um responda de fato à pergunta específica.',
        },
        {
          type: 'paragraph',
          value:
            'O sintoma clássico é o trecho certo aparecer entre os recuperados, mas fora do topo. Você pede os 20 vizinhos mais próximos e a resposta exata está na posição 9. Se o pipeline monta o contexto com os 3 ou 5 primeiros, a resposta certa foi recuperada e depois descartada, e o modelo responde a partir de trechos que só tangenciam a pergunta. Não é falha do embedding em recuperar, é falha em ordenar. Recall alto e ordem ruim é exatamente o cenário em que o reranking mais rende: a informação está lá, só está na posição errada.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Bi-encoder (embedding)', 'Cross-encoder (reranker)'],
          rows: [
            [
              'Como compara',
              'Vetor da pergunta contra vetor do trecho',
              'Lê pergunta e trecho juntos, par a par',
            ],
            [
              'Velocidade',
              'Muito rápida, vetores pré-calculados',
              'Lenta, um forward por par pergunta-trecho',
            ],
            [
              'Escala',
              'Milhões de trechos por consulta',
              'Dezenas de candidatos por consulta',
            ],
            [
              'Precisão da ordem',
              'Boa para triagem, fraca no topo',
              'Alta, entende a pergunta específica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A lição é que embedding e reranking não competem, eles se complementam. O embedding é a triagem barata que varre tudo e traz os candidatos plausíveis; o reranking é o segundo olhar caro que lê com atenção e decide a ordem final. Usar só o primeiro é rápido e impreciso no topo; o resto do artigo é sobre como encaixar o segundo sem estourar latência nem custo.',
        },
      ],
    },
    {
      title: 'Cross-encoder: o modelo que lê pergunta e trecho juntos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reranker é tipicamente um cross-encoder: em vez de codificar pergunta e trecho separadamente, ele recebe os dois concatenados na mesma entrada e produz um único número, a pontuação de relevância daquele par. Porque a pergunta e o trecho passam juntos pelo modelo, ele consegue capturar a interação entre eles, quais palavras da pergunta são de fato respondidas pelo trecho, e não só se os dois falam do mesmo tema. É essa leitura conjunta que o bi-encoder não faz e que corrige a ordem. O preço é que não dá para pré-calcular nada: cada par pergunta-trecho exige uma passada pelo modelo na hora da consulta. Por isso o cross-encoder é preciso demais para escanear o índice inteiro e barato o bastante para reordenar algumas dezenas de candidatos.',
        },
        {
          type: 'code',
          value: `// rerank/crossEncoder.js
// Reranking com cross-encoder: recebe a pergunta e a lista de candidatos
// vinda da busca vetorial, pontua cada par pergunta-trecho e devolve
// os candidatos reordenados do mais relevante ao menos relevante.

export async function rerank(query, candidates, { scoreFn, topN = 5 } = {}) {
  // Um forward do modelo por par (pergunta, trecho). Custa mais que a
  // busca vetorial, por isso roda so sobre os candidatos, nao sobre o indice.
  const scored = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      // scoreFn compara pergunta e trecho JUNTOS: quao bem este trecho
      // responde ESTA pergunta, nao so se falam do mesmo assunto.
      score: await scoreFn(query, c.text),
    })),
  );

  // Reordena por relevancia real e corta no topN que vai ao modelo.
  // O embedding fez a triagem; o cross-encoder decide a ordem final.
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Você não precisa treinar um cross-encoder para começar: há modelos de reranking prontos, servidos por API ou rodando local, que recebem uma pergunta e uma lista de trechos e devolvem as pontuações. A decisão de engenharia não é qual arquitetura implementar do zero, é quantos candidatos mandar para o reranker e quantos entregar ao modelo depois. Esse é o coração do padrão que vem a seguir: recuperar amplo com o embedding, reranquear estreito com o cross-encoder.',
        },
      ],
    },
    {
      title: 'O padrão: recuperar amplo, reranquear, entregar estreito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reranking só ajuda se a resposta certa estiver entre os candidatos recuperados. Por isso a busca vetorial na frente deve pescar um conjunto amplo, bem maior do que o que vai ao modelo. Recuperar só os 3 mais próximos pelo embedding e reranquear esses 3 não adianta nada: se a resposta estava na posição 9, ela nem entrou na peneira. O padrão certo é recuperar largo (dezenas de candidatos), reranquear tudo isso com o cross-encoder e só então cortar nos poucos melhores que cabem na janela do modelo. O embedding maximiza recall barato; o reranker maximiza precisão no topo.',
        },
        {
          type: 'diagram',
          value: `Recuperar amplo -> reranquear -> entregar estreito

  pergunta
     |
     v
  [ busca vetorial / embedding ]   <- barato, varre o indice inteiro
     |  recupera ~30 candidatos (recall alto, ordem fraca)
     v
  [ c9 c3 c17 c1 c22 ... ]         <- resposta certa esta aqui, mas na pos. 9
     |
     v
  [ cross-encoder reranker ]        <- caro, le pergunta+trecho par a par
     |  reordena por relevancia real
     v
  [ c9 c1 c3 ]                      <- top-N; a resposta certa subiu ao topo
     |
     v
  [ modelo de geracao ]             <- recebe so o contexto certo e enxuto

  recuperar 3 e reranquear 3 = inutil: se a resposta esta na pos. 9,
  nem entra na peneira. Recuperar amplo e o que da material ao reranker.`,
        },
        {
          type: 'paragraph',
          value:
            'Há dois números para calibrar. O primeiro é quantos candidatos a busca vetorial recupera antes do reranking: amplo o bastante para conter a resposta certa com folga, sem virar um conjunto grande demais que encareça a etapa de reranking. O segundo é quantos trechos, depois de reordenados, vão ao modelo: enxuto o bastante para não diluir o contexto nem gastar janela à toa. O reranking permite ser generoso na recuperação e econômico na entrega, porque a reordenação garante que os poucos que sobrarem são os melhores, não só os primeiros que o vetor devolveu.',
        },
      ],
    },
    {
      title: 'O custo real: latência e preço que o reranking adiciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking não é grátis. Cada candidato reranqueado é uma passada por um modelo, então reordenar 30 candidatos é 30 inferências que não existiam antes, seja em tempo de GPU local, seja em chamadas a uma API de reranking. Isso soma latência entre a busca vetorial e a geração, e soma custo por consulta. A conta é direta: quanto mais amplo o conjunto recuperado, maior a chance da resposta certa estar dentro, mas maior a fatura e o tempo do reranking. O trabalho de engenharia é achar o ponto em que ampliar mais o conjunto não melhora mais a resposta, só encarece.',
        },
        {
          type: 'list',
          items: [
            'Latência: o reranking entra no caminho crítico entre buscar e gerar; um reranker lento pode custar mais tempo que a própria geração. Meça o acréscimo, não assuma que é desprezível.',
            'Custo por consulta: reranquear N candidatos é N inferências extras; num sistema de alto volume isso pode superar o custo da própria chamada de geração.',
            'Retorno decrescente: dobrar o número de candidatos recuperados raramente dobra a qualidade; existe um platô a partir do qual só se paga mais sem ganhar recall.',
            'Reranker local versus API: rodar local troca custo por chamada por custo de infraestrutura e engenharia; a API é mais simples mas cobra por trecho reranqueado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A forma de domar o custo é não reranquear quando não é preciso. Se a busca vetorial já devolve um primeiro candidato com pontuação de similaridade muito alta e destacada dos demais, provavelmente a triagem já acertou e o reranking vai só confirmar. Reservar o cross-encoder para as consultas ambíguas, aquelas em que os candidatos têm pontuações parecidas e a ordem está de fato incerta, corta boa parte da conta sem perder o ganho onde ele importa. Reranking é um segundo olhar caro; aplicá-lo indiscriminadamente desperdiça o que ele tem de melhor.',
        },
      ],
    },
    {
      title: 'Medir se o reranking está valendo a pena',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reranking mexe na ordem, então as métricas que importam são as que enxergam ordem, não só presença. Recall@k pergunta se o trecho certo está entre os k recuperados, e o reranking não muda isso: o mesmo conjunto entra e sai, só reordenado. O que o reranking melhora são as métricas sensíveis à posição, que penalizam a resposta certa por estar lá embaixo. A avaliação precisa isolar a camada: fixando chunking, embedding e busca, você liga e desliga o reranker e mede se a posição do trecho certo melhorou. Assim você separa ganho de reranking de qualquer outra mudança no pipeline.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que revela', 'Efeito do reranking'],
          rows: [
            [
              'Recall@k',
              'Se o trecho certo entrou nos k recuperados',
              'Não muda: depende da busca, não da ordem',
            ],
            [
              'MRR',
              'Quão perto do topo está o primeiro trecho certo',
              'Sobe quando o reranker puxa a resposta para cima',
            ],
            [
              'nDCG@k',
              'Qualidade da ordem completa, com peso na posição',
              'Sobe quando os relevantes ficam antes dos ruidosos',
            ],
            [
              'Latência p95',
              'Tempo extra que o reranking adiciona',
              'Sobe: é o preço a pesar contra o ganho de ordem',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A pergunta prática é: o reranking sobe o suficiente as métricas de posição para justificar a latência e o custo que adiciona? Se o MRR e o nDCG mal se mexem, o embedding já estava ordenando bem e o reranker é peso morto. Se eles saltam, o reranking está pescando de volta respostas que o pipeline estava descartando por estarem fora do topo. Medir os dois lados, ganho de ordem contra custo de latência, é o que transforma "adicionei um reranker" numa decisão de engenharia em vez de um item de checklist.',
        },
      ],
    },
    {
      title: 'Quando o reranking rende e quando não vale',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking não é ganho universal; ele rende em situações específicas. Onde o corpus é grande e cheio de trechos parecidos, o embedding traz muitos candidatos plausíveis e a ordem fica ruim, exatamente o terreno do cross-encoder. Onde a pergunta é sutil, com uma condição ou negação que muda a resposta, o bi-encoder tende a ignorar o detalhe e o reranker, que lê pergunta e trecho juntos, o captura. Já onde o corpus é pequeno e homogêneo, ou onde a busca vetorial já devolve o trecho certo em primeiro com folga, o reranking custa latência e dinheiro para confirmar uma ordem que já estava certa.',
        },
        {
          type: 'ordered',
          items: [
            'Antes de adicionar reranking, confirme o recall: se o trecho certo nem entra nos candidatos, o problema é chunking ou embedding, e o reranker não tem o que reordenar.',
            'Recupere amplo o suficiente para a resposta certa caber na peneira; recuperar estreito e reranquear estreito não resolve a ordem, só a confirma.',
            'Comece com um reranker pronto (API ou modelo local) antes de pensar em treinar; a decisão de engenharia é quantos candidatos entram e quantos saem.',
            'Meça posição, não só presença: MRR e nDCG dizem se a resposta subiu ao topo; recall sozinho não enxerga o ganho do reranking.',
            'Pese o ganho de ordem contra a latência p95 e o custo por consulta; reserve o reranking para as consultas ambíguas se o volume apertar a conta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O reranking é uma das alavancas mais baratas de qualidade de RAG justamente porque não pede trocar o modelo de geração nem reindexar o corpus: você mantém o embedding e a base como estão e insere uma etapa de reordenação entre a busca e a montagem do contexto. Quando o sintoma é "a informação estava lá, mas a resposta veio errada", quase sempre o culpado é a ordem, e a ordem é o que o reranking conserta. É o segundo olhar que faz o trecho certo, que já tinha sido recuperado, finalmente chegar ao modelo no topo.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual a diferença entre a busca por embedding e o reranking?',
      answer:
        'A busca por embedding usa um bi-encoder: pergunta e trecho são transformados em vetores separadamente, sem se olharem, e a busca compara distâncias entre esses vetores. É rápida porque os vetores dos trechos são pré-calculados, então serve para varrer milhões de trechos, mas comprime o significado e erra a ordem fina. O reranking usa um cross-encoder: recebe pergunta e trecho juntos na mesma entrada e produz uma pontuação de quão bem aquele trecho responde àquela pergunta específica. Ele lê a interação entre os dois, o que o embedding não faz, mas é lento porque exige uma inferência por par. Por isso o embedding faz a triagem ampla e barata, e o reranking reordena com precisão os poucos candidatos que sobraram.',
    },
    {
      question: 'Reranking melhora o recall do meu RAG?',
      answer:
        'Não. O reranking não muda quais trechos foram recuperados, só reordena os que a busca vetorial já trouxe. O mesmo conjunto entra e sai, apenas em ordem diferente. Se o trecho certo não estava entre os candidatos recuperados, o reranking não tem como pescá-lo de volta, e o problema está antes, no chunking ou no embedding. O que o reranking melhora é a posição: ele pega a resposta certa que estava recuperada mas na nona posição e a puxa para o topo, onde o contexto do modelo é montado. Por isso as métricas que mostram o ganho são as de ordem, como MRR e nDCG, e não o recall, que fica igual com ou sem reranker.',
    },
    {
      question: 'Vale a pena o custo e a latência do reranking?',
      answer:
        'Depende de quanto a ordem estava ruim. Cada candidato reranqueado é uma inferência extra, então o reranking soma latência no caminho crítico e custo por consulta. Ele vale a pena quando o corpus é grande e cheio de trechos parecidos, ou quando as perguntas têm condições e negações que o embedding ignora, situações em que a resposta certa costuma chegar recuperada mas fora do topo. Não vale quando o corpus é pequeno e homogêneo ou quando a busca já entrega o trecho certo em primeiro com folga: nesses casos o reranker só confirma uma ordem que já estava boa, pagando latência à toa. A forma de decidir é medir: se MRR e nDCG saltam ao ligar o reranking, o ganho justifica o custo; se mal se mexem, o embedding já ordenava bem.',
    },
  ],
  conclusion: {
    title: 'Reranking é o segundo olhar que coloca a resposta certa no topo',
    description:
      'A qualidade do RAG não depende só de recuperar o trecho certo, mas de entregá-lo ao modelo na ordem certa. Recuperar amplo com o embedding, reordenar com um cross-encoder e entregar estreito coloca a resposta que já estava recuperada no topo do contexto, sem trocar o modelo de geração nem reindexar o corpus. Posso desenhar essa camada de reranking no seu sistema de IA, calibrando quantos candidatos entram, quantos vão ao modelo e medindo o ganho de ordem contra a latência, para que o retrieval entregue a resposta certa inteira e na frente.',
    cta: 'Falar sobre reranking e RAG no meu sistema de IA',
  },
  related: [
    { label: 'Chunking de documento para RAG sem perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'RAG para atendimento no WhatsApp: produção sem alucinação', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-reranking-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'After cutting the document well and picking a good embedding model, many people consider retrieval solved: the vector search returns the nearest neighbors and that is it. But there is a step between "retrieving candidates" and "assembling the context" that almost every pipeline skips and that decides whether the right answer reaches the model: reordering the candidates by real relevance. Embedding similarity search is fast and good for scanning millions of passages, but it compares compressed vectors, not the question against the text. The result is that the passage which answers the question exactly is often among the retrieved ones, only in seventh or tenth place, and you cut the context at the top three. Reranking exists to fix this: retrieve a wide, cheap set, and then reorder with a model that actually reads question and passage together, putting the right answer at the top. This article shows why the embedding gets the order wrong, what a cross-encoder is and how it differs from a bi-encoder, the retrieve-wide-rerank-narrow pattern, the cost and latency reranking adds and how to measure whether it is paying off, all without swapping the generation model.',
  sections: [
    {
      title: 'Why embedding search gets the passage order wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Vector search works like this: at ingestion time, each passage is turned into a vector by an embedding model; at query time, the question becomes another vector and you search for the passages whose vector is closest. This is called a bi-encoder, because question and passage are encoded separately, each one without seeing the other. It is extremely fast, because the passage vectors are precomputed and the search is just a distance comparison. The problem is exactly that: question and passage never look at each other. The embedding compresses all the meaning of a paragraph into a single vector of a few hundred dimensions, and in that compression details are lost. Two passages that talk about the same general subject end up close to the question, even if only one actually answers the specific question.',
        },
        {
          type: 'paragraph',
          value:
            'The classic symptom is the right passage appearing among the retrieved ones, but outside the top. You ask for the 20 nearest neighbors and the exact answer is at position 9. If the pipeline assembles the context with the first 3 or 5, the right answer was retrieved and then discarded, and the model answers from passages that only graze the question. It is not a failure of the embedding to retrieve, it is a failure to order. High recall and bad order is exactly the scenario where reranking pays off most: the information is there, it is just in the wrong position.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Bi-encoder (embedding)', 'Cross-encoder (reranker)'],
          rows: [
            [
              'How it compares',
              'Question vector against passage vector',
              'Reads question and passage together, pair by pair',
            ],
            [
              'Speed',
              'Very fast, precomputed vectors',
              'Slow, one forward per question-passage pair',
            ],
            [
              'Scale',
              'Millions of passages per query',
              'Dozens of candidates per query',
            ],
            [
              'Order precision',
              'Good for triage, weak at the top',
              'High, understands the specific question',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The lesson is that embedding and reranking do not compete, they complement each other. The embedding is the cheap triage that scans everything and brings the plausible candidates; reranking is the expensive second look that reads carefully and decides the final order. Using only the first is fast and imprecise at the top; the rest of the article is about how to fit the second in without blowing latency or cost.',
        },
      ],
    },
    {
      title: 'Cross-encoder: the model that reads question and passage together',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The reranker is typically a cross-encoder: instead of encoding question and passage separately, it takes both concatenated in the same input and produces a single number, the relevance score of that pair. Because the question and the passage pass through the model together, it can capture the interaction between them, which words of the question are actually answered by the passage, and not just whether the two talk about the same topic. It is this joint reading that the bi-encoder does not do and that fixes the order. The price is that nothing can be precomputed: each question-passage pair requires a forward pass through the model at query time. That is why the cross-encoder is too precise to scan the whole index and cheap enough to reorder a few dozen candidates.',
        },
        {
          type: 'code',
          value: `// rerank/crossEncoder.js
// Reranking with a cross-encoder: takes the question and the candidate list
// coming from vector search, scores each question-passage pair and returns
// the candidates reordered from most relevant to least relevant.

export async function rerank(query, candidates, { scoreFn, topN = 5 } = {}) {
  // One model forward per (question, passage) pair. It costs more than the
  // vector search, so it runs only over the candidates, not over the index.
  const scored = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      // scoreFn compares question and passage TOGETHER: how well this passage
      // answers THIS question, not just whether they talk about the same topic.
      score: await scoreFn(query, c.text),
    })),
  );

  // Reorder by real relevance and cut at the topN that goes to the model.
  // The embedding did the triage; the cross-encoder decides the final order.
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}`,
        },
        {
          type: 'paragraph',
          value:
            'You do not need to train a cross-encoder to start: there are ready-made reranking models, served by API or running locally, that take a question and a list of passages and return the scores. The engineering decision is not which architecture to implement from scratch, it is how many candidates to send to the reranker and how many to deliver to the model afterwards. That is the heart of the pattern that follows: retrieve wide with the embedding, rerank narrow with the cross-encoder.',
        },
      ],
    },
    {
      title: 'The pattern: retrieve wide, rerank, deliver narrow',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking only helps if the right answer is among the retrieved candidates. That is why the vector search up front must fish a wide set, much larger than what goes to the model. Retrieving only the 3 nearest by embedding and reranking those 3 is useless: if the answer was at position 9, it never entered the sieve. The right pattern is to retrieve wide (dozens of candidates), rerank all of that with the cross-encoder and only then cut at the few best that fit the model window. The embedding maximizes cheap recall; the reranker maximizes precision at the top.',
        },
        {
          type: 'diagram',
          value: `Retrieve wide -> rerank -> deliver narrow

  question
     |
     v
  [ vector search / embedding ]    <- cheap, scans the whole index
     |  retrieves ~30 candidates (high recall, weak order)
     v
  [ c9 c3 c17 c1 c22 ... ]         <- right answer is here, but at pos. 9
     |
     v
  [ cross-encoder reranker ]        <- expensive, reads question+passage pairs
     |  reorders by real relevance
     v
  [ c9 c1 c3 ]                      <- top-N; the right answer rose to the top
     |
     v
  [ generation model ]              <- gets only the right, lean context

  retrieving 3 and reranking 3 = useless: if the answer is at pos. 9,
  it never enters the sieve. Retrieving wide is what feeds the reranker.`,
        },
        {
          type: 'paragraph',
          value:
            'There are two numbers to calibrate. The first is how many candidates the vector search retrieves before reranking: wide enough to contain the right answer comfortably, without becoming a set so large it makes the reranking step expensive. The second is how many passages, after being reordered, go to the model: lean enough not to dilute the context or waste window. Reranking lets you be generous in retrieval and thrifty in delivery, because the reordering guarantees that the few that remain are the best ones, not just the first the vector returned.',
        },
      ],
    },
    {
      title: 'The real cost: latency and price reranking adds',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking is not free. Each reranked candidate is a pass through a model, so reordering 30 candidates is 30 inferences that did not exist before, whether in local GPU time or in calls to a reranking API. This adds latency between the vector search and the generation, and adds cost per query. The math is direct: the wider the retrieved set, the higher the chance the right answer is inside, but the higher the reranking bill and time. The engineering work is finding the point where widening the set further no longer improves the answer, only makes it more expensive.',
        },
        {
          type: 'list',
          items: [
            'Latency: reranking enters the critical path between retrieving and generating; a slow reranker can cost more time than the generation itself. Measure the increase, do not assume it is negligible.',
            'Cost per query: reranking N candidates is N extra inferences; in a high-volume system this can exceed the cost of the generation call itself.',
            'Diminishing returns: doubling the number of retrieved candidates rarely doubles quality; there is a plateau beyond which you only pay more without gaining recall.',
            'Local reranker versus API: running locally trades per-call cost for infrastructure and engineering cost; the API is simpler but charges per reranked passage.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The way to tame the cost is not to rerank when you do not need to. If the vector search already returns a first candidate with a very high similarity score, clearly detached from the rest, the triage probably got it right and reranking will only confirm. Reserving the cross-encoder for the ambiguous queries, those where the candidates have similar scores and the order is genuinely uncertain, cuts a good part of the bill without losing the gain where it matters. Reranking is an expensive second look; applying it indiscriminately wastes what is best about it.',
        },
      ],
    },
    {
      title: 'Measuring whether reranking is paying off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking touches the order, so the metrics that matter are the ones that see order, not just presence. Recall@k asks whether the right passage is among the k retrieved, and reranking does not change that: the same set goes in and out, only reordered. What reranking improves are the position-sensitive metrics, which penalize the right answer for being down at the bottom. The evaluation needs to isolate the layer: fixing chunking, embedding and search, you turn the reranker on and off and measure whether the position of the right passage improved. That way you separate reranking gain from any other change in the pipeline.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it reveals', 'Effect of reranking'],
          rows: [
            [
              'Recall@k',
              'Whether the right passage entered the k retrieved',
              'Does not change: depends on search, not order',
            ],
            [
              'MRR',
              'How close to the top the first right passage is',
              'Rises when the reranker pulls the answer up',
            ],
            [
              'nDCG@k',
              'Quality of the whole order, weighted by position',
              'Rises when relevant ones land before noisy ones',
            ],
            [
              'p95 latency',
              'Extra time reranking adds',
              'Rises: the price to weigh against the order gain',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical question is: does reranking raise the position metrics enough to justify the latency and cost it adds? If MRR and nDCG barely move, the embedding was already ordering well and the reranker is dead weight. If they jump, reranking is fishing back answers the pipeline was discarding for being outside the top. Measuring both sides, order gain against latency cost, is what turns "I added a reranker" into an engineering decision instead of a checklist item.',
        },
      ],
    },
    {
      title: 'When reranking pays off and when it is not worth it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reranking is not a universal gain; it pays off in specific situations. Where the corpus is large and full of similar passages, the embedding brings many plausible candidates and the order gets bad, exactly the cross-encoder terrain. Where the question is subtle, with a condition or negation that changes the answer, the bi-encoder tends to ignore the detail and the reranker, which reads question and passage together, captures it. But where the corpus is small and homogeneous, or where the vector search already returns the right passage first by a comfortable margin, reranking costs latency and money to confirm an order that was already right.',
        },
        {
          type: 'ordered',
          items: [
            'Before adding reranking, confirm the recall: if the right passage does not even enter the candidates, the problem is chunking or embedding, and the reranker has nothing to reorder.',
            'Retrieve wide enough for the right answer to fit the sieve; retrieving narrow and reranking narrow does not fix the order, it only confirms it.',
            'Start with a ready-made reranker (API or local model) before thinking about training; the engineering decision is how many candidates go in and how many come out.',
            'Measure position, not just presence: MRR and nDCG tell whether the answer rose to the top; recall alone does not see the reranking gain.',
            'Weigh the order gain against p95 latency and cost per query; reserve reranking for the ambiguous queries if volume tightens the bill.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Reranking is one of the cheapest levers of RAG quality precisely because it does not require swapping the generation model or reindexing the corpus: you keep the embedding and the base as they are and insert a reordering step between the search and the context assembly. When the symptom is "the information was there, but the answer came out wrong", the culprit is almost always the order, and the order is what reranking fixes. It is the second look that finally makes the right passage, which had already been retrieved, reach the model at the top.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the difference between embedding search and reranking?',
      answer:
        'Embedding search uses a bi-encoder: question and passage are turned into vectors separately, without looking at each other, and the search compares distances between those vectors. It is fast because the passage vectors are precomputed, so it can scan millions of passages, but it compresses the meaning and gets the fine order wrong. Reranking uses a cross-encoder: it takes question and passage together in the same input and produces a score of how well that passage answers that specific question. It reads the interaction between the two, which the embedding does not, but it is slow because it requires one inference per pair. That is why the embedding does the wide, cheap triage, and reranking precisely reorders the few candidates that remain.',
    },
    {
      question: 'Does reranking improve my RAG recall?',
      answer:
        'No. Reranking does not change which passages were retrieved, it only reorders the ones the vector search already brought. The same set goes in and out, just in a different order. If the right passage was not among the retrieved candidates, reranking cannot fish it back, and the problem is earlier, in the chunking or the embedding. What reranking improves is the position: it takes the right answer that was retrieved but at ninth place and pulls it to the top, where the model context is assembled. That is why the metrics that show the gain are the order ones, like MRR and nDCG, and not recall, which stays the same with or without a reranker.',
    },
    {
      question: 'Is the cost and latency of reranking worth it?',
      answer:
        'It depends on how bad the order was. Each reranked candidate is an extra inference, so reranking adds latency in the critical path and cost per query. It is worth it when the corpus is large and full of similar passages, or when the questions have conditions and negations the embedding ignores, situations where the right answer tends to arrive retrieved but outside the top. It is not worth it when the corpus is small and homogeneous or when the search already delivers the right passage first by a comfortable margin: in those cases the reranker only confirms an order that was already good, paying latency for nothing. The way to decide is to measure: if MRR and nDCG jump when you turn reranking on, the gain justifies the cost; if they barely move, the embedding was already ordering well.',
    },
  ],
  conclusion: {
    title: 'Reranking is the second look that puts the right answer at the top',
    description:
      'RAG quality does not depend only on retrieving the right passage, but on delivering it to the model in the right order. Retrieving wide with the embedding, reordering with a cross-encoder and delivering narrow puts the answer that was already retrieved at the top of the context, without swapping the generation model or reindexing the corpus. I can design that reranking layer in your AI system, calibrating how many candidates go in, how many go to the model and measuring the order gain against latency, so retrieval delivers the whole right answer and up front.',
    cta: 'Talk about reranking and RAG in my AI system',
  },
  related: [
    { label: 'Document chunking for RAG without losing context', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'RAG for WhatsApp support: production design with fewer hallucinations', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-reranking-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Después de cortar el documento bien y elegir un buen modelo de embedding, mucha gente considera el retrieval resuelto: la búsqueda vectorial devuelve los vecinos más cercanos y listo. Pero hay una etapa entre "recuperar candidatos" y "armar el contexto" que casi todo pipeline saltea y que decide si la respuesta correcta llega al modelo: la reordenación de los candidatos por relevancia real. La búsqueda por similitud de embedding es rápida y buena para barrer millones de fragmentos, pero compara vectores comprimidos, no la pregunta contra el texto. El resultado es que el fragmento que responde exactamente a la pregunta muchas veces está entre los recuperados, solo que en la séptima o décima posición, y vos cortás el contexto en los tres primeros. El reranking existe para corregir esto: recuperar un conjunto amplio y barato, y luego reordenar con un modelo que de hecho lee pregunta y fragmento juntos, poniendo la respuesta correcta en la cima. Este artículo muestra por qué el embedding equivoca el orden, qué es un cross-encoder y en qué se diferencia del bi-encoder, el patrón recuperar-amplio-reranquear-estrecho, el costo y la latencia que el reranking agrega y cómo medir si está valiendo la pena, todo sin cambiar el modelo de generación.',
  sections: [
    {
      title: 'Por qué la búsqueda por embedding equivoca el orden de los fragmentos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La búsqueda vectorial funciona así: en el momento de la ingesta, cada fragmento se transforma en un vector por un modelo de embedding; en el momento de la consulta, la pregunta se vuelve otro vector y buscás los fragmentos cuyo vector está más cerca. Esto se llama bi-encoder, porque pregunta y fragmento se codifican por separado, cada uno sin ver al otro. Es extremadamente rápido, porque los vectores de los fragmentos están precalculados y la búsqueda es solo una comparación de distancia. El problema es justamente ese: pregunta y fragmento nunca se miran. El embedding comprime todo el significado de un párrafo en un único vector de algunas centenas de dimensiones, y en esa compresión los detalles se pierden. Dos fragmentos que hablan del mismo asunto general quedan cerca de la pregunta, aunque solo uno responda de hecho a la pregunta específica.',
        },
        {
          type: 'paragraph',
          value:
            'El síntoma clásico es el fragmento correcto apareciendo entre los recuperados, pero fuera de la cima. Pedís los 20 vecinos más cercanos y la respuesta exacta está en la posición 9. Si el pipeline arma el contexto con los 3 o 5 primeros, la respuesta correcta fue recuperada y luego descartada, y el modelo responde a partir de fragmentos que solo rozan la pregunta. No es falla del embedding en recuperar, es falla en ordenar. Recall alto y orden malo es exactamente el escenario en el que el reranking más rinde: la información está ahí, solo está en la posición equivocada.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Bi-encoder (embedding)', 'Cross-encoder (reranker)'],
          rows: [
            [
              'Cómo compara',
              'Vector de la pregunta contra vector del fragmento',
              'Lee pregunta y fragmento juntos, par a par',
            ],
            [
              'Velocidad',
              'Muy rápida, vectores precalculados',
              'Lenta, un forward por par pregunta-fragmento',
            ],
            [
              'Escala',
              'Millones de fragmentos por consulta',
              'Decenas de candidatos por consulta',
            ],
            [
              'Precisión del orden',
              'Buena para triaje, débil en la cima',
              'Alta, entiende la pregunta específica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lección es que embedding y reranking no compiten, se complementan. El embedding es el triaje barato que barre todo y trae los candidatos plausibles; el reranking es la segunda mirada cara que lee con atención y decide el orden final. Usar solo el primero es rápido e impreciso en la cima; el resto del artículo es sobre cómo encajar el segundo sin reventar latencia ni costo.',
        },
      ],
    },
    {
      title: 'Cross-encoder: el modelo que lee pregunta y fragmento juntos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reranker es típicamente un cross-encoder: en vez de codificar pregunta y fragmento por separado, recibe los dos concatenados en la misma entrada y produce un único número, la puntuación de relevancia de ese par. Porque la pregunta y el fragmento pasan juntos por el modelo, logra capturar la interacción entre ellos, qué palabras de la pregunta son de hecho respondidas por el fragmento, y no solo si los dos hablan del mismo tema. Es esa lectura conjunta la que el bi-encoder no hace y la que corrige el orden. El precio es que no se puede precalcular nada: cada par pregunta-fragmento exige una pasada por el modelo en el momento de la consulta. Por eso el cross-encoder es demasiado preciso para escanear el índice entero y bastante barato para reordenar algunas decenas de candidatos.',
        },
        {
          type: 'code',
          value: `// rerank/crossEncoder.js
// Reranking con cross-encoder: recibe la pregunta y la lista de candidatos
// que viene de la busqueda vectorial, puntua cada par pregunta-fragmento y
// devuelve los candidatos reordenados del mas relevante al menos relevante.

export async function rerank(query, candidates, { scoreFn, topN = 5 } = {}) {
  // Un forward del modelo por par (pregunta, fragmento). Cuesta mas que la
  // busqueda vectorial, por eso corre solo sobre los candidatos, no el indice.
  const scored = await Promise.all(
    candidates.map(async (c) => ({
      ...c,
      // scoreFn compara pregunta y fragmento JUNTOS: que tan bien este
      // fragmento responde ESTA pregunta, no solo si hablan del mismo asunto.
      score: await scoreFn(query, c.text),
    })),
  );

  // Reordena por relevancia real y corta en el topN que va al modelo.
  // El embedding hizo el triaje; el cross-encoder decide el orden final.
  return scored.sort((a, b) => b.score - a.score).slice(0, topN);
}`,
        },
        {
          type: 'paragraph',
          value:
            'No necesitás entrenar un cross-encoder para empezar: hay modelos de reranking listos, servidos por API o corriendo local, que reciben una pregunta y una lista de fragmentos y devuelven las puntuaciones. La decisión de ingeniería no es qué arquitectura implementar desde cero, es cuántos candidatos mandar al reranker y cuántos entregar al modelo después. Ese es el corazón del patrón que viene a continuación: recuperar amplio con el embedding, reranquear estrecho con el cross-encoder.',
        },
      ],
    },
    {
      title: 'El patrón: recuperar amplio, reranquear, entregar estrecho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reranking solo ayuda si la respuesta correcta está entre los candidatos recuperados. Por eso la búsqueda vectorial al frente debe pescar un conjunto amplio, mucho mayor que el que va al modelo. Recuperar solo los 3 más cercanos por el embedding y reranquear esos 3 no sirve de nada: si la respuesta estaba en la posición 9, ni entró en el tamiz. El patrón correcto es recuperar ancho (decenas de candidatos), reranquear todo eso con el cross-encoder y solo entonces cortar en los pocos mejores que caben en la ventana del modelo. El embedding maximiza recall barato; el reranker maximiza precisión en la cima.',
        },
        {
          type: 'diagram',
          value: `Recuperar amplio -> reranquear -> entregar estrecho

  pregunta
     |
     v
  [ busqueda vectorial / embedding ]  <- barato, barre el indice entero
     |  recupera ~30 candidatos (recall alto, orden debil)
     v
  [ c9 c3 c17 c1 c22 ... ]         <- la respuesta correcta esta aqui, en pos. 9
     |
     v
  [ cross-encoder reranker ]        <- caro, lee pregunta+fragmento par a par
     |  reordena por relevancia real
     v
  [ c9 c1 c3 ]                      <- top-N; la respuesta correcta subio a la cima
     |
     v
  [ modelo de generacion ]          <- recibe solo el contexto correcto y magro

  recuperar 3 y reranquear 3 = inutil: si la respuesta esta en pos. 9,
  ni entra en el tamiz. Recuperar amplio es lo que le da material al reranker.`,
        },
        {
          type: 'paragraph',
          value:
            'Hay dos números para calibrar. El primero es cuántos candidatos recupera la búsqueda vectorial antes del reranking: amplio lo suficiente para contener la respuesta correcta con holgura, sin volverse un conjunto tan grande que encarezca la etapa de reranking. El segundo es cuántos fragmentos, después de reordenados, van al modelo: magro lo suficiente para no diluir el contexto ni gastar ventana al pedo. El reranking permite ser generoso en la recuperación y económico en la entrega, porque la reordenación garantiza que los pocos que quedan son los mejores, no solo los primeros que el vector devolvió.',
        },
      ],
    },
    {
      title: 'El costo real: latencia y precio que el reranking agrega',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reranking no es gratis. Cada candidato reranqueado es una pasada por un modelo, así que reordenar 30 candidatos son 30 inferencias que no existían antes, sea en tiempo de GPU local, sea en llamadas a una API de reranking. Eso suma latencia entre la búsqueda vectorial y la generación, y suma costo por consulta. La cuenta es directa: cuanto más amplio el conjunto recuperado, mayor la chance de que la respuesta correcta esté dentro, pero mayor la factura y el tiempo del reranking. El trabajo de ingeniería es hallar el punto en el que ampliar más el conjunto ya no mejora la respuesta, solo encarece.',
        },
        {
          type: 'list',
          items: [
            'Latencia: el reranking entra en el camino crítico entre buscar y generar; un reranker lento puede costar más tiempo que la propia generación. Medí el incremento, no asumas que es despreciable.',
            'Costo por consulta: reranquear N candidatos son N inferencias extra; en un sistema de alto volumen eso puede superar el costo de la propia llamada de generación.',
            'Retorno decreciente: doblar el número de candidatos recuperados raramente dobla la calidad; existe una meseta a partir de la cual solo pagás más sin ganar recall.',
            'Reranker local versus API: correr local cambia costo por llamada por costo de infraestructura e ingeniería; la API es más simple pero cobra por fragmento reranqueado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La forma de domar el costo es no reranquear cuando no hace falta. Si la búsqueda vectorial ya devuelve un primer candidato con puntuación de similitud muy alta y destacada de los demás, probablemente el triaje ya acertó y el reranking solo va a confirmar. Reservar el cross-encoder para las consultas ambiguas, aquellas en que los candidatos tienen puntuaciones parecidas y el orden está de hecho incierto, corta buena parte de la cuenta sin perder la ganancia donde importa. El reranking es una segunda mirada cara; aplicarlo indiscriminadamente desperdicia lo mejor que tiene.',
        },
      ],
    },
    {
      title: 'Medir si el reranking está valiendo la pena',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reranking toca el orden, así que las métricas que importan son las que ven orden, no solo presencia. Recall@k pregunta si el fragmento correcto está entre los k recuperados, y el reranking no cambia eso: el mismo conjunto entra y sale, solo reordenado. Lo que el reranking mejora son las métricas sensibles a la posición, que penalizan a la respuesta correcta por estar abajo. La evaluación necesita aislar la capa: fijando chunking, embedding y búsqueda, prendés y apagás el reranker y medís si la posición del fragmento correcto mejoró. Así separás ganancia de reranking de cualquier otro cambio en el pipeline.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué revela', 'Efecto del reranking'],
          rows: [
            [
              'Recall@k',
              'Si el fragmento correcto entró en los k recuperados',
              'No cambia: depende de la búsqueda, no del orden',
            ],
            [
              'MRR',
              'Qué tan cerca de la cima está el primer fragmento correcto',
              'Sube cuando el reranker tira la respuesta hacia arriba',
            ],
            [
              'nDCG@k',
              'Calidad del orden completo, con peso en la posición',
              'Sube cuando los relevantes quedan antes de los ruidosos',
            ],
            [
              'Latencia p95',
              'Tiempo extra que el reranking agrega',
              'Sube: es el precio a pesar contra la ganancia de orden',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La pregunta práctica es: ¿el reranking sube lo suficiente las métricas de posición para justificar la latencia y el costo que agrega? Si el MRR y el nDCG apenas se mueven, el embedding ya estaba ordenando bien y el reranker es peso muerto. Si saltan, el reranking está pescando de vuelta respuestas que el pipeline estaba descartando por estar fuera de la cima. Medir los dos lados, ganancia de orden contra costo de latencia, es lo que transforma "agregué un reranker" en una decisión de ingeniería en vez de un ítem de checklist.',
        },
      ],
    },
    {
      title: 'Cuándo el reranking rinde y cuándo no vale',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reranking no es ganancia universal; rinde en situaciones específicas. Donde el corpus es grande y lleno de fragmentos parecidos, el embedding trae muchos candidatos plausibles y el orden queda malo, exactamente el terreno del cross-encoder. Donde la pregunta es sutil, con una condición o negación que cambia la respuesta, el bi-encoder tiende a ignorar el detalle y el reranker, que lee pregunta y fragmento juntos, lo captura. En cambio donde el corpus es pequeño y homogéneo, o donde la búsqueda vectorial ya devuelve el fragmento correcto en primero con holgura, el reranking cuesta latencia y dinero para confirmar un orden que ya estaba correcto.',
        },
        {
          type: 'ordered',
          items: [
            'Antes de agregar reranking, confirmá el recall: si el fragmento correcto ni entra en los candidatos, el problema es chunking o embedding, y el reranker no tiene qué reordenar.',
            'Recuperá amplio lo suficiente para que la respuesta correcta quepa en el tamiz; recuperar estrecho y reranquear estrecho no resuelve el orden, solo lo confirma.',
            'Empezá con un reranker listo (API o modelo local) antes de pensar en entrenar; la decisión de ingeniería es cuántos candidatos entran y cuántos salen.',
            'Medí posición, no solo presencia: MRR y nDCG dicen si la respuesta subió a la cima; el recall solo no ve la ganancia del reranking.',
            'Pesá la ganancia de orden contra la latencia p95 y el costo por consulta; reservá el reranking para las consultas ambiguas si el volumen aprieta la cuenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El reranking es una de las palancas más baratas de calidad de RAG justamente porque no pide cambiar el modelo de generación ni reindexar el corpus: mantenés el embedding y la base como están e insertás una etapa de reordenación entre la búsqueda y el armado del contexto. Cuando el síntoma es "la información estaba ahí, pero la respuesta salió equivocada", casi siempre el culpable es el orden, y el orden es lo que el reranking arregla. Es la segunda mirada que hace que el fragmento correcto, que ya había sido recuperado, finalmente llegue al modelo en la cima.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es la diferencia entre la búsqueda por embedding y el reranking?',
      answer:
        'La búsqueda por embedding usa un bi-encoder: pregunta y fragmento se transforman en vectores por separado, sin mirarse, y la búsqueda compara distancias entre esos vectores. Es rápida porque los vectores de los fragmentos están precalculados, así que sirve para barrer millones de fragmentos, pero comprime el significado y equivoca el orden fino. El reranking usa un cross-encoder: recibe pregunta y fragmento juntos en la misma entrada y produce una puntuación de qué tan bien ese fragmento responde a esa pregunta específica. Lee la interacción entre los dos, lo que el embedding no hace, pero es lento porque exige una inferencia por par. Por eso el embedding hace el triaje amplio y barato, y el reranking reordena con precisión los pocos candidatos que quedaron.',
    },
    {
      question: '¿El reranking mejora el recall de mi RAG?',
      answer:
        'No. El reranking no cambia qué fragmentos fueron recuperados, solo reordena los que la búsqueda vectorial ya trajo. El mismo conjunto entra y sale, apenas en orden diferente. Si el fragmento correcto no estaba entre los candidatos recuperados, el reranking no tiene cómo pescarlo de vuelta, y el problema está antes, en el chunking o el embedding. Lo que el reranking mejora es la posición: toma la respuesta correcta que estaba recuperada pero en la novena posición y la tira a la cima, donde se arma el contexto del modelo. Por eso las métricas que muestran la ganancia son las de orden, como MRR y nDCG, y no el recall, que queda igual con o sin reranker.',
    },
    {
      question: '¿Vale la pena el costo y la latencia del reranking?',
      answer:
        'Depende de qué tan malo estaba el orden. Cada candidato reranqueado es una inferencia extra, así que el reranking suma latencia en el camino crítico y costo por consulta. Vale la pena cuando el corpus es grande y lleno de fragmentos parecidos, o cuando las preguntas tienen condiciones y negaciones que el embedding ignora, situaciones en que la respuesta correcta suele llegar recuperada pero fuera de la cima. No vale cuando el corpus es pequeño y homogéneo o cuando la búsqueda ya entrega el fragmento correcto en primero con holgura: en esos casos el reranker solo confirma un orden que ya estaba bueno, pagando latencia al pedo. La forma de decidir es medir: si MRR y nDCG saltan al prender el reranking, la ganancia justifica el costo; si apenas se mueven, el embedding ya ordenaba bien.',
    },
  ],
  conclusion: {
    title: 'El reranking es la segunda mirada que pone la respuesta correcta en la cima',
    description:
      'La calidad del RAG no depende solo de recuperar el fragmento correcto, sino de entregarlo al modelo en el orden correcto. Recuperar amplio con el embedding, reordenar con un cross-encoder y entregar estrecho pone la respuesta que ya estaba recuperada en la cima del contexto, sin cambiar el modelo de generación ni reindexar el corpus. Puedo diseñar esa capa de reranking en tu sistema de IA, calibrando cuántos candidatos entran, cuántos van al modelo y midiendo la ganancia de orden contra la latencia, para que el retrieval entregue la respuesta correcta entera y al frente.',
    cta: 'Hablar sobre reranking y RAG en mi sistema de IA',
  },
  related: [
    { label: 'Chunking de documento para RAG sin perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'RAG para atención en WhatsApp: diseño de producción con menos alucinaciones', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'rag-reranking-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
