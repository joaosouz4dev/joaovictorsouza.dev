// Conteudo do artigo: guardrails de saida em LLM (validacao e recusa segura).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Camada mínima de guardrails de saída para LLM: valida a resposta contra um schema, repara e faz retry com feedback estruturado, detecta recusa e vazamento de dado sensível, bloqueia ação perigosa antes de executar e sempre entrega um fallback seguro em vez de propagar saída inválida para o usuário.',
  en: 'Minimal output-guardrail layer for LLMs: validates the response against a schema, repairs and retries with structured feedback, detects refusal and sensitive-data leakage, blocks a dangerous action before executing and always delivers a safe fallback instead of propagating invalid output to the user.',
  es: 'Capa mínima de guardrails de salida para LLM: valida la respuesta contra un schema, repara y reintenta con feedback estructurado, detecta rechazo y filtración de dato sensible, bloquea una acción peligrosa antes de ejecutar y siempre entrega un fallback seguro en vez de propagar salida inválida al usuario.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-output-guardrails-mini';

const pt = {
  intro:
    'A parte perigosa de um sistema com LLM não é o prompt que entra, é a resposta que sai. O modelo pode devolver JSON quebrado que estoura o parser, inventar um campo que nunca existiu, vazar o CPF que estava no contexto, recusar uma pergunta legítima ou pedir para chamar uma tool destrutiva com argumento errado. Sem uma camada que inspeciona a saída antes de ela chegar ao usuário ou ao banco, cada uma dessas falhas vira bug de produção, incidente de privacidade ou ação irreversível. Guardrails de saída são essa camada: um conjunto de validações entre o modelo e o mundo que decide se a resposta pode passar, precisa ser reparada ou tem que ser bloqueada. Este artigo mostra como construir essa camada sem transformar o produto num labirinto de if: validação de schema com reparo e retry, detecção de recusa e de vazamento, bloqueio de ação perigosa antes da execução, e a regra de ouro que amarra tudo, sempre ter um fallback seguro. O foco é o mínimo que impede a saída ruim de virar dano real.',
  sections: [
    {
      title: 'Guardrail de entrada não é guardrail de saída',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusão mais comum é achar que validar o prompt de entrada resolve o problema. Não resolve: são dois riscos diferentes em momentos diferentes. O guardrail de entrada protege contra o que o usuário manda (prompt injection, pedido abusivo, conteúdo proibido) e roda antes do modelo. O guardrail de saída protege contra o que o modelo devolve (formato inválido, alucinação, vazamento, ação perigosa) e roda depois do modelo, antes de a resposta chegar ao usuário, ao banco ou a uma tool. Uma entrada perfeitamente válida pode gerar uma saída perigosa, porque o modelo é probabilístico e não garante nada sobre o que produz.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto de instalação importa: o guardrail de saída fica no caminho de retorno, envelopando a resposta do modelo como um interceptor. Nada que o modelo produz chega ao mundo externo sem passar por ele. A tabela abaixo separa os dois para deixar claro que um não substitui o outro.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'Guardrail de entrada', 'Guardrail de saída'],
          rows: [
            [
              'Quando roda',
              'Antes de chamar o modelo',
              'Depois do modelo, antes do usuário/banco/tool',
            ],
            [
              'Protege contra',
              'Prompt injection, pedido abusivo, PII na entrada',
              'Formato inválido, alucinação, vazamento, ação perigosa',
            ],
            [
              'Ação típica',
              'Recusar, sanitizar, rotear',
              'Reparar, fazer retry, bloquear, fallback',
            ],
            [
              'Se falhar',
              'Modelo recebe entrada ruim',
              'Usuário recebe saída ruim (dano real)',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra prática: guardrail de entrada reduz a chance de saída ruim, mas nunca a elimina. A validação que de fato protege o usuário é a de saída, porque é a última antes do dano. Investir só na entrada é trancar a porta da frente e deixar a dos fundos aberta.',
        },
      ],
    },
    {
      title: 'Validação de schema: o retry estruturado que conserta em vez de quebrar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O guardrail mais barato e mais rentável é a validação de schema. Quando a saída do modelo deveria ser JSON estruturado (para virar chamada de API, registro no banco ou decisão de fluxo), você não confia que veio certo, você valida contra um schema. Mas o passo que separa um sistema frágil de um robusto é o que fazer quando a validação falha: em vez de estourar um erro para o usuário, você devolve o erro de validação ao próprio modelo e pede para ele corrigir. O modelo que produziu o JSON quebrado quase sempre acerta na segunda tentativa quando recebe a mensagem exata do que estava errado.',
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
            'Dois detalhes fazem a diferença. Primeiro, o retry tem limite: duas tentativas cobrem a esmagadora maioria dos casos, e insistir além disso só queima token e latência num modelo que não vai convergir. Segundo, quando o retry esgota, o retorno não é a saída inválida, é um sinal de falha que o fallback vai tratar. Propagar JSON quebrado depois de duas tentativas é trocar um erro controlado por um erro em produção.',
        },
      ],
    },
    {
      title: 'Detectar recusa indevida e recusa legítima',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda recusa é um problema, e nem toda resposta fluida está correta. O modelo pode recusar uma pergunta perfeitamente legítima ("não posso ajudar com isso") por excesso de zelo, e pode responder com confiança algo que deveria ter recusado. O guardrail de recusa mede esse eixo: ele classifica se a resposta é uma recusa e decide se aquela recusa faz sentido no contexto. Recusa em cima de pedido válido é degradação de produto, o usuário bateu numa parede sem motivo. Ausência de recusa em pedido perigoso é risco, o modelo passou por cima de um limite que deveria respeitar.',
        },
        {
          type: 'list',
          items: [
            'Detectar a recusa: procure os padrões de recusa da sua stack ("não posso", "não consigo ajudar", "isso vai contra") e trate como um sinal classificável, não como texto qualquer.',
            'Classificar o contexto: a pergunta era legítima? Se sim, uma recusa é falha, e o caminho é re-perguntar com prompt ajustado ou rotear para humano, não devolver a parede ao usuário.',
            'Medir a taxa de recusa: recusa subindo de repente costuma ser prompt quebrado ou guardrail agressivo demais, e só aparece se você conta as recusas como métrica.',
            'Não suprimir recusa legítima: quando o modelo recusa algo que deve mesmo recusar, o guardrail confirma e registra, ele não força uma resposta que abriria um buraco de segurança.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro clássico é tratar recusa como falha sempre, e reescrever o prompt até o modelo responder qualquer coisa. Isso quebra a recusa legítima e transforma o guardrail num vetor de ataque. A postura certa é distinguir: recusa indevida se conserta, recusa legítima se respeita. O guardrail não existe para forçar resposta, existe para garantir que a decisão de responder ou não esteja alinhada com o contexto.',
        },
      ],
    },
    {
      title: 'Vazamento de dado sensível na saída',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um risco silencioso: o contexto do modelo carrega dado sensível (CPF, telefone, dado de outro usuário que entrou por engano no retrieval) e o modelo repete esse dado na resposta. A entrada estava sob controle, mas a saída vaza. O guardrail de vazamento inspeciona a resposta antes de entregar e bloqueia ou redige o que não deveria sair. É a mesma lógica da redação de log, mas aqui o alvo é o que chega ao usuário final, então a barra é mais alta: em log você redige para não persistir, na saída você redige ou bloqueia para não expor.',
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
            'A decisão entre redigir e bloquear é o que separa um guardrail útil de um perigoso. Mascarar um email num texto que ainda faz sentido é razoável. Mas quando a resposta inteira gira em torno de um dado que vazou por engano (o modelo confundiu o pedido de um usuário com o cadastro de outro), redigir deixa passar uma resposta sem sentido e potencialmente incriminadora. Nesse caso, bloquear e cair no fallback é mais seguro do que entregar algo mutilado.',
        },
      ],
    },
    {
      title: 'Bloquear ação perigosa antes de executar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O guardrail mais crítico é o que fica entre o modelo e uma ação com efeito colateral. Quando o LLM decide chamar uma tool (cancelar pedido, emitir reembolso, apagar registro, disparar mensagem em massa), a saída do modelo deixa de ser texto e vira comando. Um argumento alucinado, um id errado ou um valor fora de faixa não geram uma resposta ruim, geram uma ação irreversível. Aqui a saída do modelo é uma proposta de ação, e o guardrail é a aprovação: valida os argumentos, checa limites e políticas, e só então deixa executar.',
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
            'Dois princípios sustentam esse guardrail. Negar por padrão: uma ação que não está na tabela de políticas não executa, porque o modelo pode inventar um nome de tool que você nunca definiu. E escalar em vez de simplesmente falhar: reembolso acima do limite ou disparo em massa não viram erro seco, viram um pedido de aprovação humana. O guardrail não existe só para dizer não, existe para rotear a decisão para quem tem autoridade quando o modelo está fora da alçada.',
        },
      ],
    },
    {
      title: 'Fallback seguro: a regra de ouro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo guardrail acima compartilha a mesma regra de ouro: quando algo dá errado, a saída nunca é a resposta ruim, é sempre um fallback seguro. Schema que não valida depois do retry, recusa que não se conserta, vazamento crítico, ação fora da política, todos convergem para o mesmo lugar, uma resposta controlada que você escreveu, não uma que o modelo alucinou. O anti-padrão é deixar a falha vazar como erro técnico (stack trace, 500, JSON quebrado na tela) ou, pior, deixar a saída ruim passar porque o guardrail só logou e não bloqueou.',
        },
        {
          type: 'diagram',
          value: `Caminho da saída do modelo pelos guardrails

  resposta do modelo
        |
        v
  [ schema válido? ] --não--> retry (até 2x) --falhou--> FALLBACK
        | sim
        v
  [ é recusa? ] --sim--> legítima? --não--> re-perguntar / humano
        | não (ou legítima)
        v
  [ vaza dado sensível? ] --crítico--> BLOQUEIA --> FALLBACK
        |                --redige--> segue com texto redigido
        v
  [ é ação? ] --fora da política--> BLOQUEIA --> aprovação humana
        | dentro da política
        v
  entrega ao usuário / executa a ação

  FALLBACK = resposta segura escrita por você, nunca erro cru na tela`,
        },
        {
          type: 'paragraph',
          value:
            'O fallback certo depende do contexto: numa resposta de texto, é uma mensagem honesta ("não consegui gerar uma resposta confiável agora, vou te transferir"); numa chamada de tool, é não executar e escalar; num fluxo automático, é parar e alertar em vez de seguir com dado suspeito. O que ele nunca é: um erro técnico jogado na cara do usuário ou uma saída inválida que passou porque ninguém bloqueou. A diferença entre um sistema que degrada com dignidade e um que quebra feio está inteira nessa decisão.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe operacional fecha o ciclo: todo acionamento de fallback é um evento que você quer contar. Fallback subindo é o sinal mais direto de que o modelo, o prompt ou o schema mudaram de comportamento, e conecta o guardrail à observabilidade, o assunto do artigo relacionado. Guardrail sem métrica de acionamento é uma rede de segurança que você não sabe se está segurando alguém.',
        },
      ],
    },
    {
      title: 'Montar a camada sem virar labirinto de if',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A armadilha é espalhar validação por todo o código em ifs soltos, até ninguém saber mais qual regra roda quando. A camada de guardrails deve ser uma esteira ordenada e centralizada: a saída do modelo entra por uma ponta, passa pelos guardrails na ordem certa, e sai validada pela outra, ou cai no fallback. Cada guardrail é uma função pequena e testável isoladamente; a esteira apenas os encadeia. O caminho é adicionar por ordem de risco.',
        },
        {
          type: 'ordered',
          items: [
            'Comece pela validação de schema com retry: é o mais barato, o mais frequente e o que mais evita bug bobo de parser em produção.',
            'Adicione o fallback seguro logo em seguida: sem ele, os outros guardrails só trocam um erro por outro; com ele, toda falha tem destino controlado.',
            'Ligue o guardrail de ação antes de qualquer tool com efeito colateral: aqui o custo de errar é irreversível, então ele não é opcional.',
            'Instrumente o guardrail de vazamento onde a resposta contém dado do usuário: quanto mais sensível o domínio, mais cedo ele entra.',
            'Coloque a detecção de recusa por último e conecte tudo a métricas: acionamento de cada guardrail vira linha no dashboard, e o baseline revela quando algo mudou.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre um sistema com LLM que dá confiança e um que assusta está em quem controla a saída. Sem guardrails, é o modelo, probabilístico e sem garantia, que decide o que chega ao usuário e ao banco. Com guardrails, o modelo propõe e a sua camada dispõe: valida, repara, bloqueia ou cai no fallback, mas nunca deixa a saída ruim virar dano. Poucas centenas de linhas de guardrail bem colocadas separam um piloto que você não põe na frente do cliente de um produto que aguenta produção.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Guardrail de saída não é a mesma coisa que validar o prompt de entrada?',
      answer:
        'Não. São dois controles em momentos diferentes. O guardrail de entrada roda antes do modelo e protege contra o que o usuário manda (prompt injection, pedido abusivo). O guardrail de saída roda depois do modelo e protege contra o que ele devolve (formato inválido, alucinação, vazamento, ação perigosa). Uma entrada perfeitamente válida pode gerar uma saída perigosa, porque o modelo é probabilístico. A validação que de fato protege o usuário é a de saída, porque é a última antes do dano chegar ao banco, a uma tool ou à tela.',
    },
    {
      question: 'Por que fazer retry em vez de só retornar erro quando o schema falha?',
      answer:
        'Porque o modelo que produziu o JSON quebrado quase sempre acerta na segunda tentativa quando recebe a mensagem exata do que estava errado. Retornar erro na primeira falha desperdiçaria uma correção fácil e barata. A chave é o retry ser estruturado (você injeta o erro de validação como feedback) e limitado (duas tentativas cobrem quase tudo; insistir além disso só queima token). E, quando o retry esgota, o retorno não é a saída inválida, é um sinal de falha que cai no fallback seguro, nunca JSON quebrado propagado para o usuário.',
    },
    {
      question: 'O guardrail deve sempre bloquear quando encontra dado sensível na saída?',
      answer:
        'Não sempre; depende do dado e do papel dele na resposta. Se é um dado que só precisa ser ocultado e a resposta continua fazendo sentido sem ele, redigir (mascarar) é suficiente. Mas se o dado é crítico (CPF, cartão) ou se a resposta inteira gira em torno de um dado que vazou por engano, redigir deixaria passar algo sem sentido ou incriminador, então o certo é bloquear e cair no fallback. A regra: redija quando ocultar preserva a resposta, bloqueie quando o vazamento contamina a resposta toda.',
    },
  ],
  conclusion: {
    title: 'Guardrails de saída são o que impede a resposta ruim de virar dano real',
    description:
      'Validação de schema com retry, detecção de recusa e vazamento, bloqueio de ação perigosa e fallback seguro são o mínimo para que nada que o modelo produz chegue ao usuário ou ao banco sem passar por um controle. Posso desenhar essa camada no seu produto, encadeada e observável, do schema ao fallback, integrada ao seu stack.',
    cta: 'Falar sobre guardrails no meu sistema de IA',
  },
  related: [
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
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
    'La parte peligrosa de un sistema con LLM no es el prompt que entra, es la respuesta que sale. El modelo puede devolver JSON roto que revienta el parser, inventar un campo que nunca existió, filtrar el documento que estaba en el contexto, rechazar una pregunta legítima o pedir llamar a una tool destructiva con el argumento equivocado. Sin una capa que inspecciona la salida antes de que llegue al usuario o a la base de datos, cada una de esas fallas se vuelve bug de producción, incidente de privacidad o acción irreversible. Los guardrails de salida son esa capa: un conjunto de validaciones entre el modelo y el mundo que decide si la respuesta puede pasar, necesita repararse o hay que bloquearla. Este artículo muestra cómo construir esa capa sin volver el producto un laberinto de if: validación de schema con reparación y retry, detección de rechazo y de filtración, bloqueo de acción peligrosa antes de ejecutar, y la regla de oro que amarra todo, siempre tener un fallback seguro. El foco es el mínimo que impide que una salida mala se vuelva daño real.',
  sections: [
    {
      title: 'Un guardrail de entrada no es un guardrail de salida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusión más común es creer que validar el prompt de entrada resuelve el problema. No lo resuelve: son dos riesgos distintos en momentos distintos. El guardrail de entrada protege contra lo que el usuario manda (prompt injection, pedido abusivo, contenido prohibido) y corre antes del modelo. El guardrail de salida protege contra lo que el modelo devuelve (formato inválido, alucinación, filtración, acción peligrosa) y corre después del modelo, antes de que la respuesta llegue al usuario, a la base de datos o a una tool. Una entrada perfectamente válida puede generar una salida peligrosa, porque el modelo es probabilístico y no garantiza nada sobre lo que produce.',
        },
        {
          type: 'paragraph',
          value:
            'El punto de instalación importa: el guardrail de salida está en el camino de retorno, envolviendo la respuesta del modelo como un interceptor. Nada que el modelo produce llega al mundo externo sin pasar por él. La tabla de abajo separa los dos para dejar claro que uno no reemplaza al otro.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'Guardrail de entrada', 'Guardrail de salida'],
          rows: [
            [
              'Cuándo corre',
              'Antes de llamar al modelo',
              'Después del modelo, antes del usuario/base/tool',
            ],
            [
              'Protege contra',
              'Prompt injection, pedido abusivo, PII en la entrada',
              'Formato inválido, alucinación, filtración, acción peligrosa',
            ],
            [
              'Acción típica',
              'Rechazar, sanitizar, rutear',
              'Reparar, retry, bloquear, fallback',
            ],
            [
              'Si falla',
              'El modelo recibe entrada mala',
              'El usuario recibe salida mala (daño real)',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica: un guardrail de entrada reduce la probabilidad de salida mala, pero nunca la elimina. La validación que de verdad protege al usuario es la de salida, porque es la última antes del daño. Invertir solo en la entrada es trancar la puerta del frente y dejar la de atrás abierta.',
        },
      ],
    },
    {
      title: 'Validación de schema: el retry estructurado que repara en vez de romper',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El guardrail más barato y más rentable es la validación de schema. Cuando la salida del modelo debería ser JSON estructurado (para volverse llamada de API, registro en la base o decisión de flujo), no confías en que salió bien, la validas contra un schema. Pero el paso que separa un sistema frágil de uno robusto es qué haces cuando la validación falla: en vez de reventar un error al usuario, devuelves el error de validación al propio modelo y le pides que lo corrija. El modelo que produjo el JSON roto casi siempre acierta en el segundo intento cuando recibe el mensaje exacto de lo que estaba mal.',
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
            'Dos detalles hacen la diferencia. Primero, el retry tiene límite: dos intentos cubren la abrumadora mayoría de los casos, e insistir más allá solo quema tokens y latencia en un modelo que no va a converger. Segundo, cuando el retry se agota, el retorno no es la salida inválida, es una señal de falla que el fallback va a tratar. Propagar JSON roto después de dos intentos es cambiar un error controlado por uno de producción.',
        },
      ],
    },
    {
      title: 'Detectar rechazo indebido y rechazo legítimo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todo rechazo es un problema, y no toda respuesta fluida es correcta. El modelo puede rechazar una pregunta perfectamente legítima ("no puedo ayudar con eso") por exceso de celo, y puede responder con confianza algo que debería haber rechazado. El guardrail de rechazo mide ese eje: clasifica si la respuesta es un rechazo y decide si ese rechazo tiene sentido en el contexto. Rechazo sobre un pedido válido es degradación de producto, el usuario chocó con una pared sin motivo. Ausencia de rechazo en un pedido peligroso es riesgo, el modelo pasó por encima de un límite que debería respetar.',
        },
        {
          type: 'list',
          items: [
            'Detectar el rechazo: busca los patrones de rechazo de tu stack ("no puedo", "no consigo ayudar", "eso va contra") y trátalo como una señal clasificable, no como texto cualquiera.',
            'Clasificar el contexto: ¿la pregunta era legítima? Si lo era, un rechazo es falla, y el camino es re-preguntar con prompt ajustado o rutear a humano, no devolver la pared al usuario.',
            'Medir la tasa de rechazo: un rechazo subiendo de repente suele ser prompt roto o guardrail demasiado agresivo, y solo aparece si cuentas los rechazos como métrica.',
            'No suprimir rechazo legítimo: cuando el modelo rechaza algo que sí debe rechazar, el guardrail lo confirma y registra, no fuerza una respuesta que abriría un hueco de seguridad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error clásico es tratar el rechazo como falla siempre, y reescribir el prompt hasta que el modelo responda cualquier cosa. Eso rompe el rechazo legítimo y convierte el guardrail en un vector de ataque. La postura correcta es distinguir: rechazo indebido se repara, rechazo legítimo se respeta. El guardrail no existe para forzar respuesta, existe para garantizar que la decisión de responder o no esté alineada con el contexto.',
        },
      ],
    },
    {
      title: 'Filtración de dato sensible en la salida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un riesgo silencioso: el contexto del modelo carga dato sensible (documento, teléfono, dato de otro usuario que entró por error en el retrieval) y el modelo repite ese dato en la respuesta. La entrada estaba bajo control, pero la salida filtra. El guardrail de filtración inspecciona la respuesta antes de entregar y bloquea o redacta lo que no debería salir. Es la misma lógica de la redacción de log, pero aquí el objetivo es lo que llega al usuario final, así que la vara es más alta: en un log redactas para no persistir, en la salida redactas o bloqueas para no exponer.',
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
            'La decisión entre redactar y bloquear es lo que separa un guardrail útil de uno peligroso. Enmascarar un email en un texto que aún tiene sentido es razonable. Pero cuando la respuesta entera gira en torno a un dato que se filtró por error (el modelo confundió el pedido de un usuario con el registro de otro), redactar deja pasar una respuesta sin sentido y potencialmente incriminadora. En ese caso, bloquear y caer en el fallback es más seguro que entregar algo mutilado.',
        },
      ],
    },
    {
      title: 'Bloquear una acción peligrosa antes de ejecutar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El guardrail más crítico es el que está entre el modelo y una acción con efecto colateral. Cuando el LLM decide llamar a una tool (cancelar pedido, emitir reembolso, borrar registro, disparar mensaje masivo), la salida del modelo deja de ser texto y se vuelve comando. Un argumento alucinado, un id equivocado o un valor fuera de rango no generan una respuesta mala, generan una acción irreversible. Aquí la salida del modelo es una propuesta de acción, y el guardrail es la aprobación: valida los argumentos, chequea límites y políticas, y solo entonces deja ejecutar.',
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
            'Dos principios sostienen este guardrail. Negar por defecto: una acción que no está en la tabla de políticas no ejecuta, porque el modelo puede inventar un nombre de tool que nunca definiste. Y escalar en vez de simplemente fallar: un reembolso sobre el límite o un disparo masivo no se vuelven un error seco, se vuelven un pedido de aprobación humana. El guardrail no existe solo para decir no, existe para rutear la decisión a quien tiene autoridad cuando el modelo está fuera de su alcance.',
        },
      ],
    },
    {
      title: 'Fallback seguro: la regla de oro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo guardrail de arriba comparte la misma regla de oro: cuando algo sale mal, la salida nunca es la respuesta mala, es siempre un fallback seguro. Un schema que no valida después del retry, un rechazo que no se repara, una filtración crítica, una acción fuera de la política, todos convergen al mismo lugar, una respuesta controlada que escribiste tú, no una que el modelo alucinó. El anti-patrón es dejar que la falla se filtre como error técnico (stack trace, 500, JSON roto en la pantalla) o, peor, dejar pasar la salida mala porque el guardrail solo la logueó y no la bloqueó.',
        },
        {
          type: 'diagram',
          value: `Camino de la salida del modelo por los guardrails

  respuesta del modelo
        |
        v
  [ ¿schema válido? ] --no--> retry (hasta 2x) --falló--> FALLBACK
        | sí
        v
  [ ¿es rechazo? ] --sí--> ¿legítimo? --no--> re-preguntar / humano
        | no (o legítimo)
        v
  [ ¿filtra dato sensible? ] --crítico--> BLOQUEA --> FALLBACK
        |                --redacta--> sigue con texto redactado
        v
  [ ¿es acción? ] --fuera de la política--> BLOQUEA --> aprobación humana
        | dentro de la política
        v
  entrega al usuario / ejecuta la acción

  FALLBACK = respuesta segura escrita por ti, nunca error crudo en la pantalla`,
        },
        {
          type: 'paragraph',
          value:
            'El fallback correcto depende del contexto: en una respuesta de texto, es un mensaje honesto ("no logré generar una respuesta confiable ahora, te voy a transferir"); en una llamada de tool, es no ejecutar y escalar; en un flujo automático, es parar y alertar en vez de seguir con dato sospechoso. Lo que nunca es: un error técnico tirado en la cara del usuario o una salida inválida que pasó porque nadie la bloqueó. La diferencia entre un sistema que degrada con dignidad y uno que se rompe feo está entera en esa decisión.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle operativo cierra el ciclo: todo disparo de fallback es un evento que quieres contar. Un fallback subiendo es la señal más directa de que el modelo, el prompt o el schema cambiaron de comportamiento, y conecta el guardrail con la observabilidad, el tema del artículo relacionado. Un guardrail sin métrica de disparo es una red de seguridad que no sabes si está sosteniendo a alguien.',
        },
      ],
    },
    {
      title: 'Montar la capa sin volverla laberinto de if',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La trampa es desparramar la validación por todo el código en ifs sueltos, hasta que nadie sepa qué regla corre cuándo. La capa de guardrails debe ser una cinta ordenada y centralizada: la salida del modelo entra por una punta, pasa por los guardrails en el orden correcto, y sale validada por la otra, o cae en el fallback. Cada guardrail es una función pequeña y testeable de forma aislada; la cinta solo los encadena. El camino es agregar por orden de riesgo.',
        },
        {
          type: 'ordered',
          items: [
            'Empieza por la validación de schema con retry: es lo más barato, lo más frecuente y lo que más evita bug tonto de parser en producción.',
            'Agrega el fallback seguro justo después: sin él, los otros guardrails solo cambian un error por otro; con él, toda falla tiene destino controlado.',
            'Enciende el guardrail de acción antes de cualquier tool con efecto colateral: aquí el costo de errar es irreversible, así que no es opcional.',
            'Instrumenta el guardrail de filtración donde la respuesta contiene dato del usuario: cuanto más sensible el dominio, más temprano entra.',
            'Pon la detección de rechazo al final y conecta todo a métricas: el disparo de cada guardrail se vuelve línea en el dashboard, y el baseline revela cuándo algo cambió.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre un sistema con LLM que da confianza y uno que asusta está en quién controla la salida. Sin guardrails, es el modelo, probabilístico y sin garantía, el que decide qué llega al usuario y a la base. Con guardrails, el modelo propone y tu capa dispone: valida, repara, bloquea o cae en el fallback, pero nunca deja que una salida mala se vuelva daño. Pocas centenas de líneas de guardrail bien puestas separan un piloto que no pondrías frente al cliente de un producto que aguanta producción.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Un guardrail de salida no es lo mismo que validar el prompt de entrada?',
      answer:
        'No. Son dos controles en momentos distintos. El guardrail de entrada corre antes del modelo y protege contra lo que el usuario manda (prompt injection, pedido abusivo). El guardrail de salida corre después del modelo y protege contra lo que devuelve (formato inválido, alucinación, filtración, acción peligrosa). Una entrada perfectamente válida puede generar una salida peligrosa, porque el modelo es probabilístico. La validación que de verdad protege al usuario es la de salida, porque es la última antes de que el daño llegue a la base, a una tool o a la pantalla.',
    },
    {
      question: '¿Por qué hacer retry en vez de solo retornar error cuando el schema falla?',
      answer:
        'Porque el modelo que produjo el JSON roto casi siempre acierta en el segundo intento cuando recibe el mensaje exacto de lo que estaba mal. Retornar error en la primera falla desperdiciaría una corrección fácil y barata. La clave es que el retry sea estructurado (inyectas el error de validación como feedback) y limitado (dos intentos cubren casi todo; insistir más solo quema tokens). Y cuando el retry se agota, el retorno no es la salida inválida, es una señal de falla que cae en el fallback seguro, nunca JSON roto propagado al usuario.',
    },
    {
      question: '¿El guardrail debe siempre bloquear cuando encuentra dato sensible en la salida?',
      answer:
        'No siempre; depende del dato y de su papel en la respuesta. Si es un dato que solo necesita ocultarse y la respuesta sigue teniendo sentido sin él, redactar (enmascarar) alcanza. Pero si el dato es crítico (documento, tarjeta) o la respuesta entera gira en torno a un dato que se filtró por error, redactar dejaría pasar algo sin sentido o incriminador, así que lo correcto es bloquear y caer en el fallback. La regla: redacta cuando ocultar preserva la respuesta, bloquea cuando la filtración contamina la respuesta entera.',
    },
  ],
  conclusion: {
    title: 'Los guardrails de salida son lo que impide que una respuesta mala se vuelva daño real',
    description:
      'Validación de schema con retry, detección de rechazo y filtración, bloqueo de acción peligrosa y fallback seguro son el mínimo para que nada que el modelo produce llegue al usuario o a la base sin pasar por un control. Puedo diseñar esa capa en tu producto, encadenada y observable, del schema al fallback, integrada a tu stack.',
    cta: 'Hablar sobre guardrails en mi sistema de IA',
  },
  related: [
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'llm-output-guardrails-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
