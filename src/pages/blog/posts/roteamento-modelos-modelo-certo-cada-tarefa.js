// Conteudo do artigo: roteamento de modelos, o modelo certo para cada tarefa.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Roteador de modelos mínimo: em vez de mandar toda requisição para o modelo mais caro, classifica a tarefa por complexidade e custo aceitável e escolhe o modelo certo, com fallback para um modelo mais forte quando a resposta do barato não passa na validação, para cortar custo e latência sem perder qualidade nas tarefas difíceis.',
  en: 'Minimal model router: instead of sending every request to the most expensive model, it classifies the task by complexity and acceptable cost and picks the right model, with a fallback to a stronger model when the cheap answer fails validation, to cut cost and latency without losing quality on the hard tasks.',
  es: 'Router de modelos mínimo: en vez de mandar toda request al modelo más caro, clasifica la tarea por complejidad y costo aceptable y elige el modelo correcto, con fallback a un modelo más fuerte cuando la respuesta del barato no pasa la validación, para cortar costo y latencia sin perder calidad en las tareas difíciles.',
};

const repoUrl = 'https://github.com/joaosouz4dev/model-router-mini';

const pt = {
  intro:
    'A escolha mais cara de um sistema com LLM raramente é o prompt, é o modelo. Quem manda toda requisição para o modelo mais forte paga preço de topo para classificar um sim ou não, extrair um CEP de um texto ou responder um "olá". Quem manda tudo para o modelo mais barato entrega resposta rasa quando a tarefa exige raciocínio, e paga o custo de refazer, de reclamação e de retrabalho. Roteamento de modelos é a disciplina de casar cada tarefa com o modelo mais barato que ainda resolve bem, e escalar para um modelo mais forte só quando a tarefa realmente pede. Feito de forma ingênua, o roteador vira um gargalo que erra a classificação e manda tarefa difícil para modelo fraco. Feito com régua e fallback, ele corta uma fatia grande da fatura sem que o usuário perceba queda de qualidade, porque as tarefas triviais (que são a maioria) passam a rodar num modelo dez vezes mais barato, e as difíceis continuam no modelo forte. Este artigo mostra como desenhar essa camada: o critério de classificação, a tabela de custo por tarefa, o roteador com fallback e a métrica que diz se ele está economizando ou degradando.',
  sections: [
    {
      title: 'Por que um modelo só é a decisão mais cara',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição de padronizar tudo num modelo forte parece simplicidade, mas é a decisão que mais infla a fatura de um sistema com LLM. A maioria das requisições de um produto real não é raciocínio complexo: é classificação de intenção, extração de campo, reformulação de texto, resposta curta de FAQ, roteamento de fila. Essas tarefas são resolvidas com folga por um modelo pequeno e barato, e mandá-las para o modelo topo de linha é pagar preço de raciocínio profundo por trabalho de rotina. O inverso também custa caro: padronizar tudo no modelo barato entrega resposta pobre nas poucas tarefas que exigem raciocínio, e o custo aparece disfarçado de retrabalho, de reclamação e de tarefa refeita à mão.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto central é que a distribuição de dificuldade das requisições é desigual: um punhado de tarefas difíceis e uma multidão de tarefas triviais. A tabela abaixo mostra por que a escolha de um modelo único, seja ele forte ou fraco, deixa dinheiro ou qualidade na mesa.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Custo', 'Qualidade nas tarefas difíceis'],
          rows: [
            [
              'Tudo no modelo forte',
              'Alto: paga topo até no trivial',
              'Ótima, mas cara demais para a maioria',
            ],
            [
              'Tudo no modelo barato',
              'Baixo, mas com retrabalho escondido',
              'Ruim: falha onde precisa de raciocínio',
            ],
            [
              'Roteamento por tarefa',
              'Baixo no trivial, alto só onde precisa',
              'Boa: difícil vai para o modelo forte',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O roteamento não é sobre usar o modelo mais barato sempre, é sobre usar o modelo mais barato que ainda resolve aquela tarefa. Quando a maioria das requisições é trivial, mover essa maioria para um modelo dez vezes mais barato corta a fatura de forma expressiva, enquanto as poucas tarefas difíceis continuam recebendo o modelo forte. O ganho vem da distribuição: você não baixa a qualidade média, você para de pagar preço de raciocínio por trabalho de rotina.',
        },
      ],
    },
    {
      title: 'Classificar a tarefa: complexidade, risco e custo aceitável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O coração do roteador é a classificação: antes de escolher o modelo, ele precisa saber que tipo de tarefa está diante dele. Três eixos bastam para decidir bem. O primeiro é a complexidade: a tarefa é padrão (classificar, extrair, reformular) ou exige raciocínio de várias etapas, síntese ou julgamento. O segundo é o risco: um erro na resposta é um incômodo tolerável ou uma falha cara (dado financeiro, jurídico, médico). O terceiro é o custo aceitável: quanto aquela tarefa pode gastar por chamada dado o valor que ela gera. Uma classificação de fila que roda milhões de vezes ao dia tem orçamento por chamada minúsculo; uma análise de contrato que roda dez vezes ao dia tolera pagar caro.',
        },
        {
          type: 'paragraph',
          value:
            'A classificação em si pode ser barata. Muitas vezes a própria natureza do endpoint já define a classe (o endpoint de "classificar intenção" é sempre trivial, o de "analisar documento" é sempre complexo), e nesse caso o roteamento é uma tabela estática, sem custo de inferência. Quando o mesmo endpoint recebe tarefas de dificuldade variável, um classificador leve (um modelo pequeno ou até heurística de tamanho e palavras-chave) decide a rota. A regra é não gastar mais para classificar do que se economiza roteando.',
        },
        {
          type: 'code',
          value: `// router/classify.js
// Classifica a tarefa antes de escolher o modelo.
// Barato de proposito: a classificacao nao pode custar mais do que economiza.

export function classifyTask(req) {
  // Muitas vezes a rota ja esta implicita no tipo do endpoint.
  if (req.kind === 'intent' || req.kind === 'extract') {
    return { tier: 'small', reason: 'tarefa padrao de rotina' };
  }
  if (req.kind === 'analysis' || req.kind === 'reasoning') {
    return { tier: 'large', reason: 'exige raciocinio de varias etapas' };
  }

  // Quando o mesmo endpoint recebe dificuldade variavel, uma heuristica leve
  // (tamanho, palavras-chave) escolhe a rota sem custo de inferencia.
  const long = (req.text || '').length > 2000;
  const sensitive = req.risk === 'high';
  if (long || sensitive) return { tier: 'large', reason: 'entrada longa ou risco alto' };

  return { tier: 'small', reason: 'padrao' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que a classificação é conservadora no que importa: risco alto e entrada longa já empurram para o modelo forte, mesmo sem certeza de que a tarefa é difícil. Errar mandando uma tarefa trivial para o modelo forte custa alguns centavos; errar mandando uma tarefa crítica para o modelo fraco custa uma resposta errada num contexto sensível. O roteador deve errar sempre para o lado seguro, e é o fallback da próxima seção que corrige o outro tipo de erro sem exigir classificação perfeita.',
        },
      ],
    },
    {
      title: 'O roteador com fallback: escalar quando o barato falha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nenhum classificador acerta sempre, e exigir classificação perfeita torna o roteador frágil. A saída elegante é o fallback: mande a tarefa para o modelo barato primeiro, valide a resposta e, se ela não passar na validação, escale para o modelo forte. Assim o roteador não precisa prever de antemão toda tarefa difícil; ele tenta o barato, e só paga o caro quando o barato prova que não deu conta. O fluxo abaixo mostra o caminho completo de uma requisição, da classificação ao fallback.',
        },
        {
          type: 'diagram',
          value: `Caminho de uma requisição pelo roteador de modelos

  requisição
        |
        v
  classifica a tarefa (complexidade, risco, custo)
        |
        v
  [ tier? ]
     |  small                   |  large
     v                          v
  chama modelo barato       chama modelo forte
        |                       |
        v                       v
  [ resposta válida? ]      devolve resposta
     |  sim      |  não
     v           v
  devolve     FALLBACK: chama modelo forte
                  |
                  v
              devolve resposta forte

  maioria trivial resolve no barato = economia
  minoria difícil escala no fallback = qualidade`,
        },
        {
          type: 'code',
          value: `// router/route.js
// Roteia para o modelo mais barato que resolve. Se o barato falhar
// na validacao, escala para o forte. Fallback corrige erro de classificacao.

export function createRouter({ callSmall, callLarge, validate }) {
  return async function route(req) {
    const { tier } = classifyTask(req);

    if (tier === 'large') {
      // Tarefa ja classificada como dificil: vai direto ao modelo forte.
      return { answer: await callLarge(req), model: 'large', escalated: false };
    }

    // Tenta o modelo barato primeiro.
    const small = await callSmall(req);
    if (validate(small, req)) {
      return { answer: small, model: 'small', escalated: false };
    }

    // Barato nao passou na validacao: escala para o forte (fallback).
    const large = await callLarge(req);
    return { answer: large, model: 'large', escalated: true };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que faz o fallback funcionar é a validação: ela precisa detectar de forma barata quando o modelo barato entregou uma resposta ruim. Para tarefas estruturadas isso é objetivo (o JSON não bate no schema, o campo esperado veio vazio, a classificação caiu fora do conjunto de rótulos válidos). Para tarefas abertas é mais sutil, e às vezes vale um segundo modelo pequeno como juiz. A chave é que o fallback só compensa se a taxa de escalonamento for baixa: se metade das tarefas triviais falha e escala, você paga o barato e o caro, e teria sido melhor mandar tudo para o forte. Monitorar essa taxa é o que a seção de métricas cobre.',
        },
      ],
    },
    {
      title: 'A tabela de custo por tarefa: o mapa da decisão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O roteamento só é uma decisão informada se você tiver o custo de cada modelo por tipo de tarefa na frente. Sem essa tabela, "modelo barato" e "modelo forte" são rótulos vagos, e a escolha vira palpite. Com ela, o roteamento vira aritmética: você sabe quanto custa cada rota, qual a fração de tráfego que cai em cada uma e quanto o roteamento economiza frente ao cenário de modelo único. A tabela abaixo é o formato mínimo dessa análise, com números ilustrativos para mostrar a estrutura da decisão.',
        },
        {
          type: 'table',
          columns: ['Tipo de tarefa', 'Modelo indicado', 'Custo relativo', 'Fração do tráfego'],
          rows: [
            ['Classificar intenção', 'Pequeno', '1x', 'Alta'],
            ['Extrair campo (CEP, valor)', 'Pequeno', '1x', 'Alta'],
            ['Resposta de FAQ', 'Pequeno', '1x', 'Média'],
            ['Resumo de conversa', 'Médio', '4x', 'Média'],
            ['Análise de documento', 'Forte', '15x', 'Baixa'],
            ['Raciocínio de várias etapas', 'Forte', '15x', 'Baixa'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura dessa tabela é o argumento inteiro do roteamento. As tarefas mais caras por chamada (análise de documento, raciocínio) são justamente as de menor volume; as de maior volume (classificar, extrair) são as mais baratas por chamada. Quando você multiplica custo por volume, a conta do modelo único fica dominada pelo custo de rodar o forte no trivial de alto volume. O roteamento quebra essa multiplicação: o alto volume passa a rodar barato, e o custo do forte fica confinado ao baixo volume onde ele é necessário. Sem essa tabela você não sabe se o roteamento vale o esforço; com ela, o ganho é calculável antes de escrever a primeira linha.',
        },
      ],
    },
    {
      title: 'Validação e guardrails: o que impede o roteador de degradar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O risco do roteamento não é técnico, é de qualidade: mandar uma tarefa que precisava do modelo forte para o barato e servir uma resposta pior sem ninguém perceber. A defesa contra isso é dupla. A primeira camada é a classificação conservadora, que já vimos: na dúvida, sobe de tier. A segunda é a validação da resposta do modelo barato, que transforma o fallback numa rede de segurança. Juntas, elas garantem que a economia não vem às custas de qualidade nas tarefas que importam.',
        },
        {
          type: 'ordered',
          items: [
            'Valide estrutura sempre que possível: se a tarefa espera JSON, um rótulo de um conjunto fechado ou um campo específico, a validação é objetiva e barata, e o fallback dispara sozinho quando o barato erra o formato.',
            'Use um juiz leve para tarefas abertas: quando não há estrutura, um modelo pequeno pode pontuar a resposta do barato (completa? no tópico? sem recusa indevida?) e decidir se escala, ainda mais barato que rodar o forte direto.',
            'Trave tarefas de risco alto fora do modelo barato: cobrança, jurídico, saúde e qualquer coisa cara de errar devem ir direto ao forte, sem passar pela tentativa barata, porque ali o custo de um erro supera a economia.',
            'Limite a profundidade do fallback: uma tentativa barata e uma escalada bastam; não encadeie três modelos, senão o pior caso paga todos e a latência explode.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra que amarra tudo: o roteador economiza no caso comum e protege no caso raro. O caso comum (tarefa trivial de alto volume) roda barato e passa na validação, e é dali que vem a economia. O caso raro (tarefa difícil ou classificada errado) é capturado pela validação e escalado pelo fallback, e é dali que vem a garantia de qualidade. Um roteador sem validação é só uma aposta de que a classificação nunca erra, e classificação sempre erra em algum ponto. A validação é o que transforma o roteamento de aposta em engenharia.',
        },
      ],
    },
    {
      title: 'Medir se o roteador economiza sem degradar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um roteador sem métrica é uma promessa de economia que ninguém checou. Quatro sinais dizem se ele está entregando. A economia real compara o custo com roteamento contra o custo hipotético de rodar tudo no modelo forte, e é a justificativa da camada. A taxa de escalonamento mede quantas tarefas que foram para o barato acabaram escalando para o forte: se ela é alta, o barato está falhando demais e o roteamento paga duas vezes. A distribuição por tier mostra quanto do tráfego cai em cada modelo e confirma se a classificação está enviando a maioria para o barato como esperado. E a qualidade por rota, medida por amostragem, verifica se as respostas servidas pelo barato não estão piores do que as do forte.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que revela', 'Quando agir'],
          rows: [
            [
              'Economia real',
              'Custo com roteamento vs modelo único forte',
              'Baixa: pouca tarefa cai no barato, revise a classificação',
            ],
            [
              'Taxa de escalonamento',
              'Fração do barato que escalou para o forte',
              'Alta: barato falha demais, suba o tier de origem',
            ],
            [
              'Distribuição por tier',
              'Fração do tráfego em cada modelo',
              'Muito no forte: classificação conservadora demais',
            ],
            [
              'Qualidade por rota',
              'Resposta do barato pior que a do forte?',
              'Sim: aperte a validação ou o critério de tier',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A taxa de escalonamento é a métrica que denuncia um roteador mal calibrado, porque ela captura o pior cenário: pagar o barato e o caro na mesma requisição. Escalonamento alto significa que a classificação está otimista demais, mandando para o barato tarefas que ele não resolve, e a correção é subir o tier de origem dessas classes de tarefa em vez de confiar no fallback. Já uma distribuição concentrada no forte indica o oposto, uma classificação conservadora demais que anula a economia. O ponto de operação saudável é a maioria do tráfego no barato, escalonamento baixo e qualidade por rota indistinguível entre barato e forte nas tarefas que o barato atende. É esse equilíbrio que o roteamento persegue.',
        },
      ],
    },
    {
      title: 'Montar a camada de roteamento em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O roteamento de modelos é uma das otimizações de melhor retorno num sistema com LLM: mexe direto no maior item de custo (a chamada ao modelo) sem tocar na experiência do usuário quando bem feito. Mas é uma otimização de qualidade sensível, então a ordem de implantação importa: comece protegendo a qualidade e afrouxe a economia com dado na mão.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pela tabela de custo por tarefa: sem saber o custo e o volume de cada tipo, você não sabe se o roteamento vale nem quais tarefas mover primeiro. Priorize as de alto volume e baixa complexidade.',
            'Roteie primeiro o que é obviamente trivial: classificação, extração e FAQ curta são seguros de mandar para o barato desde o dia um, e já entregam a maior fatia da economia.',
            'Ligue o fallback com validação antes de descer mais: só depois de ter a rede de segurança do fallback funcionando é seguro mover tarefas de dificuldade duvidosa para o barato.',
            'Instrumente as quatro métricas: economia real, escalonamento, distribuição por tier e qualidade por rota. Sem elas você não sabe se economizou ou degradou.',
            'Mantenha risco alto fora do roteamento barato: tarefas caras de errar vão direto ao forte, sempre. A economia vem do volume trivial, não de arriscar o crítico.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre um roteador que corta a fatura sem ninguém notar e um que degrada a qualidade no escuro está inteira na classificação conservadora, na validação com fallback e na métrica de escalonamento, não na esperteza do critério de escolha. O critério é simples: o modelo mais barato que ainda resolve. O que torna isso confiável em produção é a rede de segurança que captura os erros de classificação e a instrumentação que prova que a economia é real e a qualidade se manteve. Bem montado, o roteamento é dinheiro deixado na mesa por quem padroniza tudo no modelo forte, recuperado sem que o usuário perceba diferença nas respostas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Roteamento de modelos não é só usar sempre o modelo mais barato?',
      answer:
        'Não. Usar sempre o barato degrada as tarefas que exigem raciocínio, e o custo aparece disfarçado de retrabalho e reclamação. Roteamento é usar o modelo mais barato que ainda resolve aquela tarefa específica, e escalar para um modelo mais forte quando a tarefa realmente pede. A maioria das requisições de um produto real é trivial (classificar, extrair, responder FAQ) e roda bem no barato; a minoria difícil continua no forte. O ganho vem da distribuição desigual de dificuldade: você move o alto volume trivial para o barato sem baixar a qualidade média, porque as tarefas difíceis nunca deixam o modelo forte.',
    },
    {
      question: 'E se o roteador classificar errado e mandar tarefa difícil para o modelo barato?',
      answer:
        'É para isso que existe o fallback. O roteador manda a tarefa para o barato primeiro, valida a resposta e, se ela não passar na validação (JSON fora do schema, campo vazio, resposta incompleta), escala automaticamente para o modelo forte. Assim o roteador não precisa de classificação perfeita: ele tenta o barato e só paga o caro quando o barato prova que não deu conta. A classificação também é conservadora, empurrando risco alto e entrada longa direto para o forte. O que precisa ser monitorado é a taxa de escalonamento: se ela for alta, o barato está falhando demais e vale subir o tier de origem daquelas tarefas.',
    },
    {
      question: 'Como saber se o roteamento está economizando de verdade?',
      answer:
        'Com quatro métricas. A economia real compara o custo com roteamento contra rodar tudo no modelo forte. A taxa de escalonamento mede quantas tarefas do barato acabaram no forte (alta significa pagar duas vezes). A distribuição por tier mostra se a maioria do tráfego cai no barato como esperado. E a qualidade por rota, por amostragem, verifica se a resposta do barato não está pior que a do forte. O ponto saudável é maioria do tráfego no barato, escalonamento baixo e qualidade indistinguível nas tarefas que o barato atende. Sem essas métricas, o roteamento é só uma promessa de economia que ninguém checou.',
    },
  ],
  conclusion: {
    title: 'Roteamento de modelos corta custo de LLM quando cada tarefa vai ao modelo certo',
    description:
      'Mandar tudo para o modelo forte paga preço de raciocínio por trabalho de rotina; roteamento casa cada tarefa com o modelo mais barato que ainda resolve, com classificação conservadora, fallback validado e métrica de escalonamento. Posso desenhar essa camada no seu sistema de IA, da tabela de custo à observabilidade, cortando fatura sem degradar as respostas.',
    cta: 'Falar sobre roteamento de modelos no meu sistema de IA',
  },
  related: [
    { label: 'Cache semântico para reduzir custo de LLM', to: '/blog/cache-semantico-reduzir-custo-llm' },
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-router-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The most expensive choice in an LLM system is rarely the prompt, it is the model. Whoever sends every request to the strongest model pays top price to classify a yes or no, extract a zip code from a text or answer a "hello". Whoever sends everything to the cheapest model delivers a shallow answer when the task demands reasoning, and pays the cost of redoing it, of complaints and of manual rework. Model routing is the discipline of matching each task with the cheapest model that still solves it well, and escalating to a stronger model only when the task truly requires it. Done naively, the router becomes a bottleneck that misclassifies and sends a hard task to a weak model. Done with a ruler and a fallback, it cuts a large slice of the invoice without the user noticing any drop in quality, because the trivial tasks (which are the majority) start running on a model ten times cheaper, and the hard ones stay on the strong model. This article shows how to design that layer: the classification criterion, the cost-per-task table, the router with fallback and the metric that tells you whether it is saving or degrading.',
  sections: [
    {
      title: 'Why a single model is the most expensive decision',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition of standardizing everything on a strong model looks like simplicity, but it is the decision that inflates the LLM invoice the most. Most requests in a real product are not complex reasoning: they are intent classification, field extraction, text rewriting, short FAQ answers, queue routing. These tasks are solved with ease by a small, cheap model, and sending them to the top-tier model is paying deep-reasoning price for routine work. The reverse also costs dearly: standardizing everything on the cheap model delivers a poor answer on the few tasks that require reasoning, and the cost shows up disguised as rework, complaints and tasks redone by hand.',
        },
        {
          type: 'paragraph',
          value:
            'The central point is that the difficulty distribution of requests is uneven: a handful of hard tasks and a crowd of trivial ones. The table below shows why choosing a single model, be it strong or weak, leaves either money or quality on the table.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Cost', 'Quality on hard tasks'],
          rows: [
            [
              'Everything on the strong model',
              'High: pays top even on the trivial',
              'Great, but too expensive for the majority',
            ],
            [
              'Everything on the cheap model',
              'Low, but with hidden rework',
              'Poor: fails where reasoning is needed',
            ],
            [
              'Routing per task',
              'Low on trivial, high only where needed',
              'Good: hard goes to the strong model',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Routing is not about always using the cheapest model, it is about using the cheapest model that still solves that task. When most requests are trivial, moving that majority to a model ten times cheaper cuts the invoice significantly, while the few hard tasks keep getting the strong model. The gain comes from the distribution: you do not lower the average quality, you stop paying reasoning price for routine work.',
        },
      ],
    },
    {
      title: 'Classifying the task: complexity, risk and acceptable cost',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The heart of the router is classification: before choosing the model, it needs to know what kind of task it faces. Three axes are enough to decide well. The first is complexity: is the task standard (classify, extract, rewrite) or does it require multi-step reasoning, synthesis or judgment. The second is risk: is an error in the answer a tolerable nuisance or an expensive failure (financial, legal, medical data). The third is acceptable cost: how much that task can spend per call given the value it generates. A queue classification running millions of times a day has a tiny per-call budget; a contract analysis running ten times a day tolerates paying dearly.',
        },
        {
          type: 'paragraph',
          value:
            'The classification itself can be cheap. Often the nature of the endpoint already defines the class (the "classify intent" endpoint is always trivial, the "analyze document" one is always complex), and in that case routing is a static table, with no inference cost. When the same endpoint receives tasks of varying difficulty, a lightweight classifier (a small model or even a size-and-keyword heuristic) decides the route. The rule is not to spend more to classify than you save by routing.',
        },
        {
          type: 'code',
          value: `// router/classify.js
// Classifies the task before choosing the model.
// Cheap on purpose: classification must not cost more than it saves.

export function classifyTask(req) {
  // Often the route is already implicit in the endpoint kind.
  if (req.kind === 'intent' || req.kind === 'extract') {
    return { tier: 'small', reason: 'standard routine task' };
  }
  if (req.kind === 'analysis' || req.kind === 'reasoning') {
    return { tier: 'large', reason: 'requires multi-step reasoning' };
  }

  // When the same endpoint gets varying difficulty, a light heuristic
  // (size, keywords) picks the route with no inference cost.
  const long = (req.text || '').length > 2000;
  const sensitive = req.risk === 'high';
  if (long || sensitive) return { tier: 'large', reason: 'long input or high risk' };

  return { tier: 'small', reason: 'default' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note that classification is conservative where it matters: high risk and long input already push to the strong model, even without certainty that the task is hard. Erring by sending a trivial task to the strong model costs a few cents; erring by sending a critical task to the weak model costs a wrong answer in a sensitive context. The router must always err on the safe side, and it is the fallback in the next section that fixes the other kind of error without requiring perfect classification.',
        },
      ],
    },
    {
      title: 'The router with fallback: escalate when the cheap one fails',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No classifier hits every time, and demanding perfect classification makes the router fragile. The elegant way out is the fallback: send the task to the cheap model first, validate the answer and, if it does not pass validation, escalate to the strong model. That way the router does not need to foresee every hard task in advance; it tries the cheap one, and only pays for the expensive one when the cheap one proves it could not cope. The flow below shows the full path of a request, from classification to fallback.',
        },
        {
          type: 'diagram',
          value: `Path of a request through the model router

  request
        |
        v
  classify the task (complexity, risk, cost)
        |
        v
  [ tier? ]
     |  small                   |  large
     v                          v
  call cheap model          call strong model
        |                       |
        v                       v
  [ answer valid? ]         return answer
     |  yes      |  no
     v           v
  return      FALLBACK: call strong model
                  |
                  v
              return strong answer

  trivial majority solved on cheap = savings
  hard minority escalates on fallback = quality`,
        },
        {
          type: 'code',
          value: `// router/route.js
// Routes to the cheapest model that solves it. If the cheap one fails
// validation, escalate to the strong one. Fallback fixes classification errors.

export function createRouter({ callSmall, callLarge, validate }) {
  return async function route(req) {
    const { tier } = classifyTask(req);

    if (tier === 'large') {
      // Task already classified as hard: goes straight to the strong model.
      return { answer: await callLarge(req), model: 'large', escalated: false };
    }

    // Try the cheap model first.
    const small = await callSmall(req);
    if (validate(small, req)) {
      return { answer: small, model: 'small', escalated: false };
    }

    // Cheap one failed validation: escalate to the strong one (fallback).
    const large = await callLarge(req);
    return { answer: large, model: 'large', escalated: true };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that makes the fallback work is the validation: it must detect cheaply when the cheap model delivered a bad answer. For structured tasks this is objective (the JSON does not match the schema, the expected field came empty, the classification fell outside the set of valid labels). For open tasks it is subtler, and sometimes a second small model as a judge is worth it. The key is that the fallback only pays off if the escalation rate is low: if half the trivial tasks fail and escalate, you pay the cheap and the expensive, and it would have been better to send everything to the strong one. Monitoring that rate is what the metrics section covers.',
        },
      ],
    },
    {
      title: 'The cost-per-task table: the map of the decision',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Routing is only an informed decision if you have the cost of each model per task type in front of you. Without that table, "cheap model" and "strong model" are vague labels, and the choice becomes a guess. With it, routing becomes arithmetic: you know how much each route costs, what fraction of traffic falls into each and how much routing saves against the single-model scenario. The table below is the minimal format of that analysis, with illustrative numbers to show the structure of the decision.',
        },
        {
          type: 'table',
          columns: ['Task type', 'Recommended model', 'Relative cost', 'Traffic fraction'],
          rows: [
            ['Classify intent', 'Small', '1x', 'High'],
            ['Extract field (zip, amount)', 'Small', '1x', 'High'],
            ['FAQ answer', 'Small', '1x', 'Medium'],
            ['Conversation summary', 'Medium', '4x', 'Medium'],
            ['Document analysis', 'Strong', '15x', 'Low'],
            ['Multi-step reasoning', 'Strong', '15x', 'Low'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Reading this table is the whole argument for routing. The most expensive tasks per call (document analysis, reasoning) are precisely the lowest volume; the highest volume ones (classify, extract) are the cheapest per call. When you multiply cost by volume, the single-model bill is dominated by the cost of running the strong model on high-volume trivial work. Routing breaks that multiplication: the high volume starts running cheap, and the strong-model cost stays confined to the low volume where it is necessary. Without that table you do not know whether routing is worth the effort; with it, the gain is calculable before writing the first line.',
        },
      ],
    },
    {
      title: 'Validation and guardrails: what stops the router from degrading',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The risk of routing is not technical, it is about quality: sending a task that needed the strong model to the cheap one and serving a worse answer without anyone noticing. The defense against that is twofold. The first layer is conservative classification, which we already saw: when in doubt, bump the tier. The second is validation of the cheap model answer, which turns the fallback into a safety net. Together, they ensure the savings do not come at the cost of quality on the tasks that matter.',
        },
        {
          type: 'ordered',
          items: [
            'Validate structure whenever possible: if the task expects JSON, a label from a closed set or a specific field, validation is objective and cheap, and the fallback fires on its own when the cheap one botches the format.',
            'Use a light judge for open tasks: when there is no structure, a small model can score the cheap answer (complete? on topic? no undue refusal?) and decide whether to escalate, still cheaper than running the strong one directly.',
            'Lock high-risk tasks out of the cheap model: billing, legal, health and anything expensive to get wrong should go straight to the strong model, without the cheap attempt, because there the cost of an error exceeds the savings.',
            'Limit the fallback depth: one cheap attempt and one escalation are enough; do not chain three models, or the worst case pays for all of them and latency explodes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The rule that ties it together: the router saves in the common case and protects in the rare case. The common case (high-volume trivial task) runs cheap and passes validation, and that is where the savings come from. The rare case (hard or misclassified task) is caught by validation and escalated by the fallback, and that is where the quality guarantee comes from. A router without validation is just a bet that classification never errs, and classification always errs at some point. Validation is what turns routing from a bet into engineering.',
        },
      ],
    },
    {
      title: 'Measuring whether the router saves without degrading',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A router without metrics is a savings promise nobody checked. Four signals tell you whether it is delivering. Real savings compares the cost with routing against the hypothetical cost of running everything on the strong model, and it is the justification of the layer. The escalation rate measures how many tasks that went to the cheap one ended up escalating to the strong one: if it is high, the cheap one is failing too much and routing pays twice. The distribution per tier shows how much traffic falls into each model and confirms whether classification is sending the majority to the cheap one as expected. And quality per route, measured by sampling, verifies that the answers served by the cheap one are not worse than the strong one.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it reveals', 'When to act'],
          rows: [
            [
              'Real savings',
              'Cost with routing vs single strong model',
              'Low: few tasks fall on the cheap one, review classification',
            ],
            [
              'Escalation rate',
              'Fraction of cheap that escalated to strong',
              'High: cheap fails too much, raise the origin tier',
            ],
            [
              'Distribution per tier',
              'Fraction of traffic on each model',
              'Too much on strong: classification too conservative',
            ],
            [
              'Quality per route',
              'Cheap answer worse than the strong one?',
              'Yes: tighten validation or the tier criterion',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The escalation rate is the metric that exposes a poorly calibrated router, because it captures the worst scenario: paying the cheap and the expensive in the same request. High escalation means classification is too optimistic, sending to the cheap one tasks it cannot solve, and the fix is to raise the origin tier of those task classes instead of relying on the fallback. A distribution concentrated on the strong model indicates the opposite, a classification too conservative that nullifies the savings. The healthy operating point is most traffic on the cheap one, low escalation and quality per route indistinguishable between cheap and strong on the tasks the cheap one handles. That balance is what routing pursues.',
        },
      ],
    },
    {
      title: 'Building the routing layer in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Model routing is one of the best-return optimizations in an LLM system: it hits directly the biggest cost item (the model call) without touching the user experience when done right. But it is a quality-sensitive optimization, so the rollout order matters: start by protecting quality and loosen the savings with data in hand.',
        },
        {
          type: 'ordered',
          items: [
            'Start with the cost-per-task table: without knowing the cost and volume of each type, you do not know whether routing is worth it or which tasks to move first. Prioritize high volume and low complexity.',
            'Route first what is obviously trivial: classification, extraction and short FAQ are safe to send to the cheap one from day one, and already deliver the biggest slice of savings.',
            'Turn on the fallback with validation before going lower: only after the fallback safety net works is it safe to move tasks of doubtful difficulty to the cheap one.',
            'Instrument the four metrics: real savings, escalation, distribution per tier and quality per route. Without them you do not know whether you saved or degraded.',
            'Keep high risk out of cheap routing: tasks expensive to get wrong go straight to the strong model, always. The savings come from trivial volume, not from risking the critical.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between a router that cuts the invoice without anyone noticing and one that degrades quality in the dark lives entirely in conservative classification, validation with fallback and the escalation metric, not in the cleverness of the choice criterion. The criterion is simple: the cheapest model that still solves it. What makes it reliable in production is the safety net that catches classification errors and the instrumentation that proves the savings are real and quality held. Well built, routing is money left on the table by whoever standardizes everything on the strong model, recovered without the user noticing any difference in the answers.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is model routing just using the cheapest model all the time?',
      answer:
        'No. Always using the cheap one degrades the tasks that require reasoning, and the cost shows up disguised as rework and complaints. Routing is using the cheapest model that still solves that specific task, and escalating to a stronger model when the task truly requires it. Most requests in a real product are trivial (classify, extract, answer FAQ) and run well on the cheap one; the hard minority stays on the strong one. The gain comes from the uneven difficulty distribution: you move the high-volume trivial to the cheap one without lowering the average quality, because the hard tasks never leave the strong model.',
    },
    {
      question: 'What if the router misclassifies and sends a hard task to the cheap model?',
      answer:
        'That is what the fallback is for. The router sends the task to the cheap one first, validates the answer and, if it does not pass validation (JSON off schema, empty field, incomplete answer), automatically escalates to the strong model. That way the router does not need perfect classification: it tries the cheap one and only pays for the expensive one when the cheap one proves it could not cope. Classification is also conservative, pushing high risk and long input straight to the strong one. What needs monitoring is the escalation rate: if it is high, the cheap one is failing too much and it is worth raising the origin tier of those tasks.',
    },
    {
      question: 'How do you know whether routing is actually saving?',
      answer:
        'With four metrics. Real savings compares the cost with routing against running everything on the strong model. The escalation rate measures how many cheap tasks ended up on the strong one (high means paying twice). The distribution per tier shows whether most traffic falls on the cheap one as expected. And quality per route, by sampling, verifies that the cheap answer is not worse than the strong one. The healthy point is most traffic on the cheap one, low escalation and indistinguishable quality on the tasks the cheap one handles. Without those metrics, routing is just a savings promise nobody checked.',
    },
  ],
  conclusion: {
    title: 'Model routing cuts LLM cost when each task goes to the right model',
    description:
      'Sending everything to the strong model pays reasoning price for routine work; routing matches each task with the cheapest model that still solves it, with conservative classification, validated fallback and an escalation metric. I can design that layer in your AI system, from the cost table to observability, cutting the invoice without degrading the answers.',
    cta: 'Talk about model routing in my AI system',
  },
  related: [
    { label: 'Semantic cache to cut LLM cost', to: '/blog/cache-semantico-reduzir-custo-llm' },
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-router-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'La elección más cara de un sistema con LLM raramente es el prompt, es el modelo. Quien manda toda request al modelo más fuerte paga precio de tope para clasificar un sí o no, extraer un código postal de un texto o responder un "hola". Quien manda todo al modelo más barato entrega respuesta pobre cuando la tarea exige razonamiento, y paga el costo de rehacer, de reclamo y de retrabajo. El ruteo de modelos es la disciplina de casar cada tarea con el modelo más barato que aún la resuelve bien, y escalar a un modelo más fuerte solo cuando la tarea realmente lo pide. Hecho de forma ingenua, el router se vuelve un cuello de botella que clasifica mal y manda tarea difícil a modelo débil. Hecho con regla y fallback, corta una porción grande de la factura sin que el usuario perciba caída de calidad, porque las tareas triviales (que son la mayoría) pasan a correr en un modelo diez veces más barato, y las difíciles siguen en el modelo fuerte. Este artículo muestra cómo diseñar esa capa: el criterio de clasificación, la tabla de costo por tarea, el router con fallback y la métrica que dice si está ahorrando o degradando.',
  sections: [
    {
      title: 'Por qué un solo modelo es la decisión más cara',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición de estandarizar todo en un modelo fuerte parece simplicidad, pero es la decisión que más infla la factura de un sistema con LLM. La mayoría de las requests de un producto real no es razonamiento complejo: es clasificación de intención, extracción de campo, reformulación de texto, respuesta corta de FAQ, ruteo de cola. Esas tareas las resuelve con holgura un modelo pequeño y barato, y mandarlas al modelo tope de línea es pagar precio de razonamiento profundo por trabajo de rutina. El inverso también cuesta caro: estandarizar todo en el modelo barato entrega respuesta pobre en las pocas tareas que exigen razonamiento, y el costo aparece disfrazado de retrabajo, de reclamo y de tarea rehecha a mano.',
        },
        {
          type: 'paragraph',
          value:
            'El punto central es que la distribución de dificultad de las requests es desigual: un puñado de tareas difíciles y una multitud de tareas triviales. La tabla de abajo muestra por qué elegir un solo modelo, sea fuerte o débil, deja dinero o calidad sobre la mesa.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Costo', 'Calidad en tareas difíciles'],
          rows: [
            [
              'Todo en el modelo fuerte',
              'Alto: paga tope hasta en lo trivial',
              'Óptima, pero muy cara para la mayoría',
            ],
            [
              'Todo en el modelo barato',
              'Bajo, pero con retrabajo escondido',
              'Mala: falla donde se necesita razonamiento',
            ],
            [
              'Ruteo por tarea',
              'Bajo en lo trivial, alto solo donde hace falta',
              'Buena: lo difícil va al modelo fuerte',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El ruteo no es usar siempre el modelo más barato, es usar el modelo más barato que aún resuelve esa tarea. Cuando la mayoría de las requests es trivial, mover esa mayoría a un modelo diez veces más barato corta la factura de forma expresiva, mientras las pocas tareas difíciles siguen recibiendo el modelo fuerte. La ganancia viene de la distribución: no bajás la calidad media, dejás de pagar precio de razonamiento por trabajo de rutina.',
        },
      ],
    },
    {
      title: 'Clasificar la tarea: complejidad, riesgo y costo aceptable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corazón del router es la clasificación: antes de elegir el modelo, necesita saber qué tipo de tarea tiene delante. Tres ejes bastan para decidir bien. El primero es la complejidad: la tarea es estándar (clasificar, extraer, reformular) o exige razonamiento de varias etapas, síntesis o juicio. El segundo es el riesgo: un error en la respuesta es una molestia tolerable o una falla cara (dato financiero, jurídico, médico). El tercero es el costo aceptable: cuánto puede gastar esa tarea por llamada dado el valor que genera. Una clasificación de cola que corre millones de veces al día tiene presupuesto por llamada mínimo; un análisis de contrato que corre diez veces al día tolera pagar caro.',
        },
        {
          type: 'paragraph',
          value:
            'La clasificación en sí puede ser barata. Muchas veces la propia naturaleza del endpoint ya define la clase (el endpoint de "clasificar intención" es siempre trivial, el de "analizar documento" es siempre complejo), y en ese caso el ruteo es una tabla estática, sin costo de inferencia. Cuando el mismo endpoint recibe tareas de dificultad variable, un clasificador liviano (un modelo pequeño o hasta una heurística de tamaño y palabras clave) decide la ruta. La regla es no gastar más para clasificar de lo que se ahorra ruteando.',
        },
        {
          type: 'code',
          value: `// router/classify.js
// Clasifica la tarea antes de elegir el modelo.
// Barato a proposito: la clasificacion no puede costar mas de lo que ahorra.

export function classifyTask(req) {
  // Muchas veces la ruta ya esta implicita en el tipo del endpoint.
  if (req.kind === 'intent' || req.kind === 'extract') {
    return { tier: 'small', reason: 'tarea estandar de rutina' };
  }
  if (req.kind === 'analysis' || req.kind === 'reasoning') {
    return { tier: 'large', reason: 'exige razonamiento de varias etapas' };
  }

  // Cuando el mismo endpoint recibe dificultad variable, una heuristica liviana
  // (tamano, palabras clave) elige la ruta sin costo de inferencia.
  const long = (req.text || '').length > 2000;
  const sensitive = req.risk === 'high';
  if (long || sensitive) return { tier: 'large', reason: 'entrada larga o riesgo alto' };

  return { tier: 'small', reason: 'default' };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate que la clasificación es conservadora en lo que importa: riesgo alto y entrada larga ya empujan al modelo fuerte, incluso sin certeza de que la tarea es difícil. Errar mandando una tarea trivial al modelo fuerte cuesta unos centavos; errar mandando una tarea crítica al modelo débil cuesta una respuesta equivocada en un contexto sensible. El router debe errar siempre hacia el lado seguro, y es el fallback de la próxima sección el que corrige el otro tipo de error sin exigir clasificación perfecta.',
        },
      ],
    },
    {
      title: 'El router con fallback: escalar cuando el barato falla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ningún clasificador acierta siempre, y exigir clasificación perfecta vuelve el router frágil. La salida elegante es el fallback: manda la tarea al modelo barato primero, valida la respuesta y, si no pasa la validación, escala al modelo fuerte. Así el router no necesita prever de antemano toda tarea difícil; prueba el barato, y solo paga el caro cuando el barato prueba que no dio abasto. El flujo de abajo muestra el camino completo de una request, de la clasificación al fallback.',
        },
        {
          type: 'diagram',
          value: `Camino de una request por el router de modelos

  request
        |
        v
  clasifica la tarea (complejidad, riesgo, costo)
        |
        v
  [ ¿tier? ]
     |  small                   |  large
     v                          v
  llama modelo barato       llama modelo fuerte
        |                       |
        v                       v
  [ ¿respuesta válida? ]    devuelve respuesta
     |  sí       |  no
     v           v
  devuelve    FALLBACK: llama modelo fuerte
                  |
                  v
              devuelve respuesta fuerte

  mayoría trivial resuelve en el barato = ahorro
  minoría difícil escala en el fallback = calidad`,
        },
        {
          type: 'code',
          value: `// router/route.js
// Rutea al modelo mas barato que resuelve. Si el barato falla la
// validacion, escala al fuerte. El fallback corrige error de clasificacion.

export function createRouter({ callSmall, callLarge, validate }) {
  return async function route(req) {
    const { tier } = classifyTask(req);

    if (tier === 'large') {
      // Tarea ya clasificada como dificil: va directo al modelo fuerte.
      return { answer: await callLarge(req), model: 'large', escalated: false };
    }

    // Prueba el modelo barato primero.
    const small = await callSmall(req);
    if (validate(small, req)) {
      return { answer: small, model: 'small', escalated: false };
    }

    // El barato no paso la validacion: escala al fuerte (fallback).
    const large = await callLarge(req);
    return { answer: large, model: 'large', escalated: true };
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que hace funcionar el fallback es la validación: debe detectar de forma barata cuándo el modelo barato entregó una respuesta mala. Para tareas estructuradas eso es objetivo (el JSON no cuadra con el schema, el campo esperado vino vacío, la clasificación cayó fuera del conjunto de etiquetas válidas). Para tareas abiertas es más sutil, y a veces vale un segundo modelo pequeño como juez. La clave es que el fallback solo compensa si la tasa de escalonamiento es baja: si la mitad de las tareas triviales falla y escala, pagás el barato y el caro, y habría sido mejor mandar todo al fuerte. Monitorear esa tasa es lo que cubre la sección de métricas.',
        },
      ],
    },
    {
      title: 'La tabla de costo por tarea: el mapa de la decisión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ruteo solo es una decisión informada si tenés el costo de cada modelo por tipo de tarea delante. Sin esa tabla, "modelo barato" y "modelo fuerte" son etiquetas vagas, y la elección se vuelve palpito. Con ella, el ruteo se vuelve aritmética: sabés cuánto cuesta cada ruta, qué fracción del tráfico cae en cada una y cuánto ahorra el ruteo frente al escenario de modelo único. La tabla de abajo es el formato mínimo de ese análisis, con números ilustrativos para mostrar la estructura de la decisión.',
        },
        {
          type: 'table',
          columns: ['Tipo de tarea', 'Modelo indicado', 'Costo relativo', 'Fracción del tráfico'],
          rows: [
            ['Clasificar intención', 'Pequeño', '1x', 'Alta'],
            ['Extraer campo (CP, valor)', 'Pequeño', '1x', 'Alta'],
            ['Respuesta de FAQ', 'Pequeño', '1x', 'Media'],
            ['Resumen de conversación', 'Medio', '4x', 'Media'],
            ['Análisis de documento', 'Fuerte', '15x', 'Baja'],
            ['Razonamiento de varias etapas', 'Fuerte', '15x', 'Baja'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura de esta tabla es el argumento entero del ruteo. Las tareas más caras por llamada (análisis de documento, razonamiento) son justamente las de menor volumen; las de mayor volumen (clasificar, extraer) son las más baratas por llamada. Cuando multiplicás costo por volumen, la cuenta del modelo único queda dominada por el costo de correr el fuerte en lo trivial de alto volumen. El ruteo rompe esa multiplicación: el alto volumen pasa a correr barato, y el costo del fuerte queda confinado al bajo volumen donde es necesario. Sin esa tabla no sabés si el ruteo vale el esfuerzo; con ella, la ganancia es calculable antes de escribir la primera línea.',
        },
      ],
    },
    {
      title: 'Validación y guardrails: lo que impide al router degradar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El riesgo del ruteo no es técnico, es de calidad: mandar una tarea que necesitaba el modelo fuerte al barato y servir una respuesta peor sin que nadie lo note. La defensa contra eso es doble. La primera capa es la clasificación conservadora, que ya vimos: en la duda, sube de tier. La segunda es la validación de la respuesta del modelo barato, que convierte el fallback en una red de seguridad. Juntas, garantizan que el ahorro no viene a costa de calidad en las tareas que importan.',
        },
        {
          type: 'ordered',
          items: [
            'Valida estructura siempre que puedas: si la tarea espera JSON, una etiqueta de un conjunto cerrado o un campo específico, la validación es objetiva y barata, y el fallback se dispara solo cuando el barato erra el formato.',
            'Usa un juez liviano para tareas abiertas: cuando no hay estructura, un modelo pequeño puede puntuar la respuesta del barato (¿completa? ¿en tema? ¿sin rechazo indebido?) y decidir si escala, aún más barato que correr el fuerte directo.',
            'Traba tareas de riesgo alto fuera del modelo barato: cobranza, jurídico, salud y cualquier cosa cara de errar deben ir directo al fuerte, sin pasar por el intento barato, porque ahí el costo de un error supera el ahorro.',
            'Limita la profundidad del fallback: un intento barato y una escalada bastan; no encadenes tres modelos, si no el peor caso paga todos y la latencia explota.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla que amarra todo: el router ahorra en el caso común y protege en el caso raro. El caso común (tarea trivial de alto volumen) corre barato y pasa la validación, y de ahí viene el ahorro. El caso raro (tarea difícil o clasificada mal) es capturado por la validación y escalado por el fallback, y de ahí viene la garantía de calidad. Un router sin validación es solo una apuesta a que la clasificación nunca yerra, y la clasificación siempre yerra en algún punto. La validación es lo que transforma el ruteo de apuesta en ingeniería.',
        },
      ],
    },
    {
      title: 'Medir si el router ahorra sin degradar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un router sin métrica es una promesa de ahorro que nadie chequeó. Cuatro señales dicen si está entregando. El ahorro real compara el costo con ruteo contra el costo hipotético de correr todo en el modelo fuerte, y es la justificación de la capa. La tasa de escalonamiento mide cuántas tareas que fueron al barato terminaron escalando al fuerte: si es alta, el barato está fallando demasiado y el ruteo paga dos veces. La distribución por tier muestra cuánto del tráfico cae en cada modelo y confirma si la clasificación está mandando la mayoría al barato como se espera. Y la calidad por ruta, medida por muestreo, verifica si las respuestas servidas por el barato no están peores que las del fuerte.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué revela', 'Cuándo actuar'],
          rows: [
            [
              'Ahorro real',
              'Costo con ruteo vs modelo único fuerte',
              'Bajo: poca tarea cae en el barato, revisa la clasificación',
            ],
            [
              'Tasa de escalonamiento',
              'Fracción del barato que escaló al fuerte',
              'Alta: el barato falla mucho, sube el tier de origen',
            ],
            [
              'Distribución por tier',
              'Fracción del tráfico en cada modelo',
              'Mucho en el fuerte: clasificación muy conservadora',
            ],
            [
              'Calidad por ruta',
              '¿Respuesta del barato peor que la del fuerte?',
              'Sí: aprieta la validación o el criterio de tier',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tasa de escalonamiento es la métrica que delata un router mal calibrado, porque captura el peor escenario: pagar el barato y el caro en la misma request. Escalonamiento alto significa que la clasificación está demasiado optimista, mandando al barato tareas que no resuelve, y la corrección es subir el tier de origen de esas clases de tarea en vez de confiar en el fallback. Una distribución concentrada en el fuerte indica lo opuesto, una clasificación demasiado conservadora que anula el ahorro. El punto de operación sano es la mayoría del tráfico en el barato, escalonamiento bajo y calidad por ruta indistinguible entre barato y fuerte en las tareas que el barato atiende. Ese equilibrio es lo que el ruteo persigue.',
        },
      ],
    },
    {
      title: 'Montar la capa de ruteo en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ruteo de modelos es una de las optimizaciones de mejor retorno en un sistema con LLM: pega directo en el mayor ítem de costo (la llamada al modelo) sin tocar la experiencia del usuario cuando está bien hecho. Pero es una optimización sensible a la calidad, así que el orden de despliegue importa: empieza protegiendo la calidad y afloja el ahorro con dato en la mano.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por la tabla de costo por tarea: sin saber el costo y el volumen de cada tipo, no sabés si el ruteo vale ni qué tareas mover primero. Prioriza las de alto volumen y baja complejidad.',
            'Rutea primero lo que es obviamente trivial: clasificación, extracción y FAQ corta son seguros de mandar al barato desde el día uno, y ya entregan la mayor porción del ahorro.',
            'Enciende el fallback con validación antes de bajar más: solo después de tener la red de seguridad del fallback funcionando es seguro mover tareas de dificultad dudosa al barato.',
            'Instrumenta las cuatro métricas: ahorro real, escalonamiento, distribución por tier y calidad por ruta. Sin ellas no sabés si ahorraste o degradaste.',
            'Mantén el riesgo alto fuera del ruteo barato: tareas caras de errar van directo al fuerte, siempre. El ahorro viene del volumen trivial, no de arriesgar lo crítico.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un router que corta la factura sin que nadie lo note y uno que degrada la calidad a oscuras está entera en la clasificación conservadora, la validación con fallback y la métrica de escalonamiento, no en la astucia del criterio de elección. El criterio es simple: el modelo más barato que aún resuelve. Lo que lo vuelve confiable en producción es la red de seguridad que captura los errores de clasificación y la instrumentación que prueba que el ahorro es real y la calidad se mantuvo. Bien montado, el ruteo es dinero dejado sobre la mesa por quien estandariza todo en el modelo fuerte, recuperado sin que el usuario perciba diferencia en las respuestas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El ruteo de modelos no es solo usar siempre el modelo más barato?',
      answer:
        'No. Usar siempre el barato degrada las tareas que exigen razonamiento, y el costo aparece disfrazado de retrabajo y reclamo. El ruteo es usar el modelo más barato que aún resuelve esa tarea específica, y escalar a un modelo más fuerte cuando la tarea realmente lo pide. La mayoría de las requests de un producto real es trivial (clasificar, extraer, responder FAQ) y corre bien en el barato; la minoría difícil sigue en el fuerte. La ganancia viene de la distribución desigual de dificultad: movés el alto volumen trivial al barato sin bajar la calidad media, porque las tareas difíciles nunca dejan el modelo fuerte.',
    },
    {
      question: '¿Y si el router clasifica mal y manda tarea difícil al modelo barato?',
      answer:
        'Para eso existe el fallback. El router manda la tarea al barato primero, valida la respuesta y, si no pasa la validación (JSON fuera de schema, campo vacío, respuesta incompleta), escala automáticamente al modelo fuerte. Así el router no necesita clasificación perfecta: prueba el barato y solo paga el caro cuando el barato prueba que no dio abasto. La clasificación también es conservadora, empujando riesgo alto y entrada larga directo al fuerte. Lo que hay que monitorear es la tasa de escalonamiento: si es alta, el barato está fallando demasiado y vale subir el tier de origen de esas tareas.',
    },
    {
      question: '¿Cómo saber si el ruteo está ahorrando de verdad?',
      answer:
        'Con cuatro métricas. El ahorro real compara el costo con ruteo contra correr todo en el modelo fuerte. La tasa de escalonamiento mide cuántas tareas del barato terminaron en el fuerte (alta significa pagar dos veces). La distribución por tier muestra si la mayoría del tráfico cae en el barato como se espera. Y la calidad por ruta, por muestreo, verifica si la respuesta del barato no está peor que la del fuerte. El punto sano es la mayoría del tráfico en el barato, escalonamiento bajo y calidad indistinguible en las tareas que el barato atiende. Sin esas métricas, el ruteo es solo una promesa de ahorro que nadie chequeó.',
    },
  ],
  conclusion: {
    title: 'El ruteo de modelos corta costo de LLM cuando cada tarea va al modelo correcto',
    description:
      'Mandar todo al modelo fuerte paga precio de razonamiento por trabajo de rutina; el ruteo casa cada tarea con el modelo más barato que aún la resuelve, con clasificación conservadora, fallback validado y métrica de escalonamiento. Puedo diseñar esa capa en tu sistema de IA, de la tabla de costo a la observabilidad, cortando factura sin degradar las respuestas.',
    cta: 'Hablar sobre ruteo de modelos en mi sistema de IA',
  },
  related: [
    { label: 'Cache semántico para reducir el costo de LLM', to: '/blog/cache-semantico-reduzir-custo-llm' },
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'model-router-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
