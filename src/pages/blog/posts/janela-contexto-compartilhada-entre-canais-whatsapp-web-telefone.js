// Conteudo do artigo: janela de contexto compartilhada entre canais, WhatsApp, web e telefone.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cliente explicou o problema inteiro no WhatsApp na terça, mandou o comprovante pelo chat do site na quarta e ligou na quinta. Do lado dele isso é uma conversa só. Do lado do seu sistema são três conversas que nunca se encontraram, e por isso ele contou a mesma história três vezes e ainda ouviu que não havia registro do comprovante. A tentação é resolver por identidade: achar que é a mesma pessoa e concatenar tudo num histórico único. Isso quebra em dois lugares ao mesmo tempo, porque telefone não é identidade e porque a janela do modelo não cresce quando o cliente fala mais. Este artigo mostra como construir a janela compartilhada de verdade: por que o canal precisa continuar existindo como dimensão, como vincular identidades sem confundir pessoas, como montar a janela por orçamento e não por concatenação, como escrever concorrente entre canais sem perder mensagem e como reconhecer o caso em que juntar contexto é a decisão errada.',
  sections: [
    {
      title: 'Continuidade não é concatenação: o que o cliente espera de fato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A frase que descreve o problema é sempre a mesma na reunião: o atendimento precisa lembrar do que foi falado no outro canal. O que quase nunca é discutido é o quanto precisa lembrar, e essa é a decisão que define a arquitetura inteira. O cliente não espera que o atendente por telefone recite o que ele digitou no chat, ele espera não ter que repetir o motivo do contato, o número do pedido e o que já foi tentado. São coisas diferentes: a primeira é transcrição, a segunda é estado. Sistemas que tentam entregar transcrição entre canais gastam contexto caro com histórico literal e ainda assim erram, porque a informação que importava estava diluída em quarenta mensagens de ida e volta.',
        },
        {
          type: 'paragraph',
          value:
            'A separação prática é entre três camadas com ciclos de vida diferentes. O fato durável é o que continua verdadeiro independentemente do canal e do tempo: o pedido em disputa, o endereço confirmado, a preferência de contato, a decisão já tomada pelo suporte. O resumo do episódio é o que aconteceu naquele atendimento específico, condensado em poucas frases assim que ele termina. E a transcrição bruta é o turno a turno, que serve para auditoria e para o operador humano ler, mas quase nunca precisa entrar no prompt de outro canal. Quem trata as três como se fossem a mesma coisa acaba enfiando transcrição em tudo, e é assim que uma conversa de dez minutos no telefone vira um prompt que não cabe na janela e ainda custa três vezes mais.',
        },
        {
          type: 'table',
          columns: ['Camada', 'Ciclo de vida', 'Entra no prompt de outro canal', 'Custo típico'],
          rows: [
            [
              'Fato durável',
              'Meses, até ser contradito',
              'Sempre, é o núcleo da continuidade',
              'Dezenas de tokens, cabe inteiro',
            ],
            [
              'Resumo do episódio',
              'Semanas, decai por relevância',
              'Os dois ou três mais recentes',
              'Centenas de tokens por episódio',
            ],
            [
              'Transcrição bruta',
              'Retenção legal, meses ou anos',
              'Raramente, só o episódio em curso',
              'Milhares de tokens, estoura rápido',
            ],
            [
              'Estado operacional',
              'Vida do ticket',
              'Sempre, define o que pode ser feito',
              'Dezenas de tokens, é estruturado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Essa tabela também responde por que a resposta ingênua falha em produção sem dar erro. Concatenar canais funciona no piloto porque o cliente de teste tem três mensagens em cada um. Com um cliente real de seis meses, o histórico cruzado passa de qualquer janela, e a estratégia de cortar os mais antigos apaga justamente o fato durável, que costuma ter sido dito no primeiro contato. O sistema fica pior que o desconectado: além de não lembrar, ele lembra da coisa errada com confiança.',
        },
      ],
    },
    {
      title: 'Vincular identidades sem juntar duas pessoas na mesma conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de compartilhar qualquer contexto é preciso decidir de quem ele é, e essa é a parte onde os erros são caros de forma assimétrica. Deixar de vincular o mesmo cliente entre canais custa uma repetição irritante. Vincular pessoas diferentes ao mesmo perfil vaza dado de uma para a outra, e no Brasil o número de telefone reciclado pela operadora torna isso comum o bastante para não ser um caso de borda. O celular que hoje é do seu cliente pode ter sido de outra pessoa há oito meses, e o WhatsApp Business vai entregar essa mensagem no mesmo identificador que você usou como chave.',
        },
        {
          type: 'paragraph',
          value:
            'O desenho que resolve isso é separar o identificador do canal da identidade da pessoa, com um nível de confiança em cada vínculo. O identificador do canal é o número de WhatsApp, o identificador anônimo do widget web, o número de origem da ligação. A identidade é o cliente no seu domínio. Entre os dois existe um vínculo com origem e força: vínculo confirmado por autenticação vale para tudo, vínculo inferido por coincidência de número vale para retomar o assunto do dia, e nunca para expor dado cadastral ou financeiro. A regra que evita o vazamento é simples de enunciar e precisa ser explícita no código: o que o vínculo fraco libera é continuidade de assunto, não acesso a dado.',
        },
        {
          type: 'code',
          value: `// identity-link.js
// Vinculo entre identificador de canal e identidade do cliente, com nivel
// de confianca. O nivel decide o que pode ser exposto, nao apenas se as
// conversas se juntam: numero reciclado pela operadora e caso comum.

export const LINK_STRENGTH = {
  AUTHENTICATED: 'authenticated', // login, OTP ou token de sessao valido
  DECLARED: 'declared',           // cliente informou pedido/CPF e conferiu
  INFERRED: 'inferred',           // mesmo numero, sem confirmacao ativa
};

const RANK = { inferred: 1, declared: 2, authenticated: 3 };

// Vinculo inferido expira rapido: apos esse prazo o mesmo numero volta a
// ser tratado como desconhecido ate nova confirmacao.
const INFERRED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const resolveIdentity = ({ channel, channelId, links, now }) => {
  const candidates = links
    .filter((link) => link.channel === channel && link.channelId === channelId)
    .filter((link) => {
      if (link.strength !== LINK_STRENGTH.INFERRED) return true;
      return now - link.confirmedAt <= INFERRED_MAX_AGE_MS;
    })
    .sort((a, b) => RANK[b.strength] - RANK[a.strength] || b.confirmedAt - a.confirmedAt);

  // Dois clientes distintos no mesmo identificador sem vinculo forte:
  // numero provavelmente trocou de dono. Nao adivinhe, pergunte.
  const distinct = new Set(candidates.map((link) => link.customerId));
  if (distinct.size > 1 && candidates[0].strength !== LINK_STRENGTH.AUTHENTICATED) {
    return { customerId: null, strength: null, needsDisambiguation: true };
  }

  const best = candidates[0];
  if (!best) return { customerId: null, strength: null, needsDisambiguation: false };
  return { customerId: best.customerId, strength: best.strength, needsDisambiguation: false };
};

// O que cada nivel libera. Vinculo fraco da continuidade de assunto,
// nunca dado cadastral, financeiro ou acao com efeito colateral.
const SCOPE_BY_STRENGTH = {
  inferred: ['episode_summary', 'open_ticket_subject'],
  declared: ['episode_summary', 'open_ticket_subject', 'order_status', 'durable_facts'],
  authenticated: [
    'episode_summary',
    'open_ticket_subject',
    'order_status',
    'durable_facts',
    'billing',
    'personal_data',
    'mutating_tools',
  ],
};

export const allowedScopes = (strength) => SCOPE_BY_STRENGTH[strength] ?? [];

export const canExpose = (strength, scope) => allowedScopes(strength).includes(scope);`,
        },
        {
          type: 'paragraph',
          value:
            'A checagem de identificador com mais de um cliente merece atenção porque é ela que transforma o vazamento em pergunta. Quando o mesmo número aparece ligado a duas identidades sem vínculo forte, o sistema não deve escolher a mais recente: deve tratar como desconhecido e pedir confirmação de um dado que só o titular sabe. Custa uma pergunta a mais no começo da conversa e evita o incidente que ninguém quer reportar. A expiração do vínculo inferido tem a mesma função no eixo do tempo, porque o número que ficou seis meses parado é justamente o que tem maior chance de ter mudado de dono.',
        },
      ],
    },
    {
      title: 'Montar a janela por orçamento, não por concatenação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Resolvida a identidade, a pergunta seguinte é o que vai no prompt. A resposta errada é tudo que couber, começando pelo mais recente, porque isso deixa a composição do contexto na mão do acaso: um cliente que mandou vinte áudios transcritos ontem apaga o fato relevante de três meses atrás. A composição precisa ser um orçamento com fatias reservadas por tipo de informação, e cada fatia é preenchida pela sua própria regra de prioridade. Assim, o pior caso deixa de ser a perda do que importa e passa a ser a perda de detalhe dentro de uma categoria.',
        },
        {
          type: 'diagram',
          value: `Orcamento de janela em atendimento multicanal (exemplo com 8k tokens)

  instrucao do sistema        800  fixo, nao negociavel
  estado operacional          400  ticket aberto, canal, permissoes
  fatos duraveis            1.200  ordenados por relevancia ao assunto atual
  resumo de episodios       1.600  ultimos episodios, qualquer canal
  episodio atual            3.200  turnos recentes deste canal, integral
  reserva de saida            800  nao usar, e o teto da resposta

Regra de preenchimento
  cada fatia so cede o que sobrou para a fatia seguinte, nunca puxa da anterior
  fato duravel nunca e cortado por idade, so por irrelevancia ao assunto
  episodio de outro canal entra resumido, nunca em transcricao
  se o episodio atual nao cabe, comprime o meio e preserva inicio e fim`,
        },
        {
          type: 'paragraph',
          value:
            'A regra de que uma fatia cede o excedente para a seguinte, mas nunca invade a anterior, é o que impede o efeito mais comum em produção: o histórico recente engolindo o espaço dos fatos. Ela também dá uma propriedade útil de operação, que é a previsibilidade do custo. Com fatias fixas, o token gasto por turno tem teto conhecido independentemente de quanto o cliente falou, e a fatura para de ser função do cliente mais falante. Sem isso, um único usuário com uma conversa de duzentos turnos define o custo médio da sua operação inteira.',
        },
        {
          type: 'code',
          value: `// context-window.js
// Montagem da janela por orcamento com fatias por tipo. Cada fatia gasta
// o que precisa e passa a sobra adiante; nenhuma invade a anterior.

const BUDGET = {
  systemInstruction: 800,
  operationalState: 400,
  durableFacts: 1200,
  episodeSummaries: 1600,
  currentEpisode: 3200,
};

// Aproximacao suficiente para orcamento. Use o tokenizer do provedor
// quando a margem importar mais que a latencia da contagem.
const estimateTokens = (text) => Math.ceil(text.length / 3.6);

const fill = (items, budget) => {
  const selected = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (used + cost > budget) continue; // pula o que nao cabe, segue tentando os menores
    selected.push(item);
    used += cost;
  }
  return { selected, used };
};

export const buildWindow = ({ channel, subject, state, facts, summaries, episode, scopes }) => {
  let spare = 0;

  // Fatos duraveis: ordenados por relevancia ao assunto atual, filtrados
  // pelo escopo que o nivel de vinculo autoriza a expor.
  const visibleFacts = facts
    .filter((fact) => scopes.includes(fact.scope))
    .sort((a, b) => relevance(b, subject) - relevance(a, subject));
  const factsFill = fill(visibleFacts, BUDGET.durableFacts);
  spare += BUDGET.durableFacts - factsFill.used;

  // Resumos de episodios: mais recentes primeiro, de qualquer canal.
  // O canal de origem entra no texto porque muda como a informacao e lida.
  const summaryItems = summaries
    .slice()
    .sort((a, b) => b.endedAt - a.endedAt)
    .map((item) => ({ ...item, text: \`[\${item.channel}] \${item.text}\` }));
  const summariesFill = fill(summaryItems, BUDGET.episodeSummaries + spare);
  spare = BUDGET.episodeSummaries + spare - summariesFill.used;

  // Episodio atual: preserva o inicio, onde o cliente disse o que quer,
  // e o fim, que e o estado da conversa. O meio e o que se comprime.
  const currentBudget = BUDGET.currentEpisode + spare;
  const current = compressMiddle(episode.turns, currentBudget, estimateTokens);

  return {
    channel,
    blocks: {
      state,
      facts: factsFill.selected,
      summaries: summariesFill.selected,
      turns: current.turns,
    },
    estimatedTokens:
      BUDGET.systemInstruction +
      BUDGET.operationalState +
      factsFill.used +
      summariesFill.used +
      current.used,
    droppedTurns: current.dropped,
  };
};

// Corta do meio para fora, mantendo os primeiros e os ultimos turnos.
const compressMiddle = (turns, budget, estimate) => {
  const costs = turns.map((turn) => estimate(turn.text));
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= budget) return { turns, used: total, dropped: 0 };

  const kept = [];
  let used = 0;
  let head = 0;
  let tail = turns.length - 1;

  // Alterna entre inicio e fim para nao enviesar o corte para um dos lados.
  while (head <= tail) {
    const takeTail = kept.length % 2 === 1;
    const index = takeTail ? tail : head;
    if (used + costs[index] > budget) break;
    kept.push({ index, turn: turns[index] });
    used += costs[index];
    if (takeTail) tail -= 1;
    else head += 1;
  }

  kept.sort((a, b) => a.index - b.index);
  return {
    turns: kept.map((item) => item.turn),
    used,
    dropped: turns.length - kept.length,
  };
};

const relevance = (fact, subject) => {
  const overlap = fact.tags.filter((tag) => subject.tags.includes(tag)).length;
  const ageDays = (Date.now() - fact.confirmedAt) / 86_400_000;
  return overlap * 10 - Math.log1p(ageDays);
};`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe do canal de origem entrar no texto do resumo não é cosmético. O modelo precisa saber que aquele trecho veio do telefone para tratar a transcrição com a incerteza que ela merece, e precisa saber que veio do chat web para confiar no número de pedido que foi digitado. Sem essa marca, a transcrição imprecisa de um áudio ruim entra no prompt com o mesmo peso de um dado que o cliente conferiu na tela, e o modelo repete o erro com confiança total.',
        },
      ],
    },
    {
      title: 'Escrita concorrente entre canais: o cliente pode estar em dois ao mesmo tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O caso que quebra a implementação simples não é o cliente que troca de canal, é o que usa dois ao mesmo tempo. Ele está na ligação com o atendente e enquanto isso manda a foto do produto pelo WhatsApp, ou pergunta no chat web enquanto o bot ainda está processando a mensagem anterior do WhatsApp. Se o estado compartilhado é lido, modificado e escrito por cada canal sem coordenação, a última escrita apaga a outra em silêncio: o fato que o atendente acabou de registrar some porque o bot gravou por cima com uma versão do estado lida cinco segundos antes.',
        },
        {
          type: 'paragraph',
          value:
            'A solução que se paga é modelar o estado compartilhado como fatos apensados com versão, e não como um documento sobrescrito. Cada canal escreve um fato novo com o carimbo de origem e de tempo, e a leitura resolve o conflito na hora de montar a janela, aplicando a regra de precedência do domínio. Isso evita o bloqueio distribuído no caminho quente e ainda deixa a divergência visível em vez de silenciosa. A ordenação por tempo do servidor resolve a maioria dos casos, e a exceção que merece regra explícita é a contradição entre canais de confiança diferente.',
        },
        {
          type: 'list',
          items: [
            'Fato confirmado por autenticação vence fato inferido, independentemente de qual chegou depois, porque um foi conferido e o outro foi deduzido.',
            'Entre fatos de mesma força, o mais recente vence, usando o carimbo do servidor e não o do dispositivo, que pode estar com relógio errado ou fora de ordem por fila.',
            'Contradição direta em campo sensível, como endereço de entrega ou dado de pagamento, não se resolve sozinha: marca o campo como em disputa e força confirmação no próximo turno.',
            'Ação com efeito colateral, como emitir segunda via ou cancelar pedido, precisa de chave de idempotência que inclua a identidade e não o canal, senão a mesma ação disparada de dois canais executa duas vezes.',
            'Episódio ainda aberto em outro canal entra na janela como estado, não como histórico, para que o modelo saiba que existe um atendimento humano em curso e não tente resolver por conta própria.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último item é o que mais melhora a experiência percebida com menos código. Um bot que responde no WhatsApp enquanto o cliente está falando com um humano no telefone produz respostas conflitantes na mesma janela de dois minutos, e o cliente conclui, com razão, que a empresa não fala com ela mesma. Saber que existe um episódio ativo em outro canal permite a resposta certa, que é reconhecer o atendimento em curso e não competir com ele.',
        },
      ],
    },
    {
      title: 'O canal continua importando depois de compartilhar o contexto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compartilhar o contexto não significa apagar a diferença entre os canais, e o erro simétrico ao de não compartilhar nada é tratar tudo como se fosse a mesma superfície. Cada canal tem restrição própria de formato, de latência e de confiabilidade da entrada, e essas restrições precisam entrar na montagem do prompt junto com o histórico. A resposta correta no chat web, com lista de opções e um link, é uma resposta ruim quando lida em voz alta pelo telefone, e o mesmo texto de trezentas palavras que funciona na web vira quatro balões que o cliente não lê no WhatsApp.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'WhatsApp', 'Chat web', 'Telefone'],
          rows: [
            [
              'Confiabilidade da entrada',
              'Alta em texto, média em áudio transcrito',
              'Alta, o cliente confere o que digitou',
              'Média, transcrição erra número e nome próprio',
            ],
            [
              'Formato da resposta',
              'Curto, sem markdown, quebra em poucos balões',
              'Estruturado, aceita lista, tabela e link',
              'Frase falada, sem enumeração longa nem URL',
            ],
            [
              'Tolerância de latência',
              'Segundos, conversa é assíncrona',
              'Poucos segundos, cliente está olhando',
              'Menos de um segundo, silêncio é falha',
            ],
            [
              'Sessão',
              'Não existe fim explícito, some por inatividade',
              'Termina quando fecha a aba',
              'Termina no desligar, sem despedida garantida',
            ],
            [
              'Confirmação de dado sensível',
              'Pode pedir digitação, texto fica registrado',
              'Ideal, permite formulário e mascaramento',
              'Evitar, número falado em voz vaza no ambiente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha da confiabilidade da entrada é a que mais gera bug sutil. Quando um número de pedido chega pela transcrição de uma ligação, ele deve entrar no contexto marcado como não confirmado, e a primeira coisa a fazer é validar contra a base antes de tratá-lo como fato durável. Sem essa marca, o número transcrito errado vira fato, contamina os episódios seguintes em todos os canais e o cliente passa a ser atendido sobre um pedido que não é o dele. Corrigir isso depois é mais difícil do que parece, porque o fato errado já foi propagado como se fosse verdade estabelecida.',
        },
      ],
    },
    {
      title: 'Quando não compartilhar é a decisão certa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe um conjunto de situações em que a continuidade entre canais é um defeito, e vale enunciá-las porque a pressão natural do projeto é compartilhar sempre mais. A primeira é o canal com nível de autenticação mais fraco: trazer para o WhatsApp inferido o assunto de um atendimento que foi autenticado no aplicativo expõe informação a quem tiver o aparelho na mão, e isso inclui o cenário mundano do celular emprestado. A segunda é o contexto que envelheceu: retomar automaticamente um assunto de quatro meses atrás porque o cliente escreveu oi é pior do que perguntar, e produz aquele atendimento que insiste em um problema que já foi resolvido por outro caminho.',
        },
        {
          type: 'ordered',
          items: [
            'Canal de destino com vínculo mais fraco que o de origem: compartilha apenas o assunto em aberto, sem dado cadastral, financeiro ou histórico de reclamação.',
            'Episódio encerrado com resolução há mais de noventa dias: fica disponível para busca, mas não entra na janela por padrão, porque a probabilidade de o cliente estar voltando naquele assunto é baixa.',
            'Assunto marcado como sensível pelo domínio, como jurídico, saúde ou disputa de cobrança: exige confirmação explícita do cliente antes de aparecer em outro canal, mesmo com identidade autenticada.',
            'Atendimento em canal compartilhado por natureza, como um telefone fixo de empresa ou um WhatsApp de setor: o vínculo por identificador não pode ser inferido, porque a pessoa por trás muda a cada ligação.',
            'Cliente que pediu explicitamente para tratar o assunto de forma separada: a preferência é um fato durável e precisa ser respeitada pela montagem da janela, não apenas registrada no CRM.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quarto item costuma passar despercebido até virar incidente. Um número de WhatsApp de um setor de uma empresa cliente recebe mensagens de pessoas diferentes ao longo do dia, e o vínculo inferido por identificador junta todas na mesma identidade. O sintoma aparece como um bot que confunde solicitações, e a causa é ter tratado um identificador compartilhado como se fosse pessoal. A saída é marcar esses identificadores explicitamente no cadastro e exigir identificação por turno neles, o que é uma fricção aceitável em um contexto onde ela já é esperada.',
        },
      ],
    },
    {
      title: 'Verificar que a continuidade funciona antes do cliente testar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Continuidade entre canais é o tipo de funcionalidade que passa em todos os testes unitários e falha no primeiro uso real, porque o que quebra está nas junções e não nas partes. O teste que importa cruza canal, tempo e identidade ao mesmo tempo, e ele precisa ser automatizado, senão só será executado quando alguém lembrar. Vale montar um conjunto pequeno de cenários ponta a ponta que exercitem exatamente os pontos onde a arquitetura pode falhar em silêncio.',
        },
        {
          type: 'ordered',
          items: [
            'Retomada simples: abre um episódio no WhatsApp com um fato durável, encerra, abre outro no chat web e confirme que o fato aparece na janela e a transcrição do primeiro não aparece.',
            'Concorrência entre canais: escreva um fato pelo canal A e outro contraditório pelo canal B na mesma janela de segundos, e verifique que nenhum dos dois sumiu e que a precedência aplicada foi a do domínio, não a da ordem de chegada.',
            'Número reciclado: registre dois clientes distintos no mesmo identificador com vínculo inferido e confirme que o sistema pede desambiguação em vez de escolher o mais recente.',
            'Estouro de orçamento: injete um episódio com centenas de turnos e verifique que os fatos duráveis continuam na janela, que o corte aconteceu no meio do episódio atual e que o total estimado respeitou o teto.',
            'Escopo por força de vínculo: com vínculo inferido, confirme que o assunto em aberto aparece e que nenhum campo de dado pessoal ou financeiro entrou no prompt, inspecionando o payload final e não a resposta.',
            'Episódio ativo em paralelo: com um atendimento humano em andamento no telefone, envie uma mensagem no WhatsApp e verifique que o bot reconhece o atendimento em curso em vez de responder por conta própria.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quinto cenário merece ser escrito contra o payload que sai para o provedor, e não contra o texto que o cliente recebe. É perfeitamente possível que o modelo não mencione o dado pessoal na resposta e ele tenha ido no prompt do mesmo jeito, e nesse caso o vazamento já aconteceu: o dado saiu do seu perímetro, está no log de requisição e possivelmente no cache de prompt do provedor. O teste que olha só a resposta passa e a auditoria reprova. Verificar no payload transforma uma discussão de política em uma asserção que quebra o build.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Dá para simplesmente concatenar o histórico dos canais em um prompt só?',
      answer:
        'Funciona no piloto e falha em produção, sem dar erro, que é o pior modo de falhar. O cliente de teste tem três mensagens em cada canal, e o cliente real de seis meses tem um histórico cruzado que estoura qualquer janela. Quando estoura, a estratégia usual de cortar o mais antigo apaga justamente o fato durável, porque ele quase sempre foi dito no primeiro contato, e o sistema fica pior do que estaria desconectado: não lembra do que importa e lembra do irrelevante com total confiança. O caminho que funciona é separar três camadas com ciclos de vida diferentes, que são o fato durável, o resumo do episódio e a transcrição bruta, e montar a janela com fatias de orçamento reservadas para cada uma. A transcrição de outro canal quase nunca precisa entrar, o resumo entra quase sempre e o fato durável nunca é cortado por idade, apenas por irrelevância ao assunto atual. Com fatias fixas o custo por turno também ganha teto conhecido, em vez de ser definido pelo cliente mais falante da base.',
    },
    {
      question: 'Como evitar juntar duas pessoas no mesmo contexto quando o número de telefone é reciclado?',
      answer:
        'Separando o identificador do canal da identidade da pessoa e anexando uma força a cada vínculo. O número de WhatsApp, o identificador do widget web e o número de origem da ligação são identificadores de canal; o cliente é a identidade. O vínculo entre eles tem origem: autenticado por login ou token, declarado quando o cliente informou um dado e ele conferiu, ou inferido por coincidência de identificador. A regra que evita o vazamento é que vínculo fraco libera continuidade de assunto e nunca acesso a dado cadastral, financeiro ou ação com efeito colateral. Além disso, o vínculo inferido precisa expirar, porque o identificador parado por meses é o que tem maior chance de ter mudado de dono, e quando o mesmo identificador aparece ligado a duas identidades sem vínculo forte o sistema deve tratar como desconhecido e pedir confirmação de um dado que só o titular sabe, em vez de escolher a identidade mais recente. Vale também marcar no cadastro os identificadores compartilhados por natureza, como o WhatsApp de um setor, onde a inferência nunca é válida.',
    },
    {
      question: 'O que acontece se o cliente usar dois canais ao mesmo tempo?',
      answer:
        'É o caso que quebra a implementação ingênua, porque cada canal lê o estado compartilhado, modifica e escreve de volta, e a última escrita apaga a outra em silêncio. A saída que se paga é modelar o estado como fatos apensados com versão e carimbo de origem, em vez de um documento sobrescrito: cada canal escreve um fato novo e o conflito é resolvido na leitura, quando a janela é montada, aplicando a precedência do domínio. Fato autenticado vence fato inferido independentemente de qual chegou depois; entre fatos de mesma força vence o mais recente pelo relógio do servidor; e contradição direta em campo sensível, como endereço de entrega, não se resolve sozinha, marca o campo como em disputa e força confirmação no próximo turno. Duas consequências operacionais completam o desenho: chave de idempotência de ação com efeito colateral deve incluir a identidade e não o canal, senão a mesma ação disparada dos dois lados executa duas vezes, e o episódio aberto em outro canal precisa entrar na janela como estado, para que o bot reconheça o atendimento humano em curso em vez de competir com ele.',
    },
  ],
  conclusion: {
    title: 'Continuidade é estado compartilhado, não histórico empilhado',
    description:
      'Janela de contexto compartilhada entre canais não se resolve concatenando conversas, se resolve decidindo o que é fato durável, o que é resumo de episódio e o que é transcrição descartável, e montando a janela por orçamento com fatias reservadas para cada camada. Em volta disso, três decisões definem se o sistema ajuda ou vaza: vínculo de identidade com força explícita que limita o escopo exposto, estado apensado com precedência de domínio em vez de documento sobrescrito, e o reconhecimento de que o canal continua importando na hora de formatar e de confiar na entrada. Posso desenhar e implementar esse contexto compartilhado no seu atendimento com WhatsApp, web e telefone, para que o cliente pare de repetir a mesma história em cada canal sem que isso vire vazamento entre pessoas.',
    cta: 'Falar sobre contexto compartilhado no meu atendimento',
  },
  related: [
    { label: 'Memória de longo prazo em agentes de atendimento', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Compressão de contexto: caber mais na janela sem perder sinal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Handoff humano em atendimento com WhatsApp e IA', to: '/blog/handoff-humano-whatsapp-ia' },
  ],
};

const en = {
  intro:
    'The customer explained the whole problem on WhatsApp on Tuesday, sent the receipt through the website chat on Wednesday and called on Thursday. On their side that is one conversation. On your system side it is three conversations that never met, which is why they told the same story three times and were still told there was no record of the receipt. The temptation is to solve it by identity: assume it is the same person and concatenate everything into one history. That breaks in two places at once, because a phone number is not an identity and because the model window does not grow when the customer talks more. This article shows how to build the shared window properly: why the channel has to stay a dimension, how to link identities without merging people, how to assemble the window by budget instead of concatenation, how to write concurrently across channels without losing anything and how to recognize the case where sharing context is the wrong call.',
  sections: [
    {
      title: 'Continuity is not concatenation: what the customer actually expects',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The sentence that describes the problem is always the same in the meeting: support has to remember what was said on the other channel. What almost never gets discussed is how much it has to remember, and that is the decision that defines the whole architecture. The customer does not expect the phone agent to recite what they typed into the chat, they expect not to have to repeat the reason for contact, the order number and what has already been tried. Those are different things: the first is transcript, the second is state. Systems that try to deliver transcripts across channels burn expensive context on literal history and still get it wrong, because the information that mattered was diluted across forty back-and-forth messages.',
        },
        {
          type: 'paragraph',
          value:
            'The practical separation is into three layers with different lifecycles. A durable fact is what stays true regardless of channel and time: the disputed order, the confirmed address, the contact preference, the decision support already made. An episode summary is what happened in that particular interaction, condensed into a few sentences as soon as it ends. And the raw transcript is the turn-by-turn record, useful for auditing and for a human operator to read, but it almost never needs to enter another channel prompt. Whoever treats the three as the same thing ends up stuffing transcripts everywhere, and that is how a ten-minute phone call becomes a prompt that does not fit the window and costs three times more on top.',
        },
        {
          type: 'table',
          columns: ['Layer', 'Lifecycle', 'Enters another channel prompt', 'Typical cost'],
          rows: [
            [
              'Durable fact',
              'Months, until contradicted',
              'Always, it is the core of continuity',
              'Tens of tokens, fits whole',
            ],
            [
              'Episode summary',
              'Weeks, decays by relevance',
              'The two or three most recent ones',
              'Hundreds of tokens per episode',
            ],
            [
              'Raw transcript',
              'Legal retention, months or years',
              'Rarely, only the ongoing episode',
              'Thousands of tokens, overflows fast',
            ],
            [
              'Operational state',
              'Lifetime of the ticket',
              'Always, it defines what can be done',
              'Tens of tokens, it is structured',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'That table also answers why the naive approach fails in production without raising an error. Concatenating channels works in the pilot because the test customer has three messages on each one. With a real customer of six months, the cross-channel history exceeds any window, and the strategy of cutting the oldest deletes precisely the durable fact, which was usually stated in the first contact. The system ends up worse than the disconnected one: on top of not remembering, it remembers the wrong thing with confidence.',
        },
      ],
    },
    {
      title: 'Linking identities without merging two people into one conversation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before sharing any context you have to decide whose it is, and that is the part where mistakes are expensive asymmetrically. Failing to link the same customer across channels costs an annoying repetition. Linking different people to the same profile leaks data from one to the other, and carrier-recycled phone numbers make that common enough not to be an edge case. The mobile number that today belongs to your customer may have belonged to somebody else eight months ago, and WhatsApp Business will deliver that message under the very identifier you used as a key.',
        },
        {
          type: 'paragraph',
          value:
            'The design that solves this separates the channel identifier from the person identity, with a confidence level on each link. The channel identifier is the WhatsApp number, the anonymous web widget id, the calling number. The identity is the customer in your domain. Between the two sits a link with an origin and a strength: a link confirmed by authentication is good for everything, a link inferred from a matching identifier is good for resuming the topic of the day and never for exposing account or financial data. The rule that prevents the leak is simple to state and has to be explicit in code: what a weak link unlocks is topic continuity, not data access.',
        },
        {
          type: 'code',
          value: `// identity-link.js
// Link between a channel identifier and a customer identity, with a
// confidence level. The level decides what can be exposed, not merely
// whether conversations merge: carrier-recycled numbers are common.

export const LINK_STRENGTH = {
  AUTHENTICATED: 'authenticated', // login, OTP or valid session token
  DECLARED: 'declared',           // customer stated order/tax id and it checked out
  INFERRED: 'inferred',           // same identifier, no active confirmation
};

const RANK = { inferred: 1, declared: 2, authenticated: 3 };

// An inferred link expires quickly: after this age the same identifier is
// treated as unknown again until a new confirmation.
const INFERRED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const resolveIdentity = ({ channel, channelId, links, now }) => {
  const candidates = links
    .filter((link) => link.channel === channel && link.channelId === channelId)
    .filter((link) => {
      if (link.strength !== LINK_STRENGTH.INFERRED) return true;
      return now - link.confirmedAt <= INFERRED_MAX_AGE_MS;
    })
    .sort((a, b) => RANK[b.strength] - RANK[a.strength] || b.confirmedAt - a.confirmedAt);

  // Two distinct customers on the same identifier with no strong link:
  // the number probably changed hands. Do not guess, ask.
  const distinct = new Set(candidates.map((link) => link.customerId));
  if (distinct.size > 1 && candidates[0].strength !== LINK_STRENGTH.AUTHENTICATED) {
    return { customerId: null, strength: null, needsDisambiguation: true };
  }

  const best = candidates[0];
  if (!best) return { customerId: null, strength: null, needsDisambiguation: false };
  return { customerId: best.customerId, strength: best.strength, needsDisambiguation: false };
};

// What each level unlocks. A weak link grants topic continuity, never
// account data, financial data or an action with side effects.
const SCOPE_BY_STRENGTH = {
  inferred: ['episode_summary', 'open_ticket_subject'],
  declared: ['episode_summary', 'open_ticket_subject', 'order_status', 'durable_facts'],
  authenticated: [
    'episode_summary',
    'open_ticket_subject',
    'order_status',
    'durable_facts',
    'billing',
    'personal_data',
    'mutating_tools',
  ],
};

export const allowedScopes = (strength) => SCOPE_BY_STRENGTH[strength] ?? [];

export const canExpose = (strength, scope) => allowedScopes(strength).includes(scope);`,
        },
        {
          type: 'paragraph',
          value:
            'The check for an identifier bound to more than one customer deserves attention because it is what turns a leak into a question. When the same number shows up linked to two identities with no strong link, the system should not pick the most recent one: it should treat it as unknown and ask for confirmation of something only the account holder knows. It costs one extra question at the start of the conversation and avoids the incident nobody wants to report. Expiring the inferred link serves the same purpose along the time axis, because the number that sat idle for six months is exactly the one most likely to have changed hands.',
        },
      ],
    },
    {
      title: 'Assemble the window by budget, not by concatenation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With identity resolved, the next question is what goes into the prompt. The wrong answer is everything that fits, starting from the most recent, because that leaves context composition to chance: a customer who sent twenty transcribed voice notes yesterday erases the relevant fact from three months ago. Composition has to be a budget with slices reserved per information type, and each slice is filled by its own priority rule. That way the worst case stops being the loss of what matters and becomes the loss of detail within a category.',
        },
        {
          type: 'diagram',
          value: `Window budget in multichannel support (example with 8k tokens)

  system instruction          800  fixed, not negotiable
  operational state           400  open ticket, channel, permissions
  durable facts             1,200  ordered by relevance to the current topic
  episode summaries         1,600  latest episodes, any channel
  current episode           3,200  recent turns of this channel, verbatim
  output reserve              800  do not use, it is the answer ceiling

Filling rule
  each slice only passes leftovers forward, never takes from the previous one
  a durable fact is never cut by age, only by irrelevance to the topic
  another channel episode enters summarized, never as a transcript
  if the current episode does not fit, compress the middle, keep start and end`,
        },
        {
          type: 'paragraph',
          value:
            'The rule that a slice passes its surplus forward but never invades the previous one is what prevents the most common production effect: recent history swallowing the space meant for facts. It also gives a useful operational property, which is cost predictability. With fixed slices, tokens spent per turn have a known ceiling regardless of how much the customer talked, and the invoice stops being a function of your chattiest customer. Without it, a single user with a two hundred turn conversation sets the average cost of your entire operation.',
        },
        {
          type: 'code',
          value: `// context-window.js
// Budget-based window assembly with slices per type. Each slice spends
// what it needs and passes the surplus forward; none invades the previous.

const BUDGET = {
  systemInstruction: 800,
  operationalState: 400,
  durableFacts: 1200,
  episodeSummaries: 1600,
  currentEpisode: 3200,
};

// Good enough approximation for budgeting. Use the provider tokenizer
// when the margin matters more than the latency of counting.
const estimateTokens = (text) => Math.ceil(text.length / 3.6);

const fill = (items, budget) => {
  const selected = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (used + cost > budget) continue; // skip what does not fit, keep trying smaller ones
    selected.push(item);
    used += cost;
  }
  return { selected, used };
};

export const buildWindow = ({ channel, subject, state, facts, summaries, episode, scopes }) => {
  let spare = 0;

  // Durable facts: ordered by relevance to the current topic, filtered by
  // the scope the link strength authorizes exposing.
  const visibleFacts = facts
    .filter((fact) => scopes.includes(fact.scope))
    .sort((a, b) => relevance(b, subject) - relevance(a, subject));
  const factsFill = fill(visibleFacts, BUDGET.durableFacts);
  spare += BUDGET.durableFacts - factsFill.used;

  // Episode summaries: most recent first, from any channel. The origin
  // channel goes into the text because it changes how the info is read.
  const summaryItems = summaries
    .slice()
    .sort((a, b) => b.endedAt - a.endedAt)
    .map((item) => ({ ...item, text: \`[\${item.channel}] \${item.text}\` }));
  const summariesFill = fill(summaryItems, BUDGET.episodeSummaries + spare);
  spare = BUDGET.episodeSummaries + spare - summariesFill.used;

  // Current episode: keep the beginning, where the customer said what they
  // want, and the end, which is the state of the conversation. The middle
  // is what gets compressed.
  const currentBudget = BUDGET.currentEpisode + spare;
  const current = compressMiddle(episode.turns, currentBudget, estimateTokens);

  return {
    channel,
    blocks: {
      state,
      facts: factsFill.selected,
      summaries: summariesFill.selected,
      turns: current.turns,
    },
    estimatedTokens:
      BUDGET.systemInstruction +
      BUDGET.operationalState +
      factsFill.used +
      summariesFill.used +
      current.used,
    droppedTurns: current.dropped,
  };
};

// Cuts from the middle outward, keeping the first and the last turns.
const compressMiddle = (turns, budget, estimate) => {
  const costs = turns.map((turn) => estimate(turn.text));
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= budget) return { turns, used: total, dropped: 0 };

  const kept = [];
  let used = 0;
  let head = 0;
  let tail = turns.length - 1;

  // Alternates between start and end so the cut is not biased to one side.
  while (head <= tail) {
    const takeTail = kept.length % 2 === 1;
    const index = takeTail ? tail : head;
    if (used + costs[index] > budget) break;
    kept.push({ index, turn: turns[index] });
    used += costs[index];
    if (takeTail) tail -= 1;
    else head += 1;
  }

  kept.sort((a, b) => a.index - b.index);
  return {
    turns: kept.map((item) => item.turn),
    used,
    dropped: turns.length - kept.length,
  };
};

const relevance = (fact, subject) => {
  const overlap = fact.tags.filter((tag) => subject.tags.includes(tag)).length;
  const ageDays = (Date.now() - fact.confirmedAt) / 86_400_000;
  return overlap * 10 - Math.log1p(ageDays);
};`,
        },
        {
          type: 'paragraph',
          value:
            'Putting the origin channel into the summary text is not cosmetic. The model needs to know that a passage came from the phone so it treats the transcription with the uncertainty it deserves, and it needs to know that a passage came from the web chat so it can trust the order number that was typed in. Without that marker, the sloppy transcription of a bad audio enters the prompt with the same weight as a value the customer checked on screen, and the model repeats the error with full confidence.',
        },
      ],
    },
    {
      title: 'Concurrent writes across channels: the customer can be on two at once',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The case that breaks the simple implementation is not the customer switching channels, it is the one using two at once. They are on the call with the agent and meanwhile send the product photo over WhatsApp, or they ask something in the web chat while the bot is still processing the previous WhatsApp message. If the shared state is read, modified and written by each channel without coordination, the last write silently erases the other: the fact the agent just recorded disappears because the bot overwrote it with a version of the state read five seconds earlier.',
        },
        {
          type: 'paragraph',
          value:
            'The approach that pays off is modeling the shared state as appended, versioned facts rather than an overwritten document. Each channel writes a new fact with an origin and time stamp, and reading resolves the conflict when the window is assembled, applying the domain precedence rule. That avoids distributed locking on the hot path and leaves divergence visible instead of silent. Ordering by server time solves most cases, and the exception that deserves an explicit rule is a contradiction between channels of different trust.',
        },
        {
          type: 'list',
          items: [
            'A fact confirmed by authentication beats an inferred fact, regardless of which arrived later, because one was verified and the other was deduced.',
            'Between facts of equal strength, the most recent wins, using the server stamp and not the device one, which may have a wrong clock or arrive out of order through a queue.',
            'A direct contradiction in a sensitive field, such as the delivery address or payment data, does not resolve itself: it marks the field as disputed and forces confirmation on the next turn.',
            'An action with side effects, such as issuing a duplicate invoice or cancelling an order, needs an idempotency key that includes the identity and not the channel, otherwise the same action fired from two channels runs twice.',
            'An episode still open on another channel enters the window as state, not as history, so the model knows a human interaction is in progress and does not try to solve it on its own.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last item improves perceived experience the most with the least code. A bot answering on WhatsApp while the customer is talking to a human on the phone produces conflicting answers within the same two-minute window, and the customer concludes, rightly, that the company does not talk to itself. Knowing that an active episode exists on another channel enables the right answer, which is acknowledging the ongoing interaction rather than competing with it.',
        },
      ],
    },
    {
      title: 'The channel still matters after you share the context',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sharing context does not mean erasing the difference between channels, and the mistake symmetric to sharing nothing is treating everything as the same surface. Each channel has its own constraints on format, latency and input reliability, and those constraints have to enter prompt assembly alongside the history. The correct answer in the web chat, with a list of options and a link, is a bad answer when read aloud on the phone, and the same three hundred word text that works on the web becomes four bubbles the customer does not read on WhatsApp.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'WhatsApp', 'Web chat', 'Phone'],
          rows: [
            [
              'Input reliability',
              'High for text, medium for transcribed audio',
              'High, the customer checks what they typed',
              'Medium, transcription misses digits and names',
            ],
            [
              'Answer format',
              'Short, no markdown, split into few bubbles',
              'Structured, accepts lists, tables and links',
              'Spoken sentence, no long enumeration or URL',
            ],
            [
              'Latency tolerance',
              'Seconds, the conversation is asynchronous',
              'A few seconds, the customer is watching',
              'Under a second, silence reads as failure',
            ],
            [
              'Session',
              'No explicit end, fades by inactivity',
              'Ends when the tab is closed',
              'Ends on hang-up, no goodbye guaranteed',
            ],
            [
              'Sensitive data confirmation',
              'Can ask for typing, the text stays on record',
              'Ideal, allows a form and masking',
              'Avoid, a number spoken aloud leaks in the room',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The input reliability row is the one that produces the subtlest bug. When an order number arrives through a call transcription, it must enter the context marked as unconfirmed, and the first thing to do is validate it against the database before treating it as a durable fact. Without that marker, the badly transcribed number becomes a fact, contaminates the following episodes on every channel and the customer starts being served about an order that is not theirs. Fixing that later is harder than it sounds, because the wrong fact has already propagated as established truth.',
        },
      ],
    },
    {
      title: 'When not sharing is the right call',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a set of situations where cross-channel continuity is a defect, and it is worth stating them because the natural pressure of the project is always to share more. The first is a channel with a weaker authentication level: bringing into an inferred WhatsApp the topic of an interaction that was authenticated in the app exposes information to whoever holds the handset, and that includes the mundane scenario of a borrowed phone. The second is context that has aged: automatically resuming a topic from four months ago because the customer wrote hello is worse than asking, and it produces that interaction which insists on a problem already solved through another path.',
        },
        {
          type: 'ordered',
          items: [
            'Destination channel with a weaker link than the origin: share only the open topic, without account data, financial data or complaint history.',
            'Episode closed with a resolution more than ninety days ago: it stays available for search, but does not enter the window by default, because the odds of the customer returning to that topic are low.',
            'Topic marked as sensitive by the domain, such as legal, health or a billing dispute: it requires explicit customer confirmation before showing up on another channel, even with an authenticated identity.',
            'Interaction on a channel that is shared by nature, such as a company landline or a departmental WhatsApp: the link by identifier cannot be inferred, because the person behind it changes with every call.',
            'A customer who explicitly asked to keep a topic separate: that preference is a durable fact and has to be honored by window assembly, not merely recorded in the CRM.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth item usually goes unnoticed until it becomes an incident. A departmental WhatsApp number at a client company receives messages from different people throughout the day, and the identifier-inferred link merges them all into the same identity. The symptom shows up as a bot confusing requests, and the cause is having treated a shared identifier as a personal one. The way out is flagging those identifiers explicitly in the registry and requiring per-turn identification on them, which is acceptable friction in a context where it is already expected.',
        },
      ],
    },
    {
      title: 'Verify that continuity works before the customer tests it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cross-channel continuity is the kind of feature that passes every unit test and fails on first real use, because what breaks lives in the joints and not in the parts. The test that matters crosses channel, time and identity at once, and it has to be automated, otherwise it will only run when somebody remembers. It is worth assembling a small set of end-to-end scenarios that exercise exactly the points where the architecture can fail silently.',
        },
        {
          type: 'ordered',
          items: [
            'Simple resumption: open an episode on WhatsApp with a durable fact, close it, open another in the web chat and confirm the fact appears in the window while the first transcript does not.',
            'Cross-channel concurrency: write a fact through channel A and a contradictory one through channel B within the same few seconds, and verify neither disappeared and that the precedence applied was the domain one, not arrival order.',
            'Recycled number: register two distinct customers on the same identifier with inferred links and confirm the system asks for disambiguation instead of picking the most recent.',
            'Budget overflow: inject an episode with hundreds of turns and verify the durable facts are still in the window, that the cut happened in the middle of the current episode and that the estimated total respected the ceiling.',
            'Scope by link strength: with an inferred link, confirm the open topic appears and that no personal or financial field entered the prompt, inspecting the final payload and not the answer.',
            'Parallel active episode: with a human interaction in progress on the phone, send a WhatsApp message and verify the bot acknowledges the ongoing interaction instead of answering on its own.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth scenario deserves to be written against the payload that leaves for the provider, not against the text the customer receives. It is perfectly possible for the model not to mention the personal data in its answer while the data went into the prompt anyway, and in that case the leak already happened: it left your perimeter, it is in the request log and possibly in the provider prompt cache. A test that only looks at the answer passes and the audit fails. Checking the payload turns a policy discussion into an assertion that breaks the build.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can you just concatenate the channel histories into a single prompt?',
      answer:
        'It works in the pilot and fails in production without raising an error, which is the worst way to fail. The test customer has three messages on each channel, and the real six-month customer has a cross-channel history that exceeds any window. When it overflows, the usual strategy of cutting the oldest deletes precisely the durable fact, because it was almost always stated in the first contact, and the system ends up worse than a disconnected one: it does not remember what matters and it remembers the irrelevant with full confidence. The path that works is separating three layers with different lifecycles, which are the durable fact, the episode summary and the raw transcript, and assembling the window with budget slices reserved for each one. Another channel transcript almost never needs to enter, the summary enters almost always, and the durable fact is never cut by age, only by irrelevance to the current topic. With fixed slices the cost per turn also gains a known ceiling, instead of being defined by the chattiest customer in the base.',
    },
    {
      question: 'How do you avoid merging two people into the same context when a phone number is recycled?',
      answer:
        'By separating the channel identifier from the person identity and attaching a strength to each link. The WhatsApp number, the web widget id and the calling number are channel identifiers; the customer is the identity. The link between them has an origin: authenticated by login or token, declared when the customer stated a value and it checked out, or inferred from a matching identifier. The rule that prevents the leak is that a weak link unlocks topic continuity and never access to account data, financial data or an action with side effects. On top of that, the inferred link has to expire, because an identifier idle for months is the one most likely to have changed hands, and when the same identifier appears bound to two identities with no strong link the system should treat it as unknown and ask for confirmation of something only the account holder knows, instead of picking the most recent identity. It is also worth flagging in the registry the identifiers that are shared by nature, such as a departmental WhatsApp, where inference is never valid.',
    },
    {
      question: 'What happens if the customer uses two channels at the same time?',
      answer:
        'That is the case that breaks the naive implementation, because each channel reads the shared state, modifies it and writes it back, and the last write silently erases the other. The approach that pays off is modeling the state as appended facts with a version and an origin stamp, instead of an overwritten document: each channel writes a new fact and the conflict is resolved on read, when the window is assembled, applying domain precedence. An authenticated fact beats an inferred one regardless of which arrived later; between facts of equal strength the most recent wins by the server clock; and a direct contradiction in a sensitive field, such as the delivery address, does not resolve itself, it marks the field as disputed and forces confirmation on the next turn. Two operational consequences complete the design: the idempotency key for an action with side effects must include the identity and not the channel, otherwise the same action fired from both sides runs twice, and an episode open on another channel has to enter the window as state, so the bot acknowledges the ongoing human interaction instead of competing with it.',
    },
  ],
  conclusion: {
    title: 'Continuity is shared state, not stacked history',
    description:
      'A context window shared across channels is not solved by concatenating conversations, it is solved by deciding what is a durable fact, what is an episode summary and what is a disposable transcript, then assembling the window by budget with slices reserved for each layer. Around that, three decisions define whether the system helps or leaks: an identity link with an explicit strength that bounds the exposed scope, appended state with domain precedence instead of an overwritten document, and the recognition that the channel still matters when formatting the answer and when trusting the input. I can design and implement this shared context in your WhatsApp, web and phone support, so the customer stops repeating the same story on every channel without that turning into a leak between people.',
    cta: 'Talk about shared context in my support',
  },
  related: [
    { label: 'Long-term memory in support agents', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Context compression: fitting more in the window without losing signal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Human handoff in WhatsApp support with AI', to: '/blog/handoff-humano-whatsapp-ia' },
  ],
};

const es = {
  intro:
    'El cliente explicó el problema entero por WhatsApp el martes, mandó el comprobante por el chat del sitio el miércoles y llamó el jueves. De su lado eso es una sola conversación. Del lado de tu sistema son tres conversaciones que nunca se encontraron, y por eso contó la misma historia tres veces y encima escuchó que no había registro del comprobante. La tentación es resolverlo por identidad: suponer que es la misma persona y concatenar todo en un historial único. Eso se rompe en dos lugares a la vez, porque un teléfono no es una identidad y porque la ventana del modelo no crece cuando el cliente habla más. Este artículo muestra cómo construir la ventana compartida de verdad: por qué el canal tiene que seguir existiendo como dimensión, cómo vincular identidades sin confundir personas, cómo armar la ventana por presupuesto y no por concatenación, cómo escribir de forma concurrente entre canales sin perder nada y cómo reconocer el caso en que compartir contexto es la decisión equivocada.',
  sections: [
    {
      title: 'Continuidad no es concatenación: qué espera el cliente en realidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La frase que describe el problema es siempre la misma en la reunión: la atención tiene que acordarse de lo que se habló en el otro canal. Lo que casi nunca se discute es cuánto tiene que acordarse, y esa es la decisión que define la arquitectura entera. El cliente no espera que el agente telefónico recite lo que él escribió en el chat, espera no tener que repetir el motivo del contacto, el número de pedido y lo que ya se intentó. Son cosas distintas: la primera es transcripción, la segunda es estado. Los sistemas que intentan entregar transcripción entre canales gastan contexto caro en historial literal y aun así se equivocan, porque la información que importaba estaba diluida en cuarenta mensajes de ida y vuelta.',
        },
        {
          type: 'paragraph',
          value:
            'La separación práctica es en tres capas con ciclos de vida distintos. El hecho durable es lo que sigue siendo verdad independientemente del canal y del tiempo: el pedido en disputa, la dirección confirmada, la preferencia de contacto, la decisión que soporte ya tomó. El resumen del episodio es lo que pasó en esa atención específica, condensado en pocas frases apenas termina. Y la transcripción cruda es el turno a turno, que sirve para auditoría y para que el operador humano lo lea, pero casi nunca necesita entrar en el prompt de otro canal. Quien trata las tres como si fueran lo mismo termina metiendo transcripción en todo, y así una llamada de diez minutos se convierte en un prompt que no entra en la ventana y encima cuesta tres veces más.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Ciclo de vida', 'Entra en el prompt de otro canal', 'Costo típico'],
          rows: [
            [
              'Hecho durable',
              'Meses, hasta ser contradicho',
              'Siempre, es el núcleo de la continuidad',
              'Decenas de tokens, entra completo',
            ],
            [
              'Resumen del episodio',
              'Semanas, decae por relevancia',
              'Los dos o tres más recientes',
              'Cientos de tokens por episodio',
            ],
            [
              'Transcripción cruda',
              'Retención legal, meses o años',
              'Rara vez, solo el episodio en curso',
              'Miles de tokens, se desborda rápido',
            ],
            [
              'Estado operativo',
              'Vida del ticket',
              'Siempre, define qué se puede hacer',
              'Decenas de tokens, es estructurado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esa tabla también responde por qué la respuesta ingenua falla en producción sin dar error. Concatenar canales funciona en el piloto porque el cliente de prueba tiene tres mensajes en cada uno. Con un cliente real de seis meses, el historial cruzado supera cualquier ventana, y la estrategia de cortar lo más antiguo borra justamente el hecho durable, que suele haber sido dicho en el primer contacto. El sistema queda peor que el desconectado: además de no acordarse, se acuerda de lo equivocado con confianza.',
        },
      ],
    },
    {
      title: 'Vincular identidades sin juntar dos personas en la misma conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de compartir cualquier contexto hay que decidir de quién es, y esa es la parte donde los errores son caros de forma asimétrica. No vincular al mismo cliente entre canales cuesta una repetición molesta. Vincular personas distintas al mismo perfil filtra dato de una a la otra, y el número de teléfono reciclado por la operadora vuelve eso lo bastante común como para no ser un caso de borde. El celular que hoy es de tu cliente pudo haber sido de otra persona hace ocho meses, y WhatsApp Business va a entregar ese mensaje bajo el mismo identificador que usaste como clave.',
        },
        {
          type: 'paragraph',
          value:
            'El diseño que resuelve esto separa el identificador del canal de la identidad de la persona, con un nivel de confianza en cada vínculo. El identificador del canal es el número de WhatsApp, el identificador anónimo del widget web, el número de origen de la llamada. La identidad es el cliente en tu dominio. Entre los dos hay un vínculo con origen y fuerza: vínculo confirmado por autenticación sirve para todo, vínculo inferido por coincidencia de identificador sirve para retomar el asunto del día y nunca para exponer dato de cuenta o financiero. La regla que evita la filtración es simple de enunciar y tiene que estar explícita en el código: lo que el vínculo débil habilita es continuidad de asunto, no acceso a dato.',
        },
        {
          type: 'code',
          value: `// identity-link.js
// Vinculo entre identificador de canal e identidad del cliente, con nivel
// de confianza. El nivel decide que se puede exponer, no solo si las
// conversaciones se juntan: el numero reciclado por la operadora es comun.

export const LINK_STRENGTH = {
  AUTHENTICATED: 'authenticated', // login, OTP o token de sesion valido
  DECLARED: 'declared',           // el cliente informo pedido/documento y coincidio
  INFERRED: 'inferred',           // mismo identificador, sin confirmacion activa
};

const RANK = { inferred: 1, declared: 2, authenticated: 3 };

// El vinculo inferido expira rapido: pasado ese plazo el mismo identificador
// vuelve a tratarse como desconocido hasta una nueva confirmacion.
const INFERRED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const resolveIdentity = ({ channel, channelId, links, now }) => {
  const candidates = links
    .filter((link) => link.channel === channel && link.channelId === channelId)
    .filter((link) => {
      if (link.strength !== LINK_STRENGTH.INFERRED) return true;
      return now - link.confirmedAt <= INFERRED_MAX_AGE_MS;
    })
    .sort((a, b) => RANK[b.strength] - RANK[a.strength] || b.confirmedAt - a.confirmedAt);

  // Dos clientes distintos en el mismo identificador sin vinculo fuerte:
  // el numero probablemente cambio de dueno. No adivines, pregunta.
  const distinct = new Set(candidates.map((link) => link.customerId));
  if (distinct.size > 1 && candidates[0].strength !== LINK_STRENGTH.AUTHENTICATED) {
    return { customerId: null, strength: null, needsDisambiguation: true };
  }

  const best = candidates[0];
  if (!best) return { customerId: null, strength: null, needsDisambiguation: false };
  return { customerId: best.customerId, strength: best.strength, needsDisambiguation: false };
};

// Que habilita cada nivel. El vinculo debil da continuidad de asunto, nunca
// dato de cuenta, financiero o accion con efecto colateral.
const SCOPE_BY_STRENGTH = {
  inferred: ['episode_summary', 'open_ticket_subject'],
  declared: ['episode_summary', 'open_ticket_subject', 'order_status', 'durable_facts'],
  authenticated: [
    'episode_summary',
    'open_ticket_subject',
    'order_status',
    'durable_facts',
    'billing',
    'personal_data',
    'mutating_tools',
  ],
};

export const allowedScopes = (strength) => SCOPE_BY_STRENGTH[strength] ?? [];

export const canExpose = (strength, scope) => allowedScopes(strength).includes(scope);`,
        },
        {
          type: 'paragraph',
          value:
            'La verificación de un identificador ligado a más de un cliente merece atención porque es la que convierte la filtración en pregunta. Cuando el mismo número aparece ligado a dos identidades sin vínculo fuerte, el sistema no debe elegir la más reciente: debe tratarlo como desconocido y pedir confirmación de un dato que solo el titular sabe. Cuesta una pregunta más al comienzo de la conversación y evita el incidente que nadie quiere reportar. La expiración del vínculo inferido cumple la misma función en el eje del tiempo, porque el número que estuvo seis meses quieto es justamente el que tiene más chance de haber cambiado de dueño.',
        },
      ],
    },
    {
      title: 'Armar la ventana por presupuesto, no por concatenación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Resuelta la identidad, la pregunta siguiente es qué va en el prompt. La respuesta equivocada es todo lo que entre, empezando por lo más reciente, porque eso deja la composición del contexto en manos del azar: un cliente que mandó veinte audios transcritos ayer borra el hecho relevante de hace tres meses. La composición tiene que ser un presupuesto con porciones reservadas por tipo de información, y cada porción se llena con su propia regla de prioridad. Así, el peor caso deja de ser la pérdida de lo que importa y pasa a ser la pérdida de detalle dentro de una categoría.',
        },
        {
          type: 'diagram',
          value: `Presupuesto de ventana en atencion multicanal (ejemplo con 8k tokens)

  instruccion del sistema     800  fijo, no negociable
  estado operativo            400  ticket abierto, canal, permisos
  hechos durables           1.200  ordenados por relevancia al asunto actual
  resumenes de episodios    1.600  ultimos episodios, cualquier canal
  episodio actual           3.200  turnos recientes de este canal, integral
  reserva de salida           800  no usar, es el techo de la respuesta

Regla de llenado
  cada porcion solo cede lo que sobro a la siguiente, nunca toma de la anterior
  un hecho durable nunca se corta por edad, solo por irrelevancia al asunto
  el episodio de otro canal entra resumido, nunca en transcripcion
  si el episodio actual no entra, comprime el medio y preserva inicio y fin`,
        },
        {
          type: 'paragraph',
          value:
            'La regla de que una porción cede el excedente a la siguiente, pero nunca invade la anterior, es lo que impide el efecto más común en producción: el historial reciente comiéndose el espacio de los hechos. También da una propiedad útil de operación, que es la previsibilidad del costo. Con porciones fijas, el token gastado por turno tiene techo conocido sin importar cuánto habló el cliente, y la factura deja de ser función del cliente más hablador. Sin eso, un solo usuario con una conversación de doscientos turnos define el costo promedio de toda tu operación.',
        },
        {
          type: 'code',
          value: `// context-window.js
// Armado de la ventana por presupuesto con porciones por tipo. Cada porcion
// gasta lo que necesita y pasa la sobra; ninguna invade a la anterior.

const BUDGET = {
  systemInstruction: 800,
  operationalState: 400,
  durableFacts: 1200,
  episodeSummaries: 1600,
  currentEpisode: 3200,
};

// Aproximacion suficiente para presupuestar. Usa el tokenizer del proveedor
// cuando el margen importe mas que la latencia del conteo.
const estimateTokens = (text) => Math.ceil(text.length / 3.6);

const fill = (items, budget) => {
  const selected = [];
  let used = 0;
  for (const item of items) {
    const cost = estimateTokens(item.text);
    if (used + cost > budget) continue; // salta lo que no entra y sigue con los menores
    selected.push(item);
    used += cost;
  }
  return { selected, used };
};

export const buildWindow = ({ channel, subject, state, facts, summaries, episode, scopes }) => {
  let spare = 0;

  // Hechos durables: ordenados por relevancia al asunto actual, filtrados
  // por el alcance que el nivel de vinculo autoriza a exponer.
  const visibleFacts = facts
    .filter((fact) => scopes.includes(fact.scope))
    .sort((a, b) => relevance(b, subject) - relevance(a, subject));
  const factsFill = fill(visibleFacts, BUDGET.durableFacts);
  spare += BUDGET.durableFacts - factsFill.used;

  // Resumenes de episodios: mas recientes primero, de cualquier canal. El
  // canal de origen entra en el texto porque cambia como se lee el dato.
  const summaryItems = summaries
    .slice()
    .sort((a, b) => b.endedAt - a.endedAt)
    .map((item) => ({ ...item, text: \`[\${item.channel}] \${item.text}\` }));
  const summariesFill = fill(summaryItems, BUDGET.episodeSummaries + spare);
  spare = BUDGET.episodeSummaries + spare - summariesFill.used;

  // Episodio actual: preserva el inicio, donde el cliente dijo lo que quiere,
  // y el final, que es el estado de la conversacion. El medio es lo que se
  // comprime.
  const currentBudget = BUDGET.currentEpisode + spare;
  const current = compressMiddle(episode.turns, currentBudget, estimateTokens);

  return {
    channel,
    blocks: {
      state,
      facts: factsFill.selected,
      summaries: summariesFill.selected,
      turns: current.turns,
    },
    estimatedTokens:
      BUDGET.systemInstruction +
      BUDGET.operationalState +
      factsFill.used +
      summariesFill.used +
      current.used,
    droppedTurns: current.dropped,
  };
};

// Corta del medio hacia afuera, manteniendo los primeros y los ultimos turnos.
const compressMiddle = (turns, budget, estimate) => {
  const costs = turns.map((turn) => estimate(turn.text));
  const total = costs.reduce((a, b) => a + b, 0);
  if (total <= budget) return { turns, used: total, dropped: 0 };

  const kept = [];
  let used = 0;
  let head = 0;
  let tail = turns.length - 1;

  // Alterna entre inicio y final para no sesgar el corte hacia un lado.
  while (head <= tail) {
    const takeTail = kept.length % 2 === 1;
    const index = takeTail ? tail : head;
    if (used + costs[index] > budget) break;
    kept.push({ index, turn: turns[index] });
    used += costs[index];
    if (takeTail) tail -= 1;
    else head += 1;
  }

  kept.sort((a, b) => a.index - b.index);
  return {
    turns: kept.map((item) => item.turn),
    used,
    dropped: turns.length - kept.length,
  };
};

const relevance = (fact, subject) => {
  const overlap = fact.tags.filter((tag) => subject.tags.includes(tag)).length;
  const ageDays = (Date.now() - fact.confirmedAt) / 86_400_000;
  return overlap * 10 - Math.log1p(ageDays);
};`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle de que el canal de origen entre en el texto del resumen no es cosmético. El modelo necesita saber que ese fragmento vino del teléfono para tratar la transcripción con la incertidumbre que merece, y necesita saber que vino del chat web para confiar en el número de pedido que fue tecleado. Sin esa marca, la transcripción imprecisa de un audio malo entra en el prompt con el mismo peso que un dato que el cliente verificó en pantalla, y el modelo repite el error con total confianza.',
        },
      ],
    },
    {
      title: 'Escritura concurrente entre canales: el cliente puede estar en dos a la vez',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El caso que rompe la implementación simple no es el cliente que cambia de canal, es el que usa dos a la vez. Está en la llamada con el agente y mientras tanto manda la foto del producto por WhatsApp, o pregunta en el chat web mientras el bot todavía procesa el mensaje anterior de WhatsApp. Si el estado compartido se lee, se modifica y se escribe desde cada canal sin coordinación, la última escritura borra la otra en silencio: el hecho que el agente acaba de registrar desaparece porque el bot escribió encima con una versión del estado leída cinco segundos antes.',
        },
        {
          type: 'paragraph',
          value:
            'La solución que se paga sola es modelar el estado compartido como hechos agregados con versión, y no como un documento sobrescrito. Cada canal escribe un hecho nuevo con sello de origen y de tiempo, y la lectura resuelve el conflicto al armar la ventana, aplicando la regla de precedencia del dominio. Eso evita el bloqueo distribuido en el camino caliente y además deja la divergencia visible en vez de silenciosa. El orden por tiempo del servidor resuelve la mayoría de los casos, y la excepción que merece regla explícita es la contradicción entre canales de confianza distinta.',
        },
        {
          type: 'list',
          items: [
            'Un hecho confirmado por autenticación gana a uno inferido, sin importar cuál llegó después, porque uno fue verificado y el otro fue deducido.',
            'Entre hechos de la misma fuerza gana el más reciente, usando el sello del servidor y no el del dispositivo, que puede tener el reloj mal o llegar fuera de orden por la cola.',
            'La contradicción directa en un campo sensible, como dirección de entrega o dato de pago, no se resuelve sola: marca el campo como en disputa y fuerza confirmación en el próximo turno.',
            'Una acción con efecto colateral, como emitir un duplicado o cancelar un pedido, necesita clave de idempotencia que incluya la identidad y no el canal, si no la misma acción disparada desde dos canales se ejecuta dos veces.',
            'Un episodio todavía abierto en otro canal entra en la ventana como estado, no como historial, para que el modelo sepa que hay una atención humana en curso y no intente resolverla por su cuenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último punto es el que más mejora la experiencia percibida con menos código. Un bot que responde por WhatsApp mientras el cliente habla con un humano por teléfono produce respuestas en conflicto dentro de la misma ventana de dos minutos, y el cliente concluye, con razón, que la empresa no habla consigo misma. Saber que existe un episodio activo en otro canal habilita la respuesta correcta, que es reconocer la atención en curso y no competir con ella.',
        },
      ],
    },
    {
      title: 'El canal sigue importando después de compartir el contexto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Compartir el contexto no significa borrar la diferencia entre los canales, y el error simétrico al de no compartir nada es tratar todo como si fuera la misma superficie. Cada canal tiene restricciones propias de formato, de latencia y de confiabilidad de la entrada, y esas restricciones tienen que entrar en el armado del prompt junto con el historial. La respuesta correcta en el chat web, con lista de opciones y un enlace, es una respuesta mala cuando se lee en voz alta por teléfono, y el mismo texto de trescientas palabras que funciona en la web se vuelve cuatro globos que el cliente no lee en WhatsApp.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'WhatsApp', 'Chat web', 'Teléfono'],
          rows: [
            [
              'Confiabilidad de la entrada',
              'Alta en texto, media en audio transcrito',
              'Alta, el cliente verifica lo que escribió',
              'Media, la transcripción falla en dígitos y nombres',
            ],
            [
              'Formato de la respuesta',
              'Corto, sin markdown, en pocos globos',
              'Estructurado, acepta lista, tabla y enlace',
              'Frase hablada, sin enumeración larga ni URL',
            ],
            [
              'Tolerancia de latencia',
              'Segundos, la conversación es asíncrona',
              'Pocos segundos, el cliente está mirando',
              'Menos de un segundo, el silencio es falla',
            ],
            [
              'Sesión',
              'No hay fin explícito, se apaga por inactividad',
              'Termina al cerrar la pestaña',
              'Termina al colgar, sin despedida garantizada',
            ],
            [
              'Confirmación de dato sensible',
              'Puede pedir tecleo, el texto queda registrado',
              'Ideal, permite formulario y enmascarado',
              'Evitar, un número dicho en voz se filtra en el ambiente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila de la confiabilidad de la entrada es la que genera el bug más sutil. Cuando un número de pedido llega por la transcripción de una llamada, tiene que entrar en el contexto marcado como no confirmado, y lo primero es validarlo contra la base antes de tratarlo como hecho durable. Sin esa marca, el número mal transcrito se vuelve hecho, contamina los episodios siguientes en todos los canales y el cliente pasa a ser atendido sobre un pedido que no es el suyo. Corregir eso después es más difícil de lo que parece, porque el hecho equivocado ya se propagó como verdad establecida.',
        },
      ],
    },
    {
      title: 'Cuándo no compartir es la decisión correcta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay un conjunto de situaciones en las que la continuidad entre canales es un defecto, y vale enunciarlas porque la presión natural del proyecto es compartir siempre más. La primera es el canal con nivel de autenticación más débil: llevar a un WhatsApp inferido el asunto de una atención que fue autenticada en la app expone información a quien tenga el aparato en la mano, y eso incluye el escenario mundano del celular prestado. La segunda es el contexto que envejeció: retomar automáticamente un asunto de hace cuatro meses porque el cliente escribió hola es peor que preguntar, y produce esa atención que insiste en un problema que ya se resolvió por otro camino.',
        },
        {
          type: 'ordered',
          items: [
            'Canal de destino con vínculo más débil que el de origen: comparte solo el asunto abierto, sin dato de cuenta, financiero ni historial de reclamos.',
            'Episodio cerrado con resolución hace más de noventa días: queda disponible para búsqueda, pero no entra en la ventana por defecto, porque la probabilidad de que el cliente vuelva a ese asunto es baja.',
            'Asunto marcado como sensible por el dominio, como legal, salud o disputa de cobro: exige confirmación explícita del cliente antes de aparecer en otro canal, incluso con identidad autenticada.',
            'Atención en un canal compartido por naturaleza, como una línea fija de empresa o un WhatsApp de un sector: el vínculo por identificador no se puede inferir, porque la persona detrás cambia en cada llamada.',
            'Cliente que pidió explícitamente tratar el asunto por separado: la preferencia es un hecho durable y tiene que ser respetada por el armado de la ventana, no solo registrada en el CRM.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El cuarto punto suele pasar desapercibido hasta que se vuelve incidente. Un número de WhatsApp de un sector de una empresa cliente recibe mensajes de personas distintas a lo largo del día, y el vínculo inferido por identificador las junta a todas en la misma identidad. El síntoma aparece como un bot que confunde solicitudes, y la causa es haber tratado un identificador compartido como si fuera personal. La salida es marcar esos identificadores explícitamente en el registro y exigir identificación por turno en ellos, lo que es una fricción aceptable en un contexto donde ya se espera.',
        },
      ],
    },
    {
      title: 'Verificar que la continuidad funciona antes de que el cliente la pruebe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La continuidad entre canales es el tipo de funcionalidad que pasa todos los tests unitarios y falla en el primer uso real, porque lo que se rompe está en las junturas y no en las partes. El test que importa cruza canal, tiempo e identidad a la vez, y tiene que estar automatizado, si no solo se va a ejecutar cuando alguien se acuerde. Vale armar un conjunto pequeño de escenarios punta a punta que ejerciten exactamente los puntos donde la arquitectura puede fallar en silencio.',
        },
        {
          type: 'ordered',
          items: [
            'Retomada simple: abre un episodio en WhatsApp con un hecho durable, ciérralo, abre otro en el chat web y confirma que el hecho aparece en la ventana y que la transcripción del primero no aparece.',
            'Concurrencia entre canales: escribe un hecho por el canal A y otro contradictorio por el canal B en la misma ventana de segundos, y verifica que ninguno desapareció y que la precedencia aplicada fue la del dominio, no la del orden de llegada.',
            'Número reciclado: registra dos clientes distintos en el mismo identificador con vínculo inferido y confirma que el sistema pide desambiguación en vez de elegir el más reciente.',
            'Desborde de presupuesto: inyecta un episodio con cientos de turnos y verifica que los hechos durables siguen en la ventana, que el corte ocurrió en el medio del episodio actual y que el total estimado respetó el techo.',
            'Alcance por fuerza del vínculo: con vínculo inferido, confirma que el asunto abierto aparece y que ningún campo de dato personal o financiero entró en el prompt, inspeccionando el payload final y no la respuesta.',
            'Episodio activo en paralelo: con una atención humana en curso por teléfono, envía un mensaje por WhatsApp y verifica que el bot reconoce la atención en marcha en vez de responder por su cuenta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El quinto escenario merece escribirse contra el payload que sale hacia el proveedor, y no contra el texto que recibe el cliente. Es perfectamente posible que el modelo no mencione el dato personal en la respuesta y que el dato haya ido en el prompt igual, y en ese caso la filtración ya ocurrió: salió de tu perímetro, está en el log de la petición y posiblemente en el cache de prompt del proveedor. El test que mira solo la respuesta pasa y la auditoría reprueba. Verificar en el payload convierte una discusión de política en una aserción que rompe el build.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Se puede simplemente concatenar el historial de los canales en un solo prompt?',
      answer:
        'Funciona en el piloto y falla en producción sin dar error, que es la peor forma de fallar. El cliente de prueba tiene tres mensajes en cada canal, y el cliente real de seis meses tiene un historial cruzado que supera cualquier ventana. Cuando se desborda, la estrategia habitual de cortar lo más antiguo borra justamente el hecho durable, porque casi siempre se dijo en el primer contacto, y el sistema queda peor que uno desconectado: no se acuerda de lo que importa y se acuerda de lo irrelevante con total confianza. El camino que funciona es separar tres capas con ciclos de vida distintos, que son el hecho durable, el resumen del episodio y la transcripción cruda, y armar la ventana con porciones de presupuesto reservadas para cada una. La transcripción de otro canal casi nunca necesita entrar, el resumen entra casi siempre y el hecho durable nunca se corta por edad, solo por irrelevancia al asunto actual. Con porciones fijas el costo por turno también gana un techo conocido, en vez de quedar definido por el cliente más hablador de la base.',
    },
    {
      question: '¿Cómo evitar juntar a dos personas en el mismo contexto cuando el número de teléfono es reciclado?',
      answer:
        'Separando el identificador del canal de la identidad de la persona y adjuntando una fuerza a cada vínculo. El número de WhatsApp, el identificador del widget web y el número de origen de la llamada son identificadores de canal; el cliente es la identidad. El vínculo entre ellos tiene origen: autenticado por login o token, declarado cuando el cliente informó un dato y coincidió, o inferido por coincidencia de identificador. La regla que evita la filtración es que el vínculo débil habilita continuidad de asunto y nunca acceso a dato de cuenta, financiero o acción con efecto colateral. Además, el vínculo inferido tiene que expirar, porque un identificador quieto durante meses es el que más chance tiene de haber cambiado de dueño, y cuando el mismo identificador aparece ligado a dos identidades sin vínculo fuerte el sistema debe tratarlo como desconocido y pedir confirmación de un dato que solo el titular sabe, en vez de elegir la identidad más reciente. También vale marcar en el registro los identificadores compartidos por naturaleza, como el WhatsApp de un sector, donde la inferencia nunca es válida.',
    },
    {
      question: '¿Qué pasa si el cliente usa dos canales al mismo tiempo?',
      answer:
        'Ese es el caso que rompe la implementación ingenua, porque cada canal lee el estado compartido, lo modifica y lo escribe de vuelta, y la última escritura borra la otra en silencio. La salida que se paga sola es modelar el estado como hechos agregados con versión y sello de origen, en vez de un documento sobrescrito: cada canal escribe un hecho nuevo y el conflicto se resuelve en la lectura, al armar la ventana, aplicando la precedencia del dominio. Un hecho autenticado gana a uno inferido sin importar cuál llegó después; entre hechos de la misma fuerza gana el más reciente por el reloj del servidor; y la contradicción directa en un campo sensible, como la dirección de entrega, no se resuelve sola, marca el campo como en disputa y fuerza confirmación en el próximo turno. Dos consecuencias operativas completan el diseño: la clave de idempotencia de una acción con efecto colateral debe incluir la identidad y no el canal, si no la misma acción disparada desde ambos lados se ejecuta dos veces, y el episodio abierto en otro canal tiene que entrar en la ventana como estado, para que el bot reconozca la atención humana en curso en vez de competir con ella.',
    },
  ],
  conclusion: {
    title: 'Continuidad es estado compartido, no historial apilado',
    description:
      'La ventana de contexto compartida entre canales no se resuelve concatenando conversaciones, se resuelve decidiendo qué es hecho durable, qué es resumen de episodio y qué es transcripción descartable, y armando la ventana por presupuesto con porciones reservadas para cada capa. Alrededor de eso, tres decisiones definen si el sistema ayuda o filtra: vínculo de identidad con fuerza explícita que limita el alcance expuesto, estado agregado con precedencia de dominio en vez de documento sobrescrito, y el reconocimiento de que el canal sigue importando a la hora de formatear y de confiar en la entrada. Puedo diseñar e implementar ese contexto compartido en tu atención con WhatsApp, web y teléfono, para que el cliente deje de repetir la misma historia en cada canal sin que eso se convierta en filtración entre personas.',
    cta: 'Hablar sobre contexto compartido en mi atención',
  },
  related: [
    { label: 'Memoria de largo plazo en agentes de atención', to: '/blog/memoria-longo-prazo-agentes-atendimento' },
    { label: 'Compresión de contexto: caber más en la ventana sin perder señal', to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal' },
    { label: 'Handoff humano en atención con WhatsApp e IA', to: '/blog/handoff-humano-whatsapp-ia' },
  ],
};

export default {
  pt,
  en,
  es,
};
