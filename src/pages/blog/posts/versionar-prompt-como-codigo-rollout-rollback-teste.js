// Conteudo do artigo: versionar o prompt como codigo, com rollout, rollback e teste.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Registro de prompts versionados com rollout gradual e rollback rápido: cada prompt tem um id imutável de versão, um manifesto declara qual versão atende qual fatia de tráfego, o rollout sobe a nova versão para uma porcentagem antes de todo mundo e o rollback troca o ponteiro sem redeploy, com uma suíte de eval que roda como gate no CI e bloqueia a promoção de uma versão que regride.',
  en: 'Versioned prompt registry with gradual rollout and fast rollback: each prompt has an immutable version id, a manifest declares which version serves which slice of traffic, the rollout raises the new version to a percentage before everyone, and the rollback flips the pointer without a redeploy, with an eval suite that runs as a CI gate and blocks the promotion of a version that regresses.',
  es: 'Registro de prompts versionados con rollout gradual y rollback rápido: cada prompt tiene un id inmutable de versión, un manifiesto declara qué versión atiende qué porción del tráfico, el rollout sube la nueva versión a un porcentaje antes que a todos, y el rollback cambia el puntero sin redeploy, con una suite de eval que corre como gate en el CI y bloquea la promoción de una versión que regresa.',
};

const repoUrl = 'https://github.com/joaosouz4dev/prompt-versioning-mini';

const pt = {
  intro:
    'O prompt é o código mais crítico de um sistema com LLM e costuma ser o menos versionado. Uma string enorme escondida no meio de um arquivo, editada direto em produção porque "é só texto", trocada por alguém que queria melhorar uma resposta e piorou dez outras sem ninguém perceber. Quando a qualidade cai, não há como saber o que mudou, quando mudou nem como voltar ao que funcionava, porque a versão anterior não existe em lugar nenhum: foi sobrescrita. O prompt merece o mesmo rigor que o resto do código: um identificador de versão imutável, um histórico do que cada versão era, um rollout que expõe a mudança a uma fatia do tráfego antes de todo mundo, um rollback que volta em segundos e uma suíte de avaliação que barra a promoção de uma versão pior. Este artigo mostra como tratar o prompt como código de verdade, com registro versionado, manifesto de tráfego, rollout gradual, rollback sem redeploy e o gate de eval que impede a regressão de chegar ao cliente.',
  sections: [
    {
      title: 'Editar o prompt em produção é deploy sem versão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O prompt escapa do controle de versão por um motivo cultural: ele parece configuração, não código. É texto, cabe numa variável de ambiente, num campo de banco, num painel de administração, e a tentação de editar direto por ali é grande porque não exige build nem deploy. O problema é que essa edição é um deploy, o mais arriscado de todos, feito sem revisão, sem histórico e sem rollback. Quando alguém ajusta uma frase para melhorar um caso específico, essa frase muda o comportamento do modelo em todos os casos, e o efeito colateral só aparece dias depois, na forma de uma métrica de qualidade que caiu sem que nenhum commit explique por quê. A pergunta "o que mudou entre ontem e hoje" não tem resposta, porque a versão de ontem foi apagada no ato de salvar a de hoje.',
        },
        {
          type: 'paragraph',
          value:
            'O prompt tem todas as propriedades que exigem versionamento: ele muda o comportamento observável do sistema, o efeito de uma mudança é difícil de prever, e voltar atrás precisa ser rápido quando algo dá errado. Tratar o prompt como configuração ignora as duas primeiras propriedades e impossibilita a terceira. A inversão é encará-lo como o que ele é, um artefato de comportamento, e dar a ele o mesmo aparato do código: cada versão ganha um identificador imutável, nunca é editada no lugar, e a troca de qual versão está ativa é uma operação explícita e reversível, não uma edição de campo. O texto continua fácil de mudar, mas cada mudança vira uma versão nova rastreável em vez de uma sobrescrita silenciosa.',
        },
        {
          type: 'table',
          columns: ['Prompt como', 'Como muda', 'O que falta quando quebra'],
          rows: [
            [
              'Configuração editável',
              'Sobrescreve o texto no painel ou no banco',
              'Histórico, revisão e a versão anterior para voltar',
            ],
            [
              'Constante no código',
              'Vai junto no deploy, mas sem rollout parcial',
              'Testar numa fatia antes de todos e reverter sem redeploy',
            ],
            [
              'Artefato versionado',
              'Cria versão nova com id imutável; ponteiro escolhe a ativa',
              'Nada: histórico, rollout gradual e rollback ficam de graça',
            ],
          ],
        },
      ],
    },
    {
      title: 'Versão imutável: o prompt tem um id, não um lugar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A base de tudo é a imutabilidade: uma versão de prompt, uma vez criada, nunca muda. Não se edita a versão 3, cria-se a versão 4. Cada versão carrega o texto completo, o modelo e os parâmetros com que foi pensada, e um identificador que a acompanha por toda a vida, nos logs, nas métricas e no rollout. Esse identificador precisa ser derivado do conteúdo, não um contador que alguém incrementa à mão: um hash do texto mais os parâmetros garante que duas versões idênticas colidem no mesmo id e que qualquer alteração, por menor que seja, produz um id diferente. Assim o id vira uma prova de qual texto exato rodou, e uma resposta salva com o id da versão 4 pode ser reproduzida byte a byte anos depois, porque a versão 4 nunca foi tocada.',
        },
        {
          type: 'paragraph',
          value:
            'Com a versão imutável e identificada pelo conteúdo, o log de cada chamada ao modelo passa a registrar não só a entrada e a saída, mas o id da versão de prompt que a produziu. Essa amarração é o que fecha o ciclo de diagnóstico: quando uma resposta ruim aparece, o id no log diz exatamente qual texto de prompt a gerou, e comparar dois ids diz se a diferença de qualidade veio de uma troca de prompt ou de outra coisa. Sem o id no log, a mesma investigação vira arqueologia: adivinhar qual versão estava ativa naquele momento a partir de timestamps e memória de quem mexeu. O id transforma "acho que foi quando mudamos o prompt" numa consulta determinística.',
        },
        {
          type: 'code',
          value: `// registry/version.js
// Uma versao de prompt e IMUTAVEL e identificada pelo conteudo.
// O id e um hash do texto + parametros: mesma versao, mesmo id;
// qualquer mudanca produz um id novo. Nunca se edita no lugar.

import { createHash } from 'node:crypto';

export function makePromptVersion({ template, model, params }) {
  const payload = JSON.stringify({ template, model, params });
  const id = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return Object.freeze({ id, template, model, params });
}

// O registro guarda todas as versoes por id. Adicionar nunca sobrescreve.
export function createRegistry() {
  const byId = new Map();
  return {
    add(version) {
      // Id derivado do conteudo: reinserir a mesma versao e no-op seguro.
      if (!byId.has(version.id)) byId.set(version.id, version);
      return version.id;
    },
    get(id) {
      const v = byId.get(id);
      if (!v) throw new Error('versao de prompt desconhecida: ' + id);
      return v;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'O manifesto de tráfego separa qual versão de quem a recebe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ter versões imutáveis resolve o histórico, mas não diz qual delas o cliente recebe agora. Essa decisão vive num artefato separado, o manifesto de tráfego: um mapa pequeno e legível que declara, para cada prompt, qual versão é a estável, qual é a candidata e que fatia do tráfego a candidata atende. O manifesto é a única coisa que muda quando se faz um rollout ou um rollback; as versões em si ficam paradas no registro. Essa separação é o que permite trocar de comportamento sem tocar no código: promover a candidata a estável é editar um campo do manifesto, e voltar é editar de novo. O texto do prompt e a decisão de quem o recebe deixam de ser a mesma coisa, e cada um muda no seu ritmo.',
        },
        {
          type: 'paragraph',
          value:
            'A fatia de tráfego precisa ser determinística por usuário, não aleatória por requisição. Se o sorteio fosse por chamada, o mesmo cliente cairia na versão nova numa mensagem e na antiga na seguinte, e a conversa ficaria esquizofrênica, mudando de tom e de regras no meio. A âncora certa é um identificador estável do usuário ou da conversa, passado por um hash que devolve um número entre zero e cem; se esse número cai abaixo da porcentagem da candidata, aquele usuário vê a versão nova de forma consistente em toda a sessão. O mesmo mecanismo dá o controle fino do rollout: dez por cento significa que só os usuários cujo hash cai na primeira décima parte veem a candidata, e subir para cinquenta é mexer num número, não redistribuir nada.',
        },
        {
          type: 'code',
          value: `// registry/manifest.js
// O manifesto declara, por prompt, a versao estavel, a candidata e a
// fatia da candidata. Trocar de comportamento e editar este mapa,
// nunca o texto de uma versao ja publicada.

import { createHash } from 'node:crypto';

// Ancora deterministica: mesmo usuario cai sempre na mesma versao.
function bucketOf(userId) {
  const h = createHash('sha256').update(String(userId)).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

export function resolveVersion(manifest, promptName, userId) {
  const entry = manifest[promptName];
  if (!entry) throw new Error('prompt sem manifesto: ' + promptName);

  // Sem candidata, todo mundo recebe a estavel.
  if (!entry.candidate || entry.rolloutPct <= 0) return entry.stable;

  // A fatia e por usuario, nao por requisicao: a conversa nao troca
  // de versao no meio.
  return bucketOf(userId) < entry.rolloutPct ? entry.candidate : entry.stable;
}`,
        },
      ],
    },
    {
      title: 'Rollout gradual: subir a versão para poucos antes de todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um prompt novo bom no laboratório pode ser ruim em produção por motivos que o teste não pegou: uma frase que induz o modelo a ser prolixo, uma instrução que conflita com um caso raro mas frequente o bastante para importar, um tom que soa estranho no canal real. O rollout gradual existe para que esse erro atinja poucos usuários antes de atingir todos. A candidata começa em uma fatia pequena, cinco ou dez por cento, e as métricas dessa fatia são comparadas com as da estável no mesmo período: se a candidata mantém ou melhora a qualidade sem piorar custo e latência, a fatia sobe; se degrada, para. A promoção é uma escada de porcentagens vigiada por métrica, não um salto de zero a cem por decreto.',
        },
        {
          type: 'paragraph',
          value:
            'O que torna o rollout confiável é comparar as duas versões na mesma janela de tempo, não a candidata de hoje contra a estável da semana passada. Tráfego muda ao longo do dia, o tipo de pergunta muda com o contexto, e uma comparação entre períodos diferentes confunde a mudança de prompt com a mudança de tráfego. Rodando estável e candidata lado a lado, cada uma na sua fatia, o mesmo perfil de perguntas passa pelas duas ao mesmo tempo, e a diferença nas métricas isola o efeito do prompt. As métricas que importam são as mesmas de qualquer mudança em sistema com LLM: sinais de qualidade da resposta, custo por chamada, latência e taxa de escalonamento para humano, cada uma quebrada por versão.',
        },
        {
          type: 'diagram',
          value: `Rollout gradual comparando na mesma janela

  manifesto: stable=v3  candidate=v4  rollout=10%
       |
  trafego ---+---> 90% -> v3 (estavel)  --> metricas v3
             |
             +---> 10% -> v4 (candidata) --> metricas v4
                          (por hash do usuario, estavel na sessao)

  compara v3 x v4 NA MESMA JANELA:
    qualidade  custo  latencia  escalonamento
       ok ------> sobe rollout: 10% -> 25% -> 50% -> 100%
       pior ----> para e volta: rollback para v3`,
        },
      ],
    },
    {
      title: 'Rollback sem redeploy: voltar é trocar um ponteiro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O rollback é a parte que justifica todo o resto. De nada adianta detectar que a candidata regrediu se voltar atrás exige um novo deploy, com build, fila de CI e minutos preciosos enquanto os clientes recebem respostas piores. Como a versão anterior é imutável e continua no registro, e como a escolha de qual versão está ativa vive no manifesto, o rollback é uma única operação: apontar a estável de volta para o id antigo e zerar a candidata. Nada é reconstruído, nenhuma versão é recuperada de backup, porque a versão boa nunca deixou de existir. O tempo entre "a candidata está pior" e "todo mundo voltou para a boa" é o tempo de escrever um valor no manifesto e propagá-lo, segundos, não um ciclo de deploy.',
        },
        {
          type: 'paragraph',
          value:
            'Para o rollback ser instantâneo de verdade, o manifesto não pode estar embutido no bundle da aplicação, senão trocá-lo exigiria justamente o redeploy que se quer evitar. Ele vive num lugar que a aplicação lê em runtime com um cache curto, um registro de configuração, um arquivo em armazenamento observado, uma chave em cache distribuído, e a troca se propaga para todas as instâncias em segundos. O cache precisa de um tempo de vida curto para que o rollback chegue rápido, e o custo dessa leitura frequente é pequeno porque o manifesto é minúsculo. O rollback também merece ser uma ação de primeira classe, um botão ou comando único que faz a troca e registra quem, quando e por quê, para que sob pressão ninguém precise editar JSON à mão no pior momento possível.',
        },
        {
          type: 'code',
          value: `// registry/rollout.js
// Promover e reverter sao edicoes do manifesto, nao deploys.
// A versao antiga nunca saiu do registro, entao voltar e instantaneo.

export function promote(manifest, promptName, pct) {
  const e = manifest[promptName];
  if (!e.candidate) throw new Error('sem candidata para promover');
  // Subir a fatia da candidata: 10 -> 25 -> 50. Em 100, vira estavel.
  if (pct >= 100) {
    return { ...manifest, [promptName]: { stable: e.candidate, candidate: null, rolloutPct: 0 } };
  }
  return { ...manifest, [promptName]: { ...e, rolloutPct: pct } };
}

export function rollback(manifest, promptName, reason) {
  const e = manifest[promptName];
  // Voltar e apontar a estavel para o id antigo e zerar a candidata.
  // Nenhum redeploy: a estavel imutavel sempre esteve la.
  logAudit({ action: 'rollback', promptName, from: e.candidate, to: e.stable, reason });
  return { ...manifest, [promptName]: { stable: e.stable, candidate: null, rolloutPct: 0 } };
}`,
        },
      ],
    },
    {
      title: 'O gate de eval barra a versão pior antes do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O rollout gradual limita o dano de uma versão ruim, mas o ideal é a versão ruim nem chegar ao rollout. Isso é papel do gate de eval: uma suíte de casos versionada, com entradas representativas e o que se espera de cada uma, que roda contra a candidata no CI antes da promoção. Alguns casos têm resposta certa verificável, um formato, um campo, uma classificação, e viram asserção direta; outros são subjetivos e usam um modelo como juiz calibrado, comparando a resposta da candidata com um critério. O gate falha o build quando a candidata regride abaixo de um limiar no dataset, e essa reprovação é o que impede que uma edição bem-intencionada de prompt vire uma regressão em produção. O prompt entra no mesmo fluxo de qualquer código: pull request, revisão, teste automático, merge.',
        },
        {
          type: 'ordered',
          items: [
            'Dataset versionado: casos representativos com entrada e resultado esperado, guardados junto do código e crescendo a cada bug real que virou caso de regressão.',
            'Eval objetiva onde dá: formato, campo obrigatório, classificação correta viram asserção determinística que passa ou falha sem ambiguidade.',
            'Juiz calibrado onde não dá: para qualidade subjetiva, um modelo julga contra um critério explícito, aferido contra rótulos humanos para não virar opinião solta.',
            'Gate no CI: a candidata só pode ser promovida se o score no dataset não regride abaixo do limiar; abaixo dele, o build falha e a promoção não acontece.',
            'Comparação contra a estável: o eval roda nas duas versões e compara, para separar uma queda causada pela candidata de uma dificuldade do próprio caso.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O gate de eval e o rollout gradual são duas redes em série, e é essa dupla que dá coragem para mexer no prompt com frequência. O gate pega a regressão previsível, a que o dataset já conhece; o rollout gradual pega a imprevisível, a que só aparece no tráfego real, e limita seu alcance a uma fatia enquanto as métricas decidem. Uma regressão que passe pelas duas ainda encontra o rollback instantâneo como última linha. Com as três em conjunto, versão imutável no registro, gate no CI e rollout com rollback no manifesto, mudar um prompt deixa de ser uma aposta feita direto em produção e vira uma operação de engenharia como qualquer outra, testável, observável e reversível.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que versionar o prompt em vez de editá-lo direto em produção?',
      answer:
        'Porque editar o prompt direto é um deploy disfarçado, o mais arriscado de todos: feito sem revisão, sem histórico e sem rollback. O prompt muda o comportamento observável do sistema, o efeito de uma alteração é difícil de prever, e voltar atrás precisa ser rápido, exatamente as propriedades que exigem versionamento. Quando alguém ajusta uma frase para melhorar um caso, essa frase muda o modelo em todos os casos, e a queda de qualidade só aparece dias depois sem nenhum commit que explique. Tratar o prompt como artefato versionado, com id imutável derivado do conteúdo, dá o histórico do que cada versão era, amarra cada resposta à versão que a gerou e torna a troca de comportamento uma operação explícita e reversível em vez de uma sobrescrita silenciosa.',
    },
    {
      question: 'Como fazer o rollout gradual de um prompt novo sem quebrar a conversa?',
      answer:
        'Colocando a versão candidata numa fatia pequena do tráfego, cinco ou dez por cento, e escolhendo essa fatia de forma determinística por usuário, não aleatória por requisição. Um hash de um identificador estável do usuário ou da conversa devolve um número entre zero e cem; se ele cai abaixo da porcentagem da candidata, aquele usuário vê a versão nova de forma consistente em toda a sessão, e a conversa não troca de tom no meio. As métricas da candidata são comparadas com as da estável na mesma janela de tempo, cada uma na sua fatia, para isolar o efeito do prompt da variação natural do tráfego. Se qualidade, custo, latência e escalonamento se mantêm ou melhoram, a fatia sobe em degraus; se degradam, para e volta.',
    },
    {
      question: 'O que torna o rollback de um prompt instantâneo?',
      answer:
        'Duas coisas: a versão anterior ser imutável e continuar no registro, e a escolha de qual versão está ativa viver num manifesto separado do texto. Como a versão boa nunca foi sobrescrita nem apagada, voltar não reconstrói nada, apenas aponta o ponteiro da estável de volta para o id antigo e zera a candidata, uma edição de um valor pequeno. Para isso ser realmente rápido, o manifesto não pode estar embutido no bundle, senão trocá-lo exigiria o redeploy que se quer evitar; ele vive num registro de configuração lido em runtime com cache curto, e a troca se propaga para todas as instâncias em segundos. O rollback merece ser uma ação de primeira classe, um botão que faz a troca e registra quem, quando e por quê, para que ninguém edite JSON à mão sob pressão.',
    },
  ],
  conclusion: {
    title: 'O prompt é código: merece versão, rollout e rollback',
    description:
      'Um prompt editado direto em produção é um deploy sem versão, sem revisão e sem volta: quando a qualidade cai, não há como saber o que mudou nem como reverter, porque a versão anterior foi sobrescrita. Tratar o prompt como código, uma versão imutável com id derivado do conteúdo no registro, um manifesto que separa qual versão de quem a recebe, um rollout gradual comparado na mesma janela, um rollback que troca um ponteiro sem redeploy e um gate de eval que barra a regressão no CI, transforma cada mudança de prompt de uma aposta numa operação de engenharia testável e reversível. Posso montar esse fluxo de prompt versionado no seu sistema com LLM, do registro imutável ao gate de eval no CI, para que você mude o prompt com a mesma frequência e a mesma segurança com que muda qualquer código.',
    cta: 'Falar sobre versionar prompt no meu sistema com LLM',
  },
  related: [
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidade de LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'prompt-versioning-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The prompt is the most critical code in an LLM system and tends to be the least versioned. A huge string hidden in the middle of a file, edited straight in production because "it is just text", swapped by someone who wanted to improve one answer and made ten others worse without anyone noticing. When quality drops, there is no way to know what changed, when it changed or how to go back to what worked, because the previous version exists nowhere: it was overwritten. The prompt deserves the same rigor as the rest of the code: an immutable version identifier, a history of what each version was, a rollout that exposes the change to a slice of traffic before everyone, a rollback that returns in seconds and an evaluation suite that blocks the promotion of a worse version. This article shows how to treat the prompt as real code, with a versioned registry, a traffic manifest, a gradual rollout, a rollback without redeploy and the eval gate that stops a regression from reaching the customer.',
  sections: [
    {
      title: 'Editing the prompt in production is a deploy without a version',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The prompt escapes version control for a cultural reason: it looks like configuration, not code. It is text, it fits in an environment variable, a database field, an admin panel, and the temptation to edit it right there is strong because it requires no build and no deploy. The problem is that this edit is a deploy, the riskiest of all, done without review, without history and without rollback. When someone tweaks a sentence to improve a specific case, that sentence changes the model behavior in every case, and the side effect only shows up days later, as a quality metric that dropped with no commit to explain why. The question "what changed between yesterday and today" has no answer, because yesterday version was erased in the act of saving today one.',
        },
        {
          type: 'paragraph',
          value:
            'The prompt has all the properties that demand versioning: it changes the observable behavior of the system, the effect of a change is hard to predict, and going back must be fast when something goes wrong. Treating the prompt as configuration ignores the first two properties and makes the third impossible. The inversion is to see it as what it is, a behavior artifact, and give it the same apparatus as code: each version gets an immutable identifier, is never edited in place, and switching which version is active is an explicit and reversible operation, not a field edit. The text stays easy to change, but each change becomes a new traceable version instead of a silent overwrite.',
        },
        {
          type: 'table',
          columns: ['Prompt as', 'How it changes', 'What is missing when it breaks'],
          rows: [
            [
              'Editable configuration',
              'Overwrites the text in the panel or the database',
              'History, review and the previous version to return to',
            ],
            [
              'Constant in the code',
              'Ships with the deploy, but no partial rollout',
              'Testing on a slice before everyone and reverting without redeploy',
            ],
            [
              'Versioned artifact',
              'Creates a new version with immutable id; a pointer picks the active one',
              'Nothing: history, gradual rollout and rollback come for free',
            ],
          ],
        },
      ],
    },
    {
      title: 'Immutable version: the prompt has an id, not a place',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The foundation of everything is immutability: a prompt version, once created, never changes. You do not edit version 3, you create version 4. Each version carries the full text, the model and the parameters it was designed with, and an identifier that follows it for life, in the logs, the metrics and the rollout. That identifier must be derived from the content, not a counter someone bumps by hand: a hash of the text plus the parameters guarantees that two identical versions collide on the same id and that any change, however small, produces a different id. So the id becomes proof of which exact text ran, and an answer saved with the id of version 4 can be reproduced byte for byte years later, because version 4 was never touched.',
        },
        {
          type: 'paragraph',
          value:
            'With the version immutable and identified by content, the log of each model call records not only the input and the output but the id of the prompt version that produced it. That binding is what closes the diagnosis loop: when a bad answer appears, the id in the log says exactly which prompt text generated it, and comparing two ids says whether the quality difference came from a prompt swap or from something else. Without the id in the log, the same investigation becomes archaeology: guessing which version was active at that moment from timestamps and the memory of whoever touched it. The id turns "I think it was when we changed the prompt" into a deterministic query.',
        },
        {
          type: 'code',
          value: `// registry/version.js
// A prompt version is IMMUTABLE and identified by content.
// The id is a hash of the text + params: same version, same id;
// any change produces a new id. It is never edited in place.

import { createHash } from 'node:crypto';

export function makePromptVersion({ template, model, params }) {
  const payload = JSON.stringify({ template, model, params });
  const id = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return Object.freeze({ id, template, model, params });
}

// The registry keeps every version by id. Adding never overwrites.
export function createRegistry() {
  const byId = new Map();
  return {
    add(version) {
      // Id derived from content: re-adding the same version is a safe no-op.
      if (!byId.has(version.id)) byId.set(version.id, version);
      return version.id;
    },
    get(id) {
      const v = byId.get(id);
      if (!v) throw new Error('unknown prompt version: ' + id);
      return v;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'The traffic manifest separates which version from who gets it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Having immutable versions solves the history but does not say which one the customer gets now. That decision lives in a separate artifact, the traffic manifest: a small, readable map that declares, for each prompt, which version is stable, which is the candidate and what slice of traffic the candidate serves. The manifest is the only thing that changes on a rollout or a rollback; the versions themselves sit still in the registry. That separation is what lets you switch behavior without touching the code: promoting the candidate to stable is editing a manifest field, and reverting is editing it again. The prompt text and the decision of who receives it stop being the same thing, and each changes at its own pace.',
        },
        {
          type: 'paragraph',
          value:
            'The traffic slice must be deterministic per user, not random per request. If the draw were per call, the same customer would land on the new version in one message and the old one in the next, and the conversation would go schizophrenic, changing tone and rules midway. The right anchor is a stable identifier of the user or the conversation, passed through a hash that returns a number between zero and a hundred; if that number falls below the candidate percentage, that user sees the new version consistently across the whole session. The same mechanism gives fine control of the rollout: ten percent means only the users whose hash falls in the first tenth see the candidate, and raising it to fifty is changing a number, not redistributing anything.',
        },
        {
          type: 'code',
          value: `// registry/manifest.js
// The manifest declares, per prompt, the stable version, the candidate
// and the candidate slice. Switching behavior is editing this map,
// never the text of an already published version.

import { createHash } from 'node:crypto';

// Deterministic anchor: the same user always lands on the same version.
function bucketOf(userId) {
  const h = createHash('sha256').update(String(userId)).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

export function resolveVersion(manifest, promptName, userId) {
  const entry = manifest[promptName];
  if (!entry) throw new Error('prompt without manifest: ' + promptName);

  // No candidate, everyone gets the stable version.
  if (!entry.candidate || entry.rolloutPct <= 0) return entry.stable;

  // The slice is per user, not per request: the conversation does not
  // switch version midway.
  return bucketOf(userId) < entry.rolloutPct ? entry.candidate : entry.stable;
}`,
        },
      ],
    },
    {
      title: 'Gradual rollout: raising the version to a few before everyone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A new prompt that is good in the lab can be bad in production for reasons the test did not catch: a sentence that leads the model to be verbose, an instruction that conflicts with a rare but frequent-enough case to matter, a tone that sounds off in the real channel. The gradual rollout exists so that this mistake hits a few users before it hits everyone. The candidate starts on a small slice, five or ten percent, and the metrics of that slice are compared with the stable in the same period: if the candidate keeps or improves quality without worsening cost and latency, the slice goes up; if it degrades, it stops. Promotion is a staircase of percentages watched by metrics, not a leap from zero to a hundred by decree.',
        },
        {
          type: 'paragraph',
          value:
            'What makes the rollout reliable is comparing the two versions in the same time window, not today candidate against last week stable. Traffic changes over the day, the type of question changes with context, and a comparison between different periods confuses the prompt change with the traffic change. Running stable and candidate side by side, each on its slice, the same profile of questions goes through both at once, and the difference in metrics isolates the prompt effect. The metrics that matter are the same as for any change in an LLM system: answer quality signals, cost per call, latency and the escalation-to-human rate, each broken down by version.',
        },
        {
          type: 'diagram',
          value: `Gradual rollout compared in the same window

  manifest: stable=v3  candidate=v4  rollout=10%
       |
  traffic ---+---> 90% -> v3 (stable)    --> metrics v3
             |
             +---> 10% -> v4 (candidate) --> metrics v4
                          (by user hash, stable across the session)

  compares v3 x v4 IN THE SAME WINDOW:
    quality  cost  latency  escalation
       ok ------> raise rollout: 10% -> 25% -> 50% -> 100%
       worse ---> stop and revert: rollback to v3`,
        },
      ],
    },
    {
      title: 'Rollback without redeploy: reverting is flipping a pointer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The rollback is the part that justifies all the rest. It is useless to detect that the candidate regressed if reverting requires a new deploy, with build, a CI queue and precious minutes while customers get worse answers. Because the previous version is immutable and still in the registry, and because the choice of which version is active lives in the manifest, the rollback is a single operation: point the stable back to the old id and zero out the candidate. Nothing is rebuilt, no version is recovered from backup, because the good version never stopped existing. The time between "the candidate is worse" and "everyone is back on the good one" is the time to write a value in the manifest and propagate it, seconds, not a deploy cycle.',
        },
        {
          type: 'paragraph',
          value:
            'For the rollback to be truly instant, the manifest cannot be baked into the application bundle, otherwise swapping it would require exactly the redeploy you want to avoid. It lives somewhere the application reads at runtime with a short cache, a config store, a watched file in storage, a key in a distributed cache, and the swap propagates to every instance in seconds. The cache needs a short time to live so the rollback arrives fast, and the cost of that frequent read is small because the manifest is tiny. The rollback also deserves to be a first-class action, a single button or command that does the swap and records who, when and why, so that under pressure nobody has to edit JSON by hand at the worst possible moment.',
        },
        {
          type: 'code',
          value: `// registry/rollout.js
// Promoting and reverting are manifest edits, not deploys.
// The old version never left the registry, so reverting is instant.

export function promote(manifest, promptName, pct) {
  const e = manifest[promptName];
  if (!e.candidate) throw new Error('no candidate to promote');
  // Raise the candidate slice: 10 -> 25 -> 50. At 100, it becomes stable.
  if (pct >= 100) {
    return { ...manifest, [promptName]: { stable: e.candidate, candidate: null, rolloutPct: 0 } };
  }
  return { ...manifest, [promptName]: { ...e, rolloutPct: pct } };
}

export function rollback(manifest, promptName, reason) {
  const e = manifest[promptName];
  // Reverting is pointing the stable at the old id and zeroing the candidate.
  // No redeploy: the immutable stable was always there.
  logAudit({ action: 'rollback', promptName, from: e.candidate, to: e.stable, reason });
  return { ...manifest, [promptName]: { stable: e.stable, candidate: null, rolloutPct: 0 } };
}`,
        },
      ],
    },
    {
      title: 'The eval gate blocks the worse version before the customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The gradual rollout limits the damage of a bad version, but the ideal is for the bad version not to reach the rollout at all. That is the job of the eval gate: a versioned suite of cases, with representative inputs and what each is expected to produce, that runs against the candidate in CI before promotion. Some cases have a verifiable right answer, a format, a field, a classification, and become a direct assertion; others are subjective and use a model as a calibrated judge, comparing the candidate answer against a criterion. The gate fails the build when the candidate regresses below a threshold on the dataset, and that rejection is what stops a well-meant prompt edit from becoming a production regression. The prompt enters the same flow as any code: pull request, review, automated test, merge.',
        },
        {
          type: 'ordered',
          items: [
            'Versioned dataset: representative cases with input and expected result, kept next to the code and growing with each real bug that became a regression case.',
            'Objective eval where possible: format, required field, correct classification become a deterministic assertion that passes or fails without ambiguity.',
            'Calibrated judge where not: for subjective quality, a model judges against an explicit criterion, checked against human labels so it does not become loose opinion.',
            'CI gate: the candidate can only be promoted if its dataset score does not regress below the threshold; below it, the build fails and the promotion does not happen.',
            'Comparison against the stable: the eval runs on both versions and compares, to separate a drop caused by the candidate from a difficulty of the case itself.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The eval gate and the gradual rollout are two nets in series, and it is this pair that gives the courage to touch the prompt often. The gate catches the predictable regression, the one the dataset already knows; the gradual rollout catches the unpredictable one, the one that only appears in real traffic, and limits its reach to a slice while the metrics decide. A regression that passes both still meets the instant rollback as the last line. With the three together, immutable version in the registry, gate in CI and rollout with rollback in the manifest, changing a prompt stops being a bet made straight in production and becomes an engineering operation like any other, testable, observable and reversible.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why version the prompt instead of editing it straight in production?',
      answer:
        'Because editing the prompt directly is a disguised deploy, the riskiest of all: done without review, without history and without rollback. The prompt changes the observable behavior of the system, the effect of a change is hard to predict, and going back must be fast, exactly the properties that demand versioning. When someone tweaks a sentence to improve one case, that sentence changes the model in every case, and the quality drop only shows up days later with no commit to explain it. Treating the prompt as a versioned artifact, with an immutable id derived from the content, gives the history of what each version was, binds each answer to the version that generated it and makes switching behavior an explicit and reversible operation instead of a silent overwrite.',
    },
    {
      question: 'How do you gradually roll out a new prompt without breaking the conversation?',
      answer:
        'By placing the candidate version on a small slice of traffic, five or ten percent, and choosing that slice deterministically per user, not randomly per request. A hash of a stable identifier of the user or the conversation returns a number between zero and a hundred; if it falls below the candidate percentage, that user sees the new version consistently across the whole session, and the conversation does not change tone midway. The candidate metrics are compared with the stable in the same time window, each on its slice, to isolate the prompt effect from natural traffic variation. If quality, cost, latency and escalation hold or improve, the slice goes up in steps; if they degrade, it stops and reverts.',
    },
    {
      question: 'What makes a prompt rollback instant?',
      answer:
        'Two things: the previous version being immutable and still in the registry, and the choice of which version is active living in a manifest separate from the text. Because the good version was never overwritten or deleted, reverting rebuilds nothing, it just points the stable pointer back to the old id and zeroes the candidate, a small value edit. For that to be truly fast, the manifest cannot be baked into the bundle, otherwise swapping it would require the redeploy you want to avoid; it lives in a config store read at runtime with a short cache, and the swap propagates to every instance in seconds. The rollback deserves to be a first-class action, a button that does the swap and records who, when and why, so nobody edits JSON by hand under pressure.',
    },
  ],
  conclusion: {
    title: 'The prompt is code: it deserves version, rollout and rollback',
    description:
      'A prompt edited straight in production is a deploy without a version, without review and without a way back: when quality drops, there is no way to know what changed or how to revert, because the previous version was overwritten. Treating the prompt as code, an immutable version with a content-derived id in the registry, a manifest that separates which version from who receives it, a gradual rollout compared in the same window, a rollback that flips a pointer without redeploy and an eval gate that blocks the regression in CI, turns each prompt change from a bet into a testable and reversible engineering operation. I can set up this versioned prompt flow in your LLM system, from the immutable registry to the eval gate in CI, so that you change the prompt with the same frequency and the same safety with which you change any code.',
    cta: 'Talk about versioning the prompt in my LLM system',
  },
  related: [
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'prompt-versioning-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El prompt es el código más crítico de un sistema con LLM y suele ser el menos versionado. Una cadena enorme escondida a mitad de un archivo, editada directo en producción porque "es solo texto", cambiada por alguien que quería mejorar una respuesta y empeoró otras diez sin que nadie lo notara. Cuando la calidad cae, no hay forma de saber qué cambió, cuándo cambió ni cómo volver a lo que funcionaba, porque la versión anterior no existe en ningún lado: fue sobrescrita. El prompt merece el mismo rigor que el resto del código: un identificador de versión inmutable, un historial de lo que era cada versión, un rollout que expone el cambio a una porción del tráfico antes que a todos, un rollback que vuelve en segundos y una suite de evaluación que bloquea la promoción de una versión peor. Este artículo muestra cómo tratar el prompt como código de verdad, con registro versionado, manifiesto de tráfico, rollout gradual, rollback sin redeploy y el gate de eval que impide que una regresión llegue al cliente.',
  sections: [
    {
      title: 'Editar el prompt en producción es un deploy sin versión',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El prompt escapa del control de versiones por un motivo cultural: parece configuración, no código. Es texto, cabe en una variable de entorno, en un campo de base de datos, en un panel de administración, y la tentación de editarlo ahí mismo es grande porque no exige build ni deploy. El problema es que esa edición es un deploy, el más arriesgado de todos, hecho sin revisión, sin historial y sin rollback. Cuando alguien ajusta una frase para mejorar un caso específico, esa frase cambia el comportamiento del modelo en todos los casos, y el efecto colateral solo aparece días después, en forma de una métrica de calidad que cayó sin que ningún commit explique por qué. La pregunta "qué cambió entre ayer y hoy" no tiene respuesta, porque la versión de ayer fue borrada en el acto de guardar la de hoy.',
        },
        {
          type: 'paragraph',
          value:
            'El prompt tiene todas las propiedades que exigen versionado: cambia el comportamiento observable del sistema, el efecto de un cambio es difícil de prever, y volver atrás debe ser rápido cuando algo sale mal. Tratar el prompt como configuración ignora las dos primeras propiedades e imposibilita la tercera. La inversión es verlo como lo que es, un artefacto de comportamiento, y darle el mismo aparato del código: cada versión recibe un identificador inmutable, nunca se edita en el lugar, y cambiar qué versión está activa es una operación explícita y reversible, no una edición de campo. El texto sigue siendo fácil de cambiar, pero cada cambio se vuelve una versión nueva rastreable en vez de una sobrescritura silenciosa.',
        },
        {
          type: 'table',
          columns: ['Prompt como', 'Cómo cambia', 'Qué falta cuando se rompe'],
          rows: [
            [
              'Configuración editable',
              'Sobrescribe el texto en el panel o la base de datos',
              'Historial, revisión y la versión anterior para volver',
            ],
            [
              'Constante en el código',
              'Va junto en el deploy, pero sin rollout parcial',
              'Probar en una porción antes que a todos y revertir sin redeploy',
            ],
            [
              'Artefacto versionado',
              'Crea versión nueva con id inmutable; un puntero elige la activa',
              'Nada: historial, rollout gradual y rollback salen gratis',
            ],
          ],
        },
      ],
    },
    {
      title: 'Versión inmutable: el prompt tiene un id, no un lugar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La base de todo es la inmutabilidad: una versión de prompt, una vez creada, nunca cambia. No se edita la versión 3, se crea la versión 4. Cada versión lleva el texto completo, el modelo y los parámetros con que fue pensada, y un identificador que la acompaña toda la vida, en los logs, en las métricas y en el rollout. Ese identificador debe derivarse del contenido, no ser un contador que alguien incrementa a mano: un hash del texto más los parámetros garantiza que dos versiones idénticas colisionan en el mismo id y que cualquier cambio, por pequeño que sea, produce un id distinto. Así el id se vuelve una prueba de qué texto exacto corrió, y una respuesta guardada con el id de la versión 4 puede reproducirse byte a byte años después, porque la versión 4 nunca fue tocada.',
        },
        {
          type: 'paragraph',
          value:
            'Con la versión inmutable e identificada por el contenido, el log de cada llamada al modelo pasa a registrar no solo la entrada y la salida, sino el id de la versión de prompt que la produjo. Esa amarra es lo que cierra el ciclo de diagnóstico: cuando aparece una respuesta mala, el id en el log dice exactamente qué texto de prompt la generó, y comparar dos ids dice si la diferencia de calidad vino de un cambio de prompt o de otra cosa. Sin el id en el log, la misma investigación se vuelve arqueología: adivinar qué versión estaba activa en ese momento a partir de timestamps y de la memoria de quien tocó. El id transforma "creo que fue cuando cambiamos el prompt" en una consulta determinista.',
        },
        {
          type: 'code',
          value: `// registry/version.js
// Una version de prompt es INMUTABLE e identificada por el contenido.
// El id es un hash del texto + parametros: misma version, mismo id;
// cualquier cambio produce un id nuevo. Nunca se edita en el lugar.

import { createHash } from 'node:crypto';

export function makePromptVersion({ template, model, params }) {
  const payload = JSON.stringify({ template, model, params });
  const id = createHash('sha256').update(payload).digest('hex').slice(0, 12);
  return Object.freeze({ id, template, model, params });
}

// El registro guarda todas las versiones por id. Agregar nunca sobrescribe.
export function createRegistry() {
  const byId = new Map();
  return {
    add(version) {
      // Id derivado del contenido: reinsertar la misma version es un no-op seguro.
      if (!byId.has(version.id)) byId.set(version.id, version);
      return version.id;
    },
    get(id) {
      const v = byId.get(id);
      if (!v) throw new Error('version de prompt desconocida: ' + id);
      return v;
    },
  };
}`,
        },
      ],
    },
    {
      title: 'El manifiesto de tráfico separa qué versión de quién la recibe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tener versiones inmutables resuelve el historial, pero no dice cuál de ellas recibe el cliente ahora. Esa decisión vive en un artefacto separado, el manifiesto de tráfico: un mapa pequeño y legible que declara, para cada prompt, qué versión es la estable, cuál es la candidata y qué porción del tráfico atiende la candidata. El manifiesto es lo único que cambia cuando se hace un rollout o un rollback; las versiones en sí quedan quietas en el registro. Esa separación es lo que permite cambiar de comportamiento sin tocar el código: promover la candidata a estable es editar un campo del manifiesto, y volver es editarlo de nuevo. El texto del prompt y la decisión de quién lo recibe dejan de ser la misma cosa, y cada uno cambia a su ritmo.',
        },
        {
          type: 'paragraph',
          value:
            'La porción de tráfico debe ser determinista por usuario, no aleatoria por petición. Si el sorteo fuera por llamada, el mismo cliente caería en la versión nueva en un mensaje y en la vieja en el siguiente, y la conversación quedaría esquizofrénica, cambiando de tono y de reglas a mitad. El ancla correcta es un identificador estable del usuario o de la conversación, pasado por un hash que devuelve un número entre cero y cien; si ese número cae por debajo del porcentaje de la candidata, ese usuario ve la versión nueva de forma consistente en toda la sesión. El mismo mecanismo da el control fino del rollout: diez por ciento significa que solo los usuarios cuyo hash cae en la primera décima parte ven la candidata, y subir a cincuenta es tocar un número, no redistribuir nada.',
        },
        {
          type: 'code',
          value: `// registry/manifest.js
// El manifiesto declara, por prompt, la version estable, la candidata y
// la porcion de la candidata. Cambiar de comportamiento es editar este
// mapa, nunca el texto de una version ya publicada.

import { createHash } from 'node:crypto';

// Ancla determinista: el mismo usuario cae siempre en la misma version.
function bucketOf(userId) {
  const h = createHash('sha256').update(String(userId)).digest();
  return h.readUInt16BE(0) % 100; // 0..99
}

export function resolveVersion(manifest, promptName, userId) {
  const entry = manifest[promptName];
  if (!entry) throw new Error('prompt sin manifiesto: ' + promptName);

  // Sin candidata, todos reciben la estable.
  if (!entry.candidate || entry.rolloutPct <= 0) return entry.stable;

  // La porcion es por usuario, no por peticion: la conversacion no
  // cambia de version a mitad.
  return bucketOf(userId) < entry.rolloutPct ? entry.candidate : entry.stable;
}`,
        },
      ],
    },
    {
      title: 'Rollout gradual: subir la versión a pocos antes que a todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un prompt nuevo bueno en el laboratorio puede ser malo en producción por motivos que la prueba no atrapó: una frase que induce al modelo a ser prolijo, una instrucción que choca con un caso raro pero frecuente lo bastante para importar, un tono que suena extraño en el canal real. El rollout gradual existe para que ese error alcance a pocos usuarios antes de alcanzar a todos. La candidata empieza en una porción pequeña, cinco o diez por ciento, y las métricas de esa porción se comparan con las de la estable en el mismo período: si la candidata mantiene o mejora la calidad sin empeorar costo y latencia, la porción sube; si degrada, para. La promoción es una escalera de porcentajes vigilada por métrica, no un salto de cero a cien por decreto.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que hace confiable al rollout es comparar las dos versiones en la misma ventana de tiempo, no la candidata de hoy contra la estable de la semana pasada. El tráfico cambia a lo largo del día, el tipo de pregunta cambia con el contexto, y una comparación entre períodos distintos confunde el cambio de prompt con el cambio de tráfico. Corriendo estable y candidata lado a lado, cada una en su porción, el mismo perfil de preguntas pasa por las dos al mismo tiempo, y la diferencia en las métricas aísla el efecto del prompt. Las métricas que importan son las mismas de cualquier cambio en sistema con LLM: señales de calidad de la respuesta, costo por llamada, latencia y tasa de escalonamiento a humano, cada una desglosada por versión.',
        },
        {
          type: 'diagram',
          value: `Rollout gradual comparado en la misma ventana

  manifiesto: stable=v3  candidate=v4  rollout=10%
       |
  trafico ---+---> 90% -> v3 (estable)   --> metricas v3
             |
             +---> 10% -> v4 (candidata) --> metricas v4
                          (por hash del usuario, estable en la sesion)

  compara v3 x v4 EN LA MISMA VENTANA:
    calidad  costo  latencia  escalonamiento
       ok ------> sube rollout: 10% -> 25% -> 50% -> 100%
       peor ----> para y vuelve: rollback a v3`,
        },
      ],
    },
    {
      title: 'Rollback sin redeploy: volver es cambiar un puntero',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El rollback es la parte que justifica todo lo demás. De nada sirve detectar que la candidata regresó si volver atrás exige un nuevo deploy, con build, cola de CI y minutos preciosos mientras los clientes reciben respuestas peores. Como la versión anterior es inmutable y sigue en el registro, y como la elección de qué versión está activa vive en el manifiesto, el rollback es una única operación: apuntar la estable de vuelta al id viejo y poner la candidata en cero. Nada se reconstruye, ninguna versión se recupera de backup, porque la versión buena nunca dejó de existir. El tiempo entre "la candidata está peor" y "todos volvieron a la buena" es el tiempo de escribir un valor en el manifiesto y propagarlo, segundos, no un ciclo de deploy.',
        },
        {
          type: 'paragraph',
          value:
            'Para que el rollback sea instantáneo de verdad, el manifiesto no puede estar embebido en el bundle de la aplicación, si no cambiarlo exigiría justamente el redeploy que se quiere evitar. Vive en un lugar que la aplicación lee en runtime con un cache corto, un registro de configuración, un archivo en almacenamiento observado, una clave en cache distribuido, y el cambio se propaga a todas las instancias en segundos. El cache necesita un tiempo de vida corto para que el rollback llegue rápido, y el costo de esa lectura frecuente es pequeño porque el manifiesto es diminuto. El rollback también merece ser una acción de primera clase, un botón o comando único que hace el cambio y registra quién, cuándo y por qué, para que bajo presión nadie tenga que editar JSON a mano en el peor momento posible.',
        },
        {
          type: 'code',
          value: `// registry/rollout.js
// Promover y revertir son ediciones del manifiesto, no deploys.
// La version vieja nunca salio del registro, asi que volver es instantaneo.

export function promote(manifest, promptName, pct) {
  const e = manifest[promptName];
  if (!e.candidate) throw new Error('sin candidata para promover');
  // Subir la porcion de la candidata: 10 -> 25 -> 50. En 100, se vuelve estable.
  if (pct >= 100) {
    return { ...manifest, [promptName]: { stable: e.candidate, candidate: null, rolloutPct: 0 } };
  }
  return { ...manifest, [promptName]: { ...e, rolloutPct: pct } };
}

export function rollback(manifest, promptName, reason) {
  const e = manifest[promptName];
  // Volver es apuntar la estable al id viejo y poner la candidata en cero.
  // Ningun redeploy: la estable inmutable siempre estuvo alli.
  logAudit({ action: 'rollback', promptName, from: e.candidate, to: e.stable, reason });
  return { ...manifest, [promptName]: { stable: e.stable, candidate: null, rolloutPct: 0 } };
}`,
        },
      ],
    },
    {
      title: 'El gate de eval bloquea la versión peor antes del cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El rollout gradual limita el daño de una versión mala, pero lo ideal es que la versión mala ni siquiera llegue al rollout. Eso es papel del gate de eval: una suite de casos versionada, con entradas representativas y lo que se espera de cada una, que corre contra la candidata en el CI antes de la promoción. Algunos casos tienen respuesta correcta verificable, un formato, un campo, una clasificación, y se vuelven aserción directa; otros son subjetivos y usan un modelo como juez calibrado, comparando la respuesta de la candidata con un criterio. El gate falla el build cuando la candidata regresa por debajo de un umbral en el dataset, y ese rechazo es lo que impide que una edición bien intencionada de prompt se vuelva una regresión en producción. El prompt entra en el mismo flujo de cualquier código: pull request, revisión, prueba automática, merge.',
        },
        {
          type: 'ordered',
          items: [
            'Dataset versionado: casos representativos con entrada y resultado esperado, guardados junto al código y creciendo con cada bug real que se volvió caso de regresión.',
            'Eval objetiva donde se puede: formato, campo obligatorio, clasificación correcta se vuelven aserción determinista que pasa o falla sin ambigüedad.',
            'Juez calibrado donde no: para calidad subjetiva, un modelo juzga contra un criterio explícito, aferrado a etiquetas humanas para no volverse opinión suelta.',
            'Gate en el CI: la candidata solo puede promoverse si su score en el dataset no regresa por debajo del umbral; por debajo de él, el build falla y la promoción no ocurre.',
            'Comparación contra la estable: el eval corre en las dos versiones y compara, para separar una caída causada por la candidata de una dificultad del propio caso.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El gate de eval y el rollout gradual son dos redes en serie, y es esa dupla la que da coraje para tocar el prompt con frecuencia. El gate atrapa la regresión previsible, la que el dataset ya conoce; el rollout gradual atrapa la imprevisible, la que solo aparece en el tráfico real, y limita su alcance a una porción mientras las métricas deciden. Una regresión que pase por las dos todavía encuentra el rollback instantáneo como última línea. Con las tres en conjunto, versión inmutable en el registro, gate en el CI y rollout con rollback en el manifiesto, cambiar un prompt deja de ser una apuesta hecha directo en producción y se vuelve una operación de ingeniería como cualquier otra, testeable, observable y reversible.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué versionar el prompt en vez de editarlo directo en producción?',
      answer:
        'Porque editar el prompt directo es un deploy disfrazado, el más arriesgado de todos: hecho sin revisión, sin historial y sin rollback. El prompt cambia el comportamiento observable del sistema, el efecto de un cambio es difícil de prever, y volver atrás debe ser rápido, exactamente las propiedades que exigen versionado. Cuando alguien ajusta una frase para mejorar un caso, esa frase cambia el modelo en todos los casos, y la caída de calidad solo aparece días después sin ningún commit que lo explique. Tratar el prompt como artefacto versionado, con un id inmutable derivado del contenido, da el historial de lo que era cada versión, amarra cada respuesta a la versión que la generó y vuelve el cambio de comportamiento una operación explícita y reversible en vez de una sobrescritura silenciosa.',
    },
    {
      question: '¿Cómo hacer el rollout gradual de un prompt nuevo sin romper la conversación?',
      answer:
        'Poniendo la versión candidata en una porción pequeña del tráfico, cinco o diez por ciento, y eligiendo esa porción de forma determinista por usuario, no aleatoria por petición. Un hash de un identificador estable del usuario o de la conversación devuelve un número entre cero y cien; si cae por debajo del porcentaje de la candidata, ese usuario ve la versión nueva de forma consistente en toda la sesión, y la conversación no cambia de tono a mitad. Las métricas de la candidata se comparan con las de la estable en la misma ventana de tiempo, cada una en su porción, para aislar el efecto del prompt de la variación natural del tráfico. Si calidad, costo, latencia y escalonamiento se mantienen o mejoran, la porción sube en escalones; si degradan, para y vuelve.',
    },
    {
      question: '¿Qué hace que el rollback de un prompt sea instantáneo?',
      answer:
        'Dos cosas: que la versión anterior sea inmutable y siga en el registro, y que la elección de qué versión está activa viva en un manifiesto separado del texto. Como la versión buena nunca fue sobrescrita ni borrada, volver no reconstruye nada, solo apunta el puntero de la estable de vuelta al id viejo y pone la candidata en cero, una edición de un valor pequeño. Para que eso sea realmente rápido, el manifiesto no puede estar embebido en el bundle, si no cambiarlo exigiría el redeploy que se quiere evitar; vive en un registro de configuración leído en runtime con cache corto, y el cambio se propaga a todas las instancias en segundos. El rollback merece ser una acción de primera clase, un botón que hace el cambio y registra quién, cuándo y por qué, para que nadie edite JSON a mano bajo presión.',
    },
  ],
  conclusion: {
    title: 'El prompt es código: merece versión, rollout y rollback',
    description:
      'Un prompt editado directo en producción es un deploy sin versión, sin revisión y sin vuelta atrás: cuando la calidad cae, no hay forma de saber qué cambió ni cómo revertir, porque la versión anterior fue sobrescrita. Tratar el prompt como código, una versión inmutable con id derivado del contenido en el registro, un manifiesto que separa qué versión de quién la recibe, un rollout gradual comparado en la misma ventana, un rollback que cambia un puntero sin redeploy y un gate de eval que bloquea la regresión en el CI, transforma cada cambio de prompt de una apuesta en una operación de ingeniería testeable y reversible. Puedo montar ese flujo de prompt versionado en tu sistema con LLM, del registro inmutable al gate de eval en el CI, para que cambies el prompt con la misma frecuencia y la misma seguridad con que cambias cualquier código.',
    cta: 'Hablar sobre versionar el prompt en mi sistema con LLM',
  },
  related: [
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidad de LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'prompt-versioning-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
