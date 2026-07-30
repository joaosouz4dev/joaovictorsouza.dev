// Conteudo do artigo: modo degradado, manter o atendimento de pe sem a IA.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Máquina de níveis de degradação para atendimento com IA: classifica a falha por tipo, transiciona entre pleno, reduzido, roteador e recado com histerese e tempo mínimo em cada nível, escolhe a resposta disponível em cada modo e sonda a recuperação com uma fração do tráfego antes de voltar ao nível anterior.',
  en: 'Degradation level machine for AI-powered support: classifies the failure by type, transitions between full, reduced, router and message modes with hysteresis and a minimum dwell time per level, picks the available answer for each mode and probes recovery with a fraction of traffic before stepping back up.',
  es: 'Máquina de niveles de degradación para atención con IA: clasifica el fallo por tipo, transiciona entre pleno, reducido, enrutador y recado con histéresis y tiempo mínimo en cada nivel, elige la respuesta disponible en cada modo y sondea la recuperación con una fracción del tráfico antes de volver al nivel anterior.',
};

const repoUrl = 'https://github.com/joaosouz4dev/degraded-mode-machine';

const pt = {
  intro:
    'O provedor de LLM cai, e a pergunta que decide a qualidade do seu atendimento naquele momento não é técnica, é de produto: o que o cliente vê. Sem plano, ele vê um erro genérico, uma tela girando até o timeout ou, pior, silêncio. Nada disso é inevitável, porque quase tudo que o bot faz de útil não depende do modelo. A base de conhecimento continua lá, o histórico da conversa continua lá, a fila de humanos continua lá, o formulário de coleta continua lá. Modo degradado é a disciplina de decidir com antecedência quais capacidades caem primeiro, o que ainda é possível entregar sem cada uma, e como voltar sem derrubar de novo o serviço que acabou de se recuperar. Este artigo mostra como desenhar essa escada: por que falhar em modo aberto é diferente de falhar em modo fechado, como classificar a falha antes de reagir, quais níveis fazem sentido em atendimento, como evitar o pingue-pongue entre modos, o que dizer ao cliente em cada nível e como testar tudo isso antes que a queda real aconteça.',
  sections: [
    {
      title: 'A pergunta que precisa ser respondida antes do incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema que depende de um serviço externo enfrenta uma escolha binária quando esse serviço some: falhar em modo aberto, deixando a operação seguir sem a proteção ou o enriquecimento que aquele serviço dava, ou falhar em modo fechado, bloqueando a operação por não conseguir garantir o resultado. Essa escolha não é técnica, é de negócio, e ela precisa ser feita por capacidade e não pelo sistema inteiro.',
        },
        {
          type: 'paragraph',
          value:
            'Em atendimento, a resposta certa quase sempre difere entre as capacidades do mesmo bot. Um classificador de intenção que caiu deve falhar aberto: sem ele o roteamento fica pior, mas mandar tudo para a fila geral é melhor do que não atender. Um verificador de elegibilidade de reembolso deve falhar fechado: sem ele, aprovar por otimismo cria prejuízo real e irreversível. Misturar as duas políticas no mesmo tratamento de erro é como a maioria dos sistemas erra, e o sintoma é sempre o mesmo: ou o bot bloqueia coisas inofensivas durante toda a queda, ou ele libera exatamente aquilo que precisava de verificação.',
        },
        {
          type: 'paragraph',
          value:
            'A regra prática que resolve quase todos os casos: falhe aberto quando o pior resultado da ausência é uma resposta pior, e falhe fechado quando o pior resultado é uma ação errada com efeito no mundo. Ler documentação, sugerir artigo, resumir histórico e classificar assunto caem no primeiro grupo. Cancelar assinatura, emitir crédito, alterar endereço de entrega e liberar acesso caem no segundo. Escreva essa classificação por capacidade antes do incidente, porque durante ele ninguém tem calma para decidir direito.',
        },
      ],
    },
    {
      title: 'Classificar a falha antes de escolher a reação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reagir a "deu erro" leva à reação errada com frequência. Um 429 pede espera e enfileiramento, um 400 pede correção do payload e nunca melhora com retentativa, um 503 pede troca de provedor, e um timeout não diz se a chamada aconteceu ou não. Tratar os quatro do mesmo jeito é o que transforma uma limitação temporária de taxa em queda total, porque a retentativa imediata contra um provedor que já está sinalizando saturação é o jeito mais rápido de piorar a saturação.',
        },
        {
          type: 'table',
          columns: ['Sintoma', 'O que provavelmente é', 'Reação certa', 'Erro comum'],
          rows: [
            [
              'HTTP 429 com Retry-After',
              'Limite de taxa, o serviço está de pé',
              'Respeitar o cabeçalho, enfileirar e degradar só o não urgente',
              'Retentar de imediato e ampliar a saturação',
            ],
            [
              'HTTP 5xx persistente',
              'Indisponibilidade do provedor',
              'Abrir o disjuntor e cair para o provedor secundário',
              'Insistir no primário até estourar todos os timeouts',
            ],
            [
              'Timeout sem resposta',
              'Ambíguo: pode ter executado do outro lado',
              'Não repetir efeito colateral sem chave de idempotência',
              'Retentar cegamente e duplicar a ação',
            ],
            [
              'HTTP 400 ou 422',
              'Contrato quebrado, provavelmente após um deploy',
              'Falhar rápido, alertar e reverter a mudança',
              'Retentar, o que nunca corrige e ainda esconde o bug',
            ],
            [
              'Latência alta sem erro',
              'Degradação parcial, a pior de detectar',
              'Cortar por orçamento de tempo e responder sem o modelo',
              'Esperar o timeout completo e travar a conversa',
            ],
            [
              'Resposta fora de formato',
              'Regressão do modelo ou mudança silenciosa de versão',
              'Validar a saída, uma retentativa e cair para o fluxo fixo',
              'Aceitar o texto quebrado e propagar o defeito adiante',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A latência alta sem erro merece atenção extra porque não dispara nenhum alarme convencional e é a forma mais comum de queda parcial. O que resolve é orçamento de tempo por turno, contado desde a chegada da mensagem e não desde o início de cada chamada. Quando o orçamento acaba, o turno responde com o que tiver, e responder em três segundos com um artigo relevante é melhor do que responder em quarenta com a resposta perfeita, porque em quarenta segundos o cliente já saiu.',
        },
      ],
    },
    {
      title: 'Os quatro níveis da escada de degradação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modo degradado não é um interruptor entre ligado e desligado. É uma escada em que cada degrau remove uma capacidade e mantém tudo o que não depende dela. Quatro níveis cobrem bem a realidade de um atendimento, e a virtude do desenho está em quanto ainda funciona no terceiro degrau.',
        },
        {
          type: 'table',
          columns: ['Nível', 'O que está fora', 'O que ainda funciona', 'Gatilho típico'],
          rows: [
            [
              'Pleno',
              'Nada',
              'Geração, RAG, tools, resumo e classificação',
              'Operação normal',
            ],
            [
              'Reduzido',
              'Modelo grande e tools de escrita',
              'Modelo menor, RAG, leitura de dados, classificação',
              'Latência acima do orçamento ou custo em alerta',
            ],
            [
              'Roteador',
              'Toda geração de texto livre',
              'Busca na base, resposta pronta por intenção, transbordo',
              'Provedor indisponível ou disjuntor aberto',
            ],
            [
              'Recado',
              'Busca e classificação também',
              'Receber, confirmar, coletar dados e enfileirar para humano',
              'Falha ampla, incluindo o índice de busca',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O nível roteador é o que salva a operação na maioria dos incidentes reais e é justamente o que quase ninguém constrói. Sem modelo nenhum, uma busca léxica na base de conhecimento mais um conjunto de respostas prontas por intenção resolve uma fatia grande do volume, porque o atendimento é dominado por perguntas repetidas. A parte que exige disciplina é manter esse conjunto de respostas vivo: ele apodrece em silêncio quando ninguém exercita, e descobrir isso durante a queda é descobrir tarde.',
        },
        {
          type: 'paragraph',
          value:
            'O nível recado parece pouco e é muito. Confirmar o recebimento, coletar os dados que o humano vai precisar, informar prazo real e criar o ticket transforma uma queda de trinta minutos em uma fila de trabalho organizada em vez de uma pilha de clientes irritados que precisarão repetir tudo depois. É também o único nível que precisa funcionar sem nenhuma dependência externa além do seu próprio banco, e por isso ele merece o caminho de código mais simples e mais testado do sistema.',
        },
        {
          type: 'diagram',
          value: `                    orcamento de tempo do turno
                              |
   +--------+   latencia   +---------+   disjuntor   +----------+   indice   +--------+
   | PLENO  | -----------> | REDUZID | ------------> | ROTEADOR | ---------> | RECADO |
   +--------+              +---------+               +----------+            +--------+
       ^                        ^                          ^                     |
       |                        |                          |                     |
       +---- sonda 5% ok -------+---- sonda 5% ok ---------+---- sonda 5% ok ----+
             (subir 1 nivel por vez, nunca do fundo direto ao topo)

   descer: imediato, na primeira evidencia de falha
   subir : so apos janela minima + sonda bem sucedida`,
        },
      ],
    },
    {
      title: 'Descer rápido, subir devagar e não ficar oscilando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A assimetria é o coração do desenho. Descer de nível deve ser imediato, porque cada segundo em um nível que não funciona é uma conversa perdida. Subir de nível deve ser lento e verificado, porque um provedor que acabou de voltar costuma voltar frágil, e mandar cem por cento do tráfego para ele no primeiro sinal de vida é a maneira mais confiável de derrubá-lo de novo.',
        },
        {
          type: 'paragraph',
          value:
            'O modo de falha específico a evitar é o pingue-pongue: o sistema sobe porque uma requisição funcionou, cai porque as dez seguintes falharam, sobe de novo, e cada oscilação custa uma leva de conversas atendidas pela metade além de encher o canal de alertas. Três mecanismos combinados resolvem, e os três são necessários. Histerese, com limiares diferentes para descer e para subir, para que o ponto de retorno não seja o mesmo ponto de saída. Tempo mínimo de permanência no nível, tipicamente de um a cinco minutos, para que nenhuma decisão seja revertida antes de ter efeito observável. E sonda de recuperação, mandando uma fração pequena do tráfego para a capacidade suspeita e só promovendo o nível quando essa fração passa por uma janela inteira.',
        },
        {
          type: 'code',
          value: `// degraded/machine.js
// Maquina de nivel de degradacao: desce rapido, sobe devagar.
// Descer e imediato; subir exige janela minima + sonda bem sucedida.

export const LEVELS = ['full', 'reduced', 'router', 'message'];

export function createDegradationMachine({
  now,                      // () => number, injetado para ser testavel
  minDwellMs = 60_000,      // tempo minimo em um nivel antes de subir
  probeRatio = 0.05,        // fracao do trafego que sonda o nivel acima
  probeSuccessesToRecover = 20,
  failuresToDegrade = 5,
} = {}) {
  if (typeof now !== 'function') throw new Error('now precisa ser uma funcao');

  let index = 0;                 // 0 = full
  let enteredAt = now();
  let failures = 0;
  let probeSuccesses = 0;

  const level = () => LEVELS[index];

  return {
    level,

    /** Falha observada no nivel atual: desce assim que houver evidencia. */
    recordFailure() {
      failures += 1;
      probeSuccesses = 0;
      if (failures >= failuresToDegrade && index < LEVELS.length - 1) {
        index += 1;
        enteredAt = now();
        failures = 0;
        return { changed: true, level: level(), direction: 'down' };
      }
      return { changed: false, level: level() };
    },

    /**
     * Sucesso observado. So conta para recuperacao se veio de uma sonda,
     * senao o sucesso do proprio nivel degradado promoveria o sistema.
     */
    recordSuccess({ fromProbe = false } = {}) {
      failures = 0;
      if (!fromProbe || index === 0) return { changed: false, level: level() };

      // Tempo minimo de permanencia: evita reverter antes de haver efeito.
      if (now() - enteredAt < minDwellMs) return { changed: false, level: level() };

      probeSuccesses += 1;
      if (probeSuccesses >= probeSuccessesToRecover) {
        index -= 1;              // um nivel por vez, nunca do fundo ao topo
        enteredAt = now();
        probeSuccesses = 0;
        return { changed: true, level: level(), direction: 'up' };
      }
      return { changed: false, level: level() };
    },

    /** Decide se esta requisicao testa o nivel acima. */
    shouldProbe(sample) {
      if (index === 0) return false;
      if (now() - enteredAt < minDwellMs) return false;
      return sample < probeRatio;   // sample em [0, 1), do chamador
    },

    snapshot() {
      return { level: level(), index, enteredAt, failures, probeSuccesses };
    },
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Duas decisões nesse código merecem destaque porque são exatamente onde as implementações caseiras erram. O sucesso só conta para recuperação quando vem de uma sonda: sem essa distinção, o bot no nível roteador acumula sucessos das próprias respostas prontas e se promove sozinho para um nível que continua quebrado. E a subida é de um nível por vez: pular do recado direto para o pleno é o caminho mais curto para reabrir o disjuntor em segundos.',
        },
      ],
    },
    {
      title: 'O que o cliente vê e o que a operação precisa saber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modo degradado mal comunicado é indistinguível de bot ruim. O cliente não sabe que o provedor caiu, ele sabe que perguntou uma coisa e recebeu outra. As três regras que evitam isso: seja específico sobre o que você ainda consegue fazer, nunca prometa prazo que depende de um sistema que você não controla, e não invente explicação técnica que ninguém pediu.',
        },
        {
          type: 'paragraph',
          value:
            'Compare duas mensagens no nível roteador. A primeira diz que houve um erro e pede para tentar mais tarde: ela empurra o problema para o cliente e não entrega nada. A segunda diz que naquele momento consegue consultar a base e encontrar o artigo sobre o assunto, e que se não resolver já deixa o caso com um atendente com tudo que foi conversado: ela entrega duas saídas concretas e preserva o contexto. O trabalho técnico é o mesmo, e a diferença de percepção é enorme.',
        },
        {
          type: 'list',
          items: [
            'Nível reduzido: não anuncie nada. A resposta continua sendo gerada, apenas com um modelo menor e sem ações de escrita, e avisar aqui só cria dúvida onde não havia problema.',
            'Nível roteador: diga o que ainda é possível, ofereça o artigo encontrado e coloque o transbordo para humano a um toque de distância, sem exigir que o cliente reformule a pergunta.',
            'Nível recado: confirme o recebimento com número de protocolo, informe o prazo real de retorno com base no tamanho da fila e colete o que o humano vai precisar para não perguntar de novo.',
            'Em qualquer nível abaixo de pleno: preserve o histórico e passe-o ao atendente, porque fazer o cliente repetir tudo é o que transforma um incidente técnico em reclamação.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Do lado da operação, o mínimo é registrar o nível atual como um campo em toda conversa e emitir métricas de tempo em cada nível, de transições por hora e de resultado por nível. Sem isso você não consegue responder as duas perguntas que sempre aparecem depois: quanto do volume da semana passou por modo degradado, e o nível roteador resolveu ou apenas adiou. A segunda pergunta é a que justifica o investimento em manter as respostas prontas atualizadas.',
        },
      ],
    },
    {
      title: 'Testar o modo degradado antes de precisar dele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Modo degradado tem a mesma patologia de todo caminho de exceção: ele é escrito uma vez, nunca é executado e apodrece em silêncio até o dia em que é a única coisa que importa. A resposta pronta que mencionava um produto descontinuado, o índice de busca que parou de ser atualizado, o formulário de coleta que quebrou num deploy de três meses atrás, tudo isso só aparece durante a queda se ninguém exercitar antes.',
        },
        {
          type: 'ordered',
          items: [
            'Torne o nível forçável por configuração, de forma que qualquer pessoa possa colocar o sistema em roteador ou recado sem simular uma falha real.',
            'Rode um exercício semanal em produção com uma fatia pequena do tráfego, entre um e cinco por cento, atendida no nível roteador de propósito.',
            'Teste a máquina de níveis com relógio injetado, cobrindo pingue-pongue, tempo mínimo de permanência e subida de um nível por vez.',
            'Verifique a saúde do nível recado sem nenhuma dependência externa disponível, porque ele é o único que precisa funcionar quando tudo mais caiu.',
            'Meça a taxa de resolução dentro de cada nível degradado e trate a queda dessa taxa como um bug de produto, não como consequência aceitável do incidente.',
            'Revise o conjunto de respostas prontas na mesma cadência em que revisa a base de conhecimento, porque ele envelhece pelo mesmo motivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O exercício semanal em produção é o item que mais incomoda e o que mais entrega. Servir um por cento do tráfego em nível roteador tem custo real e pequeno, e é a única forma honesta de saber que ele funciona: teste em ambiente de homologação prova que o código roda, não que a resposta pronta ainda faz sentido para o cliente de hoje. Se a taxa de transbordo do grupo exercitado for muito maior que a do grupo normal, você descobriu isso numa terça-feira tranquila em vez de descobrir durante a queda.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Quantos níveis de degradação vale a pena manter?',
      answer:
        'Menos do que a vontade inicial sugere, porque cada nível é um caminho de código que precisa ser exercitado para não apodrecer, e níveis que ninguém exercita são código morto que dá falsa sensação de segurança. Comece com dois além do pleno: um sem geração de texto livre, que responde por busca e respostas prontas, e um que só recebe, confirma e enfileira para humano. Esses dois cobrem a grande maioria dos incidentes reais, porque as falhas que importam são indisponibilidade do provedor e queda ampla. O nível reduzido, com modelo menor e sem ações de escrita, vale a pena quando você já tem um segundo modelo integrado e um orçamento de tempo por turno implementado, e não antes disso. Adicionar um quinto nível quase sempre significa que a classificação de falha está imprecisa, e vale mais consertar a classificação do que criar mais um degrau.',
    },
    {
      question: 'O modo degradado deve valer para o sistema inteiro ou por capacidade?',
      answer:
        'Por capacidade, com um nível global calculado a partir delas. Se o índice de busca vetorial caiu mas o modelo está de pé, degradar tudo joga fora a geração que ainda funcionaria perfeitamente; se o provedor caiu mas a busca está de pé, manter tudo em pleno gera timeout em cada turno. O desenho que funciona é declarar a política por capacidade, definindo para cada uma se ela falha aberta ou fechada e qual nível ela força quando indisponível, e derivar o nível efetivo da conversa a partir da capacidade mais degradada que aquele fluxo específico exige. Um fluxo de consulta a pedido e um fluxo de cancelamento de assinatura não precisam estar no mesmo nível ao mesmo tempo, e forçá-los a isso é o que faz o sistema degradar mais do que precisava.',
    },
    {
      question: 'Vale a pena manter um provedor secundário em vez de degradar?',
      answer:
        'As duas coisas são complementares e resolvem problemas diferentes, então tratá-las como alternativas é o erro. O provedor secundário cobre indisponibilidade de um fornecedor específico e é a primeira linha de defesa, com a ressalva de que ele precisa ser exercitado com tráfego real de vez em quando, porque prompt calibrado em um modelo raramente funciona igual no outro e descobrir isso durante a queda é descobrir tarde. O modo degradado cobre o que o fallback não alcança: os dois provedores fora, a rede da sua nuvem com problema, o índice de busca corrompido, o limite de gasto atingido, o bug no seu próprio código de orquestração. Sistemas que só têm fallback ficam sem plano nenhum exatamente nos incidentes mais graves, que são justamente aqueles em que a alternativa também está indisponível.',
    },
  ],
  conclusion: {
    title: 'Sem plano, a indisponibilidade da IA vira indisponibilidade do atendimento',
    description:
      'A queda do provedor é certa e a data é o único detalhe desconhecido. O que separa meia hora de operação em ritmo reduzido de meia hora de clientes sem resposta é ter decidido antes quais capacidades falham abertas e quais falham fechadas, ter uma escada de níveis em que o degrau sem modelo nenhum ainda resolve, descer rápido e subir devagar com sonda e histerese, e exercitar tudo isso em produção antes de precisar. Posso desenhar e implementar essa camada de degradação no seu atendimento com IA, da classificação de falha à comunicação com o cliente em cada nível.',
    cta: 'Falar sobre modo degradado no meu atendimento',
  },
  related: [
    { label: 'Fallback entre provedores de LLM sem parar o atendimento', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Timeout e cancelamento em cadeia de chamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'degraded-mode-machine', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The LLM provider goes down, and the question that decides the quality of your support at that moment is not technical, it is a product question: what does the customer see. With no plan, they see a generic error, a spinner running until the timeout or, worse, silence. None of that is inevitable, because almost everything useful the bot does does not depend on the model. The knowledge base is still there, the conversation history is still there, the human queue is still there, the intake form is still there. Degraded mode is the discipline of deciding in advance which capabilities fall first, what can still be delivered without each one, and how to come back without knocking over the service that just recovered. This article shows how to design that ladder: why failing open differs from failing closed, how to classify the failure before reacting, which levels make sense in support, how to avoid ping-ponging between modes, what to tell the customer at each level and how to test all of it before the real outage arrives.',
  sections: [
    {
      title: 'The question that has to be answered before the incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every system depending on an external service faces a binary choice when that service disappears: fail open, letting the operation proceed without the protection or enrichment that service provided, or fail closed, blocking the operation because the outcome cannot be guaranteed. That choice is not technical, it is a business one, and it has to be made per capability rather than for the whole system.',
        },
        {
          type: 'paragraph',
          value:
            'In support, the right answer almost always differs across capabilities of the same bot. An intent classifier that went down should fail open: without it routing gets worse, but sending everything to the general queue beats not answering at all. A refund eligibility checker should fail closed: without it, approving out of optimism creates real and irreversible loss. Mixing both policies into the same error handler is how most systems get it wrong, and the symptom is always the same: either the bot blocks harmless things throughout the outage, or it releases exactly what needed verification.',
        },
        {
          type: 'paragraph',
          value:
            'The practical rule that settles almost every case: fail open when the worst outcome of the absence is a worse answer, and fail closed when the worst outcome is a wrong action with an effect on the world. Reading documentation, suggesting an article, summarizing history and classifying a topic belong to the first group. Cancelling a subscription, issuing credit, changing a delivery address and granting access belong to the second. Write this classification per capability before the incident, because during one nobody is calm enough to decide well.',
        },
      ],
    },
    {
      title: 'Classify the failure before choosing the reaction',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reacting to "it errored" leads to the wrong reaction quite often. A 429 asks for waiting and queueing, a 400 asks for a payload fix and never improves with retries, a 503 asks for a provider swap, and a timeout does not say whether the call happened or not. Treating all four the same way is what turns a temporary rate limit into a full outage, because retrying immediately against a provider already signalling saturation is the fastest way to make the saturation worse.',
        },
        {
          type: 'table',
          columns: ['Symptom', 'What it likely is', 'Right reaction', 'Common mistake'],
          rows: [
            [
              'HTTP 429 with Retry-After',
              'Rate limit, the service is up',
              'Honor the header, queue and degrade only the non urgent',
              'Retry immediately and widen the saturation',
            ],
            [
              'Persistent HTTP 5xx',
              'Provider unavailability',
              'Open the circuit breaker and fall to the secondary provider',
              'Insist on the primary until every timeout blows',
            ],
            [
              'Timeout with no response',
              'Ambiguous: it may have executed on the other side',
              'Do not repeat a side effect without an idempotency key',
              'Retry blindly and duplicate the action',
            ],
            [
              'HTTP 400 or 422',
              'Broken contract, most likely after a deploy',
              'Fail fast, alert and roll the change back',
              'Retry, which never fixes it and hides the bug',
            ],
            [
              'High latency with no error',
              'Partial degradation, the hardest to detect',
              'Cut on a time budget and answer without the model',
              'Wait out the full timeout and freeze the conversation',
            ],
            [
              'Out-of-format response',
              'Model regression or a silent version change',
              'Validate the output, retry once and fall to the fixed flow',
              'Accept the broken text and propagate the defect downstream',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'High latency with no error deserves extra attention because it triggers no conventional alarm and is the most common shape of a partial outage. What solves it is a per-turn time budget, counted from message arrival rather than from the start of each call. When the budget runs out, the turn answers with whatever it has, and answering in three seconds with a relevant article beats answering in forty with the perfect response, because in forty seconds the customer is already gone.',
        },
      ],
    },
    {
      title: 'The four levels of the degradation ladder',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Degraded mode is not a switch between on and off. It is a ladder in which each step removes one capability and keeps everything that does not depend on it. Four levels cover the reality of a support operation well, and the virtue of the design lies in how much still works on the third step.',
        },
        {
          type: 'table',
          columns: ['Level', 'What is out', 'What still works', 'Typical trigger'],
          rows: [
            [
              'Full',
              'Nothing',
              'Generation, RAG, tools, summarization and classification',
              'Normal operation',
            ],
            [
              'Reduced',
              'Large model and write tools',
              'Smaller model, RAG, data reads, classification',
              'Latency above budget or cost in warning',
            ],
            [
              'Router',
              'All free-text generation',
              'Knowledge base search, canned answers per intent, handoff',
              'Provider unavailable or circuit breaker open',
            ],
            [
              'Message',
              'Search and classification too',
              'Receive, confirm, collect data and queue for a human',
              'Broad failure, including the search index',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The router level is what saves the operation in most real incidents and is precisely the one almost nobody builds. With no model at all, a lexical search over the knowledge base plus a set of canned answers per intent resolves a large slice of volume, because support is dominated by repeated questions. The part that takes discipline is keeping that answer set alive: it rots quietly when nobody exercises it, and discovering that during the outage is discovering it late.',
        },
        {
          type: 'paragraph',
          value:
            'The message level looks like little and is a lot. Confirming receipt, collecting the data the human will need, stating a real turnaround and creating the ticket turns a thirty minute outage into an organized work queue instead of a pile of annoyed customers who will have to repeat everything later. It is also the only level that must work with no external dependency beyond your own database, which is why it deserves the simplest and most tested code path in the system.',
        },
        {
          type: 'diagram',
          value: `                       per-turn time budget
                              |
   +--------+   latency    +---------+   breaker    +----------+   index    +---------+
   |  FULL  | -----------> | REDUCED | -----------> |  ROUTER  | ---------> | MESSAGE |
   +--------+              +---------+              +----------+            +---------+
       ^                        ^                         ^                      |
       |                        |                         |                      |
       +---- probe 5% ok -------+---- probe 5% ok --------+---- probe 5% ok -----+
             (step up one level at a time, never bottom to top)

   step down: immediate, on the first evidence of failure
   step up  : only after minimum dwell + successful probe`,
        },
      ],
    },
    {
      title: 'Step down fast, step up slowly and do not oscillate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The asymmetry is the heart of the design. Stepping down must be immediate, because every second spent at a level that does not work is a lost conversation. Stepping up must be slow and verified, because a provider that just came back tends to come back fragile, and sending it a hundred percent of traffic at the first sign of life is the most reliable way to knock it over again.',
        },
        {
          type: 'paragraph',
          value:
            'The specific failure mode to avoid is ping-ponging: the system steps up because one request worked, falls because the next ten failed, steps up again, and every oscillation costs a batch of half-served conversations plus a flooded alert channel. Three combined mechanisms fix it, and all three are necessary. Hysteresis, with different thresholds for stepping down and stepping up, so the return point is not the same as the exit point. A minimum dwell time at the level, typically one to five minutes, so no decision is reverted before it has an observable effect. And a recovery probe, sending a small fraction of traffic to the suspect capability and only promoting the level once that fraction survives a whole window.',
        },
        {
          type: 'code',
          value: `// degraded/machine.js
// Degradation level machine: steps down fast, steps up slowly.
// Down is immediate; up requires minimum dwell + a successful probe.

export const LEVELS = ['full', 'reduced', 'router', 'message'];

export function createDegradationMachine({
  now,                      // () => number, injected so it stays testable
  minDwellMs = 60_000,      // minimum time at a level before stepping up
  probeRatio = 0.05,        // fraction of traffic probing the level above
  probeSuccessesToRecover = 20,
  failuresToDegrade = 5,
} = {}) {
  if (typeof now !== 'function') throw new Error('now must be a function');

  let index = 0;                 // 0 = full
  let enteredAt = now();
  let failures = 0;
  let probeSuccesses = 0;

  const level = () => LEVELS[index];

  return {
    level,

    /** Failure seen at the current level: step down on evidence. */
    recordFailure() {
      failures += 1;
      probeSuccesses = 0;
      if (failures >= failuresToDegrade && index < LEVELS.length - 1) {
        index += 1;
        enteredAt = now();
        failures = 0;
        return { changed: true, level: level(), direction: 'down' };
      }
      return { changed: false, level: level() };
    },

    /**
     * Success seen. It only counts toward recovery when it came from a probe,
     * otherwise the degraded level's own success would promote the system.
     */
    recordSuccess({ fromProbe = false } = {}) {
      failures = 0;
      if (!fromProbe || index === 0) return { changed: false, level: level() };

      // Minimum dwell: avoids reverting before there is any effect.
      if (now() - enteredAt < minDwellMs) return { changed: false, level: level() };

      probeSuccesses += 1;
      if (probeSuccesses >= probeSuccessesToRecover) {
        index -= 1;              // one level at a time, never bottom to top
        enteredAt = now();
        probeSuccesses = 0;
        return { changed: true, level: level(), direction: 'up' };
      }
      return { changed: false, level: level() };
    },

    /** Decides whether this request probes the level above. */
    shouldProbe(sample) {
      if (index === 0) return false;
      if (now() - enteredAt < minDwellMs) return false;
      return sample < probeRatio;   // sample in [0, 1), from the caller
    },

    snapshot() {
      return { level: level(), index, enteredAt, failures, probeSuccesses };
    },
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two decisions in that code stand out because they are exactly where homegrown implementations go wrong. Success only counts toward recovery when it comes from a probe: without that distinction, a bot at the router level accumulates successes from its own canned answers and promotes itself to a level that is still broken. And stepping up goes one level at a time: jumping from message straight to full is the shortest path to reopening the breaker within seconds.',
        },
      ],
    },
    {
      title: 'What the customer sees and what operations needs to know',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A poorly communicated degraded mode is indistinguishable from a bad bot. The customer does not know the provider went down, they know they asked one thing and got another. The three rules that avoid this: be specific about what you can still do, never promise a turnaround that depends on a system you do not control, and do not invent a technical explanation nobody asked for.',
        },
        {
          type: 'paragraph',
          value:
            'Compare two messages at the router level. The first says an error occurred and asks the customer to try later: it pushes the problem onto them and delivers nothing. The second says that right now it can search the knowledge base and find the article on the subject, and that if this does not resolve it, the case goes to an agent with everything already discussed: it delivers two concrete exits and preserves the context. The technical work is the same, and the difference in perception is enormous.',
        },
        {
          type: 'list',
          items: [
            'Reduced level: announce nothing. The answer is still being generated, only with a smaller model and no write actions, and warning here only creates doubt where there was no problem.',
            'Router level: say what is still possible, offer the article found and put the human handoff one tap away, without requiring the customer to rephrase the question.',
            'Message level: confirm receipt with a ticket number, state a real turnaround based on queue size and collect what the human will need so nobody asks twice.',
            'At any level below full: preserve the history and pass it to the agent, because making the customer repeat everything is what turns a technical incident into a complaint.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'On the operations side, the minimum is recording the current level as a field on every conversation and emitting metrics for time spent at each level, transitions per hour and outcome per level. Without those you cannot answer the two questions that always come up afterwards: how much of last week volume went through degraded mode, and did the router level resolve or merely postpone. The second question is the one that justifies the investment in keeping the canned answers current.',
        },
      ],
    },
    {
      title: 'Testing degraded mode before you need it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Degraded mode has the same pathology as every exception path: it is written once, never executed and quietly rots until the day it is the only thing that matters. The canned answer mentioning a discontinued product, the search index that stopped being updated, the intake form broken by a deploy three months ago, all of it only shows up during the outage if nobody exercises it beforehand.',
        },
        {
          type: 'ordered',
          items: [
            'Make the level forceable by configuration, so anyone can put the system into router or message mode without simulating a real failure.',
            'Run a weekly production exercise with a small slice of traffic, between one and five percent, served at the router level on purpose.',
            'Test the level machine with an injected clock, covering ping-pong, minimum dwell time and stepping up one level at a time.',
            'Verify the health of the message level with no external dependency available, because it is the only one that must work when everything else is down.',
            'Measure the resolution rate within each degraded level and treat a drop in it as a product bug, not as an acceptable consequence of the incident.',
            'Review the canned answer set on the same cadence as the knowledge base, because it ages for the same reason.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The weekly production exercise is the item that bothers people most and delivers most. Serving one percent of traffic at the router level has a real and small cost, and it is the only honest way to know that it works: a staging test proves the code runs, not that the canned answer still makes sense to today customers. If the handoff rate of the exercised group is much higher than the normal group, you found that out on a quiet Tuesday instead of during the outage.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How many degradation levels are worth maintaining?',
      answer:
        'Fewer than the initial urge suggests, because each level is a code path that has to be exercised to avoid rotting, and levels nobody exercises are dead code that grants a false sense of safety. Start with two beyond full: one with no free-text generation, answering through search and canned answers, and one that only receives, confirms and queues for a human. Those two cover the vast majority of real incidents, because the failures that matter are provider unavailability and broad outages. The reduced level, with a smaller model and no write actions, becomes worthwhile once you already have a second model integrated and a per-turn time budget implemented, not before that. Adding a fifth level almost always means the failure classification is imprecise, and fixing the classification is worth more than adding another step.',
    },
    {
      question: 'Should degraded mode apply to the whole system or per capability?',
      answer:
        'Per capability, with a global level derived from them. If the vector search index went down but the model is up, degrading everything throws away generation that would still work perfectly; if the provider is down but search is up, keeping everything at full produces a timeout on every turn. The design that works is declaring the policy per capability, defining for each whether it fails open or closed and which level it forces when unavailable, and deriving the conversation effective level from the most degraded capability that specific flow requires. An order lookup flow and a subscription cancellation flow do not need to sit at the same level at the same time, and forcing them to is what makes the system degrade more than it had to.',
    },
    {
      question: 'Is a secondary provider worth it instead of degrading?',
      answer:
        'The two are complementary and solve different problems, so treating them as alternatives is the mistake. The secondary provider covers unavailability of one specific vendor and is the first line of defense, with the caveat that it has to be exercised with real traffic every so often, because a prompt calibrated on one model rarely behaves the same on another and discovering that during the outage is discovering it late. Degraded mode covers what failover cannot reach: both providers down, your cloud network in trouble, a corrupted search index, a spending cap reached, a bug in your own orchestration code. Systems that only have failover end up with no plan at all in precisely the most severe incidents, which are exactly the ones where the alternative is also unavailable.',
    },
  ],
  conclusion: {
    title: 'With no plan, AI unavailability becomes support unavailability',
    description:
      'The provider outage is certain and the date is the only unknown detail. What separates half an hour of operating at a reduced pace from half an hour of customers with no answer is having decided beforehand which capabilities fail open and which fail closed, having a ladder in which the step with no model at all still resolves, stepping down fast and up slowly with probes and hysteresis, and exercising all of it in production before you need it. I can design and implement this degradation layer in your AI-powered support, from failure classification to customer communication at each level.',
    cta: 'Talk about degraded mode in my support',
  },
  related: [
    { label: 'LLM provider failover without stopping support', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Timeout and cancellation across a chain of LLM calls', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'degraded-mode-machine', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El proveedor de LLM se cae, y la pregunta que decide la calidad de tu atención en ese momento no es técnica, es de producto: qué ve el cliente. Sin plan, ve un error genérico, una pantalla girando hasta el timeout o, peor, silencio. Nada de eso es inevitable, porque casi todo lo útil que hace el bot no depende del modelo. La base de conocimiento sigue ahí, el historial de la conversación sigue ahí, la fila de humanos sigue ahí, el formulario de recolección sigue ahí. El modo degradado es la disciplina de decidir por adelantado qué capacidades caen primero, qué se puede entregar todavía sin cada una, y cómo volver sin tumbar de nuevo el servicio que acaba de recuperarse. Este artículo muestra cómo diseñar esa escalera: por qué fallar en modo abierto es distinto de fallar en modo cerrado, cómo clasificar el fallo antes de reaccionar, qué niveles tienen sentido en atención, cómo evitar el ping-pong entre modos, qué decirle al cliente en cada nivel y cómo probar todo eso antes de que llegue la caída real.',
  sections: [
    {
      title: 'La pregunta que hay que responder antes del incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema que depende de un servicio externo enfrenta una elección binaria cuando ese servicio desaparece: fallar en modo abierto, dejando que la operación siga sin la protección o el enriquecimiento que ese servicio daba, o fallar en modo cerrado, bloqueando la operación por no poder garantizar el resultado. Esa elección no es técnica, es de negocio, y hay que tomarla por capacidad y no para el sistema entero.',
        },
        {
          type: 'paragraph',
          value:
            'En atención, la respuesta correcta casi siempre difiere entre las capacidades del mismo bot. Un clasificador de intención caído debe fallar abierto: sin él el ruteo empeora, pero mandar todo a la fila general es mejor que no atender. Un verificador de elegibilidad de reembolso debe fallar cerrado: sin él, aprobar por optimismo genera pérdida real e irreversible. Mezclar ambas políticas en el mismo manejo de error es como se equivoca la mayoría de los sistemas, y el síntoma siempre es el mismo: o el bot bloquea cosas inofensivas durante toda la caída, o libera justamente lo que necesitaba verificación.',
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica que resuelve casi todos los casos: falla abierto cuando el peor resultado de la ausencia es una respuesta peor, y falla cerrado cuando el peor resultado es una acción equivocada con efecto en el mundo. Leer documentación, sugerir un artículo, resumir historial y clasificar el asunto caen en el primer grupo. Cancelar una suscripción, emitir crédito, cambiar la dirección de entrega y liberar acceso caen en el segundo. Escribe esa clasificación por capacidad antes del incidente, porque durante uno nadie tiene la calma para decidir bien.',
        },
      ],
    },
    {
      title: 'Clasificar el fallo antes de elegir la reacción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reaccionar a "dio error" lleva a la reacción equivocada con frecuencia. Un 429 pide espera y encolado, un 400 pide corrección del payload y nunca mejora con reintentos, un 503 pide cambio de proveedor, y un timeout no dice si la llamada ocurrió o no. Tratar los cuatro igual es lo que convierte una limitación temporal de tasa en caída total, porque reintentar de inmediato contra un proveedor que ya señala saturación es la forma más rápida de empeorar la saturación.',
        },
        {
          type: 'table',
          columns: ['Síntoma', 'Qué es probablemente', 'Reacción correcta', 'Error común'],
          rows: [
            [
              'HTTP 429 con Retry-After',
              'Límite de tasa, el servicio está en pie',
              'Respetar la cabecera, encolar y degradar solo lo no urgente',
              'Reintentar de inmediato y ampliar la saturación',
            ],
            [
              'HTTP 5xx persistente',
              'Indisponibilidad del proveedor',
              'Abrir el disyuntor y caer al proveedor secundario',
              'Insistir en el primario hasta agotar todos los timeouts',
            ],
            [
              'Timeout sin respuesta',
              'Ambiguo: pudo haberse ejecutado del otro lado',
              'No repetir efecto colateral sin clave de idempotencia',
              'Reintentar a ciegas y duplicar la acción',
            ],
            [
              'HTTP 400 o 422',
              'Contrato roto, probablemente tras un deploy',
              'Fallar rápido, alertar y revertir el cambio',
              'Reintentar, lo que nunca corrige y encima esconde el bug',
            ],
            [
              'Latencia alta sin error',
              'Degradación parcial, la más difícil de detectar',
              'Cortar por presupuesto de tiempo y responder sin el modelo',
              'Esperar el timeout completo y congelar la conversación',
            ],
            [
              'Respuesta fuera de formato',
              'Regresión del modelo o cambio silencioso de versión',
              'Validar la salida, un reintento y caer al flujo fijo',
              'Aceptar el texto roto y propagar el defecto aguas abajo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La latencia alta sin error merece atención extra porque no dispara ninguna alarma convencional y es la forma más común de caída parcial. Lo que lo resuelve es un presupuesto de tiempo por turno, contado desde la llegada del mensaje y no desde el inicio de cada llamada. Cuando el presupuesto se agota, el turno responde con lo que tenga, y responder en tres segundos con un artículo relevante es mejor que responder en cuarenta con la respuesta perfecta, porque en cuarenta segundos el cliente ya se fue.',
        },
      ],
    },
    {
      title: 'Los cuatro niveles de la escalera de degradación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El modo degradado no es un interruptor entre encendido y apagado. Es una escalera en la que cada escalón quita una capacidad y mantiene todo lo que no depende de ella. Cuatro niveles cubren bien la realidad de una operación de atención, y la virtud del diseño está en cuánto sigue funcionando en el tercer escalón.',
        },
        {
          type: 'table',
          columns: ['Nivel', 'Qué está fuera', 'Qué sigue funcionando', 'Disparador típico'],
          rows: [
            [
              'Pleno',
              'Nada',
              'Generación, RAG, tools, resumen y clasificación',
              'Operación normal',
            ],
            [
              'Reducido',
              'Modelo grande y tools de escritura',
              'Modelo menor, RAG, lectura de datos, clasificación',
              'Latencia por encima del presupuesto o costo en alerta',
            ],
            [
              'Enrutador',
              'Toda generación de texto libre',
              'Búsqueda en la base, respuesta prearmada por intención, traspaso',
              'Proveedor indisponible o disyuntor abierto',
            ],
            [
              'Recado',
              'Búsqueda y clasificación también',
              'Recibir, confirmar, recolectar datos y encolar para un humano',
              'Fallo amplio, incluido el índice de búsqueda',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El nivel enrutador es el que salva la operación en la mayoría de los incidentes reales y es justamente el que casi nadie construye. Sin ningún modelo, una búsqueda léxica en la base de conocimiento más un conjunto de respuestas prearmadas por intención resuelve una porción grande del volumen, porque la atención está dominada por preguntas repetidas. La parte que exige disciplina es mantener vivo ese conjunto de respuestas: se pudre en silencio cuando nadie lo ejercita, y descubrirlo durante la caída es descubrirlo tarde.',
        },
        {
          type: 'paragraph',
          value:
            'El nivel recado parece poco y es mucho. Confirmar la recepción, recolectar los datos que el humano va a necesitar, informar un plazo real y crear el ticket convierte una caída de treinta minutos en una fila de trabajo organizada en vez de una pila de clientes molestos que tendrán que repetir todo después. Es además el único nivel que debe funcionar sin ninguna dependencia externa más allá de tu propia base de datos, y por eso merece el camino de código más simple y más probado del sistema.',
        },
        {
          type: 'diagram',
          value: `                  presupuesto de tiempo del turno
                              |
   +--------+   latencia   +---------+  disyuntor   +----------+   indice   +--------+
   | PLENO  | -----------> | REDUCID | -----------> | ENRUTADOR| ---------> | RECADO |
   +--------+              +---------+              +----------+            +--------+
       ^                        ^                         ^                     |
       |                        |                         |                     |
       +---- sonda 5% ok -------+---- sonda 5% ok --------+---- sonda 5% ok ----+
             (subir un nivel por vez, nunca del fondo a la cima)

   bajar: inmediato, ante la primera evidencia de fallo
   subir: solo tras ventana minima + sonda exitosa`,
        },
      ],
    },
    {
      title: 'Bajar rápido, subir despacio y no quedar oscilando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La asimetría es el corazón del diseño. Bajar de nivel debe ser inmediato, porque cada segundo en un nivel que no funciona es una conversación perdida. Subir de nivel debe ser lento y verificado, porque un proveedor que acaba de volver suele volver frágil, y mandarle el cien por ciento del tráfico a la primera señal de vida es la forma más confiable de tumbarlo de nuevo.',
        },
        {
          type: 'paragraph',
          value:
            'El modo de fallo específico a evitar es el ping-pong: el sistema sube porque una petición funcionó, cae porque las diez siguientes fallaron, sube otra vez, y cada oscilación cuesta una tanda de conversaciones atendidas a medias además de inundar el canal de alertas. Tres mecanismos combinados lo resuelven, y los tres son necesarios. Histéresis, con umbrales distintos para bajar y para subir, para que el punto de retorno no sea el mismo punto de salida. Tiempo mínimo de permanencia en el nivel, típicamente de uno a cinco minutos, para que ninguna decisión se revierta antes de tener efecto observable. Y sonda de recuperación, mandando una fracción pequeña del tráfico a la capacidad sospechosa y promoviendo el nivel solo cuando esa fracción sobrevive una ventana entera.',
        },
        {
          type: 'code',
          value: `// degraded/machine.js
// Maquina de nivel de degradacion: baja rapido, sube despacio.
// Bajar es inmediato; subir exige ventana minima + sonda exitosa.

export const LEVELS = ['full', 'reduced', 'router', 'message'];

export function createDegradationMachine({
  now,                      // () => number, inyectado para ser testeable
  minDwellMs = 60_000,      // tiempo minimo en un nivel antes de subir
  probeRatio = 0.05,        // fraccion del trafico que sondea el nivel de arriba
  probeSuccessesToRecover = 20,
  failuresToDegrade = 5,
} = {}) {
  if (typeof now !== 'function') throw new Error('now debe ser una funcion');

  let index = 0;                 // 0 = full
  let enteredAt = now();
  let failures = 0;
  let probeSuccesses = 0;

  const level = () => LEVELS[index];

  return {
    level,

    /** Fallo observado en el nivel actual: baja ante la evidencia. */
    recordFailure() {
      failures += 1;
      probeSuccesses = 0;
      if (failures >= failuresToDegrade && index < LEVELS.length - 1) {
        index += 1;
        enteredAt = now();
        failures = 0;
        return { changed: true, level: level(), direction: 'down' };
      }
      return { changed: false, level: level() };
    },

    /**
     * Exito observado. Solo cuenta para la recuperacion si vino de una sonda,
     * si no el exito del propio nivel degradado promoveria el sistema.
     */
    recordSuccess({ fromProbe = false } = {}) {
      failures = 0;
      if (!fromProbe || index === 0) return { changed: false, level: level() };

      // Permanencia minima: evita revertir antes de que haya efecto.
      if (now() - enteredAt < minDwellMs) return { changed: false, level: level() };

      probeSuccesses += 1;
      if (probeSuccesses >= probeSuccessesToRecover) {
        index -= 1;              // un nivel por vez, nunca del fondo a la cima
        enteredAt = now();
        probeSuccesses = 0;
        return { changed: true, level: level(), direction: 'up' };
      }
      return { changed: false, level: level() };
    },

    /** Decide si esta peticion prueba el nivel de arriba. */
    shouldProbe(sample) {
      if (index === 0) return false;
      if (now() - enteredAt < minDwellMs) return false;
      return sample < probeRatio;   // sample en [0, 1), del llamador
    },

    snapshot() {
      return { level: level(), index, enteredAt, failures, probeSuccesses };
    },
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos decisiones de ese código destacan porque son justamente donde se equivocan las implementaciones caseras. El éxito solo cuenta para la recuperación cuando viene de una sonda: sin esa distinción, un bot en el nivel enrutador acumula éxitos de sus propias respuestas prearmadas y se promueve solo a un nivel que sigue roto. Y la subida es de un nivel por vez: saltar de recado directo a pleno es el camino más corto para reabrir el disyuntor en segundos.',
        },
      ],
    },
    {
      title: 'Qué ve el cliente y qué necesita saber la operación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un modo degradado mal comunicado es indistinguible de un bot malo. El cliente no sabe que el proveedor se cayó, sabe que preguntó una cosa y recibió otra. Las tres reglas que lo evitan: sé específico sobre lo que todavía puedes hacer, nunca prometas un plazo que depende de un sistema que no controlas, y no inventes una explicación técnica que nadie pidió.',
        },
        {
          type: 'paragraph',
          value:
            'Compara dos mensajes en el nivel enrutador. El primero dice que hubo un error y pide intentar más tarde: le empuja el problema al cliente y no entrega nada. El segundo dice que en ese momento puede consultar la base y encontrar el artículo sobre el tema, y que si eso no lo resuelve deja el caso con un agente con todo lo conversado: entrega dos salidas concretas y preserva el contexto. El trabajo técnico es el mismo, y la diferencia de percepción es enorme.',
        },
        {
          type: 'list',
          items: [
            'Nivel reducido: no anuncies nada. La respuesta se sigue generando, solo que con un modelo menor y sin acciones de escritura, y avisar aquí únicamente crea duda donde no había problema.',
            'Nivel enrutador: di qué sigue siendo posible, ofrece el artículo encontrado y deja el traspaso a humano a un toque de distancia, sin exigir que el cliente reformule la pregunta.',
            'Nivel recado: confirma la recepción con número de ticket, informa el plazo real de retorno según el tamaño de la fila y recolecta lo que el humano va a necesitar para no preguntar de nuevo.',
            'En cualquier nivel por debajo de pleno: preserva el historial y pásalo al agente, porque hacer que el cliente repita todo es lo que convierte un incidente técnico en un reclamo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Del lado de la operación, lo mínimo es registrar el nivel actual como un campo en cada conversación y emitir métricas de tiempo en cada nivel, de transiciones por hora y de resultado por nivel. Sin eso no puedes responder las dos preguntas que siempre aparecen después: cuánto del volumen de la semana pasó por modo degradado, y si el nivel enrutador resolvió o solo aplazó. La segunda pregunta es la que justifica la inversión en mantener actualizadas las respuestas prearmadas.',
        },
      ],
    },
    {
      title: 'Probar el modo degradado antes de necesitarlo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El modo degradado tiene la misma patología que todo camino de excepción: se escribe una vez, nunca se ejecuta y se pudre en silencio hasta el día en que es lo único que importa. La respuesta prearmada que mencionaba un producto discontinuado, el índice de búsqueda que dejó de actualizarse, el formulario de recolección que rompió un deploy de hace tres meses, todo eso solo aparece durante la caída si nadie lo ejercita antes.',
        },
        {
          type: 'ordered',
          items: [
            'Haz el nivel forzable por configuración, de modo que cualquiera pueda poner el sistema en enrutador o recado sin simular un fallo real.',
            'Corre un ejercicio semanal en producción con una porción pequeña del tráfico, entre uno y cinco por ciento, atendida en el nivel enrutador a propósito.',
            'Prueba la máquina de niveles con reloj inyectado, cubriendo ping-pong, tiempo mínimo de permanencia y subida de un nivel por vez.',
            'Verifica la salud del nivel recado sin ninguna dependencia externa disponible, porque es el único que debe funcionar cuando todo lo demás cayó.',
            'Mide la tasa de resolución dentro de cada nivel degradado y trata su caída como un bug de producto, no como consecuencia aceptable del incidente.',
            'Revisa el conjunto de respuestas prearmadas con la misma cadencia con que revisas la base de conocimiento, porque envejece por el mismo motivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El ejercicio semanal en producción es el punto que más incomoda y el que más entrega. Servir el uno por ciento del tráfico en nivel enrutador tiene un costo real y pequeño, y es la única forma honesta de saber que funciona: una prueba en homologación demuestra que el código corre, no que la respuesta prearmada todavía tiene sentido para el cliente de hoy. Si la tasa de traspaso del grupo ejercitado es mucho mayor que la del grupo normal, lo descubriste un martes tranquilo en vez de descubrirlo durante la caída.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuántos niveles de degradación vale la pena mantener?',
      answer:
        'Menos de los que sugiere el impulso inicial, porque cada nivel es un camino de código que hay que ejercitar para que no se pudra, y los niveles que nadie ejercita son código muerto que da una falsa sensación de seguridad. Empieza con dos además del pleno: uno sin generación de texto libre, que responde por búsqueda y respuestas prearmadas, y uno que solo recibe, confirma y encola para un humano. Esos dos cubren la gran mayoría de los incidentes reales, porque los fallos que importan son la indisponibilidad del proveedor y la caída amplia. El nivel reducido, con modelo menor y sin acciones de escritura, vale la pena cuando ya tienes un segundo modelo integrado y un presupuesto de tiempo por turno implementado, y no antes. Agregar un quinto nivel casi siempre significa que la clasificación de fallo es imprecisa, y arreglar la clasificación vale más que crear otro escalón.',
    },
    {
      question: '¿El modo degradado debe valer para todo el sistema o por capacidad?',
      answer:
        'Por capacidad, con un nivel global calculado a partir de ellas. Si el índice de búsqueda vectorial cayó pero el modelo está en pie, degradar todo tira a la basura la generación que aún funcionaría perfectamente; si el proveedor cayó pero la búsqueda está en pie, mantener todo en pleno genera timeout en cada turno. El diseño que funciona es declarar la política por capacidad, definiendo para cada una si falla abierta o cerrada y qué nivel fuerza cuando está indisponible, y derivar el nivel efectivo de la conversación a partir de la capacidad más degradada que ese flujo específico exige. Un flujo de consulta de pedido y un flujo de cancelación de suscripción no necesitan estar en el mismo nivel al mismo tiempo, y forzarlos a eso es lo que hace que el sistema degrade más de lo necesario.',
    },
    {
      question: '¿Vale la pena mantener un proveedor secundario en vez de degradar?',
      answer:
        'Las dos cosas son complementarias y resuelven problemas distintos, así que tratarlas como alternativas es el error. El proveedor secundario cubre la indisponibilidad de un proveedor específico y es la primera línea de defensa, con la salvedad de que hay que ejercitarlo con tráfico real de vez en cuando, porque un prompt calibrado en un modelo rara vez se comporta igual en otro y descubrirlo durante la caída es descubrirlo tarde. El modo degradado cubre lo que el failover no alcanza: los dos proveedores caídos, la red de tu nube con problemas, el índice de búsqueda corrupto, el límite de gasto alcanzado, el bug en tu propio código de orquestación. Los sistemas que solo tienen failover se quedan sin ningún plan justamente en los incidentes más graves, que son precisamente aquellos en los que la alternativa también está indisponible.',
    },
  ],
  conclusion: {
    title: 'Sin plan, la indisponibilidad de la IA se vuelve indisponibilidad de la atención',
    description:
      'La caída del proveedor es segura y la fecha es el único detalle desconocido. Lo que separa media hora de operación a ritmo reducido de media hora de clientes sin respuesta es haber decidido antes qué capacidades fallan abiertas y cuáles cerradas, tener una escalera en la que el escalón sin ningún modelo todavía resuelve, bajar rápido y subir despacio con sonda e histéresis, y ejercitar todo eso en producción antes de necesitarlo. Puedo diseñar e implementar esta capa de degradación en tu atención con IA, desde la clasificación de fallo hasta la comunicación con el cliente en cada nivel.',
    cta: 'Hablar sobre modo degradado en mi atención',
  },
  related: [
    { label: 'Fallback entre proveedores de LLM sin parar la atención', to: '/blog/fallback-provedores-llm-sem-parar-atendimento' },
    { label: 'Timeout y cancelación en cadena de llamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'degraded-mode-machine', description: repo.es, url: repoUrl },
};

export default {
  pt,
  en,
  es,
};
