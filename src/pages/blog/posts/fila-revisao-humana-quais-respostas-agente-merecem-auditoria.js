// Conteudo do artigo: fila de revisao humana, como escolher quais respostas
// do agente merecem auditoria quando ninguem consegue revisar tudo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O agente responde quarenta mil vezes por mês e o time tem duas pessoas que conseguem revisar, no máximo, trezentas respostas cada uma. Isso é menos de dois por cento do tráfego, e a decisão que quase todo mundo toma é revisar por amostragem aleatória, porque parece estatisticamente honesto. É honesto para estimar uma taxa de erro global e é péssimo para encontrar erro: numa operação com noventa e cinco por cento de acerto, revisar trezentas respostas aleatórias entrega quinze problemas e duzentas e oitenta e cinco confirmações de que está tudo bem. O revisor gasta a maior parte do turno lendo respostas corretas. Este artigo trata a revisão humana como o recurso escasso que ela é, com o problema formulado de forma útil: dado um orçamento fixo de atenção humana por dia, quais respostas colocar na fila para maximizar o que se aprende, e como impedir que essa fila vire um depósito que ninguém abre.',
  sections: [
    {
      title: 'Amostra aleatória e busca de erro são objetivos diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusão que produz filas inúteis é tratar como um só problema o que são dois. Estimar a taxa de erro do sistema exige amostra aleatória, sem viés, porque qualquer seleção enviesada destrói a capacidade de generalizar o número para o todo. Encontrar e corrigir erros exige exatamente o contrário: concentrar a atenção onde a probabilidade de erro é maior. As duas coisas são necessárias, e a solução é dividir explicitamente o orçamento entre elas em vez de escolher uma e fingir que ela serve para as duas.',
        },
        {
          type: 'diagram',
          value: `orcamento diario de revisao: 60 respostas

[ 12 ] amostra aleatoria pura ....... estimar a taxa de erro real
[ 30 ] risco alto por sinal ......... encontrar defeito onde ele mora
[ 12 ] fronteira de decisao ......... calibrar limiar de escalonamento
[  6 ] casos novos ou fora do padrao . descobrir o que ainda nao existe

a fatia aleatoria e a unica que produz numero generalizavel
as outras tres produzem correcao, nao estatistica`,
        },
        {
          type: 'paragraph',
          value:
            'A divisão acima não é arbitrária e cada fatia responde a uma pergunta distinta. A fatia aleatória é a única que permite dizer "a qualidade é de noventa e quatro por cento" com honestidade, e ela precisa ser pequena mas nunca zero, porque sem ela você perde a régua e passa a medir apenas o que já suspeitava. A fatia de risco alto é onde a correção acontece. A fatia de fronteira serve para calibrar limiares, que é uma tarefa recorrente e que ninguém faz sem dados. E a fatia de novidade é o seguro contra o ponto cego: ela existe para pegar o tipo de caso que ainda não tem sinal associado porque nunca apareceu antes.',
        },
        {
          type: 'paragraph',
          value:
            'Vale ser explícito sobre a consequência estatística de misturar: se você revisar só o que o sistema marcou como arriscado e reportar a taxa de erro dessa fila como taxa de erro do produto, o número vai ser terrível e não vai significar nada. O contrário também acontece: times que revisam só amostra aleatória concluem que a qualidade está ótima enquanto uma falha concentrada num tipo raro de pedido queima clientes silenciosamente todo mês.',
        },
      ],
    },
    {
      title: 'Os sinais que realmente predizem erro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Escolher o que revisar é um problema de ordenação, e ordenar exige sinal. O erro comum é usar um único indicador, quase sempre a confiança auto declarada do modelo, que é o pior deles isoladamente: modelos são confiantes quando erram e a correlação entre confiança expressa e correção é fraca o suficiente para não sustentar uma fila. O que funciona é combinar sinais baratos de origens diferentes, porque eles falham de formas diferentes e a combinação cobre mais que a soma das partes.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'O que ele captura', 'Limitação que exige combinação'],
          rows: [
            [
              'Escore de recuperação baixo no RAG',
              'A resposta foi gerada com contexto fraco ou ausente',
              'Pergunta simples pode não precisar de contexto algum',
            ],
            [
              'Divergência entre duas gerações da mesma pergunta',
              'Instabilidade: o modelo não tem uma resposta firme',
              'Custa uma chamada extra, então só vale em amostra',
            ],
            [
              'Conversa que passou por transbordo para humano',
              'Sinal forte e gratuito de que a automação não resolveu',
              'Chega tarde: o cliente já sentiu o problema',
            ],
            [
              'Cliente reformulou a mesma pergunta em seguida',
              'A resposta anterior não serviu, mesmo sem reclamação',
              'Também captura cliente que só mudou de assunto',
            ],
            [
              'Ferramenta com efeito colateral foi chamada',
              'Erro aqui é caro e irreversível, não só embaraçoso',
              'Alto volume: precisa ser cruzado com valor da operação',
            ],
            [
              'Resposta muito curta ou muito longa para o tipo de pergunta',
              'Recusa disfarçada ou divagação sem conteúdo',
              'Limiar depende da vertical e envelhece com o prompt',
            ],
            [
              'Assunto raro segundo o histórico de intenções',
              'Cauda longa, onde o eval quase nunca tem cobertura',
              'Raro não é sinônimo de errado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Repare que três desses sinais são gratuitos, porque já existem nos dados que o sistema produz: transbordo, reformulação e chamada de ferramenta. Começar por eles é a decisão certa quando não há orçamento para instrumentar nada novo, e eles sozinhos já rendem uma fila muito melhor que aleatória. A divergência entre gerações é o sinal mais forte da lista e o único que custa dinheiro, então ele entra depois, aplicado apenas ao subconjunto que já passou pelos outros filtros.',
        },
        {
          type: 'code',
          value: `// Pontuacao de prioridade da fila. Sinais somados com peso, todos
// normalizados entre zero e um, para que o peso signifique alguma coisa.

const PESOS = {
  recuperacaoFraca: 0.25,
  transbordo: 0.30,
  reformulacao: 0.15,
  ferramentaComEfeito: 0.20,
  tamanhoAnomalo: 0.10,
};

// Valor de negocio multiplica em vez de somar: um erro numa conversa de
// ticket alto importa mais que o mesmo erro numa consulta trivial.
const fatorValor = (valorConversa, valorMediano) =>
  Math.min(3, Math.max(0.5, valorConversa / Math.max(1, valorMediano)));

export const pontuarParaRevisao = (resposta, contexto) => {
  const sinais = {
    // Escore de recuperacao vira risco invertido: quanto pior o contexto
    // recuperado, maior a chance de a resposta ter sido inventada.
    recuperacaoFraca: resposta.usouRag
      ? Math.max(0, 1 - resposta.escoreRecuperacaoTopo)
      : 0,
    transbordo: resposta.houveTransbordo ? 1 : 0,
    reformulacao: resposta.clienteReformulouEmSeguida ? 1 : 0,
    ferramentaComEfeito: resposta.ferramentasChamadas.some((f) => f.temEfeitoColateral) ? 1 : 0,
    tamanhoAnomalo: contexto.desvioDeTamanho(resposta) > 2 ? 1 : 0,
  };

  const base = Object.entries(PESOS).reduce(
    (soma, [chave, peso]) => soma + peso * sinais[chave],
    0,
  );

  return {
    prioridade: base * fatorValor(resposta.valorConversa, contexto.valorMediano),
    // Guardar os sinais junto da pontuacao e o que permite ao revisor
    // saber por que aquele item chegou na fila dele.
    sinais,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Duas escolhas desse código são deliberadas. A primeira é o valor da conversa entrar como multiplicador e não como mais uma parcela: um erro numa negociação de ticket alto merece atenção desproporcional, e somar mais um peso não produz esse comportamento. A segunda é devolver os sinais junto com a pontuação. Um item que chega na fila sem explicação faz o revisor gastar dois minutos entendendo por que está olhando aquilo, e dois minutos vezes trezentos itens é o turno inteiro de uma pessoa.',
        },
      ],
    },
    {
      title: 'A fila precisa caber no turno de quem revisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aqui está o erro operacional que mata mais iniciativas de revisão do que qualquer problema técnico: a fila é dimensionada pela quantidade de itens suspeitos, e não pela capacidade humana disponível. Numa segunda-feira com incidente, o sistema marca oito mil respostas como arriscadas, a fila estoura, o revisor abre, vê o tamanho e fecha. A partir daí a fila está morta, e a próxima conversa sobre revisão humana vai começar do zero em seis meses.',
        },
        {
          type: 'paragraph',
          value:
            'A fila precisa ser um orçamento, não um filtro. Se a capacidade é de sessenta itens por dia, a fila do dia tem exatamente sessenta itens, escolhidos como os melhores sessenta segundo a pontuação e as cotas de cada fatia. O que não entrou não fica pendente: ele é descartado da fila e continua existindo nos dados agregados, onde é contado sem ser lido individualmente. Essa distinção entre "revisado" e "contabilizado" é o que impede a fila de virar dívida.',
        },
        {
          type: 'ordered',
          items: [
            'Meça o tempo real de revisão por item, cronometrado e não estimado, incluindo o tempo de ler o contexto da conversa e não só a resposta final.',
            'Defina a capacidade diária como número de itens, derivada desse tempo e das horas que o time realmente tem, com folga para os itens difíceis que levam o triplo.',
            'Monte a fila do dia por cota: cada fatia recebe um número fixo de vagas e disputa internamente por pontuação, para que a fatia de risco alto nunca engula a de amostra aleatória.',
            'Descarte o excedente explicitamente em vez de acumular, e registre quantos itens ficaram de fora para que o dado de cobertura seja honesto.',
            'Reserve uma faixa da capacidade para itens vindos de incidente aberto, porque durante incidente a prioridade muda e a fila normal fica irrelevante.',
          ],
        },
        {
          type: 'code',
          value: `// Montagem da fila diaria por cota. A capacidade e o limite superior,
// e o excedente e descartado de proposito para a fila nunca virar deposito.

const COTAS = {
  aleatoria: 0.2,
  riscoAlto: 0.5,
  fronteira: 0.2,
  novidade: 0.1,
};

const pegarMelhores = (itens, n) =>
  [...itens].sort((a, b) => b.prioridade - a.prioridade).slice(0, n);

export const montarFilaDoDia = (candidatos, capacidade, aleatorioSeguro) => {
  const vagas = Object.fromEntries(
    Object.entries(COTAS).map(([fatia, fracao]) => [fatia, Math.floor(capacidade * fracao)]),
  );

  const porFatia = {
    // Amostra aleatoria de verdade: sem ordenacao por pontuacao, ou o
    // numero que ela produz deixa de ser generalizavel.
    aleatoria: aleatorioSeguro(candidatos, vagas.aleatoria),
    riscoAlto: pegarMelhores(
      candidatos.filter((c) => c.prioridade >= 0.6),
      vagas.riscoAlto,
    ),
    // Fronteira: itens perto do limiar de escalonamento, onde a decisao
    // de automatizar ou transbordar e mais dificil e mais calibravel.
    fronteira: pegarMelhores(
      candidatos.filter((c) => Math.abs(c.prioridade - 0.5) < 0.08),
      vagas.fronteira,
    ),
    novidade: pegarMelhores(
      candidatos.filter((c) => c.intencaoRara || c.semCoberturaNoEval),
      vagas.novidade,
    ),
  };

  const vistos = new Set();
  const fila = [];
  for (const [fatia, itens] of Object.entries(porFatia)) {
    for (const item of itens) {
      if (vistos.has(item.id)) continue; // um item pertence a uma fatia so
      vistos.add(item.id);
      fila.push({ ...item, fatia });
    }
  }

  return {
    fila,
    // Descartados nao viram pendencia: entram na metrica de cobertura
    // e desaparecem da fila, que precisa caber no turno de hoje.
    descartados: candidatos.length - fila.length,
    cobertura: candidatos.length === 0 ? 1 : fila.length / candidatos.length,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe do conjunto de itens já vistos importa mais do que parece. Sem ele, um item de risco alto que também é raro aparece duas vezes na fila, o revisor lê o mesmo caso duas vezes e conclui, com razão, que a ferramenta é descuidada. Uma fila de revisão perde a confiança do time por esse tipo de detalhe muito antes de perder por má escolha de sinal.',
        },
      ],
    },
    {
      title: 'O que o revisor devolve precisa ser reaproveitável',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Revisão humana só se paga se o resultado alimentar alguma coisa. O padrão que não se paga é o revisor escrever um comentário livre num campo de texto e marcar o item como visto: isso produz conhecimento que mora na cabeça de quem revisou e num campo que ninguém consulta. O padrão que se paga transforma cada revisão em um registro estruturado que serve como caso de avaliação, evidência para ajuste de prompt ou entrada num relatório de qualidade.',
        },
        {
          type: 'list',
          items: [
            'Veredito em categoria fechada, não em texto livre: correto, incorreto por informação errada, incorreto por informação faltando, correto mas em tom inadequado, recusa indevida, ação indevida por ferramenta.',
            'A resposta que deveria ter sido dada, escrita pelo revisor quando o veredito é negativo, porque é isso que transforma o caso em item de conjunto de avaliação sem trabalho adicional depois.',
            'A causa provável apontada entre opções conhecidas: contexto não recuperado, contexto recuperado mas ignorado, instrução ambígua no prompt, ferramenta devolveu dado errado, política mudou e o prompt não.',
            'Referência estável para a conversa e para a versão do prompt e do modelo vigentes naquele momento, sem a qual a análise agregada por versão é impossível.',
            'Tempo gasto na revisão, que é o dado que permite recalibrar a capacidade diária quando o perfil dos casos muda.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O segundo item é o de maior retorno e o mais negligenciado. Pedir ao revisor que escreva a resposta correta parece aumentar o custo da revisão, e aumenta mesmo, em talvez um minuto por caso negativo. Em troca, cada caso negativo revisado vira automaticamente um item de conjunto de avaliação com entrada e saída esperada, que é exatamente o insumo mais caro de produzir de qualquer outra forma. Sem isso, alguém vai precisar reconstruir esses casos depois, com menos contexto e mais esforço.',
        },
        {
          type: 'code',
          value: `// Registro estruturado da revisao. O formato e o que permite reaproveitar
// o trabalho humano como caso de eval sem uma segunda passada.

export const registrarRevisao = async (repo, { item, revisor, veredito }) => {
  const registro = {
    conversaId: item.conversaId,
    respostaId: item.id,
    fatiaDaFila: item.fatia,
    sinais: item.sinais,
    // Versoes vigentes: sem elas nao da para dizer se a regressao veio
    // do prompt novo, do modelo novo ou da base de conhecimento nova.
    promptVersao: item.promptVersao,
    modelo: item.modelo,
    veredito: veredito.categoria,
    respostaEsperada: veredito.respostaEsperada ?? null,
    causaProvavel: veredito.causaProvavel ?? null,
    revisor,
    duracaoSegundos: veredito.duracaoSegundos,
  };

  await repo.salvarRevisao(registro);

  // Caso negativo com resposta esperada preenchida ja nasce como item
  // candidato do conjunto de avaliacao, marcado para curadoria.
  const negativo = veredito.categoria !== 'correto';
  if (negativo && veredito.respostaEsperada) {
    await repo.proporCasoDeEval({
      entrada: item.perguntaCliente,
      contexto: item.contextoRecuperado,
      saidaEsperada: veredito.respostaEsperada,
      origem: 'revisao-humana',
      revisaoId: registro.respostaId,
      // Nunca entra direto no eval: um caso mal escrito envenena a regua
      // por meses, entao passa por curadoria antes de valer nota.
      estado: 'aguardando-curadoria',
    });
  }

  return registro;
};`,
        },
        {
          type: 'paragraph',
          value:
            'O estado de espera por curadoria não é burocracia. Um caso de avaliação escrito às pressas por um revisor cansado, com uma resposta esperada que reflete a opinião dele e não a política da empresa, vai valer nota por meses e empurrar o sistema na direção errada. A revisão humana propõe, a curadoria decide, e esse par de etapas custa pouco perto do estrago que um conjunto de avaliação contaminado provoca.',
        },
      ],
    },
    {
      title: 'Medir se a fila está funcionando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma fila de revisão pode consumir duas pessoas em tempo integral e não produzir nada, e o time só descobre isso quando alguém pergunta o que mudou por causa dela. As métricas de uma fila não são sobre quantidade revisada, que é apenas medida de esforço. Elas são sobre densidade de achado e sobre efeito, e as duas precisam aparecer no mesmo painel.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Como ler', 'Ação quando está ruim'],
          rows: [
            [
              'Densidade de erro na fatia de risco alto',
              'Proporção de vereditos negativos entre os itens priorizados',
              'Se está perto da taxa geral, os sinais não predizem nada: revise os pesos',
            ],
            [
              'Elevação sobre a aleatória',
              'Densidade da fatia de risco dividida pela densidade da aleatória',
              'Abaixo de duas vezes, a priorização não se justifica frente ao custo',
            ],
            [
              'Cobertura declarada',
              'Itens revisados sobre itens candidatos, sempre visível',
              'Se ninguém sabe que é dois por cento, alguém vai tratar como auditoria total',
            ],
            [
              'Casos de eval originados da fila',
              'Quantos itens negativos viraram caso curado por semana',
              'Zero significa que a revisão está produzindo apenas leitura',
            ],
            [
              'Tempo entre revisão e correção',
              'Da marcação negativa até o ajuste de prompt, base ou ferramenta',
              'Se passa de semanas, a fila vira registro histórico e desmotiva o revisor',
            ],
            [
              'Concordância entre revisores',
              'Proporção de acordo em um lote pequeno revisado em duplicata',
              'Baixa concordância indica critério ambíguo, não revisor ruim',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A elevação sobre a aleatória é a métrica que justifica toda a máquina, e ela merece cuidado na leitura. Se a fatia de risco alto tem densidade de erro de trinta por cento e a aleatória tem cinco, a elevação é seis: cada hora do revisor rende seis vezes mais achados do que renderia sem priorização. Se a elevação for próxima de um, toda a pontuação, os pesos e o código de fila estão sendo executados para produzir o mesmo resultado que um sorteio, e a resposta honesta é simplificar em vez de adicionar mais um sinal.',
        },
        {
          type: 'paragraph',
          value:
            'A concordância entre revisores é a métrica que quase ninguém coleta e que explica boa parte das discussões improdutivas sobre qualidade. Colocar dez itens por semana na fila de duas pessoas ao mesmo tempo custa dez itens de capacidade e revela se o critério é compartilhado. Quando a concordância é baixa, o problema não está no agente nem no revisor: está numa definição de "resposta correta" que ninguém escreveu, e nenhuma métrica de qualidade construída sobre esse chão significa coisa alguma.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não revisar por amostragem aleatória, que é o método estatisticamente correto?',
      answer:
        'Porque amostragem aleatória responde uma pergunta diferente da que você tem. Ela é a única forma honesta de estimar a taxa de erro global do sistema, e por isso precisa existir sempre, ocupando uma fatia pequena do orçamento de revisão. Mas ela é péssima para encontrar erro: se a operação acerta noventa e cinco por cento das vezes, o revisor passa noventa e cinco por cento do turno confirmando que respostas corretas estão corretas. Priorizar por sinal concentra a atenção onde o erro mora e costuma render várias vezes mais achados por hora de revisão. A solução não é escolher uma das duas, é dividir o orçamento explicitamente em fatias com propósitos distintos, e nunca reportar a taxa de erro da fatia priorizada como se fosse a do produto.',
    },
    {
      question: 'Que sinais usar quando não há nenhuma instrumentação específica ainda?',
      answer:
        'Comece pelos três que já existem nos seus dados e não custam nada para coletar: conversas que acabaram em transbordo para atendente humano, clientes que reformularam a mesma pergunta logo depois da resposta, e respostas em que o agente chamou alguma ferramenta com efeito colateral, como emitir segunda via, alterar cadastro ou registrar pedido. Esses três sozinhos já produzem uma fila bem melhor que aleatória. Depois deles, o próximo passo mais barato é o escore de recuperação do RAG, que você já tem se usa busca vetorial. O sinal mais forte, que é a divergência entre duas gerações da mesma pergunta, custa uma chamada extra ao modelo e por isso deve ser aplicado apenas ao subconjunto que já passou pelos filtros anteriores, nunca no tráfego inteiro.',
    },
    {
      question: 'A fila cresce mais rápido do que o time revisa. O que fazer com o acúmulo?',
      answer:
        'Descartar, explicitamente e todo dia. Uma fila de revisão precisa ser um orçamento de atenção, não um filtro de tudo que parece suspeito: se a capacidade é de sessenta itens por dia, a fila do dia tem sessenta itens e o resto sai. O que não foi revisado individualmente continua existindo nos dados agregados e nas métricas, então não se perde informação, apenas leitura humana. O acúmulo é pior que o descarte por dois motivos: um revisor que abre uma fila com oito mil itens fecha a ferramenta e não volta, e uma fila com pendência antiga faz o time revisar caso de três semanas atrás em vez do caso de ontem, que é o que ainda dá para corrigir. Registre quantos itens ficaram de fora e mostre a cobertura real no painel, para que ninguém confunda a fila com auditoria completa.',
    },
  ],
  conclusion: {
    title: 'Atenção humana é orçamento, não filtro',
    description:
      'O erro que inutiliza a maioria das filas de revisão não é técnico, é de enquadramento: elas são construídas como um filtro que separa o suspeito do normal, quando deveriam ser construídas como um orçamento fixo de atenção humana disputado por candidatos. A partir desse enquadramento tudo fica mais simples: a capacidade define o tamanho da fila, as cotas garantem que a fatia aleatória sobreviva à pressão da fatia de risco, o excedente é descartado sem virar dívida, e cada revisão negativa devolve uma resposta esperada que nasce como candidata a caso de avaliação. E a pergunta que decide se a máquina inteira se justifica é uma só: quantas vezes mais defeitos por hora essa fila encontra em comparação com um sorteio. Se a resposta for próxima de uma vez, simplifique, porque a complexidade não está pagando nada.',
    cta: 'Quer transformar as horas de revisão do seu time em correção e não em leitura? Posso desenhar a pontuação de prioridade com os sinais que você já tem, dimensionar a fila pela capacidade real e fechar o ciclo entre revisão humana e conjunto de avaliação.',
  },
  related: [
    {
      label: 'Congelar o conjunto de avaliação: por que o seu eval envelhece e como renovar',
      to: '/blog/congelar-conjunto-avaliacao-eval-envelhece-como-renovar',
    },
    {
      label: 'Detectar deriva de qualidade antes do cliente reclamar',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const en = {
  intro:
    'The agent answers forty thousand times a month and the team has two people who can review, at best, three hundred answers each. That is under two percent of traffic, and the decision almost everyone makes is to review a random sample, because it feels statistically honest. It is honest for estimating a global error rate and it is terrible for finding errors: in an operation that is right ninety-five percent of the time, reviewing three hundred random answers yields fifteen problems and two hundred eighty-five confirmations that everything is fine. The reviewer spends most of the shift reading correct answers. This article treats human review as the scarce resource it is, with the problem framed usefully: given a fixed budget of human attention per day, which answers should go into the queue to maximize what you learn, and how do you keep that queue from becoming a bin nobody opens.',
  sections: [
    {
      title: 'Random sampling and error hunting are different goals',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The confusion that produces useless queues is treating two problems as one. Estimating the system error rate requires a random, unbiased sample, because any biased selection destroys the ability to generalize the number to the whole. Finding and fixing errors requires exactly the opposite: concentrating attention where the probability of error is highest. Both are necessary, and the solution is to split the budget explicitly between them instead of picking one and pretending it serves both.',
        },
        {
          type: 'diagram',
          value: `daily review budget: 60 answers

[ 12 ] pure random sample .......... estimate the real error rate
[ 30 ] high risk by signal ......... find defects where they live
[ 12 ] decision boundary ........... calibrate the escalation threshold
[  6 ] new or off-pattern cases .... discover what does not exist yet

the random slice is the only one producing a generalizable number
the other three produce correction, not statistics`,
        },
        {
          type: 'paragraph',
          value:
            'That split is not arbitrary and each slice answers a distinct question. The random slice is the only one that lets you honestly say "quality is ninety-four percent", and it must be small but never zero, because without it you lose the ruler and start measuring only what you already suspected. The high risk slice is where correction happens. The boundary slice serves to calibrate thresholds, which is a recurring task nobody does without data. And the novelty slice is insurance against the blind spot: it exists to catch the kind of case that has no associated signal yet because it never appeared before.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth being explicit about the statistical consequence of mixing: if you review only what the system flagged as risky and report that queue error rate as the product error rate, the number will be terrible and will mean nothing. The reverse also happens: teams that review only random samples conclude quality is great while a failure concentrated in a rare order type silently burns customers every month.',
        },
      ],
    },
    {
      title: 'The signals that actually predict errors',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Choosing what to review is a ranking problem, and ranking requires signal. The common mistake is using a single indicator, almost always the model self reported confidence, which is the worst one in isolation: models are confident when they are wrong and the correlation between expressed confidence and correctness is weak enough not to sustain a queue. What works is combining cheap signals from different sources, because they fail in different ways and the combination covers more than the sum of its parts.',
        },
        {
          type: 'table',
          columns: ['Signal', 'What it captures', 'Limitation requiring combination'],
          rows: [
            [
              'Low retrieval score in RAG',
              'The answer was generated with weak or absent context',
              'A simple question may not need context at all',
            ],
            [
              'Divergence between two generations of the same question',
              'Instability: the model has no firm answer',
              'Costs an extra call, so it only pays off on a sample',
            ],
            [
              'Conversation that was handed off to a human',
              'A strong and free signal that automation did not resolve it',
              'It arrives late: the customer already felt the problem',
            ],
            [
              'Customer rephrased the same question right after',
              'The previous answer did not work, even without a complaint',
              'Also catches customers who simply changed subject',
            ],
            [
              'A tool with side effects was called',
              'An error here is expensive and irreversible, not just embarrassing',
              'High volume: must be crossed with operation value',
            ],
            [
              'Answer much shorter or longer than the question type warrants',
              'Disguised refusal or rambling with no content',
              'The threshold depends on the vertical and ages with the prompt',
            ],
            [
              'Rare subject according to intent history',
              'Long tail, where the eval almost never has coverage',
              'Rare is not a synonym for wrong',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Notice that three of those signals are free, because they already exist in the data the system produces: handoff, rephrasing and tool calls. Starting with them is the right decision when there is no budget to instrument anything new, and by themselves they already produce a queue far better than random. Divergence between generations is the strongest signal on the list and the only one that costs money, so it comes later, applied only to the subset that already passed the other filters.',
        },
        {
          type: 'code',
          value: `// Queue priority scoring. Weighted sum of signals, all normalized
// between zero and one so that the weights actually mean something.

const WEIGHTS = {
  weakRetrieval: 0.25,
  handoff: 0.30,
  rephrasing: 0.15,
  sideEffectTool: 0.20,
  anomalousLength: 0.10,
};

// Business value multiplies instead of adding: an error in a high ticket
// conversation matters more than the same error in a trivial lookup.
const valueFactor = (conversationValue, medianValue) =>
  Math.min(3, Math.max(0.5, conversationValue / Math.max(1, medianValue)));

export const scoreForReview = (answer, context) => {
  const signals = {
    // The retrieval score becomes inverted risk: the worse the retrieved
    // context, the higher the chance the answer was made up.
    weakRetrieval: answer.usedRag ? Math.max(0, 1 - answer.topRetrievalScore) : 0,
    handoff: answer.wasHandedOff ? 1 : 0,
    rephrasing: answer.customerRephrasedRightAfter ? 1 : 0,
    sideEffectTool: answer.toolsCalled.some((t) => t.hasSideEffect) ? 1 : 0,
    anomalousLength: context.lengthDeviation(answer) > 2 ? 1 : 0,
  };

  const base = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + weight * signals[key],
    0,
  );

  return {
    priority: base * valueFactor(answer.conversationValue, context.medianValue),
    // Storing the signals alongside the score is what lets the reviewer
    // know why that item landed in their queue.
    signals,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Two choices in that code are deliberate. The first is conversation value entering as a multiplier rather than another additive term: an error in a high ticket negotiation deserves disproportionate attention, and adding one more weight does not produce that behavior. The second is returning the signals along with the score. An item that reaches the queue without explanation makes the reviewer spend two minutes figuring out why they are looking at it, and two minutes times three hundred items is one person entire shift.',
        },
      ],
    },
    {
      title: 'The queue must fit the reviewer shift',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Here is the operational mistake that kills more review initiatives than any technical problem: the queue is sized by the number of suspicious items rather than by available human capacity. On a Monday with an incident, the system flags eight thousand answers as risky, the queue overflows, the reviewer opens it, sees the size and closes it. From then on the queue is dead, and the next conversation about human review will start from scratch in six months.',
        },
        {
          type: 'paragraph',
          value:
            'The queue must be a budget, not a filter. If capacity is sixty items a day, today queue holds exactly sixty items, chosen as the best sixty according to the score and the slice quotas. What did not make it is not left pending: it is discarded from the queue and continues to exist in aggregate data, where it is counted without being read individually. That distinction between "reviewed" and "counted" is what keeps the queue from becoming debt.',
        },
        {
          type: 'ordered',
          items: [
            'Measure the real review time per item, timed rather than estimated, including the time to read the conversation context and not just the final answer.',
            'Define daily capacity as a number of items, derived from that time and the hours the team actually has, with slack for the hard items that take three times as long.',
            'Build the daily queue by quota: each slice gets a fixed number of seats and competes internally on score, so the high risk slice never swallows the random one.',
            'Discard the overflow explicitly instead of accumulating it, and record how many items were left out so the coverage figure stays honest.',
            'Reserve a band of capacity for items coming from an open incident, because during an incident priorities change and the normal queue becomes irrelevant.',
          ],
        },
        {
          type: 'code',
          value: `// Daily queue assembly by quota. Capacity is the upper bound, and the
// overflow is discarded on purpose so the queue never becomes a bin.

const QUOTAS = {
  random: 0.2,
  highRisk: 0.5,
  boundary: 0.2,
  novelty: 0.1,
};

const takeBest = (items, n) =>
  [...items].sort((a, b) => b.priority - a.priority).slice(0, n);

export const buildDailyQueue = (candidates, capacity, safeRandom) => {
  const seats = Object.fromEntries(
    Object.entries(QUOTAS).map(([slice, fraction]) => [slice, Math.floor(capacity * fraction)]),
  );

  const bySlice = {
    // A genuinely random sample: no score ordering, or the number it
    // produces stops being generalizable.
    random: safeRandom(candidates, seats.random),
    highRisk: takeBest(
      candidates.filter((c) => c.priority >= 0.6),
      seats.highRisk,
    ),
    // Boundary: items near the escalation threshold, where the decision
    // to automate or hand off is hardest and most calibratable.
    boundary: takeBest(
      candidates.filter((c) => Math.abs(c.priority - 0.5) < 0.08),
      seats.boundary,
    ),
    novelty: takeBest(
      candidates.filter((c) => c.rareIntent || c.noEvalCoverage),
      seats.novelty,
    ),
  };

  const seen = new Set();
  const queue = [];
  for (const [slice, items] of Object.entries(bySlice)) {
    for (const item of items) {
      if (seen.has(item.id)) continue; // an item belongs to one slice only
      seen.add(item.id);
      queue.push({ ...item, slice });
    }
  }

  return {
    queue,
    // Discarded items do not become pending work: they feed the coverage
    // metric and leave the queue, which has to fit today shift.
    discarded: candidates.length - queue.length,
    coverage: candidates.length === 0 ? 1 : queue.length / candidates.length,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The seen set detail matters more than it looks. Without it, a high risk item that is also rare shows up twice in the queue, the reviewer reads the same case twice and concludes, reasonably, that the tool is careless. A review queue loses the team trust over that kind of detail long before it loses it over a poor signal choice.',
        },
      ],
    },
    {
      title: 'What the reviewer returns has to be reusable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Human review only pays off if the result feeds something. The pattern that does not pay off is the reviewer writing a free-form comment in a text field and marking the item as seen: that produces knowledge living in the reviewer head and in a field nobody queries. The pattern that pays off turns each review into a structured record usable as an evaluation case, evidence for a prompt adjustment or an entry in a quality report.',
        },
        {
          type: 'list',
          items: [
            'A verdict from a closed category, not free text: correct, incorrect due to wrong information, incorrect due to missing information, correct but with inappropriate tone, undue refusal, undue action through a tool.',
            'The answer that should have been given, written by the reviewer when the verdict is negative, because that is what turns the case into an evaluation set item with no extra work later.',
            'The likely cause picked from known options: context not retrieved, context retrieved but ignored, ambiguous instruction in the prompt, tool returned wrong data, policy changed and the prompt did not.',
            'A stable reference to the conversation and to the prompt and model versions in effect at that moment, without which aggregate analysis per version is impossible.',
            'Time spent on the review, which is the data that lets you recalibrate daily capacity when the case profile changes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second item has the highest return and is the most neglected. Asking the reviewer to write the correct answer looks like it increases review cost, and it does, by maybe a minute per negative case. In exchange, every reviewed negative case automatically becomes an evaluation set item with an input and an expected output, which is exactly the most expensive input to produce any other way. Without it, someone will have to reconstruct those cases later, with less context and more effort.',
        },
        {
          type: 'code',
          value: `// Structured review record. The format is what allows reusing the human
// work as an eval case without a second pass.

export const recordReview = async (repo, { item, reviewer, verdict }) => {
  const record = {
    conversationId: item.conversationId,
    answerId: item.id,
    queueSlice: item.slice,
    signals: item.signals,
    // Versions in effect: without them there is no way to tell whether the
    // regression came from the new prompt, the new model or the new base.
    promptVersion: item.promptVersion,
    model: item.model,
    verdict: verdict.category,
    expectedAnswer: verdict.expectedAnswer ?? null,
    likelyCause: verdict.likelyCause ?? null,
    reviewer,
    durationSeconds: verdict.durationSeconds,
  };

  await repo.saveReview(record);

  // A negative case with an expected answer filled in is born as a
  // candidate evaluation set item, flagged for curation.
  const negative = verdict.category !== 'correct';
  if (negative && verdict.expectedAnswer) {
    await repo.proposeEvalCase({
      input: item.customerQuestion,
      context: item.retrievedContext,
      expectedOutput: verdict.expectedAnswer,
      origin: 'human-review',
      reviewId: record.answerId,
      // Never enters the eval directly: a poorly written case poisons the
      // ruler for months, so it goes through curation before it counts.
      state: 'awaiting-curation',
    });
  }

  return record;
};`,
        },
        {
          type: 'paragraph',
          value:
            'The awaiting curation state is not bureaucracy. An evaluation case written in a hurry by a tired reviewer, with an expected answer reflecting their opinion rather than company policy, will count toward scores for months and push the system in the wrong direction. Human review proposes, curation decides, and that pair of steps costs little next to the damage a contaminated evaluation set causes.',
        },
      ],
    },
    {
      title: 'Measuring whether the queue is working',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A review queue can consume two full-time people and produce nothing, and the team only finds out when someone asks what changed because of it. Queue metrics are not about volume reviewed, which is merely a measure of effort. They are about finding density and about effect, and both need to appear on the same dashboard.',
        },
        {
          type: 'table',
          columns: ['Metric', 'How to read it', 'Action when it is bad'],
          rows: [
            [
              'Error density in the high risk slice',
              'Share of negative verdicts among prioritized items',
              'If close to the overall rate, the signals predict nothing: revise the weights',
            ],
            [
              'Lift over random',
              'High risk slice density divided by random slice density',
              'Below two times, prioritization does not justify its cost',
            ],
            [
              'Declared coverage',
              'Items reviewed over candidate items, always visible',
              'If nobody knows it is two percent, someone will treat it as a full audit',
            ],
            [
              'Eval cases originated from the queue',
              'How many negative items became curated cases per week',
              'Zero means the review is producing reading only',
            ],
            [
              'Time between review and fix',
              'From the negative verdict to the prompt, base or tool adjustment',
              'If it takes weeks, the queue becomes a historical log and demotivates reviewers',
            ],
            [
              'Inter reviewer agreement',
              'Share of agreement on a small batch reviewed in duplicate',
              'Low agreement points to ambiguous criteria, not to a bad reviewer',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Lift over random is the metric that justifies the whole machine, and it deserves careful reading. If the high risk slice has thirty percent error density and the random one has five, the lift is six: every reviewer hour yields six times more findings than it would without prioritization. If the lift is close to one, all the scoring, weights and queue code are running to produce the same result as a lottery, and the honest answer is to simplify rather than add one more signal.',
        },
        {
          type: 'paragraph',
          value:
            'Inter reviewer agreement is the metric almost nobody collects and it explains a good share of unproductive quality debates. Putting ten items a week into two people queues at once costs ten items of capacity and reveals whether the criteria are shared. When agreement is low, the problem is neither the agent nor the reviewer: it is a definition of "correct answer" nobody wrote down, and no quality metric built on that ground means anything at all.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not review by random sampling, which is the statistically correct method?',
      answer:
        'Because random sampling answers a different question than the one you have. It is the only honest way to estimate the global error rate of the system, which is why it must always exist, occupying a small slice of the review budget. But it is terrible for finding errors: if the operation is right ninety-five percent of the time, the reviewer spends ninety-five percent of the shift confirming that correct answers are correct. Prioritizing by signal concentrates attention where the error lives and usually yields several times more findings per review hour. The solution is not choosing one of the two, it is splitting the budget explicitly into slices with distinct purposes, and never reporting the prioritized slice error rate as if it were the product one.',
    },
    {
      question: 'Which signals should I use when there is no specific instrumentation yet?',
      answer:
        'Start with the three that already exist in your data and cost nothing to collect: conversations that ended in a handoff to a human agent, customers who rephrased the same question right after the answer, and answers where the agent called a tool with side effects, such as issuing a duplicate invoice, changing a record or placing an order. Those three alone already produce a queue far better than random. After them, the next cheapest step is the RAG retrieval score, which you already have if you use vector search. The strongest signal, divergence between two generations of the same question, costs an extra model call and should therefore be applied only to the subset that already passed the earlier filters, never to full traffic.',
    },
    {
      question: 'The queue grows faster than the team reviews. What do I do with the backlog?',
      answer:
        'Discard it, explicitly and every day. A review queue must be an attention budget, not a filter for everything that looks suspicious: if capacity is sixty items a day, today queue holds sixty items and the rest leaves. What was not reviewed individually still exists in aggregate data and metrics, so no information is lost, only human reading. A backlog is worse than discarding for two reasons: a reviewer who opens a queue with eight thousand items closes the tool and does not come back, and a queue with old pending work makes the team review a case from three weeks ago instead of yesterday case, which is the one still fixable. Record how many items were left out and show the real coverage on the dashboard, so nobody confuses the queue with a full audit.',
    },
  ],
  conclusion: {
    title: 'Human attention is a budget, not a filter',
    description:
      'The mistake that renders most review queues useless is not technical, it is framing: they are built as a filter separating the suspicious from the normal, when they should be built as a fixed budget of human attention that candidates compete for. From that framing everything gets simpler: capacity defines the queue size, quotas guarantee the random slice survives the pressure from the risk slice, overflow is discarded without becoming debt, and every negative review returns an expected answer born as a candidate evaluation case. And the question that decides whether the whole machine is justified is a single one: how many times more defects per hour does this queue find compared to a lottery. If the answer is close to one, simplify, because the complexity is not paying for anything.',
    cta: 'Want to turn your team review hours into corrections rather than reading? I can design the priority scoring from the signals you already have, size the queue by real capacity and close the loop between human review and the evaluation set.',
  },
  related: [
    {
      label: 'Freezing the evaluation set: why your eval ages and how to renew it',
      to: '/blog/congelar-conjunto-avaliacao-eval-envelhece-como-renovar',
    },
    {
      label: 'Detecting quality drift before the customer complains',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

const es = {
  intro:
    'El agente responde cuarenta mil veces por mes y el equipo tiene dos personas que pueden revisar, como máximo, trescientas respuestas cada una. Eso es menos del dos por ciento del tráfico, y la decisión que casi todos toman es revisar por muestreo aleatorio, porque parece estadísticamente honesto. Es honesto para estimar una tasa de error global y es pésimo para encontrar errores: en una operación con noventa y cinco por ciento de acierto, revisar trescientas respuestas aleatorias entrega quince problemas y doscientas ochenta y cinco confirmaciones de que todo está bien. El revisor pasa la mayor parte del turno leyendo respuestas correctas. Este artículo trata la revisión humana como el recurso escaso que es, con el problema formulado de forma útil: dado un presupuesto fijo de atención humana por día, qué respuestas poner en la fila para maximizar lo que se aprende, y cómo impedir que esa fila se convierta en un depósito que nadie abre.',
  sections: [
    {
      title: 'Muestra aleatoria y búsqueda de errores son objetivos distintos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusión que produce filas inútiles es tratar como un solo problema lo que son dos. Estimar la tasa de error del sistema exige muestra aleatoria, sin sesgo, porque cualquier selección sesgada destruye la capacidad de generalizar el número al total. Encontrar y corregir errores exige exactamente lo contrario: concentrar la atención donde la probabilidad de error es mayor. Ambas cosas son necesarias, y la solución es dividir explícitamente el presupuesto entre ellas en vez de elegir una y fingir que sirve para las dos.',
        },
        {
          type: 'diagram',
          value: `presupuesto diario de revision: 60 respuestas

[ 12 ] muestra aleatoria pura ...... estimar la tasa de error real
[ 30 ] riesgo alto por senal ....... encontrar el defecto donde vive
[ 12 ] frontera de decision ........ calibrar el umbral de escalado
[  6 ] casos nuevos o atipicos ..... descubrir lo que aun no existe

la porcion aleatoria es la unica que produce un numero generalizable
las otras tres producen correccion, no estadistica`,
        },
        {
          type: 'paragraph',
          value:
            'Esa división no es arbitraria y cada porción responde a una pregunta distinta. La porción aleatoria es la única que permite decir "la calidad es del noventa y cuatro por ciento" con honestidad, y debe ser pequeña pero nunca cero, porque sin ella perdés la regla y pasás a medir apenas lo que ya sospechabas. La porción de riesgo alto es donde ocurre la corrección. La porción de frontera sirve para calibrar umbrales, que es una tarea recurrente que nadie hace sin datos. Y la porción de novedad es el seguro contra el punto ciego: existe para atrapar el tipo de caso que todavía no tiene señal asociada porque nunca apareció antes.',
        },
        {
          type: 'paragraph',
          value:
            'Vale ser explícito sobre la consecuencia estadística de mezclar: si revisás solo lo que el sistema marcó como riesgoso y reportás la tasa de error de esa fila como tasa de error del producto, el número va a ser terrible y no va a significar nada. Lo contrario también pasa: equipos que revisan solo muestra aleatoria concluyen que la calidad está óptima mientras una falla concentrada en un tipo raro de pedido quema clientes en silencio todos los meses.',
        },
      ],
    },
    {
      title: 'Las señales que realmente predicen error',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Elegir qué revisar es un problema de ordenamiento, y ordenar exige señal. El error común es usar un único indicador, casi siempre la confianza autodeclarada del modelo, que es el peor de todos por separado: los modelos son confiados cuando se equivocan y la correlación entre confianza expresada y corrección es demasiado débil para sostener una fila. Lo que funciona es combinar señales baratas de orígenes distintos, porque fallan de formas distintas y la combinación cubre más que la suma de las partes.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Qué captura', 'Limitación que exige combinación'],
          rows: [
            [
              'Puntaje de recuperación bajo en el RAG',
              'La respuesta se generó con contexto débil o ausente',
              'Una pregunta simple puede no necesitar contexto alguno',
            ],
            [
              'Divergencia entre dos generaciones de la misma pregunta',
              'Inestabilidad: el modelo no tiene una respuesta firme',
              'Cuesta una llamada extra, así que solo conviene en muestra',
            ],
            [
              'Conversación que pasó a traspaso humano',
              'Señal fuerte y gratuita de que la automatización no resolvió',
              'Llega tarde: el cliente ya sintió el problema',
            ],
            [
              'El cliente reformuló la misma pregunta enseguida',
              'La respuesta anterior no sirvió, aun sin reclamo',
              'También captura al cliente que solo cambió de tema',
            ],
            [
              'Se llamó una herramienta con efecto colateral',
              'Un error acá es caro e irreversible, no solo incómodo',
              'Alto volumen: hay que cruzarlo con el valor de la operación',
            ],
            [
              'Respuesta muy corta o muy larga para el tipo de pregunta',
              'Rechazo disfrazado o divagación sin contenido',
              'El umbral depende de la vertical y envejece con el prompt',
            ],
            [
              'Asunto raro según el historial de intenciones',
              'Cola larga, donde el eval casi nunca tiene cobertura',
              'Raro no es sinónimo de incorrecto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Fijate que tres de esas señales son gratuitas, porque ya existen en los datos que el sistema produce: traspaso, reformulación y llamada de herramienta. Empezar por ellas es la decisión correcta cuando no hay presupuesto para instrumentar nada nuevo, y solas ya rinden una fila mucho mejor que la aleatoria. La divergencia entre generaciones es la señal más fuerte de la lista y la única que cuesta dinero, así que entra después, aplicada solo al subconjunto que ya pasó por los otros filtros.',
        },
        {
          type: 'code',
          value: `// Puntuacion de prioridad de la fila. Senales sumadas con peso, todas
// normalizadas entre cero y uno, para que el peso signifique algo.

const PESOS = {
  recuperacionDebil: 0.25,
  traspaso: 0.30,
  reformulacion: 0.15,
  herramientaConEfecto: 0.20,
  tamanoAnomalo: 0.10,
};

// El valor de negocio multiplica en vez de sumar: un error en una
// conversacion de ticket alto importa mas que el mismo error en una consulta trivial.
const factorValor = (valorConversacion, valorMediano) =>
  Math.min(3, Math.max(0.5, valorConversacion / Math.max(1, valorMediano)));

export const puntuarParaRevision = (respuesta, contexto) => {
  const senales = {
    // El puntaje de recuperacion se vuelve riesgo invertido: cuanto peor
    // el contexto recuperado, mayor la chance de que la respuesta sea inventada.
    recuperacionDebil: respuesta.usoRag
      ? Math.max(0, 1 - respuesta.puntajeRecuperacionTope)
      : 0,
    traspaso: respuesta.huboTraspaso ? 1 : 0,
    reformulacion: respuesta.clienteReformuloEnseguida ? 1 : 0,
    herramientaConEfecto: respuesta.herramientasLlamadas.some((h) => h.tieneEfectoColateral) ? 1 : 0,
    tamanoAnomalo: contexto.desvioDeTamano(respuesta) > 2 ? 1 : 0,
  };

  const base = Object.entries(PESOS).reduce(
    (suma, [clave, peso]) => suma + peso * senales[clave],
    0,
  );

  return {
    prioridad: base * factorValor(respuesta.valorConversacion, contexto.valorMediano),
    // Guardar las senales junto al puntaje es lo que permite al revisor
    // saber por que ese item llego a su fila.
    senales,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Dos elecciones de ese código son deliberadas. La primera es que el valor de la conversación entre como multiplicador y no como una parcela más: un error en una negociación de ticket alto merece atención desproporcionada, y sumar un peso más no produce ese comportamiento. La segunda es devolver las señales junto con el puntaje. Un ítem que llega a la fila sin explicación hace que el revisor gaste dos minutos entendiendo por qué está mirando eso, y dos minutos por trescientos ítems es el turno entero de una persona.',
        },
      ],
    },
    {
      title: 'La fila tiene que caber en el turno de quien revisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Acá está el error operativo que mata más iniciativas de revisión que cualquier problema técnico: la fila se dimensiona por la cantidad de ítems sospechosos y no por la capacidad humana disponible. Un lunes con incidente, el sistema marca ocho mil respuestas como riesgosas, la fila explota, el revisor abre, ve el tamaño y cierra. A partir de ahí la fila está muerta, y la próxima conversación sobre revisión humana va a empezar de cero en seis meses.',
        },
        {
          type: 'paragraph',
          value:
            'La fila tiene que ser un presupuesto, no un filtro. Si la capacidad es de sesenta ítems por día, la fila del día tiene exactamente sesenta ítems, elegidos como los mejores sesenta según el puntaje y las cuotas de cada porción. Lo que no entró no queda pendiente: se descarta de la fila y sigue existiendo en los datos agregados, donde se cuenta sin ser leído individualmente. Esa distinción entre "revisado" y "contabilizado" es lo que impide que la fila se convierta en deuda.',
        },
        {
          type: 'ordered',
          items: [
            'Medí el tiempo real de revisión por ítem, cronometrado y no estimado, incluyendo el tiempo de leer el contexto de la conversación y no solo la respuesta final.',
            'Definí la capacidad diaria como número de ítems, derivada de ese tiempo y de las horas que el equipo realmente tiene, con margen para los ítems difíciles que llevan el triple.',
            'Armá la fila del día por cuota: cada porción recibe un número fijo de lugares y compite internamente por puntaje, para que la porción de riesgo alto nunca se coma la de muestra aleatoria.',
            'Descartá el excedente explícitamente en vez de acumularlo, y registrá cuántos ítems quedaron afuera para que el dato de cobertura sea honesto.',
            'Reservá una franja de la capacidad para ítems provenientes de un incidente abierto, porque durante un incidente la prioridad cambia y la fila normal queda irrelevante.',
          ],
        },
        {
          type: 'code',
          value: `// Armado de la fila diaria por cuota. La capacidad es el limite superior,
// y el excedente se descarta a proposito para que la fila nunca sea un deposito.

const CUOTAS = {
  aleatoria: 0.2,
  riesgoAlto: 0.5,
  frontera: 0.2,
  novedad: 0.1,
};

const tomarMejores = (items, n) =>
  [...items].sort((a, b) => b.prioridad - a.prioridad).slice(0, n);

export const armarFilaDelDia = (candidatos, capacidad, aleatorioSeguro) => {
  const lugares = Object.fromEntries(
    Object.entries(CUOTAS).map(([porcion, fraccion]) => [porcion, Math.floor(capacidad * fraccion)]),
  );

  const porPorcion = {
    // Muestra aleatoria de verdad: sin ordenar por puntaje, o el numero
    // que produce deja de ser generalizable.
    aleatoria: aleatorioSeguro(candidatos, lugares.aleatoria),
    riesgoAlto: tomarMejores(
      candidatos.filter((c) => c.prioridad >= 0.6),
      lugares.riesgoAlto,
    ),
    // Frontera: items cerca del umbral de escalado, donde la decision de
    // automatizar o traspasar es mas dificil y mas calibrable.
    frontera: tomarMejores(
      candidatos.filter((c) => Math.abs(c.prioridad - 0.5) < 0.08),
      lugares.frontera,
    ),
    novedad: tomarMejores(
      candidatos.filter((c) => c.intencionRara || c.sinCoberturaEnEval),
      lugares.novedad,
    ),
  };

  const vistos = new Set();
  const fila = [];
  for (const [porcion, items] of Object.entries(porPorcion)) {
    for (const item of items) {
      if (vistos.has(item.id)) continue; // un item pertenece a una sola porcion
      vistos.add(item.id);
      fila.push({ ...item, porcion });
    }
  }

  return {
    fila,
    // Los descartados no se vuelven pendientes: alimentan la metrica de
    // cobertura y salen de la fila, que tiene que caber en el turno de hoy.
    descartados: candidatos.length - fila.length,
    cobertura: candidatos.length === 0 ? 1 : fila.length / candidatos.length,
  };
};`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle del conjunto de ítems ya vistos importa más de lo que parece. Sin él, un ítem de riesgo alto que además es raro aparece dos veces en la fila, el revisor lee el mismo caso dos veces y concluye, con razón, que la herramienta es descuidada. Una fila de revisión pierde la confianza del equipo por ese tipo de detalle mucho antes de perderla por una mala elección de señal.',
        },
      ],
    },
    {
      title: 'Lo que devuelve el revisor tiene que ser reaprovechable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La revisión humana solo se paga si el resultado alimenta algo. El patrón que no se paga es que el revisor escriba un comentario libre en un campo de texto y marque el ítem como visto: eso produce conocimiento que vive en la cabeza de quien revisó y en un campo que nadie consulta. El patrón que se paga transforma cada revisión en un registro estructurado que sirve como caso de evaluación, evidencia para ajustar el prompt o entrada en un informe de calidad.',
        },
        {
          type: 'list',
          items: [
            'Veredicto en categoría cerrada, no en texto libre: correcto, incorrecto por información equivocada, incorrecto por información faltante, correcto pero en tono inadecuado, rechazo indebido, acción indebida por herramienta.',
            'La respuesta que debería haberse dado, escrita por el revisor cuando el veredicto es negativo, porque eso transforma el caso en ítem del conjunto de evaluación sin trabajo adicional después.',
            'La causa probable señalada entre opciones conocidas: contexto no recuperado, contexto recuperado pero ignorado, instrucción ambigua en el prompt, la herramienta devolvió un dato equivocado, la política cambió y el prompt no.',
            'Referencia estable a la conversación y a la versión del prompt y del modelo vigentes en ese momento, sin la cual el análisis agregado por versión es imposible.',
            'Tiempo dedicado a la revisión, que es el dato que permite recalibrar la capacidad diaria cuando cambia el perfil de los casos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El segundo punto es el de mayor retorno y el más descuidado. Pedirle al revisor que escriba la respuesta correcta parece aumentar el costo de la revisión, y lo aumenta, en tal vez un minuto por caso negativo. A cambio, cada caso negativo revisado se convierte automáticamente en un ítem del conjunto de evaluación con entrada y salida esperada, que es justamente el insumo más caro de producir de cualquier otra forma. Sin eso, alguien va a tener que reconstruir esos casos después, con menos contexto y más esfuerzo.',
        },
        {
          type: 'code',
          value: `// Registro estructurado de la revision. El formato es lo que permite
// reaprovechar el trabajo humano como caso de eval sin una segunda pasada.

export const registrarRevision = async (repo, { item, revisor, veredicto }) => {
  const registro = {
    conversacionId: item.conversacionId,
    respuestaId: item.id,
    porcionDeLaFila: item.porcion,
    senales: item.senales,
    // Versiones vigentes: sin ellas no se puede decir si la regresion vino
    // del prompt nuevo, del modelo nuevo o de la base de conocimiento nueva.
    promptVersion: item.promptVersion,
    modelo: item.modelo,
    veredicto: veredicto.categoria,
    respuestaEsperada: veredicto.respuestaEsperada ?? null,
    causaProbable: veredicto.causaProbable ?? null,
    revisor,
    duracionSegundos: veredicto.duracionSegundos,
  };

  await repo.guardarRevision(registro);

  // Un caso negativo con respuesta esperada completada nace como item
  // candidato del conjunto de evaluacion, marcado para curaduria.
  const negativo = veredicto.categoria !== 'correcto';
  if (negativo && veredicto.respuestaEsperada) {
    await repo.proponerCasoDeEval({
      entrada: item.preguntaCliente,
      contexto: item.contextoRecuperado,
      salidaEsperada: veredicto.respuestaEsperada,
      origen: 'revision-humana',
      revisionId: registro.respuestaId,
      // Nunca entra directo al eval: un caso mal escrito envenena la regla
      // durante meses, asi que pasa por curaduria antes de valer nota.
      estado: 'esperando-curaduria',
    });
  }

  return registro;
};`,
        },
        {
          type: 'paragraph',
          value:
            'El estado de espera por curaduría no es burocracia. Un caso de evaluación escrito a las apuradas por un revisor cansado, con una respuesta esperada que refleja su opinión y no la política de la empresa, va a valer nota durante meses y empujar al sistema en la dirección equivocada. La revisión humana propone, la curaduría decide, y ese par de etapas cuesta poco al lado del daño que provoca un conjunto de evaluación contaminado.',
        },
      ],
    },
    {
      title: 'Medir si la fila está funcionando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una fila de revisión puede consumir dos personas a tiempo completo y no producir nada, y el equipo solo se entera cuando alguien pregunta qué cambió por causa de ella. Las métricas de una fila no son sobre cantidad revisada, que es apenas una medida de esfuerzo. Son sobre densidad de hallazgo y sobre efecto, y las dos tienen que aparecer en el mismo panel.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Cómo leerla', 'Acción cuando está mal'],
          rows: [
            [
              'Densidad de error en la porción de riesgo alto',
              'Proporción de veredictos negativos entre los ítems priorizados',
              'Si está cerca de la tasa general, las señales no predicen nada: revisá los pesos',
            ],
            [
              'Elevación sobre la aleatoria',
              'Densidad de la porción de riesgo dividida por la densidad de la aleatoria',
              'Por debajo de dos veces, la priorización no se justifica frente al costo',
            ],
            [
              'Cobertura declarada',
              'Ítems revisados sobre ítems candidatos, siempre visible',
              'Si nadie sabe que es el dos por ciento, alguien lo va a tratar como auditoría total',
            ],
            [
              'Casos de eval originados en la fila',
              'Cuántos ítems negativos se volvieron caso curado por semana',
              'Cero significa que la revisión está produciendo solo lectura',
            ],
            [
              'Tiempo entre revisión y corrección',
              'Del veredicto negativo hasta el ajuste de prompt, base o herramienta',
              'Si pasa de semanas, la fila se vuelve registro histórico y desmotiva al revisor',
            ],
            [
              'Concordancia entre revisores',
              'Proporción de acuerdo en un lote pequeño revisado por duplicado',
              'Baja concordancia indica criterio ambiguo, no revisor malo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La elevación sobre la aleatoria es la métrica que justifica toda la maquinaria, y merece cuidado en la lectura. Si la porción de riesgo alto tiene densidad de error del treinta por ciento y la aleatoria tiene cinco, la elevación es seis: cada hora del revisor rinde seis veces más hallazgos de los que rendiría sin priorización. Si la elevación es cercana a uno, toda la puntuación, los pesos y el código de fila se están ejecutando para producir el mismo resultado que un sorteo, y la respuesta honesta es simplificar en vez de agregar una señal más.',
        },
        {
          type: 'paragraph',
          value:
            'La concordancia entre revisores es la métrica que casi nadie recolecta y que explica buena parte de las discusiones improductivas sobre calidad. Poner diez ítems por semana en la fila de dos personas al mismo tiempo cuesta diez ítems de capacidad y revela si el criterio es compartido. Cuando la concordancia es baja, el problema no está en el agente ni en el revisor: está en una definición de "respuesta correcta" que nadie escribió, y ninguna métrica de calidad construida sobre ese piso significa nada.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no revisar por muestreo aleatorio, que es el método estadísticamente correcto?',
      answer:
        'Porque el muestreo aleatorio responde una pregunta distinta de la que tenés. Es la única forma honesta de estimar la tasa de error global del sistema, y por eso tiene que existir siempre, ocupando una porción pequeña del presupuesto de revisión. Pero es pésimo para encontrar errores: si la operación acierta el noventa y cinco por ciento de las veces, el revisor pasa el noventa y cinco por ciento del turno confirmando que respuestas correctas están correctas. Priorizar por señal concentra la atención donde vive el error y suele rendir varias veces más hallazgos por hora de revisión. La solución no es elegir una de las dos, es dividir el presupuesto explícitamente en porciones con propósitos distintos, y nunca reportar la tasa de error de la porción priorizada como si fuera la del producto.',
    },
    {
      question: '¿Qué señales usar cuando todavía no hay ninguna instrumentación específica?',
      answer:
        'Empezá por las tres que ya existen en tus datos y no cuestan nada recolectar: conversaciones que terminaron en traspaso a un agente humano, clientes que reformularon la misma pregunta justo después de la respuesta, y respuestas en las que el agente llamó alguna herramienta con efecto colateral, como emitir un duplicado, modificar un registro o registrar un pedido. Esas tres solas ya producen una fila mucho mejor que la aleatoria. Después de ellas, el próximo paso más barato es el puntaje de recuperación del RAG, que ya tenés si usás búsqueda vectorial. La señal más fuerte, que es la divergencia entre dos generaciones de la misma pregunta, cuesta una llamada extra al modelo y por eso debe aplicarse solo al subconjunto que ya pasó los filtros anteriores, nunca al tráfico entero.',
    },
    {
      question: 'La fila crece más rápido de lo que el equipo revisa. ¿Qué hago con la acumulación?',
      answer:
        'Descartarla, explícitamente y todos los días. Una fila de revisión tiene que ser un presupuesto de atención, no un filtro de todo lo que parece sospechoso: si la capacidad es de sesenta ítems por día, la fila del día tiene sesenta ítems y el resto sale. Lo que no se revisó individualmente sigue existiendo en los datos agregados y en las métricas, así que no se pierde información, solo lectura humana. La acumulación es peor que el descarte por dos motivos: un revisor que abre una fila con ocho mil ítems cierra la herramienta y no vuelve, y una fila con pendientes viejos hace que el equipo revise un caso de hace tres semanas en vez del de ayer, que es el que todavía se puede corregir. Registrá cuántos ítems quedaron afuera y mostrá la cobertura real en el panel, para que nadie confunda la fila con una auditoría completa.',
    },
  ],
  conclusion: {
    title: 'La atención humana es presupuesto, no filtro',
    description:
      'El error que inutiliza la mayoría de las filas de revisión no es técnico, es de encuadre: se construyen como un filtro que separa lo sospechoso de lo normal, cuando deberían construirse como un presupuesto fijo de atención humana que los candidatos se disputan. A partir de ese encuadre todo se simplifica: la capacidad define el tamaño de la fila, las cuotas garantizan que la porción aleatoria sobreviva a la presión de la porción de riesgo, el excedente se descarta sin volverse deuda, y cada revisión negativa devuelve una respuesta esperada que nace como candidata a caso de evaluación. Y la pregunta que decide si toda la maquinaria se justifica es una sola: cuántas veces más defectos por hora encuentra esa fila en comparación con un sorteo. Si la respuesta es cercana a una vez, simplificá, porque la complejidad no está pagando nada.',
    cta: '¿Querés transformar las horas de revisión de tu equipo en corrección y no en lectura? Puedo diseñar la puntuación de prioridad con las señales que ya tenés, dimensionar la fila por la capacidad real y cerrar el ciclo entre revisión humana y conjunto de evaluación.',
  },
  related: [
    {
      label: 'Congelar el conjunto de evaluación: por qué tu eval envejece y cómo renovarlo',
      to: '/blog/congelar-conjunto-avaliacao-eval-envelhece-como-renovar',
    },
    {
      label: 'Detectar deriva de calidad antes de que el cliente reclame',
      to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar',
    },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
};

export default {
  pt,
  en,
  es,
};
