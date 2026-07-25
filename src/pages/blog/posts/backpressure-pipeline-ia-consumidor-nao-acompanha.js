// Conteudo do artigo: backpressure em pipeline de IA quando o consumidor nao acompanha.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Estágio de pipeline com backpressure explícito: a fila é limitada e nunca cresce além do teto configurado, um medidor com histerese traduz a ocupação em regime declarado (normal, degradado, crítico), o teto de admissão fecha a porta para o tráfego de lote antes do interativo sofrer, e a recusa devolve uma estimativa de espera derivada da fila real, para que a sobrecarga vire recusa rápida e previsível em vez de memória crescendo até o processo morrer.',
  en: 'Pipeline stage with explicit backpressure: the queue is bounded and never grows past the configured ceiling, a gauge with hysteresis translates occupancy into a declared regime (normal, degraded, critical), the admission ceiling closes the door to batch traffic before interactive traffic suffers, and the rejection returns a wait estimate derived from the real queue, so overload becomes a fast and predictable refusal instead of memory growing until the process dies.',
  es: 'Etapa de pipeline con backpressure explícito: la cola es limitada y nunca crece más allá del techo configurado, un medidor con histéresis traduce la ocupación en un régimen declarado (normal, degradado, crítico), el techo de admisión cierra la puerta al tráfico de lote antes de que sufra el interactivo, y el rechazo devuelve una estimación de espera derivada de la cola real, para que la sobrecarga se vuelva un rechazo rápido y previsible en vez de memoria creciendo hasta que el proceso muere.',
};

const repoUrl = 'https://github.com/joaosouz4dev/ai-pipeline-backpressure-mini';

const pt = {
  intro:
    'O pipeline funciona bem no teste e quebra na campanha. A causa quase nunca é o código de processamento: é a diferença de velocidade entre quem produz e quem consome. O webhook aceita mil mensagens por minuto porque aceitar é barato, e o estágio que chama o modelo processa cem por minuto porque o modelo demora. Enquanto a diferença for pequena e passageira, a fila absorve. Quando a diferença é sustentada, a fila não absorve nada: ela apenas adia, e o adiamento tem um preço que aparece de uma vez. A memória sobe, a latência do item que entrou por último vira minutos, e quando o processo finalmente morre ele leva junto tudo que estava enfileirado, inclusive o trabalho que já tinha sido aceito e prometido ao cliente. Backpressure é o mecanismo que evita isso: em vez de aceitar tudo e sofrer depois, o consumidor comunica ao produtor que não está dando conta, e o sistema desacelera na origem. Este artigo mostra como implementar essa comunicação: por que a fila ilimitada é uma bomba-relógio, como medir pressão de um jeito que não oscila, quais políticas de descarte existem e quando cada uma está certa, como propagar o sinal por uma cadeia de estágios e o que medir para saber se o freio está funcionando ou apenas escondendo o problema.',
  sections: [
    {
      title: 'A fila ilimitada é um adiamento, não uma solução',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição de que uma fila resolve descompasso de velocidade está certa, mas só para descompasso temporário. Uma fila é um amortecedor: ela absorve a diferença entre produção e consumo durante um intervalo, contando com um período posterior em que o consumidor está mais rápido que o produtor e drena o acúmulo. Se a taxa média de produção é maior que a taxa média de consumo, nenhum tamanho de fila resolve, porque não existe momento de drenagem. A fila só cresce. O que muda com o tamanho é quando o problema aparece, não se ele aparece.',
        },
        {
          type: 'paragraph',
          value:
            'O detalhe cruel é que uma fila crescendo piora ativamente o sistema antes de derrubá-lo. Cada item enfileirado ocupa memória, e em pipeline de IA os itens não são pequenos: carregam o histórico da conversa, o contexto recuperado, os anexos. Mil itens de cem kilobytes são cem megabytes de heap que o coletor de lixo precisa varrer a cada ciclo, e a pressão de GC deixa o consumidor mais lento, o que faz a fila crescer mais rápido, o que aumenta a pressão de GC. O sistema entra numa espiral em que a própria tentativa de absorver a carga é o que reduz a capacidade de processá-la.',
        },
        {
          type: 'paragraph',
          value:
            'E há o custo que ninguém contabiliza: o trabalho enfileirado envelhece. Uma mensagem que espera oito minutos numa fila para depois ser processada gera uma resposta que chega quando o cliente já saiu da conversa, já ligou para o telefone ou já desistiu. Você gastou tokens, gastou tempo de máquina e produziu uma resposta que não vale nada. Processar um item vencido é pior do que tê-lo recusado na entrada, porque a recusa é barata e honesta, enquanto o processamento tardio custa dinheiro e ainda entrega uma experiência ruim.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'O que acontece na sobrecarga sustentada', 'Como o sistema falha', 'O que o cliente vê'],
          rows: [
            [
              'Fila ilimitada em memória',
              'Heap cresce, GC pressiona, consumo desacelera',
              'Processo morre e perde tudo que estava enfileirado',
              'Sistema fora do ar sem aviso prévio',
            ],
            [
              'Fila limitada sem política',
              'Fila enche e o enqueue começa a falhar',
              'Erro genérico em ponto arbitrário do código',
              'Falha aleatória, crítico e lote tratados igual',
            ],
            [
              'Fila limitada com descarte cego',
              'O que chega depois é jogado fora',
              'Perda silenciosa, sem registro do que caiu',
              'Mensagem some sem explicação nem retorno',
            ],
            [
              'Fila limitada com backpressure declarado',
              'Produtor desacelera, lote é recusado, crítico passa',
              'Degradação anunciada e reversível',
              'Espera estimada ou recusa rápida com retorno claro',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medir pressão sem oscilar: histerese e regimes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure começa com uma medida. A mais direta é a ocupação da fila: quantos itens estão esperando dividido pelo teto configurado. É melhor que medir CPU ou memória porque a ocupação responde imediatamente ao descompasso, enquanto CPU alta pode significar simplesmente trabalho útil sendo feito e memória alta é um indicador atrasado, que já vem tarde demais.',
        },
        {
          type: 'paragraph',
          value:
            'A armadilha aparece na transformação da medida em decisão. Se a regra é "acima de sessenta por cento, recusar lote", uma fila oscilando em torno de sessenta por cento faz o sistema alternar entre aceitar e recusar a cada item, e o produtor recebe um sinal que muda de segundo em segundo, impossível de seguir. A correção é histerese: o regime sobe quando a pressão cruza o limiar, mas só desce quando ela cai abaixo do limiar menos uma margem. É o mesmo princípio do termostato, que não liga e desliga o compressor a cada décimo de grau. Com histerese, o produtor recebe um regime estável o suficiente para agir sobre ele.',
        },
        {
          type: 'paragraph',
          value:
            'Três regimes cobrem praticamente todo caso real, e o valor de nomeá-los é que cada um carrega uma política declarada, escrita antes do incidente, em vez de uma decisão improvisada durante ele.',
        },
        {
          type: 'table',
          columns: ['Regime', 'Ocupação típica', 'O que é admitido', 'Sinal ao produtor'],
          rows: [
            [
              'Normal',
              'Abaixo de 60 por cento',
              'Todo o tráfego, interativo e lote',
              'Nenhum, produtor segue no ritmo',
            ],
            [
              'Degradado',
              'Entre 60 e 85 por cento',
              'Interativo e lote de prioridade média',
              'Reduzir concorrência do lote pela metade',
            ],
            [
              'Crítico',
              'Acima de 85 por cento',
              'Somente interativo com humano esperando',
              'Pausar lote e respeitar o Retry-After',
            ],
          ],
        },
        {
          type: 'code',
          value: `// src/pressure-gauge.js
// Medidor de pressao com histerese: sobe no limiar cheio, mas so desce
// quando a pressao cai abaixo do limiar menos a margem. Sem isso o regime
// pisca em cima da fronteira e o produtor nao consegue reagir.

export const NORMAL = 'normal';
export const DEGRADED = 'degraded';
export const CRITICAL = 'critical';

export class PressureGauge {
  constructor({ degradedAt = 0.6, criticalAt = 0.85, hysteresis = 0.1 } = {}) {
    if (!(degradedAt < criticalAt)) {
      throw new Error('degradedAt deve ser menor que criticalAt');
    }
    this.degradedAt = degradedAt;
    this.criticalAt = criticalAt;
    this.hysteresis = hysteresis;
    this.state = NORMAL;
  }

  update(pressure) {
    if (this.state === NORMAL && pressure >= this.degradedAt) {
      this.state = pressure >= this.criticalAt ? CRITICAL : DEGRADED;
      return this.state;
    }

    if (this.state === DEGRADED) {
      if (pressure >= this.criticalAt) this.state = CRITICAL;
      else if (pressure < this.degradedAt - this.hysteresis) this.state = NORMAL;
      return this.state;
    }

    if (this.state === CRITICAL && pressure < this.criticalAt - this.hysteresis) {
      this.state = pressure >= this.degradedAt ? DEGRADED : NORMAL;
    }

    return this.state;
  }

  // Prioridade maxima aceita em cada regime (menor numero = mais urgente).
  admissionCeiling() {
    if (this.state === CRITICAL) return 1;
    if (this.state === DEGRADED) return 5;
    return Number.POSITIVE_INFINITY;
  }
}`,
        },
      ],
    },
    {
      title: 'Políticas de descarte: escolher o que perder antes de perder',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando a fila enche, algo vai ser perdido. Isso não é opcional, é aritmética: se entram mil e saem cem, novecentos ficam de fora de um jeito ou de outro. A única escolha real é entre decidir o que perder ou deixar o esgotamento de recurso decidir por você. A primeira opção produz perda controlada e registrada; a segunda produz perda arbitrária e silenciosa, normalmente do trabalho mais caro, porque é o que estava em processamento quando o processo morreu.',
        },
        {
          type: 'paragraph',
          value:
            'Três políticas cobrem a maior parte dos casos, e a escolha não é técnica, é de negócio. Recusar na entrada é a política certa quando o produtor pode segurar o trabalho e tentar de novo depois, como um webhook que devolve 429 e confia na retentativa do remetente. Descartar o mais antigo é a política certa quando o dado envelhece e o valor está no mais fresco, como um fluxo de telemetria em que a medição de agora vale mais que a de dois minutos atrás. Descartar o de menor prioridade é a política certa quando classes diferentes convivem na mesma fila e uma delas tem um humano esperando do outro lado.',
        },
        {
          type: 'code',
          value: `// src/bounded-queue.js
// Fila limitada com politica de admissao explicita.
// Ela nunca cresce alem de maxSize: quando cheia, decide o que perder
// em vez de deixar a memoria decidir por ela.

export const ADMITTED = 'admitted';
export const REJECTED = 'rejected';
export const SHED = 'shed';

export class BoundedQueue {
  constructor({ maxSize, policy = 'reject' }) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('maxSize deve ser um inteiro maior que zero');
    }
    this.maxSize = maxSize;
    this.policy = policy;
    this.items = [];
    this.stats = { admitted: 0, rejected: 0, shed: 0 };
  }

  get pressure() {
    return this.items.length / this.maxSize;
  }

  enqueue(item, priority = 5) {
    const entry = { item, priority, enqueuedAt: Date.now() };

    if (this.items.length < this.maxSize) {
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      return { outcome: ADMITTED, dropped: null };
    }

    if (this.policy === 'drop-oldest') {
      const dropped = this.removeOldest();
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      this.stats.shed += 1;
      return { outcome: SHED, dropped: dropped.item };
    }

    if (this.policy === 'drop-lowest') {
      const worst = this.items[this.items.length - 1];
      // So descarta se o recem-chegado for realmente mais urgente que o pior
      // da fila, senao a fila vira um carrossel de trocas sem progresso.
      if (worst.priority > priority) {
        this.items.pop();
        this.insertByPriority(entry);
        this.stats.admitted += 1;
        this.stats.shed += 1;
        return { outcome: SHED, dropped: worst.item };
      }
      this.stats.rejected += 1;
      return { outcome: REJECTED, dropped: null };
    }

    this.stats.rejected += 1;
    return { outcome: REJECTED, dropped: null };
  }

  insertByPriority(entry) {
    // Insercao estavel: entre prioridades iguais vale a ordem de chegada.
    let index = this.items.length;
    while (index > 0 && this.items[index - 1].priority > entry.priority) {
      index -= 1;
    }
    this.items.splice(index, 0, entry);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que separa uma implementação correta de uma que se sabota está na política drop-lowest: a troca só acontece se o recém-chegado for estritamente mais urgente que o pior item já enfileirado. Sem essa comparação, uma rajada de itens de mesma prioridade faz a fila descartar e readmitir os próprios itens sem parar, gastando trabalho para não avançar nada. É o tipo de bug que só aparece sob carga, exatamente quando você menos quer descobri-lo.',
        },
      ],
    },
    {
      title: 'Devolver a pressão ao produtor, não só absorvê-la',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limitar a fila protege o processo, mas ainda não é backpressure. Backpressure é o sinal que sobe: o consumidor precisa comunicar ao produtor que está saturado, e o produtor precisa fazer algo com essa informação. Sem esse retorno, você trocou um processo que morre por um processo saudável que recusa tudo, o que é melhor, mas ainda muito longe do ideal, porque o produtor continua martelando na mesma velocidade e desperdiçando trabalho em tentativas que serão rejeitadas.',
        },
        {
          type: 'paragraph',
          value:
            'O que forma esse sinal depende do transporte, mas a informação é sempre a mesma: houve recusa, e quanto esperar antes de tentar de novo. Numa API HTTP, é o 429 com Retry-After. Numa fila de mensagens com confirmação manual, é parar de buscar novos lotes enquanto os anteriores não forem confirmados, o que é o prefetch limitado do AMQP ou a pausa de consumo do Kafka. Dentro do mesmo processo, é a promessa retornada pelo write de um stream, ou simplesmente aguardar antes do próximo submit. O erro comum é responder a recusa com um valor fixo de espera: cinco segundos chutados fazem todos os produtores voltarem juntos, sincronizados, num efeito manada que recria o pico. O valor certo deriva da fila real, do trabalho pendente dividido pela vazão do consumidor.',
        },
        {
          type: 'diagram',
          value: `  produtor                      estagio com backpressure
     |                                    |
     |  submit(job, prioridade)           |
     |----------------------------------->|
     |                             [ mede ocupacao da fila ]
     |                             [ atualiza regime c/ histerese ]
     |                                    |
     |                          prioridade <= teto do regime?
     |                                    |
     |            <---- admitido ---------+ sim
     |                                    |
     |            <-- recusado + espera --+ nao
     |                                    |
     |  desacelera na origem              v
     |  (pausa lote, mantem interativo)  consumidor
     |                                   concorrencia limitada
     v                                        |
  produz menos <----- regime critico ---------+`,
        },
        {
          type: 'code',
          value: `// src/pipeline.js
// Estagio com backpressure explicito: concorrencia limitada no consumidor,
// fila limitada no meio e resultado de admissao devolvido ao produtor.

export class BackpressureStage {
  constructor({ handler, concurrency = 2, maxQueueSize = 10, policy = 'reject', gauge }) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.queue = new BoundedQueue({ maxSize: maxQueueSize, policy });
    this.gauge = gauge || new PressureGauge();
    this.inFlight = 0;
    this.metrics = { processed: 0, failed: 0, rejected: 0, shed: 0, maxQueueSeen: 0 };
  }

  submit(job, priority = 5) {
    const state = this.gauge.update(this.queue.pressure);

    // O teto do regime fecha a porta para o lote antes do interativo sofrer.
    if (priority > this.gauge.admissionCeiling()) {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }

    const admission = this.queue.enqueue(job, priority);
    if (admission.outcome === 'rejected') {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }
    if (admission.outcome === 'shed') this.metrics.shed += 1;

    this.metrics.maxQueueSeen = Math.max(this.metrics.maxQueueSeen, this.queue.size);
    this.pump();
    return { outcome: admission.outcome, state, dropped: admission.dropped };
  }

  // Espera estimada a partir da fila real e da vazao configurada,
  // em vez de um valor fixo que sincroniza todos os produtores.
  retryAfterMs(perItemMs = 200) {
    return Math.ceil(((this.queue.size + 1) / this.concurrency) * perItemMs);
  }

  pump() {
    while (this.inFlight < this.concurrency && this.queue.size > 0) {
      const job = this.queue.dequeue();
      this.inFlight += 1;
      Promise.resolve()
        .then(() => this.handler(job))
        .then(() => { this.metrics.processed += 1; })
        .catch(() => { this.metrics.failed += 1; })
        .finally(() => {
          this.inFlight -= 1;
          this.gauge.update(this.queue.pressure);
          this.pump();
        });
    }
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que a concorrência limitada no consumidor é parte essencial do desenho, e não um detalhe. Se o pump disparasse todos os itens da fila de uma vez, a fila esvaziaria instantaneamente, a pressão medida cairia para zero e o medidor diria que está tudo bem enquanto mil chamadas simultâneas estariam em voo contra o provedor. A fila só é um sensor honesto de pressão porque existe um limite de trabalho em voo represando os itens nela.',
        },
      ],
    },
    {
      title: 'Propagar o sinal por uma cadeia de estágios',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um pipeline real tem vários estágios em sequência: recebe a mensagem, normaliza, recupera o contexto, chama o modelo, valida a saída, entrega. Cada um tem vazão diferente, e o gargalo é o mais lento, normalmente a chamada ao modelo. O erro clássico é colocar backpressure só nesse estágio: os anteriores continuam aceitando tudo, acumulam nas próprias filas, e o problema apenas se muda de lugar, saindo do estágio lento para os que vêm antes dele.',
        },
        {
          type: 'paragraph',
          value:
            'A regra é que o sinal precisa subir a cadeia até chegar à borda, o ponto onde o sistema fala com o mundo externo e pode legitimamente dizer não. Cada estágio observa a pressão do estágio seguinte antes de aceitar mais trabalho, e o primeiro estágio traduz a pressão acumulada numa resposta ao chamador. É o inverso do fluxo de dados: os dados descem do primeiro ao último, o sinal de pressão sobe do último ao primeiro.',
        },
        {
          type: 'ordered',
          items: [
            'Cada estágio expõe a própria pressão como um número entre zero e um, derivado da ocupação da fila mais o trabalho em voo.',
            'Antes de aceitar um item, o estágio consulta a pressão do estágio seguinte e usa o maior valor entre a própria e a dele como pressão efetiva.',
            'A borda traduz a pressão efetiva em resposta ao chamador: aceita, aceita com aviso de degradação ou recusa com espera estimada.',
            'O trabalho de lote consulta a pressão antes de puxar o próximo bloco e reduz o tamanho do bloco no regime degradado, pausando no crítico.',
            'Nenhum estágio intermediário tem fila ilimitada, porque um único buffer sem teto no meio da cadeia anula o sinal de todos os outros.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Há um caso em que a borda não pode dizer não: quando o produtor é um webhook externo que vai desistir e considerar a mensagem perdida se você recusar. Aí a resposta correta não é aceitar em memória, é persistir imediatamente em armazenamento durável e responder 200 sobre o registro persistido, transformando a fila em memória numa fila em disco que sobrevive à queda do processo. A pressão continua existindo e continua sendo medida, mas passa a ser medida sobre a fila durável, e o backlog vira um número visível em vez de heap invisível.',
        },
      ],
    },
    {
      title: 'Métricas que dizem se o freio funciona ou só esconde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure implementado sem métrica vira um mecanismo que descarta trabalho em silêncio, o que é uma forma diferente do mesmo problema. Contar apenas o total processado não revela nada, porque um sistema que recusa noventa por cento da carga e processa dez por cento rapidamente parece saudável em latência média. As métricas precisam separar o que foi aceito do que foi recusado e mostrar o custo de cada decisão.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Como medir', 'O que ela revela', 'Quando agir'],
          rows: [
            [
              'Taxa de recusa por classe',
              'Recusados sobre submetidos, separado por prioridade',
              'Se o freio está protegendo o crítico ou atingindo todos',
              'Qualquer recusa na classe interativa',
            ],
            [
              'Ocupação da fila no percentil 95',
              'Amostrar o tamanho da fila periodicamente',
              'Se o teto está apertado ou folgado demais',
              'Acima de 80 por cento de forma sustentada',
            ],
            [
              'Idade do item mais antigo',
              'Agora menos o instante de entrada na fila',
              'Se a fila anda ou se há trabalho preso',
              'Idade acima da validade do item',
            ],
            [
              'Tempo em regime degradado ou crítico',
              'Somar a duração de cada regime por hora',
              'Se a capacidade é insuficiente e não é pico',
              'Mais de dez por cento da hora fora do normal',
            ],
            [
              'Trabalho vencido processado',
              'Itens concluídos após a validade de negócio',
              'Token gasto para produzir resposta inútil',
              'Qualquer valor diferente de zero',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha merece destaque porque é a que mais surpreende quem instrumenta pela primeira vez. Um pipeline com fila generosa costuma ter uma fatia relevante de itens concluídos depois que já não importavam: a resposta pronta para uma conversa encerrada, o resumo gerado para um atendimento já transferido. Esses itens consumiram cota, custaram dinheiro e ocuparam o lugar de trabalho útil. Medir isso costuma ser o argumento mais convincente para reduzir o tamanho da fila, porque transforma uma discussão de arquitetura numa linha de fatura.',
        },
        {
          type: 'paragraph',
          value:
            'A leitura conjunta é o que dá o diagnóstico. Recusa alta com ocupação baixa significa teto de admissão calibrado de forma conservadora demais. Recusa baixa com ocupação sempre no topo significa que a fila está grande demais e você está acumulando latência em vez de sinalizar. Tempo em regime crítico crescendo semana após semana não é problema de configuração: é falta de capacidade, e nenhum ajuste de limiar resolve, só mais consumidores ou um modelo mais rápido no gargalo.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual o tamanho certo para a fila?',
      answer:
        'O tamanho certo deriva do tempo máximo de espera que o item tolera, não de um número redondo. Multiplique a vazão do consumidor pela validade de negócio do item: se o estágio processa dez itens por segundo e uma resposta perde o valor depois de trinta segundos, o teto útil é trezentos, porque qualquer item além disso será concluído depois de vencer. Filas maiores que esse produto não aumentam a capacidade, apenas transformam recusa rápida em processamento tardio, que custa igual e entrega menos. Se o cálculo der um número pequeno demais para o seu tráfego, o problema é capacidade e não configuração.',
    },
    {
      question: 'Backpressure não é só recusar requisição com 429?',
      answer:
        'O 429 é uma das formas de expressar o sinal, mas backpressure é o mecanismo inteiro: medir a saturação real do consumidor, decidir a admissão por classe de tráfego, informar quanto esperar com base na fila real e fazer o produtor agir sobre esse retorno. Devolver 429 sem medir nada é chutar o limite, e devolver Retry-After fixo sincroniza todos os clientes num efeito manada que recria o pico logo depois. A diferença prática está em o número vir do estado observado do sistema em vez de uma constante escolhida no momento em que o endpoint foi escrito.',
    },
    {
      question: 'Como aplicar isso quando o consumo vem de uma fila gerenciada?',
      answer:
        'Com SQS, RabbitMQ ou Kafka o buffer já é externo e durável, o que resolve a parte de não perder trabalho na queda do processo, mas não elimina o backpressure: ele muda de lugar. O controle passa a ser quantas mensagens o consumidor busca de uma vez, o prefetch do AMQP ou o max de registros por poll, e a decisão de pausar o consumo quando o estágio seguinte satura. O sinal que antes era ocupação da fila em memória vira profundidade do backlog mais idade da mensagem mais antiga. E o descarte por prioridade normalmente vira filas separadas por classe, com o consumidor lendo a de lote só quando a interativa está vazia.',
    },
  ],
  conclusion: {
    title: 'Perda controlada vale mais que colapso silencioso',
    description:
      'A fila ilimitada não absorve sobrecarga, ela apenas escolhe um momento pior para falhar, quando a memória acabou e o trabalho aceito se perde junto. Backpressure troca esse colapso por uma degradação declarada: fila com teto, regime medido com histerese, política de descarte escrita antes do incidente, sinal que sobe até a borda e métricas que separam o que foi recusado do que foi processado depois de vencer. O sistema continua dizendo não quando não dá conta, mas passa a dizer cedo, com um prazo estimado e protegendo quem tem um humano esperando do outro lado.',
    cta: 'Falar sobre controle de carga no meu pipeline de IA',
  },
  related: [
    { label: 'Rate limit e fila de prioridade para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Timeout e cancelamento em cadeia de chamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-pipeline-backpressure-mini', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'The pipeline works fine in testing and breaks during the campaign. The cause is almost never the processing code: it is the speed difference between who produces and who consumes. The webhook accepts a thousand messages per minute because accepting is cheap, and the stage that calls the model processes a hundred per minute because the model takes time. As long as the gap is small and temporary, the queue absorbs it. When the gap is sustained, the queue absorbs nothing: it only postpones, and the postponement has a price that shows up all at once. Memory climbs, the latency of the last item to enter becomes minutes, and when the process finally dies it takes everything queued with it, including the work that had already been accepted and promised to the customer. Backpressure is the mechanism that prevents this: instead of accepting everything and suffering later, the consumer tells the producer it cannot keep up, and the system slows down at the source. This article shows how to implement that communication: why the unbounded queue is a time bomb, how to measure pressure in a way that does not oscillate, which shedding policies exist and when each one is right, how to propagate the signal across a chain of stages and what to measure to know whether the brake is working or merely hiding the problem.',
  sections: [
    {
      title: 'The unbounded queue is a postponement, not a solution',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition that a queue solves a speed mismatch is correct, but only for a temporary mismatch. A queue is a buffer: it absorbs the difference between production and consumption over an interval, counting on a later period in which the consumer is faster than the producer and drains the backlog. If the average production rate is higher than the average consumption rate, no queue size solves it, because there is no draining period. The queue only grows. What the size changes is when the problem appears, not whether it appears.',
        },
        {
          type: 'paragraph',
          value:
            'The cruel detail is that a growing queue actively degrades the system before bringing it down. Each queued item takes memory, and in an AI pipeline the items are not small: they carry conversation history, retrieved context, attachments. A thousand items of a hundred kilobytes are a hundred megabytes of heap the garbage collector has to sweep every cycle, and GC pressure makes the consumer slower, which makes the queue grow faster, which increases GC pressure. The system enters a spiral where the very attempt to absorb the load is what reduces the capacity to process it.',
        },
        {
          type: 'paragraph',
          value:
            'And there is the cost nobody accounts for: queued work ages. A message that waits eight minutes in a queue and is only then processed produces an answer that arrives when the customer has already left the conversation, already called the phone line or already given up. You spent tokens, spent machine time and produced an answer worth nothing. Processing an expired item is worse than having refused it at the door, because the refusal is cheap and honest, while late processing costs money and still delivers a bad experience.',
        },
        {
          type: 'table',
          columns: ['Approach', 'What happens under sustained overload', 'How the system fails', 'What the customer sees'],
          rows: [
            [
              'Unbounded in-memory queue',
              'Heap grows, GC presses, consumption slows down',
              'Process dies and loses everything that was queued',
              'System down with no prior warning',
            ],
            [
              'Bounded queue with no policy',
              'Queue fills and the enqueue starts failing',
              'Generic error at an arbitrary point in the code',
              'Random failure, critical and batch treated alike',
            ],
            [
              'Bounded queue with blind shedding',
              'Whatever arrives later is thrown away',
              'Silent loss, with no record of what dropped',
              'Message vanishes with no explanation or feedback',
            ],
            [
              'Bounded queue with declared backpressure',
              'Producer slows down, batch is refused, critical passes',
              'Announced and reversible degradation',
              'Estimated wait or fast refusal with clear feedback',
            ],
          ],
        },
      ],
    },
    {
      title: 'Measuring pressure without oscillating: hysteresis and regimes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure starts with a measurement. The most direct one is queue occupancy: how many items are waiting divided by the configured ceiling. It beats measuring CPU or memory because occupancy responds immediately to the mismatch, while high CPU may simply mean useful work being done and high memory is a lagging indicator that already arrives too late.',
        },
        {
          type: 'paragraph',
          value:
            'The trap shows up when turning the measurement into a decision. If the rule is "above sixty percent, refuse batch", a queue oscillating around sixty percent makes the system flip between accepting and refusing on every item, and the producer gets a signal that changes second by second, impossible to follow. The fix is hysteresis: the regime rises when pressure crosses the threshold, but only falls when it drops below the threshold minus a margin. It is the same principle as a thermostat, which does not switch the compressor on and off at every tenth of a degree. With hysteresis, the producer receives a regime stable enough to act upon.',
        },
        {
          type: 'paragraph',
          value:
            'Three regimes cover practically every real case, and the value of naming them is that each one carries a declared policy, written before the incident, instead of a decision improvised during it.',
        },
        {
          type: 'table',
          columns: ['Regime', 'Typical occupancy', 'What is admitted', 'Signal to the producer'],
          rows: [
            [
              'Normal',
              'Below 60 percent',
              'All traffic, interactive and batch',
              'None, the producer keeps its pace',
            ],
            [
              'Degraded',
              'Between 60 and 85 percent',
              'Interactive and medium priority batch',
              'Cut batch concurrency in half',
            ],
            [
              'Critical',
              'Above 85 percent',
              'Only interactive with a human waiting',
              'Pause batch and honor the Retry-After',
            ],
          ],
        },
        {
          type: 'code',
          value: `// src/pressure-gauge.js
// Pressure gauge with hysteresis: it rises at the full threshold, but only
// falls when pressure drops below the threshold minus the margin. Without
// it the regime flickers on the boundary and the producer cannot react.

export const NORMAL = 'normal';
export const DEGRADED = 'degraded';
export const CRITICAL = 'critical';

export class PressureGauge {
  constructor({ degradedAt = 0.6, criticalAt = 0.85, hysteresis = 0.1 } = {}) {
    if (!(degradedAt < criticalAt)) {
      throw new Error('degradedAt must be lower than criticalAt');
    }
    this.degradedAt = degradedAt;
    this.criticalAt = criticalAt;
    this.hysteresis = hysteresis;
    this.state = NORMAL;
  }

  update(pressure) {
    if (this.state === NORMAL && pressure >= this.degradedAt) {
      this.state = pressure >= this.criticalAt ? CRITICAL : DEGRADED;
      return this.state;
    }

    if (this.state === DEGRADED) {
      if (pressure >= this.criticalAt) this.state = CRITICAL;
      else if (pressure < this.degradedAt - this.hysteresis) this.state = NORMAL;
      return this.state;
    }

    if (this.state === CRITICAL && pressure < this.criticalAt - this.hysteresis) {
      this.state = pressure >= this.degradedAt ? DEGRADED : NORMAL;
    }

    return this.state;
  }

  // Highest priority accepted in each regime (lower number = more urgent).
  admissionCeiling() {
    if (this.state === CRITICAL) return 1;
    if (this.state === DEGRADED) return 5;
    return Number.POSITIVE_INFINITY;
  }
}`,
        },
      ],
    },
    {
      title: 'Shedding policies: choosing what to lose before losing it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the queue fills, something will be lost. That is not optional, it is arithmetic: if a thousand come in and a hundred go out, nine hundred stay out one way or another. The only real choice is between deciding what to lose or letting resource exhaustion decide for you. The first option produces controlled and recorded loss; the second produces arbitrary and silent loss, usually of the most expensive work, because that is what was being processed when the process died.',
        },
        {
          type: 'paragraph',
          value:
            'Three policies cover most cases, and the choice is not technical, it is a business one. Refusing at the door is the right policy when the producer can hold the work and try again later, like a webhook that returns 429 and trusts the sender retry. Dropping the oldest is the right policy when data ages and the value lies in the freshest item, like a telemetry stream where the measurement from now is worth more than the one from two minutes ago. Dropping the lowest priority is the right policy when different classes share the same queue and one of them has a human waiting on the other side.',
        },
        {
          type: 'code',
          value: `// src/bounded-queue.js
// Bounded queue with an explicit admission policy.
// It never grows past maxSize: when full, it decides what to lose
// instead of letting memory decide for it.

export const ADMITTED = 'admitted';
export const REJECTED = 'rejected';
export const SHED = 'shed';

export class BoundedQueue {
  constructor({ maxSize, policy = 'reject' }) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('maxSize must be an integer greater than zero');
    }
    this.maxSize = maxSize;
    this.policy = policy;
    this.items = [];
    this.stats = { admitted: 0, rejected: 0, shed: 0 };
  }

  get pressure() {
    return this.items.length / this.maxSize;
  }

  enqueue(item, priority = 5) {
    const entry = { item, priority, enqueuedAt: Date.now() };

    if (this.items.length < this.maxSize) {
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      return { outcome: ADMITTED, dropped: null };
    }

    if (this.policy === 'drop-oldest') {
      const dropped = this.removeOldest();
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      this.stats.shed += 1;
      return { outcome: SHED, dropped: dropped.item };
    }

    if (this.policy === 'drop-lowest') {
      const worst = this.items[this.items.length - 1];
      // Only shed if the newcomer is genuinely more urgent than the worst
      // in the queue, otherwise it becomes a swap carousel with no progress.
      if (worst.priority > priority) {
        this.items.pop();
        this.insertByPriority(entry);
        this.stats.admitted += 1;
        this.stats.shed += 1;
        return { outcome: SHED, dropped: worst.item };
      }
      this.stats.rejected += 1;
      return { outcome: REJECTED, dropped: null };
    }

    this.stats.rejected += 1;
    return { outcome: REJECTED, dropped: null };
  }

  insertByPriority(entry) {
    // Stable insertion: among equal priorities, arrival order wins.
    let index = this.items.length;
    while (index > 0 && this.items[index - 1].priority > entry.priority) {
      index -= 1;
    }
    this.items.splice(index, 0, entry);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that separates a correct implementation from a self-sabotaging one is in the drop-lowest policy: the swap only happens if the newcomer is strictly more urgent than the worst item already queued. Without that comparison, a burst of same-priority items makes the queue endlessly shed and readmit its own items, spending work to advance nothing. It is the kind of bug that only shows up under load, exactly when you least want to discover it.',
        },
      ],
    },
    {
      title: 'Returning pressure to the producer, not just absorbing it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Bounding the queue protects the process, but it is not yet backpressure. Backpressure is the signal that travels upstream: the consumer has to tell the producer it is saturated, and the producer has to do something with that information. Without that feedback, you traded a process that dies for a healthy process that refuses everything, which is better, but still far from ideal, because the producer keeps hammering at the same speed and wasting work on attempts that will be rejected.',
        },
        {
          type: 'paragraph',
          value:
            'What shapes that signal depends on the transport, but the information is always the same: there was a refusal, and how long to wait before trying again. In an HTTP API, it is the 429 with Retry-After. In a message queue with manual acknowledgement, it is stopping the fetch of new batches while the previous ones are unacknowledged, which is the bounded prefetch in AMQP or the consumption pause in Kafka. Inside the same process, it is the promise returned by a stream write, or simply awaiting before the next submit. The common mistake is answering the refusal with a fixed wait value: five guessed seconds make every producer come back together, synchronized, in a herd effect that recreates the spike. The right value derives from the real queue, from pending work divided by consumer throughput.',
        },
        {
          type: 'diagram',
          value: `  producer                       stage with backpressure
     |                                    |
     |  submit(job, priority)             |
     |----------------------------------->|
     |                             [ measures queue occupancy ]
     |                             [ updates regime w/ hysteresis ]
     |                                    |
     |                          priority <= regime ceiling?
     |                                    |
     |            <---- admitted ---------+ yes
     |                                    |
     |            <-- refused + wait -----+ no
     |                                    |
     |  slows down at the source          v
     |  (pauses batch, keeps interactive) consumer
     |                                   bounded concurrency
     v                                        |
  produces less <---- critical regime --------+`,
        },
        {
          type: 'code',
          value: `// src/pipeline.js
// Stage with explicit backpressure: bounded concurrency in the consumer,
// bounded queue in the middle and the admission result handed to the producer.

export class BackpressureStage {
  constructor({ handler, concurrency = 2, maxQueueSize = 10, policy = 'reject', gauge }) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.queue = new BoundedQueue({ maxSize: maxQueueSize, policy });
    this.gauge = gauge || new PressureGauge();
    this.inFlight = 0;
    this.metrics = { processed: 0, failed: 0, rejected: 0, shed: 0, maxQueueSeen: 0 };
  }

  submit(job, priority = 5) {
    const state = this.gauge.update(this.queue.pressure);

    // The regime ceiling closes the door to batch before interactive suffers.
    if (priority > this.gauge.admissionCeiling()) {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }

    const admission = this.queue.enqueue(job, priority);
    if (admission.outcome === 'rejected') {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }
    if (admission.outcome === 'shed') this.metrics.shed += 1;

    this.metrics.maxQueueSeen = Math.max(this.metrics.maxQueueSeen, this.queue.size);
    this.pump();
    return { outcome: admission.outcome, state, dropped: admission.dropped };
  }

  // Wait estimated from the real queue and the configured throughput,
  // instead of a fixed value that synchronizes every producer.
  retryAfterMs(perItemMs = 200) {
    return Math.ceil(((this.queue.size + 1) / this.concurrency) * perItemMs);
  }

  pump() {
    while (this.inFlight < this.concurrency && this.queue.size > 0) {
      const job = this.queue.dequeue();
      this.inFlight += 1;
      Promise.resolve()
        .then(() => this.handler(job))
        .then(() => { this.metrics.processed += 1; })
        .catch(() => { this.metrics.failed += 1; })
        .finally(() => {
          this.inFlight -= 1;
          this.gauge.update(this.queue.pressure);
          this.pump();
        });
    }
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Notice that bounded concurrency in the consumer is an essential part of the design, not a detail. If pump fired every queued item at once, the queue would drain instantly, the measured pressure would fall to zero and the gauge would report all clear while a thousand simultaneous calls were in flight against the provider. The queue is only an honest pressure sensor because a limit on in-flight work holds the items in it.',
        },
      ],
    },
    {
      title: 'Propagating the signal across a chain of stages',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A real pipeline has several stages in sequence: receive the message, normalize, retrieve context, call the model, validate the output, deliver. Each has a different throughput, and the bottleneck is the slowest one, usually the model call. The classic mistake is putting backpressure only in that stage: the earlier ones keep accepting everything, pile up in their own queues, and the problem just moves, leaving the slow stage for the ones ahead of it.',
        },
        {
          type: 'paragraph',
          value:
            'The rule is that the signal has to travel up the chain until it reaches the edge, the point where the system talks to the outside world and can legitimately say no. Each stage observes the pressure of the following stage before accepting more work, and the first stage translates the accumulated pressure into a response to the caller. It is the inverse of the data flow: data goes down from first to last, the pressure signal goes up from last to first.',
        },
        {
          type: 'ordered',
          items: [
            'Each stage exposes its own pressure as a number between zero and one, derived from queue occupancy plus in-flight work.',
            'Before accepting an item, the stage checks the pressure of the next stage and uses the higher of its own and that one as the effective pressure.',
            'The edge translates the effective pressure into a response to the caller: accepted, accepted with a degradation notice, or refused with an estimated wait.',
            'Batch work checks the pressure before pulling the next block and reduces the block size in the degraded regime, pausing in the critical one.',
            'No intermediate stage has an unbounded queue, because a single ceiling-free buffer in the middle of the chain cancels the signal of all the others.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'There is one case where the edge cannot say no: when the producer is an external webhook that will give up and consider the message lost if you refuse. There the correct answer is not to accept in memory, it is to persist immediately into durable storage and return 200 over the persisted record, turning the in-memory queue into an on-disk queue that survives a process crash. Pressure still exists and is still measured, but it starts being measured over the durable queue, and the backlog becomes a visible number instead of invisible heap.',
        },
      ],
    },
    {
      title: 'Metrics that tell whether the brake works or only hides',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Backpressure implemented without metrics becomes a mechanism that discards work in silence, which is a different form of the same problem. Counting only the total processed reveals nothing, because a system that refuses ninety percent of the load and processes ten percent quickly looks healthy in average latency. Metrics have to separate what was accepted from what was refused and show the cost of each decision.',
        },
        {
          type: 'table',
          columns: ['Metric', 'How to measure', 'What it reveals', 'When to act'],
          rows: [
            [
              'Refusal rate per class',
              'Refused over submitted, split by priority',
              'Whether the brake protects critical or hits everyone',
              'Any refusal in the interactive class',
            ],
            [
              'Queue occupancy at the 95th percentile',
              'Sample the queue size periodically',
              'Whether the ceiling is too tight or too loose',
              'Above 80 percent in a sustained way',
            ],
            [
              'Age of the oldest item',
              'Now minus the instant it entered the queue',
              'Whether the queue moves or work is stuck',
              'Age above the item validity',
            ],
            [
              'Time in degraded or critical regime',
              'Sum the duration of each regime per hour',
              'Whether capacity is insufficient and it is not a spike',
              'More than ten percent of the hour outside normal',
            ],
            [
              'Expired work processed',
              'Items finished after the business validity',
              'Tokens spent producing a useless answer',
              'Any value other than zero',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row deserves attention because it is the one that most surprises whoever instruments it for the first time. A pipeline with a generous queue usually has a relevant slice of items finished after they no longer mattered: the answer ready for a closed conversation, the summary generated for a ticket already handed over. Those items consumed quota, cost money and took the place of useful work. Measuring this is usually the most convincing argument for shrinking the queue, because it turns an architecture discussion into a line on the invoice.',
        },
        {
          type: 'paragraph',
          value:
            'Reading them together is what gives the diagnosis. High refusal with low occupancy means an admission ceiling calibrated too conservatively. Low refusal with occupancy always at the top means the queue is too large and you are accumulating latency instead of signaling. Time in the critical regime growing week after week is not a configuration problem: it is missing capacity, and no threshold tuning fixes it, only more consumers or a faster model at the bottleneck.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the right size for the queue?',
      answer:
        'The right size derives from the maximum wait the item tolerates, not from a round number. Multiply the consumer throughput by the business validity of the item: if the stage processes ten items per second and an answer loses value after thirty seconds, the useful ceiling is three hundred, because any item beyond that will be finished after expiring. Queues larger than that product do not add capacity, they only turn a fast refusal into late processing, which costs the same and delivers less. If the calculation yields a number too small for your traffic, the problem is capacity and not configuration.',
    },
    {
      question: 'Is backpressure not just refusing requests with a 429?',
      answer:
        'The 429 is one of the ways to express the signal, but backpressure is the whole mechanism: measuring the real saturation of the consumer, deciding admission by traffic class, telling how long to wait based on the real queue and having the producer act on that feedback. Returning a 429 without measuring anything is guessing the limit, and returning a fixed Retry-After synchronizes every client into a herd effect that recreates the spike right afterwards. The practical difference is the number coming from the observed state of the system instead of a constant chosen when the endpoint was written.',
    },
    {
      question: 'How do I apply this when consumption comes from a managed queue?',
      answer:
        'With SQS, RabbitMQ or Kafka the buffer is already external and durable, which solves the part about not losing work when the process crashes, but it does not remove backpressure: it moves it. The control becomes how many messages the consumer fetches at once, the AMQP prefetch or the max records per poll, and the decision to pause consumption when the next stage saturates. The signal that used to be in-memory queue occupancy becomes backlog depth plus the age of the oldest message. And priority shedding usually turns into separate queues per class, with the consumer reading the batch one only when the interactive one is empty.',
    },
  ],
  conclusion: {
    title: 'Controlled loss beats silent collapse',
    description:
      'The unbounded queue does not absorb overload, it only picks a worse moment to fail, when memory has run out and the accepted work is lost with it. Backpressure trades that collapse for a declared degradation: a queue with a ceiling, a regime measured with hysteresis, a shedding policy written before the incident, a signal that travels up to the edge and metrics that separate what was refused from what was processed after expiring. The system still says no when it cannot cope, but it starts saying so early, with an estimated wait and while protecting whoever has a human waiting on the other side.',
    cta: 'Talk about load control in my AI pipeline',
  },
  related: [
    { label: 'Rate limit and priority queue for LLM APIs', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Timeout and cancellation across a chain of LLM calls', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-pipeline-backpressure-mini', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'El pipeline funciona bien en la prueba y se rompe en la campaña. La causa casi nunca es el código de procesamiento: es la diferencia de velocidad entre quien produce y quien consume. El webhook acepta mil mensajes por minuto porque aceptar es barato, y la etapa que llama al modelo procesa cien por minuto porque el modelo tarda. Mientras la diferencia sea pequeña y pasajera, la cola la absorbe. Cuando la diferencia es sostenida, la cola no absorbe nada: solo aplaza, y el aplazamiento tiene un precio que aparece de golpe. La memoria sube, la latencia del último ítem que entró se vuelve minutos, y cuando el proceso finalmente muere se lleva todo lo que estaba encolado, incluido el trabajo que ya había sido aceptado y prometido al cliente. El backpressure es el mecanismo que evita esto: en vez de aceptar todo y sufrir después, el consumidor le comunica al productor que no da abasto, y el sistema desacelera en el origen. Este artículo muestra cómo implementar esa comunicación: por qué la cola ilimitada es una bomba de tiempo, cómo medir presión de un modo que no oscile, qué políticas de descarte existen y cuándo cada una es la correcta, cómo propagar la señal por una cadena de etapas y qué medir para saber si el freno funciona o solo esconde el problema.',
  sections: [
    {
      title: 'La cola ilimitada es un aplazamiento, no una solución',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición de que una cola resuelve el desajuste de velocidad es correcta, pero solo para un desajuste temporal. Una cola es un amortiguador: absorbe la diferencia entre producción y consumo durante un intervalo, contando con un período posterior en que el consumidor es más rápido que el productor y drena la acumulación. Si la tasa media de producción es mayor que la tasa media de consumo, ningún tamaño de cola lo resuelve, porque no existe momento de drenaje. La cola solo crece. Lo que cambia con el tamaño es cuándo aparece el problema, no si aparece.',
        },
        {
          type: 'paragraph',
          value:
            'El detalle cruel es que una cola creciendo empeora activamente el sistema antes de tumbarlo. Cada ítem encolado ocupa memoria, y en un pipeline de IA los ítems no son pequeños: llevan el historial de la conversación, el contexto recuperado, los adjuntos. Mil ítems de cien kilobytes son cien megabytes de heap que el recolector de basura debe barrer en cada ciclo, y la presión de GC vuelve más lento al consumidor, lo que hace crecer la cola más rápido, lo que aumenta la presión de GC. El sistema entra en una espiral en la que el propio intento de absorber la carga es lo que reduce la capacidad de procesarla.',
        },
        {
          type: 'paragraph',
          value:
            'Y está el costo que nadie contabiliza: el trabajo encolado envejece. Un mensaje que espera ocho minutos en una cola para después ser procesado genera una respuesta que llega cuando el cliente ya salió de la conversación, ya llamó por teléfono o ya desistió. Gastaste tokens, gastaste tiempo de máquina y produjiste una respuesta que no vale nada. Procesar un ítem vencido es peor que haberlo rechazado en la entrada, porque el rechazo es barato y honesto, mientras que el procesamiento tardío cuesta dinero y encima entrega una mala experiencia.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Qué pasa en la sobrecarga sostenida', 'Cómo falla el sistema', 'Qué ve el cliente'],
          rows: [
            [
              'Cola ilimitada en memoria',
              'El heap crece, el GC presiona, el consumo desacelera',
              'El proceso muere y pierde todo lo que estaba encolado',
              'Sistema caído sin aviso previo',
            ],
            [
              'Cola limitada sin política',
              'La cola se llena y el enqueue empieza a fallar',
              'Error genérico en un punto arbitrario del código',
              'Falla aleatoria, crítico y lote tratados igual',
            ],
            [
              'Cola limitada con descarte ciego',
              'Lo que llega después se tira',
              'Pérdida silenciosa, sin registro de lo que cayó',
              'El mensaje desaparece sin explicación ni retorno',
            ],
            [
              'Cola limitada con backpressure declarado',
              'El productor desacelera, se rechaza el lote, pasa lo crítico',
              'Degradación anunciada y reversible',
              'Espera estimada o rechazo rápido con retorno claro',
            ],
          ],
        },
      ],
    },
    {
      title: 'Medir presión sin oscilar: histéresis y regímenes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El backpressure empieza con una medida. La más directa es la ocupación de la cola: cuántos ítems esperan dividido por el techo configurado. Es mejor que medir CPU o memoria porque la ocupación responde de inmediato al desajuste, mientras que una CPU alta puede significar simplemente trabajo útil en curso y la memoria alta es un indicador atrasado, que ya llega demasiado tarde.',
        },
        {
          type: 'paragraph',
          value:
            'La trampa aparece al transformar la medida en decisión. Si la regla es "por encima del sesenta por ciento, rechazar lote", una cola oscilando en torno al sesenta por ciento hace que el sistema alterne entre aceptar y rechazar en cada ítem, y el productor recibe una señal que cambia de segundo en segundo, imposible de seguir. La corrección es la histéresis: el régimen sube cuando la presión cruza el umbral, pero solo baja cuando cae por debajo del umbral menos un margen. Es el mismo principio del termostato, que no enciende y apaga el compresor cada décima de grado. Con histéresis, el productor recibe un régimen lo bastante estable para actuar sobre él.',
        },
        {
          type: 'paragraph',
          value:
            'Tres regímenes cubren prácticamente todo caso real, y el valor de nombrarlos es que cada uno lleva una política declarada, escrita antes del incidente, en vez de una decisión improvisada durante él.',
        },
        {
          type: 'table',
          columns: ['Régimen', 'Ocupación típica', 'Qué se admite', 'Señal al productor'],
          rows: [
            [
              'Normal',
              'Por debajo del 60 por ciento',
              'Todo el tráfico, interactivo y lote',
              'Ninguna, el productor sigue su ritmo',
            ],
            [
              'Degradado',
              'Entre 60 y 85 por ciento',
              'Interactivo y lote de prioridad media',
              'Reducir a la mitad la concurrencia del lote',
            ],
            [
              'Crítico',
              'Por encima del 85 por ciento',
              'Solo interactivo con un humano esperando',
              'Pausar el lote y respetar el Retry-After',
            ],
          ],
        },
        {
          type: 'code',
          value: `// src/pressure-gauge.js
// Medidor de presion con histeresis: sube en el umbral lleno, pero solo
// baja cuando la presion cae por debajo del umbral menos el margen. Sin
// esto el regimen parpadea en la frontera y el productor no puede reaccionar.

export const NORMAL = 'normal';
export const DEGRADED = 'degraded';
export const CRITICAL = 'critical';

export class PressureGauge {
  constructor({ degradedAt = 0.6, criticalAt = 0.85, hysteresis = 0.1 } = {}) {
    if (!(degradedAt < criticalAt)) {
      throw new Error('degradedAt debe ser menor que criticalAt');
    }
    this.degradedAt = degradedAt;
    this.criticalAt = criticalAt;
    this.hysteresis = hysteresis;
    this.state = NORMAL;
  }

  update(pressure) {
    if (this.state === NORMAL && pressure >= this.degradedAt) {
      this.state = pressure >= this.criticalAt ? CRITICAL : DEGRADED;
      return this.state;
    }

    if (this.state === DEGRADED) {
      if (pressure >= this.criticalAt) this.state = CRITICAL;
      else if (pressure < this.degradedAt - this.hysteresis) this.state = NORMAL;
      return this.state;
    }

    if (this.state === CRITICAL && pressure < this.criticalAt - this.hysteresis) {
      this.state = pressure >= this.degradedAt ? DEGRADED : NORMAL;
    }

    return this.state;
  }

  // Prioridad maxima aceptada en cada regimen (numero menor = mas urgente).
  admissionCeiling() {
    if (this.state === CRITICAL) return 1;
    if (this.state === DEGRADED) return 5;
    return Number.POSITIVE_INFINITY;
  }
}`,
        },
      ],
    },
    {
      title: 'Políticas de descarte: elegir qué perder antes de perderlo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando la cola se llena, algo se va a perder. Eso no es opcional, es aritmética: si entran mil y salen cien, novecientos quedan fuera de un modo u otro. La única elección real es entre decidir qué perder o dejar que el agotamiento de recursos decida por vos. La primera opción produce una pérdida controlada y registrada; la segunda produce una pérdida arbitraria y silenciosa, normalmente del trabajo más caro, porque es lo que estaba en procesamiento cuando el proceso murió.',
        },
        {
          type: 'paragraph',
          value:
            'Tres políticas cubren la mayoría de los casos, y la elección no es técnica, es de negocio. Rechazar en la entrada es la política correcta cuando el productor puede retener el trabajo e intentar de nuevo después, como un webhook que devuelve 429 y confía en el reintento del remitente. Descartar el más antiguo es la política correcta cuando el dato envejece y el valor está en el más fresco, como un flujo de telemetría donde la medición de ahora vale más que la de hace dos minutos. Descartar el de menor prioridad es la política correcta cuando clases distintas conviven en la misma cola y una de ellas tiene un humano esperando del otro lado.',
        },
        {
          type: 'code',
          value: `// src/bounded-queue.js
// Cola limitada con politica de admision explicita.
// Nunca crece mas alla de maxSize: cuando esta llena, decide que perder
// en vez de dejar que la memoria decida por ella.

export const ADMITTED = 'admitted';
export const REJECTED = 'rejected';
export const SHED = 'shed';

export class BoundedQueue {
  constructor({ maxSize, policy = 'reject' }) {
    if (!Number.isInteger(maxSize) || maxSize < 1) {
      throw new Error('maxSize debe ser un entero mayor que cero');
    }
    this.maxSize = maxSize;
    this.policy = policy;
    this.items = [];
    this.stats = { admitted: 0, rejected: 0, shed: 0 };
  }

  get pressure() {
    return this.items.length / this.maxSize;
  }

  enqueue(item, priority = 5) {
    const entry = { item, priority, enqueuedAt: Date.now() };

    if (this.items.length < this.maxSize) {
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      return { outcome: ADMITTED, dropped: null };
    }

    if (this.policy === 'drop-oldest') {
      const dropped = this.removeOldest();
      this.insertByPriority(entry);
      this.stats.admitted += 1;
      this.stats.shed += 1;
      return { outcome: SHED, dropped: dropped.item };
    }

    if (this.policy === 'drop-lowest') {
      const worst = this.items[this.items.length - 1];
      // Solo descarta si el recien llegado es realmente mas urgente que el
      // peor de la cola, si no la cola se vuelve un carrusel sin progreso.
      if (worst.priority > priority) {
        this.items.pop();
        this.insertByPriority(entry);
        this.stats.admitted += 1;
        this.stats.shed += 1;
        return { outcome: SHED, dropped: worst.item };
      }
      this.stats.rejected += 1;
      return { outcome: REJECTED, dropped: null };
    }

    this.stats.rejected += 1;
    return { outcome: REJECTED, dropped: null };
  }

  insertByPriority(entry) {
    // Insercion estable: entre prioridades iguales vale el orden de llegada.
    let index = this.items.length;
    while (index > 0 && this.items[index - 1].priority > entry.priority) {
      index -= 1;
    }
    this.items.splice(index, 0, entry);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que separa una implementación correcta de una que se sabotea está en la política drop-lowest: el intercambio solo ocurre si el recién llegado es estrictamente más urgente que el peor ítem ya encolado. Sin esa comparación, una ráfaga de ítems de la misma prioridad hace que la cola descarte y readmita sus propios ítems sin parar, gastando trabajo para no avanzar nada. Es el tipo de bug que solo aparece bajo carga, exactamente cuando menos querés descubrirlo.',
        },
      ],
    },
    {
      title: 'Devolver la presión al productor, no solo absorberla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Limitar la cola protege al proceso, pero todavía no es backpressure. El backpressure es la señal que sube: el consumidor necesita comunicarle al productor que está saturado, y el productor necesita hacer algo con esa información. Sin ese retorno, cambiaste un proceso que muere por un proceso sano que rechaza todo, lo cual es mejor, pero todavía muy lejos de lo ideal, porque el productor sigue martillando a la misma velocidad y desperdiciando trabajo en intentos que serán rechazados.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que forma esa señal depende del transporte, pero la información es siempre la misma: hubo un rechazo, y cuánto esperar antes de intentar de nuevo. En una API HTTP, es el 429 con Retry-After. En una cola de mensajes con confirmación manual, es dejar de buscar nuevos lotes mientras los anteriores no estén confirmados, que es el prefetch limitado de AMQP o la pausa de consumo de Kafka. Dentro del mismo proceso, es la promesa devuelta por el write de un stream, o simplemente esperar antes del siguiente submit. El error común es responder al rechazo con un valor fijo de espera: cinco segundos al azar hacen que todos los productores vuelvan juntos, sincronizados, en un efecto manada que recrea el pico. El valor correcto deriva de la cola real, del trabajo pendiente dividido por el caudal del consumidor.',
        },
        {
          type: 'diagram',
          value: `  productor                      etapa con backpressure
     |                                    |
     |  submit(job, prioridad)            |
     |----------------------------------->|
     |                             [ mide ocupacion de la cola ]
     |                             [ actualiza regimen c/ histeresis ]
     |                                    |
     |                          prioridad <= techo del regimen?
     |                                    |
     |            <---- admitido ---------+ si
     |                                    |
     |            <-- rechazado + espera -+ no
     |                                    |
     |  desacelera en el origen           v
     |  (pausa lote, mantiene interactivo) consumidor
     |                                   concurrencia limitada
     v                                        |
  produce menos <---- regimen critico --------+`,
        },
        {
          type: 'code',
          value: `// src/pipeline.js
// Etapa con backpressure explicito: concurrencia limitada en el consumidor,
// cola limitada en el medio y resultado de admision devuelto al productor.

export class BackpressureStage {
  constructor({ handler, concurrency = 2, maxQueueSize = 10, policy = 'reject', gauge }) {
    this.handler = handler;
    this.concurrency = concurrency;
    this.queue = new BoundedQueue({ maxSize: maxQueueSize, policy });
    this.gauge = gauge || new PressureGauge();
    this.inFlight = 0;
    this.metrics = { processed: 0, failed: 0, rejected: 0, shed: 0, maxQueueSeen: 0 };
  }

  submit(job, priority = 5) {
    const state = this.gauge.update(this.queue.pressure);

    // El techo del regimen cierra la puerta al lote antes de que sufra
    // el trafico interactivo.
    if (priority > this.gauge.admissionCeiling()) {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }

    const admission = this.queue.enqueue(job, priority);
    if (admission.outcome === 'rejected') {
      this.metrics.rejected += 1;
      return { outcome: 'rejected', state, retryAfterMs: this.retryAfterMs() };
    }
    if (admission.outcome === 'shed') this.metrics.shed += 1;

    this.metrics.maxQueueSeen = Math.max(this.metrics.maxQueueSeen, this.queue.size);
    this.pump();
    return { outcome: admission.outcome, state, dropped: admission.dropped };
  }

  // Espera estimada a partir de la cola real y del caudal configurado,
  // en vez de un valor fijo que sincroniza a todos los productores.
  retryAfterMs(perItemMs = 200) {
    return Math.ceil(((this.queue.size + 1) / this.concurrency) * perItemMs);
  }

  pump() {
    while (this.inFlight < this.concurrency && this.queue.size > 0) {
      const job = this.queue.dequeue();
      this.inFlight += 1;
      Promise.resolve()
        .then(() => this.handler(job))
        .then(() => { this.metrics.processed += 1; })
        .catch(() => { this.metrics.failed += 1; })
        .finally(() => {
          this.inFlight -= 1;
          this.gauge.update(this.queue.pressure);
          this.pump();
        });
    }
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en que la concurrencia limitada en el consumidor es parte esencial del diseño, y no un detalle. Si el pump disparara todos los ítems de la cola de una vez, la cola se vaciaría al instante, la presión medida caería a cero y el medidor diría que está todo bien mientras mil llamadas simultáneas estarían en vuelo contra el proveedor. La cola solo es un sensor honesto de presión porque existe un límite de trabajo en vuelo que retiene los ítems en ella.',
        },
      ],
    },
    {
      title: 'Propagar la señal por una cadena de etapas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un pipeline real tiene varias etapas en secuencia: recibe el mensaje, normaliza, recupera el contexto, llama al modelo, valida la salida, entrega. Cada una tiene un caudal distinto, y el cuello de botella es la más lenta, normalmente la llamada al modelo. El error clásico es poner backpressure solo en esa etapa: las anteriores siguen aceptando todo, acumulan en sus propias colas, y el problema apenas se muda de lugar, saliendo de la etapa lenta hacia las que vienen antes de ella.',
        },
        {
          type: 'paragraph',
          value:
            'La regla es que la señal necesita subir la cadena hasta llegar al borde, el punto donde el sistema habla con el mundo externo y puede legítimamente decir que no. Cada etapa observa la presión de la etapa siguiente antes de aceptar más trabajo, y la primera etapa traduce la presión acumulada en una respuesta al llamador. Es el inverso del flujo de datos: los datos bajan de la primera a la última, la señal de presión sube de la última a la primera.',
        },
        {
          type: 'ordered',
          items: [
            'Cada etapa expone su propia presión como un número entre cero y uno, derivado de la ocupación de la cola más el trabajo en vuelo.',
            'Antes de aceptar un ítem, la etapa consulta la presión de la etapa siguiente y usa el mayor valor entre la propia y la de ella como presión efectiva.',
            'El borde traduce la presión efectiva en respuesta al llamador: acepta, acepta con aviso de degradación o rechaza con espera estimada.',
            'El trabajo de lote consulta la presión antes de traer el siguiente bloque y reduce el tamaño del bloque en el régimen degradado, pausando en el crítico.',
            'Ninguna etapa intermedia tiene cola ilimitada, porque un único buffer sin techo en el medio de la cadena anula la señal de todas las demás.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Hay un caso en que el borde no puede decir que no: cuando el productor es un webhook externo que va a desistir y considerar el mensaje perdido si lo rechazás. Ahí la respuesta correcta no es aceptar en memoria, es persistir de inmediato en almacenamiento durable y responder 200 sobre el registro persistido, transformando la cola en memoria en una cola en disco que sobrevive a la caída del proceso. La presión sigue existiendo y sigue siendo medida, pero pasa a medirse sobre la cola durable, y el backlog se vuelve un número visible en vez de heap invisible.',
        },
      ],
    },
    {
      title: 'Métricas que dicen si el freno funciona o solo esconde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un backpressure implementado sin métrica se vuelve un mecanismo que descarta trabajo en silencio, que es una forma distinta del mismo problema. Contar solo el total procesado no revela nada, porque un sistema que rechaza el noventa por ciento de la carga y procesa el diez por ciento rápidamente parece sano en latencia media. Las métricas necesitan separar lo que fue aceptado de lo que fue rechazado y mostrar el costo de cada decisión.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Cómo medir', 'Qué revela', 'Cuándo actuar'],
          rows: [
            [
              'Tasa de rechazo por clase',
              'Rechazados sobre enviados, separado por prioridad',
              'Si el freno protege lo crítico o golpea a todos',
              'Cualquier rechazo en la clase interactiva',
            ],
            [
              'Ocupación de la cola en el percentil 95',
              'Muestrear el tamaño de la cola periódicamente',
              'Si el techo está muy apretado o muy holgado',
              'Por encima del 80 por ciento de forma sostenida',
            ],
            [
              'Edad del ítem más antiguo',
              'Ahora menos el instante de entrada en la cola',
              'Si la cola avanza o si hay trabajo trabado',
              'Edad por encima de la validez del ítem',
            ],
            [
              'Tiempo en régimen degradado o crítico',
              'Sumar la duración de cada régimen por hora',
              'Si la capacidad es insuficiente y no es un pico',
              'Más del diez por ciento de la hora fuera de lo normal',
            ],
            [
              'Trabajo vencido procesado',
              'Ítems concluidos después de la validez de negocio',
              'Token gastado para producir una respuesta inútil',
              'Cualquier valor distinto de cero',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila merece destaque porque es la que más sorprende a quien instrumenta por primera vez. Un pipeline con cola generosa suele tener una porción relevante de ítems concluidos después de que ya no importaban: la respuesta lista para una conversación cerrada, el resumen generado para una atención ya transferida. Esos ítems consumieron cuota, costaron dinero y ocuparon el lugar de trabajo útil. Medir esto suele ser el argumento más convincente para reducir el tamaño de la cola, porque transforma una discusión de arquitectura en una línea de la factura.',
        },
        {
          type: 'paragraph',
          value:
            'La lectura conjunta es lo que da el diagnóstico. Rechazo alto con ocupación baja significa un techo de admisión calibrado de forma demasiado conservadora. Rechazo bajo con ocupación siempre en el tope significa que la cola es demasiado grande y estás acumulando latencia en vez de señalizar. Tiempo en régimen crítico creciendo semana tras semana no es un problema de configuración: es falta de capacidad, y ningún ajuste de umbral lo resuelve, solo más consumidores o un modelo más rápido en el cuello de botella.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es el tamaño correcto para la cola?',
      answer:
        'El tamaño correcto deriva del tiempo máximo de espera que el ítem tolera, no de un número redondo. Multiplicá el caudal del consumidor por la validez de negocio del ítem: si la etapa procesa diez ítems por segundo y una respuesta pierde valor después de treinta segundos, el techo útil es trescientos, porque cualquier ítem más allá de eso será concluido después de vencer. Colas mayores que ese producto no aumentan la capacidad, solo transforman un rechazo rápido en procesamiento tardío, que cuesta igual y entrega menos. Si el cálculo da un número demasiado pequeño para tu tráfico, el problema es de capacidad y no de configuración.',
    },
    {
      question: '¿El backpressure no es solo rechazar la petición con un 429?',
      answer:
        'El 429 es una de las formas de expresar la señal, pero el backpressure es el mecanismo entero: medir la saturación real del consumidor, decidir la admisión por clase de tráfico, informar cuánto esperar en base a la cola real y hacer que el productor actúe sobre ese retorno. Devolver un 429 sin medir nada es adivinar el límite, y devolver un Retry-After fijo sincroniza a todos los clientes en un efecto manada que recrea el pico enseguida. La diferencia práctica está en que el número venga del estado observado del sistema en vez de una constante elegida cuando se escribió el endpoint.',
    },
    {
      question: '¿Cómo aplicar esto cuando el consumo viene de una cola gestionada?',
      answer:
        'Con SQS, RabbitMQ o Kafka el buffer ya es externo y durable, lo que resuelve la parte de no perder trabajo en la caída del proceso, pero no elimina el backpressure: lo cambia de lugar. El control pasa a ser cuántos mensajes trae el consumidor de una vez, el prefetch de AMQP o el máximo de registros por poll, y la decisión de pausar el consumo cuando la etapa siguiente satura. La señal que antes era ocupación de la cola en memoria se vuelve profundidad del backlog más edad del mensaje más antiguo. Y el descarte por prioridad normalmente se vuelve colas separadas por clase, con el consumidor leyendo la de lote solo cuando la interactiva está vacía.',
    },
  ],
  conclusion: {
    title: 'La pérdida controlada vale más que el colapso silencioso',
    description:
      'La cola ilimitada no absorbe la sobrecarga, solo elige un momento peor para fallar, cuando la memoria se acabó y el trabajo aceptado se pierde junto. El backpressure cambia ese colapso por una degradación declarada: cola con techo, régimen medido con histéresis, política de descarte escrita antes del incidente, señal que sube hasta el borde y métricas que separan lo que fue rechazado de lo que fue procesado después de vencer. El sistema sigue diciendo que no cuando no da abasto, pero pasa a decirlo temprano, con un plazo estimado y protegiendo a quien tiene un humano esperando del otro lado.',
    cta: 'Hablar sobre control de carga en mi pipeline de IA',
  },
  related: [
    { label: 'Rate limit y cola de prioridad para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Timeout y cancelación en una cadena de llamadas de LLM', to: '/blog/timeout-cancelamento-cadeia-chamadas-llm' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'ai-pipeline-backpressure-mini', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
