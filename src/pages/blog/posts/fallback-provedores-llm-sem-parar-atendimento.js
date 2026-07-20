// Conteudo do artigo: fallback entre provedores de LLM sem parar o atendimento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Fallback mínimo entre provedores de LLM: um roteador que envia a requisição ao provedor primário, e diante de erro que não é culpa do pedido (indisponibilidade, timeout, rate limit) tenta o secundário com o mesmo prompt normalizado, mantendo circuit breaker por provedor, respeitando o Retry-After e devolvendo qual provedor de fato respondeu, para que uma queda de um fornecedor não vire uma queda do atendimento.',
  en: 'Minimal fallback across LLM providers: a router that sends the request to the primary provider, and upon an error that is not the request\'s fault (unavailability, timeout, rate limit) tries the secondary with the same normalized prompt, keeping a per-provider circuit breaker, honoring Retry-After and reporting which provider actually answered, so that one vendor going down does not become the support going down.',
  es: 'Fallback mínimo entre proveedores de LLM: un router que envía la petición al proveedor primario, y ante un error que no es culpa del pedido (indisponibilidad, timeout, rate limit) intenta el secundario con el mismo prompt normalizado, manteniendo un circuit breaker por proveedor, respetando el Retry-After y devolviendo qué proveedor de hecho respondió, para que una caída de un proveedor no se vuelva una caída de la atención.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-provider-fallback-mini';

const pt = {
  intro:
    'Um sistema de atendimento com IA depende de um serviço que você não controla: a API do provedor de LLM. Ela cai, degrada, entra em manutenção e passa por incidentes regionais, e quando isso acontece o seu atendimento para junto, mesmo que todo o resto da sua infraestrutura esteja saudável. A tentação é resolver com retry: a chamada falhou, tenta de novo. Mas retry no mesmo provedor que está fora não ajuda, e retry num provedor com rate limit só piora o quadro. A resposta de engenharia é o fallback entre provedores: manter um segundo, e às vezes um terceiro, fornecedor de LLM pronto para assumir quando o primário falha, de forma que a queda de um vire só uma troca invisível de rota, não uma queda do atendimento. O que parece simples de fora esconde três decisões difíceis: distinguir a falha que vale trocar de provedor da falha que trocar não resolve, normalizar o prompt e a resposta entre APIs que não são idênticas, e evitar que a tentativa de socorro derrube o provedor de socorro junto. Este artigo mostra por que só retry não basta, quais erros disparam o fallback e quais não, o circuit breaker que protege o secundário, a normalização entre provedores, o cuidado com o custo e a qualidade de cada rota e como testar que a troca acontece sem o cliente perceber.',
  sections: [
    {
      title: 'Por que retry no mesmo provedor não é fallback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Retry e fallback resolvem problemas diferentes e são confundidos com frequência. Retry é insistir na mesma porta: a chamada falhou por um soluço transitório, você espera um pouco e tenta de novo no mesmo provedor. Funciona para erro pontual, um pacote perdido, uma instância que reiniciou. Fallback é trocar de porta: o provedor primário não está respondendo de forma consistente, então você manda a mesma requisição para outro provedor. Quando o primário está em incidente amplo, retry só bate na mesma parede mais vezes, some latência ao pedido e ainda pode piorar, porque cada retry é mais carga sobre um serviço que já está sofrendo. O sinal de que você precisa de fallback e não de mais retry é a falha persistir depois de algumas tentativas: aí o problema não é transitório, é o provedor, e a solução é outro provedor.',
        },
        {
          type: 'paragraph',
          value:
            'O erro clássico é tratar retry e fallback como a mesma coisa e empilhar retries agressivos esperando que a nona tentativa dê certo. Num incidente do provedor, isso transforma uma falha rápida numa espera longa: o cliente fica olhando o "digitando..." por dezenas de segundos até o sistema desistir, quando poderia ter recebido a resposta do provedor secundário em um segundo. A ordem certa é retry curto e limitado no provedor atual para absorver o soluço transitório, e fallback para outro provedor assim que fica claro que não é soluço, é queda. Um sem o outro deixa buraco: só retry não sobrevive à queda do provedor, só fallback troca de rota por qualquer soluço bobo que o retry resolveria mais barato.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Retry (mesmo provedor)', 'Fallback (outro provedor)'],
          rows: [
            [
              'Resolve',
              'Soluço transitório, erro pontual',
              'Queda ou degradação persistente do provedor',
            ],
            [
              'Ação',
              'Espera e repete na mesma porta',
              'Manda a mesma requisição para outra porta',
            ],
            [
              'Custo do erro',
              'Baixo se limitado, alto se agressivo',
              'Troca de rota, exige normalizar prompt e resposta',
            ],
            [
              'Risco',
              'Insistir num provedor que já caiu',
              'Derrubar o secundário se ele receber toda a carga',
            ],
          ],
        },
      ],
    },
    {
      title: 'Quais erros disparam o fallback e quais não',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda falha justifica trocar de provedor. A pergunta que separa é: a culpa é do pedido ou do provedor? Se o prompt é inválido, excede o limite de contexto, viola a política de conteúdo ou usa parâmetros errados, o segundo provedor vai recusar exatamente igual, porque o problema viajou junto com a requisição. Trocar de rota aqui só gasta duas chamadas para receber o mesmo erro. Já se a falha é do provedor, indisponibilidade, timeout, erro interno, sobrecarga, o segundo provedor não carrega esse problema e tem chance real de responder. O fallback deve disparar só na segunda categoria, e o rate limit fica no meio: é do provedor, mas trocar por trocar pode empurrar a carga para um secundário que também vai estourar, então ele pede um cuidado extra que os próximos blocos tratam.',
        },
        {
          type: 'list',
          items: [
            'Dispara fallback: provedor indisponível (5xx), timeout de conexão ou de resposta, erro interno do provedor, sobrecarga temporária. A causa está do lado do fornecedor e não viaja com a requisição.',
            'Dispara fallback com cuidado: rate limit (429). É do provedor, mas trocar sem controle pode saturar o secundário; respeite o Retry-After do primário e considere se o secundário aguenta a carga desviada.',
            'Não dispara fallback: prompt inválido, contexto excedido, violação de política de conteúdo, autenticação errada, parâmetro não suportado. A culpa é do pedido, o segundo provedor recusa igual.',
            'Caso ambíguo: resposta veio, mas malformada ou vazia. Antes de trocar de provedor, tente uma vez no mesmo; se persistir, pode ser degradação do primário e aí o fallback ajuda.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Classificar o erro certo é o que impede o fallback de virar desperdício ou mascarar bug. Se você trocar de provedor diante de um prompt malformado, o sistema faz duas chamadas caras, recebe dois erros e ainda esconde de você que o prompt está errado, porque o log só mostra "tentou os dois provedores e falhou". A classificação explícita, culpa do pedido versus culpa do provedor, é a fronteira que decide entre corrigir a origem e trocar de rota. Sem ela, o fallback engole erros que você precisava enxergar.',
        },
      ],
    },
    {
      title: 'O roteador: primário, secundário e a mesma requisição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O coração do fallback é um roteador que fica na frente dos provedores. Ele recebe a requisição do seu sistema uma vez, escolhe o provedor primário, e diante de uma falha que classifica como culpa do provedor, tenta o próximo da lista com a mesma requisição normalizada. O ponto crítico é que a requisição precisa ser a mesma em significado, ainda que a forma mude entre APIs: o mesmo prompt, as mesmas instruções, o mesmo comportamento esperado. Se o roteador manda um prompt para o primário e um prompt diferente para o secundário, o fallback deixa de ser uma rota alternativa e vira um comportamento imprevisível, em que a resposta que o cliente recebe depende de qual provedor estava de pé.',
        },
        {
          type: 'code',
          value: `// llm/router.js
// Roteador de fallback: tenta os provedores em ordem com a MESMA requisicao.
// So troca de provedor quando o erro e culpa do provedor, nao do pedido.

export async function callWithFallback(request, providers, { isProviderFault }) {
  let lastError;

  for (const provider of providers) {
    // Circuit breaker: pula o provedor que esta marcado como fora.
    if (provider.isOpen()) continue;

    try {
      // A mesma requisicao normalizada vai para cada provedor da lista.
      // O que muda e so a traducao para o formato de cada API, nao o conteudo.
      const response = await provider.call(request);
      provider.recordSuccess();
      // Devolve QUAL provedor respondeu: essencial para log, custo e metrica.
      return { response, provider: provider.name };
    } catch (err) {
      lastError = err;

      // Culpa do pedido (prompt invalido, contexto excedido): trocar nao ajuda,
      // o proximo provedor recusa igual. Falha rapido em vez de gastar chamadas.
      if (!isProviderFault(err)) throw err;

      // Culpa do provedor: marca a falha e deixa o loop tentar o proximo.
      provider.recordFailure();
    }
  }

  // Todos os provedores da lista falharam por culpa deles: sem rota de saida.
  throw new AllProvidersFailedError('nenhum provedor respondeu', lastError);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no que o roteador devolve: não só a resposta, mas qual provedor respondeu. Isso não é detalhe. Sem saber qual rota atendeu cada requisição, você não consegue medir com que frequência o fallback dispara, quanto o provedor secundário está custando, nem se a qualidade da resposta muda quando a rota troca. O provedor que respondeu é a informação que transforma o fallback de uma caixa-preta que "às vezes funciona" num mecanismo observável, com métrica de quantas requisições cada provedor absorveu e alerta quando o primário passa a falhar demais.',
        },
      ],
    },
    {
      title: 'Circuit breaker: não insistir no provedor que já caiu',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se o provedor primário está em incidente, tentar cada requisição nele antes de cair para o secundário adiciona a latência da falha a toda chamada. Mil clientes esperam o timeout do primário mil vezes antes de o roteador desistir e ir ao secundário. O circuit breaker resolve isso: depois de um número de falhas seguidas de um provedor, o roteador abre o circuito daquele provedor e para de tentá-lo por um tempo, mandando as requisições direto para o próximo da lista. Passado o intervalo, ele deixa uma requisição de teste passar; se voltar, fecha o circuito e retoma o provedor; se falhar de novo, mantém aberto. É o que evita que a queda de um provedor contamine a latência de todas as requisições que ainda tentam bater nele.',
        },
        {
          type: 'diagram',
          value: `Fallback com circuit breaker por provedor

  requisicao
     |
     v
  [ primario ]  circuito FECHADO -> tenta
     |                                  \\
     | sucesso                           \\ N falhas seguidas
     v                                    v
  responde                          circuito ABERTO
  (provedor: primario)              (pula o primario por um tempo)
                                          |
                                          v
                                    [ secundario ]  -> tenta
                                          |
                                          | sucesso
                                          v
                                    responde
                                    (provedor: secundario)

  passado o intervalo: 1 requisicao de teste no primario
    volta  -> circuito FECHA, retoma o primario
    falha  -> circuito segue ABERTO

  erro culpa-do-pedido: NAO abre circuito, NAO faz fallback -> falha rapido`,
        },
        {
          type: 'paragraph',
          value:
            'O circuit breaker precisa ser por provedor, não global, porque a razão de existir do fallback é que os provedores falham de forma independente. Um breaker único que abre para todo mundo joga fora justamente a redundância que você montou. E o breaker só deve contar as falhas de culpa do provedor: um prompt inválido não é sinal de que o provedor caiu, então não pode abrir o circuito. Misturar as duas contas faz o breaker abrir por erros do seu próprio sistema, tirando de operação um provedor que estava saudável. A separação entre culpa do pedido e culpa do provedor, que decide o fallback, também é a que alimenta o breaker.',
        },
      ],
    },
    {
      title: 'Normalização: a mesma resposta de APIs diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Provedores de LLM não têm a mesma API. Mudam o formato da requisição, o nome dos parâmetros, a forma de passar instruções de sistema, a estrutura da resposta, os nomes dos modelos e a maneira de fazer tool use. Se o seu sistema fala direto o dialeto de um provedor, trocar de rota no fallback obriga a reescrever a requisição na hora, e a resposta que volta tem um formato diferente que o resto do código não sabe ler. A saída é uma camada de normalização: o seu sistema fala um formato interno único, e cada provedor tem um adaptador que traduz esse formato para o dialeto do provedor na ida e traduz a resposta de volta para o formato interno na volta. Assim o roteador troca de provedor sem que o restante do código perceba que a rota mudou.',
        },
        {
          type: 'paragraph',
          value:
            'A normalização tem um limite honesto: nem tudo se traduz um para um. Um provedor pode ter um recurso que o outro não tem, um formato de tool use diferente, um comportamento de recusa distinto. O adaptador precisa mapear o que dá e ter uma degradação clara para o que não dá, e o fallback só deve incluir na lista provedores capazes de atender a mesma requisição em termos práticos. Colocar como secundário um provedor que não suporta o tool use que a sua aplicação exige não é redundância, é uma rota que vai falhar de outro jeito na hora do incidente. A regra é que os provedores da lista de fallback precisam ser intercambiáveis para o caso de uso, não idênticos em tudo.',
        },
        {
          type: 'table',
          columns: ['O que muda entre provedores', 'Sem normalização', 'Com camada de adaptador'],
          rows: [
            [
              'Formato da requisição',
              'Reescrever a chamada em cada rota',
              'Formato interno único, adaptador traduz na ida',
            ],
            [
              'Estrutura da resposta',
              'Código a jusante quebra ao trocar de rota',
              'Adaptador traduz de volta ao formato interno',
            ],
            [
              'Nomes de modelo',
              'Modelo do primário não existe no secundário',
              'Mapa de modelo equivalente por provedor',
            ],
            [
              'Tool use e recursos',
              'Secundário não suporta o que o primário fazia',
              'Só entram na lista provedores intercambiáveis',
            ],
          ],
        },
      ],
    },
    {
      title: 'Custo, qualidade e o cuidado com o rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A rota de fallback não é gratuita nem neutra. O provedor secundário pode custar mais por token, pode ter latência diferente e pode dar respostas de qualidade diferente para o mesmo prompt, porque é outro modelo. Isso tem duas consequências práticas. A primeira é de custo: se o fallback dispara com frequência, você está gastando na rota cara sem perceber, e a métrica de qual provedor respondeu é o que revela isso. A segunda é de qualidade: um prompt calibrado para o modelo primário pode se comportar diferente no secundário, então o fallback que salva a disponibilidade pode degradar a resposta. O secundário existe para manter o atendimento de pé durante o incidente, não necessariamente para dar a melhor resposta possível, e essa é uma troca consciente, não um acidente.',
        },
        {
          type: 'paragraph',
          value:
            'O rate limit merece um parágrafo próprio porque é o erro que mais engana. Ele é culpa do provedor, então tenta se qualificar para o fallback, mas trocar cegamente diante de um 429 tem um risco específico: se o primário está com rate limit por causa de um pico de tráfego seu, desviar todo esse tráfego para o secundário provavelmente vai estourar o rate limit do secundário também, e agora os dois estão fora. O fallback por rate limit precisa respeitar o Retry-After que o primário informa, e o padrão mais seguro combina retry com backoff no primário e fallback só quando o secundário tem folga para absorver a carga. Trocar de provedor não cria capacidade do nada; se a demanda excede os dois, o fallback só espalha a fila.',
        },
        {
          type: 'ordered',
          items: [
            'Classifique o erro antes de agir: culpa do pedido falha rápido, culpa do provedor tenta o fallback, rate limit respeita o Retry-After.',
            'Mantenha retry curto e limitado no provedor atual para o soluço transitório, e reserve o fallback para a falha persistente.',
            'Use circuit breaker por provedor, contando só as falhas de culpa do provedor, para não adicionar a latência da queda a cada requisição.',
            'Normalize entrada e saída com adaptadores, e só inclua na lista de fallback provedores intercambiáveis para o caso de uso.',
            'Devolva e registre qual provedor respondeu; meça a taxa de fallback, o custo por rota e a qualidade da resposta secundária.',
          ],
        },
      ],
    },
    {
      title: 'Testar que a troca acontece sem o cliente perceber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fallback é código que só executa quando algo dá errado, então é o tipo de mecanismo que passa despercebido até o incidente real, quando você descobre que ele nunca funcionou. A única forma de confiar nele é forçar a falha em teste. Você simula o provedor primário devolvendo 5xx, timeout e 429, e verifica que o roteador cai para o secundário e devolve uma resposta válida com o provedor secundário registrado. Simula um prompt inválido e verifica que o roteador não faz fallback, falha rápido e não gasta a segunda chamada. Simula falhas seguidas e verifica que o circuit breaker abre e para de tentar o primário. Cada caminho do fallback precisa de um teste que o exercite de propósito, porque em produção ele fica quieto até o dia em que precisa salvar o atendimento.',
        },
        {
          type: 'code',
          value: `// llm/router.test.js
// Testa os caminhos do fallback forcando cada falha de proposito.

test('cai para o secundario quando o primario retorna 5xx', async () => {
  const primario = fakeProvider({ name: 'primario', fail: 'server_error' });
  const secundario = fakeProvider({ name: 'secundario', ok: true });

  const { response, provider } = await callWithFallback(
    request,
    [primario, secundario],
    { isProviderFault },
  );

  // A troca precisa ser invisivel para quem chamou: resposta valida...
  expect(response).toBeValid();
  // ...mas o log precisa revelar que foi o secundario que atendeu.
  expect(provider).toBe('secundario');
});

test('NAO faz fallback com prompt invalido: falha rapido', async () => {
  const primario = fakeProvider({ name: 'primario', fail: 'invalid_prompt' });
  const secundario = fakeProvider({ name: 'secundario', ok: true });

  // Culpa do pedido: o roteador nao gasta a segunda chamada, propaga o erro.
  await expect(
    callWithFallback(request, [primario, secundario], { isProviderFault }),
  ).rejects.toThrow('invalid_prompt');
  expect(secundario.callCount).toBe(0);
});`,
        },
        {
          type: 'paragraph',
          value:
            'O teste do caminho negativo, o de que o fallback não dispara para culpa do pedido, é tão importante quanto o positivo. É ele que garante que o mecanismo de socorro não vira um encobridor de bug, gastando duas chamadas e escondendo do log que o prompt estava errado. Um fallback bem testado é aquele em que você tem confiança tanto de que a troca acontece quando o provedor cai, quanto de que ela não acontece quando o erro é seu. Os dois lados juntos são o que faz a queda de um provedor virar uma linha no log em vez de uma queda no atendimento.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual a diferença entre retry e fallback entre provedores de LLM?',
      answer:
        'Retry é insistir no mesmo provedor: a chamada falhou por um soluço transitório, você espera um pouco e repete na mesma porta. Serve para erro pontual e não sobrevive à queda do provedor, porque insistir num serviço fora só bate na mesma parede. Fallback é trocar de provedor: diante de uma falha persistente que é culpa do provedor, você manda a mesma requisição para outro fornecedor de LLM, que não carrega aquele incidente. Os dois se complementam: retry curto e limitado absorve o soluço transitório barato, e o fallback assume quando fica claro que não é soluço, é queda. Só retry deixa o atendimento cair junto com o provedor; só fallback troca de rota por qualquer erro bobo que o retry resolveria mais barato.',
    },
    {
      question: 'Todo erro do provedor deve disparar o fallback?',
      answer:
        'Não. A pergunta que separa é de quem é a culpa. Erros de culpa do provedor, indisponibilidade, timeout, erro interno, sobrecarga, disparam o fallback, porque o segundo provedor não carrega esse problema e tem chance real de responder. Erros de culpa do pedido, prompt inválido, contexto excedido, violação de política, autenticação errada, não devem disparar, porque o problema viajou com a requisição e o segundo provedor vai recusar exatamente igual: trocar só gasta duas chamadas para receber o mesmo erro e ainda esconde do log que a origem estava errada. O rate limit fica no meio: é do provedor, mas trocar sem controle pode saturar o secundário, então ele pede respeitar o Retry-After e checar se o secundário tem folga antes de desviar a carga.',
    },
    {
      question: 'O provedor secundário dá a mesma resposta que o primário?',
      answer:
        'Nem sempre, e essa é uma troca consciente. O secundário costuma ser outro modelo, com custo por token, latência e comportamento diferentes, então um prompt calibrado para o primário pode se comportar de outro jeito no secundário. Uma camada de normalização, com adaptadores que traduzem a requisição e a resposta entre o formato interno e o dialeto de cada API, mantém o resto do código sem perceber a troca de rota, mas ela não iguala a qualidade das respostas, só o formato. Por isso o fallback existe para manter o atendimento de pé durante o incidente, não necessariamente para dar a melhor resposta possível, e só devem entrar na lista provedores intercambiáveis para o caso de uso, capazes de atender a mesma requisição em termos práticos, incluindo tool use e limites de contexto.',
    },
  ],
  conclusion: {
    title: 'Fallback transforma a queda de um provedor numa troca invisível de rota',
    description:
      'A disponibilidade do seu atendimento com IA não pode depender de um único fornecedor que você não controla. Classificar a falha entre culpa do pedido e culpa do provedor, cair para um secundário com a mesma requisição normalizada, proteger cada rota com circuit breaker e respeitar o rate limit transforma a queda de um provedor numa linha no log em vez de uma queda no atendimento. Posso desenhar essa camada de fallback no seu sistema de IA, escolhendo os provedores intercambiáveis, calibrando os gatilhos de troca e medindo custo e qualidade de cada rota, para que um incidente do fornecedor não vire um incidente do seu negócio.',
    cta: 'Falar sobre fallback de provedores no meu sistema de IA',
  },
  related: [
    { label: 'Roteamento de modelos: modelo certo para cada tarefa', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Rate limit e fila de prioridade para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Observabilidade e Confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'llm-provider-fallback-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'An AI support system depends on a service you do not control: the LLM provider API. It goes down, degrades, enters maintenance and suffers regional incidents, and when that happens your support goes down with it, even if all the rest of your infrastructure is healthy. The temptation is to solve it with retry: the call failed, try again. But retry on the same provider that is down does not help, and retry on a rate-limited provider only makes it worse. The engineering answer is fallback across providers: keeping a second, and sometimes a third, LLM vendor ready to take over when the primary fails, so that one going down becomes just an invisible route switch, not a support outage. What looks simple from outside hides three hard decisions: distinguishing the failure worth switching provider from the one that switching does not fix, normalizing the prompt and the response across APIs that are not identical, and preventing the rescue attempt from bringing the rescue provider down with it. This article shows why retry alone is not enough, which errors trigger the fallback and which do not, the circuit breaker that protects the secondary, the normalization across providers, the care with cost and quality of each route and how to test that the switch happens without the customer noticing.',
  sections: [
    {
      title: 'Why retry on the same provider is not fallback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Retry and fallback solve different problems and are frequently confused. Retry is insisting on the same door: the call failed due to a transient hiccup, you wait a bit and try again on the same provider. It works for a one-off error, a dropped packet, an instance that restarted. Fallback is switching doors: the primary provider is not responding consistently, so you send the same request to another provider. When the primary is in a broad incident, retry just hits the same wall more times, adds latency to the request and can even make it worse, because each retry is more load on a service that is already struggling. The sign that you need fallback and not more retry is the failure persisting after a few attempts: at that point the problem is not transient, it is the provider, and the solution is another provider.',
        },
        {
          type: 'paragraph',
          value:
            'The classic mistake is treating retry and fallback as the same thing and stacking aggressive retries hoping the ninth attempt succeeds. In a provider incident, that turns a fast failure into a long wait: the customer stares at the "typing..." for dozens of seconds until the system gives up, when it could have received the secondary provider\'s answer in one second. The right order is short, limited retry on the current provider to absorb the transient hiccup, and fallback to another provider as soon as it is clear it is not a hiccup, it is an outage. One without the other leaves a gap: retry alone does not survive the provider going down, fallback alone switches routes for any silly hiccup that retry would fix more cheaply.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Retry (same provider)', 'Fallback (another provider)'],
          rows: [
            [
              'Solves',
              'Transient hiccup, one-off error',
              'Persistent provider outage or degradation',
            ],
            [
              'Action',
              'Wait and repeat on the same door',
              'Send the same request to another door',
            ],
            [
              'Error cost',
              'Low if limited, high if aggressive',
              'Route switch, requires normalizing prompt and response',
            ],
            [
              'Risk',
              'Insisting on a provider that is already down',
              'Bringing the secondary down if it takes all the load',
            ],
          ],
        },
      ],
    },
    {
      title: 'Which errors trigger the fallback and which do not',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every failure justifies switching provider. The question that separates them is: is it the request\'s fault or the provider\'s fault? If the prompt is invalid, exceeds the context limit, violates the content policy or uses wrong parameters, the second provider will refuse it exactly the same, because the problem traveled along with the request. Switching route here only spends two calls to receive the same error. But if the failure is the provider\'s, unavailability, timeout, internal error, overload, the second provider does not carry that problem and has a real chance of answering. Fallback should trigger only on the second category, and rate limit sits in the middle: it is the provider\'s, but switching for its own sake can push the load onto a secondary that will also blow up, so it needs the extra care the next blocks address.',
        },
        {
          type: 'list',
          items: [
            'Triggers fallback: provider unavailable (5xx), connection or response timeout, provider internal error, temporary overload. The cause is on the vendor side and does not travel with the request.',
            'Triggers fallback with care: rate limit (429). It is the provider\'s, but switching without control can saturate the secondary; honor the primary\'s Retry-After and consider whether the secondary can take the diverted load.',
            'Does not trigger fallback: invalid prompt, exceeded context, content policy violation, wrong authentication, unsupported parameter. It is the request\'s fault, the second provider refuses the same.',
            'Ambiguous case: a response arrived, but malformed or empty. Before switching provider, try once on the same one; if it persists, it may be primary degradation and then the fallback helps.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Classifying the right error is what keeps the fallback from becoming waste or masking a bug. If you switch provider on a malformed prompt, the system makes two expensive calls, receives two errors and still hides from you that the prompt is wrong, because the log only shows "tried both providers and failed". The explicit classification, request\'s fault versus provider\'s fault, is the boundary that decides between fixing the source and switching route. Without it, the fallback swallows errors you needed to see.',
        },
      ],
    },
    {
      title: 'The router: primary, secondary and the same request',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The heart of fallback is a router that sits in front of the providers. It receives the request from your system once, chooses the primary provider, and upon a failure it classifies as the provider\'s fault, tries the next in the list with the same normalized request. The critical point is that the request must be the same in meaning, even if the form changes across APIs: the same prompt, the same instructions, the same expected behavior. If the router sends one prompt to the primary and a different prompt to the secondary, the fallback stops being an alternative route and becomes unpredictable behavior, where the answer the customer receives depends on which provider was up.',
        },
        {
          type: 'code',
          value: `// llm/router.js
// Fallback router: tries the providers in order with the SAME request.
// Only switches provider when the error is the provider's fault, not the request's.

export async function callWithFallback(request, providers, { isProviderFault }) {
  let lastError;

  for (const provider of providers) {
    // Circuit breaker: skip the provider marked as down.
    if (provider.isOpen()) continue;

    try {
      // The same normalized request goes to each provider in the list.
      // What changes is only the translation to each API's format, not the content.
      const response = await provider.call(request);
      provider.recordSuccess();
      // Returns WHICH provider answered: essential for log, cost and metric.
      return { response, provider: provider.name };
    } catch (err) {
      lastError = err;

      // Request's fault (invalid prompt, exceeded context): switching does not help,
      // the next provider refuses the same. Fail fast instead of spending calls.
      if (!isProviderFault(err)) throw err;

      // Provider's fault: record the failure and let the loop try the next.
      provider.recordFailure();
    }
  }

  // Every provider in the list failed by their own fault: no exit route.
  throw new AllProvidersFailedError('no provider answered', lastError);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice what the router returns: not just the response, but which provider answered. This is not a detail. Without knowing which route served each request, you cannot measure how often the fallback triggers, how much the secondary provider is costing, nor whether the response quality changes when the route switches. The provider that answered is the information that turns fallback from a black box that "sometimes works" into an observable mechanism, with a metric of how many requests each provider absorbed and an alert when the primary starts failing too much.',
        },
      ],
    },
    {
      title: 'Circuit breaker: not insisting on the provider that already went down',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If the primary provider is in an incident, trying each request on it before falling to the secondary adds the failure latency to every call. A thousand customers wait for the primary\'s timeout a thousand times before the router gives up and goes to the secondary. The circuit breaker solves this: after a number of consecutive failures from a provider, the router opens that provider\'s circuit and stops trying it for a while, sending requests straight to the next in the list. Once the interval passes, it lets one test request through; if it returns, it closes the circuit and resumes the provider; if it fails again, it stays open. It is what prevents one provider\'s outage from contaminating the latency of every request that still tries to hit it.',
        },
        {
          type: 'diagram',
          value: `Fallback with per-provider circuit breaker

  request
     |
     v
  [ primary ]  circuit CLOSED -> try
     |                              \\
     | success                       \\ N consecutive failures
     v                                v
  answers                        circuit OPEN
  (provider: primary)            (skips the primary for a while)
                                      |
                                      v
                                [ secondary ]  -> try
                                      |
                                      | success
                                      v
                                answers
                                (provider: secondary)

  after the interval: 1 test request on the primary
    returns -> circuit CLOSES, resume the primary
    fails   -> circuit stays OPEN

  request-fault error: does NOT open circuit, does NOT fall back -> fail fast`,
        },
        {
          type: 'paragraph',
          value:
            'The circuit breaker needs to be per provider, not global, because the whole reason fallback exists is that providers fail independently. A single breaker that opens for everyone throws away exactly the redundancy you built. And the breaker should only count the provider-fault failures: an invalid prompt is not a sign the provider went down, so it must not open the circuit. Mixing the two counts makes the breaker open on errors from your own system, taking out of service a provider that was healthy. The separation between request\'s fault and provider\'s fault, which decides the fallback, is also the one that feeds the breaker.',
        },
      ],
    },
    {
      title: 'Normalization: the same response from different APIs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'LLM providers do not have the same API. They change the request format, the parameter names, the way of passing system instructions, the response structure, the model names and the way of doing tool use. If your system speaks one provider\'s dialect directly, switching route in the fallback forces rewriting the request on the fly, and the response that comes back has a different format the rest of the code does not know how to read. The way out is a normalization layer: your system speaks a single internal format, and each provider has an adapter that translates that format to the provider\'s dialect on the way in and translates the response back to the internal format on the way out. That way the router switches provider without the rest of the code noticing the route changed.',
        },
        {
          type: 'paragraph',
          value:
            'Normalization has an honest limit: not everything translates one to one. One provider may have a feature the other does not, a different tool use format, a distinct refusal behavior. The adapter needs to map what it can and have a clear degradation for what it cannot, and the fallback should only include in the list providers capable of serving the same request in practical terms. Putting as secondary a provider that does not support the tool use your application requires is not redundancy, it is a route that will fail another way when the incident comes. The rule is that the providers on the fallback list need to be interchangeable for the use case, not identical in everything.',
        },
        {
          type: 'table',
          columns: ['What changes across providers', 'Without normalization', 'With an adapter layer'],
          rows: [
            [
              'Request format',
              'Rewrite the call on each route',
              'Single internal format, adapter translates on the way in',
            ],
            [
              'Response structure',
              'Downstream code breaks on route switch',
              'Adapter translates back to the internal format',
            ],
            [
              'Model names',
              'Primary\'s model does not exist on the secondary',
              'Map of equivalent model per provider',
            ],
            [
              'Tool use and features',
              'Secondary does not support what the primary did',
              'Only interchangeable providers enter the list',
            ],
          ],
        },
      ],
    },
    {
      title: 'Cost, quality and the care with rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fallback route is neither free nor neutral. The secondary provider may cost more per token, may have different latency and may give different-quality answers for the same prompt, because it is another model. This has two practical consequences. The first is cost: if the fallback triggers frequently, you are spending on the expensive route without noticing, and the metric of which provider answered is what reveals it. The second is quality: a prompt calibrated for the primary model may behave differently on the secondary, so the fallback that saves availability can degrade the answer. The secondary exists to keep support up during the incident, not necessarily to give the best possible answer, and that is a conscious trade, not an accident.',
        },
        {
          type: 'paragraph',
          value:
            'Rate limit deserves its own paragraph because it is the error that fools you the most. It is the provider\'s fault, so it tries to qualify for the fallback, but switching blindly upon a 429 has a specific risk: if the primary is rate-limited because of a traffic spike of yours, diverting all that traffic to the secondary will probably blow the secondary\'s rate limit too, and now both are down. The rate-limit fallback needs to honor the Retry-After the primary reports, and the safest pattern combines retry with backoff on the primary and fallback only when the secondary has slack to absorb the load. Switching provider does not create capacity out of nowhere; if the demand exceeds both, the fallback only spreads the queue.',
        },
        {
          type: 'ordered',
          items: [
            'Classify the error before acting: request\'s fault fails fast, provider\'s fault tries the fallback, rate limit honors the Retry-After.',
            'Keep short, limited retry on the current provider for the transient hiccup, and reserve the fallback for the persistent failure.',
            'Use a per-provider circuit breaker, counting only the provider-fault failures, so as not to add the outage latency to every request.',
            'Normalize input and output with adapters, and only include in the fallback list providers interchangeable for the use case.',
            'Return and log which provider answered; measure the fallback rate, the cost per route and the quality of the secondary answer.',
          ],
        },
      ],
    },
    {
      title: 'Testing that the switch happens without the customer noticing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fallback is code that only runs when something goes wrong, so it is the kind of mechanism that goes unnoticed until the real incident, when you discover it never worked. The only way to trust it is to force the failure in a test. You simulate the primary provider returning 5xx, timeout and 429, and verify that the router falls to the secondary and returns a valid response with the secondary provider recorded. You simulate an invalid prompt and verify that the router does not fall back, fails fast and does not spend the second call. You simulate consecutive failures and verify that the circuit breaker opens and stops trying the primary. Each path of the fallback needs a test that exercises it on purpose, because in production it stays quiet until the day it needs to save the support.',
        },
        {
          type: 'code',
          value: `// llm/router.test.js
// Tests the fallback paths by forcing each failure on purpose.

test('falls to the secondary when the primary returns 5xx', async () => {
  const primary = fakeProvider({ name: 'primary', fail: 'server_error' });
  const secondary = fakeProvider({ name: 'secondary', ok: true });

  const { response, provider } = await callWithFallback(
    request,
    [primary, secondary],
    { isProviderFault },
  );

  // The switch must be invisible to the caller: a valid response...
  expect(response).toBeValid();
  // ...but the log must reveal that the secondary served it.
  expect(provider).toBe('secondary');
});

test('does NOT fall back on an invalid prompt: fails fast', async () => {
  const primary = fakeProvider({ name: 'primary', fail: 'invalid_prompt' });
  const secondary = fakeProvider({ name: 'secondary', ok: true });

  // Request's fault: the router does not spend the second call, propagates the error.
  await expect(
    callWithFallback(request, [primary, secondary], { isProviderFault }),
  ).rejects.toThrow('invalid_prompt');
  expect(secondary.callCount).toBe(0);
});`,
        },
        {
          type: 'paragraph',
          value:
            'The negative-path test, the one that the fallback does not trigger on a request\'s fault, is as important as the positive one. It is the one that guarantees the rescue mechanism does not become a bug cover-up, spending two calls and hiding from the log that the prompt was wrong. A well-tested fallback is one in which you are confident both that the switch happens when the provider goes down, and that it does not happen when the error is yours. The two sides together are what turns one provider going down into a line in the log instead of a support outage.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the difference between retry and fallback across LLM providers?',
      answer:
        'Retry is insisting on the same provider: the call failed due to a transient hiccup, you wait a bit and repeat on the same door. It works for a one-off error and does not survive the provider going down, because insisting on a service that is out just hits the same wall. Fallback is switching provider: upon a persistent failure that is the provider\'s fault, you send the same request to another LLM vendor, which does not carry that incident. The two complement each other: short, limited retry cheaply absorbs the transient hiccup, and the fallback takes over when it is clear it is not a hiccup, it is an outage. Retry alone lets support go down with the provider; fallback alone switches route for any silly error that retry would fix more cheaply.',
    },
    {
      question: 'Should every provider error trigger the fallback?',
      answer:
        'No. The question that separates them is whose fault it is. Provider-fault errors, unavailability, timeout, internal error, overload, trigger the fallback, because the second provider does not carry that problem and has a real chance of answering. Request-fault errors, invalid prompt, exceeded context, policy violation, wrong authentication, should not trigger, because the problem traveled with the request and the second provider will refuse it exactly the same: switching only spends two calls to receive the same error and even hides from the log that the source was wrong. Rate limit sits in the middle: it is the provider\'s, but switching without control can saturate the secondary, so it asks to honor the Retry-After and check whether the secondary has slack before diverting the load.',
    },
    {
      question: 'Does the secondary provider give the same response as the primary?',
      answer:
        'Not always, and that is a conscious trade. The secondary is usually another model, with different cost per token, latency and behavior, so a prompt calibrated for the primary may behave differently on the secondary. A normalization layer, with adapters that translate the request and the response between the internal format and each API\'s dialect, keeps the rest of the code from noticing the route switch, but it does not equalize the quality of the answers, only the format. That is why the fallback exists to keep support up during the incident, not necessarily to give the best possible answer, and only providers interchangeable for the use case should enter the list, capable of serving the same request in practical terms, including tool use and context limits.',
    },
  ],
  conclusion: {
    title: 'Fallback turns one provider going down into an invisible route switch',
    description:
      'The availability of your AI support cannot depend on a single vendor you do not control. Classifying the failure between request\'s fault and provider\'s fault, falling to a secondary with the same normalized request, protecting each route with a circuit breaker and honoring the rate limit turns one provider going down into a line in the log instead of a support outage. I can design that fallback layer in your AI system, choosing the interchangeable providers, calibrating the switch triggers and measuring the cost and quality of each route, so that a vendor incident does not become a business incident.',
    cta: 'Talk about provider fallback in my AI system',
  },
  related: [
    { label: 'Model routing: the right model for each task', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Rate limit and priority queue for LLM APIs', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Observability and Reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'llm-provider-fallback-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un sistema de atención con IA depende de un servicio que no controlás: la API del proveedor de LLM. Se cae, degrada, entra en mantenimiento y sufre incidentes regionales, y cuando eso pasa tu atención se cae junto, aunque todo el resto de tu infraestructura esté sano. La tentación es resolverlo con retry: la llamada falló, probá de nuevo. Pero retry en el mismo proveedor que está caído no ayuda, y retry en un proveedor con rate limit solo empeora el cuadro. La respuesta de ingeniería es el fallback entre proveedores: mantener un segundo, y a veces un tercer, proveedor de LLM listo para asumir cuando el primario falla, de forma que la caída de uno se vuelva solo un cambio invisible de ruta, no una caída de la atención. Lo que parece simple desde afuera esconde tres decisiones difíciles: distinguir la falla que vale cambiar de proveedor de la falla que cambiar no resuelve, normalizar el prompt y la respuesta entre APIs que no son idénticas, y evitar que el intento de rescate tire al proveedor de rescate junto. Este artículo muestra por qué solo retry no basta, qué errores disparan el fallback y cuáles no, el circuit breaker que protege al secundario, la normalización entre proveedores, el cuidado con el costo y la calidad de cada ruta y cómo probar que el cambio ocurre sin que el cliente lo perciba.',
  sections: [
    {
      title: 'Por qué retry en el mismo proveedor no es fallback',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Retry y fallback resuelven problemas diferentes y se confunden con frecuencia. Retry es insistir en la misma puerta: la llamada falló por un hipo transitorio, esperás un poco y probás de nuevo en el mismo proveedor. Funciona para un error puntual, un paquete perdido, una instancia que se reinició. Fallback es cambiar de puerta: el proveedor primario no está respondiendo de forma consistente, así que mandás la misma petición a otro proveedor. Cuando el primario está en un incidente amplio, retry solo pega en la misma pared más veces, suma latencia al pedido y hasta puede empeorar, porque cada retry es más carga sobre un servicio que ya está sufriendo. La señal de que necesitás fallback y no más retry es que la falla persista después de algunos intentos: ahí el problema no es transitorio, es el proveedor, y la solución es otro proveedor.',
        },
        {
          type: 'paragraph',
          value:
            'El error clásico es tratar retry y fallback como lo mismo y apilar retries agresivos esperando que el noveno intento salga bien. En un incidente del proveedor, eso transforma una falla rápida en una espera larga: el cliente se queda mirando el "escribiendo..." por decenas de segundos hasta que el sistema se rinde, cuando podría haber recibido la respuesta del proveedor secundario en un segundo. El orden correcto es retry corto y limitado en el proveedor actual para absorber el hipo transitorio, y fallback a otro proveedor apenas queda claro que no es un hipo, es una caída. Uno sin el otro deja un hueco: solo retry no sobrevive a la caída del proveedor, solo fallback cambia de ruta por cualquier hipo tonto que el retry resolvería más barato.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Retry (mismo proveedor)', 'Fallback (otro proveedor)'],
          rows: [
            [
              'Resuelve',
              'Hipo transitorio, error puntual',
              'Caída o degradación persistente del proveedor',
            ],
            [
              'Acción',
              'Espera y repite en la misma puerta',
              'Manda la misma petición a otra puerta',
            ],
            [
              'Costo del error',
              'Bajo si limitado, alto si agresivo',
              'Cambio de ruta, exige normalizar prompt y respuesta',
            ],
            [
              'Riesgo',
              'Insistir en un proveedor que ya se cayó',
              'Tirar al secundario si recibe toda la carga',
            ],
          ],
        },
      ],
    },
    {
      title: 'Qué errores disparan el fallback y cuáles no',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No toda falla justifica cambiar de proveedor. La pregunta que separa es: ¿la culpa es del pedido o del proveedor? Si el prompt es inválido, excede el límite de contexto, viola la política de contenido o usa parámetros equivocados, el segundo proveedor lo va a rechazar exactamente igual, porque el problema viajó junto con la petición. Cambiar de ruta acá solo gasta dos llamadas para recibir el mismo error. En cambio, si la falla es del proveedor, indisponibilidad, timeout, error interno, sobrecarga, el segundo proveedor no carga ese problema y tiene chance real de responder. El fallback debe dispararse solo en la segunda categoría, y el rate limit queda en el medio: es del proveedor, pero cambiar por cambiar puede empujar la carga a un secundario que también va a reventar, así que pide un cuidado extra que tratan los próximos bloques.',
        },
        {
          type: 'list',
          items: [
            'Dispara fallback: proveedor indisponible (5xx), timeout de conexión o de respuesta, error interno del proveedor, sobrecarga temporal. La causa está del lado del proveedor y no viaja con la petición.',
            'Dispara fallback con cuidado: rate limit (429). Es del proveedor, pero cambiar sin control puede saturar al secundario; respetá el Retry-After del primario y considerá si el secundario aguanta la carga desviada.',
            'No dispara fallback: prompt inválido, contexto excedido, violación de política de contenido, autenticación equivocada, parámetro no soportado. La culpa es del pedido, el segundo proveedor rechaza igual.',
            'Caso ambiguo: la respuesta vino, pero malformada o vacía. Antes de cambiar de proveedor, probá una vez en el mismo; si persiste, puede ser degradación del primario y ahí el fallback ayuda.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Clasificar el error correcto es lo que impide que el fallback se vuelva desperdicio o enmascare un bug. Si cambiás de proveedor ante un prompt malformado, el sistema hace dos llamadas caras, recibe dos errores y encima te esconde que el prompt está mal, porque el log solo muestra "probó los dos proveedores y falló". La clasificación explícita, culpa del pedido versus culpa del proveedor, es la frontera que decide entre corregir el origen y cambiar de ruta. Sin ella, el fallback se traga errores que necesitabas ver.',
        },
      ],
    },
    {
      title: 'El router: primario, secundario y la misma petición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corazón del fallback es un router que está al frente de los proveedores. Recibe la petición de tu sistema una vez, elige el proveedor primario, y ante una falla que clasifica como culpa del proveedor, prueba el siguiente de la lista con la misma petición normalizada. El punto crítico es que la petición tiene que ser la misma en significado, aunque la forma cambie entre APIs: el mismo prompt, las mismas instrucciones, el mismo comportamiento esperado. Si el router manda un prompt al primario y un prompt diferente al secundario, el fallback deja de ser una ruta alternativa y se vuelve un comportamiento impredecible, en el que la respuesta que el cliente recibe depende de qué proveedor estaba de pie.',
        },
        {
          type: 'code',
          value: `// llm/router.js
// Router de fallback: prueba los proveedores en orden con la MISMA peticion.
// Solo cambia de proveedor cuando el error es culpa del proveedor, no del pedido.

export async function callWithFallback(request, providers, { isProviderFault }) {
  let lastError;

  for (const provider of providers) {
    // Circuit breaker: saltea el proveedor marcado como fuera.
    if (provider.isOpen()) continue;

    try {
      // La misma peticion normalizada va a cada proveedor de la lista.
      // Lo que cambia es solo la traduccion al formato de cada API, no el contenido.
      const response = await provider.call(request);
      provider.recordSuccess();
      // Devuelve QUE proveedor respondio: esencial para log, costo y metrica.
      return { response, provider: provider.name };
    } catch (err) {
      lastError = err;

      // Culpa del pedido (prompt invalido, contexto excedido): cambiar no ayuda,
      // el proximo proveedor rechaza igual. Falla rapido en vez de gastar llamadas.
      if (!isProviderFault(err)) throw err;

      // Culpa del proveedor: marca la falla y deja que el loop pruebe el proximo.
      provider.recordFailure();
    }
  }

  // Todos los proveedores de la lista fallaron por culpa de ellos: sin ruta de salida.
  throw new AllProvidersFailedError('ningun proveedor respondio', lastError);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en lo que el router devuelve: no solo la respuesta, sino qué proveedor respondió. Esto no es un detalle. Sin saber qué ruta atendió cada petición, no podés medir con qué frecuencia el fallback se dispara, cuánto está costando el proveedor secundario, ni si la calidad de la respuesta cambia cuando la ruta cambia. El proveedor que respondió es la información que transforma el fallback de una caja negra que "a veces funciona" en un mecanismo observable, con métrica de cuántas peticiones absorbió cada proveedor y alerta cuando el primario pasa a fallar demasiado.',
        },
      ],
    },
    {
      title: 'Circuit breaker: no insistir en el proveedor que ya se cayó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si el proveedor primario está en un incidente, probar cada petición en él antes de caer al secundario agrega la latencia de la falla a toda llamada. Mil clientes esperan el timeout del primario mil veces antes de que el router se rinda y vaya al secundario. El circuit breaker resuelve esto: después de un número de fallas seguidas de un proveedor, el router abre el circuito de ese proveedor y deja de probarlo por un tiempo, mandando las peticiones directo al siguiente de la lista. Pasado el intervalo, deja pasar una petición de prueba; si vuelve, cierra el circuito y retoma el proveedor; si falla de nuevo, lo mantiene abierto. Es lo que evita que la caída de un proveedor contamine la latencia de todas las peticiones que todavía intentan pegarle.',
        },
        {
          type: 'diagram',
          value: `Fallback con circuit breaker por proveedor

  peticion
     |
     v
  [ primario ]  circuito CERRADO -> prueba
     |                                  \\
     | exito                             \\ N fallas seguidas
     v                                    v
  responde                          circuito ABIERTO
  (proveedor: primario)             (saltea el primario por un tiempo)
                                          |
                                          v
                                    [ secundario ]  -> prueba
                                          |
                                          | exito
                                          v
                                    responde
                                    (proveedor: secundario)

  pasado el intervalo: 1 peticion de prueba en el primario
    vuelve -> circuito CIERRA, retoma el primario
    falla  -> circuito sigue ABIERTO

  error culpa-del-pedido: NO abre circuito, NO hace fallback -> falla rapido`,
        },
        {
          type: 'paragraph',
          value:
            'El circuit breaker tiene que ser por proveedor, no global, porque la razón de existir del fallback es que los proveedores fallan de forma independiente. Un breaker único que abre para todos tira justamente la redundancia que armaste. Y el breaker solo debe contar las fallas de culpa del proveedor: un prompt inválido no es señal de que el proveedor se cayó, así que no puede abrir el circuito. Mezclar las dos cuentas hace que el breaker abra por errores de tu propio sistema, sacando de operación a un proveedor que estaba sano. La separación entre culpa del pedido y culpa del proveedor, que decide el fallback, también es la que alimenta el breaker.',
        },
      ],
    },
    {
      title: 'Normalización: la misma respuesta de APIs diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los proveedores de LLM no tienen la misma API. Cambian el formato de la petición, el nombre de los parámetros, la forma de pasar instrucciones de sistema, la estructura de la respuesta, los nombres de los modelos y la manera de hacer tool use. Si tu sistema habla directo el dialecto de un proveedor, cambiar de ruta en el fallback obliga a reescribir la petición al vuelo, y la respuesta que vuelve tiene un formato diferente que el resto del código no sabe leer. La salida es una capa de normalización: tu sistema habla un formato interno único, y cada proveedor tiene un adaptador que traduce ese formato al dialecto del proveedor en la ida y traduce la respuesta de vuelta al formato interno en la vuelta. Así el router cambia de proveedor sin que el resto del código perciba que la ruta cambió.',
        },
        {
          type: 'paragraph',
          value:
            'La normalización tiene un límite honesto: no todo se traduce uno a uno. Un proveedor puede tener un recurso que el otro no tiene, un formato de tool use diferente, un comportamiento de rechazo distinto. El adaptador necesita mapear lo que se puede y tener una degradación clara para lo que no se puede, y el fallback solo debe incluir en la lista proveedores capaces de atender la misma petición en términos prácticos. Poner como secundario un proveedor que no soporta el tool use que tu aplicación exige no es redundancia, es una ruta que va a fallar de otra forma en el momento del incidente. La regla es que los proveedores de la lista de fallback tienen que ser intercambiables para el caso de uso, no idénticos en todo.',
        },
        {
          type: 'table',
          columns: ['Qué cambia entre proveedores', 'Sin normalización', 'Con capa de adaptador'],
          rows: [
            [
              'Formato de la petición',
              'Reescribir la llamada en cada ruta',
              'Formato interno único, adaptador traduce en la ida',
            ],
            [
              'Estructura de la respuesta',
              'Código aguas abajo se rompe al cambiar de ruta',
              'Adaptador traduce de vuelta al formato interno',
            ],
            [
              'Nombres de modelo',
              'El modelo del primario no existe en el secundario',
              'Mapa de modelo equivalente por proveedor',
            ],
            [
              'Tool use y recursos',
              'El secundario no soporta lo que el primario hacía',
              'Solo entran proveedores intercambiables en la lista',
            ],
          ],
        },
      ],
    },
    {
      title: 'Costo, calidad y el cuidado con el rate limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La ruta de fallback no es gratis ni neutra. El proveedor secundario puede costar más por token, puede tener latencia diferente y puede dar respuestas de calidad diferente para el mismo prompt, porque es otro modelo. Eso tiene dos consecuencias prácticas. La primera es de costo: si el fallback se dispara con frecuencia, estás gastando en la ruta cara sin darte cuenta, y la métrica de qué proveedor respondió es lo que lo revela. La segunda es de calidad: un prompt calibrado para el modelo primario puede comportarse diferente en el secundario, así que el fallback que salva la disponibilidad puede degradar la respuesta. El secundario existe para mantener la atención de pie durante el incidente, no necesariamente para dar la mejor respuesta posible, y esa es una decisión consciente, no un accidente.',
        },
        {
          type: 'paragraph',
          value:
            'El rate limit merece un párrafo propio porque es el error que más engaña. Es culpa del proveedor, así que intenta calificar para el fallback, pero cambiar ciegamente ante un 429 tiene un riesgo específico: si el primario está con rate limit por un pico de tráfico tuyo, desviar todo ese tráfico al secundario probablemente va a reventar el rate limit del secundario también, y ahora los dos están fuera. El fallback por rate limit necesita respetar el Retry-After que el primario informa, y el patrón más seguro combina retry con backoff en el primario y fallback solo cuando el secundario tiene holgura para absorber la carga. Cambiar de proveedor no crea capacidad de la nada; si la demanda excede a los dos, el fallback solo esparce la fila.',
        },
        {
          type: 'ordered',
          items: [
            'Clasificá el error antes de actuar: culpa del pedido falla rápido, culpa del proveedor prueba el fallback, rate limit respeta el Retry-After.',
            'Mantené retry corto y limitado en el proveedor actual para el hipo transitorio, y reservá el fallback para la falla persistente.',
            'Usá circuit breaker por proveedor, contando solo las fallas de culpa del proveedor, para no agregar la latencia de la caída a cada petición.',
            'Normalizá entrada y salida con adaptadores, y solo incluí en la lista de fallback proveedores intercambiables para el caso de uso.',
            'Devolvé y registrá qué proveedor respondió; medí la tasa de fallback, el costo por ruta y la calidad de la respuesta secundaria.',
          ],
        },
      ],
    },
    {
      title: 'Probar que el cambio ocurre sin que el cliente lo perciba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El fallback es código que solo ejecuta cuando algo sale mal, así que es el tipo de mecanismo que pasa desapercibido hasta el incidente real, cuando descubrís que nunca funcionó. La única forma de confiar en él es forzar la falla en un test. Simulás el proveedor primario devolviendo 5xx, timeout y 429, y verificás que el router cae al secundario y devuelve una respuesta válida con el proveedor secundario registrado. Simulás un prompt inválido y verificás que el router no hace fallback, falla rápido y no gasta la segunda llamada. Simulás fallas seguidas y verificás que el circuit breaker abre y deja de probar el primario. Cada camino del fallback necesita un test que lo ejercite a propósito, porque en producción se queda quieto hasta el día en que necesita salvar la atención.',
        },
        {
          type: 'code',
          value: `// llm/router.test.js
// Prueba los caminos del fallback forzando cada falla a proposito.

test('cae al secundario cuando el primario retorna 5xx', async () => {
  const primario = fakeProvider({ name: 'primario', fail: 'server_error' });
  const secundario = fakeProvider({ name: 'secundario', ok: true });

  const { response, provider } = await callWithFallback(
    request,
    [primario, secundario],
    { isProviderFault },
  );

  // El cambio tiene que ser invisible para quien llamo: respuesta valida...
  expect(response).toBeValid();
  // ...pero el log tiene que revelar que fue el secundario el que atendio.
  expect(provider).toBe('secundario');
});

test('NO hace fallback con prompt invalido: falla rapido', async () => {
  const primario = fakeProvider({ name: 'primario', fail: 'invalid_prompt' });
  const secundario = fakeProvider({ name: 'secundario', ok: true });

  // Culpa del pedido: el router no gasta la segunda llamada, propaga el error.
  await expect(
    callWithFallback(request, [primario, secundario], { isProviderFault }),
  ).rejects.toThrow('invalid_prompt');
  expect(secundario.callCount).toBe(0);
});`,
        },
        {
          type: 'paragraph',
          value:
            'El test del camino negativo, el de que el fallback no se dispara por culpa del pedido, es tan importante como el positivo. Es el que garantiza que el mecanismo de rescate no se vuelva un encubridor de bug, gastando dos llamadas y escondiendo del log que el prompt estaba mal. Un fallback bien probado es aquel en el que tenés confianza tanto de que el cambio ocurre cuando el proveedor se cae, como de que no ocurre cuando el error es tuyo. Los dos lados juntos son lo que hace que la caída de un proveedor se vuelva una línea en el log en vez de una caída en la atención.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es la diferencia entre retry y fallback entre proveedores de LLM?',
      answer:
        'Retry es insistir en el mismo proveedor: la llamada falló por un hipo transitorio, esperás un poco y repetís en la misma puerta. Sirve para un error puntual y no sobrevive a la caída del proveedor, porque insistir en un servicio fuera solo pega en la misma pared. Fallback es cambiar de proveedor: ante una falla persistente que es culpa del proveedor, mandás la misma petición a otro proveedor de LLM, que no carga ese incidente. Los dos se complementan: retry corto y limitado absorbe barato el hipo transitorio, y el fallback asume cuando queda claro que no es un hipo, es una caída. Solo retry deja que la atención se caiga junto con el proveedor; solo fallback cambia de ruta por cualquier error tonto que el retry resolvería más barato.',
    },
    {
      question: '¿Todo error del proveedor debe disparar el fallback?',
      answer:
        'No. La pregunta que separa es de quién es la culpa. Los errores de culpa del proveedor, indisponibilidad, timeout, error interno, sobrecarga, disparan el fallback, porque el segundo proveedor no carga ese problema y tiene chance real de responder. Los errores de culpa del pedido, prompt inválido, contexto excedido, violación de política, autenticación equivocada, no deben disparar, porque el problema viajó con la petición y el segundo proveedor la va a rechazar exactamente igual: cambiar solo gasta dos llamadas para recibir el mismo error y encima esconde del log que el origen estaba mal. El rate limit queda en el medio: es del proveedor, pero cambiar sin control puede saturar al secundario, así que pide respetar el Retry-After y chequear si el secundario tiene holgura antes de desviar la carga.',
    },
    {
      question: '¿El proveedor secundario da la misma respuesta que el primario?',
      answer:
        'No siempre, y esa es una decisión consciente. El secundario suele ser otro modelo, con costo por token, latencia y comportamiento diferentes, así que un prompt calibrado para el primario puede comportarse de otra forma en el secundario. Una capa de normalización, con adaptadores que traducen la petición y la respuesta entre el formato interno y el dialecto de cada API, mantiene al resto del código sin percibir el cambio de ruta, pero no iguala la calidad de las respuestas, solo el formato. Por eso el fallback existe para mantener la atención de pie durante el incidente, no necesariamente para dar la mejor respuesta posible, y solo deben entrar en la lista proveedores intercambiables para el caso de uso, capaces de atender la misma petición en términos prácticos, incluyendo tool use y límites de contexto.',
    },
  ],
  conclusion: {
    title: 'El fallback transforma la caída de un proveedor en un cambio invisible de ruta',
    description:
      'La disponibilidad de tu atención con IA no puede depender de un único proveedor que no controlás. Clasificar la falla entre culpa del pedido y culpa del proveedor, caer a un secundario con la misma petición normalizada, proteger cada ruta con circuit breaker y respetar el rate limit transforma la caída de un proveedor en una línea en el log en vez de una caída en la atención. Puedo diseñar esa capa de fallback en tu sistema de IA, eligiendo los proveedores intercambiables, calibrando los disparadores de cambio y midiendo el costo y la calidad de cada ruta, para que un incidente del proveedor no se vuelva un incidente de tu negocio.',
    cta: 'Hablar sobre fallback de proveedores en mi sistema de IA',
  },
  related: [
    { label: 'Ruteo de modelos: el modelo correcto para cada tarea', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Rate limit y cola de prioridad para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Observabilidad y Confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'llm-provider-fallback-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
