// Conteudo do artigo: retencao de dados em sistema com IA, o que guardar, por quanto tempo e como apagar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Um sistema com IA guarda muito mais coisa do que o time imagina. A conversa está no banco da aplicação, mas a mesma frase do cliente também está no trace de observabilidade, no payload bruto do webhook, no índice vetorial, na memória de longo prazo do agente, no cache semântico, na fila de revisão humana, no conjunto de avaliação e no log de erro que alguém deixou verboso para depurar um incidente de março. Quando chega um pedido de exclusão, o time apaga a linha da conversa, responde que apagou, e o dado continua vivo em seis lugares. Retenção não é um campo de configuração, é uma propriedade que precisa ser desenhada por cópia, porque cada cópia tem um dono, um propósito e um prazo diferentes. Este artigo mostra como inventariar essas cópias, como definir prazo a partir do propósito em vez de definir por hábito, por que apagar de um índice vetorial e de um conjunto de avaliação é tecnicamente diferente de apagar de uma tabela, e como provar que a exclusão realmente aconteceu em vez de confiar que aconteceu.',
  sections: [
    {
      title: 'O dado não está em um lugar, está em oito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro erro de retenção é mental: o time pensa na conversa como um registro, quando ela é um rastro que se espalha por todo o pipeline. Cada componente que toca a mensagem cria uma cópia, e essa cópia quase sempre nasce sem prazo, porque foi criada para resolver um problema operacional imediato, não para ser gerenciada. O trace foi criado para depurar latência, o cache para economizar chamada, o eval para medir qualidade, e nenhum deles foi pensado como repositório de dado pessoal, mas todos são.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de escrever qualquer política, faça o inventário. Ele não precisa de ferramenta: precisa de uma linha por lugar onde a mensagem do cliente pousa, com quem escreve, quem lê, e o que quebra se aquilo sumir amanhã. A última coluna é a mais importante, porque é ela que separa o que tem propósito real do que só está lá por inércia.',
        },
        {
          type: 'table',
          columns: ['Onde a cópia vive', 'Por que ela existe', 'Prazo típico defensável', 'O que quebra se apagar'],
          rows: [
            [
              'Banco da conversa',
              'Continuidade do atendimento e histórico do cliente',
              'Enquanto durar a relação, mais o prazo legal aplicável',
              'O cliente perde o próprio histórico',
            ],
            [
              'Payload bruto do webhook',
              'Reprocessar entrega que falhou',
              '7 a 30 dias',
              'Nada depois da janela de reprocessamento',
            ],
            [
              'Trace de observabilidade',
              'Depurar incidente e atribuir custo',
              '15 a 30 dias com conteúdo, mais tempo só com metadado',
              'Investigação de incidente antigo fica cega',
            ],
            [
              'Índice vetorial do RAG',
              'Recuperar contexto relevante',
              'Enquanto o documento de origem existir',
              'A resposta perde a fonte, não só o texto',
            ],
            [
              'Memória de longo prazo do agente',
              'Personalizar sem repergunta',
              'Prazo próprio, geralmente menor que o da conversa',
              'O agente volta a perguntar o que já sabia',
            ],
            [
              'Cache semântico',
              'Cortar custo e latência',
              'Horas a poucos dias',
              'Sobe custo e latência, nada mais',
            ],
            [
              'Conjunto de avaliação',
              'Medir regressão entre versões',
              'Longo, mas só com dado anonimizado',
              'A série histórica de qualidade perde comparabilidade',
            ],
            [
              'Log de erro da aplicação',
              'Diagnóstico de falha',
              '15 a 30 dias',
              'Nada, se o metadado estruturado ficar',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Duas linhas dessa tabela costumam causar surpresa. O log de erro entra no inventário porque, na hora do incidente, alguém sempre loga o prompt inteiro para entender o que aconteceu, e esse log fica em um sistema com retenção pensada para volume, não para privacidade. E o cache semântico é o que tem o prazo mais curto de todos e quase sempre é o que ninguém lembra de limpar, porque ele é invisível quando funciona.',
        },
      ],
    },
    {
      title: 'Prazo vem do propósito, não do hábito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A pergunta "por quanto tempo a gente guarda?" não tem resposta genérica, e o número que a maioria dos times escolhe vem de hábito de infraestrutura, não de análise. Quando alguém responde noventa dias sem hesitar, geralmente noventa dias é o padrão da ferramenta de log. A pergunta correta é outra: qual decisão essa cópia sustenta, e por quanto tempo essa decisão ainda pode ser tomada. Se a janela de disputa de cobrança é de sessenta dias, o trace com conteúdo não precisa passar disso. Se o webhook só reprocessa entrega falha em sete dias, o payload bruto não tem por que sobreviver ao oitavo.',
        },
        {
          type: 'paragraph',
          value:
            'Há um segundo eixo que resolve boa parte da tensão entre apagar e continuar operando: separar conteúdo de metadado. O conteúdo é a frase do cliente, o texto recuperado, a resposta gerada. O metadado é a duração, o número de tokens, o modelo usado, a intenção classificada, se houve transbordo. Quase todo painel operacional vive de metadado, e quase todo risco de privacidade vive de conteúdo. Quando as duas coisas ficam na mesma linha, o prazo do conteúdo contamina o do metadado, e o time se vê obrigado a escolher entre perder a série histórica de custo e guardar texto que já deveria ter sumido.',
        },
        {
          type: 'code',
          value: `// retention/policy.js
// A politica vive no codigo, nao na cabeca de quem configurou o banco.
// Cada classe de dado declara proposito, prazo e o que sobra depois do prazo.

export const RETENTION = {
  conversation_content: { days: 365, afterExpiry: 'delete', purpose: 'historico do cliente' },
  conversation_metadata: { days: 1095, afterExpiry: 'keep', purpose: 'serie de volume e custo' },
  webhook_payload: { days: 7, afterExpiry: 'delete', purpose: 'reprocessar entrega falha' },
  trace_content: { days: 30, afterExpiry: 'redact', purpose: 'depurar incidente' },
  trace_metadata: { days: 400, afterExpiry: 'keep', purpose: 'latencia e custo por rota' },
  agent_memory: { days: 180, afterExpiry: 'delete', purpose: 'personalizacao sem repergunta' },
  semantic_cache: { days: 2, afterExpiry: 'delete', purpose: 'custo e latencia' },
  eval_case: { days: null, afterExpiry: 'keep', purpose: 'regressao', requiresAnonymization: true },
};

// Prazo nulo so e aceito quando o dado ja entrou anonimizado.
// A checagem roda no boot: politica invalida derruba o processo em vez
// de virar um dado pessoal guardado para sempre por descuido.
export function assertPolicyIsSound() {
  for (const [name, rule] of Object.entries(RETENTION)) {
    if (rule.days === null && !rule.requiresAnonymization) {
      throw new Error(\`Retencao infinita sem anonimizacao em "\${name}".\`);
    }
    if (rule.days !== null && rule.days <= 0) {
      throw new Error(\`Prazo invalido em "\${name}".\`);
    }
  }
}

export function expiresAt(kind, createdAt) {
  const rule = RETENTION[kind];
  if (!rule) throw new Error(\`Classe de dado desconhecida: "\${kind}".\`);
  if (rule.days === null) return null;
  return new Date(createdAt.getTime() + rule.days * 86400000);
}`,
        },
        {
          type: 'paragraph',
          value:
            'A função de verificação no boot parece exagero até a primeira vez que alguém adiciona uma classe nova de dado e esquece o prazo. Sem ela, o valor ausente vira retenção infinita silenciosa, que é exatamente o estado que a política existe para evitar. Com ela, o esquecimento derruba o deploy em ambiente de teste, que é o momento barato de descobrir o problema.',
        },
        {
          type: 'list',
          items: [
            'Escreva o propósito de cada classe antes do prazo: se ninguém consegue escrever o propósito em uma frase, a cópia provavelmente não deveria existir.',
            'Trate "redigir" como uma ação de primeira classe ao lado de "apagar": muito trace precisa sobreviver sem o conteúdo, e apagar a linha inteira destrói a série de latência junto.',
            'Prazo diferente por classe é o normal, não a exceção: forçar um prazo único para tudo sempre guarda demais em um lugar e de menos em outro.',
            'Registre o prazo junto do dado, não só na configuração global, porque o dado migra de banco e a configuração fica para trás.',
            'Ligue o expurgo desde o primeiro dia, mesmo com volume baixo: política que começa a rodar depois de dois anos de acúmulo é um projeto de limpeza, não uma política.',
          ],
        },
      ],
    },
    {
      title: 'Apagar de índice vetorial e de eval não é apagar de tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em uma tabela relacional, apagar é uma operação conhecida: uma linha some, as chaves estrangeiras avisam, e o resultado é verificável com uma consulta. Nos dois componentes que mais caracterizam um sistema com IA, o índice vetorial e o conjunto de avaliação, apagar tem armadilhas próprias, e é aí que a maioria das exclusões fica pela metade.',
        },
        {
          type: 'paragraph',
          value:
            'No índice vetorial, o embedding não é o texto, mas deriva dele, e um vizinho recuperado pode reconstruir boa parte do conteúdo original em uma resposta gerada. Isso significa que apagar o documento de origem sem apagar os vetores derivados não resolve nada: o RAG continua recuperando trechos de um documento que oficialmente não existe mais. Pior, muitos índices marcam como removido sem compactar, e o vetor continua materialmente presente até a próxima reconstrução. A regra prática é guardar, junto de cada vetor, a chave do titular e do documento de origem, para que a exclusão seja uma consulta por chave e não uma varredura por similaridade.',
        },
        {
          type: 'diagram',
          value: `Um pedido de exclusao, oito destinos

  pedido de exclusao (titular X)
        |
        v
  +-- resolver identidade -------------------------+
  |  telefone, id externo, id interno, id de sessao|
  +------------------------------------------------+
        |
        +--> banco da conversa ........ DELETE por titular
        +--> payload de webhook ....... DELETE por titular
        +--> trace de observabilidade . REDIGIR conteudo, manter metadado
        +--> indice vetorial .......... DELETE por chave de titular
        |                               + reconstruir/compactar
        +--> memoria do agente ........ DELETE por titular
        +--> cache semantico .......... INVALIDAR entradas do titular
        +--> conjunto de avaliacao .... ANONIMIZAR ou remover o caso
        +--> backup ................... marcar para expurgo no ciclo
                                        (nao restaurar dado apagado)
        |
        v
  registro de exclusao: quando, quais destinos, resultado por destino

  destino sem confirmacao = exclusao incompleta, nao exclusao pendente`,
        },
        {
          type: 'paragraph',
          value:
            'O conjunto de avaliação é o caso mais delicado, porque ele tem uma razão legítima para durar muito: sem casos estáveis não existe comparação entre versões do sistema. A saída não é abrir exceção para dado pessoal, é mudar o momento da anonimização. O caso entra no eval já sem identificador, com nomes, telefones e números de pedido substituídos por marcadores consistentes, e é essa versão que dura. Quando a anonimização acontece na entrada, o pedido de exclusão do titular não força escolher entre cumprir a lei e perder a régua de qualidade.',
        },
        {
          type: 'paragraph',
          value:
            'O backup merece a mesma honestidade. Backup imutável não é apagável sob demanda, e prometer o contrário é inventar uma capacidade que a arquitetura não tem. O comportamento defensável é declarar o ciclo de retenção do backup, garantir que o dado sai dele quando o ciclo vira, e assegurar que uma restauração nunca ressuscita registro já excluído, o que exige aplicar a lista de exclusões como etapa obrigatória do procedimento de restore. Sem essa etapa, todo restore desfaz silenciosamente meses de exclusões cumpridas.',
        },
      ],
    },
    {
      title: 'Expurgo que roda sozinho e não trava o banco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Política escrita e não executada é pior do que nenhuma política, porque cria a sensação de que o problema está resolvido. O expurgo precisa ser um processo periódico, idempotente e observável, e precisa apagar em lotes. Um comando único de exclusão em cima de uma tabela grande trava a escrita, estoura o log de transação e acaba sendo cancelado no meio, deixando o expurgo pela metade e o time com medo de rodar de novo.',
        },
        {
          type: 'code',
          value: `// retention/purge.js
// Expurgo em lotes: idempotente, com teto por execucao e pausa entre lotes.
// Roda todo dia; se o volume acumulado for grande, converge em varios dias
// em vez de tentar limpar tudo numa transacao unica.

import { RETENTION } from './policy.js';

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 200;

export async function purgeExpired({ db, kind, now = new Date(), logger }) {
  const rule = RETENTION[kind];
  if (!rule || rule.days === null) return { kind, deleted: 0, skipped: true };

  const cutoff = new Date(now.getTime() - rule.days * 86400000);
  let total = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    // A acao depende da regra: apagar a linha ou apenas limpar o conteudo.
    const affected =
      rule.afterExpiry === 'redact'
        ? await db.redactContentBatch({ kind, cutoff, limit: BATCH_SIZE })
        : await db.deleteBatch({ kind, cutoff, limit: BATCH_SIZE });

    total += affected;
    if (affected < BATCH_SIZE) break; // acabou antes do teto
    await new Promise((resolve) => setTimeout(resolve, 200)); // folga para o banco
  }

  logger.info('retention.purge', { kind, action: rule.afterExpiry, cutoff, total });
  return { kind, deleted: total, skipped: false };
}

// A metrica que importa nao e quantos registros foram apagados, e sim
// qual e o registro mais velho que ainda esta vivo em cada classe.
export async function oldestSurviving({ db, kind }) {
  const rule = RETENTION[kind];
  const oldest = await db.oldestRecordAge({ kind });
  const overdue = rule.days !== null && oldest !== null && oldest > rule.days;
  return { kind, oldestDays: oldest, limitDays: rule.days, overdue };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A segunda função é a que transforma retenção em algo monitorável. Contar quantos registros o expurgo apagou não diz nada sobre conformidade: um dia sem exclusões pode significar que não havia nada vencido ou que o job falhou silenciosamente. A idade do registro mais velho vivo em cada classe responde diretamente a pergunta que importa, e ela é o alerta certo: se o mais velho passa do prazo declarado, alguma coisa parou, e o alerta dispara antes de alguém de fora perceber.',
        },
        {
          type: 'ordered',
          items: [
            'Rode o expurgo diariamente, mesmo quando não há volume, para que a falha apareça como falha e não como ausência de dado vencido.',
            'Apague em lotes com pausa entre eles, e aceite convergir em vários dias quando houver acúmulo histórico.',
            'Emita por classe a idade do registro mais velho vivo e alerte quando ela ultrapassar o prazo declarado.',
            'Faça o expurgo idempotente: reexecutar depois de uma queda no meio precisa ser seguro e barato.',
            'Rode primeiro em modo de contagem em ambiente de produção, compare com o esperado, e só depois ligue a exclusão real.',
            'Inclua os destinos externos no mesmo job, porque índice vetorial e cache costumam ser os únicos que ninguém agendou.',
          ],
        },
      ],
    },
    {
      title: 'Provar que apagou, não confiar que apagou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando chega um pedido de exclusão, a diferença entre um sistema maduro e um improvisado não está em conseguir apagar, está em conseguir dizer exatamente o que foi apagado, onde e quando. Isso exige tratar a exclusão como uma operação distribuída com confirmação por destino, e não como uma chamada que retorna verdadeiro. Cada destino confirma individualmente, o resultado é registrado, e a ausência de confirmação de um destino é uma exclusão incompleta, não uma exclusão pendente que alguém vai lembrar de terminar.',
        },
        {
          type: 'paragraph',
          value:
            'O registro dessa operação é uma exceção interessante à própria política: ele precisa durar mais que o dado que apagou, e por isso precisa conter apenas o identificador pseudonimizado do titular, a lista de destinos e o resultado de cada um. Um registro de exclusão que guarda o nome de quem pediu a exclusão é exatamente o tipo de contradição que aparece na primeira auditoria.',
        },
        {
          type: 'table',
          columns: ['Pergunta da auditoria', 'Resposta frágil', 'Resposta defensável'],
          rows: [
            [
              'Onde esse dado está?',
              'No banco de conversas',
              'Inventário por classe com dono, propósito e prazo',
            ],
            [
              'Vocês apagaram?',
              'Rodamos o delete',
              'Registro com destino, horário e confirmação por destino',
            ],
            [
              'E no backup?',
              'Backup é imutável',
              'Ciclo declarado e lista de exclusão aplicada no restore',
            ],
            [
              'E no eval e no índice vetorial?',
              'Isso é dado técnico',
              'Eval anonimizado na entrada, vetor apagado por chave de titular',
            ],
            [
              'Como sabem que continua funcionando?',
              'O job está agendado',
              'Idade do registro mais velho vivo, por classe, com alerta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A coluna do meio não é caricatura: são as respostas reais que times competentes dão quando nunca precisaram formalizar retenção. Todas soam razoáveis e nenhuma é verificável, e é justamente essa a diferença. A coluna da direita não exige ferramenta cara nem projeto de seis meses; exige que o inventário exista, que o prazo esteja no código, que o expurgo rode com métrica e que a exclusão deixe rastro.',
        },
        {
          type: 'paragraph',
          value:
            'Vale fechar com o efeito colateral que quase nunca entra na conversa: retenção bem feita reduz custo e melhora qualidade. Índice vetorial menor busca mais rápido e recupera menos lixo antigo, cache limpo erra menos, trace com conteúdo curto custa menos em armazenamento e o eval anonimizado dura mais sem virar passivo. A política de retenção que o jurídico pede é a mesma que o time de engenharia deveria querer, e apresentá-la assim é o que faz ela sair do papel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso apagar o dado do índice vetorial ou basta apagar o documento de origem?',
      answer:
        'Precisa apagar dos dois, e essa é uma das falhas de exclusão mais comuns em sistemas com RAG. O embedding não é o texto, mas deriva dele com informação suficiente para que um trecho recuperado reapareça dentro de uma resposta gerada, então um índice que ainda contém os vetores continua entregando conteúdo de um documento que oficialmente já não existe. Some a isso que muitos índices marcam o registro como removido sem compactar de imediato, e o vetor permanece materialmente presente até a próxima reconstrução. O desenho que torna isso viável é guardar, junto de cada vetor, a chave do titular e a chave do documento de origem, para que a exclusão seja uma consulta por chave e não uma varredura por similaridade, e agendar a compactação como parte do procedimento e não como manutenção eventual.',
    },
    {
      question: 'Como manter um conjunto de avaliação estável se preciso apagar dado de clientes?',
      answer:
        'Mudando o momento da anonimização em vez de abrir exceção para o eval. Se o caso entra no conjunto já sem identificadores, com nome, telefone, e-mail e número de pedido substituídos por marcadores consistentes que preservam a estrutura do caso, o que dura é uma versão que não é dado pessoal, e o pedido de exclusão do titular deixa de colidir com a necessidade de comparar versões do sistema ao longo do tempo. O erro é fazer o caminho inverso, guardar o caso cru e prometer anonimizar depois: a anonimização tardia sempre chega incompleta, porque identificador aparece no meio do texto livre e não só nos campos estruturados. Quando um caso específico ainda assim precisar sair, remova o caso e registre a mudança de versão do conjunto, para que a série histórica de qualidade continue legível.',
    },
    {
      question: 'Como lidar com backup, se ele é imutável por definição?',
      answer:
        'Sendo explícito sobre o que a arquitetura consegue fazer em vez de prometer exclusão imediata onde ela não existe. O comportamento defensável tem três partes: declarar o ciclo de retenção do backup, garantir que o dado sai naturalmente dele quando o ciclo vira, e tratar a lista de registros excluídos como etapa obrigatória do procedimento de restauração. Essa terceira parte é a que quase todo time esquece, e é a mais importante, porque sem ela qualquer restore ressuscita silenciosamente meses de exclusões já cumpridas e o sistema volta a um estado que já tinha sido corrigido. Documente o ciclo, teste a restauração com a lista aplicada pelo menos uma vez, e mantenha o registro dessa validação junto do procedimento.',
    },
  ],
  conclusion: {
    title: 'Retenção é desenho de arquitetura, não campo de configuração',
    description:
      'A mensagem do cliente não fica em um lugar: ela se multiplica em conversa, payload de webhook, trace, índice vetorial, memória do agente, cache, eval e log, e cada cópia nasce com um propósito diferente e quase sempre sem prazo. Fazer o inventário por cópia, derivar o prazo do propósito em vez do hábito, separar conteúdo de metadado, anonimizar o eval na entrada, apagar vetor por chave de titular, rodar expurgo em lotes com alerta pela idade do registro mais velho vivo e registrar cada exclusão por destino é o que transforma uma promessa em algo verificável. Posso mapear onde o dado do seu sistema de IA realmente vive, escrever a política no código, ligar o expurgo com métrica e deixar o fluxo de exclusão com prova por destino, para que a resposta a uma auditoria seja um registro e não uma lembrança.',
    cta: 'Falar sobre retenção de dados no meu sistema de IA',
  },
  related: [
    { label: 'Anonimização de dados antes de mandar para o LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Trilha de auditoria de agente de IA', to: '/blog/trilha-auditoria-agente-ia-provar-o-que-foi-decidido' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'An AI system stores far more than the team imagines. The conversation is in the application database, but the same customer sentence also lives in the observability trace, in the raw webhook payload, in the vector index, in the agent long-term memory, in the semantic cache, in the human review queue, in the evaluation set and in the error log someone left verbose to debug an incident back in March. When a deletion request arrives, the team removes the conversation row, reports that it was deleted, and the data keeps living in six other places. Retention is not a configuration field, it is a property that has to be designed per copy, because every copy has a different owner, purpose and deadline. This article shows how to inventory those copies, how to derive deadlines from purpose instead of from habit, why deleting from a vector index and from an evaluation set is technically different from deleting from a table, and how to prove that deletion actually happened instead of trusting that it did.',
  sections: [
    {
      title: 'The data is not in one place, it is in eight',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first retention mistake is mental: the team thinks of the conversation as a record, when it is a trail spread across the whole pipeline. Every component that touches the message creates a copy, and that copy is almost always born without a deadline, because it was created to solve an immediate operational problem, not to be governed. The trace was created to debug latency, the cache to save a call, the eval to measure quality, and none of them was designed as a repository of personal data, yet all of them are.',
        },
        {
          type: 'paragraph',
          value:
            'Before writing any policy, do the inventory. It needs no tooling: it needs one line per place where the customer message lands, with who writes, who reads, and what breaks if it disappears tomorrow. The last column matters most, because it separates what has a real purpose from what is only there out of inertia.',
        },
        {
          type: 'table',
          columns: ['Where the copy lives', 'Why it exists', 'Typical defensible deadline', 'What breaks if deleted'],
          rows: [
            [
              'Conversation database',
              'Support continuity and customer history',
              'For the life of the relationship, plus the applicable legal period',
              'The customer loses their own history',
            ],
            [
              'Raw webhook payload',
              'Reprocess a failed delivery',
              '7 to 30 days',
              'Nothing after the reprocessing window',
            ],
            [
              'Observability trace',
              'Debug incidents and attribute cost',
              '15 to 30 days with content, longer with metadata only',
              'Old incident investigation goes blind',
            ],
            [
              'RAG vector index',
              'Retrieve relevant context',
              'As long as the source document exists',
              'The answer loses the source, not just the text',
            ],
            [
              'Agent long-term memory',
              'Personalize without asking again',
              'Its own deadline, usually shorter than the conversation',
              'The agent starts asking what it already knew',
            ],
            [
              'Semantic cache',
              'Cut cost and latency',
              'Hours to a few days',
              'Cost and latency rise, nothing else',
            ],
            [
              'Evaluation set',
              'Measure regression across versions',
              'Long, but only with anonymized data',
              'The quality series loses comparability',
            ],
            [
              'Application error log',
              'Failure diagnosis',
              '15 to 30 days',
              'Nothing, if the structured metadata stays',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two rows in that table usually surprise people. The error log belongs in the inventory because, during an incident, someone always logs the entire prompt to understand what happened, and that log sits in a system whose retention was tuned for volume, not for privacy. And the semantic cache has the shortest deadline of all and is almost always the one nobody remembers to clean, because it is invisible when it works.',
        },
      ],
    },
    {
      title: 'Deadlines come from purpose, not from habit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The question "how long do we keep it?" has no generic answer, and the number most teams pick comes from infrastructure habit, not analysis. When someone answers ninety days without hesitating, ninety days is usually the log tool default. The right question is a different one: which decision does this copy support, and for how long can that decision still be made. If the billing dispute window is sixty days, the trace with content does not need to outlive it. If the webhook only reprocesses failed deliveries within seven days, the raw payload has no reason to survive day eight.',
        },
        {
          type: 'paragraph',
          value:
            'There is a second axis that resolves most of the tension between deleting and continuing to operate: separating content from metadata. Content is the customer sentence, the retrieved text, the generated answer. Metadata is duration, token count, model used, classified intent, whether a handoff happened. Nearly every operational dashboard runs on metadata, and nearly every privacy risk lives in content. When both sit in the same row, the content deadline contaminates the metadata deadline, and the team ends up choosing between losing the historical cost series and keeping text that should already be gone.',
        },
        {
          type: 'code',
          value: `// retention/policy.js
// A politica vive no codigo, nao na cabeca de quem configurou o banco.
// Cada classe de dado declara proposito, prazo e o que sobra depois do prazo.

export const RETENTION = {
  conversation_content: { days: 365, afterExpiry: 'delete', purpose: 'historico do cliente' },
  conversation_metadata: { days: 1095, afterExpiry: 'keep', purpose: 'serie de volume e custo' },
  webhook_payload: { days: 7, afterExpiry: 'delete', purpose: 'reprocessar entrega falha' },
  trace_content: { days: 30, afterExpiry: 'redact', purpose: 'depurar incidente' },
  trace_metadata: { days: 400, afterExpiry: 'keep', purpose: 'latencia e custo por rota' },
  agent_memory: { days: 180, afterExpiry: 'delete', purpose: 'personalizacao sem repergunta' },
  semantic_cache: { days: 2, afterExpiry: 'delete', purpose: 'custo e latencia' },
  eval_case: { days: null, afterExpiry: 'keep', purpose: 'regressao', requiresAnonymization: true },
};

// Prazo nulo so e aceito quando o dado ja entrou anonimizado.
// A checagem roda no boot: politica invalida derruba o processo em vez
// de virar um dado pessoal guardado para sempre por descuido.
export function assertPolicyIsSound() {
  for (const [name, rule] of Object.entries(RETENTION)) {
    if (rule.days === null && !rule.requiresAnonymization) {
      throw new Error(\`Retencao infinita sem anonimizacao em "\${name}".\`);
    }
    if (rule.days !== null && rule.days <= 0) {
      throw new Error(\`Prazo invalido em "\${name}".\`);
    }
  }
}

export function expiresAt(kind, createdAt) {
  const rule = RETENTION[kind];
  if (!rule) throw new Error(\`Classe de dado desconhecida: "\${kind}".\`);
  if (rule.days === null) return null;
  return new Date(createdAt.getTime() + rule.days * 86400000);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The boot-time check looks like overkill until the first time someone adds a new data class and forgets the deadline. Without it, the missing value becomes silent infinite retention, which is exactly the state the policy exists to prevent. With it, the oversight breaks the deploy in a test environment, which is the cheap moment to find the problem.',
        },
        {
          type: 'list',
          items: [
            'Write the purpose of each class before the deadline: if nobody can state the purpose in one sentence, the copy probably should not exist.',
            'Treat "redact" as a first-class action next to "delete": plenty of trace needs to survive without content, and deleting the whole row destroys the latency series along with it.',
            'A different deadline per class is normal, not an exception: forcing a single deadline for everything always keeps too much in one place and too little in another.',
            'Store the deadline alongside the data, not only in global configuration, because data migrates between stores and configuration gets left behind.',
            'Turn purging on from day one, even at low volume: a policy that starts running after two years of accumulation is a cleanup project, not a policy.',
          ],
        },
      ],
    },
    {
      title: 'Deleting from a vector index and from an eval is not deleting from a table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a relational table, deletion is a known operation: a row disappears, foreign keys complain, and the result is verifiable with a query. In the two components that most characterize an AI system, the vector index and the evaluation set, deletion has its own traps, and that is where most deletions end up half done.',
        },
        {
          type: 'paragraph',
          value:
            'In the vector index, the embedding is not the text, but it derives from it, and a retrieved neighbor can reconstruct much of the original content inside a generated answer. That means deleting the source document without deleting the derived vectors solves nothing: RAG keeps retrieving passages from a document that officially no longer exists. Worse, many indexes mark records as removed without compacting, and the vector stays materially present until the next rebuild. The practical rule is to store, next to every vector, the subject key and the source document key, so deletion is a lookup by key and not a scan by similarity.',
        },
        {
          type: 'diagram',
          value: `Um pedido de exclusao, oito destinos

  pedido de exclusao (titular X)
        |
        v
  +-- resolver identidade -------------------------+
  |  telefone, id externo, id interno, id de sessao|
  +------------------------------------------------+
        |
        +--> banco da conversa ........ DELETE por titular
        +--> payload de webhook ....... DELETE por titular
        +--> trace de observabilidade . REDIGIR conteudo, manter metadado
        +--> indice vetorial .......... DELETE por chave de titular
        |                               + reconstruir/compactar
        +--> memoria do agente ........ DELETE por titular
        +--> cache semantico .......... INVALIDAR entradas do titular
        +--> conjunto de avaliacao .... ANONIMIZAR ou remover o caso
        +--> backup ................... marcar para expurgo no ciclo
                                        (nao restaurar dado apagado)
        |
        v
  registro de exclusao: quando, quais destinos, resultado por destino

  destino sem confirmacao = exclusao incompleta, nao exclusao pendente`,
        },
        {
          type: 'paragraph',
          value:
            'The evaluation set is the trickiest case, because it has a legitimate reason to last a long time: without stable cases there is no comparison across system versions. The way out is not to carve an exception for personal data, it is to move the moment of anonymization. The case enters the eval already without identifiers, with names, phone numbers and order numbers replaced by consistent placeholders, and that is the version that lasts. When anonymization happens on the way in, a subject deletion request no longer forces a choice between complying with the law and losing the quality ruler.',
        },
        {
          type: 'paragraph',
          value:
            'Backups deserve the same honesty. An immutable backup is not deletable on demand, and promising otherwise invents a capability the architecture does not have. The defensible behavior is to declare the backup retention cycle, guarantee that data leaves it when the cycle turns, and ensure a restore never resurrects an already deleted record, which requires applying the deletion list as a mandatory step of the restore procedure. Without that step, every restore silently undoes months of fulfilled deletions.',
        },
      ],
    },
    {
      title: 'Purging that runs on its own and does not lock the database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A policy written and not executed is worse than no policy, because it creates the feeling that the problem is solved. Purging has to be a periodic, idempotent and observable process, and it has to delete in batches. A single delete statement over a large table locks writes, blows up the transaction log and ends up cancelled halfway, leaving the purge half done and the team afraid to run it again.',
        },
        {
          type: 'code',
          value: `// retention/purge.js
// Expurgo em lotes: idempotente, com teto por execucao e pausa entre lotes.
// Roda todo dia; se o volume acumulado for grande, converge em varios dias
// em vez de tentar limpar tudo numa transacao unica.

import { RETENTION } from './policy.js';

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 200;

export async function purgeExpired({ db, kind, now = new Date(), logger }) {
  const rule = RETENTION[kind];
  if (!rule || rule.days === null) return { kind, deleted: 0, skipped: true };

  const cutoff = new Date(now.getTime() - rule.days * 86400000);
  let total = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    // A acao depende da regra: apagar a linha ou apenas limpar o conteudo.
    const affected =
      rule.afterExpiry === 'redact'
        ? await db.redactContentBatch({ kind, cutoff, limit: BATCH_SIZE })
        : await db.deleteBatch({ kind, cutoff, limit: BATCH_SIZE });

    total += affected;
    if (affected < BATCH_SIZE) break; // acabou antes do teto
    await new Promise((resolve) => setTimeout(resolve, 200)); // folga para o banco
  }

  logger.info('retention.purge', { kind, action: rule.afterExpiry, cutoff, total });
  return { kind, deleted: total, skipped: false };
}

// A metrica que importa nao e quantos registros foram apagados, e sim
// qual e o registro mais velho que ainda esta vivo em cada classe.
export async function oldestSurviving({ db, kind }) {
  const rule = RETENTION[kind];
  const oldest = await db.oldestRecordAge({ kind });
  const overdue = rule.days !== null && oldest !== null && oldest > rule.days;
  return { kind, oldestDays: oldest, limitDays: rule.days, overdue };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The second function is what turns retention into something monitorable. Counting how many records the purge deleted says nothing about compliance: a day with no deletions may mean nothing was expired or that the job failed silently. The age of the oldest surviving record in each class answers the question that matters directly, and it is the right alert: if the oldest exceeds the declared deadline, something stopped, and the alert fires before anyone outside notices.',
        },
        {
          type: 'ordered',
          items: [
            'Run the purge daily, even with no volume, so failure shows up as failure and not as an absence of expired data.',
            'Delete in batches with a pause between them, and accept converging over several days when there is historical accumulation.',
            'Emit, per class, the age of the oldest surviving record and alert when it exceeds the declared deadline.',
            'Make the purge idempotent: rerunning after a mid-run crash has to be safe and cheap.',
            'Run it first in counting mode in the production environment, compare against expectations, and only then turn on real deletion.',
            'Include external destinations in the same job, because the vector index and the cache are usually the only ones nobody scheduled.',
          ],
        },
      ],
    },
    {
      title: 'Proving you deleted, not trusting that you deleted',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a deletion request arrives, the difference between a mature system and an improvised one is not being able to delete, it is being able to say exactly what was deleted, where and when. That requires treating deletion as a distributed operation with per-destination confirmation, not as a call that returns true. Each destination confirms individually, the result is recorded, and a missing confirmation from one destination is an incomplete deletion, not a pending deletion someone will remember to finish.',
        },
        {
          type: 'paragraph',
          value:
            'The record of that operation is an interesting exception to the policy itself: it has to outlive the data it deleted, and for that reason it must contain only the pseudonymized subject identifier, the list of destinations and the result of each one. A deletion record that stores the name of whoever requested the deletion is exactly the kind of contradiction that surfaces in the first audit.',
        },
        {
          type: 'table',
          columns: ['Audit question', 'Fragile answer', 'Defensible answer'],
          rows: [
            [
              'Where does this data live?',
              'In the conversation database',
              'Inventory per class with owner, purpose and deadline',
            ],
            [
              'Did you delete it?',
              'We ran the delete',
              'Record with destination, timestamp and per-destination confirmation',
            ],
            [
              'What about the backup?',
              'Backups are immutable',
              'Declared cycle and deletion list applied on restore',
            ],
            [
              'What about the eval and the vector index?',
              'That is technical data',
              'Eval anonymized on the way in, vector deleted by subject key',
            ],
            [
              'How do you know it still works?',
              'The job is scheduled',
              'Age of the oldest surviving record, per class, with an alert',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The middle column is not a caricature: those are the real answers competent teams give when they have never had to formalize retention. All of them sound reasonable and none of them is verifiable, and that is precisely the difference. The right-hand column requires no expensive tooling and no six-month project; it requires that the inventory exists, that the deadline lives in code, that the purge runs with a metric and that deletion leaves a trail.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth closing with the side effect that almost never enters the conversation: good retention cuts cost and improves quality. A smaller vector index searches faster and retrieves less stale junk, a clean cache makes fewer mistakes, a trace with short-lived content costs less in storage and an anonymized eval lasts longer without becoming a liability. The retention policy legal asks for is the same one engineering should want, and presenting it that way is what gets it off paper.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need to delete from the vector index or is deleting the source document enough?',
      answer:
        'You need to delete from both, and this is one of the most common deletion failures in RAG systems. The embedding is not the text, but it derives from it with enough information for a retrieved passage to reappear inside a generated answer, so an index that still holds the vectors keeps serving content from a document that officially no longer exists. Add to that the fact that many indexes mark the record as removed without compacting immediately, and the vector stays materially present until the next rebuild. The design that makes this workable is storing, next to every vector, the subject key and the source document key, so deletion is a lookup by key and not a scan by similarity, and scheduling compaction as part of the procedure rather than as occasional maintenance.',
    },
    {
      question: 'How do I keep a stable evaluation set if I have to delete customer data?',
      answer:
        'By moving the moment of anonymization instead of carving an exception for the eval. If the case enters the set already without identifiers, with names, phone numbers, emails and order numbers replaced by consistent placeholders that preserve the structure of the case, what lasts is a version that is not personal data, and a subject deletion request stops colliding with the need to compare system versions over time. The mistake is going the other way, storing the raw case and promising to anonymize later: late anonymization always arrives incomplete, because identifiers show up in the middle of free text and not only in structured fields. When a specific case still has to go, remove the case and record the set version change, so the historical quality series stays readable.',
    },
    {
      question: 'How do I handle backups, if they are immutable by definition?',
      answer:
        'By being explicit about what the architecture can actually do instead of promising immediate deletion where it does not exist. The defensible behavior has three parts: declare the backup retention cycle, guarantee the data naturally leaves it when the cycle turns, and treat the list of deleted records as a mandatory step of the restore procedure. That third part is the one almost every team forgets, and the most important, because without it any restore silently resurrects months of fulfilled deletions and the system returns to a state that had already been corrected. Document the cycle, test the restore with the list applied at least once, and keep the record of that validation alongside the procedure.',
    },
  ],
  conclusion: {
    title: 'Retention is architecture design, not a configuration field',
    description:
      'The customer message does not sit in one place: it multiplies across the conversation, the webhook payload, the trace, the vector index, the agent memory, the cache, the eval and the log, and each copy is born with a different purpose and almost always without a deadline. Doing the inventory per copy, deriving deadlines from purpose instead of habit, separating content from metadata, anonymizing the eval on the way in, deleting vectors by subject key, running batched purges with an alert on the age of the oldest surviving record and recording every deletion per destination is what turns a promise into something verifiable. I can map where your AI system data really lives, write the policy in code, turn on purging with a metric and leave the deletion flow with per-destination proof, so the answer to an audit is a record and not a memory.',
    cta: 'Talk about data retention in my AI system',
  },
  related: [
    { label: 'Anonymizing data before sending it to the LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Audit trail for AI agents', to: '/blog/trilha-auditoria-agente-ia-provar-o-que-foi-decidido' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'Un sistema con IA guarda mucho más de lo que el equipo imagina. La conversación está en la base de la aplicación, pero la misma frase del cliente también está en el trace de observabilidad, en el payload crudo del webhook, en el índice vectorial, en la memoria de largo plazo del agente, en la caché semántica, en la fila de revisión humana, en el conjunto de evaluación y en el log de error que alguien dejó verboso para depurar un incidente de marzo. Cuando llega un pedido de eliminación, el equipo borra la fila de la conversación, responde que la borró, y el dato sigue vivo en seis lugares. La retención no es un campo de configuración, es una propiedad que hay que diseñar por copia, porque cada copia tiene un dueño, un propósito y un plazo distintos. Este artículo muestra cómo inventariar esas copias, cómo definir el plazo a partir del propósito en vez de por costumbre, por qué borrar de un índice vectorial y de un conjunto de evaluación es técnicamente distinto de borrar de una tabla, y cómo probar que la eliminación realmente ocurrió en vez de confiar en que ocurrió.',
  sections: [
    {
      title: 'El dato no está en un lugar, está en ocho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer error de retención es mental: el equipo piensa la conversación como un registro, cuando es un rastro que se esparce por todo el pipeline. Cada componente que toca el mensaje crea una copia, y esa copia casi siempre nace sin plazo, porque fue creada para resolver un problema operativo inmediato, no para ser gobernada. El trace se creó para depurar latencia, la caché para ahorrar una llamada, el eval para medir calidad, y ninguno fue pensado como repositorio de dato personal, pero todos lo son.',
        },
        {
          type: 'paragraph',
          value:
            'Antes de escribir cualquier política, hacé el inventario. No necesita herramienta: necesita una línea por lugar donde aterriza el mensaje del cliente, con quién escribe, quién lee, y qué se rompe si eso desaparece mañana. La última columna es la más importante, porque es la que separa lo que tiene propósito real de lo que solo está ahí por inercia.',
        },
        {
          type: 'table',
          columns: ['Dónde vive la copia', 'Por qué existe', 'Plazo típico defendible', 'Qué se rompe si se borra'],
          rows: [
            [
              'Base de la conversación',
              'Continuidad de la atención e historial del cliente',
              'Mientras dure la relación, más el plazo legal aplicable',
              'El cliente pierde su propio historial',
            ],
            [
              'Payload crudo del webhook',
              'Reprocesar una entrega fallida',
              '7 a 30 días',
              'Nada después de la ventana de reprocesamiento',
            ],
            [
              'Trace de observabilidad',
              'Depurar incidentes y atribuir costo',
              '15 a 30 días con contenido, más tiempo solo con metadato',
              'La investigación de un incidente viejo queda ciega',
            ],
            [
              'Índice vectorial del RAG',
              'Recuperar contexto relevante',
              'Mientras exista el documento de origen',
              'La respuesta pierde la fuente, no solo el texto',
            ],
            [
              'Memoria de largo plazo del agente',
              'Personalizar sin volver a preguntar',
              'Plazo propio, en general menor que el de la conversación',
              'El agente vuelve a preguntar lo que ya sabía',
            ],
            [
              'Caché semántica',
              'Recortar costo y latencia',
              'Horas a pocos días',
              'Sube el costo y la latencia, nada más',
            ],
            [
              'Conjunto de evaluación',
              'Medir regresión entre versiones',
              'Largo, pero solo con dato anonimizado',
              'La serie histórica de calidad pierde comparabilidad',
            ],
            [
              'Log de error de la aplicación',
              'Diagnóstico de fallas',
              '15 a 30 días',
              'Nada, si queda el metadato estructurado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos filas de esa tabla suelen sorprender. El log de error entra en el inventario porque, en pleno incidente, alguien siempre loguea el prompt entero para entender qué pasó, y ese log queda en un sistema con retención pensada para volumen, no para privacidad. Y la caché semántica es la que tiene el plazo más corto de todos y casi siempre es la que nadie recuerda limpiar, porque es invisible cuando funciona.',
        },
      ],
    },
    {
      title: 'El plazo viene del propósito, no de la costumbre',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La pregunta "¿por cuánto tiempo lo guardamos?" no tiene respuesta genérica, y el número que la mayoría de los equipos elige viene de costumbre de infraestructura, no de análisis. Cuando alguien responde noventa días sin dudar, en general noventa días es el valor por defecto de la herramienta de logs. La pregunta correcta es otra: qué decisión sostiene esa copia, y por cuánto tiempo esa decisión todavía puede tomarse. Si la ventana de disputa de facturación es de sesenta días, el trace con contenido no necesita pasar de ahí. Si el webhook solo reprocesa entregas fallidas dentro de siete días, el payload crudo no tiene por qué sobrevivir al octavo.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un segundo eje que resuelve buena parte de la tensión entre borrar y seguir operando: separar contenido de metadato. El contenido es la frase del cliente, el texto recuperado, la respuesta generada. El metadato es la duración, la cantidad de tokens, el modelo usado, la intención clasificada, si hubo traspaso. Casi todo panel operativo vive de metadato, y casi todo riesgo de privacidad vive de contenido. Cuando ambos quedan en la misma fila, el plazo del contenido contamina el del metadato, y el equipo termina eligiendo entre perder la serie histórica de costo y guardar texto que ya debería haber desaparecido.',
        },
        {
          type: 'code',
          value: `// retention/policy.js
// A politica vive no codigo, nao na cabeca de quem configurou o banco.
// Cada classe de dado declara proposito, prazo e o que sobra depois do prazo.

export const RETENTION = {
  conversation_content: { days: 365, afterExpiry: 'delete', purpose: 'historico do cliente' },
  conversation_metadata: { days: 1095, afterExpiry: 'keep', purpose: 'serie de volume e custo' },
  webhook_payload: { days: 7, afterExpiry: 'delete', purpose: 'reprocessar entrega falha' },
  trace_content: { days: 30, afterExpiry: 'redact', purpose: 'depurar incidente' },
  trace_metadata: { days: 400, afterExpiry: 'keep', purpose: 'latencia e custo por rota' },
  agent_memory: { days: 180, afterExpiry: 'delete', purpose: 'personalizacao sem repergunta' },
  semantic_cache: { days: 2, afterExpiry: 'delete', purpose: 'custo e latencia' },
  eval_case: { days: null, afterExpiry: 'keep', purpose: 'regressao', requiresAnonymization: true },
};

// Prazo nulo so e aceito quando o dado ja entrou anonimizado.
// A checagem roda no boot: politica invalida derruba o processo em vez
// de virar um dado pessoal guardado para sempre por descuido.
export function assertPolicyIsSound() {
  for (const [name, rule] of Object.entries(RETENTION)) {
    if (rule.days === null && !rule.requiresAnonymization) {
      throw new Error(\`Retencao infinita sem anonimizacao em "\${name}".\`);
    }
    if (rule.days !== null && rule.days <= 0) {
      throw new Error(\`Prazo invalido em "\${name}".\`);
    }
  }
}

export function expiresAt(kind, createdAt) {
  const rule = RETENTION[kind];
  if (!rule) throw new Error(\`Classe de dado desconhecida: "\${kind}".\`);
  if (rule.days === null) return null;
  return new Date(createdAt.getTime() + rule.days * 86400000);
}`,
        },
        {
          type: 'paragraph',
          value:
            'La verificación en el arranque parece exagerada hasta la primera vez que alguien agrega una clase nueva de dato y se olvida del plazo. Sin ella, el valor ausente se convierte en retención infinita silenciosa, que es exactamente el estado que la política existe para evitar. Con ella, el olvido tira abajo el deploy en el entorno de pruebas, que es el momento barato de descubrir el problema.',
        },
        {
          type: 'list',
          items: [
            'Escribí el propósito de cada clase antes del plazo: si nadie puede escribir el propósito en una frase, esa copia probablemente no debería existir.',
            'Tratá "redactar" como una acción de primera clase junto a "borrar": mucho trace necesita sobrevivir sin el contenido, y borrar la fila entera destruye también la serie de latencia.',
            'Un plazo distinto por clase es lo normal, no la excepción: forzar un plazo único para todo siempre guarda de más en un lugar y de menos en otro.',
            'Registrá el plazo junto al dato, no solo en la configuración global, porque el dato migra de base y la configuración se queda atrás.',
            'Encendé la purga desde el primer día, incluso con volumen bajo: una política que empieza a correr después de dos años de acumulación es un proyecto de limpieza, no una política.',
          ],
        },
      ],
    },
    {
      title: 'Borrar de un índice vectorial y de un eval no es borrar de una tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En una tabla relacional, borrar es una operación conocida: una fila desaparece, las claves foráneas avisan, y el resultado es verificable con una consulta. En los dos componentes que más caracterizan a un sistema con IA, el índice vectorial y el conjunto de evaluación, borrar tiene trampas propias, y ahí es donde la mayoría de las eliminaciones queda por la mitad.',
        },
        {
          type: 'paragraph',
          value:
            'En el índice vectorial, el embedding no es el texto, pero deriva de él, y un vecino recuperado puede reconstruir buena parte del contenido original dentro de una respuesta generada. Eso significa que borrar el documento de origen sin borrar los vectores derivados no resuelve nada: el RAG sigue recuperando fragmentos de un documento que oficialmente ya no existe. Peor todavía, muchos índices marcan el registro como eliminado sin compactar, y el vector sigue materialmente presente hasta la próxima reconstrucción. La regla práctica es guardar, junto a cada vector, la clave del titular y la del documento de origen, para que la eliminación sea una consulta por clave y no un barrido por similitud.',
        },
        {
          type: 'diagram',
          value: `Um pedido de exclusao, oito destinos

  pedido de exclusao (titular X)
        |
        v
  +-- resolver identidade -------------------------+
  |  telefone, id externo, id interno, id de sessao|
  +------------------------------------------------+
        |
        +--> banco da conversa ........ DELETE por titular
        +--> payload de webhook ....... DELETE por titular
        +--> trace de observabilidade . REDIGIR conteudo, manter metadado
        +--> indice vetorial .......... DELETE por chave de titular
        |                               + reconstruir/compactar
        +--> memoria do agente ........ DELETE por titular
        +--> cache semantico .......... INVALIDAR entradas do titular
        +--> conjunto de avaliacao .... ANONIMIZAR ou remover o caso
        +--> backup ................... marcar para expurgo no ciclo
                                        (nao restaurar dado apagado)
        |
        v
  registro de exclusao: quando, quais destinos, resultado por destino

  destino sem confirmacao = exclusao incompleta, nao exclusao pendente`,
        },
        {
          type: 'paragraph',
          value:
            'El conjunto de evaluación es el caso más delicado, porque tiene una razón legítima para durar mucho: sin casos estables no existe comparación entre versiones del sistema. La salida no es abrir una excepción para el dato personal, es cambiar el momento de la anonimización. El caso entra al eval ya sin identificadores, con nombres, teléfonos y números de pedido reemplazados por marcadores consistentes, y esa es la versión que dura. Cuando la anonimización ocurre en la entrada, el pedido de eliminación del titular deja de obligar a elegir entre cumplir la ley y perder la regla de calidad.',
        },
        {
          type: 'paragraph',
          value:
            'El backup merece la misma honestidad. Un backup inmutable no es borrable a demanda, y prometer lo contrario es inventar una capacidad que la arquitectura no tiene. El comportamiento defendible es declarar el ciclo de retención del backup, garantizar que el dato sale de él cuando el ciclo gira, y asegurar que una restauración nunca resucite un registro ya eliminado, lo que exige aplicar la lista de eliminaciones como paso obligatorio del procedimiento de restore. Sin ese paso, todo restore deshace en silencio meses de eliminaciones cumplidas.',
        },
      ],
    },
    {
      title: 'Purga que corre sola y no traba la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una política escrita y no ejecutada es peor que ninguna política, porque crea la sensación de que el problema está resuelto. La purga tiene que ser un proceso periódico, idempotente y observable, y tiene que borrar en lotes. Un único comando de eliminación sobre una tabla grande traba la escritura, revienta el log de transacciones y termina cancelado por la mitad, dejando la purga incompleta y al equipo con miedo de volver a correrla.',
        },
        {
          type: 'code',
          value: `// retention/purge.js
// Expurgo em lotes: idempotente, com teto por execucao e pausa entre lotes.
// Roda todo dia; se o volume acumulado for grande, converge em varios dias
// em vez de tentar limpar tudo numa transacao unica.

import { RETENTION } from './policy.js';

const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 200;

export async function purgeExpired({ db, kind, now = new Date(), logger }) {
  const rule = RETENTION[kind];
  if (!rule || rule.days === null) return { kind, deleted: 0, skipped: true };

  const cutoff = new Date(now.getTime() - rule.days * 86400000);
  let total = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    // A acao depende da regra: apagar a linha ou apenas limpar o conteudo.
    const affected =
      rule.afterExpiry === 'redact'
        ? await db.redactContentBatch({ kind, cutoff, limit: BATCH_SIZE })
        : await db.deleteBatch({ kind, cutoff, limit: BATCH_SIZE });

    total += affected;
    if (affected < BATCH_SIZE) break; // acabou antes do teto
    await new Promise((resolve) => setTimeout(resolve, 200)); // folga para o banco
  }

  logger.info('retention.purge', { kind, action: rule.afterExpiry, cutoff, total });
  return { kind, deleted: total, skipped: false };
}

// A metrica que importa nao e quantos registros foram apagados, e sim
// qual e o registro mais velho que ainda esta vivo em cada classe.
export async function oldestSurviving({ db, kind }) {
  const rule = RETENTION[kind];
  const oldest = await db.oldestRecordAge({ kind });
  const overdue = rule.days !== null && oldest !== null && oldest > rule.days;
  return { kind, oldestDays: oldest, limitDays: rule.days, overdue };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La segunda función es la que convierte la retención en algo monitoreable. Contar cuántos registros borró la purga no dice nada sobre cumplimiento: un día sin eliminaciones puede significar que no había nada vencido o que el job falló en silencio. La edad del registro más viejo vivo en cada clase responde directamente la pregunta que importa, y es la alerta correcta: si el más viejo pasa el plazo declarado, algo se detuvo, y la alerta se dispara antes de que alguien de afuera lo note.',
        },
        {
          type: 'ordered',
          items: [
            'Corré la purga todos los días, incluso sin volumen, para que la falla aparezca como falla y no como ausencia de dato vencido.',
            'Borrá en lotes con pausa entre ellos, y aceptá converger en varios días cuando haya acumulación histórica.',
            'Emití por clase la edad del registro más viejo vivo y alertá cuando supere el plazo declarado.',
            'Hacé la purga idempotente: volver a ejecutarla después de una caída a mitad de camino tiene que ser seguro y barato.',
            'Corré primero en modo de conteo en el entorno de producción, comparalo con lo esperado, y recién después encendé la eliminación real.',
            'Incluí los destinos externos en el mismo job, porque el índice vectorial y la caché suelen ser los únicos que nadie agendó.',
          ],
        },
      ],
    },
    {
      title: 'Probar que borraste, no confiar en que borraste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando llega un pedido de eliminación, la diferencia entre un sistema maduro y uno improvisado no está en poder borrar, está en poder decir exactamente qué se borró, dónde y cuándo. Eso exige tratar la eliminación como una operación distribuida con confirmación por destino, y no como una llamada que devuelve verdadero. Cada destino confirma individualmente, el resultado queda registrado, y la ausencia de confirmación de un destino es una eliminación incompleta, no una eliminación pendiente que alguien va a recordar terminar.',
        },
        {
          type: 'paragraph',
          value:
            'El registro de esa operación es una excepción interesante a la propia política: tiene que durar más que el dato que borró, y por eso debe contener solo el identificador seudonimizado del titular, la lista de destinos y el resultado de cada uno. Un registro de eliminación que guarda el nombre de quien pidió la eliminación es justamente el tipo de contradicción que aparece en la primera auditoría.',
        },
        {
          type: 'table',
          columns: ['Pregunta de la auditoría', 'Respuesta frágil', 'Respuesta defendible'],
          rows: [
            [
              '¿Dónde está ese dato?',
              'En la base de conversaciones',
              'Inventario por clase con dueño, propósito y plazo',
            ],
            [
              '¿Lo borraron?',
              'Corrimos el delete',
              'Registro con destino, horario y confirmación por destino',
            ],
            [
              '¿Y en el backup?',
              'El backup es inmutable',
              'Ciclo declarado y lista de eliminación aplicada en el restore',
            ],
            [
              '¿Y en el eval y en el índice vectorial?',
              'Eso es dato técnico',
              'Eval anonimizado en la entrada, vector borrado por clave de titular',
            ],
            [
              '¿Cómo saben que sigue funcionando?',
              'El job está agendado',
              'Edad del registro más viejo vivo, por clase, con alerta',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La columna del medio no es una caricatura: son las respuestas reales que dan equipos competentes cuando nunca tuvieron que formalizar la retención. Todas suenan razonables y ninguna es verificable, y justamente esa es la diferencia. La columna de la derecha no exige herramienta cara ni un proyecto de seis meses; exige que el inventario exista, que el plazo esté en el código, que la purga corra con métrica y que la eliminación deje rastro.',
        },
        {
          type: 'paragraph',
          value:
            'Vale cerrar con el efecto colateral que casi nunca entra en la conversación: una retención bien hecha baja el costo y mejora la calidad. Un índice vectorial más chico busca más rápido y recupera menos basura vieja, una caché limpia se equivoca menos, un trace con contenido corto cuesta menos en almacenamiento y un eval anonimizado dura más sin volverse un pasivo. La política de retención que pide el área legal es la misma que ingeniería debería querer, y presentarla así es lo que la saca del papel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito borrar el dato del índice vectorial o alcanza con borrar el documento de origen?',
      answer:
        'Hay que borrar de los dos, y esta es una de las fallas de eliminación más comunes en sistemas con RAG. El embedding no es el texto, pero deriva de él con información suficiente para que un fragmento recuperado reaparezca dentro de una respuesta generada, así que un índice que todavía contiene los vectores sigue entregando contenido de un documento que oficialmente ya no existe. Sumá a eso que muchos índices marcan el registro como eliminado sin compactar de inmediato, y el vector permanece materialmente presente hasta la próxima reconstrucción. El diseño que lo hace viable es guardar, junto a cada vector, la clave del titular y la clave del documento de origen, para que la eliminación sea una consulta por clave y no un barrido por similitud, y agendar la compactación como parte del procedimiento y no como mantenimiento ocasional.',
    },
    {
      question: '¿Cómo mantengo un conjunto de evaluación estable si tengo que borrar datos de clientes?',
      answer:
        'Cambiando el momento de la anonimización en vez de abrir una excepción para el eval. Si el caso entra al conjunto ya sin identificadores, con nombre, teléfono, correo y número de pedido reemplazados por marcadores consistentes que preservan la estructura del caso, lo que dura es una versión que no es dato personal, y el pedido de eliminación del titular deja de chocar con la necesidad de comparar versiones del sistema a lo largo del tiempo. El error es hacer el camino inverso, guardar el caso crudo y prometer anonimizar después: la anonimización tardía siempre llega incompleta, porque los identificadores aparecen en medio del texto libre y no solo en los campos estructurados. Cuando un caso específico igual tenga que salir, remové el caso y registrá el cambio de versión del conjunto, para que la serie histórica de calidad siga siendo legible.',
    },
    {
      question: '¿Cómo manejo el backup, si es inmutable por definición?',
      answer:
        'Siendo explícito sobre lo que la arquitectura puede hacer de verdad en vez de prometer una eliminación inmediata donde no existe. El comportamiento defendible tiene tres partes: declarar el ciclo de retención del backup, garantizar que el dato sale naturalmente de él cuando el ciclo gira, y tratar la lista de registros eliminados como paso obligatorio del procedimiento de restauración. Esa tercera parte es la que casi todo equipo olvida, y la más importante, porque sin ella cualquier restore resucita en silencio meses de eliminaciones ya cumplidas y el sistema vuelve a un estado que ya había sido corregido. Documentá el ciclo, probá la restauración con la lista aplicada al menos una vez, y guardá el registro de esa validación junto al procedimiento.',
    },
  ],
  conclusion: {
    title: 'La retención es diseño de arquitectura, no un campo de configuración',
    description:
      'El mensaje del cliente no queda en un lugar: se multiplica en la conversación, el payload del webhook, el trace, el índice vectorial, la memoria del agente, la caché, el eval y el log, y cada copia nace con un propósito distinto y casi siempre sin plazo. Hacer el inventario por copia, derivar el plazo del propósito en vez de la costumbre, separar contenido de metadato, anonimizar el eval en la entrada, borrar vectores por clave de titular, correr purgas en lotes con alerta por la edad del registro más viejo vivo y registrar cada eliminación por destino es lo que convierte una promesa en algo verificable. Puedo mapear dónde vive realmente el dato de tu sistema de IA, escribir la política en el código, encender la purga con métrica y dejar el flujo de eliminación con prueba por destino, para que la respuesta a una auditoría sea un registro y no un recuerdo.',
    cta: 'Hablar sobre retención de datos en mi sistema de IA',
  },
  related: [
    { label: 'Anonimizar datos antes de mandarlos al LLM', to: '/blog/anonimizacao-dados-antes-de-mandar-para-llm' },
    { label: 'Traza de auditoría de agentes de IA', to: '/blog/trilha-auditoria-agente-ia-provar-o-que-foi-decidido' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default { pt, en, es };
