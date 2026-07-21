// Conteudo do artigo: compressao de contexto para caber mais na janela sem perder sinal.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Compressor de contexto mínimo: recebe o histórico de uma conversa longa, orça a janela em tokens, mantém intactos os turnos recentes e as âncoras que não podem ser perdidas, e resume em bloco os turnos antigos de baixo sinal, devolvendo o contexto comprimido junto de um relatório do que foi cortado, para que a conversa continue cabendo na janela sem esquecer o que importa.',
  en: 'Minimal context compressor: it takes a long conversation history, budgets the window in tokens, keeps the recent turns and the anchors that cannot be lost intact, and summarizes the old low-signal turns in a block, returning the compressed context alongside a report of what was cut, so the conversation keeps fitting in the window without forgetting what matters.',
  es: 'Compresor de contexto mínimo: recibe el historial de una conversación larga, presupuesta la ventana en tokens, mantiene intactos los turnos recientes y las anclas que no pueden perderse, y resume en bloque los turnos viejos de baja señal, devolviendo el contexto comprimido junto a un reporte de lo que se cortó, para que la conversación siga entrando en la ventana sin olvidar lo que importa.',
};

const repoUrl = 'https://github.com/joaosouz4dev/context-compression-mini';

const pt = {
  intro:
    'Toda conversa longa com um modelo esbarra no mesmo teto: a janela de contexto é finita, e o histórico cresce a cada turno. Cedo ou tarde a conversa não cabe mais, e você tem que escolher o que entra no prompt e o que fica de fora. A saída ingênua é cortar as mensagens mais antigas: mantém as últimas N e joga o resto fora. Funciona até o modelo esquecer o nome do cliente, o número do pedido ou a decisão que a conversa tomou vinte turnos atrás, porque essa informação estava justamente no trecho que você descartou. O problema real não é caber, é caber sem perder sinal: enfiar mais conversa na mesma janela mantendo o que importa e descartando o que não importa. Compressão de contexto é o conjunto de técnicas que faz isso de forma consciente, distinguindo o turno de alto sinal que precisa sobreviver do turno de baixo sinal que pode virar uma linha de resumo. Este artigo mostra por que cortar por idade perde informação crucial, como orçar a janela em vez de estourar, o que nunca deve ser comprimido, o resumo em bloco dos turnos antigos, o cuidado com o resumo que inventa fato e como medir se a compressão está preservando o sinal ou destruindo ele.',
  sections: [
    {
      title: 'Por que cortar por idade perde o que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A janela deslizante, manter só os últimos N turnos, é a compressão mais barata e a mais enganosa. Ela assume que a mensagem mais recente é sempre a mais importante, e isso é falso numa conversa real. O cliente diz o número do pedido no segundo turno e volta a falar dele no vigésimo; a decisão de trocar o produto foi tomada no meio e precisa valer até o fim; a instrução de sistema que define o tom do bot está no começo de tudo. Cortar por idade descarta esses trechos justamente porque eles são antigos, sem olhar se ainda são necessários. O resultado é um bot que parece ter amnésia: ele responde bem os últimos turnos e comete erros grosseiros sobre fatos que a própria conversa já estabeleceu, porque o fato saiu da janela sem que ninguém verificasse se ele ainda era preciso.',
        },
        {
          type: 'paragraph',
          value:
            'A idade de um turno não mede o seu sinal. Um "ok, obrigado" recente ocupa espaço e não carrega quase nada; a definição do escopo do pedido, dita há muitos turnos, carrega o fio inteiro da conversa. Compressão por idade trata os dois igual, e é por isso que ela quebra. A compressão que preserva sinal separa duas perguntas que a janela deslizante confunde numa só: o que é recente e o que é importante. Nem todo recente é importante, e o mais grave, nem todo importante é recente. Uma vez que você aceita que essas duas perguntas são diferentes, fica claro que a régua do corte não pode ser o relógio, tem que ser o sinal.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Régua do corte', 'O que quebra'],
          rows: [
            [
              'Janela deslizante (últimos N)',
              'Idade do turno',
              'Perde fato antigo ainda necessário, mantém turno recente vazio',
            ],
            [
              'Corte por token bruto',
              'Estourou o limite, trunca no meio',
              'Corta frase pela metade, separa pergunta da resposta',
            ],
            [
              'Compressão por sinal',
              'Importância do turno, não idade',
              'Custa um resumo, exige classificar o que preservar',
            ],
          ],
        },
      ],
    },
    {
      title: 'Orçar a janela antes de estourar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comprimir não é reagir ao erro de limite excedido, é orçar a janela antes de chegar nele. Você define um teto de tokens para o contexto que é menor que o limite bruto do modelo, porque precisa deixar espaço para a resposta que o modelo vai gerar e para uma margem de segurança. Dentro desse teto, você aloca por prioridade: primeiro a instrução de sistema, depois as âncoras que não podem cair, depois os turnos recentes, e o que sobra de espaço é o orçamento para os turnos antigos, que serão comprimidos até caber nele. Orçar antes transforma a compressão de uma reação de pânico, disparada quando o prompt já estourou, num processo previsível que roda a cada turno e mantém o contexto sempre dentro de um tamanho conhecido.',
        },
        {
          type: 'paragraph',
          value:
            'A conta de tokens tem que ser feita com o tokenizador do modelo, não estimada por número de caracteres, porque a diferença entre estimar e contar é a diferença entre caber e estourar. Um texto com muitos números, código ou outro idioma consome tokens de forma diferente do que a regra de bolso de quatro caracteres por token sugere, e uma estimativa que erra para baixo faz o prompt estourar em produção exatamente quando a conversa fica interessante. Orçar de verdade é contar com o tokenizador certo, deixar margem para a resposta e tratar o teto como um contrato: o contexto nunca passa daqui, e a compressão é o mecanismo que garante isso a cada turno.',
        },
        {
          type: 'code',
          value: `// context/budget.js
// Orca a janela por prioridade: primeiro o que nao pode cair,
// e o espaco que sobra vira o orcamento dos turnos antigos.

export function budgetContext(history, { windowLimit, reserveForReply }) {
  // O teto do contexto e o limite do modelo MENOS o espaco da resposta
  // e uma margem de seguranca. Nunca use o limite bruto.
  const budget = windowLimit - reserveForReply;

  // Sempre entram inteiros, na ordem de prioridade.
  const system = history.filter((t) => t.role === 'system');
  const anchors = history.filter((t) => t.pinned);       // fatos que nao podem cair
  const recent = takeRecentTurns(history, RECENT_KEEP);  // ultimos turnos, sempre crus

  const fixedCost = tokenCount([...system, ...anchors, ...recent]);

  // O que sobra do orcamento e para os turnos antigos, que serao comprimidos.
  const remaining = budget - fixedCost;
  const old = history.filter(
    (t) => !t.pinned && t.role !== 'system' && !recent.includes(t),
  );

  return { system, anchors, recent, old, remainingForOld: remaining };
}`,
        },
      ],
    },
    {
      title: 'O que nunca deve ser comprimido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A compressão só é segura quando existe uma lista clara do que ela não pode tocar. A instrução de sistema é a primeira: ela define o comportamento do bot e resumi-la é arriscar mudar o que o modelo faz. Depois vêm as âncoras, os fatos concretos que a conversa precisa carregar até o fim, número do pedido, nome do cliente, decisão tomada, valor combinado. Esses fatos não podem virar resumo porque um resumo é uma reformulação, e reformular um número ou um nome é a forma mais fácil de corrompê-lo. E os turnos recentes ficam crus porque são o contexto imediato do próximo turno, aquilo que o modelo precisa ler palavra por palavra para responder com coerência. Tudo o que não está nessas três categorias é candidato à compressão; tudo o que está nelas passa intacto.',
        },
        {
          type: 'list',
          items: [
            'Instrução de sistema: define o comportamento do bot, resumir muda o que ele faz. Passa sempre crua.',
            'Âncoras de fato: número de pedido, nome, valor, decisão, prazo. Fatos concretos que a conversa carrega até o fim e que um resumo corromperia ao reformular.',
            'Turnos recentes: o contexto imediato do próximo turno, precisa ser lido palavra por palavra para manter coerência. Ficam crus.',
            'Candidatos à compressão: turnos antigos de baixo sinal, saudações, confirmações, digressões, tudo que já cumpriu seu papel e pode virar uma linha de resumo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Identificar as âncoras é o passo que separa uma compressão que preserva sinal de uma que destrói. Elas podem ser marcadas de duas formas: explicitamente, quando o seu sistema sabe que um número de pedido ou um dado de cadastro entrou na conversa e o fixa, ou por extração, quando um passo dedicado lê o histórico e puxa os fatos concretos para uma lista estruturada antes de comprimir o resto. O importante é que a âncora saia do fluxo do texto comprimível e vire um dado protegido, porque enquanto ela estiver misturada com as saudações e as digressões, o compressor não tem como saber que aquele número não pode ser reformulado.',
        },
      ],
    },
    {
      title: 'Resumir os turnos antigos em bloco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o que não pode cair já protegido, sobra o miolo comprimível: os turnos antigos de baixo sinal. A técnica é resumir esse bloco num texto curto que preserve o fio da conversa sem os detalhes que já não importam. Em vez de dez turnos de ida e volta sobre um agendamento que já foi resolvido, uma linha: "o cliente agendou para terça e confirmou o endereço". O resumo não substitui as âncoras, que seguem cruas e à parte, ele apenas costura o contexto narrativo que dá sentido à conversa. E a compressão pode ser hierárquica: os turnos ficam crus, depois viram resumos de bloco, e resumos antigos podem ser resumidos de novo num resumo mais alto, formando camadas em que o detalhe diminui conforme o turno envelhece, mas o fio nunca se rompe.',
        },
        {
          type: 'diagram',
          value: `Compressao por sinal, nao por idade

  historico completo (nao cabe na janela)
     |
     v
  +-----------------------------------------------+
  | instrucao de sistema      -> CRU (nunca comprime)
  | ancoras (pedido, nome...)  -> CRU (dado protegido)
  | turnos recentes (ultimos N)-> CRU (contexto imediato)
  | turnos antigos baixo sinal -> RESUMO EM BLOCO
  +-----------------------------------------------+
     |
     v
  contexto comprimido cabe no orcamento
     |
     +-- turnos MUITO antigos: resumo do resumo (camada mais alta)
     |
     v
  prompt final: sistema + ancoras + resumo + recentes crus
     (o fio da conversa sobrevive, o detalhe morto sai)`,
        },
        {
          type: 'paragraph',
          value:
            'A compressão hierárquica é o que permite conversas realmente longas caberem numa janela fixa sem esquecer o começo. Sem ela, você tem duas opções ruins: manter tudo cru e estourar, ou cortar por idade e perder o começo. Com ela, o começo da conversa não desaparece, ele encolhe: vira uma linha de resumo que ainda diz o que foi combinado, e essa linha sobrevive mesmo depois de centenas de turnos, porque ocupa quase nada. O detalhe morto sai, o fio vivo fica. É a diferença entre um bot que "lembra que a conversa começou tratando de um reembolso" e um bot que só sabe os últimos três turnos e age como se a conversa tivesse começado agora.',
        },
      ],
    },
    {
      title: 'O resumo que inventa fato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comprimir com um modelo tem um risco que o corte por idade não tem: o resumo pode inventar. Quando você pede a um modelo para resumir dez turnos, ele pode introduzir um detalhe que não estava lá, trocar um número, afirmar uma decisão que a conversa não tomou. E o perigo é que esse fato inventado entra no contexto como se fosse verdade e contamina todos os turnos seguintes, porque agora o próprio histórico afirma algo falso, e o modelo passa a raciocinar em cima disso. Uma alucinação num resumo de contexto é pior do que uma alucinação numa resposta: a resposta o usuário vê e corrige, o resumo fica silencioso no histórico envenenando o resto da conversa. Por isso a compressão que usa modelo precisa de um freio explícito.',
        },
        {
          type: 'paragraph',
          value:
            'O freio tem três partes. A primeira é instruir o resumo a ser extrativo, não criativo: ele deve condensar o que foi dito, não interpretar nem completar, e nunca introduzir número, nome ou valor que não apareça no texto original. A segunda é manter as âncoras fora do resumo: como os fatos concretos já foram extraídos e protegidos crus, o resumo não precisa carregar número nenhum, e um resumo que não tem números não tem como errar número. A terceira é a verificação: quando o custo justifica, um passo checa que o resumo não introduziu fato ausente do original, comparando as âncoras do resumo com as âncoras extraídas. A regra que ancora tudo é que a compressão nunca pode adicionar informação, só remover; se o resumo diz algo que o original não dizia, ele falhou, por mais fluente que soe.',
        },
        {
          type: 'code',
          value: `// context/summarize.js
// Resume os turnos antigos de forma extrativa e verifica que
// nenhum fato novo entrou. Compressao so REMOVE, nunca ADICIONA.

const COMPRESS_INSTRUCTION = \`
Condense os turnos abaixo preservando o fio da conversa.
Regras: seja extrativo, nao interprete nem complete.
NUNCA introduza numero, nome, valor ou decisao que nao esteja no texto.
Fatos concretos ja foram extraidos a parte: nao os repita nem os invente.
\`;

export async function compressOldTurns(oldTurns, anchors, model) {
  const summary = await model.summarize(COMPRESS_INSTRUCTION, oldTurns);

  // Verifica que o resumo nao inventou fato: nenhuma ancora nova
  // pode aparecer no resumo que nao estivesse no original.
  const introduced = extractFacts(summary).filter(
    (fact) => !appearsIn(fact, oldTurns) && !anchors.includes(fact),
  );

  if (introduced.length > 0) {
    // O resumo alucinou um fato: descarta e cai para um corte conservador
    // em vez de envenenar o contexto com algo que a conversa nao disse.
    return conservativeTrim(oldTurns);
  }

  return summary;
}`,
        },
      ],
    },
    {
      title: 'Medir se a compressão preserva o sinal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compressão é uma troca: você ganha espaço na janela e paga em fidelidade ao histórico. Sem medir, você não sabe de que lado a troca está pendendo, e uma compressão agressiva demais degrada o bot de um jeito que não aparece em nenhum erro imediato, só numa piora difusa da qualidade das respostas. A métrica central é a retenção de âncoras: depois de comprimir, os fatos que a conversa estabeleceu ainda estão acessíveis no contexto? Você monta um conjunto de conversas longas com fatos plantados no começo, aplica a compressão e faz perguntas cuja resposta depende desses fatos. Se o bot acerta, a compressão preservou o sinal; se erra, ela cortou algo que precisava sobreviver, e você aperta o que fica cru ou o que vira âncora.',
        },
        {
          type: 'ordered',
          items: [
            'Oráculo de âncoras: monte conversas longas com fatos plantados e pergunte no fim algo que dependa deles; meça quantos o bot ainda acerta depois da compressão.',
            'Taxa de fidelidade do resumo: verifique que o resumo não introduziu fato ausente do original, com o passo de verificação como métrica contínua, não só como freio.',
            'Ocupação da janela: acompanhe quanto do orçamento cada categoria consome; se as âncoras crescem sem limite, a extração precisa priorizar ou a conversa precisa de checkpoint.',
            'Sinal por token: compare a qualidade da resposta com e sem compressão no mesmo caso; a compressão só vale se a queda de qualidade for menor que o ganho de caber.',
            'Alerta de perda: registre quando um turno é cortado ou resumido e o que ele continha, para reconstruir o que foi perdido quando uma conversa der resposta errada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A compressão de contexto bem feita é invisível: o bot mantém conversas longas coerentes, lembra o que foi combinado no começo e nunca estoura a janela, e você não percebe que por baixo há um mecanismo constante decidindo o que preservar cru e o que condensar. A compressão mal feita também é quase invisível, e é aí que mora o risco: ela degrada a qualidade aos poucos, sem um erro claro que aponte a causa, até alguém notar que o bot "está mais burro" sem saber por quê. A diferença entre as duas não está no código da compressão, está na medição: só medir a retenção de sinal separa a compressão que economiza janela da que silenciosamente joga fora a memória da conversa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não basta manter só as últimas mensagens da conversa?',
      answer:
        'Porque a idade de um turno não mede a importância dele. A janela deslizante, manter os últimos N turnos, assume que o mais recente é o mais relevante, e isso é falso numa conversa real: o número do pedido dito no começo, a decisão tomada no meio e a instrução de sistema no topo são antigos e continuam essenciais. Cortar por idade descarta esses trechos justamente por serem antigos, sem checar se ainda são necessários, e o resultado é um bot com amnésia, que responde bem os últimos turnos e erra grosseiramente sobre fatos que a própria conversa já estabeleceu. A compressão que preserva sinal separa duas perguntas que a janela deslizante confunde numa só, o que é recente e o que é importante, e usa a importância, não o relógio, como régua do corte.',
    },
    {
      question: 'Comprimir contexto com um modelo não corre o risco de alucinar?',
      answer:
        'Corre, e é o risco mais perigoso da compressão, porque um fato inventado num resumo entra no histórico como verdade e contamina todos os turnos seguintes, silenciosamente, sem que o usuário veja e corrija como faria numa resposta. O freio tem três partes: instruir o resumo a ser extrativo, condensar o que foi dito sem interpretar nem introduzir número, nome ou valor novo; manter as âncoras fora do resumo, já que os fatos concretos são extraídos e protegidos crus a parte, então um resumo sem números não tem como errar número; e verificar que o resumo não introduziu fato ausente do original, caindo para um corte conservador quando introduziu. A regra que ancora tudo é que a compressão só pode remover informação, nunca adicionar.',
    },
    {
      question: 'Como saber se a compressão está preservando o que importa?',
      answer:
        'Medindo a retenção de âncoras, que é o sinal que a conversa não pode perder. Você monta um conjunto de conversas longas com fatos plantados no começo, aplica a compressão e faz perguntas cuja resposta depende desses fatos; se o bot acerta, a compressão preservou o sinal, se erra, ela cortou algo que precisava sobreviver. Junto disso, acompanhe a taxa de fidelidade do resumo com o passo de verificação, a ocupação da janela por categoria e o sinal por token, comparando a qualidade da resposta com e sem compressão no mesmo caso. Sem medir, uma compressão agressiva demais degrada o bot de forma difusa, sem erro imediato que aponte a causa, até alguém notar que ele "está mais burro" sem saber por quê.',
    },
  ],
  conclusion: {
    title: 'Comprimir contexto é escolher o sinal, não o relógio',
    description:
      'Caber na janela sem perder o que importa não é cortar as mensagens mais antigas, é distinguir o turno de alto sinal que precisa sobreviver do turno de baixo sinal que pode virar uma linha de resumo. Orçar a janela em tokens, proteger crua a instrução de sistema, as âncoras de fato e os turnos recentes, resumir o resto de forma extrativa e verificada e medir a retenção de sinal transforma a janela de contexto de um teto que trunca a conversa num orçamento que a conversa respeita. Posso desenhar essa camada de compressão no seu sistema de IA, escolhendo o que fica cru e o que condensa, blindando o resumo contra alucinação e medindo que o fio da conversa sobrevive, para que o seu bot mantenha conversas longas sem amnésia nem estouro de janela.',
    cta: 'Falar sobre compressão de contexto no meu sistema de IA',
  },
  related: [
    { label: 'Chunking de documento para RAG sem perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Memória de longo prazo para agentes de atendimento', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'context-compression-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Every long conversation with a model hits the same ceiling: the context window is finite, and the history grows with each turn. Sooner or later the conversation no longer fits, and you have to choose what goes into the prompt and what stays out. The naive way out is to cut the oldest messages: keep the last N and throw the rest away. It works until the model forgets the customer name, the order number or the decision the conversation made twenty turns ago, because that information was precisely in the passage you discarded. The real problem is not fitting, it is fitting without losing signal: packing more conversation into the same window while keeping what matters and dropping what does not. Context compression is the set of techniques that does this consciously, distinguishing the high-signal turn that must survive from the low-signal turn that can become a summary line. This article shows why cutting by age loses crucial information, how to budget the window instead of blowing it, what should never be compressed, the block summary of old turns, the care with a summary that invents facts and how to measure whether the compression is preserving the signal or destroying it.',
  sections: [
    {
      title: 'Why cutting by age loses what matters',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The sliding window, keeping only the last N turns, is the cheapest compression and the most deceptive. It assumes the most recent message is always the most important, and that is false in a real conversation. The customer says the order number on the second turn and comes back to it on the twentieth; the decision to swap the product was made in the middle and must hold to the end; the system instruction that defines the bot tone is at the very start. Cutting by age discards these passages precisely because they are old, without checking whether they are still needed. The result is a bot that seems to have amnesia: it answers the last turns well and makes gross mistakes about facts the conversation itself already established, because the fact left the window without anyone verifying it was still accurate.',
        },
        {
          type: 'paragraph',
          value:
            'The age of a turn does not measure its signal. A recent "ok, thanks" takes up space and carries almost nothing; the definition of the request scope, said many turns ago, carries the whole thread of the conversation. Compression by age treats the two the same, and that is why it breaks. Signal-preserving compression separates two questions the sliding window collapses into one: what is recent and what is important. Not everything recent is important, and worse, not everything important is recent. Once you accept that these are two different questions, it becomes clear that the ruler for the cut cannot be the clock, it has to be the signal.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Cut ruler', 'What breaks'],
          rows: [
            [
              'Sliding window (last N)',
              'Turn age',
              'Loses old fact still needed, keeps empty recent turn',
            ],
            [
              'Raw token trim',
              'Over the limit, truncates mid-text',
              'Cuts a sentence in half, splits question from answer',
            ],
            [
              'Signal compression',
              'Turn importance, not age',
              'Costs a summary, requires classifying what to preserve',
            ],
          ],
        },
      ],
    },
    {
      title: 'Budget the window before blowing it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compressing is not reacting to the limit-exceeded error, it is budgeting the window before reaching it. You set a token ceiling for the context that is smaller than the model raw limit, because you need to leave room for the answer the model will generate and for a safety margin. Within that ceiling, you allocate by priority: first the system instruction, then the anchors that cannot fall, then the recent turns, and whatever space is left is the budget for the old turns, which will be compressed until they fit it. Budgeting first turns compression from a panic reaction, fired when the prompt already blew, into a predictable process that runs every turn and keeps the context always within a known size.',
        },
        {
          type: 'paragraph',
          value:
            'The token count has to be done with the model tokenizer, not estimated by character count, because the difference between estimating and counting is the difference between fitting and blowing. A text with many numbers, code or another language consumes tokens differently from what the four-characters-per-token rule of thumb suggests, and an estimate that errs low blows the prompt in production exactly when the conversation gets interesting. Budgeting for real is counting with the right tokenizer, leaving margin for the answer and treating the ceiling as a contract: the context never goes past here, and compression is the mechanism that guarantees it every turn.',
        },
        {
          type: 'code',
          value: `// context/budget.js
// Budgets the window by priority: first what cannot fall,
// and whatever space is left becomes the budget for the old turns.

export function budgetContext(history, { windowLimit, reserveForReply }) {
  // The context ceiling is the model limit MINUS the answer space
  // and a safety margin. Never use the raw limit.
  const budget = windowLimit - reserveForReply;

  // Always go in whole, in priority order.
  const system = history.filter((t) => t.role === 'system');
  const anchors = history.filter((t) => t.pinned);       // facts that cannot fall
  const recent = takeRecentTurns(history, RECENT_KEEP);  // last turns, always raw

  const fixedCost = tokenCount([...system, ...anchors, ...recent]);

  // Whatever is left of the budget is for the old turns, which will be compressed.
  const remaining = budget - fixedCost;
  const old = history.filter(
    (t) => !t.pinned && t.role !== 'system' && !recent.includes(t),
  );

  return { system, anchors, recent, old, remainingForOld: remaining };
}`,
        },
      ],
    },
    {
      title: 'What should never be compressed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compression is only safe when there is a clear list of what it cannot touch. The system instruction is the first: it defines the bot behavior and summarizing it risks changing what the model does. Then come the anchors, the concrete facts the conversation needs to carry to the end, order number, customer name, decision made, agreed amount. These facts cannot become a summary because a summary is a rewording, and rewording a number or a name is the easiest way to corrupt it. And the recent turns stay raw because they are the immediate context of the next turn, what the model needs to read word by word to answer coherently. Everything that is not in these three categories is a candidate for compression; everything in them passes through intact.',
        },
        {
          type: 'list',
          items: [
            'System instruction: defines the bot behavior, summarizing changes what it does. Always passes raw.',
            'Fact anchors: order number, name, amount, decision, deadline. Concrete facts the conversation carries to the end and that a summary would corrupt by rewording.',
            'Recent turns: the immediate context of the next turn, needs to be read word by word to keep coherence. They stay raw.',
            'Compression candidates: old low-signal turns, greetings, confirmations, digressions, everything that already did its job and can become a summary line.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Identifying the anchors is the step that separates a signal-preserving compression from a destructive one. They can be marked two ways: explicitly, when your system knows an order number or a registration field entered the conversation and pins it, or by extraction, when a dedicated step reads the history and pulls the concrete facts into a structured list before compressing the rest. What matters is that the anchor leaves the compressible text flow and becomes a protected datum, because as long as it is mixed with the greetings and the digressions, the compressor has no way of knowing that number cannot be reworded.',
        },
      ],
    },
    {
      title: 'Summarize the old turns in a block',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With what cannot fall already protected, what is left is the compressible core: the old low-signal turns. The technique is to summarize this block into a short text that preserves the thread of the conversation without the details that no longer matter. Instead of ten back-and-forth turns about a scheduling that was already resolved, one line: "the customer booked for Tuesday and confirmed the address". The summary does not replace the anchors, which stay raw and apart, it only stitches the narrative context that gives the conversation meaning. And compression can be hierarchical: turns stay raw, then become block summaries, and old summaries can be summarized again into a higher summary, forming layers where detail fades as the turn ages, but the thread never breaks.',
        },
        {
          type: 'diagram',
          value: `Compression by signal, not by age

  full history (does not fit the window)
     |
     v
  +-----------------------------------------------+
  | system instruction        -> RAW (never compress)
  | anchors (order, name...)   -> RAW (protected datum)
  | recent turns (last N)      -> RAW (immediate context)
  | old low-signal turns       -> BLOCK SUMMARY
  +-----------------------------------------------+
     |
     v
  compressed context fits the budget
     |
     +-- VERY old turns: summary of the summary (higher layer)
     |
     v
  final prompt: system + anchors + summary + raw recent
     (the thread survives, the dead detail leaves)`,
        },
        {
          type: 'paragraph',
          value:
            'Hierarchical compression is what lets truly long conversations fit a fixed window without forgetting the beginning. Without it, you have two bad options: keep everything raw and blow it, or cut by age and lose the beginning. With it, the beginning of the conversation does not vanish, it shrinks: it becomes a summary line that still says what was agreed, and that line survives even after hundreds of turns, because it takes up almost nothing. The dead detail leaves, the live thread stays. It is the difference between a bot that "remembers the conversation began about a refund" and a bot that only knows the last three turns and acts as if the conversation started just now.',
        },
      ],
    },
    {
      title: 'The summary that invents facts',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compressing with a model has a risk that cutting by age does not: the summary can invent. When you ask a model to summarize ten turns, it may introduce a detail that was not there, swap a number, assert a decision the conversation did not make. And the danger is that this invented fact enters the context as if it were true and contaminates every following turn, because now the history itself asserts something false, and the model starts reasoning on top of it. A hallucination in a context summary is worse than a hallucination in an answer: the answer the user sees and corrects, the summary stays silent in the history poisoning the rest of the conversation. That is why model-based compression needs an explicit brake.',
        },
        {
          type: 'paragraph',
          value:
            'The brake has three parts. The first is to instruct the summary to be extractive, not creative: it should condense what was said, not interpret or complete, and never introduce a number, name or amount that does not appear in the original text. The second is to keep the anchors out of the summary: since the concrete facts were already extracted and protected raw, the summary does not need to carry any number, and a summary with no numbers has no way to get a number wrong. The third is verification: when the cost justifies it, a step checks that the summary did not introduce a fact absent from the original, comparing the summary anchors with the extracted anchors. The rule that anchors it all is that compression can never add information, only remove it; if the summary says something the original did not, it failed, however fluent it sounds.',
        },
        {
          type: 'code',
          value: `// context/summarize.js
// Summarizes the old turns extractively and verifies that
// no new fact entered. Compression only REMOVES, never ADDS.

const COMPRESS_INSTRUCTION = \`
Condense the turns below preserving the thread of the conversation.
Rules: be extractive, do not interpret or complete.
NEVER introduce a number, name, amount or decision not in the text.
Concrete facts were already extracted apart: do not repeat or invent them.
\`;

export async function compressOldTurns(oldTurns, anchors, model) {
  const summary = await model.summarize(COMPRESS_INSTRUCTION, oldTurns);

  // Verify the summary did not invent a fact: no new anchor
  // can appear in the summary that was not in the original.
  const introduced = extractFacts(summary).filter(
    (fact) => !appearsIn(fact, oldTurns) && !anchors.includes(fact),
  );

  if (introduced.length > 0) {
    // The summary hallucinated a fact: discard it and fall to a conservative
    // trim instead of poisoning the context with something the conversation did not say.
    return conservativeTrim(oldTurns);
  }

  return summary;
}`,
        },
      ],
    },
    {
      title: 'Measure whether the compression preserves the signal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compression is a trade: you gain space in the window and pay in fidelity to the history. Without measuring, you do not know which way the trade is tilting, and an overly aggressive compression degrades the bot in a way that shows up in no immediate error, only in a diffuse worsening of answer quality. The central metric is anchor retention: after compressing, are the facts the conversation established still accessible in the context? You build a set of long conversations with facts planted at the start, apply the compression and ask questions whose answer depends on those facts. If the bot gets it right, the compression preserved the signal; if it gets it wrong, it cut something that needed to survive, and you tighten what stays raw or what becomes an anchor.',
        },
        {
          type: 'ordered',
          items: [
            'Anchor oracle: build long conversations with planted facts and ask at the end something that depends on them; measure how many the bot still gets right after compression.',
            'Summary fidelity rate: verify the summary did not introduce a fact absent from the original, with the verification step as a continuous metric, not just a brake.',
            'Window occupancy: track how much of the budget each category consumes; if the anchors grow without limit, the extraction needs to prioritize or the conversation needs a checkpoint.',
            'Signal per token: compare answer quality with and without compression on the same case; compression is only worth it if the quality drop is smaller than the gain of fitting.',
            'Loss alert: log when a turn is cut or summarized and what it contained, to reconstruct what was lost when a conversation gives a wrong answer.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Well-done context compression is invisible: the bot keeps long conversations coherent, remembers what was agreed at the start and never blows the window, and you do not notice that underneath there is a constant mechanism deciding what to preserve raw and what to condense. Badly done compression is also almost invisible, and that is where the risk lives: it degrades quality little by little, with no clear error pointing to the cause, until someone notices the bot "got dumber" without knowing why. The difference between the two is not in the compression code, it is in the measurement: only measuring signal retention separates the compression that saves window from the one that silently throws away the memory of the conversation.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why is it not enough to keep only the latest messages of the conversation?',
      answer:
        'Because the age of a turn does not measure its importance. The sliding window, keeping the last N turns, assumes the most recent is the most relevant, and that is false in a real conversation: the order number said at the start, the decision made in the middle and the system instruction at the top are old and remain essential. Cutting by age discards these passages precisely because they are old, without checking whether they are still needed, and the result is a bot with amnesia, answering the last turns well and grossly missing facts the conversation itself already established. Signal-preserving compression separates two questions the sliding window collapses into one, what is recent and what is important, and uses importance, not the clock, as the ruler for the cut.',
    },
    {
      question: 'Does compressing context with a model risk hallucinating?',
      answer:
        'It does, and it is the most dangerous risk of compression, because an invented fact in a summary enters the history as truth and contaminates every following turn, silently, without the user seeing and correcting it as they would in an answer. The brake has three parts: instruct the summary to be extractive, condensing what was said without interpreting or introducing a new number, name or amount; keep the anchors out of the summary, since the concrete facts are extracted and protected raw apart, so a summary with no numbers has no way to get a number wrong; and verify the summary did not introduce a fact absent from the original, falling to a conservative trim when it did. The rule that anchors it all is that compression can only remove information, never add it.',
    },
    {
      question: 'How do you know the compression is preserving what matters?',
      answer:
        'By measuring anchor retention, which is the signal the conversation cannot lose. You build a set of long conversations with facts planted at the start, apply the compression and ask questions whose answer depends on those facts; if the bot gets it right, the compression preserved the signal, if it gets it wrong, it cut something that needed to survive. Alongside that, track the summary fidelity rate with the verification step, the window occupancy per category and the signal per token, comparing answer quality with and without compression on the same case. Without measuring, an overly aggressive compression degrades the bot diffusely, with no immediate error pointing to the cause, until someone notices it "got dumber" without knowing why.',
    },
  ],
  conclusion: {
    title: 'Compressing context is choosing the signal, not the clock',
    description:
      'Fitting the window without losing what matters is not cutting the oldest messages, it is distinguishing the high-signal turn that must survive from the low-signal turn that can become a summary line. Budgeting the window in tokens, protecting the system instruction, the fact anchors and the recent turns raw, summarizing the rest extractively and verified and measuring signal retention turns the context window from a ceiling that truncates the conversation into a budget the conversation respects. I can design that compression layer in your AI system, choosing what stays raw and what condenses, shielding the summary against hallucination and measuring that the thread of the conversation survives, so your bot keeps long conversations without amnesia or window blowout.',
    cta: 'Talk about context compression in my AI system',
  },
  related: [
    { label: 'Document chunking for RAG without losing context', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Long-term memory for support agents', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'context-compression-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Toda conversación larga con un modelo choca con el mismo techo: la ventana de contexto es finita, y el historial crece en cada turno. Tarde o temprano la conversación ya no entra, y tenés que elegir qué va al prompt y qué queda afuera. La salida ingenua es cortar los mensajes más viejos: mantener los últimos N y tirar el resto. Funciona hasta que el modelo olvida el nombre del cliente, el número de pedido o la decisión que la conversación tomó veinte turnos atrás, porque esa información estaba justamente en el fragmento que descartaste. El problema real no es entrar, es entrar sin perder señal: meter más conversación en la misma ventana manteniendo lo que importa y descartando lo que no. La compresión de contexto es el conjunto de técnicas que hace esto de forma consciente, distinguiendo el turno de alta señal que tiene que sobrevivir del turno de baja señal que puede volverse una línea de resumen. Este artículo muestra por qué cortar por edad pierde información crucial, cómo presupuestar la ventana en vez de reventarla, qué nunca debe comprimirse, el resumen en bloque de los turnos viejos, el cuidado con el resumen que inventa un hecho y cómo medir si la compresión está preservando la señal o destruyéndola.',
  sections: [
    {
      title: 'Por qué cortar por edad pierde lo que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La ventana deslizante, mantener solo los últimos N turnos, es la compresión más barata y la más engañosa. Asume que el mensaje más reciente es siempre el más importante, y eso es falso en una conversación real. El cliente dice el número de pedido en el segundo turno y vuelve a hablar de él en el vigésimo; la decisión de cambiar el producto se tomó en el medio y tiene que valer hasta el final; la instrucción de sistema que define el tono del bot está al comienzo de todo. Cortar por edad descarta esos fragmentos justamente porque son viejos, sin mirar si todavía son necesarios. El resultado es un bot que parece tener amnesia: responde bien los últimos turnos y comete errores groseros sobre hechos que la propia conversación ya estableció, porque el hecho salió de la ventana sin que nadie verificara si seguía siendo preciso.',
        },
        {
          type: 'paragraph',
          value:
            'La edad de un turno no mide su señal. Un "ok, gracias" reciente ocupa espacio y no carga casi nada; la definición del alcance del pedido, dicha hace muchos turnos, carga el hilo entero de la conversación. La compresión por edad trata a los dos igual, y por eso se rompe. La compresión que preserva señal separa dos preguntas que la ventana deslizante confunde en una sola: qué es reciente y qué es importante. No todo lo reciente es importante, y lo más grave, no todo lo importante es reciente. Una vez que aceptás que son dos preguntas diferentes, queda claro que la regla del corte no puede ser el reloj, tiene que ser la señal.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Regla del corte', 'Qué se rompe'],
          rows: [
            [
              'Ventana deslizante (últimos N)',
              'Edad del turno',
              'Pierde hecho viejo aún necesario, mantiene turno reciente vacío',
            ],
            [
              'Corte por token bruto',
              'Se pasó del límite, trunca en el medio',
              'Corta la frase a la mitad, separa pregunta de respuesta',
            ],
            [
              'Compresión por señal',
              'Importancia del turno, no edad',
              'Cuesta un resumen, exige clasificar qué preservar',
            ],
          ],
        },
      ],
    },
    {
      title: 'Presupuestar la ventana antes de reventarla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comprimir no es reaccionar al error de límite excedido, es presupuestar la ventana antes de llegar a él. Definís un techo de tokens para el contexto que es menor que el límite bruto del modelo, porque necesitás dejar espacio para la respuesta que el modelo va a generar y para un margen de seguridad. Dentro de ese techo, asignás por prioridad: primero la instrucción de sistema, después las anclas que no pueden caer, después los turnos recientes, y lo que sobra de espacio es el presupuesto para los turnos viejos, que serán comprimidos hasta entrar en él. Presupuestar antes transforma la compresión de una reacción de pánico, disparada cuando el prompt ya reventó, en un proceso previsible que corre en cada turno y mantiene el contexto siempre dentro de un tamaño conocido.',
        },
        {
          type: 'paragraph',
          value:
            'La cuenta de tokens tiene que hacerse con el tokenizador del modelo, no estimada por número de caracteres, porque la diferencia entre estimar y contar es la diferencia entre entrar y reventar. Un texto con muchos números, código u otro idioma consume tokens de forma diferente de lo que la regla de bolsillo de cuatro caracteres por token sugiere, y una estimación que se equivoca para abajo revienta el prompt en producción justo cuando la conversación se pone interesante. Presupuestar de verdad es contar con el tokenizador correcto, dejar margen para la respuesta y tratar el techo como un contrato: el contexto nunca pasa de acá, y la compresión es el mecanismo que lo garantiza en cada turno.',
        },
        {
          type: 'code',
          value: `// context/budget.js
// Presupuesta la ventana por prioridad: primero lo que no puede caer,
// y el espacio que sobra se vuelve el presupuesto de los turnos viejos.

export function budgetContext(history, { windowLimit, reserveForReply }) {
  // El techo del contexto es el limite del modelo MENOS el espacio de la respuesta
  // y un margen de seguridad. Nunca uses el limite bruto.
  const budget = windowLimit - reserveForReply;

  // Siempre entran enteros, en orden de prioridad.
  const system = history.filter((t) => t.role === 'system');
  const anchors = history.filter((t) => t.pinned);       // hechos que no pueden caer
  const recent = takeRecentTurns(history, RECENT_KEEP);  // ultimos turnos, siempre crudos

  const fixedCost = tokenCount([...system, ...anchors, ...recent]);

  // Lo que sobra del presupuesto es para los turnos viejos, que seran comprimidos.
  const remaining = budget - fixedCost;
  const old = history.filter(
    (t) => !t.pinned && t.role !== 'system' && !recent.includes(t),
  );

  return { system, anchors, recent, old, remainingForOld: remaining };
}`,
        },
      ],
    },
    {
      title: 'Qué nunca debe comprimirse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La compresión solo es segura cuando existe una lista clara de lo que no puede tocar. La instrucción de sistema es la primera: define el comportamiento del bot y resumirla es arriesgar cambiar lo que el modelo hace. Después vienen las anclas, los hechos concretos que la conversación necesita cargar hasta el final, número de pedido, nombre del cliente, decisión tomada, valor acordado. Esos hechos no pueden volverse resumen porque un resumen es una reformulación, y reformular un número o un nombre es la forma más fácil de corromperlo. Y los turnos recientes quedan crudos porque son el contexto inmediato del próximo turno, aquello que el modelo necesita leer palabra por palabra para responder con coherencia. Todo lo que no está en esas tres categorías es candidato a la compresión; todo lo que está en ellas pasa intacto.',
        },
        {
          type: 'list',
          items: [
            'Instrucción de sistema: define el comportamiento del bot, resumir cambia lo que hace. Pasa siempre cruda.',
            'Anclas de hecho: número de pedido, nombre, valor, decisión, plazo. Hechos concretos que la conversación carga hasta el final y que un resumen corrompería al reformular.',
            'Turnos recientes: el contexto inmediato del próximo turno, necesita leerse palabra por palabra para mantener coherencia. Quedan crudos.',
            'Candidatos a la compresión: turnos viejos de baja señal, saludos, confirmaciones, digresiones, todo lo que ya cumplió su papel y puede volverse una línea de resumen.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Identificar las anclas es el paso que separa una compresión que preserva señal de una que destruye. Pueden marcarse de dos formas: explícitamente, cuando tu sistema sabe que un número de pedido o un dato de registro entró en la conversación y lo fija, o por extracción, cuando un paso dedicado lee el historial y saca los hechos concretos a una lista estructurada antes de comprimir el resto. Lo importante es que el ancla salga del flujo del texto comprimible y se vuelva un dato protegido, porque mientras esté mezclada con los saludos y las digresiones, el compresor no tiene cómo saber que ese número no puede reformularse.',
        },
      ],
    },
    {
      title: 'Resumir los turnos viejos en bloque',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con lo que no puede caer ya protegido, sobra el núcleo comprimible: los turnos viejos de baja señal. La técnica es resumir ese bloque en un texto corto que preserve el hilo de la conversación sin los detalles que ya no importan. En vez de diez turnos de ida y vuelta sobre un agendamiento que ya fue resuelto, una línea: "el cliente agendó para el martes y confirmó la dirección". El resumen no reemplaza a las anclas, que siguen crudas y aparte, solo cose el contexto narrativo que le da sentido a la conversación. Y la compresión puede ser jerárquica: los turnos quedan crudos, después se vuelven resúmenes de bloque, y resúmenes viejos pueden resumirse de nuevo en un resumen más alto, formando capas en las que el detalle disminuye conforme el turno envejece, pero el hilo nunca se rompe.',
        },
        {
          type: 'diagram',
          value: `Compresion por senal, no por edad

  historial completo (no entra en la ventana)
     |
     v
  +-----------------------------------------------+
  | instruccion de sistema     -> CRUDO (nunca comprime)
  | anclas (pedido, nombre...)  -> CRUDO (dato protegido)
  | turnos recientes (ultimos N)-> CRUDO (contexto inmediato)
  | turnos viejos baja senal    -> RESUMEN EN BLOQUE
  +-----------------------------------------------+
     |
     v
  contexto comprimido entra en el presupuesto
     |
     +-- turnos MUY viejos: resumen del resumen (capa mas alta)
     |
     v
  prompt final: sistema + anclas + resumen + recientes crudos
     (el hilo de la conversacion sobrevive, el detalle muerto sale)`,
        },
        {
          type: 'paragraph',
          value:
            'La compresión jerárquica es lo que permite que conversaciones realmente largas entren en una ventana fija sin olvidar el comienzo. Sin ella, tenés dos opciones malas: mantener todo crudo y reventar, o cortar por edad y perder el comienzo. Con ella, el comienzo de la conversación no desaparece, encoge: se vuelve una línea de resumen que todavía dice lo que se acordó, y esa línea sobrevive incluso después de cientos de turnos, porque ocupa casi nada. El detalle muerto sale, el hilo vivo queda. Es la diferencia entre un bot que "recuerda que la conversación empezó tratando de un reembolso" y un bot que solo sabe los últimos tres turnos y actúa como si la conversación hubiera empezado recién.',
        },
      ],
    },
    {
      title: 'El resumen que inventa un hecho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comprimir con un modelo tiene un riesgo que el corte por edad no tiene: el resumen puede inventar. Cuando le pedís a un modelo que resuma diez turnos, puede introducir un detalle que no estaba, cambiar un número, afirmar una decisión que la conversación no tomó. Y el peligro es que ese hecho inventado entra en el contexto como si fuera verdad y contamina todos los turnos siguientes, porque ahora el propio historial afirma algo falso, y el modelo pasa a razonar sobre eso. Una alucinación en un resumen de contexto es peor que una alucinación en una respuesta: la respuesta el usuario la ve y la corrige, el resumen queda silencioso en el historial envenenando el resto de la conversación. Por eso la compresión que usa modelo necesita un freno explícito.',
        },
        {
          type: 'paragraph',
          value:
            'El freno tiene tres partes. La primera es instruir al resumen a ser extractivo, no creativo: debe condensar lo que se dijo, no interpretar ni completar, y nunca introducir número, nombre o valor que no aparezca en el texto original. La segunda es mantener las anclas fuera del resumen: como los hechos concretos ya fueron extraídos y protegidos crudos, el resumen no necesita cargar ningún número, y un resumen que no tiene números no tiene cómo equivocar un número. La tercera es la verificación: cuando el costo lo justifica, un paso chequea que el resumen no introdujo un hecho ausente del original, comparando las anclas del resumen con las anclas extraídas. La regla que ancla todo es que la compresión nunca puede agregar información, solo remover; si el resumen dice algo que el original no decía, falló, por más fluido que suene.',
        },
        {
          type: 'code',
          value: `// context/summarize.js
// Resume los turnos viejos de forma extractiva y verifica que
// ningun hecho nuevo entro. La compresion solo REMUEVE, nunca AGREGA.

const COMPRESS_INSTRUCTION = \`
Condensa los turnos de abajo preservando el hilo de la conversacion.
Reglas: se extractivo, no interpretes ni completes.
NUNCA introduzcas numero, nombre, valor o decision que no este en el texto.
Los hechos concretos ya fueron extraidos aparte: no los repitas ni los inventes.
\`;

export async function compressOldTurns(oldTurns, anchors, model) {
  const summary = await model.summarize(COMPRESS_INSTRUCTION, oldTurns);

  // Verifica que el resumen no invento un hecho: ninguna ancla nueva
  // puede aparecer en el resumen que no estuviera en el original.
  const introduced = extractFacts(summary).filter(
    (fact) => !appearsIn(fact, oldTurns) && !anchors.includes(fact),
  );

  if (introduced.length > 0) {
    // El resumen alucino un hecho: lo descarta y cae a un corte conservador
    // en vez de envenenar el contexto con algo que la conversacion no dijo.
    return conservativeTrim(oldTurns);
  }

  return summary;
}`,
        },
      ],
    },
    {
      title: 'Medir si la compresión preserva la señal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La compresión es una decisión de intercambio: ganás espacio en la ventana y pagás en fidelidad al historial. Sin medir, no sabés hacia qué lado se inclina el intercambio, y una compresión demasiado agresiva degrada al bot de un modo que no aparece en ningún error inmediato, solo en un empeoramiento difuso de la calidad de las respuestas. La métrica central es la retención de anclas: después de comprimir, ¿los hechos que la conversación estableció siguen accesibles en el contexto? Armás un conjunto de conversaciones largas con hechos plantados al comienzo, aplicás la compresión y hacés preguntas cuya respuesta depende de esos hechos. Si el bot acierta, la compresión preservó la señal; si se equivoca, cortó algo que necesitaba sobrevivir, y ajustás lo que queda crudo o lo que se vuelve ancla.',
        },
        {
          type: 'ordered',
          items: [
            'Oráculo de anclas: armá conversaciones largas con hechos plantados y preguntá al final algo que dependa de ellos; medí cuántos el bot todavía acierta después de la compresión.',
            'Tasa de fidelidad del resumen: verificá que el resumen no introdujo un hecho ausente del original, con el paso de verificación como métrica continua, no solo como freno.',
            'Ocupación de la ventana: seguí cuánto del presupuesto consume cada categoría; si las anclas crecen sin límite, la extracción necesita priorizar o la conversación necesita un checkpoint.',
            'Señal por token: compará la calidad de la respuesta con y sin compresión en el mismo caso; la compresión solo vale si la caída de calidad es menor que la ganancia de entrar.',
            'Alerta de pérdida: registrá cuándo un turno es cortado o resumido y qué contenía, para reconstruir lo que se perdió cuando una conversación dé una respuesta equivocada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La compresión de contexto bien hecha es invisible: el bot mantiene conversaciones largas coherentes, recuerda lo que se acordó al comienzo y nunca revienta la ventana, y no percibís que por debajo hay un mecanismo constante decidiendo qué preservar crudo y qué condensar. La compresión mal hecha también es casi invisible, y ahí vive el riesgo: degrada la calidad de a poco, sin un error claro que apunte a la causa, hasta que alguien nota que el bot "está más tonto" sin saber por qué. La diferencia entre las dos no está en el código de la compresión, está en la medición: solo medir la retención de señal separa la compresión que ahorra ventana de la que silenciosamente tira a la basura la memoria de la conversación.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no basta con mantener solo los últimos mensajes de la conversación?',
      answer:
        'Porque la edad de un turno no mide su importancia. La ventana deslizante, mantener los últimos N turnos, asume que el más reciente es el más relevante, y eso es falso en una conversación real: el número de pedido dicho al comienzo, la decisión tomada en el medio y la instrucción de sistema en el tope son viejos y siguen siendo esenciales. Cortar por edad descarta esos fragmentos justamente por ser viejos, sin chequear si todavía son necesarios, y el resultado es un bot con amnesia, que responde bien los últimos turnos y se equivoca groseramente sobre hechos que la propia conversación ya estableció. La compresión que preserva señal separa dos preguntas que la ventana deslizante confunde en una sola, qué es reciente y qué es importante, y usa la importancia, no el reloj, como regla del corte.',
    },
    {
      question: '¿Comprimir contexto con un modelo no corre el riesgo de alucinar?',
      answer:
        'Lo corre, y es el riesgo más peligroso de la compresión, porque un hecho inventado en un resumen entra en el historial como verdad y contamina todos los turnos siguientes, silenciosamente, sin que el usuario lo vea y lo corrija como haría en una respuesta. El freno tiene tres partes: instruir al resumen a ser extractivo, condensar lo que se dijo sin interpretar ni introducir número, nombre o valor nuevo; mantener las anclas fuera del resumen, ya que los hechos concretos son extraídos y protegidos crudos aparte, así un resumen sin números no tiene cómo equivocar un número; y verificar que el resumen no introdujo un hecho ausente del original, cayendo a un corte conservador cuando lo hizo. La regla que ancla todo es que la compresión solo puede remover información, nunca agregar.',
    },
    {
      question: '¿Cómo saber si la compresión está preservando lo que importa?',
      answer:
        'Midiendo la retención de anclas, que es la señal que la conversación no puede perder. Armás un conjunto de conversaciones largas con hechos plantados al comienzo, aplicás la compresión y hacés preguntas cuya respuesta depende de esos hechos; si el bot acierta, la compresión preservó la señal, si se equivoca, cortó algo que necesitaba sobrevivir. Junto a eso, seguí la tasa de fidelidad del resumen con el paso de verificación, la ocupación de la ventana por categoría y la señal por token, comparando la calidad de la respuesta con y sin compresión en el mismo caso. Sin medir, una compresión demasiado agresiva degrada al bot de forma difusa, sin error inmediato que apunte a la causa, hasta que alguien nota que "está más tonto" sin saber por qué.',
    },
  ],
  conclusion: {
    title: 'Comprimir contexto es elegir la señal, no el reloj',
    description:
      'Entrar en la ventana sin perder lo que importa no es cortar los mensajes más viejos, es distinguir el turno de alta señal que tiene que sobrevivir del turno de baja señal que puede volverse una línea de resumen. Presupuestar la ventana en tokens, proteger crudas la instrucción de sistema, las anclas de hecho y los turnos recientes, resumir el resto de forma extractiva y verificada y medir la retención de señal transforma la ventana de contexto de un techo que trunca la conversación en un presupuesto que la conversación respeta. Puedo diseñar esa capa de compresión en tu sistema de IA, eligiendo qué queda crudo y qué se condensa, blindando el resumen contra alucinación y midiendo que el hilo de la conversación sobrevive, para que tu bot mantenga conversaciones largas sin amnesia ni reventón de ventana.',
    cta: 'Hablar sobre compresión de contexto en mi sistema de IA',
  },
  related: [
    { label: 'Chunking de documento para RAG sin perder contexto', to: '/blog/chunking-documento-rag-sem-perder-contexto' },
    { label: 'Memoria de largo plazo para agentes de atención', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'context-compression-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
