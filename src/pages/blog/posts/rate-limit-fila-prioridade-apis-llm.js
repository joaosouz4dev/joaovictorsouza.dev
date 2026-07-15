// Conteudo do artigo: rate limit e fila de prioridade para APIs de LLM.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Cliente mínimo de API de LLM com controle de vazão e fila de prioridade: um token bucket segura a taxa abaixo do limite do provedor, uma fila com classes de prioridade decide quem passa primeiro quando a demanda excede a cota, e o retry com backoff exponencial e jitter respeita o Retry-After em vez de martelar o servidor, para que picos virem espera ordenada em vez de uma chuva de erros 429.',
  en: 'Minimal LLM API client with throughput control and priority queue: a token bucket keeps the rate below the provider limit, a queue with priority classes decides who goes first when demand exceeds the quota, and retry with exponential backoff and jitter honors Retry-After instead of hammering the server, so that spikes turn into orderly waiting instead of a shower of 429 errors.',
  es: 'Cliente mínimo de API de LLM con control de caudal y cola de prioridad: un token bucket mantiene la tasa por debajo del límite del proveedor, una cola con clases de prioridad decide quién pasa primero cuando la demanda excede la cuota, y el retry con backoff exponencial y jitter respeta el Retry-After en vez de martillar el servidor, para que los picos se vuelvan espera ordenada en lugar de una lluvia de errores 429.',
};

const repoUrl = 'https://github.com/joaosouz4dev/llm-rate-limit-queue';

const pt = {
  intro:
    'Toda API de LLM tem um teto, e ele quase nunca é o que você imagina. O provedor não vende chamadas ilimitadas: vende uma cota por minuto, medida em requisições e em tokens, e quando o seu tráfego encosta nesse teto a API começa a devolver 429. O primeiro reflexo de quase todo time é tentar de novo, imediatamente, em todas as chamadas que falharam ao mesmo tempo. É o pior movimento possível: as tentativas simultâneas batem no limite outra vez, geram mais 429, disparam mais retentativas, e o sistema entra numa tempestade de retry que consome a cota inteira em erros e não entrega uma resposta sequer. O erro conceitual é tratar o rate limit como uma falha esporádica quando ele é um recurso escasso a ser administrado. Um pico de demanda não deveria virar uma chuva de erros: deveria virar uma fila. E se é para haver fila, ela não pode ser cega, porque nem toda chamada vale o mesmo: o usuário esperando uma resposta na tela não pode ficar atrás de dez mil linhas de um relatório noturno. Este artigo mostra como transformar o teto do provedor em vazão controlada: o token bucket que segura a taxa antes do erro acontecer, a fila com classes de prioridade que decide quem passa primeiro, o retry com backoff e jitter que respeita o Retry-After, e as métricas que dizem se a cota está apertada ou se o problema é outro.',
  sections: [
    {
      title: 'Por que o retry ingênuo piora o problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando uma chamada volta com 429, o significado é literal: o provedor está dizendo que você excedeu a cota e precisa desacelerar. Repetir a chamada no instante seguinte é responder ao pedido de desaceleração acelerando. E o problema não é uma chamada repetida: é que todas as chamadas que falharam no mesmo segundo tendem a repetir no mesmo segundo, porque falharam juntas. Esse é o efeito manada, e ele converte um pico de tráfego numa oscilação que se sustenta sozinha, com a cota inteira sendo gasta em requisições rejeitadas.',
        },
        {
          type: 'paragraph',
          value:
            'Vale entender também que a cota de uma API de LLM raramente é uma dimensão só. Costuma haver um limite de requisições por minuto e outro, independente, de tokens por minuto, e o segundo é o que morde primeiro em cargas de contexto longo: dez chamadas com um prompt gigante estouram a cota de tokens muito antes de encostar na de requisições. Controlar apenas a contagem de chamadas dá a ilusão de estar dentro do limite enquanto o consumo real de tokens já passou dele.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'O que acontece no pico', 'Efeito na cota', 'Resultado para o usuário'],
          rows: [
            [
              'Retry imediato',
              'Todas as falhas repetem juntas',
              'Consumida por requisições rejeitadas',
              'Erro depois de uma espera longa',
            ],
            [
              'Retry com backoff fixo',
              'Manada volta em bloco, só que mais tarde',
              'Picos sincronizados de rejeição',
              'Latência irregular e imprevisível',
            ],
            [
              'Backoff exponencial com jitter',
              'Tentativas se espalham no tempo',
              'Rejeições caem, mas ainda há erro',
              'Funciona, sem controle de ordem',
            ],
            [
              'Token bucket com fila e prioridade',
              'Excedente espera em fila ordenada',
              'Usada quase toda em chamadas aceitas',
              'Espera previsível, crítico passa antes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre as duas últimas linhas é a tese deste artigo. Backoff com jitter é reativo: espera o erro acontecer para então se comportar bem. O token bucket com fila é preventivo: ele nunca deixa a chamada sair se ela vai estourar a cota, então o 429 quase não acontece, e quando acontece (porque outra instância também consome a mesma cota) o backoff é a rede de segurança, não a estratégia principal.',
        },
      ],
    },
    {
      title: 'Token bucket: segurar a taxa antes do erro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O token bucket é o algoritmo certo para essa tarefa porque modela exatamente o que o provedor vende: uma taxa média com tolerância a rajada. O balde tem uma capacidade máxima e é reabastecido continuamente a uma taxa fixa. Cada chamada precisa retirar tokens do balde para sair; se não houver tokens suficientes, ela espera até haver. A capacidade define o tamanho da rajada que você aceita mandar de uma vez, e a taxa de reabastecimento define o regime sustentado. É melhor que uma janela fixa de contagem, que sofre do problema de borda: duas rajadas nas pontas de janelas vizinhas passam pela contagem mas concentram o dobro do tráfego no meio.',
        },
        {
          type: 'paragraph',
          value:
            'A sutileza para LLM é que você precisa de dois baldes, um para requisições e um para tokens, e a chamada só sai quando os dois autorizam. O balde de tokens é debitado por uma estimativa do custo da chamada antes de ela sair, e reconciliado com o consumo real quando a resposta chega, porque só aí se sabe quantos tokens de saída o modelo gerou.',
        },
        {
          type: 'diagram',
          value: `  reabastecimento continuo (rate/s)
            |
            v
   +--------------------+
   |  balde de requisicoes |  capacidade = rajada aceita
   +--------------------+
            |  precisa de 1 token
            v
   +--------------------+
   |   balde de tokens    |  capacidade = tokens/min do plano
   +--------------------+
            |  precisa de custo_estimado
            v
     os dois autorizam? --nao--> espera na fila
            |
           sim
            v
       chamada sai para a API
            |
            v
   resposta traz uso real -> reconcilia o balde de tokens`,
        },
        {
          type: 'code',
          value: `// src/token-bucket.js
// Balde de tokens com reabastecimento continuo.
// Nao usa setInterval: calcula o nivel sob demanda a partir do tempo
// decorrido, o que evita drift e nao segura o event loop.

export class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.level = capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.level = Math.min(
      this.capacity,
      this.level + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefill = now;
  }

  // Tenta retirar 'amount' tokens. Devolve true se conseguiu.
  tryRemove(amount) {
    this.refill();
    if (this.level < amount) return false;
    this.level -= amount;
    return true;
  }

  // Quantos ms faltam ate haver 'amount' tokens disponiveis.
  waitTimeMs(amount) {
    this.refill();
    if (this.level >= amount) return 0;
    const missing = amount - this.level;
    return Math.ceil((missing / this.refillPerSecond) * 1000);
  }

  // Devolve tokens ao balde quando a estimativa foi maior que o uso real.
  giveBack(amount) {
    this.refill();
    this.level = Math.min(this.capacity, this.level + Math.max(0, amount));
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes de implementação valem o comentário. O reabastecimento é calculado sob demanda, a partir do tempo decorrido desde a última consulta, em vez de um setInterval que soma tokens periodicamente: além de não segurar o event loop com um timer eterno, isso elimina o desvio acumulado que um intervalo impreciso introduziria ao longo de horas. E o giveBack existe porque a estimativa de custo é feita antes da chamada, quando ainda não se sabe o tamanho da saída; quando a resposta chega com o uso real e ele foi menor que o estimado, a diferença volta para o balde, senão a cota real fica ociosa por causa de uma estimativa pessimista.',
        },
      ],
    },
    {
      title: 'A fila de prioridade: nem toda chamada vale o mesmo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a demanda excede a cota, alguém vai esperar. A pergunta é quem. Uma fila FIFO responde "quem chegou depois", o que é a resposta errada, porque ela ignora completamente o custo de negócio da espera. Um usuário olhando para a tela esperando o chat responder tem tolerância de segundos; um relatório em lote que roda de madrugada tolera minutos sem que ninguém perceba. Se ambos entram na mesma fila por ordem de chegada, o lote de dez mil linhas que entrou às três da manhã vai fazer o usuário das três e um esperar o lote inteiro.',
        },
        {
          type: 'paragraph',
          value:
            'A solução é classificar cada chamada por prioridade na origem e servir a fila por classe. Três classes cobrem quase todo caso real, e a disciplina é simples: só sirva a classe mais baixa quando as mais altas estiverem vazias.',
        },
        {
          type: 'table',
          columns: ['Classe', 'Exemplo típico', 'Tolerância de espera', 'O que fazer sob pressão'],
          rows: [
            [
              'Interativa',
              'Chat com usuário na tela, autocomplete',
              'Segundos',
              'Passa na frente, sempre',
            ],
            [
              'Assíncrona',
              'Resumo de ticket, classificação de e-mail',
              'Dezenas de segundos',
              'Espera as interativas escoarem',
            ],
            [
              'Lote',
              'Reprocessar histórico, indexação noturna',
              'Minutos ou horas',
              'Só roda com cota sobrando',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A prioridade estrita tem um risco conhecido: a fome (starvation). Se a classe interativa nunca esvazia, o lote nunca roda. A defesa é o envelhecimento: uma chamada que espera além de um teto sobe de classe, garantindo que ela eventualmente saia. O código abaixo implementa a fila com essa promoção.',
        },
        {
          type: 'code',
          value: `// src/priority-queue.js
// Fila por classes com envelhecimento: um item que espera demais
// sobe de prioridade, para que lote nunca morra de fome.

const CLASSES = ['interactive', 'async', 'batch'];
const AGING_MS = { async: 30_000, batch: 120_000 };

export class PriorityQueue {
  constructor() {
    this.queues = new Map(CLASSES.map((name) => [name, []]));
  }

  push(item, priority = 'async') {
    const queue = this.queues.get(priority) || this.queues.get('async');
    queue.push({ ...item, priority, enqueuedAt: Date.now() });
  }

  // Promove itens que esperaram alem do teto da sua classe.
  applyAging() {
    const now = Date.now();
    for (const [name, threshold] of Object.entries(AGING_MS)) {
      const queue = this.queues.get(name);
      const higher = CLASSES[CLASSES.indexOf(name) - 1];
      // Percorre do mais antigo para o mais novo e para no primeiro
      // que ainda nao venceu: a fila esta ordenada por chegada.
      while (queue.length && now - queue[0].enqueuedAt >= threshold) {
        this.queues.get(higher).push(queue.shift());
      }
    }
  }

  // Serve a classe mais alta que tiver item.
  shift() {
    this.applyAging();
    for (const name of CLASSES) {
      const queue = this.queues.get(name);
      if (queue.length) return queue.shift();
    }
    return null;
  }

  get size() {
    return CLASSES.reduce((total, n) => total + this.queues.get(n).length, 0);
  }

  depthByClass() {
    return Object.fromEntries(
      CLASSES.map((n) => [n, this.queues.get(n).length]),
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O envelhecimento é o que torna a prioridade estrita segura de usar. Sem ele, um sistema com carga interativa constante deixa o lote parado para sempre, e o time descobre isso quando o relatório de segunda não existe. Com ele, o pior caso de um item de lote é esperar o teto configurado antes de subir para a classe assíncrona, o que dá um limite superior de espera que se pode prometer.',
        },
      ],
    },
    {
      title: 'Retry com backoff, jitter e Retry-After',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com o token bucket calibrado, o 429 vai acontecer. A cota é do provedor e é compartilhada por todas as instâncias do seu serviço, então o balde local de cada processo não conhece o consumo dos outros; e o provedor pode ajustar a cota sem avisar. O retry, então, existe como rede de segurança para o erro que escapa, não como estratégia de vazão.',
        },
        {
          type: 'paragraph',
          value:
            'Três regras tornam o retry correto. A primeira: se a resposta trouxer o cabeçalho Retry-After, obedeça, porque é o provedor dizendo exatamente quanto esperar, e nenhuma heurística sua vai adivinhar melhor. A segunda: sem Retry-After, use backoff exponencial, dobrando a espera a cada tentativa, com um teto para não esperar minutos. A terceira, e a mais esquecida: aplique jitter, um componente aleatório na espera, porque sem ele todas as chamadas que falharam juntas voltam juntas e a manada se reconstitui.',
        },
        {
          type: 'paragraph',
          value:
            'Igualmente importante é saber o que não retentar. Um 429 e um 503 são transitórios e merecem nova tentativa; um 400 de prompt malformado e um 401 de credencial errada vão falhar de novo, exatamente igual, quantas vezes você tentar. Retentar erro permanente é queimar cota para reproduzir o mesmo erro.',
        },
        {
          type: 'code',
          value: `// src/retry.js
// Backoff exponencial com jitter completo, respeitando Retry-After.
// So retenta erro transitorio: 429 e 5xx. Erro de cliente falha na hora.

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 20_000;

const isRetryable = (status) => status === 429 || (status >= 500 && status < 600);

// Jitter completo: sorteia em [0, teto]. Espalha a manada melhor
// que somar um ruido pequeno a um valor fixo.
const backoffWithJitter = (attempt, random) => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
};

const parseRetryAfter = (header) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

export async function callWithRetry(doCall, { sleep, random = Math.random } = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await doCall();
    if (response.ok) return response;

    if (!isRetryable(response.status)) {
      // Erro permanente: retentar so reproduz a mesma falha.
      throw new Error(\`Falha permanente: HTTP \${response.status}\`);
    }

    lastError = new Error(\`HTTP \${response.status}\`);
    const serverHint = parseRetryAfter(response.headers.get('retry-after'));
    const delay = serverHint ?? backoffWithJitter(attempt, random);
    await sleep(delay);
  }
  throw lastError;
}`,
        },
        {
          type: 'paragraph',
          value:
            'O jitter completo, que sorteia a espera no intervalo inteiro de zero até o teto exponencial, espalha melhor do que somar um pequeno ruído a um valor fixo: com o ruído pequeno, as tentativas ainda se agrupam em torno do valor central e a manada sobrevive, só que mais discreta. E repare que o Retry-After tem precedência sobre o cálculo local: quando o provedor diz quanto esperar, essa informação vale mais que qualquer fórmula.',
        },
      ],
    },
    {
      title: 'Juntar as peças: o cliente com vazão controlada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As três peças se compõem numa ordem específica. A fila decide quem é o próximo; o token bucket decide quando esse próximo pode sair; o retry cuida do erro que escapou apesar dos dois. O laço que orquestra isso é um despachante único, e é ele que deve ter o limite de concorrência, porque respeitar a taxa não basta se cem chamadas ficarem abertas ao mesmo tempo esperando resposta.',
        },
        {
          type: 'code',
          value: `// src/dispatcher.js
// Une fila, balde e retry. A chamada so sai quando ha vaga de
// concorrencia e os dois baldes autorizam.

import { TokenBucket } from './token-bucket.js';
import { PriorityQueue } from './priority-queue.js';
import { callWithRetry } from './retry.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Dispatcher {
  constructor({ requestsPerMinute, tokensPerMinute, maxConcurrent }) {
    this.requests = new TokenBucket({
      capacity: Math.ceil(requestsPerMinute / 6),
      refillPerSecond: requestsPerMinute / 60,
    });
    this.tokens = new TokenBucket({
      capacity: tokensPerMinute,
      refillPerSecond: tokensPerMinute / 60,
    });
    this.queue = new PriorityQueue();
    this.maxConcurrent = maxConcurrent;
    this.inFlight = 0;
    this.running = false;
  }

  submit(call, { priority = 'async', estimatedTokens }) {
    return new Promise((resolve, reject) => {
      this.queue.push({ call, estimatedTokens, resolve, reject }, priority);
      this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.size > 0) {
      if (this.inFlight >= this.maxConcurrent) break;

      const next = this.queue.shift();
      if (!next) break;

      const cost = next.estimatedTokens;
      if (!this.requests.tryRemove(1) || !this.tokens.tryRemove(cost)) {
        // Sem cota agora: devolve a fila e espera o balde encher.
        this.queue.push(next, next.priority);
        await sleep(Math.max(
          this.requests.waitTimeMs(1),
          this.tokens.waitTimeMs(cost),
        ));
        continue;
      }

      this.inFlight += 1;
      callWithRetry(next.call, { sleep })
        .then((response) => {
          // Reconcilia: estimativa maior que o uso real devolve cota.
          const used = response.usage?.totalTokens ?? cost;
          if (used < cost) this.tokens.giveBack(cost - used);
          next.resolve(response);
        })
        .catch(next.reject)
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
    this.running = false;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto mais fácil de errar aqui é o item que não conseguiu cota. Ele volta para a fila e o laço espera o balde encher, em vez de descartar a chamada ou girar em laço apertado consumindo CPU. E o limite de concorrência é uma dimensão independente da taxa: dez chamadas por segundo com respostas de trinta segundos significam trezentas chamadas abertas ao mesmo tempo, o que estoura memória e conexões muito antes de estourar a cota. Taxa e concorrência precisam de tetos separados.',
        },
      ],
    },
    {
      title: 'Métricas: saber se a cota está apertada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um controlador de vazão sem métrica é um lugar onde a latência vai se esconder. Do lado de fora, uma chamada que espera quarenta segundos na fila e uma que espera quarenta segundos no modelo parecem a mesma coisa, e sem separar as duas o time otimiza o modelo quando o problema é cota, ou compra cota quando o problema é o prompt. Meça o tempo de fila separado do tempo de chamada, sempre.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que revela', 'Sinal de alerta'],
          rows: [
            [
              'Tempo de espera na fila (p95, por classe)',
              'Quanto a cota está atrasando cada classe',
              'Interativa acima de poucos segundos',
            ],
            [
              'Profundidade da fila por classe',
              'Se a demanda excede a cota de forma sustentada',
              'Cresce sem voltar ao normal',
            ],
            [
              'Taxa de 429 recebidos',
              'Se o balde local está mal calibrado',
              'Qualquer valor não desprezível',
            ],
            [
              'Utilização do balde de tokens',
              'Quanto da cota comprada é de fato usada',
              'Alta com fila cheia: cota é o gargalo',
            ],
            [
              'Promoções por envelhecimento',
              'Se o lote está morrendo de fome',
              'Todo item de lote sendo promovido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura conjunta dessas métricas é o que responde à pergunta cara: comprar mais cota ou consertar o código. Fila funda com utilização do balde de tokens perto do teto significa demanda maior que a cota, e aí é decisão comercial. Fila funda com utilização baixa significa que o gargalo é outro, quase sempre o limite de concorrência ou uma chamada lenta segurando vaga. E 429 acontecendo com o balde local dentro do limite significa que a cota está sendo dividida com outra instância ou outro serviço, e o balde precisa ser compartilhado num Redis em vez de viver na memória de cada processo.',
        },
      ],
    },
    {
      title: 'Colocar em produção sem surpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sequência abaixo é a ordem em que essas peças devem entrar, cada passo entregando valor antes do seguinte.',
        },
        {
          type: 'ordered',
          items: [
            'Descubra a cota real do seu plano em ambas as dimensões, requisições por minuto e tokens por minuto, e não confie na memória de ninguém: leia a documentação do provedor e confirme com uma medição.',
            'Calibre o balde para uma folga abaixo do teto nominal, algo como 80 por cento, porque a contabilidade do provedor e a sua nunca coincidem exatamente e a folga é o que evita o 429 de borda.',
            'Classifique cada ponto de chamada do código em interativa, assíncrona ou lote. Se todo mundo se declarar interativo, a prioridade não existe: essa conversa é de arquitetura, não de código.',
            'Ponha o despachante único no caminho de todas as chamadas ao provedor. Um caminho paralelo que escapa do controlador destrói a garantia, porque consome cota que o balde acha que ainda tem.',
            'Instrumente tempo de fila separado do tempo de chamada antes de calibrar qualquer coisa, senão você vai otimizar no escuro.',
            'Se rodar mais de uma instância, mova o balde para um contador compartilhado (Redis com script atômico), porque quatro processos com balde local consomem quatro vezes a cota.',
            'Só então ajuste concorrência e tetos de envelhecimento, com a métrica na tela, mudando um parâmetro por vez.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O passo que mais gera retrabalho quando pulado é o do balde compartilhado. É comum o controlador funcionar perfeitamente em desenvolvimento, com um processo só, e desmoronar em produção com quatro réplicas, porque cada uma acredita ter a cota inteira. O sintoma é característico: 429 constante enquanto o painel de cada instância jura estar dentro do limite.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Token bucket ou leaky bucket para API de LLM?',
      answer:
        'Token bucket, porque ele permite rajada até a capacidade do balde e é assim que os provedores de LLM medem a cota: uma taxa média com tolerância a picos curtos. O leaky bucket suaviza a saída para uma taxa constante, o que desperdiça a rajada que você tem direito de mandar e piora a latência da primeira chamada depois de um período ocioso. Use a capacidade do balde para definir o tamanho da rajada aceitável e a taxa de reabastecimento para o regime sustentado.',
    },
    {
      question: 'Preciso de fila de prioridade mesmo com pouco tráfego?',
      answer:
        'Não no dia normal, mas a fila existe para o dia ruim. Com tráfego bem abaixo da cota, todas as chamadas saem na hora e a fila fica vazia, sem custo nenhum. O valor aparece no pico, na campanha, no reprocessamento que alguém disparou sem avisar: é quando a diferença entre o usuário esperar dois segundos ou dois minutos é decidida pela existência da classificação. Classificar as chamadas custa pouco e é muito mais difícil de fazer depois, com o incidente em andamento.',
    },
    {
      question: 'Como controlar a cota com várias instâncias do serviço?',
      answer:
        'Um balde em memória só conhece o consumo do próprio processo, então quatro réplicas com balde local consomem até quatro vezes a cota e o 429 volta. A saída é mover a contagem para um contador compartilhado, tipicamente Redis com um script Lua que faz o refill e o débito de forma atômica, para que não haja corrida entre as réplicas. Alternativa mais simples, quando a precisão pode ser aproximada: dividir a cota estaticamente pelo número de réplicas, aceitando o desperdício de uma réplica ociosa com cota reservada.',
    },
  ],
  conclusion: {
    title: 'Rate limit é um recurso a administrar, não um erro a retentar',
    description:
      'O 429 não é uma falha esporádica: é o provedor cobrando disciplina de vazão. Um token bucket calibrado nas duas dimensões evita quase todo erro antes dele acontecer, a fila com classes de prioridade e envelhecimento decide quem espera quando a cota aperta, e o retry com backoff, jitter e Retry-After cuida do que escapa. Junte isso a métricas que separam tempo de fila de tempo de modelo e o pico deixa de ser incidente para virar espera previsível.',
    cta: 'Falar sobre controle de vazão na minha integração com LLM',
  },
  related: [
    { label: 'Streaming de resposta de LLM sem quebrar a UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Roteamento de modelos: modelo certo para cada tarefa', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Fila e picos em campanha de WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
  ],
  repo: { name: 'llm-rate-limit-queue', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Every LLM API has a ceiling, and it is almost never the one you imagine. The provider does not sell unlimited calls: it sells a per-minute quota, measured in requests and in tokens, and when your traffic touches that ceiling the API starts returning 429. The first reflex of nearly every team is to try again, immediately, on every call that failed at the same time. It is the worst possible move: the simultaneous attempts hit the limit again, generate more 429s, trigger more retries, and the system enters a retry storm that burns the whole quota on errors and does not deliver a single answer. The conceptual mistake is treating the rate limit as an occasional failure when it is a scarce resource to be managed. A demand spike should not become a shower of errors: it should become a queue. And if there is to be a queue, it cannot be blind, because not every call is worth the same: the user waiting for an answer on screen cannot sit behind ten thousand rows of a nightly report. This article shows how to turn the provider ceiling into controlled throughput: the token bucket that holds the rate before the error happens, the queue with priority classes that decides who goes first, the retry with backoff and jitter that honors Retry-After, and the metrics that tell you whether the quota is tight or the problem is elsewhere.',
  sections: [
    {
      title: 'Why naive retry makes the problem worse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When a call comes back with 429, the meaning is literal: the provider is telling you that you exceeded the quota and need to slow down. Repeating the call the next instant is answering a request to slow down by speeding up. And the problem is not one repeated call: it is that every call that failed in the same second tends to repeat in the same second, because they failed together. That is the thundering herd, and it converts a traffic spike into an oscillation that sustains itself, with the entire quota being spent on rejected requests.',
        },
        {
          type: 'paragraph',
          value:
            'It is also worth understanding that an LLM API quota is rarely a single dimension. There is usually a requests-per-minute limit and another, independent one, of tokens per minute, and the second is what bites first under long-context loads: ten calls with a giant prompt blow through the token quota long before touching the request one. Controlling only the call count gives the illusion of being within the limit while real token consumption has already passed it.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'What happens in the spike', 'Effect on the quota', 'Result for the user'],
          rows: [
            [
              'Immediate retry',
              'All failures repeat together',
              'Consumed by rejected requests',
              'Error after a long wait',
            ],
            [
              'Retry with fixed backoff',
              'Herd comes back as a block, just later',
              'Synchronized rejection spikes',
              'Irregular, unpredictable latency',
            ],
            [
              'Exponential backoff with jitter',
              'Attempts spread out over time',
              'Rejections drop, but errors remain',
              'Works, without order control',
            ],
            [
              'Token bucket with queue and priority',
              'Excess waits in an ordered queue',
              'Used almost fully on accepted calls',
              'Predictable wait, critical goes first',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The difference between the last two rows is the thesis of this article. Backoff with jitter is reactive: it waits for the error to happen and only then behaves well. The token bucket with a queue is preventive: it never lets a call leave if it would blow the quota, so the 429 barely happens, and when it does (because another instance also consumes the same quota) the backoff is the safety net, not the main strategy.',
        },
      ],
    },
    {
      title: 'Token bucket: hold the rate before the error',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The token bucket is the right algorithm for this task because it models exactly what the provider sells: an average rate with burst tolerance. The bucket has a maximum capacity and is refilled continuously at a fixed rate. Each call must remove tokens from the bucket to leave; if there are not enough tokens, it waits until there are. Capacity defines the size of the burst you accept sending at once, and the refill rate defines the sustained regime. It beats a fixed counting window, which suffers from the boundary problem: two bursts at the edges of neighboring windows pass the count but concentrate double the traffic in the middle.',
        },
        {
          type: 'paragraph',
          value:
            'The subtlety for LLM is that you need two buckets, one for requests and one for tokens, and the call only leaves when both authorize it. The token bucket is debited by an estimate of the call cost before it leaves, and reconciled with real consumption when the response arrives, because only then do you know how many output tokens the model generated.',
        },
        {
          type: 'diagram',
          value: `  continuous refill (rate/s)
            |
            v
   +--------------------+
   |   request bucket     |  capacity = accepted burst
   +--------------------+
            |  needs 1 token
            v
   +--------------------+
   |    token bucket      |  capacity = plan tokens/min
   +--------------------+
            |  needs estimated_cost
            v
      both authorize? --no--> waits in the queue
            |
           yes
            v
       call leaves to the API
            |
            v
   response brings real usage -> reconciles the token bucket`,
        },
        {
          type: 'code',
          value: `// src/token-bucket.js
// Token bucket with continuous refill.
// No setInterval: it computes the level on demand from elapsed time,
// which avoids drift and does not hold the event loop.

export class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.level = capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.level = Math.min(
      this.capacity,
      this.level + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefill = now;
  }

  // Tries to remove 'amount' tokens. Returns true on success.
  tryRemove(amount) {
    this.refill();
    if (this.level < amount) return false;
    this.level -= amount;
    return true;
  }

  // How many ms until 'amount' tokens are available.
  waitTimeMs(amount) {
    this.refill();
    if (this.level >= amount) return 0;
    const missing = amount - this.level;
    return Math.ceil((missing / this.refillPerSecond) * 1000);
  }

  // Returns tokens to the bucket when the estimate exceeded real usage.
  giveBack(amount) {
    this.refill();
    this.level = Math.min(this.capacity, this.level + Math.max(0, amount));
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two implementation details are worth the comment. The refill is computed on demand, from the time elapsed since the last check, instead of a setInterval that adds tokens periodically: besides not holding the event loop with an eternal timer, this eliminates the accumulated drift that an imprecise interval would introduce over hours. And giveBack exists because the cost estimate is made before the call, when the output size is still unknown; when the response arrives with real usage and it was smaller than estimated, the difference goes back to the bucket, otherwise the real quota sits idle because of a pessimistic estimate.',
        },
      ],
    },
    {
      title: 'The priority queue: not every call is worth the same',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When demand exceeds the quota, someone will wait. The question is who. A FIFO queue answers "whoever arrived later", which is the wrong answer, because it completely ignores the business cost of waiting. A user staring at the screen waiting for the chat to answer has a tolerance of seconds; a batch report running at dawn tolerates minutes without anyone noticing. If both enter the same queue by arrival order, the ten-thousand-row batch that started at three in the morning will make the user at 3:01 wait for the entire batch.',
        },
        {
          type: 'paragraph',
          value:
            'The solution is to classify each call by priority at the source and serve the queue by class. Three classes cover almost every real case, and the discipline is simple: only serve the lowest class when the higher ones are empty.',
        },
        {
          type: 'table',
          columns: ['Class', 'Typical example', 'Wait tolerance', 'What to do under pressure'],
          rows: [
            [
              'Interactive',
              'Chat with the user on screen, autocomplete',
              'Seconds',
              'Goes first, always',
            ],
            [
              'Asynchronous',
              'Ticket summary, e-mail classification',
              'Tens of seconds',
              'Waits for interactive to drain',
            ],
            [
              'Batch',
              'Reprocessing history, nightly indexing',
              'Minutes or hours',
              'Only runs with spare quota',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Strict priority has a known risk: starvation. If the interactive class never empties, batch never runs. The defense is aging: a call that waits beyond a threshold moves up a class, ensuring it eventually leaves. The code below implements the queue with that promotion.',
        },
        {
          type: 'code',
          value: `// src/priority-queue.js
// Class-based queue with aging: an item that waits too long moves
// up in priority, so batch never starves.

const CLASSES = ['interactive', 'async', 'batch'];
const AGING_MS = { async: 30_000, batch: 120_000 };

export class PriorityQueue {
  constructor() {
    this.queues = new Map(CLASSES.map((name) => [name, []]));
  }

  push(item, priority = 'async') {
    const queue = this.queues.get(priority) || this.queues.get('async');
    queue.push({ ...item, priority, enqueuedAt: Date.now() });
  }

  // Promotes items that waited beyond their class threshold.
  applyAging() {
    const now = Date.now();
    for (const [name, threshold] of Object.entries(AGING_MS)) {
      const queue = this.queues.get(name);
      const higher = CLASSES[CLASSES.indexOf(name) - 1];
      // Walks from oldest to newest and stops at the first that has
      // not expired: the queue is ordered by arrival.
      while (queue.length && now - queue[0].enqueuedAt >= threshold) {
        this.queues.get(higher).push(queue.shift());
      }
    }
  }

  // Serves the highest class that has an item.
  shift() {
    this.applyAging();
    for (const name of CLASSES) {
      const queue = this.queues.get(name);
      if (queue.length) return queue.shift();
    }
    return null;
  }

  get size() {
    return CLASSES.reduce((total, n) => total + this.queues.get(n).length, 0);
  }

  depthByClass() {
    return Object.fromEntries(
      CLASSES.map((n) => [n, this.queues.get(n).length]),
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Aging is what makes strict priority safe to use. Without it, a system with constant interactive load leaves batch stalled forever, and the team finds out when Monday report does not exist. With it, the worst case for a batch item is waiting the configured threshold before moving up to the asynchronous class, which gives an upper bound on waiting that you can promise.',
        },
      ],
    },
    {
      title: 'Retry with backoff, jitter and Retry-After',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with a calibrated token bucket, the 429 will happen. The quota belongs to the provider and is shared by every instance of your service, so each process local bucket does not know the others consumption; and the provider can adjust the quota without warning. Retry, then, exists as a safety net for the error that escapes, not as a throughput strategy.',
        },
        {
          type: 'paragraph',
          value:
            'Three rules make retry correct. First: if the response carries the Retry-After header, obey it, because it is the provider saying exactly how long to wait, and no heuristic of yours will guess better. Second: without Retry-After, use exponential backoff, doubling the wait each attempt, with a cap so you do not wait minutes. Third, and the most forgotten: apply jitter, a random component in the wait, because without it every call that failed together comes back together and the herd re-forms.',
        },
        {
          type: 'paragraph',
          value:
            'Equally important is knowing what not to retry. A 429 and a 503 are transient and deserve another attempt; a 400 from a malformed prompt and a 401 from a wrong credential will fail again, exactly the same, however many times you try. Retrying a permanent error is burning quota to reproduce the same error.',
        },
        {
          type: 'code',
          value: `// src/retry.js
// Exponential backoff with full jitter, honoring Retry-After.
// Only retries transient errors: 429 and 5xx. Client errors fail fast.

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 20_000;

const isRetryable = (status) => status === 429 || (status >= 500 && status < 600);

// Full jitter: draws in [0, ceiling]. Spreads the herd better than
// adding small noise to a fixed value.
const backoffWithJitter = (attempt, random) => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
};

const parseRetryAfter = (header) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

export async function callWithRetry(doCall, { sleep, random = Math.random } = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await doCall();
    if (response.ok) return response;

    if (!isRetryable(response.status)) {
      // Permanent error: retrying only reproduces the same failure.
      throw new Error(\`Permanent failure: HTTP \${response.status}\`);
    }

    lastError = new Error(\`HTTP \${response.status}\`);
    const serverHint = parseRetryAfter(response.headers.get('retry-after'));
    const delay = serverHint ?? backoffWithJitter(attempt, random);
    await sleep(delay);
  }
  throw lastError;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Full jitter, which draws the wait across the entire range from zero to the exponential ceiling, spreads better than adding small noise to a fixed value: with small noise, attempts still cluster around the central value and the herd survives, just more discreetly. And note that Retry-After takes precedence over the local computation: when the provider says how long to wait, that information is worth more than any formula.',
        },
      ],
    },
    {
      title: 'Putting the pieces together: the throughput-controlled client',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The three pieces compose in a specific order. The queue decides who is next; the token bucket decides when that next one can leave; the retry handles the error that escaped despite both. The loop orchestrating this is a single dispatcher, and it is the one that must hold the concurrency limit, because respecting the rate is not enough if a hundred calls stay open at the same time waiting for a response.',
        },
        {
          type: 'code',
          value: `// src/dispatcher.js
// Joins queue, bucket and retry. The call only leaves when there is a
// concurrency slot and both buckets authorize it.

import { TokenBucket } from './token-bucket.js';
import { PriorityQueue } from './priority-queue.js';
import { callWithRetry } from './retry.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Dispatcher {
  constructor({ requestsPerMinute, tokensPerMinute, maxConcurrent }) {
    this.requests = new TokenBucket({
      capacity: Math.ceil(requestsPerMinute / 6),
      refillPerSecond: requestsPerMinute / 60,
    });
    this.tokens = new TokenBucket({
      capacity: tokensPerMinute,
      refillPerSecond: tokensPerMinute / 60,
    });
    this.queue = new PriorityQueue();
    this.maxConcurrent = maxConcurrent;
    this.inFlight = 0;
    this.running = false;
  }

  submit(call, { priority = 'async', estimatedTokens }) {
    return new Promise((resolve, reject) => {
      this.queue.push({ call, estimatedTokens, resolve, reject }, priority);
      this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.size > 0) {
      if (this.inFlight >= this.maxConcurrent) break;

      const next = this.queue.shift();
      if (!next) break;

      const cost = next.estimatedTokens;
      if (!this.requests.tryRemove(1) || !this.tokens.tryRemove(cost)) {
        // No quota now: puts it back and waits for the bucket to fill.
        this.queue.push(next, next.priority);
        await sleep(Math.max(
          this.requests.waitTimeMs(1),
          this.tokens.waitTimeMs(cost),
        ));
        continue;
      }

      this.inFlight += 1;
      callWithRetry(next.call, { sleep })
        .then((response) => {
          // Reconciles: an estimate above real usage returns quota.
          const used = response.usage?.totalTokens ?? cost;
          if (used < cost) this.tokens.giveBack(cost - used);
          next.resolve(response);
        })
        .catch(next.reject)
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
    this.running = false;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The easiest thing to get wrong here is the item that could not get quota. It goes back to the queue and the loop waits for the bucket to fill, instead of dropping the call or spinning in a tight loop burning CPU. And the concurrency limit is a dimension independent of the rate: ten calls per second with thirty-second responses means three hundred calls open at the same time, which blows memory and connections long before blowing the quota. Rate and concurrency need separate ceilings.',
        },
      ],
    },
    {
      title: 'Metrics: knowing whether the quota is tight',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A throughput controller without metrics is a place where latency goes to hide. From the outside, a call that waits forty seconds in the queue and one that waits forty seconds in the model look the same, and without separating the two the team optimizes the model when the problem is quota, or buys quota when the problem is the prompt. Measure queue time separately from call time, always.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it reveals', 'Warning sign'],
          rows: [
            [
              'Queue wait time (p95, per class)',
              'How much the quota is delaying each class',
              'Interactive above a few seconds',
            ],
            [
              'Queue depth per class',
              'Whether demand exceeds the quota persistently',
              'Grows without returning to normal',
            ],
            [
              'Rate of 429s received',
              'Whether the local bucket is badly calibrated',
              'Any non-negligible value',
            ],
            [
              'Token bucket utilization',
              'How much of the purchased quota is actually used',
              'High with a full queue: quota is the bottleneck',
            ],
            [
              'Promotions by aging',
              'Whether batch is starving',
              'Every batch item being promoted',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Reading these metrics together is what answers the expensive question: buy more quota or fix the code. A deep queue with token bucket utilization near the ceiling means demand greater than quota, and that is a commercial decision. A deep queue with low utilization means the bottleneck is elsewhere, almost always the concurrency limit or a slow call holding a slot. And 429s happening with the local bucket within the limit means the quota is being shared with another instance or another service, and the bucket needs to be shared in a Redis instead of living in each process memory.',
        },
      ],
    },
    {
      title: 'Going to production without surprises',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The sequence below is the order in which these pieces should land, each step delivering value before the next.',
        },
        {
          type: 'ordered',
          items: [
            'Find the real quota of your plan in both dimensions, requests per minute and tokens per minute, and do not trust anyone memory: read the provider documentation and confirm with a measurement.',
            'Calibrate the bucket to some slack below the nominal ceiling, something like 80 percent, because the provider accounting and yours never match exactly and the slack is what avoids the boundary 429.',
            'Classify every call site in the code as interactive, asynchronous or batch. If everyone declares themselves interactive, priority does not exist: that conversation is architecture, not code.',
            'Put the single dispatcher on the path of every call to the provider. A parallel path that escapes the controller destroys the guarantee, because it consumes quota the bucket thinks it still has.',
            'Instrument queue time separately from call time before calibrating anything, otherwise you will be optimizing in the dark.',
            'If you run more than one instance, move the bucket to a shared counter (Redis with an atomic script), because four processes with local buckets consume four times the quota.',
            'Only then tune concurrency and aging thresholds, with the metrics on screen, changing one parameter at a time.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The step that generates the most rework when skipped is the shared bucket. It is common for the controller to work perfectly in development, with a single process, and collapse in production with four replicas, because each believes it owns the whole quota. The symptom is characteristic: constant 429s while each instance dashboard swears it is within the limit.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Token bucket or leaky bucket for an LLM API?',
      answer:
        'Token bucket, because it allows bursts up to the bucket capacity and that is how LLM providers measure the quota: an average rate with tolerance for short peaks. The leaky bucket smooths the output to a constant rate, which wastes the burst you are entitled to send and worsens the latency of the first call after an idle period. Use the bucket capacity to define the acceptable burst size and the refill rate for the sustained regime.',
    },
    {
      question: 'Do I need a priority queue even with low traffic?',
      answer:
        'Not on a normal day, but the queue exists for the bad day. With traffic well below the quota, every call leaves immediately and the queue stays empty, at no cost at all. The value shows up in the spike, in the campaign, in the reprocessing someone triggered without warning: that is when the difference between the user waiting two seconds or two minutes is decided by the existence of the classification. Classifying calls costs little and is much harder to do later, with the incident under way.',
    },
    {
      question: 'How do I control the quota with several service instances?',
      answer:
        'An in-memory bucket only knows its own process consumption, so four replicas with local buckets consume up to four times the quota and the 429 returns. The way out is to move the counting to a shared counter, typically Redis with a Lua script that does the refill and the debit atomically, so there is no race between replicas. A simpler alternative, when precision can be approximate: split the quota statically by the number of replicas, accepting the waste of an idle replica holding reserved quota.',
    },
  ],
  conclusion: {
    title: 'Rate limit is a resource to manage, not an error to retry',
    description:
      'The 429 is not an occasional failure: it is the provider demanding throughput discipline. A token bucket calibrated on both dimensions avoids almost every error before it happens, the queue with priority classes and aging decides who waits when the quota tightens, and the retry with backoff, jitter and Retry-After handles what escapes. Add metrics that separate queue time from model time and the spike stops being an incident and becomes predictable waiting.',
    cta: 'Talk about throughput control in my LLM integration',
  },
  related: [
    { label: 'LLM response streaming without breaking the UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Model routing: the right model for each task', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Queue and spikes in WhatsApp campaigns', to: '/blog/fila-picos-campanha-whatsapp' },
  ],
  repo: { name: 'llm-rate-limit-queue', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Toda API de LLM tiene un techo, y casi nunca es el que imaginas. El proveedor no vende llamadas ilimitadas: vende una cuota por minuto, medida en peticiones y en tokens, y cuando tu tráfico roza ese techo la API empieza a devolver 429. El primer reflejo de casi todo equipo es intentar de nuevo, de inmediato, en todas las llamadas que fallaron al mismo tiempo. Es el peor movimiento posible: los intentos simultáneos golpean el límite otra vez, generan más 429, disparan más reintentos, y el sistema entra en una tormenta de retry que consume la cuota entera en errores y no entrega ni una sola respuesta. El error conceptual es tratar el rate limit como una falla esporádica cuando es un recurso escaso que hay que administrar. Un pico de demanda no debería volverse una lluvia de errores: debería volverse una cola. Y si va a haber cola, no puede ser ciega, porque no toda llamada vale lo mismo: el usuario esperando una respuesta en la pantalla no puede quedar detrás de diez mil filas de un reporte nocturno. Este artículo muestra cómo transformar el techo del proveedor en caudal controlado: el token bucket que sostiene la tasa antes de que ocurra el error, la cola con clases de prioridad que decide quién pasa primero, el retry con backoff y jitter que respeta el Retry-After, y las métricas que dicen si la cuota está apretada o si el problema es otro.',
  sections: [
    {
      title: 'Por qué el retry ingenuo empeora el problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando una llamada vuelve con 429, el significado es literal: el proveedor está diciendo que excediste la cuota y necesitas desacelerar. Repetir la llamada al instante siguiente es responder al pedido de desaceleración acelerando. Y el problema no es una llamada repetida: es que todas las llamadas que fallaron en el mismo segundo tienden a repetir en el mismo segundo, porque fallaron juntas. Ese es el efecto manada, y convierte un pico de tráfico en una oscilación que se sostiene sola, con la cuota entera gastada en peticiones rechazadas.',
        },
        {
          type: 'paragraph',
          value:
            'Vale entender también que la cuota de una API de LLM raramente es una sola dimensión. Suele haber un límite de peticiones por minuto y otro, independiente, de tokens por minuto, y el segundo es el que muerde primero en cargas de contexto largo: diez llamadas con un prompt gigante revientan la cuota de tokens mucho antes de rozar la de peticiones. Controlar solo el conteo de llamadas da la ilusión de estar dentro del límite mientras el consumo real de tokens ya lo pasó.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Qué pasa en el pico', 'Efecto en la cuota', 'Resultado para el usuario'],
          rows: [
            [
              'Retry inmediato',
              'Todas las fallas repiten juntas',
              'Consumida por peticiones rechazadas',
              'Error después de una espera larga',
            ],
            [
              'Retry con backoff fijo',
              'La manada vuelve en bloque, solo que más tarde',
              'Picos sincronizados de rechazo',
              'Latencia irregular e impredecible',
            ],
            [
              'Backoff exponencial con jitter',
              'Los intentos se esparcen en el tiempo',
              'Los rechazos bajan, pero aún hay error',
              'Funciona, sin control de orden',
            ],
            [
              'Token bucket con cola y prioridad',
              'El excedente espera en cola ordenada',
              'Usada casi toda en llamadas aceptadas',
              'Espera previsible, lo crítico pasa antes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre las dos últimas filas es la tesis de este artículo. El backoff con jitter es reactivo: espera a que el error ocurra para entonces comportarse bien. El token bucket con cola es preventivo: nunca deja salir una llamada si va a reventar la cuota, así que el 429 casi no ocurre, y cuando ocurre (porque otra instancia también consume la misma cuota) el backoff es la red de seguridad, no la estrategia principal.',
        },
      ],
    },
    {
      title: 'Token bucket: sostener la tasa antes del error',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El token bucket es el algoritmo correcto para esta tarea porque modela exactamente lo que el proveedor vende: una tasa media con tolerancia a ráfaga. El balde tiene una capacidad máxima y se rellena continuamente a una tasa fija. Cada llamada necesita retirar tokens del balde para salir; si no hay tokens suficientes, espera hasta que los haya. La capacidad define el tamaño de la ráfaga que aceptas mandar de una vez, y la tasa de rellenado define el régimen sostenido. Es mejor que una ventana fija de conteo, que sufre el problema de borde: dos ráfagas en las puntas de ventanas vecinas pasan el conteo pero concentran el doble del tráfico en el medio.',
        },
        {
          type: 'paragraph',
          value:
            'La sutileza para LLM es que necesitas dos baldes, uno para peticiones y uno para tokens, y la llamada solo sale cuando ambos autorizan. El balde de tokens se debita por una estimación del costo de la llamada antes de que salga, y se reconcilia con el consumo real cuando llega la respuesta, porque solo ahí se sabe cuántos tokens de salida generó el modelo.',
        },
        {
          type: 'diagram',
          value: `  rellenado continuo (rate/s)
            |
            v
   +--------------------+
   |  balde de peticiones |  capacidad = rafaga aceptada
   +--------------------+
            |  necesita 1 token
            v
   +--------------------+
   |   balde de tokens    |  capacidad = tokens/min del plan
   +--------------------+
            |  necesita costo_estimado
            v
     los dos autorizan? --no--> espera en la cola
            |
            si
            v
      la llamada sale a la API
            |
            v
   la respuesta trae uso real -> reconcilia el balde de tokens`,
        },
        {
          type: 'code',
          value: `// src/token-bucket.js
// Balde de tokens con rellenado continuo.
// No usa setInterval: calcula el nivel bajo demanda a partir del tiempo
// transcurrido, lo que evita drift y no retiene el event loop.

export class TokenBucket {
  constructor({ capacity, refillPerSecond }) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.level = capacity;
    this.lastRefill = Date.now();
  }

  refill() {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.level = Math.min(
      this.capacity,
      this.level + elapsedSeconds * this.refillPerSecond,
    );
    this.lastRefill = now;
  }

  // Intenta retirar 'amount' tokens. Devuelve true si lo logro.
  tryRemove(amount) {
    this.refill();
    if (this.level < amount) return false;
    this.level -= amount;
    return true;
  }

  // Cuantos ms faltan hasta que haya 'amount' tokens disponibles.
  waitTimeMs(amount) {
    this.refill();
    if (this.level >= amount) return 0;
    const missing = amount - this.level;
    return Math.ceil((missing / this.refillPerSecond) * 1000);
  }

  // Devuelve tokens al balde cuando la estimacion supero el uso real.
  giveBack(amount) {
    this.refill();
    this.level = Math.min(this.capacity, this.level + Math.max(0, amount));
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de implementación merecen el comentario. El rellenado se calcula bajo demanda, a partir del tiempo transcurrido desde la última consulta, en vez de un setInterval que suma tokens periódicamente: además de no retener el event loop con un timer eterno, esto elimina el desvío acumulado que un intervalo impreciso introduciría a lo largo de horas. Y el giveBack existe porque la estimación de costo se hace antes de la llamada, cuando aún no se sabe el tamaño de la salida; cuando la respuesta llega con el uso real y fue menor que el estimado, la diferencia vuelve al balde, si no la cuota real queda ociosa por culpa de una estimación pesimista.',
        },
      ],
    },
    {
      title: 'La cola de prioridad: no toda llamada vale lo mismo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la demanda excede la cuota, alguien va a esperar. La pregunta es quién. Una cola FIFO responde "quien llegó después", que es la respuesta equivocada, porque ignora por completo el costo de negocio de la espera. Un usuario mirando la pantalla esperando que el chat responda tiene tolerancia de segundos; un reporte en lote que corre de madrugada tolera minutos sin que nadie lo note. Si ambos entran en la misma cola por orden de llegada, el lote de diez mil filas que entró a las tres de la mañana hará que el usuario de las tres y uno espere el lote entero.',
        },
        {
          type: 'paragraph',
          value:
            'La solución es clasificar cada llamada por prioridad en el origen y servir la cola por clase. Tres clases cubren casi todo caso real, y la disciplina es simple: solo sirve la clase más baja cuando las más altas estén vacías.',
        },
        {
          type: 'table',
          columns: ['Clase', 'Ejemplo típico', 'Tolerancia de espera', 'Qué hacer bajo presión'],
          rows: [
            [
              'Interactiva',
              'Chat con usuario en pantalla, autocomplete',
              'Segundos',
              'Pasa adelante, siempre',
            ],
            [
              'Asíncrona',
              'Resumen de ticket, clasificación de correo',
              'Decenas de segundos',
              'Espera que las interactivas se escurran',
            ],
            [
              'Lote',
              'Reprocesar histórico, indexación nocturna',
              'Minutos u horas',
              'Solo corre con cuota sobrante',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La prioridad estricta tiene un riesgo conocido: la inanición (starvation). Si la clase interactiva nunca se vacía, el lote nunca corre. La defensa es el envejecimiento: una llamada que espera más allá de un techo sube de clase, garantizando que eventualmente salga. El código de abajo implementa la cola con esa promoción.',
        },
        {
          type: 'code',
          value: `// src/priority-queue.js
// Cola por clases con envejecimiento: un item que espera demasiado
// sube de prioridad, para que el lote nunca muera de hambre.

const CLASSES = ['interactive', 'async', 'batch'];
const AGING_MS = { async: 30_000, batch: 120_000 };

export class PriorityQueue {
  constructor() {
    this.queues = new Map(CLASSES.map((name) => [name, []]));
  }

  push(item, priority = 'async') {
    const queue = this.queues.get(priority) || this.queues.get('async');
    queue.push({ ...item, priority, enqueuedAt: Date.now() });
  }

  // Promueve items que esperaron mas alla del techo de su clase.
  applyAging() {
    const now = Date.now();
    for (const [name, threshold] of Object.entries(AGING_MS)) {
      const queue = this.queues.get(name);
      const higher = CLASSES[CLASSES.indexOf(name) - 1];
      // Recorre del mas antiguo al mas nuevo y para en el primero que
      // aun no vencio: la cola esta ordenada por llegada.
      while (queue.length && now - queue[0].enqueuedAt >= threshold) {
        this.queues.get(higher).push(queue.shift());
      }
    }
  }

  // Sirve la clase mas alta que tenga item.
  shift() {
    this.applyAging();
    for (const name of CLASSES) {
      const queue = this.queues.get(name);
      if (queue.length) return queue.shift();
    }
    return null;
  }

  get size() {
    return CLASSES.reduce((total, n) => total + this.queues.get(n).length, 0);
  }

  depthByClass() {
    return Object.fromEntries(
      CLASSES.map((n) => [n, this.queues.get(n).length]),
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El envejecimiento es lo que vuelve segura de usar la prioridad estricta. Sin él, un sistema con carga interactiva constante deja el lote parado para siempre, y el equipo lo descubre cuando el reporte del lunes no existe. Con él, el peor caso de un item de lote es esperar el techo configurado antes de subir a la clase asíncrona, lo que da un límite superior de espera que se puede prometer.',
        },
      ],
    },
    {
      title: 'Retry con backoff, jitter y Retry-After',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con el token bucket calibrado, el 429 va a ocurrir. La cuota es del proveedor y está compartida por todas las instancias de tu servicio, así que el balde local de cada proceso no conoce el consumo de los otros; y el proveedor puede ajustar la cuota sin avisar. El retry, entonces, existe como red de seguridad para el error que se escapa, no como estrategia de caudal.',
        },
        {
          type: 'paragraph',
          value:
            'Tres reglas vuelven correcto el retry. La primera: si la respuesta trae el encabezado Retry-After, obedece, porque es el proveedor diciendo exactamente cuánto esperar, y ninguna heurística tuya va a adivinar mejor. La segunda: sin Retry-After, usa backoff exponencial, doblando la espera en cada intento, con un techo para no esperar minutos. La tercera, y la más olvidada: aplica jitter, un componente aleatorio en la espera, porque sin él todas las llamadas que fallaron juntas vuelven juntas y la manada se reconstituye.',
        },
        {
          type: 'paragraph',
          value:
            'Igual de importante es saber qué no reintentar. Un 429 y un 503 son transitorios y merecen otro intento; un 400 de prompt mal formado y un 401 de credencial equivocada van a fallar de nuevo, exactamente igual, cuantas veces intentes. Reintentar un error permanente es quemar cuota para reproducir el mismo error.',
        },
        {
          type: 'code',
          value: `// src/retry.js
// Backoff exponencial con jitter completo, respetando Retry-After.
// Solo reintenta error transitorio: 429 y 5xx. El error de cliente falla ya.

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 20_000;

const isRetryable = (status) => status === 429 || (status >= 500 && status < 600);

// Jitter completo: sortea en [0, techo]. Esparce la manada mejor
// que sumar un ruido pequeno a un valor fijo.
const backoffWithJitter = (attempt, random) => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
};

const parseRetryAfter = (header) => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
};

export async function callWithRetry(doCall, { sleep, random = Math.random } = {}) {
  let lastError;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await doCall();
    if (response.ok) return response;

    if (!isRetryable(response.status)) {
      // Error permanente: reintentar solo reproduce la misma falla.
      throw new Error(\`Falla permanente: HTTP \${response.status}\`);
    }

    lastError = new Error(\`HTTP \${response.status}\`);
    const serverHint = parseRetryAfter(response.headers.get('retry-after'));
    const delay = serverHint ?? backoffWithJitter(attempt, random);
    await sleep(delay);
  }
  throw lastError;
}`,
        },
        {
          type: 'paragraph',
          value:
            'El jitter completo, que sortea la espera en el intervalo entero de cero hasta el techo exponencial, esparce mejor que sumar un pequeño ruido a un valor fijo: con el ruido pequeño, los intentos aún se agrupan en torno al valor central y la manada sobrevive, solo que más discreta. Y nota que el Retry-After tiene precedencia sobre el cálculo local: cuando el proveedor dice cuánto esperar, esa información vale más que cualquier fórmula.',
        },
      ],
    },
    {
      title: 'Juntar las piezas: el cliente con caudal controlado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las tres piezas se componen en un orden específico. La cola decide quién es el próximo; el token bucket decide cuándo ese próximo puede salir; el retry se ocupa del error que se escapó a pesar de los dos. El lazo que orquesta esto es un despachante único, y es él quien debe tener el límite de concurrencia, porque respetar la tasa no basta si cien llamadas quedan abiertas al mismo tiempo esperando respuesta.',
        },
        {
          type: 'code',
          value: `// src/dispatcher.js
// Une cola, balde y retry. La llamada solo sale cuando hay lugar de
// concurrencia y los dos baldes autorizan.

import { TokenBucket } from './token-bucket.js';
import { PriorityQueue } from './priority-queue.js';
import { callWithRetry } from './retry.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Dispatcher {
  constructor({ requestsPerMinute, tokensPerMinute, maxConcurrent }) {
    this.requests = new TokenBucket({
      capacity: Math.ceil(requestsPerMinute / 6),
      refillPerSecond: requestsPerMinute / 60,
    });
    this.tokens = new TokenBucket({
      capacity: tokensPerMinute,
      refillPerSecond: tokensPerMinute / 60,
    });
    this.queue = new PriorityQueue();
    this.maxConcurrent = maxConcurrent;
    this.inFlight = 0;
    this.running = false;
  }

  submit(call, { priority = 'async', estimatedTokens }) {
    return new Promise((resolve, reject) => {
      this.queue.push({ call, estimatedTokens, resolve, reject }, priority);
      this.pump();
    });
  }

  async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.size > 0) {
      if (this.inFlight >= this.maxConcurrent) break;

      const next = this.queue.shift();
      if (!next) break;

      const cost = next.estimatedTokens;
      if (!this.requests.tryRemove(1) || !this.tokens.tryRemove(cost)) {
        // Sin cuota ahora: devuelve a la cola y espera que el balde llene.
        this.queue.push(next, next.priority);
        await sleep(Math.max(
          this.requests.waitTimeMs(1),
          this.tokens.waitTimeMs(cost),
        ));
        continue;
      }

      this.inFlight += 1;
      callWithRetry(next.call, { sleep })
        .then((response) => {
          // Reconcilia: estimacion mayor que el uso real devuelve cuota.
          const used = response.usage?.totalTokens ?? cost;
          if (used < cost) this.tokens.giveBack(cost - used);
          next.resolve(response);
        })
        .catch(next.reject)
        .finally(() => {
          this.inFlight -= 1;
          this.pump();
        });
    }
    this.running = false;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El punto más fácil de errar aquí es el item que no consiguió cuota. Vuelve a la cola y el lazo espera que el balde llene, en vez de descartar la llamada o girar en lazo apretado consumiendo CPU. Y el límite de concurrencia es una dimensión independiente de la tasa: diez llamadas por segundo con respuestas de treinta segundos significan trescientas llamadas abiertas al mismo tiempo, lo que revienta memoria y conexiones mucho antes de reventar la cuota. Tasa y concurrencia necesitan techos separados.',
        },
      ],
    },
    {
      title: 'Métricas: saber si la cuota está apretada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un controlador de caudal sin métrica es un lugar donde la latencia se va a esconder. Desde afuera, una llamada que espera cuarenta segundos en la cola y una que espera cuarenta segundos en el modelo parecen lo mismo, y sin separar las dos el equipo optimiza el modelo cuando el problema es cuota, o compra cuota cuando el problema es el prompt. Mide el tiempo de cola separado del tiempo de llamada, siempre.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué revela', 'Señal de alerta'],
          rows: [
            [
              'Tiempo de espera en la cola (p95, por clase)',
              'Cuánto la cuota está atrasando cada clase',
              'Interactiva arriba de pocos segundos',
            ],
            [
              'Profundidad de la cola por clase',
              'Si la demanda excede la cuota de forma sostenida',
              'Crece sin volver a lo normal',
            ],
            [
              'Tasa de 429 recibidos',
              'Si el balde local está mal calibrado',
              'Cualquier valor no despreciable',
            ],
            [
              'Utilización del balde de tokens',
              'Cuánto de la cuota comprada se usa de hecho',
              'Alta con cola llena: la cuota es el cuello de botella',
            ],
            [
              'Promociones por envejecimiento',
              'Si el lote está muriendo de hambre',
              'Todo item de lote siendo promovido',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura conjunta de esas métricas es lo que responde la pregunta cara: comprar más cuota o arreglar el código. Cola profunda con utilización del balde de tokens cerca del techo significa demanda mayor que la cuota, y ahí es decisión comercial. Cola profunda con utilización baja significa que el cuello de botella es otro, casi siempre el límite de concurrencia o una llamada lenta reteniendo lugar. Y 429 ocurriendo con el balde local dentro del límite significa que la cuota está siendo dividida con otra instancia u otro servicio, y el balde necesita ser compartido en un Redis en vez de vivir en la memoria de cada proceso.',
        },
      ],
    },
    {
      title: 'Poner en producción sin sorpresa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La secuencia de abajo es el orden en que estas piezas deben entrar, cada paso entregando valor antes del siguiente.',
        },
        {
          type: 'ordered',
          items: [
            'Descubre la cuota real de tu plan en ambas dimensiones, peticiones por minuto y tokens por minuto, y no confíes en la memoria de nadie: lee la documentación del proveedor y confirma con una medición.',
            'Calibra el balde para una holgura debajo del techo nominal, algo como 80 por ciento, porque la contabilidad del proveedor y la tuya nunca coinciden exactamente y la holgura es lo que evita el 429 de borde.',
            'Clasifica cada punto de llamada del código en interactiva, asíncrona o lote. Si todo el mundo se declara interactivo, la prioridad no existe: esa conversación es de arquitectura, no de código.',
            'Pon el despachante único en el camino de todas las llamadas al proveedor. Un camino paralelo que escapa del controlador destruye la garantía, porque consume cuota que el balde cree que aún tiene.',
            'Instrumenta el tiempo de cola separado del tiempo de llamada antes de calibrar cualquier cosa, si no vas a optimizar a ciegas.',
            'Si corres más de una instancia, mueve el balde a un contador compartido (Redis con script atómico), porque cuatro procesos con balde local consumen cuatro veces la cuota.',
            'Solo entonces ajusta concurrencia y techos de envejecimiento, con la métrica en la pantalla, cambiando un parámetro por vez.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El paso que más genera retrabajo cuando se salta es el del balde compartido. Es común que el controlador funcione perfectamente en desarrollo, con un solo proceso, y se desmorone en producción con cuatro réplicas, porque cada una cree tener la cuota entera. El síntoma es característico: 429 constante mientras el panel de cada instancia jura estar dentro del límite.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Token bucket o leaky bucket para API de LLM?',
      answer:
        'Token bucket, porque permite ráfaga hasta la capacidad del balde y así es como los proveedores de LLM miden la cuota: una tasa media con tolerancia a picos cortos. El leaky bucket suaviza la salida a una tasa constante, lo que desperdicia la ráfaga que tienes derecho a mandar y empeora la latencia de la primera llamada después de un período ocioso. Usa la capacidad del balde para definir el tamaño de la ráfaga aceptable y la tasa de rellenado para el régimen sostenido.',
    },
    {
      question: '¿Necesito cola de prioridad incluso con poco tráfico?',
      answer:
        'No en el día normal, pero la cola existe para el día malo. Con tráfico bien debajo de la cuota, todas las llamadas salen al instante y la cola queda vacía, sin costo ninguno. El valor aparece en el pico, en la campaña, en el reprocesamiento que alguien disparó sin avisar: es cuando la diferencia entre que el usuario espere dos segundos o dos minutos la decide la existencia de la clasificación. Clasificar las llamadas cuesta poco y es mucho más difícil de hacer después, con el incidente en marcha.',
    },
    {
      question: '¿Cómo controlar la cuota con varias instancias del servicio?',
      answer:
        'Un balde en memoria solo conoce el consumo del propio proceso, así que cuatro réplicas con balde local consumen hasta cuatro veces la cuota y el 429 vuelve. La salida es mover el conteo a un contador compartido, típicamente Redis con un script Lua que hace el rellenado y el débito de forma atómica, para que no haya carrera entre las réplicas. Alternativa más simple, cuando la precisión puede ser aproximada: dividir la cuota estáticamente por el número de réplicas, aceptando el desperdicio de una réplica ociosa con cuota reservada.',
    },
  ],
  conclusion: {
    title: 'El rate limit es un recurso a administrar, no un error a reintentar',
    description:
      'El 429 no es una falla esporádica: es el proveedor cobrando disciplina de caudal. Un token bucket calibrado en las dos dimensiones evita casi todo error antes de que ocurra, la cola con clases de prioridad y envejecimiento decide quién espera cuando la cuota aprieta, y el retry con backoff, jitter y Retry-After se ocupa de lo que se escapa. Junta eso a métricas que separan tiempo de cola de tiempo de modelo y el pico deja de ser incidente para volverse espera previsible.',
    cta: 'Hablar sobre control de caudal en mi integración con LLM',
  },
  related: [
    { label: 'Streaming de respuesta de LLM sin romper la UX', to: '/blog/streaming-resposta-llm-sem-quebrar-ux' },
    { label: 'Ruteo de modelos: el modelo correcto para cada tarea', to: '/blog/roteamento-modelos-modelo-certo-cada-tarefa' },
    { label: 'Cola y picos en campaña de WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
  ],
  repo: { name: 'llm-rate-limit-queue', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
