// Conteudo do artigo: memoria de longo prazo para agentes de atendimento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Memória de longo prazo mínima para agente de atendimento: separa a janela de contexto da conversa atual da memória persistente por usuário, grava fatos duráveis com escopo e validade, recupera só o que é relevante para o turno via embedding e injeta um resumo enxuto no prompt, para o agente lembrar do cliente entre sessões sem estourar contexto nem carregar dado obsoleto.',
  en: 'Minimal long-term memory for a support agent: it separates the current conversation window from the per-user persistent memory, writes durable facts with scope and validity, retrieves only what is relevant to the turn via embedding and injects a lean summary into the prompt, so the agent remembers the customer across sessions without blowing the context or carrying stale data.',
  es: 'Memoria de largo plazo mínima para agente de atención: separa la ventana de contexto de la conversación actual de la memoria persistente por usuario, graba hechos durables con alcance y validez, recupera solo lo relevante para el turno vía embedding e inyecta un resumen breve en el prompt, para que el agente recuerde al cliente entre sesiones sin reventar el contexto ni cargar dato obsoleto.',
};

const repoUrl = 'https://github.com/joaosouz4dev/agent-memory-mini';

const pt = {
  intro:
    'O cliente já contou tudo três vezes. Na primeira sessão explicou que tem um plano empresarial e prefere ser chamado pelo primeiro nome; na segunda, teve que repetir; na terceira, desistiu e ligou. O problema não é o modelo, é que o agente não tem memória: cada conversa começa do zero, porque a janela de contexto é volátil e morre no fim da sessão. Memória de longo prazo é a camada que faz o agente lembrar do cliente entre sessões, mas ela não é simplesmente "guardar todo o histórico e mandar tudo de novo". Isso estoura a janela, custa uma fortuna em token e ainda enterra o fato relevante debaixo de mil mensagens irrelevantes. Memória bem feita é seletiva: grava só o que é durável, recupera só o que importa para o turno atual e injeta um resumo enxuto, não o transcript inteiro. Este artigo mostra como construir essa camada com a régua no lugar: a diferença entre janela de contexto e memória persistente, o que vale a pena lembrar e o que é ruído, como recuperar por relevância em vez de por recência e como manter a memória atualizada para não responder com um fato que já mudou.',
  sections: [
    {
      title: 'Janela de contexto não é memória',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusão mais comum é tratar a janela de contexto do modelo como se fosse memória. A janela é o que o modelo enxerga naquela chamada: o prompt, o histórico recente da conversa, as instruções. Ela é volátil (some quando a sessão acaba), limitada (tem um teto de tokens) e cara (cada token na janela é cobrado em toda chamada). Memória de longo prazo é o oposto em cada eixo: é persistente (sobrevive entre sessões), potencialmente ilimitada (mora num banco, não no prompt) e barata para guardar. O erro de arquitetura é tentar usar uma no lugar da outra: ou você empilha histórico na janela até estourar, ou finge que o modelo lembra de algo que nunca foi persistido.',
        },
        {
          type: 'paragraph',
          value:
            'A memória de longo prazo não substitui a janela, ela a alimenta. O fluxo é: a memória mora fora do modelo, e a cada turno você recupera dela um punhado de fatos relevantes e os injeta na janela como contexto. A tabela abaixo separa os dois papéis para deixar claro por que nenhum sozinho resolve.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'Janela de contexto', 'Memória de longo prazo'],
          rows: [
            [
              'Duração',
              'Volátil, morre na sessão',
              'Persistente, sobrevive entre sessões',
            ],
            [
              'Tamanho',
              'Limitada por teto de tokens',
              'Ilimitada (mora em banco)',
            ],
            [
              'Custo',
              'Cara: cobrada por chamada',
              'Barata para guardar, custa só o que recupera',
            ],
            [
              'Papel',
              'O que o modelo vê agora',
              'De onde vem o que ele precisa ver',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra que organiza tudo: a memória é a fonte, a janela é a vitrine. Você guarda muito e mostra pouco. Todo o resto do artigo é sobre como escolher o pouco certo a mostrar, porque despejar a memória inteira na janela é tão ruim quanto não ter memória nenhuma: um agente afogado em contexto irrelevante responde pior do que um agente enxuto e focado.',
        },
      ],
    },
    {
      title: 'O que lembrar e o que é ruído',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda mensagem merece virar memória. O instinto de gravar o transcript inteiro é o caminho mais curto para uma memória inútil: cheia, cara de recuperar e dominada por conversa fiada. A pergunta certa não é "o que o usuário disse?", é "o que sobre este usuário continua verdade na próxima sessão?". Um fato durável (o plano que ele contratou, a preferência de idioma, uma restrição que ele mencionou) vale ouro porque muda como você atende dali em diante. Uma troca de mensagens sobre um problema já resolvido é ruído: não precisa ser lembrada literalmente, no máximo como um resumo de uma linha.',
        },
        {
          type: 'list',
          items: [
            'Grave fatos, não frases: "usa o plano empresarial", "prefere português", "tem restrição a e-mail de marketing" são fatos duráveis; a mensagem literal que revelou isso é descartável.',
            'Separe o estável do efêmero: preferências, perfil e decisões passadas são estáveis; o humor da conversa de hoje e o assunto pontual já resolvido são efêmeros e não devem persistir.',
            'Não persista o que já é dado vivo: status de pedido, saldo e cotação não são memória, são consulta ao sistema de origem na hora; lembrar disso serve dado obsoleto.',
            'Resuma, não acumule: em vez de guardar as 40 mensagens de uma sessão, guarde o resumo do que ficou decidido; a memória cresce em conhecimento, não em volume.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A separação prática é entre memória de perfil (fatos duráveis sobre quem é o usuário e o que ele prefere) e memória de episódio (o que aconteceu numa sessão específica, guardado como resumo). A primeira é consultada quase sempre; a segunda, só quando o assunto reaparece. O que nunca deve virar memória é dado vivo: se a resposta depende do estado atual do sistema, ela vem de uma consulta, não da lembrança, senão o agente responde com um saldo de três semanas atrás com a confiança de quem acabou de checar.',
        },
      ],
    },
    {
      title: 'A anatomia de um fato de memória',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um fato de memória não é só um texto solto. Para ser recuperável, atualizável e confiável, ele precisa de estrutura: a quem pertence, de que tipo é, o conteúdo em si, quando foi gravado e até quando vale. Sem escopo por usuário, você vaza a memória de um cliente para outro. Sem tipo, não dá para recuperar por categoria nem para atualizar o fato certo. Sem validade, um fato que mudou fica servindo eternamente. O formato abaixo é o mínimo que sustenta uma memória de produção.',
        },
        {
          type: 'code',
          value: `// memory/record.js
// Um fato de memoria precisa de estrutura para ser recuperado e atualizado.
// Texto solto nao da para escopar por usuario nem para expirar.

export function makeMemory({ userId, kind, content, embedding, ttlDays }) {
  const now = Date.now();
  return {
    userId,                 // escopo: memoria e SEMPRE por usuario, nunca global
    kind,                   // 'perfil' | 'preferencia' | 'episodio' | 'decisao'
    content,                // o fato em uma frase, nao a mensagem literal
    embedding,              // vetor do content, para recuperar por relevancia
    createdAt: now,
    // Fato durável (preferencia) pode nao ter validade; episodio expira.
    expiresAt: ttlDays ? now + ttlDays * 86400000 : null,
  };
}

// Regra de ouro: content e um FATO ("usa plano empresarial"),
// nao um TRECHO de conversa ("entao eu queria saber se o meu plano...").`,
        },
        {
          type: 'paragraph',
          value:
            'Repare em três escolhas que salvam o sistema mais tarde. O userId torna a memória sempre escopada: nenhuma busca cruza a fronteira do usuário, o que fecha a porta mais óbvia de vazamento de dado pessoal. O kind permite recuperar por categoria (só as preferências, por exemplo) e atualizar o fato certo em vez de duplicar. E o expiresAt distingue o durável do efêmero: uma preferência não expira, mas o resumo de um episódio pode ter validade, para a memória não inchar com sessões antigas que ninguém vai reabrir. Guardar o content como fato, e não como trecho de conversa, é o que faz a recuperação funcionar: um fato curto e denso casa melhor com a pergunta do que um parágrafo de bate-papo.',
        },
      ],
    },
    {
      title: 'Recuperar por relevância, não por recência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a memória cheia, a pergunta vira: o que dela injetar na janela deste turno? A resposta ingênua é "as últimas N lembranças", mas recência é o critério errado. O fato mais útil para a pergunta de agora pode ter sido gravado há meses (o plano que o cliente contratou), enquanto as lembranças recentes podem ser sobre um assunto que não tem nada a ver. O critério certo é relevância: transforme o turno atual em embedding, busque na memória do usuário os fatos mais próximos e injete só esses. É o mesmo mecanismo de um RAG, mas aplicado à memória de um único usuário em vez de a uma base de documentos.',
        },
        {
          type: 'diagram',
          value: `Recuperacao de memoria por turno

  mensagem do usuario (turno atual)
        |
        v
  gera embedding do turno
        |
        v
  busca na memoria DESTE usuario (userId fixo)
     os fatos mais relevantes (top-k)
        |
        v
  monta um resumo enxuto (nao o transcript)
        |
        v
  injeta o resumo no prompt + historico recente
        |
        v
  modelo responde JA sabendo quem e o cliente

  regra: escopo por usuario + top-k por relevancia + resumo curto
  errado: despejar toda a memoria OU so as lembrancas recentes`,
        },
        {
          type: 'code',
          value: `// memory/recall.js
// Recupera da memoria SO o que e relevante para o turno atual.
// Escopo por usuario e top-k por similaridade, nunca "tudo" nem "os ultimos".

export async function recall({ embed, store, userId, turn, k = 5 }) {
  const query = await embed(turn);

  // Busca restrita ao usuario: memoria NUNCA cruza a fronteira do userId.
  const hits = await store.nearest({ userId, query, k });

  // Injeta um resumo enxuto, nao o conteudo bruto de cada fato.
  // Menos token na janela, foco no que importa para a pergunta.
  const summary = hits
    .filter((h) => !isExpired(h))
    .map((h) => \`- \${h.content}\`)
    .join('\\n');

  return summary; // vai para o prompt como contexto do usuario
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes fazem a diferença entre uma recuperação que ajuda e uma que atrapalha. O primeiro é o top-k pequeno: recuperar cinco fatos densos e certeiros é melhor do que despejar cinquenta, porque contexto irrelevante dilui a atenção do modelo tanto quanto a falta de contexto. O segundo é o resumo: você injeta o fato ("usa o plano empresarial"), não o parágrafo de onde ele saiu. Menos token, mais sinal. E a busca é sempre presa ao userId, porque memória que vaza entre usuários é o pior erro possível: servir a preferência ou o histórico de um cliente para outro é um incidente de privacidade, não um bug de qualidade.',
        },
      ],
    },
    {
      title: 'Atualizar e esquecer: memória que não mente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Memória que só cresce vira mentira com o tempo. O cliente que "usava o plano básico" migrou para o empresarial; o que "preferia ser contatado por e-mail" agora pediu WhatsApp; a restrição que ele tinha deixou de valer. Se a memória guarda o fato antigo lado a lado com o novo, a recuperação pode trazer o errado, e o agente atende com uma verdade vencida. Por isso memória de longo prazo precisa de duas operações que quase sempre ficam de fora: atualizar (substituir um fato quando ele muda) e esquecer (remover o que expirou ou o que o usuário pediu para apagar).',
        },
        {
          type: 'ordered',
          items: [
            'Atualize por fato, não por acúmulo: quando o usuário muda de plano, substitua o fato de plano; não guarde os dois e torça para o mais novo ganhar na recuperação.',
            'Dê validade ao que é temporário: episódios e resumos de sessão devem expirar; preferências duráveis vivem até serem contraditas, não para sempre por padrão.',
            'Respeite o pedido de esquecimento: um usuário pode pedir para apagar dados; a memória tem que ter delete por usuário, não só por conveniência mas por obrigação de privacidade.',
            'Detecte contradição na escrita: ao gravar um fato do mesmo kind, cheque se já existe um que ele contradiz e resolva na hora, em vez de deixar dois fatos rivais na base.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro clássico é montar a escrita e a recuperação, comemorar que o agente "lembra", e nunca implementar a atualização. O sistema começa impressionante e apodrece devagar: quanto mais o usuário interage, mais fatos vencidos se acumulam, e mais a recuperação erra ao trazer uma verdade antiga. Atualizar e esquecer são o que mantém a memória alinhada com a realidade do cliente. E o esquecimento não é só higiene técnica: é requisito de privacidade. Um usuário tem o direito de pedir que você apague o que sabe sobre ele, e a memória precisa ser construída assumindo esse pedido desde o primeiro dia.',
        },
      ],
    },
    {
      title: 'Onde a memória mora e como ela escala',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A escolha de armazenamento decide o custo e a latência da memória em produção. Como a recuperação é por similaridade, o coração é uma busca vetorial: os embeddings dos fatos precisam morar onde dá para achar os mais próximos rápido. Mas os fatos também têm metadados (userId, kind, validade) que você filtra antes ou durante a busca, então armazenamento puro de vetor sem filtro por usuário não basta. A combinação prática é um índice vetorial com filtro por userId, mais um armazenamento durável dos fatos com seus metadados.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Decisão', 'Por quê'],
          rows: [
            [
              'Índice de busca',
              'Vetorial com filtro por userId',
              'Recuperação é por relevância, sempre escopada ao usuário',
            ],
            [
              'Escopo da busca',
              'Sempre um userId por vez',
              'Memória nunca pode cruzar a fronteira entre clientes',
            ],
            [
              'Crescimento',
              'TTL nos episódios, resumo dos perfis',
              'Memória cresce em conhecimento, não em volume bruto',
            ],
            [
              'Latência',
              'Top-k pequeno, resumo curto',
              'Recuperar pouco e denso mantém a chamada rápida e barata',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O que mantém a memória barata e rápida em escala não é a tecnologia de banco, é a disciplina de gravar pouco e denso. Uma memória que guarda fatos resumidos, expira episódios e mantém só o perfil durável fica pequena e rápida mesmo com milhões de usuários, porque cada busca toca só a memória de um usuário e traz só um punhado de fatos. Uma memória que guarda transcript bruto de tudo cresce sem limite, encarece cada busca e ainda entrega contexto pior. A escala não é problema de infraestrutura, é consequência da política de escrita.',
        },
      ],
    },
    {
      title: 'Montar a camada sem virar risco novo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Memória de longo prazo transforma a experiência de atendimento: o agente deixa de tratar cada sessão como a primeira e passa a atender alguém que ele conhece. Mas ela introduz duas classes de risco que não existiam no agente sem memória: vazamento de dado entre usuários e resposta baseada em fato vencido. A ordem de implantação importa tanto quanto o código, e o caminho é construir a segurança antes da esperteza.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pelo escopo por usuário: antes de qualquer recuperação, garanta que toda busca é presa ao userId. Vazar memória entre clientes é incidente de privacidade, não bug de qualidade.',
            'Grave fato, não transcript: implemente a extração de fatos duráveis desde o início; memória cheia de conversa bruta é cara, lenta e ruim de recuperar.',
            'Recupere por relevância com top-k pequeno: injete poucos fatos densos, não a memória inteira nem só as lembranças recentes; contexto irrelevante piora a resposta.',
            'Adicione atualizar e esquecer antes de escalar: sem substituição de fato e sem delete por usuário, a memória apodrece e vira passivo de privacidade.',
            'Instrumente o que a memória injeta: logue quais fatos entraram no prompt (com redação de dado pessoal) para auditar quando o agente responder com base numa lembrança errada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre uma memória que encanta o cliente e uma que vira incidente está inteira no escopo e na política de escrita, não no modelo de embedding. O embedding é commodity; o escopo por usuário, a extração de fatos, a recuperação por relevância e as operações de atualizar e esquecer são o que transforma "guardar histórico" numa camada de produção confiável. Bem feita, a memória de longo prazo é uma das mudanças de maior impacto percebido num agente de atendimento: o cliente sente que está falando com alguém que se lembra dele, sem que o sistema pague isso em token, latência ou risco de privacidade.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Memória de longo prazo não é só mandar o histórico inteiro da conversa no prompt?',
      answer:
        'Não, e essa é a armadilha mais comum. Empilhar o histórico inteiro na janela de contexto estoura o teto de tokens, custa caro em toda chamada e ainda enterra o fato relevante debaixo de mensagens irrelevantes. Memória de longo prazo é o oposto: os fatos moram fora do modelo, num armazenamento persistente, e a cada turno você recupera só os poucos que importam para a pergunta atual e injeta um resumo enxuto. Você guarda muito e mostra pouco. A janela é a vitrine, a memória é a fonte; despejar a memória inteira na janela é tão ruim quanto não ter memória nenhuma.',
    },
    {
      question: 'Qual o maior risco da memória de longo prazo e como controlar?',
      answer:
        'São dois. O primeiro é o vazamento entre usuários: se a busca não for escopada por userId, o agente pode servir a preferência ou o histórico de um cliente para outro, o que é um incidente de privacidade, não um bug de qualidade. Controla-se prendendo toda recuperação ao userId, sem exceção. O segundo é a resposta com fato vencido: se a memória só cresce e nunca atualiza, ela guarda o plano antigo lado a lado com o novo e a recuperação traz o errado. Controla-se com atualização por fato (substituir quando muda), validade nos episódios e delete por usuário, que também atende ao direito de esquecimento.',
    },
    {
      question: 'Como decidir o que vira memória e o que é descartado?',
      answer:
        'A pergunta certa não é "o que o usuário disse?", é "o que sobre este usuário continua verdade na próxima sessão?". Fatos duráveis (plano contratado, preferência de idioma ou canal, restrições, decisões passadas) valem porque mudam como você atende dali em diante, e devem ser gravados como fato curto, não como a mensagem literal. Conversa fiada e assunto pontual já resolvido são ruído: no máximo viram um resumo de uma linha com validade. E dado vivo (status de pedido, saldo, cotação) nunca é memória: vem de consulta ao sistema na hora, senão o agente responde com um valor obsoleto com cara de recém-checado.',
    },
  ],
  conclusion: {
    title: 'Memória de longo prazo faz o agente lembrar do cliente sem estourar contexto',
    description:
      'Separar janela de contexto de memória persistente, gravar fato em vez de transcript, recuperar por relevância escopada ao usuário e manter a memória atualizada é o que transforma um agente amnésico num que conhece o cliente. Posso desenhar essa camada no seu agente de atendimento, do escopo por usuário à recuperação e ao esquecimento, com segurança de privacidade e sem inflar o custo de token.',
    cta: 'Falar sobre memória no meu agente de atendimento',
  },
  related: [
    { label: 'Orquestração de agentes de IA em produção', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Feature store para personalização de atendimento', to: '/blog/feature-store-personalizacao-atendimento' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-memory-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The customer has already explained everything three times. In the first session they said they have an enterprise plan and prefer to be called by their first name; in the second, they had to repeat it; in the third, they gave up and called. The problem is not the model, it is that the agent has no memory: every conversation starts from scratch, because the context window is volatile and dies at the end of the session. Long-term memory is the layer that makes the agent remember the customer across sessions, but it is not simply "store the whole history and send it all again". That blows the window, costs a fortune in tokens and buries the relevant fact under a thousand irrelevant messages. Good memory is selective: it stores only what is durable, retrieves only what matters to the current turn and injects a lean summary, not the whole transcript. This article shows how to build that layer with the ruler in the right place: the difference between context window and persistent memory, what is worth remembering and what is noise, how to retrieve by relevance instead of by recency and how to keep the memory up to date so it does not answer with a fact that already changed.',
  sections: [
    {
      title: 'A context window is not memory',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common confusion is treating the model context window as if it were memory. The window is what the model sees on that call: the prompt, the recent conversation history, the instructions. It is volatile (it disappears when the session ends), limited (it has a token ceiling) and expensive (every token in the window is billed on every call). Long-term memory is the opposite on every axis: it is persistent (it survives across sessions), potentially unlimited (it lives in a store, not in the prompt) and cheap to keep. The architectural mistake is trying to use one in place of the other: either you stack history in the window until it overflows, or you pretend the model remembers something that was never persisted.',
        },
        {
          type: 'paragraph',
          value:
            'Long-term memory does not replace the window, it feeds it. The flow is: memory lives outside the model, and on every turn you retrieve a handful of relevant facts from it and inject them into the window as context. The table below separates the two roles to make clear why neither one alone solves it.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Context window', 'Long-term memory'],
          rows: [
            [
              'Duration',
              'Volatile, dies with the session',
              'Persistent, survives across sessions',
            ],
            [
              'Size',
              'Limited by a token ceiling',
              'Unlimited (lives in a store)',
            ],
            [
              'Cost',
              'Expensive: billed per call',
              'Cheap to keep, costs only what it retrieves',
            ],
            [
              'Role',
              'What the model sees now',
              'Where what it needs to see comes from',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rule that organizes everything: memory is the source, the window is the display. You keep a lot and show a little. The rest of the article is about how to choose the right little to show, because dumping the whole memory into the window is as bad as having no memory at all: an agent drowning in irrelevant context answers worse than a lean, focused one.',
        },
      ],
    },
    {
      title: 'What to remember and what is noise',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every message deserves to become memory. The instinct to store the whole transcript is the shortest path to a useless memory: full, expensive to retrieve and dominated by small talk. The right question is not "what did the user say?", it is "what about this user stays true in the next session?". A durable fact (the plan they subscribed to, the language preference, a constraint they mentioned) is worth gold because it changes how you serve them from then on. An exchange about an already-solved problem is noise: it does not need to be remembered literally, at most as a one-line summary.',
        },
        {
          type: 'list',
          items: [
            'Store facts, not sentences: "uses the enterprise plan", "prefers English", "opted out of marketing email" are durable facts; the literal message that revealed it is disposable.',
            'Separate the stable from the ephemeral: preferences, profile and past decisions are stable; the mood of today conversation and the one-off topic already solved are ephemeral and should not persist.',
            'Do not persist what is already live data: order status, balance and quote are not memory, they are a query to the source system at the moment; remembering them serves stale data.',
            'Summarize, do not accumulate: instead of keeping the 40 messages of a session, keep the summary of what was decided; memory grows in knowledge, not in volume.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical split is between profile memory (durable facts about who the user is and what they prefer) and episodic memory (what happened in a specific session, stored as a summary). The first is consulted almost always; the second, only when the topic reappears. What should never become memory is live data: if the answer depends on the current state of the system, it comes from a query, not from recollection, otherwise the agent answers with a three-week-old balance with the confidence of someone who just checked.',
        },
      ],
    },
    {
      title: 'The anatomy of a memory fact',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A memory fact is not just loose text. To be retrievable, updatable and reliable, it needs structure: who it belongs to, what type it is, the content itself, when it was written and until when it holds. Without a per-user scope, you leak one customer memory to another. Without a type, you cannot retrieve by category nor update the right fact. Without validity, a fact that changed keeps serving forever. The format below is the minimum that sustains a production memory.',
        },
        {
          type: 'code',
          value: `// memory/record.js
// A memory fact needs structure to be retrieved and updated.
// Loose text cannot be scoped per user nor expired.

export function makeMemory({ userId, kind, content, embedding, ttlDays }) {
  const now = Date.now();
  return {
    userId,                 // scope: memory is ALWAYS per user, never global
    kind,                   // 'profile' | 'preference' | 'episode' | 'decision'
    content,                // the fact in one sentence, not the literal message
    embedding,              // vector of the content, to retrieve by relevance
    createdAt: now,
    // Durable fact (preference) may have no validity; an episode expires.
    expiresAt: ttlDays ? now + ttlDays * 86400000 : null,
  };
}

// Golden rule: content is a FACT ("uses the enterprise plan"),
// not a SNIPPET of conversation ("so I wanted to know if my plan...").`,
        },
        {
          type: 'paragraph',
          value:
            'Note three choices that save the system later. The userId makes memory always scoped: no search crosses the user boundary, which closes the most obvious door to personal-data leakage. The kind lets you retrieve by category (only the preferences, for example) and update the right fact instead of duplicating. And the expiresAt distinguishes the durable from the ephemeral: a preference does not expire, but the summary of an episode can have validity, so the memory does not swell with old sessions no one will reopen. Storing the content as a fact, and not as a conversation snippet, is what makes retrieval work: a short, dense fact matches the question better than a paragraph of chatter.',
        },
      ],
    },
    {
      title: 'Retrieve by relevance, not by recency',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the memory full, the question becomes: what of it to inject into this turn window? The naive answer is "the last N memories", but recency is the wrong criterion. The most useful fact for the current question may have been stored months ago (the plan the customer subscribed to), while the recent memories may be about a topic that has nothing to do with it. The right criterion is relevance: turn the current turn into an embedding, search the user memory for the closest facts and inject only those. It is the same mechanism as a RAG, but applied to a single user memory instead of to a document base.',
        },
        {
          type: 'diagram',
          value: `Per-turn memory retrieval

  user message (current turn)
        |
        v
  generate turn embedding
        |
        v
  search THIS user memory (fixed userId)
     for the most relevant facts (top-k)
        |
        v
  build a lean summary (not the transcript)
        |
        v
  inject the summary into the prompt + recent history
        |
        v
  model answers ALREADY knowing who the customer is

  rule: per-user scope + top-k by relevance + short summary
  wrong: dump all the memory OR only the recent memories`,
        },
        {
          type: 'code',
          value: `// memory/recall.js
// Retrieves from memory ONLY what is relevant to the current turn.
// Per-user scope and top-k by similarity, never "everything" nor "the latest".

export async function recall({ embed, store, userId, turn, k = 5 }) {
  const query = await embed(turn);

  // Search restricted to the user: memory NEVER crosses the userId boundary.
  const hits = await store.nearest({ userId, query, k });

  // Inject a lean summary, not the raw content of each fact.
  // Fewer tokens in the window, focus on what matters to the question.
  const summary = hits
    .filter((h) => !isExpired(h))
    .map((h) => \`- \${h.content}\`)
    .join('\\n');

  return summary; // goes into the prompt as the user context
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details make the difference between a retrieval that helps and one that hurts. The first is the small top-k: retrieving five dense, precise facts is better than dumping fifty, because irrelevant context dilutes the model attention as much as the lack of context. The second is the summary: you inject the fact ("uses the enterprise plan"), not the paragraph it came from. Fewer tokens, more signal. And the search is always bound to the userId, because memory that leaks between users is the worst possible error: serving one customer preference or history to another is a privacy incident, not a quality bug.',
        },
      ],
    },
    {
      title: 'Update and forget: memory that does not lie',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Memory that only grows becomes a lie over time. The customer who "used the basic plan" migrated to enterprise; the one who "preferred to be contacted by email" now asked for WhatsApp; the constraint they had no longer holds. If the memory keeps the old fact side by side with the new one, retrieval may bring the wrong one, and the agent serves with an expired truth. That is why long-term memory needs two operations that are almost always left out: update (replace a fact when it changes) and forget (remove what expired or what the user asked to erase).',
        },
        {
          type: 'ordered',
          items: [
            'Update by fact, not by accumulation: when the user changes plan, replace the plan fact; do not keep both and hope the newest wins on retrieval.',
            'Give validity to what is temporary: episodes and session summaries should expire; durable preferences live until contradicted, not forever by default.',
            'Respect the request to be forgotten: a user can ask to erase data; memory must have per-user delete, not only for convenience but as a privacy obligation.',
            'Detect contradiction on write: when storing a fact of the same kind, check whether one it contradicts already exists and resolve it right away, instead of leaving two rival facts in the base.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The classic mistake is to build the write and the retrieval, celebrate that the agent "remembers", and never implement the update. The system starts impressive and rots slowly: the more the user interacts, the more expired facts accumulate, and the more retrieval errs by bringing an old truth. Update and forget are what keep the memory aligned with the customer reality. And forgetting is not only technical hygiene: it is a privacy requirement. A user has the right to ask you to erase what you know about them, and the memory must be built assuming that request from day one.',
        },
      ],
    },
    {
      title: 'Where memory lives and how it scales',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The storage choice decides the cost and latency of memory in production. Since retrieval is by similarity, the heart is a vector search: the embeddings of the facts need to live where you can find the closest ones fast. But the facts also have metadata (userId, kind, validity) that you filter before or during the search, so pure vector storage without a per-user filter is not enough. The practical combination is a vector index with a userId filter, plus a durable store of the facts with their metadata.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Decision', 'Why'],
          rows: [
            [
              'Search index',
              'Vector with userId filter',
              'Retrieval is by relevance, always scoped to the user',
            ],
            [
              'Search scope',
              'Always one userId at a time',
              'Memory can never cross the boundary between customers',
            ],
            [
              'Growth',
              'TTL on episodes, summary on profiles',
              'Memory grows in knowledge, not in raw volume',
            ],
            [
              'Latency',
              'Small top-k, short summary',
              'Retrieving little and dense keeps the call fast and cheap',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'What keeps memory cheap and fast at scale is not the database technology, it is the discipline of writing little and dense. A memory that stores summarized facts, expires episodes and keeps only the durable profile stays small and fast even with millions of users, because each search touches only one user memory and brings back only a handful of facts. A memory that stores the raw transcript of everything grows without limit, makes each search more expensive and still delivers worse context. Scale is not an infrastructure problem, it is a consequence of the write policy.',
        },
      ],
    },
    {
      title: 'Building the layer without becoming a new risk',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Long-term memory transforms the support experience: the agent stops treating every session as the first and starts serving someone it knows. But it introduces two classes of risk that did not exist in the memoryless agent: data leakage between users and an answer based on an expired fact. The rollout order matters as much as the code, and the path is to build the safety before the cleverness.',
        },
        {
          type: 'ordered',
          items: [
            'Start with the per-user scope: before any retrieval, ensure every search is bound to the userId. Leaking memory between customers is a privacy incident, not a quality bug.',
            'Store facts, not transcript: implement durable-fact extraction from the start; a memory full of raw conversation is expensive, slow and bad to retrieve.',
            'Retrieve by relevance with a small top-k: inject a few dense facts, not the whole memory nor only the recent ones; irrelevant context worsens the answer.',
            'Add update and forget before scaling: without fact replacement and per-user delete, the memory rots and becomes a privacy liability.',
            'Instrument what the memory injects: log which facts entered the prompt (with personal-data redaction) to audit when the agent answers based on a wrong recollection.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between a memory that delights the customer and one that becomes an incident lives entirely in the scope and the write policy, not in the embedding model. The embedding is a commodity; the per-user scope, the fact extraction, the retrieval by relevance and the update-and-forget operations are what turn "storing history" into a reliable production layer. Done right, long-term memory is one of the highest perceived-impact changes in a support agent: the customer feels they are talking to someone who remembers them, without the system paying for it in tokens, latency or privacy risk.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is long-term memory just sending the whole conversation history in the prompt?',
      answer:
        'No, and that is the most common trap. Stacking the whole history in the context window blows the token ceiling, costs a lot on every call and still buries the relevant fact under irrelevant messages. Long-term memory is the opposite: the facts live outside the model, in a persistent store, and on every turn you retrieve only the few that matter to the current question and inject a lean summary. You keep a lot and show a little. The window is the display, memory is the source; dumping the whole memory into the window is as bad as having no memory at all.',
    },
    {
      question: 'What is the biggest risk of long-term memory and how do you control it?',
      answer:
        'There are two. The first is leakage between users: if the search is not scoped by userId, the agent may serve one customer preference or history to another, which is a privacy incident, not a quality bug. You control it by binding every retrieval to the userId, without exception. The second is answering with an expired fact: if the memory only grows and never updates, it keeps the old plan side by side with the new one and retrieval brings the wrong one. You control it with update by fact (replace when it changes), validity on episodes and per-user delete, which also honors the right to be forgotten.',
    },
    {
      question: 'How do you decide what becomes memory and what is discarded?',
      answer:
        'The right question is not "what did the user say?", it is "what about this user stays true in the next session?". Durable facts (subscribed plan, language or channel preference, constraints, past decisions) matter because they change how you serve them from then on, and should be stored as a short fact, not as the literal message. Small talk and an already-solved one-off topic are noise: at most they become a one-line summary with validity. And live data (order status, balance, quote) is never memory: it comes from a query to the system at the moment, otherwise the agent answers with a stale value looking freshly checked.',
    },
  ],
  conclusion: {
    title: 'Long-term memory makes the agent remember the customer without blowing the context',
    description:
      'Separating context window from persistent memory, storing facts instead of transcript, retrieving by relevance scoped to the user and keeping the memory up to date is what turns an amnesiac agent into one that knows the customer. I can design that layer in your support agent, from the per-user scope to retrieval and forgetting, with privacy safety and without inflating the token cost.',
    cta: 'Talk about memory in my support agent',
  },
  related: [
    { label: 'Orchestrating AI agents in production', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Feature store for support personalization', to: '/blog/feature-store-personalizacao-atendimento' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-memory-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El cliente ya contó todo tres veces. En la primera sesión explicó que tiene un plan empresarial y prefiere que lo llamen por el nombre; en la segunda, tuvo que repetirlo; en la tercera, se rindió y llamó. El problema no es el modelo, es que el agente no tiene memoria: cada conversación empieza de cero, porque la ventana de contexto es volátil y muere al final de la sesión. La memoria de largo plazo es la capa que hace que el agente recuerde al cliente entre sesiones, pero no es simplemente "guardar todo el historial y mandarlo todo de nuevo". Eso revienta la ventana, cuesta una fortuna en token y encima entierra el hecho relevante debajo de mil mensajes irrelevantes. La memoria bien hecha es selectiva: guarda solo lo que es durable, recupera solo lo que importa para el turno actual e inyecta un resumen breve, no el transcript entero. Este artículo muestra cómo construir esa capa con la regla en el lugar correcto: la diferencia entre ventana de contexto y memoria persistente, qué vale la pena recordar y qué es ruido, cómo recuperar por relevancia en vez de por recencia y cómo mantener la memoria actualizada para no responder con un hecho que ya cambió.',
  sections: [
    {
      title: 'La ventana de contexto no es memoria',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusión más común es tratar la ventana de contexto del modelo como si fuera memoria. La ventana es lo que el modelo ve en esa llamada: el prompt, el historial reciente de la conversación, las instrucciones. Es volátil (desaparece cuando la sesión termina), limitada (tiene un techo de tokens) y cara (cada token en la ventana se cobra en toda llamada). La memoria de largo plazo es lo opuesto en cada eje: es persistente (sobrevive entre sesiones), potencialmente ilimitada (vive en un almacén, no en el prompt) y barata de guardar. El error de arquitectura es intentar usar una en lugar de la otra: o apilás historial en la ventana hasta reventar, o finges que el modelo recuerda algo que nunca fue persistido.',
        },
        {
          type: 'paragraph',
          value:
            'La memoria de largo plazo no reemplaza la ventana, la alimenta. El flujo es: la memoria vive fuera del modelo, y en cada turno recuperás de ella un puñado de hechos relevantes y los inyectás en la ventana como contexto. La tabla de abajo separa los dos roles para dejar claro por qué ninguno solo lo resuelve.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'Ventana de contexto', 'Memoria de largo plazo'],
          rows: [
            [
              'Duración',
              'Volátil, muere en la sesión',
              'Persistente, sobrevive entre sesiones',
            ],
            [
              'Tamaño',
              'Limitada por techo de tokens',
              'Ilimitada (vive en un almacén)',
            ],
            [
              'Costo',
              'Cara: se cobra por llamada',
              'Barata de guardar, cuesta solo lo que recupera',
            ],
            [
              'Rol',
              'Lo que el modelo ve ahora',
              'De dónde viene lo que necesita ver',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla que organiza todo: la memoria es la fuente, la ventana es la vitrina. Guardás mucho y mostrás poco. Todo el resto del artículo es sobre cómo elegir el poco correcto a mostrar, porque volcar la memoria entera en la ventana es tan malo como no tener memoria: un agente ahogado en contexto irrelevante responde peor que uno breve y enfocado.',
        },
      ],
    },
    {
      title: 'Qué recordar y qué es ruido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todo mensaje merece volverse memoria. El instinto de guardar el transcript entero es el camino más corto a una memoria inútil: llena, cara de recuperar y dominada por charla. La pregunta correcta no es "¿qué dijo el usuario?", es "¿qué sobre este usuario sigue siendo verdad en la próxima sesión?". Un hecho durable (el plan que contrató, la preferencia de idioma, una restricción que mencionó) vale oro porque cambia cómo lo atendés de ahí en adelante. Un intercambio sobre un problema ya resuelto es ruido: no necesita recordarse literalmente, a lo sumo como un resumen de una línea.',
        },
        {
          type: 'list',
          items: [
            'Guarda hechos, no frases: "usa el plan empresarial", "prefiere español", "tiene restricción a email de marketing" son hechos durables; el mensaje literal que lo reveló es descartable.',
            'Separa lo estable de lo efímero: preferencias, perfil y decisiones pasadas son estables; el humor de la conversación de hoy y el tema puntual ya resuelto son efímeros y no deben persistir.',
            'No persistas lo que ya es dato vivo: estado de pedido, saldo y cotización no son memoria, son consulta al sistema de origen en el momento; recordarlos sirve dato obsoleto.',
            'Resume, no acumules: en vez de guardar los 40 mensajes de una sesión, guarda el resumen de lo que quedó decidido; la memoria crece en conocimiento, no en volumen.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La separación práctica es entre memoria de perfil (hechos durables sobre quién es el usuario y qué prefiere) y memoria de episodio (lo que pasó en una sesión específica, guardado como resumen). La primera se consulta casi siempre; la segunda, solo cuando el tema reaparece. Lo que nunca debe volverse memoria es dato vivo: si la respuesta depende del estado actual del sistema, viene de una consulta, no del recuerdo, si no el agente responde con un saldo de hace tres semanas con la confianza de quien acaba de chequear.',
        },
      ],
    },
    {
      title: 'La anatomía de un hecho de memoria',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un hecho de memoria no es solo un texto suelto. Para ser recuperable, actualizable y confiable, necesita estructura: a quién pertenece, de qué tipo es, el contenido en sí, cuándo se grabó y hasta cuándo vale. Sin alcance por usuario, filtrás la memoria de un cliente a otro. Sin tipo, no podés recuperar por categoría ni actualizar el hecho correcto. Sin validez, un hecho que cambió queda sirviendo eternamente. El formato de abajo es el mínimo que sostiene una memoria de producción.',
        },
        {
          type: 'code',
          value: `// memory/record.js
// Un hecho de memoria necesita estructura para recuperarse y actualizarse.
// Texto suelto no da para escopar por usuario ni para expirar.

export function makeMemory({ userId, kind, content, embedding, ttlDays }) {
  const now = Date.now();
  return {
    userId,                 // alcance: la memoria es SIEMPRE por usuario, nunca global
    kind,                   // 'perfil' | 'preferencia' | 'episodio' | 'decision'
    content,                // el hecho en una frase, no el mensaje literal
    embedding,              // vector del content, para recuperar por relevancia
    createdAt: now,
    // Hecho durable (preferencia) puede no tener validez; el episodio expira.
    expiresAt: ttlDays ? now + ttlDays * 86400000 : null,
  };
}

// Regla de oro: content es un HECHO ("usa plan empresarial"),
// no un FRAGMENTO de conversacion ("entonces queria saber si mi plan...").`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en tres decisiones que salvan el sistema más tarde. El userId hace que la memoria esté siempre escopada: ninguna búsqueda cruza la frontera del usuario, lo que cierra la puerta más obvia de filtración de dato personal. El kind permite recuperar por categoría (solo las preferencias, por ejemplo) y actualizar el hecho correcto en vez de duplicar. Y el expiresAt distingue lo durable de lo efímero: una preferencia no expira, pero el resumen de un episodio puede tener validez, para que la memoria no se hinche con sesiones viejas que nadie va a reabrir. Guardar el content como hecho, y no como fragmento de conversación, es lo que hace que la recuperación funcione: un hecho corto y denso casa mejor con la pregunta que un párrafo de charla.',
        },
      ],
    },
    {
      title: 'Recuperar por relevancia, no por recencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la memoria llena, la pregunta se vuelve: ¿qué de ella inyectar en la ventana de este turno? La respuesta ingenua es "las últimas N memorias", pero la recencia es el criterio equivocado. El hecho más útil para la pregunta de ahora puede haberse grabado hace meses (el plan que el cliente contrató), mientras las memorias recientes pueden ser sobre un tema que no tiene nada que ver. El criterio correcto es la relevancia: transformá el turno actual en embedding, buscá en la memoria del usuario los hechos más próximos e inyectá solo esos. Es el mismo mecanismo de un RAG, pero aplicado a la memoria de un único usuario en vez de a una base de documentos.',
        },
        {
          type: 'diagram',
          value: `Recuperacion de memoria por turno

  mensaje del usuario (turno actual)
        |
        v
  genera embedding del turno
        |
        v
  busca en la memoria DE ESTE usuario (userId fijo)
     los hechos mas relevantes (top-k)
        |
        v
  arma un resumen breve (no el transcript)
        |
        v
  inyecta el resumen en el prompt + historial reciente
        |
        v
  el modelo responde YA sabiendo quien es el cliente

  regla: alcance por usuario + top-k por relevancia + resumen corto
  mal: volcar toda la memoria O solo las memorias recientes`,
        },
        {
          type: 'code',
          value: `// memory/recall.js
// Recupera de la memoria SOLO lo relevante para el turno actual.
// Alcance por usuario y top-k por similitud, nunca "todo" ni "los ultimos".

export async function recall({ embed, store, userId, turn, k = 5 }) {
  const query = await embed(turn);

  // Busqueda restringida al usuario: la memoria NUNCA cruza la frontera del userId.
  const hits = await store.nearest({ userId, query, k });

  // Inyecta un resumen breve, no el contenido bruto de cada hecho.
  // Menos token en la ventana, foco en lo que importa a la pregunta.
  const summary = hits
    .filter((h) => !isExpired(h))
    .map((h) => \`- \${h.content}\`)
    .join('\\n');

  return summary; // va al prompt como contexto del usuario
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles hacen la diferencia entre una recuperación que ayuda y una que estorba. El primero es el top-k pequeño: recuperar cinco hechos densos y certeros es mejor que volcar cincuenta, porque el contexto irrelevante diluye la atención del modelo tanto como la falta de contexto. El segundo es el resumen: inyectás el hecho ("usa el plan empresarial"), no el párrafo de donde salió. Menos token, más señal. Y la búsqueda está siempre presa al userId, porque memoria que se filtra entre usuarios es el peor error posible: servir la preferencia o el historial de un cliente a otro es un incidente de privacidad, no un bug de calidad.',
        },
      ],
    },
    {
      title: 'Actualizar y olvidar: memoria que no miente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La memoria que solo crece se vuelve mentira con el tiempo. El cliente que "usaba el plan básico" migró al empresarial; el que "prefería ser contactado por email" ahora pidió WhatsApp; la restricción que tenía dejó de valer. Si la memoria guarda el hecho viejo al lado del nuevo, la recuperación puede traer el equivocado, y el agente atiende con una verdad vencida. Por eso la memoria de largo plazo necesita dos operaciones que casi siempre quedan afuera: actualizar (reemplazar un hecho cuando cambia) y olvidar (remover lo que expiró o lo que el usuario pidió borrar).',
        },
        {
          type: 'ordered',
          items: [
            'Actualiza por hecho, no por acumulación: cuando el usuario cambia de plan, reemplaza el hecho de plan; no guardes los dos y reces para que el más nuevo gane en la recuperación.',
            'Dale validez a lo temporal: episodios y resúmenes de sesión deben expirar; las preferencias durables viven hasta ser contradichas, no para siempre por defecto.',
            'Respeta el pedido de olvido: un usuario puede pedir borrar datos; la memoria tiene que tener delete por usuario, no solo por conveniencia sino por obligación de privacidad.',
            'Detecta contradicción en la escritura: al grabar un hecho del mismo kind, chequea si ya existe uno que lo contradice y resuélvelo en el momento, en vez de dejar dos hechos rivales en la base.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error clásico es montar la escritura y la recuperación, celebrar que el agente "recuerda", y nunca implementar la actualización. El sistema empieza impresionante y se pudre despacio: cuanto más interactúa el usuario, más hechos vencidos se acumulan, y más la recuperación yerra al traer una verdad vieja. Actualizar y olvidar son lo que mantiene la memoria alineada con la realidad del cliente. Y el olvido no es solo higiene técnica: es requisito de privacidad. Un usuario tiene el derecho de pedir que borres lo que sabés sobre él, y la memoria debe construirse asumiendo ese pedido desde el primer día.',
        },
      ],
    },
    {
      title: 'Dónde vive la memoria y cómo escala',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La elección de almacenamiento decide el costo y la latencia de la memoria en producción. Como la recuperación es por similitud, el corazón es una búsqueda vectorial: los embeddings de los hechos necesitan vivir donde se pueda encontrar los más próximos rápido. Pero los hechos también tienen metadatos (userId, kind, validez) que filtrás antes o durante la búsqueda, así que almacenamiento puro de vector sin filtro por usuario no basta. La combinación práctica es un índice vectorial con filtro por userId, más un almacenamiento durable de los hechos con sus metadatos.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Decisión', 'Por qué'],
          rows: [
            [
              'Índice de búsqueda',
              'Vectorial con filtro por userId',
              'La recuperación es por relevancia, siempre escopada al usuario',
            ],
            [
              'Alcance de la búsqueda',
              'Siempre un userId por vez',
              'La memoria nunca puede cruzar la frontera entre clientes',
            ],
            [
              'Crecimiento',
              'TTL en los episodios, resumen de los perfiles',
              'La memoria crece en conocimiento, no en volumen bruto',
            ],
            [
              'Latencia',
              'Top-k pequeño, resumen corto',
              'Recuperar poco y denso mantiene la llamada rápida y barata',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Lo que mantiene la memoria barata y rápida en escala no es la tecnología de base, es la disciplina de grabar poco y denso. Una memoria que guarda hechos resumidos, expira episodios y mantiene solo el perfil durable queda pequeña y rápida incluso con millones de usuarios, porque cada búsqueda toca solo la memoria de un usuario y trae solo un puñado de hechos. Una memoria que guarda transcript bruto de todo crece sin límite, encarece cada búsqueda y encima entrega contexto peor. La escala no es problema de infraestructura, es consecuencia de la política de escritura.',
        },
      ],
    },
    {
      title: 'Montar la capa sin volverla riesgo nuevo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La memoria de largo plazo transforma la experiencia de atención: el agente deja de tratar cada sesión como la primera y pasa a atender a alguien que conoce. Pero introduce dos clases de riesgo que no existían en el agente sin memoria: filtración de dato entre usuarios y respuesta basada en hecho vencido. El orden de despliegue importa tanto como el código, y el camino es construir la seguridad antes de la astucia.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por el alcance por usuario: antes de cualquier recuperación, garantiza que toda búsqueda está presa al userId. Filtrar memoria entre clientes es incidente de privacidad, no bug de calidad.',
            'Graba hecho, no transcript: implementa la extracción de hechos durables desde el inicio; memoria llena de conversación bruta es cara, lenta y mala de recuperar.',
            'Recupera por relevancia con top-k pequeño: inyecta pocos hechos densos, no la memoria entera ni solo las memorias recientes; el contexto irrelevante empeora la respuesta.',
            'Agrega actualizar y olvidar antes de escalar: sin reemplazo de hecho y sin delete por usuario, la memoria se pudre y se vuelve pasivo de privacidad.',
            'Instrumenta lo que la memoria inyecta: loguea qué hechos entraron en el prompt (con redacción de dato personal) para auditar cuando el agente responda con base en un recuerdo equivocado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre una memoria que encanta al cliente y una que se vuelve incidente está entera en el alcance y en la política de escritura, no en el modelo de embedding. El embedding es commodity; el alcance por usuario, la extracción de hechos, la recuperación por relevancia y las operaciones de actualizar y olvidar son lo que transforma "guardar historial" en una capa de producción confiable. Bien hecha, la memoria de largo plazo es uno de los cambios de mayor impacto percibido en un agente de atención: el cliente siente que habla con alguien que se acuerda de él, sin que el sistema lo pague en token, latencia o riesgo de privacidad.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿La memoria de largo plazo no es solo mandar el historial entero de la conversación en el prompt?',
      answer:
        'No, y esa es la trampa más común. Apilar el historial entero en la ventana de contexto revienta el techo de tokens, cuesta caro en toda llamada y encima entierra el hecho relevante debajo de mensajes irrelevantes. La memoria de largo plazo es lo opuesto: los hechos viven fuera del modelo, en un almacén persistente, y en cada turno recuperás solo los pocos que importan para la pregunta actual e inyectás un resumen breve. Guardás mucho y mostrás poco. La ventana es la vitrina, la memoria es la fuente; volcar la memoria entera en la ventana es tan malo como no tener memoria.',
    },
    {
      question: '¿Cuál es el mayor riesgo de la memoria de largo plazo y cómo se controla?',
      answer:
        'Son dos. El primero es la filtración entre usuarios: si la búsqueda no está escopada por userId, el agente puede servir la preferencia o el historial de un cliente a otro, lo que es un incidente de privacidad, no un bug de calidad. Se controla prendiendo toda recuperación al userId, sin excepción. El segundo es responder con hecho vencido: si la memoria solo crece y nunca actualiza, guarda el plan viejo al lado del nuevo y la recuperación trae el equivocado. Se controla con actualización por hecho (reemplazar cuando cambia), validez en los episodios y delete por usuario, que también honra el derecho al olvido.',
    },
    {
      question: '¿Cómo decidir qué se vuelve memoria y qué se descarta?',
      answer:
        'La pregunta correcta no es "¿qué dijo el usuario?", es "¿qué sobre este usuario sigue siendo verdad en la próxima sesión?". Hechos durables (plan contratado, preferencia de idioma o canal, restricciones, decisiones pasadas) valen porque cambian cómo lo atendés de ahí en adelante, y deben grabarse como hecho corto, no como el mensaje literal. Charla y tema puntual ya resuelto son ruido: a lo sumo se vuelven un resumen de una línea con validez. Y el dato vivo (estado de pedido, saldo, cotización) nunca es memoria: viene de consulta al sistema en el momento, si no el agente responde con un valor obsoleto con cara de recién chequeado.',
    },
  ],
  conclusion: {
    title: 'La memoria de largo plazo hace que el agente recuerde al cliente sin reventar el contexto',
    description:
      'Separar ventana de contexto de memoria persistente, grabar hecho en vez de transcript, recuperar por relevancia escopada al usuario y mantener la memoria actualizada es lo que transforma un agente amnésico en uno que conoce al cliente. Puedo diseñar esa capa en tu agente de atención, del alcance por usuario a la recuperación y al olvido, con seguridad de privacidad y sin inflar el costo de token.',
    cta: 'Hablar sobre memoria en mi agente de atención',
  },
  related: [
    { label: 'Orquestación de agentes de IA en producción', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Feature store para personalización de atención', to: '/blog/feature-store-personalizacao-atendimento' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'agent-memory-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
