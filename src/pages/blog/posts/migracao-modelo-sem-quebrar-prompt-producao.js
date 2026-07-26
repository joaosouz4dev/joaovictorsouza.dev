// Conteudo do artigo: migrar de modelo sem quebrar o prompt que ja estava em producao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Harness de migração de modelo com tráfego sombra: o modelo candidato recebe uma cópia do tráfego real sem responder ao cliente, cada par de respostas é comparado por checagens objetivas de contrato e por um juiz para o que é subjetivo, e um gate de paridade decide por caso de uso se a troca pode subir, com relatório do que regrediu e onde o prompt precisa de ajuste antes do corte.',
  en: 'Model migration harness with shadow traffic: the candidate model receives a copy of real traffic without answering the customer, each pair of responses is compared by objective contract checks and by a judge for what is subjective, and a parity gate decides per use case whether the switch can go up, with a report of what regressed and where the prompt needs adjusting before the cutover.',
  es: 'Harness de migración de modelo con tráfico sombra: el modelo candidato recibe una copia del tráfico real sin responder al cliente, cada par de respuestas se compara con chequeos objetivos de contrato y con un juez para lo subjetivo, y un gate de paridad decide por caso de uso si el cambio puede subir, con reporte de lo que regresó y dónde el prompt necesita ajuste antes del corte.',
};

const repoUrl = 'https://github.com/joaosouz4dev/model-migration-shadow-mini';

const pt = {
  intro:
    'Trocar o modelo parece a mudança mais barata de um sistema com LLM: uma string de configuração, um deploy, pronto. Só que o prompt em produção não é um texto neutro que qualquer modelo lê do mesmo jeito. Ele foi lapidado durante meses contra um modelo específico, e boa parte do que faz ele funcionar não está escrito: está no jeito daquele modelo interpretar uma instrução ambígua, no formato que ele já devolve sem que ninguém peça, na quantidade de exemplos que ele precisa antes de acertar. Trocar o modelo remove esse acordo tácito, e o que quebra não é o prompt inteiro, são as bordas: o JSON que agora vem embrulhado em markdown, a recusa que ficou mais conservadora, a resposta que dobrou de tamanho e estourou o orçamento de tokens. Este artigo mostra como migrar sem apostar: caracterizar o que o prompt depende do modelo antigo, rodar o candidato em tráfego sombra sem risco ao cliente, comparar por contrato e por juízo, adaptar o prompt em vez de reescrevê-lo do zero e fazer o corte com rollback pronto.',
  sections: [
    {
      title: 'O prompt não é portátil: ele foi ajustado contra um modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo prompt maduro carrega uma dívida invisível com o modelo em que nasceu. As instruções explícitas são a parte pequena; a parte grande é o comportamento que o modelo antigo entregava por padrão e por isso nunca precisou virar regra. Se aquele modelo já devolvia JSON limpo quando o prompt pedia "responda em JSON", ninguém escreveu "sem cercas de código, sem texto antes ou depois". Se ele já era conciso, ninguém colocou um teto de tamanho. Se ele raramente recusava, ninguém definiu o que fazer quando a recusa chega. Cada um desses silêncios é uma suposição, e a troca de modelo testa todas de uma vez. O resultado típico não é um sistema que para: é um sistema que continua respondendo, com uma fatia dos casos saindo errada de um jeito que só aparece na métrica dias depois.',
        },
        {
          type: 'paragraph',
          value:
            'Por isso a migração não começa escolhendo o modelo novo, começa listando as suposições. O exercício é ler o prompt e o código em volta perguntando, para cada comportamento de que o sistema depende, se ele está escrito ou se está apenas acontecendo. O que está escrito viaja com o prompt; o que está apenas acontecendo é dívida que vence na troca. Essa lista vira a espinha do teste de migração, porque cada suposição não escrita é exatamente um caso de regressão a verificar no candidato. Fazer isso antes de trocar transforma a migração de um mistério em uma checklist finita, e costuma render o efeito colateral de melhorar o prompt no modelo atual: uma suposição que virou instrução explícita reduz variância mesmo sem trocar nada.',
        },
        {
          type: 'table',
          columns: ['Suposição tácita', 'Como quebra no modelo novo', 'Como tornar explícita'],
          rows: [
            [
              'O modelo devolve JSON puro',
              'Vem embrulhado em cerca de código ou com um preâmbulo',
              'Instrução de formato mais parser tolerante e validação de schema',
            ],
            [
              'A resposta é curta por natureza',
              'Dobra de tamanho e estoura custo e janela',
              'Teto explícito de tamanho e verificação no gate',
            ],
            [
              'Recusa é rara e previsível',
              'Fica mais conservador e recusa caso legítimo',
              'Casos de fronteira no dataset e política de fallback declarada',
            ],
            [
              'Chama a ferramenta certa sem hesitar',
              'Descreve a ação em texto em vez de emitir a tool call',
              'Descrição de tool mais afiada e asserção de tool call no eval',
            ],
            [
              'Segue a ordem das etapas do prompt',
              'Pula ou funde etapas em respostas longas',
              'Saída estruturada por campo em vez de texto sequencial',
            ],
          ],
        },
      ],
    },
    {
      title: 'Caracterizar o comportamento atual antes de comparar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comparar candidato com atual exige saber o que o atual faz, e essa informação quase nunca está documentada: está espalhada em logs. O primeiro passo concreto é montar um dataset de caracterização a partir do tráfego real, não de casos inventados. Uma amostra estratificada dos últimos dias, cobrindo os tipos de pedido na proporção em que aparecem mais os casos raros que importam, com a entrada completa e a resposta que o modelo atual deu. Esse conjunto não é um gabarito de respostas certas, é um retrato do comportamento vigente, e é contra ele que a pergunta da migração fica respondível: o candidato faz o mesmo trabalho, ou faz um trabalho diferente que ninguém pediu.',
        },
        {
          type: 'paragraph',
          value:
            'A amostra precisa de duas propriedades para não enganar. A primeira é cobertura das caudas: os casos raros são justamente onde a diferença entre modelos aparece, então uma amostra puramente aleatória, dominada pelo caso comum, dá uma sensação falsa de paridade. A segunda é ancoragem em resultado real onde ele existe: quando o sistema sabe depois se a resposta resolveu, porque houve escalonamento para humano, reclamação, retrabalho ou conversão, esse sinal deve viajar junto com o caso. Assim o dataset mistura casos com verdade conhecida, que viram asserção objetiva, e casos sem, que dependem de comparação. Uma última regra prática: o dataset carrega dado real de cliente e deve nascer já com redação de dados pessoais, porque ele vai ser lido por gente e enviado para um provedor novo, que é exatamente a operação que a migração está avaliando.',
        },
        {
          type: 'list',
          items: [
            'Amostra estratificada por tipo de pedido, na proporção real do tráfego, com sobrerrepresentação deliberada dos casos raros e caros.',
            'Entrada completa como o modelo a recebe: prompt renderizado, contexto recuperado, histórico e definições de ferramenta, não apenas a mensagem do usuário.',
            'Resposta atual salva junto, com o id da versão de prompt, o modelo e os parâmetros que a produziram, para a comparação ser entre coisas comparáveis.',
            'Sinal de resultado quando existir: escalonou, foi corrigido, resolveu, para separar caso com verdade conhecida de caso que depende de juízo.',
            'Redação de dados pessoais na origem, antes de o dataset sair do sistema, porque ele será lido por humanos e enviado a um provedor novo.',
          ],
        },
      ],
    },
    {
      title: 'Tráfego sombra: rodar o candidato sem que o cliente veja',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O dataset offline pega a regressão previsível, mas tráfego real tem formas que nenhuma amostra antecipa: mensagens truncadas, contexto gigante, sequências de ferramentas que só acontecem numa jornada específica. O tráfego sombra resolve isso rodando o candidato sobre o tráfego de produção ao vivo, em paralelo com o modelo atual, sem que a resposta dele chegue ao cliente. O que o usuário recebe continua vindo do modelo estável; a resposta do candidato é apenas gravada ao lado, formando pares comparáveis das mesmas entradas nas mesmas condições. É a única forma de medir o candidato contra a realidade sem que um erro dele custe alguma coisa.',
        },
        {
          type: 'paragraph',
          value:
            'Três cuidados fazem o tráfego sombra ser seguro em vez de uma nova fonte de incidentes. O primeiro é isolamento de efeito colateral: a execução sombra nunca pode disparar tool call que escreve, então as ferramentas com efeito precisam rodar num modo simulado que registra a intenção sem executar, e comparar intenções continua sendo suficiente para avaliar. O segundo é isolamento de recurso: a sombra não pode competir por cota nem por latência com o caminho do cliente, o que significa fila separada, execução assíncrona depois de responder ao usuário e permissão para descartar quando houver pressão. O terceiro é custo: sombra em cem por cento do tráfego dobra a fatura de inferência, então o normal é amostrar uma fatia, priorizando os tipos de caso onde a diferença importa mais.',
        },
        {
          type: 'diagram',
          value: `Trafego sombra durante a migracao

  requisicao do cliente
        |
        +--> modelo ATUAL (estavel) --> resposta --> CLIENTE
        |
        +--> copia amostrada --> fila separada (assincrona)
                                      |
                                      v
                              modelo CANDIDATO
                              tools em modo simulado
                              (registra intencao, nao executa)
                                      |
                                      v
                              par {atual, candidato} gravado
                                      |
                                      v
                       comparacao: contrato + juiz + custo/latencia
                                      |
                          relatorio de paridade por caso de uso`,
        },
      ],
    },
    {
      title: 'Comparar por contrato antes de comparar por qualidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com os pares em mãos, a tentação é ir direto perguntar qual resposta é melhor. É a ordem errada, e cara. A maior parte das quebras de migração não é de qualidade, é de contrato: JSON que não parseia, campo obrigatório ausente, valor fora do enum, tool call que virou texto, resposta que estourou o teto de tamanho. Essas falhas são detectáveis por código, custam quase nada e são determinísticas. Rodá-las primeiro filtra o grosso do problema antes de gastar chamada de juiz, e dá um diagnóstico acionável: não é "o modelo novo é pior", é "em onze por cento dos casos ele embrulha o JSON em cerca de código", que é uma linha de instrução e um parser mais tolerante, não uma reescrita.',
        },
        {
          type: 'paragraph',
          value:
            'Só o que passa no contrato merece comparação de qualidade, e mesmo aí a comparação precisa ser desenhada para não se enganar sozinha. Um juiz que recebe "resposta A" e "resposta B" tende a preferir a mais longa e a que vem primeiro, então a posição deve ser embaralhada por caso e o critério precisa ser explícito sobre o que conta: resolve o pedido, respeita a política, não inventa fato que não está no contexto. E o juízo deve ser calibrado contra um punhado de casos rotulados por gente antes de valer como métrica, senão a migração troca uma incerteza por outra. Um detalhe que costuma passar batido: se o modelo candidato for da mesma família do juiz, existe viés de autopreferência, e vale usar um juiz de outra família ou rotular à mão a fatia decisiva.',
        },
        {
          type: 'code',
          value: `// compare/contract.js
// Ordem certa: checagens de contrato primeiro (baratas, deterministicas),
// juiz so no que sobrevive. A maioria das quebras de migracao e de
// formato, nao de qualidade.

const FENCE = /^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/;

// Parser tolerante: aceita o JSON embrulhado, mas REGISTRA o desvio.
// Tolerar sem medir esconde a regressao que o gate precisa ver.
export function parseStructured(raw) {
  const text = String(raw ?? '').trim();
  const fenced = text.match(FENCE);
  const body = fenced ? fenced[1] : text;
  try {
    return { ok: true, value: JSON.parse(body), fenced: Boolean(fenced) };
  } catch {
    return { ok: false, value: null, fenced: Boolean(fenced) };
  }
}

export function checkContract(output, spec) {
  const violations = [];
  const parsed = parseStructured(output.text);

  if (!parsed.ok) violations.push('json_invalido');
  if (parsed.fenced) violations.push('json_em_cerca_de_codigo');

  if (parsed.ok) {
    for (const field of spec.requiredFields) {
      if (parsed.value[field] === undefined) violations.push('campo_ausente:' + field);
    }
    for (const [field, allowed] of Object.entries(spec.enums ?? {})) {
      const v = parsed.value[field];
      if (v !== undefined && !allowed.includes(v)) violations.push('enum_invalido:' + field);
    }
  }

  // Tool call que virou texto e a quebra mais silenciosa: o sistema
  // segue respondendo, so parou de agir.
  if (spec.expectsToolCall && !output.toolCalls?.length) violations.push('tool_call_ausente');
  if (spec.maxOutputTokens && output.usage.outputTokens > spec.maxOutputTokens) {
    violations.push('estourou_teto_de_tamanho');
  }

  return { pass: violations.length === 0, violations, parsed };
}`,
        },
      ],
    },
    {
      title: 'Adaptar o prompt em vez de reescrevê-lo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o relatório aponta as diferenças, a reação errada é reescrever o prompt do zero para o modelo novo. O prompt atual codifica anos de casos de borda descobertos em produção, e uma reescrita joga esse conhecimento fora para resolver problemas de formato. A abordagem que funciona é cirúrgica: para cada violação de contrato recorrente, uma instrução explícita que fecha a suposição que estava tácita, e nada mais. JSON embrulhado vira uma linha proibindo cerca de código somada a um parser que a tolera; resposta longa demais vira um teto declarado; recusa em caso legítimo vira um exemplo de fronteira mostrando o comportamento esperado. Cada mudança dessas é pequena, verificável no dataset e reversível.',
        },
        {
          type: 'paragraph',
          value:
            'A regra que evita o efeito sanfona é validar cada ajuste nos dois modelos, não só no candidato. Uma instrução adicionada para consertar o modelo novo pode piorar o antigo, e como o antigo continua servindo o cliente durante toda a migração, uma regressão nele é dano imediato. O caminho seguro é tratar o prompt adaptado como uma versão candidata no mesmo esquema de versionamento que o resto: id imutável, dataset rodando contra as duas combinações de modelo e prompt, promoção só quando a nova combinação empata ou ganha e a antiga não piora. E quando a diferença for grande demais para ser fechada com ajustes pontuais, a decisão honesta é manter duas variantes do prompt, uma por modelo, no mesmo registro, com o custo de manutenção explícito em vez de fingir que uma serve para as duas.',
        },
        {
          type: 'ordered',
          items: [
            'Agrupe as violações por tipo, não por caso: dez falhas de JSON embrulhado são um problema, não dez, e se resolvem com uma instrução.',
            'Feche cada suposição tácita com a menor mudança possível de prompt, uma por vez, medindo o efeito isolado no dataset.',
            'Rode cada ajuste nas duas combinações de modelo e prompt: o antigo ainda atende o cliente e não pode regredir durante a migração.',
            'Prefira mudar o parser e a validação quando o desvio for de formato tolerável, e mudar o prompt quando for de comportamento.',
            'Se restar diferença estrutural, mantenha duas variantes de prompt por modelo, com custo de manutenção declarado, em vez de forçar uma só.',
          ],
        },
      ],
    },
    {
      title: 'O gate de paridade e o corte com rollback pronto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Migração precisa de um critério de parada escrito antes do resultado, senão a decisão vira negociação com o próprio viés. Esse critério é o gate de paridade, e ele é por caso de uso, não global. Uma média agregada esconde exatamente o que importa: o candidato pode ficar dois por cento melhor no geral e vinte por cento pior na fatia que envolve cobrança, e a média não conta isso. O gate declara, para cada caso de uso, o limite de queda tolerável em taxa de contrato válido, em qualidade julgada, em escalonamento para humano, e o teto de piora aceitável em custo e latência. Um caso de uso que não passa não bloqueia os outros: bloqueia a si mesmo, e o roteamento pode manter aquele caso no modelo antigo enquanto o resto migra.',
        },
        {
          type: 'paragraph',
          value:
            'Com o gate verde, o corte segue o mesmo desenho de qualquer mudança arriscada: fatia pequena e determinística por usuário para a conversa não trocar de modelo no meio, subida em degraus vigiada por métrica, e rollback como troca de ponteiro em vez de redeploy. A diferença é que aqui há um detalhe fácil de esquecer com custo alto: cache. Cache semântico e cache de prompt carregam respostas produzidas pelo modelo antigo, e servir uma dessas para tráfego que já está no modelo novo mistura os comportamentos e corrompe a medição. A chave de cache precisa incluir o identificador do modelo, senão o rollout mede uma mistura. O mesmo vale para as métricas: tudo quebrado por modelo, senão a comparação some no agregado.',
        },
        {
          type: 'code',
          value: `// gate/parity.js
// Gate de paridade POR CASO DE USO, com limites escritos antes de ver
// o resultado. Media global esconde a fatia que regrediu.

export function parityGate(results, budgets) {
  const byUseCase = new Map();
  for (const r of results) {
    const bucket = byUseCase.get(r.useCase) ?? [];
    bucket.push(r);
    byUseCase.set(r.useCase, bucket);
  }

  const report = [];
  for (const [useCase, rows] of byUseCase) {
    const budget = budgets[useCase] ?? budgets.default;
    const n = rows.length;

    const contractDrop =
      rows.filter((r) => r.current.contractOk && !r.candidate.contractOk).length / n;
    const qualityDrop = rows.filter((r) => r.judge === 'current_better').length / n
      - rows.filter((r) => r.judge === 'candidate_better').length / n;
    const costRatio =
      rows.reduce((s, r) => s + r.candidate.costUsd, 0) /
      Math.max(rows.reduce((s, r) => s + r.current.costUsd, 0), 1e-9);
    const p95Ratio = percentile(rows.map((r) => r.candidate.ms), 95) /
      Math.max(percentile(rows.map((r) => r.current.ms), 95), 1);

    const failures = [];
    if (contractDrop > budget.maxContractDrop) failures.push('contrato');
    if (qualityDrop > budget.maxQualityDrop) failures.push('qualidade');
    if (costRatio > budget.maxCostRatio) failures.push('custo');
    if (p95Ratio > budget.maxLatencyRatio) failures.push('latencia');

    // Caso de uso reprovado nao bloqueia os outros: fica no modelo
    // antigo enquanto o resto migra.
    report.push({ useCase, n, contractDrop, qualityDrop, costRatio, p95Ratio, pass: failures.length === 0, failures });
  }
  return report;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}`,
        },
        {
          type: 'paragraph',
          value:
            'Depois do corte, a migração não acabou: ela entra no período em que a diferença lenta aparece. Regressões de formato surgem em horas, mas mudanças de tom, de tamanho médio de resposta e de taxa de escalonamento levam dias para se separar do ruído. Vale manter o modelo antigo acessível por uma janela combinada, o gate de paridade rodando em amostra contínua e as métricas quebradas por modelo enquanto durar essa janela. Só depois disso o modelo antigo sai do manifesto e o prompt adaptado vira o novo estável, com uma lista de suposições agora explícitas que torna a próxima migração incomparavelmente mais barata.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que trocar o modelo quebra um prompt que estava funcionando bem?',
      answer:
        'Porque o prompt não é portátil: ele foi lapidado contra um modelo específico e boa parte do que faz ele funcionar nunca virou instrução escrita. Se o modelo antigo já devolvia JSON limpo, ninguém precisou proibir cerca de código; se já era conciso, ninguém pôs teto de tamanho; se raramente recusava, ninguém definiu o que fazer com a recusa. Cada silêncio desses é uma suposição tácita, e a troca de modelo testa todas de uma vez. O resultado típico não é um sistema que para, é um sistema que continua respondendo com uma fatia dos casos saindo errada de um jeito que só aparece na métrica dias depois. Por isso a migração começa listando o que o sistema depende e não está escrito, porque cada suposição não escrita é exatamente um caso de regressão a verificar no candidato.',
    },
    {
      question: 'Como testar o modelo novo sem arriscar o cliente?',
      answer:
        'Com tráfego sombra: o candidato roda sobre o tráfego real de produção em paralelo com o modelo atual, mas a resposta dele nunca chega ao cliente, apenas é gravada ao lado formando pares comparáveis. Isso pega as formas que nenhum dataset antecipa, como mensagens truncadas, contexto gigante e sequências raras de ferramentas. Três cuidados tornam a sombra segura: as ferramentas com efeito colateral rodam em modo simulado, registrando a intenção sem executar, para a execução sombra não escrever nada; a sombra usa fila separada e execução assíncrona depois de responder ao usuário, para não competir por cota nem por latência com o caminho do cliente; e o tráfego é amostrado em vez de espelhado por inteiro, porque sombra em cem por cento dobra a fatura de inferência.',
    },
    {
      question: 'Qual critério usar para decidir que a migração pode subir?',
      answer:
        'Um gate de paridade por caso de uso, com limites escritos antes de ver o resultado. Média agregada esconde o que importa: o candidato pode ficar dois por cento melhor no geral e vinte por cento pior na fatia que envolve cobrança. O gate declara, por caso de uso, a queda tolerável em taxa de contrato válido, em qualidade julgada e em escalonamento para humano, mais o teto de piora em custo e latência; um caso de uso que não passa fica no modelo antigo enquanto o resto migra, em vez de bloquear tudo. A ordem de avaliação também importa: checagens de contrato primeiro, porque são determinísticas, baratas e pegam a maioria das quebras, e juiz apenas no que sobreviveu, com posição embaralhada e critério calibrado contra rótulos humanos.',
    },
  ],
  conclusion: {
    title: 'Migrar de modelo é um projeto de engenharia, não uma troca de string',
    description:
      'Trocar o modelo parece uma linha de configuração, mas o prompt em produção carrega meses de suposições tácitas sobre como aquele modelo específico se comporta, e a troca testa todas de uma vez nas bordas: JSON que passou a vir embrulhado, resposta que dobrou de tamanho, tool call que virou texto, recusa em caso legítimo. Caracterizar o comportamento atual com uma amostra real, rodar o candidato em tráfego sombra sem risco ao cliente, comparar por contrato antes de comparar por qualidade, adaptar o prompt com mudanças cirúrgicas validadas nos dois modelos e cortar por trás de um gate de paridade por caso de uso, com rollback como troca de ponteiro, transforma a migração de uma aposta numa operação medida. Posso conduzir essa migração no seu sistema com LLM, do harness de sombra ao gate de paridade, para você trocar de modelo sem descobrir a regressão pelo cliente.',
    cta: 'Falar sobre migrar de modelo sem quebrar o meu prompt',
  },
  related: [
    { label: 'Versionar prompt como código: rollout, rollback e teste', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-migration-shadow-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Swapping the model looks like the cheapest change in an LLM system: one configuration string, one deploy, done. Except the prompt in production is not a neutral text that any model reads the same way. It was polished over months against one specific model, and much of what makes it work is not written down: it lives in how that model interprets an ambiguous instruction, in the format it already returns without anyone asking, in how many examples it needs before getting things right. Swapping the model removes that tacit agreement, and what breaks is not the whole prompt, it is the edges: the JSON that now comes wrapped in markdown, the refusal that grew more conservative, the answer that doubled in size and blew the token budget. This article shows how to migrate without gambling: characterize what the prompt depends on from the old model, run the candidate on shadow traffic with no risk to the customer, compare by contract and by judgment, adapt the prompt instead of rewriting it from scratch and cut over with the rollback ready.',
  sections: [
    {
      title: 'The prompt is not portable: it was tuned against one model',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every mature prompt carries an invisible debt to the model it was born on. The explicit instructions are the small part; the big part is the behavior the old model delivered by default and therefore never had to become a rule. If that model already returned clean JSON when the prompt said "answer in JSON", nobody wrote "no code fences, no text before or after". If it was already concise, nobody set a size ceiling. If it rarely refused, nobody defined what to do when a refusal arrives. Each of those silences is an assumption, and the model swap tests all of them at once. The typical result is not a system that stops: it is a system that keeps answering, with a slice of the cases coming out wrong in a way that only shows up in the metrics days later.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the migration does not start by picking the new model, it starts by listing the assumptions. The exercise is to read the prompt and the surrounding code asking, for each behavior the system depends on, whether it is written down or merely happening. What is written travels with the prompt; what is merely happening is debt that comes due at the swap. That list becomes the backbone of the migration test, because each unwritten assumption is exactly one regression case to check on the candidate. Doing this before the swap turns the migration from a mystery into a finite checklist, and usually has the side effect of improving the prompt on the current model: an assumption turned into an explicit instruction reduces variance even without changing anything else.',
        },
        {
          type: 'table',
          columns: ['Tacit assumption', 'How it breaks on the new model', 'How to make it explicit'],
          rows: [
            [
              'The model returns pure JSON',
              'Comes wrapped in a code fence or with a preamble',
              'Format instruction plus a tolerant parser and schema validation',
            ],
            [
              'The answer is short by nature',
              'Doubles in size and blows cost and window',
              'Explicit size ceiling and a check in the gate',
            ],
            [
              'Refusal is rare and predictable',
              'Grows more conservative and refuses a legitimate case',
              'Boundary cases in the dataset and a declared fallback policy',
            ],
            [
              'It calls the right tool without hesitating',
              'Describes the action in text instead of emitting the tool call',
              'Sharper tool description and a tool call assertion in the eval',
            ],
            [
              'It follows the order of the prompt steps',
              'Skips or merges steps in long answers',
              'Structured output per field instead of sequential text',
            ],
          ],
        },
      ],
    },
    {
      title: 'Characterize current behavior before comparing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comparing candidate against current requires knowing what current does, and that information is almost never documented: it is spread across logs. The first concrete step is building a characterization dataset from real traffic, not from invented cases. A stratified sample of the last few days, covering the request types in the proportion they appear plus the rare cases that matter, with the complete input and the answer the current model gave. That set is not a ground truth of right answers, it is a portrait of the current behavior, and it is against it that the migration question becomes answerable: does the candidate do the same job, or a different job nobody asked for.',
        },
        {
          type: 'paragraph',
          value:
            'The sample needs two properties in order not to mislead. The first is tail coverage: the rare cases are exactly where the difference between models shows up, so a purely random sample dominated by the common case gives a false sense of parity. The second is anchoring on real outcome where it exists: when the system learns afterwards whether the answer solved it, because there was an escalation to a human, a complaint, rework or a conversion, that signal must travel with the case. That way the dataset mixes cases with known truth, which become objective assertions, and cases without, which depend on comparison. One last practical rule: the dataset carries real customer data and must be born with personal data redaction, because it will be read by people and sent to a new provider, which is exactly the operation the migration is evaluating.',
        },
        {
          type: 'list',
          items: [
            'Sample stratified by request type, in the real traffic proportion, with deliberate over-representation of rare and expensive cases.',
            'Complete input as the model receives it: rendered prompt, retrieved context, history and tool definitions, not just the user message.',
            'Current answer saved alongside, with the prompt version id, the model and the parameters that produced it, so the comparison is between comparable things.',
            'Outcome signal when it exists: escalated, was corrected, resolved, to separate a case with known truth from one that depends on judgment.',
            'Personal data redaction at the source, before the dataset leaves the system, because it will be read by humans and sent to a new provider.',
          ],
        },
      ],
    },
    {
      title: 'Shadow traffic: running the candidate without the customer seeing it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The offline dataset catches the predictable regression, but real traffic has shapes no sample anticipates: truncated messages, giant context, tool sequences that only happen in one specific journey. Shadow traffic solves that by running the candidate over live production traffic, in parallel with the current model, without its answer reaching the customer. What the user receives still comes from the stable model; the candidate answer is only recorded alongside, forming comparable pairs of the same inputs under the same conditions. It is the only way to measure the candidate against reality without a mistake of its costing anything.',
        },
        {
          type: 'paragraph',
          value:
            'Three precautions make shadow traffic safe instead of a new source of incidents. The first is side-effect isolation: the shadow run can never fire a tool call that writes, so tools with effects must run in a simulated mode that records the intent without executing, and comparing intents is still enough for evaluation. The second is resource isolation: the shadow must not compete for quota or latency with the customer path, which means a separate queue, asynchronous execution after answering the user, and permission to drop under pressure. The third is cost: shadowing a hundred percent of the traffic doubles the inference bill, so the norm is to sample a slice, prioritizing the case types where the difference matters most.',
        },
        {
          type: 'diagram',
          value: `Shadow traffic during the migration

  customer request
        |
        +--> CURRENT model (stable) --> answer --> CUSTOMER
        |
        +--> sampled copy --> separate queue (async)
                                    |
                                    v
                            CANDIDATE model
                            tools in simulated mode
                            (records intent, does not execute)
                                    |
                                    v
                          pair {current, candidate} stored
                                    |
                                    v
                    comparison: contract + judge + cost/latency
                                    |
                        parity report per use case`,
        },
      ],
    },
    {
      title: 'Compare by contract before comparing by quality',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the pairs in hand, the temptation is to go straight to asking which answer is better. That is the wrong order, and an expensive one. Most migration breakages are not about quality, they are about contract: JSON that does not parse, missing required field, value outside the enum, a tool call that became text, an answer that blew the size ceiling. Those failures are detectable by code, cost almost nothing and are deterministic. Running them first filters out the bulk of the problem before spending a judge call, and gives an actionable diagnosis: it is not "the new model is worse", it is "in eleven percent of the cases it wraps the JSON in a code fence", which is one instruction line and a more tolerant parser, not a rewrite.',
        },
        {
          type: 'paragraph',
          value:
            'Only what passes the contract deserves a quality comparison, and even there the comparison must be designed not to fool itself. A judge given "answer A" and "answer B" tends to prefer the longer one and the one that comes first, so position must be shuffled per case and the criterion must be explicit about what counts: it solves the request, it respects the policy, it does not invent a fact that is not in the context. And the judgment must be calibrated against a handful of human-labeled cases before it counts as a metric, otherwise the migration trades one uncertainty for another. One detail that usually slips by: if the candidate model is from the same family as the judge, there is a self-preference bias, and it pays to use a judge from another family or hand-label the decisive slice.',
        },
        {
          type: 'code',
          value: `// compare/contract.js
// Right order: contract checks first (cheap, deterministic), judge only
// on what survives. Most migration breakages are about format, not
// quality.

const FENCE = /^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/;

// Tolerant parser: accepts the wrapped JSON, but RECORDS the deviation.
// Tolerating without measuring hides the regression the gate must see.
export function parseStructured(raw) {
  const text = String(raw ?? '').trim();
  const fenced = text.match(FENCE);
  const body = fenced ? fenced[1] : text;
  try {
    return { ok: true, value: JSON.parse(body), fenced: Boolean(fenced) };
  } catch {
    return { ok: false, value: null, fenced: Boolean(fenced) };
  }
}

export function checkContract(output, spec) {
  const violations = [];
  const parsed = parseStructured(output.text);

  if (!parsed.ok) violations.push('invalid_json');
  if (parsed.fenced) violations.push('json_in_code_fence');

  if (parsed.ok) {
    for (const field of spec.requiredFields) {
      if (parsed.value[field] === undefined) violations.push('missing_field:' + field);
    }
    for (const [field, allowed] of Object.entries(spec.enums ?? {})) {
      const v = parsed.value[field];
      if (v !== undefined && !allowed.includes(v)) violations.push('invalid_enum:' + field);
    }
  }

  // A tool call that became text is the quietest breakage: the system
  // keeps answering, it just stopped acting.
  if (spec.expectsToolCall && !output.toolCalls?.length) violations.push('missing_tool_call');
  if (spec.maxOutputTokens && output.usage.outputTokens > spec.maxOutputTokens) {
    violations.push('size_ceiling_exceeded');
  }

  return { pass: violations.length === 0, violations, parsed };
}`,
        },
      ],
    },
    {
      title: 'Adapt the prompt instead of rewriting it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the report points at the differences, the wrong reaction is rewriting the prompt from scratch for the new model. The current prompt encodes years of edge cases discovered in production, and a rewrite throws that knowledge away to solve formatting problems. The approach that works is surgical: for each recurring contract violation, one explicit instruction that closes the assumption that was tacit, and nothing more. Wrapped JSON becomes a line forbidding code fences plus a parser that tolerates them; an overly long answer becomes a declared ceiling; a refusal on a legitimate case becomes a boundary example showing the expected behavior. Each of those changes is small, verifiable on the dataset and reversible.',
        },
        {
          type: 'paragraph',
          value:
            'The rule that avoids the seesaw effect is validating each adjustment on both models, not only on the candidate. An instruction added to fix the new model can make the old one worse, and since the old one keeps serving the customer throughout the migration, a regression there is immediate damage. The safe path is to treat the adapted prompt as a candidate version in the same versioning scheme as the rest: immutable id, the dataset running against both model and prompt combinations, promotion only when the new combination ties or wins and the old one does not get worse. And when the difference is too large to close with pointed adjustments, the honest decision is to keep two prompt variants, one per model, in the same registry, with the maintenance cost explicit instead of pretending one serves both.',
        },
        {
          type: 'ordered',
          items: [
            'Group violations by type, not by case: ten wrapped-JSON failures are one problem, not ten, and they are solved with one instruction.',
            'Close each tacit assumption with the smallest possible prompt change, one at a time, measuring the isolated effect on the dataset.',
            'Run each adjustment on both model and prompt combinations: the old one still serves the customer and cannot regress during the migration.',
            'Prefer changing the parser and the validation when the deviation is a tolerable format issue, and changing the prompt when it is behavioral.',
            'If a structural difference remains, keep two prompt variants per model, with the maintenance cost declared, instead of forcing a single one.',
          ],
        },
      ],
    },
    {
      title: 'The parity gate and the cutover with rollback ready',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migration needs a stopping criterion written before the result, otherwise the decision becomes a negotiation with your own bias. That criterion is the parity gate, and it is per use case, not global. An aggregate average hides exactly what matters: the candidate can be two percent better overall and twenty percent worse on the slice that involves billing, and the average does not tell you that. The gate declares, for each use case, the tolerable drop in valid contract rate, in judged quality, in escalation to a human, and the acceptable ceiling of degradation in cost and latency. A use case that does not pass does not block the others: it blocks itself, and routing can keep that case on the old model while the rest migrates.',
        },
        {
          type: 'paragraph',
          value:
            'With the gate green, the cutover follows the same design as any risky change: a small slice, deterministic per user so the conversation does not switch models midway, a staircase raise watched by metrics, and rollback as a pointer flip instead of a redeploy. The difference is that here there is a detail that is easy to forget and expensive: cache. Semantic cache and prompt cache carry answers produced by the old model, and serving one of those to traffic already on the new model mixes the behaviors and corrupts the measurement. The cache key must include the model identifier, otherwise the rollout measures a blend. The same goes for the metrics: everything broken down by model, otherwise the comparison disappears into the aggregate.',
        },
        {
          type: 'code',
          value: `// gate/parity.js
// Parity gate PER USE CASE, with limits written before seeing the
// result. A global average hides the slice that regressed.

export function parityGate(results, budgets) {
  const byUseCase = new Map();
  for (const r of results) {
    const bucket = byUseCase.get(r.useCase) ?? [];
    bucket.push(r);
    byUseCase.set(r.useCase, bucket);
  }

  const report = [];
  for (const [useCase, rows] of byUseCase) {
    const budget = budgets[useCase] ?? budgets.default;
    const n = rows.length;

    const contractDrop =
      rows.filter((r) => r.current.contractOk && !r.candidate.contractOk).length / n;
    const qualityDrop = rows.filter((r) => r.judge === 'current_better').length / n
      - rows.filter((r) => r.judge === 'candidate_better').length / n;
    const costRatio =
      rows.reduce((s, r) => s + r.candidate.costUsd, 0) /
      Math.max(rows.reduce((s, r) => s + r.current.costUsd, 0), 1e-9);
    const p95Ratio = percentile(rows.map((r) => r.candidate.ms), 95) /
      Math.max(percentile(rows.map((r) => r.current.ms), 95), 1);

    const failures = [];
    if (contractDrop > budget.maxContractDrop) failures.push('contract');
    if (qualityDrop > budget.maxQualityDrop) failures.push('quality');
    if (costRatio > budget.maxCostRatio) failures.push('cost');
    if (p95Ratio > budget.maxLatencyRatio) failures.push('latency');

    // A failing use case does not block the others: it stays on the old
    // model while the rest migrates.
    report.push({ useCase, n, contractDrop, qualityDrop, costRatio, p95Ratio, pass: failures.length === 0, failures });
  }
  return report;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}`,
        },
        {
          type: 'paragraph',
          value:
            'After the cutover the migration is not over: it enters the period where the slow difference shows up. Format regressions appear within hours, but changes in tone, in average answer size and in escalation rate take days to separate from the noise. It is worth keeping the old model reachable for an agreed window, the parity gate running on a continuous sample and the metrics broken down by model for as long as that window lasts. Only after that does the old model leave the manifest and the adapted prompt become the new stable, with a list of now explicit assumptions that makes the next migration incomparably cheaper.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does swapping the model break a prompt that was working well?',
      answer:
        'Because the prompt is not portable: it was polished against one specific model and much of what makes it work never became a written instruction. If the old model already returned clean JSON, nobody had to forbid code fences; if it was already concise, nobody set a size ceiling; if it rarely refused, nobody defined what to do with a refusal. Each of those silences is a tacit assumption, and the model swap tests them all at once. The typical result is not a system that stops, it is a system that keeps answering with a slice of the cases coming out wrong in a way that only shows up in the metrics days later. That is why the migration starts by listing what the system depends on and is not written down, because each unwritten assumption is exactly one regression case to check on the candidate.',
    },
    {
      question: 'How do you test the new model without risking the customer?',
      answer:
        'With shadow traffic: the candidate runs over real production traffic in parallel with the current model, but its answer never reaches the customer, it is only recorded alongside forming comparable pairs. That catches the shapes no dataset anticipates, such as truncated messages, giant context and rare tool sequences. Three precautions make the shadow safe: tools with side effects run in a simulated mode, recording the intent without executing, so the shadow run writes nothing; the shadow uses a separate queue and asynchronous execution after answering the user, so it does not compete for quota or latency with the customer path; and traffic is sampled instead of mirrored in full, because shadowing a hundred percent doubles the inference bill.',
    },
    {
      question: 'What criterion decides that the migration can go live?',
      answer:
        'A parity gate per use case, with limits written before seeing the result. An aggregate average hides what matters: the candidate can be two percent better overall and twenty percent worse on the slice that involves billing. The gate declares, per use case, the tolerable drop in valid contract rate, in judged quality and in escalation to a human, plus the ceiling of degradation in cost and latency; a use case that does not pass stays on the old model while the rest migrates, instead of blocking everything. The evaluation order matters too: contract checks first, because they are deterministic, cheap and catch most breakages, and a judge only on what survived, with shuffled position and a criterion calibrated against human labels.',
    },
  ],
  conclusion: {
    title: 'Migrating models is an engineering project, not a string swap',
    description:
      'Swapping the model looks like one configuration line, but the prompt in production carries months of tacit assumptions about how that specific model behaves, and the swap tests all of them at once at the edges: JSON that now comes wrapped, an answer that doubled in size, a tool call that became text, a refusal on a legitimate case. Characterizing current behavior with a real sample, running the candidate on shadow traffic with no risk to the customer, comparing by contract before comparing by quality, adapting the prompt with surgical changes validated on both models and cutting over behind a per-use-case parity gate, with rollback as a pointer flip, turns the migration from a gamble into a measured operation. I can run that migration in your LLM system, from the shadow harness to the parity gate, so you switch models without learning about the regression from the customer.',
    cta: 'Talk about migrating models without breaking my prompt',
  },
  related: [
    { label: 'Versioning the prompt as code: rollout, rollback and testing', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-migration-shadow-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Cambiar el modelo parece el cambio más barato de un sistema con LLM: una cadena de configuración, un deploy, listo. Solo que el prompt en producción no es un texto neutro que cualquier modelo lee igual. Fue pulido durante meses contra un modelo específico, y buena parte de lo que lo hace funcionar no está escrito: está en la forma en que ese modelo interpreta una instrucción ambigua, en el formato que ya devuelve sin que nadie lo pida, en la cantidad de ejemplos que necesita antes de acertar. Cambiar el modelo elimina ese acuerdo tácito, y lo que se rompe no es el prompt entero, son los bordes: el JSON que ahora viene envuelto en markdown, el rechazo que se volvió más conservador, la respuesta que duplicó su tamaño y reventó el presupuesto de tokens. Este artículo muestra cómo migrar sin apostar: caracterizar de qué depende el prompt respecto del modelo viejo, correr el candidato en tráfico sombra sin riesgo para el cliente, comparar por contrato y por juicio, adaptar el prompt en vez de reescribirlo desde cero y hacer el corte con el rollback listo.',
  sections: [
    {
      title: 'El prompt no es portable: fue ajustado contra un modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo prompt maduro carga una deuda invisible con el modelo en el que nació. Las instrucciones explícitas son la parte pequeña; la parte grande es el comportamiento que el modelo viejo entregaba por defecto y por eso nunca necesitó volverse regla. Si aquel modelo ya devolvía JSON limpio cuando el prompt pedía "responde en JSON", nadie escribió "sin cercas de código, sin texto antes ni después". Si ya era conciso, nadie puso un techo de tamaño. Si rara vez rechazaba, nadie definió qué hacer cuando llega el rechazo. Cada uno de esos silencios es una suposición, y el cambio de modelo las prueba todas de una vez. El resultado típico no es un sistema que se detiene: es un sistema que sigue respondiendo, con una porción de los casos saliendo mal de una forma que solo aparece en la métrica días después.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso la migración no empieza eligiendo el modelo nuevo, empieza listando las suposiciones. El ejercicio es leer el prompt y el código alrededor preguntando, para cada comportamiento del que el sistema depende, si está escrito o si simplemente está ocurriendo. Lo que está escrito viaja con el prompt; lo que apenas ocurre es deuda que vence en el cambio. Esa lista se vuelve la columna del test de migración, porque cada suposición no escrita es exactamente un caso de regresión a verificar en el candidato. Hacerlo antes del cambio transforma la migración de un misterio en un checklist finito, y suele tener el efecto colateral de mejorar el prompt en el modelo actual: una suposición convertida en instrucción explícita reduce varianza incluso sin cambiar nada más.',
        },
        {
          type: 'table',
          columns: ['Suposición tácita', 'Cómo se rompe en el modelo nuevo', 'Cómo volverla explícita'],
          rows: [
            [
              'El modelo devuelve JSON puro',
              'Viene envuelto en cerca de código o con un preámbulo',
              'Instrucción de formato más parser tolerante y validación de schema',
            ],
            [
              'La respuesta es corta por naturaleza',
              'Duplica su tamaño y revienta costo y ventana',
              'Techo explícito de tamaño y verificación en el gate',
            ],
            [
              'El rechazo es raro y predecible',
              'Se vuelve más conservador y rechaza un caso legítimo',
              'Casos de frontera en el dataset y política de fallback declarada',
            ],
            [
              'Llama a la herramienta correcta sin dudar',
              'Describe la acción en texto en vez de emitir la tool call',
              'Descripción de tool más afilada y aserción de tool call en el eval',
            ],
            [
              'Sigue el orden de las etapas del prompt',
              'Salta o fusiona etapas en respuestas largas',
              'Salida estructurada por campo en vez de texto secuencial',
            ],
          ],
        },
      ],
    },
    {
      title: 'Caracterizar el comportamiento actual antes de comparar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Comparar candidato contra actual exige saber qué hace el actual, y esa información casi nunca está documentada: está dispersa en logs. El primer paso concreto es armar un dataset de caracterización a partir del tráfico real, no de casos inventados. Una muestra estratificada de los últimos días, cubriendo los tipos de pedido en la proporción en que aparecen más los casos raros que importan, con la entrada completa y la respuesta que dio el modelo actual. Ese conjunto no es un gabarito de respuestas correctas, es un retrato del comportamiento vigente, y es contra él que la pregunta de la migración se vuelve respondible: el candidato hace el mismo trabajo, o hace un trabajo distinto que nadie pidió.',
        },
        {
          type: 'paragraph',
          value:
            'La muestra necesita dos propiedades para no engañar. La primera es cobertura de las colas: los casos raros son justamente donde aparece la diferencia entre modelos, así que una muestra puramente aleatoria, dominada por el caso común, da una sensación falsa de paridad. La segunda es anclaje en resultado real donde existe: cuando el sistema sabe después si la respuesta resolvió, porque hubo escalonamiento a humano, reclamo, retrabajo o conversión, esa señal debe viajar junto con el caso. Así el dataset mezcla casos con verdad conocida, que se vuelven aserción objetiva, y casos sin ella, que dependen de comparación. Una última regla práctica: el dataset carga dato real de cliente y debe nacer ya con redacción de datos personales, porque será leído por gente y enviado a un proveedor nuevo, que es exactamente la operación que la migración está evaluando.',
        },
        {
          type: 'list',
          items: [
            'Muestra estratificada por tipo de pedido, en la proporción real del tráfico, con sobrerrepresentación deliberada de los casos raros y caros.',
            'Entrada completa tal como el modelo la recibe: prompt renderizado, contexto recuperado, historial y definiciones de herramienta, no solo el mensaje del usuario.',
            'Respuesta actual guardada junto, con el id de la versión de prompt, el modelo y los parámetros que la produjeron, para que la comparación sea entre cosas comparables.',
            'Señal de resultado cuando exista: escaló, fue corregido, resolvió, para separar el caso con verdad conocida del que depende de juicio.',
            'Redacción de datos personales en el origen, antes de que el dataset salga del sistema, porque será leído por humanos y enviado a un proveedor nuevo.',
          ],
        },
      ],
    },
    {
      title: 'Tráfico sombra: correr el candidato sin que el cliente lo vea',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El dataset offline atrapa la regresión previsible, pero el tráfico real tiene formas que ninguna muestra anticipa: mensajes truncados, contexto gigante, secuencias de herramientas que solo ocurren en una jornada específica. El tráfico sombra resuelve eso corriendo el candidato sobre el tráfico de producción en vivo, en paralelo con el modelo actual, sin que su respuesta llegue al cliente. Lo que el usuario recibe sigue viniendo del modelo estable; la respuesta del candidato solo se graba al lado, formando pares comparables de las mismas entradas en las mismas condiciones. Es la única forma de medir el candidato contra la realidad sin que un error suyo cueste algo.',
        },
        {
          type: 'paragraph',
          value:
            'Tres cuidados hacen que el tráfico sombra sea seguro en vez de una nueva fuente de incidentes. El primero es aislamiento de efecto colateral: la ejecución sombra nunca puede disparar una tool call que escribe, así que las herramientas con efecto deben correr en un modo simulado que registra la intención sin ejecutar, y comparar intenciones sigue siendo suficiente para evaluar. El segundo es aislamiento de recurso: la sombra no puede competir por cuota ni por latencia con el camino del cliente, lo que significa cola separada, ejecución asíncrona después de responder al usuario y permiso para descartar cuando haya presión. El tercero es costo: sombra en cien por ciento del tráfico duplica la factura de inferencia, así que lo normal es muestrear una porción, priorizando los tipos de caso donde la diferencia importa más.',
        },
        {
          type: 'diagram',
          value: `Trafico sombra durante la migracion

  peticion del cliente
        |
        +--> modelo ACTUAL (estable) --> respuesta --> CLIENTE
        |
        +--> copia muestreada --> cola separada (asincrona)
                                       |
                                       v
                               modelo CANDIDATO
                               tools en modo simulado
                               (registra intencion, no ejecuta)
                                       |
                                       v
                            par {actual, candidato} guardado
                                       |
                                       v
                    comparacion: contrato + juez + costo/latencia
                                       |
                        reporte de paridad por caso de uso`,
        },
      ],
    },
    {
      title: 'Comparar por contrato antes de comparar por calidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con los pares en la mano, la tentación es ir directo a preguntar qué respuesta es mejor. Es el orden equivocado, y caro. La mayor parte de las roturas de migración no es de calidad, es de contrato: JSON que no parsea, campo obligatorio ausente, valor fuera del enum, tool call que se volvió texto, respuesta que reventó el techo de tamaño. Esas fallas son detectables por código, cuestan casi nada y son deterministas. Correrlas primero filtra el grueso del problema antes de gastar una llamada de juez, y da un diagnóstico accionable: no es "el modelo nuevo es peor", es "en once por ciento de los casos envuelve el JSON en cerca de código", que es una línea de instrucción y un parser más tolerante, no una reescritura.',
        },
        {
          type: 'paragraph',
          value:
            'Solo lo que pasa el contrato merece comparación de calidad, y aun ahí la comparación debe diseñarse para no engañarse sola. Un juez que recibe "respuesta A" y "respuesta B" tiende a preferir la más larga y la que viene primero, así que la posición debe barajarse por caso y el criterio debe ser explícito sobre qué cuenta: resuelve el pedido, respeta la política, no inventa un hecho que no está en el contexto. Y el juicio debe calibrarse contra un puñado de casos etiquetados por gente antes de valer como métrica, si no la migración cambia una incertidumbre por otra. Un detalle que suele pasar desapercibido: si el modelo candidato es de la misma familia que el juez, existe sesgo de autopreferencia, y conviene usar un juez de otra familia o etiquetar a mano la porción decisiva.',
        },
        {
          type: 'code',
          value: `// compare/contract.js
// Orden correcto: chequeos de contrato primero (baratos, deterministas),
// juez solo en lo que sobrevive. La mayoria de las roturas de migracion
// es de formato, no de calidad.

const FENCE = /^\`\`\`(?:json)?\\s*([\\s\\S]*?)\\s*\`\`\`$/;

// Parser tolerante: acepta el JSON envuelto, pero REGISTRA la desviacion.
// Tolerar sin medir esconde la regresion que el gate necesita ver.
export function parseStructured(raw) {
  const text = String(raw ?? '').trim();
  const fenced = text.match(FENCE);
  const body = fenced ? fenced[1] : text;
  try {
    return { ok: true, value: JSON.parse(body), fenced: Boolean(fenced) };
  } catch {
    return { ok: false, value: null, fenced: Boolean(fenced) };
  }
}

export function checkContract(output, spec) {
  const violations = [];
  const parsed = parseStructured(output.text);

  if (!parsed.ok) violations.push('json_invalido');
  if (parsed.fenced) violations.push('json_en_cerca_de_codigo');

  if (parsed.ok) {
    for (const field of spec.requiredFields) {
      if (parsed.value[field] === undefined) violations.push('campo_ausente:' + field);
    }
    for (const [field, allowed] of Object.entries(spec.enums ?? {})) {
      const v = parsed.value[field];
      if (v !== undefined && !allowed.includes(v)) violations.push('enum_invalido:' + field);
    }
  }

  // La tool call que se volvio texto es la rotura mas silenciosa: el
  // sistema sigue respondiendo, solo dejo de actuar.
  if (spec.expectsToolCall && !output.toolCalls?.length) violations.push('tool_call_ausente');
  if (spec.maxOutputTokens && output.usage.outputTokens > spec.maxOutputTokens) {
    violations.push('techo_de_tamano_excedido');
  }

  return { pass: violations.length === 0, violations, parsed };
}`,
        },
      ],
    },
    {
      title: 'Adaptar el prompt en vez de reescribirlo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando el reporte señala las diferencias, la reacción equivocada es reescribir el prompt desde cero para el modelo nuevo. El prompt actual codifica años de casos de borde descubiertos en producción, y una reescritura tira ese conocimiento para resolver problemas de formato. El enfoque que funciona es quirúrgico: para cada violación de contrato recurrente, una instrucción explícita que cierra la suposición que estaba tácita, y nada más. JSON envuelto se vuelve una línea prohibiendo cercas de código sumada a un parser que las tolera; respuesta demasiado larga se vuelve un techo declarado; rechazo en caso legítimo se vuelve un ejemplo de frontera mostrando el comportamiento esperado. Cada uno de esos cambios es pequeño, verificable en el dataset y reversible.',
        },
        {
          type: 'paragraph',
          value:
            'La regla que evita el efecto acordeón es validar cada ajuste en los dos modelos, no solo en el candidato. Una instrucción agregada para arreglar el modelo nuevo puede empeorar el viejo, y como el viejo sigue sirviendo al cliente durante toda la migración, una regresión ahí es daño inmediato. El camino seguro es tratar el prompt adaptado como una versión candidata en el mismo esquema de versionado que el resto: id inmutable, dataset corriendo contra las dos combinaciones de modelo y prompt, promoción solo cuando la nueva combinación empata o gana y la vieja no empeora. Y cuando la diferencia sea demasiado grande para cerrarse con ajustes puntuales, la decisión honesta es mantener dos variantes del prompt, una por modelo, en el mismo registro, con el costo de mantenimiento explícito en vez de fingir que una sirve para las dos.',
        },
        {
          type: 'ordered',
          items: [
            'Agrupe las violaciones por tipo, no por caso: diez fallas de JSON envuelto son un problema, no diez, y se resuelven con una instrucción.',
            'Cierre cada suposición tácita con el cambio de prompt más pequeño posible, uno por vez, midiendo el efecto aislado en el dataset.',
            'Corra cada ajuste en las dos combinaciones de modelo y prompt: el viejo aún atiende al cliente y no puede regresar durante la migración.',
            'Prefiera cambiar el parser y la validación cuando la desviación sea de formato tolerable, y cambiar el prompt cuando sea de comportamiento.',
            'Si queda una diferencia estructural, mantenga dos variantes de prompt por modelo, con el costo de mantenimiento declarado, en vez de forzar una sola.',
          ],
        },
      ],
    },
    {
      title: 'El gate de paridad y el corte con rollback listo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La migración necesita un criterio de parada escrito antes del resultado, si no la decisión se vuelve una negociación con el propio sesgo. Ese criterio es el gate de paridad, y es por caso de uso, no global. Un promedio agregado esconde justamente lo que importa: el candidato puede quedar dos por ciento mejor en general y veinte por ciento peor en la porción que involucra cobro, y el promedio no lo cuenta. El gate declara, para cada caso de uso, el límite de caída tolerable en tasa de contrato válido, en calidad juzgada, en escalonamiento a humano, y el techo de empeoramiento aceptable en costo y latencia. Un caso de uso que no pasa no bloquea a los otros: se bloquea a sí mismo, y el ruteo puede mantener ese caso en el modelo viejo mientras el resto migra.',
        },
        {
          type: 'paragraph',
          value:
            'Con el gate en verde, el corte sigue el mismo diseño de cualquier cambio riesgoso: porción pequeña y determinista por usuario para que la conversación no cambie de modelo a mitad, subida en escalones vigilada por métrica, y rollback como cambio de puntero en vez de redeploy. La diferencia es que aquí hay un detalle fácil de olvidar y de costo alto: el cache. El cache semántico y el cache de prompt cargan respuestas producidas por el modelo viejo, y servir una de esas a tráfico que ya está en el modelo nuevo mezcla los comportamientos y corrompe la medición. La clave de cache debe incluir el identificador del modelo, si no el rollout mide una mezcla. Lo mismo vale para las métricas: todo desglosado por modelo, si no la comparación desaparece en el agregado.',
        },
        {
          type: 'code',
          value: `// gate/parity.js
// Gate de paridad POR CASO DE USO, con limites escritos antes de ver el
// resultado. El promedio global esconde la porcion que regreso.

export function parityGate(results, budgets) {
  const byUseCase = new Map();
  for (const r of results) {
    const bucket = byUseCase.get(r.useCase) ?? [];
    bucket.push(r);
    byUseCase.set(r.useCase, bucket);
  }

  const report = [];
  for (const [useCase, rows] of byUseCase) {
    const budget = budgets[useCase] ?? budgets.default;
    const n = rows.length;

    const contractDrop =
      rows.filter((r) => r.current.contractOk && !r.candidate.contractOk).length / n;
    const qualityDrop = rows.filter((r) => r.judge === 'current_better').length / n
      - rows.filter((r) => r.judge === 'candidate_better').length / n;
    const costRatio =
      rows.reduce((s, r) => s + r.candidate.costUsd, 0) /
      Math.max(rows.reduce((s, r) => s + r.current.costUsd, 0), 1e-9);
    const p95Ratio = percentile(rows.map((r) => r.candidate.ms), 95) /
      Math.max(percentile(rows.map((r) => r.current.ms), 95), 1);

    const failures = [];
    if (contractDrop > budget.maxContractDrop) failures.push('contrato');
    if (qualityDrop > budget.maxQualityDrop) failures.push('calidad');
    if (costRatio > budget.maxCostRatio) failures.push('costo');
    if (p95Ratio > budget.maxLatencyRatio) failures.push('latencia');

    // Un caso de uso reprobado no bloquea a los otros: queda en el
    // modelo viejo mientras el resto migra.
    report.push({ useCase, n, contractDrop, qualityDrop, costRatio, p95Ratio, pass: failures.length === 0, failures });
  }
  return report;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}`,
        },
        {
          type: 'paragraph',
          value:
            'Después del corte la migración no terminó: entra en el período en que aparece la diferencia lenta. Las regresiones de formato surgen en horas, pero los cambios de tono, de tamaño medio de respuesta y de tasa de escalonamiento tardan días en separarse del ruido. Conviene mantener el modelo viejo accesible por una ventana acordada, el gate de paridad corriendo en muestra continua y las métricas desglosadas por modelo mientras dure esa ventana. Recién después el modelo viejo sale del manifiesto y el prompt adaptado se vuelve el nuevo estable, con una lista de suposiciones ahora explícitas que hace la próxima migración incomparablemente más barata.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué cambiar el modelo rompe un prompt que estaba funcionando bien?',
      answer:
        'Porque el prompt no es portable: fue pulido contra un modelo específico y buena parte de lo que lo hace funcionar nunca se volvió instrucción escrita. Si el modelo viejo ya devolvía JSON limpio, nadie tuvo que prohibir cercas de código; si ya era conciso, nadie puso techo de tamaño; si rara vez rechazaba, nadie definió qué hacer con el rechazo. Cada uno de esos silencios es una suposición tácita, y el cambio de modelo las prueba todas de una vez. El resultado típico no es un sistema que se detiene, es un sistema que sigue respondiendo con una porción de los casos saliendo mal de una forma que solo aparece en la métrica días después. Por eso la migración empieza listando de qué depende el sistema y no está escrito, porque cada suposición no escrita es exactamente un caso de regresión a verificar en el candidato.',
    },
    {
      question: '¿Cómo probar el modelo nuevo sin arriesgar al cliente?',
      answer:
        'Con tráfico sombra: el candidato corre sobre el tráfico real de producción en paralelo con el modelo actual, pero su respuesta nunca llega al cliente, solo se graba al lado formando pares comparables. Eso atrapa las formas que ningún dataset anticipa, como mensajes truncados, contexto gigante y secuencias raras de herramientas. Tres cuidados vuelven segura la sombra: las herramientas con efecto colateral corren en modo simulado, registrando la intención sin ejecutar, para que la ejecución sombra no escriba nada; la sombra usa cola separada y ejecución asíncrona después de responder al usuario, para no competir por cuota ni por latencia con el camino del cliente; y el tráfico se muestrea en vez de espejarse entero, porque sombra en cien por ciento duplica la factura de inferencia.',
    },
    {
      question: '¿Qué criterio decide que la migración puede subir?',
      answer:
        'Un gate de paridad por caso de uso, con límites escritos antes de ver el resultado. El promedio agregado esconde lo que importa: el candidato puede quedar dos por ciento mejor en general y veinte por ciento peor en la porción que involucra cobro. El gate declara, por caso de uso, la caída tolerable en tasa de contrato válido, en calidad juzgada y en escalonamiento a humano, más el techo de empeoramiento en costo y latencia; un caso de uso que no pasa queda en el modelo viejo mientras el resto migra, en vez de bloquear todo. El orden de evaluación también importa: chequeos de contrato primero, porque son deterministas, baratos y atrapan la mayoría de las roturas, y juez solo en lo que sobrevivió, con posición barajada y criterio calibrado contra etiquetas humanas.',
    },
  ],
  conclusion: {
    title: 'Migrar de modelo es un proyecto de ingeniería, no un cambio de cadena',
    description:
      'Cambiar el modelo parece una línea de configuración, pero el prompt en producción carga meses de suposiciones tácitas sobre cómo se comporta ese modelo específico, y el cambio las prueba todas de una vez en los bordes: JSON que pasó a venir envuelto, respuesta que duplicó su tamaño, tool call que se volvió texto, rechazo en caso legítimo. Caracterizar el comportamiento actual con una muestra real, correr el candidato en tráfico sombra sin riesgo para el cliente, comparar por contrato antes de comparar por calidad, adaptar el prompt con cambios quirúrgicos validados en los dos modelos y cortar detrás de un gate de paridad por caso de uso, con rollback como cambio de puntero, transforma la migración de una apuesta en una operación medida. Puedo conducir esa migración en tu sistema con LLM, del harness de sombra al gate de paridad, para que cambies de modelo sin enterarte de la regresión por el cliente.',
    cta: 'Hablar sobre migrar de modelo sin romper mi prompt',
  },
  related: [
    { label: 'Versionar el prompt como código: rollout, rollback y prueba', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-migration-shadow-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
