// Conteudo do artigo: aquecimento de cache de prompt, pagando o prefixo uma
// vez e reaproveitando entre chamadas sem invalidar o cache por descuido.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cache de prompt é a otimização com melhor relação entre esforço e retorno em sistemas com LLM, e é também a que mais gente liga errado. A promessa é simples: o prefixo estável da sua chamada, aquele bloco de instruções, esquema de ferramentas e contexto fixo que se repete em toda requisição, é processado uma vez e reaproveitado nas seguintes por uma fração do preço e com uma fração da latência. O que a promessa não diz é que o cache é posicional e frágil: ele casa por prefixo exato, do primeiro token até o ponto marcado, e qualquer coisa que mude no começo, um carimbo de data e hora, um contador de tokens do usuário, uma lista de ferramentas ordenada por um objeto sem ordem garantida, invalida tudo que vem depois. O resultado típico é uma taxa de acerto de trinta por cento que ninguém percebe, porque a fatura continua caindo o suficiente para parecer que funcionou. Este artigo trata o cache como o que ele é: uma decisão de ordenação do prompt, com custo de escrita, tempo de vida e um problema de aquecimento que só aparece quando o tráfego é irregular.',
  sections: [
    {
      title: 'O cache é um prefixo, não um conjunto de blocos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro conceitual mais caro é imaginar o cache como um dicionário que guarda pedaços do prompt e os reconhece onde quer que apareçam. Não é isso. O que fica em cache é o estado interno do modelo depois de processar uma sequência de tokens desde a posição zero. Isso significa que o acerto é sempre um prefixo contínuo: se os primeiros oito mil tokens são idênticos aos da chamada anterior e o token oito mil e um difere, você aproveita oito mil e paga integralmente por todo o resto. E significa também que colocar o bloco estável depois de um bloco variável não serve para nada, mesmo que aquele bloco estável tenha vinte mil tokens e nunca mude, porque a variação anterior já quebrou a cadeia.',
        },
        {
          type: 'paragraph',
          value:
            'Daí sai a única regra de ordenação que importa, e ela vale para qualquer provedor: ordene o prompt por frequência de mudança, do mais estável para o mais volátil. Instruções do sistema e definição de ferramentas primeiro, porque mudam em deploy. Contexto de domínio compartilhado depois, porque muda em dias. Dados do cliente em seguida, porque mudam por conversa. Histórico de mensagens e a pergunta do turno atual por último, porque mudam a cada requisição. Essa ordem não é estética, ela é literalmente a diferença entre pagar o prefixo uma vez por dia e pagar a cada chamada.',
        },
        {
          type: 'diagram',
          value: `Ordem que aproveita o cache          Ordem que destrói o cache

[ instrucoes do sistema  ] estavel   [ timestamp da chamada   ] muda sempre
[ definicao de tools     ] estavel   [ instrucoes do sistema  ] estavel
[ contexto de dominio    ] dias      [ definicao de tools     ] estavel
[ perfil do cliente      ] conversa  [ contexto de dominio    ] dias
--------- ponto de cache ---------   [ perfil do cliente      ] conversa
[ historico de mensagens ] turno     [ historico de mensagens ] turno
[ pergunta do turno      ] turno     [ pergunta do turno      ] turno

acerto: tudo antes do marcador       acerto: zero
                                     (o primeiro token ja difere)`,
        },
        {
          type: 'paragraph',
          value:
            'Vale notar a assimetria de preço que torna essa decisão interessante. Escrever no cache custa mais do que processar o token normalmente, tipicamente algo em torno de vinte e cinco por cento a mais. Ler do cache custa uma fração pequena do preço normal, na ordem de um décimo. Isso quer dizer que o cache não é gratuito: um prefixo escrito e nunca reaproveitado é prejuízo direto. O ponto de equilíbrio aparece por volta da segunda leitura, e é por isso que a pergunta operacional não é "vale a pena cachear?", é "quantas leituras eu consigo antes de o prefixo expirar?".',
        },
      ],
    },
    {
      title: 'O que invalida o cache sem ninguém perceber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A taxa de acerto baixa quase nunca vem de uma decisão consciente. Ela vem de detalhes de serialização que ninguém revisou porque parecem inertes. O caso mais comum e mais irritante é a data no prompt do sistema: alguém escreveu "Hoje é 8 de agosto de 2026" para o modelo saber a data atual, e se esse texto for gerado com hora e minuto, o prefixo muda a cada requisição e o cache nunca acerta. O mesmo vale para um identificador de requisição injetado no cabeçalho do prompt, para um contador de mensagens da conversa colocado antes das instruções, e para qualquer coisa que envolva geração aleatória.',
        },
        {
          type: 'table',
          columns: ['Fonte da invalidação', 'Por que passa despercebida', 'Correção'],
          rows: [
            [
              'Data e hora completa no prompt do sistema',
              'Parece um dado estático, mas muda a cada segundo',
              'Truncar para o dia, ou mover a data para o fim do prompt',
            ],
            [
              'Ferramentas serializadas a partir de um objeto',
              'A ordem das chaves parece estável até um deploy mudá-la',
              'Ordenar as ferramentas explicitamente por nome antes de serializar',
            ],
            [
              'JSON com indentação variável ou chaves fora de ordem',
              'O conteúdo é igual, mas a sequência de tokens não é',
              'Serializar de forma canônica: chaves ordenadas, espaçamento fixo',
            ],
            [
              'Identificador de requisição ou de sessão no início',
              'Foi colocado para rastreio e ninguém pensou no cache',
              'Manter fora do prompt, no metadado da chamada',
            ],
            [
              'Nome do usuário ou saudação personalizada no topo',
              'Torna o prefixo único por pessoa, matando o compartilhamento',
              'Mover o bloco personalizado para depois do ponto de cache',
            ],
            [
              'Rotação de modelo entre chamadas',
              'O cache é por modelo, e o roteador troca sem avisar',
              'Contabilizar o cache por modelo e evitar rotação no caminho quente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A defesa contra isso não é revisão de código, é um teste. O prefixo estável precisa ter uma verificação automatizada que monta o prompt duas vezes, em momentos diferentes, com entradas diferentes, e compara o hash da parte que deveria ser idêntica. Se o hash diverge, o teste falha e alguém descobre no pull request em vez de descobrir na fatura três semanas depois.',
        },
        {
          type: 'code',
          value: `// Montagem do prompt com prefixo estável verificável.
// A ordenação canônica das ferramentas e a ausência de qualquer valor
// derivado do relógio são o que garante o acerto entre chamadas.

const serializarFerramentas = (ferramentas) =>
  [...ferramentas]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => JSON.stringify(f, Object.keys(f).sort()))
    .join('\\n');

// Tudo que entra aqui muda no máximo em deploy ou em janela de horas.
// Nada de relógio, identificador de requisição ou dado do cliente.
export const montarPrefixoEstavel = ({ instrucoes, ferramentas, glossario }) =>
  [
    instrucoes.trim(),
    '## Ferramentas disponíveis',
    serializarFerramentas(ferramentas),
    '## Glossário do domínio',
    glossario.trim(),
  ].join('\\n\\n');

export const montarChamada = ({ prefixoEstavel, perfilCliente, historico, pergunta }) => ({
  system: [
    // O bloco marcado é o que o provedor guarda; ele precisa ser byte a byte
    // igual ao da chamada anterior para haver acerto.
    { type: 'text', text: prefixoEstavel, cache_control: { type: 'ephemeral' } },
    // Depois do marcador entra tudo que varia por conversa e por turno.
    { type: 'text', text: perfilCliente },
  ],
  messages: [...historico, { role: 'user', content: pergunta }],
});`,
        },
        {
          type: 'code',
          value: `// Teste que trava a estabilidade do prefixo. Falha no pull request
// quando alguém injeta relógio, aleatoriedade ou ordem não determinística.

import { createHash } from 'node:crypto';
import { montarPrefixoEstavel } from './prompt.js';

const hash = (texto) => createHash('sha256').update(texto).digest('hex');

test('o prefixo estável não muda entre montagens', () => {
  const entrada = {
    instrucoes: INSTRUCOES,
    // Mesma coleção em ordens diferentes: a serialização canônica
    // precisa produzir exatamente a mesma sequência de tokens.
    ferramentas: [...FERRAMENTAS].reverse(),
    glossario: GLOSSARIO,
  };

  const primeiro = hash(montarPrefixoEstavel({ ...entrada, ferramentas: FERRAMENTAS }));
  const segundo = hash(montarPrefixoEstavel(entrada));

  expect(segundo).toBe(primeiro);
});

test('o prefixo estável não contém marcas de tempo', () => {
  const prefixo = montarPrefixoEstavel({
    instrucoes: INSTRUCOES,
    ferramentas: FERRAMENTAS,
    glossario: GLOSSARIO,
  });

  expect(prefixo).not.toMatch(/\\d{2}:\\d{2}:\\d{2}/);
  expect(prefixo).not.toMatch(/\\d{4}-\\d{2}-\\d{2}T/);
});`,
        },
      ],
    },
    {
      title: 'O problema do aquecimento: tempo de vida contra ritmo do tráfego',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aqui está a parte que dá nome ao artigo e que a maioria das implementações ignora. O prefixo em cache tem tempo de vida curto, tipicamente alguns minutos a partir do último acesso, com opções de vida estendida a um custo de escrita maior. Cada leitura renova o relógio. Isso cria uma dinâmica que depende inteiramente do ritmo do seu tráfego, e não do tamanho do seu prompt: se as chamadas chegam com intervalo menor que o tempo de vida, o prefixo se mantém vivo sozinho e você paga a escrita uma única vez; se o intervalo entre chamadas é maior, cada requisição paga a escrita de novo e você está gastando mais do que gastaria sem cache nenhum.',
        },
        {
          type: 'table',
          columns: ['Perfil de tráfego', 'O que acontece com o prefixo', 'Decisão'],
          rows: [
            [
              'Constante, várias chamadas por minuto',
              'Sempre vivo, renovado pelo próprio tráfego',
              'Não faça nada: o cache se sustenta sozinho',
            ],
            [
              'Rajadas curtas com longos vales',
              'Morre no vale e é reescrito a cada rajada',
              'Aquecer antes da rajada quando ela é previsível',
            ],
            [
              'Comercial diurno, silêncio noturno',
              'Morre toda noite e a primeira chamada do dia é lenta e cara',
              'Aquecer uma vez antes do pico de abertura',
            ],
            [
              'Esparso e imprevisível',
              'Quase sempre frio, escrita raramente amortizada',
              'Manter aquecido custa mais que o benefício: desligue o cache',
            ],
            [
              'Lote noturno de processamento',
              'Vive durante o lote inteiro se a concorrência for controlada',
              'Aquecer uma vez e disparar o lote em seguida',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A conclusão prática é desconfortável para quem gosta de solução geral: manter um prefixo quente com um ping periódico só compensa quando o volume que se beneficia dele é grande o suficiente para pagar as escritas do aquecimento. Um ping a cada quatro minutos, o dia inteiro, são algumas centenas de escritas de prefixo por dia. Se o seu volume de leitura é de dezenas de milhares de chamadas, isso é irrelevante e o aquecimento se paga muitas vezes. Se o seu volume é de algumas centenas de chamadas por dia, o aquecimento custa quase tanto quanto o que ele economiza, e a decisão correta é aquecer apenas antes dos picos conhecidos, ou não aquecer.',
        },
        {
          type: 'code',
          value: `// Aquecedor de prefixo. Roda como job periódico e dispara a chamada
// mais barata possível que ainda escreve o prefixo no cache do provedor.

const INTERVALO_MS = 4 * 60 * 1000; // abaixo do TTL nominal, com margem

// A chamada de aquecimento pede o mínimo de saída: o objetivo é escrever
// o prefixo, não obter resposta. Tokens de saída são o item caro.
const aquecer = async (cliente, prefixoEstavel) => {
  const inicio = process.hrtime.bigint();

  const resposta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 1,
    system: [{ type: 'text', text: prefixoEstavel, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'ok' }],
  });

  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  const { cache_creation_input_tokens: escritos, cache_read_input_tokens: lidos } = resposta.usage;

  // Se o aquecimento escreveu em vez de ler, o prefixo tinha morrido:
  // é o sinal de que o intervalo está acima do TTL real do provedor.
  return { escritos, lidos, ms, expirou: escritos > 0 };
};

export const iniciarAquecimento = (cliente, prefixoEstavel, metricas) => {
  const timer = setInterval(async () => {
    try {
      const r = await aquecer(cliente, prefixoEstavel);
      metricas.registrar('cache.aquecimento', r);
    } catch (erro) {
      // Falha no aquecimento nunca pode derrubar o processo: o pior caso
      // é o prefixo esfriar e a próxima chamada real pagar a escrita.
      metricas.registrar('cache.aquecimento.erro', { mensagem: erro.message });
    }
  }, INTERVALO_MS);

  timer.unref();
  return () => clearInterval(timer);
};`,
        },
        {
          type: 'paragraph',
          value:
            'Duas escolhas desse código merecem justificativa. A primeira é o limite de um token na saída: a escrita do prefixo acontece do lado da entrada, então gerar resposta é desperdício puro. A segunda é usar o próprio retorno de uso para descobrir se o prefixo expirou. Quando o aquecimento reporta escrita em vez de leitura, o intervalo escolhido está acima do tempo de vida real, e esse número é um dado observado no seu provedor, na sua região, e não uma constante de documentação para copiar.',
        },
      ],
    },
    {
      title: 'Quando o prefixo é grande demais para caber numa versão só',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sistemas maduros raramente têm um prefixo. Têm um por vertical de atendimento, um por idioma, um por variante de experimento, um por versão do prompt em rollout. Cada combinação é um prefixo distinto no cache, com sua própria escrita e seu próprio tempo de vida. Um sistema com quatro verticais, três idiomas e duas variantes de flag tem vinte e quatro prefixos concorrendo por aquecimento, e a taxa de acerto agregada despenca sem que nenhuma linha de código pareça errada.',
        },
        {
          type: 'ordered',
          items: [
            'Conte quantos prefixos distintos o seu sistema realmente emite hoje, multiplicando as dimensões que variam: vertical, idioma, variante de flag, versão do prompt e modelo.',
            'Meça o volume de chamadas por prefixo, não no agregado, porque a decisão de aquecer é sempre por prefixo.',
            'Corte o que não se paga: prefixos abaixo do volume de equilíbrio devem sair do cache, não entrar na rotina de aquecimento.',
            'Fatore o que é comum a todos eles para um bloco compartilhado no topo, deixando a parte específica depois do primeiro marcador.',
            'Durante um rollout de prompt, aceite conscientemente que existem dois prefixos quentes ao mesmo tempo, e encerre a versão antiga em vez de deixá-la viva indefinidamente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A fatoração do item quatro é o que mais rende e o que menos gente faz. Se as instruções de tom, as regras de segurança e o glossário geral da empresa são os mesmos em todas as verticais, esse bloco pode ser um prefixo compartilhado por todo o tráfego, aquecido uma vez e reaproveitado por todos. A parte específica da vertical vira um segundo trecho marcado depois dele. Provedores que suportam mais de um ponto de cache por chamada permitem exatamente esse encadeamento, e o ganho é grande porque o bloco compartilhado é o que tem o maior volume de leitura de todo o sistema.',
        },
        {
          type: 'diagram',
          value: `chamada de atendimento (vertical A, idioma pt, variante 1)

[ bloco comum a toda a empresa ] <- marcador 1: compartilhado por todos
[ contexto da vertical A       ] <- marcador 2: compartilhado pela vertical
[ variacao da flag 1           ]
[ perfil do cliente            ]
[ historico + pergunta         ]

chamada de atendimento (vertical B, idioma pt, variante 1)

[ bloco comum a toda a empresa ] <- ACERTO no marcador 1
[ contexto da vertical B       ] <- escrita propria da vertical B
[ variacao da flag 1           ]
[ perfil do cliente            ]
[ historico + pergunta         ]`,
        },
      ],
    },
    {
      title: 'Medir o acerto real, e não a economia aparente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A métrica que quase todo mundo usa para avaliar o cache é a queda no valor da fatura, e ela é enganosa por um motivo simples: a fatura também cai quando o volume cai, quando o histórico fica mais curto, quando alguém troca de modelo. Avaliar cache pela fatura mistura tudo. O dado que importa vem direto do retorno de uso de cada chamada, que separa tokens de entrada normais, tokens escritos no cache e tokens lidos do cache, e é com esses três números que se calcula a taxa de acerto de verdade.',
        },
        {
          type: 'list',
          items: [
            'Taxa de acerto por prefixo: tokens lidos do cache divididos pela soma de lidos, escritos e entrada normal. Agregar isso no sistema inteiro esconde o prefixo que nunca acerta.',
            'Razão entre escritas e leituras por prefixo: acima de um para dois, aquele prefixo está custando mais do que economiza e precisa sair do cache.',
            'Tempo até o primeiro token separado por acerto e por falha, porque o ganho de latência do cache é frequentemente maior que o ganho de custo e aparece direto na experiência do cliente.',
            'Contagem de prefixos distintos por dia, que é o indicador antecedente de fragmentação: quando esse número sobe sem que alguém tenha criado uma vertical nova, algo está injetando variação no prefixo.',
            'Custo de aquecimento por prefixo, comparado ao custo economizado por ele, porque essa razão é a única justificativa defensável para manter o job de ping rodando.',
          ],
        },
        {
          type: 'code',
          value: `// Contabilidade do cache a partir do retorno de uso da API.
// Um registro por chamada, agrupado pela identidade do prefixo.

export const registrarUso = (metricas, { prefixoId, modelo, usage, ttfbMs }) => {
  const entradaNormal = usage.input_tokens ?? 0;
  const escritos = usage.cache_creation_input_tokens ?? 0;
  const lidos = usage.cache_read_input_tokens ?? 0;
  const total = entradaNormal + escritos + lidos;

  metricas.registrar('llm.cache', {
    prefixoId,
    modelo,
    // A taxa por chamada, agregada depois por prefixo na janela desejada.
    taxaAcerto: total === 0 ? 0 : lidos / total,
    escritos,
    lidos,
    // Separar a latência por acerto é o que revela o ganho de experiência,
    // que costuma ser maior e mais visível que o ganho de custo.
    ttfbMs,
    acertou: lidos > 0,
  });
};

// Regra de decisão executável: um prefixo só permanece no cache enquanto
// as leituras amortizarem as escritas na janela observada.
export const deveManterNoCache = ({ escritos, lidos }, fatorEscrita = 1.25, fatorLeitura = 0.1) => {
  const custoComCache = escritos * fatorEscrita + lidos * fatorLeitura;
  const custoSemCache = escritos + lidos;
  return custoComCache < custoSemCache;
};`,
        },
        {
          type: 'paragraph',
          value:
            'O último trecho é a versão executável da decisão que costuma ficar implícita numa planilha. Os fatores são os multiplicadores de preço de escrita e de leitura em relação ao token de entrada normal, e valem os do seu provedor, consultados no momento em que você escreve isso. Rodar essa comparação por prefixo, uma vez por semana, é o que impede o cache de virar aquela otimização que todo mundo acha que está ativa e que ninguém consegue provar que ainda compensa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que a minha taxa de acerto do cache é baixa se o meu prompt quase não muda?',
      answer:
        'Porque o cache casa por prefixo exato de tokens desde a posição zero, e não por semelhança de conteúdo. Basta um token diferente no começo para tudo depois dele ser cobrado integralmente. As causas mais comuns são invisíveis numa revisão rápida: uma data com hora e minuto no prompt do sistema, um identificador de requisição colocado no cabeçalho para rastreio, ferramentas serializadas a partir de um objeto cuja ordem de chaves mudou num deploy, JSON com indentação ou ordenação inconsistente, e nome do cliente numa saudação no topo, que torna o prefixo único por pessoa. A verificação que resolve isso é um teste que monta o prefixo duas vezes com entradas diferentes e compara o hash: se divergir, o pull request falha antes de a fatura contar a história.',
    },
    {
      question: 'Vale a pena manter um job de ping para o prefixo nunca esfriar?',
      answer:
        'Depende inteiramente do volume que se beneficia do prefixo, e a conta é direta. Um ping a cada quatro minutos gera algumas centenas de escritas de prefixo por dia. Se o tráfego real é de dezenas de milhares de chamadas contra aquele mesmo prefixo, o aquecimento é ruído no custo e se paga muitas vezes em latência e em preço. Se o tráfego é de algumas centenas de chamadas por dia, o aquecimento custa quase tanto quanto economiza e não se justifica: nesse caso, aqueça apenas antes de picos previsíveis, como a abertura do horário comercial ou o início de um lote noturno, ou simplesmente não use cache naquele prefixo. A decisão é sempre por prefixo, nunca no agregado do sistema.',
    },
    {
      question: 'Cache de prompt é a mesma coisa que cache semântico de respostas?',
      answer:
        'Não, e confundir os dois leva a decisões ruins. O cache de prompt é um mecanismo do provedor que guarda o estado interno do modelo para um prefixo de tokens e cobra mais barato pela releitura dele; a resposta continua sendo gerada do zero a cada chamada, então a saída pode variar e a informação nunca fica velha. O cache semântico é uma camada sua, antes do modelo, que devolve uma resposta já gerada quando a nova pergunta se parece o suficiente com outra anterior, o que economiza a chamada inteira mas traz risco de servir conteúdo desatualizado ou de casar perguntas parecidas com respostas diferentes. Eles são complementares: o cache de prompt reduz o custo das chamadas que acontecem, e o cache semântico reduz o número de chamadas que acontecem.',
    },
  ],
  conclusion: {
    title: 'Cache é ordenação de prompt, e aquecimento é decisão de tráfego',
    description:
      'O cache de prompt entrega o que promete, mas só para quem trata o prompt como uma sequência ordenada por frequência de mudança em vez de um punhado de blocos concatenados na ordem em que foram escritos. A diferença entre trinta e noventa por cento de acerto quase nunca está no provedor: está numa data com hora no topo, numa serialização não determinística das ferramentas e numa saudação personalizada antes do ponto de cache. E o aquecimento, que parece a parte sofisticada, é a mais simples de decidir quando você mede por prefixo: se o tráfego mantém o prefixo vivo sozinho, não faça nada; se ele morre em vales previsíveis, aqueça antes do pico; se ele quase nunca acerta, tire aquele prefixo do cache em vez de pagar escrita para ninguém ler.',
    cta: 'Quer saber quanto do seu custo de LLM é prefixo pago mais de uma vez? Posso revisar a montagem dos seus prompts e a contabilidade de uso por prefixo, e desenhar a política de cache e aquecimento que se sustenta no seu ritmo de tráfego real.',
  },
  related: [
    {
      label: 'Cache semântico: reduzir custo de LLM sem perder qualidade',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Compressão de contexto: caber mais na janela sem perder sinal',
      to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal',
    },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'Prompt caching is the best effort-to-return optimization in LLM systems, and it is also the one most people turn on incorrectly. The promise is simple: the stable prefix of your call, that block of instructions, tool schema and fixed context repeated on every request, is processed once and reused on the following ones for a fraction of the price and a fraction of the latency. What the promise does not say is that the cache is positional and fragile: it matches by exact prefix, from the first token up to the marked point, and anything that changes at the beginning, a timestamp, a user token counter, a tool list ordered from an object with no guaranteed ordering, invalidates everything after it. The typical outcome is a thirty percent hit rate nobody notices, because the bill still drops enough to look like it worked. This article treats the cache as what it is: a prompt ordering decision, with a write cost, a lifetime and a warming problem that only shows up when traffic is irregular.',
  sections: [
    {
      title: 'The cache is a prefix, not a set of blocks',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most expensive conceptual mistake is imagining the cache as a dictionary that stores pieces of the prompt and recognizes them wherever they appear. It is not. What gets cached is the internal state of the model after processing a token sequence from position zero. That means the hit is always a contiguous prefix: if the first eight thousand tokens are identical to the previous call and token eight thousand and one differs, you reuse eight thousand and pay in full for everything else. And it also means that placing the stable block after a variable block is worth nothing, even if that stable block has twenty thousand tokens and never changes, because the earlier variation already broke the chain.',
        },
        {
          type: 'paragraph',
          value:
            'From that comes the only ordering rule that matters, and it holds for any provider: order the prompt by frequency of change, from the most stable to the most volatile. System instructions and tool definitions first, because they change on deploy. Shared domain context next, because it changes in days. Customer data after that, because it changes per conversation. Message history and the current turn question last, because they change on every request. This ordering is not aesthetic, it is literally the difference between paying for the prefix once a day and paying for it on every call.',
        },
        {
          type: 'diagram',
          value: `Ordering that uses the cache            Ordering that destroys it

[ system instructions   ] stable       [ call timestamp        ] always
[ tool definitions      ] stable       [ system instructions   ] stable
[ domain context        ] days         [ tool definitions      ] stable
[ customer profile      ] conversation [ domain context        ] days
--------- cache point ---------        [ customer profile      ] conversation
[ message history       ] turn         [ message history       ] turn
[ current question      ] turn         [ current question      ] turn

hit: everything before the marker      hit: zero
                                       (the first token already differs)`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth noting the price asymmetry that makes this decision interesting. Writing to the cache costs more than processing the token normally, typically around twenty-five percent more. Reading from the cache costs a small fraction of the normal price, on the order of a tenth. That means the cache is not free: a prefix written and never reused is a straight loss. The break-even point shows up around the second read, and that is why the operational question is not "is caching worth it?", it is "how many reads can I get before the prefix expires?".',
        },
      ],
    },
    {
      title: 'What invalidates the cache without anyone noticing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A low hit rate almost never comes from a conscious decision. It comes from serialization details nobody reviewed because they look inert. The most common and most annoying case is the date in the system prompt: someone wrote "Today is August 8, 2026" so the model would know the current date, and if that text is generated with hours and minutes, the prefix changes on every request and the cache never hits. The same goes for a request identifier injected into the prompt header, a conversation message counter placed before the instructions, and anything involving random generation.',
        },
        {
          type: 'table',
          columns: ['Source of invalidation', 'Why it goes unnoticed', 'Fix'],
          rows: [
            [
              'Full date and time in the system prompt',
              'Looks like static data, but changes every second',
              'Truncate to the day, or move the date to the end of the prompt',
            ],
            [
              'Tools serialized from an object',
              'Key order looks stable until a deploy changes it',
              'Sort tools explicitly by name before serializing',
            ],
            [
              'JSON with variable indentation or unordered keys',
              'The content is the same, the token sequence is not',
              'Serialize canonically: sorted keys, fixed spacing',
            ],
            [
              'Request or session identifier at the top',
              'It was added for tracing and nobody thought about the cache',
              'Keep it out of the prompt, in the call metadata',
            ],
            [
              'User name or personalized greeting at the top',
              'Makes the prefix unique per person, killing any sharing',
              'Move the personalized block after the cache point',
            ],
            [
              'Model rotation between calls',
              'The cache is per model, and the router swaps without warning',
              'Account for the cache per model and avoid rotation on the hot path',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The defense against this is not code review, it is a test. The stable prefix needs an automated check that builds the prompt twice, at different moments, with different inputs, and compares the hash of the part that should be identical. If the hash diverges, the test fails and someone finds out in the pull request instead of finding out in the bill three weeks later.',
        },
        {
          type: 'code',
          value: `// Prompt assembly with a verifiable stable prefix.
// Canonical tool ordering and the absence of any clock-derived value
// are what guarantee a hit across calls.

const serializeTools = (tools) =>
  [...tools]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => JSON.stringify(t, Object.keys(t).sort()))
    .join('\\n');

// Everything here changes at most on deploy or on an hours-long window.
// No clock, no request identifier, no customer data.
export const buildStablePrefix = ({ instructions, tools, glossary }) =>
  [
    instructions.trim(),
    '## Available tools',
    serializeTools(tools),
    '## Domain glossary',
    glossary.trim(),
  ].join('\\n\\n');

export const buildCall = ({ stablePrefix, customerProfile, history, question }) => ({
  system: [
    // The marked block is what the provider stores; it has to be byte for byte
    // identical to the previous call for there to be a hit.
    { type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } },
    // After the marker comes everything that varies per conversation and turn.
    { type: 'text', text: customerProfile },
  ],
  messages: [...history, { role: 'user', content: question }],
});`,
        },
        {
          type: 'code',
          value: `// Test that locks prefix stability. Fails in the pull request
// when someone injects a clock, randomness or non-deterministic ordering.

import { createHash } from 'node:crypto';
import { buildStablePrefix } from './prompt.js';

const hash = (text) => createHash('sha256').update(text).digest('hex');

test('the stable prefix does not change between builds', () => {
  const input = {
    instructions: INSTRUCTIONS,
    // Same collection in a different order: canonical serialization
    // has to produce exactly the same token sequence.
    tools: [...TOOLS].reverse(),
    glossary: GLOSSARY,
  };

  const first = hash(buildStablePrefix({ ...input, tools: TOOLS }));
  const second = hash(buildStablePrefix(input));

  expect(second).toBe(first);
});

test('the stable prefix contains no time markers', () => {
  const prefix = buildStablePrefix({
    instructions: INSTRUCTIONS,
    tools: TOOLS,
    glossary: GLOSSARY,
  });

  expect(prefix).not.toMatch(/\\d{2}:\\d{2}:\\d{2}/);
  expect(prefix).not.toMatch(/\\d{4}-\\d{2}-\\d{2}T/);
});`,
        },
      ],
    },
    {
      title: 'The warming problem: lifetime against traffic rhythm',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Here is the part that gives the article its name and that most implementations ignore. The cached prefix has a short lifetime, typically a few minutes from the last access, with extended-life options at a higher write cost. Every read resets the clock. That creates a dynamic that depends entirely on the rhythm of your traffic, not on the size of your prompt: if calls arrive with an interval shorter than the lifetime, the prefix stays alive on its own and you pay the write only once; if the interval between calls is longer, every request pays for the write again and you are spending more than you would with no cache at all.',
        },
        {
          type: 'table',
          columns: ['Traffic profile', 'What happens to the prefix', 'Decision'],
          rows: [
            [
              'Steady, several calls per minute',
              'Always alive, renewed by the traffic itself',
              'Do nothing: the cache sustains itself',
            ],
            [
              'Short bursts with long valleys',
              'Dies in the valley and is rewritten on every burst',
              'Warm before the burst when it is predictable',
            ],
            [
              'Daytime business hours, quiet at night',
              'Dies every night and the first call of the day is slow and expensive',
              'Warm once before the opening peak',
            ],
            [
              'Sparse and unpredictable',
              'Almost always cold, writes rarely amortized',
              'Keeping it warm costs more than the benefit: turn the cache off',
            ],
            [
              'Nightly batch processing',
              'Stays alive through the whole batch if concurrency is controlled',
              'Warm once and fire the batch right after',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical conclusion is uncomfortable for anyone who likes general solutions: keeping a prefix warm with a periodic ping only pays off when the volume that benefits from it is large enough to cover the warming writes. A ping every four minutes, all day, is a few hundred prefix writes per day. If your read volume is tens of thousands of calls, that is irrelevant and the warming pays for itself many times over. If your volume is a few hundred calls per day, warming costs nearly as much as it saves, and the correct decision is to warm only before known peaks, or not to warm at all.',
        },
        {
          type: 'code',
          value: `// Prefix warmer. Runs as a periodic job and fires the cheapest possible
// call that still writes the prefix into the provider cache.

const INTERVAL_MS = 4 * 60 * 1000; // below the nominal TTL, with margin

// The warming call asks for the minimum output: the goal is to write
// the prefix, not to get an answer. Output tokens are the expensive item.
const warm = async (client, stablePrefix) => {
  const start = process.hrtime.bigint();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1,
    system: [{ type: 'text', text: stablePrefix, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'ok' }],
  });

  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  const { cache_creation_input_tokens: written, cache_read_input_tokens: read } = response.usage;

  // If the warming wrote instead of read, the prefix had died: that is
  // the signal that the interval is above the provider real TTL.
  return { written, read, ms, expired: written > 0 };
};

export const startWarming = (client, stablePrefix, metrics) => {
  const timer = setInterval(async () => {
    try {
      const r = await warm(client, stablePrefix);
      metrics.record('cache.warming', r);
    } catch (error) {
      // A warming failure can never take the process down: the worst case
      // is the prefix cooling off and the next real call paying the write.
      metrics.record('cache.warming.error', { message: error.message });
    }
  }, INTERVAL_MS);

  timer.unref();
  return () => clearInterval(timer);
};`,
        },
        {
          type: 'paragraph',
          value:
            'Two choices in this code deserve justification. The first is the one-token output limit: the prefix write happens on the input side, so generating an answer is pure waste. The second is using the usage response itself to find out whether the prefix expired. When the warming reports a write instead of a read, the chosen interval is above the real lifetime, and that number is a value observed on your provider, in your region, not a documentation constant to copy.',
        },
      ],
    },
    {
      title: 'When the prefix is too large to fit a single version',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mature systems rarely have one prefix. They have one per support vertical, one per language, one per experiment variant, one per prompt version in rollout. Each combination is a distinct prefix in the cache, with its own write and its own lifetime. A system with four verticals, three languages and two flag variants has twenty-four prefixes competing for warming, and the aggregate hit rate collapses without a single line of code looking wrong.',
        },
        {
          type: 'ordered',
          items: [
            'Count how many distinct prefixes your system actually emits today, multiplying the dimensions that vary: vertical, language, flag variant, prompt version and model.',
            'Measure call volume per prefix, not in aggregate, because the decision to warm is always per prefix.',
            'Cut what does not pay for itself: prefixes below the break-even volume should leave the cache, not enter the warming routine.',
            'Factor out what is common to all of them into a shared block at the top, leaving the specific part after the first marker.',
            'During a prompt rollout, consciously accept that there are two warm prefixes at once, and retire the old version instead of leaving it alive indefinitely.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The factoring in item four is what pays off most and what fewest people do. If the tone instructions, the safety rules and the general company glossary are the same across every vertical, that block can be a prefix shared by all traffic, warmed once and reused by everyone. The vertical-specific part becomes a second marked segment after it. Providers that support more than one cache point per call allow exactly this chaining, and the gain is large because the shared block is the one with the highest read volume in the entire system.',
        },
        {
          type: 'diagram',
          value: `support call (vertical A, language pt, variant 1)

[ block common to the company  ] <- marker 1: shared by everyone
[ vertical A context           ] <- marker 2: shared by the vertical
[ flag variant 1               ]
[ customer profile             ]
[ history + question           ]

support call (vertical B, language pt, variant 1)

[ block common to the company  ] <- HIT on marker 1
[ vertical B context           ] <- vertical B own write
[ flag variant 1               ]
[ customer profile             ]
[ history + question           ]`,
        },
      ],
    },
    {
      title: 'Measuring the real hit rate, not the apparent savings',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The metric almost everyone uses to evaluate the cache is the drop in the bill, and it is misleading for a simple reason: the bill also drops when volume drops, when history gets shorter, when someone swaps models. Evaluating the cache by the bill mixes everything together. The data that matters comes straight from the usage response of each call, which separates normal input tokens, tokens written to the cache and tokens read from the cache, and those three numbers are what give you the real hit rate.',
        },
        {
          type: 'list',
          items: [
            'Hit rate per prefix: tokens read from the cache divided by the sum of read, written and normal input. Aggregating this across the whole system hides the prefix that never hits.',
            'Write-to-read ratio per prefix: above one to two, that prefix is costing more than it saves and needs to leave the cache.',
            'Time to first token split by hit and by miss, because the latency gain from the cache is often larger than the cost gain and shows up directly in the customer experience.',
            'Count of distinct prefixes per day, which is the leading indicator of fragmentation: when that number rises without anyone having created a new vertical, something is injecting variation into the prefix.',
            'Warming cost per prefix, compared to the cost it saves, because that ratio is the only defensible justification for keeping the ping job running.',
          ],
        },
        {
          type: 'code',
          value: `// Cache accounting from the API usage response.
// One record per call, grouped by prefix identity.

export const recordUsage = (metrics, { prefixId, model, usage, ttfbMs }) => {
  const normalInput = usage.input_tokens ?? 0;
  const written = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  const total = normalInput + written + read;

  metrics.record('llm.cache', {
    prefixId,
    model,
    // Per-call rate, aggregated later per prefix over the desired window.
    hitRate: total === 0 ? 0 : read / total,
    written,
    read,
    // Splitting latency by hit is what reveals the experience gain,
    // which is usually larger and more visible than the cost gain.
    ttfbMs,
    hit: read > 0,
  });
};

// Executable decision rule: a prefix stays in the cache only while
// reads amortize writes over the observed window.
export const shouldKeepCached = ({ written, read }, writeFactor = 1.25, readFactor = 0.1) => {
  const costWithCache = written * writeFactor + read * readFactor;
  const costWithoutCache = written + read;
  return costWithCache < costWithoutCache;
};`,
        },
        {
          type: 'paragraph',
          value:
            'The last snippet is the executable version of a decision that usually stays implicit in a spreadsheet. The factors are the write and read price multipliers relative to the normal input token, and the ones that count are your provider values, checked at the moment you write this. Running that comparison per prefix, once a week, is what keeps the cache from becoming the optimization everyone believes is on and nobody can prove is still worth it.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why is my cache hit rate low if my prompt barely changes?',
      answer:
        'Because the cache matches by exact token prefix from position zero, not by content similarity. A single different token at the beginning makes everything after it billed in full. The most common causes are invisible in a quick review: a date with hours and minutes in the system prompt, a request identifier placed in the header for tracing, tools serialized from an object whose key order changed in a deploy, JSON with inconsistent indentation or ordering, and the customer name in a greeting at the top, which makes the prefix unique per person. The check that solves this is a test that builds the prefix twice with different inputs and compares the hash: if it diverges, the pull request fails before the bill tells the story.',
    },
    {
      question: 'Is it worth keeping a ping job so the prefix never cools down?',
      answer:
        'It depends entirely on the volume that benefits from the prefix, and the math is direct. A ping every four minutes generates a few hundred prefix writes per day. If real traffic is tens of thousands of calls against that same prefix, warming is noise in the cost and pays for itself many times over in latency and price. If traffic is a few hundred calls per day, warming costs nearly as much as it saves and is not justified: in that case, warm only before predictable peaks, such as the opening of business hours or the start of a nightly batch, or simply do not cache that prefix. The decision is always per prefix, never on the system aggregate.',
    },
    {
      question: 'Is prompt caching the same as semantic response caching?',
      answer:
        'No, and confusing the two leads to bad decisions. Prompt caching is a provider mechanism that stores the internal model state for a token prefix and charges less for rereading it; the answer is still generated from scratch on every call, so the output can vary and the information never goes stale. Semantic caching is a layer of yours, before the model, that returns an already generated answer when the new question is similar enough to a previous one, which saves the entire call but carries the risk of serving outdated content or matching similar questions that need different answers. They are complementary: prompt caching reduces the cost of the calls that happen, and semantic caching reduces the number of calls that happen.',
    },
  ],
  conclusion: {
    title: 'The cache is prompt ordering, and warming is a traffic decision',
    description:
      'Prompt caching delivers what it promises, but only for those who treat the prompt as a sequence ordered by frequency of change instead of a handful of blocks concatenated in the order they were written. The difference between a thirty and a ninety percent hit rate is almost never in the provider: it is in a date with a time at the top, in non-deterministic tool serialization and in a personalized greeting before the cache point. And warming, which looks like the sophisticated part, is the simplest to decide once you measure per prefix: if traffic keeps the prefix alive on its own, do nothing; if it dies in predictable valleys, warm before the peak; if it almost never hits, take that prefix out of the cache instead of paying for writes nobody reads.',
    cta: 'Want to know how much of your LLM cost is a prefix paid for more than once? I can review how your prompts are assembled and how usage is accounted per prefix, and design the caching and warming policy that holds up under your real traffic rhythm.',
  },
  related: [
    {
      label: 'Semantic caching: cutting LLM cost without losing quality',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Context compression: fitting more in the window without losing signal',
      to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal',
    },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'La caché de prompt es la optimización con mejor relación entre esfuerzo y retorno en sistemas con LLM, y también es la que más gente activa mal. La promesa es simple: el prefijo estable de tu llamada, ese bloque de instrucciones, esquema de herramientas y contexto fijo que se repite en cada petición, se procesa una vez y se reaprovecha en las siguientes por una fracción del precio y una fracción de la latencia. Lo que la promesa no dice es que la caché es posicional y frágil: casa por prefijo exacto, desde el primer token hasta el punto marcado, y cualquier cosa que cambie al principio, una marca de tiempo, un contador de tokens del usuario, una lista de herramientas ordenada desde un objeto sin orden garantizado, invalida todo lo que viene después. El resultado típico es una tasa de acierto del treinta por ciento que nadie percibe, porque la factura sigue bajando lo suficiente como para parecer que funcionó. Este artículo trata la caché como lo que es: una decisión de ordenación del prompt, con costo de escritura, tiempo de vida y un problema de calentamiento que solo aparece cuando el tráfico es irregular.',
  sections: [
    {
      title: 'La caché es un prefijo, no un conjunto de bloques',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error conceptual más caro es imaginar la caché como un diccionario que guarda pedazos del prompt y los reconoce donde sea que aparezcan. No es así. Lo que queda en caché es el estado interno del modelo después de procesar una secuencia de tokens desde la posición cero. Eso significa que el acierto siempre es un prefijo continuo: si los primeros ocho mil tokens son idénticos a los de la llamada anterior y el token ocho mil uno difiere, aprovechas ocho mil y pagas íntegramente por todo el resto. Y significa también que colocar el bloque estable después de un bloque variable no sirve de nada, aunque ese bloque estable tenga veinte mil tokens y nunca cambie, porque la variación anterior ya rompió la cadena.',
        },
        {
          type: 'paragraph',
          value:
            'De ahí sale la única regla de ordenación que importa, y vale para cualquier proveedor: ordena el prompt por frecuencia de cambio, del más estable al más volátil. Instrucciones del sistema y definición de herramientas primero, porque cambian en el deploy. Contexto de dominio compartido después, porque cambia en días. Datos del cliente a continuación, porque cambian por conversación. Historial de mensajes y la pregunta del turno actual al final, porque cambian en cada petición. Ese orden no es estético, es literalmente la diferencia entre pagar el prefijo una vez al día y pagarlo en cada llamada.',
        },
        {
          type: 'diagram',
          value: `Orden que aprovecha la cache          Orden que la destruye

[ instrucciones del sistema ] estable  [ marca de tiempo        ] siempre
[ definicion de tools       ] estable  [ instrucciones sistema  ] estable
[ contexto de dominio       ] dias     [ definicion de tools    ] estable
[ perfil del cliente        ] charla   [ contexto de dominio    ] dias
--------- punto de cache ---------     [ perfil del cliente     ] charla
[ historial de mensajes     ] turno    [ historial de mensajes  ] turno
[ pregunta del turno        ] turno    [ pregunta del turno     ] turno

acierto: todo antes del marcador       acierto: cero
                                       (el primer token ya difiere)`,
        },
        {
          type: 'paragraph',
          value:
            'Conviene notar la asimetría de precio que hace interesante esta decisión. Escribir en la caché cuesta más que procesar el token normalmente, típicamente alrededor de un veinticinco por ciento más. Leer de la caché cuesta una fracción pequeña del precio normal, del orden de una décima parte. Eso quiere decir que la caché no es gratuita: un prefijo escrito y nunca reaprovechado es pérdida directa. El punto de equilibrio aparece alrededor de la segunda lectura, y por eso la pregunta operativa no es "¿vale la pena cachear?", es "¿cuántas lecturas consigo antes de que el prefijo expire?".',
        },
      ],
    },
    {
      title: 'Lo que invalida la caché sin que nadie lo note',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tasa de acierto baja casi nunca viene de una decisión consciente. Viene de detalles de serialización que nadie revisó porque parecen inertes. El caso más común y más irritante es la fecha en el prompt del sistema: alguien escribió "Hoy es 8 de agosto de 2026" para que el modelo supiera la fecha actual, y si ese texto se genera con hora y minuto, el prefijo cambia en cada petición y la caché nunca acierta. Lo mismo vale para un identificador de petición inyectado en el encabezado del prompt, para un contador de mensajes de la conversación colocado antes de las instrucciones, y para cualquier cosa que involucre generación aleatoria.',
        },
        {
          type: 'table',
          columns: ['Fuente de la invalidación', 'Por qué pasa desapercibida', 'Corrección'],
          rows: [
            [
              'Fecha y hora completa en el prompt del sistema',
              'Parece un dato estático, pero cambia cada segundo',
              'Truncar al día, o mover la fecha al final del prompt',
            ],
            [
              'Herramientas serializadas desde un objeto',
              'El orden de las claves parece estable hasta que un deploy lo cambia',
              'Ordenar las herramientas explícitamente por nombre antes de serializar',
            ],
            [
              'JSON con indentación variable o claves desordenadas',
              'El contenido es igual, la secuencia de tokens no',
              'Serializar de forma canónica: claves ordenadas, espaciado fijo',
            ],
            [
              'Identificador de petición o de sesión al inicio',
              'Se puso para trazabilidad y nadie pensó en la caché',
              'Mantenerlo fuera del prompt, en el metadato de la llamada',
            ],
            [
              'Nombre del usuario o saludo personalizado arriba',
              'Vuelve el prefijo único por persona, matando el compartir',
              'Mover el bloque personalizado a después del punto de caché',
            ],
            [
              'Rotación de modelo entre llamadas',
              'La caché es por modelo, y el enrutador cambia sin avisar',
              'Contabilizar la caché por modelo y evitar rotación en el camino caliente',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La defensa contra esto no es revisión de código, es una prueba. El prefijo estable necesita una verificación automatizada que arme el prompt dos veces, en momentos distintos, con entradas distintas, y compare el hash de la parte que debería ser idéntica. Si el hash diverge, la prueba falla y alguien lo descubre en el pull request en vez de descubrirlo en la factura tres semanas después.',
        },
        {
          type: 'code',
          value: `// Armado del prompt con prefijo estable verificable.
// La ordenación canónica de las herramientas y la ausencia de cualquier
// valor derivado del reloj son lo que garantiza el acierto entre llamadas.

const serializarHerramientas = (herramientas) =>
  [...herramientas]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((h) => JSON.stringify(h, Object.keys(h).sort()))
    .join('\\n');

// Todo lo que entra aquí cambia como mucho en el deploy o en una ventana
// de horas. Nada de reloj, identificador de petición o dato del cliente.
export const armarPrefijoEstable = ({ instrucciones, herramientas, glosario }) =>
  [
    instrucciones.trim(),
    '## Herramientas disponibles',
    serializarHerramientas(herramientas),
    '## Glosario del dominio',
    glosario.trim(),
  ].join('\\n\\n');

export const armarLlamada = ({ prefijoEstable, perfilCliente, historial, pregunta }) => ({
  system: [
    // El bloque marcado es lo que el proveedor guarda; tiene que ser byte
    // a byte igual al de la llamada anterior para que haya acierto.
    { type: 'text', text: prefijoEstable, cache_control: { type: 'ephemeral' } },
    // Después del marcador entra todo lo que varía por conversación y turno.
    { type: 'text', text: perfilCliente },
  ],
  messages: [...historial, { role: 'user', content: pregunta }],
});`,
        },
        {
          type: 'code',
          value: `// Prueba que fija la estabilidad del prefijo. Falla en el pull request
// cuando alguien inyecta reloj, aleatoriedad u orden no determinista.

import { createHash } from 'node:crypto';
import { armarPrefijoEstable } from './prompt.js';

const hash = (texto) => createHash('sha256').update(texto).digest('hex');

test('el prefijo estable no cambia entre armados', () => {
  const entrada = {
    instrucciones: INSTRUCCIONES,
    // Misma colección en orden distinto: la serialización canónica
    // tiene que producir exactamente la misma secuencia de tokens.
    herramientas: [...HERRAMIENTAS].reverse(),
    glosario: GLOSARIO,
  };

  const primero = hash(armarPrefijoEstable({ ...entrada, herramientas: HERRAMIENTAS }));
  const segundo = hash(armarPrefijoEstable(entrada));

  expect(segundo).toBe(primero);
});

test('el prefijo estable no contiene marcas de tiempo', () => {
  const prefijo = armarPrefijoEstable({
    instrucciones: INSTRUCCIONES,
    herramientas: HERRAMIENTAS,
    glosario: GLOSARIO,
  });

  expect(prefijo).not.toMatch(/\\d{2}:\\d{2}:\\d{2}/);
  expect(prefijo).not.toMatch(/\\d{4}-\\d{2}-\\d{2}T/);
});`,
        },
      ],
    },
    {
      title: 'El problema del calentamiento: tiempo de vida contra ritmo del tráfico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aquí está la parte que da nombre al artículo y que la mayoría de las implementaciones ignora. El prefijo en caché tiene un tiempo de vida corto, típicamente algunos minutos desde el último acceso, con opciones de vida extendida a un costo de escritura mayor. Cada lectura renueva el reloj. Eso crea una dinámica que depende enteramente del ritmo de tu tráfico, y no del tamaño de tu prompt: si las llamadas llegan con un intervalo menor que el tiempo de vida, el prefijo se mantiene vivo solo y pagas la escritura una única vez; si el intervalo entre llamadas es mayor, cada petición paga la escritura de nuevo y estás gastando más de lo que gastarías sin caché alguna.',
        },
        {
          type: 'table',
          columns: ['Perfil de tráfico', 'Qué pasa con el prefijo', 'Decisión'],
          rows: [
            [
              'Constante, varias llamadas por minuto',
              'Siempre vivo, renovado por el propio tráfico',
              'No hagas nada: la caché se sostiene sola',
            ],
            [
              'Ráfagas cortas con valles largos',
              'Muere en el valle y se reescribe en cada ráfaga',
              'Calentar antes de la ráfaga cuando es previsible',
            ],
            [
              'Comercial diurno, silencio nocturno',
              'Muere cada noche y la primera llamada del día es lenta y cara',
              'Calentar una vez antes del pico de apertura',
            ],
            [
              'Esparso e imprevisible',
              'Casi siempre frío, escritura raramente amortizada',
              'Mantenerlo caliente cuesta más que el beneficio: apaga la caché',
            ],
            [
              'Lote nocturno de procesamiento',
              'Vive durante todo el lote si la concurrencia está controlada',
              'Calentar una vez y disparar el lote enseguida',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La conclusión práctica es incómoda para quien prefiere soluciones generales: mantener un prefijo caliente con un ping periódico solo compensa cuando el volumen que se beneficia de él es lo bastante grande como para pagar las escrituras del calentamiento. Un ping cada cuatro minutos, todo el día, son algunos cientos de escrituras de prefijo por día. Si tu volumen de lectura es de decenas de miles de llamadas, eso es irrelevante y el calentamiento se paga muchas veces. Si tu volumen es de algunos cientos de llamadas por día, el calentamiento cuesta casi tanto como lo que ahorra, y la decisión correcta es calentar solo antes de los picos conocidos, o no calentar.',
        },
        {
          type: 'code',
          value: `// Calentador de prefijo. Corre como job periódico y dispara la llamada
// más barata posible que aún escribe el prefijo en la caché del proveedor.

const INTERVALO_MS = 4 * 60 * 1000; // por debajo del TTL nominal, con margen

// La llamada de calentamiento pide el mínimo de salida: el objetivo es
// escribir el prefijo, no obtener respuesta. Los tokens de salida son lo caro.
const calentar = async (cliente, prefijoEstable) => {
  const inicio = process.hrtime.bigint();

  const respuesta = await cliente.messages.create({
    model: MODELO,
    max_tokens: 1,
    system: [{ type: 'text', text: prefijoEstable, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: 'ok' }],
  });

  const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
  const { cache_creation_input_tokens: escritos, cache_read_input_tokens: leidos } = respuesta.usage;

  // Si el calentamiento escribió en vez de leer, el prefijo había muerto:
  // es la señal de que el intervalo está por encima del TTL real.
  return { escritos, leidos, ms, expiro: escritos > 0 };
};

export const iniciarCalentamiento = (cliente, prefijoEstable, metricas) => {
  const timer = setInterval(async () => {
    try {
      const r = await calentar(cliente, prefijoEstable);
      metricas.registrar('cache.calentamiento', r);
    } catch (error) {
      // Un fallo del calentamiento nunca puede tumbar el proceso: el peor
      // caso es que el prefijo se enfríe y la próxima llamada pague la escritura.
      metricas.registrar('cache.calentamiento.error', { mensaje: error.message });
    }
  }, INTERVALO_MS);

  timer.unref();
  return () => clearInterval(timer);
};`,
        },
        {
          type: 'paragraph',
          value:
            'Dos elecciones de ese código merecen justificación. La primera es el límite de un token en la salida: la escritura del prefijo ocurre del lado de la entrada, así que generar respuesta es desperdicio puro. La segunda es usar el propio retorno de uso para descubrir si el prefijo expiró. Cuando el calentamiento reporta escritura en vez de lectura, el intervalo elegido está por encima del tiempo de vida real, y ese número es un dato observado en tu proveedor, en tu región, y no una constante de documentación para copiar.',
        },
      ],
    },
    {
      title: 'Cuando el prefijo es demasiado grande para caber en una sola versión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los sistemas maduros raramente tienen un prefijo. Tienen uno por vertical de atención, uno por idioma, uno por variante de experimento, uno por versión del prompt en rollout. Cada combinación es un prefijo distinto en la caché, con su propia escritura y su propio tiempo de vida. Un sistema con cuatro verticales, tres idiomas y dos variantes de flag tiene veinticuatro prefijos compitiendo por calentamiento, y la tasa de acierto agregada se desploma sin que ninguna línea de código parezca equivocada.',
        },
        {
          type: 'ordered',
          items: [
            'Cuenta cuántos prefijos distintos emite realmente tu sistema hoy, multiplicando las dimensiones que varían: vertical, idioma, variante de flag, versión del prompt y modelo.',
            'Mide el volumen de llamadas por prefijo, no en el agregado, porque la decisión de calentar es siempre por prefijo.',
            'Corta lo que no se paga: los prefijos por debajo del volumen de equilibrio deben salir de la caché, no entrar en la rutina de calentamiento.',
            'Factoriza lo que es común a todos ellos en un bloque compartido arriba, dejando la parte específica después del primer marcador.',
            'Durante un rollout de prompt, acepta conscientemente que hay dos prefijos calientes al mismo tiempo, y retira la versión antigua en vez de dejarla viva indefinidamente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La factorización del punto cuatro es la que más rinde y la que menos gente hace. Si las instrucciones de tono, las reglas de seguridad y el glosario general de la empresa son los mismos en todas las verticales, ese bloque puede ser un prefijo compartido por todo el tráfico, calentado una vez y reaprovechado por todos. La parte específica de la vertical pasa a ser un segundo tramo marcado después de él. Los proveedores que soportan más de un punto de caché por llamada permiten exactamente ese encadenamiento, y la ganancia es grande porque el bloque compartido es el que tiene el mayor volumen de lectura de todo el sistema.',
        },
        {
          type: 'diagram',
          value: `llamada de atencion (vertical A, idioma pt, variante 1)

[ bloque comun a la empresa   ] <- marcador 1: compartido por todos
[ contexto de la vertical A   ] <- marcador 2: compartido por la vertical
[ variacion de la flag 1      ]
[ perfil del cliente          ]
[ historial + pregunta        ]

llamada de atencion (vertical B, idioma pt, variante 1)

[ bloque comun a la empresa   ] <- ACIERTO en el marcador 1
[ contexto de la vertical B   ] <- escritura propia de la vertical B
[ variacion de la flag 1      ]
[ perfil del cliente          ]
[ historial + pregunta        ]`,
        },
      ],
    },
    {
      title: 'Medir el acierto real, y no el ahorro aparente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La métrica que casi todo el mundo usa para evaluar la caché es la caída del valor de la factura, y es engañosa por un motivo simple: la factura también cae cuando cae el volumen, cuando el historial se acorta, cuando alguien cambia de modelo. Evaluar la caché por la factura lo mezcla todo. El dato que importa viene directo del retorno de uso de cada llamada, que separa tokens de entrada normales, tokens escritos en la caché y tokens leídos de la caché, y con esos tres números se calcula la tasa de acierto de verdad.',
        },
        {
          type: 'list',
          items: [
            'Tasa de acierto por prefijo: tokens leídos de la caché divididos por la suma de leídos, escritos y entrada normal. Agregar esto en todo el sistema esconde el prefijo que nunca acierta.',
            'Razón entre escrituras y lecturas por prefijo: por encima de uno a dos, ese prefijo está costando más de lo que ahorra y necesita salir de la caché.',
            'Tiempo hasta el primer token separado por acierto y por fallo, porque la ganancia de latencia de la caché suele ser mayor que la de costo y aparece directo en la experiencia del cliente.',
            'Conteo de prefijos distintos por día, que es el indicador anticipado de fragmentación: cuando ese número sube sin que nadie haya creado una vertical nueva, algo está inyectando variación en el prefijo.',
            'Costo de calentamiento por prefijo, comparado con el costo que ahorra, porque esa razón es la única justificación defendible para mantener el job de ping corriendo.',
          ],
        },
        {
          type: 'code',
          value: `// Contabilidad de la caché a partir del retorno de uso de la API.
// Un registro por llamada, agrupado por la identidad del prefijo.

export const registrarUso = (metricas, { prefijoId, modelo, usage, ttfbMs }) => {
  const entradaNormal = usage.input_tokens ?? 0;
  const escritos = usage.cache_creation_input_tokens ?? 0;
  const leidos = usage.cache_read_input_tokens ?? 0;
  const total = entradaNormal + escritos + leidos;

  metricas.registrar('llm.cache', {
    prefijoId,
    modelo,
    // La tasa por llamada, agregada después por prefijo en la ventana deseada.
    tasaAcierto: total === 0 ? 0 : leidos / total,
    escritos,
    leidos,
    // Separar la latencia por acierto es lo que revela la ganancia de
    // experiencia, que suele ser mayor y más visible que la de costo.
    ttfbMs,
    acerto: leidos > 0,
  });
};

// Regla de decisión ejecutable: un prefijo permanece en la caché solo
// mientras las lecturas amorticen las escrituras en la ventana observada.
export const debeMantenerEnCache = ({ escritos, leidos }, factorEscritura = 1.25, factorLectura = 0.1) => {
  const costoConCache = escritos * factorEscritura + leidos * factorLectura;
  const costoSinCache = escritos + leidos;
  return costoConCache < costoSinCache;
};`,
        },
        {
          type: 'paragraph',
          value:
            'El último fragmento es la versión ejecutable de la decisión que suele quedar implícita en una planilla. Los factores son los multiplicadores de precio de escritura y de lectura respecto al token de entrada normal, y valen los de tu proveedor, consultados en el momento en que escribes esto. Correr esa comparación por prefijo, una vez por semana, es lo que impide que la caché se vuelva esa optimización que todos creen activa y que nadie logra probar que aún compensa.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué mi tasa de acierto de caché es baja si mi prompt casi no cambia?',
      answer:
        'Porque la caché casa por prefijo exacto de tokens desde la posición cero, y no por semejanza de contenido. Basta un token distinto al principio para que todo lo posterior se cobre íntegramente. Las causas más comunes son invisibles en una revisión rápida: una fecha con hora y minuto en el prompt del sistema, un identificador de petición puesto en el encabezado para trazabilidad, herramientas serializadas desde un objeto cuyo orden de claves cambió en un deploy, JSON con indentación u ordenación inconsistente, y el nombre del cliente en un saludo arriba, que vuelve el prefijo único por persona. La verificación que resuelve esto es una prueba que arma el prefijo dos veces con entradas distintas y compara el hash: si diverge, el pull request falla antes de que la factura cuente la historia.',
    },
    {
      question: '¿Vale la pena mantener un job de ping para que el prefijo nunca se enfríe?',
      answer:
        'Depende enteramente del volumen que se beneficia del prefijo, y la cuenta es directa. Un ping cada cuatro minutos genera algunos cientos de escrituras de prefijo por día. Si el tráfico real es de decenas de miles de llamadas contra ese mismo prefijo, el calentamiento es ruido en el costo y se paga muchas veces en latencia y en precio. Si el tráfico es de algunos cientos de llamadas por día, el calentamiento cuesta casi tanto como ahorra y no se justifica: en ese caso, calienta solo antes de picos previsibles, como la apertura del horario comercial o el inicio de un lote nocturno, o simplemente no uses caché en ese prefijo. La decisión es siempre por prefijo, nunca en el agregado del sistema.',
    },
    {
      question: '¿La caché de prompt es lo mismo que la caché semántica de respuestas?',
      answer:
        'No, y confundir ambas lleva a malas decisiones. La caché de prompt es un mecanismo del proveedor que guarda el estado interno del modelo para un prefijo de tokens y cobra más barato por releerlo; la respuesta se sigue generando desde cero en cada llamada, así que la salida puede variar y la información nunca queda vieja. La caché semántica es una capa tuya, antes del modelo, que devuelve una respuesta ya generada cuando la nueva pregunta se parece lo suficiente a otra anterior, lo que ahorra la llamada entera pero trae el riesgo de servir contenido desactualizado o de casar preguntas parecidas con respuestas distintas. Son complementarias: la caché de prompt reduce el costo de las llamadas que ocurren, y la caché semántica reduce el número de llamadas que ocurren.',
    },
  ],
  conclusion: {
    title: 'La caché es ordenación del prompt, y el calentamiento es decisión de tráfico',
    description:
      'La caché de prompt entrega lo que promete, pero solo para quien trata el prompt como una secuencia ordenada por frecuencia de cambio en vez de un puñado de bloques concatenados en el orden en que se escribieron. La diferencia entre un treinta y un noventa por ciento de acierto casi nunca está en el proveedor: está en una fecha con hora arriba, en una serialización no determinista de las herramientas y en un saludo personalizado antes del punto de caché. Y el calentamiento, que parece la parte sofisticada, es la más simple de decidir cuando mides por prefijo: si el tráfico mantiene el prefijo vivo solo, no hagas nada; si muere en valles previsibles, calienta antes del pico; si casi nunca acierta, saca ese prefijo de la caché en vez de pagar escrituras que nadie lee.',
    cta: '¿Quieres saber cuánto de tu costo de LLM es prefijo pagado más de una vez? Puedo revisar el armado de tus prompts y la contabilidad de uso por prefijo, y diseñar la política de caché y calentamiento que se sostiene con tu ritmo de tráfico real.',
  },
  related: [
    {
      label: 'Caché semántica: reducir el costo de LLM sin perder calidad',
      to: '/blog/cache-semantico-reduzir-custo-llm',
    },
    {
      label: 'Compresión de contexto: caber más en la ventana sin perder señal',
      to: '/blog/compressao-contexto-caber-mais-janela-sem-perder-sinal',
    },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default { pt, en, es };
