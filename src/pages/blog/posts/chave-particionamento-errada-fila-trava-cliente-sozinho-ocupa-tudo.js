// Conteudo do artigo: chave de particionamento errada e bloqueio de fila por um unico cliente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A fila tem trinta e dois consumidores, o painel mostra doze por cento de uso de CPU, e mesmo assim as mensagens de quarenta clientes estão paradas há dezoito minutos. Não falta capacidade: falta distribuição. Um único cliente despejou setenta mil eventos numa partição e todo mundo que caiu naquela mesma partição entrou na fila atrás dele. Este artigo mostra por que a escolha da chave de particionamento é uma decisão de isolamento e não de performance, por que a ordenação por partição é justamente o que transforma um cliente grande em bloqueio para os outros, como medir o desequilíbrio antes de ele virar incidente, quais chaves compostas resolvem sem quebrar a ordem que o negócio realmente exige, por que aumentar o número de partições não conserta e o que fazer com o cliente que sozinho excede a capacidade de uma partição.',
  sections: [
    {
      title: 'A chave decide quem espera por quem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em qualquer sistema de log particionado, seja Kafka, Kinesis, Pub/Sub com chave de ordenação ou uma fila caseira em cima do Postgres, a chave cumpre duas funções ao mesmo tempo e quase todo desenho só considera uma delas. A primeira é a que aparece na documentação: mensagens com a mesma chave vão para a mesma partição e por isso são entregues na ordem em que foram produzidas. A segunda é a que aparece no incidente: mensagens com chaves diferentes que caem na mesma partição por acaso do hash passam a compartilhar uma fila serial e uma sorte comum. A chave não define apenas o que fica ordenado, define quem fica preso atrás de quem.',
        },
        {
          type: 'paragraph',
          value:
            'É por isso que a pergunta certa na hora de escolher a chave não é qual campo distribui melhor, e sim qual é a menor unidade que realmente precisa de ordem. Se o requisito é que os eventos de uma conversa sejam processados na sequência, a unidade é a conversa e não o cliente. Se a chave for o identificador do cliente, todas as conversas daquele cliente ficam serializadas por uma exigência que o negócio nunca fez, e a fila herda um gargalo artificial. A regra prática que fecha essa parte é direta: ordenar mais do que o necessário nunca é neutro, é sempre capacidade jogada fora e latência transferida para quem não pediu.',
        },
        {
          type: 'diagram',
          value: `CHAVE = tenant_id  (ordem alem do necessario)

P0  [tenant-A x 70000 ...........................] <- 18 min de backlog
P1  [tenant-C][tenant-F][tenant-J]                  <- vazia em segundos
P2  [tenant-B][tenant-D]                            <- vazia em segundos
P3  [tenant-E][tenant-G][tenant-H]                  <- vazia em segundos
     ^ tenant-K caiu no hash de P0 e espera 18 min
       por um backlog que nao e dele

CHAVE = tenant_id + conversation_id  (ordem no que o negocio exige)

P0  [A/c1][K/c9][A/c4][C/c2]
P1  [A/c2][B/c7][A/c5][K/c3]
P2  [A/c3][D/c1][F/c8][A/c6]
P3  [A/c7][E/c2][A/c8][J/c4]
     ^ o volume do tenant-A continua grande, mas agora
       se espalha, e nenhum outro tenant fica atras dele`,
        },
        {
          type: 'paragraph',
          value:
            'Vale separar dois fenômenos que costumam ser tratados como um só porque produzem o mesmo sintoma no painel. Desequilíbrio de partição é quando o hash distribui mal e uma partição recebe mais mensagens que as outras, e ele se corrige com mais entropia na chave. Bloqueio de cabeça de fila é quando uma única mensagem lenta ou envenenada trava tudo que está atrás dela na mesma partição, e ele não se corrige com entropia nenhuma, porque o problema não é o volume e sim a serialização. Sistemas reais quase sempre têm os dois, e a correção de um não ajuda em nada no outro.',
        },
      ],
    },
    {
      title: 'Medir o desequilíbrio antes que ele vire incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A métrica que quase todo time tem é o lag total do grupo de consumidores, e ela é péssima para esse problema específico. O lag total é uma soma, e a soma esconde exatamente a informação que interessa: uma partição com noventa mil mensagens de atraso e trinta e uma partições zeradas produzem o mesmo número que trinta e duas partições com quase três mil cada. No primeiro caso existe um incidente em curso para um subconjunto de clientes, no segundo o sistema está apenas ocupado. O painel mostra o mesmo valor nos dois.',
        },
        {
          type: 'paragraph',
          value:
            'O que revela o problema é olhar a distribuição em vez do agregado, e três medidas bastam. O lag máximo por partição diz se existe alguma partição em situação ruim, e é ele que deve disparar alerta, não a soma. A razão entre o lag máximo e o lag mediano diz se o sistema está desequilibrado ou apenas carregado, e um valor persistente acima de cinco é sinal de chave mal escolhida e não de falta de consumidor. A participação do maior produtor por partição diz de quem é o volume, e é essa medida que transforma um alerta genérico em uma ação concreta, porque ela nomeia o cliente que precisa de tratamento diferente.',
        },
        {
          type: 'code',
          value: `// metrics/partition-skew.js
// Distribuicao do lag por particao, nao a soma.
//
// A soma esconde o caso que importa: uma particao com 90k de lag e
// 31 zeradas somam o mesmo que 32 particoes com 2.8k cada. A primeira
// e um incidente para um subconjunto de clientes, a segunda e trafego.

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
};

// lagByPartition: Map<partitionId, number>
export const describeSkew = (lagByPartition) => {
  const entries = [...lagByPartition.entries()];
  const values = entries.map(([, lag]) => lag).sort((a, b) => a - b);

  const total = values.reduce((sum, lag) => sum + lag, 0);
  const median = percentile(values, 0.5);
  const max = values[values.length - 1] ?? 0;

  const [hottestPartition] = entries.reduce(
    (worst, entry) => (entry[1] > worst[1] ? entry : worst),
    [null, -1],
  );

  return {
    total,
    median,
    max,
    hottestPartition,
    // Razao, nao diferenca: 90000/2800 e desequilibrio, 90000/89000 e carga.
    // Mediana zero com maximo positivo e o caso mais grave, e virar Infinity
    // aqui seria perder o alerta, entao ancoramos em 1.
    skewRatio: max / Math.max(median, 1),
    // Particoes efetivamente paradas enquanto existe backlog em outra:
    // capacidade contratada, paga e ociosa.
    idlePartitions: values.filter((lag) => lag === 0).length,
  };
};

// Alerta por particao, nao por soma. O limiar de razao pega o desequilibrio
// que ainda nao virou lag absoluto grande, que e a janela util para agir.
export const skewAlerts = (skew, { maxLagThreshold = 5000, maxSkewRatio = 5 } = {}) => {
  const alerts = [];

  if (skew.max > maxLagThreshold) {
    alerts.push({
      level: 'page',
      reason: 'partition_lag_high',
      partition: skew.hottestPartition,
      value: skew.max,
    });
  }

  // Desequilibrio com lag ainda baixo: nao acorda ninguem, mas vira tarefa
  // de revisao de chave antes do proximo pico.
  if (skew.skewRatio > maxSkewRatio && skew.idlePartitions > 0) {
    alerts.push({
      level: 'ticket',
      reason: 'partition_key_skew',
      partition: skew.hottestPartition,
      value: Number(skew.skewRatio.toFixed(1)),
    });
  }

  return alerts;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Há um detalhe operacional que muda o valor desse alerta: ele precisa rodar sobre uma janela curta, de um ou dois minutos, e não sobre a média da hora. Desequilíbrio é um fenômeno de rajada, e ele aparece justamente quando um cliente dispara uma importação, uma campanha ou uma reprocessagem. Na média de sessenta minutos, um pico de quatro minutos com razão vinte vira uma razão dois e some do painel, e o time descobre o problema pelo canal de suporte em vez de pelo alerta.',
        },
      ],
    },
    {
      title: 'Chave composta: espalhar sem perder a ordem que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção estrutural quase sempre é a mesma: trocar a chave por uma composição que carregue a menor unidade de ordem real. Em atendimento, isso normalmente é a conversa e não o cliente, porque duas conversas do mesmo cliente não têm relação causal entre si. Em cobrança, é a assinatura e não a empresa. Em estoque, é o item e não o depósito. A composição precisa manter o identificador de tenant como prefixo quando o roteamento posterior depende dele, mas o que entra no cálculo do hash passa a ser o par completo.',
        },
        {
          type: 'table',
          columns: ['Chave', 'Ordem garantida', 'Efeito no desequilíbrio', 'Quando faz sentido'],
          rows: [
            [
              'tenant_id',
              'Todos os eventos do cliente, em série',
              'Máximo: um cliente grande ocupa uma partição inteira',
              'Só quando a ordem entre entidades diferentes do mesmo cliente é obrigatória, o que é raro',
            ],
            [
              'tenant_id + entidade',
              'Eventos da mesma conversa, pedido ou assinatura',
              'Baixo enquanto o cliente tiver muitas entidades ativas',
              'Padrão para a maioria dos sistemas de atendimento e transacionais',
            ],
            [
              'tenant_id + entidade + sufixo por faixa',
              'Eventos da mesma entidade dentro da faixa',
              'Controlado, ao custo de ordem parcial',
              'Entidade única com volume que não cabe em uma partição, como um canal de broadcast',
            ],
            [
              'Aleatória ou round-robin',
              'Nenhuma',
              'Nenhum, distribuição perfeita',
              'Eventos idempotentes e comutativos, como métricas e logs',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A troca de chave tem um custo que precisa ser planejado e é onde a maioria das migrações erra: durante a transição, eventos da mesma entidade existem nas duas partições, a antiga e a nova, e a ordem entre eles deixa de ser garantida exatamente no intervalo em que as duas convivem. A forma segura de fazer é drenar antes de cortar. O produtor passa a escrever num tópico novo com a chave nova, os consumidores continuam lendo o tópico antigo até o lag chegar a zero e só então assumem o novo. Cortar a chave no mesmo tópico, sem drenar, é criar uma janela de reordenação silenciosa que só vai aparecer depois, como um estado inconsistente que ninguém consegue reproduzir.',
        },
        {
          type: 'code',
          value: `// queue/partition-key.js
// Chave composta: a menor unidade que o negocio exige em ordem.
//
// Manter tenant_id no prefixo serve para roteamento e depuracao, mas o
// hash usa a chave inteira. Trocar o separador ou a ordem dos campos
// remapeia tudo: a chave e um contrato, versionado como qualquer outro.

const SEPARATOR = '\\u001f'; // unit separator: nao aparece em id de negocio

export const partitionKey = ({ tenantId, entityId }) => {
  if (!tenantId || !entityId) {
    // Cair no null aqui significa round-robin silencioso e perda de ordem.
    // Melhor falhar na producao do evento do que descobrir no consumo.
    throw new Error('partition_key_requires_tenant_and_entity');
  }
  return \`\${tenantId}\${SEPARATOR}\${entityId}\`;
};

// Sufixo por faixa para a entidade que sozinha excede uma particao.
// Custo explicito: eventos da mesma entidade deixam de ter ordem total
// entre si. So use quando a ordem dentro da faixa for suficiente, por
// exemplo entregas de broadcast, que sao independentes entre destinatarios.
export const shardedPartitionKey = ({ tenantId, entityId, shardCount = 1, discriminator }) => {
  const base = partitionKey({ tenantId, entityId });
  if (shardCount <= 1) return base;

  // O discriminador precisa ser estavel por sub-unidade (o destinatario),
  // nao aleatorio: aleatorio quebraria a ordem tambem dentro da sub-unidade.
  const shard = stableHash(String(discriminator ?? '')) % shardCount;
  return \`\${base}\${SEPARATOR}\${shard}\`;
};

// FNV-1a: estavel entre processos e versoes de runtime. Nao use
// String.prototype.hashCode improvisado nem Math.random: a chave precisa
// produzir a mesma particao daqui a seis meses, em outro deploy.
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};`,
        },
      ],
    },
    {
      title: 'Por que aumentar o número de partições não resolve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A reação mais comum diante do desequilíbrio é subir o número de partições, e ela falha por um motivo aritmético simples: uma chave sempre mapeia para uma partição só. Se a chave é o identificador do cliente e um cliente concentra setenta mil eventos, esses setenta mil continuam em uma única partição, tenha o tópico oito ou oitocentas. O que muda é apenas a probabilidade de outro cliente cair junto, o que reduz o número de vítimas colaterais sem reduzir em nada o tempo de espera do cliente grande nem o da vítima que ainda assim cair no mesmo hash.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda um efeito colateral que costuma passar despercebido no momento da mudança. Aumentar o número de partições em um tópico já em uso remapeia todas as chaves, porque o destino é calculado como hash da chave módulo o número de partições. Eventos de uma mesma entidade que estavam na partição três passam a ir para a onze, enquanto os antigos ainda esperam na três, e por um intervalo a ordem entre eles simplesmente não existe. Ou seja, a medida que não resolve o desequilíbrio introduz, de graça, a mesma janela de reordenação que uma troca de chave mal feita introduziria.',
        },
        {
          type: 'list',
          items: [
            'Mais partições ajudam quando o gargalo é vazão agregada e as chaves já estão bem distribuídas, porque aí a limitação é paralelismo. Não ajudam quando o gargalo é uma chave específica.',
            'O número de partições limita o paralelismo do grupo de consumidores: com trinta e duas partições, o trigésimo terceiro consumidor fica ocioso. Subir consumidor sem subir partição não aumenta a vazão.',
            'Reduzir o número de partições não é suportado na maioria dos sistemas, então o número escolhido é praticamente permanente. Vale começar acima do necessário, mas sem exagero, porque cada partição custa memória de broker e arquivo aberto.',
            'A ordem só é garantida dentro da partição, nunca entre partições. Qualquer lógica que dependa de comparar eventos de partições diferentes precisa de marca de tempo lógica própria, não da ordem de consumo.',
            'Se a distribuição já está boa e o lag máximo continua alto em todas as partições, o problema não é a chave: é capacidade de consumo ou uma dependência lenta dentro do handler.',
          ],
        },
      ],
    },
    {
      title: 'O cliente que sozinho não cabe em uma partição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Depois de compor a chave corretamente, sobra um caso que a composição não cobre: a entidade única cujo volume excede a capacidade de uma partição. É o disparo de broadcast para duzentos mil destinatários, a importação inicial de um catálogo, a reprocessagem de um mês inteiro de histórico. Nesses casos, mesmo com a menor unidade de ordem correta, o trabalho de uma entidade não cabe no tempo aceitável de uma partição só, e a única saída é dividir a entidade ou tirá-la da fila principal.',
        },
        {
          type: 'paragraph',
          value:
            'A divisão por sufixo funciona quando as sub-unidades são independentes entre si, que é o caso do broadcast: a ordem entre a entrega para o destinatário A e para o destinatário B nunca importou. O sufixo precisa ser derivado de forma estável do destinatário, e não sorteado, porque um sufixo aleatório quebraria também a ordem dos eventos daquele destinatário específico. Quando as sub-unidades não são independentes, a divisão não é possível e a resposta correta é a separação de tópico: trabalho de volume alto e latência tolerante sai da fila que atende o tempo real e vai para um tópico próprio, com seus próprios consumidores e seu próprio orçamento.',
        },
        {
          type: 'table',
          columns: ['Cenário', 'Sintoma', 'Correção', 'Custo aceito'],
          rows: [
            [
              'Muitos clientes, um com volume alto',
              'Uma partição com lag, várias ociosas',
              'Chave composta com a entidade',
              'Nenhum: a ordem entre entidades nunca foi requisito',
            ],
            [
              'Uma entidade com volume alto',
              'Lag alto mesmo após compor a chave',
              'Sufixo por faixa derivado da sub-unidade',
              'Ordem parcial dentro da entidade',
            ],
            [
              'Lote grande e tolerante a atraso',
              'Tempo real degrada durante importações',
              'Tópico separado com consumidores próprios',
              'Mais uma fila para operar e monitorar',
            ],
            [
              'Mensagem que sempre falha',
              'Partição parada com lag crescendo, sem CPU',
              'Fila de mensagens mortas após N tentativas',
              'Perda de ordem para aquela entidade específica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha da tabela merece nota, porque é a que mais causa incidente longo e a que menos aparece em desenho de arquitetura. Uma mensagem que falha de forma determinística, por um campo inválido ou um registro que não existe mais, é retentada para sempre, e enquanto ela está no topo da partição nada atrás dela avança. O sintoma é característico e fácil de reconhecer depois que se viu uma vez: lag subindo em uma partição só, consumo de CPU no chão, e o mesmo identificador de mensagem repetido no log a cada poucos segundos. A correção é enviar a mensagem para uma fila de mensagens mortas depois de um número finito de tentativas, aceitando conscientemente que a ordem daquela entidade se perdeu, porque a alternativa é perder o avanço de todas as outras entidades da mesma partição.',
        },
      ],
    },
    {
      title: 'O teste que prova que o isolamento existe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nenhuma dessas correções deve ser confiada apenas ao raciocínio, porque a propriedade que se quer garantir é justamente uma que só aparece sob desequilíbrio. O teste útil não mede vazão: ele mede latência do cliente pequeno enquanto o cliente grande satura a fila. Produza dezenas de milhares de eventos de um tenant único, injete no meio disso um punhado de eventos de outro tenant e meça quanto tempo o segundo levou do produtor até o consumidor. Com a chave antiga, essa latência é da ordem do backlog inteiro. Com a chave composta, ela precisa continuar na ordem de segundos.',
        },
        {
          type: 'code',
          value: `// test/noisy-neighbor.test.js
// O teste nao mede vazao: mede se o cliente pequeno ainda e atendido
// enquanto o grande satura a fila. E a unica propriedade que a chave
// composta existe para garantir.

import { describe, it, expect } from 'vitest';
import { partitionKey } from '../queue/partition-key.js';

const PARTITIONS = 32;
const fnv1a = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};
const partitionOf = (key) => fnv1a(key) % PARTITIONS;

// Simulacao sem broker: cada particao e uma lista serial, e a posicao de
// uma mensagem na sua particao e o numero de mensagens que ela espera.
const simulate = (events, keyOf) => {
  const depth = new Array(PARTITIONS).fill(0);
  return events.map((event) => {
    const partition = partitionOf(keyOf(event));
    const waitsBehind = depth[partition];
    depth[partition] += 1;
    return { ...event, partition, waitsBehind };
  });
};

describe('isolamento entre tenants na fila', () => {
  // Cliente grande: 70k eventos espalhados em 5k conversas.
  // Cliente pequeno: 10 eventos, injetados no meio do lote.
  const events = [
    ...Array.from({ length: 70_000 }, (_, i) => ({
      tenantId: 'tenant-a',
      entityId: \`conv-\${i % 5_000}\`,
    })),
  ];
  events.splice(
    35_000,
    0,
    ...Array.from({ length: 10 }, (_, i) => ({ tenantId: 'tenant-k', entityId: \`conv-\${i}\` })),
  );

  const smallTenantWait = (processed) =>
    Math.max(
      ...processed.filter((event) => event.tenantId === 'tenant-k').map((e) => e.waitsBehind),
    );

  it('chave por tenant prende o cliente pequeno atras do backlog', () => {
    const processed = simulate(events, (event) => event.tenantId);
    // tenant-k tem particao propria, mas tenant-a ocupa uma inteira:
    // qualquer tenant que caia no mesmo hash espera o backlog completo.
    const hottest = Math.max(
      ...Array.from({ length: PARTITIONS }, (_, p) =>
        processed.filter((event) => event.partition === p).length,
      ),
    );
    expect(hottest).toBeGreaterThan(60_000);
  });

  it('chave composta mantem o cliente pequeno em espera de segundos', () => {
    const processed = simulate(events, partitionKey);
    // 70k espalhados em 32 particoes: ~2.2k por particao. O cliente
    // pequeno espera uma fracao disso, nao o backlog inteiro.
    expect(smallTenantWait(processed)).toBeLessThan(3_000);
  });

  it('nenhuma particao fica ociosa enquanto outra acumula', () => {
    const processed = simulate(events, partitionKey);
    const depths = Array.from({ length: PARTITIONS }, (_, p) =>
      processed.filter((event) => event.partition === p).length,
    );
    const max = Math.max(...depths);
    const median = depths.sort((a, b) => a - b)[Math.floor(PARTITIONS / 2)];
    expect(max / median).toBeLessThan(1.5);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'Esse teste tem uma virtude que compensa a simplificação: ele não precisa de broker, roda em milissegundos e por isso cabe no pipeline como qualquer teste unitário. A simulação captura exatamente a propriedade que interessa, que é quantas mensagens estão à frente da mensagem do cliente pequeno na sua partição, e ignora tudo o mais. Quando alguém futuramente trocar a chave de volta para o identificador do cliente por conveniência, a terceira asserção quebra e o motivo fica registrado no arquivo, que é o único lugar onde esse tipo de decisão sobrevive à rotatividade do time.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como escolher entre chave composta e tópico separado por cliente?',
      answer:
        'A escolha depende de quantos clientes existem e de quão previsível é o volume deles. A chave composta é a resposta padrão porque não custa nada em operação: continua sendo um tópico, um grupo de consumidores e um painel, e o isolamento vem da distribuição. O tópico separado só se justifica quando um cliente específico tem um perfil de tráfego tão diferente dos demais que compartilhar recurso deixa de fazer sentido, tipicamente um contrato grande com garantia própria de latência, e quando o número desses casos é pequeno o bastante para ser gerenciado à mão. O erro caro é criar um tópico por cliente como regra geral: com centenas de clientes isso vira centenas de grupos de consumidores para monitorar, cada um com seu lag e seu deploy, e o custo de operação cresce linearmente com a base enquanto o benefício é o mesmo que a chave composta já entregava. Há também um limite técnico concreto: cada partição consome memória de broker e descritor de arquivo, e milhares de tópicos com poucas partições cada degradam o cluster inteiro. A regra prática é usar chave composta como padrão e tópico separado como exceção nomeada, com uma lista curta de clientes que a justificam explicitamente.',
    },
    {
      question: 'Trocar a chave de particionamento exige parar o sistema?',
      answer:
        'Não exige parada, mas exige uma sequência que a maioria dos times pula. A forma segura tem quatro passos e nenhum deles pode ser paralelizado. Primeiro, criar um tópico novo com a chave nova, sem consumidores ainda, para que ele exista e esteja configurado. Segundo, fazer o produtor escrever nos dois tópicos ao mesmo tempo, e não trocar de uma vez, para que o novo comece a receber tráfego enquanto o antigo continua sendo a fonte da verdade. Terceiro, esperar o lag do tópico antigo chegar a zero, o que garante que não existe nenhum evento pendente cuja ordem poderia ser violada. Só então, quarto, mover os consumidores para o tópico novo e parar a escrita dupla. A tentação de simplesmente trocar a chave no mesmo tópico é forte porque parece um deploy de uma linha, e é justamente por isso que causa o pior tipo de bug: eventos da mesma entidade em duas partições diferentes durante alguns minutos, com ordem indefinida entre eles e nenhum erro registrado em lugar nenhum. O sintoma aparece dias depois como um estado inconsistente que ninguém consegue reproduzir, porque a janela que o criou já fechou.',
    },
    {
      question: 'Consumidor paralelo dentro da partição resolve o bloqueio de cabeça de fila?',
      answer:
        'Resolve o sintoma e pode destruir a garantia, então só vale com uma condição explícita. Processar várias mensagens da mesma partição em paralelo aumenta a vazão e evita que uma mensagem lenta trave as seguintes, mas remove exatamente a ordem que motivou o particionamento por chave, e nesse caso valeria mais ter usado chave aleatória desde o início. A forma correta de recuperar o ganho sem perder a garantia é paralelizar por chave dentro da partição, e não por mensagem: o consumidor lê um lote, agrupa as mensagens por chave, processa os grupos em paralelo entre si e cada grupo em série internamente. A ordem por entidade permanece intacta e a vazão sobe proporcionalmente ao número de entidades distintas no lote, que costuma ser alto. O ponto de atenção fica no commit de offset, que precisa ser feito apenas até a mensagem mais antiga ainda não concluída, e nunca até a última do lote: comitar à frente de um grupo que ainda está processando significa perder aquelas mensagens se o consumidor cair naquele instante.',
    },
  ],
  conclusion: {
    title: 'Capacidade ociosa e cliente esperando são o mesmo problema',
    description:
      'Uma fila com trinta e duas partições e doze por cento de CPU que mesmo assim acumula dezoito minutos de atraso não tem problema de capacidade, tem problema de chave. A decisão de particionamento define quem espera por quem, e escolhê-la pensando apenas em ordenação transfere a latência do cliente grande para todos os outros que caírem no mesmo hash. Posso revisar a chave de particionamento do seu sistema e definir a menor unidade de ordem que o negócio exige, o plano de migração sem janela de reordenação, as métricas de desequilíbrio por partição que disparam antes do incidente, o tratamento do cliente que sozinho não cabe em uma partição e os testes de vizinho barulhento que provam que o isolamento continua valendo.',
    cta: 'Falar sobre a fila e o particionamento do meu sistema',
  },
  related: [
    {
      label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Arquitetura de fila para picos de campanha no WhatsApp',
      to: '/blog/fila-picos-campanha-whatsapp',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The queue has thirty-two consumers, the dashboard shows twelve percent CPU usage, and messages from forty customers have still been stuck for eighteen minutes. Capacity is not missing: distribution is. A single customer dumped seventy thousand events into one partition and everyone else who hashed into that same partition got in line behind them. This article shows why the partition key is an isolation decision rather than a performance one, why per-partition ordering is exactly what turns one large customer into a blocker for the others, how to measure skew before it becomes an incident, which composite keys fix it without breaking the ordering the business actually requires, why raising the partition count does not help, and what to do with the customer whose volume alone exceeds a single partition.',
  sections: [
    {
      title: 'The key decides who waits for whom',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In any partitioned log system, whether Kafka, Kinesis, Pub/Sub with an ordering key or a homegrown queue on top of Postgres, the key serves two purposes at once and almost every design only accounts for one of them. The first is the one in the documentation: messages sharing a key land in the same partition and are therefore delivered in the order they were produced. The second is the one that shows up in the incident: messages with different keys that happen to hash into the same partition now share a serial queue and a common fate. The key does not only define what stays ordered, it defines who gets stuck behind whom.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the right question when choosing a key is not which field distributes best, but what is the smallest unit that genuinely needs ordering. If the requirement is that events of a conversation be processed in sequence, the unit is the conversation and not the customer. If the key is the customer identifier, every conversation of that customer gets serialized by a constraint the business never asked for, and the queue inherits an artificial bottleneck. The practical rule that closes this part is blunt: ordering more than necessary is never neutral, it is always wasted capacity and latency handed to someone who did not ask for it.',
        },
        {
          type: 'diagram',
          value: `KEY = tenant_id  (ordering beyond what is needed)

P0  [tenant-A x 70000 ...........................] <- 18 min of backlog
P1  [tenant-C][tenant-F][tenant-J]                  <- drains in seconds
P2  [tenant-B][tenant-D]                            <- drains in seconds
P3  [tenant-E][tenant-G][tenant-H]                  <- drains in seconds
     ^ tenant-K hashed into P0 and waits 18 min
       for a backlog that is not theirs

KEY = tenant_id + conversation_id  (ordering the business requires)

P0  [A/c1][K/c9][A/c4][C/c2]
P1  [A/c2][B/c7][A/c5][K/c3]
P2  [A/c3][D/c1][F/c8][A/c6]
P3  [A/c7][E/c2][A/c8][J/c4]
     ^ tenant-A's volume is still large, but it now
       spreads out, and no other tenant sits behind it`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth separating two phenomena that get treated as one because they produce the same dashboard symptom. Partition skew is when the hash distributes poorly and one partition receives more messages than the others, and it is fixed by adding entropy to the key. Head-of-line blocking is when a single slow or poisoned message stalls everything behind it in the same partition, and no amount of entropy fixes it, because the problem is not volume but serialization. Real systems almost always have both, and fixing one does nothing for the other.',
        },
      ],
    },
    {
      title: 'Measuring skew before it becomes an incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The metric almost every team already has is total consumer group lag, and it is terrible for this particular problem. Total lag is a sum, and the sum hides exactly the information that matters: one partition with ninety thousand messages of lag and thirty-one empty partitions produce the same number as thirty-two partitions with nearly three thousand each. In the first case an incident is under way for a subset of customers, in the second the system is merely busy. The dashboard shows the same value for both.',
        },
        {
          type: 'paragraph',
          value:
            'What exposes the problem is looking at the distribution instead of the aggregate, and three measures are enough. Max lag per partition tells you whether any partition is in a bad place, and that is what should page, not the sum. The ratio between max lag and median lag tells you whether the system is skewed or merely loaded, and a value persistently above five signals a badly chosen key rather than a shortage of consumers. The share of the top producer per partition tells you whose volume it is, and that measure is what turns a generic alert into concrete action, because it names the customer who needs different treatment.',
        },
        {
          type: 'code',
          value: `// metrics/partition-skew.js
// Lag distribution per partition, not the sum.
//
// The sum hides the case that matters: one partition with 90k lag and
// 31 empty ones add up to the same as 32 partitions with 2.8k each. The
// first is an incident for a subset of customers, the second is traffic.

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
};

// lagByPartition: Map<partitionId, number>
export const describeSkew = (lagByPartition) => {
  const entries = [...lagByPartition.entries()];
  const values = entries.map(([, lag]) => lag).sort((a, b) => a - b);

  const total = values.reduce((sum, lag) => sum + lag, 0);
  const median = percentile(values, 0.5);
  const max = values[values.length - 1] ?? 0;

  const [hottestPartition] = entries.reduce(
    (worst, entry) => (entry[1] > worst[1] ? entry : worst),
    [null, -1],
  );

  return {
    total,
    median,
    max,
    hottestPartition,
    // Ratio, not difference: 90000/2800 is skew, 90000/89000 is load.
    // A zero median with a positive max is the worst case, and turning
    // into Infinity here would lose the alert, so we anchor at 1.
    skewRatio: max / Math.max(median, 1),
    // Partitions sitting idle while another holds a backlog:
    // capacity that is provisioned, paid for and unused.
    idlePartitions: values.filter((lag) => lag === 0).length,
  };
};

// Alert per partition, not on the sum. The ratio threshold catches skew
// that has not yet turned into large absolute lag, which is the useful
// window to act in.
export const skewAlerts = (skew, { maxLagThreshold = 5000, maxSkewRatio = 5 } = {}) => {
  const alerts = [];

  if (skew.max > maxLagThreshold) {
    alerts.push({
      level: 'page',
      reason: 'partition_lag_high',
      partition: skew.hottestPartition,
      value: skew.max,
    });
  }

  // Skew while lag is still low: does not wake anyone up, but becomes a
  // key review task before the next peak.
  if (skew.skewRatio > maxSkewRatio && skew.idlePartitions > 0) {
    alerts.push({
      level: 'ticket',
      reason: 'partition_key_skew',
      partition: skew.hottestPartition,
      value: Number(skew.skewRatio.toFixed(1)),
    });
  }

  return alerts;
};`,
        },
        {
          type: 'paragraph',
          value:
            'One operational detail changes the value of that alert: it has to run over a short window, one or two minutes, not over the hourly average. Skew is a burst phenomenon, and it shows up precisely when a customer kicks off an import, a campaign or a reprocessing job. Over a sixty-minute average, a four-minute spike with a ratio of twenty becomes a ratio of two and disappears from the dashboard, and the team learns about the problem through the support channel instead of through the alert.',
        },
      ],
    },
    {
      title: 'Composite key: spreading out without losing the ordering that matters',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The structural fix is almost always the same: replace the key with a composition that carries the smallest real unit of ordering. In support systems that is usually the conversation and not the customer, because two conversations of the same customer have no causal relationship. In billing it is the subscription and not the company. In inventory it is the item and not the warehouse. The composition should keep the tenant identifier as a prefix when downstream routing depends on it, but what enters the hash computation becomes the full pair.',
        },
        {
          type: 'table',
          columns: ['Key', 'Guaranteed ordering', 'Effect on skew', 'When it makes sense'],
          rows: [
            [
              'tenant_id',
              'All events of the customer, serialized',
              'Maximum: one large customer occupies a whole partition',
              'Only when ordering across different entities of the same customer is mandatory, which is rare',
            ],
            [
              'tenant_id + entity',
              'Events of the same conversation, order or subscription',
              'Low as long as the customer has many active entities',
              'Default for most support and transactional systems',
            ],
            [
              'tenant_id + entity + shard suffix',
              'Events of the same entity within the shard',
              'Controlled, at the cost of partial ordering',
              'A single entity whose volume does not fit one partition, such as a broadcast channel',
            ],
            [
              'Random or round-robin',
              'None',
              'None, perfect distribution',
              'Idempotent and commutative events, such as metrics and logs',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Changing the key carries a cost that must be planned for, and it is where most migrations go wrong: during the transition, events of the same entity exist in two partitions, the old and the new, and ordering between them stops being guaranteed exactly in the interval where both coexist. The safe way is to drain before cutting over. The producer starts writing to a new topic with the new key, consumers keep reading the old topic until lag reaches zero, and only then take over the new one. Switching the key on the same topic without draining creates a silent reordering window that only surfaces later, as an inconsistent state nobody can reproduce.',
        },
        {
          type: 'code',
          value: `// queue/partition-key.js
// Composite key: the smallest unit the business requires in order.
//
// Keeping tenant_id in the prefix helps routing and debugging, but the
// hash uses the whole key. Changing the separator or the field order
// remaps everything: the key is a contract, versioned like any other.

const SEPARATOR = '\\u001f'; // unit separator: never appears in a business id

export const partitionKey = ({ tenantId, entityId }) => {
  if (!tenantId || !entityId) {
    // Falling back to null here means silent round-robin and lost ordering.
    // Better to fail at produce time than to discover it at consume time.
    throw new Error('partition_key_requires_tenant_and_entity');
  }
  return \`\${tenantId}\${SEPARATOR}\${entityId}\`;
};

// Shard suffix for the entity that alone exceeds one partition.
// Explicit cost: events of the same entity lose total ordering among
// themselves. Only use it when ordering within the shard is enough, for
// example broadcast deliveries, which are independent per recipient.
export const shardedPartitionKey = ({ tenantId, entityId, shardCount = 1, discriminator }) => {
  const base = partitionKey({ tenantId, entityId });
  if (shardCount <= 1) return base;

  // The discriminator must be stable per sub-unit (the recipient), not
  // random: random would also break ordering within that sub-unit.
  const shard = stableHash(String(discriminator ?? '')) % shardCount;
  return \`\${base}\${SEPARATOR}\${shard}\`;
};

// FNV-1a: stable across processes and runtime versions. Do not use an
// improvised String.prototype.hashCode or Math.random: the key must map
// to the same partition six months from now, on another deploy.
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};`,
        },
      ],
    },
    {
      title: 'Why raising the partition count does not fix it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common reaction to skew is to raise the partition count, and it fails for a simple arithmetic reason: a key always maps to exactly one partition. If the key is the customer identifier and one customer concentrates seventy thousand events, those seventy thousand stay in a single partition whether the topic has eight partitions or eight hundred. What changes is only the probability of another customer landing alongside them, which reduces the number of collateral victims without reducing the large customer wait time at all, nor the wait of the victim who still hashes into the same slot.',
        },
        {
          type: 'paragraph',
          value:
            'There is also a side effect that usually goes unnoticed at the moment of the change. Raising the partition count on a topic already in use remaps every key, because the destination is computed as the key hash modulo the partition count. Events of the same entity that were in partition three now go to eleven, while the older ones still wait in three, and for an interval ordering between them simply does not exist. In other words, the measure that does not fix the skew introduces, for free, the same reordering window a botched key change would introduce.',
        },
        {
          type: 'list',
          items: [
            'More partitions help when the bottleneck is aggregate throughput and keys are already well distributed, because then the limit is parallelism. They do not help when the bottleneck is one specific key.',
            'The partition count caps consumer group parallelism: with thirty-two partitions, the thirty-third consumer sits idle. Adding consumers without adding partitions does not add throughput.',
            'Reducing the partition count is unsupported in most systems, so the chosen number is effectively permanent. It pays to start above what you need, but without going overboard, since each partition costs broker memory and an open file handle.',
            'Ordering is guaranteed only within a partition, never across partitions. Any logic that depends on comparing events from different partitions needs its own logical timestamp, not the consumption order.',
            'If distribution is already good and max lag stays high across all partitions, the key is not the problem: it is consumption capacity or a slow dependency inside the handler.',
          ],
        },
      ],
    },
    {
      title: 'The customer that alone does not fit in one partition',
      blocks: [
        {
          type: 'paragraph',
          value:
            'After composing the key correctly, one case remains that the composition does not cover: the single entity whose volume exceeds the capacity of one partition. It is the broadcast to two hundred thousand recipients, the initial import of a catalog, the reprocessing of a full month of history. In those cases, even with the correct smallest unit of ordering, the work of one entity does not fit into the acceptable time of a single partition, and the only way out is to split the entity or take it off the main queue.',
        },
        {
          type: 'paragraph',
          value:
            'Splitting by suffix works when sub-units are independent of each other, which is the broadcast case: the ordering between delivery to recipient A and recipient B never mattered. The suffix must be derived stably from the recipient rather than drawn at random, because a random suffix would also break the ordering of events for that specific recipient. When sub-units are not independent, splitting is not possible and the correct answer is topic separation: high volume, latency-tolerant work leaves the queue that serves real time and moves to its own topic, with its own consumers and its own budget.',
        },
        {
          type: 'table',
          columns: ['Scenario', 'Symptom', 'Fix', 'Accepted cost'],
          rows: [
            [
              'Many customers, one with high volume',
              'One partition with lag, several idle',
              'Composite key with the entity',
              'None: ordering across entities was never a requirement',
            ],
            [
              'One entity with high volume',
              'High lag even after composing the key',
              'Shard suffix derived from the sub-unit',
              'Partial ordering within the entity',
            ],
            [
              'Large batch that tolerates delay',
              'Real time degrades during imports',
              'Separate topic with its own consumers',
              'One more queue to operate and monitor',
            ],
            [
              'Message that always fails',
              'Partition stalled with lag growing, no CPU',
              'Dead letter queue after N attempts',
              'Lost ordering for that specific entity',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row of the table deserves a note, because it causes the longest incidents and appears the least in architecture diagrams. A message that fails deterministically, because of an invalid field or a record that no longer exists, is retried forever, and while it sits at the head of the partition nothing behind it advances. The symptom is distinctive and easy to recognize once you have seen it: lag rising in one partition only, CPU on the floor, and the same message identifier repeated in the log every few seconds. The fix is to send the message to a dead letter queue after a finite number of attempts, consciously accepting that ordering for that entity is lost, because the alternative is losing progress for every other entity in the same partition.',
        },
      ],
    },
    {
      title: 'The test that proves isolation exists',
      blocks: [
        {
          type: 'paragraph',
          value:
            'None of these fixes should be trusted to reasoning alone, because the property you want to guarantee is exactly one that only shows up under skew. The useful test does not measure throughput: it measures the small customer latency while the large customer saturates the queue. Produce tens of thousands of events for a single tenant, inject a handful of events from another tenant in the middle, and measure how long the second took from producer to consumer. With the old key that latency is on the order of the entire backlog. With the composite key it must stay on the order of seconds.',
        },
        {
          type: 'code',
          value: `// test/noisy-neighbor.test.js
// The test does not measure throughput: it measures whether the small
// customer is still served while the large one saturates the queue. It
// is the only property the composite key exists to guarantee.

import { describe, it, expect } from 'vitest';
import { partitionKey } from '../queue/partition-key.js';

const PARTITIONS = 32;
const fnv1a = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};
const partitionOf = (key) => fnv1a(key) % PARTITIONS;

// Broker-free simulation: each partition is a serial list, and a message's
// position in its partition is the number of messages it waits behind.
const simulate = (events, keyOf) => {
  const depth = new Array(PARTITIONS).fill(0);
  return events.map((event) => {
    const partition = partitionOf(keyOf(event));
    const waitsBehind = depth[partition];
    depth[partition] += 1;
    return { ...event, partition, waitsBehind };
  });
};

describe('tenant isolation in the queue', () => {
  // Large customer: 70k events spread over 5k conversations.
  // Small customer: 10 events, injected in the middle of the batch.
  const events = [
    ...Array.from({ length: 70_000 }, (_, i) => ({
      tenantId: 'tenant-a',
      entityId: \`conv-\${i % 5_000}\`,
    })),
  ];
  events.splice(
    35_000,
    0,
    ...Array.from({ length: 10 }, (_, i) => ({ tenantId: 'tenant-k', entityId: \`conv-\${i}\` })),
  );

  const smallTenantWait = (processed) =>
    Math.max(
      ...processed.filter((event) => event.tenantId === 'tenant-k').map((e) => e.waitsBehind),
    );

  it('a per-tenant key traps the small customer behind the backlog', () => {
    const processed = simulate(events, (event) => event.tenantId);
    // tenant-k gets its own partition, but tenant-a occupies a whole one:
    // any tenant hashing into that slot waits for the entire backlog.
    const hottest = Math.max(
      ...Array.from({ length: PARTITIONS }, (_, p) =>
        processed.filter((event) => event.partition === p).length,
      ),
    );
    expect(hottest).toBeGreaterThan(60_000);
  });

  it('a composite key keeps the small customer waiting seconds', () => {
    const processed = simulate(events, partitionKey);
    // 70k spread over 32 partitions: ~2.2k each. The small customer waits
    // a fraction of that, not the whole backlog.
    expect(smallTenantWait(processed)).toBeLessThan(3_000);
  });

  it('no partition sits idle while another accumulates', () => {
    const processed = simulate(events, partitionKey);
    const depths = Array.from({ length: PARTITIONS }, (_, p) =>
      processed.filter((event) => event.partition === p).length,
    );
    const max = Math.max(...depths);
    const median = depths.sort((a, b) => a - b)[Math.floor(PARTITIONS / 2)];
    expect(max / median).toBeLessThan(1.5);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'This test has a virtue that compensates for the simplification: it needs no broker, runs in milliseconds and therefore fits into the pipeline like any unit test. The simulation captures exactly the property that matters, which is how many messages sit ahead of the small customer message in its partition, and ignores everything else. When someone later switches the key back to the customer identifier out of convenience, the third assertion breaks and the reason stays recorded in the file, which is the only place this kind of decision survives team turnover.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do I choose between a composite key and a per-customer topic?',
      answer:
        'The choice depends on how many customers exist and how predictable their volume is. The composite key is the default answer because it costs nothing operationally: it is still one topic, one consumer group and one dashboard, and isolation comes from distribution. A separate topic is only justified when a specific customer has a traffic profile so different from the rest that sharing resources stops making sense, typically a large contract with its own latency guarantee, and when the number of such cases is small enough to be managed by hand. The expensive mistake is creating one topic per customer as a general rule: with hundreds of customers that becomes hundreds of consumer groups to monitor, each with its own lag and its own deploy, and operational cost grows linearly with the customer base while the benefit is the same one the composite key already delivered. There is also a concrete technical limit: each partition consumes broker memory and a file descriptor, and thousands of topics with a few partitions each degrade the whole cluster. The practical rule is composite key as the default and separate topic as a named exception, with a short list of customers that explicitly justify it.',
    },
    {
      question: 'Does changing the partition key require stopping the system?',
      answer:
        'It does not require downtime, but it requires a sequence most teams skip. The safe way has four steps and none of them can be parallelized. First, create a new topic with the new key, with no consumers yet, so it exists and is configured. Second, have the producer write to both topics at once instead of switching in one go, so the new one starts receiving traffic while the old one remains the source of truth. Third, wait for the old topic lag to reach zero, which guarantees no pending event whose ordering could be violated. Only then, fourth, move consumers to the new topic and stop the dual write. The temptation to simply change the key on the same topic is strong because it looks like a one-line deploy, and that is precisely why it causes the worst kind of bug: events of the same entity in two different partitions for a few minutes, with undefined ordering between them and no error logged anywhere. The symptom shows up days later as an inconsistent state nobody can reproduce, because the window that created it has already closed.',
    },
    {
      question: 'Does parallel consumption within a partition solve head-of-line blocking?',
      answer:
        'It solves the symptom and can destroy the guarantee, so it is only worth it under an explicit condition. Processing several messages of the same partition in parallel raises throughput and prevents one slow message from stalling the following ones, but it removes exactly the ordering that motivated keyed partitioning in the first place, and in that case a random key would have been the better choice from the start. The correct way to recover the gain without losing the guarantee is to parallelize by key within the partition rather than by message: the consumer reads a batch, groups messages by key, processes the groups in parallel with each other and each group serially inside itself. Per-entity ordering stays intact and throughput rises proportionally to the number of distinct entities in the batch, which is usually high. The thing to watch is the offset commit, which must go only up to the oldest message not yet completed, and never up to the last one in the batch: committing ahead of a group still in flight means losing those messages if the consumer dies at that instant.',
    },
  ],
  conclusion: {
    title: 'Idle capacity and a waiting customer are the same problem',
    description:
      'A queue with thirty-two partitions and twelve percent CPU that still accumulates eighteen minutes of delay does not have a capacity problem, it has a key problem. The partitioning decision defines who waits for whom, and choosing it with only ordering in mind hands the large customer latency to everyone else who hashes into the same slot. I can review your system partition key and define the smallest unit of ordering the business requires, the migration plan with no reordering window, the per-partition skew metrics that fire before the incident, the treatment for the customer who alone does not fit in one partition, and the noisy neighbor tests that prove isolation still holds.',
    cta: 'Talk about my system queue and partitioning',
  },
  related: [
    {
      label: 'Backpressure in an AI pipeline: when the consumer cannot keep up',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Queue architecture for WhatsApp campaign peaks',
      to: '/blog/fila-picos-campanha-whatsapp',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La cola tiene treinta y dos consumidores, el panel muestra doce por ciento de uso de CPU, y aun así los mensajes de cuarenta clientes llevan dieciocho minutos parados. No falta capacidad: falta distribución. Un único cliente descargó setenta mil eventos en una partición y todos los que cayeron en esa misma partición quedaron en la fila detrás de él. Este artículo muestra por qué la clave de particionamiento es una decisión de aislamiento y no de rendimiento, por qué el orden por partición es justamente lo que convierte a un cliente grande en un bloqueo para los demás, cómo medir el desequilibrio antes de que se vuelva incidente, qué claves compuestas lo resuelven sin romper el orden que el negocio realmente exige, por qué aumentar el número de particiones no lo arregla y qué hacer con el cliente que por sí solo excede la capacidad de una partición.',
  sections: [
    {
      title: 'La clave decide quién espera a quién',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En cualquier sistema de log particionado, sea Kafka, Kinesis, Pub/Sub con clave de ordenación o una cola casera sobre Postgres, la clave cumple dos funciones a la vez y casi todo diseño solo contempla una de ellas. La primera es la que aparece en la documentación: los mensajes con la misma clave van a la misma partición y por eso se entregan en el orden en que fueron producidos. La segunda es la que aparece en el incidente: los mensajes con claves distintas que caen en la misma partición por azar del hash pasan a compartir una cola serial y una suerte común. La clave no define solo qué queda ordenado, define quién queda atrapado detrás de quién.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso la pregunta correcta al elegir la clave no es qué campo distribuye mejor, sino cuál es la menor unidad que realmente necesita orden. Si el requisito es que los eventos de una conversación se procesen en secuencia, la unidad es la conversación y no el cliente. Si la clave es el identificador del cliente, todas las conversaciones de ese cliente quedan serializadas por una exigencia que el negocio nunca hizo, y la cola hereda un cuello de botella artificial. La regla práctica que cierra esta parte es directa: ordenar más de lo necesario nunca es neutro, siempre es capacidad desperdiciada y latencia transferida a quien no la pidió.',
        },
        {
          type: 'diagram',
          value: `CLAVE = tenant_id  (orden mas alla de lo necesario)

P0  [tenant-A x 70000 ...........................] <- 18 min de backlog
P1  [tenant-C][tenant-F][tenant-J]                  <- se vacia en segundos
P2  [tenant-B][tenant-D]                            <- se vacia en segundos
P3  [tenant-E][tenant-G][tenant-H]                  <- se vacia en segundos
     ^ tenant-K cayo en el hash de P0 y espera 18 min
       por un backlog que no es suyo

CLAVE = tenant_id + conversation_id  (orden que el negocio exige)

P0  [A/c1][K/c9][A/c4][C/c2]
P1  [A/c2][B/c7][A/c5][K/c3]
P2  [A/c3][D/c1][F/c8][A/c6]
P3  [A/c7][E/c2][A/c8][J/c4]
     ^ el volumen de tenant-A sigue siendo grande, pero
       ahora se reparte, y ningun otro tenant queda detras`,
        },
        {
          type: 'paragraph',
          value:
            'Conviene separar dos fenómenos que suelen tratarse como uno solo porque producen el mismo síntoma en el panel. El desequilibrio de partición es cuando el hash distribuye mal y una partición recibe más mensajes que las otras, y se corrige con más entropía en la clave. El bloqueo de cabeza de fila es cuando un único mensaje lento o envenenado traba todo lo que está detrás en la misma partición, y no se corrige con ninguna entropía, porque el problema no es el volumen sino la serialización. Los sistemas reales casi siempre tienen los dos, y corregir uno no ayuda en nada con el otro.',
        },
      ],
    },
    {
      title: 'Medir el desequilibrio antes de que se vuelva incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La métrica que casi todo equipo ya tiene es el lag total del grupo de consumidores, y es pésima para este problema específico. El lag total es una suma, y la suma esconde justamente la información que interesa: una partición con noventa mil mensajes de atraso y treinta y una particiones vacías producen el mismo número que treinta y dos particiones con casi tres mil cada una. En el primer caso hay un incidente en curso para un subconjunto de clientes, en el segundo el sistema solo está ocupado. El panel muestra el mismo valor en los dos casos.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que revela el problema es mirar la distribución en vez del agregado, y bastan tres medidas. El lag máximo por partición dice si hay alguna partición en mala situación, y es ese el que debe disparar la alerta, no la suma. La razón entre el lag máximo y el lag mediano dice si el sistema está desequilibrado o solo cargado, y un valor persistente por encima de cinco señala una clave mal elegida y no falta de consumidores. La participación del mayor productor por partición dice de quién es el volumen, y esa medida es la que convierte una alerta genérica en una acción concreta, porque nombra al cliente que necesita un tratamiento distinto.',
        },
        {
          type: 'code',
          value: `// metrics/partition-skew.js
// Distribucion del lag por particion, no la suma.
//
// La suma esconde el caso que importa: una particion con 90k de lag y
// 31 vacias suman lo mismo que 32 particiones con 2.8k cada una. La
// primera es un incidente para un subconjunto de clientes, la segunda
// es trafico.

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
};

// lagByPartition: Map<partitionId, number>
export const describeSkew = (lagByPartition) => {
  const entries = [...lagByPartition.entries()];
  const values = entries.map(([, lag]) => lag).sort((a, b) => a - b);

  const total = values.reduce((sum, lag) => sum + lag, 0);
  const median = percentile(values, 0.5);
  const max = values[values.length - 1] ?? 0;

  const [hottestPartition] = entries.reduce(
    (worst, entry) => (entry[1] > worst[1] ? entry : worst),
    [null, -1],
  );

  return {
    total,
    median,
    max,
    hottestPartition,
    // Razon, no diferencia: 90000/2800 es desequilibrio, 90000/89000 es
    // carga. Mediana cero con maximo positivo es el caso mas grave, y
    // volverse Infinity aqui seria perder la alerta, asi que anclamos en 1.
    skewRatio: max / Math.max(median, 1),
    // Particiones efectivamente paradas mientras otra acumula backlog:
    // capacidad contratada, pagada y ociosa.
    idlePartitions: values.filter((lag) => lag === 0).length,
  };
};

// Alerta por particion, no por suma. El umbral de razon detecta el
// desequilibrio que todavia no se volvio lag absoluto grande, que es la
// ventana util para actuar.
export const skewAlerts = (skew, { maxLagThreshold = 5000, maxSkewRatio = 5 } = {}) => {
  const alerts = [];

  if (skew.max > maxLagThreshold) {
    alerts.push({
      level: 'page',
      reason: 'partition_lag_high',
      partition: skew.hottestPartition,
      value: skew.max,
    });
  }

  // Desequilibrio con lag todavia bajo: no despierta a nadie, pero se
  // convierte en tarea de revision de clave antes del proximo pico.
  if (skew.skewRatio > maxSkewRatio && skew.idlePartitions > 0) {
    alerts.push({
      level: 'ticket',
      reason: 'partition_key_skew',
      partition: skew.hottestPartition,
      value: Number(skew.skewRatio.toFixed(1)),
    });
  }

  return alerts;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Hay un detalle operativo que cambia el valor de esa alerta: necesita correr sobre una ventana corta, de uno o dos minutos, y no sobre el promedio de la hora. El desequilibrio es un fenómeno de ráfaga, y aparece justamente cuando un cliente dispara una importación, una campaña o un reprocesamiento. En el promedio de sesenta minutos, un pico de cuatro minutos con razón veinte se convierte en una razón dos y desaparece del panel, y el equipo se entera del problema por el canal de soporte en vez de por la alerta.',
        },
      ],
    },
    {
      title: 'Clave compuesta: repartir sin perder el orden que importa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección estructural casi siempre es la misma: cambiar la clave por una composición que cargue la menor unidad de orden real. En atención, eso normalmente es la conversación y no el cliente, porque dos conversaciones del mismo cliente no tienen relación causal entre sí. En cobranza, es la suscripción y no la empresa. En inventario, es el artículo y no el depósito. La composición debe mantener el identificador de tenant como prefijo cuando el enrutamiento posterior depende de él, pero lo que entra en el cálculo del hash pasa a ser el par completo.',
        },
        {
          type: 'table',
          columns: ['Clave', 'Orden garantizado', 'Efecto en el desequilibrio', 'Cuándo tiene sentido'],
          rows: [
            [
              'tenant_id',
              'Todos los eventos del cliente, en serie',
              'Máximo: un cliente grande ocupa una partición entera',
              'Solo cuando el orden entre entidades distintas del mismo cliente es obligatorio, lo cual es raro',
            ],
            [
              'tenant_id + entidad',
              'Eventos de la misma conversación, pedido o suscripción',
              'Bajo mientras el cliente tenga muchas entidades activas',
              'Estándar para la mayoría de los sistemas de atención y transaccionales',
            ],
            [
              'tenant_id + entidad + sufijo por franja',
              'Eventos de la misma entidad dentro de la franja',
              'Controlado, al costo de un orden parcial',
              'Entidad única con volumen que no cabe en una partición, como un canal de broadcast',
            ],
            [
              'Aleatoria o round-robin',
              'Ninguno',
              'Ninguno, distribución perfecta',
              'Eventos idempotentes y conmutativos, como métricas y logs',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El cambio de clave tiene un costo que hay que planificar y es donde la mayoría de las migraciones falla: durante la transición, los eventos de la misma entidad existen en dos particiones, la antigua y la nueva, y el orden entre ellos deja de estar garantizado exactamente en el intervalo en que ambas conviven. La forma segura es drenar antes de cortar. El productor pasa a escribir en un tópico nuevo con la clave nueva, los consumidores siguen leyendo el tópico antiguo hasta que el lag llegue a cero y solo entonces asumen el nuevo. Cambiar la clave en el mismo tópico, sin drenar, es crear una ventana de reordenamiento silencioso que solo va a aparecer después, como un estado inconsistente que nadie logra reproducir.',
        },
        {
          type: 'code',
          value: `// queue/partition-key.js
// Clave compuesta: la menor unidad que el negocio exige en orden.
//
// Mantener tenant_id en el prefijo sirve para enrutamiento y depuracion,
// pero el hash usa la clave entera. Cambiar el separador o el orden de
// los campos remapea todo: la clave es un contrato, versionado como
// cualquier otro.

const SEPARATOR = '\\u001f'; // unit separator: no aparece en id de negocio

export const partitionKey = ({ tenantId, entityId }) => {
  if (!tenantId || !entityId) {
    // Caer en null aqui significa round-robin silencioso y perdida de
    // orden. Mejor fallar al producir el evento que descubrirlo al consumir.
    throw new Error('partition_key_requires_tenant_and_entity');
  }
  return \`\${tenantId}\${SEPARATOR}\${entityId}\`;
};

// Sufijo por franja para la entidad que por si sola excede una particion.
// Costo explicito: los eventos de la misma entidad dejan de tener orden
// total entre si. Uselo solo cuando el orden dentro de la franja sea
// suficiente, por ejemplo entregas de broadcast, que son independientes
// entre destinatarios.
export const shardedPartitionKey = ({ tenantId, entityId, shardCount = 1, discriminator }) => {
  const base = partitionKey({ tenantId, entityId });
  if (shardCount <= 1) return base;

  // El discriminador tiene que ser estable por sub-unidad (el destinatario),
  // no aleatorio: aleatorio rompería el orden tambien dentro de esa sub-unidad.
  const shard = stableHash(String(discriminator ?? '')) % shardCount;
  return \`\${base}\${SEPARATOR}\${shard}\`;
};

// FNV-1a: estable entre procesos y versiones de runtime. No use un
// String.prototype.hashCode improvisado ni Math.random: la clave tiene que
// producir la misma particion dentro de seis meses, en otro deploy.
const stableHash = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};`,
        },
      ],
    },
    {
      title: 'Por qué aumentar el número de particiones no lo resuelve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La reacción más común ante el desequilibrio es subir el número de particiones, y falla por una razón aritmética simple: una clave siempre mapea a una sola partición. Si la clave es el identificador del cliente y un cliente concentra setenta mil eventos, esos setenta mil siguen en una única partición, tenga el tópico ocho u ochocientas. Lo que cambia es solo la probabilidad de que otro cliente caiga junto, lo que reduce el número de víctimas colaterales sin reducir en nada el tiempo de espera del cliente grande ni el de la víctima que aun así caiga en el mismo hash.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además un efecto colateral que suele pasar desapercibido en el momento del cambio. Aumentar el número de particiones en un tópico ya en uso remapea todas las claves, porque el destino se calcula como hash de la clave módulo el número de particiones. Los eventos de una misma entidad que estaban en la partición tres pasan a ir a la once, mientras los antiguos todavía esperan en la tres, y por un intervalo el orden entre ellos simplemente no existe. Es decir, la medida que no resuelve el desequilibrio introduce, de regalo, la misma ventana de reordenamiento que introduciría un cambio de clave mal hecho.',
        },
        {
          type: 'list',
          items: [
            'Más particiones ayudan cuando el cuello de botella es el rendimiento agregado y las claves ya están bien distribuidas, porque ahí el límite es el paralelismo. No ayudan cuando el cuello de botella es una clave específica.',
            'El número de particiones limita el paralelismo del grupo de consumidores: con treinta y dos particiones, el trigésimo tercer consumidor queda ocioso. Subir consumidores sin subir particiones no aumenta el rendimiento.',
            'Reducir el número de particiones no está soportado en la mayoría de los sistemas, así que el número elegido es prácticamente permanente. Conviene empezar por encima de lo necesario, pero sin exagerar, porque cada partición cuesta memoria de broker y un descriptor de archivo.',
            'El orden solo está garantizado dentro de la partición, nunca entre particiones. Cualquier lógica que dependa de comparar eventos de particiones distintas necesita su propia marca de tiempo lógica, no el orden de consumo.',
            'Si la distribución ya es buena y el lag máximo sigue alto en todas las particiones, el problema no es la clave: es capacidad de consumo o una dependencia lenta dentro del handler.',
          ],
        },
      ],
    },
    {
      title: 'El cliente que por sí solo no cabe en una partición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Después de componer la clave correctamente, queda un caso que la composición no cubre: la entidad única cuyo volumen excede la capacidad de una partición. Es el disparo de broadcast a doscientos mil destinatarios, la importación inicial de un catálogo, el reprocesamiento de un mes entero de historial. En esos casos, incluso con la menor unidad de orden correcta, el trabajo de una entidad no cabe en el tiempo aceptable de una sola partición, y la única salida es dividir la entidad o sacarla de la cola principal.',
        },
        {
          type: 'paragraph',
          value:
            'La división por sufijo funciona cuando las sub-unidades son independientes entre sí, que es el caso del broadcast: el orden entre la entrega al destinatario A y al destinatario B nunca importó. El sufijo tiene que derivarse de forma estable del destinatario, y no sortearse, porque un sufijo aleatorio rompería también el orden de los eventos de ese destinatario específico. Cuando las sub-unidades no son independientes, la división no es posible y la respuesta correcta es la separación de tópico: el trabajo de alto volumen y latencia tolerante sale de la cola que atiende el tiempo real y va a un tópico propio, con sus propios consumidores y su propio presupuesto.',
        },
        {
          type: 'table',
          columns: ['Escenario', 'Síntoma', 'Corrección', 'Costo aceptado'],
          rows: [
            [
              'Muchos clientes, uno con volumen alto',
              'Una partición con lag, varias ociosas',
              'Clave compuesta con la entidad',
              'Ninguno: el orden entre entidades nunca fue requisito',
            ],
            [
              'Una entidad con volumen alto',
              'Lag alto incluso tras componer la clave',
              'Sufijo por franja derivado de la sub-unidad',
              'Orden parcial dentro de la entidad',
            ],
            [
              'Lote grande y tolerante al atraso',
              'El tiempo real se degrada durante importaciones',
              'Tópico separado con consumidores propios',
              'Una cola más para operar y monitorear',
            ],
            [
              'Mensaje que siempre falla',
              'Partición parada con lag creciendo, sin CPU',
              'Cola de mensajes muertos tras N intentos',
              'Pérdida de orden para esa entidad específica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última línea de la tabla merece una nota, porque es la que más causa incidentes largos y la que menos aparece en los diseños de arquitectura. Un mensaje que falla de forma determinista, por un campo inválido o un registro que ya no existe, se reintenta para siempre, y mientras está en la cabeza de la partición nada detrás de él avanza. El síntoma es característico y fácil de reconocer después de haberlo visto una vez: lag subiendo en una sola partición, consumo de CPU por el piso, y el mismo identificador de mensaje repetido en el log cada pocos segundos. La corrección es enviar el mensaje a una cola de mensajes muertos después de un número finito de intentos, aceptando conscientemente que el orden de esa entidad se perdió, porque la alternativa es perder el avance de todas las otras entidades de la misma partición.',
        },
      ],
    },
    {
      title: 'La prueba que demuestra que el aislamiento existe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ninguna de estas correcciones debe confiarse solo al razonamiento, porque la propiedad que se quiere garantizar es justamente una que solo aparece bajo desequilibrio. La prueba útil no mide rendimiento: mide la latencia del cliente pequeño mientras el cliente grande satura la cola. Produzca decenas de miles de eventos de un único tenant, inyecte en medio un puñado de eventos de otro tenant y mida cuánto tardó el segundo desde el productor hasta el consumidor. Con la clave antigua, esa latencia es del orden del backlog entero. Con la clave compuesta, tiene que seguir siendo del orden de segundos.',
        },
        {
          type: 'code',
          value: `// test/noisy-neighbor.test.js
// La prueba no mide rendimiento: mide si el cliente pequeno sigue siendo
// atendido mientras el grande satura la cola. Es la unica propiedad que
// la clave compuesta existe para garantizar.

import { describe, it, expect } from 'vitest';
import { partitionKey } from '../queue/partition-key.js';

const PARTITIONS = 32;
const fnv1a = (value) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};
const partitionOf = (key) => fnv1a(key) % PARTITIONS;

// Simulacion sin broker: cada particion es una lista serial, y la posicion
// de un mensaje en su particion es la cantidad de mensajes que espera.
const simulate = (events, keyOf) => {
  const depth = new Array(PARTITIONS).fill(0);
  return events.map((event) => {
    const partition = partitionOf(keyOf(event));
    const waitsBehind = depth[partition];
    depth[partition] += 1;
    return { ...event, partition, waitsBehind };
  });
};

describe('aislamiento entre tenants en la cola', () => {
  // Cliente grande: 70k eventos repartidos en 5k conversaciones.
  // Cliente pequeno: 10 eventos, inyectados en medio del lote.
  const events = [
    ...Array.from({ length: 70_000 }, (_, i) => ({
      tenantId: 'tenant-a',
      entityId: \`conv-\${i % 5_000}\`,
    })),
  ];
  events.splice(
    35_000,
    0,
    ...Array.from({ length: 10 }, (_, i) => ({ tenantId: 'tenant-k', entityId: \`conv-\${i}\` })),
  );

  const smallTenantWait = (processed) =>
    Math.max(
      ...processed.filter((event) => event.tenantId === 'tenant-k').map((e) => e.waitsBehind),
    );

  it('la clave por tenant atrapa al cliente pequeno detras del backlog', () => {
    const processed = simulate(events, (event) => event.tenantId);
    // tenant-k tiene particion propia, pero tenant-a ocupa una entera:
    // cualquier tenant que caiga en ese hash espera el backlog completo.
    const hottest = Math.max(
      ...Array.from({ length: PARTITIONS }, (_, p) =>
        processed.filter((event) => event.partition === p).length,
      ),
    );
    expect(hottest).toBeGreaterThan(60_000);
  });

  it('la clave compuesta mantiene al cliente pequeno en espera de segundos', () => {
    const processed = simulate(events, partitionKey);
    // 70k repartidos en 32 particiones: ~2.2k por particion. El cliente
    // pequeno espera una fraccion de eso, no el backlog entero.
    expect(smallTenantWait(processed)).toBeLessThan(3_000);
  });

  it('ninguna particion queda ociosa mientras otra acumula', () => {
    const processed = simulate(events, partitionKey);
    const depths = Array.from({ length: PARTITIONS }, (_, p) =>
      processed.filter((event) => event.partition === p).length,
    );
    const max = Math.max(...depths);
    const median = depths.sort((a, b) => a - b)[Math.floor(PARTITIONS / 2)];
    expect(max / median).toBeLessThan(1.5);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'Esa prueba tiene una virtud que compensa la simplificación: no necesita broker, corre en milisegundos y por eso cabe en el pipeline como cualquier prueba unitaria. La simulación captura exactamente la propiedad que interesa, que es cuántos mensajes están delante del mensaje del cliente pequeño en su partición, e ignora todo lo demás. Cuando alguien en el futuro cambie la clave de vuelta al identificador del cliente por conveniencia, la tercera aserción se rompe y el motivo queda registrado en el archivo, que es el único lugar donde este tipo de decisión sobrevive a la rotación del equipo.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cómo elegir entre clave compuesta y tópico separado por cliente?',
      answer:
        'La elección depende de cuántos clientes existen y de qué tan predecible es su volumen. La clave compuesta es la respuesta estándar porque no cuesta nada en operación: sigue siendo un tópico, un grupo de consumidores y un panel, y el aislamiento viene de la distribución. El tópico separado solo se justifica cuando un cliente específico tiene un perfil de tráfico tan distinto de los demás que compartir recursos deja de tener sentido, típicamente un contrato grande con garantía propia de latencia, y cuando el número de esos casos es lo bastante pequeño para gestionarse a mano. El error caro es crear un tópico por cliente como regla general: con cientos de clientes eso se vuelve cientos de grupos de consumidores que monitorear, cada uno con su lag y su deploy, y el costo de operación crece linealmente con la base mientras el beneficio es el mismo que la clave compuesta ya entregaba. Hay además un límite técnico concreto: cada partición consume memoria de broker y un descriptor de archivo, y miles de tópicos con pocas particiones cada uno degradan el clúster entero. La regla práctica es usar clave compuesta como estándar y tópico separado como excepción nombrada, con una lista corta de clientes que la justifiquen explícitamente.',
    },
    {
      question: '¿Cambiar la clave de particionamiento exige detener el sistema?',
      answer:
        'No exige parada, pero exige una secuencia que la mayoría de los equipos se salta. La forma segura tiene cuatro pasos y ninguno puede paralelizarse. Primero, crear un tópico nuevo con la clave nueva, todavía sin consumidores, para que exista y esté configurado. Segundo, hacer que el productor escriba en los dos tópicos a la vez, y no cambiar de golpe, para que el nuevo empiece a recibir tráfico mientras el antiguo sigue siendo la fuente de verdad. Tercero, esperar a que el lag del tópico antiguo llegue a cero, lo que garantiza que no hay ningún evento pendiente cuyo orden pudiera violarse. Solo entonces, cuarto, mover los consumidores al tópico nuevo y detener la escritura doble. La tentación de simplemente cambiar la clave en el mismo tópico es fuerte porque parece un deploy de una línea, y es justamente por eso que causa el peor tipo de bug: eventos de la misma entidad en dos particiones distintas durante algunos minutos, con orden indefinido entre ellos y ningún error registrado en ninguna parte. El síntoma aparece días después como un estado inconsistente que nadie logra reproducir, porque la ventana que lo creó ya se cerró.',
    },
    {
      question: '¿El consumo paralelo dentro de la partición resuelve el bloqueo de cabeza de fila?',
      answer:
        'Resuelve el síntoma y puede destruir la garantía, así que solo vale con una condición explícita. Procesar varios mensajes de la misma partición en paralelo aumenta el rendimiento y evita que un mensaje lento trabe los siguientes, pero elimina justamente el orden que motivó el particionamiento por clave, y en ese caso habría valido más usar una clave aleatoria desde el principio. La forma correcta de recuperar la ganancia sin perder la garantía es paralelizar por clave dentro de la partición, y no por mensaje: el consumidor lee un lote, agrupa los mensajes por clave, procesa los grupos en paralelo entre sí y cada grupo en serie internamente. El orden por entidad queda intacto y el rendimiento sube proporcionalmente al número de entidades distintas en el lote, que suele ser alto. El punto de atención está en el commit de offset, que tiene que hacerse solo hasta el mensaje más antiguo aún no concluido, y nunca hasta el último del lote: hacer commit por delante de un grupo que todavía está procesando significa perder esos mensajes si el consumidor se cae en ese instante.',
    },
  ],
  conclusion: {
    title: 'Capacidad ociosa y cliente esperando son el mismo problema',
    description:
      'Una cola con treinta y dos particiones y doce por ciento de CPU que aun así acumula dieciocho minutos de atraso no tiene un problema de capacidad, tiene un problema de clave. La decisión de particionamiento define quién espera a quién, y elegirla pensando solo en la ordenación transfiere la latencia del cliente grande a todos los demás que caigan en el mismo hash. Puedo revisar la clave de particionamiento de tu sistema y definir la menor unidad de orden que el negocio exige, el plan de migración sin ventana de reordenamiento, las métricas de desequilibrio por partición que disparan antes del incidente, el tratamiento del cliente que por sí solo no cabe en una partición y las pruebas de vecino ruidoso que demuestran que el aislamiento sigue vigente.',
    cta: 'Hablar sobre la cola y el particionamiento de mi sistema',
  },
  related: [
    {
      label: 'Backpressure en un pipeline de IA: cuando el consumidor no da abasto',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Arquitectura de cola para picos de campaña en WhatsApp',
      to: '/blog/fila-picos-campanha-whatsapp',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default { pt, en, es };
