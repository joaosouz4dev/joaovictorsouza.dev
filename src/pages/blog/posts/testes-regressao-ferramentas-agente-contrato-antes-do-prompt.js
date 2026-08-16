// Conteudo do artigo: testes de regressao para ferramentas do agente, contrato antes do prompt.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O agente parou de consultar o rastreamento de pedido e ninguém mexeu no prompt. O que mudou foi a API interna: o campo "status" virou "orderStatus", a resposta de erro deixou de ter "message" e o parâmetro de data passou a exigir fuso. Nada disso quebrou um teste, porque a suíte do time testa a API e testa o prompt, e o que quebrou fica exatamente entre os dois. Ferramenta de agente não é só uma função: é um contrato com três faces que envelhecem em ritmos diferentes, e a face que ninguém versiona é justamente a que o modelo lê. Este artigo trata teste de regressão de ferramenta como engenharia de contrato: quais três camadas precisam de teste separado, como um snapshot do esquema pega a mudança que o compilador não pega, por que testar seleção de ferramenta com o modelo real custa caro e como reduzir esse custo sem perder o sinal, e qual portão colocar no pipeline para que a mudança de contrato pare antes de chegar em produção.',
  sections: [
    {
      title: 'A ferramenta tem três contratos, e o time testa só um',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando um desenvolvedor escreve uma ferramenta para o agente, ele enxerga uma função: recebe argumentos, chama um serviço, devolve dados. O teste que ele escreve reflete essa visão e cobre bem o caminho da execução. Só que o modelo não interage com a função, ele interage com a descrição dela. Entre o prompt e o serviço existem três contratos independentes, e cada um pode regredir sozinho sem derrubar os outros dois.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro é o contrato de descoberta: nome da ferramenta, descrição, nomes e descrições dos parâmetros, enumerações, obrigatoriedade. É o texto que o modelo lê para decidir se aquela ferramenta serve para a pergunta. O segundo é o contrato de invocação: o esquema que valida os argumentos que o modelo produziu, incluindo tipos, formatos e valores aceitos. O terceiro é o contrato de retorno: a forma dos dados que voltam para dentro da janela de contexto e viram base da resposta ao cliente. Renomear um campo do retorno não quebra o esquema de entrada, não quebra a chamada HTTP e não gera exceção. Só faz o agente responder que não encontrou a informação.',
        },
        {
          type: 'table',
          columns: ['Camada', 'Quem consome', 'Como regride na prática', 'Teste que pega'],
          rows: [
            [
              'Descoberta',
              'O modelo, ao escolher a ferramenta',
              'Descrição reescrita para ficar "mais clara" e a taxa de seleção cai',
              'Suíte de seleção com casos rotulados',
            ],
            [
              'Invocação',
              'O validador de argumentos',
              'Parâmetro vira obrigatório ou muda de formato de data',
              'Snapshot do esquema mais teste de compatibilidade',
            ],
            [
              'Retorno',
              'O modelo, ao redigir a resposta',
              'Campo renomeado ou aninhado em um nível novo',
              'Contrato de resposta com dados gravados',
            ],
            [
              'Efeito colateral',
              'O sistema de destino',
              'Ação passa a exigir confirmação ou vira assíncrona',
              'Teste de integração com serviço real ou dublê fiel',
            ],
            [
              'Erro',
              'O modelo, ao decidir se tenta de novo',
              'Formato de erro muda e o agente entra em laço de repetição',
              'Casos de falha explícitos na suíte',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha merece atenção porque produz o incidente mais caro da lista. Quando o formato de erro muda, o modelo perde a única pista que tinha sobre o que fazer a seguir, e o comportamento padrão de quase todo agente nessa situação é tentar de novo com os mesmos argumentos. O resultado é uma conversa que consome dez chamadas de ferramenta e três vezes o orçamento de tokens para terminar em uma resposta genérica de indisponibilidade. Nenhum teste de API pega isso, porque do ponto de vista da API o erro foi devolvido corretamente.',
        },
      ],
    },
    {
      title: 'Congelar o esquema: o teste mais barato que existe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de qualquer coisa que envolva o modelo, existe um teste que custa milissegundos e pega a maior parte das regressões de contrato: gravar o esquema exposto ao modelo em um arquivo versionado e falhar quando ele mudar sem intenção. É o mesmo princípio de um teste de snapshot de interface, aplicado ao artefato que o modelo enxerga. A diferença em relação a um snapshot comum é que aqui a comparação não pode ser textual bruta, senão qualquer reordenação de chaves gera falso positivo e o time aprende a atualizar o arquivo sem ler.',
        },
        {
          type: 'paragraph',
          value:
            'O que funciona é normalizar o esquema, gerar um hash por ferramenta e classificar a diferença. Adicionar um parâmetro opcional é compatível. Adicionar um obrigatório, remover um valor de enumeração, apertar um formato ou renomear um campo é quebra. Mudar só a descrição não quebra a invocação, mas muda a descoberta, então precisa de um aviso diferente: não bloqueia o merge, mas exige que a suíte de seleção rode.',
        },
        {
          type: 'code',
          value: `// tools/schema-contract.js
// Congela o contrato exposto ao modelo e classifica a diferenca entre a
// versao gravada e a atual. Roda em milissegundos, sem chamar o provedor.

import { createHash } from 'node:crypto';

// Normaliza para que reordenacao de chaves nao gere falso positivo.
// A descricao entra num hash separado: ela nao quebra a invocacao,
// mas muda a descoberta e precisa disparar a suite de selecao.
function normalizeParameters(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeParameters);

  return Object.keys(schema)
    .filter((key) => key !== 'description')
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalizeParameters(schema[key]);
      return acc;
    }, {});
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function fingerprintTool(tool) {
  return {
    name: tool.name,
    invocationHash: hashOf(normalizeParameters(tool.parameters)),
    discoveryHash: hashOf({
      description: tool.description,
      parameterDescriptions: collectDescriptions(tool.parameters),
    }),
    required: [...(tool.parameters?.required ?? [])].sort(),
    enums: collectEnums(tool.parameters),
  };
}

function collectDescriptions(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (typeof schema.description === 'string') out[path || '.'] = schema.description;
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectDescriptions(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

function collectEnums(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema.enum)) out[path || '.'] = [...schema.enum].sort();
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectEnums(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

// Classifica a mudanca em vez de apenas apontar diferenca. O time precisa
// saber se aquilo bloqueia o merge ou apenas exige rodar a suite de selecao.
export function diffContracts(baseline, current) {
  const findings = [];
  const byName = new Map(current.map((tool) => [tool.name, tool]));

  for (const before of baseline) {
    const after = byName.get(before.name);

    if (!after) {
      findings.push({ tool: before.name, level: 'breaking', reason: 'ferramenta removida' });
      continue;
    }

    if (before.invocationHash !== after.invocationHash) {
      const newRequired = after.required.filter((key) => !before.required.includes(key));
      const lostEnum = Object.entries(before.enums).flatMap(([path, values]) =>
        values.filter((value) => !(after.enums[path] ?? []).includes(value)),
      );

      findings.push({
        tool: before.name,
        level: newRequired.length || lostEnum.length ? 'breaking' : 'compatible',
        reason: newRequired.length
          ? \`novos parametros obrigatorios: \${newRequired.join(', ')}\`
          : lostEnum.length
            ? \`valores de enum removidos: \${lostEnum.join(', ')}\`
            : 'esquema alterado de forma compativel',
      });
    }

    if (before.discoveryHash !== after.discoveryHash) {
      findings.push({
        tool: before.name,
        level: 'behavioral',
        reason: 'descricao mudou, rode a suite de selecao antes do merge',
      });
    }
  }

  for (const after of current) {
    if (!baseline.some((before) => before.name === after.name)) {
      findings.push({ tool: after.name, level: 'behavioral', reason: 'ferramenta nova' });
    }
  }

  return findings;
}`,
        },
        {
          type: 'paragraph',
          value:
            'A escolha de separar o hash de invocação do hash de descoberta é o detalhe que faz esse teste sobreviver ao contato com o time. Se qualquer ajuste de redação bloquear o merge, alguém vai passar a regenerar o arquivo de referência por reflexo em duas semanas, e o teste vira decoração. Separando as duas faces, ajuste de texto vira aviso que dispara a suíte cara, e mudança estrutural vira bloqueio, que é o comportamento proporcional em cada caso.',
        },
      ],
    },
    {
      title: 'Testar seleção de ferramenta sem quebrar o orçamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O esquema congelado não responde a pergunta que mais importa: dada a pergunta do cliente, o agente ainda escolhe a ferramenta certa com os argumentos certos? Essa camada exige o modelo no laço, porque é comportamento e não estrutura. E é aqui que quase todo time desiste, porque rodar duzentos casos com o modelo grande a cada pull request tem custo e latência que ninguém aceita no caminho do merge.',
        },
        {
          type: 'paragraph',
          value:
            'A saída não é reduzir a cobertura, é separar o que roda sempre do que roda por evento. Um conjunto pequeno de casos críticos, algo entre vinte e quarenta, roda em todo pull request que toca ferramenta ou prompt. O conjunto completo roda quando o diff de contrato aponta mudança comportamental, quando o modelo muda de versão e uma vez por dia no agendado. O barateamento vem de um detalhe técnico simples e muito eficaz: nesse teste não é preciso executar a ferramenta nem gerar a resposta final. Basta pedir a primeira decisão do modelo e parar ali, o que corta a maior parte dos tokens de saída e todo o custo do serviço de destino.',
        },
        {
          type: 'code',
          value: `// tools/selection-suite.js
// Suite de regressao de selecao de ferramenta. Nao executa a ferramenta nem
// gera a resposta final: pede so a primeira decisao e para ali.

const DEFAULT_THRESHOLDS = {
  minToolAccuracy: 0.95,   // escolheu a ferramenta certa
  minArgAccuracy: 0.9,     // preencheu os argumentos criticos certos
  maxSpuriousCalls: 0.02,  // chamou ferramenta em caso que nao precisava
};

export function createSelectionSuite({ callModel, tools, cases, thresholds = {} }) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };

  async function runCase(testCase) {
    const decision = await callModel({
      messages: [{ role: 'user', content: testCase.userMessage }],
      tools,
      toolChoice: 'auto',
      maxTokens: 512,
    });

    const call = decision.toolCalls?.[0] ?? null;

    // Caso negativo: a pergunta deve ser respondida sem ferramenta.
    // Testar isso importa tanto quanto o positivo, porque descricao
    // ampla demais faz o agente chamar ferramenta para "bom dia".
    if (testCase.expectedTool === null) {
      return { id: testCase.id, ok: call === null, kind: 'negative', got: call?.name ?? null };
    }

    if (!call) {
      return { id: testCase.id, ok: false, kind: 'missing', got: null };
    }

    if (call.name !== testCase.expectedTool) {
      return { id: testCase.id, ok: false, kind: 'wrong-tool', got: call.name };
    }

    // Compara apenas os argumentos criticos. Exigir igualdade exata do objeto
    // inteiro transforma a suite numa fabrica de falso positivo, porque o
    // modelo preenche campos opcionais de forma legitimamente variavel.
    const wrongArgs = Object.entries(testCase.expectedArguments ?? {}).filter(
      ([key, expected]) => !argumentMatches(call.arguments?.[key], expected),
    );

    return {
      id: testCase.id,
      ok: wrongArgs.length === 0,
      kind: wrongArgs.length ? 'wrong-args' : 'pass',
      got: Object.fromEntries(wrongArgs.map(([key]) => [key, call.arguments?.[key]])),
    };
  }

  async function run() {
    const results = [];
    for (const testCase of cases) {
      results.push(await runCase(testCase));
    }

    const positives = results.filter((r) => r.kind !== 'negative');
    const negatives = results.filter((r) => r.kind === 'negative');

    const toolAccuracy =
      positives.filter((r) => r.kind !== 'wrong-tool' && r.kind !== 'missing').length /
      Math.max(positives.length, 1);
    const argAccuracy = positives.filter((r) => r.ok).length / Math.max(positives.length, 1);
    const spuriousRate =
      negatives.filter((r) => !r.ok).length / Math.max(negatives.length, 1);

    const failures = [];
    if (toolAccuracy < limits.minToolAccuracy) failures.push(\`selecao \${toolAccuracy.toFixed(3)}\`);
    if (argAccuracy < limits.minArgAccuracy) failures.push(\`argumentos \${argAccuracy.toFixed(3)}\`);
    if (spuriousRate > limits.maxSpuriousCalls) failures.push(\`espurias \${spuriousRate.toFixed(3)}\`);

    return {
      approved: failures.length === 0,
      failures,
      metrics: { toolAccuracy, argAccuracy, spuriousRate },
      results,
    };
  }

  return { run, runCase };
}

function argumentMatches(actual, expected) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (typeof expected === 'function') return Boolean(expected(actual));
  return JSON.stringify(actual) === JSON.stringify(expected);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois pontos desse código valem mais do que o resto. O primeiro é o caso negativo, que quase nunca aparece nas suítes que vejo: um conjunto de perguntas que o agente deve responder sem chamar nada. Descrição larga demais produz um agente que consulta o estoque para responder "bom dia", e esse desperdício não aparece em nenhuma métrica de acerto se você só testa casos positivos. O segundo é comparar apenas os argumentos críticos, com expressão regular ou predicado em vez de igualdade exata: o modelo preenche campos opcionais de forma legitimamente variável, e exigir o objeto inteiro idêntico gera falha em toda execução até o time silenciar a suíte.',
        },
      ],
    },
    {
      title: 'O retorno da ferramenta também é contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A regressão mais silenciosa acontece depois da chamada dar certo. A ferramenta responde com status duzentos, o esquema de entrada validou, nenhum log registra nada estranho, e mesmo assim o agente diz ao cliente que não conseguiu localizar o pedido. Isso acontece porque o modelo lê o corpo do retorno como texto, e quando "status" vira "orderStatus" aninhado dentro de "fulfillment", a informação continua lá mas deixou de estar onde a instrução mandava procurar.',
        },
        {
          type: 'paragraph',
          value:
            'A defesa é tratar o retorno com o mesmo rigor da entrada: definir um esquema de saída explícito, mapear a resposta do serviço para esse esquema em uma camada de adaptação e testar esse mapeamento com respostas reais gravadas. Gravar respostas reais é o passo que a maioria pula, e é o que dá valor ao teste, porque a mudança que quebra nunca é a que você imaginou ao escrever o dublê à mão.',
        },
        {
          type: 'ordered',
          items: [
            'Defina um esquema de saída para cada ferramenta, com os campos que a instrução do agente realmente cita, e trate o resto como opcional.',
            'Coloque uma camada de adaptação entre o serviço e o agente, para que mudança de campo do fornecedor pare ali em vez de vazar para o contexto.',
            'Grave respostas reais do serviço em ambiente de homologação, incluindo pelo menos um sucesso, um vazio, um erro de negócio e um erro de infraestrutura.',
            'Rode o mapeamento contra essas respostas gravadas em todo pull request, verificando que os campos citados na instrução continuam presentes e no mesmo lugar.',
            'Renove as respostas gravadas em cadência fixa, porque dublê que envelhece esconde exatamente a mudança que você quer detectar.',
            'Falhe alto quando um campo obrigatório do esquema de saída sumir, em vez de repassar um objeto incompleto para dentro da janela de contexto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quinto item é o que decide se toda essa estrutura vale alguma coisa em seis meses. Uma suíte com respostas gravadas há um ano prova que o seu código continua compatível com uma API que não existe mais nesse formato, e passa uma sensação de segurança pior do que não ter teste nenhum. Uma tarefa agendada que regrava os dublês contra homologação semanalmente e abre um pull request quando o formato muda resolve isso, e transforma a mudança do fornecedor em uma revisão de dez minutos em vez de um incidente.',
        },
        {
          type: 'diagram',
          value: `Onde cada teste entra no caminho da ferramenta

  pergunta do cliente
        |
        v
  [ modelo escolhe ]  <-- suite de selecao (modelo real, casos rotulados)
        |                  mede: ferramenta certa, argumentos, chamada espuria
        v
  [ valida esquema ]  <-- snapshot de contrato (milissegundos, sem provedor)
        |                  mede: obrigatorio novo, enum removido, campo renomeado
        v
  [ chama servico  ]  <-- integracao com dublê gravado de resposta real
        |                  mede: sucesso, vazio, erro de negocio, erro de infra
        v
  [ adapta retorno ]  <-- contrato de saida (campos citados na instrucao)
        |                  mede: campo sumiu, aninhou, mudou de tipo
        v
  [ modelo redige  ]  <-- eval de resposta (caro, roda por evento)

  regra de custo: quanto mais alto no caminho, mais barato o teste
  e mais cedo ele deve falhar`,
        },
      ],
    },
    {
      title: 'O portão no pipeline: o que bloqueia e o que apenas avisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ter os testes não adianta se o pipeline os trata todos igual. Um portão que bloqueia por qualquer diferença faz o time criar o hábito de forçar o merge, e um portão que só avisa não impede nada. A configuração que funciona liga o nível da falha ao tipo de mudança detectada, e usa o resultado do diff de contrato para decidir quais suítes caras precisam rodar naquele pull request específico.',
        },
        {
          type: 'table',
          columns: ['Sinal detectado', 'Ação no pipeline', 'Suíte cara roda?', 'Justificativa'],
          rows: [
            [
              'Parâmetro opcional adicionado',
              'Passa, atualiza o arquivo de referência',
              'Não',
              'Compatível com chamadas existentes',
            ],
            [
              'Parâmetro obrigatório novo',
              'Bloqueia até aprovação explícita',
              'Sim',
              'Toda chamada anterior do modelo passa a ser inválida',
            ],
            [
              'Descrição reescrita',
              'Passa com aviso',
              'Sim',
              'Não quebra a invocação, mas muda a escolha do modelo',
            ],
            [
              'Valor de enumeração removido',
              'Bloqueia',
              'Sim',
              'O modelo aprendeu a produzir um valor que agora é recusado',
            ],
            [
              'Campo do retorno renomeado',
              'Bloqueia',
              'Não',
              'O contrato de saída já prova a quebra sem custo de modelo',
            ],
            [
              'Versão do modelo alterada',
              'Bloqueia até a suíte completa passar',
              'Sim, completa',
              'Seleção de ferramenta muda entre versões sem aviso',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a que mais gente esquece de configurar e a que mais dói. Trocar a versão do modelo não altera uma linha do seu código, então nenhum diff dispara, nenhum teste de esquema falha e o pull request nem existe, porque a troca costuma ser uma variável de ambiente. O comportamento de seleção de ferramenta, porém, muda entre versões: uma descrição que era suficientemente clara para a versão anterior pode passar a competir com outra ferramenta na nova. Amarrar a suíte completa à mudança do identificador do modelo, e não apenas ao diff de código, é o que fecha essa porta.',
        },
        {
          type: 'paragraph',
          value:
            'Sobre o volume, vale ser concreto para o portão não virar uma discussão eterna. Um conjunto crítico de trinta casos, com a chamada parando na primeira decisão e sem executar ferramenta, custa alguns centavos por execução e termina em menos de um minuto quando os casos rodam em paralelo. Isso cabe em qualquer pull request. O conjunto completo, com duzentos ou trezentos casos incluindo os negativos, cabe bem em uma execução diária e nas trocas de versão. Quando alguém argumentar que a suíte é cara, o número a comparar não é o custo dela e sim o custo de uma semana com quinze por cento das conversas escolhendo a ferramenta errada.',
        },
      ],
    },
    {
      title: 'Onde os casos de teste realmente vêm',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A suíte só tem valor se os casos representam o que os clientes perguntam, e casos escritos em uma reunião de planejamento representam o que o time imagina que eles perguntam. A diferença entre as duas coisas costuma ser grande, e aparece como uma suíte de noventa e oito por cento de acerto convivendo com um agente que erra ferramenta o tempo todo em produção.',
        },
        {
          type: 'paragraph',
          value:
            'A fonte certa é o tráfego real, e existem quatro veios que rendem mais do que qualquer sessão de brainstorm. O primeiro são as conversas que terminaram em transferência para humano logo depois de uma chamada de ferramenta, porque quase sempre a ferramenta escolhida foi a errada. O segundo são as conversas com três ou mais chamadas seguidas da mesma ferramenta, que indicam laço de repetição por erro mal formatado. O terceiro são as chamadas que falharam na validação de argumentos, que já vêm com o rótulo pronto. O quarto, e o mais valioso, são as perguntas que geraram chamada de ferramenta e deveriam ter sido respondidas direto, que viram os casos negativos que quase ninguém tem.',
        },
        {
          type: 'code',
          value: `// tools/mine-cases.js
// Extrai candidatos a caso de teste do trafego real. Nao rotula sozinho:
// entrega uma fila priorizada para revisao humana, com o motivo do palpite.

export async function mineToolCases({ db, since, limit = 200 }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.first_user_message,
            c.tool_calls,
            c.handoff_at,
            c.validation_errors
       FROM agent_conversations c
      WHERE c.started_at >= $1
        AND jsonb_array_length(c.tool_calls) > 0
      ORDER BY c.started_at DESC
      LIMIT $2\`,
    [since, limit],
  );

  const candidates = [];

  for (const row of rows) {
    const calls = row.tool_calls ?? [];
    const firstCall = calls[0];

    // Transferencia logo apos a primeira chamada: forte indicio de
    // ferramenta errada, nao de pergunta dificil.
    if (row.handoff_at && calls.length <= 2) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'wrong-tool',
        priority: 3,
      });
      continue;
    }

    // Repeticao da mesma ferramenta: quase sempre erro mal formatado
    // que o modelo nao consegue interpretar como definitivo.
    const repeated = calls.filter((call) => call.name === firstCall?.name).length;
    if (repeated >= 3) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'retry-loop',
        priority: 2,
      });
      continue;
    }

    if ((row.validation_errors ?? []).length > 0) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'bad-arguments',
        priority: 2,
      });
    }
  }

  // Prioridade alta primeiro: o revisor tem tempo limitado e cada caso
  // rotulado vira teste permanente, entao a ordem importa mais que o volume.
  return candidates.sort((a, b) => b.priority - a.priority);
}`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto de disciplina aqui é que a mineração entrega candidatos, não casos. Quem rotula é uma pessoa, porque decidir qual seria a ferramenta certa naquela conversa é exatamente o julgamento que a suíte vai congelar. Rotulagem automática a partir do próprio comportamento do agente produz uma suíte que confirma o que o sistema já faz, incluindo os erros, que é o pior resultado possível: um teste que passa sempre e não protege nada.',
        },
        {
          type: 'paragraph',
          value:
            'Vale fechar com o desconforto que esse trabalho revela. Uma suíte de regressão de ferramenta não impede que a API interna mude, não impede que o fornecedor renomeie um campo e não impede que a nova versão do modelo escolha diferente. O que ela faz é mover a descoberta desses fatos do canal de atendimento para o pipeline, onde eles custam uma revisão em vez de um incidente. Essa é toda a proposta, e é bem mais do que parece quando o time descobre, pela terceira vez no trimestre, que o agente parou de consultar pedido porque alguém achou que renomear um campo era mudança interna.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso rodar a suíte com o modelo real em todo pull request?',
      answer:
        'Não, e insistir nisso costuma matar a prática. O caminho que funciona é separar por camada e por custo. O snapshot de contrato, que compara o esquema exposto ao modelo com uma versão gravada, roda em milissegundos, não chama provedor nenhum e deve rodar em todo pull request, porque pega parâmetro obrigatório novo, valor de enumeração removido e campo renomeado sem custo. O teste de mapeamento do retorno contra respostas reais gravadas também roda sempre, pela mesma razão. A suíte que exige o modelo no laço, que mede seleção de ferramenta e preenchimento de argumentos, fica em duas camadas: um conjunto crítico de vinte a quarenta casos em todo pull request que toca ferramenta ou prompt, e o conjunto completo por evento, quando o diff de contrato aponta mudança de descrição, quando o identificador do modelo muda e uma vez por dia no agendado. Barateia muito parar na primeira decisão do modelo em vez de executar a ferramenta e gerar a resposta final: corta a maior parte dos tokens de saída e todo o custo do serviço de destino.',
    },
    {
      question: 'Como evito que a suíte de seleção vire uma fábrica de falso positivo?',
      answer:
        'Com três decisões concretas. A primeira é comparar apenas os argumentos críticos de cada caso, usando expressão regular ou predicado em vez de igualdade exata do objeto inteiro, porque o modelo preenche campos opcionais de forma legitimamente variável e exigir identidade total gera falha em toda execução até alguém silenciar a suíte. A segunda é separar o hash do esquema de invocação do hash das descrições: ajuste de redação não pode bloquear merge, deve apenas disparar a suíte de seleção, enquanto mudança estrutural bloqueia. A terceira é avaliar por limiar agregado e não caso a caso: defina um piso de acerto de ferramenta, um piso de acerto de argumentos e um teto de chamadas espúrias, e falhe quando a métrica cruzar o limite. Um único caso oscilando não deve derrubar o pipeline, mas uma queda de três pontos na taxa de seleção deve.',
    },
    {
      question: 'De onde tiro os casos de teste sem inventar perguntas artificiais?',
      answer:
        'Do tráfego real, com quatro veios que rendem muito mais que uma sessão de brainstorm. Primeiro, conversas que terminaram em transferência para humano logo depois da primeira ou segunda chamada de ferramenta, porque nesses casos a ferramenta escolhida quase sempre foi a errada. Segundo, conversas com três ou mais chamadas seguidas da mesma ferramenta, que indicam laço de repetição causado por erro mal formatado que o modelo não consegue interpretar como definitivo. Terceiro, chamadas que falharam na validação de argumentos, que já chegam com o rótulo pronto. Quarto, e o mais valioso porque quase ninguém tem, perguntas que geraram chamada de ferramenta mas deveriam ter sido respondidas direto, que viram os casos negativos e protegem contra descrição larga demais. Uma ressalva importante: a mineração entrega candidatos, não casos prontos. Quem rotula precisa ser uma pessoa, porque rotulagem automática a partir do comportamento do próprio agente produz uma suíte que confirma os erros existentes e passa sempre.',
    },
  ],
  conclusion: {
    title: 'Contrato de ferramenta é código de produção, não detalhe de prompt',
    description:
      'Ferramenta de agente falha na fronteira que nenhuma suíte tradicional cobre: entre o teste de API, que valida o serviço, e o eval de prompt, que valida a redação. Congelar o esquema exposto ao modelo com hashes separados para invocação e descoberta, testar seleção com casos rotulados vindos do tráfego real e parando na primeira decisão, incluir casos negativos que provam que o agente não chama ferramenta à toa, tratar o retorno como contrato com respostas reais gravadas e renovadas, e amarrar o portão do pipeline ao tipo de mudança detectada transforma renomeação de campo em revisão de dez minutos em vez de uma semana de conversa errada. Posso mapear os contratos das suas ferramentas, montar o conjunto crítico a partir do seu histórico de conversas e deixar o portão configurado para bloquear o que quebra e apenas avisar o que muda comportamento.',
    cta: 'Falar sobre as ferramentas do meu agente',
  },
  related: [
    {
      label: 'Idempotência em tool use: evitar ação duplicada do agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    {
      label: 'Sandbox de ferramentas: limitar o que o agente pode executar',
      to: '/blog/sandbox-ferramentas-limitar-o-que-agente-pode-executar',
    },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The agent stopped looking up order tracking and nobody touched the prompt. What changed was the internal API: the "status" field became "orderStatus", the error response no longer carries "message", and the date parameter now requires a timezone. None of that broke a test, because the team\'s suite tests the API and tests the prompt, and what broke sits exactly between the two. An agent tool is not just a function: it is a contract with three faces that age at different rates, and the face nobody versions is precisely the one the model reads. This article treats tool regression testing as contract engineering: which three layers need separate tests, how a schema snapshot catches the change the compiler cannot, why testing tool selection with the real model is expensive and how to cut that cost without losing signal, and which gate to place in the pipeline so a contract change stops before it reaches production.',
  sections: [
    {
      title: 'The tool has three contracts, and the team tests only one',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a developer writes a tool for the agent, they see a function: it takes arguments, calls a service, returns data. The test they write reflects that view and covers the execution path well. But the model does not interact with the function, it interacts with its description. Between the prompt and the service there are three independent contracts, and each can regress on its own without taking the other two down.',
        },
        {
          type: 'paragraph',
          value:
            'The first is the discovery contract: tool name, description, parameter names and descriptions, enumerations, requiredness. It is the text the model reads to decide whether that tool fits the question. The second is the invocation contract: the schema validating the arguments the model produced, including types, formats and accepted values. The third is the return contract: the shape of the data that comes back into the context window and becomes the basis of the customer answer. Renaming a return field does not break the input schema, does not break the HTTP call and raises no exception. It just makes the agent say it could not find the information.',
        },
        {
          type: 'table',
          columns: ['Layer', 'Who consumes it', 'How it regresses in practice', 'Test that catches it'],
          rows: [
            [
              'Discovery',
              'The model, when picking the tool',
              'Description rewritten to be "clearer" and selection rate drops',
              'Selection suite with labeled cases',
            ],
            [
              'Invocation',
              'The argument validator',
              'A parameter becomes required or changes date format',
              'Schema snapshot plus compatibility check',
            ],
            [
              'Return',
              'The model, when drafting the answer',
              'Field renamed or nested one level deeper',
              'Response contract with recorded data',
            ],
            [
              'Side effect',
              'The target system',
              'The action starts requiring confirmation or turns async',
              'Integration test with real service or faithful double',
            ],
            [
              'Error',
              'The model, when deciding whether to retry',
              'Error format changes and the agent enters a retry loop',
              'Explicit failure cases in the suite',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row deserves attention because it produces the most expensive incident on the list. When the error format changes, the model loses the only clue it had about what to do next, and the default behavior of almost every agent in that situation is to retry with the same arguments. The result is a conversation burning ten tool calls and three times the token budget to end in a generic unavailability message. No API test catches that, because from the API point of view the error was returned correctly.',
        },
      ],
    },
    {
      title: 'Freezing the schema: the cheapest test there is',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before anything involving the model, there is a test that costs milliseconds and catches most contract regressions: record the schema exposed to the model in a versioned file and fail when it changes unintentionally. It is the same principle as an interface snapshot test, applied to the artifact the model sees. The difference from an ordinary snapshot is that the comparison cannot be raw text, otherwise any key reordering produces a false positive and the team learns to update the file without reading it.',
        },
        {
          type: 'paragraph',
          value:
            'What works is normalizing the schema, generating a hash per tool and classifying the difference. Adding an optional parameter is compatible. Adding a required one, removing an enumeration value, tightening a format or renaming a field is breaking. Changing only the description does not break invocation, but it changes discovery, so it needs a different signal: it does not block the merge, but it forces the selection suite to run.',
        },
        {
          type: 'code',
          value: `// tools/schema-contract.js
// Freezes the contract exposed to the model and classifies the difference
// between the recorded version and the current one. Runs in milliseconds,
// with no provider call.

import { createHash } from 'node:crypto';

// Normalize so key reordering does not produce a false positive.
// The description goes into a separate hash: it does not break invocation,
// but it changes discovery and must trigger the selection suite.
function normalizeParameters(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeParameters);

  return Object.keys(schema)
    .filter((key) => key !== 'description')
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalizeParameters(schema[key]);
      return acc;
    }, {});
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function fingerprintTool(tool) {
  return {
    name: tool.name,
    invocationHash: hashOf(normalizeParameters(tool.parameters)),
    discoveryHash: hashOf({
      description: tool.description,
      parameterDescriptions: collectDescriptions(tool.parameters),
    }),
    required: [...(tool.parameters?.required ?? [])].sort(),
    enums: collectEnums(tool.parameters),
  };
}

function collectDescriptions(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (typeof schema.description === 'string') out[path || '.'] = schema.description;
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectDescriptions(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

function collectEnums(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema.enum)) out[path || '.'] = [...schema.enum].sort();
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectEnums(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

// Classify the change instead of just flagging a difference. The team needs
// to know whether it blocks the merge or only requires the selection suite.
export function diffContracts(baseline, current) {
  const findings = [];
  const byName = new Map(current.map((tool) => [tool.name, tool]));

  for (const before of baseline) {
    const after = byName.get(before.name);

    if (!after) {
      findings.push({ tool: before.name, level: 'breaking', reason: 'tool removed' });
      continue;
    }

    if (before.invocationHash !== after.invocationHash) {
      const newRequired = after.required.filter((key) => !before.required.includes(key));
      const lostEnum = Object.entries(before.enums).flatMap(([path, values]) =>
        values.filter((value) => !(after.enums[path] ?? []).includes(value)),
      );

      findings.push({
        tool: before.name,
        level: newRequired.length || lostEnum.length ? 'breaking' : 'compatible',
        reason: newRequired.length
          ? \`new required parameters: \${newRequired.join(', ')}\`
          : lostEnum.length
            ? \`enum values removed: \${lostEnum.join(', ')}\`
            : 'schema changed in a compatible way',
      });
    }

    if (before.discoveryHash !== after.discoveryHash) {
      findings.push({
        tool: before.name,
        level: 'behavioral',
        reason: 'description changed, run the selection suite before merging',
      });
    }
  }

  for (const after of current) {
    if (!baseline.some((before) => before.name === after.name)) {
      findings.push({ tool: after.name, level: 'behavioral', reason: 'new tool' });
    }
  }

  return findings;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Separating the invocation hash from the discovery hash is the detail that makes this test survive contact with the team. If any wording tweak blocks the merge, someone will start regenerating the reference file reflexively within two weeks and the test becomes decoration. By splitting the two faces, text edits become a warning that triggers the expensive suite, and structural change becomes a block, which is the proportional behavior in each case.',
        },
      ],
    },
    {
      title: 'Testing tool selection without wrecking the budget',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The frozen schema does not answer the question that matters most: given the customer question, does the agent still pick the right tool with the right arguments? That layer requires the model in the loop, because it is behavior and not structure. And this is where almost every team gives up, because running two hundred cases against the large model on every pull request has a cost and a latency nobody accepts on the merge path.',
        },
        {
          type: 'paragraph',
          value:
            'The way out is not reducing coverage, it is separating what always runs from what runs on an event. A small set of critical cases, somewhere between twenty and forty, runs on every pull request touching tools or prompts. The full set runs when the contract diff flags a behavioral change, when the model version changes, and once a day on a schedule. The savings come from a simple and very effective technical detail: this test does not need to execute the tool or generate the final answer. Asking for the model\'s first decision and stopping there cuts most output tokens and the entire cost of the target service.',
        },
        {
          type: 'code',
          value: `// tools/selection-suite.js
// Tool selection regression suite. It neither executes the tool nor generates
// the final answer: it asks for the first decision and stops there.

const DEFAULT_THRESHOLDS = {
  minToolAccuracy: 0.95,   // picked the right tool
  minArgAccuracy: 0.9,     // filled the critical arguments correctly
  maxSpuriousCalls: 0.02,  // called a tool when none was needed
};

export function createSelectionSuite({ callModel, tools, cases, thresholds = {} }) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };

  async function runCase(testCase) {
    const decision = await callModel({
      messages: [{ role: 'user', content: testCase.userMessage }],
      tools,
      toolChoice: 'auto',
      maxTokens: 512,
    });

    const call = decision.toolCalls?.[0] ?? null;

    // Negative case: the question must be answered without any tool.
    // Testing this matters as much as the positive path, because an overly
    // broad description makes the agent call a tool for "good morning".
    if (testCase.expectedTool === null) {
      return { id: testCase.id, ok: call === null, kind: 'negative', got: call?.name ?? null };
    }

    if (!call) {
      return { id: testCase.id, ok: false, kind: 'missing', got: null };
    }

    if (call.name !== testCase.expectedTool) {
      return { id: testCase.id, ok: false, kind: 'wrong-tool', got: call.name };
    }

    // Compare only the critical arguments. Requiring exact equality of the
    // whole object turns the suite into a false positive factory, because the
    // model fills optional fields in legitimately variable ways.
    const wrongArgs = Object.entries(testCase.expectedArguments ?? {}).filter(
      ([key, expected]) => !argumentMatches(call.arguments?.[key], expected),
    );

    return {
      id: testCase.id,
      ok: wrongArgs.length === 0,
      kind: wrongArgs.length ? 'wrong-args' : 'pass',
      got: Object.fromEntries(wrongArgs.map(([key]) => [key, call.arguments?.[key]])),
    };
  }

  async function run() {
    const results = [];
    for (const testCase of cases) {
      results.push(await runCase(testCase));
    }

    const positives = results.filter((r) => r.kind !== 'negative');
    const negatives = results.filter((r) => r.kind === 'negative');

    const toolAccuracy =
      positives.filter((r) => r.kind !== 'wrong-tool' && r.kind !== 'missing').length /
      Math.max(positives.length, 1);
    const argAccuracy = positives.filter((r) => r.ok).length / Math.max(positives.length, 1);
    const spuriousRate =
      negatives.filter((r) => !r.ok).length / Math.max(negatives.length, 1);

    const failures = [];
    if (toolAccuracy < limits.minToolAccuracy) failures.push(\`selection \${toolAccuracy.toFixed(3)}\`);
    if (argAccuracy < limits.minArgAccuracy) failures.push(\`arguments \${argAccuracy.toFixed(3)}\`);
    if (spuriousRate > limits.maxSpuriousCalls) failures.push(\`spurious \${spuriousRate.toFixed(3)}\`);

    return {
      approved: failures.length === 0,
      failures,
      metrics: { toolAccuracy, argAccuracy, spuriousRate },
      results,
    };
  }

  return { run, runCase };
}

function argumentMatches(actual, expected) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (typeof expected === 'function') return Boolean(expected(actual));
  return JSON.stringify(actual) === JSON.stringify(expected);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two points in that code are worth more than the rest. The first is the negative case, which almost never shows up in the suites I see: a set of questions the agent must answer without calling anything. An overly broad description produces an agent that queries inventory to answer "good morning", and that waste appears in no accuracy metric if you only test positive cases. The second is comparing only the critical arguments, with a regular expression or a predicate instead of exact equality: the model fills optional fields in legitimately variable ways, and demanding an identical object produces failures on every run until the team silences the suite.',
        },
      ],
    },
    {
      title: 'The tool return is a contract too',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The quietest regression happens after the call succeeds. The tool answers with a two hundred status, the input schema validated, no log records anything unusual, and still the agent tells the customer it could not locate the order. That happens because the model reads the return body as text, and when "status" becomes "orderStatus" nested inside "fulfillment", the information is still there but no longer where the instruction told it to look.',
        },
        {
          type: 'paragraph',
          value:
            'The defense is treating the return with the same rigor as the input: define an explicit output schema, map the service response onto that schema in an adaptation layer and test that mapping against recorded real responses. Recording real responses is the step most teams skip, and it is what gives the test its value, because the change that breaks you is never the one you imagined while hand writing the double.',
        },
        {
          type: 'ordered',
          items: [
            'Define an output schema for each tool, with the fields the agent instruction actually cites, and treat the rest as optional.',
            'Put an adaptation layer between the service and the agent, so a vendor field change stops there instead of leaking into the context.',
            'Record real service responses in staging, including at least one success, one empty result, one business error and one infrastructure error.',
            'Run the mapping against those recorded responses on every pull request, checking that the fields cited in the instruction are still present and in the same place.',
            'Refresh the recorded responses on a fixed cadence, because an aging double hides exactly the change you want to detect.',
            'Fail loudly when a required output field disappears, instead of passing an incomplete object into the context window.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth item decides whether this whole structure is worth anything in six months. A suite with responses recorded a year ago proves your code is still compatible with an API that no longer exists in that shape, and it conveys a sense of safety worse than having no test at all. A scheduled job that re-records the doubles against staging weekly and opens a pull request when the shape changes solves it, and turns a vendor change into a ten minute review instead of an incident.',
        },
        {
          type: 'diagram',
          value: `Where each test sits along the tool path

  customer question
        |
        v
  [ model chooses ]  <-- selection suite (real model, labeled cases)
        |                 measures: right tool, arguments, spurious call
        v
  [ validate schema ] <-- contract snapshot (milliseconds, no provider)
        |                 measures: new required, enum removed, field renamed
        v
  [ call service   ] <-- integration with recorded real-response double
        |                 measures: success, empty, business error, infra error
        v
  [ adapt return   ] <-- output contract (fields cited in the instruction)
        |                 measures: field gone, nested, type changed
        v
  [ model drafts   ] <-- answer eval (expensive, runs on events)

  cost rule: the higher up the path, the cheaper the test
  and the earlier it should fail`,
        },
      ],
    },
    {
      title: 'The pipeline gate: what blocks and what only warns',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Having the tests is pointless if the pipeline treats them all the same. A gate that blocks on any difference teaches the team to force merges, and a gate that only warns prevents nothing. The configuration that works ties the failure level to the type of change detected, and uses the contract diff result to decide which expensive suites need to run on that specific pull request.',
        },
        {
          type: 'table',
          columns: ['Detected signal', 'Pipeline action', 'Expensive suite runs?', 'Rationale'],
          rows: [
            [
              'Optional parameter added',
              'Pass, refresh the reference file',
              'No',
              'Compatible with existing calls',
            ],
            [
              'New required parameter',
              'Block until explicit approval',
              'Yes',
              'Every previous model call becomes invalid',
            ],
            [
              'Description rewritten',
              'Pass with a warning',
              'Yes',
              'Does not break invocation, but changes the model choice',
            ],
            [
              'Enumeration value removed',
              'Block',
              'Yes',
              'The model learned to emit a value that is now refused',
            ],
            [
              'Return field renamed',
              'Block',
              'No',
              'The output contract already proves the break with no model cost',
            ],
            [
              'Model version changed',
              'Block until the full suite passes',
              'Yes, the full one',
              'Tool selection changes between versions without warning',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is the one most people forget to configure and the one that hurts most. Changing the model version does not alter a line of your code, so no diff fires, no schema test fails and the pull request does not even exist, because the swap is usually an environment variable. Tool selection behavior, however, does change between versions: a description that was clear enough for the previous version may start competing with another tool in the new one. Tying the full suite to a change in the model identifier, and not only to a code diff, is what closes that door.',
        },
        {
          type: 'paragraph',
          value:
            'On volume, it is worth being concrete so the gate does not become an endless debate. A critical set of thirty cases, stopping at the first decision and never executing a tool, costs a few cents per run and finishes in under a minute when the cases run in parallel. That fits in any pull request. The full set, with two or three hundred cases including the negatives, fits comfortably in a daily run and in version swaps. When someone argues the suite is expensive, the number to compare against is not its cost but the cost of a week with fifteen percent of conversations picking the wrong tool.',
        },
      ],
    },
    {
      title: 'Where test cases actually come from',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The suite is only worth something if the cases represent what customers ask, and cases written in a planning meeting represent what the team imagines they ask. The gap between those two is usually wide, and it shows up as a suite with ninety-eight percent accuracy coexisting with an agent that picks the wrong tool constantly in production.',
        },
        {
          type: 'paragraph',
          value:
            'The right source is real traffic, and there are four seams that yield far more than any brainstorming session. The first is conversations that ended in a handoff to a human right after a tool call, because the tool chosen was almost always the wrong one. The second is conversations with three or more consecutive calls to the same tool, which indicate a retry loop caused by a badly formatted error. The third is calls that failed argument validation, which already come with the label attached. The fourth, and the most valuable, is questions that triggered a tool call and should have been answered directly, which become the negative cases almost nobody has.',
        },
        {
          type: 'code',
          value: `// tools/mine-cases.js
// Extracts test case candidates from real traffic. It does not label them:
// it hands over a prioritized queue for human review, with the guess reason.

export async function mineToolCases({ db, since, limit = 200 }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.first_user_message,
            c.tool_calls,
            c.handoff_at,
            c.validation_errors
       FROM agent_conversations c
      WHERE c.started_at >= $1
        AND jsonb_array_length(c.tool_calls) > 0
      ORDER BY c.started_at DESC
      LIMIT $2\`,
    [since, limit],
  );

  const candidates = [];

  for (const row of rows) {
    const calls = row.tool_calls ?? [];
    const firstCall = calls[0];

    // Handoff right after the first call: a strong hint of the wrong tool,
    // not of a hard question.
    if (row.handoff_at && calls.length <= 2) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'wrong-tool',
        priority: 3,
      });
      continue;
    }

    // Repeating the same tool: almost always a badly formatted error the
    // model cannot interpret as final.
    const repeated = calls.filter((call) => call.name === firstCall?.name).length;
    if (repeated >= 3) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'retry-loop',
        priority: 2,
      });
      continue;
    }

    if ((row.validation_errors ?? []).length > 0) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'bad-arguments',
        priority: 2,
      });
    }
  }

  // High priority first: the reviewer has limited time and every labeled case
  // becomes a permanent test, so ordering matters more than volume.
  return candidates.sort((a, b) => b.priority - a.priority);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The discipline point here is that mining delivers candidates, not cases. A person does the labeling, because deciding which tool would have been right in that conversation is exactly the judgment the suite is going to freeze. Automatic labeling derived from the agent\'s own behavior produces a suite that confirms what the system already does, errors included, which is the worst possible outcome: a test that always passes and protects nothing.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing with the discomfort this work reveals. A tool regression suite does not stop the internal API from changing, does not stop the vendor from renaming a field and does not stop the new model version from choosing differently. What it does is move the discovery of those facts from the support channel to the pipeline, where they cost a review instead of an incident. That is the whole proposition, and it is a lot more than it sounds when the team finds out, for the third time in a quarter, that the agent stopped looking up orders because someone decided renaming a field was an internal change.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need to run the suite against the real model on every pull request?',
      answer:
        'No, and insisting on it usually kills the practice. What works is separating by layer and by cost. The contract snapshot, which compares the schema exposed to the model with a recorded version, runs in milliseconds, calls no provider and should run on every pull request, because it catches a new required parameter, a removed enumeration value and a renamed field at no cost. The return mapping test against recorded real responses also runs always, for the same reason. The suite requiring the model in the loop, measuring tool selection and argument filling, sits in two tiers: a critical set of twenty to forty cases on every pull request touching tools or prompts, and the full set on events, when the contract diff flags a description change, when the model identifier changes and once a day on a schedule. Stopping at the model\'s first decision instead of executing the tool and generating the final answer makes it far cheaper: it cuts most output tokens and the entire cost of the target service.',
    },
    {
      question: 'How do I keep the selection suite from becoming a false positive factory?',
      answer:
        'With three concrete decisions. First, compare only the critical arguments of each case, using a regular expression or a predicate instead of exact equality of the whole object, because the model fills optional fields in legitimately variable ways and demanding full identity produces failures on every run until someone silences the suite. Second, separate the invocation schema hash from the description hash: a wording tweak must not block a merge, it should only trigger the selection suite, while structural change blocks. Third, evaluate by aggregate threshold rather than case by case: set a floor for tool accuracy, a floor for argument accuracy and a ceiling for spurious calls, and fail when the metric crosses the limit. A single flapping case should not take the pipeline down, but a three point drop in selection rate should.',
    },
    {
      question: 'Where do I get test cases without inventing artificial questions?',
      answer:
        'From real traffic, with four seams that yield far more than a brainstorming session. First, conversations that ended in a handoff to a human right after the first or second tool call, because in those cases the chosen tool was almost always wrong. Second, conversations with three or more consecutive calls to the same tool, which indicate a retry loop caused by a badly formatted error the model cannot interpret as final. Third, calls that failed argument validation, which arrive already labeled. Fourth, and the most valuable because almost nobody has them, questions that triggered a tool call but should have been answered directly, which become the negative cases and protect against overly broad descriptions. One important caveat: mining delivers candidates, not finished cases. A person must do the labeling, because automatic labeling derived from the agent\'s own behavior produces a suite that confirms the existing errors and always passes.',
    },
  ],
  conclusion: {
    title: 'A tool contract is production code, not a prompt detail',
    description:
      'Agent tools fail at the boundary no traditional suite covers: between the API test, which validates the service, and the prompt eval, which validates the wording. Freezing the schema exposed to the model with separate hashes for invocation and discovery, testing selection with labeled cases mined from real traffic and stopping at the first decision, including negative cases that prove the agent does not call tools gratuitously, treating the return as a contract with real responses recorded and refreshed, and tying the pipeline gate to the type of change detected turns a field rename into a ten minute review instead of a week of wrong answers. I can map your tool contracts, build the critical set from your conversation history and leave the gate configured to block what breaks and merely warn about what changes behavior.',
    cta: 'Talk about my agent tools',
  },
  related: [
    {
      label: 'Idempotency in tool use: avoiding duplicate agent actions',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    {
      label: 'Tool sandbox: limiting what the agent can execute',
      to: '/blog/sandbox-ferramentas-limitar-o-que-agente-pode-executar',
    },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'El agente dejó de consultar el seguimiento de pedidos y nadie tocó el prompt. Lo que cambió fue la API interna: el campo "status" pasó a llamarse "orderStatus", la respuesta de error ya no trae "message" y el parámetro de fecha ahora exige zona horaria. Nada de eso rompió una prueba, porque la suite del equipo prueba la API y prueba el prompt, y lo que se rompió está exactamente entre las dos. Una herramienta de agente no es solo una función: es un contrato con tres caras que envejecen a ritmos distintos, y la cara que nadie versiona es justamente la que el modelo lee. Este artículo trata las pruebas de regresión de herramientas como ingeniería de contratos: qué tres capas necesitan pruebas separadas, cómo un snapshot del esquema atrapa el cambio que el compilador no atrapa, por qué probar la selección de herramienta con el modelo real es caro y cómo reducir ese costo sin perder señal, y qué compuerta poner en el pipeline para que un cambio de contrato se detenga antes de llegar a producción.',
  sections: [
    {
      title: 'La herramienta tiene tres contratos, y el equipo prueba solo uno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando un desarrollador escribe una herramienta para el agente, ve una función: recibe argumentos, llama a un servicio, devuelve datos. La prueba que escribe refleja esa visión y cubre bien el camino de ejecución. Pero el modelo no interactúa con la función, interactúa con su descripción. Entre el prompt y el servicio hay tres contratos independientes, y cada uno puede regresar por su cuenta sin tirar a los otros dos.',
        },
        {
          type: 'paragraph',
          value:
            'El primero es el contrato de descubrimiento: nombre de la herramienta, descripción, nombres y descripciones de los parámetros, enumeraciones, obligatoriedad. Es el texto que el modelo lee para decidir si esa herramienta sirve para la pregunta. El segundo es el contrato de invocación: el esquema que valida los argumentos que el modelo produjo, incluyendo tipos, formatos y valores aceptados. El tercero es el contrato de retorno: la forma de los datos que vuelven a la ventana de contexto y se vuelven base de la respuesta al cliente. Renombrar un campo del retorno no rompe el esquema de entrada, no rompe la llamada HTTP y no genera excepción. Solo hace que el agente diga que no encontró la información.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Quién la consume', 'Cómo regresa en la práctica', 'Prueba que la atrapa'],
          rows: [
            [
              'Descubrimiento',
              'El modelo, al elegir la herramienta',
              'Descripción reescrita para ser "más clara" y la tasa de selección cae',
              'Suite de selección con casos etiquetados',
            ],
            [
              'Invocación',
              'El validador de argumentos',
              'Un parámetro se vuelve obligatorio o cambia de formato de fecha',
              'Snapshot del esquema más prueba de compatibilidad',
            ],
            [
              'Retorno',
              'El modelo, al redactar la respuesta',
              'Campo renombrado o anidado un nivel más adentro',
              'Contrato de respuesta con datos grabados',
            ],
            [
              'Efecto colateral',
              'El sistema de destino',
              'La acción pasa a exigir confirmación o se vuelve asíncrona',
              'Prueba de integración con servicio real o doble fiel',
            ],
            [
              'Error',
              'El modelo, al decidir si reintenta',
              'El formato de error cambia y el agente entra en bucle de reintentos',
              'Casos de falla explícitos en la suite',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila merece atención porque produce el incidente más caro de la lista. Cuando el formato de error cambia, el modelo pierde la única pista que tenía sobre qué hacer a continuación, y el comportamiento por defecto de casi todo agente en esa situación es reintentar con los mismos argumentos. El resultado es una conversación que consume diez llamadas de herramienta y tres veces el presupuesto de tokens para terminar en un mensaje genérico de indisponibilidad. Ninguna prueba de API atrapa eso, porque desde el punto de vista de la API el error se devolvió correctamente.',
        },
      ],
    },
    {
      title: 'Congelar el esquema: la prueba más barata que existe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de cualquier cosa que involucre al modelo, hay una prueba que cuesta milisegundos y atrapa la mayor parte de las regresiones de contrato: grabar el esquema expuesto al modelo en un archivo versionado y fallar cuando cambie sin intención. Es el mismo principio de una prueba de snapshot de interfaz, aplicado al artefacto que el modelo ve. La diferencia frente a un snapshot común es que aquí la comparación no puede ser de texto crudo, porque cualquier reordenamiento de claves genera falso positivo y el equipo aprende a actualizar el archivo sin leerlo.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que funciona es normalizar el esquema, generar un hash por herramienta y clasificar la diferencia. Agregar un parámetro opcional es compatible. Agregar uno obligatorio, quitar un valor de enumeración, endurecer un formato o renombrar un campo es ruptura. Cambiar solo la descripción no rompe la invocación, pero cambia el descubrimiento, así que necesita una señal distinta: no bloquea el merge, pero obliga a correr la suite de selección.',
        },
        {
          type: 'code',
          value: `// tools/schema-contract.js
// Congela el contrato expuesto al modelo y clasifica la diferencia entre la
// version grabada y la actual. Corre en milisegundos, sin llamar al proveedor.

import { createHash } from 'node:crypto';

// Normaliza para que el reordenamiento de claves no genere falso positivo.
// La descripcion entra en un hash separado: no rompe la invocacion,
// pero cambia el descubrimiento y debe disparar la suite de seleccion.
function normalizeParameters(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(normalizeParameters);

  return Object.keys(schema)
    .filter((key) => key !== 'description')
    .sort()
    .reduce((acc, key) => {
      acc[key] = normalizeParameters(schema[key]);
      return acc;
    }, {});
}

function hashOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

export function fingerprintTool(tool) {
  return {
    name: tool.name,
    invocationHash: hashOf(normalizeParameters(tool.parameters)),
    discoveryHash: hashOf({
      description: tool.description,
      parameterDescriptions: collectDescriptions(tool.parameters),
    }),
    required: [...(tool.parameters?.required ?? [])].sort(),
    enums: collectEnums(tool.parameters),
  };
}

function collectDescriptions(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (typeof schema.description === 'string') out[path || '.'] = schema.description;
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectDescriptions(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

function collectEnums(schema, path = '', out = {}) {
  if (!schema || typeof schema !== 'object') return out;
  if (Array.isArray(schema.enum)) out[path || '.'] = [...schema.enum].sort();
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    collectEnums(value, \`\${path}.\${key}\`, out);
  }
  return out;
}

// Clasifica el cambio en vez de solo senalar la diferencia. El equipo necesita
// saber si aquello bloquea el merge o solo exige correr la suite de seleccion.
export function diffContracts(baseline, current) {
  const findings = [];
  const byName = new Map(current.map((tool) => [tool.name, tool]));

  for (const before of baseline) {
    const after = byName.get(before.name);

    if (!after) {
      findings.push({ tool: before.name, level: 'breaking', reason: 'herramienta eliminada' });
      continue;
    }

    if (before.invocationHash !== after.invocationHash) {
      const newRequired = after.required.filter((key) => !before.required.includes(key));
      const lostEnum = Object.entries(before.enums).flatMap(([path, values]) =>
        values.filter((value) => !(after.enums[path] ?? []).includes(value)),
      );

      findings.push({
        tool: before.name,
        level: newRequired.length || lostEnum.length ? 'breaking' : 'compatible',
        reason: newRequired.length
          ? \`nuevos parametros obligatorios: \${newRequired.join(', ')}\`
          : lostEnum.length
            ? \`valores de enum eliminados: \${lostEnum.join(', ')}\`
            : 'esquema modificado de forma compatible',
      });
    }

    if (before.discoveryHash !== after.discoveryHash) {
      findings.push({
        tool: before.name,
        level: 'behavioral',
        reason: 'la descripcion cambio, corra la suite de seleccion antes del merge',
      });
    }
  }

  for (const after of current) {
    if (!baseline.some((before) => before.name === after.name)) {
      findings.push({ tool: after.name, level: 'behavioral', reason: 'herramienta nueva' });
    }
  }

  return findings;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Separar el hash de invocación del hash de descubrimiento es el detalle que hace que esta prueba sobreviva al contacto con el equipo. Si cualquier ajuste de redacción bloquea el merge, alguien va a regenerar el archivo de referencia por reflejo en dos semanas y la prueba se vuelve decoración. Al separar las dos caras, el ajuste de texto se vuelve un aviso que dispara la suite cara, y el cambio estructural se vuelve un bloqueo, que es el comportamiento proporcional en cada caso.',
        },
      ],
    },
    {
      title: 'Probar la selección de herramienta sin romper el presupuesto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El esquema congelado no responde la pregunta que más importa: dada la pregunta del cliente, ¿el agente sigue eligiendo la herramienta correcta con los argumentos correctos? Esa capa exige el modelo en el bucle, porque es comportamiento y no estructura. Y es aquí donde casi todo equipo se rinde, porque correr doscientos casos contra el modelo grande en cada pull request tiene un costo y una latencia que nadie acepta en el camino del merge.',
        },
        {
          type: 'paragraph',
          value:
            'La salida no es reducir la cobertura, es separar lo que corre siempre de lo que corre por evento. Un conjunto pequeño de casos críticos, entre veinte y cuarenta, corre en cada pull request que toca herramientas o prompts. El conjunto completo corre cuando el diff de contrato señala un cambio de comportamiento, cuando cambia la versión del modelo y una vez al día en el agendado. El abaratamiento viene de un detalle técnico simple y muy eficaz: esta prueba no necesita ejecutar la herramienta ni generar la respuesta final. Basta pedir la primera decisión del modelo y detenerse ahí, lo que corta la mayor parte de los tokens de salida y todo el costo del servicio de destino.',
        },
        {
          type: 'code',
          value: `// tools/selection-suite.js
// Suite de regresion de seleccion de herramienta. No ejecuta la herramienta ni
// genera la respuesta final: pide solo la primera decision y se detiene ahi.

const DEFAULT_THRESHOLDS = {
  minToolAccuracy: 0.95,   // eligio la herramienta correcta
  minArgAccuracy: 0.9,     // completo los argumentos criticos correctos
  maxSpuriousCalls: 0.02,  // llamo herramienta en un caso que no la requeria
};

export function createSelectionSuite({ callModel, tools, cases, thresholds = {} }) {
  const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };

  async function runCase(testCase) {
    const decision = await callModel({
      messages: [{ role: 'user', content: testCase.userMessage }],
      tools,
      toolChoice: 'auto',
      maxTokens: 512,
    });

    const call = decision.toolCalls?.[0] ?? null;

    // Caso negativo: la pregunta debe responderse sin herramienta.
    // Probarlo importa tanto como el positivo, porque una descripcion
    // demasiado amplia hace que el agente llame herramienta para "buenos dias".
    if (testCase.expectedTool === null) {
      return { id: testCase.id, ok: call === null, kind: 'negative', got: call?.name ?? null };
    }

    if (!call) {
      return { id: testCase.id, ok: false, kind: 'missing', got: null };
    }

    if (call.name !== testCase.expectedTool) {
      return { id: testCase.id, ok: false, kind: 'wrong-tool', got: call.name };
    }

    // Compara solo los argumentos criticos. Exigir igualdad exacta del objeto
    // entero convierte la suite en una fabrica de falsos positivos, porque el
    // modelo completa campos opcionales de forma legitimamente variable.
    const wrongArgs = Object.entries(testCase.expectedArguments ?? {}).filter(
      ([key, expected]) => !argumentMatches(call.arguments?.[key], expected),
    );

    return {
      id: testCase.id,
      ok: wrongArgs.length === 0,
      kind: wrongArgs.length ? 'wrong-args' : 'pass',
      got: Object.fromEntries(wrongArgs.map(([key]) => [key, call.arguments?.[key]])),
    };
  }

  async function run() {
    const results = [];
    for (const testCase of cases) {
      results.push(await runCase(testCase));
    }

    const positives = results.filter((r) => r.kind !== 'negative');
    const negatives = results.filter((r) => r.kind === 'negative');

    const toolAccuracy =
      positives.filter((r) => r.kind !== 'wrong-tool' && r.kind !== 'missing').length /
      Math.max(positives.length, 1);
    const argAccuracy = positives.filter((r) => r.ok).length / Math.max(positives.length, 1);
    const spuriousRate =
      negatives.filter((r) => !r.ok).length / Math.max(negatives.length, 1);

    const failures = [];
    if (toolAccuracy < limits.minToolAccuracy) failures.push(\`seleccion \${toolAccuracy.toFixed(3)}\`);
    if (argAccuracy < limits.minArgAccuracy) failures.push(\`argumentos \${argAccuracy.toFixed(3)}\`);
    if (spuriousRate > limits.maxSpuriousCalls) failures.push(\`espurias \${spuriousRate.toFixed(3)}\`);

    return {
      approved: failures.length === 0,
      failures,
      metrics: { toolAccuracy, argAccuracy, spuriousRate },
      results,
    };
  }

  return { run, runCase };
}

function argumentMatches(actual, expected) {
  if (expected instanceof RegExp) return typeof actual === 'string' && expected.test(actual);
  if (typeof expected === 'function') return Boolean(expected(actual));
  return JSON.stringify(actual) === JSON.stringify(expected);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos puntos de ese código valen más que el resto. El primero es el caso negativo, que casi nunca aparece en las suites que veo: un conjunto de preguntas que el agente debe responder sin llamar nada. Una descripción demasiado amplia produce un agente que consulta el inventario para responder "buenos días", y ese desperdicio no aparece en ninguna métrica de acierto si solo se prueban casos positivos. El segundo es comparar únicamente los argumentos críticos, con expresión regular o predicado en vez de igualdad exacta: el modelo completa campos opcionales de forma legítimamente variable, y exigir el objeto entero idéntico genera falla en cada ejecución hasta que el equipo silencie la suite.',
        },
      ],
    },
    {
      title: 'El retorno de la herramienta también es contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La regresión más silenciosa ocurre después de que la llamada sale bien. La herramienta responde con estado doscientos, el esquema de entrada validó, ningún log registra nada extraño, y aun así el agente le dice al cliente que no pudo localizar el pedido. Eso pasa porque el modelo lee el cuerpo del retorno como texto, y cuando "status" se vuelve "orderStatus" anidado dentro de "fulfillment", la información sigue ahí pero dejó de estar donde la instrucción mandaba buscar.',
        },
        {
          type: 'paragraph',
          value:
            'La defensa es tratar el retorno con el mismo rigor que la entrada: definir un esquema de salida explícito, mapear la respuesta del servicio a ese esquema en una capa de adaptación y probar ese mapeo con respuestas reales grabadas. Grabar respuestas reales es el paso que la mayoría se salta, y es lo que le da valor a la prueba, porque el cambio que rompe nunca es el que imaginaste al escribir el doble a mano.',
        },
        {
          type: 'ordered',
          items: [
            'Defina un esquema de salida para cada herramienta, con los campos que la instrucción del agente realmente cita, y trate el resto como opcional.',
            'Coloque una capa de adaptación entre el servicio y el agente, para que un cambio de campo del proveedor se detenga ahí en vez de filtrarse al contexto.',
            'Grabe respuestas reales del servicio en homologación, incluyendo al menos un éxito, un resultado vacío, un error de negocio y un error de infraestructura.',
            'Corra el mapeo contra esas respuestas grabadas en cada pull request, verificando que los campos citados en la instrucción siguen presentes y en el mismo lugar.',
            'Renueve las respuestas grabadas con una cadencia fija, porque un doble que envejece esconde justamente el cambio que quiere detectar.',
            'Falle en voz alta cuando desaparezca un campo obligatorio del esquema de salida, en vez de pasar un objeto incompleto a la ventana de contexto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El quinto punto decide si toda esta estructura vale algo en seis meses. Una suite con respuestas grabadas hace un año demuestra que su código sigue siendo compatible con una API que ya no existe en ese formato, y transmite una sensación de seguridad peor que no tener prueba alguna. Una tarea agendada que regrabe los dobles contra homologación semanalmente y abra un pull request cuando el formato cambie resuelve eso, y convierte el cambio del proveedor en una revisión de diez minutos en vez de un incidente.',
        },
        {
          type: 'diagram',
          value: `Donde entra cada prueba en el camino de la herramienta

  pregunta del cliente
        |
        v
  [ el modelo elige ] <-- suite de seleccion (modelo real, casos etiquetados)
        |                  mide: herramienta correcta, argumentos, llamada espuria
        v
  [ valida esquema  ] <-- snapshot de contrato (milisegundos, sin proveedor)
        |                  mide: obligatorio nuevo, enum eliminado, campo renombrado
        v
  [ llama servicio  ] <-- integracion con doble grabado de respuesta real
        |                  mide: exito, vacio, error de negocio, error de infra
        v
  [ adapta retorno  ] <-- contrato de salida (campos citados en la instruccion)
        |                  mide: campo desaparecido, anidado, cambio de tipo
        v
  [ el modelo redacta ] <-- eval de respuesta (caro, corre por evento)

  regla de costo: cuanto mas arriba en el camino, mas barata la prueba
  y mas temprano debe fallar`,
        },
      ],
    },
    {
      title: 'La compuerta en el pipeline: qué bloquea y qué solo avisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tener las pruebas no sirve si el pipeline las trata a todas igual. Una compuerta que bloquea ante cualquier diferencia le enseña al equipo a forzar el merge, y una que solo avisa no impide nada. La configuración que funciona liga el nivel de la falla al tipo de cambio detectado, y usa el resultado del diff de contrato para decidir qué suites caras deben correr en ese pull request específico.',
        },
        {
          type: 'table',
          columns: ['Señal detectada', 'Acción en el pipeline', '¿Corre la suite cara?', 'Justificación'],
          rows: [
            [
              'Parámetro opcional agregado',
              'Pasa, actualiza el archivo de referencia',
              'No',
              'Compatible con las llamadas existentes',
            ],
            [
              'Parámetro obligatorio nuevo',
              'Bloquea hasta aprobación explícita',
              'Sí',
              'Toda llamada anterior del modelo pasa a ser inválida',
            ],
            [
              'Descripción reescrita',
              'Pasa con aviso',
              'Sí',
              'No rompe la invocación, pero cambia la elección del modelo',
            ],
            [
              'Valor de enumeración eliminado',
              'Bloquea',
              'Sí',
              'El modelo aprendió a emitir un valor que ahora es rechazado',
            ],
            [
              'Campo del retorno renombrado',
              'Bloquea',
              'No',
              'El contrato de salida ya prueba la ruptura sin costo de modelo',
            ],
            [
              'Versión del modelo cambiada',
              'Bloquea hasta que pase la suite completa',
              'Sí, la completa',
              'La selección de herramienta cambia entre versiones sin aviso',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la que más gente olvida configurar y la que más duele. Cambiar la versión del modelo no altera una línea de su código, así que ningún diff se dispara, ninguna prueba de esquema falla y el pull request ni siquiera existe, porque el cambio suele ser una variable de entorno. El comportamiento de selección de herramienta, sin embargo, sí cambia entre versiones: una descripción que era suficientemente clara para la versión anterior puede pasar a competir con otra herramienta en la nueva. Atar la suite completa al cambio del identificador del modelo, y no solo al diff de código, es lo que cierra esa puerta.',
        },
        {
          type: 'paragraph',
          value:
            'Sobre el volumen, vale ser concreto para que la compuerta no se vuelva una discusión eterna. Un conjunto crítico de treinta casos, deteniéndose en la primera decisión y sin ejecutar herramienta, cuesta unos centavos por ejecución y termina en menos de un minuto cuando los casos corren en paralelo. Eso cabe en cualquier pull request. El conjunto completo, con doscientos o trescientos casos incluyendo los negativos, cabe bien en una ejecución diaria y en los cambios de versión. Cuando alguien argumente que la suite es cara, el número a comparar no es su costo sino el de una semana con quince por ciento de las conversaciones eligiendo la herramienta equivocada.',
        },
      ],
    },
    {
      title: 'De dónde vienen realmente los casos de prueba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La suite solo vale algo si los casos representan lo que los clientes preguntan, y los casos escritos en una reunión de planificación representan lo que el equipo imagina que preguntan. La distancia entre esas dos cosas suele ser grande, y aparece como una suite con noventa y ocho por ciento de acierto conviviendo con un agente que se equivoca de herramienta todo el tiempo en producción.',
        },
        {
          type: 'paragraph',
          value:
            'La fuente correcta es el tráfico real, y hay cuatro vetas que rinden mucho más que cualquier sesión de lluvia de ideas. La primera son las conversaciones que terminaron en transferencia a humano justo después de una llamada de herramienta, porque casi siempre la herramienta elegida fue la equivocada. La segunda son las conversaciones con tres o más llamadas seguidas a la misma herramienta, que indican un bucle de reintentos por un error mal formateado. La tercera son las llamadas que fallaron en la validación de argumentos, que ya vienen con la etiqueta puesta. La cuarta, y la más valiosa, son las preguntas que generaron llamada de herramienta y debían haberse respondido directo, que se convierten en los casos negativos que casi nadie tiene.',
        },
        {
          type: 'code',
          value: `// tools/mine-cases.js
// Extrae candidatos a caso de prueba del trafico real. No los etiqueta solo:
// entrega una fila priorizada para revision humana, con el motivo del indicio.

export async function mineToolCases({ db, since, limit = 200 }) {
  const rows = await db.query(
    \`SELECT c.conversation_id,
            c.first_user_message,
            c.tool_calls,
            c.handoff_at,
            c.validation_errors
       FROM agent_conversations c
      WHERE c.started_at >= $1
        AND jsonb_array_length(c.tool_calls) > 0
      ORDER BY c.started_at DESC
      LIMIT $2\`,
    [since, limit],
  );

  const candidates = [];

  for (const row of rows) {
    const calls = row.tool_calls ?? [];
    const firstCall = calls[0];

    // Transferencia justo despues de la primera llamada: fuerte indicio de
    // herramienta equivocada, no de pregunta dificil.
    if (row.handoff_at && calls.length <= 2) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'wrong-tool',
        priority: 3,
      });
      continue;
    }

    // Repeticion de la misma herramienta: casi siempre un error mal formateado
    // que el modelo no logra interpretar como definitivo.
    const repeated = calls.filter((call) => call.name === firstCall?.name).length;
    if (repeated >= 3) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'retry-loop',
        priority: 2,
      });
      continue;
    }

    if ((row.validation_errors ?? []).length > 0) {
      candidates.push({
        conversationId: row.conversation_id,
        userMessage: row.first_user_message,
        observedTool: firstCall?.name ?? null,
        guess: 'bad-arguments',
        priority: 2,
      });
    }
  }

  // Prioridad alta primero: el revisor tiene tiempo limitado y cada caso
  // etiquetado se vuelve prueba permanente, asi que el orden importa mas
  // que el volumen.
  return candidates.sort((a, b) => b.priority - a.priority);
}`,
        },
        {
          type: 'paragraph',
          value:
            'El punto de disciplina aquí es que la minería entrega candidatos, no casos. Quien etiqueta es una persona, porque decidir cuál habría sido la herramienta correcta en esa conversación es exactamente el juicio que la suite va a congelar. El etiquetado automático a partir del propio comportamiento del agente produce una suite que confirma lo que el sistema ya hace, errores incluidos, que es el peor resultado posible: una prueba que pasa siempre y no protege nada.',
        },
        {
          type: 'paragraph',
          value:
            'Vale cerrar con la incomodidad que este trabajo revela. Una suite de regresión de herramientas no impide que la API interna cambie, no impide que el proveedor renombre un campo y no impide que la nueva versión del modelo elija distinto. Lo que hace es mover el descubrimiento de esos hechos del canal de atención al pipeline, donde cuestan una revisión en vez de un incidente. Esa es toda la propuesta, y es bastante más de lo que parece cuando el equipo descubre, por tercera vez en el trimestre, que el agente dejó de consultar pedidos porque alguien pensó que renombrar un campo era un cambio interno.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito correr la suite con el modelo real en cada pull request?',
      answer:
        'No, e insistir en eso suele matar la práctica. El camino que funciona es separar por capa y por costo. El snapshot de contrato, que compara el esquema expuesto al modelo con una versión grabada, corre en milisegundos, no llama a ningún proveedor y debe correr en cada pull request, porque atrapa parámetro obligatorio nuevo, valor de enumeración eliminado y campo renombrado sin costo. La prueba de mapeo del retorno contra respuestas reales grabadas también corre siempre, por la misma razón. La suite que exige el modelo en el bucle, que mide selección de herramienta y llenado de argumentos, queda en dos niveles: un conjunto crítico de veinte a cuarenta casos en cada pull request que toca herramientas o prompts, y el conjunto completo por evento, cuando el diff de contrato señala un cambio de descripción, cuando cambia el identificador del modelo y una vez al día en el agendado. Abarata mucho detenerse en la primera decisión del modelo en vez de ejecutar la herramienta y generar la respuesta final: corta la mayor parte de los tokens de salida y todo el costo del servicio de destino.',
    },
    {
      question: '¿Cómo evito que la suite de selección se vuelva una fábrica de falsos positivos?',
      answer:
        'Con tres decisiones concretas. La primera es comparar solo los argumentos críticos de cada caso, usando expresión regular o predicado en vez de igualdad exacta del objeto entero, porque el modelo completa campos opcionales de forma legítimamente variable y exigir identidad total genera falla en cada ejecución hasta que alguien silencie la suite. La segunda es separar el hash del esquema de invocación del hash de las descripciones: un ajuste de redacción no puede bloquear el merge, solo debe disparar la suite de selección, mientras que el cambio estructural bloquea. La tercera es evaluar por umbral agregado y no caso por caso: defina un piso de acierto de herramienta, un piso de acierto de argumentos y un techo de llamadas espurias, y falle cuando la métrica cruce el límite. Un único caso oscilando no debe tirar el pipeline, pero una caída de tres puntos en la tasa de selección sí.',
    },
    {
      question: '¿De dónde saco los casos de prueba sin inventar preguntas artificiales?',
      answer:
        'Del tráfico real, con cuatro vetas que rinden mucho más que una sesión de lluvia de ideas. Primero, conversaciones que terminaron en transferencia a humano justo después de la primera o segunda llamada de herramienta, porque en esos casos la herramienta elegida casi siempre fue la equivocada. Segundo, conversaciones con tres o más llamadas seguidas a la misma herramienta, que indican un bucle de reintentos causado por un error mal formateado que el modelo no logra interpretar como definitivo. Tercero, llamadas que fallaron en la validación de argumentos, que llegan ya etiquetadas. Cuarto, y el más valioso porque casi nadie lo tiene, preguntas que generaron llamada de herramienta pero debían haberse respondido directo, que se vuelven los casos negativos y protegen contra descripciones demasiado amplias. Una advertencia importante: la minería entrega candidatos, no casos terminados. Quien etiqueta debe ser una persona, porque el etiquetado automático a partir del comportamiento del propio agente produce una suite que confirma los errores existentes y pasa siempre.',
    },
  ],
  conclusion: {
    title: 'El contrato de la herramienta es código de producción, no un detalle del prompt',
    description:
      'Las herramientas del agente fallan en la frontera que ninguna suite tradicional cubre: entre la prueba de API, que valida el servicio, y el eval de prompt, que valida la redacción. Congelar el esquema expuesto al modelo con hashes separados para invocación y descubrimiento, probar la selección con casos etiquetados extraídos del tráfico real y deteniéndose en la primera decisión, incluir casos negativos que prueben que el agente no llama herramientas de gratis, tratar el retorno como contrato con respuestas reales grabadas y renovadas, y atar la compuerta del pipeline al tipo de cambio detectado convierte el renombrado de un campo en una revisión de diez minutos en vez de una semana de respuestas equivocadas. Puedo mapear los contratos de sus herramientas, armar el conjunto crítico a partir de su historial de conversaciones y dejar la compuerta configurada para bloquear lo que rompe y solo avisar sobre lo que cambia comportamiento.',
    cta: 'Hablar sobre las herramientas de mi agente',
  },
  related: [
    {
      label: 'Idempotencia en tool use: evitar la acción duplicada del agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    {
      label: 'Sandbox de herramientas: limitar lo que el agente puede ejecutar',
      to: '/blog/sandbox-ferramentas-limitar-o-que-agente-pode-executar',
    },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
