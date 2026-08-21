// Conteudo do artigo: contrato de saida estruturada (quando o esquema do modelo muda sozinho).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O parser quebrou às três da manhã e ninguém tinha feito deploy. O prompt é o mesmo de seis meses atrás, o schema que você declara na chamada é o mesmo, e mesmo assim o campo que sempre vinha como número passou a vir como string, ou um enum ganhou um valor que você nunca escreveu, ou um objeto opcional que nunca aparecia começou a aparecer sempre. Isso não é bug de ninguém: é a consequência de tratar a saída do modelo como se fosse resposta de API versionada quando na verdade ela é uma distribuição de probabilidade que o provedor pode reformar sem te avisar. Este artigo trata a saída estruturada como um contrato de integração de verdade: por que schema declarado não é garantia de execução, como separar o contrato interno do formato que o modelo devolve com uma camada de adaptação, por que campo obrigatório novo é sempre incidente e opcional com default nunca é, como detectar deriva de esquema com métrica em vez de com exceção do parser, e qual teste de contrato roda contra o provedor real antes do usuário descobrir.',
  sections: [
    {
      title: 'Schema declarado não é schema garantido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo provedor sério hoje aceita um schema na chamada, seja como JSON Schema em structured output, seja como definição de tool. A leitura errada disso é achar que o schema vira uma garantia de execução equivalente a um tipo de linguagem estática. Ele não vira. O que o schema faz é restringir fortemente a amostragem: os tokens que violariam a gramática ganham probabilidade zero ou quase zero. Isso resolve JSON sintaticamente quebrado e chave inventada, e é uma melhora enorme. Não resolve o que está na camada semântica acima da gramática: qual valor de enum foi escolhido, se um campo opcional foi preenchido, quantos itens entraram num array, se o número veio como 5 ou como "5" quando o schema aceita união.',
        },
        {
          type: 'paragraph',
          value:
            'Some daí a distinção que organiza o resto do artigo. Uma coisa é a validade sintática, e essa o provedor sustenta bem. Outra é a estabilidade semântica, que ninguém prometeu. Quando um provedor troca a versão do modelo por trás do mesmo alias, quando ajusta o decoder de structured output, quando muda como o schema é convertido internamente em gramática, a distribuição dos valores dentro do formato válido se desloca. Seu código continua fazendo parse com sucesso e passa a tomar decisões diferentes.',
        },
        {
          type: 'table',
          columns: ['Camada', 'Quem garante', 'Falha típica', 'Como você descobre'],
          rows: [
            [
              'Sintaxe JSON',
              'Decoder do provedor',
              'JSON truncado por limite de token',
              'Exceção no parse, na hora',
            ],
            [
              'Forma do schema',
              'Provedor, com boa cobertura',
              'Chave a mais, tipo em união inesperada',
              'Validação estrita, se você tiver uma',
            ],
            [
              'Semântica dos valores',
              'Ninguém',
              'Enum novo, opcional que virou frequente, array vazio',
              'Métrica de distribuição ou reclamação do cliente',
            ],
            [
              'Significado do campo',
              'Ninguém',
              'Mesmo nome, sentido diferente após troca de modelo',
              'Auditoria manual, quase sempre tarde',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha que dói é a terceira. Ela não gera exceção, não aparece em log de erro, e por isso passa direto pelo alerta que você configurou. O sistema continua verde enquanto decide errado.',
        },
      ],
    },
    {
      title: 'O contrato interno não pode ser o formato do modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro estrutural mais caro é deixar o objeto que o modelo devolve circular pelo sistema inteiro. Quando o retorno cru do provedor vira o argumento que atravessa serviço, entra na fila e é persistido, qualquer mudança na saída do modelo se propaga para dezenas de pontos ao mesmo tempo. O conserto exige tocar em tudo, e o rollback fica impossível porque já existe dado gravado no formato antigo e no novo.',
        },
        {
          type: 'paragraph',
          value:
            'A separação certa é a mesma de qualquer integração com terceiro: o formato do provedor é externo, o contrato do domínio é seu, e existe uma camada fina entre eles cuja única responsabilidade é traduzir. Essa camada é o único lugar do código que conhece o formato do modelo. Se o enum ganhar valor novo, o conserto acontece em um arquivo e não em quinze.',
        },
        {
          type: 'diagram',
          value: `modelo                  adaptador                  dominio
  |                         |                          |
  |-- JSON valido --------->|                          |
  |   (forma do provedor)   |                          |
  |                         |-- valida estrito ------->| rejeita se
  |                         |   (chave extra = erro)   | forma mudou
  |                         |                          |
  |                         |-- normaliza ------------>| "5" -> 5
  |                         |   (coercao explicita)    | "URGENTE" -> urgent
  |                         |                          |
  |                         |-- mapeia desconhecido -->| enum novo ->
  |                         |   (nunca descarta)       | bucket "unknown"
  |                         |                          |
  |                         |-- emite metrica -------->| taxa por campo
  |                         |                          |
  |                         |==== Intake (tipo do dominio) ====>
  |                         |     so este atravessa o sistema`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no detalhe do valor desconhecido. A tentação é lançar exceção quando o enum traz algo fora da lista, porque parece o comportamento estrito e correto. Na prática isso transforma uma degradação parcial em indisponibilidade: um valor novo em dois por cento das requisições derruba dois por cento do tráfego. Mapear para um bucket explícito de desconhecido, contar e seguir para o caminho de revisão humana preserva o serviço e ainda te dá o sinal.',
        },
        {
          type: 'code',
          value: `// adapters/intake.js
// Unica fronteira que conhece o formato do modelo. Valida estrito,
// normaliza com coercao explicita e nunca deixa valor novo virar excecao.

const PRIORITIES = new Set(['low', 'normal', 'high']);
const ALLOWED_KEYS = new Set(['intent', 'priority', 'entities', 'confidence']);

export function toIntake(raw, { metrics }) {
  // 1. Chave que o schema nao previa e sinal de deriva, nao de dado extra.
  const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    metrics.increment('intake.unknown_key', { keys: unknownKeys.join(',') });
  }

  // 2. Coercao explicita: aceita "5" e 5, mas registra quando o tipo muda,
  //    porque tipo instavel e o primeiro sintoma de troca de modelo.
  const confidence = coerceNumber(raw.confidence, { metrics, field: 'confidence' });

  // 3. Enum desconhecido vira bucket, nunca excecao. Um valor novo em 2%
  //    das requisicoes nao pode derrubar 2% do trafego.
  let priority = normalizePriority(raw.priority);
  if (!PRIORITIES.has(priority)) {
    metrics.increment('intake.unknown_enum', { field: 'priority', value: String(raw.priority) });
    priority = 'unknown';
  }

  return {
    intent: String(raw.intent ?? '').trim() || 'unclassified',
    priority,
    // Array ausente e array vazio sao coisas diferentes para o dominio:
    // ausente significa "o modelo nao respondeu isso", vazio significa
    // "o modelo respondeu que nao ha nada". Nao colapse os dois.
    entities: Array.isArray(raw.entities) ? raw.entities.map(String) : null,
    confidence: confidence ?? 0,
    needsReview: priority === 'unknown' || confidence === null,
  };
}

function coerceNumber(value, { metrics, field }) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      metrics.increment('intake.type_coercion', { field, from: 'string' });
      return parsed;
    }
  }
  return null;
}

function normalizePriority(value) {
  return String(value ?? '').trim().toLowerCase();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Cada ponto de tolerância desse adaptador emite métrica. Essa é a diferença entre tolerar e ignorar: tolerar é aceitar o desvio e registrá-lo; ignorar é aceitar e ficar em silêncio. Um adaptador que absorve tudo sem contar nada esconde a deriva até o dia em que ela é grande demais.',
        },
      ],
    },
    {
      title: 'A assimetria que decide o tamanho do incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mudanças de esquema não são todas iguais, e vale internalizar a assimetria antes de escrever o primeiro schema. Adicionar um campo opcional com default é seguro: o consumidor antigo ignora, o novo aproveita. Tornar um campo obrigatório é quebra garantida: todo produtor que ainda não manda o campo passa a falhar. Remover um campo quebra quem lê. Trocar o tipo de um campo quebra quem faz parse. Adicionar valor a um enum quebra quem faz switch exaustivo sem cláusula default.',
        },
        {
          type: 'table',
          columns: ['Mudança no esquema', 'Efeito no consumidor', 'Classificação', 'Mitigação'],
          rows: [
            [
              'Campo opcional novo com default',
              'Ignorado por quem não conhece',
              'Compatível',
              'Nenhuma, é o caminho seguro',
            ],
            [
              'Campo obrigatório novo',
              'Falha em todo produtor antigo',
              'Quebra',
              'Lançar como opcional, migrar, depois exigir',
            ],
            [
              'Campo removido',
              'Leitor recebe undefined onde esperava valor',
              'Quebra',
              'Manter por uma janela, marcar como obsoleto',
            ],
            [
              'Tipo alterado (número para string)',
              'Parse silenciosamente errado',
              'Quebra silenciosa',
              'Campo novo com nome novo, nunca reusar o antigo',
            ],
            [
              'Valor novo em enum',
              'Switch exaustivo cai no vazio',
              'Quebra parcial',
              'Bucket de desconhecido mais alerta',
            ],
            [
              'Enum restringido',
              'Produtor manda valor agora inválido',
              'Quebra',
              'Aceitar na leitura por uma janela',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A regra operacional que sai daí é simples e vale para os dois lados: quando você muda o schema que envia ao modelo, adicione sempre como opcional primeiro e só exija depois que a métrica mostrar preenchimento consistente. E quando é o modelo que muda sozinho, a única defesa é o adaptador nunca fazer switch exaustivo sem caminho de escape.',
        },
        {
          type: 'paragraph',
          value:
            'Um caso merece destaque porque é o mais traiçoeiro: a troca de tipo. Quando um campo que era número passa a vir como string, boa parte das linguagens não reclama. JavaScript compara, soma como concatenação e segue. O resultado é uma decisão errada que nunca gera stack trace. É por isso que a coerção precisa ser explícita e instrumentada, e não implícita e silenciosa.',
        },
      ],
    },
    {
      title: 'Detectar deriva com métrica, não com exceção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se o único detector de mudança de esquema é a exceção do parser, você só vê a categoria de falha mais barulhenta e mais rara. A deriva que importa é a que mantém tudo válido e desloca a distribuição. O instrumento certo não é try/catch, é uma métrica por campo comparada contra uma linha de base.',
        },
        {
          type: 'paragraph',
          value:
            'Na prática, quatro séries por campo cobrem quase tudo. Taxa de presença, que é a fração de respostas em que o campo apareceu preenchido. Distribuição de tipo, que é a fração por tipo primitivo observado. Cardinalidade de enum, que é o conjunto distinto de valores visto na janela. E, para arrays, o percentil do tamanho. Deriva aparece nessas séries dias antes de aparecer em reclamação.',
        },
        {
          type: 'code',
          value: `// monitor/schema-drift.js
// Compara a janela recente contra uma linha de base congelada.
// A ideia nao e detectar valor novo isolado, e detectar deslocamento
// sustentado, que e o que indica troca de modelo por baixo.

const PRESENCE_TOLERANCE = 0.10; // 10 pontos percentuais
const MIN_SAMPLES = 200;         // abaixo disso, ruido domina

export function compareToBaseline(window, baseline) {
  const alerts = [];

  for (const [field, current] of Object.entries(window.fields)) {
    const base = baseline.fields[field];
    if (!base || current.samples < MIN_SAMPLES) continue;

    // 1. Campo que passou a vir sempre (ou parou de vir) mudou de papel,
    //    mesmo continuando "opcional" no schema.
    const presenceDelta = current.presenceRate - base.presenceRate;
    if (Math.abs(presenceDelta) > PRESENCE_TOLERANCE) {
      alerts.push({
        field,
        kind: 'presence_shift',
        from: base.presenceRate,
        to: current.presenceRate,
        severity: presenceDelta > 0 ? 'warn' : 'page',
      });
    }

    // 2. Tipo novo em campo estavel e quase sempre troca de modelo.
    for (const type of Object.keys(current.typeShare)) {
      if (!(type in base.typeShare)) {
        alerts.push({ field, kind: 'new_type', type, severity: 'page' });
      }
    }

    // 3. Enum ganhou valor: nao e erro, mas exige decisao humana antes
    //    de o bucket "unknown" crescer sem ninguem olhar.
    const newValues = current.enumValues.filter((v) => !base.enumValues.includes(v));
    if (newValues.length > 0) {
      alerts.push({ field, kind: 'new_enum_value', values: newValues, severity: 'warn' });
    }
  }

  return alerts;
}`,
        },
        {
          type: 'paragraph',
          value:
            'A escolha de severidade não é decorativa. Tipo novo em campo estável é página, porque quase sempre significa que o modelo por trás do alias mudou e o efeito é imediato em decisão de negócio. Valor novo de enum é aviso, porque o bucket de desconhecido já está segurando o tráfego e a decisão pode esperar o horário comercial. Queda de taxa de presença é página quando é queda, porque significa que o sistema parou de receber informação que já usava.',
        },
        {
          type: 'list',
          items: [
            'Congele a linha de base numa versão explícita e datada, não numa média móvel dos últimos sete dias, senão a deriva lenta vira a nova normalidade sem nunca disparar.',
            'Exija um mínimo de amostras por janela antes de comparar, porque com volume baixo a variação natural gera alerta falso e o time aprende a ignorar.',
            'Monitore por combinação de modelo e versão de prompt, não só por endpoint, senão um rollout de prompt em dez por cento do tráfego fica invisível dentro do agregado.',
            'Alerte no bucket de desconhecido crescendo, e não só no valor novo aparecendo: um enum que ninguém revisou vira caminho de revisão humana entupido.',
          ],
        },
      ],
    },
    {
      title: 'Teste de contrato contra o provedor real',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Teste unitário com resposta fixa em fixture prova que seu adaptador funciona, o que é necessário e insuficiente: ele nunca vai te avisar que o provedor mudou, porque a fixture é sua e está congelada. O que fecha o buraco é uma suíte de contrato que roda contra o provedor de verdade, em agenda fixa, com um conjunto pequeno de entradas representativas, e falha quando a forma da saída sai do envelope acordado.',
        },
        {
          type: 'ordered',
          items: [
            'Escolha de vinte a quarenta entradas que cubram os caminhos que importam, incluindo os casos de borda que produzem campos opcionais, arrays vazios e valores raros de enum.',
            'Rode contra o provedor real em agenda diária, fora do caminho de deploy, para que a falha seja um sinal sobre o mundo externo e não um bloqueio do seu pipeline.',
            'Valide a forma e o envelope estatístico, nunca o texto exato: o teste afirma que confidence é número entre zero e um em cem por cento das respostas, não que o intent de uma entrada específica seja uma string literal.',
            'Fixe a versão do modelo com o identificador completo, incluindo data, e trate o alias flutuante como ambiente separado que você monitora mas não usa em produção.',
            'Quando o teste falhar, o artefato é um diff entre a linha de base e a saída atual por campo, porque a pergunta operacional é o que mudou, não se algo mudou.',
          ],
        },
        {
          type: 'code',
          value: `// tests/contract/intake.contract.test.js
// Roda contra o provedor real, em agenda, fora do deploy.
// Afirma o envelope, nunca o texto exato da resposta.

import { describe, it, expect } from 'vitest';
import { callModel } from '../../src/providers/client.js';
import { toIntake } from '../../src/adapters/intake.js';
import { CASES } from './cases.js';

const MODEL = 'claude-sonnet-4-5-20250929'; // versao fixa, nunca alias flutuante
const noopMetrics = { increment: () => {} };

describe('contrato de saida estruturada do intake', () => {
  it('mantem a forma acordada em todas as entradas representativas', async () => {
    const results = await Promise.all(
      CASES.map(async (testCase) => {
        const raw = await callModel({ model: MODEL, input: testCase.input });
        return { testCase, intake: toIntake(raw, { metrics: noopMetrics }) };
      }),
    );

    for (const { testCase, intake } of results) {
      // Forma: sempre verdadeiro, independente do conteudo.
      expect(typeof intake.intent).toBe('string');
      expect(intake.confidence).toBeGreaterThanOrEqual(0);
      expect(intake.confidence).toBeLessThanOrEqual(1);
      expect(intake.entities === null || Array.isArray(intake.entities)).toBe(true);

      // Envelope: o enum pode ganhar valor, mas nao pode virar
      // desconhecido no caso que existe exatamente para exercita-lo.
      if (testCase.expectsKnownPriority) {
        expect(intake.priority).not.toBe('unknown');
      }
    }

    // Estatistico: um caso isolado caindo em revisao e aceitavel,
    // um terco da suite caindo significa que a forma mudou.
    const reviewRate = results.filter((r) => r.intake.needsReview).length / results.length;
    expect(reviewRate).toBeLessThan(0.15);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'A última asserção é a que mais paga o custo da suíte. Ela não olha nenhum caso individual e sim a taxa agregada de casos que caíram em revisão. É exatamente a forma de deriva que passa por qualquer validação item a item: nada quebrou, tudo continua válido, e mesmo assim o sistema começou a não entender uma fatia maior do tráfego.',
        },
      ],
    },
    {
      title: 'O que fazer no dia em que o esquema mudar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A resposta muda conforme o tipo de mudança, e vale ter isso decidido antes, no runbook, e não às três da manhã. Para valor novo de enum, o bucket de desconhecido já segurou o tráfego: a ação é revisar o valor, decidir se ele mapeia para uma categoria existente ou merece uma nova, e atualizar o adaptador. Nenhum rollback é necessário porque nada quebrou.',
        },
        {
          type: 'paragraph',
          value:
            'Para tipo alterado ou campo que sumiu, a ação imediata é fixar a versão anterior do modelo se você tinha o identificador completo, o que é o motivo prático de nunca chamar produção por alias flutuante. Com a versão fixada o sistema volta ao comportamento conhecido em minutos, e a adaptação ao formato novo passa a ser trabalho planejado em vez de emergência.',
        },
        {
          type: 'list',
          items: [
            'Um alias flutuante na configuração é confortável no dia do lançamento e caro no dia da mudança: sem versão explícita, não existe rollback, só adaptação sob pressão.',
            'Adapte o novo formato num caminho paralelo primeiro, comparando as duas saídas em sombra sobre tráfego real antes de trocar, porque o adaptador novo também tem bug.',
            'Registre a mudança de esquema como incidente mesmo quando não houve indisponibilidade, senão o histórico some e a mesma classe de falha volta no próximo trimestre.',
            'Reveja a linha de base depois de estabilizar, com data e versão de modelo anotadas, senão o próximo comparativo mede contra um mundo que não existe mais.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O fio que amarra tudo é o mesmo de qualquer integração com terceiro cujo comportamento você não controla: assuma que a forma vai mudar, isole quem conhece a forma em um lugar só, meça o desvio antes que ele vire dano e mantenha um caminho de volta. A diferença aqui é que o terceiro não publica changelog de esquema e a mudança não vem com aviso, o que só aumenta o peso da métrica e do teste de contrato.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se eu uso structured output com JSON Schema, o provedor não garante o formato?',
      answer:
        'Garante a validade sintática e a forma declarada, e isso já elimina JSON quebrado e chave inventada. O que não é garantido é a camada semântica acima disso: qual valor de enum foi escolhido, se um campo opcional foi preenchido, quantos itens entraram num array, ou se um número veio como 5 ou "5" quando o schema aceita união de tipos. Quando o provedor troca a versão do modelo por trás de um alias ou ajusta o decoder, essa distribuição se desloca sem violar o schema. Seu código continua fazendo parse com sucesso e passa a decidir diferente, o que é pior que quebrar, porque não gera exceção nenhuma.',
    },
    {
      question: 'Por que não lançar exceção quando o modelo devolve um valor de enum desconhecido?',
      answer:
        'Porque isso converte uma degradação parcial em indisponibilidade. Se o valor novo aparece em dois por cento das requisições, a exceção derruba dois por cento do tráfego, e a alternativa custa quase nada: mapear para um bucket explícito de desconhecido, incrementar uma métrica e rotear aquele caso para revisão humana. O serviço continua de pé, o sinal chega ao time e a decisão sobre a categoria nova acontece em horário comercial. A regra é rejeitar de forma estrita o que muda a forma, como uma chave inesperada, e tolerar de forma contada o que só amplia um domínio de valores.',
    },
    {
      question: 'Testar contra o provedor real não deixa a suíte lenta, cara e instável?',
      answer:
        'Deixa, e por isso ela não pertence ao pipeline de deploy. É uma suíte separada, com vinte a quarenta entradas, rodando em agenda diária, cuja falha é um sinal sobre o mundo externo e não um bloqueio do seu merge. O custo é baixo porque o volume é pequeno, e a instabilidade some quando as asserções afirmam o envelope em vez do texto: confidence é número entre zero e um em cem por cento das respostas, e a taxa agregada de casos que caem em revisão fica abaixo de um limiar. Testes com fixture congelada continuam valendo para o adaptador, mas por definição nunca avisam que o provedor mudou.',
    },
  ],
  conclusion: {
    title: 'Saída estruturada é integração com terceiro, e terceiro muda sem avisar',
    description:
      'Um adaptador único que conhece o formato do modelo, coerção explícita e instrumentada, bucket de desconhecido em vez de exceção, métrica por campo contra linha de base congelada e uma suíte de contrato rodando contra o provedor real: é isso que transforma uma mudança de esquema em trabalho planejado em vez de incidente noturno. Posso desenhar essa fronteira no seu sistema, do adaptador ao alerta, integrada ao stack que você já roda.',
    cta: 'Falar sobre contrato de saída no meu sistema de IA',
  },
  related: [
    { label: 'Guardrails de saída de LLM: validação e recusa segura', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Testes de regressão de ferramentas do agente: contrato antes do prompt', to: '/blog/testes-regressao-ferramentas-agente-contrato-antes-do-prompt' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The parser broke at three in the morning and nobody had deployed anything. The prompt is the same one from six months ago, the schema you declare in the call is the same, and yet the field that always came as a number started coming as a string, or an enum gained a value you never wrote, or an optional object that never showed up started showing up every time. This is nobody\'s bug: it is the consequence of treating model output as if it were a versioned API response when it is actually a probability distribution the provider can reshape without telling you. This article treats structured output as a real integration contract: why a declared schema is not an execution guarantee, how to separate your internal contract from the format the model returns using an adaptation layer, why a new required field is always an incident and an optional one with a default never is, how to detect schema drift with metrics instead of with a parser exception, and which contract test runs against the real provider before the user finds out.',
  sections: [
    {
      title: 'A declared schema is not a guaranteed schema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every serious provider today accepts a schema in the call, whether as JSON Schema in structured output or as a tool definition. The wrong reading of that is assuming the schema becomes an execution guarantee equivalent to a type in a statically typed language. It does not. What the schema does is constrain sampling hard: tokens that would violate the grammar get zero or near-zero probability. That solves syntactically broken JSON and invented keys, and it is an enormous improvement. It does not solve what sits in the semantic layer above the grammar: which enum value was chosen, whether an optional field was filled in, how many items went into an array, whether the number came as 5 or as "5" when the schema accepts a union.',
        },
        {
          type: 'paragraph',
          value:
            'From that comes the distinction that organizes the rest of the article. One thing is syntactic validity, and the provider holds that up well. Another is semantic stability, which nobody ever promised. When a provider swaps the model version behind the same alias, when it tunes the structured-output decoder, when it changes how the schema is internally converted into a grammar, the distribution of values inside the valid format shifts. Your code keeps parsing successfully and starts making different decisions.',
        },
        {
          type: 'table',
          columns: ['Layer', 'Who guarantees it', 'Typical failure', 'How you find out'],
          rows: [
            [
              'JSON syntax',
              'Provider decoder',
              'JSON truncated by a token limit',
              'Parse exception, immediately',
            ],
            [
              'Schema shape',
              'Provider, with good coverage',
              'Extra key, unexpected type in a union',
              'Strict validation, if you have one',
            ],
            [
              'Value semantics',
              'Nobody',
              'New enum value, optional that became frequent, empty array',
              'Distribution metric or customer complaint',
            ],
            [
              'Field meaning',
              'Nobody',
              'Same name, different sense after a model swap',
              'Manual audit, almost always late',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The row that hurts is the third one. It raises no exception, shows up in no error log, and therefore walks straight past the alert you configured. The system stays green while it decides wrong.',
        },
      ],
    },
    {
      title: 'Your internal contract cannot be the model format',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most expensive structural mistake is letting the object the model returns circulate through the whole system. When the raw provider response becomes the argument that crosses services, enters queues and gets persisted, any change in model output propagates to dozens of points at once. The fix requires touching everything, and rollback becomes impossible because data is already stored in both the old and the new format.',
        },
        {
          type: 'paragraph',
          value:
            'The right separation is the same as in any third-party integration: the provider format is external, the domain contract is yours, and there is a thin layer between them whose only responsibility is translation. That layer is the only place in the code that knows the model format. If the enum gains a new value, the fix happens in one file instead of fifteen.',
        },
        {
          type: 'diagram',
          value: `model                   adapter                    domain
  |                         |                          |
  |-- valid JSON ---------->|                          |
  |   (provider shape)      |                          |
  |                         |-- strict validate ------>| reject if
  |                         |   (extra key = error)    | shape changed
  |                         |                          |
  |                         |-- normalize ------------>| "5" -> 5
  |                         |   (explicit coercion)    | "URGENT" -> urgent
  |                         |                          |
  |                         |-- map unknown ---------->| new enum ->
  |                         |   (never discard)        | "unknown" bucket
  |                         |                          |
  |                         |-- emit metric ---------->| per-field rate
  |                         |                          |
  |                         |==== Intake (domain type) ========>
  |                         |     only this crosses the system`,
        },
        {
          type: 'paragraph',
          value:
            'Note the detail about the unknown value. The temptation is to throw when the enum brings something outside the list, because that looks like the strict and correct behavior. In practice it turns partial degradation into an outage: a new value in two percent of requests takes down two percent of traffic. Mapping it to an explicit unknown bucket, counting it and routing to the human-review path keeps the service up and still gives you the signal.',
        },
        {
          type: 'code',
          value: `// adapters/intake.js
// The only boundary that knows the model format. Validates strictly,
// normalizes with explicit coercion and never lets a new value throw.

const PRIORITIES = new Set(['low', 'normal', 'high']);
const ALLOWED_KEYS = new Set(['intent', 'priority', 'entities', 'confidence']);

export function toIntake(raw, { metrics }) {
  // 1. A key the schema did not foresee is a drift signal, not extra data.
  const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    metrics.increment('intake.unknown_key', { keys: unknownKeys.join(',') });
  }

  // 2. Explicit coercion: accepts "5" and 5, but records when the type
  //    changes, because an unstable type is the first symptom of a swap.
  const confidence = coerceNumber(raw.confidence, { metrics, field: 'confidence' });

  // 3. Unknown enum becomes a bucket, never an exception. A new value in
  //    2% of requests cannot take down 2% of traffic.
  let priority = normalizePriority(raw.priority);
  if (!PRIORITIES.has(priority)) {
    metrics.increment('intake.unknown_enum', { field: 'priority', value: String(raw.priority) });
    priority = 'unknown';
  }

  return {
    intent: String(raw.intent ?? '').trim() || 'unclassified',
    priority,
    // A missing array and an empty array are different things for the
    // domain: missing means "the model did not answer this", empty means
    // "the model answered that there is nothing". Do not collapse them.
    entities: Array.isArray(raw.entities) ? raw.entities.map(String) : null,
    confidence: confidence ?? 0,
    needsReview: priority === 'unknown' || confidence === null,
  };
}

function coerceNumber(value, { metrics, field }) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      metrics.increment('intake.type_coercion', { field, from: 'string' });
      return parsed;
    }
  }
  return null;
}

function normalizePriority(value) {
  return String(value ?? '').trim().toLowerCase();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Every tolerance point in that adapter emits a metric. That is the difference between tolerating and ignoring: tolerating means accepting the deviation and recording it; ignoring means accepting it in silence. An adapter that absorbs everything without counting anything hides the drift until the day it is too large.',
        },
      ],
    },
    {
      title: 'The asymmetry that decides how big the incident gets',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Schema changes are not all alike, and it is worth internalizing the asymmetry before writing the first schema. Adding an optional field with a default is safe: the old consumer ignores it, the new one uses it. Making a field required is a guaranteed break: every producer that does not send it yet starts failing. Removing a field breaks readers. Changing a field type breaks parsing. Adding a value to an enum breaks anyone doing an exhaustive switch with no default clause.',
        },
        {
          type: 'table',
          columns: ['Schema change', 'Effect on the consumer', 'Classification', 'Mitigation'],
          rows: [
            [
              'New optional field with a default',
              'Ignored by anyone who does not know it',
              'Compatible',
              'None, this is the safe path',
            ],
            [
              'New required field',
              'Fails on every old producer',
              'Breaking',
              'Ship as optional, migrate, then require',
            ],
            [
              'Removed field',
              'Reader gets undefined where it expected a value',
              'Breaking',
              'Keep it for a window, mark it deprecated',
            ],
            [
              'Changed type (number to string)',
              'Silently wrong parsing',
              'Silent break',
              'New field with a new name, never reuse the old one',
            ],
            [
              'New enum value',
              'Exhaustive switch falls through',
              'Partial break',
              'Unknown bucket plus an alert',
            ],
            [
              'Narrowed enum',
              'Producer sends a now-invalid value',
              'Breaking',
              'Accept it on read for a window',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The operational rule that follows is simple and applies to both directions: when you change the schema you send to the model, always add it as optional first and only require it once the metric shows consistent fill rates. And when it is the model that changes on its own, the only defense is an adapter that never does an exhaustive switch without an escape path.',
        },
        {
          type: 'paragraph',
          value:
            'One case deserves special mention because it is the most treacherous: the type change. When a field that was a number starts coming as a string, most languages do not complain. JavaScript compares it, adds it as concatenation and moves on. The result is a wrong decision that never produces a stack trace. That is why coercion has to be explicit and instrumented rather than implicit and silent.',
        },
      ],
    },
    {
      title: 'Detect drift with metrics, not with exceptions',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If your only schema-change detector is the parser exception, you only see the loudest and rarest failure category. The drift that matters is the one that keeps everything valid and shifts the distribution. The right instrument is not try/catch, it is a per-field metric compared against a baseline.',
        },
        {
          type: 'paragraph',
          value:
            'In practice, four series per field cover almost everything. Presence rate, which is the fraction of responses where the field showed up filled in. Type distribution, which is the share per observed primitive type. Enum cardinality, which is the distinct set of values seen in the window. And, for arrays, the size percentile. Drift shows up in those series days before it shows up in a complaint.',
        },
        {
          type: 'code',
          value: `// monitor/schema-drift.js
// Compares the recent window against a frozen baseline. The point is not
// to detect an isolated new value, it is to detect a sustained shift,
// which is what indicates a model swap underneath.

const PRESENCE_TOLERANCE = 0.10; // 10 percentage points
const MIN_SAMPLES = 200;         // below this, noise dominates

export function compareToBaseline(window, baseline) {
  const alerts = [];

  for (const [field, current] of Object.entries(window.fields)) {
    const base = baseline.fields[field];
    if (!base || current.samples < MIN_SAMPLES) continue;

    // 1. A field that started always coming (or stopped coming) changed
    //    role, even while staying "optional" in the schema.
    const presenceDelta = current.presenceRate - base.presenceRate;
    if (Math.abs(presenceDelta) > PRESENCE_TOLERANCE) {
      alerts.push({
        field,
        kind: 'presence_shift',
        from: base.presenceRate,
        to: current.presenceRate,
        severity: presenceDelta > 0 ? 'warn' : 'page',
      });
    }

    // 2. A new type on a stable field is almost always a model swap.
    for (const type of Object.keys(current.typeShare)) {
      if (!(type in base.typeShare)) {
        alerts.push({ field, kind: 'new_type', type, severity: 'page' });
      }
    }

    // 3. The enum gained a value: not an error, but it needs a human
    //    decision before the "unknown" bucket grows unwatched.
    const newValues = current.enumValues.filter((v) => !base.enumValues.includes(v));
    if (newValues.length > 0) {
      alerts.push({ field, kind: 'new_enum_value', values: newValues, severity: 'warn' });
    }
  }

  return alerts;
}`,
        },
        {
          type: 'paragraph',
          value:
            'The severity choice is not decorative. A new type on a stable field is a page, because it almost always means the model behind the alias changed and the effect on business decisions is immediate. A new enum value is a warning, because the unknown bucket is already holding traffic and the decision can wait for business hours. A drop in presence rate is a page when it is a drop, because it means the system stopped receiving information it was already using.',
        },
        {
          type: 'list',
          items: [
            'Freeze the baseline at an explicit, dated version rather than a seven-day moving average, otherwise slow drift becomes the new normal without ever firing.',
            'Require a minimum sample count per window before comparing, because at low volume natural variation produces false alerts and the team learns to ignore them.',
            'Monitor per model and prompt version, not just per endpoint, otherwise a prompt rollout on ten percent of traffic stays invisible inside the aggregate.',
            'Alert on the unknown bucket growing, not only on the new value appearing: an enum nobody reviewed turns into a clogged human-review path.',
          ],
        },
      ],
    },
    {
      title: 'Contract testing against the real provider',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A unit test with a fixed fixture response proves your adapter works, which is necessary and insufficient: it will never tell you the provider changed, because the fixture is yours and it is frozen. What closes the gap is a contract suite that runs against the real provider, on a fixed schedule, with a small set of representative inputs, and fails when the output shape leaves the agreed envelope.',
        },
        {
          type: 'ordered',
          items: [
            'Pick twenty to forty inputs covering the paths that matter, including the edge cases that produce optional fields, empty arrays and rare enum values.',
            'Run it against the real provider on a daily schedule, outside the deploy path, so a failure is a signal about the external world rather than a block on your pipeline.',
            'Assert the shape and the statistical envelope, never the exact text: the test claims that confidence is a number between zero and one in one hundred percent of responses, not that the intent of a specific input is a literal string.',
            'Pin the model version with the full identifier, date included, and treat the floating alias as a separate environment you monitor but do not run in production.',
            'When the test fails, the artifact is a per-field diff between the baseline and the current output, because the operational question is what changed, not whether something changed.',
          ],
        },
        {
          type: 'code',
          value: `// tests/contract/intake.contract.test.js
// Runs against the real provider, on a schedule, outside the deploy.
// Asserts the envelope, never the exact response text.

import { describe, it, expect } from 'vitest';
import { callModel } from '../../src/providers/client.js';
import { toIntake } from '../../src/adapters/intake.js';
import { CASES } from './cases.js';

const MODEL = 'claude-sonnet-4-5-20250929'; // pinned version, never a floating alias
const noopMetrics = { increment: () => {} };

describe('intake structured output contract', () => {
  it('keeps the agreed shape across all representative inputs', async () => {
    const results = await Promise.all(
      CASES.map(async (testCase) => {
        const raw = await callModel({ model: MODEL, input: testCase.input });
        return { testCase, intake: toIntake(raw, { metrics: noopMetrics }) };
      }),
    );

    for (const { testCase, intake } of results) {
      // Shape: always true, regardless of content.
      expect(typeof intake.intent).toBe('string');
      expect(intake.confidence).toBeGreaterThanOrEqual(0);
      expect(intake.confidence).toBeLessThanOrEqual(1);
      expect(intake.entities === null || Array.isArray(intake.entities)).toBe(true);

      // Envelope: the enum may gain values, but it must not become
      // unknown on the case that exists precisely to exercise it.
      if (testCase.expectsKnownPriority) {
        expect(intake.priority).not.toBe('unknown');
      }
    }

    // Statistical: one isolated case falling into review is acceptable,
    // a third of the suite falling means the shape changed.
    const reviewRate = results.filter((r) => r.intake.needsReview).length / results.length;
    expect(reviewRate).toBeLessThan(0.15);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'That last assertion is the one that pays for the suite. It looks at no individual case and instead at the aggregate rate of cases that fell into review. It is exactly the kind of drift that slips past any item-by-item validation: nothing broke, everything is still valid, and yet the system started failing to understand a larger slice of traffic.',
        },
      ],
    },
    {
      title: 'What to do on the day the schema changes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The answer depends on the kind of change, and it is worth deciding that ahead of time, in the runbook, rather than at three in the morning. For a new enum value, the unknown bucket already held the traffic: the action is to review the value, decide whether it maps to an existing category or deserves a new one, and update the adapter. No rollback is needed because nothing broke.',
        },
        {
          type: 'paragraph',
          value:
            'For a changed type or a field that disappeared, the immediate action is pinning the previous model version if you had the full identifier, which is the practical reason never to call production through a floating alias. With the version pinned the system returns to known behavior in minutes, and adapting to the new format becomes planned work instead of an emergency.',
        },
        {
          type: 'list',
          items: [
            'A floating alias in the config is comfortable on launch day and expensive on change day: without an explicit version there is no rollback, only adaptation under pressure.',
            'Adapt the new format on a parallel path first, comparing both outputs in shadow over real traffic before switching, because the new adapter has bugs too.',
            'Record the schema change as an incident even when there was no outage, otherwise the history vanishes and the same failure class returns next quarter.',
            'Revisit the baseline after stabilizing, with the date and model version recorded, otherwise the next comparison measures against a world that no longer exists.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The thread tying it all together is the same as in any third-party integration whose behavior you do not control: assume the shape will change, isolate whoever knows the shape into a single place, measure the deviation before it becomes damage and keep a path back. The difference here is that the third party publishes no schema changelog and the change arrives without notice, which only raises the weight of the metric and the contract test.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If I use structured output with JSON Schema, does the provider not guarantee the format?',
      answer:
        'It guarantees syntactic validity and the declared shape, and that already eliminates broken JSON and invented keys. What is not guaranteed is the semantic layer above that: which enum value was chosen, whether an optional field was filled in, how many items went into an array, or whether a number came as 5 or "5" when the schema accepts a union of types. When the provider swaps the model version behind an alias or tunes the decoder, that distribution shifts without violating the schema. Your code keeps parsing successfully and starts deciding differently, which is worse than breaking, because it raises no exception at all.',
    },
    {
      question: 'Why not throw when the model returns an unknown enum value?',
      answer:
        'Because that converts partial degradation into an outage. If the new value appears in two percent of requests, the exception takes down two percent of traffic, and the alternative costs almost nothing: map it to an explicit unknown bucket, increment a metric and route that case to human review. The service stays up, the signal reaches the team and the decision about the new category happens during business hours. The rule is to reject strictly whatever changes the shape, like an unexpected key, and to tolerate in a counted way whatever merely widens a value domain.',
    },
    {
      question: 'Does testing against the real provider not make the suite slow, expensive and flaky?',
      answer:
        'It does, and that is why it does not belong in the deploy pipeline. It is a separate suite, with twenty to forty inputs, running on a daily schedule, whose failure is a signal about the external world rather than a block on your merge. The cost is low because the volume is small, and the flakiness disappears once the assertions claim the envelope instead of the text: confidence is a number between zero and one in one hundred percent of responses, and the aggregate rate of cases falling into review stays below a threshold. Frozen-fixture tests still matter for the adapter, but by definition they never warn you that the provider changed.',
    },
  ],
  conclusion: {
    title: 'Structured output is a third-party integration, and third parties change without notice',
    description:
      'A single adapter that knows the model format, explicit and instrumented coercion, an unknown bucket instead of an exception, per-field metrics against a frozen baseline and a contract suite running against the real provider: that is what turns a schema change into planned work instead of a nighttime incident. I can design that boundary in your system, from adapter to alert, integrated into the stack you already run.',
    cta: 'Talk about the output contract in my AI system',
  },
  related: [
    { label: 'LLM output guardrails: validation and safe refusal', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Agent tool regression tests: contract before prompt', to: '/blog/testes-regressao-ferramentas-agente-contrato-antes-do-prompt' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'El parser se rompió a las tres de la mañana y nadie había hecho deploy. El prompt es el mismo de hace seis meses, el schema que declaras en la llamada es el mismo, y aun así el campo que siempre venía como número pasó a venir como string, o un enum ganó un valor que nunca escribiste, o un objeto opcional que nunca aparecía empezó a aparecer siempre. Esto no es bug de nadie: es la consecuencia de tratar la salida del modelo como si fuera respuesta de API versionada cuando en realidad es una distribución de probabilidad que el proveedor puede reformar sin avisarte. Este artículo trata la salida estructurada como un contrato de integración de verdad: por qué un schema declarado no es garantía de ejecución, cómo separar el contrato interno del formato que devuelve el modelo con una capa de adaptación, por qué un campo obligatorio nuevo siempre es incidente y uno opcional con default nunca lo es, cómo detectar deriva de esquema con métrica en vez de con excepción del parser, y qué prueba de contrato corre contra el proveedor real antes de que el usuario se entere.',
  sections: [
    {
      title: 'Schema declarado no es schema garantizado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo proveedor serio hoy acepta un schema en la llamada, ya sea como JSON Schema en structured output o como definición de tool. La lectura equivocada de eso es creer que el schema se vuelve una garantía de ejecución equivalente a un tipo de lenguaje estático. No lo es. Lo que el schema hace es restringir fuertemente el muestreo: los tokens que violarían la gramática reciben probabilidad cero o casi cero. Eso resuelve el JSON sintácticamente roto y la clave inventada, y es una mejora enorme. No resuelve lo que está en la capa semántica por encima de la gramática: qué valor de enum se eligió, si un campo opcional se completó, cuántos ítems entraron en un array, si el número vino como 5 o como "5" cuando el schema acepta una unión.',
        },
        {
          type: 'paragraph',
          value:
            'De ahí sale la distinción que organiza el resto del artículo. Una cosa es la validez sintáctica, y esa el proveedor la sostiene bien. Otra es la estabilidad semántica, que nadie prometió. Cuando un proveedor cambia la versión del modelo detrás del mismo alias, cuando ajusta el decoder de structured output, cuando modifica cómo el schema se convierte internamente en gramática, la distribución de los valores dentro del formato válido se desplaza. Tu código sigue parseando con éxito y empieza a tomar decisiones distintas.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Quién la garantiza', 'Falla típica', 'Cómo te enteras'],
          rows: [
            [
              'Sintaxis JSON',
              'Decoder del proveedor',
              'JSON truncado por límite de token',
              'Excepción en el parse, al instante',
            ],
            [
              'Forma del schema',
              'Proveedor, con buena cobertura',
              'Clave de más, tipo inesperado en una unión',
              'Validación estricta, si la tienes',
            ],
            [
              'Semántica de los valores',
              'Nadie',
              'Enum nuevo, opcional que se volvió frecuente, array vacío',
              'Métrica de distribución o reclamo del cliente',
            ],
            [
              'Significado del campo',
              'Nadie',
              'Mismo nombre, sentido distinto tras cambiar el modelo',
              'Auditoría manual, casi siempre tarde',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila que duele es la tercera. No genera excepción, no aparece en log de error, y por eso pasa de largo frente a la alerta que configuraste. El sistema sigue en verde mientras decide mal.',
        },
      ],
    },
    {
      title: 'El contrato interno no puede ser el formato del modelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error estructural más caro es dejar que el objeto que devuelve el modelo circule por todo el sistema. Cuando el retorno crudo del proveedor se vuelve el argumento que atraviesa servicios, entra en colas y se persiste, cualquier cambio en la salida del modelo se propaga a decenas de puntos a la vez. El arreglo exige tocar todo, y el rollback se vuelve imposible porque ya hay datos guardados en el formato viejo y en el nuevo.',
        },
        {
          type: 'paragraph',
          value:
            'La separación correcta es la misma de cualquier integración con un tercero: el formato del proveedor es externo, el contrato del dominio es tuyo, y hay una capa fina entre ambos cuya única responsabilidad es traducir. Esa capa es el único lugar del código que conoce el formato del modelo. Si el enum gana un valor nuevo, el arreglo ocurre en un archivo y no en quince.',
        },
        {
          type: 'diagram',
          value: `modelo                  adaptador                  dominio
  |                         |                          |
  |-- JSON valido --------->|                          |
  |   (forma del proveedor) |                          |
  |                         |-- valida estricto ------>| rechaza si
  |                         |   (clave extra = error)  | cambio la forma
  |                         |                          |
  |                         |-- normaliza ------------>| "5" -> 5
  |                         |   (coercion explicita)   | "URGENTE" -> urgent
  |                         |                          |
  |                         |-- mapea desconocido ---->| enum nuevo ->
  |                         |   (nunca descarta)       | bucket "unknown"
  |                         |                          |
  |                         |-- emite metrica -------->| tasa por campo
  |                         |                          |
  |                         |==== Intake (tipo del dominio) ====>
  |                         |     solo esto atraviesa el sistema`,
        },
        {
          type: 'paragraph',
          value:
            'Fíjate en el detalle del valor desconocido. La tentación es lanzar excepción cuando el enum trae algo fuera de la lista, porque parece el comportamiento estricto y correcto. En la práctica eso transforma una degradación parcial en indisponibilidad: un valor nuevo en dos por ciento de las peticiones tumba dos por ciento del tráfico. Mapearlo a un bucket explícito de desconocido, contarlo y enviarlo al camino de revisión humana preserva el servicio y además te da la señal.',
        },
        {
          type: 'code',
          value: `// adapters/intake.js
// Unica frontera que conoce el formato del modelo. Valida estricto,
// normaliza con coercion explicita y nunca deja que un valor nuevo lance.

const PRIORITIES = new Set(['low', 'normal', 'high']);
const ALLOWED_KEYS = new Set(['intent', 'priority', 'entities', 'confidence']);

export function toIntake(raw, { metrics }) {
  // 1. Una clave que el schema no preveia es senal de deriva, no dato extra.
  const unknownKeys = Object.keys(raw).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) {
    metrics.increment('intake.unknown_key', { keys: unknownKeys.join(',') });
  }

  // 2. Coercion explicita: acepta "5" y 5, pero registra cuando el tipo
  //    cambia, porque un tipo inestable es el primer sintoma de un cambio.
  const confidence = coerceNumber(raw.confidence, { metrics, field: 'confidence' });

  // 3. Enum desconocido se vuelve bucket, nunca excepcion. Un valor nuevo
  //    en 2% de las peticiones no puede tumbar 2% del trafico.
  let priority = normalizePriority(raw.priority);
  if (!PRIORITIES.has(priority)) {
    metrics.increment('intake.unknown_enum', { field: 'priority', value: String(raw.priority) });
    priority = 'unknown';
  }

  return {
    intent: String(raw.intent ?? '').trim() || 'unclassified',
    priority,
    // Un array ausente y uno vacio son cosas distintas para el dominio:
    // ausente significa "el modelo no respondio esto", vacio significa
    // "el modelo respondio que no hay nada". No los colapses.
    entities: Array.isArray(raw.entities) ? raw.entities.map(String) : null,
    confidence: confidence ?? 0,
    needsReview: priority === 'unknown' || confidence === null,
  };
}

function coerceNumber(value, { metrics, field }) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      metrics.increment('intake.type_coercion', { field, from: 'string' });
      return parsed;
    }
  }
  return null;
}

function normalizePriority(value) {
  return String(value ?? '').trim().toLowerCase();
}`,
        },
        {
          type: 'paragraph',
          value:
            'Cada punto de tolerancia de ese adaptador emite métrica. Esa es la diferencia entre tolerar e ignorar: tolerar es aceptar el desvío y registrarlo; ignorar es aceptarlo en silencio. Un adaptador que absorbe todo sin contar nada esconde la deriva hasta el día en que ya es demasiado grande.',
        },
      ],
    },
    {
      title: 'La asimetría que decide el tamaño del incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los cambios de esquema no son todos iguales, y conviene internalizar la asimetría antes de escribir el primer schema. Agregar un campo opcional con default es seguro: el consumidor viejo lo ignora, el nuevo lo aprovecha. Volver obligatorio un campo es ruptura garantizada: todo productor que aún no lo manda empieza a fallar. Quitar un campo rompe a quien lee. Cambiar el tipo de un campo rompe a quien parsea. Agregar un valor a un enum rompe a quien hace switch exhaustivo sin cláusula default.',
        },
        {
          type: 'table',
          columns: ['Cambio en el esquema', 'Efecto en el consumidor', 'Clasificación', 'Mitigación'],
          rows: [
            [
              'Campo opcional nuevo con default',
              'Ignorado por quien no lo conoce',
              'Compatible',
              'Ninguna, es el camino seguro',
            ],
            [
              'Campo obligatorio nuevo',
              'Falla en todo productor viejo',
              'Ruptura',
              'Lanzar como opcional, migrar, después exigir',
            ],
            [
              'Campo eliminado',
              'El lector recibe undefined donde esperaba un valor',
              'Ruptura',
              'Mantenerlo una ventana, marcarlo obsoleto',
            ],
            [
              'Tipo alterado (número a string)',
              'Parse silenciosamente equivocado',
              'Ruptura silenciosa',
              'Campo nuevo con nombre nuevo, nunca reusar el viejo',
            ],
            [
              'Valor nuevo en enum',
              'El switch exhaustivo cae al vacío',
              'Ruptura parcial',
              'Bucket de desconocido más alerta',
            ],
            [
              'Enum restringido',
              'El productor manda un valor ahora inválido',
              'Ruptura',
              'Aceptarlo en la lectura por una ventana',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La regla operativa que sale de ahí es simple y vale para los dos lados: cuando cambias el schema que envías al modelo, agrégalo siempre como opcional primero y solo exígelo después de que la métrica muestre completado consistente. Y cuando es el modelo el que cambia solo, la única defensa es que el adaptador nunca haga switch exhaustivo sin camino de escape.',
        },
        {
          type: 'paragraph',
          value:
            'Un caso merece destaque porque es el más traicionero: el cambio de tipo. Cuando un campo que era número pasa a venir como string, buena parte de los lenguajes no reclama. JavaScript lo compara, lo suma como concatenación y sigue. El resultado es una decisión equivocada que nunca genera stack trace. Por eso la coerción tiene que ser explícita e instrumentada, y no implícita y silenciosa.',
        },
      ],
    },
    {
      title: 'Detectar deriva con métrica, no con excepción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si el único detector de cambio de esquema es la excepción del parser, solo ves la categoría de falla más ruidosa y más rara. La deriva que importa es la que mantiene todo válido y desplaza la distribución. El instrumento correcto no es try/catch, es una métrica por campo comparada contra una línea de base.',
        },
        {
          type: 'paragraph',
          value:
            'En la práctica, cuatro series por campo cubren casi todo. Tasa de presencia, que es la fracción de respuestas en que el campo apareció completado. Distribución de tipo, que es la fracción por tipo primitivo observado. Cardinalidad del enum, que es el conjunto distinto de valores visto en la ventana. Y, para arrays, el percentil del tamaño. La deriva aparece en esas series días antes de aparecer en un reclamo.',
        },
        {
          type: 'code',
          value: `// monitor/schema-drift.js
// Compara la ventana reciente contra una linea de base congelada.
// La idea no es detectar un valor nuevo aislado, es detectar un
// desplazamiento sostenido, que es lo que indica cambio de modelo debajo.

const PRESENCE_TOLERANCE = 0.10; // 10 puntos porcentuales
const MIN_SAMPLES = 200;         // por debajo de eso, domina el ruido

export function compareToBaseline(window, baseline) {
  const alerts = [];

  for (const [field, current] of Object.entries(window.fields)) {
    const base = baseline.fields[field];
    if (!base || current.samples < MIN_SAMPLES) continue;

    // 1. Un campo que paso a venir siempre (o dejo de venir) cambio de
    //    papel, aunque siga siendo "opcional" en el schema.
    const presenceDelta = current.presenceRate - base.presenceRate;
    if (Math.abs(presenceDelta) > PRESENCE_TOLERANCE) {
      alerts.push({
        field,
        kind: 'presence_shift',
        from: base.presenceRate,
        to: current.presenceRate,
        severity: presenceDelta > 0 ? 'warn' : 'page',
      });
    }

    // 2. Un tipo nuevo en un campo estable es casi siempre cambio de modelo.
    for (const type of Object.keys(current.typeShare)) {
      if (!(type in base.typeShare)) {
        alerts.push({ field, kind: 'new_type', type, severity: 'page' });
      }
    }

    // 3. El enum gano un valor: no es error, pero exige decision humana
    //    antes de que el bucket "unknown" crezca sin que nadie mire.
    const newValues = current.enumValues.filter((v) => !base.enumValues.includes(v));
    if (newValues.length > 0) {
      alerts.push({ field, kind: 'new_enum_value', values: newValues, severity: 'warn' });
    }
  }

  return alerts;
}`,
        },
        {
          type: 'paragraph',
          value:
            'La elección de severidad no es decorativa. Un tipo nuevo en un campo estable es página, porque casi siempre significa que el modelo detrás del alias cambió y el efecto es inmediato en la decisión de negocio. Un valor nuevo de enum es aviso, porque el bucket de desconocido ya está sosteniendo el tráfico y la decisión puede esperar al horario laboral. Una caída en la tasa de presencia es página cuando es caída, porque significa que el sistema dejó de recibir información que ya usaba.',
        },
        {
          type: 'list',
          items: [
            'Congela la línea de base en una versión explícita y fechada, no en un promedio móvil de los últimos siete días, si no la deriva lenta se vuelve la nueva normalidad sin disparar nunca.',
            'Exige un mínimo de muestras por ventana antes de comparar, porque con volumen bajo la variación natural genera alerta falsa y el equipo aprende a ignorarla.',
            'Monitorea por combinación de modelo y versión de prompt, no solo por endpoint, si no un rollout de prompt en diez por ciento del tráfico queda invisible dentro del agregado.',
            'Alerta sobre el bucket de desconocido creciendo, y no solo sobre el valor nuevo apareciendo: un enum que nadie revisó se vuelve un camino de revisión humana tapado.',
          ],
        },
      ],
    },
    {
      title: 'Prueba de contrato contra el proveedor real',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba unitaria con respuesta fija en fixture demuestra que tu adaptador funciona, lo cual es necesario e insuficiente: nunca te va a avisar que el proveedor cambió, porque la fixture es tuya y está congelada. Lo que cierra el hueco es una suite de contrato que corre contra el proveedor de verdad, en agenda fija, con un conjunto pequeño de entradas representativas, y que falla cuando la forma de la salida sale del envelope acordado.',
        },
        {
          type: 'ordered',
          items: [
            'Elige de veinte a cuarenta entradas que cubran los caminos que importan, incluyendo los casos borde que producen campos opcionales, arrays vacíos y valores raros de enum.',
            'Córrela contra el proveedor real en agenda diaria, fuera del camino de deploy, para que la falla sea una señal sobre el mundo externo y no un bloqueo de tu pipeline.',
            'Valida la forma y el envelope estadístico, nunca el texto exacto: la prueba afirma que confidence es un número entre cero y uno en cien por ciento de las respuestas, no que el intent de una entrada específica sea un string literal.',
            'Fija la versión del modelo con el identificador completo, fecha incluida, y trata el alias flotante como un entorno separado que monitoreas pero no usas en producción.',
            'Cuando la prueba falle, el artefacto es un diff por campo entre la línea de base y la salida actual, porque la pregunta operativa es qué cambió, no si algo cambió.',
          ],
        },
        {
          type: 'code',
          value: `// tests/contract/intake.contract.test.js
// Corre contra el proveedor real, en agenda, fuera del deploy.
// Afirma el envelope, nunca el texto exacto de la respuesta.

import { describe, it, expect } from 'vitest';
import { callModel } from '../../src/providers/client.js';
import { toIntake } from '../../src/adapters/intake.js';
import { CASES } from './cases.js';

const MODEL = 'claude-sonnet-4-5-20250929'; // version fija, nunca alias flotante
const noopMetrics = { increment: () => {} };

describe('contrato de salida estructurada del intake', () => {
  it('mantiene la forma acordada en todas las entradas representativas', async () => {
    const results = await Promise.all(
      CASES.map(async (testCase) => {
        const raw = await callModel({ model: MODEL, input: testCase.input });
        return { testCase, intake: toIntake(raw, { metrics: noopMetrics }) };
      }),
    );

    for (const { testCase, intake } of results) {
      // Forma: siempre verdadero, independiente del contenido.
      expect(typeof intake.intent).toBe('string');
      expect(intake.confidence).toBeGreaterThanOrEqual(0);
      expect(intake.confidence).toBeLessThanOrEqual(1);
      expect(intake.entities === null || Array.isArray(intake.entities)).toBe(true);

      // Envelope: el enum puede ganar valores, pero no puede volverse
      // desconocido en el caso que existe justamente para ejercitarlo.
      if (testCase.expectsKnownPriority) {
        expect(intake.priority).not.toBe('unknown');
      }
    }

    // Estadistico: un caso aislado cayendo en revision es aceptable,
    // un tercio de la suite cayendo significa que la forma cambio.
    const reviewRate = results.filter((r) => r.intake.needsReview).length / results.length;
    expect(reviewRate).toBeLessThan(0.15);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'Esa última aserción es la que más paga el costo de la suite. No mira ningún caso individual sino la tasa agregada de casos que cayeron en revisión. Es exactamente la forma de deriva que pasa por cualquier validación ítem por ítem: nada se rompió, todo sigue válido, y aun así el sistema empezó a no entender una porción mayor del tráfico.',
        },
      ],
    },
    {
      title: 'Qué hacer el día en que el esquema cambie',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La respuesta cambia según el tipo de cambio, y conviene tenerlo decidido antes, en el runbook, y no a las tres de la mañana. Para un valor nuevo de enum, el bucket de desconocido ya sostuvo el tráfico: la acción es revisar el valor, decidir si mapea a una categoría existente o merece una nueva, y actualizar el adaptador. No hace falta rollback porque nada se rompió.',
        },
        {
          type: 'paragraph',
          value:
            'Para un tipo alterado o un campo que desapareció, la acción inmediata es fijar la versión anterior del modelo si tenías el identificador completo, que es la razón práctica de nunca llamar a producción por un alias flotante. Con la versión fijada el sistema vuelve al comportamiento conocido en minutos, y adaptarse al formato nuevo pasa a ser trabajo planificado en vez de emergencia.',
        },
        {
          type: 'list',
          items: [
            'Un alias flotante en la configuración es cómodo el día del lanzamiento y caro el día del cambio: sin versión explícita no hay rollback, solo adaptación bajo presión.',
            'Adapta el formato nuevo en un camino paralelo primero, comparando las dos salidas en sombra sobre tráfico real antes de cambiar, porque el adaptador nuevo también tiene bugs.',
            'Registra el cambio de esquema como incidente aun cuando no hubo indisponibilidad, si no el historial desaparece y la misma clase de falla vuelve el trimestre siguiente.',
            'Revisa la línea de base después de estabilizar, con fecha y versión de modelo anotadas, si no la próxima comparación mide contra un mundo que ya no existe.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El hilo que amarra todo es el mismo de cualquier integración con un tercero cuyo comportamiento no controlas: asume que la forma va a cambiar, aísla a quien conoce la forma en un solo lugar, mide el desvío antes de que se vuelva daño y mantén un camino de vuelta. La diferencia aquí es que el tercero no publica changelog de esquema y el cambio no viene con aviso, lo que solo aumenta el peso de la métrica y de la prueba de contrato.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Si uso structured output con JSON Schema, el proveedor no garantiza el formato?',
      answer:
        'Garantiza la validez sintáctica y la forma declarada, y eso ya elimina el JSON roto y la clave inventada. Lo que no está garantizado es la capa semántica por encima: qué valor de enum se eligió, si un campo opcional se completó, cuántos ítems entraron en un array, o si un número vino como 5 o "5" cuando el schema acepta una unión de tipos. Cuando el proveedor cambia la versión del modelo detrás de un alias o ajusta el decoder, esa distribución se desplaza sin violar el schema. Tu código sigue parseando con éxito y empieza a decidir distinto, lo cual es peor que romperse, porque no genera ninguna excepción.',
    },
    {
      question: '¿Por qué no lanzar excepción cuando el modelo devuelve un valor de enum desconocido?',
      answer:
        'Porque eso convierte una degradación parcial en indisponibilidad. Si el valor nuevo aparece en dos por ciento de las peticiones, la excepción tumba dos por ciento del tráfico, y la alternativa cuesta casi nada: mapearlo a un bucket explícito de desconocido, incrementar una métrica y enrutar ese caso a revisión humana. El servicio sigue en pie, la señal llega al equipo y la decisión sobre la categoría nueva ocurre en horario laboral. La regla es rechazar de forma estricta lo que cambia la forma, como una clave inesperada, y tolerar de forma contada lo que solo amplía un dominio de valores.',
    },
    {
      question: '¿Probar contra el proveedor real no vuelve la suite lenta, cara e inestable?',
      answer:
        'Sí, y por eso no pertenece al pipeline de deploy. Es una suite separada, con veinte a cuarenta entradas, corriendo en agenda diaria, cuya falla es una señal sobre el mundo externo y no un bloqueo de tu merge. El costo es bajo porque el volumen es pequeño, y la inestabilidad desaparece cuando las aserciones afirman el envelope en vez del texto: confidence es un número entre cero y uno en cien por ciento de las respuestas, y la tasa agregada de casos que caen en revisión queda por debajo de un umbral. Las pruebas con fixture congelada siguen valiendo para el adaptador, pero por definición nunca avisan que el proveedor cambió.',
    },
  ],
  conclusion: {
    title: 'La salida estructurada es integración con un tercero, y el tercero cambia sin avisar',
    description:
      'Un adaptador único que conoce el formato del modelo, coerción explícita e instrumentada, bucket de desconocido en vez de excepción, métrica por campo contra una línea de base congelada y una suite de contrato corriendo contra el proveedor real: eso es lo que transforma un cambio de esquema en trabajo planificado en vez de incidente nocturno. Puedo diseñar esa frontera en tu sistema, del adaptador a la alerta, integrada al stack que ya corres.',
    cta: 'Hablar sobre el contrato de salida en mi sistema de IA',
  },
  related: [
    { label: 'Guardrails de salida de LLM: validación y rechazo seguro', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Pruebas de regresión de herramientas del agente: contrato antes del prompt', to: '/blog/testes-regressao-ferramentas-agente-contrato-antes-do-prompt' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default { pt, en, es };
