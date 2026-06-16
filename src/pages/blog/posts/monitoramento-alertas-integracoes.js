// Conteudo do artigo: Monitoramento e alertas em integracoes.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related }.

const pt = {
  intro:
    'Integracao que so e observada quando ja caiu vira rotina de apagar incendio. ' +
    'Voce descobre o problema pelo cliente reclamando, nao pelo painel. ' +
    'Este guia mostra o minimo viavel de monitoramento e alertas para webhook, fila, ' +
    'worker e APIs externas, com foco em tempo de resposta. Nada de Datadog enterprise: ' +
    'o objetivo e enxergar o que importa e ser avisado antes do estrago.',
  sections: [
    {
      title: 'Por que o minimo importa mais que o completo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Painel cheio de grafico que ninguem olha nao reduz incidente. O que reduz e ' +
            'um conjunto pequeno de sinais que respondem rapido a pergunta certa: o sistema ' +
            'esta saudavel agora? Comece pelo essencial e cresca so quando houver dor real.',
        },
        {
          type: 'list',
          items: [
            'Prefira poucos sinais acionaveis a muitos graficos decorativos.',
            'Todo alerta precisa de um dono e de uma acao clara associada.',
            'Se um alerta nao muda nenhuma decisao, ele e ruido e deve ser removido.',
            'Meça primeiro o que afeta o cliente: tempo de resposta e taxa de erro.',
          ],
        },
      ],
    },
    {
      title: 'Os 4 sinais de ouro aplicados a integracoes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os Golden Signals do SRE (latencia, trafego, erros e saturacao) cabem bem em ' +
            'integracoes. Eles cobrem 80% dos incidentes com pouca instrumentacao.',
        },
        {
          type: 'list',
          items: [
            'Latencia: tempo de resposta do webhook e das chamadas a APIs externas, sempre em p95 e p99, nunca so a media.',
            'Trafego: volume de eventos recebidos por minuto e mensagens processadas pela fila.',
            'Erros: taxa de respostas 5xx, falhas de processamento no worker e timeouts de parceiros.',
            'Saturacao: profundidade da fila, uso de conexoes do banco e memoria ou CPU do worker.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regra pratica: latencia e erros avisam que algo ja esta ruim para o cliente; ' +
            'trafego e saturacao avisam que algo vai ficar ruim em breve.',
        },
      ],
    },
    {
      title: 'Metricas minimas por componente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada componente da cadeia tem um punhado de metricas que vale a pena coletar. ' +
            'Abaixo o conjunto enxuto que entrega visibilidade sem virar projeto.',
        },
        {
          type: 'table',
          columns: ['Componente', 'Metrica minima', 'Por que importa'],
          rows: [
            ['Webhook', 'p95 de latencia, taxa de 5xx, eventos/min', 'Detecta lentidao e rejeicao antes do parceiro reenviar'],
            ['Fila', 'Profundidade e idade da mensagem mais antiga', 'Mostra acumulo e atraso real de processamento'],
            ['Worker', 'Throughput, taxa de falha, tempo por job', 'Revela travamento, retry em loop e gargalo'],
            ['APIs externas', 'Latencia p95, taxa de erro, timeouts', 'Isola culpa do parceiro e protege seu SLA'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A idade da mensagem mais antiga na fila e a metrica mais subestimada. ' +
            'Profundidade alta pode ser pico saudavel; idade alta significa que alguem ja esta esperando demais.',
        },
      ],
    },
    {
      title: 'Os alertas que realmente importam',
      blocks: [
        {
          type: 'paragraph',
          value:
            'De todas as metricas, poucas merecem acordar alguem. Foque nos alertas que ' +
            'representam dor para o cliente ou risco iminente de fila travada.',
        },
        {
          type: 'list',
          items: [
            'Taxa de erro 5xx acima de um limite por janela curta, por exemplo 2% em 5 minutos.',
            'Fila acumulando: profundidade crescente sem cair ou idade da mensagem acima do SLA.',
            'p95 de latencia do webhook ou de API parceira acima do limite acordado.',
            'Falha de API parceira: sequencia de timeouts ou taxa de erro que indica parceiro fora do ar.',
          ],
        },
      ],
    },
    {
      title: 'Como evitar alert fatigue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Alerta demais e tao perigoso quanto alerta de menos. Quando tudo apita, ninguem ' +
            'reage. Tres alavancas mantem o ruido baixo: thresholds, janelas e severidade.',
        },
        {
          type: 'list',
          items: [
            'Thresholds calibrados: defina limites a partir do comportamento real, nao de chute, e revise apos cada incidente.',
            'Janelas e duracao: so dispare se a condicao persistir por X minutos, evitando ruido de picos instantaneos.',
            'Severidade clara: separe page (acorda alguem) de ticket (revisa no horario comercial) de info (so registra).',
            'Agrupamento e silenciamento: agrupe alertas correlatos e silencie durante deploys ou janelas de manutencao conhecidas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Meta saudavel: todo alerta de page deve ser acionavel e raro. Se ele dispara toda ' +
            'semana sem acao real, vire ticket ou ajuste o threshold.',
        },
      ],
    },
    {
      title: 'Health check e metricas na pratica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O minimo viavel cabe em duas rotas: um /health para liveness e readiness, e um ' +
            '/metrics no formato Prometheus. Em Node, prom-client resolve com pouca cola.',
        },
        {
          type: 'diagram',
          value:
            'Parceiro --> /webhook --> Fila --> Worker --> API externa\n' +
            '                 |          |        |\n' +
            '              metricas   metricas metricas\n' +
            '                 \\         |        /\n' +
            '                  ---> /metrics ---> Prometheus --> Alertas',
        },
        {
          type: 'code',
          value: `// metrics.js
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latencia das requisicoes HTTP',
  labelNames: ['route', 'status'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const webhookErrors = new client.Counter({
  name: 'webhook_errors_total',
  help: 'Total de erros no processamento do webhook',
  labelNames: ['reason'],
});

const queueDepth = new client.Gauge({
  name: 'queue_depth',
  help: 'Mensagens pendentes na fila',
});

const queueOldestAge = new client.Gauge({
  name: 'queue_oldest_message_age_seconds',
  help: 'Idade da mensagem mais antiga na fila',
});

register.registerMetric(httpDuration);
register.registerMetric(webhookErrors);
register.registerMetric(queueDepth);
register.registerMetric(queueOldestAge);

module.exports = { register, httpDuration, webhookErrors, queueDepth, queueOldestAge };`,
        },
        {
          type: 'code',
          value: `// server.js
const express = require('express');
const { register, httpDuration } = require('./metrics');
const app = express();

// /health: liveness + readiness em um lugar
app.get('/health', async (req, res) => {
  const checks = { fila: await pingQueue(), banco: await pingDb() };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});

// /metrics: exposicao no formato Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// middleware para medir latencia por rota e status
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ route: req.path });
  res.on('finish', () => end({ status: res.statusCode }));
  next();
});`,
        },
      ],
    },
    {
      title: 'Runbook curto por alerta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Alerta sem runbook gera panico. Cada disparo precisa de um roteiro de 3 a 5 passos ' +
            'que qualquer pessoa de plantao consiga seguir as 3 da manha.',
        },
        {
          type: 'paragraph',
          value: 'Runbook para taxa de 5xx alta no webhook:',
        },
        {
          type: 'ordered',
          items: [
            'Abra o painel e confirme se o pico e geral ou de uma rota especifica.',
            'Verifique logs recentes de erro e correlacione com o ultimo deploy.',
            'Cheque dependencias: banco, fila e APIs externas estao respondendo?',
            'Se foi deploy, faca rollback; se for dependencia externa, ative o fallback ou circuit breaker.',
            'Registre a causa e abra ticket de follow-up para acao definitiva.',
          ],
        },
        {
          type: 'paragraph',
          value: 'Runbook para fila acumulada ou idade da mensagem alta:',
        },
        {
          type: 'ordered',
          items: [
            'Confirme se o worker esta vivo e consumindo, olhando throughput recente.',
            'Verifique se ha mensagem em loop de retry travando o consumo.',
            'Avalie escalar workers temporariamente para drenar o acumulo.',
            'Se a causa for API externa lenta, considere pausar producao ate o parceiro normalizar.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de uma ferramenta paga como Datadog para comecar?',
      answer:
        'Nao. Para o minimo viavel, prom-client mais Prometheus e um Grafana ou Alertmanager ' +
        'cobrem health check, metricas e alertas sem custo de licenca. Ferramenta paga so se ' +
        'justifica quando o volume e a operacao crescem a ponto de o esforco de manter a stack ' +
        'aberta superar o preco da gerenciada.',
    },
    {
      question: 'Qual a diferenca entre /health de liveness e de readiness?',
      answer:
        'Liveness responde se o processo esta vivo e deve ser reiniciado caso trave. Readiness ' +
        'responde se ele esta pronto para receber trafego, checando dependencias como banco e ' +
        'fila. Voce pode separar em duas rotas ou retornar ambos os checks em um /health unico, ' +
        'usando 200 para saudavel e 503 para degradado.',
    },
    {
      question: 'Por que medir p95 e p99 em vez da media de latencia?',
      answer:
        'A media esconde a cauda. Um p95 ruim significa que 5% das requisicoes estao lentas, e ' +
        'sao justamente esses clientes que reclamam. Media baixa com p99 alto e um padrao classico ' +
        'de problema invisivel: tudo parece bem no agregado enquanto uma parcela sofre.',
    },
  ],
  conclusion: {
    title: 'Comece pequeno e durma melhor',
    description:
      'Monitoramento bom nao e o que tem mais grafico, e o que avisa cedo e diz o que fazer. ' +
      'Implemente os 4 sinais de ouro, as metricas minimas por componente, poucos alertas ' +
      'acionaveis e um runbook curto. Esse minimo viavel troca a rotina de apagar incendio por ' +
      'operacao previsivel. Posso ajudar a montar isso na sua integracao.',
    cta: 'Falar sobre observabilidade da minha integracao',
  },
  related: [
    { label: 'Webhook, idempotencia e filas no WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Fila para picos de campanha no WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Fale comigo', to: '/contato' },
  ],
};

const en = {
  intro:
    'An integration that is only watched after it goes down turns into constant firefighting. ' +
    'You find out about the problem from a customer complaint, not from the dashboard. ' +
    'This guide shows the minimum viable monitoring and alerting for webhook, queue, worker and ' +
    'external APIs, with a focus on response time. No enterprise Datadog: the goal is to see what ' +
    'matters and get warned before the damage is done.',
  sections: [
    {
      title: 'Why the minimum beats the complete',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A dashboard full of charts nobody looks at does not reduce incidents. What reduces ' +
            'them is a small set of signals that quickly answer the right question: is the system ' +
            'healthy right now? Start with the essentials and grow only when there is real pain.',
        },
        {
          type: 'list',
          items: [
            'Prefer a few actionable signals over many decorative charts.',
            'Every alert needs an owner and a clear action attached to it.',
            'If an alert changes no decision, it is noise and should be removed.',
            'Measure first what affects the customer: response time and error rate.',
          ],
        },
      ],
    },
    {
      title: 'The 4 golden signals applied to integrations',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The SRE golden signals (latency, traffic, errors and saturation) fit integrations ' +
            'well. They cover 80% of incidents with very little instrumentation.',
        },
        {
          type: 'list',
          items: [
            'Latency: response time of the webhook and of external API calls, always in p95 and p99, never just the average.',
            'Traffic: volume of events received per minute and messages processed by the queue.',
            'Errors: rate of 5xx responses, processing failures in the worker and partner timeouts.',
            'Saturation: queue depth, database connection usage and worker memory or CPU.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Rule of thumb: latency and errors tell you something is already bad for the customer; ' +
            'traffic and saturation tell you something will get bad soon.',
        },
      ],
    },
    {
      title: 'Minimum metrics per component',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Each component in the chain has a handful of metrics worth collecting. Below is the ' +
            'lean set that delivers visibility without turning into a project.',
        },
        {
          type: 'table',
          columns: ['Component', 'Minimum metric', 'Why it matters'],
          rows: [
            ['Webhook', 'p95 latency, 5xx rate, events/min', 'Detects slowness and rejection before the partner retries'],
            ['Queue', 'Depth and age of the oldest message', 'Shows backlog and real processing delay'],
            ['Worker', 'Throughput, failure rate, time per job', 'Reveals stalls, retry loops and bottlenecks'],
            ['External APIs', 'p95 latency, error rate, timeouts', 'Isolates partner blame and protects your SLA'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The age of the oldest message in the queue is the most underrated metric. High depth ' +
            'may be a healthy spike; high age means someone has already been waiting too long.',
        },
      ],
    },
    {
      title: 'The alerts that truly matter',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Of all the metrics, few deserve to wake someone up. Focus on alerts that represent ' +
            'customer pain or imminent risk of a stuck queue.',
        },
        {
          type: 'list',
          items: [
            '5xx error rate above a threshold over a short window, for example 2% in 5 minutes.',
            'Queue backing up: rising depth that does not drain or message age above the SLA.',
            'p95 latency of the webhook or partner API above the agreed threshold.',
            'Partner API failure: a run of timeouts or an error rate that signals the partner is down.',
          ],
        },
      ],
    },
    {
      title: 'How to avoid alert fatigue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Too many alerts is as dangerous as too few. When everything beeps, nobody reacts. ' +
            'Three levers keep the noise low: thresholds, windows and severity.',
        },
        {
          type: 'list',
          items: [
            'Calibrated thresholds: set limits from real behavior, not guesses, and revise after each incident.',
            'Windows and duration: only fire if the condition persists for X minutes, avoiding noise from instant spikes.',
            'Clear severity: separate page (wakes someone) from ticket (review in business hours) from info (just logs).',
            'Grouping and silencing: group correlated alerts and silence during deploys or known maintenance windows.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Healthy goal: every page alert should be actionable and rare. If it fires every week ' +
            'with no real action, turn it into a ticket or adjust the threshold.',
        },
      ],
    },
    {
      title: 'Health check and metrics in practice',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The minimum viable setup fits in two routes: a /health for liveness and readiness, and ' +
            'a /metrics in Prometheus format. In Node, prom-client handles it with little glue.',
        },
        {
          type: 'diagram',
          value:
            'Partner --> /webhook --> Queue --> Worker --> External API\n' +
            '                |          |        |\n' +
            '             metrics    metrics  metrics\n' +
            '                \\         |        /\n' +
            '                 ---> /metrics ---> Prometheus --> Alerts',
        },
        {
          type: 'code',
          value: `// metrics.js
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['route', 'status'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const webhookErrors = new client.Counter({
  name: 'webhook_errors_total',
  help: 'Total errors while processing the webhook',
  labelNames: ['reason'],
});

const queueDepth = new client.Gauge({
  name: 'queue_depth',
  help: 'Pending messages in the queue',
});

const queueOldestAge = new client.Gauge({
  name: 'queue_oldest_message_age_seconds',
  help: 'Age of the oldest message in the queue',
});

register.registerMetric(httpDuration);
register.registerMetric(webhookErrors);
register.registerMetric(queueDepth);
register.registerMetric(queueOldestAge);

module.exports = { register, httpDuration, webhookErrors, queueDepth, queueOldestAge };`,
        },
        {
          type: 'code',
          value: `// server.js
const express = require('express');
const { register, httpDuration } = require('./metrics');
const app = express();

// /health: liveness + readiness in one place
app.get('/health', async (req, res) => {
  const checks = { queue: await pingQueue(), db: await pingDb() };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});

// /metrics: exposition in Prometheus format
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// middleware to measure latency by route and status
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ route: req.path });
  res.on('finish', () => end({ status: res.statusCode }));
  next();
});`,
        },
      ],
    },
    {
      title: 'A short runbook per alert',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An alert with no runbook breeds panic. Every firing needs a 3 to 5 step script that ' +
            'anyone on call can follow at 3 in the morning.',
        },
        {
          type: 'paragraph',
          value: 'Runbook for high 5xx rate on the webhook:',
        },
        {
          type: 'ordered',
          items: [
            'Open the dashboard and confirm whether the spike is global or on a specific route.',
            'Check recent error logs and correlate with the last deploy.',
            'Check dependencies: are the database, queue and external APIs responding?',
            'If it was a deploy, roll back; if it is an external dependency, enable the fallback or circuit breaker.',
            'Record the cause and open a follow-up ticket for the definitive fix.',
          ],
        },
        {
          type: 'paragraph',
          value: 'Runbook for a backed-up queue or high message age:',
        },
        {
          type: 'ordered',
          items: [
            'Confirm the worker is alive and consuming, by looking at recent throughput.',
            'Check whether a message stuck in a retry loop is blocking consumption.',
            'Consider temporarily scaling workers to drain the backlog.',
            'If the cause is a slow external API, consider pausing production until the partner recovers.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need a paid tool like Datadog to start?',
      answer:
        'No. For the minimum viable setup, prom-client plus Prometheus and a Grafana or ' +
        'Alertmanager cover health check, metrics and alerts with no license cost. A paid tool ' +
        'only makes sense when volume and operations grow to the point where maintaining the ' +
        'open stack costs more effort than the managed price.',
    },
    {
      question: 'What is the difference between liveness and readiness in /health?',
      answer:
        'Liveness reports whether the process is alive and should be restarted if it hangs. ' +
        'Readiness reports whether it is ready to receive traffic, checking dependencies like ' +
        'database and queue. You can split into two routes or return both checks in a single ' +
        '/health, using 200 for healthy and 503 for degraded.',
    },
    {
      question: 'Why measure p95 and p99 instead of the average latency?',
      answer:
        'The average hides the tail. A bad p95 means 5% of requests are slow, and those are ' +
        'exactly the customers who complain. A low average with a high p99 is a classic invisible ' +
        'problem: everything looks fine in the aggregate while a slice suffers.',
    },
  ],
  conclusion: {
    title: 'Start small and sleep better',
    description:
      'Good monitoring is not the one with the most charts, it is the one that warns early and ' +
      'tells you what to do. Implement the 4 golden signals, the minimum metrics per component, ' +
      'a few actionable alerts and a short runbook. This minimum viable setup trades the ' +
      'firefighting routine for predictable operations. I can help you build this into your ' +
      'integration.',
    cta: 'Talk about observability for my integration',
  },
  related: [
    { label: 'Webhook, idempotency and queues on WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Queue for campaign spikes on WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Get in touch', to: '/contato' },
  ],
};

const es = {
  intro:
    'Una integracion que solo se observa cuando ya se cayo se vuelve una rutina de apagar ' +
    'incendios. Te enteras del problema porque el cliente se queja, no por el panel. ' +
    'Esta guia muestra el minimo viable de monitoreo y alertas para webhook, cola, worker y ' +
    'APIs externas, con foco en el tiempo de respuesta. Nada de Datadog enterprise: el objetivo ' +
    'es ver lo que importa y recibir aviso antes del dano.',
  sections: [
    {
      title: 'Por que el minimo importa mas que lo completo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un panel lleno de graficos que nadie mira no reduce incidentes. Lo que los reduce es ' +
            'un conjunto pequeno de senales que responden rapido a la pregunta correcta: el sistema ' +
            'esta sano ahora? Empieza por lo esencial y crece solo cuando haya dolor real.',
        },
        {
          type: 'list',
          items: [
            'Prefiere pocas senales accionables a muchos graficos decorativos.',
            'Toda alerta necesita un dueno y una accion clara asociada.',
            'Si una alerta no cambia ninguna decision, es ruido y debe eliminarse.',
            'Mide primero lo que afecta al cliente: tiempo de respuesta y tasa de error.',
          ],
        },
      ],
    },
    {
      title: 'Las 4 senales de oro aplicadas a integraciones',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las senales de oro del SRE (latencia, trafico, errores y saturacion) encajan bien en ' +
            'integraciones. Cubren el 80% de los incidentes con muy poca instrumentacion.',
        },
        {
          type: 'list',
          items: [
            'Latencia: tiempo de respuesta del webhook y de las llamadas a APIs externas, siempre en p95 y p99, nunca solo el promedio.',
            'Trafico: volumen de eventos recibidos por minuto y mensajes procesados por la cola.',
            'Errores: tasa de respuestas 5xx, fallos de procesamiento en el worker y timeouts de socios.',
            'Saturacion: profundidad de la cola, uso de conexiones de la base y memoria o CPU del worker.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regla practica: latencia y errores avisan que algo ya esta mal para el cliente; ' +
            'trafico y saturacion avisan que algo se pondra mal pronto.',
        },
      ],
    },
    {
      title: 'Metricas minimas por componente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada componente de la cadena tiene un punado de metricas que vale la pena recolectar. ' +
            'Abajo el conjunto reducido que entrega visibilidad sin convertirse en un proyecto.',
        },
        {
          type: 'table',
          columns: ['Componente', 'Metrica minima', 'Por que importa'],
          rows: [
            ['Webhook', 'p95 de latencia, tasa de 5xx, eventos/min', 'Detecta lentitud y rechazo antes de que el socio reintente'],
            ['Cola', 'Profundidad y edad del mensaje mas antiguo', 'Muestra acumulacion y retraso real de procesamiento'],
            ['Worker', 'Throughput, tasa de fallo, tiempo por job', 'Revela bloqueos, bucles de reintento y cuellos de botella'],
            ['APIs externas', 'p95 de latencia, tasa de error, timeouts', 'Aisla la culpa del socio y protege tu SLA'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La edad del mensaje mas antiguo en la cola es la metrica mas subestimada. Una ' +
            'profundidad alta puede ser un pico sano; una edad alta significa que alguien ya espera demasiado.',
        },
      ],
    },
    {
      title: 'Las alertas que de verdad importan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'De todas las metricas, pocas merecen despertar a alguien. Enfocate en las alertas que ' +
            'representan dolor para el cliente o riesgo inminente de cola bloqueada.',
        },
        {
          type: 'list',
          items: [
            'Tasa de error 5xx por encima de un limite en una ventana corta, por ejemplo 2% en 5 minutos.',
            'Cola acumulando: profundidad creciente que no baja o edad del mensaje por encima del SLA.',
            'p95 de latencia del webhook o de la API socia por encima del limite acordado.',
            'Fallo de API socia: una serie de timeouts o una tasa de error que indica que el socio esta caido.',
          ],
        },
      ],
    },
    {
      title: 'Como evitar la fatiga de alertas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Demasiadas alertas es tan peligroso como muy pocas. Cuando todo pita, nadie reacciona. ' +
            'Tres palancas mantienen el ruido bajo: thresholds, ventanas y severidad.',
        },
        {
          type: 'list',
          items: [
            'Thresholds calibrados: define limites a partir del comportamiento real, no de suposiciones, y revisalos tras cada incidente.',
            'Ventanas y duracion: dispara solo si la condicion persiste por X minutos, evitando ruido de picos instantaneos.',
            'Severidad clara: separa page (despierta a alguien) de ticket (se revisa en horario laboral) de info (solo registra).',
            'Agrupacion y silenciamiento: agrupa alertas correlacionadas y silencia durante deploys o ventanas de mantenimiento conocidas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Meta sana: toda alerta de page debe ser accionable y rara. Si dispara cada semana sin ' +
            'accion real, conviertela en ticket o ajusta el threshold.',
        },
      ],
    },
    {
      title: 'Health check y metricas en la practica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El minimo viable cabe en dos rutas: un /health para liveness y readiness, y un ' +
            '/metrics en formato Prometheus. En Node, prom-client lo resuelve con poco pegamento.',
        },
        {
          type: 'diagram',
          value:
            'Socio --> /webhook --> Cola --> Worker --> API externa\n' +
            '              |         |        |\n' +
            '           metricas  metricas metricas\n' +
            '              \\        |        /\n' +
            '               ---> /metrics ---> Prometheus --> Alertas',
        },
        {
          type: 'code',
          value: `// metrics.js
const client = require('prom-client');
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Latencia de las peticiones HTTP',
  labelNames: ['route', 'status'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

const webhookErrors = new client.Counter({
  name: 'webhook_errors_total',
  help: 'Total de errores al procesar el webhook',
  labelNames: ['reason'],
});

const queueDepth = new client.Gauge({
  name: 'queue_depth',
  help: 'Mensajes pendientes en la cola',
});

const queueOldestAge = new client.Gauge({
  name: 'queue_oldest_message_age_seconds',
  help: 'Edad del mensaje mas antiguo en la cola',
});

register.registerMetric(httpDuration);
register.registerMetric(webhookErrors);
register.registerMetric(queueDepth);
register.registerMetric(queueOldestAge);

module.exports = { register, httpDuration, webhookErrors, queueDepth, queueOldestAge };`,
        },
        {
          type: 'code',
          value: `// server.js
const express = require('express');
const { register, httpDuration } = require('./metrics');
const app = express();

// /health: liveness + readiness en un solo lugar
app.get('/health', async (req, res) => {
  const checks = { cola: await pingQueue(), base: await pingDb() };
  const healthy = Object.values(checks).every(Boolean);
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks });
});

// /metrics: exposicion en formato Prometheus
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// middleware para medir latencia por ruta y status
app.use((req, res, next) => {
  const end = httpDuration.startTimer({ route: req.path });
  res.on('finish', () => end({ status: res.statusCode }));
  next();
});`,
        },
      ],
    },
    {
      title: 'Runbook corto por alerta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una alerta sin runbook genera panico. Cada disparo necesita un guion de 3 a 5 pasos ' +
            'que cualquier persona de guardia pueda seguir a las 3 de la manana.',
        },
        {
          type: 'paragraph',
          value: 'Runbook para tasa de 5xx alta en el webhook:',
        },
        {
          type: 'ordered',
          items: [
            'Abre el panel y confirma si el pico es general o de una ruta especifica.',
            'Revisa los logs recientes de error y correlaciona con el ultimo deploy.',
            'Verifica las dependencias: la base, la cola y las APIs externas responden?',
            'Si fue un deploy, haz rollback; si es una dependencia externa, activa el fallback o circuit breaker.',
            'Registra la causa y abre un ticket de seguimiento para la solucion definitiva.',
          ],
        },
        {
          type: 'paragraph',
          value: 'Runbook para cola acumulada o edad de mensaje alta:',
        },
        {
          type: 'ordered',
          items: [
            'Confirma que el worker esta vivo y consumiendo, mirando el throughput reciente.',
            'Verifica si hay un mensaje en bucle de reintento bloqueando el consumo.',
            'Evalua escalar workers temporalmente para drenar la acumulacion.',
            'Si la causa es una API externa lenta, considera pausar la produccion hasta que el socio se normalice.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Necesito una herramienta de pago como Datadog para empezar?',
      answer:
        'No. Para el minimo viable, prom-client mas Prometheus y un Grafana o Alertmanager cubren ' +
        'health check, metricas y alertas sin costo de licencia. Una herramienta de pago solo se ' +
        'justifica cuando el volumen y la operacion crecen al punto de que mantener la stack ' +
        'abierta cuesta mas esfuerzo que el precio de la gestionada.',
    },
    {
      question: 'Cual es la diferencia entre liveness y readiness en /health?',
      answer:
        'Liveness reporta si el proceso esta vivo y debe reiniciarse si se cuelga. Readiness ' +
        'reporta si esta listo para recibir trafico, revisando dependencias como la base y la ' +
        'cola. Puedes separarlo en dos rutas o devolver ambos checks en un /health unico, usando ' +
        '200 para sano y 503 para degradado.',
    },
    {
      question: 'Por que medir p95 y p99 en lugar del promedio de latencia?',
      answer:
        'El promedio esconde la cola. Un p95 malo significa que el 5% de las peticiones estan ' +
        'lentas, y son justamente esos clientes los que se quejan. Un promedio bajo con un p99 ' +
        'alto es un patron clasico de problema invisible: todo parece bien en el agregado mientras ' +
        'una parte sufre.',
    },
  ],
  conclusion: {
    title: 'Empieza pequeno y duerme mejor',
    description:
      'Un buen monitoreo no es el que tiene mas graficos, es el que avisa temprano y dice que ' +
      'hacer. Implementa las 4 senales de oro, las metricas minimas por componente, pocas alertas ' +
      'accionables y un runbook corto. Este minimo viable cambia la rutina de apagar incendios por ' +
      'una operacion previsible. Puedo ayudarte a montar esto en tu integracion.',
    cta: 'Hablar sobre observabilidad de mi integracion',
  },
  related: [
    { label: 'Webhook, idempotencia y colas en WhatsApp', to: '/blog/webhook-whatsapp-idempotencia-filas' },
    { label: 'Cola para picos de campana en WhatsApp', to: '/blog/fila-picos-campanha-whatsapp' },
    { label: 'Hablemos', to: '/contato' },
  ],
};

export default { pt, en, es };
