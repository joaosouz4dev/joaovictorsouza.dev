// Conteudo do artigo: anonimizacao de dados antes de mandar para o LLM.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Camada de anonimização reversível para chamadas de LLM: detecta dado pessoal por regra e por validador, substitui cada ocorrência por um marcador estável que preserva o formato, guarda o mapa de volta apenas na memória da requisição e reidrata a resposta do modelo antes de entregar ao cliente, com um teste que falha quando um dado real vaza para o payload enviado.',
  en: 'Reversible anonymization layer for LLM calls: it detects personal data by rule and by validator, replaces each occurrence with a stable placeholder that preserves the format, keeps the reverse map only in the request memory and rehydrates the model answer before delivering it to the customer, with a test that fails when real data leaks into the sent payload.',
  es: 'Capa de anonimización reversible para llamadas de LLM: detecta dato personal por regla y por validador, sustituye cada ocurrencia por un marcador estable que preserva el formato, guarda el mapa de vuelta solo en la memoria de la petición y rehidrata la respuesta del modelo antes de entregarla al cliente, con una prueba que falla cuando un dato real se filtra al payload enviado.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-pii-redaction-mini';

const pt = {
  intro:
    'O prompt que sai do seu servidor carrega tudo que estava na conversa: o CPF que o cliente digitou para se identificar, o cartão que ele colou por engano no chat, o endereço completo de entrega, o e-mail corporativo de um terceiro que nem é seu cliente. Esse texto atravessa a internet, é processado por um provedor externo e frequentemente fica retido em log de erro, em cache de prompt, em amostra de monitoramento. Nenhuma dessas retenções é maliciosa, e todas são superfície de exposição que o seu contrato com o cliente não previu. Anonimizar antes de mandar não é burocracia de conformidade, é reduzir o dado em trânsito ao mínimo que a tarefa exige: o modelo precisa saber que existe um número de pedido, não precisa saber qual CPF está por trás dele. Este artigo mostra como construir essa camada de forma reversível e testável: o que realmente precisa sair, como detectar sem depender só de expressão regular, por que o marcador precisa preservar formato e ser estável dentro da conversa, como reidratar a resposta sem vazar o mapa e como provar em teste que nenhum dado real escapou.',
  sections: [
    {
      title: 'O que sai no prompt é maior do que você imagina',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conta de exposição raramente é feita, e quando é, costuma parar na mensagem atual do usuário. Só que o payload que chega ao provedor é bem maior: o histórico da conversa inteira, os trechos recuperados do RAG, o resultado de cada tool call, o system prompt com regras de negócio, e às vezes um bloco de contexto do CRM que alguém injetou para o bot "conhecer o cliente". Cada uma dessas fontes carrega dado pessoal por caminhos diferentes. O histórico traz o que o cliente digitou. O RAG traz o que estava no documento indexado, incluindo o e-mail do autor que ninguém lembrou de tirar. A tool call que consulta o pedido devolve nome, telefone e endereço completos porque a API interna sempre devolveu assim.',
        },
        {
          type: 'paragraph',
          value:
            'O risco não é só o provedor: é a cadeia inteira que toca esse texto. O log de erro da sua própria aplicação grava o prompt quando a chamada falha, e esse log vai para um agregador de terceiros. A ferramenta de observabilidade guarda uma amostra dos prompts para você inspecionar qualidade. O cache de prompt do provedor retém o prefixo por um tempo para baratear a chamada seguinte. A base de eval que você montou a partir de conversas reais virou um arquivo no repositório. Nenhum desses lugares foi projetado como cofre, e todos passam a conter dado pessoal no instante em que ele entra no prompt. Anonimizar na borda de saída corta todos de uma vez, porque o que nunca esteve no texto não pode vazar em lugar nenhum depois.',
        },
        {
          type: 'table',
          columns: ['Fonte do dado', 'O que costuma vazar', 'Por que passa despercebido'],
          rows: [
            [
              'Mensagem do usuário',
              'CPF, cartão, telefone, e-mail colados no chat',
              'É o único ponto que a maioria dos times lembra de filtrar',
            ],
            [
              'Histórico da conversa',
              'Tudo que já foi dito, reenviado a cada turno',
              'O dado sai uma vez e volta a sair em todas as chamadas seguintes',
            ],
            [
              'Retorno de tool call',
              'Nome completo, endereço, documento vindos da API interna',
              'Vem do seu próprio backend, então parece confiável por definição',
            ],
            [
              'Trecho recuperado do RAG',
              'E-mail e nome de terceiros dentro do documento indexado',
              'Ninguém revisa PII no corpus na hora de indexar',
            ],
            [
              'Log e amostra de eval',
              'O prompt inteiro, já montado, salvo fora do sistema',
              'É efeito colateral de debugar, não uma decisão consciente',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detectar: regex sozinha erra dos dois lados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira tentativa é sempre uma lista de expressões regulares, e ela falha nas duas direções. Falso positivo: uma sequência de onze dígitos vira CPF, mas era um número de protocolo, e o marcador destrói justamente a informação que o modelo precisava para responder. Falso negativo: o cliente escreve o CPF com pontos e traço numa formatação que a regex não previu, ou separa os dígitos com espaço, ou escreve o cartão em quatro grupos com hífen. Regex é boa para achar candidatos e péssima para decidir se o candidato é de verdade. A correção é separar as duas etapas: a expressão encontra a forma, e um validador específico do tipo confirma o conteúdo. CPF tem dígito verificador. Cartão passa no algoritmo de Luhn. CNPJ tem checksum. Um candidato que não passa no validador não é anonimizado, e com isso o falso positivo cai drasticamente sem perder recall.',
        },
        {
          type: 'paragraph',
          value:
            'Nem todo dado pessoal tem estrutura verificável, e é aí que a detecção puramente léxica encontra seu teto. Nome próprio, endereço em texto corrido e apelido não têm dígito verificador nem formato fixo. Para esses, existem duas saídas que se combinam bem. A primeira é a âncora de contexto: quando o dado vem de um campo conhecido, o retorno de uma tool call que sabidamente traz o nome do titular, você não precisa detectar nada, você já sabe onde ele está e anonimiza por origem, não por conteúdo. A segunda é reduzir o texto livre a categorias: em vez de tentar identificar cada nome no histórico, envie a mensagem do cliente e mantenha o resto do dossiê fora do prompt, deixando o modelo pedir o que precisar via tool. O que não entra no prompt não precisa ser detectado.',
        },
        {
          type: 'code',
          value: `// detect.js
// Regex acha o CANDIDATO; o validador do tipo decide se e real.
// Sem essa separacao, protocolo de 11 digitos vira CPF e o modelo
// perde a informacao que precisava para responder.

const PATTERNS = [
  { type: 'CPF', re: /\\b\\d{3}[.\\s]?\\d{3}[.\\s]?\\d{3}[-\\s]?\\d{2}\\b/g, validate: isCpf },
  { type: 'CARD', re: /\\b(?:\\d[ -]?){13,19}\\b/g, validate: isLuhn },
  { type: 'EMAIL', re: /\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}\\b/g, validate: () => true },
  { type: 'PHONE', re: /\\b(?:\\+55\\s?)?\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}\\b/g, validate: () => true },
];

function isCpf(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length !== 11 || /^(\\d)\\1{10}$/.test(d)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return (mod === 10 ? 0 : mod) === Number(d[len]);
  };
  return check(9) && check(10);
}

function isLuhn(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// Devolve os achados REAIS, ja filtrados pelo validador.
export function detect(text) {
  const found = [];
  for (const { type, re, validate } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (validate(match[0])) found.push({ type, value: match[0], index: match.index });
    }
  }
  // Maior primeiro: evita que um trecho curto corte um achado maior.
  return found.sort((a, b) => b.value.length - a.value.length);
}`,
        },
      ],
    },
    {
      title: 'O marcador precisa preservar formato e ser estável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Substituir o dado por uma tarja opaca resolve o vazamento e cria dois problemas novos. O primeiro é de formato: se todo dado vira a mesma string genérica, o modelo perde a noção do tipo e passa a tratar um telefone e um documento como a mesma coisa, o que degrada a resposta em tarefas que dependem da estrutura. O marcador precisa dizer o tipo sem dizer o valor, algo como uma etiqueta tipada e numerada. O segundo problema é de identidade: se a mesma pessoa aparece três vezes na conversa e cada ocorrência vira um marcador diferente, o modelo enxerga três pessoas distintas e a coerência da resposta desmorona. O marcador precisa ser estável dentro do escopo da conversa, isto é, o mesmo valor de entrada mapeia sempre para a mesma etiqueta enquanto aquela sessão durar.',
        },
        {
          type: 'paragraph',
          value:
            'Essa estabilidade tem um limite que é fácil de ultrapassar sem perceber. Se o marcador for derivado de um hash determinístico do valor, e esse hash for o mesmo entre sessões e entre clientes, ele vira um pseudônimo persistente: quem tiver acesso aos logs consegue correlacionar todas as conversas do mesmo CPF ao longo do tempo, mesmo sem nunca ver o número. Isso deixa de ser anonimização e vira pseudonimização, que continua sendo dado pessoal para efeito regulatório. A escolha certa depende do objetivo: se você precisa correlacionar, use um hash com sal por tenant e trate o resultado como dado sensível; se não precisa, gere o marcador a partir de um contador por requisição, que morre com ela e não correlaciona nada. Na dúvida, o contador é a opção mais defensável.',
        },
        {
          type: 'table',
          columns: ['Estratégia de marcador', 'Correlaciona entre sessões', 'Quando usar'],
          rows: [
            [
              'Contador por requisição',
              'Não, o mapa morre com a requisição',
              'Padrão: máxima proteção, o modelo só precisa de coerência interna',
            ],
            [
              'Hash com sal por tenant',
              'Sim, dentro do tenant',
              'Quando análise precisa ligar conversas do mesmo cliente sem ver o dado',
            ],
            [
              'Hash global sem sal',
              'Sim, entre tenants e para sempre',
              'Nunca: é pseudônimo permanente e ainda é dado pessoal',
            ],
            [
              'Tarja genérica sem tipo',
              'Não, mas destrói a estrutura',
              'Só quando a resposta não depende de distinguir os campos',
            ],
          ],
        },
        {
          type: 'code',
          value: `// redact.js
// Marcador TIPADO (o modelo sabe que e um CPF) e ESTAVEL dentro da
// requisicao (a mesma pessoa nao vira tres pessoas diferentes).
// O mapa de volta vive so na memoria desta requisicao.

import { detect } from './detect.js';

export function createRedactionScope() {
  const toPlaceholder = new Map(); // valor real -> marcador
  const toValue = new Map();       // marcador -> valor real
  const counters = new Map();      // tipo -> proximo numero

  function placeholderFor(type, value) {
    const existing = toPlaceholder.get(value);
    if (existing) return existing; // estabilidade: mesmo valor, mesma etiqueta
    const n = (counters.get(type) || 0) + 1;
    counters.set(type, n);
    const token = '[' + type + '_' + n + ']';
    toPlaceholder.set(value, token);
    toValue.set(token, value);
    return token;
  }

  return {
    redact(text) {
      let out = text;
      for (const { type, value } of detect(text)) {
        // split/join troca TODAS as ocorrencias sem interpretar regex.
        out = out.split(value).join(placeholderFor(type, value));
      }
      return out;
    },
    // Reidrata a resposta do modelo trocando marcador de volta por valor.
    rehydrate(text) {
      let out = text;
      for (const [token, value] of toValue) out = out.split(token).join(value);
      return out;
    },
    // Nada de persistir: o escopo morre no fim da requisicao.
    size() {
      return toValue.size;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'Reidratar a resposta sem devolver o que o modelo não deveria saber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A anonimização só é utilizável se a resposta voltar legível para o cliente. O modelo recebeu um texto com etiquetas e responde com as mesmas etiquetas, e a camada de saída troca cada uma pelo valor original antes de entregar. Isso funciona porque o mapa de volta nunca saiu do seu processo. O ponto delicado é o escopo desse mapa: ele pertence à requisição e à identidade de quem a fez, e reidratar um marcador com o valor de outra sessão seria um vazamento cruzado muito pior do que o original. Na prática isso significa nunca guardar o mapa num cache compartilhado por chave previsível, nunca reaproveitá-lo entre usuários e destruí-lo ao fim do ciclo, mesmo em caso de erro.',
        },
        {
          type: 'paragraph',
          value:
            'A reidratação também precisa de um freio contra o marcador inventado. O modelo pode devolver uma etiqueta que você nunca emitiu, seja por alucinação, seja porque alguém plantou um texto com formato de marcador no conteúdo recuperado pelo RAG. Se a sua função de troca aceitar qualquer coisa que pareça um marcador, ela vira um oráculo: basta o atacante escrever a etiqueta certa na mensagem para receber de volta o valor real de outro campo. O tratamento correto é aceitar apenas os marcadores que aquele escopo emitiu e deixar os demais intactos, além de registrar a ocorrência, porque um marcador desconhecido na saída é sinal de alucinação ou de tentativa de injeção, e vale investigar nos dois casos.',
        },
        {
          type: 'diagram',
          value: `Ciclo de anonimizacao reversivel

  entrada do cliente
    "meu cpf e 529.982.247-25, pedido 11223344"
        |
        v
  [detect] regex acha candidato -> validador confirma
        |   (11223344 nao passa em isCpf: fica intacto)
        v
  [redact] "meu cpf e [CPF_1], pedido 11223344"
        |
        |  mapa { [CPF_1] -> 529.982.247-25 }  (so na memoria da requisicao)
        v
  ============ FRONTEIRA: aqui sai da sua rede ============
        |
        v
  provedor de LLM  (log, cache de prompt, amostra)
        |   nunca viu o CPF real
        v
  resposta "confirmei o [CPF_1] no pedido 11223344"
        |
        v
  [rehydrate] so troca marcadores que ESTE escopo emitiu
        |   marcador desconhecido -> mantem e registra alerta
        v
  "confirmei o 529.982.247-25 no pedido 11223344"  -> cliente`,
        },
      ],
    },
    {
      title: 'Nem todo dado deve voltar: minimizar antes de anonimizar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A camada de anonimização é a última linha, não a primeira. Antes de perguntar como esconder um dado, vale perguntar por que ele está no prompt. Muita PII chega ao modelo porque alguém montou o contexto com um dump do cadastro em vez de com os campos que a tarefa exige. Se o bot precisa dizer se o pedido foi entregue, ele precisa do status, não do endereço completo. Se precisa confirmar identidade, precisa saber que a confirmação bateu, não do documento inteiro. Trocar o dossiê por um resumo derivado corta a exposição na origem e reduz tokens de quebra, e o que não entra no prompt não depende de o detector funcionar.',
        },
        {
          type: 'ordered',
          items: [
            'Reveja o que o contexto carrega: liste os campos que entram no prompt e marque quais a tarefa realmente usa para produzir a resposta.',
            'Substitua dado por veredito: em vez de mandar o documento para o modelo comparar, faça a comparação no seu código e mande apenas se conferiu ou não.',
            'Prefira referência a valor: mande o identificador interno do pedido e deixe o modelo pedir detalhes via tool, com a tool devolvendo já o campo mínimo.',
            'Trate o retorno de tool como fonte de PII: anonimize o resultado antes de concatená-lo ao contexto, com o mesmo escopo da requisição.',
            'Limpe o corpus do RAG na ingestão: o trecho recuperado entra no prompt como qualquer outro texto, e PII indexada vaza em toda consulta que a recuperar.',
            'Só então anonimize o que sobrou: a camada de detecção fica responsável pelo residual, não pelo volume principal.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Existe um caso em que anonimizar não basta e a resposta certa é não mandar: dado que o modelo não precisa e cuja simples presença já viola um contrato ou uma norma setorial, como dado de saúde num sistema que não tem base legal para tratá-lo com terceiros, ou credencial de qualquer tipo. Para esses, a política não é substituir por marcador, é bloquear a chamada e devolver um caminho alternativo, exatamente como um guardrail de saída bloqueia uma ação perigosa. Misturar as duas políticas na mesma função é um erro comum: a de anonimizar quer deixar a chamada seguir, a de bloquear quer interrompê-la, e a segunda precisa ser explícita para não ser silenciosamente rebaixada à primeira.',
        },
      ],
    },
    {
      title: 'Provar que não vazou: o teste que falha com dado real no payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma camada de anonimização sem teste é uma suposição. Ela quebra de formas discretas: alguém adiciona um campo novo ao contexto e esquece de passá-lo pelo redator, uma refatoração troca a ordem e o dado é concatenado depois da anonimização, um provedor novo é integrado por um caminho que não passa pela camada. Nenhuma dessas falhas gera erro visível, porque a chamada continua funcionando e a resposta continua boa. O único jeito de pegar é inverter a asserção: em vez de testar que o redator funciona isoladamente, teste que o payload final, o objeto exato que vai para a rede, não contém nenhum dos valores sensíveis do caso. Esse teste vive no ponto mais externo possível, idealmente num duplo do cliente HTTP que captura o corpo enviado.',
        },
        {
          type: 'code',
          value: `// pii-leak.test.js
// A assercao e sobre o PAYLOAD QUE SAI, nao sobre a funcao de redigir.
// Assim o teste pega o campo novo que alguem esqueceu de anonimizar.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload } from '../src/build-payload.js';

const SENSITIVE = {
  cpf: '529.982.247-25',
  email: 'cliente@exemplo.com.br',
  card: '4111 1111 1111 1111',
};

test('nenhum dado sensivel atravessa a fronteira de rede', () => {
  const payload = buildPayload({
    userMessage: 'meu cpf e ' + SENSITIVE.cpf + ' e o cartao ' + SENSITIVE.card,
    history: [{ role: 'user', content: 'me manda no ' + SENSITIVE.email }],
    toolResults: [{ name: 'getOrder', content: JSON.stringify({ email: SENSITIVE.email }) }],
  });

  // Serializa TUDO que sai: nenhum campo escapa da verificacao.
  const wire = JSON.stringify(payload);

  for (const [label, value] of Object.entries(SENSITIVE)) {
    assert.ok(!wire.includes(value), 'vazou ' + label + ' no payload');
    // Tambem sem formatacao: o dado pode sair so com digitos.
    const digits = value.replace(/\\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!wire.includes(digits), 'vazou ' + label + ' sem formatacao');
    }
  }

  // O marcador precisa estar la: anonimizar nao pode virar apagar.
  assert.match(wire, /\\[CPF_1\\]/);
});

test('numero que nao e CPF nao vira marcador', () => {
  const payload = buildPayload({ userMessage: 'pedido 11223344', history: [], toolResults: [] });
  assert.match(JSON.stringify(payload), /11223344/);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Vale medir a camada em produção também, com dois sinais baratos. O primeiro é a contagem de marcadores emitidos por requisição, quebrada por tipo: uma queda súbita para zero num tipo que sempre aparecia significa que o detector parou de funcionar, provavelmente por uma mudança de formato na origem. O segundo é a taxa de marcador desconhecido na reidratação, que deveria ser praticamente nula: qualquer subida indica alucinação do modelo ou tentativa de injeção pelo conteúdo recuperado. Junto com o teste de payload no CI, esses dois números transformam a anonimização de promessa em propriedade verificável, que é a única forma de sustentá-la ao longo do tempo enquanto o sistema muda.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não basta usar expressão regular para detectar dado pessoal?',
      answer:
        'Porque a expressão regular erra nos dois sentidos e cada erro tem um custo diferente. No falso positivo, uma sequência de onze dígitos que era número de protocolo vira marcador de CPF, e o modelo perde exatamente a informação que precisava para responder, degradando a qualidade sem que ninguém associe a causa. No falso negativo, o cliente escreve o documento numa formatação que a expressão não previu e o dado atravessa a fronteira intacto. A correção é separar as duas etapas: a expressão encontra o candidato pela forma e um validador específico do tipo confirma o conteúdo, dígito verificador para CPF e CNPJ, algoritmo de Luhn para cartão. Para dado sem estrutura verificável, como nome e endereço em texto corrido, a saída é anonimizar por origem, quando o campo vem de uma tool call conhecida, e minimizar o que entra no prompt, porque o que não entra não precisa ser detectado.',
    },
    {
      question: 'O marcador deve ser sempre o mesmo para o mesmo dado?',
      answer:
        'Dentro da requisição, sim, e essa estabilidade é obrigatória: se a mesma pessoa aparece três vezes na conversa e cada ocorrência vira um marcador diferente, o modelo enxerga três pessoas distintas e a coerência da resposta desmorona. Entre requisições, a resposta padrão é não. Um marcador derivado de hash determinístico do valor, igual entre sessões e clientes, vira um pseudônimo permanente: quem tiver acesso aos logs consegue correlacionar todas as conversas do mesmo documento ao longo do tempo sem nunca ver o número, o que ainda é dado pessoal para efeito regulatório. Gerar o marcador a partir de um contador por requisição, com um mapa que morre junto com ela, dá a coerência que o modelo precisa sem criar correlação nenhuma. Se a análise realmente exigir ligar conversas do mesmo cliente, use hash com sal por tenant e trate o resultado como dado sensível.',
    },
    {
      question: 'Como garantir que nenhum dado real está vazando na prática?',
      answer:
        'Invertendo a asserção do teste. Testar que a função de anonimizar funciona isoladamente não pega a falha mais comum, que é um campo novo adicionado ao contexto por um caminho que não passa pela camada, ou uma refatoração que concatena o dado depois da anonimização. O teste que pega isso serializa o payload final, o objeto exato que vai para a rede, e afirma que ele não contém nenhum dos valores sensíveis do caso, nem na forma formatada nem só com os dígitos. Ele deve rodar no ponto mais externo possível, num duplo do cliente HTTP que captura o corpo enviado, e falhar o build quando algo escapa. Em produção, complemente com dois sinais: a contagem de marcadores emitidos por tipo, cuja queda súbita a zero denuncia um detector quebrado, e a taxa de marcador desconhecido na reidratação, cuja subida indica alucinação ou tentativa de injeção pelo conteúdo recuperado.',
    },
  ],
  conclusion: {
    title: 'O dado que nunca entrou no prompt não vaza em lugar nenhum',
    description:
      'O prompt que sai do seu servidor carrega muito mais do que a mensagem atual: histórico inteiro, retorno de tool, trecho de RAG e system prompt, e cada um desses caminhos leva dado pessoal para log, cache e amostra de monitoramento que nunca foram projetados como cofre. Minimizar primeiro e anonimizar o residual depois, com detecção validada em vez de só regex, marcador tipado e estável dentro da requisição, reidratação restrita ao escopo que a emitiu e um teste que falha quando o valor real aparece no payload, transforma privacidade de promessa em propriedade verificável. Posso desenhar e implementar essa camada no seu sistema com LLM, da minimização do contexto ao teste de vazamento no CI, para que o dado do seu cliente pare na sua rede em vez de atravessar a fronteira sem necessidade.',
    cta: 'Falar sobre anonimização no meu sistema com LLM',
  },
  related: [
    { label: 'Prompt injection em RAG: defender o contexto recuperado', to: '/blog/prompt-injection-rag-defender-contexto-recuperado' },
    { label: 'Guardrails de saída em LLM: validação e recusa segura', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Checklist de segurança para integrações Meta e WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: { name: 'llm-pii-redaction-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The prompt that leaves your server carries everything that was in the conversation: the tax id the customer typed to identify themselves, the card they pasted into the chat by mistake, the full delivery address, the corporate email of a third party who is not even your customer. That text crosses the internet, is processed by an external provider and often stays retained in an error log, in a prompt cache, in a monitoring sample. None of those retentions is malicious, and all of them are exposure surface your contract with the customer did not account for. Anonymizing before sending is not compliance bureaucracy, it is reducing the data in transit to the minimum the task requires: the model needs to know an order number exists, it does not need to know which tax id sits behind it. This article shows how to build that layer in a reversible and testable way: what really needs to leave, how to detect without relying on regular expressions alone, why the placeholder must preserve format and be stable inside the conversation, how to rehydrate the answer without leaking the map and how to prove in a test that no real data escaped.',
  sections: [
    {
      title: 'What leaves in the prompt is larger than you think',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The exposure accounting is rarely done, and when it is, it usually stops at the current user message. But the payload that reaches the provider is much larger: the entire conversation history, the passages retrieved from RAG, the result of every tool call, the system prompt with business rules, and sometimes a block of CRM context someone injected so the bot would "know the customer". Each of those sources carries personal data by a different path. The history brings what the customer typed. RAG brings what was in the indexed document, including the author email nobody remembered to strip. The tool call that looks up the order returns full name, phone and address because the internal API has always returned it that way.',
        },
        {
          type: 'paragraph',
          value:
            'The risk is not only the provider: it is the whole chain that touches that text. Your own application error log records the prompt when the call fails, and that log goes to a third-party aggregator. The observability tool keeps a sample of prompts so you can inspect quality. The provider prompt cache retains the prefix for a while to make the next call cheaper. The eval dataset you assembled from real conversations became a file in the repository. None of those places was designed as a vault, and all of them start containing personal data the moment it enters the prompt. Anonymizing at the outbound edge cuts all of them at once, because what was never in the text cannot leak anywhere afterwards.',
        },
        {
          type: 'table',
          columns: ['Data source', 'What usually leaks', 'Why it goes unnoticed'],
          rows: [
            [
              'User message',
              'Tax id, card, phone, email pasted into the chat',
              'It is the only point most teams remember to filter',
            ],
            [
              'Conversation history',
              'Everything already said, resent on every turn',
              'The data leaves once and keeps leaving on every following call',
            ],
            [
              'Tool call result',
              'Full name, address, document coming from the internal API',
              'It comes from your own backend, so it looks trusted by definition',
            ],
            [
              'Retrieved RAG passage',
              'Third-party email and name inside the indexed document',
              'Nobody reviews PII in the corpus at indexing time',
            ],
            [
              'Log and eval sample',
              'The whole assembled prompt, saved outside the system',
              'It is a side effect of debugging, not a conscious decision',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detecting: regex alone gets it wrong on both sides',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first attempt is always a list of regular expressions, and it fails in both directions. False positive: a sequence of eleven digits becomes a tax id, but it was a ticket number, and the placeholder destroys exactly the information the model needed to answer. False negative: the customer writes the document with dots and a dash in a formatting the regex did not anticipate, or separates the digits with spaces, or writes the card in four hyphenated groups. Regex is good at finding candidates and terrible at deciding whether the candidate is real. The fix is to split the two steps: the expression finds the shape, and a type-specific validator confirms the content. A Brazilian tax id has check digits. A card passes the Luhn algorithm. A company id has a checksum. A candidate that fails the validator is not anonymized, and with that false positives drop drastically without losing recall.',
        },
        {
          type: 'paragraph',
          value:
            'Not every piece of personal data has verifiable structure, and that is where purely lexical detection hits its ceiling. A person name, an address in running text and a nickname have no check digit and no fixed format. For those, two exits combine well. The first is the context anchor: when the data comes from a known field, the return of a tool call that is known to carry the holder name, you do not need to detect anything, you already know where it is and you anonymize by origin, not by content. The second is reducing free text to categories: instead of trying to identify every name in the history, send the customer message and keep the rest of the dossier out of the prompt, letting the model ask for what it needs through a tool. What does not enter the prompt does not need to be detected.',
        },
        {
          type: 'code',
          value: `// detect.js
// Regex finds the CANDIDATE; the type validator decides if it is real.
// Without that split, an 11-digit ticket number becomes a tax id and the
// model loses the information it needed to answer.

const PATTERNS = [
  { type: 'CPF', re: /\\b\\d{3}[.\\s]?\\d{3}[.\\s]?\\d{3}[-\\s]?\\d{2}\\b/g, validate: isCpf },
  { type: 'CARD', re: /\\b(?:\\d[ -]?){13,19}\\b/g, validate: isLuhn },
  { type: 'EMAIL', re: /\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}\\b/g, validate: () => true },
  { type: 'PHONE', re: /\\b(?:\\+55\\s?)?\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}\\b/g, validate: () => true },
];

function isCpf(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length !== 11 || /^(\\d)\\1{10}$/.test(d)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return (mod === 10 ? 0 : mod) === Number(d[len]);
  };
  return check(9) && check(10);
}

function isLuhn(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// Returns the REAL findings, already filtered by the validator.
export function detect(text) {
  const found = [];
  for (const { type, re, validate } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (validate(match[0])) found.push({ type, value: match[0], index: match.index });
    }
  }
  // Longest first: prevents a short match from cutting a longer finding.
  return found.sort((a, b) => b.value.length - a.value.length);
}`,
        },
      ],
    },
    {
      title: 'The placeholder must preserve format and be stable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Replacing the data with an opaque black bar fixes the leak and creates two new problems. The first is format: if every piece of data becomes the same generic string, the model loses the notion of type and starts treating a phone number and a document as the same thing, which degrades the answer in tasks that depend on structure. The placeholder must state the type without stating the value, something like a typed and numbered label. The second problem is identity: if the same person appears three times in the conversation and each occurrence becomes a different placeholder, the model sees three distinct people and the coherence of the answer collapses. The placeholder must be stable within the scope of the conversation, meaning the same input value always maps to the same label for as long as that session lasts.',
        },
        {
          type: 'paragraph',
          value:
            'That stability has a limit which is easy to cross without noticing. If the placeholder is derived from a deterministic hash of the value, and that hash is the same across sessions and across customers, it becomes a persistent pseudonym: anyone with access to the logs can correlate every conversation of the same tax id over time, even without ever seeing the number. That stops being anonymization and becomes pseudonymization, which is still personal data for regulatory purposes. The right choice depends on the goal: if you need to correlate, use a hash with a per-tenant salt and treat the result as sensitive data; if you do not, generate the placeholder from a per-request counter, which dies with it and correlates nothing. When in doubt, the counter is the more defensible option.',
        },
        {
          type: 'table',
          columns: ['Placeholder strategy', 'Correlates across sessions', 'When to use'],
          rows: [
            [
              'Per-request counter',
              'No, the map dies with the request',
              'Default: maximum protection, the model only needs internal coherence',
            ],
            [
              'Hash with per-tenant salt',
              'Yes, inside the tenant',
              'When analysis must link conversations of the same customer without seeing the data',
            ],
            [
              'Global hash without salt',
              'Yes, across tenants and forever',
              'Never: it is a permanent pseudonym and still personal data',
            ],
            [
              'Generic bar without type',
              'No, but it destroys the structure',
              'Only when the answer does not depend on telling the fields apart',
            ],
          ],
        },
        {
          type: 'code',
          value: `// redact.js
// TYPED placeholder (the model knows it is a tax id) and STABLE within the
// request (the same person does not become three different people).
// The reverse map lives only in this request memory.

import { detect } from './detect.js';

export function createRedactionScope() {
  const toPlaceholder = new Map(); // real value -> placeholder
  const toValue = new Map();       // placeholder -> real value
  const counters = new Map();      // type -> next number

  function placeholderFor(type, value) {
    const existing = toPlaceholder.get(value);
    if (existing) return existing; // stability: same value, same label
    const n = (counters.get(type) || 0) + 1;
    counters.set(type, n);
    const token = '[' + type + '_' + n + ']';
    toPlaceholder.set(value, token);
    toValue.set(token, value);
    return token;
  }

  return {
    redact(text) {
      let out = text;
      for (const { type, value } of detect(text)) {
        // split/join swaps ALL occurrences without interpreting regex.
        out = out.split(value).join(placeholderFor(type, value));
      }
      return out;
    },
    // Rehydrates the model answer swapping placeholder back for value.
    rehydrate(text) {
      let out = text;
      for (const [token, value] of toValue) out = out.split(token).join(value);
      return out;
    },
    // Nothing is persisted: the scope dies at the end of the request.
    size() {
      return toValue.size;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'Rehydrating the answer without giving back what the model should not know',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Anonymization is only usable if the answer comes back readable for the customer. The model received a text with labels and answers with the same labels, and the outbound layer swaps each one for the original value before delivering. This works because the reverse map never left your process. The delicate point is the scope of that map: it belongs to the request and to the identity of whoever made it, and rehydrating a placeholder with the value from another session would be a cross leak far worse than the original one. In practice that means never keeping the map in a shared cache under a predictable key, never reusing it across users and destroying it at the end of the cycle, even on error.',
        },
        {
          type: 'paragraph',
          value:
            'Rehydration also needs a brake against the invented placeholder. The model may return a label you never issued, whether by hallucination or because someone planted a text with placeholder format in the content retrieved by RAG. If your swap function accepts anything that looks like a placeholder, it becomes an oracle: the attacker just has to write the right label in the message to receive back the real value of another field. The correct treatment is to accept only the placeholders that scope issued and leave the rest untouched, plus record the occurrence, because an unknown placeholder in the output is a sign of hallucination or of an injection attempt, and both are worth investigating.',
        },
        {
          type: 'diagram',
          value: `Reversible anonymization cycle

  customer input
    "my tax id is 529.982.247-25, order 11223344"
        |
        v
  [detect] regex finds candidate -> validator confirms
        |   (11223344 fails isCpf: stays untouched)
        v
  [redact] "my tax id is [CPF_1], order 11223344"
        |
        |  map { [CPF_1] -> 529.982.247-25 }  (only in request memory)
        v
  ============ BOUNDARY: this leaves your network ============
        |
        v
  LLM provider  (log, prompt cache, sample)
        |   never saw the real tax id
        v
  answer "confirmed [CPF_1] on order 11223344"
        |
        v
  [rehydrate] only swaps placeholders THIS scope issued
        |   unknown placeholder -> keep it and raise an alert
        v
  "confirmed 529.982.247-25 on order 11223344"  -> customer`,
        },
      ],
    },
    {
      title: 'Not every piece of data should come back: minimize before anonymizing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The anonymization layer is the last line, not the first. Before asking how to hide a piece of data, it is worth asking why it is in the prompt at all. A lot of PII reaches the model because someone assembled the context with a dump of the customer record instead of with the fields the task requires. If the bot needs to say whether the order was delivered, it needs the status, not the full address. If it needs to confirm identity, it needs to know the confirmation matched, not the whole document. Swapping the dossier for a derived summary cuts exposure at the source and reduces tokens as a bonus, and what does not enter the prompt does not depend on the detector working.',
        },
        {
          type: 'ordered',
          items: [
            'Review what the context carries: list the fields that enter the prompt and mark which ones the task actually uses to produce the answer.',
            'Replace data with a verdict: instead of sending the document for the model to compare, do the comparison in your code and send only whether it matched.',
            'Prefer reference over value: send the internal order identifier and let the model ask for details through a tool, with the tool already returning the minimal field.',
            'Treat tool results as a PII source: anonymize the result before concatenating it into the context, with the same request scope.',
            'Clean the RAG corpus at ingestion: the retrieved passage enters the prompt like any other text, and indexed PII leaks on every query that retrieves it.',
            'Only then anonymize what is left: the detection layer is responsible for the residue, not for the main volume.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is a case where anonymizing is not enough and the right answer is not to send at all: data the model does not need and whose mere presence already violates a contract or a sector rule, such as health data in a system with no legal basis to process it with third parties, or a credential of any kind. For those, the policy is not to replace with a placeholder, it is to block the call and return an alternative path, exactly as an output guardrail blocks a dangerous action. Mixing the two policies in the same function is a common mistake: the anonymizing one wants the call to proceed, the blocking one wants to interrupt it, and the second must be explicit so it is not silently downgraded into the first.',
        },
      ],
    },
    {
      title: 'Proving it did not leak: the test that fails with real data in the payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An anonymization layer without a test is an assumption. It breaks in discreet ways: someone adds a new field to the context and forgets to run it through the redactor, a refactor changes the order and the data is concatenated after anonymization, a new provider is integrated through a path that does not go through the layer. None of those failures produces a visible error, because the call keeps working and the answer keeps being good. The only way to catch it is to invert the assertion: instead of testing that the redactor works in isolation, test that the final payload, the exact object that goes to the network, contains none of the sensitive values of the case. That test lives at the outermost point possible, ideally in an HTTP client double that captures the sent body.',
        },
        {
          type: 'code',
          value: `// pii-leak.test.js
// The assertion is about the PAYLOAD THAT LEAVES, not about the redact function.
// That way the test catches the new field someone forgot to anonymize.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload } from '../src/build-payload.js';

const SENSITIVE = {
  cpf: '529.982.247-25',
  email: 'customer@example.com',
  card: '4111 1111 1111 1111',
};

test('no sensitive data crosses the network boundary', () => {
  const payload = buildPayload({
    userMessage: 'my tax id is ' + SENSITIVE.cpf + ' and the card ' + SENSITIVE.card,
    history: [{ role: 'user', content: 'send it to ' + SENSITIVE.email }],
    toolResults: [{ name: 'getOrder', content: JSON.stringify({ email: SENSITIVE.email }) }],
  });

  // Serializes EVERYTHING that leaves: no field escapes the check.
  const wire = JSON.stringify(payload);

  for (const [label, value] of Object.entries(SENSITIVE)) {
    assert.ok(!wire.includes(value), 'leaked ' + label + ' in the payload');
    // Also without formatting: the data may leave as digits only.
    const digits = value.replace(/\\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!wire.includes(digits), 'leaked ' + label + ' without formatting');
    }
  }

  // The placeholder must be there: anonymizing cannot become erasing.
  assert.match(wire, /\\[CPF_1\\]/);
});

test('a number that is not a tax id does not become a placeholder', () => {
  const payload = buildPayload({ userMessage: 'order 11223344', history: [], toolResults: [] });
  assert.match(JSON.stringify(payload), /11223344/);
});`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth measuring the layer in production too, with two cheap signals. The first is the count of placeholders issued per request, broken down by type: a sudden drop to zero on a type that always appeared means the detector stopped working, most likely because of a format change at the source. The second is the unknown-placeholder rate at rehydration, which should be practically nil: any rise indicates model hallucination or an injection attempt through the retrieved content. Together with the payload test in CI, those two numbers turn anonymization from a promise into a verifiable property, which is the only way to sustain it over time while the system changes.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why is a regular expression not enough to detect personal data?',
      answer:
        'Because the regular expression gets it wrong in both directions and each error has a different cost. On the false positive, a sequence of eleven digits that was a ticket number becomes a tax id placeholder, and the model loses exactly the information it needed to answer, degrading quality without anyone connecting the cause. On the false negative, the customer writes the document in a formatting the expression did not anticipate and the data crosses the boundary intact. The fix is to split the two steps: the expression finds the candidate by shape and a type-specific validator confirms the content, check digits for tax and company ids, the Luhn algorithm for cards. For data without verifiable structure, such as a name or an address in running text, the exit is to anonymize by origin, when the field comes from a known tool call, and to minimize what enters the prompt, because what does not enter does not need to be detected.',
    },
    {
      question: 'Should the placeholder always be the same for the same piece of data?',
      answer:
        'Within the request, yes, and that stability is mandatory: if the same person appears three times in the conversation and each occurrence becomes a different placeholder, the model sees three distinct people and the coherence of the answer collapses. Across requests, the default answer is no. A placeholder derived from a deterministic hash of the value, identical across sessions and customers, becomes a permanent pseudonym: anyone with access to the logs can correlate every conversation of the same document over time without ever seeing the number, which is still personal data for regulatory purposes. Generating the placeholder from a per-request counter, with a map that dies along with it, gives the coherence the model needs while correlating nothing. If analysis genuinely requires linking conversations of the same customer, use a hash with a per-tenant salt and treat the result as sensitive data.',
    },
    {
      question: 'How do you guarantee in practice that no real data is leaking?',
      answer:
        'By inverting the test assertion. Testing that the anonymizing function works in isolation does not catch the most common failure, which is a new field added to the context through a path that skips the layer, or a refactor that concatenates the data after anonymization. The test that catches it serializes the final payload, the exact object that goes to the network, and asserts it contains none of the sensitive values of the case, neither in formatted form nor as digits only. It should run at the outermost point possible, in an HTTP client double that captures the sent body, and fail the build when something escapes. In production, complement it with two signals: the count of placeholders issued per type, whose sudden drop to zero exposes a broken detector, and the unknown-placeholder rate at rehydration, whose rise indicates hallucination or an injection attempt through retrieved content.',
    },
  ],
  conclusion: {
    title: 'Data that never entered the prompt leaks nowhere',
    description:
      'The prompt that leaves your server carries far more than the current message: the whole history, tool results, RAG passages and the system prompt, and each of those paths takes personal data into logs, caches and monitoring samples that were never designed as vaults. Minimizing first and anonymizing the residue afterwards, with validated detection instead of regex alone, a typed placeholder that is stable within the request, rehydration restricted to the scope that issued it and a test that fails when the real value appears in the payload, turns privacy from a promise into a verifiable property. I can design and implement this layer in your LLM system, from context minimization to the leak test in CI, so that your customer data stops inside your network instead of crossing the boundary without need.',
    cta: 'Talk about anonymization in my LLM system',
  },
  related: [
    { label: 'Prompt injection in RAG: defending the retrieved context', to: '/blog/prompt-injection-rag-defender-contexto-recuperado' },
    { label: 'LLM output guardrails: validation and safe refusal', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Security checklist for Meta and WhatsApp integrations', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: { name: 'llm-pii-redaction-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El prompt que sale de tu servidor lleva todo lo que estaba en la conversación: el documento que el cliente escribió para identificarse, la tarjeta que pegó por error en el chat, la dirección completa de entrega, el correo corporativo de un tercero que ni siquiera es tu cliente. Ese texto atraviesa internet, es procesado por un proveedor externo y con frecuencia queda retenido en un log de error, en un cache de prompt, en una muestra de monitoreo. Ninguna de esas retenciones es maliciosa, y todas son superficie de exposición que tu contrato con el cliente no previó. Anonimizar antes de mandar no es burocracia de cumplimiento, es reducir el dato en tránsito al mínimo que la tarea exige: el modelo necesita saber que existe un número de pedido, no necesita saber qué documento está detrás. Este artículo muestra cómo construir esa capa de forma reversible y testeable: qué realmente necesita salir, cómo detectar sin depender solo de expresiones regulares, por qué el marcador debe preservar el formato y ser estable dentro de la conversación, cómo rehidratar la respuesta sin filtrar el mapa y cómo probar en un test que ningún dato real se escapó.',
  sections: [
    {
      title: 'Lo que sale en el prompt es más grande de lo que imaginas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La cuenta de exposición rara vez se hace, y cuando se hace suele parar en el mensaje actual del usuario. Pero el payload que llega al proveedor es bastante mayor: el historial completo de la conversación, los fragmentos recuperados del RAG, el resultado de cada tool call, el system prompt con reglas de negocio, y a veces un bloque de contexto del CRM que alguien inyectó para que el bot "conozca al cliente". Cada una de esas fuentes lleva dato personal por caminos distintos. El historial trae lo que el cliente escribió. El RAG trae lo que estaba en el documento indexado, incluido el correo del autor que nadie recordó quitar. La tool call que consulta el pedido devuelve nombre, teléfono y dirección completos porque la API interna siempre los devolvió así.',
        },
        {
          type: 'paragraph',
          value:
            'El riesgo no es solo el proveedor: es toda la cadena que toca ese texto. El log de error de tu propia aplicación graba el prompt cuando la llamada falla, y ese log va a un agregador de terceros. La herramienta de observabilidad guarda una muestra de los prompts para que inspecciones calidad. El cache de prompt del proveedor retiene el prefijo un tiempo para abaratar la llamada siguiente. El dataset de eval que armaste a partir de conversaciones reales se volvió un archivo en el repositorio. Ninguno de esos lugares fue diseñado como caja fuerte, y todos pasan a contener dato personal en el instante en que entra al prompt. Anonimizar en el borde de salida corta todos de una vez, porque lo que nunca estuvo en el texto no puede filtrarse en ningún lado después.',
        },
        {
          type: 'table',
          columns: ['Fuente del dato', 'Qué suele filtrarse', 'Por qué pasa desapercibido'],
          rows: [
            [
              'Mensaje del usuario',
              'Documento, tarjeta, teléfono, correo pegados en el chat',
              'Es el único punto que la mayoría de los equipos recuerda filtrar',
            ],
            [
              'Historial de la conversación',
              'Todo lo ya dicho, reenviado en cada turno',
              'El dato sale una vez y vuelve a salir en todas las llamadas siguientes',
            ],
            [
              'Retorno de tool call',
              'Nombre completo, dirección, documento venidos de la API interna',
              'Viene de tu propio backend, así que parece confiable por definición',
            ],
            [
              'Fragmento recuperado del RAG',
              'Correo y nombre de terceros dentro del documento indexado',
              'Nadie revisa PII en el corpus a la hora de indexar',
            ],
            [
              'Log y muestra de eval',
              'El prompt entero, ya armado, guardado fuera del sistema',
              'Es efecto colateral de depurar, no una decisión consciente',
            ],
          ],
        },
      ],
    },
    {
      title: 'Detectar: la regex sola se equivoca de los dos lados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer intento siempre es una lista de expresiones regulares, y falla en las dos direcciones. Falso positivo: una secuencia de once dígitos se vuelve documento, pero era un número de protocolo, y el marcador destruye justamente la información que el modelo necesitaba para responder. Falso negativo: el cliente escribe el documento con puntos y guion en un formato que la regex no previó, o separa los dígitos con espacios, o escribe la tarjeta en cuatro grupos con guiones. La regex es buena para encontrar candidatos y pésima para decidir si el candidato es real. La corrección es separar las dos etapas: la expresión encuentra la forma, y un validador específico del tipo confirma el contenido. El documento tiene dígito verificador. La tarjeta pasa el algoritmo de Luhn. El identificador de empresa tiene checksum. Un candidato que no pasa el validador no se anonimiza, y con eso el falso positivo cae drásticamente sin perder recall.',
        },
        {
          type: 'paragraph',
          value:
            'No todo dato personal tiene estructura verificable, y ahí es donde la detección puramente léxica encuentra su techo. Un nombre propio, una dirección en texto corrido y un apodo no tienen dígito verificador ni formato fijo. Para esos hay dos salidas que se combinan bien. La primera es el ancla de contexto: cuando el dato viene de un campo conocido, el retorno de una tool call que se sabe que trae el nombre del titular, no necesitas detectar nada, ya sabes dónde está y anonimizas por origen, no por contenido. La segunda es reducir el texto libre a categorías: en vez de intentar identificar cada nombre en el historial, envía el mensaje del cliente y mantén el resto del expediente fuera del prompt, dejando que el modelo pida lo que necesite vía tool. Lo que no entra en el prompt no necesita ser detectado.',
        },
        {
          type: 'code',
          value: `// detect.js
// La regex encuentra el CANDIDATO; el validador del tipo decide si es real.
// Sin esa separacion, un protocolo de 11 digitos se vuelve documento y el
// modelo pierde la informacion que necesitaba para responder.

const PATTERNS = [
  { type: 'CPF', re: /\\b\\d{3}[.\\s]?\\d{3}[.\\s]?\\d{3}[-\\s]?\\d{2}\\b/g, validate: isCpf },
  { type: 'CARD', re: /\\b(?:\\d[ -]?){13,19}\\b/g, validate: isLuhn },
  { type: 'EMAIL', re: /\\b[\\w.+-]+@[\\w-]+\\.[\\w.-]{2,}\\b/g, validate: () => true },
  { type: 'PHONE', re: /\\b(?:\\+55\\s?)?\\(?\\d{2}\\)?\\s?9?\\d{4}[-\\s]?\\d{4}\\b/g, validate: () => true },
];

function isCpf(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length !== 11 || /^(\\d)\\1{10}$/.test(d)) return false;
  const check = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i += 1) sum += Number(d[i]) * (len + 1 - i);
    const mod = (sum * 10) % 11;
    return (mod === 10 ? 0 : mod) === Number(d[len]);
  };
  return check(9) && check(10);
}

function isLuhn(raw) {
  const d = raw.replace(/\\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i]);
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// Devuelve los hallazgos REALES, ya filtrados por el validador.
export function detect(text) {
  const found = [];
  for (const { type, re, validate } of PATTERNS) {
    for (const match of text.matchAll(re)) {
      if (validate(match[0])) found.push({ type, value: match[0], index: match.index });
    }
  }
  // El mas largo primero: evita que un fragmento corto corte un hallazgo mayor.
  return found.sort((a, b) => b.value.length - a.value.length);
}`,
        },
      ],
    },
    {
      title: 'El marcador debe preservar el formato y ser estable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sustituir el dato por una franja opaca resuelve la filtración y crea dos problemas nuevos. El primero es de formato: si todo dato se vuelve la misma cadena genérica, el modelo pierde la noción del tipo y pasa a tratar un teléfono y un documento como la misma cosa, lo que degrada la respuesta en tareas que dependen de la estructura. El marcador debe decir el tipo sin decir el valor, algo como una etiqueta tipada y numerada. El segundo problema es de identidad: si la misma persona aparece tres veces en la conversación y cada ocurrencia se vuelve un marcador distinto, el modelo ve tres personas diferentes y la coherencia de la respuesta se derrumba. El marcador debe ser estable dentro del alcance de la conversación, es decir, el mismo valor de entrada mapea siempre a la misma etiqueta mientras esa sesión dure.',
        },
        {
          type: 'paragraph',
          value:
            'Esa estabilidad tiene un límite fácil de cruzar sin darse cuenta. Si el marcador se deriva de un hash determinista del valor, y ese hash es el mismo entre sesiones y entre clientes, se vuelve un seudónimo persistente: quien tenga acceso a los logs puede correlacionar todas las conversaciones del mismo documento a lo largo del tiempo, aun sin ver nunca el número. Eso deja de ser anonimización y pasa a ser seudonimización, que sigue siendo dato personal a efectos regulatorios. La elección correcta depende del objetivo: si necesitas correlacionar, usa un hash con sal por tenant y trata el resultado como dato sensible; si no lo necesitas, genera el marcador a partir de un contador por petición, que muere con ella y no correlaciona nada. En la duda, el contador es la opción más defendible.',
        },
        {
          type: 'table',
          columns: ['Estrategia de marcador', 'Correlaciona entre sesiones', 'Cuándo usar'],
          rows: [
            [
              'Contador por petición',
              'No, el mapa muere con la petición',
              'Estándar: máxima protección, el modelo solo necesita coherencia interna',
            ],
            [
              'Hash con sal por tenant',
              'Sí, dentro del tenant',
              'Cuando el análisis necesita ligar conversaciones del mismo cliente sin ver el dato',
            ],
            [
              'Hash global sin sal',
              'Sí, entre tenants y para siempre',
              'Nunca: es seudónimo permanente y sigue siendo dato personal',
            ],
            [
              'Franja genérica sin tipo',
              'No, pero destruye la estructura',
              'Solo cuando la respuesta no depende de distinguir los campos',
            ],
          ],
        },
        {
          type: 'code',
          value: `// redact.js
// Marcador TIPADO (el modelo sabe que es un documento) y ESTABLE dentro de
// la peticion (la misma persona no se vuelve tres personas distintas).
// El mapa de vuelta vive solo en la memoria de esta peticion.

import { detect } from './detect.js';

export function createRedactionScope() {
  const toPlaceholder = new Map(); // valor real -> marcador
  const toValue = new Map();       // marcador -> valor real
  const counters = new Map();      // tipo -> proximo numero

  function placeholderFor(type, value) {
    const existing = toPlaceholder.get(value);
    if (existing) return existing; // estabilidad: mismo valor, misma etiqueta
    const n = (counters.get(type) || 0) + 1;
    counters.set(type, n);
    const token = '[' + type + '_' + n + ']';
    toPlaceholder.set(value, token);
    toValue.set(token, value);
    return token;
  }

  return {
    redact(text) {
      let out = text;
      for (const { type, value } of detect(text)) {
        // split/join cambia TODAS las ocurrencias sin interpretar regex.
        out = out.split(value).join(placeholderFor(type, value));
      }
      return out;
    },
    // Rehidrata la respuesta del modelo cambiando marcador por valor.
    rehydrate(text) {
      let out = text;
      for (const [token, value] of toValue) out = out.split(token).join(value);
      return out;
    },
    // Nada se persiste: el alcance muere al final de la peticion.
    size() {
      return toValue.size;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'Rehidratar la respuesta sin devolver lo que el modelo no debería saber',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La anonimización solo es utilizable si la respuesta vuelve legible para el cliente. El modelo recibió un texto con etiquetas y responde con las mismas etiquetas, y la capa de salida cambia cada una por el valor original antes de entregar. Esto funciona porque el mapa de vuelta nunca salió de tu proceso. El punto delicado es el alcance de ese mapa: pertenece a la petición y a la identidad de quien la hizo, y rehidratar un marcador con el valor de otra sesión sería una filtración cruzada mucho peor que la original. En la práctica eso significa nunca guardar el mapa en un cache compartido con clave previsible, nunca reutilizarlo entre usuarios y destruirlo al final del ciclo, incluso en caso de error.',
        },
        {
          type: 'paragraph',
          value:
            'La rehidratación también necesita un freno contra el marcador inventado. El modelo puede devolver una etiqueta que nunca emitiste, sea por alucinación, sea porque alguien plantó un texto con formato de marcador en el contenido recuperado por el RAG. Si tu función de cambio acepta cualquier cosa que parezca un marcador, se vuelve un oráculo: basta que el atacante escriba la etiqueta correcta en el mensaje para recibir de vuelta el valor real de otro campo. El tratamiento correcto es aceptar solo los marcadores que ese alcance emitió y dejar los demás intactos, además de registrar la ocurrencia, porque un marcador desconocido en la salida es señal de alucinación o de intento de inyección, y vale investigar en los dos casos.',
        },
        {
          type: 'diagram',
          value: `Ciclo de anonimizacion reversible

  entrada del cliente
    "mi documento es 529.982.247-25, pedido 11223344"
        |
        v
  [detect] la regex halla candidato -> el validador confirma
        |   (11223344 no pasa isCpf: queda intacto)
        v
  [redact] "mi documento es [CPF_1], pedido 11223344"
        |
        |  mapa { [CPF_1] -> 529.982.247-25 }  (solo en memoria de la peticion)
        v
  ============ FRONTERA: aqui sale de tu red ============
        |
        v
  proveedor de LLM  (log, cache de prompt, muestra)
        |   nunca vio el documento real
        v
  respuesta "confirme el [CPF_1] en el pedido 11223344"
        |
        v
  [rehydrate] solo cambia marcadores que ESTE alcance emitio
        |   marcador desconocido -> se mantiene y se registra alerta
        v
  "confirme el 529.982.247-25 en el pedido 11223344"  -> cliente`,
        },
      ],
    },
    {
      title: 'No todo dato debe volver: minimizar antes de anonimizar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La capa de anonimización es la última línea, no la primera. Antes de preguntar cómo esconder un dato, vale preguntar por qué está en el prompt. Mucha PII llega al modelo porque alguien armó el contexto con un volcado del registro en vez de con los campos que la tarea exige. Si el bot necesita decir si el pedido fue entregado, necesita el estado, no la dirección completa. Si necesita confirmar identidad, necesita saber que la confirmación coincidió, no el documento entero. Cambiar el expediente por un resumen derivado corta la exposición en el origen y reduce tokens de regalo, y lo que no entra en el prompt no depende de que el detector funcione.',
        },
        {
          type: 'ordered',
          items: [
            'Revisa qué lleva el contexto: lista los campos que entran en el prompt y marca cuáles usa realmente la tarea para producir la respuesta.',
            'Sustituye dato por veredicto: en vez de mandar el documento para que el modelo compare, haz la comparación en tu código y manda solo si coincidió o no.',
            'Prefiere referencia a valor: manda el identificador interno del pedido y deja que el modelo pida detalles vía tool, con la tool devolviendo ya el campo mínimo.',
            'Trata el retorno de tool como fuente de PII: anonimiza el resultado antes de concatenarlo al contexto, con el mismo alcance de la petición.',
            'Limpia el corpus del RAG en la ingesta: el fragmento recuperado entra al prompt como cualquier otro texto, y la PII indexada se filtra en toda consulta que la recupere.',
            'Solo entonces anonimiza lo que quedó: la capa de detección se encarga del residuo, no del volumen principal.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Existe un caso en que anonimizar no basta y la respuesta correcta es no mandar: dato que el modelo no necesita y cuya sola presencia ya viola un contrato o una norma sectorial, como dato de salud en un sistema sin base legal para tratarlo con terceros, o credencial de cualquier tipo. Para esos, la política no es sustituir por marcador, es bloquear la llamada y devolver un camino alternativo, exactamente como un guardrail de salida bloquea una acción peligrosa. Mezclar las dos políticas en la misma función es un error común: la de anonimizar quiere dejar que la llamada siga, la de bloquear quiere interrumpirla, y la segunda debe ser explícita para no ser silenciosamente degradada a la primera.',
        },
      ],
    },
    {
      title: 'Probar que no se filtró: el test que falla con dato real en el payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una capa de anonimización sin test es una suposición. Se rompe de formas discretas: alguien agrega un campo nuevo al contexto y olvida pasarlo por el redactor, una refactorización cambia el orden y el dato se concatena después de la anonimización, un proveedor nuevo se integra por un camino que no pasa por la capa. Ninguna de esas fallas genera un error visible, porque la llamada sigue funcionando y la respuesta sigue siendo buena. La única forma de atraparlo es invertir la aserción: en vez de probar que el redactor funciona aisladamente, prueba que el payload final, el objeto exacto que va a la red, no contiene ninguno de los valores sensibles del caso. Ese test vive en el punto más externo posible, idealmente en un doble del cliente HTTP que captura el cuerpo enviado.',
        },
        {
          type: 'code',
          value: `// pii-leak.test.js
// La asercion es sobre el PAYLOAD QUE SALE, no sobre la funcion de redactar.
// Asi el test atrapa el campo nuevo que alguien olvido anonimizar.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPayload } from '../src/build-payload.js';

const SENSITIVE = {
  cpf: '529.982.247-25',
  email: 'cliente@ejemplo.com',
  card: '4111 1111 1111 1111',
};

test('ningun dato sensible atraviesa la frontera de red', () => {
  const payload = buildPayload({
    userMessage: 'mi documento es ' + SENSITIVE.cpf + ' y la tarjeta ' + SENSITIVE.card,
    history: [{ role: 'user', content: 'mandalo a ' + SENSITIVE.email }],
    toolResults: [{ name: 'getOrder', content: JSON.stringify({ email: SENSITIVE.email }) }],
  });

  // Serializa TODO lo que sale: ningun campo escapa a la verificacion.
  const wire = JSON.stringify(payload);

  for (const [label, value] of Object.entries(SENSITIVE)) {
    assert.ok(!wire.includes(value), 'se filtro ' + label + ' en el payload');
    // Tambien sin formato: el dato puede salir solo con digitos.
    const digits = value.replace(/\\D/g, '');
    if (digits.length >= 8) {
      assert.ok(!wire.includes(digits), 'se filtro ' + label + ' sin formato');
    }
  }

  // El marcador debe estar ahi: anonimizar no puede volverse borrar.
  assert.match(wire, /\\[CPF_1\\]/);
});

test('un numero que no es documento no se vuelve marcador', () => {
  const payload = buildPayload({ userMessage: 'pedido 11223344', history: [], toolResults: [] });
  assert.match(JSON.stringify(payload), /11223344/);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Vale medir la capa en producción también, con dos señales baratas. La primera es el conteo de marcadores emitidos por petición, desglosado por tipo: una caída súbita a cero en un tipo que siempre aparecía significa que el detector dejó de funcionar, probablemente por un cambio de formato en el origen. La segunda es la tasa de marcador desconocido en la rehidratación, que debería ser prácticamente nula: cualquier subida indica alucinación del modelo o intento de inyección por el contenido recuperado. Junto con el test de payload en el CI, esos dos números transforman la anonimización de promesa en propiedad verificable, que es la única forma de sostenerla a lo largo del tiempo mientras el sistema cambia.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no basta con una expresión regular para detectar dato personal?',
      answer:
        'Porque la expresión regular se equivoca en los dos sentidos y cada error tiene un costo distinto. En el falso positivo, una secuencia de once dígitos que era número de protocolo se vuelve marcador de documento, y el modelo pierde exactamente la información que necesitaba para responder, degradando la calidad sin que nadie asocie la causa. En el falso negativo, el cliente escribe el documento en un formato que la expresión no previó y el dato atraviesa la frontera intacto. La corrección es separar las dos etapas: la expresión encuentra el candidato por la forma y un validador específico del tipo confirma el contenido, dígito verificador para documento e identificador de empresa, algoritmo de Luhn para tarjeta. Para dato sin estructura verificable, como nombre y dirección en texto corrido, la salida es anonimizar por origen, cuando el campo viene de una tool call conocida, y minimizar lo que entra al prompt, porque lo que no entra no necesita ser detectado.',
    },
    {
      question: '¿El marcador debe ser siempre el mismo para el mismo dato?',
      answer:
        'Dentro de la petición, sí, y esa estabilidad es obligatoria: si la misma persona aparece tres veces en la conversación y cada ocurrencia se vuelve un marcador distinto, el modelo ve tres personas diferentes y la coherencia de la respuesta se derrumba. Entre peticiones, la respuesta estándar es no. Un marcador derivado de un hash determinista del valor, igual entre sesiones y clientes, se vuelve un seudónimo permanente: quien tenga acceso a los logs puede correlacionar todas las conversaciones del mismo documento a lo largo del tiempo sin ver nunca el número, lo que sigue siendo dato personal a efectos regulatorios. Generar el marcador a partir de un contador por petición, con un mapa que muere junto con ella, da la coherencia que el modelo necesita sin crear correlación alguna. Si el análisis realmente exige ligar conversaciones del mismo cliente, usa hash con sal por tenant y trata el resultado como dato sensible.',
    },
    {
      question: '¿Cómo garantizar en la práctica que ningún dato real se está filtrando?',
      answer:
        'Invirtiendo la aserción del test. Probar que la función de anonimizar funciona aisladamente no atrapa la falla más común, que es un campo nuevo agregado al contexto por un camino que no pasa por la capa, o una refactorización que concatena el dato después de la anonimización. El test que lo atrapa serializa el payload final, el objeto exacto que va a la red, y afirma que no contiene ninguno de los valores sensibles del caso, ni en forma con formato ni solo con los dígitos. Debe correr en el punto más externo posible, en un doble del cliente HTTP que captura el cuerpo enviado, y fallar el build cuando algo se escapa. En producción, complementa con dos señales: el conteo de marcadores emitidos por tipo, cuya caída súbita a cero delata un detector roto, y la tasa de marcador desconocido en la rehidratación, cuya subida indica alucinación o intento de inyección por el contenido recuperado.',
    },
  ],
  conclusion: {
    title: 'El dato que nunca entró al prompt no se filtra en ningún lado',
    description:
      'El prompt que sale de tu servidor lleva mucho más que el mensaje actual: historial completo, retorno de tool, fragmento de RAG y system prompt, y cada uno de esos caminos lleva dato personal a logs, caches y muestras de monitoreo que nunca fueron diseñados como caja fuerte. Minimizar primero y anonimizar el residuo después, con detección validada en vez de solo regex, marcador tipado y estable dentro de la petición, rehidratación restringida al alcance que la emitió y un test que falla cuando el valor real aparece en el payload, transforma la privacidad de promesa en propiedad verificable. Puedo diseñar e implementar esa capa en tu sistema con LLM, de la minimización del contexto al test de filtración en el CI, para que el dato de tu cliente pare en tu red en vez de atravesar la frontera sin necesidad.',
    cta: 'Hablar sobre anonimización en mi sistema con LLM',
  },
  related: [
    { label: 'Prompt injection en RAG: defender el contexto recuperado', to: '/blog/prompt-injection-rag-defender-contexto-recuperado' },
    { label: 'Guardrails de salida en LLM: validacion y rechazo seguro', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Checklist de seguridad para integraciones de Meta y WhatsApp', to: '/blog/seguranca-integracoes-meta-whatsapp' },
  ],
  repo: { name: 'llm-pii-redaction-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
