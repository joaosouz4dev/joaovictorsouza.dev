// Conteudo do artigo: trilha de auditoria em agente de IA.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Trilha de auditoria append-only para agentes de IA: registra a decisão como unidade, encadeia cada evento ao anterior por hash, sela o lote com um resumo verificável, aplica redação de dado pessoal antes da gravação e traz um verificador que aponta em qual posição a cadeia foi rompida.',
  en: 'Append-only audit trail for AI agents: records the decision as the unit, chains each event to the previous one by hash, seals the batch with a verifiable digest, applies personal data redaction before writing and ships a verifier that pinpoints where the chain was broken.',
  es: 'Traza de auditoría append-only para agentes de IA: registra la decisión como unidad, encadena cada evento al anterior por hash, sella el lote con un resumen verificable, aplica redacción de dato personal antes de escribir y trae un verificador que señala en qué posición se rompió la cadena.',
};

const repoUrl = 'https://github.com/joaosouz4dev/ai-decision-audit-trail';

const pt = {
  intro:
    'Um cliente reclama que o bot negou o reembolso dele, e a pergunta que chega ao time não é técnica: por que negou. Você abre o log, encontra a linha da chamada ao modelo, o tempo de resposta, a contagem de tokens, o status duzentos, e nada disso responde. O log de aplicação registra que a decisão aconteceu, não o que a sustentou. Trilha de auditoria é a disciplina de gravar, no momento em que a decisão é tomada, tudo que seria necessário para reconstituí-la meses depois diante de alguém que não confia na sua palavra: qual regra aplicou, qual dado o agente leu, qual versão de prompt e de modelo estava em vigor, qual ferramenta executou e com qual resultado. Este artigo mostra como montar essa trilha sem transformar o sistema em um depósito de dado pessoal: qual é a unidade certa de registro, o que precisa entrar em cada evento, como encadear os eventos por hash para que uma edição posterior seja detectável, como reduzir o dado sensível antes da gravação e como sair da reclamação até o evento concreto em minutos.',
  sections: [
    {
      title: 'Log de aplicação não é trilha de auditoria',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois escrevem linhas em disco e é por isso que a confusão sobrevive tanto tempo. A diferença aparece na primeira pergunta séria. O log de aplicação existe para o engenheiro entender por que o sistema quebrou, é otimizado para volume e custo, tem retenção curta, é reescrito com liberdade em cada refactor e ninguém se importa se um campo mudou de nome entre duas versões. A trilha de auditoria existe para provar a terceiros o que o sistema decidiu, precisa sobreviver a anos, não pode ser reescrita depois do fato e o formato dela é um contrato tão sério quanto o de uma API pública.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática de tratar um como outro é sempre a mesma: no dia em que a pergunta chega, o log existe, tem gigabytes, e não responde. Ele tem a duração da chamada mas não o texto da política aplicada, tem o id da requisição mas não o id da versão do prompt, tem a mensagem de erro mas não os documentos que o agente leu antes de responder. E, mais grave, ele pode ter sido alterado: se qualquer pessoa com acesso ao banco pode fazer um update numa linha de log, aquela linha não prova nada em uma discussão em que a boa fé está sendo questionada.',
        },
        {
          type: 'table',
          columns: ['Dimensão', 'Log de aplicação', 'Trilha de auditoria'],
          rows: [
            [
              'Pergunta que responde',
              'Por que o sistema quebrou',
              'Por que o sistema decidiu assim',
            ],
            [
              'Leitor',
              'Quem escreveu o código',
              'Jurídico, cliente, auditor, regulador',
            ],
            [
              'Retenção típica',
              'De sete a trinta dias',
              'De um a cinco anos, conforme o contrato',
            ],
            [
              'Mutabilidade',
              'Livre, ninguém acompanha mudança de campo',
              'Append-only, alteração precisa ser detectável',
            ],
            [
              'Esquema',
              'Informal, evolui a cada deploy',
              'Versionado, mudança quebrando exige migração',
            ],
            [
              'Amostragem',
              'Aceitável e comum sob carga',
              'Proibida, decisão amostrada é decisão não registrada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha de amostragem é a que mais surpreende times que vêm de observabilidade. Descartar noventa por cento dos traces sob carga é uma prática correta e barata quando o objetivo é achar gargalo, porque a estatística sobrevive à amostra. Ela é indefensável em auditoria, porque a decisão que vai ser questionada é justamente uma, e a chance de ela estar entre as descartadas é de noventa por cento. Trilha de auditoria grava cem por cento das decisões ou não é trilha, e é por isso que ela precisa ser desenhada para custar pouco por evento em vez de ser desligada quando o volume sobe.',
        },
      ],
    },
    {
      title: 'A unidade de registro é a decisão, não a chamada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A escolha da unidade define se a trilha vai responder ou não. Registrar por chamada ao modelo parece natural porque é onde o dinheiro é gasto, mas produz uma trilha em que ninguém consegue navegar: um único atendimento gera doze chamadas, das quais oito são de classificação e reformulação, e a pergunta do cliente não é sobre nenhuma delas. Registrar por turno de conversa é melhor e ainda insuficiente, porque um turno pode conter várias decisões independentes e porque muitas decisões relevantes acontecem sem nenhuma mensagem do cliente por perto, como uma reprocessamento noturno.',
        },
        {
          type: 'paragraph',
          value:
            'A unidade que funciona é a decisão: um ponto do fluxo em que o sistema escolheu entre alternativas e essa escolha produziu efeito visível para alguém de fora. Aprovar ou negar reembolso é decisão. Transbordar para humano é decisão. Escolher não executar uma ferramenta por falta de permissão é decisão. Chamar o modelo para reescrever uma frase não é decisão, é passo. Passos entram na trilha como evidência anexada à decisão que eles sustentaram, não como registros de primeira classe com vida própria.',
        },
        {
          type: 'list',
          items: [
            'Toda decisão recebe um identificador próprio, estável e derivado do conteúdo, para poder ser citada em um ticket sem ambiguidade.',
            'Toda decisão carrega o identificador da conversa e o do cliente, para que a busca a partir da reclamação chegue nela sem varredura.',
            'Os passos que a sustentaram apontam para o identificador da decisão, e não o contrário, porque a decisão é o que alguém vai procurar.',
            'Uma decisão revertida depois não sobrescreve a original: ela é um novo evento que referencia o anterior, preservando a sequência real dos fatos.',
            'Decisões automáticas e decisões humanas usam o mesmo esquema, mudando só o campo que identifica quem decidiu, porque a reclamação não distingue as duas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última regra é a que evita a armadilha mais cara. Times costumam construir a trilha só para o que a IA decide, e quando o caso escala descobrem que o pedaço humano do fluxo, justamente o que reverteu a decisão do bot, não deixou rastro nenhum. Se o supervisor aprovou manualmente um reembolso que o agente havia negado, esse é o evento mais importante da história inteira, e ele precisa estar na mesma sequência, com o mesmo formato, com a mesma garantia de integridade.',
        },
      ],
    },
    {
      title: 'O que precisa entrar para a decisão ser reconstituível',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O critério para escolher os campos é direto e implacável: um leitor que não tem acesso ao seu banco de produção, lendo o evento daqui a dois anos, consegue entender o que foi decidido e por quê. Se qualquer resposta exige abrir outra fonte que talvez não exista mais, o campo está faltando. Isso não significa gravar tudo, significa gravar o suficiente e apontar de forma estável para o resto.',
        },
        {
          type: 'table',
          columns: ['Campo', 'Por que é obrigatório', 'O que quebra sem ele'],
          rows: [
            [
              'decision_id',
              'Referência estável para citar em ticket e em processo',
              'A discussão vira "aquele atendimento de terça"',
            ],
            [
              'outcome e reason_code',
              'O que foi decidido e sob qual regra codificada',
              'Sobra texto livre que ninguém consegue agregar nem comparar',
            ],
            [
              'policy_version',
              'A regra de hoje não é a regra que valia na data',
              'Você julga a decisão passada pelo critério atual',
            ],
            [
              'prompt_version e model_id',
              'Identifica o comportamento exato que produziu a saída',
              'Não dá para reproduzir nem para delimitar o alcance do bug',
            ],
            [
              'inputs_digest',
              'Prova quais dados o agente tinha na hora, sem copiá-los',
              'Não se distingue erro de decisão de dado desatualizado',
            ],
            [
              'evidence_refs',
              'Ponteiro imutável para os trechos e registros consultados',
              'A justificativa vira alegação sem lastro verificável',
            ],
            [
              'actor',
              'Diz se decidiu o agente, uma regra fixa ou uma pessoa',
              'Responsabilidade fica difusa exatamente quando importa',
            ],
            [
              'occurred_at e recorded_at',
              'Separa quando o fato ocorreu de quando foi gravado',
              'Reprocessamento tardio parece adulteração de data',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O par inputs_digest e evidence_refs é o que dá densidade à trilha sem inchá-la. Em vez de copiar os cinco trechos de base de conhecimento dentro do evento, você grava o hash do conjunto de entradas e a referência imutável de cada trecho, com o identificador do documento e o da revisão. Isso responde as duas perguntas que aparecem em toda apuração séria: o agente tinha esse dado na hora, e o texto que ele leu era este. E responde mesmo que o documento tenha sido editado depois, contanto que suas revisões sejam preservadas, o que é uma exigência que a trilha impõe ao resto do sistema e que vale a pena assumir explicitamente.',
        },
        {
          type: 'paragraph',
          value:
            'O reason_code merece disciplina de esquema fechado. Texto livre gerado pelo modelo como justificativa é útil para o cliente ler e inútil para a operação, porque não agrega: mil justificativas ligeiramente diferentes para o mesmo motivo impedem qualquer contagem. Um código enumerado, definido pelo produto e não pelo modelo, permite responder quantas negativas de reembolso foram por prazo excedido no trimestre, que é a pergunta que efetivamente muda o produto. Guarde os dois, o código para agregar e o texto para explicar, e trate divergência entre eles como defeito.',
        },
      ],
    },
    {
      title: 'Encadeamento por hash: tornar a edição posterior detectável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Append-only por convenção não é append-only. Enquanto a tabela aceitar update, a trilha vale exatamente a confiança que se tem em quem tem acesso ao banco, e o argumento "ninguém alteraria" perde a força na hora exata em que a trilha é necessária, que é a hora em que alguém está sendo acusado de algo. A solução não exige blockchain nem serviço externo: basta encadear cada evento ao anterior por hash, de forma que alterar um registro passado invalide todos os posteriores.',
        },
        {
          type: 'paragraph',
          value:
            'A ideia é a de uma lista ligada criptográfica. Cada evento carrega o hash do evento anterior, e o hash de um evento cobre tanto o seu conteúdo canônico quanto esse elo. Editar o evento número quarenta muda o hash dele, o que quebra o elo do quarenta e um, que quebra o do quarenta e dois, e assim por diante até o fim da sequência. Quem quiser adulterar precisa reescrever toda a cauda, e é aí que entra a segunda peça: selar periodicamente a ponta da cadeia em um lugar fora do alcance de quem escreve, como um objeto com bloqueio de retenção ou um repositório separado com credencial distinta. Selar de hora em hora reduz a janela de adulteração indetectável a uma hora, o que costuma ser suficiente.',
        },
        {
          type: 'code',
          value: `// audit/chain.js
// Trilha append-only encadeada por hash.
// Cada evento carrega o hash do anterior; editar um evento passado
// invalida a cadeia inteira a partir dele.

import { createHash } from 'node:crypto';

const GENESIS = '0'.repeat(64);

/**
 * Serializacao canonica: chaves ordenadas em qualquer profundidade.
 * Sem isso, dois processos gravam o mesmo evento com hashes diferentes
 * e a verificacao acusa adulteracao onde so houve ordem de chave.
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return \`[\${value.map(canonical).join(',')}]\`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`);
  return \`{\${entries.join(',')}}\`;
}

export function hashEntry(entry) {
  return createHash('sha256').update(canonical(entry), 'utf8').digest('hex');
}

export function createAuditChain({ store, redact = (x) => x, now }) {
  if (typeof now !== 'function') throw new Error('now precisa ser uma funcao');

  /**
   * Grava uma decisao. O payload passa por redacao ANTES do hash,
   * para que o hash cubra exatamente o que foi persistido.
   */
  async function append(decision) {
    const previous = await store.last();
    const prevHash = previous ? previous.hash : GENESIS;
    const seq = previous ? previous.seq + 1 : 0;

    const body = {
      seq,
      schema: 'decision.v1',
      decision_id: decision.decisionId,
      conversation_id: decision.conversationId,
      subject_id: decision.subjectId,
      actor: decision.actor,              // 'agent' | 'rule' | 'human:<id>'
      outcome: decision.outcome,
      reason_code: decision.reasonCode,   // enumerado, nao texto livre
      policy_version: decision.policyVersion,
      prompt_version: decision.promptVersion,
      model_id: decision.modelId,
      inputs_digest: hashEntry(decision.inputs),
      evidence_refs: decision.evidenceRefs,
      payload: redact(decision.payload),
      occurred_at: decision.occurredAt,
      recorded_at: new Date(now()).toISOString(),
      prev_hash: prevHash,
    };

    const record = { ...body, hash: hashEntry(body) };
    await store.append(record);         // INSERT apenas: sem UPDATE, sem DELETE
    return record;
  }

  /** Recalcula a cadeia e aponta a primeira posicao rompida. */
  async function verify({ from = 0, expectedHead } = {}) {
    let prevHash = from === 0 ? GENESIS : (await store.at(from - 1))?.hash;
    if (!prevHash) return { ok: false, brokenAt: from, reason: 'ancora ausente' };

    let last = null;
    for await (const record of store.stream(from)) {
      const { hash, ...body } = record;
      if (body.prev_hash !== prevHash) {
        return { ok: false, brokenAt: body.seq, reason: 'elo rompido' };
      }
      if (hashEntry(body) !== hash) {
        return { ok: false, brokenAt: body.seq, reason: 'conteudo alterado' };
      }
      prevHash = hash;
      last = record;
    }

    // O selo externo prova que a cauda nao foi reescrita inteira.
    if (expectedHead && last?.hash !== expectedHead) {
      return { ok: false, brokenAt: last?.seq ?? from, reason: 'divergencia com o selo' };
    }
    return { ok: true, head: last?.hash ?? prevHash, count: (last?.seq ?? -1) + 1 };
  }

  return { append, verify };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Três decisões nesse código são as que separam uma implementação que funciona de uma que dá falso alarme. A serialização canônica com chaves ordenadas evita que dois processos gravem o mesmo evento com hashes diferentes só porque a ordem das chaves do objeto variou, algo que transforma a verificação em uma fonte constante de alerta falso. A redação acontece antes do cálculo do hash, para que ele cubra exatamente o que ficou persistido, e não uma versão que nunca existiu em disco. E a verificação retorna a posição exata do rompimento em vez de um booleano, porque saber que a cadeia quebrou sem saber onde não permite nenhuma investigação útil.',
        },
        {
          type: 'diagram',
          value: `evento 40            evento 41            evento 42
+-------------+      +-------------+      +-------------+
| prev: H39   |      | prev: H40   |      | prev: H41   |
| body ...    |      | body ...    |      | body ...    |
| hash: H40   |----->| hash: H41   |----->| hash: H42   |
+-------------+      +-------------+      +-------------+
       |                                         |
       | edita o body do 40                      | selo horario
       v                                         v
   H40 muda  =>  o elo do 41 nao bate       objeto com retencao
   verify() retorna brokenAt: 41            (credencial separada)`,
        },
      ],
    },
    {
      title: 'Registrar sem virar depósito de dado pessoal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma tensão real entre auditoria e minimização de dados, e ignorá-la produz um dos dois desastres. De um lado, a trilha que guarda a conversa inteira por cinco anos vira o maior repositório de dado pessoal da empresa, com retenção longa por desenho e apagamento difícil porque a imutabilidade é justamente o ponto. Do outro, a trilha que não guarda nada de identificável não consegue nem localizar a decisão do cliente que reclamou.',
        },
        {
          type: 'paragraph',
          value:
            'A saída é separar o que precisa ser provado do que precisa ser lido. O que precisa ser provado entra como hash: o digest das entradas prova que o agente tinha aquele conjunto de dados sem copiá-los para dentro do evento. O que precisa ser lido entra por referência: o identificador do documento e o da revisão apontam para o texto que vive no seu lugar de origem, com o ciclo de vida dele. E o que precisa apenas identificar a pessoa entra como pseudônimo estável por sujeito, que permite achar todas as decisões daquele cliente sem espalhar documento e telefone por milhões de linhas.',
        },
        {
          type: 'ordered',
          items: [
            'Defina o esquema campo a campo declarando a classificação de cada um: identificador, dado pessoal, dado sensível ou metadado técnico.',
            'Aplique a redação antes da gravação, no mesmo ponto em que o hash é calculado, para que nenhum caminho de código consiga escrever o valor cru.',
            'Use um pseudônimo estável por sujeito no lugar do documento e do contato, mantendo o mapa reversível em um cofre separado com acesso auditado.',
            'Guarde o texto da justificativa com prazo mais curto que o do restante do evento, porque ele é o campo com maior chance de conter dado pessoal livre.',
            'Trate o pedido de exclusão pela via da cripto-exclusão: apague a chave do sujeito no cofre em vez de editar eventos, preservando a cadeia intacta.',
            'Escreva um teste que falha se um valor sensível conhecido aparecer em qualquer campo do evento serializado, e rode-o com os dados de exemplo do domínio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A cripto-exclusão é o ponto que costuma travar a conversa com o jurídico e o que a destrava de vez quando explicado. Como a cadeia não permite apagar um evento sem quebrar a integridade de tudo que veio depois, o campo sensível é guardado cifrado com uma chave por sujeito, e o pedido de exclusão apaga essa chave. O evento continua lá, a cadeia continua íntegra, o hash continua conferindo, e o conteúdo cifrado se torna permanentemente ilegível. Você preserva a capacidade de provar que a decisão existiu e o encadeamento que a torna confiável, sem preservar o dado que não pode mais ser retido.',
        },
      ],
    },
    {
      title: 'Da reclamação ao evento: a trilha precisa responder rápido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma trilha completa que leva dois dias para produzir uma resposta falha no objetivo. O caminho da pergunta até a evidência é parte do desenho, não um detalhe operacional deixado para depois, e é a diferença entre um sistema auditável e um sistema que teoricamente registra tudo. Na prática, a pergunta chega sempre pela mesma porta: um identificador de cliente, uma data aproximada e uma descrição em português do que incomodou.',
        },
        {
          type: 'paragraph',
          value:
            'Isso define os índices antes de qualquer outra otimização: por sujeito com data, por conversa e por código de motivo com data. Com esses três, a busca sai da descrição vaga para a decisão concreta em segundos. Sem eles, você tem uma trilha íntegra dentro de um armazenamento que só permite varredura, e a resposta chega quando o cliente já foi embora. Vale também expor a leitura como uma consulta pronta para o time de atendimento em vez de exigir acesso ao banco, porque trilha que só o engenheiro consegue ler acaba não sendo consultada.',
        },
        {
          type: 'code',
          value: `// audit/query.js
// Caminho da reclamacao ate a evidencia, no formato em que a pergunta chega.

export function createAuditQuery({ store, chain, vault }) {
  /**
   * Reconstitui uma decisao: o evento, a verificacao de integridade do
   * trecho da cadeia que o contem e as evidencias resolvidas.
   */
  async function explain(decisionId, { reveal = false, requestedBy } = {}) {
    const record = await store.findByDecisionId(decisionId);
    if (!record) return { found: false };

    // Verifica so a janela relevante: verificar a cadeia inteira a cada
    // consulta e caro e desnecessario para responder uma reclamacao.
    const integrity = await chain.verify({ from: Math.max(0, record.seq - 500) });

    const evidence = await Promise.all(
      record.evidence_refs.map((ref) => store.resolveEvidence(ref)),
    );

    // O dado cifrado so e aberto sob pedido explicito e o acesso
    // entra na propria trilha como um novo evento.
    const sensitive = reveal
      ? await vault.decrypt(record.subject_id, record.payload.sealed)
      : null;
    if (reveal) {
      await store.appendAccessLog({
        decision_id: decisionId,
        requested_by: requestedBy,
        at: record.recorded_at,
      });
    }

    return {
      found: true,
      decision: {
        outcome: record.outcome,
        reasonCode: record.reason_code,
        actor: record.actor,
        occurredAt: record.occurred_at,
        policyVersion: record.policy_version,
        promptVersion: record.prompt_version,
        modelId: record.model_id,
      },
      evidence,
      sensitive,
      integrity,
    };
  }

  /** Busca pela porta real: cliente e janela de tempo. */
  function findBySubject(subjectId, { from, to, reasonCode } = {}) {
    return store.query({ subjectId, from, to, reasonCode });
  }

  return { explain, findBySubject };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o próprio acesso ao dado sensível gera um evento. Essa é uma exigência recorrente em auditoria e ela é barata quando a trilha já existe: quem abriu o conteúdo cifrado de qual cliente e quando é exatamente o tipo de pergunta que aparece depois, e responder com "não registramos" é pior do que não ter a funcionalidade. Repare também que a verificação de integridade cobre uma janela em torno do evento e não a cadeia inteira, porque verificar milhões de registros a cada consulta é um custo que na prática leva o time a desligar a verificação, e verificação desligada é o mesmo que não ter.',
        },
        {
          type: 'list',
          items: [
            'Meça o tempo entre a chegada da pergunta e a apresentação da evidência, e trate esse número como métrica de produto da trilha.',
            'Rode a verificação completa da cadeia em lote fora do horário de pico e alerte com a posição exata do rompimento, não com um booleano.',
            'Exercite a trilha com uma pergunta real por semana, escolhida entre casos encerrados, para descobrir campo faltante antes que ele faça falta.',
            'Compare a contagem de decisões da trilha com a contagem de resultados no banco operacional, porque divergência silenciosa significa decisão não registrada.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de blockchain para a trilha ser confiável?',
      answer:
        'Não, e na maioria dos casos ela atrapalha mais do que ajuda. O que a auditoria exige é que uma alteração posterior seja detectável, e isso é resolvido por encadeamento de hash mais um selo periódico fora do alcance de quem escreve, como um objeto com bloqueio de retenção ou um repositório com credencial separada. Blockchain resolve um problema diferente: consenso entre partes que não confiam umas nas outras e não têm autoridade comum. Na relação entre uma empresa e seus clientes, existe autoridade comum, existe contrato e existe auditor, então o custo operacional, a latência e a exposição de dados de uma cadeia distribuída não compram garantia adicional relevante. A pergunta que separa os dois casos é simples: quem precisa ser convencido de que o registro não foi alterado. Se a resposta é o auditor, o cliente ou o regulador, o encadeamento com selo externo já basta e é ordens de grandeza mais barato de operar.',
    },
    {
      question: 'Como registrar tudo sem que o custo de armazenamento fique inviável?',
      answer:
        'Separando o evento pequeno e imutável do anexo grande e com ciclo de vida próprio. O evento de decisão bem desenhado tem entre um e dois kilobytes, porque ele guarda códigos, versões, hashes e referências, não textos. Um milhão de decisões por mês nesse formato ocupa poucos gigabytes por ano, um custo irrelevante mesmo com retenção de cinco anos. O que cresce sem controle é o instinto de anexar o prompt completo, a resposta completa e os trechos recuperados dentro do evento, e é justamente esse conteúdo que deve ficar fora, referenciado por hash e por identificador de revisão. Se o time realmente precisar guardar o corpo das chamadas para reproduzir um bug, guarde em armazenamento frio com retenção mais curta, tratando esse anexo como evidência opcional e não como parte do registro de auditoria, que continua íntegro mesmo depois que o anexo expira.',
    },
    {
      question: 'A trilha de auditoria substitui o log e o tracing que já existem?',
      answer:
        'Não, os três respondem perguntas diferentes e tentar unificá-los produz um artefato ruim nas três funções. O tracing responde onde o tempo foi gasto e é amostrado por desenho, o que é correto para performance e proibido em auditoria. O log responde por que quebrou, tem retenção curta e formato que muda a cada refactor, o que é aceitável para depuração e inaceitável para um registro que precisa ser lido daqui a três anos. A trilha responde por que decidiu assim, grava cem por cento das decisões, tem esquema versionado e integridade verificável. O que compensa compartilhar entre eles é o identificador de correlação: quando o evento de auditoria carrega o trace_id, o engenheiro que investiga uma decisão específica pula direto para o trace correspondente enquanto ele ainda existe, e ganha o detalhe técnico sem que a trilha precise carregá-lo.',
    },
  ],
  conclusion: {
    title: 'Sem trilha, a explicação da decisão é só a sua palavra',
    description:
      'O dia em que alguém questiona uma decisão do agente é o dia em que a trilha vale, e ela não pode ser construída naquele dia. O que separa uma resposta em minutos, com o motivo codificado, a versão da política em vigor e os documentos consultados, de uma reconstrução por aproximação a partir de logs incompletos é ter escolhido a decisão como unidade de registro, ter gravado o suficiente para reconstituí-la sem o banco de produção, ter encadeado os eventos para que a edição posterior apareça e ter reduzido o dado pessoal antes da gravação. Posso desenhar e implementar essa trilha no seu agente, do esquema de eventos à consulta que o time de atendimento usa.',
    cta: 'Falar sobre trilha de auditoria no meu agente',
  },
  related: [
    { label: 'Anonimização de dados antes de mandar para o LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Versionar prompt como código: rollout, rollback e teste', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-decision-audit-trail', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'A customer complains that the bot denied their refund, and the question that reaches the team is not technical: why did it deny. You open the log, find the line for the model call, the response time, the token count, the two hundred status, and none of it answers. The application log records that the decision happened, not what backed it. An audit trail is the discipline of writing down, at the moment the decision is made, everything needed to reconstruct it months later in front of someone who does not take your word for it: which rule applied, which data the agent read, which prompt and model version were in force, which tool ran and with what result. This article shows how to build that trail without turning the system into a personal data warehouse: which unit of record is the right one, what must go into each event, how to chain events by hash so a later edit becomes detectable, how to cut sensitive data before writing and how to go from the complaint to the concrete event in minutes.',
  sections: [
    {
      title: 'An application log is not an audit trail',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Both write lines to disk, and that is why the confusion survives so long. The difference shows up at the first serious question. The application log exists so the engineer can understand why the system broke, it is optimized for volume and cost, has short retention, is rewritten freely in every refactor and nobody minds if a field changed name between two releases. The audit trail exists to prove to third parties what the system decided, it must survive years, it cannot be rewritten after the fact and its format is a contract as serious as that of a public API.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence of treating one as the other is always the same: on the day the question arrives, the log exists, has gigabytes, and does not answer. It has the call duration but not the text of the policy applied, it has the request id but not the prompt version id, it has the error message but not the documents the agent read before answering. And, more seriously, it may have been altered: if anyone with database access can run an update on a log row, that row proves nothing in a discussion where good faith is what is being questioned.',
        },
        {
          type: 'table',
          columns: ['Dimension', 'Application log', 'Audit trail'],
          rows: [
            [
              'Question it answers',
              'Why the system broke',
              'Why the system decided this way',
            ],
            [
              'Reader',
              'Whoever wrote the code',
              'Legal, customer, auditor, regulator',
            ],
            [
              'Typical retention',
              'Seven to thirty days',
              'One to five years, per contract',
            ],
            [
              'Mutability',
              'Free, nobody tracks a field change',
              'Append-only, alteration must be detectable',
            ],
            [
              'Schema',
              'Informal, evolves on every deploy',
              'Versioned, a breaking change requires migration',
            ],
            [
              'Sampling',
              'Acceptable and common under load',
              'Forbidden, a sampled decision is an unrecorded decision',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The sampling row is the one that most surprises teams coming from observability. Dropping ninety percent of traces under load is correct and cheap practice when the goal is finding a bottleneck, because the statistics survive the sample. It is indefensible in auditing, because the decision that will be questioned is precisely one, and the chance it sits among the discarded ones is ninety percent. An audit trail records one hundred percent of decisions or it is not a trail, which is why it must be designed to cost little per event instead of being switched off when volume rises.',
        },
      ],
    },
    {
      title: 'The unit of record is the decision, not the call',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The choice of unit determines whether the trail will answer at all. Recording per model call feels natural because that is where the money goes, but it produces a trail nobody can navigate: a single support case generates twelve calls, eight of which are classification and rewriting, and the customer question is about none of them. Recording per conversation turn is better and still insufficient, because a turn can contain several independent decisions and because many relevant decisions happen with no customer message anywhere near, such as an overnight reprocessing job.',
        },
        {
          type: 'paragraph',
          value:
            'The unit that works is the decision: a point in the flow where the system chose among alternatives and that choice produced an effect visible to someone outside. Approving or denying a refund is a decision. Handing off to a human is a decision. Choosing not to run a tool for lack of permission is a decision. Calling the model to rewrite a sentence is not a decision, it is a step. Steps enter the trail as evidence attached to the decision they backed, not as first-class records with a life of their own.',
        },
        {
          type: 'list',
          items: [
            'Every decision gets its own identifier, stable and content-derived, so it can be cited in a ticket without ambiguity.',
            'Every decision carries the conversation and the customer identifiers, so the search starting from the complaint reaches it without a scan.',
            'The steps that backed it point to the decision identifier, not the other way around, because the decision is what someone will look for.',
            'A decision reversed later does not overwrite the original: it is a new event referencing the previous one, preserving the real sequence of facts.',
            'Automated and human decisions use the same schema, changing only the field that identifies who decided, because the complaint does not tell them apart.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last rule is the one that avoids the most expensive trap. Teams tend to build the trail only for what the AI decides, and when the case escalates they discover that the human part of the flow, precisely the one that reversed the bot decision, left no trace at all. If the supervisor manually approved a refund the agent had denied, that is the single most important event in the whole story, and it needs to be in the same sequence, with the same format, with the same integrity guarantee.',
        },
      ],
    },
    {
      title: 'What must go in for the decision to be reconstructible',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The criterion for choosing fields is direct and unforgiving: a reader with no access to your production database, reading the event two years from now, can understand what was decided and why. If any answer requires opening another source that may no longer exist, the field is missing. That does not mean recording everything, it means recording enough and pointing to the rest in a stable way.',
        },
        {
          type: 'table',
          columns: ['Field', 'Why it is mandatory', 'What breaks without it'],
          rows: [
            [
              'decision_id',
              'Stable reference to cite in a ticket and in a proceeding',
              'The discussion becomes "that Tuesday support case"',
            ],
            [
              'outcome and reason_code',
              'What was decided and under which codified rule',
              'You are left with free text nobody can aggregate or compare',
            ],
            [
              'policy_version',
              'Today rule is not the rule in force on that date',
              'You judge the past decision by the current criterion',
            ],
            [
              'prompt_version and model_id',
              'Identifies the exact behavior that produced the output',
              'You can neither reproduce it nor bound the scope of the bug',
            ],
            [
              'inputs_digest',
              'Proves which data the agent had at the time without copying it',
              'You cannot tell a decision error from stale data',
            ],
            [
              'evidence_refs',
              'Immutable pointer to the passages and records consulted',
              'The justification becomes a claim with no verifiable backing',
            ],
            [
              'actor',
              'Says whether the agent, a fixed rule or a person decided',
              'Accountability blurs exactly when it matters',
            ],
            [
              'occurred_at and recorded_at',
              'Separates when the fact happened from when it was written',
              'Late reprocessing looks like date tampering',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The pair inputs_digest and evidence_refs is what gives the trail density without bloating it. Instead of copying the five knowledge base passages inside the event, you record the hash of the input set and the immutable reference to each passage, with the document identifier and the revision one. That answers the two questions that show up in every serious investigation: the agent had that data at the time, and the text it read was this one. And it answers even if the document was edited later, as long as its revisions are preserved, which is a requirement the trail imposes on the rest of the system and is worth taking on explicitly.',
        },
        {
          type: 'paragraph',
          value:
            'The reason_code deserves closed-schema discipline. Free text generated by the model as justification is useful for the customer to read and useless for the operation, because it does not aggregate: a thousand slightly different justifications for the same reason make any counting impossible. An enumerated code, defined by the product and not by the model, lets you answer how many refund denials were due to an expired deadline this quarter, which is the question that actually changes the product. Keep both, the code to aggregate and the text to explain, and treat a divergence between them as a defect.',
        },
      ],
    },
    {
      title: 'Hash chaining: making a later edit detectable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Append-only by convention is not append-only. As long as the table accepts an update, the trail is worth exactly the trust placed in whoever has database access, and the argument "nobody would alter it" loses its force at the exact moment the trail is needed, which is the moment someone is being accused of something. The solution requires neither blockchain nor an external service: it is enough to chain each event to the previous one by hash, so that altering a past record invalidates every later one.',
        },
        {
          type: 'paragraph',
          value:
            'The idea is that of a cryptographic linked list. Each event carries the hash of the previous event, and the hash of an event covers both its canonical content and that link. Editing event number forty changes its hash, which breaks the link of forty one, which breaks the one of forty two, and so on to the end of the sequence. Whoever wants to tamper has to rewrite the entire tail, and that is where the second piece comes in: periodically sealing the head of the chain somewhere out of reach of whoever writes, such as an object with a retention lock or a separate repository with a distinct credential. Sealing hourly reduces the undetectable tampering window to one hour, which is usually enough.',
        },
        {
          type: 'code',
          value: `// audit/chain.js
// Append-only trail chained by hash.
// Each event carries the previous hash; editing a past event
// invalidates the whole chain from that point on.

import { createHash } from 'node:crypto';

const GENESIS = '0'.repeat(64);

/**
 * Canonical serialization: keys sorted at any depth.
 * Without it, two processes write the same event with different hashes
 * and verification reports tampering where there was only key ordering.
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return \`[\${value.map(canonical).join(',')}]\`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`);
  return \`{\${entries.join(',')}}\`;
}

export function hashEntry(entry) {
  return createHash('sha256').update(canonical(entry), 'utf8').digest('hex');
}

export function createAuditChain({ store, redact = (x) => x, now }) {
  if (typeof now !== 'function') throw new Error('now must be a function');

  /**
   * Appends a decision. The payload goes through redaction BEFORE hashing,
   * so the hash covers exactly what was persisted.
   */
  async function append(decision) {
    const previous = await store.last();
    const prevHash = previous ? previous.hash : GENESIS;
    const seq = previous ? previous.seq + 1 : 0;

    const body = {
      seq,
      schema: 'decision.v1',
      decision_id: decision.decisionId,
      conversation_id: decision.conversationId,
      subject_id: decision.subjectId,
      actor: decision.actor,              // 'agent' | 'rule' | 'human:<id>'
      outcome: decision.outcome,
      reason_code: decision.reasonCode,   // enumerated, not free text
      policy_version: decision.policyVersion,
      prompt_version: decision.promptVersion,
      model_id: decision.modelId,
      inputs_digest: hashEntry(decision.inputs),
      evidence_refs: decision.evidenceRefs,
      payload: redact(decision.payload),
      occurred_at: decision.occurredAt,
      recorded_at: new Date(now()).toISOString(),
      prev_hash: prevHash,
    };

    const record = { ...body, hash: hashEntry(body) };
    await store.append(record);         // INSERT only: no UPDATE, no DELETE
    return record;
  }

  /** Recomputes the chain and points at the first broken position. */
  async function verify({ from = 0, expectedHead } = {}) {
    let prevHash = from === 0 ? GENESIS : (await store.at(from - 1))?.hash;
    if (!prevHash) return { ok: false, brokenAt: from, reason: 'missing anchor' };

    let last = null;
    for await (const record of store.stream(from)) {
      const { hash, ...body } = record;
      if (body.prev_hash !== prevHash) {
        return { ok: false, brokenAt: body.seq, reason: 'broken link' };
      }
      if (hashEntry(body) !== hash) {
        return { ok: false, brokenAt: body.seq, reason: 'content altered' };
      }
      prevHash = hash;
      last = record;
    }

    // The external seal proves the tail was not rewritten wholesale.
    if (expectedHead && last?.hash !== expectedHead) {
      return { ok: false, brokenAt: last?.seq ?? from, reason: 'seal mismatch' };
    }
    return { ok: true, head: last?.hash ?? prevHash, count: (last?.seq ?? -1) + 1 };
  }

  return { append, verify };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Three decisions in that code are what separate a working implementation from one that raises false alarms. Canonical serialization with sorted keys prevents two processes from writing the same event with different hashes only because the object key order varied, something that turns verification into a constant source of false alerts. Redaction happens before the hash is computed, so it covers exactly what ended up persisted and not a version that never existed on disk. And verification returns the exact position of the break instead of a boolean, because knowing the chain broke without knowing where enables no useful investigation.',
        },
        {
          type: 'diagram',
          value: `event 40             event 41             event 42
+-------------+      +-------------+      +-------------+
| prev: H39   |      | prev: H40   |      | prev: H41   |
| body ...    |      | body ...    |      | body ...    |
| hash: H40   |----->| hash: H41   |----->| hash: H42   |
+-------------+      +-------------+      +-------------+
       |                                         |
       | edit the body of 40                     | hourly seal
       v                                         v
   H40 changes  =>  link of 41 fails       object with retention
   verify() returns brokenAt: 41           (separate credential)`,
        },
      ],
    },
    {
      title: 'Recording without becoming a personal data warehouse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a real tension between auditing and data minimization, and ignoring it produces one of two disasters. On one side, the trail that keeps entire conversations for five years becomes the largest personal data repository in the company, with long retention by design and hard deletion because immutability is precisely the point. On the other, the trail that keeps nothing identifiable cannot even locate the decision of the customer who complained.',
        },
        {
          type: 'paragraph',
          value:
            'The way out is separating what must be proved from what must be read. What must be proved goes in as a hash: the input digest proves the agent had that data set without copying it into the event. What must be read goes in by reference: the document identifier and the revision one point to the text living in its place of origin, with its own lifecycle. And what only needs to identify the person goes in as a stable per-subject pseudonym, which lets you find every decision for that customer without spreading tax id and phone number across millions of rows.',
        },
        {
          type: 'ordered',
          items: [
            'Define the schema field by field, declaring the classification of each one: identifier, personal data, sensitive data or technical metadata.',
            'Apply redaction before writing, at the same point where the hash is computed, so no code path can write the raw value.',
            'Use a stable per-subject pseudonym in place of the tax id and the contact, keeping the reversible map in a separate vault with audited access.',
            'Store the justification text with a shorter deadline than the rest of the event, because it is the field most likely to contain free-form personal data.',
            'Handle deletion requests through crypto-erasure: delete the subject key in the vault instead of editing events, keeping the chain intact.',
            'Write a test that fails if a known sensitive value shows up in any field of the serialized event, and run it with the domain sample data.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Crypto-erasure is the point that usually stalls the conversation with legal and the one that unblocks it for good once explained. Since the chain does not allow deleting an event without breaking the integrity of everything that came after, the sensitive field is stored encrypted with a per-subject key, and the deletion request erases that key. The event stays there, the chain stays intact, the hash still checks out, and the encrypted content becomes permanently unreadable. You keep the ability to prove the decision existed and the chaining that makes it trustworthy, without keeping the data that can no longer be retained.',
        },
      ],
    },
    {
      title: 'From the complaint to the event: the trail must answer fast',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A complete trail that takes two days to produce an answer fails at the goal. The path from the question to the evidence is part of the design, not an operational detail left for later, and it is the difference between an auditable system and a system that theoretically records everything. In practice, the question always arrives through the same door: a customer identifier, an approximate date and a plain-language description of what bothered them.',
        },
        {
          type: 'paragraph',
          value:
            'That defines the indexes before any other optimization: by subject with date, by conversation and by reason code with date. With those three, the search goes from the vague description to the concrete decision in seconds. Without them, you have an intact trail inside a storage that only allows scanning, and the answer arrives when the customer is already gone. It is also worth exposing the read side as a ready-made query for the support team instead of requiring database access, because a trail only the engineer can read ends up never being consulted.',
        },
        {
          type: 'code',
          value: `// audit/query.js
// Path from complaint to evidence, in the shape the question arrives.

export function createAuditQuery({ store, chain, vault }) {
  /**
   * Reconstructs a decision: the event, the integrity check of the chain
   * segment containing it and the resolved evidence.
   */
  async function explain(decisionId, { reveal = false, requestedBy } = {}) {
    const record = await store.findByDecisionId(decisionId);
    if (!record) return { found: false };

    // Verify only the relevant window: checking the whole chain on every
    // query is expensive and unnecessary to answer one complaint.
    const integrity = await chain.verify({ from: Math.max(0, record.seq - 500) });

    const evidence = await Promise.all(
      record.evidence_refs.map((ref) => store.resolveEvidence(ref)),
    );

    // Encrypted data is only opened on explicit request and the access
    // enters the trail itself as a new event.
    const sensitive = reveal
      ? await vault.decrypt(record.subject_id, record.payload.sealed)
      : null;
    if (reveal) {
      await store.appendAccessLog({
        decision_id: decisionId,
        requested_by: requestedBy,
        at: record.recorded_at,
      });
    }

    return {
      found: true,
      decision: {
        outcome: record.outcome,
        reasonCode: record.reason_code,
        actor: record.actor,
        occurredAt: record.occurred_at,
        policyVersion: record.policy_version,
        promptVersion: record.prompt_version,
        modelId: record.model_id,
      },
      evidence,
      sensitive,
      integrity,
    };
  }

  /** Search through the real door: customer and time window. */
  function findBySubject(subjectId, { from, to, reasonCode } = {}) {
    return store.query({ subjectId, from, to, reasonCode });
  }

  return { explain, findBySubject };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice that accessing the sensitive data generates an event of its own. That is a recurring auditing requirement and it is cheap once the trail exists: who opened whose encrypted content and when is exactly the kind of question that shows up later, and answering with "we did not record it" is worse than not having the feature. Notice too that the integrity check covers a window around the event rather than the whole chain, because verifying millions of records on every query is a cost that in practice leads the team to switch verification off, and verification switched off is the same as not having it.',
        },
        {
          type: 'list',
          items: [
            'Measure the time between the question arriving and the evidence being presented, and treat that number as the product metric of the trail.',
            'Run the full chain verification as a batch outside peak hours and alert with the exact position of the break, not with a boolean.',
            'Exercise the trail with one real question per week, picked among closed cases, to discover a missing field before it is actually needed.',
            'Compare the decision count in the trail with the outcome count in the operational database, because a silent divergence means an unrecorded decision.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need blockchain for the trail to be trustworthy?',
      answer:
        'No, and in most cases it gets in the way more than it helps. What auditing requires is that a later alteration be detectable, and that is solved by hash chaining plus a periodic seal out of reach of whoever writes, such as an object with a retention lock or a repository with a separate credential. Blockchain solves a different problem: consensus among parties that do not trust each other and have no common authority. In the relationship between a company and its customers there is a common authority, there is a contract and there is an auditor, so the operational cost, the latency and the data exposure of a distributed chain buy no relevant additional guarantee. The question that separates the two cases is simple: who needs to be convinced that the record was not altered. If the answer is the auditor, the customer or the regulator, chaining with an external seal is already enough and is orders of magnitude cheaper to operate.',
    },
    {
      question: 'How do I record everything without storage cost becoming unfeasible?',
      answer:
        'By separating the small immutable event from the large attachment with its own lifecycle. A well designed decision event is between one and two kilobytes, because it holds codes, versions, hashes and references, not texts. A million decisions per month in that format take up a few gigabytes per year, an irrelevant cost even with five-year retention. What grows out of control is the instinct to attach the full prompt, the full answer and the retrieved passages inside the event, and that content is exactly what must stay outside, referenced by hash and revision identifier. If the team really needs to keep the call bodies to reproduce a bug, keep them in cold storage with shorter retention, treating that attachment as optional evidence and not as part of the audit record, which stays intact even after the attachment expires.',
    },
    {
      question: 'Does the audit trail replace the logging and tracing we already have?',
      answer:
        'No, the three answer different questions and trying to unify them produces an artifact that is bad at all three jobs. Tracing answers where the time went and is sampled by design, which is correct for performance and forbidden in auditing. The log answers why it broke, has short retention and a format that changes on every refactor, which is acceptable for debugging and unacceptable for a record that must be read three years from now. The trail answers why it decided this way, records one hundred percent of decisions, has a versioned schema and verifiable integrity. What is worth sharing among them is the correlation identifier: when the audit event carries the trace_id, the engineer investigating a specific decision jumps straight to the corresponding trace while it still exists, and gains the technical detail without the trail having to carry it.',
    },
  ],
  conclusion: {
    title: 'Without a trail, the explanation of the decision is just your word',
    description:
      'The day someone questions an agent decision is the day the trail pays off, and it cannot be built on that day. What separates an answer in minutes, with the coded reason, the policy version in force and the documents consulted, from an approximate reconstruction out of incomplete logs is having chosen the decision as the unit of record, having written down enough to reconstruct it without the production database, having chained the events so a later edit shows up and having cut personal data before writing. I can design and implement that trail in your agent, from the event schema to the query the support team uses.',
    cta: 'Talk about an audit trail in my agent',
  },
  related: [
    { label: 'Data anonymization before sending it to the LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Versioning the prompt as code: rollout, rollback and testing', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-decision-audit-trail', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un cliente reclama que el bot le negó el reembolso, y la pregunta que llega al equipo no es técnica: por qué lo negó. Abrís el log, encontrás la línea de la llamada al modelo, el tiempo de respuesta, el conteo de tokens, el estado doscientos, y nada de eso responde. El log de aplicación registra que la decisión ocurrió, no lo que la sostuvo. La traza de auditoría es la disciplina de grabar, en el momento en que la decisión se toma, todo lo que haría falta para reconstruirla meses después frente a alguien que no confía en tu palabra: qué regla se aplicó, qué dato leyó el agente, qué versión de prompt y de modelo estaban vigentes, qué herramienta se ejecutó y con qué resultado. Este artículo muestra cómo armar esa traza sin convertir el sistema en un depósito de dato personal: cuál es la unidad correcta de registro, qué debe entrar en cada evento, cómo encadenar los eventos por hash para que una edición posterior sea detectable, cómo reducir el dato sensible antes de grabar y cómo ir del reclamo al evento concreto en minutos.',
  sections: [
    {
      title: 'Un log de aplicación no es una traza de auditoría',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los dos escriben líneas en disco y por eso la confusión sobrevive tanto tiempo. La diferencia aparece en la primera pregunta seria. El log de aplicación existe para que el ingeniero entienda por qué se rompió el sistema, está optimizado para volumen y costo, tiene retención corta, se reescribe con libertad en cada refactor y a nadie le importa si un campo cambió de nombre entre dos versiones. La traza de auditoría existe para probar a terceros qué decidió el sistema, tiene que sobrevivir años, no puede reescribirse después del hecho y su formato es un contrato tan serio como el de una API pública.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica de tratar uno como el otro es siempre la misma: el día en que llega la pregunta, el log existe, tiene gigabytes y no responde. Tiene la duración de la llamada pero no el texto de la política aplicada, tiene el id de la petición pero no el id de la versión del prompt, tiene el mensaje de error pero no los documentos que el agente leyó antes de responder. Y, más grave, puede haber sido alterado: si cualquier persona con acceso a la base puede hacer un update en una fila de log, esa fila no prueba nada en una discusión donde lo que se cuestiona es la buena fe.',
        },
        {
          type: 'table',
          columns: ['Dimensión', 'Log de aplicación', 'Traza de auditoría'],
          rows: [
            [
              'Pregunta que responde',
              'Por qué se rompió el sistema',
              'Por qué el sistema decidió así',
            ],
            [
              'Lector',
              'Quien escribió el código',
              'Legales, cliente, auditor, regulador',
            ],
            [
              'Retención típica',
              'De siete a treinta días',
              'De uno a cinco años, según el contrato',
            ],
            [
              'Mutabilidad',
              'Libre, nadie sigue un cambio de campo',
              'Append-only, la alteración debe ser detectable',
            ],
            [
              'Esquema',
              'Informal, evoluciona en cada deploy',
              'Versionado, un cambio rompedor exige migración',
            ],
            [
              'Muestreo',
              'Aceptable y común bajo carga',
              'Prohibido, decisión muestreada es decisión no registrada',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila del muestreo es la que más sorprende a equipos que vienen de observabilidad. Descartar el noventa por ciento de los traces bajo carga es una práctica correcta y barata cuando el objetivo es encontrar un cuello de botella, porque la estadística sobrevive a la muestra. Es indefendible en auditoría, porque la decisión que va a ser cuestionada es justamente una, y la probabilidad de que esté entre las descartadas es del noventa por ciento. Una traza de auditoría graba el cien por ciento de las decisiones o no es traza, y por eso debe diseñarse para costar poco por evento en vez de apagarse cuando sube el volumen.',
        },
      ],
    },
    {
      title: 'La unidad de registro es la decisión, no la llamada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La elección de la unidad define si la traza va a responder o no. Registrar por llamada al modelo parece natural porque es donde se gasta el dinero, pero produce una traza en la que nadie logra navegar: una sola atención genera doce llamadas, de las cuales ocho son de clasificación y reescritura, y la pregunta del cliente no es sobre ninguna de ellas. Registrar por turno de conversación es mejor y todavía insuficiente, porque un turno puede contener varias decisiones independientes y porque muchas decisiones relevantes ocurren sin ningún mensaje del cliente cerca, como un reprocesamiento nocturno.',
        },
        {
          type: 'paragraph',
          value:
            'La unidad que funciona es la decisión: un punto del flujo donde el sistema eligió entre alternativas y esa elección produjo un efecto visible para alguien de afuera. Aprobar o negar un reembolso es decisión. Derivar a un humano es decisión. Elegir no ejecutar una herramienta por falta de permiso es decisión. Llamar al modelo para reescribir una frase no es decisión, es paso. Los pasos entran en la traza como evidencia adjunta a la decisión que sostuvieron, no como registros de primera clase con vida propia.',
        },
        {
          type: 'list',
          items: [
            'Cada decisión recibe un identificador propio, estable y derivado del contenido, para poder citarse en un ticket sin ambigüedad.',
            'Cada decisión lleva el identificador de la conversación y el del cliente, para que la búsqueda desde el reclamo llegue a ella sin barrido.',
            'Los pasos que la sostuvieron apuntan al identificador de la decisión, y no al revés, porque la decisión es lo que alguien va a buscar.',
            'Una decisión revertida después no sobrescribe la original: es un nuevo evento que referencia al anterior, preservando la secuencia real de los hechos.',
            'Las decisiones automáticas y las humanas usan el mismo esquema, cambiando solo el campo que identifica quién decidió, porque el reclamo no las distingue.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última regla es la que evita la trampa más cara. Los equipos suelen construir la traza solo para lo que decide la IA, y cuando el caso escala descubren que la parte humana del flujo, justamente la que revirtió la decisión del bot, no dejó ningún rastro. Si el supervisor aprobó manualmente un reembolso que el agente había negado, ese es el evento más importante de toda la historia, y tiene que estar en la misma secuencia, con el mismo formato, con la misma garantía de integridad.',
        },
      ],
    },
    {
      title: 'Qué debe entrar para que la decisión sea reconstruible',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El criterio para elegir los campos es directo e implacable: un lector que no tiene acceso a tu base de producción, leyendo el evento dentro de dos años, logra entender qué se decidió y por qué. Si alguna respuesta exige abrir otra fuente que tal vez ya no exista, falta el campo. Eso no significa grabar todo, significa grabar lo suficiente y apuntar de forma estable al resto.',
        },
        {
          type: 'table',
          columns: ['Campo', 'Por qué es obligatorio', 'Qué se rompe sin él'],
          rows: [
            [
              'decision_id',
              'Referencia estable para citar en un ticket y en un proceso',
              'La discusión se vuelve "aquella atención del martes"',
            ],
            [
              'outcome y reason_code',
              'Qué se decidió y bajo qué regla codificada',
              'Queda texto libre que nadie logra agregar ni comparar',
            ],
            [
              'policy_version',
              'La regla de hoy no es la que regía en esa fecha',
              'Juzgás la decisión pasada con el criterio actual',
            ],
            [
              'prompt_version y model_id',
              'Identifica el comportamiento exacto que produjo la salida',
              'No se puede reproducir ni delimitar el alcance del bug',
            ],
            [
              'inputs_digest',
              'Prueba qué datos tenía el agente sin copiarlos',
              'No se distingue error de decisión de dato desactualizado',
            ],
            [
              'evidence_refs',
              'Puntero inmutable a los fragmentos y registros consultados',
              'La justificación se vuelve alegato sin respaldo verificable',
            ],
            [
              'actor',
              'Dice si decidió el agente, una regla fija o una persona',
              'La responsabilidad se difumina justo cuando importa',
            ],
            [
              'occurred_at y recorded_at',
              'Separa cuándo ocurrió el hecho de cuándo se grabó',
              'Un reprocesamiento tardío parece adulteración de fecha',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El par inputs_digest y evidence_refs es lo que le da densidad a la traza sin inflarla. En vez de copiar los cinco fragmentos de la base de conocimiento dentro del evento, grabás el hash del conjunto de entradas y la referencia inmutable de cada fragmento, con el identificador del documento y el de la revisión. Eso responde las dos preguntas que aparecen en toda investigación seria: el agente tenía ese dato en ese momento, y el texto que leyó era este. Y responde aunque el documento se haya editado después, siempre que sus revisiones se preserven, que es una exigencia que la traza impone al resto del sistema y que conviene asumir explícitamente.',
        },
        {
          type: 'paragraph',
          value:
            'El reason_code merece disciplina de esquema cerrado. El texto libre generado por el modelo como justificación es útil para que el cliente lo lea e inútil para la operación, porque no agrega: mil justificaciones apenas distintas para el mismo motivo impiden cualquier conteo. Un código enumerado, definido por el producto y no por el modelo, permite responder cuántas negativas de reembolso fueron por plazo vencido en el trimestre, que es la pregunta que efectivamente cambia el producto. Guardá los dos, el código para agregar y el texto para explicar, y tratá la divergencia entre ambos como un defecto.',
        },
      ],
    },
    {
      title: 'Encadenamiento por hash: hacer detectable la edición posterior',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Append-only por convención no es append-only. Mientras la tabla acepte un update, la traza vale exactamente la confianza que se tiene en quien tiene acceso a la base, y el argumento "nadie la alteraría" pierde fuerza en el momento exacto en que la traza hace falta, que es el momento en que alguien está siendo acusado de algo. La solución no exige blockchain ni un servicio externo: basta con encadenar cada evento al anterior por hash, de modo que alterar un registro pasado invalide todos los posteriores.',
        },
        {
          type: 'paragraph',
          value:
            'La idea es la de una lista enlazada criptográfica. Cada evento lleva el hash del evento anterior, y el hash de un evento cubre tanto su contenido canónico como ese eslabón. Editar el evento número cuarenta cambia su hash, lo que rompe el eslabón del cuarenta y uno, que rompe el del cuarenta y dos, y así hasta el final de la secuencia. Quien quiera adulterar tiene que reescribir toda la cola, y ahí entra la segunda pieza: sellar periódicamente la punta de la cadena en un lugar fuera del alcance de quien escribe, como un objeto con bloqueo de retención o un repositorio separado con credencial distinta. Sellar cada hora reduce la ventana de adulteración indetectable a una hora, lo que suele ser suficiente.',
        },
        {
          type: 'code',
          value: `// audit/chain.js
// Traza append-only encadenada por hash.
// Cada evento lleva el hash del anterior; editar un evento pasado
// invalida la cadena entera a partir de el.

import { createHash } from 'node:crypto';

const GENESIS = '0'.repeat(64);

/**
 * Serializacion canonica: claves ordenadas a cualquier profundidad.
 * Sin eso, dos procesos graban el mismo evento con hashes distintos
 * y la verificacion acusa adulteracion donde solo hubo orden de clave.
 */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return \`[\${value.map(canonical).join(',')}]\`;
  const entries = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => \`\${JSON.stringify(key)}:\${canonical(value[key])}\`);
  return \`{\${entries.join(',')}}\`;
}

export function hashEntry(entry) {
  return createHash('sha256').update(canonical(entry), 'utf8').digest('hex');
}

export function createAuditChain({ store, redact = (x) => x, now }) {
  if (typeof now !== 'function') throw new Error('now debe ser una funcion');

  /**
   * Graba una decision. El payload pasa por redaccion ANTES del hash,
   * para que el hash cubra exactamente lo que se persistio.
   */
  async function append(decision) {
    const previous = await store.last();
    const prevHash = previous ? previous.hash : GENESIS;
    const seq = previous ? previous.seq + 1 : 0;

    const body = {
      seq,
      schema: 'decision.v1',
      decision_id: decision.decisionId,
      conversation_id: decision.conversationId,
      subject_id: decision.subjectId,
      actor: decision.actor,              // 'agent' | 'rule' | 'human:<id>'
      outcome: decision.outcome,
      reason_code: decision.reasonCode,   // enumerado, no texto libre
      policy_version: decision.policyVersion,
      prompt_version: decision.promptVersion,
      model_id: decision.modelId,
      inputs_digest: hashEntry(decision.inputs),
      evidence_refs: decision.evidenceRefs,
      payload: redact(decision.payload),
      occurred_at: decision.occurredAt,
      recorded_at: new Date(now()).toISOString(),
      prev_hash: prevHash,
    };

    const record = { ...body, hash: hashEntry(body) };
    await store.append(record);         // Solo INSERT: sin UPDATE, sin DELETE
    return record;
  }

  /** Recalcula la cadena y senala la primera posicion rota. */
  async function verify({ from = 0, expectedHead } = {}) {
    let prevHash = from === 0 ? GENESIS : (await store.at(from - 1))?.hash;
    if (!prevHash) return { ok: false, brokenAt: from, reason: 'ancla ausente' };

    let last = null;
    for await (const record of store.stream(from)) {
      const { hash, ...body } = record;
      if (body.prev_hash !== prevHash) {
        return { ok: false, brokenAt: body.seq, reason: 'eslabon roto' };
      }
      if (hashEntry(body) !== hash) {
        return { ok: false, brokenAt: body.seq, reason: 'contenido alterado' };
      }
      prevHash = hash;
      last = record;
    }

    // El sello externo prueba que la cola no fue reescrita entera.
    if (expectedHead && last?.hash !== expectedHead) {
      return { ok: false, brokenAt: last?.seq ?? from, reason: 'divergencia con el sello' };
    }
    return { ok: true, head: last?.hash ?? prevHash, count: (last?.seq ?? -1) + 1 };
  }

  return { append, verify };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres decisiones en ese código son las que separan una implementación que funciona de una que da falsas alarmas. La serialización canónica con claves ordenadas evita que dos procesos graben el mismo evento con hashes distintos solo porque el orden de las claves del objeto varió, algo que convierte la verificación en una fuente constante de alerta falsa. La redacción ocurre antes del cálculo del hash, para que este cubra exactamente lo que quedó persistido y no una versión que nunca existió en disco. Y la verificación devuelve la posición exacta de la ruptura en vez de un booleano, porque saber que la cadena se rompió sin saber dónde no permite ninguna investigación útil.',
        },
        {
          type: 'diagram',
          value: `evento 40            evento 41            evento 42
+-------------+      +-------------+      +-------------+
| prev: H39   |      | prev: H40   |      | prev: H41   |
| body ...    |      | body ...    |      | body ...    |
| hash: H40   |----->| hash: H41   |----->| hash: H42   |
+-------------+      +-------------+      +-------------+
       |                                         |
       | edita el body del 40                    | sello horario
       v                                         v
   H40 cambia  =>  el eslabon del 41 falla  objeto con retencion
   verify() devuelve brokenAt: 41           (credencial separada)`,
        },
      ],
    },
    {
      title: 'Registrar sin volverse un depósito de dato personal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una tensión real entre auditoría y minimización de datos, e ignorarla produce uno de dos desastres. De un lado, la traza que guarda la conversación entera por cinco años se vuelve el mayor repositorio de dato personal de la empresa, con retención larga por diseño y borrado difícil porque la inmutabilidad es justamente el punto. Del otro, la traza que no guarda nada identificable no logra ni localizar la decisión del cliente que reclamó.',
        },
        {
          type: 'paragraph',
          value:
            'La salida es separar lo que hay que probar de lo que hay que leer. Lo que hay que probar entra como hash: el digest de las entradas prueba que el agente tenía ese conjunto de datos sin copiarlos dentro del evento. Lo que hay que leer entra por referencia: el identificador del documento y el de la revisión apuntan al texto que vive en su lugar de origen, con su propio ciclo de vida. Y lo que solo necesita identificar a la persona entra como seudónimo estable por sujeto, que permite encontrar todas las decisiones de ese cliente sin esparcir documento y teléfono por millones de filas.',
        },
        {
          type: 'ordered',
          items: [
            'Definí el esquema campo por campo declarando la clasificación de cada uno: identificador, dato personal, dato sensible o metadato técnico.',
            'Aplicá la redacción antes de grabar, en el mismo punto donde se calcula el hash, para que ningún camino de código logre escribir el valor crudo.',
            'Usá un seudónimo estable por sujeto en lugar del documento y del contacto, manteniendo el mapa reversible en una bóveda separada con acceso auditado.',
            'Guardá el texto de la justificación con un plazo más corto que el del resto del evento, porque es el campo con mayor chance de contener dato personal libre.',
            'Tratá el pedido de eliminación por la vía de la cripto-eliminación: borrá la clave del sujeto en la bóveda en vez de editar eventos, dejando la cadena intacta.',
            'Escribí un test que falle si un valor sensible conocido aparece en cualquier campo del evento serializado, y corrélo con los datos de ejemplo del dominio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cripto-eliminación es el punto que suele trabar la conversación con legales y el que la destraba del todo cuando se explica. Como la cadena no permite borrar un evento sin romper la integridad de todo lo que vino después, el campo sensible se guarda cifrado con una clave por sujeto, y el pedido de eliminación borra esa clave. El evento sigue ahí, la cadena sigue íntegra, el hash sigue verificando, y el contenido cifrado se vuelve permanentemente ilegible. Preservás la capacidad de probar que la decisión existió y el encadenamiento que la vuelve confiable, sin preservar el dato que ya no puede retenerse.',
        },
      ],
    },
    {
      title: 'Del reclamo al evento: la traza tiene que responder rápido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una traza completa que tarda dos días en producir una respuesta falla en el objetivo. El camino de la pregunta hasta la evidencia es parte del diseño, no un detalle operativo dejado para después, y es la diferencia entre un sistema auditable y un sistema que teóricamente registra todo. En la práctica, la pregunta llega siempre por la misma puerta: un identificador de cliente, una fecha aproximada y una descripción en lenguaje corriente de lo que molestó.',
        },
        {
          type: 'paragraph',
          value:
            'Eso define los índices antes que cualquier otra optimización: por sujeto con fecha, por conversación y por código de motivo con fecha. Con esos tres, la búsqueda pasa de la descripción vaga a la decisión concreta en segundos. Sin ellos, tenés una traza íntegra dentro de un almacenamiento que solo permite barrido, y la respuesta llega cuando el cliente ya se fue. Conviene también exponer la lectura como una consulta lista para el equipo de atención en vez de exigir acceso a la base, porque una traza que solo el ingeniero puede leer termina sin ser consultada.',
        },
        {
          type: 'code',
          value: `// audit/query.js
// Camino del reclamo hasta la evidencia, en el formato en que llega la pregunta.

export function createAuditQuery({ store, chain, vault }) {
  /**
   * Reconstruye una decision: el evento, la verificacion de integridad del
   * tramo de cadena que lo contiene y las evidencias resueltas.
   */
  async function explain(decisionId, { reveal = false, requestedBy } = {}) {
    const record = await store.findByDecisionId(decisionId);
    if (!record) return { found: false };

    // Verifica solo la ventana relevante: verificar la cadena entera en cada
    // consulta es caro e innecesario para responder un reclamo.
    const integrity = await chain.verify({ from: Math.max(0, record.seq - 500) });

    const evidence = await Promise.all(
      record.evidence_refs.map((ref) => store.resolveEvidence(ref)),
    );

    // El dato cifrado solo se abre bajo pedido explicito y el acceso
    // entra en la propia traza como un nuevo evento.
    const sensitive = reveal
      ? await vault.decrypt(record.subject_id, record.payload.sealed)
      : null;
    if (reveal) {
      await store.appendAccessLog({
        decision_id: decisionId,
        requested_by: requestedBy,
        at: record.recorded_at,
      });
    }

    return {
      found: true,
      decision: {
        outcome: record.outcome,
        reasonCode: record.reason_code,
        actor: record.actor,
        occurredAt: record.occurred_at,
        policyVersion: record.policy_version,
        promptVersion: record.prompt_version,
        modelId: record.model_id,
      },
      evidence,
      sensitive,
      integrity,
    };
  }

  /** Busqueda por la puerta real: cliente y ventana de tiempo. */
  function findBySubject(subjectId, { from, to, reasonCode } = {}) {
    return store.query({ subjectId, from, to, reasonCode });
  }

  return { explain, findBySubject };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate que el propio acceso al dato sensible genera un evento. Esa es una exigencia recurrente en auditoría y es barata cuando la traza ya existe: quién abrió el contenido cifrado de qué cliente y cuándo es exactamente el tipo de pregunta que aparece después, y responder con "no lo registramos" es peor que no tener la funcionalidad. Fijate también que la verificación de integridad cubre una ventana alrededor del evento y no la cadena entera, porque verificar millones de registros en cada consulta es un costo que en la práctica lleva al equipo a apagar la verificación, y verificación apagada es lo mismo que no tenerla.',
        },
        {
          type: 'list',
          items: [
            'Medí el tiempo entre la llegada de la pregunta y la presentación de la evidencia, y tratá ese número como métrica de producto de la traza.',
            'Corré la verificación completa de la cadena en lote fuera del horario pico y alertá con la posición exacta de la ruptura, no con un booleano.',
            'Ejercitá la traza con una pregunta real por semana, elegida entre casos cerrados, para descubrir un campo faltante antes de que haga falta.',
            'Compará el conteo de decisiones de la traza con el conteo de resultados en la base operativa, porque una divergencia silenciosa significa decisión no registrada.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito blockchain para que la traza sea confiable?',
      answer:
        'No, y en la mayoría de los casos estorba más de lo que ayuda. Lo que la auditoría exige es que una alteración posterior sea detectable, y eso se resuelve con encadenamiento de hash más un sello periódico fuera del alcance de quien escribe, como un objeto con bloqueo de retención o un repositorio con credencial separada. Blockchain resuelve un problema distinto: consenso entre partes que no confían entre sí y no tienen autoridad común. En la relación entre una empresa y sus clientes hay autoridad común, hay contrato y hay auditor, así que el costo operativo, la latencia y la exposición de datos de una cadena distribuida no compran garantía adicional relevante. La pregunta que separa los dos casos es simple: a quién hay que convencer de que el registro no fue alterado. Si la respuesta es el auditor, el cliente o el regulador, el encadenamiento con sello externo ya alcanza y es órdenes de magnitud más barato de operar.',
    },
    {
      question: '¿Cómo registrar todo sin que el costo de almacenamiento sea inviable?',
      answer:
        'Separando el evento pequeño e inmutable del adjunto grande con ciclo de vida propio. Un evento de decisión bien diseñado pesa entre uno y dos kilobytes, porque guarda códigos, versiones, hashes y referencias, no textos. Un millón de decisiones por mes en ese formato ocupa pocos gigabytes por año, un costo irrelevante incluso con retención de cinco años. Lo que crece sin control es el instinto de adjuntar el prompt completo, la respuesta completa y los fragmentos recuperados dentro del evento, y ese contenido es justamente el que debe quedar afuera, referenciado por hash y por identificador de revisión. Si el equipo realmente necesita guardar el cuerpo de las llamadas para reproducir un bug, guardalo en almacenamiento frío con retención más corta, tratando ese adjunto como evidencia opcional y no como parte del registro de auditoría, que sigue íntegro incluso después de que el adjunto expira.',
    },
    {
      question: '¿La traza de auditoría reemplaza el log y el tracing que ya tenemos?',
      answer:
        'No, los tres responden preguntas distintas e intentar unificarlos produce un artefacto malo en las tres funciones. El tracing responde dónde se fue el tiempo y está muestreado por diseño, lo que es correcto para performance y prohibido en auditoría. El log responde por qué se rompió, tiene retención corta y un formato que cambia en cada refactor, lo que es aceptable para depuración e inaceptable para un registro que debe leerse dentro de tres años. La traza responde por qué decidió así, graba el cien por ciento de las decisiones, tiene esquema versionado e integridad verificable. Lo que sí conviene compartir entre ellos es el identificador de correlación: cuando el evento de auditoría lleva el trace_id, el ingeniero que investiga una decisión específica salta directo al trace correspondiente mientras todavía existe, y gana el detalle técnico sin que la traza tenga que cargarlo.',
    },
  ],
  conclusion: {
    title: 'Sin traza, la explicación de la decisión es solo tu palabra',
    description:
      'El día en que alguien cuestiona una decisión del agente es el día en que la traza vale, y no puede construirse ese día. Lo que separa una respuesta en minutos, con el motivo codificado, la versión de la política vigente y los documentos consultados, de una reconstrucción por aproximación a partir de logs incompletos es haber elegido la decisión como unidad de registro, haber grabado lo suficiente para reconstruirla sin la base de producción, haber encadenado los eventos para que la edición posterior aparezca y haber reducido el dato personal antes de grabar. Puedo diseñar e implementar esa traza en tu agente, del esquema de eventos a la consulta que usa el equipo de atención.',
    cta: 'Hablar sobre traza de auditoría en mi agente',
  },
  related: [
    { label: 'Anonimización de datos antes de mandarlos al LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Versionar el prompt como código: rollout, rollback y prueba', to: '/blog/versionar-prompt-como-codigo-rollout-rollback-teste' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-decision-audit-trail', description: repo.es, url: repoUrl },
};

export default {
  pt,
  en,
  es,
};
