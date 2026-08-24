// Conteudo do artigo: orcamento de erro em atendimento automatizado.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const sliCodePt = `// sli.js
// Um SLI de atendimento so vale se contar eventos elegiveis, nao todos.
// Conversa cancelada pelo cliente antes da primeira resposta nao e falha
// do bot: incluir isso no denominador dilui o sinal e esconde regressao.

// Motivos que tiram a conversa da conta. Cada exclusao precisa de
// justificativa escrita, senao vira porta dos fundos para maquiar o numero.
const NOT_ELIGIBLE = new Set([
  'client_abandoned_before_first_reply', // saiu antes de o bot poder agir
  'spam_or_test',                        // trafego sintetico
  'out_of_business_hours_by_policy',     // fora do escopo contratado
]);

export function isEligible(conversation) {
  return !NOT_ELIGIBLE.has(conversation.exclusionReason);
}

// Bom evento: resolvida sem escalonamento indevido, dentro do prazo,
// e sem que o cliente tenha marcado a resposta como errada.
export function isGood(conversation, { maxFirstReplyMs = 30000 } = {}) {
  if (conversation.firstReplyMs > maxFirstReplyMs) return false;
  if (conversation.wrongAnswerReported) return false;
  if (conversation.escalatedBecauseBotFailed) return false;
  return true;
}

// SLI = bons eventos elegiveis / total de eventos elegiveis.
export function computeSli(conversations, options) {
  const eligible = conversations.filter(isEligible);
  if (eligible.length === 0) return null; // sem trafego nao ha sinal
  const good = eligible.filter((c) => isGood(c, options)).length;
  return { sli: good / eligible.length, eligible: eligible.length, good };
}`;

const sliCodeEn = `// sli.js
// A support SLI is only worth anything if it counts eligible events, not all.
// A conversation the customer cancelled before the first reply is not a bot
// failure: putting it in the denominator dilutes the signal and hides regressions.

// Reasons that take a conversation out of the count. Every exclusion needs a
// written justification, otherwise it becomes a back door to fake the number.
const NOT_ELIGIBLE = new Set([
  'client_abandoned_before_first_reply', // left before the bot could act
  'spam_or_test',                        // synthetic traffic
  'out_of_business_hours_by_policy',     // outside the contracted scope
]);

export function isEligible(conversation) {
  return !NOT_ELIGIBLE.has(conversation.exclusionReason);
}

// Good event: resolved without an undue escalation, within the deadline,
// and without the customer flagging the answer as wrong.
export function isGood(conversation, { maxFirstReplyMs = 30000 } = {}) {
  if (conversation.firstReplyMs > maxFirstReplyMs) return false;
  if (conversation.wrongAnswerReported) return false;
  if (conversation.escalatedBecauseBotFailed) return false;
  return true;
}

// SLI = good eligible events / total eligible events.
export function computeSli(conversations, options) {
  const eligible = conversations.filter(isEligible);
  if (eligible.length === 0) return null; // no traffic means no signal
  const good = eligible.filter((c) => isGood(c, options)).length;
  return { sli: good / eligible.length, eligible: eligible.length, good };
}`;

const sliCodeEs = `// sli.js
// Un SLI de atencion solo sirve si cuenta eventos elegibles, no todos.
// Una conversacion cancelada por el cliente antes de la primera respuesta no es
// falla del bot: meterla en el denominador diluye la senal y esconde regresiones.

// Motivos que sacan la conversacion de la cuenta. Cada exclusion necesita una
// justificacion escrita, si no se vuelve puerta trasera para maquillar el numero.
const NOT_ELIGIBLE = new Set([
  'client_abandoned_before_first_reply', // se fue antes de que el bot actuara
  'spam_or_test',                        // trafico sintetico
  'out_of_business_hours_by_policy',     // fuera del alcance contratado
]);

export function isEligible(conversation) {
  return !NOT_ELIGIBLE.has(conversation.exclusionReason);
}

// Buen evento: resuelta sin escalamiento indebido, dentro del plazo,
// y sin que el cliente marcara la respuesta como equivocada.
export function isGood(conversation, { maxFirstReplyMs = 30000 } = {}) {
  if (conversation.firstReplyMs > maxFirstReplyMs) return false;
  if (conversation.wrongAnswerReported) return false;
  if (conversation.escalatedBecauseBotFailed) return false;
  return true;
}

// SLI = buenos eventos elegibles / total de eventos elegibles.
export function computeSli(conversations, options) {
  const eligible = conversations.filter(isEligible);
  if (eligible.length === 0) return null; // sin trafico no hay senal
  const good = eligible.filter((c) => isGood(c, options)).length;
  return { sli: good / eligible.length, eligible: eligible.length, good };
}`;

const budgetCodePt = `// error-budget.js
// Orcamento de erro em janela deslizante de 28 dias.
// A politica de deploy le o resultado desta funcao, nao a opiniao de ninguem.

export const WINDOW_DAYS = 28;
const HOURS_IN_WINDOW = WINDOW_DAYS * 24;

// Consumo = falhas observadas / falhas permitidas pelo alvo.
// 1.0 significa orcamento esgotado; acima de 1.0, estourado.
export function budgetConsumption({ eligible, good, target }) {
  const allowedFailures = eligible * (1 - target);
  if (allowedFailures <= 0) return null; // alvo de 100% nao tem orcamento
  const observedFailures = eligible - good;
  return observedFailures / allowedFailures;
}

// Taxa de queima: quantas vezes mais rapido que o ritmo sustentavel.
// 1x consome exatamente o orcamento ao longo dos 28 dias.
export function burnRate({ eligible, good, target, windowHours }) {
  const errorRate = (eligible - good) / eligible;
  const sustainableRate = 1 - target;
  const speed = errorRate / sustainableRate;
  // Fracao do orcamento total queimada nesta janela de observacao.
  const budgetBurned = (speed * windowHours) / HOURS_IN_WINDOW;
  return { speed, windowHours, budgetBurned };
}

// Alertas de queima em duas janelas: uma rapida para pegar incidente agudo,
// uma lenta para pegar degradacao continua que a janela curta nao ve.
export function burnAlerts(shortWindow, longWindow) {
  const alerts = [];
  // 14.4x por 1h queima 2% do orcamento: pagina agora.
  if (shortWindow.speed >= 14.4) alerts.push({ severity: 'page', reason: 'fast burn' });
  // 3x por 6h queima 5% do orcamento: abre ticket, nao acorda ninguem.
  else if (longWindow.speed >= 3) alerts.push({ severity: 'ticket', reason: 'slow burn' });
  return alerts;
}

// A decisao de deploy sai daqui, sem espaco para interpretacao.
export function releaseDecision(consumption) {
  if (consumption === null) return { allow: true, mode: 'no-budget-defined' };
  if (consumption >= 1) return { allow: false, mode: 'freeze-feature-work' };
  if (consumption >= 0.75) return { allow: true, mode: 'reliability-only' };
  return { allow: true, mode: 'normal' };
}`;

const budgetCodeEn = `// error-budget.js
// Error budget over a 28 day sliding window.
// The release policy reads the result of this function, not anyone's opinion.

export const WINDOW_DAYS = 28;
const HOURS_IN_WINDOW = WINDOW_DAYS * 24;

// Consumption = observed failures / failures allowed by the target.
// 1.0 means the budget is exhausted; above 1.0, it is blown.
export function budgetConsumption({ eligible, good, target }) {
  const allowedFailures = eligible * (1 - target);
  if (allowedFailures <= 0) return null; // a 100% target has no budget
  const observedFailures = eligible - good;
  return observedFailures / allowedFailures;
}

// Burn rate: how many times faster than the sustainable pace.
// 1x consumes exactly the budget over the 28 days.
export function burnRate({ eligible, good, target, windowHours }) {
  const errorRate = (eligible - good) / eligible;
  const sustainableRate = 1 - target;
  const speed = errorRate / sustainableRate;
  // Fraction of the total budget burned during this observation window.
  const budgetBurned = (speed * windowHours) / HOURS_IN_WINDOW;
  return { speed, windowHours, budgetBurned };
}

// Burn alerts over two windows: a fast one to catch an acute incident,
// a slow one to catch continuous degradation the short window cannot see.
export function burnAlerts(shortWindow, longWindow) {
  const alerts = [];
  // 14.4x over 1h burns 2% of the budget: page now.
  if (shortWindow.speed >= 14.4) alerts.push({ severity: 'page', reason: 'fast burn' });
  // 3x over 6h burns 5% of the budget: open a ticket, do not wake anyone.
  else if (longWindow.speed >= 3) alerts.push({ severity: 'ticket', reason: 'slow burn' });
  return alerts;
}

// The release decision comes from here, with no room for interpretation.
export function releaseDecision(consumption) {
  if (consumption === null) return { allow: true, mode: 'no-budget-defined' };
  if (consumption >= 1) return { allow: false, mode: 'freeze-feature-work' };
  if (consumption >= 0.75) return { allow: true, mode: 'reliability-only' };
  return { allow: true, mode: 'normal' };
}`;

const budgetCodeEs = `// error-budget.js
// Presupuesto de error en ventana deslizante de 28 dias.
// La politica de deploy lee el resultado de esta funcion, no la opinion de nadie.

export const WINDOW_DAYS = 28;
const HOURS_IN_WINDOW = WINDOW_DAYS * 24;

// Consumo = fallas observadas / fallas permitidas por el objetivo.
// 1.0 significa presupuesto agotado; arriba de 1.0, reventado.
export function budgetConsumption({ eligible, good, target }) {
  const allowedFailures = eligible * (1 - target);
  if (allowedFailures <= 0) return null; // un objetivo de 100% no tiene presupuesto
  const observedFailures = eligible - good;
  return observedFailures / allowedFailures;
}

// Tasa de quema: cuantas veces mas rapido que el ritmo sostenible.
// 1x consume exactamente el presupuesto a lo largo de los 28 dias.
export function burnRate({ eligible, good, target, windowHours }) {
  const errorRate = (eligible - good) / eligible;
  const sustainableRate = 1 - target;
  const speed = errorRate / sustainableRate;
  // Fraccion del presupuesto total quemada en esta ventana de observacion.
  const budgetBurned = (speed * windowHours) / HOURS_IN_WINDOW;
  return { speed, windowHours, budgetBurned };
}

// Alertas de quema en dos ventanas: una rapida para el incidente agudo,
// una lenta para la degradacion continua que la ventana corta no ve.
export function burnAlerts(shortWindow, longWindow) {
  const alerts = [];
  // 14.4x por 1h quema 2% del presupuesto: llama ahora.
  if (shortWindow.speed >= 14.4) alerts.push({ severity: 'page', reason: 'fast burn' });
  // 3x por 6h quema 5% del presupuesto: abre ticket, no despiertes a nadie.
  else if (longWindow.speed >= 3) alerts.push({ severity: 'ticket', reason: 'slow burn' });
  return alerts;
}

// La decision de deploy sale de aqui, sin espacio para interpretacion.
export function releaseDecision(consumption) {
  if (consumption === null) return { allow: true, mode: 'no-budget-defined' };
  if (consumption >= 1) return { allow: false, mode: 'freeze-feature-work' };
  if (consumption >= 0.75) return { allow: true, mode: 'reliability-only' };
  return { allow: true, mode: 'normal' };
}`;

const diagramPt = `alvo 97% em janela de 28 dias, 100 mil conversas elegiveis
orcamento total = 3% de 100 mil = 3.000 falhas permitidas

  |################................................| 32% consumido
  ^                                                ^
  dia 1                                            dia 28

regime normal (consumo < 75%):
  lanca feature normalmente, retry de risco permitido

regime de atencao (consumo entre 75% e 100%):
  so entra trabalho que reduz falha; feature nova espera

orcamento esgotado (consumo >= 100%):
  congela feature ate a janela deslizar e devolver folga

taxa de queima diz QUANDO agir, nao so SE agir:
  14,4x por 1h  -> queimou 2% do orcamento -> acorda alguem
   3,0x por 6h  -> queimou 5% do orcamento -> abre ticket
   1,0x         -> ritmo sustentavel, nada a fazer`;

const diagramEn = `97% target over a 28 day window, 100k eligible conversations
total budget = 3% of 100k = 3,000 allowed failures

  |################................................| 32% consumed
  ^                                                ^
  day 1                                            day 28

normal regime (consumption < 75%):
  ship features normally, risky retries allowed

caution regime (consumption between 75% and 100%):
  only work that reduces failure gets in; new features wait

budget exhausted (consumption >= 100%):
  freeze features until the window slides and returns slack

burn rate tells you WHEN to act, not only IF to act:
  14.4x over 1h -> burned 2% of the budget -> wake someone up
   3.0x over 6h -> burned 5% of the budget -> open a ticket
   1.0x         -> sustainable pace, nothing to do`;

const diagramEs = `objetivo 97% en ventana de 28 dias, 100 mil conversaciones elegibles
presupuesto total = 3% de 100 mil = 3.000 fallas permitidas

  |################................................| 32% consumido
  ^                                                ^
  dia 1                                            dia 28

regimen normal (consumo < 75%):
  lanza features normalmente, retry de riesgo permitido

regimen de atencion (consumo entre 75% y 100%):
  solo entra trabajo que reduce falla; feature nueva espera

presupuesto agotado (consumo >= 100%):
  congela features hasta que la ventana deslice y devuelva holgura

la tasa de quema dice CUANDO actuar, no solo SI actuar:
  14,4x por 1h -> quemo 2% del presupuesto -> despierta a alguien
   3,0x por 6h -> quemo 5% del presupuesto -> abre ticket
   1,0x        -> ritmo sostenible, nada que hacer`;

const pt = {
  intro:
    'A pergunta que trava toda reunião de produto quando o bot erra é sempre a mesma: a gente pausa o roadmap ou segue lançando? E ela é sempre respondida do mesmo jeito, que é o pior possível: quem grita mais alto decide. Se o time de suporte teve uma semana ruim, congela tudo. Se a pressão comercial é maior, segue lançando com uma promessa vaga de melhorar a qualidade depois. Nos dois casos a decisão foi tomada por política interna, não por evidência, e o resultado é um pêndulo entre paralisia e negligência que nunca converge. O orçamento de erro existe justamente para tirar essa decisão do campo da opinião. A ideia é declarar antes, com o negócio junto, quanta falha o atendimento pode ter em uma janela de tempo, medir o consumo real desse limite, e amarrar a política de deploy no número resultante. Quando o orçamento está sobrando, lançar é seguro e a discussão nem acontece. Quando está esgotado, o roadmap para sozinho, sem ninguém precisar convencer ninguém. Este artigo mostra como definir o SLI que realmente mede o atendimento, como escolher um alvo que não seja cem por cento disfarçado, como calcular consumo e taxa de queima, e como escrever a política de congelamento de forma que ela seja verificável em vez de negociável.',
  sections: [
    {
      title: 'O SLI de atendimento não é uptime, e essa é a parte difícil',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em um serviço de infraestrutura o indicador é direto: a requisição respondeu com sucesso dentro do prazo ou não. Em atendimento automatizado essa definição não cobre quase nada do que importa. O bot pode responder em duzentos milissegundos, com status 200, e ter dado uma resposta completamente errada. Do ponto de vista de disponibilidade, foi um sucesso. Do ponto de vista do cliente, foi uma falha pior do que uma indisponibilidade honesta, porque ele agiu com base numa informação incorreta.',
        },
        {
          type: 'paragraph',
          value:
            'Por isso o SLI precisa ser composto por sinais de qualidade, não só de resposta. Na prática funciona bem definir um evento bom como a conversa que teve primeira resposta dentro do prazo, não foi marcada como resposta errada pelo cliente, e não escalou para humano por falha do bot. Repare no qualificador na última condição: escalar porque o assunto exige um humano é o comportamento correto e não pode contar como falha, senão o sistema aprende a não escalar nunca, que é exatamente o oposto do desejado.',
        },
        {
          type: 'paragraph',
          value:
            'A segunda decisão difícil é o denominador. Toda conversa entra na conta? Não. A conversa que o cliente abandonou antes da primeira resposta não mede qualidade do bot, e incluí-la dilui o indicador com ruído. Mas cada exclusão precisa de justificativa escrita e revisão, porque a lista de exclusões é a porta dos fundos mais fácil para maquiar o número: basta ir marcando como não elegível tudo que ficou ruim.',
        },
        {
          type: 'code',
          value: sliCodePt,
        },
        {
          type: 'paragraph',
          value:
            'Vale a pena começar com um SLI só. É tentador definir cinco indicadores no primeiro dia, mas cada um deles precisa de alvo, de alerta e de revisão periódica, e um time que não consegue manter um SLI honesto não vai manter cinco. Comece pelo que o cliente sente primeiro, tipicamente resposta correta dentro do prazo, e só adicione outro quando o primeiro estiver estável e confiável.',
        },
      ],
    },
    {
      title: 'Escolher o alvo: por que 99,9% em atendimento é quase sempre errado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reflexo de todo time técnico é copiar o alvo de disponibilidade de infraestrutura, e o número que sai é sempre alguma quantidade de noves. Mas atendimento automatizado não se parece com um serviço de rede: ele lida com linguagem ambígua, contexto incompleto e pedidos que às vezes nem têm resposta certa. Um alvo de 99,9% significa aceitar uma falha a cada mil conversas, o que na prática é indistinguível de exigir perfeição, e o efeito colateral é imediato: o orçamento estoura na primeira semana, o congelamento vira permanente, e o time simplesmente para de olhar para o indicador porque ele perdeu a utilidade.',
        },
        {
          type: 'paragraph',
          value:
            'O alvo certo é o menor número que ainda mantém o cliente satisfeito. Isso soa cínico e é justamente o ponto: confiabilidade acima do necessário custa caro e não é percebida. Se o cliente não distingue 97% de 99%, o alvo é 97%, e os dois pontos de diferença são orçamento real que compra velocidade de entrega. A forma de descobrir esse número não é técnica: é olhar reclamação, churn e volume de escalonamento nos períodos em que o indicador esteve em cada faixa.',
        },
        {
          type: 'table',
          columns: ['Alvo', 'Falhas em 100 mil conversas', 'Efeito prático', 'Quando faz sentido'],
          rows: [
            ['90%', '10.000', 'Orçamento largo, quase nunca congela', 'Bot novo, escopo experimental'],
            ['95%', '5.000', 'Folga real para experimentar', 'Operação em amadurecimento'],
            ['97%', '3.000', 'Aperta em semana ruim, ainda gerenciável', 'Operação estável e madura'],
            ['99%', '1.000', 'Uma regressão média já esgota', 'Só com eval forte e canário'],
            ['99,9%', '100', 'Congelamento vira permanente', 'Quase nunca em atendimento'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Um alvo bom também tem prazo de validade. Se o orçamento nunca chega perto de esgotar em seis meses, ele está frouxo e não está comprando nada: é hora de subir o alvo e converter a folga em exigência de qualidade. Se ele estoura todo mês, ou o alvo é irreal ou existe um problema estrutural que o congelamento não vai resolver sozinho. Revisar o alvo a cada trimestre, com o dado dos três meses anteriores na mesa, é o que impede que ele vire número decorativo.',
        },
      ],
    },
    {
      title: 'Consumo e taxa de queima: dois números que respondem perguntas diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O consumo do orçamento responde uma pergunta de estoque: quanto da folga desta janela já foi gasto. É o número que governa a política de deploy, porque ele diz se ainda há espaço para correr risco. A taxa de queima responde uma pergunta de fluxo: em que velocidade a folga está sendo consumida agora. É o número que governa alerta, porque ele detecta o problema antes do estoque acabar.',
        },
        {
          type: 'paragraph',
          value:
            'A distinção importa porque os dois falham sozinhos. Só com consumo, você descobre o incidente quando o orçamento já foi embora, tarde demais para agir. Só com taxa de queima, você recebe alerta de uma queima alta que dura dois minutos e não significa nada, e o time aprende a ignorar o alerta. Juntos, eles cobrem os dois modos de falha: a degradação lenta que corrói o mês inteiro sem nunca disparar um pico, e o incidente agudo que consome semanas de folga em uma hora.',
        },
        {
          type: 'diagram',
          value: diagramPt,
        },
        {
          type: 'code',
          value: budgetCodePt,
        },
        {
          type: 'paragraph',
          value:
            'Os números de 14,4x e 3x não são arbitrários. Uma queima de 14,4 vezes o ritmo sustentável durante uma hora consome exatamente dois por cento do orçamento de 28 dias, o que é rápido o bastante para justificar acordar alguém. Uma queima de 3 vezes durante seis horas consome cinco por cento, que é sério mas não é emergência: vira ticket priorizado. Esses dois patamares cobrem bem os casos reais sem gerar a enxurrada de alerta que faz o time desligar a notificação.',
        },
        {
          type: 'paragraph',
          value:
            'A janela deslizante de 28 dias é preferível ao mês de calendário por um motivo prático: com mês de calendário, o orçamento zera na virada, e o time aprende que basta aguentar até o dia primeiro para tudo ser perdoado. Com janela deslizante, o incidente de ontem continua pesando por 28 dias, e a folga volta gradualmente, o que reflete melhor a experiência real de quem foi mal atendido na semana passada.',
        },
      ],
    },
    {
      title: 'A política de congelamento precisa ser escrita antes de precisar dela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O orçamento de erro só funciona se a consequência for automática. Um número bonito no painel que todo mundo olha e ignora não muda comportamento nenhum. A política precisa estar escrita, acordada com quem tem poder de decidir prioridade, e assinada antes do primeiro incidente, porque no meio do incidente ninguém aceita um congelamento que está sendo proposto na hora.',
        },
        {
          type: 'paragraph',
          value:
            'Três faixas costumam bastar. Abaixo de setenta e cinco por cento de consumo, operação normal: lança feature, faz experimento, aceita risco. Entre setenta e cinco e cem por cento, regime de atenção: entra apenas trabalho que reduz falha, e feature nova espera. Acima de cem por cento, congelamento de feature até a janela deslizar e devolver folga. O detalhe que decide se isso é levado a sério é o congelamento valer para todo mundo, incluindo o pedido urgente do cliente grande.',
        },
        {
          type: 'table',
          columns: ['Consumo do orçamento', 'O que pode entrar', 'O que fica bloqueado', 'Quem é avisado'],
          rows: [
            ['Abaixo de 75%', 'Feature, experimento, refatoração', 'Nada', 'Ninguém, é o normal'],
            ['75% a 100%', 'Correção de falha e redução de risco', 'Feature nova, mudança de prompt ampla', 'Time e produto'],
            ['Acima de 100%', 'Só trabalho de confiabilidade', 'Todo roadmap de feature', 'Time, produto e liderança'],
            ['Acima de 150%', 'Confiabilidade e revisão de escopo', 'Feature e ampliação de cobertura do bot', 'Liderança e responsável pelo contrato'],
          ],
        },
        {
          type: 'list',
          items: [
            'Escreva a política antes do incidente e obtenha aprovação de quem prioriza roadmap, não só do time técnico.',
            'Defina uma exceção explícita e rara, com quem aprova e por quanto tempo, em vez de deixar a exceção implícita.',
            'Publique o consumo do orçamento no mesmo lugar onde o roadmap é discutido, para que o número apareça na conversa certa.',
            'Trate o congelamento como resultado esperado do sistema funcionando, não como punição do time.',
            'Registre toda exclusão de conversa não elegível com justificativa auditável, para que o SLI não seja maquiado.',
          ],
        },
      ],
    },
    {
      title: 'O que muda no ciclo de release quando o orçamento é levado a sério',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A mudança mais visível é que a discussão sobre lançar ou não some da pauta. Com o orçamento sobrando, ninguém pergunta se pode lançar, porque a resposta já está no painel. Com o orçamento esgotado, ninguém precisa defender o congelamento, porque ele foi acordado meses antes. O tempo que o time gastava negociando prioridade em cima de percepção passa a ser gasto reduzindo falha, que é o que efetivamente libera orçamento.',
        },
        {
          type: 'paragraph',
          value:
            'A segunda mudança é no desenho do próprio release. Quando o custo do erro é explícito, o canário deixa de ser opcional. Lançar uma mudança de prompt para cinco por cento do tráfego e comparar o SLI do grupo exposto com o do grupo controle custa um dia a mais e evita queimar semanas de orçamento numa regressão que só apareceria no agregado dias depois. O orçamento não proíbe risco: ele cobra que o risco seja limitado e observável.',
        },
        {
          type: 'ordered',
          items: [
            'Defina um SLI composto por resposta correta e prazo, com regras de elegibilidade escritas e revisadas.',
            'Escolha o alvo pelo menor valor que mantém o cliente satisfeito, com dado de reclamação e escalonamento na mesa.',
            'Calcule consumo em janela deslizante de 28 dias e publique no painel que o time realmente olha.',
            'Configure alerta de queima em duas janelas, uma rápida para incidente agudo e uma lenta para degradação contínua.',
            'Escreva a política de release nas três faixas e obtenha aprovação de quem prioriza roadmap.',
            'Revise alvo e regras de elegibilidade a cada trimestre com os dados dos três meses anteriores.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro mais comum na implantação é começar pela ferramenta. Painel, alerta e integração com o pipeline são a parte fácil e são inúteis sem acordo sobre o que conta como falha e o que acontece quando o orçamento acaba. Um mês de dado honesto sobre um SLI só, com uma política de três linhas que a liderança realmente assinou, produz mais mudança de comportamento do que um painel completo que ninguém usa para decidir nada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como definir o alvo do SLI se não tenho histórico de qualidade?',
      answer:
        'Meça primeiro e defina depois. Rode o cálculo do SLI sobre trinta dias de conversas já arquivadas, sem alvo nenhum, só para descobrir onde você está hoje. Se o resultado for 94%, um alvo inicial razoável é algo próximo disso, talvez 93%, que é honesto e ainda cria alguma pressão. Definir 99% antes de saber que a realidade é 94% garante orçamento estourado desde o primeiro dia e um congelamento permanente que ninguém vai respeitar. Depois de dois ou três trimestres com dado real, o alvo pode subir de forma incremental, sempre acompanhado de investimento em qualidade que justifique a exigência maior.',
    },
    {
      question: 'O congelamento de features vale mesmo para pedido urgente de cliente grande?',
      answer:
        'Se não valer, o orçamento não existe: vira sugestão. A saída correta não é abrir exceção informal e sim ter um mecanismo de exceção escrito na própria política, com nome de quem aprova, prazo máximo e registro do motivo. Exceção rara e documentada preserva a credibilidade do sistema; exceção informal e frequente destrói. E vale notar que o pedido urgente do cliente grande costuma perder força quando a conversa muda de "o time não quer lançar" para "estamos com o orçamento de erro estourado e um incidente de qualidade em aberto", porque essa segunda frase é verificável.',
    },
    {
      question: 'Orçamento de erro serve para bot com pouco volume de conversas?',
      answer:
        'Serve, mas o cálculo precisa de cuidado com ruído estatístico. Com trezentas conversas por mês e alvo de 97%, o orçamento inteiro são nove falhas, e duas conversas ruins num dia já movem o indicador de forma dramática sem que nada estrutural tenha mudado. Nesse regime, use janela mais longa, de sessenta ou noventa dias, para acumular volume suficiente, e trate o alerta de queima rápida com ceticismo. A alternativa, em volume muito baixo, é revisar conversa por conversa e usar o orçamento como instrumento de conversa periódica em vez de gatilho automático de congelamento.',
    },
  ],
  conclusion: {
    title: 'Quando parar de lançar deixa de ser opinião e vira leitura de painel',
    description:
      'Um SLI que mede resposta correta dentro do prazo, com regras de elegibilidade escritas, um alvo escolhido pelo menor valor que mantém o cliente satisfeito, e o consumo calculado em janela deslizante transformam a decisão mais política do roadmap em consulta a um número. Alerta de queima em duas janelas pega tanto o incidente agudo quanto a degradação lenta, e uma política de três faixas acordada antes do incidente garante que a consequência seja automática. O ganho não é o congelamento: é parar de discutir.',
    cta: 'Falar sobre orçamento de erro no meu atendimento automatizado',
  },
  related: [
    { label: 'Como desenhar SLAs de atendimento com bot + humano', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'Avaliação contínua de bots: do eval manual ao automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The question that stalls every product meeting when the bot gets something wrong is always the same: do we pause the roadmap or keep shipping? And it is always answered the same way, which is the worst possible one: whoever shouts loudest decides. If the support team had a bad week, freeze everything. If commercial pressure is stronger, keep shipping with a vague promise to improve quality later. In both cases the decision was made by internal politics, not evidence, and the result is a pendulum between paralysis and negligence that never converges. The error budget exists precisely to take that decision out of the realm of opinion. The idea is to declare up front, together with the business, how much failure support is allowed over a time window, measure the real consumption of that allowance, and tie the release policy to the resulting number. When the budget has room, shipping is safe and the discussion never happens. When it is exhausted, the roadmap stops on its own, with nobody having to convince anybody. This article shows how to define the SLI that actually measures support, how to pick a target that is not a hundred percent in disguise, how to compute consumption and burn rate, and how to write the freeze policy so it is verifiable rather than negotiable.',
  sections: [
    {
      title: 'A support SLI is not uptime, and that is the hard part',
      blocks: [
        {
          type: 'paragraph',
          value:
            'On an infrastructure service the indicator is direct: the request either succeeded within the deadline or it did not. In automated support that definition covers almost nothing that matters. The bot can answer in two hundred milliseconds, with status 200, and have given a completely wrong answer. From an availability point of view, that was a success. From the customer point of view, it was a failure worse than an honest outage, because they acted on incorrect information.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the SLI has to be composed of quality signals, not just response signals. In practice it works well to define a good event as a conversation that got a first reply within the deadline, was not flagged as a wrong answer by the customer, and did not escalate to a human because the bot failed. Notice the qualifier in that last condition: escalating because the topic genuinely requires a human is the correct behavior and cannot count as a failure, otherwise the system learns to never escalate, which is exactly the opposite of what you want.',
        },
        {
          type: 'paragraph',
          value:
            'The second hard decision is the denominator. Does every conversation go into the count? No. A conversation the customer abandoned before the first reply does not measure bot quality, and including it dilutes the indicator with noise. But every exclusion needs a written justification and review, because the exclusion list is the easiest back door for faking the number: just keep marking as not eligible everything that went badly.',
        },
        {
          type: 'code',
          value: sliCodeEn,
        },
        {
          type: 'paragraph',
          value:
            'It is worth starting with a single SLI. It is tempting to define five indicators on day one, but each of them needs a target, an alert and periodic review, and a team that cannot keep one SLI honest will not keep five. Start with what the customer feels first, typically a correct answer within the deadline, and only add another once the first one is stable and trustworthy.',
        },
      ],
    },
    {
      title: 'Picking the target: why 99.9% in support is almost always wrong',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every technical team reflexively copies the availability target from infrastructure, and the number that comes out is always some quantity of nines. But automated support does not look like a network service: it deals with ambiguous language, incomplete context and requests that sometimes have no right answer at all. A 99.9% target means accepting one failure per thousand conversations, which in practice is indistinguishable from demanding perfection, and the side effect is immediate: the budget blows in the first week, the freeze becomes permanent, and the team simply stops looking at the indicator because it lost its usefulness.',
        },
        {
          type: 'paragraph',
          value:
            'The right target is the lowest number that still keeps the customer satisfied. That sounds cynical and that is exactly the point: reliability beyond what is needed is expensive and goes unnoticed. If the customer cannot tell 97% from 99%, the target is 97%, and those two points of difference are real budget that buys delivery speed. The way to find that number is not technical: it is looking at complaints, churn and escalation volume across the periods when the indicator sat in each band.',
        },
        {
          type: 'table',
          columns: ['Target', 'Failures per 100k conversations', 'Practical effect', 'When it makes sense'],
          rows: [
            ['90%', '10,000', 'Wide budget, almost never freezes', 'New bot, experimental scope'],
            ['95%', '5,000', 'Real slack to experiment', 'Operation still maturing'],
            ['97%', '3,000', 'Tight in a bad week, still manageable', 'Stable, mature operation'],
            ['99%', '1,000', 'One average regression exhausts it', 'Only with strong eval and canary'],
            ['99.9%', '100', 'The freeze becomes permanent', 'Almost never in support'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A good target also has an expiry date. If the budget never comes close to running out over six months, it is loose and is not buying anything: time to raise the target and convert the slack into a stricter quality demand. If it blows every month, either the target is unrealistic or there is a structural problem the freeze will not solve on its own. Reviewing the target every quarter, with the previous three months of data on the table, is what keeps it from becoming a decorative number.',
        },
      ],
    },
    {
      title: 'Consumption and burn rate: two numbers answering different questions',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Budget consumption answers a stock question: how much of this window slack has already been spent. It is the number that governs the release policy, because it says whether there is still room to take risk. Burn rate answers a flow question: how fast the slack is being consumed right now. It is the number that governs alerting, because it detects the problem before the stock runs out.',
        },
        {
          type: 'paragraph',
          value:
            'The distinction matters because each fails on its own. With consumption only, you discover the incident once the budget is already gone, too late to act. With burn rate only, you get alerted on a high burn that lasts two minutes and means nothing, and the team learns to ignore the alert. Together they cover both failure modes: the slow degradation that erodes the whole month without ever spiking, and the acute incident that consumes weeks of slack in one hour.',
        },
        {
          type: 'diagram',
          value: diagramEn,
        },
        {
          type: 'code',
          value: budgetCodeEn,
        },
        {
          type: 'paragraph',
          value:
            'The 14.4x and 3x numbers are not arbitrary. A burn of 14.4 times the sustainable pace over one hour consumes exactly two percent of the 28 day budget, which is fast enough to justify waking someone up. A burn of 3 times over six hours consumes five percent, which is serious but not an emergency: it becomes a prioritized ticket. Those two thresholds cover the real cases well without generating the alert flood that makes a team turn notifications off.',
        },
        {
          type: 'paragraph',
          value:
            'A 28 day sliding window is preferable to the calendar month for a practical reason: with a calendar month, the budget resets at the turn, and the team learns that surviving until the first of the month is enough to be forgiven. With a sliding window, yesterday incident keeps weighing for 28 days, and the slack comes back gradually, which better reflects the actual experience of whoever was badly served last week.',
        },
      ],
    },
    {
      title: 'The freeze policy has to be written before you need it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An error budget only works if the consequence is automatic. A nice number on a dashboard everyone looks at and ignores changes no behavior at all. The policy has to be written, agreed with whoever holds priority decision power, and signed before the first incident, because in the middle of an incident nobody accepts a freeze that is being proposed on the spot.',
        },
        {
          type: 'paragraph',
          value:
            'Three bands usually suffice. Below seventy five percent consumption, normal operation: ship features, run experiments, take risk. Between seventy five and one hundred percent, caution regime: only work that reduces failure gets in, and new features wait. Above one hundred percent, feature freeze until the window slides and returns slack. The detail that decides whether this is taken seriously is the freeze applying to everyone, including the urgent request from the big customer.',
        },
        {
          type: 'table',
          columns: ['Budget consumption', 'What can get in', 'What is blocked', 'Who is notified'],
          rows: [
            ['Below 75%', 'Features, experiments, refactoring', 'Nothing', 'Nobody, this is normal'],
            ['75% to 100%', 'Failure fixes and risk reduction', 'New features, broad prompt changes', 'Team and product'],
            ['Above 100%', 'Reliability work only', 'The entire feature roadmap', 'Team, product and leadership'],
            ['Above 150%', 'Reliability and scope review', 'Features and bot coverage expansion', 'Leadership and contract owner'],
          ],
        },
        {
          type: 'list',
          items: [
            'Write the policy before the incident and get approval from whoever prioritizes the roadmap, not just the technical team.',
            'Define an explicit, rare exception, with who approves it and for how long, instead of leaving the exception implicit.',
            'Publish budget consumption in the same place the roadmap is discussed, so the number shows up in the right conversation.',
            'Treat the freeze as the expected result of a working system, not as punishment for the team.',
            'Log every not eligible exclusion with an auditable justification, so the SLI cannot be faked.',
          ],
        },
      ],
    },
    {
      title: 'What changes in the release cycle once the budget is taken seriously',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most visible change is that the discussion about whether to ship disappears from the agenda. With budget to spare, nobody asks whether they can ship, because the answer is already on the dashboard. With the budget exhausted, nobody has to defend the freeze, because it was agreed months earlier. The time the team spent negotiating priority on top of perception gets spent reducing failure instead, which is what actually frees budget.',
        },
        {
          type: 'paragraph',
          value:
            'The second change is in the design of the release itself. When the cost of an error is explicit, the canary stops being optional. Shipping a prompt change to five percent of traffic and comparing the SLI of the exposed group with the control group costs one extra day and avoids burning weeks of budget on a regression that would only show up in the aggregate days later. The budget does not forbid risk: it demands that risk be bounded and observable.',
        },
        {
          type: 'ordered',
          items: [
            'Define an SLI composed of correct answer and deadline, with written and reviewed eligibility rules.',
            'Pick the target as the lowest value that keeps the customer satisfied, with complaint and escalation data on the table.',
            'Compute consumption over a 28 day sliding window and publish it on the dashboard the team actually looks at.',
            'Configure burn alerts over two windows, a fast one for acute incidents and a slow one for continuous degradation.',
            'Write the release policy across the three bands and get approval from whoever prioritizes the roadmap.',
            'Review the target and eligibility rules every quarter with the previous three months of data.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most common rollout mistake is starting with tooling. Dashboards, alerts and pipeline integration are the easy part and are useless without agreement on what counts as failure and what happens when the budget runs out. One month of honest data on a single SLI, with a three line policy leadership actually signed, produces more behavior change than a complete dashboard nobody uses to decide anything.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do I set the SLI target with no quality history?',
      answer:
        'Measure first, set the target afterwards. Run the SLI calculation over thirty days of already archived conversations, with no target at all, just to find out where you are today. If the result is 94%, a reasonable initial target is something near that, maybe 93%, which is honest and still creates some pressure. Setting 99% before knowing reality is 94% guarantees a blown budget from day one and a permanent freeze nobody will respect. After two or three quarters with real data, the target can rise incrementally, always alongside quality investment that justifies the stricter demand.',
    },
    {
      question: 'Does the feature freeze really apply to an urgent request from a big customer?',
      answer:
        'If it does not, the budget does not exist: it becomes a suggestion. The correct way out is not an informal exception but an exception mechanism written into the policy itself, with the name of who approves it, a maximum duration and a logged reason. A rare, documented exception preserves the credibility of the system; an informal, frequent one destroys it. And it is worth noting that the urgent request from the big customer usually loses force once the conversation shifts from "the team does not want to ship" to "we have a blown error budget and an open quality incident", because that second sentence is verifiable.',
    },
    {
      question: 'Is an error budget useful for a bot with low conversation volume?',
      answer:
        'It is, but the calculation needs care with statistical noise. With three hundred conversations a month and a 97% target, the entire budget is nine failures, and two bad conversations in one day already move the indicator dramatically without anything structural having changed. In that regime, use a longer window, sixty or ninety days, to accumulate enough volume, and treat fast burn alerts with skepticism. The alternative, at very low volume, is reviewing conversations one by one and using the budget as an instrument for a periodic conversation rather than an automatic freeze trigger.',
    },
  ],
  conclusion: {
    title: 'When to stop shipping stops being an opinion and becomes a dashboard reading',
    description:
      'An SLI that measures a correct answer within the deadline, with written eligibility rules, a target chosen as the lowest value that keeps the customer satisfied, and consumption computed over a sliding window turn the most political decision on the roadmap into a lookup. Burn alerts over two windows catch both the acute incident and the slow degradation, and a three band policy agreed before the incident makes the consequence automatic. The gain is not the freeze: it is no longer arguing.',
    cta: 'Talk about an error budget for my automated support',
  },
  related: [
    { label: 'How to design support SLAs with bot + human team', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'Continuous bot evaluation: from manual to automated eval', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'La pregunta que traba toda reunión de producto cuando el bot se equivoca es siempre la misma: pausamos el roadmap o seguimos lanzando? Y siempre se responde de la misma forma, que es la peor posible: quien grita más fuerte decide. Si el equipo de soporte tuvo una mala semana, se congela todo. Si la presión comercial es mayor, se sigue lanzando con una promesa vaga de mejorar la calidad después. En ambos casos la decisión la tomó la política interna, no la evidencia, y el resultado es un péndulo entre parálisis y negligencia que nunca converge. El presupuesto de error existe justamente para sacar esa decisión del terreno de la opinión. La idea es declarar antes, junto con el negocio, cuánta falla puede tener la atención en una ventana de tiempo, medir el consumo real de ese límite, y atar la política de deploy al número resultante. Cuando el presupuesto sobra, lanzar es seguro y la discusión ni ocurre. Cuando está agotado, el roadmap se detiene solo, sin que nadie tenga que convencer a nadie. Este artículo muestra cómo definir el SLI que realmente mide la atención, cómo elegir un objetivo que no sea cien por ciento disfrazado, cómo calcular consumo y tasa de quema, y cómo escribir la política de congelamiento de forma que sea verificable en vez de negociable.',
  sections: [
    {
      title: 'El SLI de atención no es uptime, y esa es la parte difícil',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un servicio de infraestructura el indicador es directo: la petición respondió con éxito dentro del plazo o no. En atención automatizada esa definición no cubre casi nada de lo que importa. El bot puede responder en doscientos milisegundos, con status 200, y haber dado una respuesta completamente equivocada. Desde el punto de vista de disponibilidad, fue un éxito. Desde el punto de vista del cliente, fue una falla peor que una indisponibilidad honesta, porque actuó con base en información incorrecta.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso el SLI necesita componerse de señales de calidad, no solo de respuesta. En la práctica funciona bien definir un evento bueno como la conversación que tuvo primera respuesta dentro del plazo, no fue marcada como respuesta equivocada por el cliente, y no escaló a humano por falla del bot. Fíjate en el calificador de esa última condición: escalar porque el asunto realmente exige un humano es el comportamiento correcto y no puede contar como falla, si no el sistema aprende a no escalar nunca, que es exactamente lo opuesto a lo deseado.',
        },
        {
          type: 'paragraph',
          value:
            'La segunda decisión difícil es el denominador. Entra toda conversación en la cuenta? No. La conversación que el cliente abandonó antes de la primera respuesta no mide calidad del bot, e incluirla diluye el indicador con ruido. Pero cada exclusión necesita justificación escrita y revisión, porque la lista de exclusiones es la puerta trasera más fácil para maquillar el número: basta con ir marcando como no elegible todo lo que salió mal.',
        },
        {
          type: 'code',
          value: sliCodeEs,
        },
        {
          type: 'paragraph',
          value:
            'Vale la pena empezar con un solo SLI. Es tentador definir cinco indicadores el primer día, pero cada uno necesita objetivo, alerta y revisión periódica, y un equipo que no logra mantener un SLI honesto no va a mantener cinco. Empieza por lo que el cliente siente primero, típicamente respuesta correcta dentro del plazo, y solo agrega otro cuando el primero esté estable y confiable.',
        },
      ],
    },
    {
      title: 'Elegir el objetivo: por qué 99,9% en atención casi siempre está mal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reflejo de todo equipo técnico es copiar el objetivo de disponibilidad de infraestructura, y el número que sale es siempre alguna cantidad de nueves. Pero la atención automatizada no se parece a un servicio de red: lidia con lenguaje ambiguo, contexto incompleto y pedidos que a veces ni tienen respuesta correcta. Un objetivo de 99,9% significa aceptar una falla cada mil conversaciones, lo que en la práctica es indistinguible de exigir perfección, y el efecto colateral es inmediato: el presupuesto revienta la primera semana, el congelamiento se vuelve permanente, y el equipo simplemente deja de mirar el indicador porque perdió utilidad.',
        },
        {
          type: 'paragraph',
          value:
            'El objetivo correcto es el número más bajo que todavía mantiene al cliente satisfecho. Suena cínico y es justamente el punto: la confiabilidad por encima de lo necesario cuesta caro y no se percibe. Si el cliente no distingue 97% de 99%, el objetivo es 97%, y esos dos puntos de diferencia son presupuesto real que compra velocidad de entrega. La forma de descubrir ese número no es técnica: es mirar reclamos, churn y volumen de escalamiento en los periodos en que el indicador estuvo en cada franja.',
        },
        {
          type: 'table',
          columns: ['Objetivo', 'Fallas en 100 mil conversaciones', 'Efecto práctico', 'Cuándo tiene sentido'],
          rows: [
            ['90%', '10.000', 'Presupuesto amplio, casi nunca congela', 'Bot nuevo, alcance experimental'],
            ['95%', '5.000', 'Holgura real para experimentar', 'Operación en maduración'],
            ['97%', '3.000', 'Aprieta en semana mala, aún manejable', 'Operación estable y madura'],
            ['99%', '1.000', 'Una regresión media ya lo agota', 'Solo con eval fuerte y canario'],
            ['99,9%', '100', 'El congelamiento se vuelve permanente', 'Casi nunca en atención'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Un buen objetivo también tiene fecha de vencimiento. Si el presupuesto nunca se acerca a agotarse en seis meses, está flojo y no está comprando nada: es hora de subir el objetivo y convertir la holgura en exigencia de calidad. Si revienta todos los meses, o el objetivo es irreal o existe un problema estructural que el congelamiento no va a resolver solo. Revisar el objetivo cada trimestre, con el dato de los tres meses anteriores sobre la mesa, es lo que impide que se vuelva número decorativo.',
        },
      ],
    },
    {
      title: 'Consumo y tasa de quema: dos números que responden preguntas distintas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El consumo del presupuesto responde una pregunta de stock: cuánto de la holgura de esta ventana ya se gastó. Es el número que gobierna la política de deploy, porque dice si todavía hay espacio para correr riesgo. La tasa de quema responde una pregunta de flujo: a qué velocidad se está consumiendo la holgura ahora. Es el número que gobierna la alerta, porque detecta el problema antes de que el stock se acabe.',
        },
        {
          type: 'paragraph',
          value:
            'La distinción importa porque cada uno falla por separado. Solo con consumo, descubres el incidente cuando el presupuesto ya se fue, demasiado tarde para actuar. Solo con tasa de quema, recibes alerta de una quema alta que dura dos minutos y no significa nada, y el equipo aprende a ignorar la alerta. Juntos cubren los dos modos de falla: la degradación lenta que corroe el mes entero sin disparar nunca un pico, y el incidente agudo que consume semanas de holgura en una hora.',
        },
        {
          type: 'diagram',
          value: diagramEs,
        },
        {
          type: 'code',
          value: budgetCodeEs,
        },
        {
          type: 'paragraph',
          value:
            'Los números de 14,4x y 3x no son arbitrarios. Una quema de 14,4 veces el ritmo sostenible durante una hora consume exactamente dos por ciento del presupuesto de 28 días, lo suficientemente rápido como para justificar despertar a alguien. Una quema de 3 veces durante seis horas consume cinco por ciento, que es serio pero no es emergencia: se vuelve ticket priorizado. Esos dos umbrales cubren bien los casos reales sin generar la avalancha de alertas que hace que el equipo apague la notificación.',
        },
        {
          type: 'paragraph',
          value:
            'La ventana deslizante de 28 días es preferible al mes calendario por un motivo práctico: con mes calendario, el presupuesto se pone en cero al cambiar de mes, y el equipo aprende que basta aguantar hasta el día primero para que todo sea perdonado. Con ventana deslizante, el incidente de ayer sigue pesando por 28 días, y la holgura vuelve gradualmente, lo que refleja mejor la experiencia real de quien fue mal atendido la semana pasada.',
        },
      ],
    },
    {
      title: 'La política de congelamiento hay que escribirla antes de necesitarla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El presupuesto de error solo funciona si la consecuencia es automática. Un número bonito en el panel que todos miran e ignoran no cambia ningún comportamiento. La política tiene que estar escrita, acordada con quien tiene poder de decidir prioridad, y firmada antes del primer incidente, porque en medio del incidente nadie acepta un congelamiento que se está proponiendo en ese momento.',
        },
        {
          type: 'paragraph',
          value:
            'Tres franjas suelen bastar. Debajo de setenta y cinco por ciento de consumo, operación normal: lanza feature, hace experimento, acepta riesgo. Entre setenta y cinco y cien por ciento, régimen de atención: entra solo trabajo que reduce falla, y feature nueva espera. Arriba de cien por ciento, congelamiento de feature hasta que la ventana deslice y devuelva holgura. El detalle que decide si esto se toma en serio es que el congelamiento valga para todos, incluido el pedido urgente del cliente grande.',
        },
        {
          type: 'table',
          columns: ['Consumo del presupuesto', 'Qué puede entrar', 'Qué queda bloqueado', 'Quién es avisado'],
          rows: [
            ['Debajo de 75%', 'Feature, experimento, refactorización', 'Nada', 'Nadie, es lo normal'],
            ['75% a 100%', 'Corrección de falla y reducción de riesgo', 'Feature nueva, cambio de prompt amplio', 'Equipo y producto'],
            ['Arriba de 100%', 'Solo trabajo de confiabilidad', 'Todo el roadmap de feature', 'Equipo, producto y liderazgo'],
            ['Arriba de 150%', 'Confiabilidad y revisión de alcance', 'Feature y ampliación de cobertura del bot', 'Liderazgo y responsable del contrato'],
          ],
        },
        {
          type: 'list',
          items: [
            'Escribe la política antes del incidente y consigue aprobación de quien prioriza el roadmap, no solo del equipo técnico.',
            'Define una excepción explícita y rara, con quién aprueba y por cuánto tiempo, en vez de dejar la excepción implícita.',
            'Publica el consumo del presupuesto en el mismo lugar donde se discute el roadmap, para que el número aparezca en la conversación correcta.',
            'Trata el congelamiento como resultado esperado del sistema funcionando, no como castigo al equipo.',
            'Registra toda exclusión de conversación no elegible con justificación auditable, para que el SLI no se maquille.',
          ],
        },
      ],
    },
    {
      title: 'Qué cambia en el ciclo de release cuando el presupuesto se toma en serio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio más visible es que la discusión sobre lanzar o no desaparece de la agenda. Con presupuesto de sobra, nadie pregunta si puede lanzar, porque la respuesta ya está en el panel. Con el presupuesto agotado, nadie necesita defender el congelamiento, porque se acordó meses antes. El tiempo que el equipo gastaba negociando prioridad sobre percepción pasa a gastarse reduciendo falla, que es lo que efectivamente libera presupuesto.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo cambio está en el diseño del propio release. Cuando el costo del error es explícito, el canario deja de ser opcional. Lanzar un cambio de prompt para cinco por ciento del tráfico y comparar el SLI del grupo expuesto con el del grupo de control cuesta un día más y evita quemar semanas de presupuesto en una regresión que solo aparecería en el agregado días después. El presupuesto no prohíbe el riesgo: exige que el riesgo sea acotado y observable.',
        },
        {
          type: 'ordered',
          items: [
            'Define un SLI compuesto por respuesta correcta y plazo, con reglas de elegibilidad escritas y revisadas.',
            'Elige el objetivo por el valor más bajo que mantiene al cliente satisfecho, con dato de reclamo y escalamiento sobre la mesa.',
            'Calcula el consumo en ventana deslizante de 28 días y publícalo en el panel que el equipo realmente mira.',
            'Configura alerta de quema en dos ventanas, una rápida para incidente agudo y una lenta para degradación continua.',
            'Escribe la política de release en las tres franjas y consigue aprobación de quien prioriza el roadmap.',
            'Revisa objetivo y reglas de elegibilidad cada trimestre con los datos de los tres meses anteriores.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error más común en la implantación es empezar por la herramienta. Panel, alerta e integración con el pipeline son la parte fácil y son inútiles sin acuerdo sobre qué cuenta como falla y qué pasa cuando el presupuesto se acaba. Un mes de dato honesto sobre un solo SLI, con una política de tres líneas que el liderazgo realmente firmó, produce más cambio de comportamiento que un panel completo que nadie usa para decidir nada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Cómo definir el objetivo del SLI si no tengo histórico de calidad?',
      answer:
        'Mide primero y define después. Corre el cálculo del SLI sobre treinta días de conversaciones ya archivadas, sin ningún objetivo, solo para descubrir dónde estás hoy. Si el resultado es 94%, un objetivo inicial razonable es algo cercano a eso, tal vez 93%, que es honesto y todavía crea algo de presión. Definir 99% antes de saber que la realidad es 94% garantiza presupuesto reventado desde el primer día y un congelamiento permanente que nadie va a respetar. Después de dos o tres trimestres con dato real, el objetivo puede subir de forma incremental, siempre acompañado de inversión en calidad que justifique la exigencia mayor.',
    },
    {
      question: 'El congelamiento de features vale de verdad para el pedido urgente de un cliente grande?',
      answer:
        'Si no vale, el presupuesto no existe: se vuelve sugerencia. La salida correcta no es abrir una excepción informal sino tener un mecanismo de excepción escrito en la propia política, con el nombre de quien aprueba, plazo máximo y registro del motivo. Una excepción rara y documentada preserva la credibilidad del sistema; una informal y frecuente la destruye. Y vale notar que el pedido urgente del cliente grande suele perder fuerza cuando la conversación cambia de "el equipo no quiere lanzar" a "tenemos el presupuesto de error reventado y un incidente de calidad abierto", porque esa segunda frase es verificable.',
    },
    {
      question: 'El presupuesto de error sirve para un bot con poco volumen de conversaciones?',
      answer:
        'Sirve, pero el cálculo necesita cuidado con el ruido estadístico. Con trescientas conversaciones al mes y objetivo de 97%, el presupuesto entero son nueve fallas, y dos conversaciones malas en un día ya mueven el indicador de forma dramática sin que nada estructural haya cambiado. En ese régimen, usa una ventana más larga, de sesenta o noventa días, para acumular volumen suficiente, y trata la alerta de quema rápida con escepticismo. La alternativa, en volumen muy bajo, es revisar conversación por conversación y usar el presupuesto como instrumento de conversación periódica en vez de gatillo automático de congelamiento.',
    },
  ],
  conclusion: {
    title: 'Cuándo dejar de lanzar deja de ser opinión y se vuelve lectura de panel',
    description:
      'Un SLI que mide respuesta correcta dentro del plazo, con reglas de elegibilidad escritas, un objetivo elegido por el valor más bajo que mantiene al cliente satisfecho, y el consumo calculado en ventana deslizante transforman la decisión más política del roadmap en una consulta a un número. La alerta de quema en dos ventanas atrapa tanto el incidente agudo como la degradación lenta, y una política de tres franjas acordada antes del incidente hace que la consecuencia sea automática. La ganancia no es el congelamiento: es dejar de discutir.',
    cta: 'Hablar sobre presupuesto de error en mi atención automatizada',
  },
  related: [
    { label: 'Cómo diseñar SLAs de atención con bot + equipo humano', to: '/blog/slas-atendimento-bot-humano' },
    { label: 'Evaluación continua de bots: del eval manual al automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
