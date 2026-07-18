// Conteudo do artigo: idempotencia em tool use para evitar acao duplicada do agente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Wrapper mínimo de idempotência para tool use: cada chamada de ferramenta carrega uma chave derivada da intencao, um store guarda o resultado da primeira execucao por essa chave, e as tentativas seguintes com a mesma chave devolvem o resultado gravado em vez de executar de novo, para que um retry do agente ou uma retomada apos a queda nao cobre o cliente duas vezes nem envie a mesma mensagem em duplicado.',
  en: 'Minimal idempotency wrapper for tool use: each tool call carries a key derived from the intent, a store keeps the result of the first execution under that key, and later attempts with the same key return the stored result instead of running again, so an agent retry or a resume after a crash does not charge the customer twice or send the same message duplicated.',
  es: 'Wrapper minimo de idempotencia para tool use: cada llamada de herramienta lleva una clave derivada de la intencion, un store guarda el resultado de la primera ejecucion por esa clave, y los intentos siguientes con la misma clave devuelven el resultado guardado en vez de ejecutar de nuevo, para que un retry del agente o una reanudacion tras la caida no cobre al cliente dos veces ni envie el mismo mensaje duplicado.',
};

const repoUrl = 'https://github.com/joaosouz4dev/tool-use-idempotency-mini';

const pt = {
  intro:
    'Um agente que só lê o mundo pode ser retentado à vontade: se a chamada falha, você tenta de novo e nada de mau acontece. O problema começa quando a ferramenta escreve, quando ela cobra um cartão, cria um pedido, envia uma mensagem ou dispara um estorno. Aí cada retry passa a ser perigoso, porque o mundo mudou entre a primeira tentativa e a segunda, e repetir a ação duplica o efeito. E retries são a regra, não a exceção, num sistema com LLM: o modelo é reexecutado quando a resposta vem malformada, o loop de tool use é retomado depois de uma queda, o timeout de rede dispara a tentativa antes de a primeira ter terminado. A idempotência é a propriedade que separa "executei a ação uma vez" de "executei a ação quantas vezes o loop precisou tentar". Este artigo mostra por que o agente duplica ação com tanta facilidade, como derivar uma chave de idempotência que sobrevive ao retry, o padrão de janela de deduplicação que grava o resultado da primeira execução, a diferença entre uma ferramenta naturalmente idempotente e uma que precisa ser blindada, e como testar que a duplicata realmente não passa.',
  sections: [
    {
      title: 'Por que o agente duplica ação com tanta facilidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ponto mais frágil de um loop de tool use é a fronteira entre "a ferramenta executou" e "o agente soube que executou". Entre esses dois momentos há uma rede, um processo que pode cair, um timeout que pode disparar. A ferramenta cobra o cartão com sucesso, mas a resposta se perde no caminho de volta; o agente, sem confirmação, conclui que a chamada falhou e tenta de novo. Do ponto de vista do modelo foi uma única intenção, "cobrar o cliente"; do ponto de vista do mundo foram duas cobranças. O agente não duplica por burrice, duplica porque a única informação que ele tem é a ausência de resposta, e ausência de resposta é indistinguível de falha real.',
        },
        {
          type: 'paragraph',
          value:
            'Some a isso a natureza probabilística do LLM. O modelo pode gerar a mesma tool call duas vezes na mesma conversa porque perdeu o rastro de que já a fez, pode reemitir uma ação depois que o contexto foi truncado, pode reagir a um erro de parsing repetindo o passo inteiro. E o loop de orquestração, tentando ser robusto, adiciona sua própria camada de retry por cima. O resultado é que a mesma ação de escrita tem várias fontes independentes de repetição, e nenhuma delas sabe da outra. Sem uma defesa explícita, a pergunta não é se a ação vai duplicar, é quando.',
        },
        {
          type: 'list',
          items: [
            'Retry do loop de orquestração: a chamada de rede deu timeout e o loop tenta de novo, sem saber se a primeira chegou a executar do outro lado.',
            'Reexecução do modelo: a resposta veio malformada, o passo inteiro é refeito e a tool call de escrita é emitida uma segunda vez.',
            'Retomada apos queda: o processo caiu no meio do loop, o estado durável é recarregado e a etapa em andamento roda de novo.',
            'Repeticao pelo proprio LLM: o modelo perde o rastro do que ja fez e gera a mesma acao mais de uma vez na mesma conversa.',
          ],
        },
      ],
    },
    {
      title: 'A chave de idempotência: derivar da intenção, não do acaso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A defesa começa com uma chave que identifica a intenção, não a tentativa. A ideia é que todas as repetições de uma mesma ação lógica carreguem a mesma chave, para que o lado que executa consiga reconhecer "isto eu já fiz". O erro clássico é gerar a chave dentro do retry: se cada tentativa cria uma chave nova aleatória, o deduplicador vê duas ações distintas e executa as duas. A chave tem que nascer antes do loop de retry e sobreviver a ele, presa à intenção, não ao instante.',
        },
        {
          type: 'paragraph',
          value:
            'Há duas formas de conseguir isso. A primeira é a chave explícita: o orquestrador gera um identificador único quando decide fazer a ação, uma vez, e o repassa em toda tentativa daquela ação. A segunda é a chave derivada: você calcula um hash determinístico dos parâmetros que definem a ação, de modo que a mesma intenção sempre produza a mesma chave sem precisar carregar um id. A derivada é atraente porque não exige estado extra, mas tem uma armadilha: se dois pedidos legítimos e distintos tiverem exatamente os mesmos parâmetros, eles colapsam na mesma chave e o segundo é engolido como se fosse duplicata. Por isso a chave derivada precisa incluir algo que distinga intenções genuinamente diferentes.',
        },
        {
          type: 'code',
          value: `// idempotency/key.js
// Deriva uma chave de idempotencia a partir da intencao da acao.
// A mesma intencao logica -> a mesma chave, em toda tentativa.
import { createHash } from 'node:crypto';

export function idempotencyKey({ tool, actor, params, intentId }) {
  // intentId e gerado UMA vez, quando a acao e decidida, e repassado em
  // todo retry. E o que garante que duas intencoes legitimas com os mesmos
  // parametros (ex.: dois estornos iguais) NAO colapsem na mesma chave.
  const canonical = JSON.stringify({
    tool,                       // qual ferramenta
    actor,                      // em nome de quem (evita cruzar clientes)
    params: sortKeys(params),   // parametros normalizados e ordenados
    intentId,                   // desambigua intencoes distintas iguais
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Ordena as chaves para que { a, b } e { b, a } gerem o MESMO hash:
// a ordem das chaves do objeto nao pode mudar a identidade da acao.
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => ((acc[k] = sortKeys(obj[k])), acc), {});
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no detalhe da normalização: `{ valor: 10, moeda: "BRL" }` e `{ moeda: "BRL", valor: 10 }` descrevem a mesma cobrança e precisam gerar a mesma chave, senão duas tentativas da mesma ação, serializadas em ordens diferentes, escapariam da deduplicação. Ordenar as chaves antes do hash é o que torna a chave estável. E incluir o `actor` na chave evita o pior tipo de bug: duas intenções de clientes diferentes com os mesmos parâmetros compartilharem uma chave e um cliente receber o resultado do outro.',
        },
      ],
    },
    {
      title: 'A janela de deduplicação: gravar o resultado da primeira execução',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a chave em mãos, o mecanismo é uma janela de deduplicação: um store que, para cada chave, guarda o estado da ação. Antes de executar, a ferramenta consulta o store. Se a chave é nova, ela reserva a chave, executa, grava o resultado e o devolve. Se a chave já existe e a ação terminou, ela devolve o resultado gravado sem executar nada. O ponto sutil, que separa uma defesa que funciona de uma que só parece funcionar, é o que acontece quando a chave existe mas a ação ainda está em andamento: duas tentativas quase simultâneas não podem executar as duas. É por isso que a reserva da chave e a checagem precisam ser atômicas, um "insere se não existe" que só um dos concorrentes vence.',
        },
        {
          type: 'diagram',
          value: `Fluxo de uma chamada de ferramenta com idempotencia

  tool call + chave
        |
        v
  [ INSERE-SE-NAO-EXISTE a chave no store ]  <- atomico: so um vence
        |
     +--+---------------------------+
     | ganhou (chave nova)          | perdeu (chave ja existe)
     v                              v
  [ executa a acao de escrita ]   [ le o estado gravado ]
     |                              |
     v                         +----+-----------------+
  [ grava resultado ]         | done -> devolve o     | in-flight -> espera
     |                        | resultado gravado     | ou sinaliza retry
     v                        v                       v
  [ devolve resultado ]     (nao executa de novo)   (nao executa em paralelo)

  a acao de escrita roda UMA vez por chave; todo retry cai no ramo direito.`,
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.js
// Envolve uma ferramenta de escrita com uma janela de deduplicacao.
// A acao roda no maximo uma vez por chave; retries devolvem o gravado.

export function withIdempotency(store, execute) {
  return async function idempotent(key, args) {
    // 1) Reserva atomica: so a PRIMEIRA tentativa consegue inserir a chave.
    const reserved = await store.putIfAbsent(key, { status: 'in-flight' });

    if (!reserved) {
      // 2) Chave ja existe: outra tentativa esta cuidando desta acao.
      const prior = await store.get(key);
      if (prior.status === 'done') return prior.result; // devolve o gravado
      // Ainda em andamento: NAO executa em paralelo. Espera e reconsulta,
      // ou sinaliza ao chamador para tentar de novo mais tarde.
      throw new InFlightError(key);
    }

    try {
      // 3) So o vencedor da reserva executa a acao de escrita de fato.
      const result = await execute(args);
      await store.put(key, { status: 'done', result });
      return result;
    } catch (err) {
      // Falhou de verdade: libera a chave para uma retentativa legitima.
      await store.delete(key);
      throw err;
    }
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Três decisões de projeto moram nesse wrapper. A primeira é o tratamento do estado in-flight: liberar a chave cedo demais reabre a janela para duplicar; segurá-la para sempre trava uma ação que falhou de verdade. A segunda é o TTL da chave: ela não pode viver eternamente, senão o store cresce sem limite, mas precisa viver mais que o maior intervalo de retry possível, senão a chave expira antes do retry chegar e a duplicata passa. A terceira é o que fazer quando a própria execução falha: liberar a chave para permitir uma retentativa legítima, mas com o cuidado de não liberar uma ação que talvez tenha executado do outro lado apesar do erro, que é exatamente o caso ambíguo do timeout.',
        },
      ],
    },
    {
      title: 'Ferramentas naturalmente idempotentes versus as que precisam de blindagem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem toda ferramenta precisa do wrapper. A idempotência é primeiro uma propriedade da operação, e só depois um mecanismo que você adiciona. Uma leitura é idempotente por natureza: consultar o saldo dez vezes devolve o saldo dez vezes sem alterar nada. Uma escrita que define um valor absoluto também costuma ser: "marque este pedido como pago" produz o mesmo estado final quantas vezes rodar. O perigo mora nas operações relativas e nas que criam: "adicione dez ao saldo" soma dez a cada execução; "crie um pedido" cria um pedido novo por tentativa. Essas são as que a chave de idempotência precisa proteger.',
        },
        {
          type: 'table',
          columns: ['Tipo de operação', 'Idempotente por natureza?', 'O que fazer'],
          rows: [
            [
              'Leitura (consultar saldo, status)',
              'Sim, não altera estado',
              'Pode retentar à vontade, sem chave',
            ],
            [
              'Escrita absoluta (definir status = pago)',
              'Sim, mesmo estado final',
              'Segura para retry; chave opcional',
            ],
            [
              'Escrita relativa (somar ao saldo)',
              'Não, acumula a cada tentativa',
              'Exige chave de idempotência',
            ],
            [
              'Criação (novo pedido, nova cobrança)',
              'Não, cria um por tentativa',
              'Exige chave; muitas APIs têm campo próprio',
            ],
            [
              'Envio externo (mensagem, e-mail)',
              'Não, entrega duplicada visível',
              'Exige chave; deduplicar antes de enviar',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A boa notícia é que muitas APIs externas já oferecem idempotência nativa: gateways de pagamento aceitam um cabeçalho de chave de idempotência, filas têm deduplicação por id de mensagem, bancos de dados dão upsert por chave única. Quando o provedor oferece, a melhor jogada é usar a defesa dele em vez de reinventá-la, passando a sua chave derivada para o campo que ele espera. O wrapper próprio fica para as ferramentas que não têm defesa nativa, um envio interno, uma ação composta, uma escrita num sistema legado. A regra prática é classificar cada ferramenta antes de blindar: se ela já é idempotente ou o provedor já protege, não adicione uma camada que só custa latência e um store para manter.',
        },
      ],
    },
    {
      title: 'O caso ambíguo: quando você não sabe se a ação executou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O cenário que separa uma defesa madura de uma ingênua é o timeout na ação de escrita. Você mandou cobrar, o tempo estourou e a resposta nunca voltou. A ação executou do outro lado e a confirmação se perdeu, ou ela nem chegou a executar? As duas hipóteses produzem exatamente o mesmo sintoma local: silêncio. Retentar cegamente arrisca a dupla cobrança se a primeira tinha passado; desistir arrisca deixar o cliente sem o pedido se a primeira tinha falhado. Não há como decidir olhando só para o lado de cá.',
        },
        {
          type: 'paragraph',
          value:
            'É aqui que a chave de idempotência muda o jogo: com ela, o retry deixa de ser uma aposta e vira uma pergunta segura. Reenviar a ação com a mesma chave é seguro por construção, porque o lado que executa reconhece a chave e, se a primeira tentativa tinha passado, devolve o resultado gravado em vez de executar de novo; se não tinha passado, executa agora. O retry idempotente resolve a ambiguidade do timeout sem você precisar saber a verdade: a mesma chamada é ao mesmo tempo a confirmação e a segunda tentativa. Onde a API externa oferece uma consulta de status por chave, melhor ainda: você pergunta "esta ação existe?" antes de reenviar. Mas mesmo sem essa consulta, a chave transforma o timeout de uma armadilha numa situação recuperável.',
        },
        {
          type: 'ordered',
          items: [
            'Nunca retente uma ação de escrita sem chave apos um timeout: você não sabe se a primeira executou, e a duplicata é invisível até o cliente reclamar.',
            'Gere a chave antes do primeiro envio e reutilize-a em todo retry daquela ação; a chave é da intenção, e uma só por intenção.',
            'Prefira a idempotência nativa do provedor quando ela existir, passando sua chave ao campo esperado, em vez de recriar a janela por fora.',
            'Defina o TTL da chave maior que o maior intervalo de retry possível, para a chave nunca expirar antes de a última tentativa chegar.',
            'Trate o estado in-flight com cuidado: não execute em paralelo duas tentativas da mesma chave nem libere a chave antes de saber o desfecho.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A idempotência não elimina os retries, ela os torna seguros. Num sistema com LLM, onde o loop retenta, o modelo reexecuta e o processo retoma depois de cair, tentar de novo é inevitável e desejável, é o que dá robustez. O que não pode acontecer é que essa robustez se pague com efeitos duplicados no mundo real. A chave de idempotência é o contrato que permite retentar sem medo: você tenta quantas vezes precisar, e a ação acontece uma vez só.',
        },
      ],
    },
    {
      title: 'Testar que a duplicata realmente não passa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma defesa de idempotência que nunca foi exercitada sob duplicação é uma suposição, não uma garantia. O teste que importa não é "a ferramenta funciona quando chamada uma vez", é "a ferramenta chamada duas vezes com a mesma chave produz um efeito só". Isso exige simular exatamente as condições que geram duplicata: a mesma chave chegando duas vezes, as duas tentativas quase simultâneas disputando a reserva, o timeout que deixa a ação em andamento e é retentado. Um teste que só verifica o caminho feliz sequencial passa mesmo quando a atomicidade da reserva está quebrada.',
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.test.js
// Testa a propriedade que importa: mesma chave -> efeito unico,
// inclusive sob concorrencia e sob retry apos timeout.
import { test, expect, vi } from 'vitest';
import { withIdempotency } from './withIdempotency.js';
import { memoryStore } from './memoryStore.js';

test('duas chamadas com a mesma chave executam a acao UMA vez', async () => {
  const charge = vi.fn(async () => ({ id: 'ch_1', ok: true }));
  const idempotent = withIdempotency(memoryStore(), charge);

  const r1 = await idempotent('key-abc', { amount: 10 });
  const r2 = await idempotent('key-abc', { amount: 10 }); // retry

  expect(charge).toHaveBeenCalledTimes(1);   // a escrita rodou 1x
  expect(r2).toEqual(r1);                     // o retry devolveu o gravado
});

test('duas tentativas concorrentes nao executam as duas', async () => {
  let running = 0;
  const charge = vi.fn(async () => {
    running += 1;
    expect(running).toBe(1);                  // nunca ha 2 execucoes juntas
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return { id: 'ch_1' };
  });
  const idempotent = withIdempotency(memoryStore(), charge);

  // Dispara as duas ao mesmo tempo, disputando a reserva atomica.
  const results = await Promise.allSettled([
    idempotent('key-xyz', { amount: 10 }),
    idempotent('key-xyz', { amount: 10 }),
  ]);

  // No maximo uma executou; a outra caiu no ramo de deduplicacao.
  expect(charge).toHaveBeenCalledTimes(1);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Além do teste automatizado, vale monitorar a duplicação em produção com uma métrica simples: a taxa de acertos da janela de deduplicação, ou seja, quantas tentativas caíram no ramo "chave já existe". Um valor perto de zero pode significar que a defesa nunca é exercida, mas também pode significar que a chave está sendo gerada errada e cada tentativa cria uma chave nova, caso em que a proteção não existe de fato. Um pico súbito nessa métrica costuma denunciar um loop de retry mal calibrado disparando muitas repetições. A idempotência é uma daquelas propriedades que só se sabe que está funcionando quando se mede o quanto ela está barrando, porque o efeito dela é justamente uma ausência: a duplicata que não aconteceu.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'O que é uma chave de idempotência e por que ela é da intenção, não da tentativa?',
      answer:
        'Uma chave de idempotência é um identificador que marca uma ação lógica única, de modo que todas as tentativas de executar essa mesma ação carreguem a mesma chave. É por isso que ela precisa ser da intenção e não da tentativa: se cada retry gerasse uma chave nova, o mecanismo de deduplicação veria ações distintas e executaria todas, exatamente o que você queria evitar. A chave tem que nascer antes do loop de retry, presa à intenção de fazer aquela ação, e ser reutilizada em cada tentativa. Ela pode ser explícita, um id gerado uma vez quando a ação é decidida, ou derivada, um hash determinístico dos parâmetros normalizados da ação. A derivada dispensa carregar estado, mas precisa incluir algo que distinga intenções genuinamente diferentes com os mesmos parâmetros, para não colapsar dois pedidos legítimos numa chave só.',
    },
    {
      question: 'Toda ferramenta de um agente precisa de idempotência?',
      answer:
        'Não. A idempotência só importa para ações que mudam o estado do mundo e cujo efeito se acumula ou se duplica a cada execução. Leituras, como consultar um saldo ou um status, são idempotentes por natureza e podem ser retentadas à vontade sem defesa nenhuma. Escritas absolutas, do tipo "defina este pedido como pago", também tendem a ser seguras porque produzem o mesmo estado final quantas vezes rodem. Quem precisa da chave são as operações relativas, como "some dez ao saldo", e as de criação e envio, como "crie um pedido" ou "envie esta mensagem", porque cada tentativa gera um efeito novo e visível. A regra é classificar a operação antes de blindar: adicionar uma janela de deduplicação a uma ferramenta que já é idempotente só custa latência e um store para manter, sem ganho.',
    },
    {
      question: 'Como a idempotência resolve o retry após um timeout?',
      answer:
        'O timeout numa ação de escrita é ambíguo: a ação pode ter executado do outro lado e a confirmação ter se perdido, ou pode nem ter chegado a executar, e o sintoma local é o mesmo silêncio nos dois casos. Sem idempotência, retentar arrisca duplicar a ação e desistir arrisca deixá-la sem efeito, e não há como decidir olhando só para o seu lado. Com uma chave de idempotência, o retry deixa de ser uma aposta: reenviar a mesma ação com a mesma chave é seguro por construção, porque o lado que executa reconhece a chave e, se a primeira tentativa tinha passado, devolve o resultado gravado em vez de executar de novo; se não tinha passado, executa agora. A mesma chamada funciona ao mesmo tempo como confirmação e como segunda tentativa, então você recupera o timeout sem precisar saber qual das duas hipóteses era a verdadeira.',
    },
  ],
  conclusion: {
    title: 'Idempotência é o que torna o retry do agente seguro',
    description:
      'Num sistema com LLM os retries são inevitáveis: o loop retenta, o modelo reexecuta, o processo retoma depois de cair. Sem uma chave de idempotência derivada da intenção e uma janela de deduplicação que grava o resultado da primeira execução, cada uma dessas repetições vira uma cobrança dupla, um pedido duplicado ou uma mensagem enviada duas vezes. Posso desenhar essa camada de idempotência nas ferramentas de escrita do seu agente, classificando cada operação, escolhendo entre a defesa nativa do provedor e o wrapper próprio, e testando que a duplicata realmente não passa, para que o agente possa tentar de novo quantas vezes precisar sem mexer duas vezes no mundo real.',
    cta: 'Falar sobre idempotência nas ferramentas do meu agente',
  },
  related: [
    { label: 'Orquestração de agentes de IA em produção', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Guardrails de saída em LLM: validação e recusa segura', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'tool-use-idempotency-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'An agent that only reads the world can be retried freely: if the call fails, you try again and nothing bad happens. The problem starts when the tool writes, when it charges a card, creates an order, sends a message or fires a refund. Now every retry becomes dangerous, because the world changed between the first attempt and the second, and repeating the action duplicates the effect. And retries are the rule, not the exception, in an LLM system: the model is re-run when the answer comes out malformed, the tool-use loop resumes after a crash, the network timeout fires the attempt before the first one has finished. Idempotency is the property that separates "I ran the action once" from "I ran the action as many times as the loop needed to try". This article shows why the agent duplicates actions so easily, how to derive an idempotency key that survives the retry, the deduplication-window pattern that stores the result of the first execution, the difference between a naturally idempotent tool and one that needs armoring, and how to test that the duplicate really does not get through.',
  sections: [
    {
      title: 'Why the agent duplicates actions so easily',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most fragile point of a tool-use loop is the boundary between "the tool executed" and "the agent learned that it executed". Between those two moments there is a network, a process that can crash, a timeout that can fire. The tool charges the card successfully, but the response gets lost on the way back; the agent, with no confirmation, concludes that the call failed and tries again. From the model point of view it was a single intent, "charge the customer"; from the world point of view it was two charges. The agent does not duplicate out of stupidity, it duplicates because the only information it has is the absence of a response, and absence of a response is indistinguishable from a real failure.',
        },
        {
          type: 'paragraph',
          value:
            'Add to that the probabilistic nature of the LLM. The model can generate the same tool call twice in the same conversation because it lost track of already having made it, it can re-emit an action after the context was truncated, it can react to a parsing error by repeating the whole step. And the orchestration loop, trying to be robust, adds its own retry layer on top. The result is that the same write action has several independent sources of repetition, and none of them knows about the others. Without an explicit defense, the question is not whether the action will duplicate, it is when.',
        },
        {
          type: 'list',
          items: [
            'Orchestration-loop retry: the network call timed out and the loop tries again, not knowing whether the first one actually executed on the other side.',
            'Model re-run: the answer came out malformed, the whole step is redone and the write tool call is emitted a second time.',
            'Resume after a crash: the process died mid-loop, the durable state is reloaded and the in-progress step runs again.',
            'Repetition by the LLM itself: the model loses track of what it already did and generates the same action more than once in the same conversation.',
          ],
        },
      ],
    },
    {
      title: 'The idempotency key: derive it from the intent, not from chance',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The defense starts with a key that identifies the intent, not the attempt. The idea is that all repetitions of the same logical action carry the same key, so the executing side can recognize "this I have already done". The classic mistake is generating the key inside the retry: if each attempt creates a fresh random key, the deduplicator sees two distinct actions and executes both. The key has to be born before the retry loop and survive it, tied to the intent, not to the instant.',
        },
        {
          type: 'paragraph',
          value:
            'There are two ways to achieve this. The first is the explicit key: the orchestrator generates a unique identifier when it decides to do the action, once, and passes it along in every attempt of that action. The second is the derived key: you compute a deterministic hash of the parameters that define the action, so the same intent always produces the same key without carrying an id. The derived one is attractive because it needs no extra state, but it has a trap: if two legitimate and distinct requests have exactly the same parameters, they collapse into the same key and the second is swallowed as if it were a duplicate. That is why the derived key needs to include something that distinguishes genuinely different intents.',
        },
        {
          type: 'code',
          value: `// idempotency/key.js
// Derives an idempotency key from the intent of the action.
// The same logical intent -> the same key, on every attempt.
import { createHash } from 'node:crypto';

export function idempotencyKey({ tool, actor, params, intentId }) {
  // intentId is generated ONCE, when the action is decided, and passed along
  // on every retry. It is what guarantees that two legitimate intents with the
  // same parameters (e.g. two equal refunds) do NOT collapse into one key.
  const canonical = JSON.stringify({
    tool,                       // which tool
    actor,                      // on whose behalf (avoids crossing customers)
    params: sortKeys(params),   // normalized and ordered parameters
    intentId,                   // disambiguates distinct equal intents
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Sorts the keys so that { a, b } and { b, a } produce the SAME hash:
// the order of the object keys must not change the action identity.
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => ((acc[k] = sortKeys(obj[k])), acc), {});
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice the normalization detail: `{ amount: 10, currency: "USD" }` and `{ currency: "USD", amount: 10 }` describe the same charge and need to produce the same key, otherwise two attempts of the same action, serialized in different orders, would escape deduplication. Sorting the keys before the hash is what makes the key stable. And including the `actor` in the key avoids the worst kind of bug: two intents from different customers with the same parameters sharing a key and one customer receiving the other one result.',
        },
      ],
    },
    {
      title: 'The deduplication window: store the result of the first execution',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the key in hand, the mechanism is a deduplication window: a store that, for each key, keeps the state of the action. Before executing, the tool consults the store. If the key is new, it reserves the key, executes, stores the result and returns it. If the key already exists and the action is done, it returns the stored result without executing anything. The subtle point, which separates a defense that works from one that only looks like it works, is what happens when the key exists but the action is still in progress: two nearly simultaneous attempts cannot both execute. That is why reserving the key and checking it must be atomic, an "insert if not exists" that only one of the competitors wins.',
        },
        {
          type: 'diagram',
          value: `Flow of a tool call with idempotency

  tool call + key
        |
        v
  [ INSERT-IF-NOT-EXISTS the key into the store ]  <- atomic: only one wins
        |
     +--+---------------------------+
     | won (new key)                | lost (key already exists)
     v                              v
  [ execute the write action ]    [ read the stored state ]
     |                              |
     v                         +----+-----------------+
  [ store the result ]        | done -> return the    | in-flight -> wait
     |                        | stored result         | or signal a retry
     v                        v                       v
  [ return the result ]     (does not run again)    (does not run in parallel)

  the write action runs ONCE per key; every retry falls into the right branch.`,
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.js
// Wraps a write tool with a deduplication window.
// The action runs at most once per key; retries return the stored result.

export function withIdempotency(store, execute) {
  return async function idempotent(key, args) {
    // 1) Atomic reservation: only the FIRST attempt manages to insert the key.
    const reserved = await store.putIfAbsent(key, { status: 'in-flight' });

    if (!reserved) {
      // 2) Key already exists: another attempt is handling this action.
      const prior = await store.get(key);
      if (prior.status === 'done') return prior.result; // return the stored one
      // Still in progress: do NOT execute in parallel. Wait and re-check,
      // or signal the caller to try again later.
      throw new InFlightError(key);
    }

    try {
      // 3) Only the reservation winner actually executes the write action.
      const result = await execute(args);
      await store.put(key, { status: 'done', result });
      return result;
    } catch (err) {
      // Genuinely failed: release the key for a legitimate retry.
      await store.delete(key);
      throw err;
    }
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Three design decisions live in this wrapper. The first is the handling of the in-flight state: releasing the key too early reopens the window to duplicate; holding it forever locks up an action that genuinely failed. The second is the TTL of the key: it cannot live forever, otherwise the store grows without bound, but it must live longer than the largest possible retry interval, otherwise the key expires before the retry arrives and the duplicate gets through. The third is what to do when the execution itself fails: release the key to allow a legitimate retry, but with the care not to release an action that may have executed on the other side despite the error, which is exactly the ambiguous timeout case.',
        },
      ],
    },
    {
      title: 'Naturally idempotent tools versus the ones that need armoring',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not every tool needs the wrapper. Idempotency is first a property of the operation, and only then a mechanism you add. A read is idempotent by nature: querying the balance ten times returns the balance ten times without changing anything. A write that sets an absolute value usually is too: "mark this order as paid" produces the same final state however many times it runs. The danger lives in relative operations and in creation ones: "add ten to the balance" adds ten on every run; "create an order" creates a new order per attempt. Those are the ones the idempotency key needs to protect.',
        },
        {
          type: 'table',
          columns: ['Operation type', 'Idempotent by nature?', 'What to do'],
          rows: [
            [
              'Read (query balance, status)',
              'Yes, changes no state',
              'Retry freely, no key needed',
            ],
            [
              'Absolute write (set status = paid)',
              'Yes, same final state',
              'Safe for retry; key optional',
            ],
            [
              'Relative write (add to balance)',
              'No, accumulates per attempt',
              'Requires an idempotency key',
            ],
            [
              'Creation (new order, new charge)',
              'No, creates one per attempt',
              'Requires a key; many APIs have their own field',
            ],
            [
              'External send (message, email)',
              'No, visible duplicate delivery',
              'Requires a key; deduplicate before sending',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The good news is that many external APIs already offer native idempotency: payment gateways accept an idempotency-key header, queues have deduplication by message id, databases provide upsert by unique key. When the provider offers it, the best move is to use its defense instead of reinventing it, passing your derived key to the field it expects. The custom wrapper is left for tools that have no native defense, an internal send, a composite action, a write into a legacy system. The practical rule is to classify each tool before armoring it: if it is already idempotent or the provider already protects it, do not add a layer that only costs latency and a store to maintain.',
        },
      ],
    },
    {
      title: 'The ambiguous case: when you do not know if the action executed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The scenario that separates a mature defense from a naive one is the timeout on the write action. You sent the charge, the time ran out and the response never came back. Did the action execute on the other side and the confirmation get lost, or did it never even execute? The two hypotheses produce exactly the same local symptom: silence. Retrying blindly risks the double charge if the first one had gone through; giving up risks leaving the customer without the order if the first one had failed. There is no way to decide by looking only at your own side.',
        },
        {
          type: 'paragraph',
          value:
            'This is where the idempotency key changes the game: with it, the retry stops being a bet and becomes a safe question. Resending the action with the same key is safe by construction, because the executing side recognizes the key and, if the first attempt had gone through, returns the stored result instead of executing again; if it had not, it executes now. The idempotent retry resolves the timeout ambiguity without you needing to know the truth: the same call is at once the confirmation and the second attempt. Where the external API offers a status query by key, even better: you ask "does this action exist?" before resending. But even without that query, the key turns the timeout from a trap into a recoverable situation.',
        },
        {
          type: 'ordered',
          items: [
            'Never retry a keyless write action after a timeout: you do not know whether the first one executed, and the duplicate is invisible until the customer complains.',
            'Generate the key before the first send and reuse it on every retry of that action; the key belongs to the intent, one per intent.',
            'Prefer the provider native idempotency when it exists, passing your key to the expected field, instead of recreating the window on the outside.',
            'Set the key TTL larger than the largest possible retry interval, so the key never expires before the last attempt arrives.',
            'Handle the in-flight state with care: do not execute two attempts of the same key in parallel nor release the key before knowing the outcome.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Idempotency does not eliminate retries, it makes them safe. In an LLM system, where the loop retries, the model re-runs and the process resumes after a crash, trying again is inevitable and desirable, it is what gives robustness. What cannot happen is that this robustness is paid for with duplicated effects in the real world. The idempotency key is the contract that lets you retry without fear: you try as many times as you need, and the action happens once.',
        },
      ],
    },
    {
      title: 'Testing that the duplicate really does not get through',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An idempotency defense that has never been exercised under duplication is an assumption, not a guarantee. The test that matters is not "the tool works when called once", it is "the tool called twice with the same key produces a single effect". That requires simulating exactly the conditions that generate a duplicate: the same key arriving twice, the two nearly simultaneous attempts competing for the reservation, the timeout that leaves the action in progress and is retried. A test that only checks the sequential happy path passes even when the atomicity of the reservation is broken.',
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.test.js
// Tests the property that matters: same key -> single effect,
// including under concurrency and under retry after a timeout.
import { test, expect, vi } from 'vitest';
import { withIdempotency } from './withIdempotency.js';
import { memoryStore } from './memoryStore.js';

test('two calls with the same key execute the action ONCE', async () => {
  const charge = vi.fn(async () => ({ id: 'ch_1', ok: true }));
  const idempotent = withIdempotency(memoryStore(), charge);

  const r1 = await idempotent('key-abc', { amount: 10 });
  const r2 = await idempotent('key-abc', { amount: 10 }); // retry

  expect(charge).toHaveBeenCalledTimes(1);   // the write ran once
  expect(r2).toEqual(r1);                     // the retry returned the stored one
});

test('two concurrent attempts do not execute both', async () => {
  let running = 0;
  const charge = vi.fn(async () => {
    running += 1;
    expect(running).toBe(1);                  // there are never 2 runs at once
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return { id: 'ch_1' };
  });
  const idempotent = withIdempotency(memoryStore(), charge);

  // Fire both at the same time, competing for the atomic reservation.
  const results = await Promise.allSettled([
    idempotent('key-xyz', { amount: 10 }),
    idempotent('key-xyz', { amount: 10 }),
  ]);

  // At most one executed; the other fell into the deduplication branch.
  expect(charge).toHaveBeenCalledTimes(1);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Beyond the automated test, it is worth monitoring duplication in production with a simple metric: the hit rate of the deduplication window, that is, how many attempts fell into the "key already exists" branch. A value near zero can mean the defense is never exercised, but it can also mean the key is being generated wrong and every attempt creates a fresh key, in which case the protection does not actually exist. A sudden spike in this metric usually reveals a badly calibrated retry loop firing many repetitions. Idempotency is one of those properties you only know is working when you measure how much it is blocking, because its effect is precisely an absence: the duplicate that did not happen.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is an idempotency key and why does it belong to the intent, not the attempt?',
      answer:
        'An idempotency key is an identifier that marks a single logical action, so that all attempts to execute that same action carry the same key. That is why it has to belong to the intent and not the attempt: if each retry generated a fresh key, the deduplication mechanism would see distinct actions and execute all of them, exactly what you wanted to avoid. The key has to be born before the retry loop, tied to the intent of doing that action, and be reused on every attempt. It can be explicit, an id generated once when the action is decided, or derived, a deterministic hash of the normalized parameters of the action. The derived one avoids carrying state, but it needs to include something that distinguishes genuinely different intents with the same parameters, so as not to collapse two legitimate requests into a single key.',
    },
    {
      question: 'Does every tool of an agent need idempotency?',
      answer:
        'No. Idempotency only matters for actions that change the state of the world and whose effect accumulates or duplicates on each execution. Reads, such as querying a balance or a status, are idempotent by nature and can be retried freely with no defense at all. Absolute writes, of the "set this order as paid" kind, also tend to be safe because they produce the same final state however many times they run. The ones that need the key are the relative operations, such as "add ten to the balance", and the creation and send ones, such as "create an order" or "send this message", because each attempt generates a new, visible effect. The rule is to classify the operation before armoring it: adding a deduplication window to a tool that is already idempotent only costs latency and a store to maintain, with no gain.',
    },
    {
      question: 'How does idempotency solve the retry after a timeout?',
      answer:
        'The timeout on a write action is ambiguous: the action may have executed on the other side and the confirmation been lost, or it may never even have executed, and the local symptom is the same silence in both cases. Without idempotency, retrying risks duplicating the action and giving up risks leaving it with no effect, and there is no way to decide by looking only at your side. With an idempotency key, the retry stops being a bet: resending the same action with the same key is safe by construction, because the executing side recognizes the key and, if the first attempt had gone through, returns the stored result instead of executing again; if it had not, it executes now. The same call works at once as confirmation and as second attempt, so you recover the timeout without needing to know which of the two hypotheses was the true one.',
    },
  ],
  conclusion: {
    title: 'Idempotency is what makes the agent retry safe',
    description:
      'In an LLM system retries are inevitable: the loop retries, the model re-runs, the process resumes after a crash. Without an idempotency key derived from the intent and a deduplication window that stores the result of the first execution, each of these repetitions becomes a double charge, a duplicated order or a message sent twice. I can design that idempotency layer in the write tools of your agent, classifying each operation, choosing between the provider native defense and a custom wrapper, and testing that the duplicate really does not get through, so the agent can try again as many times as it needs without touching the real world twice.',
    cta: 'Talk about idempotency in my agent tools',
  },
  related: [
    { label: 'Orchestrating AI agents in production', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'LLM output guardrails: validation and safe refusal', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'tool-use-idempotency-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Un agente que solo lee el mundo puede ser reintentado a gusto: si la llamada falla, probás de nuevo y no pasa nada malo. El problema empieza cuando la herramienta escribe, cuando cobra una tarjeta, crea un pedido, envía un mensaje o dispara un reembolso. Ahí cada retry pasa a ser peligroso, porque el mundo cambió entre el primer intento y el segundo, y repetir la acción duplica el efecto. Y los retries son la regla, no la excepción, en un sistema con LLM: el modelo se reejecuta cuando la respuesta viene malformada, el loop de tool use se reanuda después de una caída, el timeout de red dispara el intento antes de que el primero haya terminado. La idempotencia es la propiedad que separa "ejecuté la acción una vez" de "ejecuté la acción cuantas veces el loop necesitó intentar". Este artículo muestra por qué el agente duplica acción con tanta facilidad, cómo derivar una clave de idempotencia que sobreviva al retry, el patrón de ventana de deduplicación que guarda el resultado de la primera ejecución, la diferencia entre una herramienta naturalmente idempotente y una que necesita blindaje, y cómo probar que el duplicado realmente no pasa.',
  sections: [
    {
      title: 'Por qué el agente duplica acción con tanta facilidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El punto más frágil de un loop de tool use es la frontera entre "la herramienta ejecutó" y "el agente supo que ejecutó". Entre esos dos momentos hay una red, un proceso que puede caer, un timeout que puede dispararse. La herramienta cobra la tarjeta con éxito, pero la respuesta se pierde en el camino de vuelta; el agente, sin confirmación, concluye que la llamada falló e intenta de nuevo. Desde el punto de vista del modelo fue una única intención, "cobrar al cliente"; desde el punto de vista del mundo fueron dos cobros. El agente no duplica por tontera, duplica porque la única información que tiene es la ausencia de respuesta, y ausencia de respuesta es indistinguible de una falla real.',
        },
        {
          type: 'paragraph',
          value:
            'Sumá a eso la naturaleza probabilística del LLM. El modelo puede generar la misma tool call dos veces en la misma conversación porque perdió el rastro de que ya la hizo, puede reemitir una acción después de que el contexto fue truncado, puede reaccionar a un error de parsing repitiendo el paso entero. Y el loop de orquestación, tratando de ser robusto, agrega su propia capa de retry por encima. El resultado es que la misma acción de escritura tiene varias fuentes independientes de repetición, y ninguna de ellas sabe de la otra. Sin una defensa explícita, la pregunta no es si la acción va a duplicar, es cuándo.',
        },
        {
          type: 'list',
          items: [
            'Retry del loop de orquestación: la llamada de red dio timeout y el loop intenta de nuevo, sin saber si la primera llegó a ejecutar del otro lado.',
            'Reejecución del modelo: la respuesta vino malformada, el paso entero se rehace y la tool call de escritura se emite una segunda vez.',
            'Reanudación tras la caída: el proceso cayó en medio del loop, el estado durable se recarga y la etapa en curso corre de nuevo.',
            'Repetición por el propio LLM: el modelo pierde el rastro de lo que ya hizo y genera la misma acción más de una vez en la misma conversación.',
          ],
        },
      ],
    },
    {
      title: 'La clave de idempotencia: derivarla de la intención, no del azar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La defensa empieza con una clave que identifica la intención, no el intento. La idea es que todas las repeticiones de una misma acción lógica lleven la misma clave, para que el lado que ejecuta logre reconocer "esto ya lo hice". El error clásico es generar la clave dentro del retry: si cada intento crea una clave nueva aleatoria, el deduplicador ve dos acciones distintas y ejecuta las dos. La clave tiene que nacer antes del loop de retry y sobrevivirlo, atada a la intención, no al instante.',
        },
        {
          type: 'paragraph',
          value:
            'Hay dos formas de conseguirlo. La primera es la clave explícita: el orquestador genera un identificador único cuando decide hacer la acción, una vez, y lo pasa en todo intento de esa acción. La segunda es la clave derivada: calculás un hash determinístico de los parámetros que definen la acción, de modo que la misma intención siempre produzca la misma clave sin necesitar cargar un id. La derivada es atractiva porque no exige estado extra, pero tiene una trampa: si dos pedidos legítimos y distintos tienen exactamente los mismos parámetros, colapsan en la misma clave y el segundo es tragado como si fuera duplicado. Por eso la clave derivada necesita incluir algo que distinga intenciones genuinamente diferentes.',
        },
        {
          type: 'code',
          value: `// idempotency/key.js
// Deriva una clave de idempotencia a partir de la intencion de la accion.
// La misma intencion logica -> la misma clave, en todo intento.
import { createHash } from 'node:crypto';

export function idempotencyKey({ tool, actor, params, intentId }) {
  // intentId se genera UNA vez, cuando la accion se decide, y se pasa en
  // todo retry. Es lo que garantiza que dos intenciones legitimas con los
  // mismos parametros (ej.: dos reembolsos iguales) NO colapsen en una clave.
  const canonical = JSON.stringify({
    tool,                       // que herramienta
    actor,                      // en nombre de quien (evita cruzar clientes)
    params: sortKeys(params),   // parametros normalizados y ordenados
    intentId,                   // desambigua intenciones distintas iguales
  });
  return createHash('sha256').update(canonical).digest('hex');
}

// Ordena las claves para que { a, b } y { b, a } generen el MISMO hash:
// el orden de las claves del objeto no puede cambiar la identidad de la accion.
function sortKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortKeys);
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => ((acc[k] = sortKeys(obj[k])), acc), {});
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en el detalle de la normalización: `{ monto: 10, moneda: "USD" }` y `{ moneda: "USD", monto: 10 }` describen el mismo cobro y necesitan generar la misma clave, si no dos intentos de la misma acción, serializados en órdenes diferentes, escaparían de la deduplicación. Ordenar las claves antes del hash es lo que vuelve la clave estable. E incluir el `actor` en la clave evita el peor tipo de bug: dos intenciones de clientes diferentes con los mismos parámetros compartiendo una clave y un cliente recibiendo el resultado del otro.',
        },
      ],
    },
    {
      title: 'La ventana de deduplicación: guardar el resultado de la primera ejecución',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la clave en mano, el mecanismo es una ventana de deduplicación: un store que, para cada clave, guarda el estado de la acción. Antes de ejecutar, la herramienta consulta el store. Si la clave es nueva, reserva la clave, ejecuta, guarda el resultado y lo devuelve. Si la clave ya existe y la acción terminó, devuelve el resultado guardado sin ejecutar nada. El punto sutil, que separa una defensa que funciona de una que solo parece funcionar, es lo que pasa cuando la clave existe pero la acción todavía está en curso: dos intentos casi simultáneos no pueden ejecutar los dos. Por eso la reserva de la clave y la verificación tienen que ser atómicas, un "inserta si no existe" que solo uno de los concurrentes gana.',
        },
        {
          type: 'diagram',
          value: `Flujo de una llamada de herramienta con idempotencia

  tool call + clave
        |
        v
  [ INSERTA-SI-NO-EXISTE la clave en el store ]  <- atomico: solo uno gana
        |
     +--+---------------------------+
     | gano (clave nueva)           | perdio (clave ya existe)
     v                              v
  [ ejecuta la accion de escritura ] [ lee el estado guardado ]
     |                              |
     v                         +----+-----------------+
  [ guarda el resultado ]     | done -> devuelve el   | in-flight -> espera
     |                        | resultado guardado    | o senala retry
     v                        v                       v
  [ devuelve el resultado ]  (no ejecuta de nuevo)   (no ejecuta en paralelo)

  la accion de escritura corre UNA vez por clave; todo retry cae a la derecha.`,
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.js
// Envuelve una herramienta de escritura con una ventana de deduplicacion.
// La accion corre a lo sumo una vez por clave; los retries devuelven lo guardado.

export function withIdempotency(store, execute) {
  return async function idempotent(key, args) {
    // 1) Reserva atomica: solo el PRIMER intento logra insertar la clave.
    const reserved = await store.putIfAbsent(key, { status: 'in-flight' });

    if (!reserved) {
      // 2) La clave ya existe: otro intento esta atendiendo esta accion.
      const prior = await store.get(key);
      if (prior.status === 'done') return prior.result; // devuelve lo guardado
      // Todavia en curso: NO ejecuta en paralelo. Espera y reconsulta,
      // o senala al llamador para intentar de nuevo mas tarde.
      throw new InFlightError(key);
    }

    try {
      // 3) Solo el ganador de la reserva ejecuta la accion de escritura.
      const result = await execute(args);
      await store.put(key, { status: 'done', result });
      return result;
    } catch (err) {
      // Fallo de verdad: libera la clave para un reintento legitimo.
      await store.delete(key);
      throw err;
    }
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Tres decisiones de diseño viven en este wrapper. La primera es el tratamiento del estado in-flight: liberar la clave demasiado temprano reabre la ventana para duplicar; retenerla para siempre traba una acción que falló de verdad. La segunda es el TTL de la clave: no puede vivir eternamente, si no el store crece sin límite, pero tiene que vivir más que el mayor intervalo de retry posible, si no la clave expira antes de que el retry llegue y el duplicado pasa. La tercera es qué hacer cuando la propia ejecución falla: liberar la clave para permitir un reintento legítimo, pero con el cuidado de no liberar una acción que quizás haya ejecutado del otro lado a pesar del error, que es exactamente el caso ambiguo del timeout.',
        },
      ],
    },
    {
      title: 'Herramientas naturalmente idempotentes versus las que necesitan blindaje',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No toda herramienta necesita el wrapper. La idempotencia es primero una propiedad de la operación, y solo después un mecanismo que agregás. Una lectura es idempotente por naturaleza: consultar el saldo diez veces devuelve el saldo diez veces sin alterar nada. Una escritura que define un valor absoluto también suele serlo: "marcá este pedido como pago" produce el mismo estado final cuantas veces corra. El peligro vive en las operaciones relativas y en las que crean: "sumá diez al saldo" suma diez en cada ejecución; "creá un pedido" crea un pedido nuevo por intento. Esas son las que la clave de idempotencia necesita proteger.',
        },
        {
          type: 'table',
          columns: ['Tipo de operación', '¿Idempotente por naturaleza?', 'Qué hacer'],
          rows: [
            [
              'Lectura (consultar saldo, estado)',
              'Sí, no altera estado',
              'Se puede reintentar a gusto, sin clave',
            ],
            [
              'Escritura absoluta (definir estado = pago)',
              'Sí, mismo estado final',
              'Segura para retry; clave opcional',
            ],
            [
              'Escritura relativa (sumar al saldo)',
              'No, acumula en cada intento',
              'Exige clave de idempotencia',
            ],
            [
              'Creación (nuevo pedido, nuevo cobro)',
              'No, crea uno por intento',
              'Exige clave; muchas APIs tienen campo propio',
            ],
            [
              'Envío externo (mensaje, e-mail)',
              'No, entrega duplicada visible',
              'Exige clave; deduplicar antes de enviar',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La buena noticia es que muchas APIs externas ya ofrecen idempotencia nativa: los gateways de pago aceptan un header de clave de idempotencia, las colas tienen deduplicación por id de mensaje, las bases de datos dan upsert por clave única. Cuando el proveedor lo ofrece, la mejor jugada es usar su defensa en vez de reinventarla, pasando tu clave derivada al campo que espera. El wrapper propio queda para las herramientas que no tienen defensa nativa, un envío interno, una acción compuesta, una escritura en un sistema legado. La regla práctica es clasificar cada herramienta antes de blindar: si ya es idempotente o el proveedor ya protege, no agregues una capa que solo cuesta latencia y un store para mantener.',
        },
      ],
    },
    {
      title: 'El caso ambiguo: cuando no sabés si la acción ejecutó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El escenario que separa una defensa madura de una ingenua es el timeout en la acción de escritura. Mandaste a cobrar, el tiempo se agotó y la respuesta nunca volvió. ¿La acción ejecutó del otro lado y la confirmación se perdió, o ni llegó a ejecutar? Las dos hipótesis producen exactamente el mismo síntoma local: silencio. Reintentar a ciegas arriesga el doble cobro si el primero había pasado; desistir arriesga dejar al cliente sin el pedido si el primero había fallado. No hay forma de decidir mirando solo tu lado.',
        },
        {
          type: 'paragraph',
          value:
            'Acá es donde la clave de idempotencia cambia el juego: con ella, el retry deja de ser una apuesta y se vuelve una pregunta segura. Reenviar la acción con la misma clave es seguro por construcción, porque el lado que ejecuta reconoce la clave y, si el primer intento había pasado, devuelve el resultado guardado en vez de ejecutar de nuevo; si no había pasado, ejecuta ahora. El retry idempotente resuelve la ambigüedad del timeout sin que necesités saber la verdad: la misma llamada es al mismo tiempo la confirmación y el segundo intento. Donde la API externa ofrece una consulta de estado por clave, mejor todavía: preguntás "¿esta acción existe?" antes de reenviar. Pero incluso sin esa consulta, la clave transforma el timeout de una trampa en una situación recuperable.',
        },
        {
          type: 'ordered',
          items: [
            'Nunca reintentes una acción de escritura sin clave tras un timeout: no sabés si la primera ejecutó, y el duplicado es invisible hasta que el cliente reclama.',
            'Generá la clave antes del primer envío y reutilizala en todo retry de esa acción; la clave es de la intención, una sola por intención.',
            'Preferí la idempotencia nativa del proveedor cuando exista, pasando tu clave al campo esperado, en vez de recrear la ventana por fuera.',
            'Definí el TTL de la clave mayor que el mayor intervalo de retry posible, para que la clave nunca expire antes de que llegue el último intento.',
            'Tratá el estado in-flight con cuidado: no ejecutes en paralelo dos intentos de la misma clave ni liberes la clave antes de saber el desenlace.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La idempotencia no elimina los retries, los vuelve seguros. En un sistema con LLM, donde el loop reintenta, el modelo reejecuta y el proceso reanuda tras caer, intentar de nuevo es inevitable y deseable, es lo que da robustez. Lo que no puede pasar es que esa robustez se pague con efectos duplicados en el mundo real. La clave de idempotencia es el contrato que permite reintentar sin miedo: intentás cuantas veces necesités, y la acción ocurre una sola vez.',
        },
      ],
    },
    {
      title: 'Probar que el duplicado realmente no pasa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una defensa de idempotencia que nunca fue ejercitada bajo duplicación es una suposición, no una garantía. La prueba que importa no es "la herramienta funciona cuando se la llama una vez", es "la herramienta llamada dos veces con la misma clave produce un solo efecto". Eso exige simular exactamente las condiciones que generan duplicado: la misma clave llegando dos veces, los dos intentos casi simultáneos disputando la reserva, el timeout que deja la acción en curso y es reintentado. Una prueba que solo verifica el camino feliz secuencial pasa incluso cuando la atomicidad de la reserva está rota.',
        },
        {
          type: 'code',
          value: `// idempotency/withIdempotency.test.js
// Prueba la propiedad que importa: misma clave -> efecto unico,
// incluso bajo concurrencia y bajo retry tras timeout.
import { test, expect, vi } from 'vitest';
import { withIdempotency } from './withIdempotency.js';
import { memoryStore } from './memoryStore.js';

test('dos llamadas con la misma clave ejecutan la accion UNA vez', async () => {
  const charge = vi.fn(async () => ({ id: 'ch_1', ok: true }));
  const idempotent = withIdempotency(memoryStore(), charge);

  const r1 = await idempotent('key-abc', { amount: 10 });
  const r2 = await idempotent('key-abc', { amount: 10 }); // retry

  expect(charge).toHaveBeenCalledTimes(1);   // la escritura corrio 1 vez
  expect(r2).toEqual(r1);                     // el retry devolvio lo guardado
});

test('dos intentos concurrentes no ejecutan los dos', async () => {
  let running = 0;
  const charge = vi.fn(async () => {
    running += 1;
    expect(running).toBe(1);                  // nunca hay 2 ejecuciones juntas
    await new Promise((r) => setTimeout(r, 5));
    running -= 1;
    return { id: 'ch_1' };
  });
  const idempotent = withIdempotency(memoryStore(), charge);

  // Dispara las dos al mismo tiempo, disputando la reserva atomica.
  const results = await Promise.allSettled([
    idempotent('key-xyz', { amount: 10 }),
    idempotent('key-xyz', { amount: 10 }),
  ]);

  // A lo sumo una ejecuto; la otra cayo en el ramo de deduplicacion.
  expect(charge).toHaveBeenCalledTimes(1);
  expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Además de la prueba automatizada, vale monitorear la duplicación en producción con una métrica simple: la tasa de aciertos de la ventana de deduplicación, o sea, cuántos intentos cayeron en el ramo "clave ya existe". Un valor cerca de cero puede significar que la defensa nunca se ejerce, pero también puede significar que la clave se está generando mal y cada intento crea una clave nueva, caso en que la protección no existe de hecho. Un pico súbito en esta métrica suele delatar un loop de retry mal calibrado disparando muchas repeticiones. La idempotencia es una de esas propiedades que solo se sabe que está funcionando cuando se mide cuánto está frenando, porque su efecto es justamente una ausencia: el duplicado que no ocurrió.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Qué es una clave de idempotencia y por qué es de la intención, no del intento?',
      answer:
        'Una clave de idempotencia es un identificador que marca una acción lógica única, de modo que todos los intentos de ejecutar esa misma acción lleven la misma clave. Por eso tiene que ser de la intención y no del intento: si cada retry generara una clave nueva, el mecanismo de deduplicación vería acciones distintas y ejecutaría todas, exactamente lo que querías evitar. La clave tiene que nacer antes del loop de retry, atada a la intención de hacer esa acción, y ser reutilizada en cada intento. Puede ser explícita, un id generado una vez cuando la acción se decide, o derivada, un hash determinístico de los parámetros normalizados de la acción. La derivada evita cargar estado, pero necesita incluir algo que distinga intenciones genuinamente diferentes con los mismos parámetros, para no colapsar dos pedidos legítimos en una sola clave.',
    },
    {
      question: '¿Toda herramienta de un agente necesita idempotencia?',
      answer:
        'No. La idempotencia solo importa para acciones que cambian el estado del mundo y cuyo efecto se acumula o se duplica en cada ejecución. Las lecturas, como consultar un saldo o un estado, son idempotentes por naturaleza y pueden reintentarse a gusto sin defensa alguna. Las escrituras absolutas, del tipo "definí este pedido como pago", también tienden a ser seguras porque producen el mismo estado final cuantas veces corran. Las que necesitan la clave son las operaciones relativas, como "sumá diez al saldo", y las de creación y envío, como "creá un pedido" o "enviá este mensaje", porque cada intento genera un efecto nuevo y visible. La regla es clasificar la operación antes de blindar: agregar una ventana de deduplicación a una herramienta que ya es idempotente solo cuesta latencia y un store para mantener, sin ganancia.',
    },
    {
      question: '¿Cómo resuelve la idempotencia el retry después de un timeout?',
      answer:
        'El timeout en una acción de escritura es ambiguo: la acción puede haber ejecutado del otro lado y la confirmación haberse perdido, o puede no haber llegado a ejecutar, y el síntoma local es el mismo silencio en ambos casos. Sin idempotencia, reintentar arriesga duplicar la acción y desistir arriesga dejarla sin efecto, y no hay forma de decidir mirando solo tu lado. Con una clave de idempotencia, el retry deja de ser una apuesta: reenviar la misma acción con la misma clave es seguro por construcción, porque el lado que ejecuta reconoce la clave y, si el primer intento había pasado, devuelve el resultado guardado en vez de ejecutar de nuevo; si no había pasado, ejecuta ahora. La misma llamada funciona al mismo tiempo como confirmación y como segundo intento, así que recuperás el timeout sin necesitar saber cuál de las dos hipótesis era la verdadera.',
    },
  ],
  conclusion: {
    title: 'La idempotencia es lo que vuelve seguro el retry del agente',
    description:
      'En un sistema con LLM los retries son inevitables: el loop reintenta, el modelo reejecuta, el proceso reanuda tras caer. Sin una clave de idempotencia derivada de la intención y una ventana de deduplicación que guarda el resultado de la primera ejecución, cada una de esas repeticiones se vuelve un doble cobro, un pedido duplicado o un mensaje enviado dos veces. Puedo diseñar esa capa de idempotencia en las herramientas de escritura de tu agente, clasificando cada operación, eligiendo entre la defensa nativa del proveedor y el wrapper propio, y probando que el duplicado realmente no pasa, para que el agente pueda intentar de nuevo cuantas veces necesite sin tocar el mundo real dos veces.',
    cta: 'Hablar sobre idempotencia en las herramientas de mi agente',
  },
  related: [
    { label: 'Orquestación de agentes de IA en producción', to: '/blog/orquestracao-agentes-ia-producao' },
    { label: 'Guardrails de salida en LLM: validación y rechazo seguro', to: '/blog/guardrails-saida-llm-validacao-recusa-segura' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'tool-use-idempotency-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
