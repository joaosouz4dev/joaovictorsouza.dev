// Conteudo do artigo: teste de carga que mente, quando o ensaio aprova o
// mesmo volume que derruba a producao horas depois.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O relatório do ensaio dizia mil requisições por segundo com latência mediana de quarenta e dois milissegundos e nenhum erro, e o time aprovou a campanha com folga confortável. Três dias depois, com novecentas requisições por segundo medidas no mesmo painel, o serviço começou a devolver erro aos onze minutos de tráfego e não se recuperou sozinho. Ninguém tinha mentido no relatório: o ensaio realmente passou naquele volume. O problema é que volume é a variável menos importante de um teste de carga, e é a única que a maioria dos ensaios controla. Este artigo mostra por que o gerador de carga de laço fechado mede algo diferente do que produção entrega e por que ele esconde exatamente a falha que você quer encontrar, por que a média e a mediana são cegas para o modo de falha que importa e qual estatística substitui as duas, quais seis diferenças entre ensaio e produção transformam o mesmo número em resultados opostos, por que a duração do teste é um parâmetro de descoberta e não de conforto, como construir um gerador de laço aberto com correção de omissão coordenada em poucas linhas, qual é o critério de aprovação que substitui o limiar de latência que todo mundo usa, e como encontrar o ponto de saturação em vez de apenas confirmar um número que alguém escolheu antes.',
  sections: [
    {
      title: 'O gerador de laço fechado responde a uma pergunta que ninguém fez',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quase toda ferramenta de teste de carga em uso hoje funciona no mesmo modelo: um número fixo de trabalhadores virtuais, cada um em um laço que envia uma requisição, espera a resposta chegar, opcionalmente pausa por um tempo de reflexão e envia a próxima. Cinquenta trabalhadores com uma resposta de cinquenta milissegundos produzem mil requisições por segundo. É simples de implementar, simples de explicar e é o que a maioria dos relatórios chama de carga.',
        },
        {
          type: 'paragraph',
          value:
            'O problema aparece quando o serviço fica lento. Se a resposta passa de cinquenta para quinhentos milissegundos, cada trabalhador passa a enviar dez vezes menos requisições, e a carga aplicada cai de mil para cem requisições por segundo sozinha, sem que ninguém peça. O gerador reduziu a pressão exatamente no instante em que o serviço estava em dificuldade. O resultado é um ensaio que nunca consegue empurrar um sistema degradado para o colapso, porque ele é, por construção, gentil com sistemas lentos.',
        },
        {
          type: 'paragraph',
          value:
            'Produção não faz isso. O usuário que abre o aplicativo não espera o anterior terminar para clicar, e o parceiro que dispara webhook não reduz a frequência porque a sua resposta demorou. A chegada é independente do serviço, e é esse desacoplamento que produz filas, e são filas que produzem timeouts, esgotamento de pool e a espiral de retry que derruba o serviço. O laço fechado mede capacidade sob autocontrole; produção aplica carga sob indiferença. São duas perguntas diferentes, e o relatório responde à errada.',
        },
        {
          type: 'diagram',
          value: `LACO FECHADO x LACO ABERTO SOB DEGRADACAO

  servico saudavel (50ms)         servico degradado (500ms)

  FECHADO  50 trabalhadores       FECHADO  50 trabalhadores
           1.000 req/s aplicadas           100 req/s aplicadas
           fila = 0                        fila = 0
           "passou"                        "passou, so mais lento"

  ABERTO   1.000 req/s agendadas  ABERTO   1.000 req/s agendadas
           1.000 req/s aplicadas           1.000 req/s aplicadas
           fila = 0                        fila cresce 900/s
                                           timeout, pool cheio, colapso

  O laco fechado converte degradacao em menos carga.
  O laco aberto converte degradacao em fila, que e o que
  produção faz. So o segundo encontra o ponto de ruptura.`,
        },
        {
          type: 'paragraph',
          value:
            'Há um caso em que o laço fechado é o modelo correto, e vale reconhecê-lo para não trocar um erro por outro: quando a população de clientes é fechada e cada cliente realmente espera. Um sistema interno com duzentos operadores de call center, cada um trabalhando em uma tela por vez, é um sistema de laço fechado de verdade, e modelá-lo como laço aberto superestima a carga de pico. A regra prática é perguntar se um cliente lento reduz a chegada de novos pedidos. Se reduz, laço fechado. Se não reduz, e quase nunca reduz em serviços expostos a internet, o modelo correto é o aberto.',
        },
      ],
    },
    {
      title: 'Omissão coordenada: o número que some do relatório é justamente o ruim',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A consequência estatística do laço fechado tem nome, e o nome é omissão coordenada. Suponha um ensaio de mil requisições por segundo durante cem segundos, com noventa e nove segundos de respostas em um milissegundo e uma pausa de um segundo em que o serviço não respondeu nada. No laço fechado, durante essa pausa os trabalhadores ficaram parados, e portanto quase nenhuma requisição foi registrada nela. O relatório sai com noventa e nove mil medições de um milissegundo e algumas dezenas de um segundo, e o percentil noventa e nove fica em torno de um milissegundo.',
        },
        {
          type: 'paragraph',
          value:
            'A realidade de um sistema de laço aberto é outra. Durante aquela pausa de um segundo, mil requisições deveriam ter sido enviadas e todas elas teriam sofrido espera. A primeira esperaria um segundo inteiro, a segunda novecentos e noventa e nove milissegundos, e assim por diante. Essas mil medições não aparecem no relatório porque o gerador nunca as emitiu: ele coordenou o próprio silêncio com o silêncio do serviço. O percentil noventa e nove verdadeiro é de centenas de milissegundos, e o relatório anuncia um.',
        },
        {
          type: 'paragraph',
          value:
            'A correção não exige trocar de ferramenta, exige mudar o que se mede. Em vez de cronometrar o tempo entre o envio efetivo e a resposta, cronometra-se o tempo entre o instante em que a requisição deveria ter sido enviada, segundo o cronograma definido no início do ensaio, e a resposta. A diferença entre os dois é a espera na fila do próprio gerador, que é exatamente a espera que o usuário real sofre quando o sistema não acompanha.',
        },
        {
          type: 'table',
          columns: ['Cenário do ensaio', 'Latência reportada pelo laço fechado', 'Latência real em laço aberto', 'O que a diferença esconde'],
          rows: [
            [
              'Pausa de coleta de lixo de 800ms a cada 30s',
              'Percentil 99 em 12ms',
              'Percentil 99 em 640ms',
              'Toda a cauda que define a experiência do usuário',
            ],
            [
              'Reeleição de líder do banco por 4s',
              'Mediana e percentil 99 quase inalterados',
              'Percentil 95 acima do timeout do cliente',
              'A avalanche de retry que vem logo depois',
            ],
            [
              'Serviço a montante degrada de 40ms para 900ms',
              'Carga aplicada cai sozinha para 1/20',
              'Fila cresce e o pool esgota em 2 minutos',
              'O modo de falha inteiro, que nunca é atingido',
            ],
            [
              'Reinício de uma réplica de três',
              'Pequeno aumento de latência média',
              'Um terço das requisições sem destino por 15s',
              'A ausência de nova tentativa no cliente',
            ],
            [
              'Limite de taxa do provedor externo em 300 req/s',
              'Taxa aplicada se acomoda em 300 req/s',
              'Fila interna cresce de forma ilimitada',
              'Que o ensaio nunca testou o comportamento acima do teto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda linha da tabela merece atenção porque descreve o incidente mais comum de todos. Uma reeleição de líder de quatro segundos é um evento normal e esperado, que acontece em todo failover planejado. No ensaio de laço fechado ela é absorvida silenciosamente e nem entra no relatório. Em produção ela produz quatro segundos de requisições acumuladas que estouram o timeout do cliente, e o cliente reenvia todas elas de uma vez no quinto segundo, dobrando a carga exatamente no instante em que o novo líder está frio. O ensaio aprovou o volume e nunca chegou perto de testar o evento.',
        },
      ],
    },
    {
      title: 'As seis diferenças que fazem o mesmo número dar resultados opostos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o ensaio aprova mil requisições por segundo e produção cai em novecentas, a tentação é concluir que o gerador estava errado sobre o número. Em geral não estava: o número é o mesmo, e o que difere é o que acompanha o número. Seis diferenças respondem pela maior parte dos casos, e todas elas são verificáveis antes do próximo ensaio.',
        },
        {
          type: 'ordered',
          items: [
            'Distribuição de chegada. O gerador emite uma requisição a cada milissegundo com régua; produção chega em processo de Poisson, onde intervalos curtos se agrupam. Com a mesma média de mil por segundo, o pico instantâneo de um segundo qualquer em Poisson passa de mil e cem com frequência, e é o pico que satura a fila, não a média.',
            'Cardinalidade dos dados. O ensaio repete cem identificadores de cliente e aquece o cache a ponto de a taxa de acerto chegar a noventa e nove por cento. Produção tem duzentos mil clientes distintos e a taxa de acerto real é de sessenta por cento, o que multiplica por quatro as consultas que chegam ao banco com o mesmo número de requisições na borda.',
            'Distribuição do trabalho por requisição. O ensaio usa o mesmo corpo de requisição sempre, quase sempre o caso pequeno. Produção tem uma cauda de requisições que custam trinta vezes mais, e é essa cauda que ocupa os trabalhadores e forma a fila para todo o resto.',
            'Estado acumulado. O ensaio roda em base recém-restaurada, com índices compactos, estatísticas recentes e nenhuma linha morta. Produção tem seis meses de crescimento, e o mesmo plano de consulta escolhido no ensaio pode nem ser o plano escolhido lá.',
            'Concorrência com o resto do mundo. Durante o ensaio o serviço tem o banco só para si. Em produção ele divide com o processo de relatório noturno, com a replicação, com o trabalho em lote das oito da manhã e com o backup, e a capacidade disponível é o que sobra, não o total.',
            'Ausência dos vizinhos degradados. O ensaio usa dependências saudáveis e locais. Produção tem um provedor externo que oscila, um serviço interno que reinicia, uma resolução de nome que ocasionalmente demora, e cada um deles transforma capacidade em fila.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Das seis, a primeira é a que se corrige com menos esforço e tem o maior retorno imediato, porque é uma mudança de três linhas no gerador. Emitir com intervalo constante é um erro silencioso: ele reduz a variância da chegada a zero e, com isso, remove o principal mecanismo de formação de fila. Trocar o intervalo constante por um intervalo exponencial, que é o que gera um processo de Poisson, mantém a mesma taxa média e devolve ao ensaio o agrupamento que produção tem.',
        },
        {
          type: 'code',
          value: `// Gerador de laco aberto com chegada de Poisson e correcao de
// omissao coordenada. O ponto central e o campo previsto: a medicao
// comeca no instante agendado, nao no instante do envio.

/**
 * @param {object} opcoes
 * @param {string} opcoes.url        endpoint sob teste
 * @param {number} opcoes.taxaPorSeg taxa media de chegada desejada
 * @param {number} opcoes.duracaoSeg duracao total do ensaio
 * @param {number} opcoes.timeoutMs  timeout por requisicao
 */
export async function ensaioLacoAberto({ url, taxaPorSeg, duracaoSeg, timeoutMs = 2000 }) {
  const medicoes = [];
  const emVoo = new Set();
  const inicio = performance.now();
  const fim = inicio + duracaoSeg * 1000;

  // Intervalo exponencial: reproduz chegada de Poisson, onde a media e
  // 1/taxa mas os intervalos se agrupam. Intervalo constante remove a
  // variancia da chegada e, com ela, a formacao de fila que se quer medir.
  const proximoIntervaloMs = () => (-Math.log(1 - Math.random()) / taxaPorSeg) * 1000;

  let previsto = inicio;

  while (previsto < fim) {
    previsto += proximoIntervaloMs();
    const agendadoPara = previsto;

    const esperaMs = agendadoPara - performance.now();
    // Espera apenas quando o gerador esta adiantado. Quando esta atrasado
    // o valor e negativo e a requisicao sai imediatamente, ja devendo
    // tempo: esse debito e a omissao coordenada tornada visivel.
    if (esperaMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, esperaMs));
    }

    const promessa = medirUma({ url, agendadoPara, timeoutMs })
      .then((medicao) => medicoes.push(medicao))
      .finally(() => emVoo.delete(promessa));

    emVoo.add(promessa);
  }

  await Promise.all(emVoo);
  return resumir(medicoes, duracaoSeg);
}

async function medirUma({ url, agendadoPara, timeoutMs }) {
  const enviadoEm = performance.now();
  const controlador = new AbortController();
  const alarme = setTimeout(() => controlador.abort(), timeoutMs);

  try {
    const resposta = await fetch(url, { signal: controlador.signal });
    const concluidoEm = performance.now();
    return {
      // Servico: o que o painel do servidor enxerga.
      servicoMs: concluidoEm - enviadoEm,
      // Resposta: o que o usuario sente, incluindo a espera na fila do
      // proprio gerador. A diferenca entre os dois e a omissao coordenada.
      respostaMs: concluidoEm - agendadoPara,
      status: resposta.status,
      ok: resposta.ok,
    };
  } catch {
    const concluidoEm = performance.now();
    return {
      servicoMs: concluidoEm - enviadoEm,
      respostaMs: concluidoEm - agendadoPara,
      status: 0,
      ok: false,
    };
  } finally {
    clearTimeout(alarme);
  }
}

function percentil(valores, p) {
  if (!valores.length) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1);
  return ordenado[indice];
}

function resumir(medicoes, duracaoSeg) {
  const servico = medicoes.map((m) => m.servicoMs);
  const resposta = medicoes.map((m) => m.respostaMs);
  const erros = medicoes.filter((m) => !m.ok).length;

  return {
    amostras: medicoes.length,
    taxaEfetiva: medicoes.length / duracaoSeg,
    taxaErro: erros / Math.max(1, medicoes.length),
    servicoP99: percentil(servico, 99),
    respostaP99: percentil(resposta, 99),
    // A razao abaixo e o indicador mais importante do relatorio inteiro.
    // Perto de 1 o gerador acompanhou o cronograma. Acima de 2 existe
    // fila no gerador, e qualquer numero de latencia do servidor esta
    // subestimando o que o usuario sofre por esse mesmo fator.
    fatorDeOmissao: percentil(resposta, 99) / Math.max(1, percentil(servico, 99)),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O campo mais valioso do resumo é o último. A razão entre o percentil noventa e nove da resposta e o percentil noventa e nove do serviço responde, em um único número, se o ensaio pode ser levado a sério. Um valor próximo de um significa que o gerador conseguiu manter o cronograma e que o número de latência do servidor é confiável. Um valor de cinco significa que o gerador acumulou fila, que o servidor já estava saturado durante boa parte do ensaio, e que o percentil bonito do painel do servidor está subestimando a experiência real por um fator de cinco.',
        },
      ],
    },
    {
      title: 'Duração e formato: o ensaio de cinco minutos aprova o que falha em quarenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma classe inteira de falhas que é invisível por construção em ensaios curtos, porque o tempo até a manifestação é maior do que a duração do teste. Elas não são exóticas nem raras: são as mais comuns em incidentes de produção, e todas têm em comum o consumo progressivo de um recurso finito que o ensaio curto mal chega a arranhar.',
        },
        {
          type: 'table',
          columns: ['Falha', 'Tempo típico até manifestar', 'Por que o ensaio curto não vê', 'Como provocá-la no ensaio'],
          rows: [
            [
              'Vazamento de conexão em caminho de erro',
              '30 a 90 minutos',
              'O caminho de erro quase não é exercitado em ensaio feliz',
              'Injetar de 2 a 5 por cento de falha nas dependências durante 60 minutos',
            ],
            [
              'Esgotamento de porta efêmera de saída',
              '20 a 60 minutos',
              'O estoque de portas é grande e o consumo é linear',
              'Manter taxa acima da sustentável por pelo menos 45 minutos',
            ],
            [
              'Fragmentação de memória e pausas crescentes',
              '2 a 6 horas',
              'A memória estabiliza antes do primeiro ciclo completo',
              'Ensaio de resistência com carga moderada e perfil de objeto realista',
            ],
            [
              'Inchaço de índice e mudança de plano de consulta',
              'Dias em produção',
              'A base do ensaio é recém-restaurada e compacta',
              'Restaurar cópia de produção em vez de gerar dados sintéticos',
            ],
            [
              'Acúmulo em fila com consumidor levemente mais lento',
              '15 a 120 minutos',
              'Um déficit de 3 por cento leva horas para virar atraso visível',
              'Comparar taxa de produção e de consumo, não o tamanho da fila',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira coluna revela o padrão comum: o ensaio curto não é pequeno demais para a carga, é curto demais para o mecanismo. Um vazamento de dez conexões por minuto precisa de uma hora para consumir um pool de seiscentas, e o ensaio de cinco minutos observa sessenta conexões vazadas, que é indistinguível de operação normal em qualquer painel. Aumentar a carga não ajuda: é preciso aumentar o tempo, ou provocar diretamente o caminho que vaza.',
        },
        {
          type: 'paragraph',
          value:
            'Isso leva a uma divisão de formatos que vale adotar explicitamente, porque cada um encontra uma classe diferente de defeito e nenhum substitui os outros. O ensaio de degrau sobe a carga em patamares até encontrar o ponto de saturação, e responde qual é a capacidade. O ensaio de rajada aplica um salto instantâneo de três a cinco vezes durante trinta segundos, e responde se o sistema absorve pico sem espiral de retry. O ensaio de resistência mantém setenta por cento da capacidade por horas, e responde se existe vazamento. O ensaio de caos aplica carga normal enquanto derruba dependências, e responde se o modo degradado funciona. Aprovar um lançamento com apenas o primeiro é aprovar apenas contra uma das quatro classes de falha.',
        },
        {
          type: 'diagram',
          value: `QUATRO FORMATOS, QUATRO PERGUNTAS DIFERENTES

  DEGRAU        carga
                 |      ___----- ponto de saturacao
                 |  __--
                 |--          pergunta: qual e a capacidade?
                 +---------------- tempo (20 a 40 min)

  RAJADA        carga
                 |    ____
                 |    |  |      pergunta: absorve pico sem
                 |____|  |____  espiral de retry?
                 +---------------- tempo (5 min, salto de 30s)

  RESISTENCIA   carga
                 |________________
                 |                pergunta: vaza algum recurso?
                 +---------------- tempo (2 a 8 horas, 70% da cap.)

  CAOS          carga + falhas injetadas
                 |____X____X______  X = dependencia derrubada
                 |                pergunta: o modo degradado existe?
                 +---------------- tempo (30 a 60 min)`,
        },
      ],
    },
    {
      title: 'O critério de aprovação precisa ser um ponto de saturação, não um limiar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O critério mais usado em teste de carga é também o menos informativo: percentil noventa e cinco abaixo de duzentos milissegundos e taxa de erro abaixo de um por cento na carga alvo. Ele tem dois defeitos estruturais. O primeiro é que ele valida um ponto e não uma curva, então ele não diz absolutamente nada sobre o que acontece com cinco por cento a mais de tráfego, que é a pergunta que interessa na véspera da campanha. O segundo é que ele confunde estar dentro do limite com ter margem, e um sistema que atende ao critério a dois por cento do ponto de ruptura passa exatamente como um que está a cinquenta.',
        },
        {
          type: 'paragraph',
          value:
            'O critério que substitui os dois é o ponto de saturação e a margem até ele. O ponto de saturação é a taxa de chegada acima da qual a vazão útil para de crescer enquanto a latência começa a subir de forma não linear. Ele não é uma escolha, é uma propriedade do sistema, e encontrá-lo é o objetivo do ensaio de degrau. A margem é a razão entre o ponto de saturação e o pico real observado em produção nos últimos noventa dias, e é esse número, e não o percentil, que deve constar do relatório de aprovação.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que ele mede', 'Faixa saudável', 'O que uma leitura ruim indica'],
          rows: [
            [
              'Ponto de saturação',
              'Taxa de chegada onde a vazão para de crescer',
              'Acima de 2 vezes o pico de produção',
              'Abaixo de 1,5 vez, um evento sazonal comum derruba o serviço',
            ],
            [
              'Fator de omissão',
              'Razão entre percentil 99 de resposta e de serviço',
              'Abaixo de 1,3',
              'Acima de 2, o número do servidor está subestimando a experiência',
            ],
            [
              'Vazão útil no colapso',
              'Vazão de sucesso a 150 por cento da saturação',
              'Acima de 70 por cento da vazão de pico',
              'Abaixo de 40 por cento, falta controle de admissão ou de fila',
            ],
            [
              'Tempo até recuperar',
              'Segundos entre o fim da rajada e o retorno ao normal',
              'Abaixo de 60 segundos',
              'Acima de 5 minutos, existe retry sem limite ou fila sem teto',
            ],
            [
              'Deriva de recurso na resistência',
              'Inclinação de memória e conexões por hora',
              'Praticamente plana',
              'Qualquer inclinação positiva sustentada é vazamento',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira linha é a que mais muda a conversa com produto, porque ela mede o que acontece depois do limite e não antes dele. Todo sistema tem um ponto de saturação, e nenhum orçamento evita que ele exista; o que diferencia um serviço resiliente de um frágil é o formato da curva depois dele. Um sistema com controle de admissão recusa o excedente rapidamente e mantém setenta por cento da vazão de pico, o que significa que sete em cada dez clientes continuam sendo atendidos. Um sistema sem controle aceita tudo, forma fila, estoura timeout em todas as requisições e entrega vazão útil próxima de zero, atendendo ninguém enquanto trabalha no limite. Os dois têm a mesma capacidade nominal e resultados opostos no dia do pico.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar também o efeito prático dessa mudança de critério no processo. Um relatório que diz percentil noventa e cinco em cento e oitenta milissegundos não permite nenhuma decisão de negócio. Um relatório que diz ponto de saturação em mil e duzentas requisições por segundo, pico de produção em quatrocentas e cinquenta, margem de dois vírgula sete vezes, e vazão útil de setenta e quatro por cento a cento e cinquenta por cento da saturação, permite decidir sobre campanha, sobre capacidade e sobre prioridade de correção sem nenhuma tradução adicional.',
        },
      ],
    },
    {
      title: 'A sequência que transforma o ensaio em evidência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reescrever o ensaio inteiro de uma vez costuma travar antes do primeiro resultado. A sequência abaixo entrega valor em cada passo e pode ser interrompida em qualquer ponto sem perder o que já foi feito, o que importa porque cada passo mostra algo novo e justifica o seguinte.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumente a omissão antes de mudar qualquer coisa. Adicione o instante agendado às medições do ensaio atual e publique a razão entre os dois percentis. Se ela passar de dois, você já sabe que todos os relatórios anteriores subestimavam a latência, e isso sozinho costuma ser suficiente para autorizar o restante do trabalho.',
            'Troque o intervalo constante pelo exponencial. São três linhas e a taxa média não muda, então a comparação com ensaios anteriores permanece válida. Espere ver o percentil noventa e nove subir sem que nada tenha piorado: o que mudou é que agora ele está sendo medido.',
            'Corrija a cardinalidade dos dados antes de qualquer ajuste de infraestrutura. Extraia a distribuição real de identificadores de um dia de log de produção e alimente o gerador com ela. Sem esse passo, toda medição de banco e de cache do ensaio é ficção, e otimizar em cima dela desperdiça semanas.',
            'Encontre o ponto de saturação com um ensaio de degrau. Suba em patamares de cinco minutos até a vazão útil parar de crescer, e registre esse número junto com o pico real de produção dos últimos noventa dias. A razão entre os dois é a sua margem, e é o primeiro número do novo relatório.',
            'Rode um ensaio de rajada a quatro vezes a média durante trinta segundos. Meça o tempo de recuperação depois do fim da rajada. Esse é o teste que revela retry sem limite e fila sem teto, e ele leva cinco minutos para rodar.',
            'Só então rode a resistência de quatro horas a setenta por cento da capacidade, com dois por cento de falha injetada nas dependências. É o ensaio mais caro em tempo de relógio e o único que encontra vazamento, e ele deve rodar de madrugada uma vez por semana, não a cada pedido de mudança.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro passo é o que mais gera resistência e o que mais muda resultado. Gerar dados sintéticos com cem clientes é rápido e dá um ensaio que roda em qualquer laptop; extrair a distribuição real de um log de produção exige uma conversa sobre acesso a dado e um cuidado de anonimização. A diferença de resultado é grande demais para ignorar: com cem clientes a taxa de acerto do cache fica em noventa e nove por cento e o banco quase não é exercitado, e é justamente o banco que quebra em produção. Uma alternativa aceitável quando o acesso ao log é inviável é reproduzir apenas o formato da distribuição, mantendo a cauda longa de identificadores raros mesmo que os valores sejam gerados.',
        },
        {
          type: 'paragraph',
          value:
            'Sobre a frequência, a divisão que funciona na prática é colocar degrau e rajada no fluxo de entrega, porque juntos levam menos de trinta minutos e pegam regressão de capacidade a cada mudança, e deixar resistência e caos em agenda semanal noturna. Tentar rodar as quatro a cada mudança faz o time desligar o teste inteiro em duas semanas, e um ensaio desligado encontra ainda menos do que um ensaio que mente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso trocar a ferramenta de teste de carga que já uso para corrigir a omissão coordenada?',
      answer:
        'Na maioria dos casos não, e vale verificar antes de propor uma migração que costuma custar semanas. Algumas ferramentas modernas já implementam a correção e expõem as duas medições com nomes diferentes, sendo uma delas o tempo desde o agendamento e outra o tempo desde o envio efetivo; nesses casos o trabalho é apenas descobrir qual métrica o seu relatório está publicando, e a resposta frequente é que o painel padrão mostra a errada porque ela é a mais bonita. Outras ferramentas suportam um modo de chegada com taxa fixa, às vezes chamado de taxa constante ou de executor de chegada, que é justamente o gerador de laço aberto; ativar esse modo costuma ser uma mudança de poucas linhas na configuração do cenário, e o principal cuidado é dimensionar o número de trabalhadores pré-alocados com folga, porque se o gerador ficar sem trabalhador disponível ele volta a coordenar com o serviço e o problema retorna com outro nome. Quando a ferramenta não oferece nenhuma das duas coisas, ainda existe uma correção aproximada que não exige troca: registrar o cronograma pretendido em paralelo e, na análise, reconstituir as medições ausentes atribuindo a cada requisição que deveria ter partido durante uma pausa a espera correspondente. É menos preciso do que medir de fato, mas é ordens de magnitude melhor do que publicar um percentil que omitiu justamente os piores casos. O critério para decidir migrar é o fator de omissão medido: abaixo de um vírgula três a ferramenta atual está acompanhando o cronograma e não há motivo para trocar nada.',
    },
    {
      question: 'Como testar carga contra dependências externas que eu não controlo e que têm limite de taxa?',
      answer:
        'A resposta depende de qual pergunta você está fazendo, e misturar as duas perguntas em um só ensaio é o erro mais comum nessa situação. Se a pergunta é sobre a capacidade do seu serviço, a dependência externa deve ser substituída por um duplo que responde com a distribuição de latência real dela, extraída dos seus próprios traços de produção, incluindo a cauda e não apenas a mediana; um duplo que responde sempre em dez milissegundos torna o ensaio inútil justamente porque remove a fonte de fila. Se a pergunta é sobre o comportamento do seu serviço quando a dependência degrada ou recusa, então o duplo precisa ser programável para reproduzir os modos de falha reais dela: devolver quatrocentos e vinte e nove com cabeçalho de espera, devolver quinhentos e três, parar de responder sem fechar a conexão, e devolver sucesso com latência de dez segundos, que é o modo mais cruel porque não dispara nenhum tratamento de erro. Testar contra o ambiente de homologação do provedor raramente responde a qualquer uma das duas perguntas, porque o dimensionamento e os limites de homologação não são os de produção, e você acaba medindo a infraestrutura de teste de outra empresa. Há um terceiro caso que merece cuidado: quando a dependência externa é o gargalo real, o ponto de saturação do seu serviço é definido por ela e não por você, e o ensaio precisa deixar isso explícito no relatório, porque a correção não é escalar a sua aplicação e sim negociar limite, adotar cache ou mudar o padrão de chamada.',
    },
    {
      question: 'Vale a pena testar carga em produção, e como fazer isso sem causar o incidente que se quer evitar?',
      answer:
        'Vale, e para várias das seis diferenças listadas no artigo é a única forma de obter uma resposta confiável, porque estado acumulado, concorrência com trabalhos em lote e comportamento real das dependências não são reproduzíveis em ambiente separado sem um custo que quase nenhuma empresa aceita pagar. O que torna a prática segura são quatro controles aplicados juntos, e a ausência de qualquer um deles é o que produz as histórias de terror que dão má fama à técnica. O primeiro é marcação de tráfego sintético que atravessa toda a cadeia de chamadas, para que nenhum dado de teste entre em faturamento, em relatório de negócio ou em treinamento de modelo, e para que o time de plantão distinga imediatamente carga sintética de carga real ao olhar um alerta. O segundo é um interruptor de desligamento acionável em segundos por qualquer pessoa de plantão, sem depender de entrega nova, porque a decisão de abortar precisa ser mais rápida do que a formação da fila. O terceiro é abortar automaticamente por indicador de serviço real e não por métrica do próprio ensaio, tipicamente interrompendo quando a latência do tráfego orgânico passa de um limiar ou quando o orçamento de erro do período começa a ser consumido. O quarto é começar com uma fração pequena e crescer devagar, algo como um por cento do tráfego em janela de baixa e dobrando a cada ensaio bem sucedido ao longo de semanas. Com esses quatro controles, o ensaio em produção responde perguntas que nenhum ambiente de homologação responde; sem eles, ele é apenas um incidente agendado.',
    },
  ],
  conclusion: {
    title: 'O ensaio que nunca falha não está aprovando o sistema, está aprovando a si mesmo',
    description:
      'Um teste de carga que sempre passa não é sinal de sistema robusto, é sinal de ensaio que não encontra nada. O laço fechado reduz a pressão quando o serviço degrada, a omissão coordenada apaga do relatório exatamente as medições ruins, o intervalo constante remove a formação de fila, os dados sintéticos escondem o banco e cinco minutos de duração são curtos demais para qualquer vazamento. Trocar o critério de limiar de latência por ponto de saturação e margem, e publicar o fator de omissão junto com cada percentil, transforma um relatório decorativo em evidência utilizável para decidir sobre campanha e capacidade. Posso revisar o seu ensaio atual, medir quanto ele está subestimando a latência hoje, reconstruir o gerador em laço aberto com dados de cardinalidade real e entregar o ponto de saturação e a margem do seu serviço.',
    cta: 'Revisar o teste de carga do meu serviço',
  },
  related: [
    {
      label: 'Esgotamento de porta efêmera: quando o servidor para de abrir conexão de saída',
      to: '/blog/esgotamento-porta-efemera-servidor-para-de-abrir-conexao-de-saida',
    },
    {
      label: 'Limite de conexões do banco esgotado: quando o pool vira o gargalo',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The rehearsal report said one thousand requests per second with a median latency of forty two milliseconds and no errors, and the team approved the campaign with comfortable headroom. Three days later, at nine hundred requests per second measured on the same dashboard, the service started returning errors eleven minutes into the traffic and never recovered on its own. Nobody had lied in the report: the rehearsal really did pass at that volume. The problem is that volume is the least important variable in a load test, and it is the only one most rehearsals control. This article shows why a closed loop generator measures something different from what production delivers and why it hides exactly the failure you are looking for, why the mean and the median are blind to the failure mode that matters and which statistic replaces both, which six differences between rehearsal and production turn the same number into opposite outcomes, why test duration is a discovery parameter rather than a comfort one, how to build an open loop generator with coordinated omission correction in a few lines, which approval criterion replaces the latency threshold everyone uses, and how to find the saturation point instead of merely confirming a number someone picked in advance.',
  sections: [
    {
      title: 'The closed loop generator answers a question nobody asked',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost every load testing tool in use today works on the same model: a fixed number of virtual workers, each in a loop that sends a request, waits for the response to arrive, optionally pauses for a think time and sends the next one. Fifty workers with a fifty millisecond response produce one thousand requests per second. It is simple to implement, simple to explain and it is what most reports call load.',
        },
        {
          type: 'paragraph',
          value:
            'The problem shows up when the service gets slow. If the response goes from fifty to five hundred milliseconds, each worker now sends ten times fewer requests, and the applied load drops from one thousand to one hundred requests per second all by itself, without anyone asking for it. The generator reduced pressure at exactly the moment the service was struggling. The result is a rehearsal that can never push a degraded system into collapse, because it is, by construction, gentle with slow systems.',
        },
        {
          type: 'paragraph',
          value:
            'Production does not do that. The user opening the app does not wait for the previous one to finish before clicking, and the partner firing webhooks does not lower the frequency because your response was slow. Arrival is independent from the service, and it is that decoupling that produces queues, and queues are what produce timeouts, pool exhaustion and the retry spiral that takes the service down. The closed loop measures capacity under self restraint; production applies load under indifference. Those are two different questions, and the report answers the wrong one.',
        },
        {
          type: 'diagram',
          value: `CLOSED LOOP x OPEN LOOP UNDER DEGRADATION

  healthy service (50ms)          degraded service (500ms)

  CLOSED   50 workers             CLOSED   50 workers
           1,000 req/s applied             100 req/s applied
           queue = 0                       queue = 0
           "passed"                        "passed, just slower"

  OPEN     1,000 req/s scheduled  OPEN     1,000 req/s scheduled
           1,000 req/s applied             1,000 req/s applied
           queue = 0                       queue grows 900/s
                                           timeout, pool full, collapse

  The closed loop turns degradation into less load.
  The open loop turns degradation into a queue, which is what
  production does. Only the second one finds the breaking point.`,
        },
        {
          type: 'paragraph',
          value:
            'There is one case where the closed loop is the correct model, and it is worth recognizing it so you do not trade one error for another: when the client population is closed and each client genuinely waits. An internal system with two hundred call center operators, each working one screen at a time, is a real closed loop system, and modeling it as open loop overestimates peak load. The practical rule is to ask whether a slow client reduces the arrival of new requests. If it does, closed loop. If it does not, and it almost never does in internet facing services, the correct model is the open one.',
        },
      ],
    },
    {
      title: 'Coordinated omission: the number that disappears from the report is precisely the bad one',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The statistical consequence of the closed loop has a name, and the name is coordinated omission. Suppose a rehearsal of one thousand requests per second over one hundred seconds, with ninety nine seconds of one millisecond responses and a one second pause in which the service answered nothing. In the closed loop, during that pause the workers sat idle, and therefore almost no request was recorded within it. The report comes out with ninety nine thousand one millisecond measurements and a few dozen one second ones, and the ninety ninth percentile lands around one millisecond.',
        },
        {
          type: 'paragraph',
          value:
            'The reality of an open loop system is different. During that one second pause, one thousand requests should have been sent and every one of them would have suffered waiting. The first would wait a full second, the second nine hundred and ninety nine milliseconds, and so on. Those thousand measurements do not appear in the report because the generator never emitted them: it coordinated its own silence with the silence of the service. The true ninety ninth percentile is in the hundreds of milliseconds, and the report announces one.',
        },
        {
          type: 'paragraph',
          value:
            'The correction does not require switching tools, it requires changing what you measure. Instead of timing from the actual send to the response, you time from the instant the request should have been sent, according to the schedule defined at the start of the rehearsal, to the response. The difference between the two is the wait inside the generator queue, which is exactly the wait a real user suffers when the system cannot keep up.',
        },
        {
          type: 'table',
          columns: ['Rehearsal scenario', 'Latency reported by the closed loop', 'Real latency in open loop', 'What the difference hides'],
          rows: [
            [
              '800ms garbage collection pause every 30s',
              '99th percentile at 12ms',
              '99th percentile at 640ms',
              'The entire tail that defines user experience',
            ],
            [
              '4s database leader re election',
              'Median and 99th percentile nearly unchanged',
              '95th percentile above the client timeout',
              'The retry avalanche that comes right after',
            ],
            [
              'Upstream service degrades from 40ms to 900ms',
              'Applied load drops by itself to 1/20',
              'Queue grows and the pool drains in 2 minutes',
              'The whole failure mode, which is never reached',
            ],
            [
              'Restart of one replica out of three',
              'Small increase in average latency',
              'One third of requests with no target for 15s',
              'The absence of a retry in the client',
            ],
            [
              'External provider rate limit at 300 req/s',
              'Applied rate settles at 300 req/s',
              'Internal queue grows without bound',
              'That the rehearsal never tested behavior above the ceiling',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second row deserves attention because it describes the most common incident of all. A four second leader re election is a normal and expected event that happens in every planned failover. In the closed loop rehearsal it is silently absorbed and does not even enter the report. In production it produces four seconds of accumulated requests that blow past the client timeout, and the client resends all of them at once in the fifth second, doubling the load at exactly the instant the new leader is cold. The rehearsal approved the volume and never came close to testing the event.',
        },
      ],
    },
    {
      title: 'The six differences that turn the same number into opposite outcomes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the rehearsal approves one thousand requests per second and production falls at nine hundred, the temptation is to conclude the generator was wrong about the number. Usually it was not: the number is the same, and what differs is what accompanies the number. Six differences account for most cases, and every one of them is verifiable before the next rehearsal.',
        },
        {
          type: 'ordered',
          items: [
            'Arrival distribution. The generator emits one request every millisecond with a ruler; production arrives as a Poisson process, where short intervals cluster. With the same average of one thousand per second, the instantaneous peak of any given second under Poisson exceeds eleven hundred frequently, and it is the peak that saturates the queue, not the average.',
            'Data cardinality. The rehearsal repeats one hundred customer identifiers and warms the cache to a ninety nine percent hit rate. Production has two hundred thousand distinct customers and the real hit rate is sixty percent, which multiplies by four the queries reaching the database at the same edge request count.',
            'Work distribution per request. The rehearsal always uses the same request body, almost always the small case. Production has a tail of requests costing thirty times more, and it is that tail that occupies workers and forms the queue for everything else.',
            'Accumulated state. The rehearsal runs on a freshly restored database, with compact indexes, recent statistics and no dead rows. Production has six months of growth, and the query plan chosen in the rehearsal may not even be the plan chosen there.',
            'Concurrency with the rest of the world. During the rehearsal the service has the database to itself. In production it shares with the nightly reporting job, with replication, with the eight in the morning batch and with the backup, and available capacity is what is left over, not the total.',
            'Absence of degraded neighbors. The rehearsal uses healthy local dependencies. Production has an external provider that oscillates, an internal service that restarts, a name resolution that occasionally stalls, and each of them turns capacity into queue.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Of the six, the first is the one fixed with the least effort and the highest immediate return, because it is a three line change in the generator. Emitting at a constant interval is a silent mistake: it drives arrival variance to zero and, with it, removes the main queue formation mechanism. Replacing the constant interval with an exponential one, which is what generates a Poisson process, keeps the same average rate and gives the rehearsal back the clustering production has.',
        },
        {
          type: 'code',
          value: `// Open loop generator with Poisson arrival and coordinated
// omission correction. The key is the scheduled field: measurement
// starts at the scheduled instant, not at the send instant.

/**
 * @param {object} options
 * @param {string} options.url          endpoint under test
 * @param {number} options.ratePerSec   desired average arrival rate
 * @param {number} options.durationSec  total rehearsal duration
 * @param {number} options.timeoutMs    per request timeout
 */
export async function openLoopRun({ url, ratePerSec, durationSec, timeoutMs = 2000 }) {
  const samples = [];
  const inFlight = new Set();
  const start = performance.now();
  const end = start + durationSec * 1000;

  // Exponential interval: reproduces Poisson arrival, where the mean is
  // 1/rate but intervals cluster. A constant interval removes arrival
  // variance and, with it, the queue formation we want to measure.
  const nextIntervalMs = () => (-Math.log(1 - Math.random()) / ratePerSec) * 1000;

  let scheduled = start;

  while (scheduled < end) {
    scheduled += nextIntervalMs();
    const scheduledAt = scheduled;

    const waitMs = scheduledAt - performance.now();
    // Wait only when the generator is ahead. When it is behind the value
    // is negative and the request goes out immediately, already owing
    // time: that debt is coordinated omission made visible.
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const promise = measureOne({ url, scheduledAt, timeoutMs })
      .then((sample) => samples.push(sample))
      .finally(() => inFlight.delete(promise));

    inFlight.add(promise);
  }

  await Promise.all(inFlight);
  return summarize(samples, durationSec);
}

async function measureOne({ url, scheduledAt, timeoutMs }) {
  const sentAt = performance.now();
  const controller = new AbortController();
  const alarm = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    const doneAt = performance.now();
    return {
      // Service: what the server dashboard sees.
      serviceMs: doneAt - sentAt,
      // Response: what the user feels, including the wait inside the
      // generator queue. The gap between the two is coordinated omission.
      responseMs: doneAt - scheduledAt,
      status: response.status,
      ok: response.ok,
    };
  } catch {
    const doneAt = performance.now();
    return {
      serviceMs: doneAt - sentAt,
      responseMs: doneAt - scheduledAt,
      status: 0,
      ok: false,
    };
  } finally {
    clearTimeout(alarm);
  }
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(samples, durationSec) {
  const service = samples.map((s) => s.serviceMs);
  const response = samples.map((s) => s.responseMs);
  const errors = samples.filter((s) => !s.ok).length;

  return {
    samples: samples.length,
    effectiveRate: samples.length / durationSec,
    errorRate: errors / Math.max(1, samples.length),
    serviceP99: percentile(service, 99),
    responseP99: percentile(response, 99),
    // The ratio below is the single most important figure in the whole
    // report. Near 1 the generator kept the schedule. Above 2 there is a
    // queue in the generator, and any server side latency number is
    // underestimating what the user suffers by that same factor.
    omissionFactor: percentile(response, 99) / Math.max(1, percentile(service, 99)),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The most valuable field in the summary is the last one. The ratio between the ninety ninth percentile of the response and the ninety ninth percentile of the service answers, in a single number, whether the rehearsal can be taken seriously. A value near one means the generator kept the schedule and the server latency number is trustworthy. A value of five means the generator accumulated a queue, that the server was already saturated for a good part of the rehearsal, and that the pretty percentile on the server dashboard is underestimating real experience by a factor of five.',
        },
      ],
    },
    {
      title: 'Duration and shape: the five minute rehearsal approves what fails at forty',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a whole class of failures that is invisible by construction in short rehearsals, because the time to manifestation is longer than the test duration. They are neither exotic nor rare: they are the most common ones in production incidents, and they all share the progressive consumption of a finite resource that a short rehearsal barely scratches.',
        },
        {
          type: 'table',
          columns: ['Failure', 'Typical time to manifest', 'Why the short rehearsal misses it', 'How to provoke it in the rehearsal'],
          rows: [
            [
              'Connection leak on the error path',
              '30 to 90 minutes',
              'The error path is barely exercised in a happy rehearsal',
              'Inject 2 to 5 percent dependency failure for 60 minutes',
            ],
            [
              'Outbound ephemeral port exhaustion',
              '20 to 60 minutes',
              'The port pool is large and consumption is linear',
              'Hold a rate above the sustainable one for at least 45 minutes',
            ],
            [
              'Memory fragmentation and growing pauses',
              '2 to 6 hours',
              'Memory stabilizes before the first full cycle',
              'Soak test at moderate load with a realistic object profile',
            ],
            [
              'Index bloat and query plan change',
              'Days in production',
              'The rehearsal database is freshly restored and compact',
              'Restore a production copy instead of generating synthetic data',
            ],
            [
              'Queue buildup with a slightly slower consumer',
              '15 to 120 minutes',
              'A 3 percent deficit takes hours to become visible lag',
              'Compare production and consumption rates, not queue depth',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third column reveals the common pattern: the short rehearsal is not too small for the load, it is too short for the mechanism. A leak of ten connections per minute needs an hour to drain a pool of six hundred, and a five minute rehearsal observes sixty leaked connections, which is indistinguishable from normal operation on any dashboard. Raising the load does not help: you need to raise the time, or provoke the leaking path directly.',
        },
        {
          type: 'paragraph',
          value:
            'That leads to a split of shapes worth adopting explicitly, because each one finds a different class of defect and none substitutes for the others. The ramp test raises load in steps until it finds the saturation point, and answers what the capacity is. The burst test applies an instantaneous jump of three to five times for thirty seconds, and answers whether the system absorbs peaks without a retry spiral. The soak test holds seventy percent of capacity for hours, and answers whether there is a leak. The chaos test applies normal load while taking dependencies down, and answers whether the degraded mode works. Approving a launch with only the first is approving against just one of the four failure classes.',
        },
        {
          type: 'diagram',
          value: `FOUR SHAPES, FOUR DIFFERENT QUESTIONS

  RAMP          load
                 |      ___----- saturation point
                 |  __--
                 |--          question: what is the capacity?
                 +---------------- time (20 to 40 min)

  BURST         load
                 |    ____
                 |    |  |      question: does it absorb peaks
                 |____|  |____  without a retry spiral?
                 +---------------- time (5 min, 30s jump)

  SOAK          load
                 |________________
                 |                question: does any resource leak?
                 +---------------- time (2 to 8 hours, 70% of cap.)

  CHAOS         load + injected failures
                 |____X____X______  X = dependency taken down
                 |                question: does degraded mode exist?
                 +---------------- time (30 to 60 min)`,
        },
      ],
    },
    {
      title: 'The approval criterion has to be a saturation point, not a threshold',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most widely used criterion in load testing is also the least informative: ninety fifth percentile below two hundred milliseconds and error rate below one percent at the target load. It has two structural defects. The first is that it validates a point rather than a curve, so it says absolutely nothing about what happens with five percent more traffic, which is the question that matters on the eve of the campaign. The second is that it conflates being within the limit with having headroom, and a system that meets the criterion at two percent from the breaking point passes exactly like one sitting at fifty.',
        },
        {
          type: 'paragraph',
          value:
            'The criterion that replaces both is the saturation point and the margin to it. The saturation point is the arrival rate above which useful throughput stops growing while latency starts rising non linearly. It is not a choice, it is a property of the system, and finding it is the purpose of the ramp test. The margin is the ratio between the saturation point and the real peak observed in production over the last ninety days, and it is that number, not the percentile, that belongs in the approval report.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it measures', 'Healthy range', 'What a bad reading indicates'],
          rows: [
            [
              'Saturation point',
              'Arrival rate where throughput stops growing',
              'Above 2 times the production peak',
              'Below 1.5 times, a common seasonal event takes the service down',
            ],
            [
              'Omission factor',
              'Ratio between response and service 99th percentiles',
              'Below 1.3',
              'Above 2, the server number is underestimating experience',
            ],
            [
              'Useful throughput in collapse',
              'Successful throughput at 150 percent of saturation',
              'Above 70 percent of peak throughput',
              'Below 40 percent, admission or queue control is missing',
            ],
            [
              'Time to recover',
              'Seconds between the end of the burst and a return to normal',
              'Below 60 seconds',
              'Above 5 minutes, there is unbounded retry or an unbounded queue',
            ],
            [
              'Resource drift in the soak',
              'Memory and connection slope per hour',
              'Essentially flat',
              'Any sustained positive slope is a leak',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third row is the one that most changes the conversation with product, because it measures what happens after the limit and not before it. Every system has a saturation point, and no budget prevents it from existing; what separates a resilient service from a fragile one is the shape of the curve after it. A system with admission control refuses the excess quickly and holds seventy percent of peak throughput, which means seven out of ten customers keep being served. A system without control accepts everything, forms a queue, blows the timeout on every request and delivers useful throughput near zero, serving nobody while working at the limit. The two have the same nominal capacity and opposite outcomes on peak day.',
        },
        {
          type: 'paragraph',
          value:
            'It is also worth recording the practical effect of this criterion change on the process. A report saying ninety fifth percentile at one hundred and eighty milliseconds enables no business decision. A report saying saturation point at one thousand two hundred requests per second, production peak at four hundred and fifty, margin of two point seven times, and useful throughput of seventy four percent at one hundred and fifty percent of saturation, enables decisions about the campaign, about capacity and about fix priority with no further translation.',
        },
      ],
    },
    {
      title: 'The sequence that turns the rehearsal into evidence',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Rewriting the whole rehearsal at once usually stalls before the first result. The sequence below delivers value at each step and can be interrupted at any point without losing what was already done, which matters because each step shows something new and justifies the next.',
        },
        {
          type: 'ordered',
          items: [
            'Instrument omission before changing anything. Add the scheduled instant to the measurements of your current rehearsal and publish the ratio between the two percentiles. If it exceeds two, you already know every previous report underestimated latency, and that alone is usually enough to authorize the rest of the work.',
            'Swap the constant interval for an exponential one. It is three lines and the average rate does not change, so comparison with earlier rehearsals stays valid. Expect the ninety ninth percentile to rise without anything having gotten worse: what changed is that it is now being measured.',
            'Fix data cardinality before any infrastructure tuning. Extract the real identifier distribution from a day of production logs and feed the generator with it. Without that step, every database and cache measurement in the rehearsal is fiction, and optimizing on top of it wastes weeks.',
            'Find the saturation point with a ramp test. Climb in five minute steps until useful throughput stops growing, and record that number alongside the real production peak over the last ninety days. The ratio between the two is your margin, and it is the first number in the new report.',
            'Run a burst test at four times the average for thirty seconds. Measure recovery time after the burst ends. That is the test that reveals unbounded retry and unbounded queues, and it takes five minutes to run.',
            'Only then run the four hour soak at seventy percent of capacity, with two percent injected dependency failure. It is the most expensive rehearsal in wall clock time and the only one that finds leaks, and it should run overnight once a week, not on every change request.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third step generates the most resistance and changes the most outcomes. Generating synthetic data with one hundred customers is fast and gives you a rehearsal that runs on any laptop; extracting the real distribution from a production log requires a conversation about data access and care with anonymization. The difference in outcome is too large to ignore: with one hundred customers the cache hit rate sits at ninety nine percent and the database is barely exercised, and it is precisely the database that breaks in production. An acceptable alternative when log access is unworkable is to reproduce only the shape of the distribution, keeping the long tail of rare identifiers even if the values themselves are generated.',
        },
        {
          type: 'paragraph',
          value:
            'On frequency, the split that works in practice is to put ramp and burst in the delivery pipeline, because together they take under thirty minutes and catch capacity regressions on every change, and to leave soak and chaos on a weekly overnight schedule. Trying to run all four on every change makes the team turn the whole test off within two weeks, and a rehearsal that is turned off finds even less than a rehearsal that lies.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I have to replace the load testing tool I already use to fix coordinated omission?',
      answer:
        'In most cases no, and it is worth verifying before proposing a migration that usually costs weeks. Some modern tools already implement the correction and expose both measurements under different names, one being the time since scheduling and the other the time since the actual send; in those cases the work is only finding out which metric your report is publishing, and the frequent answer is that the default dashboard shows the wrong one because it is the prettier one. Other tools support a fixed rate arrival mode, sometimes called constant rate or arrival executor, which is exactly the open loop generator; enabling that mode is usually a few lines of change in the scenario configuration, and the main caution is sizing the number of pre allocated workers generously, because if the generator runs out of available workers it goes back to coordinating with the service and the problem returns under another name. When the tool offers neither, there is still an approximate correction that does not require replacement: record the intended schedule in parallel and, during analysis, reconstruct the missing measurements by assigning to every request that should have departed during a pause the corresponding wait. It is less precise than actually measuring, but it is orders of magnitude better than publishing a percentile that omitted precisely the worst cases. The criterion for deciding to migrate is the measured omission factor: below one point three the current tool is keeping the schedule and there is no reason to change anything.',
    },
    {
      question: 'How do I load test against external dependencies I do not control and that have rate limits?',
      answer:
        'The answer depends on which question you are asking, and mixing the two questions into a single rehearsal is the most common mistake in this situation. If the question is about your own service capacity, the external dependency should be replaced by a double that answers with its real latency distribution, extracted from your own production traces, including the tail and not just the median; a double that always answers in ten milliseconds makes the rehearsal useless precisely because it removes the queue source. If the question is about your service behavior when the dependency degrades or refuses, then the double needs to be programmable to reproduce its real failure modes: returning four hundred and twenty nine with a retry after header, returning five hundred and three, going silent without closing the connection, and returning success with ten second latency, which is the cruelest mode because it triggers no error handling at all. Testing against the provider sandbox rarely answers either question, because sandbox sizing and limits are not the production ones, and you end up measuring another company test infrastructure. There is a third case deserving care: when the external dependency is the real bottleneck, the saturation point of your service is defined by it and not by you, and the rehearsal has to make that explicit in the report, because the fix is not scaling your application but negotiating limits, adopting cache or changing the call pattern.',
    },
    {
      question: 'Is it worth load testing in production, and how do I do it without causing the very incident I am trying to avoid?',
      answer:
        'It is, and for several of the six differences listed in the article it is the only way to get a trustworthy answer, because accumulated state, concurrency with batch jobs and real dependency behavior are not reproducible in a separate environment without a cost almost no company accepts paying. What makes the practice safe are four controls applied together, and the absence of any one of them is what produces the horror stories that give the technique a bad name. The first is synthetic traffic tagging that travels through the entire call chain, so that no test data enters billing, business reporting or model training, and so the on call team immediately distinguishes synthetic from real load when looking at an alert. The second is a kill switch actionable in seconds by anyone on call, without depending on a new deployment, because the decision to abort has to be faster than queue formation. The third is aborting automatically on real service indicators rather than on rehearsal metrics, typically stopping when organic traffic latency crosses a threshold or when the error budget for the period starts being consumed. The fourth is starting with a small fraction and growing slowly, something like one percent of traffic in a low window and doubling after every successful rehearsal over weeks. With those four controls, production testing answers questions no staging environment answers; without them, it is just a scheduled incident.',
    },
  ],
  conclusion: {
    title: 'A rehearsal that never fails is not approving the system, it is approving itself',
    description:
      'A load test that always passes is not a sign of a robust system, it is a sign of a rehearsal that finds nothing. The closed loop lowers pressure when the service degrades, coordinated omission erases precisely the bad measurements from the report, the constant interval removes queue formation, synthetic data hides the database and five minutes of duration is far too short for any leak. Replacing the latency threshold criterion with saturation point and margin, and publishing the omission factor alongside every percentile, turns a decorative report into evidence usable for deciding on campaigns and capacity. I can review your current rehearsal, measure how much it is underestimating latency today, rebuild the generator in open loop with real cardinality data and deliver the saturation point and margin of your service.',
    cta: 'Review my service load test',
  },
  related: [
    {
      label: 'Ephemeral port exhaustion: when the server stops opening outbound connections',
      to: '/blog/esgotamento-porta-efemera-servidor-para-de-abrir-conexao-de-saida',
    },
    {
      label: 'Database connection limit exhausted: when the pool becomes the bottleneck',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El informe del ensayo decía mil peticiones por segundo con latencia mediana de cuarenta y dos milisegundos y ningún error, y el equipo aprobó la campaña con holgura cómoda. Tres días después, con novecientas peticiones por segundo medidas en el mismo panel, el servicio empezó a devolver errores a los once minutos de tráfico y no se recuperó solo. Nadie había mentido en el informe: el ensayo realmente pasó con ese volumen. El problema es que el volumen es la variable menos importante de una prueba de carga, y es la única que controla la mayoría de los ensayos. Este artículo muestra por qué el generador de lazo cerrado mide algo distinto de lo que entrega producción y por qué esconde justamente el fallo que se quiere encontrar, por qué la media y la mediana son ciegas al modo de fallo que importa y qué estadístico sustituye a ambas, qué seis diferencias entre ensayo y producción convierten el mismo número en resultados opuestos, por qué la duración de la prueba es un parámetro de descubrimiento y no de comodidad, cómo construir un generador de lazo abierto con corrección de omisión coordinada en pocas líneas, qué criterio de aprobación sustituye al umbral de latencia que todo el mundo usa, y cómo encontrar el punto de saturación en vez de solo confirmar un número que alguien eligió de antemano.',
  sections: [
    {
      title: 'El generador de lazo cerrado responde a una pregunta que nadie hizo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi toda herramienta de prueba de carga en uso hoy funciona con el mismo modelo: un número fijo de trabajadores virtuales, cada uno en un bucle que envía una petición, espera a que llegue la respuesta, opcionalmente pausa un tiempo de reflexión y envía la siguiente. Cincuenta trabajadores con una respuesta de cincuenta milisegundos producen mil peticiones por segundo. Es sencillo de implementar, sencillo de explicar y es lo que la mayoría de los informes llama carga.',
        },
        {
          type: 'paragraph',
          value:
            'El problema aparece cuando el servicio se vuelve lento. Si la respuesta pasa de cincuenta a quinientos milisegundos, cada trabajador pasa a enviar diez veces menos peticiones, y la carga aplicada cae de mil a cien peticiones por segundo sola, sin que nadie lo pida. El generador redujo la presión exactamente en el instante en que el servicio estaba en dificultades. El resultado es un ensayo que nunca logra empujar un sistema degradado hacia el colapso, porque es, por construcción, amable con los sistemas lentos.',
        },
        {
          type: 'paragraph',
          value:
            'Producción no hace eso. El usuario que abre la aplicación no espera a que termine el anterior para hacer clic, y el socio que dispara webhooks no reduce la frecuencia porque tu respuesta tardó. La llegada es independiente del servicio, y es ese desacoplamiento el que produce colas, y las colas son las que producen timeouts, agotamiento del pool y la espiral de reintentos que tumba el servicio. El lazo cerrado mide capacidad bajo autocontrol; producción aplica carga bajo indiferencia. Son dos preguntas distintas, y el informe responde la equivocada.',
        },
        {
          type: 'diagram',
          value: `LAZO CERRADO x LAZO ABIERTO BAJO DEGRADACION

  servicio sano (50ms)            servicio degradado (500ms)

  CERRADO  50 trabajadores        CERRADO  50 trabajadores
           1.000 pet/s aplicadas           100 pet/s aplicadas
           cola = 0                        cola = 0
           "paso"                          "paso, solo mas lento"

  ABIERTO  1.000 pet/s agendadas  ABIERTO  1.000 pet/s agendadas
           1.000 pet/s aplicadas           1.000 pet/s aplicadas
           cola = 0                        la cola crece 900/s
                                           timeout, pool lleno, colapso

  El lazo cerrado convierte degradacion en menos carga.
  El lazo abierto la convierte en cola, que es lo que hace
  produccion. Solo el segundo encuentra el punto de ruptura.`,
        },
        {
          type: 'paragraph',
          value:
            'Hay un caso en el que el lazo cerrado es el modelo correcto, y conviene reconocerlo para no cambiar un error por otro: cuando la población de clientes es cerrada y cada cliente realmente espera. Un sistema interno con doscientos operadores de centro de llamadas, cada uno trabajando en una pantalla a la vez, es un sistema de lazo cerrado de verdad, y modelarlo como lazo abierto sobreestima la carga de pico. La regla práctica es preguntarse si un cliente lento reduce la llegada de nuevas peticiones. Si la reduce, lazo cerrado. Si no la reduce, y casi nunca la reduce en servicios expuestos a internet, el modelo correcto es el abierto.',
        },
      ],
    },
    {
      title: 'Omisión coordinada: el número que desaparece del informe es justamente el malo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La consecuencia estadística del lazo cerrado tiene nombre, y el nombre es omisión coordinada. Supongamos un ensayo de mil peticiones por segundo durante cien segundos, con noventa y nueve segundos de respuestas en un milisegundo y una pausa de un segundo en la que el servicio no respondió nada. En el lazo cerrado, durante esa pausa los trabajadores estuvieron parados, y por tanto casi ninguna petición quedó registrada en ella. El informe sale con noventa y nueve mil mediciones de un milisegundo y unas pocas decenas de un segundo, y el percentil noventa y nueve queda en torno a un milisegundo.',
        },
        {
          type: 'paragraph',
          value:
            'La realidad de un sistema de lazo abierto es otra. Durante esa pausa de un segundo, mil peticiones debían haberse enviado y todas ellas habrían sufrido espera. La primera esperaría un segundo entero, la segunda novecientos noventa y nueve milisegundos, y así sucesivamente. Esas mil mediciones no aparecen en el informe porque el generador nunca las emitió: coordinó su propio silencio con el silencio del servicio. El percentil noventa y nueve verdadero está en centenas de milisegundos, y el informe anuncia uno.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección no exige cambiar de herramienta, exige cambiar lo que se mide. En vez de cronometrar el tiempo entre el envío efectivo y la respuesta, se cronometra el tiempo entre el instante en que la petición debía haberse enviado, según el cronograma definido al inicio del ensayo, y la respuesta. La diferencia entre ambos es la espera en la cola del propio generador, que es exactamente la espera que sufre el usuario real cuando el sistema no acompaña.',
        },
        {
          type: 'table',
          columns: ['Escenario del ensayo', 'Latencia informada por el lazo cerrado', 'Latencia real en lazo abierto', 'Lo que la diferencia esconde'],
          rows: [
            [
              'Pausa de recolección de basura de 800ms cada 30s',
              'Percentil 99 en 12ms',
              'Percentil 99 en 640ms',
              'Toda la cola que define la experiencia del usuario',
            ],
            [
              'Reelección de líder de la base de 4s',
              'Mediana y percentil 99 casi sin cambios',
              'Percentil 95 por encima del timeout del cliente',
              'La avalancha de reintentos que llega justo después',
            ],
            [
              'Servicio aguas arriba degrada de 40ms a 900ms',
              'La carga aplicada cae sola a 1/20',
              'La cola crece y el pool se agota en 2 minutos',
              'El modo de fallo entero, que nunca se alcanza',
            ],
            [
              'Reinicio de una réplica de tres',
              'Pequeño aumento de latencia media',
              'Un tercio de las peticiones sin destino durante 15s',
              'La ausencia de reintento en el cliente',
            ],
            [
              'Límite de tasa del proveedor externo en 300 pet/s',
              'La tasa aplicada se acomoda en 300 pet/s',
              'La cola interna crece de forma ilimitada',
              'Que el ensayo nunca probó el comportamiento sobre el techo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda fila merece atención porque describe el incidente más común de todos. Una reelección de líder de cuatro segundos es un evento normal y esperado, que ocurre en todo failover planificado. En el ensayo de lazo cerrado se absorbe en silencio y ni siquiera entra en el informe. En producción produce cuatro segundos de peticiones acumuladas que revientan el timeout del cliente, y el cliente reenvía todas de golpe en el quinto segundo, duplicando la carga exactamente en el instante en que el nuevo líder está frío. El ensayo aprobó el volumen y nunca se acercó a probar el evento.',
        },
      ],
    },
    {
      title: 'Las seis diferencias que hacen que el mismo número dé resultados opuestos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando el ensayo aprueba mil peticiones por segundo y producción cae con novecientas, la tentación es concluir que el generador se equivocó en el número. En general no se equivocó: el número es el mismo, y lo que difiere es lo que acompaña al número. Seis diferencias explican la mayoría de los casos, y todas son verificables antes del próximo ensayo.',
        },
        {
          type: 'ordered',
          items: [
            'Distribución de llegada. El generador emite una petición cada milisegundo con regla; producción llega en proceso de Poisson, donde los intervalos cortos se agrupan. Con la misma media de mil por segundo, el pico instantáneo de cualquier segundo bajo Poisson supera mil cien con frecuencia, y es el pico el que satura la cola, no la media.',
            'Cardinalidad de los datos. El ensayo repite cien identificadores de cliente y calienta la caché hasta una tasa de acierto del noventa y nueve por ciento. Producción tiene doscientos mil clientes distintos y la tasa de acierto real es del sesenta por ciento, lo que multiplica por cuatro las consultas que llegan a la base con el mismo número de peticiones en el borde.',
            'Distribución del trabajo por petición. El ensayo usa siempre el mismo cuerpo de petición, casi siempre el caso pequeño. Producción tiene una cola de peticiones que cuestan treinta veces más, y es esa cola la que ocupa a los trabajadores y forma la fila para todo lo demás.',
            'Estado acumulado. El ensayo corre sobre una base recién restaurada, con índices compactos, estadísticas recientes y ninguna fila muerta. Producción tiene seis meses de crecimiento, y el plan de consulta elegido en el ensayo puede ni siquiera ser el plan elegido allí.',
            'Concurrencia con el resto del mundo. Durante el ensayo el servicio tiene la base para sí solo. En producción la comparte con el proceso de informes nocturno, con la replicación, con el lote de las ocho de la mañana y con el backup, y la capacidad disponible es lo que sobra, no el total.',
            'Ausencia de vecinos degradados. El ensayo usa dependencias sanas y locales. Producción tiene un proveedor externo que oscila, un servicio interno que se reinicia, una resolución de nombres que a veces tarda, y cada uno de ellos convierte capacidad en cola.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'De las seis, la primera es la que se corrige con menos esfuerzo y tiene el mayor retorno inmediato, porque es un cambio de tres líneas en el generador. Emitir con intervalo constante es un error silencioso: reduce la varianza de la llegada a cero y, con ella, elimina el principal mecanismo de formación de cola. Cambiar el intervalo constante por uno exponencial, que es lo que genera un proceso de Poisson, mantiene la misma tasa media y devuelve al ensayo el agrupamiento que producción tiene.',
        },
        {
          type: 'code',
          value: `// Generador de lazo abierto con llegada de Poisson y correccion de
// omision coordinada. La clave es el campo agendado: la medicion
// empieza en el instante agendado, no en el instante del envio.

/**
 * @param {object} opciones
 * @param {string} opciones.url          endpoint bajo prueba
 * @param {number} opciones.tasaPorSeg   tasa media de llegada deseada
 * @param {number} opciones.duracionSeg  duracion total del ensayo
 * @param {number} opciones.timeoutMs    timeout por peticion
 */
export async function ensayoLazoAbierto({ url, tasaPorSeg, duracionSeg, timeoutMs = 2000 }) {
  const muestras = [];
  const enVuelo = new Set();
  const inicio = performance.now();
  const fin = inicio + duracionSeg * 1000;

  // Intervalo exponencial: reproduce llegada de Poisson, donde la media
  // es 1/tasa pero los intervalos se agrupan. El intervalo constante
  // elimina la varianza de llegada y, con ella, la cola que se quiere medir.
  const proximoIntervaloMs = () => (-Math.log(1 - Math.random()) / tasaPorSeg) * 1000;

  let agendado = inicio;

  while (agendado < fin) {
    agendado += proximoIntervaloMs();
    const agendadoPara = agendado;

    const esperaMs = agendadoPara - performance.now();
    // Espera solo cuando el generador va adelantado. Cuando va atrasado
    // el valor es negativo y la peticion sale de inmediato, ya debiendo
    // tiempo: esa deuda es la omision coordinada hecha visible.
    if (esperaMs > 0) {
      await new Promise((resolver) => setTimeout(resolver, esperaMs));
    }

    const promesa = medirUna({ url, agendadoPara, timeoutMs })
      .then((muestra) => muestras.push(muestra))
      .finally(() => enVuelo.delete(promesa));

    enVuelo.add(promesa);
  }

  await Promise.all(enVuelo);
  return resumir(muestras, duracionSeg);
}

async function medirUna({ url, agendadoPara, timeoutMs }) {
  const enviadoEn = performance.now();
  const controlador = new AbortController();
  const alarma = setTimeout(() => controlador.abort(), timeoutMs);

  try {
    const respuesta = await fetch(url, { signal: controlador.signal });
    const terminadoEn = performance.now();
    return {
      // Servicio: lo que ve el panel del servidor.
      servicioMs: terminadoEn - enviadoEn,
      // Respuesta: lo que siente el usuario, incluida la espera en la cola
      // del propio generador. La diferencia es la omision coordinada.
      respuestaMs: terminadoEn - agendadoPara,
      status: respuesta.status,
      ok: respuesta.ok,
    };
  } catch {
    const terminadoEn = performance.now();
    return {
      servicioMs: terminadoEn - enviadoEn,
      respuestaMs: terminadoEn - agendadoPara,
      status: 0,
      ok: false,
    };
  } finally {
    clearTimeout(alarma);
  }
}

function percentil(valores, p) {
  if (!valores.length) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.ceil((p / 100) * ordenado.length) - 1);
  return ordenado[indice];
}

function resumir(muestras, duracionSeg) {
  const servicio = muestras.map((m) => m.servicioMs);
  const respuesta = muestras.map((m) => m.respuestaMs);
  const errores = muestras.filter((m) => !m.ok).length;

  return {
    muestras: muestras.length,
    tasaEfectiva: muestras.length / duracionSeg,
    tasaError: errores / Math.max(1, muestras.length),
    servicioP99: percentil(servicio, 99),
    respuestaP99: percentil(respuesta, 99),
    // La razon de abajo es el indicador mas importante del informe entero.
    // Cerca de 1 el generador mantuvo el cronograma. Por encima de 2 hay
    // cola en el generador, y cualquier numero de latencia del servidor
    // esta subestimando lo que sufre el usuario por ese mismo factor.
    factorDeOmision: percentil(respuesta, 99) / Math.max(1, percentil(servicio, 99)),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El campo más valioso del resumen es el último. La razón entre el percentil noventa y nueve de la respuesta y el percentil noventa y nueve del servicio responde, en un solo número, si el ensayo puede tomarse en serio. Un valor cercano a uno significa que el generador logró mantener el cronograma y que el número de latencia del servidor es fiable. Un valor de cinco significa que el generador acumuló cola, que el servidor ya estaba saturado durante buena parte del ensayo, y que el percentil bonito del panel del servidor está subestimando la experiencia real por un factor de cinco.',
        },
      ],
    },
    {
      title: 'Duración y forma: el ensayo de cinco minutos aprueba lo que falla a los cuarenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe toda una clase de fallos invisible por construcción en ensayos cortos, porque el tiempo hasta la manifestación es mayor que la duración de la prueba. No son exóticos ni raros: son los más comunes en incidentes de producción, y todos comparten el consumo progresivo de un recurso finito que el ensayo corto apenas roza.',
        },
        {
          type: 'table',
          columns: ['Fallo', 'Tiempo típico hasta manifestarse', 'Por qué el ensayo corto no lo ve', 'Cómo provocarlo en el ensayo'],
          rows: [
            [
              'Fuga de conexión en el camino de error',
              '30 a 90 minutos',
              'El camino de error casi no se ejercita en un ensayo feliz',
              'Inyectar de 2 a 5 por ciento de fallo en dependencias durante 60 minutos',
            ],
            [
              'Agotamiento de puertos efímeros de salida',
              '20 a 60 minutos',
              'El stock de puertos es grande y el consumo es lineal',
              'Mantener tasa por encima de la sostenible al menos 45 minutos',
            ],
            [
              'Fragmentación de memoria y pausas crecientes',
              '2 a 6 horas',
              'La memoria se estabiliza antes del primer ciclo completo',
              'Ensayo de resistencia con carga moderada y perfil de objeto realista',
            ],
            [
              'Hinchazón de índice y cambio de plan de consulta',
              'Días en producción',
              'La base del ensayo está recién restaurada y compacta',
              'Restaurar copia de producción en vez de generar datos sintéticos',
            ],
            [
              'Acumulación en cola con consumidor algo más lento',
              '15 a 120 minutos',
              'Un déficit del 3 por ciento tarda horas en ser retraso visible',
              'Comparar tasa de producción y de consumo, no el tamaño de la cola',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera columna revela el patrón común: el ensayo corto no es demasiado pequeño para la carga, es demasiado corto para el mecanismo. Una fuga de diez conexiones por minuto necesita una hora para consumir un pool de seiscientas, y el ensayo de cinco minutos observa sesenta conexiones fugadas, que es indistinguible de la operación normal en cualquier panel. Aumentar la carga no ayuda: hay que aumentar el tiempo, o provocar directamente el camino que fuga.',
        },
        {
          type: 'paragraph',
          value:
            'Eso lleva a una división de formatos que conviene adoptar de forma explícita, porque cada uno encuentra una clase distinta de defecto y ninguno sustituye a los demás. El ensayo de escalón sube la carga por peldaños hasta encontrar el punto de saturación, y responde cuál es la capacidad. El ensayo de ráfaga aplica un salto instantáneo de tres a cinco veces durante treinta segundos, y responde si el sistema absorbe picos sin espiral de reintentos. El ensayo de resistencia mantiene el setenta por ciento de la capacidad durante horas, y responde si hay fuga. El ensayo de caos aplica carga normal mientras tumba dependencias, y responde si el modo degradado funciona. Aprobar un lanzamiento solo con el primero es aprobar contra una sola de las cuatro clases de fallo.',
        },
        {
          type: 'diagram',
          value: `CUATRO FORMATOS, CUATRO PREGUNTAS DISTINTAS

  ESCALON       carga
                 |      ___----- punto de saturacion
                 |  __--
                 |--          pregunta: cual es la capacidad?
                 +---------------- tiempo (20 a 40 min)

  RAFAGA        carga
                 |    ____
                 |    |  |      pregunta: absorbe picos sin
                 |____|  |____  espiral de reintentos?
                 +---------------- tiempo (5 min, salto de 30s)

  RESISTENCIA   carga
                 |________________
                 |                pregunta: fuga algun recurso?
                 +---------------- tiempo (2 a 8 horas, 70% de cap.)

  CAOS          carga + fallos inyectados
                 |____X____X______  X = dependencia tumbada
                 |                pregunta: existe el modo degradado?
                 +---------------- tiempo (30 a 60 min)`,
        },
      ],
    },
    {
      title: 'El criterio de aprobación debe ser un punto de saturación, no un umbral',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El criterio más usado en pruebas de carga es también el menos informativo: percentil noventa y cinco por debajo de doscientos milisegundos y tasa de error por debajo del uno por ciento en la carga objetivo. Tiene dos defectos estructurales. El primero es que valida un punto y no una curva, así que no dice absolutamente nada sobre lo que ocurre con un cinco por ciento más de tráfico, que es la pregunta que importa la víspera de la campaña. El segundo es que confunde estar dentro del límite con tener margen, y un sistema que cumple el criterio a un dos por ciento del punto de ruptura pasa exactamente igual que uno que está al cincuenta.',
        },
        {
          type: 'paragraph',
          value:
            'El criterio que sustituye a ambos es el punto de saturación y el margen hasta él. El punto de saturación es la tasa de llegada por encima de la cual el rendimiento útil deja de crecer mientras la latencia empieza a subir de forma no lineal. No es una elección, es una propiedad del sistema, y encontrarlo es el objetivo del ensayo de escalón. El margen es la razón entre el punto de saturación y el pico real observado en producción en los últimos noventa días, y es ese número, y no el percentil, el que debe constar en el informe de aprobación.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué mide', 'Rango saludable', 'Qué indica una lectura mala'],
          rows: [
            [
              'Punto de saturación',
              'Tasa de llegada donde el rendimiento deja de crecer',
              'Por encima de 2 veces el pico de producción',
              'Por debajo de 1,5 veces, un evento estacional común tumba el servicio',
            ],
            [
              'Factor de omisión',
              'Razón entre percentiles 99 de respuesta y de servicio',
              'Por debajo de 1,3',
              'Por encima de 2, el número del servidor subestima la experiencia',
            ],
            [
              'Rendimiento útil en el colapso',
              'Rendimiento con éxito al 150 por ciento de la saturación',
              'Por encima del 70 por ciento del rendimiento de pico',
              'Por debajo del 40 por ciento, falta control de admisión o de cola',
            ],
            [
              'Tiempo hasta recuperar',
              'Segundos entre el fin de la ráfaga y la vuelta a la normalidad',
              'Por debajo de 60 segundos',
              'Por encima de 5 minutos, hay reintento sin límite o cola sin techo',
            ],
            [
              'Deriva de recurso en la resistencia',
              'Pendiente de memoria y conexiones por hora',
              'Prácticamente plana',
              'Cualquier pendiente positiva sostenida es una fuga',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera fila es la que más cambia la conversación con producto, porque mide lo que ocurre después del límite y no antes. Todo sistema tiene un punto de saturación, y ningún presupuesto evita que exista; lo que diferencia un servicio resiliente de uno frágil es la forma de la curva después de él. Un sistema con control de admisión rechaza el excedente rápido y mantiene el setenta por ciento del rendimiento de pico, lo que significa que siete de cada diez clientes siguen siendo atendidos. Un sistema sin control acepta todo, forma cola, revienta el timeout en todas las peticiones y entrega rendimiento útil cercano a cero, sin atender a nadie mientras trabaja al límite. Los dos tienen la misma capacidad nominal y resultados opuestos el día del pico.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene registrar también el efecto práctico de ese cambio de criterio en el proceso. Un informe que dice percentil noventa y cinco en ciento ochenta milisegundos no permite ninguna decisión de negocio. Un informe que dice punto de saturación en mil doscientas peticiones por segundo, pico de producción en cuatrocientas cincuenta, margen de dos coma siete veces, y rendimiento útil del setenta y cuatro por ciento al ciento cincuenta por ciento de la saturación, permite decidir sobre campaña, sobre capacidad y sobre prioridad de corrección sin ninguna traducción adicional.',
        },
      ],
    },
    {
      title: 'La secuencia que convierte el ensayo en evidencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Reescribir el ensayo entero de una vez suele atascarse antes del primer resultado. La secuencia de abajo entrega valor en cada paso y puede interrumpirse en cualquier punto sin perder lo ya hecho, lo que importa porque cada paso muestra algo nuevo y justifica el siguiente.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumenta la omisión antes de cambiar nada. Añade el instante agendado a las mediciones del ensayo actual y publica la razón entre los dos percentiles. Si supera dos, ya sabes que todos los informes anteriores subestimaban la latencia, y eso solo suele bastar para autorizar el resto del trabajo.',
            'Cambia el intervalo constante por el exponencial. Son tres líneas y la tasa media no cambia, así que la comparación con ensayos anteriores sigue siendo válida. Espera ver subir el percentil noventa y nueve sin que nada haya empeorado: lo que cambió es que ahora se está midiendo.',
            'Corrige la cardinalidad de los datos antes de cualquier ajuste de infraestructura. Extrae la distribución real de identificadores de un día de log de producción y alimenta el generador con ella. Sin ese paso, toda medición de base y de caché del ensayo es ficción, y optimizar sobre ella desperdicia semanas.',
            'Encuentra el punto de saturación con un ensayo de escalón. Sube en peldaños de cinco minutos hasta que el rendimiento útil deje de crecer, y registra ese número junto al pico real de producción de los últimos noventa días. La razón entre ambos es tu margen, y es el primer número del nuevo informe.',
            'Ejecuta un ensayo de ráfaga a cuatro veces la media durante treinta segundos. Mide el tiempo de recuperación tras el fin de la ráfaga. Esa es la prueba que revela reintento sin límite y cola sin techo, y tarda cinco minutos en correr.',
            'Solo entonces ejecuta la resistencia de cuatro horas al setenta por ciento de la capacidad, con dos por ciento de fallo inyectado en las dependencias. Es el ensayo más caro en tiempo de reloj y el único que encuentra fugas, y debe correr de madrugada una vez por semana, no en cada petición de cambio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer paso es el que más resistencia genera y el que más cambia el resultado. Generar datos sintéticos con cien clientes es rápido y da un ensayo que corre en cualquier portátil; extraer la distribución real de un log de producción exige una conversación sobre acceso a datos y cuidado de anonimización. La diferencia de resultado es demasiado grande para ignorarla: con cien clientes la tasa de acierto de la caché queda en el noventa y nueve por ciento y la base apenas se ejercita, y es justamente la base la que se rompe en producción. Una alternativa aceptable cuando el acceso al log es inviable es reproducir solo la forma de la distribución, manteniendo la cola larga de identificadores raros aunque los valores sean generados.',
        },
        {
          type: 'paragraph',
          value:
            'Sobre la frecuencia, la división que funciona en la práctica es poner escalón y ráfaga en el flujo de entrega, porque juntos tardan menos de treinta minutos y detectan regresión de capacidad en cada cambio, y dejar resistencia y caos en agenda semanal nocturna. Intentar correr los cuatro en cada cambio hace que el equipo apague la prueba entera en dos semanas, y un ensayo apagado encuentra todavía menos que un ensayo que miente.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Tengo que cambiar la herramienta de prueba de carga que ya uso para corregir la omisión coordinada?',
      answer:
        'En la mayoría de los casos no, y conviene verificarlo antes de proponer una migración que suele costar semanas. Algunas herramientas modernas ya implementan la corrección y exponen las dos mediciones con nombres distintos, siendo una el tiempo desde el agendamiento y otra el tiempo desde el envío efectivo; en esos casos el trabajo es solo descubrir qué métrica está publicando tu informe, y la respuesta frecuente es que el panel por defecto muestra la equivocada porque es la más bonita. Otras herramientas soportan un modo de llegada con tasa fija, a veces llamado tasa constante o ejecutor de llegada, que es justamente el generador de lazo abierto; activar ese modo suele ser un cambio de pocas líneas en la configuración del escenario, y el principal cuidado es dimensionar con holgura el número de trabajadores preasignados, porque si el generador se queda sin trabajador disponible vuelve a coordinarse con el servicio y el problema regresa con otro nombre. Cuando la herramienta no ofrece ninguna de las dos cosas, todavía existe una corrección aproximada que no exige cambio: registrar el cronograma pretendido en paralelo y, en el análisis, reconstituir las mediciones ausentes asignando a cada petición que debía haber salido durante una pausa la espera correspondiente. Es menos preciso que medir de verdad, pero es órdenes de magnitud mejor que publicar un percentil que omitió justamente los peores casos. El criterio para decidir migrar es el factor de omisión medido: por debajo de uno coma tres la herramienta actual está manteniendo el cronograma y no hay motivo para cambiar nada.',
    },
    {
      question: '¿Cómo probar carga contra dependencias externas que no controlo y que tienen límite de tasa?',
      answer:
        'La respuesta depende de qué pregunta estás haciendo, y mezclar las dos preguntas en un solo ensayo es el error más común en esta situación. Si la pregunta es sobre la capacidad de tu propio servicio, la dependencia externa debe sustituirse por un doble que responda con su distribución de latencia real, extraída de tus propias trazas de producción, incluyendo la cola y no solo la mediana; un doble que responde siempre en diez milisegundos vuelve inútil el ensayo precisamente porque elimina la fuente de cola. Si la pregunta es sobre el comportamiento de tu servicio cuando la dependencia se degrada o rechaza, entonces el doble tiene que ser programable para reproducir sus modos de fallo reales: devolver cuatrocientos veintinueve con cabecera de espera, devolver quinientos tres, dejar de responder sin cerrar la conexión, y devolver éxito con diez segundos de latencia, que es el modo más cruel porque no dispara ningún manejo de error. Probar contra el entorno de pruebas del proveedor rara vez responde alguna de las dos preguntas, porque el dimensionamiento y los límites de ese entorno no son los de producción, y acabas midiendo la infraestructura de pruebas de otra empresa. Hay un tercer caso que merece cuidado: cuando la dependencia externa es el cuello de botella real, el punto de saturación de tu servicio lo define ella y no tú, y el ensayo debe dejarlo explícito en el informe, porque la corrección no es escalar tu aplicación sino negociar límites, adoptar caché o cambiar el patrón de llamada.',
    },
    {
      question: '¿Vale la pena probar carga en producción, y cómo hacerlo sin causar el incidente que se quiere evitar?',
      answer:
        'Vale la pena, y para varias de las seis diferencias listadas en el artículo es la única forma de obtener una respuesta fiable, porque el estado acumulado, la concurrencia con trabajos por lotes y el comportamiento real de las dependencias no son reproducibles en un entorno separado sin un coste que casi ninguna empresa acepta pagar. Lo que vuelve segura la práctica son cuatro controles aplicados juntos, y la ausencia de cualquiera de ellos es lo que produce las historias de terror que dan mala fama a la técnica. El primero es el marcado de tráfico sintético que atraviesa toda la cadena de llamadas, para que ningún dato de prueba entre en facturación, en informes de negocio o en entrenamiento de modelos, y para que el equipo de guardia distinga de inmediato carga sintética de carga real al mirar una alerta. El segundo es un interruptor de apagado accionable en segundos por cualquier persona de guardia, sin depender de un despliegue nuevo, porque la decisión de abortar debe ser más rápida que la formación de la cola. El tercero es abortar automáticamente por indicadores de servicio real y no por métricas del propio ensayo, típicamente deteniéndose cuando la latencia del tráfico orgánico cruza un umbral o cuando el presupuesto de error del período empieza a consumirse. El cuarto es empezar con una fracción pequeña y crecer despacio, algo como un uno por ciento del tráfico en ventana de baja y duplicando tras cada ensayo exitoso a lo largo de semanas. Con esos cuatro controles, el ensayo en producción responde preguntas que ningún entorno de pruebas responde; sin ellos, es solo un incidente agendado.',
    },
  ],
  conclusion: {
    title: 'El ensayo que nunca falla no está aprobando el sistema, se está aprobando a sí mismo',
    description:
      'Una prueba de carga que siempre pasa no es señal de sistema robusto, es señal de ensayo que no encuentra nada. El lazo cerrado reduce la presión cuando el servicio se degrada, la omisión coordinada borra del informe justamente las mediciones malas, el intervalo constante elimina la formación de cola, los datos sintéticos esconden la base y cinco minutos de duración son demasiado poco para cualquier fuga. Cambiar el criterio de umbral de latencia por punto de saturación y margen, y publicar el factor de omisión junto a cada percentil, convierte un informe decorativo en evidencia utilizable para decidir sobre campaña y capacidad. Puedo revisar tu ensayo actual, medir cuánto está subestimando la latencia hoy, reconstruir el generador en lazo abierto con datos de cardinalidad real y entregar el punto de saturación y el margen de tu servicio.',
    cta: 'Revisar la prueba de carga de mi servicio',
  },
  related: [
    {
      label: 'Agotamiento de puertos efímeros: cuándo el servidor deja de abrir conexiones salientes',
      to: '/blog/esgotamento-porta-efemera-servidor-para-de-abrir-conexao-de-saida',
    },
    {
      label: 'Límite de conexiones de la base agotado: cuándo el pool se vuelve el cuello de botella',
      to: '/blog/limite-conexoes-banco-esgotado-pool-vira-gargalo-do-servico',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
