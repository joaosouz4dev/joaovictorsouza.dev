// Conteudo do artigo: sandbox de ferramentas em agente de IA, limitando o que
// o agente consegue executar de verdade em vez de pedir por favor no prompt.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A ferramenta que você entregou ao agente executa. Não importa quantas linhas do prompt digam "só consulte pedidos do próprio cliente" nem quão claro esteja o "nunca cancele sem confirmação": o texto é uma sugestão estatística, e o código que roda depois dela é uma execução real. Todo agente com tool use acaba descobrindo isso do jeito difícil, normalmente quando um cliente colou no chat um identificador que não era dele e o agente consultou com prazer, ou quando uma instrução plantada num documento recuperado convenceu o modelo a chamar a ferramenta de reembolso. O erro de fundo não é o modelo ter obedecido, é o sistema ter permitido. Este artigo trata do que fica entre a intenção do modelo e o efeito no mundo: como classificar ferramenta por efeito e não por nome, por que a autorização precisa ser reavaliada no ponto de execução com a identidade do cliente e não a do serviço, como validar o argumento contra o esquema e depois contra a realidade, como colocar teto de consumo em ferramenta que chama código externo, e como testar que a fuga não passa em vez de torcer para o prompt segurar.',
  sections: [
    {
      title: 'O prompt não é um mecanismo de segurança',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A instrução no system prompt influencia a probabilidade de o modelo pedir uma ação, e é só isso que ela faz. Ela não impede a chamada, não valida o argumento e não acontece no momento em que a ferramenta roda. Entre a decisão do modelo e o efeito no mundo existe um trecho de código seu, e é exatamente esse trecho que decide se o pedido vira execução. Tratar o prompt como controle de acesso é o equivalente a validar formulário só no JavaScript do navegador: funciona para o usuário bem-intencionado e não funciona para nenhum outro.',
        },
        {
          type: 'paragraph',
          value:
            'O que torna o caso do agente pior que o do formulário é que a entrada hostil não precisa vir do cliente. Ela vem do trecho recuperado do RAG, do corpo de um e-mail que o agente foi ler, do retorno de uma ferramenta anterior, de um campo de descrição de produto que alguém preencheu meses atrás. Tudo isso entra no contexto com o mesmo status de texto que a instrução original, e o modelo não tem um canal separado que distinga "isto é dado" de "isto é ordem". A defesa não pode morar no mesmo lugar que o ataque. Ela mora na camada que executa, que é código determinístico e não muda de ideia porque um documento pediu com educação.',
        },
        {
          type: 'diagram',
          value: `Onde a decisao vira efeito

  modelo                 camada de execucao              mundo
    |                           |                          |
    |-- tool_call(name, args) ->|                          |
    |                           | 1. ferramenta existe?    |
    |                           | 2. permitida neste       |
    |                           |    contexto/flag?        |
    |                           | 3. args validam no       |
    |                           |    schema?               |
    |                           | 4. o CLIENTE pode este   |
    |                           |    recurso? (nao o       |
    |                           |    servico)              |
    |                           | 5. dentro do orcamento   |
    |                           |    e do rate limit?      |
    |                           | 6. efeito colateral      |
    |                           |    exige confirmacao?    |
    |                           |------ executa ---------->|
    |<-- resultado ou erro -----|                          |

  o prompt influencia apenas a seta 1 (o pedido).
  as etapas 1..6 sao codigo, e sao elas que decidem.`,
        },
      ],
    },
    {
      title: 'Classificar ferramenta por efeito, não por nome',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de decidir o que sandboxar, é preciso saber o que cada ferramenta faz de verdade, e o nome mente com frequência. Uma ferramenta chamada `buscarPedido` que aceita um identificador arbitrário é, na prática, uma ferramenta de leitura de qualquer pedido da base. Uma chamada `atualizarPreferencia` que grava num campo consumido pelo motor de cobrança é uma ferramenta financeira. O critério útil é o efeito: o que muda no mundo se ela rodar, e o que acontece se ela rodar duas vezes.',
        },
        {
          type: 'table',
          columns: ['Classe', 'Efeito', 'Exemplos', 'Controle mínimo'],
          rows: [
            [
              'Leitura escopada',
              'Nenhum efeito externo, mas expõe dado',
              'Consultar pedido, ler histórico, buscar na base de conhecimento',
              'Escopo forçado pelo servidor: o identificador do cliente nunca vem do argumento',
            ],
            [
              'Escrita reversível',
              'Muda estado, dá para desfazer',
              'Atualizar endereço, marcar ticket, adicionar nota interna',
              'Autorização por identidade do cliente, chave de idempotência, registro em trilha',
            ],
            [
              'Escrita irreversível',
              'Muda estado sem volta ou com custo',
              'Cancelar assinatura, emitir reembolso, enviar mensagem ao cliente final',
              'Confirmação explícita, limite por janela, aprovação humana acima de um valor',
            ],
            [
              'Execução de código',
              'Roda algo que você não escreveu',
              'Interpretar expressão, gerar e rodar consulta, executar script de cálculo',
              'Processo isolado, sem rede, sem disco, com teto de CPU e memória e timeout',
            ],
            [
              'Chamada externa',
              'Fala com um terceiro em nome do cliente',
              'Consultar transportadora, integrar com ERP, disparar webhook',
              'Allowlist de destino, timeout, orçamento de chamadas por conversa',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A classificação não é burocracia: ela define o custo de errar e, portanto, quanto controle vale a pena. Leitura escopada erra e vaza dado. Escrita irreversível erra e o cliente perde a assinatura. Execução de código erra e você tem um interpretador arbitrário rodando dentro do seu processo, que é a maneira mais rápida de transformar um bug de produto num incidente de segurança. Vale escrever a classe junto da definição da ferramenta, não num documento à parte, porque é a definição que o código lê para decidir o que exigir.',
        },
      ],
    },
    {
      title: 'Autorização acontece na execução, com a identidade do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A falha mais comum e mais silenciosa é a ferramenta que recebe o identificador do recurso como argumento e confia nele. O modelo preenche esse campo a partir do contexto, e o contexto inclui tudo que o cliente escreveu. Basta o cliente dizer "consulte o pedido 8842" para o agente consultar o pedido 8842, que pode ser de outra pessoa. Não houve nenhum ataque sofisticado: a ferramenta simplesmente não perguntou se quem estava na conversa podia ver aquilo.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é estrutural e cabe em duas regras. A primeira: o identificador de quem está pedindo nunca vem do argumento, vem do estado da conversa, que foi estabelecido na autenticação e o modelo não consegue tocar. A segunda: a autorização é reavaliada no ponto de execução, com essa identidade, contra o recurso concreto. Não basta ter checado no início da conversa, porque o vínculo entre cliente e recurso pode ter mudado, e principalmente porque a ferramenta não sabe qual recurso seria pedido lá atrás. Um detalhe frequentemente esquecido: as credenciais que o executor usa contra os sistemas internos costumam ser de serviço, com permissão ampla, e é justamente por isso que a checagem por cliente precisa acontecer antes, no seu código.',
        },
        {
          type: 'code',
          value: `// agent/tool-runtime.js
// A execucao da ferramenta e o ponto onde a autorizacao acontece.
// Nada aqui confia no argumento para saber QUEM esta pedindo.

import { z } from 'zod';

const registry = new Map();

export function defineTool({ name, effect, schema, requiresConfirmation = false, handler }) {
  // 'effect' e obrigatorio: e ele que o runtime usa para decidir o rigor.
  if (!['read', 'write_reversible', 'write_irreversible', 'exec', 'external'].includes(effect)) {
    throw new Error('Ferramenta ' + name + ' sem classe de efeito valida');
  }
  registry.set(name, { name, effect, schema, requiresConfirmation, handler });
}

export async function runToolCall(call, session) {
  const tool = registry.get(call.name);
  // Ferramenta desconhecida vira erro tratavel, nao excecao: o modelo
  // pode alucinar um nome e o certo e ele replanejar, nao o turno cair.
  if (!tool) {
    return { ok: false, error: 'unknown_tool', message: 'Ferramenta inexistente.' };
  }
  if (!session.allowedTools.has(tool.name)) {
    return { ok: false, error: 'tool_not_allowed', message: 'Ferramenta indisponivel aqui.' };
  }

  // Validacao de forma. Argumento fora do schema nunca chega ao handler.
  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_arguments',
      // Devolver o motivo permite ao modelo corrigir no proximo turno.
      message: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
    };
  }

  // Autorizacao de dominio: a identidade vem da SESSAO, nunca dos args.
  const decision = await authorize({
    customerId: session.customerId,
    effect: tool.effect,
    args: parsed.data,
  });
  if (!decision.allowed) {
    return { ok: false, error: 'forbidden', message: decision.reason };
  }

  if (tool.requiresConfirmation && !call.confirmationToken) {
    // Nao executa: devolve o pedido de confirmacao para o fluxo tratar.
    return { ok: false, error: 'confirmation_required', preview: decision.preview };
  }

  return tool.handler(parsed.data, {
    customerId: session.customerId,
    conversationId: session.conversationId,
    // Chave derivada da intencao: retry do agente nao duplica o efeito.
    idempotencyKey: session.conversationId + ':' + call.id,
  });
}

// Exemplo: o argumento NAO carrega customerId. O escopo e do servidor.
defineTool({
  name: 'buscar_pedido',
  effect: 'read',
  schema: z.object({ orderId: z.string().regex(/^[A-Z0-9-]{6,20}$/) }),
  handler: (args, ctx) => findOrder({ orderId: args.orderId, customerId: ctx.customerId }),
});`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que `buscar_pedido` não expõe um campo de cliente. O agente pode pedir qualquer identificador de pedido que quiser: a consulta é feita com o cliente da sessão no filtro, e um pedido de outra pessoa simplesmente não é encontrado. Isso é melhor que checar depois e recusar, porque não existe caminho em que o dado é lido antes da checagem, e porque a mensagem de erro não confirma ao curioso que aquele pedido existe.',
        },
      ],
    },
    {
      title: 'Validar o argumento contra o esquema e depois contra a realidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A validação de esquema resolve a forma: campo obrigatório presente, tipo certo, formato plausível, valor dentro de uma lista fechada quando faz sentido. É barata e barra uma classe inteira de erros, incluindo o modelo que inventa um campo ou manda uma string onde deveria ir um número. Mas ela é só a metade fácil. O esquema aceita `quantidade: 999999` e aceita uma data de entrega em 2031, porque ambos são números e datas válidos. O que barra esses é a segunda camada, a validação de domínio, que compara o argumento com o que faz sentido no seu negócio.',
        },
        {
          type: 'list',
          items: [
            'Prefira enum a string livre sempre que o conjunto for conhecido: motivo de cancelamento, tipo de ticket, canal de contato. Enum errado o modelo corrige no turno seguinte, string livre vira uma bifurcação que ninguém previu.',
            'Coloque limites numéricos no esquema, não no handler: quantidade máxima, valor máximo, tamanho de página. O limite ausente é sempre descoberto por um caso extremo em produção.',
            'Valide a coerência entre campos, não só cada campo isolado: data final depois da inicial, valor de reembolso menor ou igual ao valor pago, item pertencente ao pedido informado.',
            'Trate a mensagem de erro como parte do contrato com o modelo: dizer qual campo falhou e por quê permite a correção no turno seguinte; um "argumentos inválidos" genérico produz três tentativas idênticas.',
            'Não use a validação para esconder falta de autorização: recusar por esquema um recurso de outro cliente ainda revela que a diferença existe. Autorização é decisão à parte.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Há um caso que merece atenção especial, o argumento que vira consulta ou expressão. Toda ferramenta que aceita um trecho de linguagem gerado pelo modelo e o interpreta é, por definição, execução de código, mesmo que o nome sugira outra coisa. Uma ferramenta de relatório que recebe um filtro em texto e o concatena numa consulta é injeção esperando acontecer, com o agravante de que o atacante nem precisa falar com você: basta plantar o texto num documento que o RAG vai recuperar. Nesse caso o certo é não aceitar linguagem alguma: exponha parâmetros estruturados, monte a consulta você mesmo, e se a expressividade for realmente necessária, isole a execução como na próxima seção.',
        },
      ],
    },
    {
      title: 'Isolar a execução: processo, rede, tempo e memória',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a ferramenta precisa mesmo rodar algo que você não escreveu, o controle deixa de ser lógico e passa a ser de recursos do sistema operacional. Rodar código gerado dentro do mesmo processo que atende suas conversas é a decisão que transforma qualquer erro em incidente: um laço infinito trava o serviço inteiro, uma alocação grande derruba o processo, um acesso à rede vira exfiltração e um acesso ao disco vira leitura das suas variáveis de ambiente. O isolamento precisa vir do ambiente de execução, não de uma lista de funções proibidas, porque a lista de proibidos é sempre incompleta.',
        },
        {
          type: 'code',
          value: `// agent/sandbox.js
// Execucao isolada em processo filho: sem rede, sem heranca de ambiente,
// com teto de memoria e de tempo. O pai nunca fica esperando pra sempre.

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const LIMITS = {
  timeoutMs: 2000,
  maxOldSpaceMb: 128,
  maxOutputBytes: 64 * 1024,
};

export async function runIsolated(source, input) {
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=' + LIMITS.maxOldSpaceMb,
      // O runner nao importa nada: recebe o fonte pelo stdin e devolve
      // JSON pelo stdout. Sem rede e sem fs porque nada os fornece.
      new URL('./sandbox-runner.mjs', import.meta.url).pathname,
    ],
    {
      // Ambiente vazio: nenhuma credencial do processo pai vaza.
      env: {},
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Grupo proprio para o kill derrubar tambem eventuais netos.
      detached: true,
    },
  );

  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // processo ja morreu; nada a fazer
    }
  }, LIMITS.timeoutMs);

  let out = '';
  let truncated = false;
  child.stdout.on('data', (chunk) => {
    if (out.length + chunk.length > LIMITS.maxOutputBytes) {
      truncated = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ja morreu
      }
      return;
    }
    out += chunk;
  });

  child.stdin.end(JSON.stringify({ source, input }));

  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);

  if (signal === 'SIGKILL') {
    return { ok: false, error: truncated ? 'output_too_large' : 'timeout' };
  }
  if (code !== 0) {
    return { ok: false, error: 'execution_failed' };
  }
  try {
    return { ok: true, value: JSON.parse(out) };
  } catch {
    return { ok: false, error: 'invalid_output' };
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes desse recorte costumam ser omitidos e são justamente os que importam. O ambiente vazio evita que a chave da API do provedor, que está numa variável do processo pai, seja legível pelo código executado. O grupo de processo próprio faz o kill alcançar netos, porque matar só o filho deixa órfão qualquer coisa que ele tenha lançado. E o teto de saída existe porque tempo e memória não cobrem o programa que imprime rápido demais: sem esse limite, o processo pai acumula a string até acabar a memória dele, e o isolamento protegeu o filho contra tudo menos contra derrubar o pai.',
        },
        {
          type: 'paragraph',
          value:
            'Um processo filho é o degrau intermediário, não o topo. Ele isola memória, tempo e ambiente, mas continua compartilhando o kernel e o sistema de arquivos da máquina. Se o código executado vier de fonte não confiável de verdade, o degrau seguinte é um contêiner com sistema de arquivos somente leitura, usuário sem privilégio, rede desligada e limites de CPU declarados, ou um runtime desenhado para isso, como uma máquina virtual de WebAssembly, onde o acesso ao mundo é uma lista explícita do que você concedeu em vez de uma lista do que você bloqueou.',
        },
      ],
    },
    {
      title: 'Teto de consumo: a ferramenta que roda mil vezes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nenhuma chamada individual precisa ser perigosa para o conjunto ser. Um agente em laço, tentando resolver uma tarefa impossível, chama a mesma ferramenta de busca quarenta vezes na mesma conversa; se ela consulta um parceiro que cobra por requisição, a fatura chega antes da percepção do bug. Por isso o teto de uso precisa ser por conversa, não só global: o limite global protege a infraestrutura contra o pico agregado, e é o limite por conversa que impede uma única conversa presa em laço de consumir o orçamento de todas as outras.',
        },
        {
          type: 'ordered',
          items: [
            'Conte chamadas por ferramenta e por conversa, e recuse com erro tratável ao estourar, em vez de deixar o laço rodar até o timeout global.',
            'Some o custo real das ferramentas que custam dinheiro no mesmo orçamento da conversa que já contabiliza os tokens, senão a economia num lado é gasta no outro sem aparecer.',
            'Limite a profundidade do encadeamento: uma ferramenta que dispara outra que dispara outra precisa de um contador que atravesse a cadeia, ou a recursão só é descoberta pela conta.',
            'Trate estouro de teto como sinal, não só como bloqueio: uma conversa que bateu o limite de uma ferramenta é candidata a escalonamento humano, porque o agente evidentemente não está convergindo.',
            'Aplique o mesmo teto às retentativas: um retry automático dentro do handler multiplica o consumo real sem aparecer no contador que só conta chamadas do modelo.',
            'Registre a recusa por teto na trilha de auditoria com a ferramenta e a conversa, porque o padrão de quem bate limite é o melhor mapa de qual ferramenta está mal desenhada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A resposta ao estourar o teto merece o mesmo cuidado da ferramenta desligada por kill switch: devolver ao modelo um erro explícito e tratável, dizendo que aquele recurso não está mais disponível nesta conversa, permite que ele siga com o que tem ou escale. Lançar uma exceção que derruba o turno transforma um limite de proteção numa falha visível ao cliente, e o cliente não fez nada de errado.',
        },
      ],
    },
    {
      title: 'Testar a fuga: o teste que tenta escapar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um sandbox sem teste adversarial é uma hipótese. O teste que importa não é o que confirma que a ferramenta funciona no caminho feliz, é o que tenta sair dela: pedir o recurso de outro cliente, mandar um argumento no limite do esquema, plantar uma instrução no documento recuperado, chamar a ferramenta irreversível sem confirmação, forçar o laço que estoura o teto. Cada um desses vira um caso de teste com uma asserção simples: o efeito não aconteceu e o erro voltou tratável.',
        },
        {
          type: 'code',
          value: `// test/tool-sandbox.spec.js
// Testes que tentam escapar. A asserção e sempre dupla: nao houve efeito
// E o erro voltou tratavel, para o agente conseguir replanejar.

import { describe, it, expect, vi } from 'vitest';
import { runToolCall } from '../agent/tool-runtime.js';

const session = {
  customerId: 'cus_alice',
  conversationId: 'conv_1',
  allowedTools: new Set(['buscar_pedido', 'cancelar_assinatura']),
};

describe('sandbox de ferramentas', () => {
  it('nao le pedido de outro cliente mesmo com o id correto', async () => {
    // 'ord_bob_9' existe, mas pertence a outra pessoa.
    const res = await runToolCall(
      { id: 'c1', name: 'buscar_pedido', arguments: { orderId: 'ORD-BOB-9' } },
      session,
    );
    expect(res.ok).toBe(false);
    // Nao vaza a existencia do recurso: mesma resposta de "nao encontrado".
    expect(res.error).toBe('not_found');
  });

  it('ignora identidade injetada nos argumentos', async () => {
    const res = await runToolCall(
      {
        id: 'c2',
        name: 'buscar_pedido',
        // O modelo foi convencido a mandar um campo extra. O schema e
        // estrito, entao o campo desconhecido derruba a validacao.
        arguments: { orderId: 'ORD-ALICE-1', customerId: 'cus_bob' },
      },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_arguments');
  });

  it('nao executa acao irreversivel sem confirmacao', async () => {
    const cancel = vi.fn();
    const res = await runToolCall(
      { id: 'c3', name: 'cancelar_assinatura', arguments: { reason: 'price' } },
      session,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(res.error).toBe('confirmation_required');
  });

  it('recusa ferramenta fora do conjunto permitido', async () => {
    const res = await runToolCall(
      { id: 'c4', name: 'emitir_reembolso', arguments: { amount: 100 } },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('tool_not_allowed');
  });

  it('mata o codigo isolado que entra em laco infinito', async () => {
    const started = process.hrtime.bigint();
    const res = await runIsolated('while (true) {}', {});
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
    // O teto e 2s: falhar aqui significa que o kill nao alcancou o processo.
    expect(elapsedMs).toBeLessThan(3000);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'Esses testes têm uma propriedade que os torna mais valiosos que a maioria: eles não dependem do modelo. Como a defesa é código determinístico, o teste chama a camada de execução diretamente com o pedido hostil, sem gastar uma chamada ao provedor e sem a variabilidade que tornaria o resultado intermitente. Isso permite rodá-los no CI a cada commit, que é onde eles precisam estar, porque a regressão típica não é alguém apagar a checagem: é alguém adicionar uma ferramenta nova e esquecer de declarar a classe de efeito.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não basta instruir no prompt que o agente não pode executar certas ações?',
      answer:
        'Porque a instrução no prompt só altera a probabilidade de o modelo pedir a ação, e não impede que a ação aconteça. Entre a decisão do modelo e o efeito no mundo existe um trecho de código seu, e é ele que executa: se esse código não valida nada, o pedido vira efeito independentemente do que o prompt dizia. Além disso, no agente a entrada hostil nem precisa vir do cliente. Ela chega pelo trecho recuperado do RAG, pelo corpo de um e-mail que o agente foi ler ou pelo retorno de uma ferramenta anterior, e tudo isso entra no contexto com o mesmo status de texto da instrução original, sem um canal que separe dado de ordem. A defesa não pode morar no mesmo lugar que o ataque: ela mora na camada de execução, que é determinística e não muda de comportamento porque um documento pediu com educação.',
    },
    {
      question: 'Como impedir que o agente acesse dados de outro cliente através de uma ferramenta de leitura?',
      answer:
        'Tirando a identidade do argumento. O identificador de quem está pedindo nunca deve ser um campo que o modelo preenche, porque ele preenche a partir do contexto e o contexto inclui tudo que o cliente escreveu: basta pedir "consulte o pedido 8842" para o agente consultar o pedido 8842. O correto é que a identidade venha do estado da conversa, estabelecido na autenticação, e que a consulta seja montada no servidor com esse cliente no filtro, de modo que um recurso de outra pessoa simplesmente não seja encontrado. Isso é melhor que checar depois e recusar, porque não existe caminho em que o dado é lido antes da checagem e porque a resposta não confirma que aquele recurso existe. Vale lembrar que as credenciais que o executor usa contra os sistemas internos costumam ser de serviço, com permissão ampla, e é exatamente por isso que a checagem por cliente precisa acontecer antes, no seu código.',
    },
    {
      question: 'Quando um processo isolado não é suficiente para rodar código gerado pelo modelo?',
      answer:
        'Um processo filho com ambiente vazio, teto de memória, timeout e limite de saída resolve a maior parte dos casos internos: ele impede que um laço infinito trave o serviço, que uma alocação grande derrube o processo principal e que as variáveis de ambiente do pai, incluindo chaves de API, sejam legíveis pelo código executado. O que ele não faz é isolar o kernel e o sistema de arquivos da máquina, que continuam compartilhados. Se o código executado vem de fonte não confiável de verdade, ou se ele manipula dados de vários clientes, o degrau seguinte é um contêiner com sistema de arquivos somente leitura, usuário sem privilégio, rede desligada e limites de CPU declarados, ou um runtime desenhado para isolamento como uma máquina virtual de WebAssembly, onde o acesso ao mundo é uma lista explícita do que foi concedido em vez de uma lista do que foi bloqueado.',
    },
  ],
  conclusion: {
    title: 'O limite do agente é o que o código permite, não o que o prompt pede',
    description:
      'Todo agente com tool use tem uma fronteira entre o que o modelo pede e o que acontece de verdade, e essa fronteira é código seu. Classificar cada ferramenta pelo efeito define quanto controle ela merece; tirar a identidade dos argumentos e reavaliar a autorização no ponto de execução fecha a leitura de dado alheio; validar contra o esquema e depois contra o domínio barra o argumento absurdo antes do handler; isolar em processo com ambiente vazio, teto de tempo, memória e saída impede que código gerado derrube o serviço; e o teto de consumo por conversa evita que um laço do agente pague a conta de todo mundo. Nada disso depende de o modelo se comportar, que é exatamente o ponto. Posso desenhar e implementar essa camada de execução no seu agente, do registro de ferramentas com classe de efeito aos testes adversariais no CI, para que a ação perigosa seja impossível em vez de improvável.',
    cta: 'Falar sobre sandbox de ferramentas no meu agente',
  },
  related: [
    {
      label: 'Prompt injection em RAG: defender o contexto recuperado',
      to: '/blog/prompt-injection-rag-defender-contexto-recuperado',
    },
    {
      label: 'Idempotência em tool use: evitar ação duplicada do agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'The tool you handed the agent executes. It does not matter how many prompt lines say "only look up orders belonging to the customer" or how clear the "never cancel without confirmation" is: the text is a statistical suggestion, and the code that runs after it is a real execution. Every agent with tool use eventually learns this the hard way, usually when a customer pasted an identifier that was not theirs into the chat and the agent happily looked it up, or when an instruction planted in a retrieved document convinced the model to call the refund tool. The underlying error is not that the model obeyed, it is that the system allowed it. This article is about what sits between the model intent and the effect in the world: how to classify tools by effect and not by name, why authorization has to be re-evaluated at the execution point with the customer identity and not the service one, how to validate the argument against the schema and then against reality, how to cap consumption on a tool that calls external code, and how to test that the escape does not get through instead of hoping the prompt holds.',
  sections: [
    {
      title: 'The prompt is not a security mechanism',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An instruction in the system prompt influences the probability that the model asks for an action, and that is all it does. It does not block the call, does not validate the argument and does not happen at the moment the tool runs. Between the model decision and the effect in the world there is a piece of your code, and that piece is exactly what decides whether the request becomes an execution. Treating the prompt as access control is the equivalent of validating a form only in browser JavaScript: it works for the well-meaning user and for nobody else.',
        },
        {
          type: 'paragraph',
          value:
            'What makes the agent case worse than the form case is that hostile input does not have to come from the customer. It comes from the passage retrieved by RAG, from the body of an email the agent went to read, from the return of a previous tool, from a product description field somebody filled in months ago. All of it enters the context with the same status as text as the original instruction, and the model has no separate channel that distinguishes "this is data" from "this is an order". The defense cannot live in the same place as the attack. It lives in the layer that executes, which is deterministic code and does not change its mind because a document asked politely.',
        },
        {
          type: 'diagram',
          value: `Where the decision becomes an effect

  model                  execution layer                 world
    |                           |                          |
    |-- tool_call(name, args) ->|                          |
    |                           | 1. does the tool exist?  |
    |                           | 2. allowed in this       |
    |                           |    context/flag?         |
    |                           | 3. do the args match     |
    |                           |    the schema?           |
    |                           | 4. can the CUSTOMER      |
    |                           |    access it? (not the   |
    |                           |    service)              |
    |                           | 5. within budget and     |
    |                           |    rate limit?           |
    |                           | 6. does the side effect  |
    |                           |    need confirmation?    |
    |                           |------ execute ---------->|
    |<-- result or error -------|                          |

  the prompt only influences arrow 1 (the request).
  steps 1..6 are code, and they are what decides.`,
        },
      ],
    },
    {
      title: 'Classify tools by effect, not by name',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before deciding what to sandbox, you need to know what each tool actually does, and the name lies often. A tool called `getOrder` that accepts an arbitrary identifier is, in practice, a tool that reads any order in the database. One called `updatePreference` that writes to a field consumed by the billing engine is a financial tool. The useful criterion is the effect: what changes in the world if it runs, and what happens if it runs twice.',
        },
        {
          type: 'table',
          columns: ['Class', 'Effect', 'Examples', 'Minimum control'],
          rows: [
            [
              'Scoped read',
              'No external effect, but exposes data',
              'Look up an order, read history, search the knowledge base',
              'Scope forced by the server: the customer identifier never comes from the argument',
            ],
            [
              'Reversible write',
              'Changes state, can be undone',
              'Update an address, flag a ticket, add an internal note',
              'Authorization by customer identity, idempotency key, audit trail record',
            ],
            [
              'Irreversible write',
              'Changes state with no way back or at a cost',
              'Cancel a subscription, issue a refund, send a message to the end customer',
              'Explicit confirmation, per-window limit, human approval above a threshold',
            ],
            [
              'Code execution',
              'Runs something you did not write',
              'Interpret an expression, generate and run a query, execute a calculation script',
              'Isolated process, no network, no disk, CPU and memory ceiling and a timeout',
            ],
            [
              'External call',
              'Talks to a third party on behalf of the customer',
              'Query the carrier, integrate with the ERP, fire a webhook',
              'Destination allowlist, timeout, call budget per conversation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The classification is not bureaucracy: it defines the cost of being wrong and therefore how much control is worth it. A scoped read goes wrong and leaks data. An irreversible write goes wrong and the customer loses their subscription. Code execution goes wrong and you have an arbitrary interpreter running inside your process, which is the fastest way to turn a product bug into a security incident. It is worth writing the class next to the tool definition, not in a separate document, because the definition is what the code reads to decide what to require.',
        },
      ],
    },
    {
      title: 'Authorization happens at execution, with the customer identity',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common and quietest failure is the tool that receives the resource identifier as an argument and trusts it. The model fills that field from the context, and the context includes everything the customer wrote. It takes only "look up order 8842" for the agent to look up order 8842, which may belong to somebody else. There was no sophisticated attack: the tool simply never asked whether whoever was in the conversation was allowed to see that.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is structural and fits in two rules. First: the identifier of whoever is asking never comes from the argument, it comes from the conversation state, which was established at authentication and the model cannot touch. Second: authorization is re-evaluated at the execution point, with that identity, against the concrete resource. Checking at the start of the conversation is not enough, because the link between customer and resource may have changed, and mainly because the tool did not know back then which resource would be requested. A frequently forgotten detail: the credentials the executor uses against internal systems tend to be service credentials with broad permission, and that is exactly why the per-customer check has to happen earlier, in your code.',
        },
        {
          type: 'code',
          value: `// agent/tool-runtime.js
// Tool execution is where authorization happens. Nothing here trusts
// the argument to know WHO is asking.

import { z } from 'zod';

const registry = new Map();

export function defineTool({ name, effect, schema, requiresConfirmation = false, handler }) {
  // 'effect' is mandatory: it is what the runtime uses to decide rigor.
  if (!['read', 'write_reversible', 'write_irreversible', 'exec', 'external'].includes(effect)) {
    throw new Error('Tool ' + name + ' has no valid effect class');
  }
  registry.set(name, { name, effect, schema, requiresConfirmation, handler });
}

export async function runToolCall(call, session) {
  const tool = registry.get(call.name);
  // Unknown tool becomes a handleable error, not an exception: the model
  // may hallucinate a name and the right move is replanning, not a crash.
  if (!tool) {
    return { ok: false, error: 'unknown_tool', message: 'Tool does not exist.' };
  }
  if (!session.allowedTools.has(tool.name)) {
    return { ok: false, error: 'tool_not_allowed', message: 'Tool unavailable here.' };
  }

  // Shape validation. An argument outside the schema never reaches the handler.
  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_arguments',
      // Returning the reason lets the model fix it on the next turn.
      message: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
    };
  }

  // Domain authorization: the identity comes from the SESSION, never the args.
  const decision = await authorize({
    customerId: session.customerId,
    effect: tool.effect,
    args: parsed.data,
  });
  if (!decision.allowed) {
    return { ok: false, error: 'forbidden', message: decision.reason };
  }

  if (tool.requiresConfirmation && !call.confirmationToken) {
    // Does not execute: returns the confirmation request for the flow to handle.
    return { ok: false, error: 'confirmation_required', preview: decision.preview };
  }

  return tool.handler(parsed.data, {
    customerId: session.customerId,
    conversationId: session.conversationId,
    // Key derived from the intent: an agent retry does not duplicate the effect.
    idempotencyKey: session.conversationId + ':' + call.id,
  });
}

// Example: the argument does NOT carry customerId. The scope is the server's.
defineTool({
  name: 'get_order',
  effect: 'read',
  schema: z.object({ orderId: z.string().regex(/^[A-Z0-9-]{6,20}$/) }),
  handler: (args, ctx) => findOrder({ orderId: args.orderId, customerId: ctx.customerId }),
});`,
        },
        {
          type: 'paragraph',
          value:
            'Note that `get_order` exposes no customer field. The agent may ask for any order identifier it wants: the query is made with the session customer in the filter, and somebody else order simply is not found. That is better than checking afterwards and refusing, because there is no path where the data is read before the check, and because the error message does not confirm to the curious that the order exists.',
        },
      ],
    },
    {
      title: 'Validate the argument against the schema and then against reality',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Schema validation solves the shape: required field present, right type, plausible format, value within a closed list when that makes sense. It is cheap and blocks an entire class of errors, including the model that invents a field or sends a string where a number belongs. But it is only the easy half. The schema accepts `quantity: 999999` and accepts a delivery date in 2031, because both are valid numbers and dates. What blocks those is the second layer, domain validation, which compares the argument with what makes sense in your business.',
        },
        {
          type: 'list',
          items: [
            'Prefer an enum to a free string whenever the set is known: cancellation reason, ticket type, contact channel. A wrong enum the model fixes on the next turn, a free string becomes a branch nobody anticipated.',
            'Put numeric limits in the schema, not in the handler: maximum quantity, maximum amount, page size. A missing limit is always discovered by an extreme case in production.',
            'Validate coherence between fields, not only each field alone: end date after the start date, refund amount less than or equal to the amount paid, item belonging to the given order.',
            'Treat the error message as part of the contract with the model: saying which field failed and why allows a fix on the next turn; a generic "invalid arguments" produces three identical attempts.',
            'Do not use validation to hide missing authorization: rejecting another customer resource by schema still reveals that the difference exists. Authorization is a separate decision.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is one case that deserves special attention, the argument that becomes a query or an expression. Any tool that accepts a piece of language generated by the model and interprets it is, by definition, code execution, even if the name suggests otherwise. A reporting tool that receives a filter as text and concatenates it into a query is injection waiting to happen, with the aggravating factor that the attacker does not even need to talk to you: planting the text in a document that RAG will retrieve is enough. In that case the right move is to accept no language at all: expose structured parameters, build the query yourself, and if expressiveness is genuinely necessary, isolate the execution as in the next section.',
        },
      ],
    },
    {
      title: 'Isolating execution: process, network, time and memory',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the tool really does need to run something you did not write, the control stops being logical and becomes a matter of operating system resources. Running generated code inside the same process that serves your conversations is the decision that turns any error into an incident: an infinite loop freezes the whole service, a large allocation kills the process, network access becomes exfiltration and disk access becomes a read of your environment variables. Isolation has to come from the execution environment, not from a list of forbidden functions, because the forbidden list is always incomplete.',
        },
        {
          type: 'code',
          value: `// agent/sandbox.js
// Isolated execution in a child process: no network, no inherited env,
// with a memory and time ceiling. The parent never waits forever.

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const LIMITS = {
  timeoutMs: 2000,
  maxOldSpaceMb: 128,
  maxOutputBytes: 64 * 1024,
};

export async function runIsolated(source, input) {
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=' + LIMITS.maxOldSpaceMb,
      // The runner imports nothing: it receives the source on stdin and
      // returns JSON on stdout. No network and no fs because nothing provides them.
      new URL('./sandbox-runner.mjs', import.meta.url).pathname,
    ],
    {
      // Empty environment: no parent process credential leaks.
      env: {},
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Own process group so the kill also takes down any grandchildren.
      detached: true,
    },
  );

  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // process already dead; nothing to do
    }
  }, LIMITS.timeoutMs);

  let out = '';
  let truncated = false;
  child.stdout.on('data', (chunk) => {
    if (out.length + chunk.length > LIMITS.maxOutputBytes) {
      truncated = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already dead
      }
      return;
    }
    out += chunk;
  });

  child.stdin.end(JSON.stringify({ source, input }));

  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);

  if (signal === 'SIGKILL') {
    return { ok: false, error: truncated ? 'output_too_large' : 'timeout' };
  }
  if (code !== 0) {
    return { ok: false, error: 'execution_failed' };
  }
  try {
    return { ok: true, value: JSON.parse(out) };
  } catch {
    return { ok: false, error: 'invalid_output' };
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Three details of this snippet tend to be omitted and they are exactly the ones that matter. The empty environment prevents the provider API key, which lives in a parent process variable, from being readable by the executed code. The own process group makes the kill reach grandchildren, because killing only the child orphans anything it spawned. And the output ceiling exists because time and memory do not cover the program that prints too fast: without that limit, the parent process accumulates the string until its own memory runs out, and the isolation protected the child against everything except taking down the parent.',
        },
        {
          type: 'paragraph',
          value:
            'A child process is the middle step, not the top. It isolates memory, time and environment, but it still shares the machine kernel and file system. If the executed code comes from a genuinely untrusted source, the next step is a container with a read-only file system, an unprivileged user, networking off and declared CPU limits, or a runtime designed for it, such as a WebAssembly virtual machine, where access to the world is an explicit list of what you granted instead of a list of what you blocked.',
        },
      ],
    },
    {
      title: 'Consumption caps: the tool that runs a thousand times',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No individual call has to be dangerous for the aggregate to be. An agent stuck in a loop, trying to solve an impossible task, calls the same search tool forty times in the same conversation; if it queries a partner that charges per request, the invoice arrives before anyone notices the bug. That is why the usage cap has to be per conversation, not only global: the global limit protects the infrastructure from the aggregate spike, and it is the per-conversation limit that stops a single looping conversation from consuming everybody else budget.',
        },
        {
          type: 'ordered',
          items: [
            'Count calls per tool and per conversation, and refuse with a handleable error on overflow, instead of letting the loop run until the global timeout.',
            'Add the real cost of tools that cost money to the same conversation budget that already accounts for tokens, otherwise savings on one side get spent on the other without showing up.',
            'Limit chaining depth: a tool that fires another that fires another needs a counter that travels through the chain, or the recursion is only discovered by the invoice.',
            'Treat a cap overflow as a signal, not only as a block: a conversation that hit a tool limit is a candidate for human escalation, because the agent is evidently not converging.',
            'Apply the same cap to retries: an automatic retry inside the handler multiplies real consumption without showing up in a counter that only counts model calls.',
            'Record the cap refusal in the audit trail with the tool and the conversation, because the pattern of who hits limits is the best map of which tool is poorly designed.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The response on overflow deserves the same care as a tool disabled by a kill switch: returning an explicit, handleable error to the model, saying that this capability is no longer available in this conversation, lets it move on with what it has or escalate. Throwing an exception that kills the turn turns a protective limit into a failure the customer sees, and the customer did nothing wrong.',
        },
      ],
    },
    {
      title: 'Testing the escape: the test that tries to break out',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sandbox without an adversarial test is a hypothesis. The test that matters is not the one confirming the tool works on the happy path, it is the one trying to get out of it: requesting another customer resource, sending an argument at the edge of the schema, planting an instruction in the retrieved document, calling the irreversible tool without confirmation, forcing the loop that overflows the cap. Each of those becomes a test case with a simple assertion: the effect did not happen and the error came back handleable.',
        },
        {
          type: 'code',
          value: `// test/tool-sandbox.spec.js
// Tests that try to escape. The assertion is always double: no effect
// happened AND the error came back handleable, so the agent can replan.

import { describe, it, expect, vi } from 'vitest';
import { runToolCall } from '../agent/tool-runtime.js';

const session = {
  customerId: 'cus_alice',
  conversationId: 'conv_1',
  allowedTools: new Set(['get_order', 'cancel_subscription']),
};

describe('tool sandbox', () => {
  it('does not read another customer order even with the right id', async () => {
    // 'ORD-BOB-9' exists, but belongs to somebody else.
    const res = await runToolCall(
      { id: 'c1', name: 'get_order', arguments: { orderId: 'ORD-BOB-9' } },
      session,
    );
    expect(res.ok).toBe(false);
    // Does not leak the resource existence: same "not found" answer.
    expect(res.error).toBe('not_found');
  });

  it('ignores an identity injected into the arguments', async () => {
    const res = await runToolCall(
      {
        id: 'c2',
        name: 'get_order',
        // The model was convinced to send an extra field. The schema is
        // strict, so the unknown field fails validation.
        arguments: { orderId: 'ORD-ALICE-1', customerId: 'cus_bob' },
      },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_arguments');
  });

  it('does not execute an irreversible action without confirmation', async () => {
    const cancel = vi.fn();
    const res = await runToolCall(
      { id: 'c3', name: 'cancel_subscription', arguments: { reason: 'price' } },
      session,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(res.error).toBe('confirmation_required');
  });

  it('refuses a tool outside the allowed set', async () => {
    const res = await runToolCall(
      { id: 'c4', name: 'issue_refund', arguments: { amount: 100 } },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('tool_not_allowed');
  });

  it('kills isolated code that enters an infinite loop', async () => {
    const started = process.hrtime.bigint();
    const res = await runIsolated('while (true) {}', {});
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
    // The ceiling is 2s: failing here means the kill did not reach the process.
    expect(elapsedMs).toBeLessThan(3000);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'These tests have a property that makes them more valuable than most: they do not depend on the model. Since the defense is deterministic code, the test calls the execution layer directly with the hostile request, without spending a provider call and without the variability that would make the result flaky. That lets you run them in CI on every commit, which is where they need to be, because the typical regression is not somebody deleting the check: it is somebody adding a new tool and forgetting to declare the effect class.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why is it not enough to instruct in the prompt that the agent cannot perform certain actions?',
      answer:
        'Because a prompt instruction only changes the probability that the model asks for the action, and does not stop the action from happening. Between the model decision and the effect in the world there is a piece of your code, and that is what executes: if that code validates nothing, the request becomes an effect regardless of what the prompt said. Besides, in an agent the hostile input does not even have to come from the customer. It arrives through the passage retrieved by RAG, through the body of an email the agent went to read or through the return of a previous tool, and all of it enters the context with the same status as text as the original instruction, with no channel separating data from orders. The defense cannot live in the same place as the attack: it lives in the execution layer, which is deterministic and does not change behavior because a document asked politely.',
    },
    {
      question: 'How do you stop the agent from accessing another customer data through a read tool?',
      answer:
        'By taking the identity out of the argument. The identifier of whoever is asking should never be a field the model fills in, because it fills from the context and the context includes everything the customer wrote: "look up order 8842" is enough for the agent to look up order 8842. The correct design is for the identity to come from the conversation state, established at authentication, and for the query to be built on the server with that customer in the filter, so that somebody else resource simply is not found. That is better than checking afterwards and refusing, because there is no path where the data is read before the check and because the answer does not confirm that the resource exists. It is worth remembering that the credentials the executor uses against internal systems tend to be service credentials with broad permission, which is exactly why the per-customer check has to happen earlier, in your code.',
    },
    {
      question: 'When is an isolated process not enough to run model-generated code?',
      answer:
        'A child process with an empty environment, a memory ceiling, a timeout and an output limit solves most internal cases: it stops an infinite loop from freezing the service, a large allocation from killing the main process and the parent environment variables, including API keys, from being readable by the executed code. What it does not do is isolate the machine kernel and file system, which stay shared. If the executed code comes from a genuinely untrusted source, or if it handles data from several customers, the next step is a container with a read-only file system, an unprivileged user, networking off and declared CPU limits, or a runtime designed for isolation such as a WebAssembly virtual machine, where access to the world is an explicit list of what was granted instead of a list of what was blocked.',
    },
  ],
  conclusion: {
    title: 'The agent boundary is what the code allows, not what the prompt asks for',
    description:
      'Every agent with tool use has a frontier between what the model asks and what actually happens, and that frontier is your code. Classifying each tool by effect defines how much control it deserves; taking the identity out of the arguments and re-evaluating authorization at the execution point closes the read of somebody else data; validating against the schema and then against the domain blocks the absurd argument before the handler; isolating in a process with an empty environment and ceilings on time, memory and output stops generated code from taking down the service; and the per-conversation consumption cap keeps an agent loop from paying everybody bill. None of it depends on the model behaving, which is exactly the point. I can design and implement this execution layer in your agent, from a tool registry with effect classes to adversarial tests in CI, so that the dangerous action is impossible rather than unlikely.',
    cta: 'Talk about tool sandboxing in my agent',
  },
  related: [
    {
      label: 'Prompt injection in RAG: defending the retrieved context',
      to: '/blog/prompt-injection-rag-defender-contexto-recuperado',
    },
    {
      label: 'Idempotency in tool use: avoiding a duplicated agent action',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'La herramienta que le entregaste al agente ejecuta. No importa cuántas líneas del prompt digan "solo consulta pedidos del propio cliente" ni qué tan claro esté el "nunca canceles sin confirmación": el texto es una sugerencia estadística, y el código que corre después es una ejecución real. Todo agente con tool use termina descubriéndolo por las malas, normalmente cuando un cliente pegó en el chat un identificador que no era suyo y el agente lo consultó con gusto, o cuando una instrucción plantada en un documento recuperado convenció al modelo de llamar a la herramienta de reembolso. El error de fondo no es que el modelo haya obedecido, es que el sistema lo haya permitido. Este artículo trata de lo que queda entre la intención del modelo y el efecto en el mundo: cómo clasificar herramientas por efecto y no por nombre, por qué la autorización debe reevaluarse en el punto de ejecución con la identidad del cliente y no la del servicio, cómo validar el argumento contra el esquema y después contra la realidad, cómo poner techo de consumo en una herramienta que llama código externo, y cómo probar que la fuga no pasa en vez de confiar en que el prompt aguante.',
  sections: [
    {
      title: 'El prompt no es un mecanismo de seguridad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La instrucción en el system prompt influye en la probabilidad de que el modelo pida una acción, y eso es todo lo que hace. No impide la llamada, no valida el argumento y no ocurre en el momento en que la herramienta corre. Entre la decisión del modelo y el efecto en el mundo hay un trozo de código tuyo, y es exactamente ese trozo el que decide si el pedido se vuelve ejecución. Tratar el prompt como control de acceso equivale a validar un formulario solo en el JavaScript del navegador: funciona para el usuario bienintencionado y para ningún otro.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que vuelve el caso del agente peor que el del formulario es que la entrada hostil no necesita venir del cliente. Viene del fragmento recuperado por el RAG, del cuerpo de un correo que el agente fue a leer, del retorno de una herramienta anterior, de un campo de descripción de producto que alguien llenó hace meses. Todo eso entra en el contexto con el mismo estatus de texto que la instrucción original, y el modelo no tiene un canal separado que distinga "esto es dato" de "esto es orden". La defensa no puede vivir en el mismo lugar que el ataque. Vive en la capa que ejecuta, que es código determinista y no cambia de opinión porque un documento lo pidió con educación.',
        },
        {
          type: 'diagram',
          value: `Donde la decision se vuelve efecto

  modelo                 capa de ejecucion               mundo
    |                           |                          |
    |-- tool_call(name, args) ->|                          |
    |                           | 1. la herramienta existe?|
    |                           | 2. permitida en este     |
    |                           |    contexto/flag?        |
    |                           | 3. los args validan en   |
    |                           |    el schema?            |
    |                           | 4. el CLIENTE puede este |
    |                           |    recurso? (no el       |
    |                           |    servicio)             |
    |                           | 5. dentro del presupuesto|
    |                           |    y del rate limit?     |
    |                           | 6. el efecto colateral   |
    |                           |    exige confirmacion?   |
    |                           |------ ejecuta ---------->|
    |<-- resultado o error -----|                          |

  el prompt influye solo en la flecha 1 (el pedido).
  los pasos 1..6 son codigo, y son ellos los que deciden.`,
        },
      ],
    },
    {
      title: 'Clasificar la herramienta por efecto, no por nombre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de decidir qué aislar hay que saber qué hace realmente cada herramienta, y el nombre miente con frecuencia. Una herramienta llamada `buscarPedido` que acepta un identificador arbitrario es, en la práctica, una herramienta de lectura de cualquier pedido de la base. Una llamada `actualizarPreferencia` que escribe en un campo que consume el motor de cobro es una herramienta financiera. El criterio útil es el efecto: qué cambia en el mundo si corre, y qué pasa si corre dos veces.',
        },
        {
          type: 'table',
          columns: ['Clase', 'Efecto', 'Ejemplos', 'Control mínimo'],
          rows: [
            [
              'Lectura acotada',
              'Ningún efecto externo, pero expone dato',
              'Consultar pedido, leer historial, buscar en la base de conocimiento',
              'Alcance forzado por el servidor: el identificador del cliente nunca viene del argumento',
            ],
            [
              'Escritura reversible',
              'Cambia estado, se puede deshacer',
              'Actualizar dirección, marcar ticket, agregar nota interna',
              'Autorización por identidad del cliente, clave de idempotencia, registro en traza',
            ],
            [
              'Escritura irreversible',
              'Cambia estado sin vuelta o con costo',
              'Cancelar suscripción, emitir reembolso, enviar mensaje al cliente final',
              'Confirmación explícita, límite por ventana, aprobación humana sobre un monto',
            ],
            [
              'Ejecución de código',
              'Corre algo que no escribiste',
              'Interpretar expresión, generar y correr consulta, ejecutar script de cálculo',
              'Proceso aislado, sin red, sin disco, con techo de CPU y memoria y timeout',
            ],
            [
              'Llamada externa',
              'Habla con un tercero en nombre del cliente',
              'Consultar transportista, integrar con el ERP, disparar webhook',
              'Allowlist de destino, timeout, presupuesto de llamadas por conversación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La clasificación no es burocracia: define el costo de equivocarse y, por lo tanto, cuánto control vale la pena. Una lectura acotada se equivoca y filtra dato. Una escritura irreversible se equivoca y el cliente pierde la suscripción. La ejecución de código se equivoca y tienes un intérprete arbitrario corriendo dentro de tu proceso, que es la forma más rápida de convertir un bug de producto en un incidente de seguridad. Vale escribir la clase junto a la definición de la herramienta, no en un documento aparte, porque es la definición lo que el código lee para decidir qué exigir.',
        },
      ],
    },
    {
      title: 'La autorización ocurre en la ejecución, con la identidad del cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El fallo más común y más silencioso es la herramienta que recibe el identificador del recurso como argumento y confía en él. El modelo llena ese campo a partir del contexto, y el contexto incluye todo lo que el cliente escribió. Basta con que el cliente diga "consulta el pedido 8842" para que el agente consulte el pedido 8842, que puede ser de otra persona. No hubo ningún ataque sofisticado: la herramienta simplemente no preguntó si quien estaba en la conversación podía ver eso.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es estructural y cabe en dos reglas. La primera: el identificador de quien pide nunca viene del argumento, viene del estado de la conversación, que se estableció en la autenticación y el modelo no puede tocar. La segunda: la autorización se reevalúa en el punto de ejecución, con esa identidad, contra el recurso concreto. No basta con haberlo verificado al inicio de la conversación, porque el vínculo entre cliente y recurso puede haber cambiado, y sobre todo porque la herramienta no sabía entonces qué recurso se iba a pedir. Un detalle que suele olvidarse: las credenciales que el ejecutor usa contra los sistemas internos suelen ser de servicio, con permiso amplio, y justamente por eso la verificación por cliente debe ocurrir antes, en tu código.',
        },
        {
          type: 'code',
          value: `// agent/tool-runtime.js
// La ejecucion de la herramienta es el punto donde ocurre la autorizacion.
// Nada aqui confia en el argumento para saber QUIEN esta pidiendo.

import { z } from 'zod';

const registry = new Map();

export function defineTool({ name, effect, schema, requiresConfirmation = false, handler }) {
  // 'effect' es obligatorio: es lo que el runtime usa para decidir el rigor.
  if (!['read', 'write_reversible', 'write_irreversible', 'exec', 'external'].includes(effect)) {
    throw new Error('Herramienta ' + name + ' sin clase de efecto valida');
  }
  registry.set(name, { name, effect, schema, requiresConfirmation, handler });
}

export async function runToolCall(call, session) {
  const tool = registry.get(call.name);
  // Herramienta desconocida es error tratable, no excepcion: el modelo
  // puede alucinar un nombre y lo correcto es que replanifique.
  if (!tool) {
    return { ok: false, error: 'unknown_tool', message: 'La herramienta no existe.' };
  }
  if (!session.allowedTools.has(tool.name)) {
    return { ok: false, error: 'tool_not_allowed', message: 'Herramienta no disponible aqui.' };
  }

  // Validacion de forma. Un argumento fuera del schema nunca llega al handler.
  const parsed = tool.schema.safeParse(call.arguments);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_arguments',
      // Devolver el motivo permite al modelo corregir en el proximo turno.
      message: parsed.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; '),
    };
  }

  // Autorizacion de dominio: la identidad viene de la SESION, nunca de los args.
  const decision = await authorize({
    customerId: session.customerId,
    effect: tool.effect,
    args: parsed.data,
  });
  if (!decision.allowed) {
    return { ok: false, error: 'forbidden', message: decision.reason };
  }

  if (tool.requiresConfirmation && !call.confirmationToken) {
    // No ejecuta: devuelve el pedido de confirmacion para que el flujo lo trate.
    return { ok: false, error: 'confirmation_required', preview: decision.preview };
  }

  return tool.handler(parsed.data, {
    customerId: session.customerId,
    conversationId: session.conversationId,
    // Clave derivada de la intencion: un retry del agente no duplica el efecto.
    idempotencyKey: session.conversationId + ':' + call.id,
  });
}

// Ejemplo: el argumento NO lleva customerId. El alcance es del servidor.
defineTool({
  name: 'buscar_pedido',
  effect: 'read',
  schema: z.object({ orderId: z.string().regex(/^[A-Z0-9-]{6,20}$/) }),
  handler: (args, ctx) => findOrder({ orderId: args.orderId, customerId: ctx.customerId }),
});`,
        },
        {
          type: 'paragraph',
          value:
            'Observa que `buscar_pedido` no expone un campo de cliente. El agente puede pedir cualquier identificador de pedido que quiera: la consulta se hace con el cliente de la sesión en el filtro, y un pedido de otra persona simplemente no se encuentra. Eso es mejor que verificar después y rechazar, porque no existe un camino en el que el dato se lea antes de la verificación, y porque el mensaje de error no le confirma al curioso que ese pedido existe.',
        },
      ],
    },
    {
      title: 'Validar el argumento contra el esquema y después contra la realidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La validación de esquema resuelve la forma: campo obligatorio presente, tipo correcto, formato plausible, valor dentro de una lista cerrada cuando tiene sentido. Es barata y bloquea una clase entera de errores, incluido el modelo que inventa un campo o manda una cadena donde debería ir un número. Pero es solo la mitad fácil. El esquema acepta `cantidad: 999999` y acepta una fecha de entrega en 2031, porque ambos son números y fechas válidos. Lo que bloquea eso es la segunda capa, la validación de dominio, que compara el argumento con lo que tiene sentido en tu negocio.',
        },
        {
          type: 'list',
          items: [
            'Prefiere un enum a una cadena libre siempre que el conjunto sea conocido: motivo de cancelación, tipo de ticket, canal de contacto. Un enum equivocado el modelo lo corrige en el turno siguiente, una cadena libre se vuelve una bifurcación que nadie previó.',
            'Pon los límites numéricos en el esquema, no en el handler: cantidad máxima, monto máximo, tamaño de página. El límite ausente siempre lo descubre un caso extremo en producción.',
            'Valida la coherencia entre campos, no solo cada campo aislado: fecha final después de la inicial, monto de reembolso menor o igual al monto pagado, ítem perteneciente al pedido informado.',
            'Trata el mensaje de error como parte del contrato con el modelo: decir qué campo falló y por qué permite la corrección en el turno siguiente; un "argumentos inválidos" genérico produce tres intentos idénticos.',
            'No uses la validación para esconder falta de autorización: rechazar por esquema un recurso de otro cliente igual revela que la diferencia existe. La autorización es una decisión aparte.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Hay un caso que merece atención especial, el argumento que se vuelve consulta o expresión. Toda herramienta que acepta un fragmento de lenguaje generado por el modelo y lo interpreta es, por definición, ejecución de código, aunque el nombre sugiera otra cosa. Una herramienta de reporte que recibe un filtro en texto y lo concatena en una consulta es inyección esperando ocurrir, con el agravante de que el atacante ni siquiera necesita hablar contigo: basta plantar el texto en un documento que el RAG va a recuperar. En ese caso lo correcto es no aceptar lenguaje alguno: expón parámetros estructurados, arma la consulta tú mismo, y si la expresividad es realmente necesaria, aísla la ejecución como en la próxima sección.',
        },
      ],
    },
    {
      title: 'Aislar la ejecución: proceso, red, tiempo y memoria',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la herramienta sí necesita correr algo que no escribiste, el control deja de ser lógico y pasa a ser de recursos del sistema operativo. Correr código generado dentro del mismo proceso que atiende tus conversaciones es la decisión que convierte cualquier error en incidente: un bucle infinito congela el servicio entero, una asignación grande tumba el proceso, un acceso a la red se vuelve exfiltración y un acceso al disco se vuelve lectura de tus variables de entorno. El aislamiento debe venir del ambiente de ejecución, no de una lista de funciones prohibidas, porque la lista de prohibidos siempre está incompleta.',
        },
        {
          type: 'code',
          value: `// agent/sandbox.js
// Ejecucion aislada en proceso hijo: sin red, sin herencia de entorno,
// con techo de memoria y de tiempo. El padre nunca espera para siempre.

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const LIMITS = {
  timeoutMs: 2000,
  maxOldSpaceMb: 128,
  maxOutputBytes: 64 * 1024,
};

export async function runIsolated(source, input) {
  const child = spawn(
    process.execPath,
    [
      '--max-old-space-size=' + LIMITS.maxOldSpaceMb,
      // El runner no importa nada: recibe el fuente por stdin y devuelve
      // JSON por stdout. Sin red y sin fs porque nada se los provee.
      new URL('./sandbox-runner.mjs', import.meta.url).pathname,
    ],
    {
      // Entorno vacio: ninguna credencial del proceso padre se filtra.
      env: {},
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe'],
      // Grupo propio para que el kill tumbe tambien a eventuales nietos.
      detached: true,
    },
  );

  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // el proceso ya murio; nada que hacer
    }
  }, LIMITS.timeoutMs);

  let out = '';
  let truncated = false;
  child.stdout.on('data', (chunk) => {
    if (out.length + chunk.length > LIMITS.maxOutputBytes) {
      truncated = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // ya murio
      }
      return;
    }
    out += chunk;
  });

  child.stdin.end(JSON.stringify({ source, input }));

  const [code, signal] = await once(child, 'exit');
  clearTimeout(timer);

  if (signal === 'SIGKILL') {
    return { ok: false, error: truncated ? 'output_too_large' : 'timeout' };
  }
  if (code !== 0) {
    return { ok: false, error: 'execution_failed' };
  }
  try {
    return { ok: true, value: JSON.parse(out) };
  } catch {
    return { ok: false, error: 'invalid_output' };
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles de este recorte suelen omitirse y son justamente los que importan. El entorno vacío evita que la clave de la API del proveedor, que está en una variable del proceso padre, sea legible por el código ejecutado. El grupo de proceso propio hace que el kill alcance a los nietos, porque matar solo al hijo deja huérfano cualquier cosa que él haya lanzado. Y el techo de salida existe porque tiempo y memoria no cubren al programa que imprime demasiado rápido: sin ese límite, el proceso padre acumula la cadena hasta agotar su propia memoria, y el aislamiento protegió al hijo contra todo menos contra tumbar al padre.',
        },
        {
          type: 'paragraph',
          value:
            'Un proceso hijo es el escalón intermedio, no el techo. Aísla memoria, tiempo y entorno, pero sigue compartiendo el kernel y el sistema de archivos de la máquina. Si el código ejecutado viene de una fuente realmente no confiable, el escalón siguiente es un contenedor con sistema de archivos de solo lectura, usuario sin privilegio, red apagada y límites de CPU declarados, o un runtime diseñado para eso, como una máquina virtual de WebAssembly, donde el acceso al mundo es una lista explícita de lo que concediste en vez de una lista de lo que bloqueaste.',
        },
      ],
    },
    {
      title: 'Techo de consumo: la herramienta que corre mil veces',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ninguna llamada individual necesita ser peligrosa para que el conjunto lo sea. Un agente en bucle, intentando resolver una tarea imposible, llama a la misma herramienta de búsqueda cuarenta veces en la misma conversación; si esa herramienta consulta a un socio que cobra por petición, la factura llega antes que la percepción del bug. Por eso el techo de uso debe ser por conversación, no solo global: el límite global protege la infraestructura contra el pico agregado, y es el límite por conversación el que impide que una sola conversación atascada en bucle consuma el presupuesto de todas las demás.',
        },
        {
          type: 'ordered',
          items: [
            'Cuenta llamadas por herramienta y por conversación, y rechaza con error tratable al desbordar, en vez de dejar el bucle correr hasta el timeout global.',
            'Suma el costo real de las herramientas que cuestan dinero al mismo presupuesto de la conversación que ya contabiliza los tokens, si no el ahorro de un lado se gasta del otro sin aparecer.',
            'Limita la profundidad del encadenamiento: una herramienta que dispara otra que dispara otra necesita un contador que atraviese la cadena, o la recursión solo la descubre la factura.',
            'Trata el desborde del techo como señal, no solo como bloqueo: una conversación que golpeó el límite de una herramienta es candidata a escalamiento humano, porque el agente evidentemente no está convergiendo.',
            'Aplica el mismo techo a los reintentos: un retry automático dentro del handler multiplica el consumo real sin aparecer en el contador que solo cuenta llamadas del modelo.',
            'Registra el rechazo por techo en la traza de auditoría con la herramienta y la conversación, porque el patrón de quien golpea límites es el mejor mapa de qué herramienta está mal diseñada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La respuesta al desbordar el techo merece el mismo cuidado que la herramienta apagada por kill switch: devolver al modelo un error explícito y tratable, diciendo que ese recurso ya no está disponible en esta conversación, le permite seguir con lo que tiene o escalar. Lanzar una excepción que tumba el turno convierte un límite de protección en un fallo visible para el cliente, y el cliente no hizo nada mal.',
        },
      ],
    },
    {
      title: 'Probar la fuga: el test que intenta escapar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un sandbox sin prueba adversarial es una hipótesis. La prueba que importa no es la que confirma que la herramienta funciona en el camino feliz, es la que intenta salir de ella: pedir el recurso de otro cliente, mandar un argumento en el límite del esquema, plantar una instrucción en el documento recuperado, llamar a la herramienta irreversible sin confirmación, forzar el bucle que desborda el techo. Cada uno de esos se vuelve un caso de prueba con una aserción simple: el efecto no ocurrió y el error volvió tratable.',
        },
        {
          type: 'code',
          value: `// test/tool-sandbox.spec.js
// Pruebas que intentan escapar. La asercion es siempre doble: no hubo
// efecto Y el error volvio tratable, para que el agente pueda replanificar.

import { describe, it, expect, vi } from 'vitest';
import { runToolCall } from '../agent/tool-runtime.js';

const session = {
  customerId: 'cus_alice',
  conversationId: 'conv_1',
  allowedTools: new Set(['buscar_pedido', 'cancelar_suscripcion']),
};

describe('sandbox de herramientas', () => {
  it('no lee el pedido de otro cliente aun con el id correcto', async () => {
    // 'ORD-BOB-9' existe, pero pertenece a otra persona.
    const res = await runToolCall(
      { id: 'c1', name: 'buscar_pedido', arguments: { orderId: 'ORD-BOB-9' } },
      session,
    );
    expect(res.ok).toBe(false);
    // No filtra la existencia del recurso: misma respuesta de "no encontrado".
    expect(res.error).toBe('not_found');
  });

  it('ignora la identidad inyectada en los argumentos', async () => {
    const res = await runToolCall(
      {
        id: 'c2',
        name: 'buscar_pedido',
        // Convencieron al modelo de mandar un campo extra. El schema es
        // estricto, entonces el campo desconocido tumba la validacion.
        arguments: { orderId: 'ORD-ALICE-1', customerId: 'cus_bob' },
      },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid_arguments');
  });

  it('no ejecuta accion irreversible sin confirmacion', async () => {
    const cancel = vi.fn();
    const res = await runToolCall(
      { id: 'c3', name: 'cancelar_suscripcion', arguments: { reason: 'price' } },
      session,
    );
    expect(cancel).not.toHaveBeenCalled();
    expect(res.error).toBe('confirmation_required');
  });

  it('rechaza herramienta fuera del conjunto permitido', async () => {
    const res = await runToolCall(
      { id: 'c4', name: 'emitir_reembolso', arguments: { amount: 100 } },
      session,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe('tool_not_allowed');
  });

  it('mata el codigo aislado que entra en bucle infinito', async () => {
    const started = process.hrtime.bigint();
    const res = await runIsolated('while (true) {}', {});
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(res.ok).toBe(false);
    expect(res.error).toBe('timeout');
    // El techo es 2s: fallar aqui significa que el kill no alcanzo al proceso.
    expect(elapsedMs).toBeLessThan(3000);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'Estas pruebas tienen una propiedad que las vuelve más valiosas que la mayoría: no dependen del modelo. Como la defensa es código determinista, la prueba llama a la capa de ejecución directamente con el pedido hostil, sin gastar una llamada al proveedor y sin la variabilidad que volvería el resultado intermitente. Eso permite correrlas en el CI en cada commit, que es donde tienen que estar, porque la regresión típica no es que alguien borre la verificación: es que alguien agregue una herramienta nueva y olvide declarar la clase de efecto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no basta con instruir en el prompt que el agente no puede ejecutar ciertas acciones?',
      answer:
        'Porque la instrucción en el prompt solo altera la probabilidad de que el modelo pida la acción, y no impide que la acción ocurra. Entre la decisión del modelo y el efecto en el mundo hay un trozo de código tuyo, y es él quien ejecuta: si ese código no valida nada, el pedido se vuelve efecto sin importar lo que decía el prompt. Además, en el agente la entrada hostil ni siquiera necesita venir del cliente. Llega por el fragmento recuperado por el RAG, por el cuerpo de un correo que el agente fue a leer o por el retorno de una herramienta anterior, y todo eso entra en el contexto con el mismo estatus de texto que la instrucción original, sin un canal que separe dato de orden. La defensa no puede vivir en el mismo lugar que el ataque: vive en la capa de ejecución, que es determinista y no cambia de comportamiento porque un documento lo pidió con educación.',
    },
    {
      question: '¿Cómo impedir que el agente acceda a datos de otro cliente a través de una herramienta de lectura?',
      answer:
        'Sacando la identidad del argumento. El identificador de quien pide nunca debe ser un campo que el modelo llena, porque lo llena a partir del contexto y el contexto incluye todo lo que el cliente escribió: basta con pedir "consulta el pedido 8842" para que el agente consulte el pedido 8842. Lo correcto es que la identidad venga del estado de la conversación, establecido en la autenticación, y que la consulta se arme en el servidor con ese cliente en el filtro, de modo que un recurso de otra persona simplemente no se encuentre. Eso es mejor que verificar después y rechazar, porque no existe un camino en el que el dato se lea antes de la verificación y porque la respuesta no confirma que ese recurso existe. Vale recordar que las credenciales que el ejecutor usa contra los sistemas internos suelen ser de servicio, con permiso amplio, y justamente por eso la verificación por cliente debe ocurrir antes, en tu código.',
    },
    {
      question: '¿Cuándo un proceso aislado no alcanza para correr código generado por el modelo?',
      answer:
        'Un proceso hijo con entorno vacío, techo de memoria, timeout y límite de salida resuelve la mayor parte de los casos internos: impide que un bucle infinito congele el servicio, que una asignación grande tumbe el proceso principal y que las variables de entorno del padre, incluidas claves de API, sean legibles por el código ejecutado. Lo que no hace es aislar el kernel y el sistema de archivos de la máquina, que siguen compartidos. Si el código ejecutado viene de una fuente realmente no confiable, o si manipula datos de varios clientes, el escalón siguiente es un contenedor con sistema de archivos de solo lectura, usuario sin privilegio, red apagada y límites de CPU declarados, o un runtime diseñado para aislamiento como una máquina virtual de WebAssembly, donde el acceso al mundo es una lista explícita de lo que se concedió en vez de una lista de lo que se bloqueó.',
    },
  ],
  conclusion: {
    title: 'El límite del agente es lo que el código permite, no lo que el prompt pide',
    description:
      'Todo agente con tool use tiene una frontera entre lo que el modelo pide y lo que ocurre de verdad, y esa frontera es código tuyo. Clasificar cada herramienta por el efecto define cuánto control merece; sacar la identidad de los argumentos y reevaluar la autorización en el punto de ejecución cierra la lectura de dato ajeno; validar contra el esquema y después contra el dominio bloquea el argumento absurdo antes del handler; aislar en un proceso con entorno vacío y techos de tiempo, memoria y salida impide que el código generado tumbe el servicio; y el techo de consumo por conversación evita que un bucle del agente pague la cuenta de todos. Nada de eso depende de que el modelo se comporte, que es exactamente el punto. Puedo diseñar e implementar esa capa de ejecución en tu agente, del registro de herramientas con clase de efecto a las pruebas adversariales en el CI, para que la acción peligrosa sea imposible en vez de improbable.',
    cta: 'Hablar sobre sandbox de herramientas en mi agente',
  },
  related: [
    {
      label: 'Prompt injection en RAG: defender el contexto recuperado',
      to: '/blog/prompt-injection-rag-defender-contexto-recuperado',
    },
    {
      label: 'Idempotencia en tool use: evitar acción duplicada del agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default {
  pt,
  en,
  es,
};
