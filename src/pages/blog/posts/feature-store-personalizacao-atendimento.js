// Conteudo do artigo: Feature store para personalizacao de atendimento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Feature store minimo para personalizacao de atendimento: registro de features, entrega online sub-10ms via Redis, materializacao offline em Parquet e o mesmo codigo de transformacao usado no treino e na inferencia para evitar training-serving skew.',
  en: 'Minimal feature store for support personalization: feature registry, sub-10ms online serving via Redis, offline materialization in Parquet and the same transformation code used in training and inference to avoid training-serving skew.',
  es: 'Feature store minimo para personalizacion de atencion: registro de features, entrega online sub-10ms via Redis, materializacion offline en Parquet y el mismo codigo de transformacion usado en el entrenamiento y en la inferencia para evitar training-serving skew.',
};

const repoUrl = 'https://github.com/joaosouz4dev/feature-store-personalizacao';

const pt = {
  intro:
    'Todo time que tenta personalizar atendimento esbarra no mesmo muro: a feature que o bot precisa na hora da conversa (ticket médio dos últimos 90 dias, número de compras, canal preferido, estágio no funil) é calculada de um jeito no notebook do cientista de dados e de outro jeito no código que roda em produção. Resultado: o modelo aprende com um número e recebe outro na inferência, a personalização erra e ninguém entende por quê. Esse descompasso tem nome, training-serving skew, e a ferramenta que existe justamente para eliminá-lo é o feature store. Este artigo mostra o que é um feature store, os quatro problemas que ele resolve, a diferença entre features batch e online, como garantir consistência treino/inferência com um exemplo real e como levar isso para produção sem montar uma plataforma gigante.',
  sections: [
    {
      title: 'O que é um feature store e por que atendimento precisa dele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um feature store é uma camada central que calcula, versiona, armazena e serve as features (os sinais de entrada de um modelo) de forma consistente entre o treino e a inferência. Em vez de cada serviço recalcular "quantas compras esse cliente fez" com sua própria query, todos consomem o mesmo valor, da mesma fonte, com a mesma definição. Em personalização de atendimento isso é crítico: a decisão de qual mensagem enviar, se oferece desconto, se prioriza na fila ou se já transfere para humano depende de features do cliente que precisam estar certas e disponíveis em milissegundos.',
        },
        {
          type: 'paragraph',
          value:
            'A dor aparece quando o mesmo conceito vive em três lugares: na query SQL do relatório, no notebook de treino e no endpoint de produção. As três divergem com o tempo, e a personalização vira um jogo de adivinhação. O feature store existe para que "ticket médio 90 dias" tenha UMA definição, calculada uma vez, servida para todos os consumidores.',
        },
      ],
    },
    {
      title: 'Os quatro problemas que ele resolve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Feature store não é hype de MLOps: cada capacidade responde a um problema concreto que aparece em qualquer time que personaliza atendimento com dados.',
        },
        {
          type: 'table',
          columns: ['Problema', 'Sem feature store', 'Com feature store'],
          rows: [
            [
              'Consistência treino/inferência',
              'A feature é calculada num script no treino e reescrita no código do endpoint; as duas divergem',
              'A mesma transformação gera o dado de treino e o de inferência; skew eliminado por construção',
            ],
            [
              'Latência na conversa',
              'O bot faz JOINs pesados em tempo real e estoura o SLA da resposta',
              'A feature já está pré-calculada e servida do online store em poucos milissegundos',
            ],
            [
              'Reuso entre modelos',
              'Cada projeto reimplementa "ticket médio" do zero, com pequenas diferenças',
              'A feature é definida uma vez no registro e reusada por qualquer modelo ou regra',
            ],
            [
              'Point-in-time correctness',
              'O treino usa o valor de hoje para prever o passado e vaza informação do futuro',
              'A materialização respeita o timestamp do evento e usa só o que era conhecido naquele instante',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quarto ponto é o mais silencioso e o mais perigoso: point-in-time correctness. Se você treina um modelo de próxima melhor ação usando o ticket médio ATUAL do cliente para rotular conversas de três meses atrás, o modelo aprende com informação que não existia naquele momento. Ele parece ótimo no backtest e falha em produção. Um feature store sério guarda o histórico com timestamp e faz o join respeitando o tempo.',
        },
      ],
    },
    {
      title: 'Features batch x online: os dois planos do mesmo dado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A arquitetura de um feature store tem dois caminhos para o mesmo dado. O plano offline (batch) lê as fontes brutas, calcula as features em janelas e materializa o resultado, usado para treinar modelos e para popular o plano online. O plano online serve o último valor de cada feature por chave (o cliente) com latência baixíssima, para a inferência em tempo real na conversa.',
        },
        {
          type: 'diagram',
          value: `Fontes brutas (eventos, pedidos, tickets)
        |
        v
  +-----------------------------+
  |  Transformacao (uma so vez) |
  +-----------------------------+
        |                     |
        v                     v
  Offline store          Online store
  (Parquet / DW)         (Redis / KV)
        |                     |
        v                     v
  Treino do modelo      Inferencia na conversa
  (historico + PIT)     (ultimo valor, < 10ms)`,
        },
        {
          type: 'paragraph',
          value:
            'A regra de ouro: a caixa "Transformação" é a MESMA para os dois caminhos. Se o código que gera a coluna de treino for diferente do que popula o Redis, o skew volta pela porta dos fundos. O offline store guarda o histórico completo com timestamp (para treino e point-in-time joins); o online store guarda só o valor mais recente por chave (para servir rápido).',
        },
      ],
    },
    {
      title: 'Definindo features com uma transformação única',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O antídoto para o training-serving skew é nunca escrever a lógica da feature duas vezes. Você define a transformação uma vez, como função pura sobre eventos, e chama a mesma função para materializar o offline e para atualizar o online. Abaixo, um exemplo enxuto: features de atendimento derivadas do histórico de pedidos e conversas de um cliente.',
        },
        {
          type: 'code',
          value: `// features.js - a UNICA definicao de cada feature.
// A mesma funcao roda no batch (treino/materializacao) e no online (update).

// Cada feature declara: nome, janela e como computar a partir dos eventos.
export const featureDefs = {
  ticket_medio_90d: {
    window_days: 90,
    compute: (events) => {
      const compras = events.filter((e) => e.type === 'order' && e.value > 0);
      if (compras.length === 0) return 0;
      const soma = compras.reduce((acc, e) => acc + e.value, 0);
      return Number((soma / compras.length).toFixed(2));
    },
  },
  num_compras_90d: {
    window_days: 90,
    compute: (events) => events.filter((e) => e.type === 'order').length,
  },
  canal_preferido: {
    window_days: 180,
    compute: (events) => {
      const msgs = events.filter((e) => e.type === 'message');
      const contagem = {};
      for (const m of msgs) contagem[m.channel] = (contagem[m.channel] || 0) + 1;
      const [canal] = Object.entries(contagem).sort((a, b) => b[1] - a[1])[0] || ['whatsapp'];
      return canal;
    },
  },
};

// Aplica TODAS as features a um cliente, respeitando a janela e o instante 'asOf'.
// asOf = agora  -> valor online (inferencia).
// asOf = timestamp do evento historico -> valor point-in-time (treino).
export function computeFeatures(events, asOf = Date.now()) {
  const out = { computed_at: asOf };
  for (const [name, def] of Object.entries(featureDefs)) {
    const inicio = asOf - def.window_days * 24 * 60 * 60 * 1000;
    const janela = events.filter((e) => e.ts <= asOf && e.ts >= inicio);
    out[name] = def.compute(janela);
  }
  return out;
}`,
        },
        {
          type: 'paragraph',
          value:
            'O parâmetro asOf é o que garante point-in-time correctness. Para servir online, você chama computeFeatures(events) e o asOf padrão é agora. Para gerar dado de treino, você chama computeFeatures(events, timestampDoRotulo), e a função filtra apenas os eventos que existiam naquele instante. Mesmo código, dois usos, zero skew.',
        },
      ],
    },
    {
      title: 'Servindo online: o online store de baixa latência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na conversa, o bot não pode fazer scan de eventos: ele lê o valor já pronto. Um job de materialização roda periodicamente (ou reage a eventos), chama computeFeatures com asOf igual a agora e escreve o resultado no online store, indexado pela chave do cliente. Na inferência, uma única leitura por chave devolve o vetor de features em poucos milissegundos.',
        },
        {
          type: 'code',
          value: `import { createClient } from 'redis';
import { computeFeatures } from './features.js';

const redis = createClient();
await redis.connect();

const key = (customerId) => \`features:\${customerId}\`;

// MATERIALIZACAO (batch/near-real-time): recalcula e grava o ultimo valor.
export async function materialize(customerId, events) {
  const features = computeFeatures(events); // asOf = agora
  await redis.set(key(customerId), JSON.stringify(features), { EX: 60 * 60 * 24 });
  return features;
}

// SERVING (inferencia na conversa): uma leitura por chave, < 10ms.
export async function getOnlineFeatures(customerId) {
  const raw = await redis.get(key(customerId));
  if (!raw) return null; // cold start: cliente sem historico materializado
  return JSON.parse(raw);
}

// Uso no fluxo do bot, antes de decidir a proxima acao.
const feats = await getOnlineFeatures('c_8123');
if (feats && feats.ticket_medio_90d > 500 && feats.num_compras_90d >= 3) {
  // cliente de alto valor e recorrente: prioriza fila e oferece atendimento VIP
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o código de decisão lê exatamente as mesmas features que o modelo de treino viu, com os mesmos nomes e a mesma semântica. Se amanhã você trocar a regra por um modelo, ele consome getOnlineFeatures sem reimplementar nada. E se o cliente não tiver valor materializado (cold start), o código trata o null com um fallback explícito, em vez de estourar.',
        },
      ],
    },
    {
      title: 'Evitando o vazamento: point-in-time joins no treino',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Montar o dataset de treino é onde a maioria dos times vaza informação do futuro. Você tem uma lista de rótulos (exemplo: "essa conversa acabou em venda?") com seus timestamps, e precisa anexar as features como elas eram naquele instante, não como são hoje. Fazer isso errado, pegando o valor atual, infla a métrica no backtest e derruba o modelo em produção.',
        },
        {
          type: 'ordered',
          items: [
            'Parta dos rótulos: cada linha tem customer_id e o timestamp do evento que você quer prever (o instante da conversa, não o de hoje).',
            'Para cada rótulo, chame computeFeatures(events, timestampDoRotulo): a janela e o filtro asOf garantem que só eventos anteriores ao rótulo entram.',
            'Junte features e rótulo numa única linha do dataset: agora cada exemplo carrega o estado do cliente como era antes da decisão.',
            'Materialize o offline store em Parquet particionado por data, para reprodutibilidade e para reprocessar quando a definição de uma feature mudar.',
            'Treine com esse dataset: o modelo aprende com a mesma computeFeatures que servirá online, só que com asOf no passado. Consistência de ponta a ponta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esse cuidado é o que separa um número bonito de backtest de um modelo que funciona. Se o offline e o online usam a mesma transformação e o treino respeita o point-in-time, o valor que o modelo viu no treino e o valor que ele recebe na conversa são, por construção, a mesma coisa.',
        },
      ],
    },
    {
      title: 'Levando para produção sem overengineering',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Não é preciso adotar uma plataforma pesada no dia um. Um feature store pragmático para personalização de atendimento cabe em poucas peças, e você só cresce quando a dor justificar.',
        },
        {
          type: 'list',
          items: [
            'Registro de features versionado: um arquivo (como o features.js do exemplo) que é a fonte única de verdade das definições, revisado em pull request.',
            'Online store: Redis ou outro KV rápido, com o último valor por chave e TTL para dado que expira. Latência de leitura em milissegundos.',
            'Offline store: Parquet no object storage ou tabelas no data warehouse, com timestamp para point-in-time joins e reprocessamento.',
            'Job de materialização: batch agendado para features de janela longa e atualização reativa (via evento) para as que precisam ser frescas na conversa.',
            'Monitoramento de skew e frescor: alerta quando a distribuição online diverge do treino e quando a feature de um cliente ficou velha demais para ser confiável.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Comece pelo registro único e pela transformação compartilhada, que já matam o skew, que é a causa raiz da maioria das falhas de personalização. Redis e Parquet resolvem serving e treino. Framework dedicado (Feast e afins) só quando o número de features, times e modelos crescer a ponto de o controle manual doer mais do que a plataforma.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de um framework como o Feast para ter um feature store?',
      answer:
        'Não no começo. O que define um feature store não é a ferramenta, é a disciplina: uma definição única de cada feature, a mesma transformação no treino e na inferência, e point-in-time correctness no dataset. Dá para atender esses três pontos com um arquivo de definições versionado, Redis para o online e Parquet para o offline. Um framework dedicado como o Feast passa a compensar quando você tem muitas features, vários times e precisa de catálogo, controle de acesso e materialização gerenciada. Antes disso, ele adiciona mais complexidade do que valor.',
    },
    {
      question: 'O que exatamente é training-serving skew e como o feature store elimina?',
      answer:
        'Training-serving skew é a divergência entre o valor de uma feature no treino e o valor da mesma feature na inferência, geralmente porque foram calculados por códigos diferentes. O modelo aprende com um número e recebe outro em produção, então a qualidade cai sem erro aparente. O feature store elimina isso ao forçar que a MESMA função de transformação gere os dois valores: no exemplo do artigo, computeFeatures roda igual no batch de treino e no update online, mudando apenas o parâmetro asOf. Se a lógica vive em um só lugar, os dois lados não têm como divergir.',
    },
    {
      question: 'Como garanto que o treino não vaza informação do futuro?',
      answer:
        'Com point-in-time correctness. Ao montar o dataset, para cada rótulo você anexa as features como elas eram no timestamp daquele evento, não como são hoje. Na prática, isso é chamar a transformação com asOf igual ao instante do rótulo, para que a janela filtre apenas eventos anteriores. Se você usa o valor atual para rotular o passado, o backtest fica otimista demais e o modelo decepciona em produção. O offline store com histórico e timestamp é o que torna esse join temporal possível de forma reprodutível.',
    },
  ],
  conclusion: {
    title: 'Uma definição, dois planos, zero skew',
    description:
      'Personalizar atendimento sem feature store é apostar que três cópias da mesma feature vão concordar para sempre, e elas nunca concordam. Posso desenhar e implementar um feature store pragmático para o seu atendimento: registro único de features, serving online de baixa latência, treino com point-in-time correctness e monitoramento de skew, sem montar uma plataforma que você ainda não precisa.',
    cta: 'Falar sobre personalização de atendimento',
  },
  related: [
    { label: 'RAG para atendimento no WhatsApp em produção', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'feature-store-personalizacao', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Every team that tries to personalize support hits the same wall: the feature the bot needs during the conversation (90-day average ticket, number of purchases, preferred channel, funnel stage) is computed one way in the data scientist notebook and another way in the code running in production. The result: the model learns from one number and receives a different one at inference, personalization misfires and no one understands why. That mismatch has a name, training-serving skew, and the tool that exists precisely to eliminate it is the feature store. This article shows what a feature store is, the four problems it solves, the difference between batch and online features, how to guarantee training/inference consistency with a real example and how to take this to production without building a giant platform.',
  sections: [
    {
      title: 'What a feature store is and why support needs one',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A feature store is a central layer that computes, versions, stores and serves the features (a model input signals) consistently across training and inference. Instead of each service recomputing "how many purchases this customer made" with its own query, everyone consumes the same value, from the same source, with the same definition. In support personalization this is critical: deciding which message to send, whether to offer a discount, whether to prioritize in the queue or hand off to a human depends on customer features that must be correct and available within milliseconds.',
        },
        {
          type: 'paragraph',
          value:
            'The pain shows up when the same concept lives in three places: the report SQL query, the training notebook and the production endpoint. All three drift apart over time, and personalization becomes a guessing game. The feature store exists so that "90-day average ticket" has ONE definition, computed once, served to all consumers.',
        },
      ],
    },
    {
      title: 'The four problems it solves',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A feature store is not MLOps hype: each capability answers a concrete problem that appears in any team personalizing support with data.',
        },
        {
          type: 'table',
          columns: ['Problem', 'Without feature store', 'With feature store'],
          rows: [
            [
              'Training/inference consistency',
              'The feature is computed in a training script and rewritten in the endpoint code; the two diverge',
              'The same transformation produces the training and inference data; skew eliminated by construction',
            ],
            [
              'Latency in the conversation',
              'The bot runs heavy JOINs in real time and blows the response SLA',
              'The feature is already precomputed and served from the online store in a few milliseconds',
            ],
            [
              'Reuse across models',
              'Each project reimplements "average ticket" from scratch, with small differences',
              'The feature is defined once in the registry and reused by any model or rule',
            ],
            [
              'Point-in-time correctness',
              'Training uses today value to predict the past and leaks information from the future',
              'Materialization respects the event timestamp and uses only what was known at that instant',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth point is the quietest and the most dangerous: point-in-time correctness. If you train a next-best-action model using the customer CURRENT average ticket to label conversations from three months ago, the model learns from information that did not exist at that moment. It looks great in the backtest and fails in production. A serious feature store stores the history with timestamps and does the join respecting time.',
        },
      ],
    },
    {
      title: 'Batch vs online features: two planes of the same data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A feature store architecture has two paths for the same data. The offline (batch) plane reads the raw sources, computes the features over windows and materializes the result, used to train models and to populate the online plane. The online plane serves the latest value of each feature per key (the customer) with very low latency, for real-time inference in the conversation.',
        },
        {
          type: 'diagram',
          value: `Raw sources (events, orders, tickets)
        |
        v
  +-----------------------------+
  |  Transformation (only once) |
  +-----------------------------+
        |                     |
        v                     v
  Offline store          Online store
  (Parquet / DW)         (Redis / KV)
        |                     |
        v                     v
  Model training        Inference in the conversation
  (history + PIT)       (latest value, < 10ms)`,
        },
        {
          type: 'paragraph',
          value:
            'The golden rule: the "Transformation" box is the SAME for both paths. If the code that produces the training column differs from the one that populates Redis, skew comes back through the side door. The offline store keeps the full history with timestamps (for training and point-in-time joins); the online store keeps only the most recent value per key (to serve fast).',
        },
      ],
    },
    {
      title: 'Defining features with a single transformation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The antidote to training-serving skew is to never write the feature logic twice. You define the transformation once, as a pure function over events, and call the same function to materialize offline and to update online. Below, a lean example: support features derived from a customer order and conversation history.',
        },
        {
          type: 'code',
          value: `// features.js - the ONE definition of each feature.
// The same function runs in batch (training/materialization) and online (update).

// Each feature declares: name, window and how to compute from the events.
export const featureDefs = {
  avg_ticket_90d: {
    window_days: 90,
    compute: (events) => {
      const orders = events.filter((e) => e.type === 'order' && e.value > 0);
      if (orders.length === 0) return 0;
      const sum = orders.reduce((acc, e) => acc + e.value, 0);
      return Number((sum / orders.length).toFixed(2));
    },
  },
  num_orders_90d: {
    window_days: 90,
    compute: (events) => events.filter((e) => e.type === 'order').length,
  },
  preferred_channel: {
    window_days: 180,
    compute: (events) => {
      const msgs = events.filter((e) => e.type === 'message');
      const counts = {};
      for (const m of msgs) counts[m.channel] = (counts[m.channel] || 0) + 1;
      const [channel] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['whatsapp'];
      return channel;
    },
  },
};

// Applies ALL features to a customer, respecting the window and the 'asOf' instant.
// asOf = now  -> online value (inference).
// asOf = historical event timestamp -> point-in-time value (training).
export function computeFeatures(events, asOf = Date.now()) {
  const out = { computed_at: asOf };
  for (const [name, def] of Object.entries(featureDefs)) {
    const start = asOf - def.window_days * 24 * 60 * 60 * 1000;
    const window = events.filter((e) => e.ts <= asOf && e.ts >= start);
    out[name] = def.compute(window);
  }
  return out;
}`,
        },
        {
          type: 'paragraph',
          value:
            'The asOf parameter is what guarantees point-in-time correctness. To serve online, you call computeFeatures(events) and the default asOf is now. To generate training data, you call computeFeatures(events, labelTimestamp), and the function filters only the events that existed at that instant. Same code, two uses, zero skew.',
        },
      ],
    },
    {
      title: 'Serving online: the low-latency online store',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In the conversation, the bot cannot scan events: it reads the value already prepared. A materialization job runs periodically (or reacts to events), calls computeFeatures with asOf equal to now and writes the result to the online store, indexed by the customer key. At inference, a single read per key returns the feature vector in a few milliseconds.',
        },
        {
          type: 'code',
          value: `import { createClient } from 'redis';
import { computeFeatures } from './features.js';

const redis = createClient();
await redis.connect();

const key = (customerId) => \`features:\${customerId}\`;

// MATERIALIZATION (batch/near-real-time): recompute and store the latest value.
export async function materialize(customerId, events) {
  const features = computeFeatures(events); // asOf = now
  await redis.set(key(customerId), JSON.stringify(features), { EX: 60 * 60 * 24 });
  return features;
}

// SERVING (inference in the conversation): one read per key, < 10ms.
export async function getOnlineFeatures(customerId) {
  const raw = await redis.get(key(customerId));
  if (!raw) return null; // cold start: customer with no materialized history
  return JSON.parse(raw);
}

// Usage in the bot flow, before deciding the next action.
const feats = await getOnlineFeatures('c_8123');
if (feats && feats.avg_ticket_90d > 500 && feats.num_orders_90d >= 3) {
  // high-value recurring customer: prioritize the queue and offer VIP support
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice that the decision code reads exactly the same features the training model saw, with the same names and the same semantics. If tomorrow you swap the rule for a model, it consumes getOnlineFeatures without reimplementing anything. And if the customer has no materialized value (cold start), the code handles the null with an explicit fallback instead of crashing.',
        },
      ],
    },
    {
      title: 'Avoiding the leak: point-in-time joins in training',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Building the training dataset is where most teams leak information from the future. You have a list of labels (example: "did this conversation end in a sale?") with their timestamps, and you need to attach the features as they were at that instant, not as they are today. Doing it wrong, taking the current value, inflates the backtest metric and drops the model in production.',
        },
        {
          type: 'ordered',
          items: [
            'Start from the labels: each row has customer_id and the timestamp of the event you want to predict (the moment of the conversation, not today).',
            'For each label, call computeFeatures(events, labelTimestamp): the window and the asOf filter guarantee only events prior to the label enter.',
            'Join features and label into a single dataset row: now each example carries the customer state as it was before the decision.',
            'Materialize the offline store in Parquet partitioned by date, for reproducibility and to reprocess when a feature definition changes.',
            'Train with that dataset: the model learns from the same computeFeatures that will serve online, only with asOf in the past. End-to-end consistency.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'This care is what separates a pretty backtest number from a model that works. If offline and online use the same transformation and training respects point-in-time, the value the model saw in training and the value it receives in the conversation are, by construction, the same thing.',
        },
      ],
    },
    {
      title: 'Taking it to production without overengineering',
      blocks: [
        {
          type: 'paragraph',
          value:
            'You do not need to adopt a heavy platform on day one. A pragmatic feature store for support personalization fits in a few pieces, and you only grow when the pain justifies it.',
        },
        {
          type: 'list',
          items: [
            'Versioned feature registry: a file (like the example features.js) that is the single source of truth of the definitions, reviewed in a pull request.',
            'Online store: Redis or another fast KV, with the latest value per key and TTL for data that expires. Read latency in milliseconds.',
            'Offline store: Parquet in object storage or tables in the data warehouse, with timestamps for point-in-time joins and reprocessing.',
            'Materialization job: scheduled batch for long-window features and reactive updates (via event) for those that must be fresh in the conversation.',
            'Skew and freshness monitoring: alert when the online distribution diverges from training and when a customer feature got too stale to be trusted.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Start with the single registry and the shared transformation, which already kill skew, the root cause of most personalization failures. Redis and Parquet solve serving and training. A dedicated framework (Feast and friends) only when the number of features, teams and models grows to the point where manual control hurts more than the platform.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need a framework like Feast to have a feature store?',
      answer:
        'Not at the start. What defines a feature store is not the tool, it is the discipline: a single definition of each feature, the same transformation in training and inference, and point-in-time correctness in the dataset. You can meet those three points with a versioned definitions file, Redis for online and Parquet for offline. A dedicated framework like Feast starts to pay off when you have many features, several teams and need a catalog, access control and managed materialization. Before that, it adds more complexity than value.',
    },
    {
      question: 'What exactly is training-serving skew and how does the feature store eliminate it?',
      answer:
        'Training-serving skew is the divergence between a feature value in training and the same feature value at inference, usually because they were computed by different code. The model learns from one number and receives another in production, so quality drops with no visible error. The feature store eliminates it by forcing the SAME transformation function to produce both values: in the article example, computeFeatures runs the same in the training batch and in the online update, changing only the asOf parameter. If the logic lives in one place, the two sides cannot diverge.',
    },
    {
      question: 'How do I ensure training does not leak information from the future?',
      answer:
        'With point-in-time correctness. When building the dataset, for each label you attach the features as they were at the timestamp of that event, not as they are today. In practice, that is calling the transformation with asOf equal to the label instant, so the window filters only prior events. If you use the current value to label the past, the backtest becomes too optimistic and the model disappoints in production. The offline store with history and timestamps is what makes this temporal join reproducible.',
    },
  ],
  conclusion: {
    title: 'One definition, two planes, zero skew',
    description:
      'Personalizing support without a feature store is betting that three copies of the same feature will agree forever, and they never do. I can design and implement a pragmatic feature store for your support: a single feature registry, low-latency online serving, training with point-in-time correctness and skew monitoring, without building a platform you do not yet need.',
    cta: 'Talk about support personalization',
  },
  related: [
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'feature-store-personalizacao', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Todo equipo que intenta personalizar la atención choca con el mismo muro: la feature que el bot necesita en el momento de la conversación (ticket promedio de los últimos 90 días, número de compras, canal preferido, etapa del embudo) se calcula de una forma en el notebook del científico de datos y de otra forma en el código que corre en producción. El resultado: el modelo aprende con un número y recibe otro en la inferencia, la personalización falla y nadie entiende por qué. Ese descalce tiene nombre, training-serving skew, y la herramienta que existe justamente para eliminarlo es el feature store. Este artículo muestra qué es un feature store, los cuatro problemas que resuelve, la diferencia entre features batch y online, cómo garantizar consistencia entrenamiento/inferencia con un ejemplo real y cómo llevar esto a producción sin montar una plataforma gigante.',
  sections: [
    {
      title: '¿Qué es un feature store y por qué la atención lo necesita?',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un feature store es una capa central que calcula, versiona, almacena y sirve las features (las señales de entrada de un modelo) de forma consistente entre el entrenamiento y la inferencia. En vez de que cada servicio recalcule "cuántas compras hizo este cliente" con su propia query, todos consumen el mismo valor, de la misma fuente, con la misma definición. En personalización de atención esto es crítico: decidir qué mensaje enviar, si ofrecer descuento, si priorizar en la cola o si transferir a un humano depende de features del cliente que deben estar correctas y disponibles en milisegundos.',
        },
        {
          type: 'paragraph',
          value:
            'El dolor aparece cuando el mismo concepto vive en tres lugares: en la query SQL del reporte, en el notebook de entrenamiento y en el endpoint de producción. Los tres divergen con el tiempo, y la personalización se vuelve un juego de adivinanzas. El feature store existe para que "ticket promedio 90 días" tenga UNA definición, calculada una vez, servida a todos los consumidores.',
        },
      ],
    },
    {
      title: 'Los cuatro problemas que resuelve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Feature store no es hype de MLOps: cada capacidad responde a un problema concreto que aparece en cualquier equipo que personaliza atención con datos.',
        },
        {
          type: 'table',
          columns: ['Problema', 'Sin feature store', 'Con feature store'],
          rows: [
            [
              'Consistencia entrenamiento/inferencia',
              'La feature se calcula en un script de entrenamiento y se reescribe en el código del endpoint; ambos divergen',
              'La misma transformación genera el dato de entrenamiento y el de inferencia; skew eliminado por construcción',
            ],
            [
              'Latencia en la conversación',
              'El bot hace JOINs pesados en tiempo real y revienta el SLA de la respuesta',
              'La feature ya está precalculada y servida desde el online store en pocos milisegundos',
            ],
            [
              'Reuso entre modelos',
              'Cada proyecto reimplementa "ticket promedio" desde cero, con pequeñas diferencias',
              'La feature se define una vez en el registro y se reusa por cualquier modelo o regla',
            ],
            [
              'Point-in-time correctness',
              'El entrenamiento usa el valor de hoy para predecir el pasado y filtra información del futuro',
              'La materialización respeta el timestamp del evento y usa solo lo que se conocía en ese instante',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El cuarto punto es el más silencioso y el más peligroso: point-in-time correctness. Si entrenas un modelo de próxima mejor acción usando el ticket promedio ACTUAL del cliente para etiquetar conversaciones de hace tres meses, el modelo aprende con información que no existía en ese momento. Se ve excelente en el backtest y falla en producción. Un feature store serio guarda el historial con timestamp y hace el join respetando el tiempo.',
        },
      ],
    },
    {
      title: 'Features batch y online: los dos planos del mismo dato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La arquitectura de un feature store tiene dos caminos para el mismo dato. El plano offline (batch) lee las fuentes crudas, calcula las features en ventanas y materializa el resultado, usado para entrenar modelos y para poblar el plano online. El plano online sirve el último valor de cada feature por clave (el cliente) con latencia bajísima, para la inferencia en tiempo real en la conversación.',
        },
        {
          type: 'diagram',
          value: `Fuentes crudas (eventos, pedidos, tickets)
        |
        v
  +-----------------------------+
  |  Transformacion (una sola)  |
  +-----------------------------+
        |                     |
        v                     v
  Offline store          Online store
  (Parquet / DW)         (Redis / KV)
        |                     |
        v                     v
  Entrenamiento         Inferencia en la conversacion
  (historial + PIT)     (ultimo valor, < 10ms)`,
        },
        {
          type: 'paragraph',
          value:
            'La regla de oro: la caja "Transformación" es la MISMA para ambos caminos. Si el código que genera la columna de entrenamiento es distinto del que puebla Redis, el skew vuelve por la puerta de atrás. El offline store guarda el historial completo con timestamp (para entrenamiento y point-in-time joins); el online store guarda solo el valor más reciente por clave (para servir rápido).',
        },
      ],
    },
    {
      title: 'Definiendo features con una transformación única',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El antídoto para el training-serving skew es nunca escribir la lógica de la feature dos veces. Defines la transformación una vez, como función pura sobre eventos, y llamas a la misma función para materializar el offline y para actualizar el online. Abajo, un ejemplo escueto: features de atención derivadas del historial de pedidos y conversaciones de un cliente.',
        },
        {
          type: 'code',
          value: `// features.js - la UNICA definicion de cada feature.
// La misma funcion corre en el batch (entrenamiento/materializacion) y en el online (update).

// Cada feature declara: nombre, ventana y como computar a partir de los eventos.
export const featureDefs = {
  ticket_promedio_90d: {
    window_days: 90,
    compute: (events) => {
      const compras = events.filter((e) => e.type === 'order' && e.value > 0);
      if (compras.length === 0) return 0;
      const suma = compras.reduce((acc, e) => acc + e.value, 0);
      return Number((suma / compras.length).toFixed(2));
    },
  },
  num_compras_90d: {
    window_days: 90,
    compute: (events) => events.filter((e) => e.type === 'order').length,
  },
  canal_preferido: {
    window_days: 180,
    compute: (events) => {
      const msgs = events.filter((e) => e.type === 'message');
      const conteo = {};
      for (const m of msgs) conteo[m.channel] = (conteo[m.channel] || 0) + 1;
      const [canal] = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0] || ['whatsapp'];
      return canal;
    },
  },
};

// Aplica TODAS las features a un cliente, respetando la ventana y el instante 'asOf'.
// asOf = ahora  -> valor online (inferencia).
// asOf = timestamp del evento historico -> valor point-in-time (entrenamiento).
export function computeFeatures(events, asOf = Date.now()) {
  const out = { computed_at: asOf };
  for (const [name, def] of Object.entries(featureDefs)) {
    const inicio = asOf - def.window_days * 24 * 60 * 60 * 1000;
    const ventana = events.filter((e) => e.ts <= asOf && e.ts >= inicio);
    out[name] = def.compute(ventana);
  }
  return out;
}`,
        },
        {
          type: 'paragraph',
          value:
            'El parámetro asOf es lo que garantiza point-in-time correctness. Para servir online, llamas computeFeatures(events) y el asOf por defecto es ahora. Para generar dato de entrenamiento, llamas computeFeatures(events, timestampDeLaEtiqueta), y la función filtra solo los eventos que existían en ese instante. Mismo código, dos usos, cero skew.',
        },
      ],
    },
    {
      title: 'Sirviendo online: el online store de baja latencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la conversación, el bot no puede escanear eventos: lee el valor ya listo. Un job de materialización corre periódicamente (o reacciona a eventos), llama computeFeatures con asOf igual a ahora y escribe el resultado en el online store, indexado por la clave del cliente. En la inferencia, una única lectura por clave devuelve el vector de features en pocos milisegundos.',
        },
        {
          type: 'code',
          value: `import { createClient } from 'redis';
import { computeFeatures } from './features.js';

const redis = createClient();
await redis.connect();

const key = (customerId) => \`features:\${customerId}\`;

// MATERIALIZACION (batch/near-real-time): recalcula y guarda el ultimo valor.
export async function materialize(customerId, events) {
  const features = computeFeatures(events); // asOf = ahora
  await redis.set(key(customerId), JSON.stringify(features), { EX: 60 * 60 * 24 });
  return features;
}

// SERVING (inferencia en la conversacion): una lectura por clave, < 10ms.
export async function getOnlineFeatures(customerId) {
  const raw = await redis.get(key(customerId));
  if (!raw) return null; // cold start: cliente sin historial materializado
  return JSON.parse(raw);
}

// Uso en el flujo del bot, antes de decidir la proxima accion.
const feats = await getOnlineFeatures('c_8123');
if (feats && feats.ticket_promedio_90d > 500 && feats.num_compras_90d >= 3) {
  // cliente de alto valor y recurrente: prioriza la cola y ofrece atencion VIP
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fíjate que el código de decisión lee exactamente las mismas features que vio el modelo de entrenamiento, con los mismos nombres y la misma semántica. Si mañana cambias la regla por un modelo, él consume getOnlineFeatures sin reimplementar nada. Y si el cliente no tiene valor materializado (cold start), el código maneja el null con un fallback explícito, en vez de reventar.',
        },
      ],
    },
    {
      title: 'Evitando la fuga: point-in-time joins en el entrenamiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Armar el dataset de entrenamiento es donde la mayoría de los equipos filtra información del futuro. Tienes una lista de etiquetas (ejemplo: "¿esta conversación terminó en venta?") con sus timestamps, y necesitas anexar las features como eran en ese instante, no como son hoy. Hacerlo mal, tomando el valor actual, infla la métrica del backtest y derrumba el modelo en producción.',
        },
        {
          type: 'ordered',
          items: [
            'Parte de las etiquetas: cada fila tiene customer_id y el timestamp del evento que quieres predecir (el instante de la conversación, no el de hoy).',
            'Para cada etiqueta, llama computeFeatures(events, timestampDeLaEtiqueta): la ventana y el filtro asOf garantizan que solo eventos anteriores a la etiqueta entren.',
            'Une features y etiqueta en una sola fila del dataset: ahora cada ejemplo carga el estado del cliente como era antes de la decisión.',
            'Materializa el offline store en Parquet particionado por fecha, para reproducibilidad y para reprocesar cuando la definición de una feature cambie.',
            'Entrena con ese dataset: el modelo aprende con la misma computeFeatures que servirá online, solo que con asOf en el pasado. Consistencia de punta a punta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ese cuidado es lo que separa un número bonito de backtest de un modelo que funciona. Si el offline y el online usan la misma transformación y el entrenamiento respeta el point-in-time, el valor que el modelo vio en el entrenamiento y el valor que recibe en la conversación son, por construcción, la misma cosa.',
        },
      ],
    },
    {
      title: 'Llevándolo a producción sin overengineering',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No hace falta adoptar una plataforma pesada el día uno. Un feature store pragmático para personalización de atención cabe en pocas piezas, y solo creces cuando el dolor lo justifique.',
        },
        {
          type: 'list',
          items: [
            'Registro de features versionado: un archivo (como el features.js del ejemplo) que es la fuente única de verdad de las definiciones, revisado en pull request.',
            'Online store: Redis u otro KV rápido, con el último valor por clave y TTL para dato que expira. Latencia de lectura en milisegundos.',
            'Offline store: Parquet en object storage o tablas en el data warehouse, con timestamp para point-in-time joins y reprocesamiento.',
            'Job de materialización: batch agendado para features de ventana larga y actualización reactiva (vía evento) para las que deben estar frescas en la conversación.',
            'Monitoreo de skew y frescura: alerta cuando la distribución online diverge del entrenamiento y cuando la feature de un cliente quedó demasiado vieja para confiar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Empieza por el registro único y la transformación compartida, que ya matan el skew, la causa raíz de la mayoría de las fallas de personalización. Redis y Parquet resuelven serving y entrenamiento. Un framework dedicado (Feast y afines) solo cuando el número de features, equipos y modelos crezca al punto en que el control manual duela más que la plataforma.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito un framework como Feast para tener un feature store?',
      answer:
        'No al comienzo. Lo que define un feature store no es la herramienta, es la disciplina: una definición única de cada feature, la misma transformación en el entrenamiento y en la inferencia, y point-in-time correctness en el dataset. Puedes cumplir esos tres puntos con un archivo de definiciones versionado, Redis para el online y Parquet para el offline. Un framework dedicado como Feast empieza a compensar cuando tienes muchas features, varios equipos y necesitas catálogo, control de acceso y materialización gestionada. Antes de eso, agrega más complejidad que valor.',
    },
    {
      question: '¿Qué es exactamente el training-serving skew y cómo lo elimina el feature store?',
      answer:
        'Training-serving skew es la divergencia entre el valor de una feature en el entrenamiento y el valor de la misma feature en la inferencia, generalmente porque fueron calculados por códigos distintos. El modelo aprende con un número y recibe otro en producción, entonces la calidad cae sin error aparente. El feature store lo elimina al forzar que la MISMA función de transformación genere ambos valores: en el ejemplo del artículo, computeFeatures corre igual en el batch de entrenamiento y en el update online, cambiando solo el parámetro asOf. Si la lógica vive en un solo lugar, los dos lados no pueden divergir.',
    },
    {
      question: '¿Cómo garantizo que el entrenamiento no filtre información del futuro?',
      answer:
        'Con point-in-time correctness. Al armar el dataset, para cada etiqueta anexas las features como eran en el timestamp de ese evento, no como son hoy. En la práctica, eso es llamar la transformación con asOf igual al instante de la etiqueta, para que la ventana filtre solo eventos anteriores. Si usas el valor actual para etiquetar el pasado, el backtest queda demasiado optimista y el modelo decepciona en producción. El offline store con historial y timestamp es lo que hace este join temporal reproducible.',
    },
  ],
  conclusion: {
    title: 'Una definición, dos planos, cero skew',
    description:
      'Personalizar la atención sin feature store es apostar a que tres copias de la misma feature van a concordar para siempre, y nunca concuerdan. Puedo diseñar e implementar un feature store pragmático para tu atención: registro único de features, serving online de baja latencia, entrenamiento con point-in-time correctness y monitoreo de skew, sin montar una plataforma que aún no necesitas.',
    cta: 'Hablar sobre personalización de atención',
  },
  related: [
    { label: 'RAG para atención en WhatsApp en producción', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
  ],
  repo: { name: 'feature-store-personalizacao', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
