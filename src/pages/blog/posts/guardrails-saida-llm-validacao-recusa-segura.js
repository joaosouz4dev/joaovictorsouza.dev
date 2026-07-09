// Conteudo do artigo: guardrails de saida em LLM (validacao e recusa segura).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Camada minima de guardrails de saida para LLM: valida a resposta contra um schema, repara e faz retry com feedback estruturado, detecta recusa e vazamento de dado sensivel, bloqueia acao perigosa antes de executar e sempre entrega um fallback seguro em vez de propagar saida invalida para o usuario.',
  en: 'Minimal output-guardrail layer for LLMs: validates the response against a schema, repairs and retries with structured feedback, detects refusal and sensitive-data leakage, blocks a dangerous action before executing and always delivers a safe fallback instead of propagating invalid output to the user.',
  es: 'Capa minima de guardrails de salida para LLM: valida la respuesta contra un schema, repara y reintenta con feedback estructurado, detecta rechazo y filtracion de dato sensible, bloquea una accion peligrosa antes de ejecutar y siempre entrega un fallback seguro en vez de propagar salida invalida al usuario.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-output-guardrails-mini';

const pt = {
  intro:
    'A parte perigosa de um sistema com LLM nao e o prompt que entra, e a resposta que sai. O modelo pode devolver JSON quebrado que estoura o parser, inventar um campo que nunca existiu, vazar o CPF que estava no contexto, recusar uma pergunta legitima ou pedir para chamar uma tool destrutiva com argumento errado. Sem uma camada que inspeciona a saida antes de ela chegar ao usuario ou ao banco, cada uma dessas falhas vira bug de producao, incidente de privacidade ou acao irreversivel. Guardrails de saida sao essa camada: um conjunto de validacoes entre o modelo e o mundo que decide se a resposta pode passar, precisa ser reparada ou tem que ser bloqueada. Este artigo mostra como construir essa camada sem transformar o produto num labirinto de if: validacao de schema com reparo e retry, deteccao de recusa e de vazamento, bloqueio de acao perigosa antes da execucao, e a regra de ouro que amarra tudo, sempre ter um fallback seguro. O foco e o minimo que impede a saida ruim de virar dano real.',
  sections: [
    {
      title: 'Guardrail de entrada nao e guardrail de saida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusao mais comum e achar que validar o prompt de entrada resolve o problema. Nao resolve: sao dois riscos diferentes em momentos diferentes. O guardrail de entrada protege contra o que o usuario manda (prompt injection, pedido abusivo, conteudo proibido) e roda antes do modelo. O guardrail de saida protege contra o que o modelo devolve (formato invalido, alucinacao, vazamento, acao perigosa) e roda depois do modelo, antes de a resposta chegar ao usuario, ao banco ou a uma tool. Uma entrada perfeitamente valida pode gerar uma saida perigosa, porque o modelo e probabilistico e nao garante nada sobre o que produz.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto de instalacao importa: o guardrail de saida fica no caminho de retorno, envelopando a resposta do modelo como um interceptor. Nada que o modelo produz chega ao mundo externo sem passar por ele. A tabela abaixo separa os dois para deixar claro que um nao substitui o outro.',
        },
        {
          type: 'table',
          columns: ['Dimensao', 'Guardrail de entrada', 'Guardrail de saida'],
          rows: [
            [
              'Quando roda',
              'Antes de chamar o modelo',
              'Depois do modelo, antes do usuario/banco/tool',
            ],
            [
              'Protege contra',
              'Prompt injection, pedido abusivo, PII na entrada',
              'Formato invalido, alucinacao, vazamento, acao perigosa',
            ],
            [
              'Acao tipica',
              'Recusar, sanitizar, rotear',
              'Reparar, fazer retry, bloquear, fallback',
            ],
            [
              'Se falhar',
              'Modelo recebe entrada ruim',
              'Usuario recebe saida ruim (dano real)',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra pratica: guardrail de entrada reduz a chance de saida ruim, mas nunca a elimina. A validacao que de fato protege o usuario e a de saida, porque e a ultima antes do dano. Investir so na entrada e trancar a porta da frente e deixar a dos fundos aberta.',
        },
      ],
    },
    {
      title: 'Validacao de schema: o retry estruturado que conserta em vez de quebrar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O guardrail mais barato e mais rentavel e a validacao de schema. Quando a saida do modelo deveria ser JSON estruturado (para virar chamada de API, registro no banco ou decisao de fluxo), voce nao confia que veio certo, voce valida contra um schema. Mas o passo que separa um sistema fragil de um robusto e o que fazer quando a validacao falha: em vez de estourar um erro para o usuario, voce devolve o erro de validacao ao proprio modelo e pede para ele corrigir. O modelo que produziu o JSON quebrado quase sempre acerta na segunda tentativa quando recebe a mensagem exata do que estava errado.',
        },
        {
          type: 'code',
          value: `// guardrails/schema.js
// Valida a saida contra um schema e, se falhar, faz retry com o erro
// como feedback. O modelo conserta o proprio JSON com a mensagem exata.

export async function ensureValidOutput(callModel, { schema, maxRetries = 2 }) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // No retry, injeta o erro anterior como instrucao de correcao.
    const raw = await callModel(lastError ? feedbackFor(lastError) : null);

    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      lastError = { kind: 'parse', detail: parsed.error };
      continue; // JSON quebrado: tenta de novo com o erro de parse
    }

    const validation = schema.validate(parsed.value);
    if (!validation.ok) {
      lastError = { kind: 'schema', detail: validation.errors };
      continue; // schema invalido: tenta de novo listando os campos errados
    }

    return { ok: true, value: parsed.value };
  }

  // Esgotou o retry: NAO propaga saida invalida, sinaliza para o fallback.
  return { ok: false, error: lastError };
}

function feedbackFor(err) {
  return err.kind === 'parse'
    ? \`Sua resposta anterior nao era JSON valido: \${err.detail}. Responda apenas com JSON.\`
    : \`Sua resposta nao respeitou o schema. Corrija estes campos: \${JSON.stringify(err.detail)}.\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes fazem a diferenca. Primeiro, o retry tem limite: duas tentativas cobrem a esmagadora maioria dos casos, e insistir alem disso so queima token e latencia num modelo que nao vai convergir. Segundo, quando o retry esgota, o retorno nao e a saida invalida, e um sinal de falha que o fallback vai tratar. Propagar JSON quebrado depois de duas tentativas e trocar um erro controlado por um erro em producao.',
        },
      ],
    },
    {
      title: 'Detectar recusa indevida e recusa legitima',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda recusa e um problema, e nem toda resposta fluida esta correta. O modelo pode recusar uma pergunta perfeitamente legitima ("nao posso ajudar com isso") por excesso de zelo, e pode responder com confianca algo que deveria ter recusado. O guardrail de recusa mede esse eixo: ele classifica se a resposta e uma recusa e decide se aquela recusa faz sentido no contexto. Recusa em cima de pedido valido e degradacao de produto, o usuario bateu numa parede sem motivo. Ausencia de recusa em pedido perigoso e risco, o modelo passou por cima de um limite que deveria respeitar.',
        },
        {
          type: 'list',
          items: [
            'Detectar a recusa: procure os padroes de recusa da sua stack ("nao posso", "nao consigo ajudar", "isso vai contra") e trate como um sinal classificavel, nao como texto qualquer.',
            'Classificar o contexto: a pergunta era legitima? Se sim, uma recusa e falha, e o caminho e re-perguntar com prompt ajustado ou rotear para humano, nao devolver a parede ao usuario.',
            'Medir a taxa de recusa: recusa subindo de repente costuma ser prompt quebrado ou guardrail agressivo demais, e so aparece se voce conta as recusas como metrica.',
            'Nao suprimir recusa legitima: quando o modelo recusa algo que deve mesmo recusar, o guardrail confirma e registra, ele nao forca uma resposta que abriria um buraco de seguranca.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro classico e tratar recusa como falha sempre, e reescrever o prompt ate o modelo responder qualquer coisa. Isso quebra a recusa legitima e transforma o guardrail num vetor de ataque. A postura certa e distinguir: recusa indevida se conserta, recusa legitima se respeita. O guardrail nao existe para forcar resposta, existe para garantir que a decisao de responder ou nao esteja alinhada com o contexto.',
        },
      ],
    },
    {
      title: 'Vazamento de dado sensivel na saida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um risco silencioso: o contexto do modelo carrega dado sensivel (CPF, telefone, dado de outro usuario que entrou por engano no retrieval) e o modelo repete esse dado na resposta. A entrada estava sob controle, mas a saida vaza. O guardrail de vazamento inspeciona a resposta antes de entregar e bloqueia ou redige o que nao deveria sair. E a mesma logica da redacao de log, mas aqui o alvo e o que chega ao usuario final, entao a barra e mais alta: em log voce redige para nao persistir, na saida voce redige ou bloqueia para nao expor.',
        },
        {
          type: 'code',
          value: `// guardrails/leak.js
// Verifica se a resposta contem dado sensivel que nao deveria sair.
// Em vez de so mascarar, decide entre passar, redigir ou bloquear.

const SENSITIVE = [
  { name: 'cpf',   re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g },
  { name: 'card',  re: /\\b(?:\\d[ -]?){13,16}\\b/g },
  { name: 'email', re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g },
];

export function checkLeak(output, { allowed = [] }) {
  const found = [];
  for (const rule of SENSITIVE) {
    if (allowed.includes(rule.name)) continue; // ex.: email do proprio usuario pode
    if (rule.re.test(output)) found.push(rule.name);
  }

  if (found.length === 0) return { action: 'pass', output };

  // Dado sensivel que o usuario nao deveria ver: bloqueia, nao arrisca.
  // Dado que so precisa ser ocultado: redige e deixa passar.
  const critical = found.some((f) => f === 'cpf' || f === 'card');
  if (critical) return { action: 'block', leaked: found };

  const redacted = SENSITIVE.reduce(
    (acc, r) => (allowed.includes(r.name) ? acc : acc.replace(r.re, \`[\${r.name.toUpperCase()}]\`)),
    output,
  );
  return { action: 'redact', output: redacted, leaked: found };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A decisao entre redigir e bloquear e o que separa um guardrail util de um perigoso. Mascarar um email num texto que ainda faz sentido e razoavel. Mas quando a resposta inteira gira em torno de um dado que vazou por engano (o modelo confundiu o pedido de um usuario com o cadastro de outro), redigir deixa passar uma resposta sem sentido e potencialmente incriminadora. Nesse caso, bloquear e cair no fallback e mais seguro do que entregar algo mutilado.',
        },
      ],
    },
    {
      title: 'Bloquear acao perigosa antes de executar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O guardrail mais critico e o que fica entre o modelo e uma acao com efeito colateral. Quando o LLM decide chamar uma tool (cancelar pedido, emitir reembolso, apagar registro, disparar mensagem em massa), a saida do modelo deixa de ser texto e vira comando. Um argumento alucinado, um id errado ou um valor fora de faixa nao geram uma resposta ruim, geram uma acao irreversivel. Aqui a saida do modelo e uma proposta de acao, e o guardrail e a aprovacao: valida os argumentos, checa limites e politicas, e so entao deixa executar.',
        },
        {
          type: 'code',
          value: `// guardrails/action.js
// A saida do modelo (tool call) e uma PROPOSTA. O guardrail valida
// argumentos e politica antes de deixar a acao rodar de verdade.

const POLICIES = {
  refund: { maxAmount: 500, requiresOrderId: true },
  bulkMessage: { maxRecipients: 100 },
};

export function authorizeAction(action) {
  const policy = POLICIES[action.name];
  if (!policy) return { ok: false, reason: 'acao desconhecida: nega por padrao' };

  // Argumento fora da faixa vira bloqueio, nunca execucao.
  if (policy.maxAmount != null && action.args.amount > policy.maxAmount) {
    return { ok: false, reason: \`valor \${action.args.amount} acima do limite \${policy.maxAmount}\` };
  }
  if (policy.requiresOrderId && !action.args.orderId) {
    return { ok: false, reason: 'reembolso sem orderId: exige revisao humana' };
  }
  if (policy.maxRecipients != null && action.args.recipients?.length > policy.maxRecipients) {
    return { ok: false, reason: 'disparo acima do limite: rotear para aprovacao' };
  }

  return { ok: true }; // dentro da politica: pode executar
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois principios sustentam esse guardrail. Negar por padrao: uma acao que nao esta na tabela de politicas nao executa, porque o modelo pode inventar um nome de tool que voce nunca definiu. E escalar em vez de simplesmente falhar: reembolso acima do limite ou disparo em massa nao viram erro seco, viram um pedido de aprovacao humana. O guardrail nao existe so para dizer nao, existe para rotear a decisao para quem tem autoridade quando o modelo esta fora da alcada.',
        },
      ],
    },
    {
      title: 'Fallback seguro: a regra de ouro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo guardrail acima compartilha a mesma regra de ouro: quando algo da errado, a saida nunca e a resposta ruim, e sempre um fallback seguro. Schema que nao valida depois do retry, recusa que nao se conserta, vazamento critico, acao fora da politica, todos convergem para o mesmo lugar, uma resposta controlada que voce escreveu, nao uma que o modelo alucinou. O anti-padrao e deixar a falha vazar como erro tecnico (stack trace, 500, JSON quebrado na tela) ou, pior, deixar a saida ruim passar porque o guardrail so logou e nao bloqueou.',
        },
        {
          type: 'diagram',
          value: `Caminho da saida do modelo pelos guardrails

  resposta do modelo
        |
        v
  [ schema valido? ] --nao--> retry (ate 2x) --falhou--> FALLBACK
        | sim
        v
  [ e recusa? ] --sim--> legitima? --nao--> re-perguntar / humano
        | nao (ou legitima)
        v
  [ vaza dado sensivel? ] --critico--> BLOQUEIA --> FALLBACK
        |                --redige--> segue com texto redigido
        v
  [ e acao? ] --fora da politica--> BLOQUEIA --> aprovacao humana
        | dentro da politica
        v
  entrega ao usuario / executa a acao

  FALLBACK = resposta segura escrita por voce, nunca erro cru na tela`,
        },
        {
          type: 'paragraph',
          value:
            'O fallback certo depende do contexto: numa resposta de texto, e uma mensagem honesta ("nao consegui gerar uma resposta confiavel agora, vou te transferir"); numa chamada de tool, e nao executar e escalar; num fluxo automatico, e parar e alertar em vez de seguir com dado suspeito. O que ele nunca e: um erro tecnico jogado na cara do usuario ou uma saida invalida que passou porque ninguem bloqueou. A diferenca entre um sistema que degrada com dignidade e um que quebra feio esta inteira nessa decisao.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe operacional fecha o ciclo: todo acionamento de fallback e um evento que voce quer contar. Fallback subindo e o sinal mais direto de que o modelo, o prompt ou o schema mudaram de comportamento, e conecta o guardrail a observabilidade, o assunto do artigo relacionado. Guardrail sem metrica de acionamento e uma rede de seguranca que voce nao sabe se esta segurando alguem.',
        },
      ],
    },
    {
      title: 'Montar a camada sem virar labirinto de if',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A armadilha e espalhar validacao por todo o codigo em ifs soltos, ate ninguem saber mais qual regra roda quando. A camada de guardrails deve ser uma esteira ordenada e centralizada: a saida do modelo entra por uma ponta, passa pelos guardrails na ordem certa, e sai validada pela outra, ou cai no fallback. Cada guardrail e uma funcao pequena e testavel isoladamente; a esteira apenas os encadeia. O caminho e adicionar por ordem de risco.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pela validacao de schema com retry: e o mais barato, o mais frequente e o que mais evita bug bobo de parser em producao.',
            'Adicione o fallback seguro logo em seguida: sem ele, os outros guardrails so trocam um erro por outro; com ele, toda falha tem destino controlado.',
            'Ligue o guardrail de acao antes de qualquer tool com efeito colateral: aqui o custo de errar e irreversivel, entao ele nao e opcional.',
            'Instrumente o guardrail de vazamento onde a resposta contem dado do usuario: quanto mais sensivel o dominio, mais cedo ele entra.',
            'Coloque a deteccao de recusa por ultimo e conecte tudo a metricas: acionamento de cada guardrail vira linha no dashboard, e o baseline revela quando algo mudou.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferenca entre um sistema com LLM que da confianca e um que assusta esta em quem controla a saida. Sem guardrails, e o modelo, probabilistico e sem garantia, que decide o que chega ao usuario e ao banco. Com guardrails, o modelo propoe e a sua camada dispoe: valida, repara, bloqueia ou cai no fallback, mas nunca deixa a saida ruim virar dano. Poucas centenas de linhas de guardrail bem colocadas separam um piloto que voce nao poe na frente do cliente de um produto que aguenta producao.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Guardrail de saida nao e a mesma coisa que validar o prompt de entrada?',
      answer:
        'Nao. Sao dois controles em momentos diferentes. O guardrail de entrada roda antes do modelo e protege contra o que o usuario manda (prompt injection, pedido abusivo). O guardrail de saida roda depois do modelo e protege contra o que ele devolve (formato invalido, alucinacao, vazamento, acao perigosa). Uma entrada perfeitamente valida pode gerar uma saida perigosa, porque o modelo e probabilistico. A validacao que de fato protege o usuario e a de saida, porque e a ultima antes do dano chegar ao banco, a uma tool ou a tela.',
    },
    {
      question: 'Por que fazer retry em vez de so retornar erro quando o schema falha?',
      answer:
        'Porque o modelo que produziu o JSON quebrado quase sempre acerta na segunda tentativa quando recebe a mensagem exata do que estava errado. Retornar erro na primeira falha desperdicaria uma correcao facil e barata. A chave e o retry ser estruturado (voce injeta o erro de validacao como feedback) e limitado (duas tentativas cobrem quase tudo; insistir alem disso so queima token). E, quando o retry esgota, o retorno nao e a saida invalida, e um sinal de falha que cai no fallback seguro, nunca JSON quebrado propagado para o usuario.',
    },
    {
      question: 'O guardrail deve sempre bloquear quando encontra dado sensivel na saida?',
      answer:
        'Nao sempre; depende do dado e do papel dele na resposta. Se e um dado que so precisa ser ocultado e a resposta continua fazendo sentido sem ele, redigir (mascarar) e suficiente. Mas se o dado e critico (CPF, cartao) ou se a resposta inteira gira em torno de um dado que vazou por engano, redigir deixaria passar algo sem sentido ou incriminador, entao o certo e bloquear e cair no fallback. A regra: redija quando ocultar preserva a resposta, bloqueie quando o vazamento contamina a resposta toda.',
    },
  ],
  conclusion: {
    title: 'Guardrails de saida sao o que impede a resposta ruim de virar dano real',
    description:
      'Validacao de schema com retry, deteccao de recusa e vazamento, bloqueio de acao perigosa e fallback seguro sao o minimo para que nada que o modelo produz chegue ao usuario ou ao banco sem passar por um controle. Posso desenhar essa camada no seu produto, encadeada e observavel, do schema ao fallback, integrada ao seu stack.',
    cta: 'Falar sobre guardrails no meu sistema de IA',
  },
  related: [
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Avaliacao continua de bots: do eval manual ao automatico', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-output-guardrails-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The dangerous part of an LLM system is not the prompt that goes in, it is the response that comes out. The model can return broken JSON that blows up the parser, invent a field that never existed, leak the ID number that was in the context, refuse a legitimate question or ask to call a destructive tool with the wrong argument. Without a layer that inspects the output before it reaches the user or the database, each of these failures becomes a production bug, a privacy incident or an irreversible action. Output guardrails are that layer: a set of validations between the model and the world that decides whether the response can pass, needs to be repaired or has to be blocked. This article shows how to build that layer without turning the product into a maze of ifs: schema validation with repair and retry, refusal and leakage detection, blocking a dangerous action before execution, and the golden rule that ties it all together, always have a safe fallback. The focus is the minimum that stops a bad output from becoming real harm.',
  sections: [
    {
      title: 'An input guardrail is not an output guardrail',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common confusion is thinking that validating the input prompt solves the problem. It does not: they are two different risks at two different moments. The input guardrail protects against what the user sends (prompt injection, abusive request, forbidden content) and runs before the model. The output guardrail protects against what the model returns (invalid format, hallucination, leakage, dangerous action) and runs after the model, before the response reaches the user, the database or a tool. A perfectly valid input can produce a dangerous output, because the model is probabilistic and guarantees nothing about what it produces.',
        },
        {
          type: 'paragraph',
          value:
            'The install point matters: the output guardrail sits on the return path, wrapping the model response like an interceptor. Nothing the model produces reaches the outside world without passing through it. The table below separates the two to make clear that one does not replace the other.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Input guardrail', 'Output guardrail'],
          rows: [
            [
              'When it runs',
              'Before calling the model',
              'After the model, before user/database/tool',
            ],
            [
              'Protects against',
              'Prompt injection, abusive request, PII in the input',
              'Invalid format, hallucination, leakage, dangerous action',
            ],
            [
              'Typical action',
              'Refuse, sanitize, route',
              'Repair, retry, block, fallback',
            ],
            [
              'If it fails',
              'Model receives bad input',
              'User receives bad output (real harm)',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical rule: an input guardrail reduces the chance of bad output, but never eliminates it. The validation that actually protects the user is the output one, because it is the last one before the harm. Investing only in the input is locking the front door and leaving the back one open.',
        },
      ],
    },
    {
      title: 'Schema validation: the structured retry that repairs instead of breaking',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The cheapest and most rewarding guardrail is schema validation. When the model output should be structured JSON (to become an API call, a database record or a flow decision), you do not trust that it came out right, you validate it against a schema. But the step that separates a fragile system from a robust one is what you do when validation fails: instead of throwing an error at the user, you return the validation error to the model itself and ask it to fix it. The model that produced the broken JSON almost always gets it right on the second try when it receives the exact message of what was wrong.',
        },
        {
          type: 'code',
          value: `// guardrails/schema.js
// Validates the output against a schema and, on failure, retries with the
// error as feedback. The model fixes its own JSON with the exact message.

export async function ensureValidOutput(callModel, { schema, maxRetries = 2 }) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // On retry, inject the previous error as a correction instruction.
    const raw = await callModel(lastError ? feedbackFor(lastError) : null);

    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      lastError = { kind: 'parse', detail: parsed.error };
      continue; // broken JSON: try again with the parse error
    }

    const validation = schema.validate(parsed.value);
    if (!validation.ok) {
      lastError = { kind: 'schema', detail: validation.errors };
      continue; // invalid schema: try again listing the wrong fields
    }

    return { ok: true, value: parsed.value };
  }

  // Retries exhausted: do NOT propagate invalid output, signal the fallback.
  return { ok: false, error: lastError };
}

function feedbackFor(err) {
  return err.kind === 'parse'
    ? \`Your previous response was not valid JSON: \${err.detail}. Reply with JSON only.\`
    : \`Your response did not match the schema. Fix these fields: \${JSON.stringify(err.detail)}.\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details make the difference. First, the retry has a limit: two attempts cover the vast majority of cases, and insisting beyond that only burns tokens and latency on a model that will not converge. Second, when the retry runs out, the return is not the invalid output, it is a failure signal for the fallback to handle. Propagating broken JSON after two attempts is trading a controlled error for a production one.',
        },
      ],
    },
    {
      title: 'Detecting improper refusal and legitimate refusal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every refusal is a problem, and not every fluent response is correct. The model can refuse a perfectly legitimate question ("I cannot help with that") out of excessive caution, and it can confidently answer something it should have refused. The refusal guardrail measures that axis: it classifies whether the response is a refusal and decides whether that refusal makes sense in context. A refusal on a valid request is product degradation, the user hit a wall for no reason. Absence of refusal on a dangerous request is risk, the model crossed a line it should have respected.',
        },
        {
          type: 'list',
          items: [
            'Detect the refusal: look for your stack refusal patterns ("I cannot", "I am unable to help", "that goes against") and treat it as a classifiable signal, not just any text.',
            'Classify the context: was the request legitimate? If so, a refusal is a failure, and the path is to re-ask with an adjusted prompt or route to a human, not hand the wall back to the user.',
            'Measure the refusal rate: a sudden rise in refusals is usually a broken prompt or an overly aggressive guardrail, and it only shows up if you count refusals as a metric.',
            'Do not suppress legitimate refusal: when the model refuses something it should indeed refuse, the guardrail confirms and records it, it does not force a response that would open a security hole.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The classic mistake is treating refusal as failure every time, and rewriting the prompt until the model answers anything. That breaks legitimate refusal and turns the guardrail into an attack vector. The right stance is to distinguish: improper refusal gets fixed, legitimate refusal gets respected. The guardrail does not exist to force a response, it exists to ensure the decision to answer or not is aligned with the context.',
        },
      ],
    },
    {
      title: 'Sensitive-data leakage in the output',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A silent risk: the model context carries sensitive data (ID number, phone, another user data that entered the retrieval by mistake) and the model repeats that data in the response. The input was under control, but the output leaks. The leakage guardrail inspects the response before delivery and blocks or redacts what should not go out. It is the same logic as log redaction, but here the target is what reaches the end user, so the bar is higher: in a log you redact so as not to persist, in the output you redact or block so as not to expose.',
        },
        {
          type: 'code',
          value: `// guardrails/leak.js
// Checks whether the response contains sensitive data that should not go out.
// Instead of just masking, it decides between pass, redact or block.

const SENSITIVE = [
  { name: 'ssn',   re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g },
  { name: 'card',  re: /\\b(?:\\d[ -]?){13,16}\\b/g },
  { name: 'email', re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g },
];

export function checkLeak(output, { allowed = [] }) {
  const found = [];
  for (const rule of SENSITIVE) {
    if (allowed.includes(rule.name)) continue; // e.g. the user own email is fine
    if (rule.re.test(output)) found.push(rule.name);
  }

  if (found.length === 0) return { action: 'pass', output };

  // Sensitive data the user should not see: block, do not risk it.
  // Data that only needs hiding: redact and let it pass.
  const critical = found.some((f) => f === 'ssn' || f === 'card');
  if (critical) return { action: 'block', leaked: found };

  const redacted = SENSITIVE.reduce(
    (acc, r) => (allowed.includes(r.name) ? acc : acc.replace(r.re, \`[\${r.name.toUpperCase()}]\`)),
    output,
  );
  return { action: 'redact', output: redacted, leaked: found };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The choice between redacting and blocking is what separates a useful guardrail from a dangerous one. Masking an email in a text that still makes sense is reasonable. But when the whole response revolves around a piece of data that leaked by mistake (the model confused one user request with another user record), redacting lets a meaningless and potentially incriminating response through. In that case, blocking and falling into the fallback is safer than delivering something mutilated.',
        },
      ],
    },
    {
      title: 'Blocking a dangerous action before execution',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most critical guardrail is the one that sits between the model and an action with a side effect. When the LLM decides to call a tool (cancel an order, issue a refund, delete a record, fire a mass message), the model output stops being text and becomes a command. A hallucinated argument, a wrong ID or an out-of-range value do not generate a bad response, they generate an irreversible action. Here the model output is a proposed action, and the guardrail is the approval: it validates the arguments, checks limits and policies, and only then lets it execute.',
        },
        {
          type: 'code',
          value: `// guardrails/action.js
// The model output (tool call) is a PROPOSAL. The guardrail validates
// arguments and policy before letting the action actually run.

const POLICIES = {
  refund: { maxAmount: 500, requiresOrderId: true },
  bulkMessage: { maxRecipients: 100 },
};

export function authorizeAction(action) {
  const policy = POLICIES[action.name];
  if (!policy) return { ok: false, reason: 'unknown action: deny by default' };

  // An out-of-range argument becomes a block, never an execution.
  if (policy.maxAmount != null && action.args.amount > policy.maxAmount) {
    return { ok: false, reason: \`amount \${action.args.amount} above limit \${policy.maxAmount}\` };
  }
  if (policy.requiresOrderId && !action.args.orderId) {
    return { ok: false, reason: 'refund without orderId: requires human review' };
  }
  if (policy.maxRecipients != null && action.args.recipients?.length > policy.maxRecipients) {
    return { ok: false, reason: 'send above limit: route to approval' };
  }

  return { ok: true }; // within policy: may execute
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two principles hold this guardrail up. Deny by default: an action that is not in the policy table does not execute, because the model can invent a tool name you never defined. And escalate instead of simply failing: a refund above the limit or a mass send do not become a dry error, they become a request for human approval. The guardrail does not exist only to say no, it exists to route the decision to whoever has authority when the model is out of its lane.',
        },
      ],
    },
    {
      title: 'Safe fallback: the golden rule',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every guardrail above shares the same golden rule: when something goes wrong, the output is never the bad response, it is always a safe fallback. A schema that does not validate after the retry, a refusal that does not fix, a critical leak, an action outside the policy, all converge to the same place, a controlled response you wrote, not one the model hallucinated. The anti-pattern is letting the failure leak as a technical error (stack trace, 500, broken JSON on the screen) or, worse, letting the bad output through because the guardrail only logged it and did not block.',
        },
        {
          type: 'diagram',
          value: `Path of the model output through the guardrails

  model response
        |
        v
  [ valid schema? ] --no--> retry (up to 2x) --failed--> FALLBACK
        | yes
        v
  [ is it a refusal? ] --yes--> legitimate? --no--> re-ask / human
        | no (or legitimate)
        v
  [ leaks sensitive data? ] --critical--> BLOCK --> FALLBACK
        |                --redact--> continue with redacted text
        v
  [ is it an action? ] --outside policy--> BLOCK --> human approval
        | within policy
        v
  deliver to user / execute the action

  FALLBACK = safe response written by you, never a raw error on the screen`,
        },
        {
          type: 'paragraph',
          value:
            'The right fallback depends on the context: in a text response, it is an honest message ("I could not generate a reliable answer right now, I will transfer you"); in a tool call, it is not executing and escalating; in an automated flow, it is stopping and alerting instead of proceeding with suspect data. What it never is: a technical error thrown in the user face or an invalid output that got through because no one blocked it. The difference between a system that degrades with dignity and one that breaks ugly lives entirely in that decision.',
        },
        {
          type: 'paragraph',
          value:
            'One operational detail closes the loop: every fallback trigger is an event you want to count. A rising fallback rate is the most direct signal that the model, the prompt or the schema changed behavior, and it connects the guardrail to observability, the topic of the related article. A guardrail without a trigger metric is a safety net you do not know is holding anyone.',
        },
      ],
    },
    {
      title: 'Building the layer without a maze of ifs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The trap is scattering validation all over the code in loose ifs, until no one knows which rule runs when. The guardrail layer should be an ordered, centralized pipeline: the model output enters at one end, passes through the guardrails in the right order, and comes out validated at the other, or falls into the fallback. Each guardrail is a small function testable in isolation; the pipeline just chains them. The path is to add in order of risk.',
        },
        {
          type: 'ordered',
          items: [
            'Start with schema validation with retry: it is the cheapest, the most frequent and the one that most avoids silly parser bugs in production.',
            'Add the safe fallback right after: without it, the other guardrails just trade one error for another; with it, every failure has a controlled destination.',
            'Turn on the action guardrail before any tool with a side effect: here the cost of being wrong is irreversible, so it is not optional.',
            'Instrument the leakage guardrail where the response contains user data: the more sensitive the domain, the earlier it enters.',
            'Put refusal detection last and connect everything to metrics: each guardrail trigger becomes a line on the dashboard, and the baseline reveals when something changed.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between an LLM system that inspires confidence and one that scares is in who controls the output. Without guardrails, it is the model, probabilistic and without guarantees, that decides what reaches the user and the database. With guardrails, the model proposes and your layer disposes: it validates, repairs, blocks or falls into the fallback, but never lets a bad output become harm. A few hundred lines of well-placed guardrail separate a pilot you would not put in front of a customer from a product that survives production.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is an output guardrail not the same as validating the input prompt?',
      answer:
        'No. They are two controls at two different moments. The input guardrail runs before the model and protects against what the user sends (prompt injection, abusive request). The output guardrail runs after the model and protects against what it returns (invalid format, hallucination, leakage, dangerous action). A perfectly valid input can produce a dangerous output, because the model is probabilistic. The validation that actually protects the user is the output one, because it is the last one before the harm reaches the database, a tool or the screen.',
    },
    {
      question: 'Why retry instead of just returning an error when the schema fails?',
      answer:
        'Because the model that produced the broken JSON almost always gets it right on the second try when it receives the exact message of what was wrong. Returning an error on the first failure would waste an easy, cheap correction. The key is for the retry to be structured (you inject the validation error as feedback) and bounded (two attempts cover almost everything; insisting beyond that only burns tokens). And when the retry runs out, the return is not the invalid output, it is a failure signal that falls into the safe fallback, never broken JSON propagated to the user.',
    },
    {
      question: 'Should the guardrail always block when it finds sensitive data in the output?',
      answer:
        'Not always; it depends on the data and its role in the response. If it is data that only needs hiding and the response still makes sense without it, redacting (masking) is enough. But if the data is critical (ID number, card) or the whole response revolves around a piece of data that leaked by mistake, redacting would let something meaningless or incriminating through, so the right move is to block and fall into the fallback. The rule: redact when hiding preserves the response, block when the leak contaminates the whole response.',
    },
  ],
  conclusion: {
    title: 'Output guardrails are what stop a bad response from becoming real harm',
    description:
      'Schema validation with retry, refusal and leakage detection, blocking a dangerous action and a safe fallback are the minimum so that nothing the model produces reaches the user or the database without passing through a control. I can design that layer in your product, chained and observable, from the schema to the fallback, integrated into your stack.',
    cta: 'Talk about guardrails in my AI system',
  },
  related: [
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-output-guardrails-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'La parte peligrosa de un sistema con LLM no es el prompt que entra, es la respuesta que sale. El modelo puede devolver JSON roto que revienta el parser, inventar un campo que nunca existio, filtrar el documento que estaba en el contexto, rechazar una pregunta legitima o pedir llamar a una tool destructiva con el argumento equivocado. Sin una capa que inspecciona la salida antes de que llegue al usuario o a la base de datos, cada una de esas fallas se vuelve bug de produccion, incidente de privacidad o accion irreversible. Los guardrails de salida son esa capa: un conjunto de validaciones entre el modelo y el mundo que decide si la respuesta puede pasar, necesita repararse o hay que bloquearla. Este articulo muestra como construir esa capa sin volver el producto un laberinto de if: validacion de schema con reparacion y retry, deteccion de rechazo y de filtracion, bloqueo de accion peligrosa antes de ejecutar, y la regla de oro que amarra todo, siempre tener un fallback seguro. El foco es el minimo que impide que una salida mala se vuelva dano real.',
  sections: [
    {
      title: 'Un guardrail de entrada no es un guardrail de salida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusion mas comun es creer que validar el prompt de entrada resuelve el problema. No lo resuelve: son dos riesgos distintos en momentos distintos. El guardrail de entrada protege contra lo que el usuario manda (prompt injection, pedido abusivo, contenido prohibido) y corre antes del modelo. El guardrail de salida protege contra lo que el modelo devuelve (formato invalido, alucinacion, filtracion, accion peligrosa) y corre despues del modelo, antes de que la respuesta llegue al usuario, a la base de datos o a una tool. Una entrada perfectamente valida puede generar una salida peligrosa, porque el modelo es probabilistico y no garantiza nada sobre lo que produce.',
        },
        {
          type: 'paragraph',
          value:
            'El punto de instalacion importa: el guardrail de salida esta en el camino de retorno, envolviendo la respuesta del modelo como un interceptor. Nada que el modelo produce llega al mundo externo sin pasar por el. La tabla de abajo separa los dos para dejar claro que uno no reemplaza al otro.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Guardrail de entrada', 'Guardrail de salida'],
          rows: [
            [
              'Cuando corre',
              'Antes de llamar al modelo',
              'Despues del modelo, antes del usuario/base/tool',
            ],
            [
              'Protege contra',
              'Prompt injection, pedido abusivo, PII en la entrada',
              'Formato invalido, alucinacion, filtracion, accion peligrosa',
            ],
            [
              'Accion tipica',
              'Rechazar, sanitizar, rutear',
              'Reparar, retry, bloquear, fallback',
            ],
            [
              'Si falla',
              'El modelo recibe entrada mala',
              'El usuario recibe salida mala (dano real)',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla practica: un guardrail de entrada reduce la probabilidad de salida mala, pero nunca la elimina. La validacion que de verdad protege al usuario es la de salida, porque es la ultima antes del dano. Invertir solo en la entrada es trancar la puerta del frente y dejar la de atras abierta.',
        },
      ],
    },
    {
      title: 'Validacion de schema: el retry estructurado que repara en vez de romper',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El guardrail mas barato y mas rentable es la validacion de schema. Cuando la salida del modelo deberia ser JSON estructurado (para volverse llamada de API, registro en la base o decision de flujo), no confias en que salio bien, la validas contra un schema. Pero el paso que separa un sistema fragil de uno robusto es que haces cuando la validacion falla: en vez de reventar un error al usuario, devuelves el error de validacion al propio modelo y le pides que lo corrija. El modelo que produjo el JSON roto casi siempre acierta en el segundo intento cuando recibe el mensaje exacto de lo que estaba mal.',
        },
        {
          type: 'code',
          value: `// guardrails/schema.js
// Valida la salida contra un schema y, si falla, reintenta con el error
// como feedback. El modelo repara su propio JSON con el mensaje exacto.

export async function ensureValidOutput(callModel, { schema, maxRetries = 2 }) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // En el retry, inyecta el error anterior como instruccion de correccion.
    const raw = await callModel(lastError ? feedbackFor(lastError) : null);

    const parsed = tryParseJson(raw);
    if (!parsed.ok) {
      lastError = { kind: 'parse', detail: parsed.error };
      continue; // JSON roto: intenta de nuevo con el error de parse
    }

    const validation = schema.validate(parsed.value);
    if (!validation.ok) {
      lastError = { kind: 'schema', detail: validation.errors };
      continue; // schema invalido: intenta de nuevo listando los campos malos
    }

    return { ok: true, value: parsed.value };
  }

  // Retries agotados: NO propaga salida invalida, senala el fallback.
  return { ok: false, error: lastError };
}

function feedbackFor(err) {
  return err.kind === 'parse'
    ? \`Tu respuesta anterior no era JSON valido: \${err.detail}. Responde solo con JSON.\`
    : \`Tu respuesta no respeto el schema. Corrige estos campos: \${JSON.stringify(err.detail)}.\`;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles hacen la diferencia. Primero, el retry tiene limite: dos intentos cubren la abrumadora mayoria de los casos, e insistir mas alla solo quema tokens y latencia en un modelo que no va a converger. Segundo, cuando el retry se agota, el retorno no es la salida invalida, es una senal de falla que el fallback va a tratar. Propagar JSON roto despues de dos intentos es cambiar un error controlado por uno de produccion.',
        },
      ],
    },
    {
      title: 'Detectar rechazo indebido y rechazo legitimo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todo rechazo es un problema, y no toda respuesta fluida es correcta. El modelo puede rechazar una pregunta perfectamente legitima ("no puedo ayudar con eso") por exceso de celo, y puede responder con confianza algo que deberia haber rechazado. El guardrail de rechazo mide ese eje: clasifica si la respuesta es un rechazo y decide si ese rechazo tiene sentido en el contexto. Rechazo sobre un pedido valido es degradacion de producto, el usuario choco con una pared sin motivo. Ausencia de rechazo en un pedido peligroso es riesgo, el modelo paso por encima de un limite que deberia respetar.',
        },
        {
          type: 'list',
          items: [
            'Detectar el rechazo: busca los patrones de rechazo de tu stack ("no puedo", "no consigo ayudar", "eso va contra") y tratalo como una senal clasificable, no como texto cualquiera.',
            'Clasificar el contexto: la pregunta era legitima? Si lo era, un rechazo es falla, y el camino es re-preguntar con prompt ajustado o rutear a humano, no devolver la pared al usuario.',
            'Medir la tasa de rechazo: un rechazo subiendo de repente suele ser prompt roto o guardrail demasiado agresivo, y solo aparece si cuentas los rechazos como metrica.',
            'No suprimir rechazo legitimo: cuando el modelo rechaza algo que si debe rechazar, el guardrail lo confirma y registra, no fuerza una respuesta que abriria un hueco de seguridad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error clasico es tratar el rechazo como falla siempre, y reescribir el prompt hasta que el modelo responda cualquier cosa. Eso rompe el rechazo legitimo y convierte el guardrail en un vector de ataque. La postura correcta es distinguir: rechazo indebido se repara, rechazo legitimo se respeta. El guardrail no existe para forzar respuesta, existe para garantizar que la decision de responder o no este alineada con el contexto.',
        },
      ],
    },
    {
      title: 'Filtracion de dato sensible en la salida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un riesgo silencioso: el contexto del modelo carga dato sensible (documento, telefono, dato de otro usuario que entro por error en el retrieval) y el modelo repite ese dato en la respuesta. La entrada estaba bajo control, pero la salida filtra. El guardrail de filtracion inspecciona la respuesta antes de entregar y bloquea o redacta lo que no deberia salir. Es la misma logica de la redaccion de log, pero aqui el objetivo es lo que llega al usuario final, asi que la vara es mas alta: en un log redactas para no persistir, en la salida redactas o bloqueas para no exponer.',
        },
        {
          type: 'code',
          value: `// guardrails/leak.js
// Verifica si la respuesta contiene dato sensible que no deberia salir.
// En vez de solo enmascarar, decide entre pasar, redactar o bloquear.

const SENSITIVE = [
  { name: 'documento', re: /\\b\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}\\b/g },
  { name: 'card',      re: /\\b(?:\\d[ -]?){13,16}\\b/g },
  { name: 'email',     re: /[\\w.+-]+@[\\w-]+\\.[\\w.-]+/g },
];

export function checkLeak(output, { allowed = [] }) {
  const found = [];
  for (const rule of SENSITIVE) {
    if (allowed.includes(rule.name)) continue; // ej.: el email del propio usuario puede
    if (rule.re.test(output)) found.push(rule.name);
  }

  if (found.length === 0) return { action: 'pass', output };

  // Dato sensible que el usuario no deberia ver: bloquea, no arriesga.
  // Dato que solo necesita ocultarse: redacta y deja pasar.
  const critical = found.some((f) => f === 'documento' || f === 'card');
  if (critical) return { action: 'block', leaked: found };

  const redacted = SENSITIVE.reduce(
    (acc, r) => (allowed.includes(r.name) ? acc : acc.replace(r.re, \`[\${r.name.toUpperCase()}]\`)),
    output,
  );
  return { action: 'redact', output: redacted, leaked: found };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La decision entre redactar y bloquear es lo que separa un guardrail util de uno peligroso. Enmascarar un email en un texto que aun tiene sentido es razonable. Pero cuando la respuesta entera gira en torno a un dato que se filtro por error (el modelo confundio el pedido de un usuario con el registro de otro), redactar deja pasar una respuesta sin sentido y potencialmente incriminadora. En ese caso, bloquear y caer en el fallback es mas seguro que entregar algo mutilado.',
        },
      ],
    },
    {
      title: 'Bloquear una accion peligrosa antes de ejecutar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El guardrail mas critico es el que esta entre el modelo y una accion con efecto colateral. Cuando el LLM decide llamar a una tool (cancelar pedido, emitir reembolso, borrar registro, disparar mensaje masivo), la salida del modelo deja de ser texto y se vuelve comando. Un argumento alucinado, un id equivocado o un valor fuera de rango no generan una respuesta mala, generan una accion irreversible. Aqui la salida del modelo es una propuesta de accion, y el guardrail es la aprobacion: valida los argumentos, chequea limites y politicas, y solo entonces deja ejecutar.',
        },
        {
          type: 'code',
          value: `// guardrails/action.js
// La salida del modelo (tool call) es una PROPUESTA. El guardrail valida
// argumentos y politica antes de dejar que la accion corra de verdad.

const POLICIES = {
  refund: { maxAmount: 500, requiresOrderId: true },
  bulkMessage: { maxRecipients: 100 },
};

export function authorizeAction(action) {
  const policy = POLICIES[action.name];
  if (!policy) return { ok: false, reason: 'accion desconocida: niega por defecto' };

  // Un argumento fuera de rango se vuelve bloqueo, nunca ejecucion.
  if (policy.maxAmount != null && action.args.amount > policy.maxAmount) {
    return { ok: false, reason: \`valor \${action.args.amount} sobre el limite \${policy.maxAmount}\` };
  }
  if (policy.requiresOrderId && !action.args.orderId) {
    return { ok: false, reason: 'reembolso sin orderId: exige revision humana' };
  }
  if (policy.maxRecipients != null && action.args.recipients?.length > policy.maxRecipients) {
    return { ok: false, reason: 'disparo sobre el limite: rutear a aprobacion' };
  }

  return { ok: true }; // dentro de la politica: puede ejecutar
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos principios sostienen este guardrail. Negar por defecto: una accion que no esta en la tabla de politicas no ejecuta, porque el modelo puede inventar un nombre de tool que nunca definiste. Y escalar en vez de simplemente fallar: un reembolso sobre el limite o un disparo masivo no se vuelven un error seco, se vuelven un pedido de aprobacion humana. El guardrail no existe solo para decir no, existe para rutear la decision a quien tiene autoridad cuando el modelo esta fuera de su alcance.',
        },
      ],
    },
    {
      title: 'Fallback seguro: la regla de oro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo guardrail de arriba comparte la misma regla de oro: cuando algo sale mal, la salida nunca es la respuesta mala, es siempre un fallback seguro. Un schema que no valida despues del retry, un rechazo que no se repara, una filtracion critica, una accion fuera de la politica, todos convergen al mismo lugar, una respuesta controlada que escribiste tu, no una que el modelo alucino. El anti-patron es dejar que la falla se filtre como error tecnico (stack trace, 500, JSON roto en la pantalla) o, peor, dejar pasar la salida mala porque el guardrail solo la logueo y no la bloqueo.',
        },
        {
          type: 'diagram',
          value: `Camino de la salida del modelo por los guardrails

  respuesta del modelo
        |
        v
  [ schema valido? ] --no--> retry (hasta 2x) --fallo--> FALLBACK
        | si
        v
  [ es rechazo? ] --si--> legitimo? --no--> re-preguntar / humano
        | no (o legitimo)
        v
  [ filtra dato sensible? ] --critico--> BLOQUEA --> FALLBACK
        |                --redacta--> sigue con texto redactado
        v
  [ es accion? ] --fuera de la politica--> BLOQUEA --> aprobacion humana
        | dentro de la politica
        v
  entrega al usuario / ejecuta la accion

  FALLBACK = respuesta segura escrita por ti, nunca error crudo en la pantalla`,
        },
        {
          type: 'paragraph',
          value:
            'El fallback correcto depende del contexto: en una respuesta de texto, es un mensaje honesto ("no logre generar una respuesta confiable ahora, te voy a transferir"); en una llamada de tool, es no ejecutar y escalar; en un flujo automatico, es parar y alertar en vez de seguir con dato sospechoso. Lo que nunca es: un error tecnico tirado en la cara del usuario o una salida invalida que paso porque nadie la bloqueo. La diferencia entre un sistema que degrada con dignidad y uno que se rompe feo esta entera en esa decision.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle operativo cierra el ciclo: todo disparo de fallback es un evento que quieres contar. Un fallback subiendo es la senal mas directa de que el modelo, el prompt o el schema cambiaron de comportamiento, y conecta el guardrail con la observabilidad, el tema del articulo relacionado. Un guardrail sin metrica de disparo es una red de seguridad que no sabes si esta sosteniendo a alguien.',
        },
      ],
    },
    {
      title: 'Montar la capa sin volverla laberinto de if',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La trampa es desparramar la validacion por todo el codigo en ifs sueltos, hasta que nadie sepa que regla corre cuando. La capa de guardrails debe ser una cinta ordenada y centralizada: la salida del modelo entra por una punta, pasa por los guardrails en el orden correcto, y sale validada por la otra, o cae en el fallback. Cada guardrail es una funcion pequena y testeable de forma aislada; la cinta solo los encadena. El camino es agregar por orden de riesgo.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por la validacion de schema con retry: es lo mas barato, lo mas frecuente y lo que mas evita bug tonto de parser en produccion.',
            'Agrega el fallback seguro justo despues: sin el, los otros guardrails solo cambian un error por otro; con el, toda falla tiene destino controlado.',
            'Enciende el guardrail de accion antes de cualquier tool con efecto colateral: aqui el costo de errar es irreversible, asi que no es opcional.',
            'Instrumenta el guardrail de filtracion donde la respuesta contiene dato del usuario: cuanto mas sensible el dominio, mas temprano entra.',
            'Pon la deteccion de rechazo al final y conecta todo a metricas: el disparo de cada guardrail se vuelve linea en el dashboard, y el baseline revela cuando algo cambio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un sistema con LLM que da confianza y uno que asusta esta en quien controla la salida. Sin guardrails, es el modelo, probabilistico y sin garantia, el que decide que llega al usuario y a la base. Con guardrails, el modelo propone y tu capa dispone: valida, repara, bloquea o cae en el fallback, pero nunca deja que una salida mala se vuelva dano. Pocas centenas de lineas de guardrail bien puestas separan un piloto que no pondrias frente al cliente de un producto que aguanta produccion.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Un guardrail de salida no es lo mismo que validar el prompt de entrada?',
      answer:
        'No. Son dos controles en momentos distintos. El guardrail de entrada corre antes del modelo y protege contra lo que el usuario manda (prompt injection, pedido abusivo). El guardrail de salida corre despues del modelo y protege contra lo que devuelve (formato invalido, alucinacion, filtracion, accion peligrosa). Una entrada perfectamente valida puede generar una salida peligrosa, porque el modelo es probabilistico. La validacion que de verdad protege al usuario es la de salida, porque es la ultima antes de que el dano llegue a la base, a una tool o a la pantalla.',
    },
    {
      question: 'Por que hacer retry en vez de solo retornar error cuando el schema falla?',
      answer:
        'Porque el modelo que produjo el JSON roto casi siempre acierta en el segundo intento cuando recibe el mensaje exacto de lo que estaba mal. Retornar error en la primera falla desperdiciaria una correccion facil y barata. La clave es que el retry sea estructurado (inyectas el error de validacion como feedback) y limitado (dos intentos cubren casi todo; insistir mas solo quema tokens). Y cuando el retry se agota, el retorno no es la salida invalida, es una senal de falla que cae en el fallback seguro, nunca JSON roto propagado al usuario.',
    },
    {
      question: 'El guardrail debe siempre bloquear cuando encuentra dato sensible en la salida?',
      answer:
        'No siempre; depende del dato y de su papel en la respuesta. Si es un dato que solo necesita ocultarse y la respuesta sigue teniendo sentido sin el, redactar (enmascarar) alcanza. Pero si el dato es critico (documento, tarjeta) o la respuesta entera gira en torno a un dato que se filtro por error, redactar dejaria pasar algo sin sentido o incriminador, asi que lo correcto es bloquear y caer en el fallback. La regla: redacta cuando ocultar preserva la respuesta, bloquea cuando la filtracion contamina la respuesta entera.',
    },
  ],
  conclusion: {
    title: 'Los guardrails de salida son lo que impide que una respuesta mala se vuelva dano real',
    description:
      'Validacion de schema con retry, deteccion de rechazo y filtracion, bloqueo de accion peligrosa y fallback seguro son el minimo para que nada que el modelo produce llegue al usuario o a la base sin pasar por un control. Puedo disenar esa capa en tu producto, encadenada y observable, del schema al fallback, integrada a tu stack.',
    cta: 'Hablar sobre guardrails en mi sistema de IA',
  },
  related: [
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Evaluacion continua de bots: del eval manual al automatico', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-output-guardrails-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
