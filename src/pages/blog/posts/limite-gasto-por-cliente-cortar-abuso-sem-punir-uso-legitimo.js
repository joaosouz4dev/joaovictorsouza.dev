// Conteudo do artigo: limite de gasto por cliente, cortar o abuso sem punir o uso legitimo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Um cliente de plano básico gastou em três dias o equivalente a onze meses da mensalidade dele. Ninguém invadiu nada: ele plugou o seu endpoint num script próprio que reprocessa o catálogo inteiro a cada hora, e o seu sistema aceitou tudo porque nunca lhe foi ensinado a dizer não. A reação instintiva é baixar um teto de requisições por minuto para todo mundo, e essa é justamente a decisão que transforma um problema de um cliente em degradação de todos os outros. Limite de gasto é um assunto diferente de rate limit, porque o recurso escasso não é vazão, é dinheiro, e dinheiro se acumula ao longo do mês em vez de se renovar a cada segundo. Este artigo mostra como construir esse controle: por que contar requisições é a métrica errada, como usar orçamento em dinheiro com reserva antes da chamada e acerto depois, onde a contabilidade eventualmente consistente quebra e quanto isso custa, como separar abuso de crescimento legítimo antes de bloquear, o que fazer quando o teto é atingido no meio de uma conversa e como avisar o cliente cedo o bastante para ele não descobrir pelo erro.',
  sections: [
    {
      title: 'Rate limit protege a infraestrutura, teto de gasto protege a margem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois controles parecem o mesmo mecanismo porque ambos terminam em recusar uma requisição, mas defendem coisas diferentes e falham de formas diferentes. O rate limit existe para que nenhum cliente monopolize a capacidade e derrube o serviço para os demais: a janela é curta, de segundos ou minutos, e o recurso se renova sozinho. O teto de gasto existe para que nenhum cliente consuma mais dinheiro do que a relação comercial com ele suporta: a janela é o ciclo de faturamento, e o recurso consumido não volta. Um cliente pode respeitar perfeitamente cinco requisições por segundo durante trinta dias seguidos e ainda assim gerar um prejuízo, porque cinco requisições por segundo com contexto longo é uma fatura de cinco dígitos.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a unidade contada precisa mudar. Rate limit conta eventos, e todo evento vale o mesmo. Teto de gasto precisa contar dinheiro, e nesse mundo duas requisições idênticas na forma podem diferir em cinquenta vezes no custo: uma pergunta curta respondida por um modelo pequeno contra uma conversa longa que arrasta oito trechos de RAG e ainda chama três ferramentas. Se você tenta aproximar dinheiro por contagem de requisições, precisa calibrar o teto pela requisição mais cara possível, o que pune quem só faz perguntas baratas, ou pela média, o que deixa passar exatamente o padrão de uso que gera o prejuízo. Não existe número de requisições que resolva isso, porque a variável que importa não está sendo medida.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Rate limit', 'Teto de gasto'],
          rows: [
            [
              'O que protege',
              'Capacidade e latência dos outros clientes',
              'Margem do contrato e previsibilidade da fatura',
            ],
            [
              'Unidade contada',
              'Requisições ou tokens por janela curta',
              'Dinheiro acumulado no ciclo de faturamento',
            ],
            [
              'Janela',
              'Segundos a minutos, renova sozinha',
              'Dias a um mês, não renova até o fechamento',
            ],
            [
              'Custo de errar para menos',
              'Cliente vê lentidão momentânea',
              'Prejuízo permanente, já foi pago ao provedor',
            ],
            [
              'Custo de errar para mais',
              'Um cliente degrada os demais',
              'Cliente legítimo é bloqueado e cancela o plano',
            ],
            [
              'Reação certa ao estourar',
              'Enfileirar ou pedir para tentar depois',
              'Degradar para modelo barato ou pedir aprovação',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reservar antes de chamar e acertar depois, porque o custo real só existe no fim',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O ponto que quebra a implementação ingênua é temporal: você precisa decidir se autoriza a chamada antes de saber quanto ela vai custar. O custo exato só aparece na resposta do provedor, com a contagem real de tokens de entrada, de saída e de cache, e a essa altura o dinheiro já foi gasto. Debitar apenas depois da resposta cria uma janela em que dez requisições paralelas do mesmo cliente passam todas pela verificação enquanto o saldo ainda está intacto, e o estouro só aparece quando as dez retornam. Em atendimento com resposta longa, essa janela dura segundos, tempo suficiente para um script agressivo furar um teto por uma margem grande.',
        },
        {
          type: 'paragraph',
          value:
            'A solução é o mesmo padrão de reserva usado em pagamento com cartão: antes da chamada você estima um teto de custo e reserva esse valor no orçamento do cliente de forma atômica; depois da resposta, substitui a reserva pelo custo real e devolve a diferença. A estimativa não precisa ser exata, precisa ser conservadora: tokens de entrada você já conhece exatamente, porque o prompt está montado na sua mão, e a saída você limita com max tokens, que é justamente o teto que torna a estimativa possível. Se a chamada falhar ou for cancelada, a reserva expira e volta ao saldo. O efeito é que dez requisições paralelas competem pelo mesmo saldo reservado e a décima é recusada antes de gastar, não depois.',
        },
        {
          type: 'code',
          value: `// spend-budget.js
// Orcamento de gasto por cliente com reserva atomica antes da chamada
// e acerto pelo custo real depois. Estado no Redis: um hash por cliente
// e ciclo, com o consumido confirmado e o total reservado em aberto.

import { randomUUID } from 'node:crypto';

// Estimativa conservadora: entrada e exata, saida usa o teto de maxTokens.
export const estimateCostCents = ({ model, inputTokens, maxTokens, prices }) => {
  const price = prices[model];
  if (!price) throw new Error(\`Sem preco cadastrado para o modelo \${model}\`);
  const input = (inputTokens / 1_000_000) * price.inputPerMillionCents;
  const output = (maxTokens / 1_000_000) * price.outputPerMillionCents;
  return Math.ceil(input + output);
};

// Reserva e acerto em Lua para que a leitura do saldo e a escrita da
// reserva sejam um passo so: sem isso, requisicoes concorrentes leem o
// mesmo saldo livre e todas se autorizam.
const RESERVE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local limit = tonumber(ARGV[1])
  local amount = tonumber(ARGV[2])
  local reservationId = ARGV[3]
  local ttl = tonumber(ARGV[4])

  local spent = tonumber(redis.call('HGET', key, 'spent') or '0')
  local reserved = tonumber(redis.call('HGET', key, 'reserved') or '0')

  if spent + reserved + amount > limit then
    return {0, spent, reserved}
  end

  redis.call('HINCRBY', key, 'reserved', amount)
  redis.call('HSET', reservationsKey, reservationId, amount)
  redis.call('EXPIRE', reservationsKey, ttl)
  return {1, spent, reserved + amount}
\`;

// O acerto e sempre relativo a reserva registrada: se a reserva ja tiver
// expirado, o custo real ainda precisa entrar no consumido, senao o
// gasto some da contabilidade justamente nas chamadas mais lentas.
const SETTLE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local reservationId = ARGV[1]
  local actual = tonumber(ARGV[2])

  local reserved = tonumber(redis.call('HGET', reservationsKey, reservationId) or '0')
  if reserved > 0 then
    redis.call('HINCRBY', key, 'reserved', -reserved)
    redis.call('HDEL', reservationsKey, reservationId)
  end
  redis.call('HINCRBY', key, 'spent', actual)
  return redis.call('HGET', key, 'spent')
\`;

export class SpendBudget {
  constructor(redis, { reservationTtlSeconds = 300 } = {}) {
    this.redis = redis;
    this.reservationTtlSeconds = reservationTtlSeconds;
  }

  #keys(tenantId, cycle) {
    return [\`budget:\${tenantId}:\${cycle}\`, \`budget:\${tenantId}:\${cycle}:reservations\`];
  }

  async reserve({ tenantId, cycle, limitCents, amountCents }) {
    const reservationId = randomUUID();
    const [ok, spent, reserved] = await this.redis.eval(
      RESERVE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      String(limitCents),
      String(amountCents),
      reservationId,
      String(this.reservationTtlSeconds),
    );

    if (ok !== 1) {
      return { granted: false, spentCents: spent, reservedCents: reserved };
    }
    return { granted: true, reservationId, spentCents: spent, reservedCents: reserved };
  }

  async settle({ tenantId, cycle, reservationId, actualCents }) {
    const spent = await this.redis.eval(
      SETTLE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      reservationId,
      String(actualCents),
    );
    return Number(spent);
  }

  // Chamada abortada ou falha antes de consumir token: devolve a reserva
  // sem debitar nada. Sem isso, timeout do provedor come o orcamento do
  // cliente por ate reservationTtlSeconds.
  async release({ tenantId, cycle, reservationId }) {
    return this.settle({ tenantId, cycle, reservationId, actualCents: 0 });
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes desse código costumam ser descobertos em produção da forma cara. O primeiro é o TTL da reserva: ele precisa ser maior que o timeout máximo da chamada ao modelo, senão a reserva expira enquanto a resposta ainda está em streaming e o acerto tenta descontar algo que já sumiu, inflando o consumido em dobro. O segundo é o acerto quando a reserva já expirou: o custo real precisa entrar no consumido de qualquer forma, porque o dinheiro foi gasto, e o erro comum é tratar reserva ausente como chamada não realizada e simplesmente ignorar o débito, o que faz o gasto desaparecer exatamente nas chamadas mais longas, que são as mais caras.',
        },
      ],
    },
    {
      title: 'Consistência do contador: onde vale gastar coordenação e onde não vale',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A verificação atômica acima resolve a corrida dentro de uma instância de Redis, e é comum o sistema estar distribuído em mais de uma região com réplicas locais para latência. Nesse cenário, insistir em consistência forte global significa que cada mensagem de atendimento paga uma ida e volta entre regiões antes de chamar o modelo, o que adiciona dezenas de milissegundos a um caminho que já é lento. A pergunta correta não é como tornar o contador perfeitamente consistente, é quanto de estouro você aceita em troca de latência, porque essa é a moeda real da negociação.',
        },
        {
          type: 'paragraph',
          value:
            'O desenho que costuma equilibrar bem é o de cotas locais com sincronização periódica: cada região recebe uma fatia do orçamento restante e opera contra ela sem coordenação, devolvendo o não usado e pedindo mais quando a fatia baixa de um piso. O estouro máximo passa a ser limitado e calculável, aproximadamente a soma das fatias em voo, e você escolhe o tamanho da fatia por perfil de cliente: fatia pequena para quem está perto do teto, fatia grande para quem está no começo do ciclo. Perto do limite, o sistema aperta a coordenação automaticamente, e é justamente aí que a exatidão importa. Longe do limite, ninguém precisa pagar por precisão que não muda decisão alguma.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Estouro possível', 'Custo de latência', 'Quando usar'],
          rows: [
            [
              'Contador único forte',
              'Praticamente zero',
              'Uma ida e volta a cada chamada, cross-region se houver',
              'Teto rígido contratual ou cliente pré-pago sem crédito',
            ],
            [
              'Cotas locais com sincronização',
              'Limitado pela soma das fatias em voo',
              'Desprezível no caminho quente',
              'Padrão para a maioria dos planos com pós-pago',
            ],
            [
              'Débito assíncrono pós-resposta',
              'Alto sob concorrência',
              'Nenhum',
              'Apenas para alerta e relatório, nunca para bloqueio',
            ],
            [
              'Fatia adaptativa por proximidade',
              'Grande longe do teto, mínimo perto dele',
              'Cresce só nos últimos por cento do orçamento',
              'Quando latência e exatidão importam nos dois extremos',
            ],
          ],
        },
      ],
    },
    {
      title: 'Separar abuso de crescimento legítimo antes de bloquear qualquer coisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O teto sozinho não distingue o cliente que descobriu valor no produto e triplicou o uso do cliente que apontou um script mal escrito para o seu endpoint. Os dois aparecem como a mesma curva subindo, e bloquear os dois do mesmo jeito custa caro nos dois sentidos: perder o cliente que ia expandir o contrato é pior do que absorver o prejuízo de um mês. A distinção não está no volume, está na forma do consumo, e existem sinais baratos de calcular que separam bem os dois casos.',
        },
        {
          type: 'list',
          items: [
            'Diversidade de conteúdo: abuso automatizado costuma repetir o mesmo prompt ou variações triviais dele, então uma taxa alta de acerto no cache semântico com gasto crescente é sinal de laço, não de adoção.',
            'Distribuição no tempo: uso humano tem vale noturno e queda no fim de semana, enquanto script tem consumo plano vinte e quatro horas por dia, e o desvio padrão por hora do dia denuncia isso sem nenhum modelo.',
            'Razão entre conversas e usuários: crescimento legítimo aumenta os dois juntos, abuso aumenta conversas com o mesmo punhado de identificadores de usuário.',
            'Desfecho das conversas: adoção real produz resolução e conversas que terminam, enquanto laço produz conversas abandonadas no meio e uma taxa de transbordo que não muda mesmo com o volume dobrando.',
            'Tamanho médio de contexto: salto súbito no comprimento do prompt sem mudança de produto do lado do cliente costuma indicar integração nova despejando documento inteiro em cada turno.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esses sinais não precisam decidir sozinhos: eles decidem qual caminho o estouro toma. Cliente com perfil de crescimento legítimo que bate o teto merece continuar atendido com custo degradado enquanto o time comercial é acionado no mesmo dia. Cliente com perfil de laço automatizado que bate o teto merece corte imediato do fluxo caro, porque cada minuto adicional é prejuízo puro sem contrapartida. A pior configuração possível é a que trata os dois igual, e ela é a configuração padrão de quem só implementou um número máximo.',
        },
      ],
    },
    {
      title: 'O que acontece quando o teto é atingido no meio de uma conversa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Devolver um erro de cota excedida no meio de um atendimento é a resposta tecnicamente correta e comercialmente péssima, porque quem paga o preço é o consumidor final do seu cliente, que não tem relação nenhuma com o contrato estourado. A conversa em andamento merece tratamento diferente da conversa nova: cortar a que já começou desperdiça todo o custo já gasto nela e ainda entrega uma experiência quebrada, enquanto recusar a abertura de uma nova é contido e explicável. O corte também deve ser gradual em vez de binário, e a degradação pode acontecer bem antes do teto.',
        },
        {
          type: 'diagram',
          value: `Consumo do orcamento no ciclo
0%                    70%        85%        100%      110%
|----------------------|----------|----------|---------|
   normal              aviso      degradado   fila     corte

  normal      modelo padrao, contexto completo, todas as ferramentas
  aviso       identico ao normal, mais alerta ao admin do cliente
  degradado   modelo barato, contexto curto, cache semantico agressivo
  fila        conversa nova espera ou vai direto para o humano
  corte       so conversa em andamento termina, nova e recusada

Regra de transicao
  desce de nivel  na hora, assim que o consumo cruza o limiar
  sobe de nivel   so no proximo ciclo ou apos aumento explicito de teto
  conversa ativa  mantem o nivel em que comecou ate o desfecho`,
        },
        {
          type: 'paragraph',
          value:
            'A regra de manter a conversa no nível em que ela começou tem um motivo prático: alternar de modelo no meio de um atendimento produz uma quebra de tom e de qualidade que o cliente percebe como defeito, e o custo de terminar a conversa no modelo caro é pequeno e limitado comparado ao de reabrir o caso. Já a transição para baixo precisa ser imediata e sem histerese, porque aqui o recurso não se recupera: diferente de um sinal de carga, que oscila e volta ao normal sozinho, o consumo do orçamento é monotônico dentro do ciclo. Só sobe. Voltar ao nível anterior por conta própria significa gastar duas vezes o que já não cabia.',
        },
      ],
    },
    {
      title: 'Avisar antes, não depois: o teto que só aparece no erro é um defeito de produto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maior parte da insatisfação com limite de gasto não vem do limite em si, vem da surpresa. O cliente que recebe um aviso aos setenta por cento com projeção de quando vai estourar tem tempo de escolher entre otimizar o uso, subir de plano ou aceitar a degradação, e nenhuma dessas três conversas é ruim. O cliente que descobre o teto pelo erro em produção passa a tratar o seu produto como imprevisível, e essa percepção não se conserta com um crédito. O aviso precisa de três coisas para ser útil: chegar ao administrador do contrato e não ao usuário final, trazer projeção em vez de apenas o percentual atual e apontar o que está consumindo.',
        },
        {
          type: 'code',
          value: `// spend-forecast.js
// Projecao simples de estouro por ritmo recente e escolha do nivel.
// Ritmo dos ultimos dias vence a media do ciclo: quem dobrou o uso
// ontem estoura muito antes do que a media do mes sugere.

export const projectOverrun = ({ spentCents, limitCents, dailySpendCents, daysLeftInCycle }) => {
  const recent = dailySpendCents.slice(-7);
  if (!recent.length) return { willOverrun: false, reason: 'sem historico suficiente' };

  // Media ponderada: o dia mais recente pesa mais que o de uma semana atras.
  const weights = recent.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rate = recent.reduce((acc, value, i) => acc + value * weights[i], 0) / weightSum;

  const remaining = limitCents - spentCents;
  if (rate <= 0) return { willOverrun: false, reason: 'sem consumo recente' };

  const daysToLimit = remaining / rate;
  const projectedCents = Math.round(spentCents + rate * daysLeftInCycle);

  return {
    willOverrun: daysToLimit < daysLeftInCycle,
    daysToLimit: Math.max(0, Math.floor(daysToLimit)),
    projectedCents,
    projectedPercent: Math.round((projectedCents / limitCents) * 100),
    dailyRateCents: Math.round(rate),
  };
};

const LEVELS = [
  { name: 'corte', minPercent: 110 },
  { name: 'fila', minPercent: 100 },
  { name: 'degradado', minPercent: 85 },
  { name: 'aviso', minPercent: 70 },
  { name: 'normal', minPercent: 0 },
];

// O nivel efetivo e o pior entre o consumo real e a projecao: quem esta
// em 40% mas estoura em tres dias ja precisa ser avisado hoje, nao no
// dia em que cruzar 70%.
export const resolveLevel = ({ spentCents, limitCents, forecast }) => {
  const percent = (spentCents / limitCents) * 100;
  const byActual = LEVELS.find((level) => percent >= level.minPercent);

  if (forecast?.willOverrun && byActual.name === 'normal') {
    return { level: 'aviso', percent: Math.round(percent), trigger: 'projecao' };
  }
  return { level: byActual.name, percent: Math.round(percent), trigger: 'consumo' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que faz esse aviso funcionar é a projeção mandar no nível junto com o consumo. Um cliente em quarenta por cento do orçamento no dia cinco do ciclo parece confortável olhando só o percentual, e se ele triplicou o ritmo nos últimos dois dias vai estourar antes do dia dez. Avisar aos setenta por cento nesse caso é avisar tarde demais para qualquer reação. Por isso a média dos últimos dias pesa mais que a média do ciclo inteiro: o que importa não é quanto ele gastou, é a velocidade com que está gastando agora.',
        },
      ],
    },
    {
      title: 'Testar o limite antes que ele seja testado pela fatura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Controle de gasto é código que só executa nas bordas, e por isso é onde os bugs sobrevivem por mais tempo: se nenhum cliente chegou perto do teto neste mês, todo o caminho de degradação e corte ficou sem executar. Quando finalmente executa, executa na pior hora possível, sem ninguém tendo visto aquele fluxo funcionar. A boa notícia é que esse é um dos poucos mecanismos de resiliência que dá para exercitar sem nenhum risco, porque o gatilho é um número em um contador e não um provedor real caindo.',
        },
        {
          type: 'ordered',
          items: [
            'Teste de concorrência na reserva: dispare cem reservas paralelas contra um orçamento que só cabe dez e verifique que exatamente dez foram concedidas, com o resto recusado. É aqui que a implementação sem operação atômica falha, e ela passa em qualquer teste sequencial.',
            'Teste de expiração de reserva: force o acerto de uma reserva já expirada e confirme que o custo real entrou no consumido mesmo assim, sem duplicar o débito e sem sumir com ele.',
            'Teste de cancelamento: aborte a chamada ao provedor depois da reserva e antes da resposta, e confirme que o saldo voltou integralmente em vez de ficar preso até o TTL.',
            'Teste de transição de nível: injete o consumido em cada faixa e verifique que o modelo escolhido, o tamanho de contexto e a decisão sobre conversa nova mudam conforme o esperado, incluindo a regra de que a conversa em andamento mantém o nível de origem.',
            'Teste de projeção: alimente uma série de gasto diário em rampa e confirme que o aviso dispara pela projeção antes do percentual bater no limiar.',
            'Ensaio no ambiente real: escolha um cliente interno, baixe o teto dele para um valor que ele vai cruzar no mesmo dia e acompanhe a experiência ponta a ponta, incluindo o aviso que chega e o que o usuário final vê quando o nível desce.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último item é o que mais rende, porque ele testa a parte que nenhum teste automatizado alcança: se o aviso chega a alguém que pode agir, se a mensagem exibida ao usuário final faz sentido para quem não conhece o contrato e se a degradação é perceptível a ponto de gerar reclamação. Já vi um sistema em que toda a mecânica funcionava perfeitamente e o alerta ia para um endereço de e-mail que ninguém lia havia um ano. O contador estava certo, o corte foi no momento certo e o cliente foi surpreendido do mesmo jeito.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Rate limit por requisição não resolve o problema de gasto?',
      answer:
        'Não, porque ele mede a variável errada. Rate limit conta eventos em uma janela curta e trata todas as requisições como equivalentes, enquanto o custo real varia com facilidade em uma ou duas ordens de grandeza entre uma pergunta curta respondida por um modelo pequeno e uma conversa longa que arrasta trechos de RAG e chama ferramentas. Para aproximar dinheiro por contagem você precisaria calibrar o teto pela requisição mais cara possível, o que estrangula quem faz uso barato, ou pela média, o que deixa passar exatamente o padrão que gera prejuízo. Além disso, as janelas são incompatíveis: rate limit se renova sozinho a cada minuto e o orçamento se acumula ao longo do ciclo de faturamento sem voltar. Os dois controles são complementares e devem coexistir, o rate limit protegendo a capacidade compartilhada e o teto de gasto protegendo a margem do contrato, cada um com o próprio contador e a própria reação ao estouro.',
    },
    {
      question: 'Como impedir que requisições concorrentes furem o teto?',
      answer:
        'Reservando o custo estimado antes da chamada, de forma atômica, e acertando pelo custo real depois. Se você debita apenas quando a resposta chega, todas as requisições paralelas leem o mesmo saldo ainda intacto e se autorizam juntas, e o estouro só aparece quando elas retornam. A reserva funciona como a pré-autorização de um cartão: você estima conservadoramente usando os tokens de entrada, que conhece exatamente, mais o teto de max tokens para a saída, reserva esse valor em uma operação que lê e escreve em um passo só, e depois substitui a reserva pelo custo real devolvendo a diferença. Dois cuidados definem se isso funciona em produção: o TTL da reserva precisa ser maior que o timeout máximo da chamada, senão a reserva expira durante o streaming, e o acerto de uma reserva já expirada precisa ainda assim somar o custo real ao consumido, porque o dinheiro foi gasto de verdade e ignorá-lo faz o gasto sumir justamente nas chamadas mais longas e caras.',
    },
    {
      question: 'Como saber se um pico de uso é abuso ou o cliente crescendo?',
      answer:
        'Olhando a forma do consumo e não o volume, porque as duas curvas sobem igual. Quatro sinais baratos separam bem os casos: diversidade de conteúdo, já que abuso automatizado repete o mesmo prompt e produz taxa alta de acerto em cache semântico com gasto subindo; distribuição no tempo, porque uso humano tem vale noturno e queda no fim de semana enquanto script tem consumo plano nas vinte e quatro horas; razão entre conversas e usuários distintos, que cresce junto na adoção real e descola no laço automatizado; e desfecho das conversas, já que adoção produz resolução enquanto laço produz conversa abandonada no meio. Esses sinais não precisam decidir o bloqueio sozinhos, eles escolhem qual caminho o estouro toma: perfil de crescimento legítimo continua atendido em modo degradado com o time comercial acionado no mesmo dia, e perfil de laço tem o fluxo caro cortado na hora, porque ali cada minuto extra é prejuízo sem contrapartida.',
    },
  ],
  conclusion: {
    title: 'O teto que ninguém vê chegar é o que gera cancelamento',
    description:
      'Limite de gasto é um controle de margem, não de capacidade, e por isso pede contador em dinheiro com reserva antes da chamada, acerto pelo custo real depois e uma decisão explícita sobre quanto estouro vale a pena trocar por latência. O que separa a implementação que protege o negócio da que perde cliente não é o número escolhido: é ter níveis de degradação antes do corte, distinguir abuso de crescimento pela forma do consumo, manter a conversa em andamento no nível em que começou e avisar por projeção enquanto ainda dá tempo de reagir. Posso implementar esse controle de gasto por cliente no seu sistema com LLM, da reserva atômica no caminho quente ao alerta com projeção que chega a quem decide, para que a fatura pare de ser descoberta no fim do mês.',
    cta: 'Falar sobre controle de gasto no meu sistema',
  },
  related: [
    { label: 'Custo por conversa: atribuir a fatura de IA ao que gerou valor', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Rate limit e fila de prioridade para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Modo degradado: manter o atendimento de pé quando a IA está indisponível', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

const en = {
  intro:
    'A basic-plan customer spent, in three days, the equivalent of eleven months of their subscription. Nobody broke in: they plugged your endpoint into a script of their own that reprocesses the entire catalog every hour, and your system accepted all of it because it was never taught to say no. The instinctive reaction is to lower a requests-per-minute ceiling for everyone, and that is exactly the decision that turns one customer problem into degradation for all the others. Spend caps are a different subject from rate limiting, because the scarce resource is not throughput, it is money, and money accumulates across the month instead of refilling every second. This article shows how to build that control: why counting requests is the wrong metric, how to use a money budget with a reservation before the call and settlement after it, where eventually consistent accounting breaks and what that costs, how to separate abuse from legitimate growth before blocking anything, what to do when the cap is hit mid conversation and how to warn the customer early enough that they do not discover it through an error.',
  sections: [
    {
      title: 'Rate limiting protects infrastructure, spend caps protect margin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two controls look like the same mechanism because both end in refusing a request, but they defend different things and fail in different ways. Rate limiting exists so that no customer monopolizes capacity and takes the service down for everyone else: the window is short, seconds or minutes, and the resource refills on its own. The spend cap exists so that no customer consumes more money than the commercial relationship with them can support: the window is the billing cycle, and the consumed resource does not come back. A customer can respect five requests per second perfectly for thirty days straight and still generate a loss, because five requests per second with long context is a five-figure invoice.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the counted unit has to change. Rate limiting counts events, and every event is worth the same. A spend cap has to count money, and in that world two requests identical in shape can differ fiftyfold in cost: a short question answered by a small model versus a long conversation dragging eight RAG passages and calling three tools on top. If you try to approximate money by request count, you either calibrate the cap against the most expensive possible request, which punishes whoever only asks cheap questions, or against the average, which lets through exactly the usage pattern that creates the loss. No request count solves this, because the variable that matters is not being measured.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Rate limit', 'Spend cap'],
          rows: [
            [
              'What it protects',
              'Capacity and latency for the other customers',
              'Contract margin and invoice predictability',
            ],
            [
              'Counted unit',
              'Requests or tokens per short window',
              'Money accumulated over the billing cycle',
            ],
            [
              'Window',
              'Seconds to minutes, refills on its own',
              'Days to a month, does not refill until close',
            ],
            [
              'Cost of setting it too low',
              'Customer sees momentary slowness',
              'Permanent loss, already paid to the provider',
            ],
            [
              'Cost of setting it too high',
              'One customer degrades the rest',
              'A legitimate customer is blocked and churns',
            ],
            [
              'Right reaction on breach',
              'Queue it or ask them to retry later',
              'Degrade to a cheap model or ask for approval',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reserve before calling and settle after, because the real cost only exists at the end',
      blocks: [
        {
          type: 'paragraph',
          value:
            'What breaks the naive implementation is timing: you have to decide whether to authorize the call before knowing what it will cost. The exact cost only shows up in the provider response, with the real count of input, output and cache tokens, and by then the money is already spent. Debiting only after the response creates a window in which ten parallel requests from the same customer all pass the check while the balance is still intact, and the breach only appears when all ten return. In support with long answers, that window lasts seconds, long enough for an aggressive script to blow through a cap by a wide margin.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is the same reservation pattern used in card payments: before the call you estimate a cost ceiling and reserve that amount against the customer budget atomically; after the response, you replace the reservation with the real cost and give back the difference. The estimate does not have to be exact, it has to be conservative: input tokens you already know precisely, because the prompt is assembled in your own hand, and the output you bound with max tokens, which is precisely the ceiling that makes the estimate possible. If the call fails or is cancelled, the reservation expires and returns to the balance. The effect is that ten parallel requests compete for the same reserved balance and the tenth is refused before spending, not after.',
        },
        {
          type: 'code',
          value: `// spend-budget.js
// Per-customer spend budget with an atomic reservation before the call
// and settlement by real cost afterwards. State in Redis: one hash per
// customer and cycle, holding confirmed spend and total open reservations.

import { randomUUID } from 'node:crypto';

// Conservative estimate: input is exact, output uses the maxTokens ceiling.
export const estimateCostCents = ({ model, inputTokens, maxTokens, prices }) => {
  const price = prices[model];
  if (!price) throw new Error(\`No price registered for model \${model}\`);
  const input = (inputTokens / 1_000_000) * price.inputPerMillionCents;
  const output = (maxTokens / 1_000_000) * price.outputPerMillionCents;
  return Math.ceil(input + output);
};

// Reservation and settlement in Lua so that reading the balance and
// writing the reservation are a single step: without this, concurrent
// requests read the same free balance and all authorize themselves.
const RESERVE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local limit = tonumber(ARGV[1])
  local amount = tonumber(ARGV[2])
  local reservationId = ARGV[3]
  local ttl = tonumber(ARGV[4])

  local spent = tonumber(redis.call('HGET', key, 'spent') or '0')
  local reserved = tonumber(redis.call('HGET', key, 'reserved') or '0')

  if spent + reserved + amount > limit then
    return {0, spent, reserved}
  end

  redis.call('HINCRBY', key, 'reserved', amount)
  redis.call('HSET', reservationsKey, reservationId, amount)
  redis.call('EXPIRE', reservationsKey, ttl)
  return {1, spent, reserved + amount}
\`;

// Settlement is always relative to the recorded reservation: if the
// reservation already expired, the real cost still has to enter the spend,
// otherwise the money vanishes from accounting on the slowest calls.
const SETTLE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local reservationId = ARGV[1]
  local actual = tonumber(ARGV[2])

  local reserved = tonumber(redis.call('HGET', reservationsKey, reservationId) or '0')
  if reserved > 0 then
    redis.call('HINCRBY', key, 'reserved', -reserved)
    redis.call('HDEL', reservationsKey, reservationId)
  end
  redis.call('HINCRBY', key, 'spent', actual)
  return redis.call('HGET', key, 'spent')
\`;

export class SpendBudget {
  constructor(redis, { reservationTtlSeconds = 300 } = {}) {
    this.redis = redis;
    this.reservationTtlSeconds = reservationTtlSeconds;
  }

  #keys(tenantId, cycle) {
    return [\`budget:\${tenantId}:\${cycle}\`, \`budget:\${tenantId}:\${cycle}:reservations\`];
  }

  async reserve({ tenantId, cycle, limitCents, amountCents }) {
    const reservationId = randomUUID();
    const [ok, spent, reserved] = await this.redis.eval(
      RESERVE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      String(limitCents),
      String(amountCents),
      reservationId,
      String(this.reservationTtlSeconds),
    );

    if (ok !== 1) {
      return { granted: false, spentCents: spent, reservedCents: reserved };
    }
    return { granted: true, reservationId, spentCents: spent, reservedCents: reserved };
  }

  async settle({ tenantId, cycle, reservationId, actualCents }) {
    const spent = await this.redis.eval(
      SETTLE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      reservationId,
      String(actualCents),
    );
    return Number(spent);
  }

  // Call aborted or failed before consuming tokens: return the reservation
  // without debiting anything. Without this, a provider timeout eats the
  // customer budget for up to reservationTtlSeconds.
  async release({ tenantId, cycle, reservationId }) {
    return this.settle({ tenantId, cycle, reservationId, actualCents: 0 });
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two details of that code tend to be discovered in production the expensive way. The first is the reservation TTL: it has to be longer than the maximum timeout of the model call, otherwise the reservation expires while the response is still streaming and settlement tries to discount something that already disappeared, inflating the recorded spend twice over. The second is settling when the reservation already expired: the real cost has to enter the spend regardless, because the money was spent, and the common mistake is treating a missing reservation as a call that never happened and simply dropping the debit, which makes the spend vanish precisely on the longest calls, which are the most expensive ones.',
        },
      ],
    },
    {
      title: 'Counter consistency: where coordination is worth paying for and where it is not',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The atomic check above solves the race inside one Redis instance, and it is common for the system to be spread across more than one region with local replicas for latency. In that scenario, insisting on strong global consistency means every support message pays a cross-region round trip before calling the model, adding tens of milliseconds to a path that is already slow. The correct question is not how to make the counter perfectly consistent, it is how much overshoot you accept in exchange for latency, because that is the real currency of the negotiation.',
        },
        {
          type: 'paragraph',
          value:
            'The design that usually balances well is local quotas with periodic sync: each region gets a slice of the remaining budget and operates against it without coordination, returning the unused part and asking for more when the slice drops below a floor. The maximum overshoot becomes bounded and computable, roughly the sum of the slices in flight, and you pick the slice size per customer profile: a small slice for whoever is close to the cap, a large slice for whoever is at the start of the cycle. Near the limit, the system automatically tightens coordination, and that is exactly where exactness matters. Far from the limit, nobody should pay for precision that changes no decision.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Possible overshoot', 'Latency cost', 'When to use'],
          rows: [
            [
              'Single strong counter',
              'Practically zero',
              'One round trip per call, cross-region if applicable',
              'Hard contractual cap or prepaid customer with no credit',
            ],
            [
              'Local quotas with sync',
              'Bounded by the sum of slices in flight',
              'Negligible on the hot path',
              'Default for most postpaid plans',
            ],
            [
              'Async debit after the response',
              'High under concurrency',
              'None',
              'Only for alerting and reporting, never for blocking',
            ],
            [
              'Adaptive slice by proximity',
              'Large far from the cap, minimal near it',
              'Grows only in the last few percent of budget',
              'When both latency and exactness matter at each extreme',
            ],
          ],
        },
      ],
    },
    {
      title: 'Separate abuse from legitimate growth before blocking anything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The cap alone does not tell apart the customer who found value in the product and tripled usage from the customer who pointed a badly written script at your endpoint. Both show up as the same rising curve, and blocking both the same way is expensive in both directions: losing the customer who was about to expand the contract is worse than absorbing one month of loss. The distinction is not in the volume, it is in the shape of the consumption, and there are cheap signals to compute that separate the two cases well.',
        },
        {
          type: 'list',
          items: [
            'Content diversity: automated abuse tends to repeat the same prompt or trivial variations of it, so a high semantic cache hit rate together with rising spend is a sign of a loop, not of adoption.',
            'Distribution over time: human usage has a nightly trough and a weekend drop, while a script has flat consumption twenty four hours a day, and the standard deviation per hour of day exposes that with no model at all.',
            'Ratio of conversations to distinct users: legitimate growth raises both together, abuse raises conversations with the same handful of user identifiers.',
            'Conversation outcomes: real adoption produces resolutions and conversations that end, while a loop produces conversations abandoned midway and a handoff rate that does not move even as volume doubles.',
            'Average context size: a sudden jump in prompt length with no product change on the customer side usually indicates a new integration dumping an entire document into every turn.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'These signals do not have to decide on their own: they decide which path the breach takes. A customer with a legitimate growth profile who hits the cap deserves to keep being served with degraded cost while the commercial team is engaged the same day. A customer with an automated loop profile who hits the cap deserves the expensive flow cut immediately, because every additional minute is pure loss with nothing in return. The worst possible configuration is the one that treats both the same, and it is the default configuration of anyone who only implemented a maximum number.',
        },
      ],
    },
    {
      title: 'What happens when the cap is hit mid conversation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Returning a quota exceeded error in the middle of a support interaction is the technically correct and commercially terrible answer, because the one paying the price is your customer end user, who has no relationship at all with the breached contract. An ongoing conversation deserves different treatment from a new one: cutting the one already in progress wastes all the cost already spent on it and delivers a broken experience on top, while refusing to open a new one is contained and explainable. The cut should also be gradual instead of binary, and degradation can happen well before the cap.',
        },
        {
          type: 'diagram',
          value: `Budget consumption in the cycle
0%                    70%        85%        100%      110%
|----------------------|----------|----------|---------|
   normal              warn       degraded    queue     cut

  normal      default model, full context, all tools
  warn        identical to normal, plus alert to the customer admin
  degraded    cheap model, short context, aggressive semantic cache
  queue       new conversation waits or goes straight to a human
  cut         only ongoing conversation finishes, new one is refused

Transition rule
  step down     immediately, as soon as consumption crosses the threshold
  step up       only next cycle or after an explicit cap increase
  active conv   keeps the level it started at until it is resolved`,
        },
        {
          type: 'paragraph',
          value:
            'The rule of keeping the conversation at the level it started has a practical reason: switching models mid interaction produces a break in tone and quality that the customer perceives as a defect, and the cost of finishing the conversation on the expensive model is small and bounded compared with reopening the case. Stepping down, on the other hand, has to be immediate and without hysteresis, because here the resource does not recover: unlike a load signal, which oscillates and returns to normal on its own, budget consumption is monotonic within the cycle. It only goes up. Returning to the previous level on your own means spending twice what already did not fit.',
        },
      ],
    },
    {
      title: 'Warn before, not after: a cap that only shows up in the error is a product defect',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Most of the dissatisfaction with spend caps does not come from the cap itself, it comes from the surprise. The customer who gets a warning at seventy percent with a projection of when they will breach has time to choose between optimizing usage, upgrading the plan or accepting degradation, and none of those three conversations is a bad one. The customer who discovers the cap through an error in production starts treating your product as unpredictable, and that perception is not fixed with a credit. The warning needs three things to be useful: reaching the contract administrator and not the end user, carrying a projection instead of just the current percentage, and pointing at what is consuming.',
        },
        {
          type: 'code',
          value: `// spend-forecast.js
// Simple overrun projection from recent pace, plus level selection.
// Recent-days pace beats the cycle average: whoever doubled usage
// yesterday breaches far earlier than the monthly average suggests.

export const projectOverrun = ({ spentCents, limitCents, dailySpendCents, daysLeftInCycle }) => {
  const recent = dailySpendCents.slice(-7);
  if (!recent.length) return { willOverrun: false, reason: 'not enough history' };

  // Weighted average: the most recent day weighs more than a week ago.
  const weights = recent.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rate = recent.reduce((acc, value, i) => acc + value * weights[i], 0) / weightSum;

  const remaining = limitCents - spentCents;
  if (rate <= 0) return { willOverrun: false, reason: 'no recent consumption' };

  const daysToLimit = remaining / rate;
  const projectedCents = Math.round(spentCents + rate * daysLeftInCycle);

  return {
    willOverrun: daysToLimit < daysLeftInCycle,
    daysToLimit: Math.max(0, Math.floor(daysToLimit)),
    projectedCents,
    projectedPercent: Math.round((projectedCents / limitCents) * 100),
    dailyRateCents: Math.round(rate),
  };
};

const LEVELS = [
  { name: 'cut', minPercent: 110 },
  { name: 'queue', minPercent: 100 },
  { name: 'degraded', minPercent: 85 },
  { name: 'warn', minPercent: 70 },
  { name: 'normal', minPercent: 0 },
];

// The effective level is the worse of actual consumption and projection:
// whoever sits at 40% but breaches in three days needs the warning today,
// not on the day they cross 70%.
export const resolveLevel = ({ spentCents, limitCents, forecast }) => {
  const percent = (spentCents / limitCents) * 100;
  const byActual = LEVELS.find((level) => percent >= level.minPercent);

  if (forecast?.willOverrun && byActual.name === 'normal') {
    return { level: 'warn', percent: Math.round(percent), trigger: 'projection' };
  }
  return { level: byActual.name, percent: Math.round(percent), trigger: 'consumption' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that makes this warning work is letting the projection drive the level alongside consumption. A customer at forty percent of budget on day five of the cycle looks comfortable if you only read the percentage, and if they tripled their pace over the last two days they will breach before day ten. Warning at seventy percent in that case is warning far too late for any reaction. That is why the last few days weigh more than the average of the whole cycle: what matters is not how much they spent, it is how fast they are spending right now.',
        },
      ],
    },
    {
      title: 'Test the cap before the invoice tests it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Spend control is code that only runs at the edges, and that is why bugs survive there the longest: if no customer came close to the cap this month, the entire degradation and cut path went unexecuted. When it finally runs, it runs at the worst possible hour, with nobody having ever seen that flow work. The good news is that this is one of the few resilience mechanisms you can exercise with no risk at all, because the trigger is a number in a counter and not a real provider going down.',
        },
        {
          type: 'ordered',
          items: [
            'Concurrency test on the reservation: fire a hundred parallel reservations against a budget that only fits ten and verify that exactly ten were granted and the rest refused. This is where an implementation without an atomic operation fails, and it passes any sequential test.',
            'Reservation expiry test: force settlement of an already expired reservation and confirm the real cost still entered the spend, without duplicating the debit and without losing it.',
            'Cancellation test: abort the provider call after the reservation and before the response, and confirm the balance came back in full instead of being stuck until the TTL.',
            'Level transition test: inject spend at each band and verify that the chosen model, the context size and the decision about a new conversation change as expected, including the rule that an ongoing conversation keeps its original level.',
            'Projection test: feed a ramping daily spend series and confirm the warning fires from the projection before the percentage hits the threshold.',
            'Rehearsal in the real environment: pick an internal customer, lower their cap to a value they will cross that same day and follow the experience end to end, including the warning that arrives and what the end user sees when the level steps down.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last item pays off the most, because it tests the part no automated test reaches: whether the warning gets to someone who can act, whether the message shown to the end user makes sense to somebody who does not know the contract, and whether the degradation is noticeable enough to generate a complaint. I have seen a system where the whole mechanism worked perfectly and the alert went to an email address nobody had read in a year. The counter was right, the cut happened at the right moment, and the customer was surprised all the same.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does per-request rate limiting not solve the spend problem?',
      answer:
        'No, because it measures the wrong variable. Rate limiting counts events in a short window and treats every request as equivalent, while real cost easily varies by one or two orders of magnitude between a short question answered by a small model and a long conversation dragging RAG passages and calling tools. To approximate money by counting you would have to calibrate the cap against the most expensive possible request, which strangles cheap usage, or against the average, which lets through exactly the pattern that creates the loss. The windows are incompatible too: rate limits refill on their own every minute and the budget accumulates over the billing cycle without coming back. The two controls are complementary and should coexist, the rate limit protecting shared capacity and the spend cap protecting contract margin, each with its own counter and its own reaction to a breach.',
    },
    {
      question: 'How do you stop concurrent requests from blowing through the cap?',
      answer:
        'By reserving the estimated cost before the call, atomically, and settling by the real cost afterwards. If you debit only when the response arrives, all parallel requests read the same still-intact balance and authorize themselves together, and the breach only shows up when they return. The reservation works like a card pre-authorization: you estimate conservatively using input tokens, which you know exactly, plus the max tokens ceiling for output, reserve that amount in an operation that reads and writes in a single step, and then replace the reservation with the real cost, returning the difference. Two details decide whether this works in production: the reservation TTL has to be longer than the maximum call timeout, otherwise the reservation expires during streaming, and settling an already expired reservation still has to add the real cost to the spend, because the money was genuinely spent and dropping it makes spend vanish precisely on the longest and most expensive calls.',
    },
    {
      question: 'How do you tell whether a usage spike is abuse or a customer growing?',
      answer:
        'By looking at the shape of the consumption rather than the volume, because both curves rise the same. Four cheap signals separate the cases well: content diversity, since automated abuse repeats the same prompt and produces a high semantic cache hit rate with rising spend; distribution over time, because human usage has a nightly trough and a weekend drop while a script consumes flat around the clock; the ratio of conversations to distinct users, which rises together in real adoption and diverges in an automated loop; and conversation outcomes, since adoption produces resolutions while a loop produces conversations abandoned midway. These signals do not have to decide the block on their own, they choose which path the breach takes: a legitimate growth profile keeps being served in degraded mode with the commercial team engaged the same day, and a loop profile gets the expensive flow cut immediately, because there every extra minute is loss with nothing in return.',
    },
  ],
  conclusion: {
    title: 'The cap nobody saw coming is the one that causes churn',
    description:
      'A spend cap is a margin control, not a capacity control, and that is why it calls for a money counter with a reservation before the call, settlement by real cost afterwards and an explicit decision about how much overshoot is worth trading for latency. What separates the implementation that protects the business from the one that loses customers is not the number chosen: it is having degradation levels before the cut, distinguishing abuse from growth by the shape of consumption, keeping the ongoing conversation at the level it started, and warning from a projection while there is still time to react. I can implement this per-customer spend control in your LLM system, from the atomic reservation on the hot path to the projected alert that reaches whoever decides, so the invoice stops being discovered at the end of the month.',
    cta: 'Talk about spend control in my system',
  },
  related: [
    { label: 'Cost per conversation: attributing the AI bill to what created value', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Rate limit and priority queue for LLM APIs', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Degraded mode: keeping support standing when the AI is unavailable', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

const es = {
  intro:
    'Un cliente de plan básico gastó en tres días el equivalente a once meses de su mensualidad. Nadie irrumpió en nada: conectó tu endpoint a un script propio que reprocesa el catálogo entero cada hora, y tu sistema aceptó todo porque nunca se le enseñó a decir que no. La reacción instintiva es bajar un techo de peticiones por minuto para todo el mundo, y esa es justamente la decisión que transforma el problema de un cliente en degradación para todos los demás. El límite de gasto es un asunto distinto del rate limit, porque el recurso escaso no es caudal, es dinero, y el dinero se acumula a lo largo del mes en vez de renovarse cada segundo. Este artículo muestra cómo construir ese control: por qué contar peticiones es la métrica equivocada, cómo usar presupuesto en dinero con reserva antes de la llamada y liquidación después, dónde se rompe la contabilidad eventualmente consistente y cuánto cuesta eso, cómo separar abuso de crecimiento legítimo antes de bloquear, qué hacer cuando el techo se alcanza en medio de una conversación y cómo avisar al cliente lo bastante temprano para que no lo descubra por el error.',
  sections: [
    {
      title: 'El rate limit protege la infraestructura, el techo de gasto protege el margen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los dos controles parecen el mismo mecanismo porque ambos terminan rechazando una petición, pero defienden cosas distintas y fallan de formas distintas. El rate limit existe para que ningún cliente monopolice la capacidad y tumbe el servicio para los demás: la ventana es corta, de segundos o minutos, y el recurso se renueva solo. El techo de gasto existe para que ningún cliente consuma más dinero del que la relación comercial con él soporta: la ventana es el ciclo de facturación, y el recurso consumido no vuelve. Un cliente puede respetar perfectamente cinco peticiones por segundo durante treinta días seguidos y aun así generar una pérdida, porque cinco peticiones por segundo con contexto largo es una factura de cinco cifras.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la unidad contada tiene que cambiar. El rate limit cuenta eventos, y todo evento vale lo mismo. El techo de gasto tiene que contar dinero, y en ese mundo dos peticiones idénticas en forma pueden diferir cincuenta veces en costo: una pregunta corta respondida por un modelo pequeño frente a una conversación larga que arrastra ocho fragmentos de RAG y encima llama a tres herramientas. Si intentas aproximar dinero por conteo de peticiones, tienes que calibrar el techo por la petición más cara posible, lo que castiga a quien solo hace preguntas baratas, o por el promedio, lo que deja pasar exactamente el patrón de uso que genera la pérdida. No existe número de peticiones que resuelva esto, porque la variable que importa no se está midiendo.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Rate limit', 'Techo de gasto'],
          rows: [
            [
              'Qué protege',
              'Capacidad y latencia de los otros clientes',
              'Margen del contrato y previsibilidad de la factura',
            ],
            [
              'Unidad contada',
              'Peticiones o tokens por ventana corta',
              'Dinero acumulado en el ciclo de facturación',
            ],
            [
              'Ventana',
              'Segundos a minutos, se renueva sola',
              'Días a un mes, no se renueva hasta el cierre',
            ],
            [
              'Costo de fijarlo muy bajo',
              'El cliente ve lentitud momentánea',
              'Pérdida permanente, ya se pagó al proveedor',
            ],
            [
              'Costo de fijarlo muy alto',
              'Un cliente degrada a los demás',
              'Un cliente legítimo se bloquea y se da de baja',
            ],
            [
              'Reacción correcta al exceder',
              'Encolar o pedir que reintente después',
              'Degradar a modelo barato o pedir aprobación',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reservar antes de llamar y liquidar después, porque el costo real solo existe al final',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El punto que rompe la implementación ingenua es temporal: tienes que decidir si autorizas la llamada antes de saber cuánto va a costar. El costo exacto solo aparece en la respuesta del proveedor, con el conteo real de tokens de entrada, de salida y de cache, y a esa altura el dinero ya se gastó. Debitar solo después de la respuesta crea una ventana en la que diez peticiones paralelas del mismo cliente pasan todas por la verificación mientras el saldo sigue intacto, y el exceso solo aparece cuando las diez retornan. En atención con respuesta larga, esa ventana dura segundos, tiempo suficiente para que un script agresivo perfore un techo por un margen grande.',
        },
        {
          type: 'paragraph',
          value:
            'La solución es el mismo patrón de reserva usado en el pago con tarjeta: antes de la llamada estimas un techo de costo y reservas ese valor en el presupuesto del cliente de forma atómica; después de la respuesta, sustituyes la reserva por el costo real y devuelves la diferencia. La estimación no necesita ser exacta, necesita ser conservadora: los tokens de entrada ya los conoces exactamente, porque el prompt está armado en tu mano, y la salida la acotas con max tokens, que es justamente el techo que vuelve posible la estimación. Si la llamada falla o se cancela, la reserva expira y vuelve al saldo. El efecto es que diez peticiones paralelas compiten por el mismo saldo reservado y la décima se rechaza antes de gastar, no después.',
        },
        {
          type: 'code',
          value: `// spend-budget.js
// Presupuesto de gasto por cliente con reserva atomica antes de la llamada
// y liquidacion por el costo real despues. Estado en Redis: un hash por
// cliente y ciclo, con el consumido confirmado y el total reservado abierto.

import { randomUUID } from 'node:crypto';

// Estimacion conservadora: la entrada es exacta, la salida usa el techo de maxTokens.
export const estimateCostCents = ({ model, inputTokens, maxTokens, prices }) => {
  const price = prices[model];
  if (!price) throw new Error(\`Sin precio registrado para el modelo \${model}\`);
  const input = (inputTokens / 1_000_000) * price.inputPerMillionCents;
  const output = (maxTokens / 1_000_000) * price.outputPerMillionCents;
  return Math.ceil(input + output);
};

// Reserva y liquidacion en Lua para que leer el saldo y escribir la reserva
// sean un solo paso: sin esto, peticiones concurrentes leen el mismo saldo
// libre y todas se autorizan.
const RESERVE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local limit = tonumber(ARGV[1])
  local amount = tonumber(ARGV[2])
  local reservationId = ARGV[3]
  local ttl = tonumber(ARGV[4])

  local spent = tonumber(redis.call('HGET', key, 'spent') or '0')
  local reserved = tonumber(redis.call('HGET', key, 'reserved') or '0')

  if spent + reserved + amount > limit then
    return {0, spent, reserved}
  end

  redis.call('HINCRBY', key, 'reserved', amount)
  redis.call('HSET', reservationsKey, reservationId, amount)
  redis.call('EXPIRE', reservationsKey, ttl)
  return {1, spent, reserved + amount}
\`;

// La liquidacion siempre es relativa a la reserva registrada: si la reserva
// ya expiro, el costo real igual tiene que entrar en el consumido, si no el
// gasto desaparece de la contabilidad justo en las llamadas mas lentas.
const SETTLE_SCRIPT = \`
  local key = KEYS[1]
  local reservationsKey = KEYS[2]
  local reservationId = ARGV[1]
  local actual = tonumber(ARGV[2])

  local reserved = tonumber(redis.call('HGET', reservationsKey, reservationId) or '0')
  if reserved > 0 then
    redis.call('HINCRBY', key, 'reserved', -reserved)
    redis.call('HDEL', reservationsKey, reservationId)
  end
  redis.call('HINCRBY', key, 'spent', actual)
  return redis.call('HGET', key, 'spent')
\`;

export class SpendBudget {
  constructor(redis, { reservationTtlSeconds = 300 } = {}) {
    this.redis = redis;
    this.reservationTtlSeconds = reservationTtlSeconds;
  }

  #keys(tenantId, cycle) {
    return [\`budget:\${tenantId}:\${cycle}\`, \`budget:\${tenantId}:\${cycle}:reservations\`];
  }

  async reserve({ tenantId, cycle, limitCents, amountCents }) {
    const reservationId = randomUUID();
    const [ok, spent, reserved] = await this.redis.eval(
      RESERVE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      String(limitCents),
      String(amountCents),
      reservationId,
      String(this.reservationTtlSeconds),
    );

    if (ok !== 1) {
      return { granted: false, spentCents: spent, reservedCents: reserved };
    }
    return { granted: true, reservationId, spentCents: spent, reservedCents: reserved };
  }

  async settle({ tenantId, cycle, reservationId, actualCents }) {
    const spent = await this.redis.eval(
      SETTLE_SCRIPT,
      2,
      ...this.#keys(tenantId, cycle),
      reservationId,
      String(actualCents),
    );
    return Number(spent);
  }

  // Llamada abortada o fallida antes de consumir tokens: devuelve la reserva
  // sin debitar nada. Sin esto, un timeout del proveedor se come el
  // presupuesto del cliente por hasta reservationTtlSeconds.
  async release({ tenantId, cycle, reservationId }) {
    return this.settle({ tenantId, cycle, reservationId, actualCents: 0 });
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de ese código se suelen descubrir en producción de la forma cara. El primero es el TTL de la reserva: tiene que ser mayor que el timeout máximo de la llamada al modelo, si no la reserva expira mientras la respuesta todavía está en streaming y la liquidación intenta descontar algo que ya desapareció, inflando el consumido al doble. El segundo es liquidar cuando la reserva ya expiró: el costo real tiene que entrar en el consumido de todas formas, porque el dinero se gastó, y el error común es tratar la reserva ausente como llamada no realizada y simplemente ignorar el débito, lo que hace que el gasto desaparezca justamente en las llamadas más largas, que son las más caras.',
        },
      ],
    },
    {
      title: 'Consistencia del contador: dónde vale gastar coordinación y dónde no',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La verificación atómica de arriba resuelve la carrera dentro de una instancia de Redis, y es común que el sistema esté distribuido en más de una región con réplicas locales por latencia. En ese escenario, insistir en consistencia fuerte global significa que cada mensaje de atención paga una ida y vuelta entre regiones antes de llamar al modelo, lo que agrega decenas de milisegundos a un camino que ya es lento. La pregunta correcta no es cómo volver el contador perfectamente consistente, es cuánto exceso aceptas a cambio de latencia, porque esa es la moneda real de la negociación.',
        },
        {
          type: 'paragraph',
          value:
            'El diseño que suele equilibrar bien es el de cuotas locales con sincronización periódica: cada región recibe una porción del presupuesto restante y opera contra ella sin coordinación, devolviendo lo no usado y pidiendo más cuando la porción baja de un piso. El exceso máximo pasa a ser acotado y calculable, aproximadamente la suma de las porciones en vuelo, y eliges el tamaño de la porción por perfil de cliente: porción pequeña para quien está cerca del techo, porción grande para quien está al comienzo del ciclo. Cerca del límite, el sistema aprieta la coordinación automáticamente, y es justo ahí donde la exactitud importa. Lejos del límite, nadie necesita pagar por precisión que no cambia ninguna decisión.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Exceso posible', 'Costo de latencia', 'Cuándo usarla'],
          rows: [
            [
              'Contador único fuerte',
              'Prácticamente cero',
              'Una ida y vuelta por llamada, entre regiones si aplica',
              'Techo rígido contractual o cliente prepago sin crédito',
            ],
            [
              'Cuotas locales con sincronización',
              'Acotado por la suma de las porciones en vuelo',
              'Despreciable en el camino caliente',
              'Estándar para la mayoría de los planes pospago',
            ],
            [
              'Débito asíncrono tras la respuesta',
              'Alto bajo concurrencia',
              'Ninguno',
              'Solo para alerta y reporte, nunca para bloqueo',
            ],
            [
              'Porción adaptativa por proximidad',
              'Grande lejos del techo, mínimo cerca de él',
              'Crece solo en el último porcentaje del presupuesto',
              'Cuando latencia y exactitud importan en cada extremo',
            ],
          ],
        },
      ],
    },
    {
      title: 'Separar abuso de crecimiento legítimo antes de bloquear cualquier cosa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El techo por sí solo no distingue al cliente que descubrió valor en el producto y triplicó el uso del cliente que apuntó un script mal escrito a tu endpoint. Los dos aparecen como la misma curva subiendo, y bloquear a ambos del mismo modo cuesta caro en los dos sentidos: perder al cliente que iba a expandir el contrato es peor que absorber la pérdida de un mes. La distinción no está en el volumen, está en la forma del consumo, y existen señales baratas de calcular que separan bien los dos casos.',
        },
        {
          type: 'list',
          items: [
            'Diversidad de contenido: el abuso automatizado suele repetir el mismo prompt o variaciones triviales de él, así que una tasa alta de acierto en cache semántico con gasto creciente es señal de bucle, no de adopción.',
            'Distribución en el tiempo: el uso humano tiene valle nocturno y caída de fin de semana, mientras que un script tiene consumo plano las veinticuatro horas, y el desvío estándar por hora del día lo delata sin ningún modelo.',
            'Razón entre conversaciones y usuarios distintos: el crecimiento legítimo sube ambos juntos, el abuso sube conversaciones con el mismo puñado de identificadores de usuario.',
            'Desenlace de las conversaciones: la adopción real produce resolución y conversaciones que terminan, mientras que el bucle produce conversaciones abandonadas a mitad de camino y una tasa de traspaso que no se mueve aunque el volumen se duplique.',
            'Tamaño medio de contexto: un salto súbito en el largo del prompt sin cambio de producto del lado del cliente suele indicar una integración nueva volcando un documento entero en cada turno.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Esas señales no tienen que decidir solas: deciden qué camino toma el exceso. Un cliente con perfil de crecimiento legítimo que toca el techo merece seguir atendido con costo degradado mientras el equipo comercial es activado el mismo día. Un cliente con perfil de bucle automatizado que toca el techo merece el corte inmediato del flujo caro, porque cada minuto adicional es pérdida pura sin contrapartida. La peor configuración posible es la que trata a ambos igual, y es la configuración por defecto de quien solo implementó un número máximo.',
        },
      ],
    },
    {
      title: 'Qué pasa cuando el techo se alcanza en medio de una conversación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Devolver un error de cuota excedida en medio de una atención es la respuesta técnicamente correcta y comercialmente pésima, porque quien paga el precio es el consumidor final de tu cliente, que no tiene relación alguna con el contrato excedido. La conversación en curso merece un trato distinto al de la conversación nueva: cortar la que ya empezó desperdicia todo el costo ya gastado en ella y encima entrega una experiencia rota, mientras que rechazar la apertura de una nueva es contenido y explicable. El corte también debe ser gradual en vez de binario, y la degradación puede ocurrir bastante antes del techo.',
        },
        {
          type: 'diagram',
          value: `Consumo del presupuesto en el ciclo
0%                    70%        85%        100%      110%
|----------------------|----------|----------|---------|
   normal              aviso      degradado   cola      corte

  normal      modelo estandar, contexto completo, todas las herramientas
  aviso       identico al normal, mas alerta al admin del cliente
  degradado   modelo barato, contexto corto, cache semantico agresivo
  cola        conversacion nueva espera o va directo al humano
  corte       solo la conversacion en curso termina, la nueva se rechaza

Regla de transicion
  baja de nivel   al instante, apenas el consumo cruza el umbral
  sube de nivel   solo el proximo ciclo o tras aumento explicito de techo
  conv. activa    mantiene el nivel en que empezo hasta el desenlace`,
        },
        {
          type: 'paragraph',
          value:
            'La regla de mantener la conversación en el nivel en que empezó tiene un motivo práctico: cambiar de modelo en medio de una atención produce una quiebra de tono y de calidad que el cliente percibe como defecto, y el costo de terminar la conversación en el modelo caro es pequeño y acotado comparado con el de reabrir el caso. La transición hacia abajo, en cambio, necesita ser inmediata y sin histéresis, porque aquí el recurso no se recupera: a diferencia de una señal de carga, que oscila y vuelve sola a lo normal, el consumo del presupuesto es monótono dentro del ciclo. Solo sube. Volver al nivel anterior por cuenta propia significa gastar dos veces lo que ya no cabía.',
        },
      ],
    },
    {
      title: 'Avisar antes, no después: el techo que solo aparece en el error es un defecto de producto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayor parte de la insatisfacción con el límite de gasto no viene del límite en sí, viene de la sorpresa. El cliente que recibe un aviso al setenta por ciento con proyección de cuándo va a excederse tiene tiempo de elegir entre optimizar el uso, subir de plan o aceptar la degradación, y ninguna de esas tres conversaciones es mala. El cliente que descubre el techo por el error en producción pasa a tratar tu producto como impredecible, y esa percepción no se arregla con un crédito. El aviso necesita tres cosas para ser útil: llegar al administrador del contrato y no al usuario final, traer proyección en vez de solo el porcentaje actual y señalar qué está consumiendo.',
        },
        {
          type: 'code',
          value: `// spend-forecast.js
// Proyeccion simple de exceso por ritmo reciente y eleccion del nivel.
// El ritmo de los ultimos dias vence al promedio del ciclo: quien duplico
// el uso ayer se excede mucho antes de lo que sugiere el promedio del mes.

export const projectOverrun = ({ spentCents, limitCents, dailySpendCents, daysLeftInCycle }) => {
  const recent = dailySpendCents.slice(-7);
  if (!recent.length) return { willOverrun: false, reason: 'sin historial suficiente' };

  // Promedio ponderado: el dia mas reciente pesa mas que el de hace una semana.
  const weights = recent.map((_, i) => i + 1);
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const rate = recent.reduce((acc, value, i) => acc + value * weights[i], 0) / weightSum;

  const remaining = limitCents - spentCents;
  if (rate <= 0) return { willOverrun: false, reason: 'sin consumo reciente' };

  const daysToLimit = remaining / rate;
  const projectedCents = Math.round(spentCents + rate * daysLeftInCycle);

  return {
    willOverrun: daysToLimit < daysLeftInCycle,
    daysToLimit: Math.max(0, Math.floor(daysToLimit)),
    projectedCents,
    projectedPercent: Math.round((projectedCents / limitCents) * 100),
    dailyRateCents: Math.round(rate),
  };
};

const LEVELS = [
  { name: 'corte', minPercent: 110 },
  { name: 'cola', minPercent: 100 },
  { name: 'degradado', minPercent: 85 },
  { name: 'aviso', minPercent: 70 },
  { name: 'normal', minPercent: 0 },
];

// El nivel efectivo es el peor entre el consumo real y la proyeccion: quien
// esta en 40% pero se excede en tres dias ya necesita el aviso hoy, no el
// dia en que cruce 70%.
export const resolveLevel = ({ spentCents, limitCents, forecast }) => {
  const percent = (spentCents / limitCents) * 100;
  const byActual = LEVELS.find((level) => percent >= level.minPercent);

  if (forecast?.willOverrun && byActual.name === 'normal') {
    return { level: 'aviso', percent: Math.round(percent), trigger: 'proyeccion' };
  }
  return { level: byActual.name, percent: Math.round(percent), trigger: 'consumo' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que hace funcionar ese aviso es que la proyección mande sobre el nivel junto con el consumo. Un cliente en el cuarenta por ciento del presupuesto el día cinco del ciclo parece cómodo mirando solo el porcentaje, y si triplicó el ritmo en los últimos dos días se va a exceder antes del día diez. Avisar al setenta por ciento en ese caso es avisar demasiado tarde para cualquier reacción. Por eso el promedio de los últimos días pesa más que el promedio del ciclo entero: lo que importa no es cuánto gastó, es la velocidad con la que está gastando ahora.',
        },
      ],
    },
    {
      title: 'Probar el límite antes de que lo pruebe la factura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El control de gasto es código que solo se ejecuta en los bordes, y por eso es donde los bugs sobreviven más tiempo: si ningún cliente se acercó al techo este mes, todo el camino de degradación y corte quedó sin ejecutarse. Cuando finalmente se ejecuta, se ejecuta en la peor hora posible, sin que nadie haya visto ese flujo funcionar. La buena noticia es que este es uno de los pocos mecanismos de resiliencia que se puede ejercitar sin ningún riesgo, porque el disparador es un número en un contador y no un proveedor real cayéndose.',
        },
        {
          type: 'ordered',
          items: [
            'Prueba de concurrencia en la reserva: dispara cien reservas paralelas contra un presupuesto que solo cabe diez y verifica que exactamente diez fueron concedidas, con el resto rechazado. Aquí es donde falla la implementación sin operación atómica, y pasa cualquier prueba secuencial.',
            'Prueba de expiración de reserva: fuerza la liquidación de una reserva ya expirada y confirma que el costo real entró igual en el consumido, sin duplicar el débito y sin perderlo.',
            'Prueba de cancelación: aborta la llamada al proveedor después de la reserva y antes de la respuesta, y confirma que el saldo volvió íntegro en vez de quedar retenido hasta el TTL.',
            'Prueba de transición de nivel: inyecta el consumido en cada franja y verifica que el modelo elegido, el tamaño de contexto y la decisión sobre conversación nueva cambian como se espera, incluida la regla de que la conversación en curso mantiene su nivel de origen.',
            'Prueba de proyección: alimenta una serie de gasto diario en rampa y confirma que el aviso se dispara por la proyección antes de que el porcentaje toque el umbral.',
            'Ensayo en el ambiente real: elige un cliente interno, baja su techo a un valor que va a cruzar el mismo día y acompaña la experiencia de punta a punta, incluyendo el aviso que llega y lo que ve el usuario final cuando el nivel baja.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último punto es el que más rinde, porque prueba la parte que ninguna prueba automatizada alcanza: si el aviso llega a alguien que puede actuar, si el mensaje mostrado al usuario final tiene sentido para quien no conoce el contrato y si la degradación es perceptible al punto de generar reclamo. He visto un sistema en el que toda la mecánica funcionaba perfectamente y la alerta iba a una dirección de correo que nadie leía desde hacía un año. El contador estaba bien, el corte fue en el momento correcto y el cliente fue sorprendido igual.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿El rate limit por petición no resuelve el problema de gasto?',
      answer:
        'No, porque mide la variable equivocada. El rate limit cuenta eventos en una ventana corta y trata todas las peticiones como equivalentes, mientras que el costo real varía con facilidad en uno o dos órdenes de magnitud entre una pregunta corta respondida por un modelo pequeño y una conversación larga que arrastra fragmentos de RAG y llama a herramientas. Para aproximar dinero por conteo tendrías que calibrar el techo por la petición más cara posible, lo que estrangula a quien hace uso barato, o por el promedio, lo que deja pasar justamente el patrón que genera la pérdida. Además, las ventanas son incompatibles: el rate limit se renueva solo cada minuto y el presupuesto se acumula a lo largo del ciclo de facturación sin volver. Los dos controles son complementarios y deben coexistir, el rate limit protegiendo la capacidad compartida y el techo de gasto protegiendo el margen del contrato, cada uno con su propio contador y su propia reacción al exceso.',
    },
    {
      question: '¿Cómo impedir que peticiones concurrentes perforen el techo?',
      answer:
        'Reservando el costo estimado antes de la llamada, de forma atómica, y liquidando por el costo real después. Si debitas solo cuando llega la respuesta, todas las peticiones paralelas leen el mismo saldo aún intacto y se autorizan juntas, y el exceso solo aparece cuando retornan. La reserva funciona como la preautorización de una tarjeta: estimas de forma conservadora usando los tokens de entrada, que conoces exactamente, más el techo de max tokens para la salida, reservas ese valor en una operación que lee y escribe en un solo paso, y después sustituyes la reserva por el costo real devolviendo la diferencia. Dos cuidados definen si esto funciona en producción: el TTL de la reserva tiene que ser mayor que el timeout máximo de la llamada, si no la reserva expira durante el streaming, y liquidar una reserva ya expirada igual tiene que sumar el costo real al consumido, porque el dinero se gastó de verdad e ignorarlo hace que el gasto desaparezca justamente en las llamadas más largas y caras.',
    },
    {
      question: '¿Cómo saber si un pico de uso es abuso o el cliente creciendo?',
      answer:
        'Mirando la forma del consumo y no el volumen, porque las dos curvas suben igual. Cuatro señales baratas separan bien los casos: diversidad de contenido, ya que el abuso automatizado repite el mismo prompt y produce una tasa alta de acierto en cache semántico con gasto subiendo; distribución en el tiempo, porque el uso humano tiene valle nocturno y caída de fin de semana mientras un script consume plano las veinticuatro horas; la razón entre conversaciones y usuarios distintos, que sube junta en la adopción real y se despega en el bucle automatizado; y el desenlace de las conversaciones, ya que la adopción produce resolución mientras el bucle produce conversación abandonada a mitad de camino. Esas señales no tienen que decidir el bloqueo solas, eligen qué camino toma el exceso: un perfil de crecimiento legítimo sigue atendido en modo degradado con el equipo comercial activado el mismo día, y un perfil de bucle tiene el flujo caro cortado al instante, porque ahí cada minuto extra es pérdida sin contrapartida.',
    },
  ],
  conclusion: {
    title: 'El techo que nadie vio venir es el que genera baja',
    description:
      'El límite de gasto es un control de margen, no de capacidad, y por eso pide contador en dinero con reserva antes de la llamada, liquidación por el costo real después y una decisión explícita sobre cuánto exceso vale la pena cambiar por latencia. Lo que separa la implementación que protege el negocio de la que pierde clientes no es el número elegido: es tener niveles de degradación antes del corte, distinguir abuso de crecimiento por la forma del consumo, mantener la conversación en curso en el nivel en que empezó y avisar por proyección mientras todavía hay tiempo de reaccionar. Puedo implementar ese control de gasto por cliente en tu sistema con LLM, desde la reserva atómica en el camino caliente hasta la alerta con proyección que llega a quien decide, para que la factura deje de descubrirse a fin de mes.',
    cta: 'Hablar sobre control de gasto en mi sistema',
  },
  related: [
    { label: 'Costo por conversación: atribuir la factura de IA a lo que generó valor', to: '/blog/custo-por-conversa-atribuir-fatura-ia-ao-valor' },
    { label: 'Rate limit y cola de prioridad para APIs de LLM', to: '/blog/rate-limit-fila-prioridade-apis-llm' },
    { label: 'Modo degradado: mantener la atención en pie cuando la IA no está disponible', to: '/blog/modo-degradado-manter-atendimento-quando-ia-indisponivel' },
  ],
};

export default {
  pt,
  en,
  es,
};
