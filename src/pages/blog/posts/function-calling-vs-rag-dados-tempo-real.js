// Conteudo do artigo: Function calling vs RAG para dados em tempo real.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Exemplo lado a lado de function calling e RAG para a mesma pergunta: uma tool que consulta o estado atual do pedido via API versus retrieval de documentos estáticos, com detecção de intenção e roteamento entre os dois.',
  en: 'Side-by-side example of function calling and RAG for the same question: a tool that queries the current order status via API versus retrieval of static documents, with intent detection and routing between the two.',
  es: 'Ejemplo lado a lado de function calling y RAG para la misma pregunta: una tool que consulta el estado actual del pedido vía API frente a retrieval de documentos estáticos, con detección de intención y ruteo entre ambos.',
};

const repoUrl = 'https://github.com/joaosouz4dev/function-calling-vs-rag-example';

const pt = {
  intro:
    'Quando um usuário pergunta "cadê meu pedido?", nenhuma base de conhecimento no mundo tem a resposta: o status muda a cada minuto e vive no banco transacional, não num documento. Ainda assim, muita gente tenta resolver tudo com RAG, indexa FAQ, políticas e manuais, e depois se frustra quando o bot inventa um prazo de entrega que não existe. O problema não é o RAG: é usar retrieval para um dado que não é recuperável, e sim consultável. Function calling resolve exatamente essa classe: em vez de buscar um trecho parecido, o modelo chama uma função que executa a consulta ao vivo e recebe o dado fresco de volta. Este artigo separa as duas ferramentas por natureza do dado, mostra os fluxos lado a lado, quando cada uma vence, um exemplo real de tool use e como rotear entre elas numa arquitetura única.',
  sections: [
    {
      title: 'O eixo que separa as duas: dado estático x dado vivo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG e function calling não competem pelo mesmo trabalho; eles resolvem perguntas de naturezas diferentes. RAG é para conhecimento: texto que já existe escrito em algum lugar (uma política de troca, um trecho de manual, um artigo) e que você quer recuperar por similaridade semântica. Function calling é para ação e consulta: um dado que só existe no momento em que você pergunta (o saldo de hoje, o status atual do pedido, o clima agora) ou uma operação que muda o mundo (criar um chamado, agendar uma visita, emitir um boleto).',
        },
        {
          type: 'paragraph',
          value:
            'A pergunta que separa as duas é simples: a resposta está escrita em algum documento ou precisa ser calculada/consultada agora? Se está escrita, RAG recupera. Se precisa ser consultada, function calling chama uma API. Confundir os dois é a raiz de metade dos bots que alucinam: eles tentam recuperar por similaridade um dado que muda a cada segundo, e o trecho mais parecido que o retrieval encontra é sempre uma versão velha ou genérica.',
        },
      ],
    },
    {
      title: 'Comparação direta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A decisão entre function calling e RAG cai em poucas dimensões que puxam claramente para um lado. A tabela abaixo coloca as que mais pesam na hora de desenhar o sistema.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'RAG', 'Function calling'],
          rows: [
            [
              'Natureza do dado',
              'Estático: texto já escrito (FAQ, políticas, manuais, artigos)',
              'Vivo: consultado ou calculado no momento da pergunta (status, saldo, estoque)',
            ],
            [
              'Frescor',
              'Depende da última reindexação; entre reindexações o dado envelhece',
              'Sempre atual: a tool consulta a fonte da verdade a cada chamada',
            ],
            [
              'Efeito colateral',
              'Nenhum: retrieval só lê documentos',
              'Pode agir: criar chamado, agendar, emitir, alterar estado no sistema',
            ],
            [
              'Fonte da verdade',
              'Um corpus de documentos indexado em vector store',
              'A API/banco transacional que já é a autoridade sobre aquele dado',
            ],
            [
              'Risco típico',
              'Recuperar o trecho errado ou desatualizado e responder em cima dele',
              'Chamar a função errada ou com argumento inválido; exige validação dos args',
            ],
            [
              'Rastreabilidade',
              'Cita o documento e a seção de origem',
              'Registra a chamada, os argumentos e a resposta bruta da API',
            ],
          ],
        },
      ],
    },
    {
      title: 'Os dois fluxos lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ver os dois caminhos deixa clara a diferença de mecanismo: RAG recupera texto parecido e injeta no prompt; function calling faz o modelo decidir chamar uma função, executa a chamada no seu backend e devolve o resultado para o modelo redigir a resposta final.',
        },
        {
          type: 'diagram',
          value: `RAG (dado estático)
  Pergunta  ->  Embed  ->  Retrieve top-k  ->  Injeta chunks  ->  Gerar  ->  Resposta
                            (vector store)

Function calling (dado vivo)
  Pergunta  ->  Modelo decide a tool  ->  Seu backend executa a chamada (API/banco)
                                                |
                                                v
                          Resultado fresco  ->  Modelo redige  ->  Resposta`,
        },
        {
          type: 'paragraph',
          value:
            'A diferença central está no meio do caminho: em RAG o que entra no contexto é um trecho de texto que já existia; em function calling o que entra é o retorno de uma execução que aconteceu agora. Por isso function calling nunca esbarra em dado velho: ele não busca uma versão, ele provoca uma consulta.',
        },
      ],
    },
    {
      title: 'Quando function calling vence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Function calling é a escolha certa sempre que a resposta não está escrita em lugar nenhum e precisa ser consultada ao vivo, ou quando o usuário quer que algo aconteça, não apenas ser informado.',
        },
        {
          type: 'list',
          items: [
            'Estado transacional em tempo real: status de pedido, saldo, posição de entrega, disponibilidade de agenda. Muda a cada minuto e vive no sistema, não num documento.',
            'Dados de terceiros ao vivo: cotação, clima, rastreamento de transportadora, consulta de CEP. A fonte da verdade é uma API externa, não um corpus indexado.',
            'Ações com efeito colateral: abrir chamado, agendar visita, emitir segunda via, cancelar pedido. RAG só lê; aqui é preciso executar.',
            'Cálculos determinísticos: frete, juros, parcelas, conversão de unidade. Você quer o número exato de uma função, não uma aproximação gerada pelo modelo.',
            'Personalização por identidade: "meus dados", "minha fatura", "meu contrato". A resposta depende de quem pergunta e só a consulta parametrizada resolve.',
          ],
        },
      ],
    },
    {
      title: 'Quando RAG vence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG continua sendo a ferramenta certa quando a resposta já existe escrita em algum lugar e o trabalho é encontrar o trecho certo dentro de um volume grande de texto.',
        },
        {
          type: 'list',
          items: [
            'Conhecimento textual estável: políticas de troca, termos de uso, manuais, documentação. O dado não muda a cada minuto e já está redigido.',
            'Base grande demais para o contexto: milhares de documentos, anos de artigos. Você precisa recuperar por similaridade, não consultar por chave.',
            'Perguntas abertas e explicativas: "como funciona a garantia estendida?", "qual a diferença entre os planos?". A resposta é explicação, não um valor vivo.',
            'Necessidade de citar a fonte: quando cada afirmação deve apontar para o documento e a seção de origem, o retrieval entrega esse rastro naturalmente.',
          ],
        },
      ],
    },
    {
      title: 'Exemplo prático com tool use',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O coração do function calling é a definição da tool: você descreve para o modelo qual função existe, o que ela faz e quais argumentos ela aceita. O modelo decide quando chamá-la e com quais argumentos; o seu backend executa a chamada de verdade e devolve o resultado. No exemplo abaixo, usando a Anthropic Messages API, uma tool consulta o status atual do pedido no seu banco. O modelo nunca inventa o status: ele delega a consulta e só redige a resposta com o dado que voltou.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// A tool que expoe a consulta de status ao modelo.
// O modelo NAO executa nada: ele so decide chamar e com quais argumentos.
const tools = [
  {
    name: 'get_order_status',
    description:
      'Consulta o status atual de um pedido pelo numero. Use sempre que o usuario perguntar sobre um pedido especifico; nunca invente o status.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Numero do pedido, ex: PED-10293' },
      },
      required: ['order_id'],
    },
  },
];

// Execucao real da tool no SEU backend: consulta a fonte da verdade.
async function runTool(name, input) {
  if (name === 'get_order_status') {
    const order = await db.orders.findByPublicId(input.order_id);
    if (!order) return { found: false };
    return {
      found: true,
      status: order.status, // 'em_separacao' | 'enviado' | 'entregue'
      carrier: order.carrier,
      eta: order.estimatedDelivery,
    };
  }
  throw new Error('Tool desconhecida: ' + name);
}

async function ask(question) {
  const messages = [{ role: 'user', content: question }];

  // 1o turno: o modelo decide se chama a tool.
  let res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    tools,
    messages,
  });

  // Enquanto o modelo pedir tools, executa e devolve o resultado.
  while (res.stop_reason === 'tool_use') {
    const toolUse = res.content.find((b) => b.type === 'tool_use');
    const result = await runTool(toolUse.name, toolUse.input);

    messages.push({ role: 'assistant', content: res.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        },
      ],
    });

    res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      tools,
      messages,
    });
  }

  return res.content.find((b) => b.type === 'text')?.text;
}

// O modelo chama get_order_status('PED-10293'), recebe o status FRESCO
// do banco e so entao redige a resposta. Nada e recuperado por similaridade.
await ask('Cade meu pedido PED-10293?');`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no ponto que muda tudo: o dado do status nunca passou por embedding nem por vector store. O modelo apenas decidiu chamar a função, o seu backend consultou o banco (a fonte da verdade) e o resultado voltou fresco para o modelo redigir. É impossível o bot responder um status desatualizado, porque ele não busca uma versão antiga: ele provoca uma consulta nova a cada pergunta.',
        },
      ],
    },
    {
      title: 'Arquitetura combinada: roteie por intenção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Num bot de atendimento real, as duas ferramentas convivem: o mesmo usuário pergunta "qual o prazo de troca?" (RAG, conhecimento estável) e "cadê meu pedido?" (function calling, dado vivo) na mesma conversa. A arquitetura robusta não escolhe uma; ela roteia por intenção. Na prática moderna, você nem precisa de um classificador separado: expor tanto a base de conhecimento quanto as tools ao mesmo modelo deixa ele próprio decidir se recupera um documento ou chama uma função.',
        },
        {
          type: 'ordered',
          items: [
            'Modele o conhecimento estável como RAG: políticas, FAQ, manuais viram um corpus indexado ou uma tool de busca semântica que retorna trechos com fonte.',
            'Modele o dado vivo e as ações como tools: status, saldo, agendamento, emissão. Cada tool tem schema explícito de argumentos e valida a entrada.',
            'Exponha ambos ao mesmo modelo: dê a ele tanto a busca semântica quanto as tools transacionais. Ele decide, por pergunta, qual caminho seguir.',
            'Valide os argumentos antes de executar: nunca confie cegamente nos args gerados. Cheque tipo, formato e permissão (o usuário pode ver aquele pedido?) antes de tocar o backend.',
            'Registre a decisão: logue se a resposta veio de retrieval ou de tool, com os argumentos e o retorno. Isso é o que torna o sistema auditável e depurável.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ganho dessa arquitetura é que cada pergunta cai na ferramenta certa pela sua natureza: conhecimento estável pelo RAG, dado vivo e ação pela tool. O bot para de alucinar prazo de entrega porque nunca mais tenta recuperar por similaridade um dado que só o banco transacional conhece.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Function calling substitui RAG?',
      answer:
        'Não. Eles resolvem naturezas diferentes de pergunta. Function calling é para dado vivo (consultado ou calculado agora) e para ações com efeito colateral; RAG é para conhecimento textual já escrito que você recupera por similaridade. Um bot de atendimento sério usa os dois: RAG para políticas e manuais, function calling para status, saldo e agendamento. A arquitetura ideal roteia por intenção entre as duas.',
    },
    {
      question: 'Como o modelo sabe qual tool chamar?',
      answer:
        'Pela descrição. Cada tool tem um nome, uma descrição em linguagem natural do que faz e um schema dos argumentos que aceita. O modelo lê essas descrições junto com a pergunta e decide se alguma tool se aplica e com quais argumentos chamá-la. Por isso a qualidade da descrição importa tanto quanto o código: uma descrição vaga leva o modelo a chamar a tool errada ou a não chamá-la quando deveria.',
    },
    {
      question: 'Function calling é seguro para ações que mudam dados?',
      answer:
        'É seguro desde que você não confie cegamente nos argumentos gerados pelo modelo. O modelo decide chamar e sugere os argumentos, mas quem executa é o seu backend. Antes de tocar o banco, valide tipo e formato dos args, cheque a permissão do usuário sobre aquele recurso e, para ações de alto impacto, exija confirmação explícita. O modelo propõe; o seu código autoriza e executa.',
    },
  ],
  conclusion: {
    title: 'Escolha pela natureza do dado, não pela ferramenta da moda',
    description:
      'RAG e function calling resolvem perguntas diferentes: retrieval para conhecimento estável já escrito, tool use para dado vivo e ações que mudam o mundo. Posso avaliar o seu fluxo de atendimento e desenhar a arquitetura certa, roteando cada pergunta para a ferramenta que de fato tem a resposta.',
    cta: 'Falar sobre minha arquitetura de IA',
  },
  related: [
    { label: 'CAG x RAG: quando cache de contexto vence retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'RAG para atendimento no WhatsApp em produção', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'function-calling-vs-rag-example', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'When a user asks "where is my order?", no knowledge base in the world holds the answer: the status changes every minute and lives in the transactional database, not in a document. Even so, many people try to solve everything with RAG, they index FAQ, policies and manuals, and then get frustrated when the bot makes up a delivery date that does not exist. The problem is not RAG: it is using retrieval for data that is not retrievable but queryable. Function calling solves exactly that class: instead of fetching a similar snippet, the model calls a function that runs the live query and gets the fresh data back. This article separates the two tools by the nature of the data, shows the flows side by side, when each one wins, a real tool use example and how to route between them in a single architecture.',
  sections: [
    {
      title: 'The axis that separates the two: static data vs live data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG and function calling do not compete for the same job; they answer questions of different natures. RAG is for knowledge: text that already exists written somewhere (a return policy, a manual snippet, an article) that you want to retrieve by semantic similarity. Function calling is for action and query: data that only exists at the moment you ask (today balance, current order status, the weather right now) or an operation that changes the world (open a ticket, schedule a visit, issue an invoice).',
        },
        {
          type: 'paragraph',
          value:
            'The question that separates the two is simple: is the answer written in some document or does it need to be computed/queried now? If it is written, RAG retrieves. If it needs to be queried, function calling calls an API. Confusing the two is the root of half the bots that hallucinate: they try to retrieve by similarity a value that changes every second, and the most similar snippet retrieval finds is always a stale or generic version.',
        },
      ],
    },
    {
      title: 'Direct comparison',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The decision between function calling and RAG comes down to a few dimensions that clearly pull one way. The table below lays out the ones that weigh the most when designing the system.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'RAG', 'Function calling'],
          rows: [
            [
              'Nature of the data',
              'Static: text already written (FAQ, policies, manuals, articles)',
              'Live: queried or computed at question time (status, balance, inventory)',
            ],
            [
              'Freshness',
              'Depends on the last reindex; between reindexes the data ages',
              'Always current: the tool queries the source of truth on every call',
            ],
            [
              'Side effect',
              'None: retrieval only reads documents',
              'Can act: open a ticket, schedule, issue, change state in the system',
            ],
            [
              'Source of truth',
              'A corpus of documents indexed in a vector store',
              'The API/transactional database that is already the authority on that data',
            ],
            [
              'Typical risk',
              'Retrieving the wrong or outdated snippet and answering on top of it',
              'Calling the wrong function or with an invalid argument; requires arg validation',
            ],
            [
              'Traceability',
              'Cites the source document and section',
              'Logs the call, the arguments and the raw API response',
            ],
          ],
        },
      ],
    },
    {
      title: 'The two flows side by side',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Seeing both paths makes the mechanism difference clear: RAG retrieves similar text and injects it into the prompt; function calling makes the model decide to call a function, runs the call on your backend and returns the result for the model to write the final answer.',
        },
        {
          type: 'diagram',
          value: `RAG (static data)
  Question  ->  Embed  ->  Retrieve top-k  ->  Inject chunks  ->  Generate  ->  Answer
                            (vector store)

Function calling (live data)
  Question  ->  Model picks the tool  ->  Your backend runs the call (API/database)
                                                |
                                                v
                          Fresh result  ->  Model writes  ->  Answer`,
        },
        {
          type: 'paragraph',
          value:
            'The core difference is in the middle of the path: in RAG what enters the context is a snippet of text that already existed; in function calling what enters is the return of an execution that happened just now. That is why function calling never runs into stale data: it does not fetch a version, it triggers a query.',
        },
      ],
    },
    {
      title: 'When function calling wins',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Function calling is the right choice whenever the answer is not written anywhere and needs to be queried live, or when the user wants something to happen, not just to be informed.',
        },
        {
          type: 'list',
          items: [
            'Real-time transactional state: order status, balance, delivery position, schedule availability. It changes every minute and lives in the system, not in a document.',
            'Live third-party data: quotes, weather, carrier tracking, address lookup. The source of truth is an external API, not an indexed corpus.',
            'Actions with side effects: open a ticket, schedule a visit, reissue an invoice, cancel an order. RAG only reads; here you must execute.',
            'Deterministic calculations: shipping, interest, installments, unit conversion. You want the exact number from a function, not an approximation generated by the model.',
            'Identity-based personalization: "my data", "my invoice", "my contract". The answer depends on who is asking and only a parameterized query resolves it.',
          ],
        },
      ],
    },
    {
      title: 'When RAG wins',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG remains the right tool when the answer already exists written somewhere and the job is to find the right snippet within a large volume of text.',
        },
        {
          type: 'list',
          items: [
            'Stable textual knowledge: return policies, terms of use, manuals, documentation. The data does not change every minute and is already written.',
            'Base too large for the context: thousands of documents, years of articles. You need to retrieve by similarity, not query by key.',
            'Open, explanatory questions: "how does the extended warranty work?", "what is the difference between the plans?". The answer is an explanation, not a live value.',
            'Need to cite the source: when each statement must point to the source document and section, retrieval delivers that trail naturally.',
          ],
        },
      ],
    },
    {
      title: 'Practical example with tool use',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The heart of function calling is the tool definition: you describe to the model which function exists, what it does and which arguments it accepts. The model decides when to call it and with which arguments; your backend runs the actual call and returns the result. In the example below, using the Anthropic Messages API, a tool queries the current order status in your database. The model never makes up the status: it delegates the query and only writes the answer with the data that came back.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// The tool that exposes the status query to the model.
// The model does NOT execute anything: it only decides to call and with which args.
const tools = [
  {
    name: 'get_order_status',
    description:
      'Queries the current status of an order by its number. Use whenever the user asks about a specific order; never make up the status.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Order number, e.g. ORD-10293' },
      },
      required: ['order_id'],
    },
  },
];

// Real tool execution on YOUR backend: queries the source of truth.
async function runTool(name, input) {
  if (name === 'get_order_status') {
    const order = await db.orders.findByPublicId(input.order_id);
    if (!order) return { found: false };
    return {
      found: true,
      status: order.status, // 'packing' | 'shipped' | 'delivered'
      carrier: order.carrier,
      eta: order.estimatedDelivery,
    };
  }
  throw new Error('Unknown tool: ' + name);
}

async function ask(question) {
  const messages = [{ role: 'user', content: question }];

  // 1st turn: the model decides whether to call the tool.
  let res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    tools,
    messages,
  });

  // While the model requests tools, execute and return the result.
  while (res.stop_reason === 'tool_use') {
    const toolUse = res.content.find((b) => b.type === 'tool_use');
    const result = await runTool(toolUse.name, toolUse.input);

    messages.push({ role: 'assistant', content: res.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        },
      ],
    });

    res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      tools,
      messages,
    });
  }

  return res.content.find((b) => b.type === 'text')?.text;
}

// The model calls get_order_status('ORD-10293'), receives the FRESH status
// from the database and only then writes the answer. Nothing is retrieved by similarity.
await ask('Where is my order ORD-10293?');`,
        },
        {
          type: 'paragraph',
          value:
            'Notice the point that changes everything: the status data never went through embedding nor a vector store. The model only decided to call the function, your backend queried the database (the source of truth) and the result came back fresh for the model to write. It is impossible for the bot to answer a stale status, because it does not fetch an old version: it triggers a new query on every question.',
        },
      ],
    },
    {
      title: 'Combined architecture: route by intent',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a real support bot, both tools coexist: the same user asks "what is the return window?" (RAG, stable knowledge) and "where is my order?" (function calling, live data) in the same conversation. The robust architecture does not pick one; it routes by intent. In modern practice you do not even need a separate classifier: exposing both the knowledge base and the tools to the same model lets it decide whether to retrieve a document or call a function.',
        },
        {
          type: 'ordered',
          items: [
            'Model stable knowledge as RAG: policies, FAQ, manuals become an indexed corpus or a semantic search tool that returns snippets with their source.',
            'Model live data and actions as tools: status, balance, scheduling, issuance. Each tool has an explicit argument schema and validates the input.',
            'Expose both to the same model: give it both the semantic search and the transactional tools. It decides, per question, which path to take.',
            'Validate the arguments before executing: never blindly trust the generated args. Check type, format and permission (can the user see that order?) before touching the backend.',
            'Log the decision: record whether the answer came from retrieval or from a tool, with the arguments and the return. That is what makes the system auditable and debuggable.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The gain of this architecture is that each question lands on the right tool by its nature: stable knowledge via RAG, live data and action via the tool. The bot stops hallucinating delivery dates because it never again tries to retrieve by similarity a value that only the transactional database knows.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does function calling replace RAG?',
      answer:
        'No. They answer different natures of question. Function calling is for live data (queried or computed now) and for actions with side effects; RAG is for already written textual knowledge you retrieve by similarity. A serious support bot uses both: RAG for policies and manuals, function calling for status, balance and scheduling. The ideal architecture routes by intent between the two.',
    },
    {
      question: 'How does the model know which tool to call?',
      answer:
        'By the description. Each tool has a name, a natural-language description of what it does and a schema of the arguments it accepts. The model reads those descriptions along with the question and decides whether any tool applies and with which arguments to call it. That is why the quality of the description matters as much as the code: a vague description leads the model to call the wrong tool or not call it when it should.',
    },
    {
      question: 'Is function calling safe for actions that change data?',
      answer:
        'It is safe as long as you do not blindly trust the arguments generated by the model. The model decides to call and suggests the arguments, but your backend is what executes. Before touching the database, validate the type and format of the args, check the user permission over that resource and, for high-impact actions, require explicit confirmation. The model proposes; your code authorizes and executes.',
    },
  ],
  conclusion: {
    title: 'Choose by the nature of the data, not by the trending tool',
    description:
      'RAG and function calling solve different questions: retrieval for stable knowledge already written, tool use for live data and actions that change the world. I can assess your support flow and design the right architecture, routing each question to the tool that actually holds the answer.',
    cta: 'Talk about my AI architecture',
  },
  related: [
    { label: 'CAG vs RAG: when context cache beats retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'function-calling-vs-rag-example', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Cuando un usuario pregunta "¿dónde está mi pedido?", ninguna base de conocimiento en el mundo tiene la respuesta: el estado cambia a cada minuto y vive en la base transaccional, no en un documento. Aun así, mucha gente intenta resolver todo con RAG, indexa FAQ, políticas y manuales, y luego se frustra cuando el bot inventa un plazo de entrega que no existe. El problema no es RAG: es usar retrieval para un dato que no es recuperable sino consultable. Function calling resuelve exactamente esa clase: en vez de buscar un fragmento parecido, el modelo llama a una función que ejecuta la consulta en vivo y recibe el dato fresco de vuelta. Este artículo separa las dos herramientas por la naturaleza del dato, muestra los flujos lado a lado, cuándo gana cada una, un ejemplo real de tool use y cómo rutear entre ellas en una arquitectura única.',
  sections: [
    {
      title: 'El eje que separa a las dos: dato estático vs dato vivo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG y function calling no compiten por el mismo trabajo; responden preguntas de naturalezas distintas. RAG es para conocimiento: texto que ya existe escrito en algún lugar (una política de cambio, un fragmento de manual, un artículo) y que quieres recuperar por similitud semántica. Function calling es para acción y consulta: un dato que solo existe en el momento en que preguntas (el saldo de hoy, el estado actual del pedido, el clima ahora) o una operación que cambia el mundo (crear un ticket, agendar una visita, emitir una factura).',
        },
        {
          type: 'paragraph',
          value:
            'La pregunta que separa a las dos es simple: ¿la respuesta está escrita en algún documento o necesita ser calculada/consultada ahora? Si está escrita, RAG la recupera. Si necesita ser consultada, function calling llama a una API. Confundir ambas es la raíz de la mitad de los bots que alucinan: intentan recuperar por similitud un valor que cambia a cada segundo, y el fragmento más parecido que el retrieval encuentra es siempre una versión vieja o genérica.',
        },
      ],
    },
    {
      title: 'Comparación directa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La decisión entre function calling y RAG cae en pocas dimensiones que tiran claramente para un lado. La tabla siguiente expone las que más pesan al momento de diseñar el sistema.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'RAG', 'Function calling'],
          rows: [
            [
              'Naturaleza del dato',
              'Estático: texto ya escrito (FAQ, políticas, manuales, artículos)',
              'Vivo: consultado o calculado al momento de la pregunta (estado, saldo, inventario)',
            ],
            [
              'Frescura',
              'Depende del último reindexado; entre reindexados el dato envejece',
              'Siempre actual: la tool consulta la fuente de verdad en cada llamada',
            ],
            [
              'Efecto colateral',
              'Ninguno: el retrieval solo lee documentos',
              'Puede actuar: crear ticket, agendar, emitir, alterar estado en el sistema',
            ],
            [
              'Fuente de verdad',
              'Un corpus de documentos indexado en vector store',
              'La API/base transaccional que ya es la autoridad sobre ese dato',
            ],
            [
              'Riesgo típico',
              'Recuperar el fragmento equivocado o desactualizado y responder sobre él',
              'Llamar a la función equivocada o con un argumento inválido; exige validar los args',
            ],
            [
              'Trazabilidad',
              'Cita el documento y la sección de origen',
              'Registra la llamada, los argumentos y la respuesta cruda de la API',
            ],
          ],
        },
      ],
    },
    {
      title: 'Los dos flujos lado a lado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ver ambos caminos deja clara la diferencia de mecanismo: RAG recupera texto parecido y lo inyecta en el prompt; function calling hace que el modelo decida llamar a una función, ejecuta la llamada en tu backend y devuelve el resultado para que el modelo redacte la respuesta final.',
        },
        {
          type: 'diagram',
          value: `RAG (dato estático)
  Pregunta  ->  Embed  ->  Retrieve top-k  ->  Inyecta chunks  ->  Generar  ->  Respuesta
                            (vector store)

Function calling (dato vivo)
  Pregunta  ->  El modelo elige la tool  ->  Tu backend ejecuta la llamada (API/base)
                                                |
                                                v
                          Resultado fresco  ->  El modelo redacta  ->  Respuesta`,
        },
        {
          type: 'paragraph',
          value:
            'La diferencia central está en la mitad del camino: en RAG lo que entra al contexto es un fragmento de texto que ya existía; en function calling lo que entra es el retorno de una ejecución que ocurrió ahora. Por eso function calling nunca choca con dato viejo: no busca una versión, provoca una consulta.',
        },
      ],
    },
    {
      title: 'Cuándo gana function calling',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Function calling es la elección correcta siempre que la respuesta no esté escrita en ningún lugar y deba ser consultada en vivo, o cuando el usuario quiere que algo ocurra, no solo ser informado.',
        },
        {
          type: 'list',
          items: [
            'Estado transaccional en tiempo real: estado de pedido, saldo, posición de entrega, disponibilidad de agenda. Cambia a cada minuto y vive en el sistema, no en un documento.',
            'Datos de terceros en vivo: cotización, clima, rastreo de transportadora, consulta de código postal. La fuente de verdad es una API externa, no un corpus indexado.',
            'Acciones con efecto colateral: abrir ticket, agendar visita, emitir duplicado, cancelar pedido. RAG solo lee; aquí hay que ejecutar.',
            'Cálculos deterministas: flete, intereses, cuotas, conversión de unidad. Quieres el número exacto de una función, no una aproximación generada por el modelo.',
            'Personalización por identidad: "mis datos", "mi factura", "mi contrato". La respuesta depende de quién pregunta y solo la consulta parametrizada la resuelve.',
          ],
        },
      ],
    },
    {
      title: 'Cuándo gana RAG',
      blocks: [
        {
          type: 'paragraph',
          value:
            'RAG sigue siendo la herramienta correcta cuando la respuesta ya existe escrita en algún lugar y el trabajo es encontrar el fragmento correcto dentro de un volumen grande de texto.',
        },
        {
          type: 'list',
          items: [
            'Conocimiento textual estable: políticas de cambio, términos de uso, manuales, documentación. El dato no cambia a cada minuto y ya está redactado.',
            'Base demasiado grande para el contexto: miles de documentos, años de artículos. Necesitas recuperar por similitud, no consultar por clave.',
            'Preguntas abiertas y explicativas: "¿cómo funciona la garantía extendida?", "¿cuál es la diferencia entre los planes?". La respuesta es explicación, no un valor vivo.',
            'Necesidad de citar la fuente: cuando cada afirmación debe apuntar al documento y la sección de origen, el retrieval entrega ese rastro de forma natural.',
          ],
        },
      ],
    },
    {
      title: 'Ejemplo práctico con tool use',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El corazón del function calling es la definición de la tool: describes al modelo qué función existe, qué hace y qué argumentos acepta. El modelo decide cuándo llamarla y con qué argumentos; tu backend ejecuta la llamada real y devuelve el resultado. En el ejemplo siguiente, usando la Anthropic Messages API, una tool consulta el estado actual del pedido en tu base. El modelo nunca inventa el estado: delega la consulta y solo redacta la respuesta con el dato que volvió.',
        },
        {
          type: 'code',
          value: `import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// La tool que expone la consulta de estado al modelo.
// El modelo NO ejecuta nada: solo decide llamar y con que argumentos.
const tools = [
  {
    name: 'get_order_status',
    description:
      'Consulta el estado actual de un pedido por su numero. Usala siempre que el usuario pregunte por un pedido especifico; nunca inventes el estado.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: 'Numero de pedido, ej: PED-10293' },
      },
      required: ['order_id'],
    },
  },
];

// Ejecucion real de la tool en TU backend: consulta la fuente de verdad.
async function runTool(name, input) {
  if (name === 'get_order_status') {
    const order = await db.orders.findByPublicId(input.order_id);
    if (!order) return { found: false };
    return {
      found: true,
      status: order.status, // 'en_preparacion' | 'enviado' | 'entregado'
      carrier: order.carrier,
      eta: order.estimatedDelivery,
    };
  }
  throw new Error('Tool desconocida: ' + name);
}

async function ask(question) {
  const messages = [{ role: 'user', content: question }];

  // 1er turno: el modelo decide si llama a la tool.
  let res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    tools,
    messages,
  });

  // Mientras el modelo pida tools, ejecuta y devuelve el resultado.
  while (res.stop_reason === 'tool_use') {
    const toolUse = res.content.find((b) => b.type === 'tool_use');
    const result = await runTool(toolUse.name, toolUse.input);

    messages.push({ role: 'assistant', content: res.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        },
      ],
    });

    res = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 512,
      tools,
      messages,
    });
  }

  return res.content.find((b) => b.type === 'text')?.text;
}

// El modelo llama get_order_status('PED-10293'), recibe el estado FRESCO
// de la base y solo entonces redacta la respuesta. Nada se recupera por similitud.
await ask('Donde esta mi pedido PED-10293?');`,
        },
        {
          type: 'paragraph',
          value:
            'Fíjate en el punto que lo cambia todo: el dato del estado nunca pasó por embedding ni por vector store. El modelo solo decidió llamar a la función, tu backend consultó la base (la fuente de verdad) y el resultado volvió fresco para que el modelo redactara. Es imposible que el bot responda un estado desactualizado, porque no busca una versión vieja: provoca una consulta nueva en cada pregunta.',
        },
      ],
    },
    {
      title: 'Arquitectura combinada: rutea por intención',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un bot de atención real, las dos herramientas conviven: el mismo usuario pregunta "¿cuál es el plazo de cambio?" (RAG, conocimiento estable) y "¿dónde está mi pedido?" (function calling, dato vivo) en la misma conversación. La arquitectura robusta no elige una; rutea por intención. En la práctica moderna ni siquiera necesitas un clasificador separado: exponer tanto la base de conocimiento como las tools al mismo modelo lo deja decidir si recupera un documento o llama a una función.',
        },
        {
          type: 'ordered',
          items: [
            'Modela el conocimiento estable como RAG: políticas, FAQ, manuales se vuelven un corpus indexado o una tool de búsqueda semántica que retorna fragmentos con su fuente.',
            'Modela el dato vivo y las acciones como tools: estado, saldo, agendamiento, emisión. Cada tool tiene un schema explícito de argumentos y valida la entrada.',
            'Expone ambos al mismo modelo: dale tanto la búsqueda semántica como las tools transaccionales. Él decide, por pregunta, qué camino seguir.',
            'Valida los argumentos antes de ejecutar: nunca confíes ciegamente en los args generados. Verifica tipo, formato y permiso (¿el usuario puede ver ese pedido?) antes de tocar el backend.',
            'Registra la decisión: loguea si la respuesta vino de retrieval o de una tool, con los argumentos y el retorno. Eso es lo que hace el sistema auditable y depurable.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ganancia de esta arquitectura es que cada pregunta cae en la herramienta correcta por su naturaleza: conocimiento estable por RAG, dato vivo y acción por la tool. El bot deja de alucinar plazos de entrega porque nunca más intenta recuperar por similitud un valor que solo la base transaccional conoce.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Function calling sustituye a RAG?',
      answer:
        'No. Responden naturalezas distintas de pregunta. Function calling es para dato vivo (consultado o calculado ahora) y para acciones con efecto colateral; RAG es para conocimiento textual ya escrito que recuperas por similitud. Un bot de atención serio usa ambos: RAG para políticas y manuales, function calling para estado, saldo y agendamiento. La arquitectura ideal rutea por intención entre las dos.',
    },
    {
      question: '¿Cómo sabe el modelo qué tool llamar?',
      answer:
        'Por la descripción. Cada tool tiene un nombre, una descripción en lenguaje natural de lo que hace y un schema de los argumentos que acepta. El modelo lee esas descripciones junto con la pregunta y decide si alguna tool aplica y con qué argumentos llamarla. Por eso la calidad de la descripción importa tanto como el código: una descripción vaga lleva al modelo a llamar a la tool equivocada o a no llamarla cuando debería.',
    },
    {
      question: '¿Function calling es seguro para acciones que cambian datos?',
      answer:
        'Es seguro siempre que no confíes ciegamente en los argumentos generados por el modelo. El modelo decide llamar y sugiere los argumentos, pero quien ejecuta es tu backend. Antes de tocar la base, valida tipo y formato de los args, verifica el permiso del usuario sobre ese recurso y, para acciones de alto impacto, exige confirmación explícita. El modelo propone; tu código autoriza y ejecuta.',
    },
  ],
  conclusion: {
    title: 'Elige por la naturaleza del dato, no por la herramienta de moda',
    description:
      'RAG y function calling resuelven preguntas distintas: retrieval para conocimiento estable ya escrito, tool use para dato vivo y acciones que cambian el mundo. Puedo evaluar tu flujo de atención y diseñar la arquitectura correcta, ruteando cada pregunta hacia la herramienta que de verdad tiene la respuesta.',
    cta: 'Hablar sobre mi arquitectura de IA',
  },
  related: [
    { label: 'CAG vs RAG: cuándo el cache de contexto le gana al retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'RAG para atención en WhatsApp en producción', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'function-calling-vs-rag-example', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
