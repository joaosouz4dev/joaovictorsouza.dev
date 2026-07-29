// Conteudo do artigo: detectar deriva de qualidade em bot de atendimento antes do cliente reclamar.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O bot não cai. Ele continua respondendo, o tempo de resposta segue normal, o painel está todo verde, e a taxa de erro é zero. Só que a resposta que ele dá hoje é pior do que a que dava há três semanas, e ninguém percebeu porque nada quebrou. Deriva de qualidade é o modo de falha mais caro de um sistema de atendimento com IA justamente porque é silencioso: quando o sinal finalmente chega, ele chega pela reclamação do cliente, pelo aumento de escalonamento humano ou pela queda de conversão, três indicadores que só se movem depois que o estrago já foi feito e que nunca apontam a causa. Este artigo trata de como detectar essa degradação antes disso: quais sinais se movem cedo, como construir um conjunto de referência que não envelhece junto com o problema, como separar deriva real de flutuação normal sem disparar alarme toda semana, e como transformar o alerta em diagnóstico que diz o que mudou em vez de apenas que algo mudou.',
  sections: [
    {
      title: 'Deriva não é queda: por que o painel verde engana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A observabilidade tradicional foi construída para detectar indisponibilidade e erro, e faz isso bem. Latência, taxa de erro HTTP, throughput e saturação capturam qualquer coisa que quebre de forma binária. O problema é que qualidade de resposta não é binária e não gera exceção. Um bot que passou a responder de forma vaga, que parou de citar a fonte, que ficou mais propenso a inventar um prazo de entrega ou que começou a escalar para humano casos que resolvia sozinho não produz um único erro. Ele produz respostas duzentas, bem formadas, dentro do tempo, e piores. Nenhum dos quatro sinais clássicos se move, e é por isso que a operação inteira pode degradar por semanas com o painel intacto.',
        },
        {
          type: 'paragraph',
          value:
            'Vale separar três causas que produzem o mesmo sintoma, porque a resposta a cada uma é diferente. A primeira é deriva do modelo: o provedor atualizou o ponto de acesso, ou você trocou de versão, e o comportamento mudou nas bordas que o seu prompt nunca especificou. A segunda é deriva do conhecimento: a base de RAG envelheceu, a política mudou e o documento não, e o bot passou a responder com confiança algo que deixou de ser verdade. A terceira é deriva de entrada: o perfil das perguntas mudou porque entrou uma campanha nova, um canal novo ou uma safra de clientes com outro vocabulário, e o sistema continua igual enquanto o mundo ao redor mudou. Confundir as três leva a ajustar o prompt quando o problema estava na base, que é o retrabalho mais comum nesse tipo de investigação.',
        },
        {
          type: 'table',
          columns: ['Causa da deriva', 'Sinal que se move primeiro', 'O que corrige'],
          rows: [
            [
              'Modelo mudou de versão ou comportamento',
              'Distribuição de formato e tamanho da resposta',
              'Gate de paridade e ajuste cirúrgico do prompt',
            ],
            [
              'Base de conhecimento envelheceu',
              'Queda na taxa de resposta com citação válida',
              'Reindexação e curadoria do corpus, não o prompt',
            ],
            [
              'Perfil das perguntas mudou',
              'Aumento de intenções fora do catálogo conhecido',
              'Ampliar cobertura, criar intenção nova ou rota de escalonamento',
            ],
            [
              'Prompt alterado sem avaliação',
              'Ruptura brusca no dia exato da alteração',
              'Rollback da versão e gate de eval antes do rollout',
            ],
            [
              'Contexto recuperado piorou',
              'Queda de relevância no top-k antes da queda de resposta',
              'Ajuste de retrieval e reranking, sem tocar no modelo',
            ],
          ],
        },
      ],
    },
    {
      title: 'Os sinais que se movem antes do cliente reclamar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existem dois tipos de sinal e eles se complementam. O sinal direto mede a qualidade da resposta e exige um julgamento, humano ou automatizado, sendo mais fiel e mais caro. O sinal indireto mede propriedades observáveis da resposta e do comportamento do usuário sem julgar conteúdo, sendo mais barato, contínuo e disponível para cem por cento do tráfego. A estratégia que funciona é usar o indireto como sentinela de alta cobertura e o direto como confirmação sob demanda: o indireto grita, o direto explica. Quem monta só o direto acaba avaliando uma amostra pequena demais para detectar deriva cedo; quem monta só o indireto detecta a mudança mas nunca sabe se ela foi para melhor ou pior.',
        },
        {
          type: 'paragraph',
          value:
            'Entre os sinais indiretos, os mais informativos costumam ser os comportamentais, porque carregam julgamento implícito do usuário sem custar nada para coletar. A taxa de reformulação, que mede quantas vezes o cliente reescreve a mesma pergunta, sobe assim que a resposta deixa de resolver. A taxa de escalonamento por intenção separa o caso complexo, que sempre escalou, da regressão nova. O número de turnos até a resolução é sensível e cedo. E vale registrar a taxa de abandono no meio da conversa, que é o cliente desistindo em silêncio, o único grupo que nunca vai reclamar e por isso nunca aparece no canal de suporte.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'Tipo', 'O que denuncia'],
          rows: [
            [
              'Taxa de reformulação da mesma pergunta',
              'Indireto, comportamental',
              'Resposta deixou de resolver, ainda que continue bem formada',
            ],
            [
              'Turnos até resolução',
              'Indireto, comportamental',
              'Perda de eficiência antes de qualquer queda visível de qualidade',
            ],
            [
              'Escalonamento por intenção',
              'Indireto, operacional',
              'Regressão localizada em um tipo de caso, não no bot inteiro',
            ],
            [
              'Distribuição do tamanho da resposta',
              'Indireto, estrutural',
              'Mudança de comportamento do modelo, tipicamente por troca de versão',
            ],
            [
              'Taxa de resposta com citação válida',
              'Indireto, estrutural',
              'Retrieval degradado ou base envelhecida',
            ],
            [
              'Nota de juiz automático no conjunto fixo',
              'Direto, avaliado',
              'Queda real de qualidade, com o caso concreto que regrediu',
            ],
          ],
        },
        {
          type: 'code',
          value: `// drift-signals.js
// Sinais indiretos calculados sobre 100% do trafego, sem julgar conteudo.
// Baratos o suficiente para rodar sempre, sensiveis o suficiente para
// se mover antes de a reclamacao chegar ao suporte.

export function conversationSignals(turns) {
  const userTurns = turns.filter((t) => t.role === 'user');
  const botTurns = turns.filter((t) => t.role === 'assistant');

  return {
    // Reformulacao: pergunta muito parecida com a anterior do MESMO usuario.
    // Sinal mais forte de "a resposta nao resolveu" que existe de graca.
    reformulations: userTurns.reduce((count, turn, i) => {
      if (i === 0) return count;
      return count + (similarity(turn.text, userTurns[i - 1].text) > 0.8 ? 1 : 0);
    }, 0),

    turnsToResolve: turns.length,
    escalated: turns.some((t) => t.event === 'handoff'),

    // Abandono: usuario parou de responder apos o bot. O cliente que
    // desiste em silencio nunca abre chamado e por isso some das metricas.
    abandoned: turns.at(-1)?.role === 'assistant' && !turns.some((t) => t.event === 'resolved'),

    avgAnswerLength: botTurns.reduce((s, t) => s + t.text.length, 0) / (botTurns.length || 1),
    citedRate: botTurns.filter((t) => t.citations?.length > 0).length / (botTurns.length || 1),
  };
}

// Jaccard sobre bigramas de caractere: barato, sem dependencia externa
// e suficiente para "e a mesma pergunta escrita de outro jeito".
function similarity(a, b) {
  const grams = (s) => {
    const norm = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    return new Set(Array.from({ length: Math.max(norm.length - 1, 0) }, (_, i) => norm.slice(i, i + 2)));
  };
  const [ga, gb] = [grams(a), grams(b)];
  if (!ga.size || !gb.size) return 0;
  const inter = [...ga].filter((g) => gb.has(g)).length;
  return inter / (ga.size + gb.size - inter);
}`,
        },
      ],
    },
    {
      title: 'O conjunto de referência que não envelhece junto com o problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detectar deriva exige um ponto fixo de comparação, e é aí que a maioria das implementações se sabota. O erro é usar a média móvel do próprio tráfego recente como referência: se a qualidade cai dois por cento por semana, a média móvel cai junto, o desvio nunca aparece e depois de seis meses o sistema degradou trinta por cento sem disparar um único alerta. A referência precisa ser um conjunto congelado de casos com resposta esperada revisada por gente, executado contra a versão atual em cadência fixa. Ele não é o tráfego, ele é a régua, e uma régua que se ajusta ao que mede não mede nada.',
        },
        {
          type: 'paragraph',
          value:
            'Um bom conjunto de referência tem três camadas. A primeira é o núcleo estável: os casos mais frequentes, que representam o volume e cuja regressão é inaceitável. A segunda é a borda conhecida: os casos que já quebraram no passado, cada incidente virando um item permanente, o que impede a mesma regressão de voltar duas vezes. A terceira é a amostra rotativa: casos reais recentes, revisados e adicionados periodicamente, que impedem o conjunto de virar um museu descolado do que os clientes perguntam hoje. As duas primeiras camadas são congeladas e só crescem; a terceira gira, mas a rotação precisa ser deliberada e registrada, nunca automática, senão a régua volta a derreter.',
        },
        {
          type: 'diagram',
          value: `  CONJUNTO DE REFERENCIA (a regua, nao o trafego)
  +----------------------------------------------+
  | nucleo estavel   ~60%  congelado, so cresce  |
  | borda conhecida  ~30%  1 item por incidente  |
  | amostra rotativa ~10%  revisada e datada     |
  +----------------------------------------------+
                    |
                    v  execucao em cadencia fixa
        +-------------------------+
        | versao atual em producao|
        +-------------------------+
                    |
                    v
        nota por caso + agregada por intencao
                    |
        +-----------+-----------+
        |                       |
        v                       v
  compara com LINHA BASE   compara com JANELA ANTERIOR
  (congelada na v1)        (detecta queda gradual)
        |                       |
        +-----------+-----------+
                    v
        alerta com o CASO que regrediu
        (nao apenas "a nota caiu")`,
        },
        {
          type: 'paragraph',
          value:
            'Um cuidado que separa um conjunto útil de um enganoso: a resposta esperada não deve ser uma string exata na maioria dos casos, porque comparação literal transforma qualquer variação de redação em falso alarme e o time desliga o alerta em duas semanas. O que se compara é a propriedade que importa em cada caso: o fato correto aparece, o valor numérico bate, a recusa acontece quando deve, a citação aponta para o documento certo, o formato de saída é válido. Escrever a expectativa como uma asserção verificável em vez de um texto ideal é o que torna o conjunto sustentável ao longo de meses.',
        },
      ],
    },
    {
      title: 'Separar deriva real de flutuação normal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sinal de qualidade oscila, e um detector ingênuo que alerta a cada queda vira ruído que ninguém lê. Três disciplinas resolvem isso. A primeira é o tamanho de amostra: uma queda de cinco pontos sobre trinta conversas não é sinal nenhum, e o alerta precisa exigir volume mínimo por segmento antes de considerar qualquer desvio. A segunda é a comparação dupla: contra a linha de base congelada, que captura degradação acumulada, e contra a janela imediatamente anterior, que captura ruptura brusca. Cada uma pega um tipo de deriva que a outra deixa passar, e alertar apenas em uma delas garante um ponto cego permanente.',
        },
        {
          type: 'paragraph',
          value:
            'A terceira disciplina é segmentar antes de agregar, e é a que mais evita o falso negativo. Uma regressão que atinge apenas uma intenção específica, um único idioma ou um canal desaparece na média global: o número agregado se move um ponto e ninguém liga, enquanto aquele segmento caiu quinze. Como segmentar multiplica o número de comparações e portanto a chance de falso positivo por acaso, o par correto é sempre segmentação com correção para múltiplas comparações e volume mínimo por célula. Alertar por segmento sem esses dois freios produz alarme diário e treina o time a ignorar o canal, que é o pior resultado possível.',
        },
        {
          type: 'code',
          value: `// drift-detector.js
// Alerta so quando ha VOLUME suficiente e o desvio persiste.
// Comparacao dupla: linha de base congelada (deriva lenta)
// e janela anterior (ruptura brusca). Uma pega o que a outra perde.

const MIN_SAMPLE = 50;        // abaixo disso, qualquer desvio e ruido
const SLOW_DRIFT_PP = 5;      // pontos percentuais contra a linha de base
const SUDDEN_DROP_PP = 8;     // ruptura contra a janela anterior
const PERSIST_WINDOWS = 2;    // precisa se manter para virar alerta

export function detectDrift({ segment, current, previous, baseline, history }) {
  if (current.n < MIN_SAMPLE) {
    return { status: 'insufficient_sample', segment, n: current.n };
  }

  const vsBaseline = (baseline.score - current.score) * 100;
  const vsPrevious = (previous.score - current.score) * 100;

  // Bonferroni simples: segmentar multiplica as comparacoes, entao o
  // limiar sobe com o numero de segmentos para nao gerar alarme diario.
  const adjust = Math.log2(Math.max(history.segmentCount, 2));
  const slowLimit = SLOW_DRIFT_PP * adjust;
  const suddenLimit = SUDDEN_DROP_PP * adjust;

  const slow = vsBaseline > slowLimit;
  const sudden = vsPrevious > suddenLimit;
  if (!slow && !sudden) return { status: 'stable', segment };

  // Persistencia: uma janela ruim e variacao, duas seguidas e deriva.
  const persisted = history.recent
    .slice(-PERSIST_WINDOWS)
    .every((w) => (baseline.score - w.score) * 100 > slowLimit / 2);

  if (sudden) {
    return { status: 'alert', kind: 'sudden', segment, deltaPp: vsPrevious };
  }
  return persisted
    ? { status: 'alert', kind: 'gradual', segment, deltaPp: vsBaseline }
    : { status: 'watching', segment, deltaPp: vsBaseline };
}`,
        },
      ],
    },
    {
      title: 'Do alerta ao diagnóstico: o que mudou, não só que mudou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um alerta que diz "a nota caiu seis pontos" gera uma investigação do zero e costuma consumir um dia de trabalho. O alerta útil chega com o recorte já feito, e isso exige gravar contexto suficiente no momento da execução, não depois. Três coisas precisam vir junto: os casos concretos que regrediram, com a resposta anterior e a atual lado a lado, porque ler duas respostas resolve metade das investigações em cinco minutos; a lista de mudanças que entraram na janela, incluindo versão de prompt, versão de modelo, reindexação de base e alteração de configuração de retrieval; e a distribuição do desvio pelos segmentos, que diz se a regressão é geral ou localizada.',
        },
        {
          type: 'paragraph',
          value:
            'Essa correlação com mudanças é o que transforma detecção em causa raiz, e ela depende de uma prática simples que quase ninguém tem: registrar toda alteração relevante num mesmo fluxo de eventos, com data e identificador de versão, incluindo as que não são deploy de código. Reindexar a base, editar um documento do corpus, mudar o parâmetro de temperatura ou o top-k do retrieval são alterações invisíveis para o histórico do repositório e capazes de mover a qualidade tanto quanto um deploy. Sem esse registro, a investigação vira arqueologia. Com ele, o alerta já chega dizendo que a queda começou na mesma hora em que a base foi reindexada.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar volume e persistência antes de mobilizar gente, porque uma janela ruim isolada quase sempre é variação.',
            'Verificar se a queda é geral ou concentrada em um segmento, o que já elimina metade das hipóteses.',
            'Ler lado a lado três casos que regrediram, comparando a resposta anterior com a atual antes de qualquer teoria.',
            'Cruzar o início da queda com o fluxo de mudanças, incluindo reindexação e ajuste de parâmetro, não apenas deploy.',
            'Isolar a camada reexecutando os mesmos casos com o retrieval anterior, o que separa deriva de contexto de deriva de modelo.',
            'Corrigir, adicionar o caso que regrediu à borda conhecida do conjunto de referência e só então encerrar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último passo é o que mais se pula e o que mais rende com o tempo. Todo incidente de deriva que não vira caso permanente no conjunto de referência é um incidente que pode acontecer de novo, e sistemas de IA regridem em direções repetidas com frequência incômoda. Transformar cada investigação num item congelado da régua faz o custo da próxima ocorrência cair para zero, porque a regressão passa a ser pega no gate antes de chegar à produção, em vez de ser redescoberta pelo mesmo caminho caro.',
        },
      ],
    },
    {
      title: 'Colocar em pé sem virar projeto de seis meses',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A tentação é começar pelo juiz automático e por um conjunto grande de referência, e isso costuma atrasar o primeiro sinal em semanas. A ordem que entrega valor cedo começa pelos sinais indiretos, porque eles não exigem julgamento, rodam sobre todo o tráfego e já capturam a maior parte das derivas visíveis. Taxa de reformulação, turnos até resolução e escalonamento por intenção podem estar registrados em poucos dias e já dizem quando algo mudou, mesmo sem dizer o quê. O conjunto de referência entra logo depois e começa pequeno: trinta casos bem escolhidos por intenção principal detectam mais regressão do que trezentos casos genéricos.',
        },
        {
          type: 'ordered',
          items: [
            'Registrar os sinais indiretos por conversa e por intenção, começando por reformulação, turnos até resolução e escalonamento.',
            'Congelar uma linha de base do comportamento atual antes de qualquer mudança, porque sem ela não existe comparação possível.',
            'Montar um conjunto de referência pequeno, com o núcleo estável das intenções de maior volume e expectativa escrita como asserção verificável.',
            'Rodar o conjunto em cadência fixa e a cada rollout de prompt ou troca de modelo, guardando a resposta completa e não só a nota.',
            'Ligar o detector com volume mínimo, comparação dupla e correção para múltiplas comparações, começando com limiar conservador.',
            'Registrar todas as mudanças relevantes num fluxo único de eventos, incluindo reindexação e ajuste de parâmetro de retrieval.',
            'Fechar o ciclo transformando cada incidente investigado em caso permanente da borda conhecida.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Uma calibração final que evita frustração: no primeiro mês o detector vai gerar mais alarme do que deveria, e a reação correta não é desligá-lo, é ajustar limiar e volume mínimo com os dados reais que ele produziu. Anotar cada disparo como verdadeiro ou falso positivo durante quatro semanas dá exatamente a informação necessária para calibrar, e converte o detector de uma suposição sobre o sistema numa ferramenta que o time confia. Sem essa fase, o resultado previsível é o canal de alerta silenciado, e um detector silenciado é indistinguível de não ter detector nenhum.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não usar a média do tráfego recente como referência de qualidade?',
      answer:
        'Porque a média móvel do próprio tráfego envelhece junto com o problema e por isso não detecta exatamente o caso mais perigoso. Se a qualidade cai dois por cento por semana, a referência cai na mesma velocidade, o desvio relativo permanece próximo de zero e o alerta nunca dispara, mesmo depois de seis meses e trinta por cento de degradação acumulada. Uma régua que se ajusta ao que mede não mede nada. A referência precisa ser um conjunto congelado de casos com expectativa revisada por gente, executado contra a versão atual em cadência fixa, e a comparação precisa ser dupla: contra essa linha de base, que captura a deriva lenta, e contra a janela imediatamente anterior, que captura a ruptura brusca de um deploy ou troca de modelo. Cada comparação pega um tipo de deriva que a outra deixa passar.',
    },
    {
      question: 'Quais sinais detectam deriva sem precisar avaliar o conteúdo da resposta?',
      answer:
        'Os comportamentais são os mais informativos porque carregam julgamento implícito do usuário e não custam nada para coletar sobre cem por cento do tráfego. A taxa de reformulação, medindo quantas vezes o cliente reescreve a mesma pergunta, sobe assim que a resposta deixa de resolver, mesmo que continue bem escrita. O número de turnos até a resolução é sensível e se move cedo. A taxa de escalonamento segmentada por intenção separa o caso complexo que sempre escalou da regressão nova. A taxa de abandono no meio da conversa captura o cliente que desiste em silêncio, o grupo que nunca reclama e por isso nunca aparece no suporte. Aos comportamentais somam-se dois estruturais úteis: a distribuição do tamanho da resposta, que denuncia troca de versão do modelo, e a taxa de resposta com citação válida, que denuncia retrieval degradado antes de a qualidade cair.',
    },
    {
      question: 'Como evitar que o detector de deriva vire ruído que o time ignora?',
      answer:
        'Com três freios aplicados juntos e uma fase de calibração. O primeiro freio é volume mínimo por segmento, porque uma queda de cinco pontos sobre trinta conversas não é sinal e alertar sobre isso treina o time a desconfiar do canal. O segundo é persistência: uma janela ruim é variação, duas janelas seguidas na mesma direção são deriva, e exigir persistência elimina a maior parte dos falsos positivos sem atrasar a detecção de forma relevante. O terceiro é correção para múltiplas comparações, obrigatória porque segmentar por intenção, canal e idioma multiplica o número de testes e portanto a chance de um desvio por acaso. Além disso, no primeiro mês o correto não é desligar o alerta ruidoso, é anotar cada disparo como verdadeiro ou falso positivo e usar esses dados para ajustar limiar e volume mínimo, porque um detector silenciado é indistinguível de não ter detector.',
    },
  ],
  conclusion: {
    title: 'A pior falha é a que não gera erro',
    description:
      'Um bot que degrada não cai, não estoura latência e não aparece em nenhum painel clássico: ele continua respondendo, cada vez pior, até que o sinal chegue pela reclamação do cliente, quando o estrago já está feito e a causa já se perdeu. Sinais indiretos sobre todo o tráfego para detectar cedo, um conjunto de referência congelado que serve de régua em vez de média móvel que derrete, comparação dupla com volume mínimo e correção para múltiplas comparações, e alerta que já chega com o caso concreto e as mudanças da janela transformam deriva de surpresa em evento gerenciado. Posso montar essa detecção no seu bot de atendimento, dos sinais comportamentais ao gate de eval no rollout, para que a regressão apareça no seu canal antes de aparecer no do cliente.',
    cta: 'Falar sobre detecção de deriva no meu bot de atendimento',
  },
  related: [
    { label: 'Avaliação contínua de bots com eval automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidade em LLM: tracing, custo e qualidade', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'SLAs de atendimento entre bot e humano', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

const en = {
  intro:
    'The bot does not go down. It keeps answering, response time stays normal, the dashboard is all green, and the error rate is zero. Except the answer it gives today is worse than the one it gave three weeks ago, and nobody noticed because nothing broke. Quality drift is the most expensive failure mode of an AI support system precisely because it is silent: when the signal finally arrives, it arrives as a customer complaint, a rise in human escalation or a drop in conversion, three indicators that only move after the damage is done and that never point at the cause. This article is about detecting that degradation before then: which signals move early, how to build a reference set that does not age along with the problem, how to separate real drift from normal fluctuation without firing an alarm every week, and how to turn the alert into a diagnosis that says what changed instead of merely that something changed.',
  sections: [
    {
      title: 'Drift is not an outage: why the green dashboard misleads',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Traditional observability was built to detect unavailability and errors, and it does that well. Latency, HTTP error rate, throughput and saturation capture anything that breaks in a binary way. The problem is that answer quality is not binary and does not raise exceptions. A bot that started answering vaguely, that stopped citing its source, that became more prone to inventing a delivery date or that began escalating cases it used to resolve on its own produces not a single error. It produces well formed responses, within the time budget, and worse. None of the four classic signals moves, and that is why an entire operation can degrade for weeks with the dashboard intact.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth separating three causes that produce the same symptom, because the response to each is different. The first is model drift: the provider updated the endpoint, or you switched versions, and behavior changed at the edges your prompt never specified. The second is knowledge drift: the RAG corpus aged, the policy changed and the document did not, and the bot began confidently stating something that stopped being true. The third is input drift: the profile of questions changed because a new campaign, a new channel or a cohort of customers with different vocabulary arrived, and the system stayed the same while the world around it moved. Confusing the three leads to tuning the prompt when the problem was in the corpus, which is the most common rework in this kind of investigation.',
        },
        {
          type: 'table',
          columns: ['Drift cause', 'Signal that moves first', 'What actually fixes it'],
          rows: [
            [
              'Model changed version or behavior',
              'Distribution of answer format and length',
              'Parity gate and surgical prompt adjustment',
            ],
            [
              'Knowledge base aged',
              'Drop in the rate of answers with a valid citation',
              'Reindexing and corpus curation, not the prompt',
            ],
            [
              'Question profile changed',
              'Rise in intents outside the known catalog',
              'Widening coverage, adding an intent or an escalation route',
            ],
            [
              'Prompt changed without evaluation',
              'Sharp break on the exact day of the change',
              'Rolling back the version and adding an eval gate before rollout',
            ],
            [
              'Retrieved context got worse',
              'Top-k relevance drops before answer quality does',
              'Retrieval and reranking adjustment, without touching the model',
            ],
          ],
        },
      ],
    },
    {
      title: 'The signals that move before the customer complains',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There are two kinds of signal and they complement each other. The direct signal measures answer quality and requires a judgment, human or automated, being more faithful and more expensive. The indirect signal measures observable properties of the answer and of user behavior without judging content, being cheaper, continuous and available across one hundred percent of traffic. The strategy that works is to use the indirect one as a high coverage sentinel and the direct one as on demand confirmation: the indirect shouts, the direct explains. Teams that build only the direct one end up evaluating a sample too small to detect drift early; teams that build only the indirect one detect the change but never know whether it was for better or worse.',
        },
        {
          type: 'paragraph',
          value:
            'Among indirect signals, the behavioral ones are usually the most informative, because they carry the user implicit judgment and cost nothing to collect. The reformulation rate, measuring how often the customer rewrites the same question, rises as soon as the answer stops resolving. The escalation rate per intent separates the complex case that always escalated from the new regression. The number of turns to resolution is sensitive and early. And it is worth recording the mid conversation abandonment rate, which is the customer giving up in silence, the only group that will never complain and therefore never shows up in the support channel.',
        },
        {
          type: 'table',
          columns: ['Signal', 'Type', 'What it reveals'],
          rows: [
            [
              'Reformulation rate of the same question',
              'Indirect, behavioral',
              'The answer stopped resolving, even while staying well formed',
            ],
            [
              'Turns to resolution',
              'Indirect, behavioral',
              'Efficiency loss before any visible quality drop',
            ],
            [
              'Escalation per intent',
              'Indirect, operational',
              'Regression localized in one case type, not in the whole bot',
            ],
            [
              'Answer length distribution',
              'Indirect, structural',
              'Model behavior change, typically from a version swap',
            ],
            [
              'Rate of answers with a valid citation',
              'Indirect, structural',
              'Degraded retrieval or an aged corpus',
            ],
            [
              'Automated judge score on the fixed set',
              'Direct, evaluated',
              'Real quality drop, with the concrete case that regressed',
            ],
          ],
        },
        {
          type: 'code',
          value: `// drift-signals.js
// Indirect signals computed over 100% of traffic, without judging content.
// Cheap enough to run always, sensitive enough to move before the
// complaint reaches support.

export function conversationSignals(turns) {
  const userTurns = turns.filter((t) => t.role === 'user');
  const botTurns = turns.filter((t) => t.role === 'assistant');

  return {
    // Reformulation: a question very similar to the SAME user previous one.
    // The strongest free signal that "the answer did not resolve".
    reformulations: userTurns.reduce((count, turn, i) => {
      if (i === 0) return count;
      return count + (similarity(turn.text, userTurns[i - 1].text) > 0.8 ? 1 : 0);
    }, 0),

    turnsToResolve: turns.length,
    escalated: turns.some((t) => t.event === 'handoff'),

    // Abandonment: user stopped replying after the bot. The customer who
    // gives up in silence never opens a ticket and vanishes from metrics.
    abandoned: turns.at(-1)?.role === 'assistant' && !turns.some((t) => t.event === 'resolved'),

    avgAnswerLength: botTurns.reduce((s, t) => s + t.text.length, 0) / (botTurns.length || 1),
    citedRate: botTurns.filter((t) => t.citations?.length > 0).length / (botTurns.length || 1),
  };
}

// Jaccard over character bigrams: cheap, no external dependency and
// enough for "this is the same question written another way".
function similarity(a, b) {
  const grams = (s) => {
    const norm = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    return new Set(Array.from({ length: Math.max(norm.length - 1, 0) }, (_, i) => norm.slice(i, i + 2)));
  };
  const [ga, gb] = [grams(a), grams(b)];
  if (!ga.size || !gb.size) return 0;
  const inter = [...ga].filter((g) => gb.has(g)).length;
  return inter / (ga.size + gb.size - inter);
}`,
        },
      ],
    },
    {
      title: 'The reference set that does not age along with the problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detecting drift requires a fixed comparison point, and that is where most implementations sabotage themselves. The mistake is using the moving average of recent traffic as the reference: if quality falls two percent per week, the moving average falls with it, the deviation never appears and after six months the system has degraded thirty percent without firing a single alert. The reference must be a frozen set of cases with human reviewed expectations, executed against the current version on a fixed cadence. It is not the traffic, it is the ruler, and a ruler that adjusts to what it measures measures nothing.',
        },
        {
          type: 'paragraph',
          value:
            'A good reference set has three layers. The first is the stable core: the most frequent cases, representing the volume, whose regression is unacceptable. The second is the known edge: cases that broke in the past, each incident becoming a permanent item, which prevents the same regression from returning twice. The third is the rotating sample: recent real cases, reviewed and added periodically, which keep the set from becoming a museum detached from what customers ask today. The first two layers are frozen and only grow; the third rotates, but the rotation must be deliberate and recorded, never automatic, otherwise the ruler starts melting again.',
        },
        {
          type: 'diagram',
          value: `  REFERENCE SET (the ruler, not the traffic)
  +----------------------------------------------+
  | stable core     ~60%  frozen, only grows     |
  | known edge      ~30%  1 item per incident    |
  | rotating sample ~10%  reviewed and dated     |
  +----------------------------------------------+
                    |
                    v  run on a fixed cadence
        +-------------------------+
        | current production build|
        +-------------------------+
                    |
                    v
        score per case + aggregated per intent
                    |
        +-----------+-----------+
        |                       |
        v                       v
  compare to BASELINE      compare to PREVIOUS WINDOW
  (frozen at v1)           (catches gradual decline)
        |                       |
        +-----------+-----------+
                    v
        alert carrying the CASE that regressed
        (not merely "the score dropped")`,
        },
        {
          type: 'paragraph',
          value:
            'One precaution separates a useful set from a misleading one: the expected answer should not be an exact string in most cases, because literal comparison turns any wording variation into a false alarm and the team switches the alert off within two weeks. What you compare is the property that matters in each case: the correct fact appears, the numeric value matches, the refusal happens when it should, the citation points at the right document, the output format is valid. Writing the expectation as a verifiable assertion instead of an ideal text is what makes the set sustainable across months.',
        },
      ],
    },
    {
      title: 'Separating real drift from normal fluctuation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every quality signal oscillates, and a naive detector that alerts on every dip becomes noise nobody reads. Three disciplines solve it. The first is sample size: a five point drop over thirty conversations is no signal at all, and the alert must require a minimum volume per segment before considering any deviation. The second is dual comparison: against the frozen baseline, which captures accumulated degradation, and against the immediately previous window, which captures a sharp break. Each catches a kind of drift the other lets through, and alerting on only one of them guarantees a permanent blind spot.',
        },
        {
          type: 'paragraph',
          value:
            'The third discipline is segmenting before aggregating, and it is the one that most prevents false negatives. A regression hitting only one specific intent, a single language or one channel disappears into the global average: the aggregate number moves one point and nobody cares, while that segment fell fifteen. Since segmenting multiplies the number of comparisons and therefore the chance of a false positive by luck, the correct pairing is always segmentation with multiple comparison correction and a minimum volume per cell. Alerting per segment without those two brakes produces daily alarms and trains the team to ignore the channel, which is the worst possible outcome.',
        },
        {
          type: 'code',
          value: `// drift-detector.js
// Alerts only when there is enough VOLUME and the deviation persists.
// Dual comparison: frozen baseline (slow drift) and previous window
// (sharp break). One catches what the other misses.

const MIN_SAMPLE = 50;        // below this, any deviation is noise
const SLOW_DRIFT_PP = 5;      // percentage points against the baseline
const SUDDEN_DROP_PP = 8;     // break against the previous window
const PERSIST_WINDOWS = 2;    // must hold before becoming an alert

export function detectDrift({ segment, current, previous, baseline, history }) {
  if (current.n < MIN_SAMPLE) {
    return { status: 'insufficient_sample', segment, n: current.n };
  }

  const vsBaseline = (baseline.score - current.score) * 100;
  const vsPrevious = (previous.score - current.score) * 100;

  // Simple Bonferroni: segmenting multiplies comparisons, so the
  // threshold rises with segment count to avoid a daily alarm.
  const adjust = Math.log2(Math.max(history.segmentCount, 2));
  const slowLimit = SLOW_DRIFT_PP * adjust;
  const suddenLimit = SUDDEN_DROP_PP * adjust;

  const slow = vsBaseline > slowLimit;
  const sudden = vsPrevious > suddenLimit;
  if (!slow && !sudden) return { status: 'stable', segment };

  // Persistence: one bad window is variation, two in a row is drift.
  const persisted = history.recent
    .slice(-PERSIST_WINDOWS)
    .every((w) => (baseline.score - w.score) * 100 > slowLimit / 2);

  if (sudden) {
    return { status: 'alert', kind: 'sudden', segment, deltaPp: vsPrevious };
  }
  return persisted
    ? { status: 'alert', kind: 'gradual', segment, deltaPp: vsBaseline }
    : { status: 'watching', segment, deltaPp: vsBaseline };
}`,
        },
      ],
    },
    {
      title: 'From alert to diagnosis: what changed, not only that it changed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An alert saying "the score dropped six points" starts an investigation from scratch and usually burns a day of work. The useful alert arrives with the slicing already done, and that requires recording enough context at execution time, not afterwards. Three things must come along: the concrete cases that regressed, with the previous and current answers side by side, because reading two answers resolves half the investigations in five minutes; the list of changes that landed in the window, including prompt version, model version, corpus reindexing and retrieval configuration changes; and the distribution of the deviation across segments, which tells whether the regression is general or localized.',
        },
        {
          type: 'paragraph',
          value:
            'That correlation with changes is what turns detection into root cause, and it depends on a simple practice almost nobody has: recording every relevant change in a single event stream, with a date and a version identifier, including the ones that are not code deploys. Reindexing the corpus, editing a document, changing the temperature parameter or the retrieval top-k are changes invisible to the repository history and capable of moving quality as much as a deploy. Without that record, the investigation becomes archaeology. With it, the alert already arrives saying the drop started at the same hour the corpus was reindexed.',
        },
        {
          type: 'ordered',
          items: [
            'Confirm volume and persistence before mobilizing people, because an isolated bad window is almost always variation.',
            'Check whether the drop is general or concentrated in one segment, which already eliminates half the hypotheses.',
            'Read three regressed cases side by side, comparing the previous answer with the current one before forming any theory.',
            'Cross the start of the drop with the change stream, including reindexing and parameter tuning, not just deploys.',
            'Isolate the layer by rerunning the same cases with the previous retrieval, which separates context drift from model drift.',
            'Fix it, add the regressed case to the known edge of the reference set, and only then close the incident.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last step is the one most often skipped and the one that pays off most over time. Every drift incident that does not become a permanent case in the reference set is an incident that can happen again, and AI systems regress in repeated directions with uncomfortable frequency. Turning each investigation into a frozen item on the ruler drives the cost of the next occurrence to zero, because the regression gets caught at the gate before reaching production instead of being rediscovered along the same expensive path.',
        },
      ],
    },
    {
      title: 'Standing it up without a six month project',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The temptation is to start with the automated judge and a large reference set, and that usually delays the first signal by weeks. The order that delivers value early starts with indirect signals, because they require no judgment, run over all traffic and already capture most visible drift. Reformulation rate, turns to resolution and escalation per intent can be instrumented within days and already tell you when something changed, even without telling what. The reference set comes right after and starts small: thirty well chosen cases per main intent detect more regression than three hundred generic ones.',
        },
        {
          type: 'ordered',
          items: [
            'Record indirect signals per conversation and per intent, starting with reformulation, turns to resolution and escalation.',
            'Freeze a baseline of current behavior before any change, because without it no comparison is possible.',
            'Build a small reference set, with the stable core of the highest volume intents and expectations written as verifiable assertions.',
            'Run the set on a fixed cadence and on every prompt rollout or model swap, storing the full answer and not just the score.',
            'Turn on the detector with minimum volume, dual comparison and multiple comparison correction, starting with a conservative threshold.',
            'Record every relevant change in a single event stream, including reindexing and retrieval parameter tuning.',
            'Close the loop by turning every investigated incident into a permanent known edge case.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A final calibration that avoids frustration: in the first month the detector will fire more than it should, and the correct reaction is not to switch it off but to tune the threshold and minimum volume with the real data it produced. Labeling each firing as a true or false positive for four weeks gives exactly the information needed to calibrate, and converts the detector from an assumption about the system into a tool the team trusts. Without that phase, the predictable outcome is a muted alert channel, and a muted detector is indistinguishable from having no detector at all.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not use the recent traffic average as the quality reference?',
      answer:
        'Because the moving average of your own traffic ages along with the problem and therefore fails to detect exactly the most dangerous case. If quality falls two percent per week, the reference falls at the same rate, the relative deviation stays near zero and the alert never fires, even after six months and thirty percent of accumulated degradation. A ruler that adjusts to what it measures measures nothing. The reference must be a frozen set of cases with human reviewed expectations, run against the current version on a fixed cadence, and the comparison must be dual: against that baseline, which captures slow drift, and against the immediately previous window, which captures the sharp break of a deploy or model swap. Each comparison catches a kind of drift the other lets through.',
    },
    {
      question: 'Which signals detect drift without evaluating the answer content?',
      answer:
        'The behavioral ones are the most informative because they carry the user implicit judgment and cost nothing to collect across one hundred percent of traffic. The reformulation rate, measuring how often the customer rewrites the same question, rises as soon as the answer stops resolving, even if it stays well written. The number of turns to resolution is sensitive and moves early. The escalation rate segmented by intent separates the complex case that always escalated from the new regression. The mid conversation abandonment rate captures the customer who gives up in silence, the group that never complains and therefore never shows up in support. To the behavioral ones add two useful structural signals: the answer length distribution, which reveals a model version swap, and the rate of answers with a valid citation, which reveals degraded retrieval before quality itself drops.',
    },
    {
      question: 'How do you keep the drift detector from becoming noise the team ignores?',
      answer:
        'With three brakes applied together and a calibration phase. The first brake is a minimum volume per segment, because a five point drop over thirty conversations is not a signal and alerting on it trains the team to distrust the channel. The second is persistence: one bad window is variation, two consecutive windows in the same direction are drift, and requiring persistence removes most false positives without meaningfully delaying detection. The third is multiple comparison correction, mandatory because segmenting by intent, channel and language multiplies the number of tests and therefore the chance of a deviation by luck. Beyond that, in the first month the right move is not to switch off a noisy alert but to label every firing as a true or false positive and use that data to tune threshold and minimum volume, because a muted detector is indistinguishable from having none.',
    },
  ],
  conclusion: {
    title: 'The worst failure is the one that raises no error',
    description:
      'A degrading bot does not go down, does not blow up latency and does not appear on any classic dashboard: it keeps answering, worse and worse, until the signal arrives as a customer complaint, when the damage is done and the cause is already lost. Indirect signals across all traffic to detect early, a frozen reference set that serves as a ruler instead of a moving average that melts, dual comparison with minimum volume and multiple comparison correction, and an alert that already carries the concrete case and the changes in the window turn drift from a surprise into a managed event. I can build that detection into your support bot, from behavioral signals to the eval gate on rollout, so the regression shows up in your channel before it shows up in the customer one.',
    cta: 'Talk about drift detection in my support bot',
  },
  related: [
    { label: 'Continuous bot evaluation with automated evals', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'LLM observability: tracing, cost and quality', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'Support SLAs between bot and human', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

const es = {
  intro:
    'El bot no se cae. Sigue respondiendo, el tiempo de respuesta sigue normal, el panel está todo en verde y la tasa de error es cero. Solo que la respuesta que da hoy es peor que la que daba hace tres semanas, y nadie lo notó porque nada se rompió. La deriva de calidad es el modo de falla más caro de un sistema de atención con IA justamente porque es silencioso: cuando la señal finalmente llega, llega por el reclamo del cliente, por el aumento de escalamiento humano o por la caída de conversión, tres indicadores que solo se mueven después de que el daño ya está hecho y que nunca señalan la causa. Este artículo trata de cómo detectar esa degradación antes: qué señales se mueven temprano, cómo construir un conjunto de referencia que no envejezca junto con el problema, cómo separar deriva real de fluctuación normal sin disparar una alarma cada semana, y cómo convertir la alerta en un diagnóstico que diga qué cambió en vez de solo que algo cambió.',
  sections: [
    {
      title: 'La deriva no es una caída: por qué el panel en verde engaña',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La observabilidad tradicional fue construida para detectar indisponibilidad y error, y lo hace bien. Latencia, tasa de error HTTP, throughput y saturación capturan cualquier cosa que se rompa de forma binaria. El problema es que la calidad de la respuesta no es binaria y no genera excepción. Un bot que pasó a responder de forma vaga, que dejó de citar la fuente, que se volvió más propenso a inventar un plazo de entrega o que empezó a escalar a un humano casos que resolvía solo no produce ni un error. Produce respuestas bien formadas, dentro del tiempo, y peores. Ninguna de las cuatro señales clásicas se mueve, y por eso una operación entera puede degradarse durante semanas con el panel intacto.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene separar tres causas que producen el mismo síntoma, porque la respuesta a cada una es distinta. La primera es deriva del modelo: el proveedor actualizó el punto de acceso, o cambiaste de versión, y el comportamiento cambió en los bordes que tu prompt nunca especificó. La segunda es deriva del conocimiento: la base de RAG envejeció, la política cambió y el documento no, y el bot pasó a responder con confianza algo que dejó de ser verdad. La tercera es deriva de entrada: el perfil de las preguntas cambió porque entró una campaña nueva, un canal nuevo o una camada de clientes con otro vocabulario, y el sistema siguió igual mientras el mundo alrededor cambió. Confundir las tres lleva a ajustar el prompt cuando el problema estaba en la base, que es el retrabajo más común en este tipo de investigación.',
        },
        {
          type: 'table',
          columns: ['Causa de la deriva', 'Señal que se mueve primero', 'Qué lo corrige de verdad'],
          rows: [
            [
              'El modelo cambió de versión o comportamiento',
              'Distribución del formato y del largo de la respuesta',
              'Gate de paridad y ajuste quirúrgico del prompt',
            ],
            [
              'La base de conocimiento envejeció',
              'Caída en la tasa de respuestas con cita válida',
              'Reindexación y curaduría del corpus, no el prompt',
            ],
            [
              'El perfil de las preguntas cambió',
              'Aumento de intenciones fuera del catálogo conocido',
              'Ampliar cobertura, crear una intención nueva o una ruta de escalamiento',
            ],
            [
              'Prompt alterado sin evaluación',
              'Ruptura brusca el día exacto del cambio',
              'Rollback de la versión y gate de eval antes del rollout',
            ],
            [
              'El contexto recuperado empeoró',
              'Cae la relevancia del top-k antes que la calidad de la respuesta',
              'Ajuste de retrieval y reranking, sin tocar el modelo',
            ],
          ],
        },
      ],
    },
    {
      title: 'Las señales que se mueven antes de que el cliente reclame',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existen dos tipos de señal y se complementan. La señal directa mide la calidad de la respuesta y exige un juicio, humano o automatizado, siendo más fiel y más cara. La señal indirecta mide propiedades observables de la respuesta y del comportamiento del usuario sin juzgar contenido, siendo más barata, continua y disponible sobre el cien por ciento del tráfico. La estrategia que funciona es usar la indirecta como centinela de alta cobertura y la directa como confirmación a demanda: la indirecta grita, la directa explica. Quien monta solo la directa termina evaluando una muestra demasiado pequeña para detectar deriva temprano; quien monta solo la indirecta detecta el cambio pero nunca sabe si fue para mejor o para peor.',
        },
        {
          type: 'paragraph',
          value:
            'Entre las señales indirectas, las más informativas suelen ser las conductuales, porque cargan el juicio implícito del usuario y no cuestan nada de recolectar. La tasa de reformulación, que mide cuántas veces el cliente reescribe la misma pregunta, sube apenas la respuesta deja de resolver. La tasa de escalamiento por intención separa el caso complejo, que siempre escaló, de la regresión nueva. La cantidad de turnos hasta la resolución es sensible y temprana. Y vale registrar la tasa de abandono en medio de la conversación, que es el cliente desistiendo en silencio, el único grupo que nunca va a reclamar y por eso nunca aparece en el canal de soporte.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Tipo', 'Qué delata'],
          rows: [
            [
              'Tasa de reformulación de la misma pregunta',
              'Indirecta, conductual',
              'La respuesta dejó de resolver, aunque siga bien formada',
            ],
            [
              'Turnos hasta la resolución',
              'Indirecta, conductual',
              'Pérdida de eficiencia antes de cualquier caída visible de calidad',
            ],
            [
              'Escalamiento por intención',
              'Indirecta, operativa',
              'Regresión localizada en un tipo de caso, no en todo el bot',
            ],
            [
              'Distribución del largo de la respuesta',
              'Indirecta, estructural',
              'Cambio de comportamiento del modelo, típicamente por cambio de versión',
            ],
            [
              'Tasa de respuestas con cita válida',
              'Indirecta, estructural',
              'Retrieval degradado o base envejecida',
            ],
            [
              'Nota del juez automático sobre el conjunto fijo',
              'Directa, evaluada',
              'Caída real de calidad, con el caso concreto que regresó',
            ],
          ],
        },
        {
          type: 'code',
          value: `// drift-signals.js
// Senales indirectas calculadas sobre el 100% del trafico, sin juzgar
// contenido. Baratas para correr siempre, sensibles para moverse antes
// de que el reclamo llegue a soporte.

export function conversationSignals(turns) {
  const userTurns = turns.filter((t) => t.role === 'user');
  const botTurns = turns.filter((t) => t.role === 'assistant');

  return {
    // Reformulacion: pregunta muy parecida a la anterior del MISMO usuario.
    // La senal gratuita mas fuerte de "la respuesta no resolvio".
    reformulations: userTurns.reduce((count, turn, i) => {
      if (i === 0) return count;
      return count + (similarity(turn.text, userTurns[i - 1].text) > 0.8 ? 1 : 0);
    }, 0),

    turnsToResolve: turns.length,
    escalated: turns.some((t) => t.event === 'handoff'),

    // Abandono: el usuario dejo de responder tras el bot. El cliente que
    // desiste en silencio nunca abre ticket y desaparece de las metricas.
    abandoned: turns.at(-1)?.role === 'assistant' && !turns.some((t) => t.event === 'resolved'),

    avgAnswerLength: botTurns.reduce((s, t) => s + t.text.length, 0) / (botTurns.length || 1),
    citedRate: botTurns.filter((t) => t.citations?.length > 0).length / (botTurns.length || 1),
  };
}

// Jaccard sobre bigramas de caracter: barato, sin dependencia externa
// y suficiente para "es la misma pregunta escrita de otra forma".
function similarity(a, b) {
  const grams = (s) => {
    const norm = s.toLowerCase().replace(/\\s+/g, ' ').trim();
    return new Set(Array.from({ length: Math.max(norm.length - 1, 0) }, (_, i) => norm.slice(i, i + 2)));
  };
  const [ga, gb] = [grams(a), grams(b)];
  if (!ga.size || !gb.size) return 0;
  const inter = [...ga].filter((g) => gb.has(g)).length;
  return inter / (ga.size + gb.size - inter);
}`,
        },
      ],
    },
    {
      title: 'El conjunto de referencia que no envejece junto con el problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Detectar deriva exige un punto fijo de comparación, y ahí es donde la mayoría de las implementaciones se sabotea. El error es usar el promedio móvil del propio tráfico reciente como referencia: si la calidad cae dos por ciento por semana, el promedio móvil cae junto, la desviación nunca aparece y después de seis meses el sistema se degradó treinta por ciento sin disparar una sola alerta. La referencia debe ser un conjunto congelado de casos con expectativa revisada por gente, ejecutado contra la versión actual en cadencia fija. No es el tráfico, es la regla, y una regla que se ajusta a lo que mide no mide nada.',
        },
        {
          type: 'paragraph',
          value:
            'Un buen conjunto de referencia tiene tres capas. La primera es el núcleo estable: los casos más frecuentes, que representan el volumen y cuya regresión es inaceptable. La segunda es el borde conocido: los casos que ya se rompieron en el pasado, con cada incidente volviéndose un ítem permanente, lo que impide que la misma regresión vuelva dos veces. La tercera es la muestra rotativa: casos reales recientes, revisados y agregados periódicamente, que impiden que el conjunto se vuelva un museo desconectado de lo que los clientes preguntan hoy. Las dos primeras capas están congeladas y solo crecen; la tercera rota, pero la rotación debe ser deliberada y registrada, nunca automática, si no la regla vuelve a derretirse.',
        },
        {
          type: 'diagram',
          value: `  CONJUNTO DE REFERENCIA (la regla, no el trafico)
  +----------------------------------------------+
  | nucleo estable   ~60%  congelado, solo crece |
  | borde conocido   ~30%  1 item por incidente  |
  | muestra rotativa ~10%  revisada y fechada    |
  +----------------------------------------------+
                    |
                    v  ejecucion en cadencia fija
        +-------------------------+
        | version actual en prod  |
        +-------------------------+
                    |
                    v
        nota por caso + agregada por intencion
                    |
        +-----------+-----------+
        |                       |
        v                       v
  compara con LINEA BASE   compara con VENTANA ANTERIOR
  (congelada en la v1)     (detecta caida gradual)
        |                       |
        +-----------+-----------+
                    v
        alerta con el CASO que regreso
        (no solo "la nota cayo")`,
        },
        {
          type: 'paragraph',
          value:
            'Un cuidado que separa un conjunto útil de uno engañoso: la respuesta esperada no debe ser una cadena exacta en la mayoría de los casos, porque la comparación literal convierte cualquier variación de redacción en falsa alarma y el equipo apaga la alerta en dos semanas. Lo que se compara es la propiedad que importa en cada caso: el hecho correcto aparece, el valor numérico coincide, el rechazo ocurre cuando debe, la cita apunta al documento correcto, el formato de salida es válido. Escribir la expectativa como una aserción verificable en lugar de un texto ideal es lo que vuelve sostenible el conjunto a lo largo de meses.',
        },
      ],
    },
    {
      title: 'Separar deriva real de fluctuación normal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda señal de calidad oscila, y un detector ingenuo que alerta ante cada caída se vuelve ruido que nadie lee. Tres disciplinas lo resuelven. La primera es el tamaño de muestra: una caída de cinco puntos sobre treinta conversaciones no es señal alguna, y la alerta debe exigir volumen mínimo por segmento antes de considerar cualquier desviación. La segunda es la comparación doble: contra la línea base congelada, que captura degradación acumulada, y contra la ventana inmediatamente anterior, que captura ruptura brusca. Cada una atrapa un tipo de deriva que la otra deja pasar, y alertar solo con una de ellas garantiza un punto ciego permanente.',
        },
        {
          type: 'paragraph',
          value:
            'La tercera disciplina es segmentar antes de agregar, y es la que más evita el falso negativo. Una regresión que golpea solo una intención específica, un único idioma o un canal desaparece en el promedio global: el número agregado se mueve un punto y a nadie le importa, mientras ese segmento cayó quince. Como segmentar multiplica la cantidad de comparaciones y por lo tanto la probabilidad de un falso positivo por azar, el par correcto es siempre segmentación con corrección para comparaciones múltiples y volumen mínimo por celda. Alertar por segmento sin esos dos frenos produce alarma diaria y entrena al equipo a ignorar el canal, que es el peor resultado posible.',
        },
        {
          type: 'code',
          value: `// drift-detector.js
// Alerta solo cuando hay VOLUMEN suficiente y la desviacion persiste.
// Comparacion doble: linea base congelada (deriva lenta) y ventana
// anterior (ruptura brusca). Una atrapa lo que la otra pierde.

const MIN_SAMPLE = 50;        // por debajo, cualquier desviacion es ruido
const SLOW_DRIFT_PP = 5;      // puntos porcentuales contra la linea base
const SUDDEN_DROP_PP = 8;     // ruptura contra la ventana anterior
const PERSIST_WINDOWS = 2;    // debe sostenerse para volverse alerta

export function detectDrift({ segment, current, previous, baseline, history }) {
  if (current.n < MIN_SAMPLE) {
    return { status: 'insufficient_sample', segment, n: current.n };
  }

  const vsBaseline = (baseline.score - current.score) * 100;
  const vsPrevious = (previous.score - current.score) * 100;

  // Bonferroni simple: segmentar multiplica las comparaciones, asi que
  // el umbral sube con la cantidad de segmentos y evita alarma diaria.
  const adjust = Math.log2(Math.max(history.segmentCount, 2));
  const slowLimit = SLOW_DRIFT_PP * adjust;
  const suddenLimit = SUDDEN_DROP_PP * adjust;

  const slow = vsBaseline > slowLimit;
  const sudden = vsPrevious > suddenLimit;
  if (!slow && !sudden) return { status: 'stable', segment };

  // Persistencia: una ventana mala es variacion, dos seguidas son deriva.
  const persisted = history.recent
    .slice(-PERSIST_WINDOWS)
    .every((w) => (baseline.score - w.score) * 100 > slowLimit / 2);

  if (sudden) {
    return { status: 'alert', kind: 'sudden', segment, deltaPp: vsPrevious };
  }
  return persisted
    ? { status: 'alert', kind: 'gradual', segment, deltaPp: vsBaseline }
    : { status: 'watching', segment, deltaPp: vsBaseline };
}`,
        },
      ],
    },
    {
      title: 'De la alerta al diagnóstico: qué cambió, no solo que cambió',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una alerta que dice "la nota cayó seis puntos" genera una investigación desde cero y suele consumir un día de trabajo. La alerta útil llega con el recorte ya hecho, y eso exige guardar contexto suficiente en el momento de la ejecución, no después. Tres cosas deben venir junto: los casos concretos que regresaron, con la respuesta anterior y la actual lado a lado, porque leer dos respuestas resuelve la mitad de las investigaciones en cinco minutos; la lista de cambios que entraron en la ventana, incluyendo versión de prompt, versión de modelo, reindexación de base y alteración de configuración de retrieval; y la distribución de la desviación por los segmentos, que dice si la regresión es general o localizada.',
        },
        {
          type: 'paragraph',
          value:
            'Esa correlación con los cambios es lo que convierte la detección en causa raíz, y depende de una práctica simple que casi nadie tiene: registrar toda alteración relevante en un mismo flujo de eventos, con fecha e identificador de versión, incluyendo las que no son despliegue de código. Reindexar la base, editar un documento del corpus, cambiar el parámetro de temperatura o el top-k del retrieval son cambios invisibles para el historial del repositorio y capaces de mover la calidad tanto como un despliegue. Sin ese registro, la investigación se vuelve arqueología. Con él, la alerta ya llega diciendo que la caída empezó a la misma hora en que se reindexó la base.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar volumen y persistencia antes de movilizar gente, porque una ventana mala aislada casi siempre es variación.',
            'Verificar si la caída es general o está concentrada en un segmento, lo que ya elimina la mitad de las hipótesis.',
            'Leer lado a lado tres casos que regresaron, comparando la respuesta anterior con la actual antes de cualquier teoría.',
            'Cruzar el inicio de la caída con el flujo de cambios, incluyendo reindexación y ajuste de parámetros, no solo despliegues.',
            'Aislar la capa reejecutando los mismos casos con el retrieval anterior, lo que separa deriva de contexto de deriva de modelo.',
            'Corregir, agregar el caso que regresó al borde conocido del conjunto de referencia y recién entonces cerrar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último paso es el que más se saltea y el que más rinde con el tiempo. Todo incidente de deriva que no se convierte en caso permanente del conjunto de referencia es un incidente que puede volver a ocurrir, y los sistemas de IA regresan en direcciones repetidas con una frecuencia incómoda. Convertir cada investigación en un ítem congelado de la regla hace que el costo de la próxima ocurrencia caiga a cero, porque la regresión pasa a ser atrapada en el gate antes de llegar a producción, en vez de ser redescubierta por el mismo camino caro.',
        },
      ],
    },
    {
      title: 'Ponerlo de pie sin volverlo un proyecto de seis meses',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tentación es empezar por el juez automático y por un conjunto grande de referencia, y eso suele atrasar la primera señal en semanas. El orden que entrega valor temprano empieza por las señales indirectas, porque no exigen juicio, corren sobre todo el tráfico y ya capturan la mayor parte de las derivas visibles. Tasa de reformulación, turnos hasta la resolución y escalamiento por intención pueden estar registrados en pocos días y ya dicen cuándo algo cambió, aunque no digan qué. El conjunto de referencia entra enseguida y empieza pequeño: treinta casos bien elegidos por intención principal detectan más regresión que trescientos casos genéricos.',
        },
        {
          type: 'ordered',
          items: [
            'Registrar las señales indirectas por conversación y por intención, empezando por reformulación, turnos hasta la resolución y escalamiento.',
            'Congelar una línea base del comportamiento actual antes de cualquier cambio, porque sin ella no existe comparación posible.',
            'Armar un conjunto de referencia pequeño, con el núcleo estable de las intenciones de mayor volumen y expectativa escrita como aserción verificable.',
            'Correr el conjunto en cadencia fija y en cada rollout de prompt o cambio de modelo, guardando la respuesta completa y no solo la nota.',
            'Encender el detector con volumen mínimo, comparación doble y corrección para comparaciones múltiples, empezando con umbral conservador.',
            'Registrar todos los cambios relevantes en un flujo único de eventos, incluyendo reindexación y ajuste de parámetros de retrieval.',
            'Cerrar el ciclo convirtiendo cada incidente investigado en caso permanente del borde conocido.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Una calibración final que evita frustración: en el primer mes el detector va a generar más alarma de la que debería, y la reacción correcta no es apagarlo, es ajustar umbral y volumen mínimo con los datos reales que produjo. Anotar cada disparo como verdadero o falso positivo durante cuatro semanas da exactamente la información necesaria para calibrar, y convierte al detector de una suposición sobre el sistema en una herramienta en la que el equipo confía. Sin esa fase, el resultado previsible es el canal de alerta silenciado, y un detector silenciado es indistinguible de no tener detector alguno.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no usar el promedio del tráfico reciente como referencia de calidad?',
      answer:
        'Porque el promedio móvil del propio tráfico envejece junto con el problema y por eso no detecta justamente el caso más peligroso. Si la calidad cae dos por ciento por semana, la referencia cae a la misma velocidad, la desviación relativa se mantiene cerca de cero y la alerta nunca dispara, incluso después de seis meses y treinta por ciento de degradación acumulada. Una regla que se ajusta a lo que mide no mide nada. La referencia debe ser un conjunto congelado de casos con expectativa revisada por gente, ejecutado contra la versión actual en cadencia fija, y la comparación debe ser doble: contra esa línea base, que captura la deriva lenta, y contra la ventana inmediatamente anterior, que captura la ruptura brusca de un despliegue o cambio de modelo. Cada comparación atrapa un tipo de deriva que la otra deja pasar.',
    },
    {
      question: '¿Qué señales detectan deriva sin necesidad de evaluar el contenido de la respuesta?',
      answer:
        'Las conductuales son las más informativas porque cargan el juicio implícito del usuario y no cuestan nada de recolectar sobre el cien por ciento del tráfico. La tasa de reformulación, que mide cuántas veces el cliente reescribe la misma pregunta, sube apenas la respuesta deja de resolver, aunque siga bien escrita. La cantidad de turnos hasta la resolución es sensible y se mueve temprano. La tasa de escalamiento segmentada por intención separa el caso complejo que siempre escaló de la regresión nueva. La tasa de abandono en medio de la conversación captura al cliente que desiste en silencio, el grupo que nunca reclama y por eso nunca aparece en soporte. A las conductuales se suman dos estructurales útiles: la distribución del largo de la respuesta, que delata un cambio de versión del modelo, y la tasa de respuestas con cita válida, que delata retrieval degradado antes de que caiga la calidad.',
    },
    {
      question: '¿Cómo evitar que el detector de deriva se vuelva ruido que el equipo ignora?',
      answer:
        'Con tres frenos aplicados juntos y una fase de calibración. El primer freno es el volumen mínimo por segmento, porque una caída de cinco puntos sobre treinta conversaciones no es señal y alertar sobre eso entrena al equipo a desconfiar del canal. El segundo es la persistencia: una ventana mala es variación, dos ventanas seguidas en la misma dirección son deriva, y exigir persistencia elimina la mayor parte de los falsos positivos sin atrasar la detección de forma relevante. El tercero es la corrección para comparaciones múltiples, obligatoria porque segmentar por intención, canal e idioma multiplica la cantidad de pruebas y por lo tanto la probabilidad de una desviación por azar. Además, en el primer mes lo correcto no es apagar la alerta ruidosa, es anotar cada disparo como verdadero o falso positivo y usar esos datos para ajustar umbral y volumen mínimo, porque un detector silenciado es indistinguible de no tener detector.',
    },
  ],
  conclusion: {
    title: 'La peor falla es la que no genera error',
    description:
      'Un bot que se degrada no se cae, no dispara la latencia y no aparece en ningún panel clásico: sigue respondiendo, cada vez peor, hasta que la señal llega por el reclamo del cliente, cuando el daño ya está hecho y la causa ya se perdió. Señales indirectas sobre todo el tráfico para detectar temprano, un conjunto de referencia congelado que sirva de regla en vez de un promedio móvil que se derrite, comparación doble con volumen mínimo y corrección para comparaciones múltiples, y una alerta que ya llegue con el caso concreto y los cambios de la ventana convierten la deriva de sorpresa en evento gestionado. Puedo montar esa detección en tu bot de atención, de las señales conductuales al gate de eval en el rollout, para que la regresión aparezca en tu canal antes de aparecer en el del cliente.',
    cta: 'Hablar sobre detección de deriva en mi bot de atención',
  },
  related: [
    { label: 'Evaluación continua de bots con eval automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Observabilidad en LLM: tracing, costo y calidad', to: '/blog/observabilidade-llm-tracing-custo-qualidade' },
    { label: 'SLAs de atención entre bot y humano', to: '/blog/slas-atendimento-bot-humano' },
  ],
};

export default { pt, en, es };
