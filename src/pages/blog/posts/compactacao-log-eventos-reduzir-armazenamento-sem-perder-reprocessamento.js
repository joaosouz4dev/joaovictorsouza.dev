// Conteudo do artigo: compactacao de log de eventos e como reduzir
// armazenamento sem perder a capacidade de reprocessar do zero.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O tópico de eventos passou de quatrocentos gigabytes para dois terabytes em sete meses e a conta de armazenamento deixou de ser detalhe de rodapé. Alguém propôs a solução óbvia: reduzir a retenção de trinta dias para sete. A proposta foi aprovada numa quinta-feira, aplicada na sexta, e na terça seguinte o time descobriu que o serviço de recomendação não conseguia mais reconstruir o próprio estado depois de um bug de cálculo, porque os eventos que ele precisava reler tinham vinte e dois dias. Este artigo mostra por que retenção por tempo e compactação por chave resolvem problemas diferentes e por que trocar uma pela outra é o erro mais caro dessa área, o que a compactação garante de verdade e o que ela destrói para sempre, por que a lápide é o único jeito de apagar uma chave e por que ela tem prazo de validade, como calcular a taxa de compactação real do seu tópico antes de ligar qualquer coisa, por que a chave do evento deixa de ser detalhe de particionamento e vira decisão de retenção, qual é a topologia de dois tópicos que preserva auditoria e reprocessamento ao mesmo tempo, e quais indicadores mostram que a compactação parou de funcionar antes de o disco encher.',
  sections: [
    {
      title: 'Retenção por tempo e compactação por chave não são a mesma alavanca',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusão começa porque as duas políticas aparecem lado a lado na mesma tela de configuração e as duas reduzem o tamanho do tópico. A semelhança termina aí. A retenção por tempo apaga segmentos inteiros com base na idade: passados os sete dias, tudo o que estava naquele arquivo some, sem que ninguém olhe o conteúdo. A compactação por chave preserva o último valor conhecido de cada chave para sempre e descarta apenas as versões anteriores daquela mesma chave. A primeira é uma política de esquecimento cronológico, a segunda é uma política de deduplicação por identidade.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que as duas respondem a perguntas diferentes. Com retenção por tempo, a pergunta que o tópico responde é: o que aconteceu nos últimos N dias. Com compactação, a pergunta é: qual é o estado atual de cada entidade. Um serviço que precisa reconstruir um saldo somando todos os lançamentos depende da primeira. Um serviço que precisa saber apenas o endereço atual de cada cliente depende da segunda, e ficaria satisfeito com um tópico compactado de um centésimo do tamanho.',
        },
        {
          type: 'paragraph',
          value:
            'O erro do incidente descrito na abertura foi tratar as duas como intercambiáveis porque ambas apareciam como formas de reduzir disco. Reduzir a janela de retenção destruiu a capacidade de reprocessar, que era a propriedade que o time achava que estava comprando. Ligar compactação naquele tópico teria sido igualmente destrutivo por outro caminho: o histórico de lançamentos teria virado um saldo por conta, e a auditoria exigida em contrato sumiria em silêncio, sem nenhum erro, sem nenhum alerta, apenas com números que deixam de bater três meses depois.',
        },
        {
          type: 'table',
          columns: ['Propriedade', 'Retenção por tempo', 'Compactação por chave', 'Consequência prática'],
          rows: [
            [
              'Critério de descarte',
              'Idade do segmento, independentemente do conteúdo',
              'Existência de versão mais recente da mesma chave',
              'Compactar não libera espaço em tópico de chaves únicas',
            ],
            [
              'O que fica garantido',
              'Todo evento dentro da janela, inclusive os intermediários',
              'O último valor de cada chave, sem garantia dos anteriores',
              'Só a retenção permite recontar a partir do zero',
            ],
            [
              'O que se perde',
              'Tudo o que é mais antigo que a janela',
              'Todas as transições intermediárias de cada chave',
              'Compactação destrói a trilha de auditoria de mudança',
            ],
            [
              'Tamanho em regime permanente',
              'Proporcional à taxa de eventos vezes a janela',
              'Proporcional ao número de chaves distintas',
              'Compactação limita crescimento, retenção limita idade',
            ],
            [
              'Eventos sem chave',
              'Tratados como qualquer outro',
              'Nunca removidos, acumulam indefinidamente',
              'Um produtor esquecido sem chave anula a economia toda',
            ],
            [
              'Apagar uma entidade',
              'Acontece sozinho quando a janela passa',
              'Exige lápide explícita e só depois some',
              'Direito ao esquecimento vira trabalho de aplicação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quinta linha é a que produz o maior número de decepções em produção. Um tópico compactado onde metade dos produtores emite eventos sem chave não encolhe pela metade: ele encolhe apenas na parte com chave e continua crescendo linearmente na outra, porque o núcleo do mecanismo não tem nenhum critério para comparar dois registros sem identidade. O gráfico de tamanho depois de ligar a compactação fica com um degrau para baixo seguido da mesma inclinação de antes, e o time conclui erroneamente que a compactação não funciona.',
        },
      ],
    },
    {
      title: 'O que a compactação garante é mais fraco do que a maioria assume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A garantia formal da compactação tem uma redação estreita e vale a pena enunciá-la com precisão, porque quase todo bug de arquitetura nessa área nasce de assumir mais do que ela promete. A garantia é: qualquer consumidor que leia o tópico do início até o fim verá, no mínimo, o último valor escrito para cada chave. Não está prometido que ele verá apenas esse valor, nem que ele verá os valores intermediários, nem que dois consumidores que leiam em momentos diferentes verão a mesma sequência.',
        },
        {
          type: 'paragraph',
          value:
            'Três consequências saem direto dessa redação. A primeira é que o consumidor precisa ser idempotente por construção, porque ele pode receber a mesma chave várias vezes: o segmento ativo ainda não foi compactado e pode conter três versões da mesma chave que uma releitura futura já não terá. A segunda é que qualquer lógica que dependa da sequência de transições de uma entidade está proibida de rodar sobre tópico compactado, porque a sequência é exatamente o que foi descartado. A terceira é que o resultado de um reprocessamento deixa de ser determinístico entre execuções: reprocessar hoje e reprocessar amanhã pode produzir históricos diferentes para a mesma entidade, mesmo sem nenhuma escrita nova, porque a compactação rodou no meio.',
        },
        {
          type: 'paragraph',
          value:
            'Essa terceira consequência é a que costuma quebrar times que usam o log como fonte de verdade para cálculos financeiros ou para modelos treinados a partir de histórico. Um relatório reconstruído em janeiro e reconstruído de novo em março sobre o mesmo tópico compactado não bate, e a diferença não aparece como erro em lugar nenhum: os dois valores estão corretos em relação ao que o tópico continha no momento de cada leitura. A investigação desse tipo de divergência costuma consumir semanas antes de alguém suspeitar da política de retenção.',
        },
        {
          type: 'diagram',
          value: `Topico com particao unica, chaves A, B e C

Antes da compactacao (offsets 0 a 8):
  off 0  A=10
  off 1  B=20
  off 2  A=11      <- versao intermediaria de A
  off 3  C=30
  off 4  A=12      <- versao intermediaria de A
  off 5  B=21      <- versao intermediaria de B
  off 6  A=13      <- ultimo valor de A
  off 7  B=22      <- ultimo valor de B
  off 8  C=31      <- ultimo valor de C   [segmento ativo]

Depois da compactacao dos segmentos fechados (0 a 7):
  off 6  A=13
  off 7  B=22
  off 8  C=31      [segmento ativo, nunca compactado]

O que sobrevive: o ultimo valor de cada chave.
O que some: A=10, A=11, A=12, B=20, B=21, C=30.
Os offsets NAO sao renumerados: 0 a 5 simplesmente nao existem mais.
Um consumidor que peca o offset 3 recebe o proximo offset existente.`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe dos offsets no fim do diagrama tem consequência operacional direta. Como a compactação abre buracos na sequência sem renumerar nada, qualquer código que assuma continuidade de offsets para calcular atraso, para estimar quantidade de mensagens pendentes ou para dividir trabalho entre consumidores vai produzir números errados em tópico compactado. A diferença entre o maior offset e o offset atual do consumidor deixa de ser a quantidade de mensagens a processar e passa a ser um limite superior que pode estar ordens de magnitude acima do valor real.',
        },
      ],
    },
    {
      title: 'Apagar uma chave exige lápide, e a lápide tem prazo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Num tópico compactado a ausência de novidade significa permanência: o último valor de cada chave fica lá indefinidamente, e nenhuma passagem de tempo o remove. Isso cria um problema específico quando a entidade deixa de existir, seja porque o cliente foi excluído, porque o produto saiu do catálogo ou porque uma requisição de exclusão de dados pessoais precisa ser honrada. O mecanismo para isso é a lápide: um registro com a chave preenchida e o valor nulo, que a compactação interpreta como instrução de remover a chave inteira.',
        },
        {
          type: 'paragraph',
          value:
            'A parte que surpreende é que a lápide não some imediatamente e também não fica para sempre. Ela precisa permanecer visível por tempo suficiente para que todo consumidor que esteja lendo o tópico veja a instrução de apagar, e depois precisa ela mesma ser removida, senão o tópico acumularia uma lápide por entidade excluída até o fim dos tempos. Existe portanto uma janela de retenção específica para lápides, tipicamente configurada em vinte e quatro horas, e essa janela cria um risco silencioso: um consumidor que fique parado mais tempo do que ela, por um incidente longo, por um fim de semana prolongado ou por um processo de reconstrução demorado, volta a ler o tópico e nunca vê a lápide. Ele mantém no próprio estado uma entidade que foi deliberadamente apagada da origem.',
        },
        {
          type: 'code',
          value: `// Producao de lapide e verificacao de janela antes de confiar na exclusao.
// A lapide so cumpre o papel se todos os consumidores leem dentro da janela.

/**
 * Emite a lapide que instrui a compactacao a remover a chave por completo.
 * O valor precisa ser nulo de verdade, nao string vazia nem objeto vazio:
 * a comparacao feita pelo compactador e com ausencia de payload.
 */
async function emitirLapide(produtor, topico, chave) {
  await produtor.send({
    topic: topico,
    messages: [{ key: chave, value: null }],
  });
}

/**
 * Verifica se e seguro confiar na lapide, comparando o atraso de cada grupo
 * consumidor com a janela de retencao de lapides do topico.
 *
 * @param {Array<{grupo: string, atrasoMs: number}>} gruposConsumidores
 * @param {number} janelaLapideMs retencao configurada para lapides
 * @param {number} margem fracao da janela reservada como folga (0.5 = metade)
 */
function avaliarSegurancaDaExclusao(gruposConsumidores, janelaLapideMs, margem = 0.5) {
  const limiteSeguro = janelaLapideMs * margem;

  const emRisco = gruposConsumidores.filter((g) => g.atrasoMs > limiteSeguro);

  return {
    seguro: emRisco.length === 0,
    limiteSeguroMs: limiteSeguro,
    // Grupos que podem nunca ver a lapide: precisam de reconstrucao completa
    // a partir de um snapshot, e nao de leitura incremental.
    gruposQuePrecisamReconstruir: emRisco.map((g) => g.grupo),
  };
}

// Uso tipico dentro do fluxo de exclusao de dados pessoais.
async function excluirEntidade({ produtor, topico, chave, gruposConsumidores, janelaLapideMs }) {
  const avaliacao = avaliarSegurancaDaExclusao(gruposConsumidores, janelaLapideMs);

  await emitirLapide(produtor, topico, chave);

  if (!avaliacao.seguro) {
    // A exclusao foi registrada, mas nao esta comprovada ponta a ponta.
    // O registro abaixo e o que transforma um risco invisivel em tarefa.
    return {
      lapideEmitida: true,
      exclusaoComprovada: false,
      acaoNecessaria: 'reconstruir estado dos grupos atrasados a partir de snapshot',
      grupos: avaliacao.gruposQuePrecisamReconstruir,
    };
  }

  return { lapideEmitida: true, exclusaoComprovada: true };
}

export { emitirLapide, avaliarSegurancaDaExclusao, excluirEntidade };`,
        },
        {
          type: 'paragraph',
          value:
            'A função de avaliação existe porque a diferença entre uma exclusão registrada e uma exclusão comprovada é exatamente o tipo de coisa que ninguém percebe até uma auditoria perguntar. Emitir a lápide é trivial e sempre funciona do lado do produtor. Garantir que cada consumidor aplicou a remoção é um problema distribuído que depende do atraso de cada grupo, e a única forma honesta de tratá-lo é medir esse atraso no momento da exclusão e escalar para reconstrução completa quem estiver fora da janela.',
        },
        {
          type: 'paragraph',
          value:
            'Há ainda uma armadilha de implementação frequente o bastante para merecer menção explícita: emitir a lápide com valor de string vazia, com objeto vazio ou com um payload marcado como excluído não produz remoção nenhuma. Qualquer um desses casos é, para o compactador, um valor válido e recente como qualquer outro, e a chave permanece no tópico para sempre com esse conteúdo. O valor precisa ser nulo no sentido de ausência de payload, e vale verificar isso no serializador, porque várias bibliotecas convertem nulo para bytes vazios em silêncio.',
        },
      ],
    },
    {
      title: 'A economia real depende da razão entre eventos e chaves distintas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de ligar compactação em qualquer tópico vale calcular quanto ela vai economizar, porque o resultado varia entre noventa e oito por cento e zero dependendo de uma única razão: quantos eventos existem por chave distinta. Um tópico de atualização de posição de entregador, onde cada entregador emite um evento a cada cinco segundos, tem uma razão altíssima e compacta maravilhosamente. Um tópico de pedidos criados, onde cada pedido aparece exatamente uma vez com identificador único, tem razão igual a um e compacta exatamente nada, além de ficar mais caro porque o processo de compactação passa a consumir processador e memória sem devolver espaço.',
        },
        {
          type: 'paragraph',
          value:
            'A conta precisa considerar também que o segmento ativo nunca é compactado e que a maioria das configurações só compacta quando a proporção de registros obsoletos ultrapassa um limiar. O tamanho em regime permanente, portanto, não é o número de chaves vezes o tamanho médio do registro: é isso mais o segmento ativo mais a margem tolerada pelo limiar, e esses dois adicionais costumam responder por uma fração relevante do total em tópicos de volume alto.',
        },
        {
          type: 'code',
          value: `// Estimativa de economia antes de ligar compactacao em um topico existente.
// Roda sobre uma amostra de offsets, nao sobre o topico inteiro.

/**
 * @param {object} p
 * @param {number} p.eventosNaAmostra     quantidade de registros lidos
 * @param {number} p.chavesDistintas      chaves unicas encontradas na amostra
 * @param {number} p.eventosSemChave      registros sem chave na amostra
 * @param {number} p.tamanhoAtualBytes    tamanho atual do topico em disco
 * @param {number} p.segmentoAtivoBytes   tamanho do segmento ativo por particao
 * @param {number} p.particoes            numero de particoes do topico
 * @param {number} p.limiarSujeira        fracao obsoleta tolerada antes de compactar
 */
export function estimarEconomiaDeCompactacao({
  eventosNaAmostra,
  chavesDistintas,
  eventosSemChave,
  tamanhoAtualBytes,
  segmentoAtivoBytes,
  particoes,
  limiarSujeira = 0.5,
}) {
  const comChave = eventosNaAmostra - eventosSemChave;
  const eventosPorChave = comChave / Math.max(chavesDistintas, 1);

  // Registros sem chave nunca sao removidos: eles sobrevivem inteiros.
  const fracaoSemChave = eventosSemChave / eventosNaAmostra;
  const bytesSemChave = tamanhoAtualBytes * fracaoSemChave;

  // Da parte com chave, sobrevive apenas o ultimo valor de cada chave,
  // extrapolado da amostra para a proporcao do topico inteiro.
  const fracaoComChave = 1 - fracaoSemChave;
  const bytesComChaveApos =
    eventosPorChave > 0 ? (tamanhoAtualBytes * fracaoComChave) / eventosPorChave : 0;

  // O segmento ativo de cada particao nunca entra na compactacao.
  const bytesSegmentoAtivo = segmentoAtivoBytes * particoes;

  // O compactador so roda quando a sujeira passa do limiar, entao em regime
  // permanente sobra sempre essa fracao de registros obsoletos no disco.
  const bytesUteis = bytesSemChave + bytesComChaveApos;
  const bytesSujeiraTolerada = bytesUteis * (limiarSujeira / (1 - limiarSujeira));

  const tamanhoEstimado = bytesUteis + bytesSujeiraTolerada + bytesSegmentoAtivo;
  const economia = 1 - tamanhoEstimado / tamanhoAtualBytes;

  return {
    eventosPorChave: Number(eventosPorChave.toFixed(2)),
    tamanhoEstimadoBytes: Math.round(tamanhoEstimado),
    economiaPercentual: Number((economia * 100).toFixed(1)),
    // Abaixo de tres eventos por chave a compactacao custa mais em
    // processamento do que devolve em disco.
    valeAPena: eventosPorChave >= 3 && economia > 0.2,
    alertaSemChave:
      fracaoSemChave > 0.1
        ? 'mais de dez por cento dos registros nao tem chave e nunca serao removidos'
        : null,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O limiar de três eventos por chave no retorno da função não é arbitrário: abaixo dele, o trabalho de leitura, construção do mapa de chaves e reescrita dos segmentos custa mais processador e memória do que o espaço economizado justifica, e em disco de custo baixo essa troca raramente compensa. O alerta sobre registros sem chave está ali porque é o diagnóstico mais frequente para a pergunta que aparece semanas depois: por que o tópico compactado continua crescendo.',
        },
      ],
    },
    {
      title: 'A chave do evento deixa de ser detalhe de roteamento e vira política de retenção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em um tópico com retenção por tempo, a chave serve para uma coisa só: decidir em qual partição o registro cai, e com isso garantir ordem entre eventos da mesma entidade. Escolher a chave errada nesse cenário produz desequilíbrio de partição, que é um problema de desempenho, incômodo mas reversível. Em um tópico compactado a mesma escolha determina a granularidade do que sobrevive, e isso não é reversível: o que foi descartado por uma chave grosseira demais não volta.',
        },
        {
          type: 'paragraph',
          value:
            'O caso mais comum é o de um tópico de mudança de status de pedido. Se a chave for o identificador do pedido, a compactação preserva apenas o status atual de cada pedido, e a pergunta quanto tempo um pedido ficou em separação fica sem resposta para sempre. Se a chave for a combinação de pedido e status, cada transição vira uma chave própria, todas sobrevivem, e o tópico deixa de encolher de forma relevante porque a razão entre eventos e chaves cai para perto de um. As duas escolhas são defensáveis, mas elas compram coisas opostas, e a decisão precisa ser tomada olhando para as consultas que o sistema precisa responder e não para o tamanho do disco.',
        },
        {
          type: 'table',
          columns: ['Chave escolhida', 'O que sobrevive à compactação', 'Pergunta que continua respondível', 'Pergunta que se perde'],
          rows: [
            [
              'Identificador do pedido',
              'Um registro por pedido, com o status atual',
              'Qual é o status de cada pedido agora',
              'Quanto tempo ficou em cada etapa',
            ],
            [
              'Pedido mais status',
              'Um registro por transição ocorrida',
              'Quais etapas cada pedido percorreu e quando',
              'Nenhuma, mas quase não há economia de espaço',
            ],
            [
              'Identificador do cliente',
              'Apenas o último pedido de cada cliente',
              'Qual foi a última compra de cada cliente',
              'Todo o histórico de pedidos anteriores',
            ],
            [
              'Pedido mais dia',
              'Um registro por pedido por dia de atividade',
              'Como o pedido evoluiu em granularidade diária',
              'Transições múltiplas dentro do mesmo dia',
            ],
            [
              'Sem chave',
              'Tudo, indefinidamente',
              'Todas',
              'Nenhuma, e o tópico nunca encolhe',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha merece atenção porque é a solução intermediária que raramente é considerada e que resolve bem uma classe inteira de casos. Compor a chave com um recorte temporal converte a compactação de deduplicação total em amostragem por período: preserva-se o estado de cada entidade ao fim de cada dia, o que basta para a maioria das análises de evolução, e descarta-se o ruído de alta frequência dentro do período. O custo em espaço é o número de chaves multiplicado pelo número de dias de atividade, o que costuma ser uma ordem de magnitude menor do que guardar tudo e uma ordem maior do que guardar só o estado atual.',
        },
      ],
    },
    {
      title: 'A topologia de dois tópicos resolve a tensão entre auditoria e estado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o mesmo fluxo precisa simultaneamente servir de trilha de auditoria completa e de fonte de estado atual, nenhuma política única atende, porque as exigências são contraditórias por construção. A saída é parar de tentar configurar um tópico para fazer as duas coisas e separar os papéis em dois tópicos com políticas próprias, alimentados pelo mesmo produtor ou por uma transformação entre eles.',
        },
        {
          type: 'diagram',
          value: `                    +---------------------+
   produtor ------> | pedidos.eventos     |  retencao por tempo: 30 dias
                    | (log completo)      |  todas as transicoes
                    +----------+----------+
                               |
                               | transformacao: extrai ultimo estado
                               v
                    +---------------------+
                    | pedidos.estado      |  compactado, sem retencao
                    | (chave = pedidoId)  |  um registro por pedido
                    +----------+----------+
                               |
              +----------------+----------------+
              v                                 v
    +-------------------+             +-------------------+
    | servico de busca  |             | painel operacional|
    | reconstroi do zero|             | le so o atual     |
    +-------------------+             +-------------------+

   Arquivamento frio (fora do broker):
   pedidos.eventos --> objeto em armazenamento barato, particionado por dia
                       retencao de anos, leitura rara, custo por gigabyte
                       de uma a duas ordens de magnitude menor

   Reprocessamento historico le do arquivo frio, nao do broker.
   Reprocessamento recente le de pedidos.eventos, dentro dos 30 dias.
   Inicializacao de servico novo le de pedidos.estado, em minutos.`,
        },
        {
          type: 'paragraph',
          value:
            'Essa topologia resolve três problemas de uma vez. O tópico de eventos mantém a janela de reprocessamento que o time realmente usa no dia a dia, que quase sempre é de dias e não de anos, e paga armazenamento caro de broker apenas por essa janela. O tópico compactado dá a qualquer serviço novo uma forma de chegar ao estado atual em minutos em vez de horas, porque ele lê um registro por entidade em vez de todo o histórico. E o arquivamento frio preserva o histórico completo para auditoria e para reprocessamento raro, num armazenamento cujo custo por gigabyte é uma a duas ordens de magnitude menor do que o do broker.',
        },
        {
          type: 'ordered',
          items: [
            'Medir a razão entre eventos e chaves distintas em uma amostra do tópico atual, para saber se a compactação tem algo a economizar antes de qualquer mudança de configuração.',
            'Inventariar os consumidores e classificar cada um como dependente de histórico ou dependente apenas de estado atual, porque essa lista define quais precisam do tópico de eventos e quais podem migrar para o compactado.',
            'Criar o tópico compactado novo em vez de mudar a política do existente, já que a mudança de política é destrutiva e não tem volta.',
            'Escrever a transformação que alimenta o tópico compactado a partir do de eventos, validando que a chave escolhida preserva a granularidade que os consumidores de estado precisam.',
            'Ligar o arquivamento frio e verificar que um reprocessamento a partir do arquivo produz o mesmo resultado que um reprocessamento a partir do broker, antes de reduzir qualquer retenção.',
            'Só então reduzir a retenção do tópico de eventos, em um passo por vez, monitorando o atraso máximo dos consumidores a cada redução.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A ordem dos passos importa mais do que o conteúdo de cada um. A redução de retenção é o único passo irreversível da lista e por isso é o último, depois de a rota alternativa de reprocessamento já estar validada em execução real e não apenas planejada. O erro do incidente da abertura foi executar exclusivamente esse passo, que é o único que aparece como uma linha de configuração e por isso parece o mais barato.',
        },
        {
          type: 'list',
          items: [
            'Atraso máximo por grupo consumidor comparado com a janela de retenção de lápides: quando o primeiro passa de metade da segunda, exclusões deixam de ser comprovadas ponta a ponta.',
            'Proporção de registros obsoletos por partição: se ela não volta para baixo do limiar depois de um ciclo, o compactador não está dando conta do volume e o tópico vai crescer sem limite.',
            'Fração de registros sem chave produzidos no tópico compactado: qualquer valor acima de um por cento indica produtor novo mal configurado e anula a economia esperada.',
            'Idade do registro mais antigo por partição no tópico de eventos, comparada com a janela contratada de reprocessamento: é esse número, e não a configuração, que diz até onde dá para voltar hoje.',
            'Tempo de inicialização de um consumidor a partir do zero no tópico compactado: o crescimento desse número é o primeiro sinal de que a razão entre eventos e chaves mudou.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Dá para ligar compactação em um tópico que já existe e está em produção, ou é preciso criar outro?',
      answer:
        'Tecnicamente dá, e é uma linha de configuração, e é exatamente por isso que essa mudança causa tanto dano. Assim que a política passa a incluir compactação, o compactador começa a processar os segmentos fechados já existentes, e todas as versões intermediárias de cada chave que estavam ali são descartadas de forma definitiva e sem confirmação. Não existe modo de simulação, não existe desfazer, e a única recuperação possível é a partir de um arquivamento externo que precisa ter sido criado antes. Por isso a recomendação prática é sempre criar um tópico novo com a política desejada e alimentar esse tópico a partir do original, mesmo quando isso significa manter os dois lado a lado por algumas semanas pagando armazenamento em dobro. O custo de manter o dobro por um mês é sempre menor do que o custo de descobrir, dois meses depois, que uma análise que ninguém tinha mapeado dependia do histórico intermediário. Existe uma exceção razoável: tópicos que já nasceram como projeção de estado, onde todo consumidor sempre leu apenas o valor atual e onde nenhum relatório histórico jamais foi construído a partir deles. Mesmo nesse caso vale executar antes a estimativa de economia, porque se a razão entre eventos e chaves for baixa a mudança traz o risco todo sem trazer o benefício. E vale documentar a mudança com data e responsável, porque quando alguém perguntar por que os dados antes daquela data têm granularidade diferente, essa anotação é a única resposta que vai existir.',
    },
    {
      question: 'Como fazer reprocessamento histórico depois que a retenção do broker foi reduzida?',
      answer:
        'A resposta curta é que o reprocessamento histórico deixa de sair do broker e passa a sair do arquivamento frio, e essa mudança precisa ser projetada e testada antes da redução da retenção, não depois. O desenho que funciona bem tem três partes. A primeira é o arquivamento contínuo: um consumidor dedicado que lê o tópico de eventos e escreve blocos em armazenamento de objetos, particionados por dia e por partição de origem, em formato colunar comprimido, o que costuma render uma redução de cinco a dez vezes em relação ao formato do broker e permite leitura seletiva por intervalo de data sem varrer tudo. A segunda é a camada de leitura unificada: uma biblioteca compartilhada que recebe um intervalo de tempo e decide sozinha se lê do arquivo frio, do broker, ou dos dois em sequência costurando o ponto de junção, para que o código de reprocessamento seja idêntico independentemente de onde o dado está. Essa camada é o que evita que cada time reimplemente a lógica de junção com um erro sutil diferente. A terceira é o teste de equivalência recorrente: um trabalho agendado que reprocessa uma janela que existe nos dois lugares e compara os resultados registro a registro, o que transforma uma suposição em verificação e detecta problemas de serialização, de fuso horário e de limite de partição antes que eles apareçam durante um incidente. Sobre desempenho, vale ajustar a expectativa: um reprocessamento a partir de armazenamento de objetos é tipicamente mais lento por registro do que a partir do broker, mas paraleliza muito melhor por ser leitura de arquivos independentes, então com dez leitores concorrentes costuma terminar antes.',
    },
    {
      question: 'Compactação ajuda ou atrapalha uma requisição de exclusão de dados pessoais?',
      answer:
        'Ajuda em um ponto específico e atrapalha em três, e a conta líquida depende de como o tópico foi desenhado. Ajuda porque a lápide dá um mecanismo explícito e verificável de remoção por chave, que em um tópico com retenção por tempo simplesmente não existe: lá a única forma de apagar um registro específico é reescrever o tópico inteiro ou esperar a janela passar. Atrapalha na primeira frente porque a remoção não é imediata nem tem prazo determinístico, já que ela só se concretiza quando o compactador processa aquele segmento, o que depende do limiar de sujeira e do volume de escrita, e pode levar de minutos a dias, o que é incompatível com um prazo legal expresso em dias corridos sem margem. Atrapalha na segunda frente por causa do segmento ativo, que nunca é compactado: se a chave a excluir teve escrita recente, o valor pessoal continua fisicamente no disco mesmo depois da lápide, até que o segmento rotacione, o que em tópico de volume baixo pode demorar. Atrapalha na terceira frente porque a lápide remove a chave mas não remove dados pessoais que estejam dentro do valor de outras chaves, e é comum um identificador ou um endereço aparecer no payload de eventos de entidades vizinhas. O desenho que resolve as três é separar o dado pessoal do fluxo de eventos desde o começo, mantendo no evento apenas um identificador opaco e guardando o dado sensível em um repositório com exclusão direta e prazo controlado. A exclusão então vira uma operação nesse repositório, imediata e comprovável, e o log de eventos permanece com identificadores que perdem qualquer capacidade de identificar alguém no momento em que a chave de referência some. Essa é a única topologia que responde com prazo confiável a uma requisição formal de exclusão.',
    },
  ],
  conclusion: {
    title: 'Compactação é uma escolha sobre qual pergunta o log continuará respondendo',
    description:
      'Reduzir armazenamento de log de eventos parece uma decisão de infraestrutura e é, na prática, uma decisão sobre quais perguntas o sistema continuará conseguindo responder daqui a um ano. Retenção por tempo e compactação por chave cortam o mesmo disco por caminhos opostos: uma apaga o passado inteiro, a outra apaga o caminho e preserva o destino. A escolha certa quase nunca é uma das duas isoladamente, e sim a topologia que separa o log de auditoria do tópico de estado e move o histórico raro para armazenamento frio antes de qualquer redução de janela. Posso levantar a razão entre eventos e chaves dos seus tópicos, mapear quais consumidores dependem de histórico e quais só precisam de estado atual, desenhar a separação e validar o reprocessamento pelo arquivo antes de tocar em qualquer configuração de retenção.',
    cta: 'Falar sobre a retenção dos meus tópicos de eventos',
  },
  related: [
    {
      label: 'Migração de fila sem perder mensagem: trocar o broker com tráfego ligado',
      to: '/blog/migracao-fila-sem-perder-mensagem-trocar-broker-com-trafego-ligado',
    },
    {
      label: 'Backup que nunca foi restaurado: transformar cópia em garantia de recuperação',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
    },
    {
      label: 'Arquitetura e Modernização Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The event topic went from four hundred gigabytes to two terabytes in seven months and the storage bill stopped being a footnote. Someone proposed the obvious fix: cut retention from thirty days to seven. The proposal was approved on a Thursday, applied on Friday, and the following Tuesday the team discovered that the recommendation service could no longer rebuild its own state after a calculation bug, because the events it needed to reread were twenty two days old. This article shows why time based retention and key based compaction solve different problems and why swapping one for the other is the most expensive mistake in this area, what compaction actually guarantees and what it destroys forever, why the tombstone is the only way to erase a key and why it has an expiry, how to compute your topic’s real compaction ratio before turning anything on, why the event key stops being a partitioning detail and becomes a retention decision, what the two topic topology that preserves audit and reprocessing at the same time looks like, and which indicators show that compaction stopped working before the disk fills up.',
  sections: [
    {
      title: 'Time based retention and key based compaction are not the same lever',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The confusion starts because both policies sit side by side on the same configuration screen and both shrink the topic. The similarity ends there. Time based retention deletes whole segments based on age: once seven days pass, everything in that file is gone without anyone looking at the contents. Key based compaction preserves the last known value of every key forever and discards only the earlier versions of that same key. The first is a policy of chronological forgetting, the second is a policy of deduplication by identity.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the two answer different questions. With time based retention, the question the topic answers is: what happened in the last N days. With compaction, the question is: what is the current state of each entity. A service that needs to rebuild a balance by summing every entry depends on the first. A service that only needs each customer’s current address depends on the second, and would be perfectly happy with a compacted topic one hundredth of the size.',
        },
        {
          type: 'paragraph',
          value:
            'The mistake in the incident described at the top was treating the two as interchangeable because both appeared as ways to reduce disk. Cutting the retention window destroyed the ability to reprocess, which was the very property the team believed it was buying. Turning compaction on in that topic would have been equally destructive by a different route: the entry history would have collapsed into a balance per account, and the audit trail required by contract would have vanished silently, with no error, no alert, only numbers that stop reconciling three months later.',
        },
        {
          type: 'table',
          columns: ['Property', 'Time based retention', 'Key based compaction', 'Practical consequence'],
          rows: [
            [
              'Discard criterion',
              'Segment age, regardless of contents',
              'Existence of a newer version of the same key',
              'Compacting frees no space in a topic of unique keys',
            ],
            [
              'What stays guaranteed',
              'Every event inside the window, intermediates included',
              'The last value of each key, with no guarantee of earlier ones',
              'Only retention lets you recount from zero',
            ],
            [
              'What gets lost',
              'Everything older than the window',
              'Every intermediate transition of each key',
              'Compaction destroys the change audit trail',
            ],
            [
              'Steady state size',
              'Proportional to event rate times the window',
              'Proportional to the number of distinct keys',
              'Compaction caps growth, retention caps age',
            ],
            [
              'Events with no key',
              'Handled like any other',
              'Never removed, they accumulate indefinitely',
              'One forgotten keyless producer cancels the whole saving',
            ],
            [
              'Deleting an entity',
              'Happens on its own once the window passes',
              'Requires an explicit tombstone and only then disappears',
              'The right to erasure becomes application work',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth row produces the largest number of disappointments in production. A compacted topic where half the producers emit events with no key does not shrink by half: it shrinks only on the keyed portion and keeps growing linearly on the other, because the core of the mechanism has no criterion for comparing two records without identity. The size graph after enabling compaction shows one step down followed by the same slope as before, and the team wrongly concludes that compaction does not work.',
        },
      ],
    },
    {
      title: 'What compaction guarantees is weaker than most people assume',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The formal guarantee of compaction has narrow wording and it is worth stating precisely, because nearly every architectural bug in this area comes from assuming more than it promises. The guarantee is: any consumer that reads the topic from beginning to end will see, at minimum, the last value written for each key. It is not promised that it will see only that value, nor that it will see the intermediate values, nor that two consumers reading at different moments will see the same sequence.',
        },
        {
          type: 'paragraph',
          value:
            'Three consequences follow directly from that wording. The first is that the consumer must be idempotent by construction, because it may receive the same key several times: the active segment has not been compacted yet and may contain three versions of the same key that a future reread will no longer have. The second is that any logic depending on the sequence of transitions of an entity is forbidden from running over a compacted topic, because the sequence is exactly what was discarded. The third is that the result of a reprocessing run stops being deterministic across executions: reprocessing today and reprocessing tomorrow can produce different histories for the same entity, with no new writes at all, because compaction ran in between.',
        },
        {
          type: 'paragraph',
          value:
            'That third consequence is the one that usually breaks teams using the log as a source of truth for financial calculations or for models trained on history. A report rebuilt in January and rebuilt again in March over the same compacted topic will not match, and the difference shows up as an error nowhere: both values are correct relative to what the topic contained at the moment of each read. Investigating that kind of divergence usually burns weeks before anyone suspects the retention policy.',
        },
        {
          type: 'diagram',
          value: `Single partition topic, keys A, B and C

Before compaction (offsets 0 to 8):
  off 0  A=10
  off 1  B=20
  off 2  A=11      <- intermediate version of A
  off 3  C=30
  off 4  A=12      <- intermediate version of A
  off 5  B=21      <- intermediate version of B
  off 6  A=13      <- last value of A
  off 7  B=22      <- last value of B
  off 8  C=31      <- last value of C   [active segment]

After compacting the closed segments (0 to 7):
  off 6  A=13
  off 7  B=22
  off 8  C=31      [active segment, never compacted]

What survives: the last value of each key.
What disappears: A=10, A=11, A=12, B=20, B=21, C=30.
Offsets are NOT renumbered: 0 to 5 simply no longer exist.
A consumer asking for offset 3 receives the next existing offset.`,
        },
        {
          type: 'paragraph',
          value:
            'The offset detail at the end of the diagram has a direct operational consequence. Because compaction opens holes in the sequence without renumbering anything, any code that assumes offset continuity to compute lag, to estimate the number of pending messages or to split work across consumers will produce wrong numbers on a compacted topic. The difference between the highest offset and the consumer’s current offset stops being the number of messages to process and becomes an upper bound that can sit orders of magnitude above the real value.',
        },
      ],
    },
    {
      title: 'Erasing a key requires a tombstone, and the tombstone has an expiry',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a compacted topic the absence of news means permanence: the last value of each key stays there indefinitely, and no passage of time removes it. That creates a specific problem when the entity ceases to exist, whether because the customer was deleted, because the product left the catalog or because a personal data erasure request has to be honored. The mechanism for this is the tombstone: a record with the key populated and the value null, which compaction interprets as an instruction to remove the entire key.',
        },
        {
          type: 'paragraph',
          value:
            'The surprising part is that the tombstone neither disappears immediately nor stays forever. It has to remain visible long enough for every consumer reading the topic to see the erase instruction, and afterwards it must itself be removed, otherwise the topic would accumulate one tombstone per deleted entity until the end of time. There is therefore a retention window specific to tombstones, typically configured at twenty four hours, and that window creates a silent risk: a consumer that stalls for longer than it, because of a long incident, an extended weekend or a slow rebuild process, comes back to read the topic and never sees the tombstone. It keeps in its own state an entity that was deliberately erased at the source.',
        },
        {
          type: 'code',
          value: `// Tombstone production and window check before trusting the deletion.
// A tombstone only does its job if every consumer reads inside the window.

/**
 * Emits the tombstone that instructs compaction to remove the key entirely.
 * The value must be truly null, not an empty string nor an empty object:
 * the comparison the compactor makes is against the absence of a payload.
 */
async function emitTombstone(producer, topic, key) {
  await producer.send({
    topic,
    messages: [{ key, value: null }],
  });
}

/**
 * Checks whether it is safe to trust the tombstone, comparing each consumer
 * group's lag against the topic's tombstone retention window.
 *
 * @param {Array<{group: string, lagMs: number}>} consumerGroups
 * @param {number} tombstoneWindowMs retention configured for tombstones
 * @param {number} margin fraction of the window kept as slack (0.5 = half)
 */
function assessDeletionSafety(consumerGroups, tombstoneWindowMs, margin = 0.5) {
  const safeLimit = tombstoneWindowMs * margin;

  const atRisk = consumerGroups.filter((g) => g.lagMs > safeLimit);

  return {
    safe: atRisk.length === 0,
    safeLimitMs: safeLimit,
    // Groups that may never see the tombstone: they need a full rebuild
    // from a snapshot rather than an incremental read.
    groupsNeedingRebuild: atRisk.map((g) => g.group),
  };
}

// Typical use inside the personal data erasure flow.
async function deleteEntity({ producer, topic, key, consumerGroups, tombstoneWindowMs }) {
  const assessment = assessDeletionSafety(consumerGroups, tombstoneWindowMs);

  await emitTombstone(producer, topic, key);

  if (!assessment.safe) {
    // The deletion was recorded but is not proven end to end.
    // The record below is what turns an invisible risk into a task.
    return {
      tombstoneEmitted: true,
      deletionProven: false,
      requiredAction: 'rebuild the state of lagging groups from a snapshot',
      groups: assessment.groupsNeedingRebuild,
    };
  }

  return { tombstoneEmitted: true, deletionProven: true };
}

export { emitTombstone, assessDeletionSafety, deleteEntity };`,
        },
        {
          type: 'paragraph',
          value:
            'The assessment function exists because the difference between a recorded deletion and a proven deletion is exactly the kind of thing nobody notices until an audit asks. Emitting the tombstone is trivial and always works on the producer side. Guaranteeing that every consumer applied the removal is a distributed problem that depends on each group’s lag, and the only honest way to handle it is to measure that lag at deletion time and escalate to a full rebuild for whoever is outside the window.',
        },
        {
          type: 'paragraph',
          value:
            'There is also an implementation trap common enough to deserve explicit mention: emitting the tombstone with an empty string value, with an empty object or with a payload flagged as deleted produces no removal at all. Each of those cases is, to the compactor, a valid and recent value like any other, and the key stays in the topic forever with that content. The value must be null in the sense of an absent payload, and it is worth verifying this at the serializer, because several libraries silently convert null into empty bytes.',
        },
      ],
    },
    {
      title: 'The real saving depends on the ratio of events to distinct keys',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before enabling compaction on any topic it is worth computing how much it will save, because the result ranges between ninety eight percent and zero depending on a single ratio: how many events exist per distinct key. A courier position update topic, where each courier emits an event every five seconds, has a very high ratio and compacts beautifully. An orders created topic, where each order appears exactly once with a unique identifier, has a ratio of one and compacts exactly nothing, while also becoming more expensive because the compaction process starts consuming processor and memory without returning space.',
        },
        {
          type: 'paragraph',
          value:
            'The calculation also has to account for the fact that the active segment is never compacted and that most configurations only compact once the proportion of obsolete records crosses a threshold. Steady state size is therefore not the number of keys times the average record size: it is that plus the active segment plus the margin tolerated by the threshold, and those two additions usually account for a meaningful fraction of the total in high volume topics.',
        },
        {
          type: 'code',
          value: `// Saving estimate before enabling compaction on an existing topic.
// Runs over a sample of offsets, not over the whole topic.

/**
 * @param {object} p
 * @param {number} p.eventsInSample     number of records read
 * @param {number} p.distinctKeys       unique keys found in the sample
 * @param {number} p.keylessEvents      records with no key in the sample
 * @param {number} p.currentSizeBytes   current topic size on disk
 * @param {number} p.activeSegmentBytes active segment size per partition
 * @param {number} p.partitions         number of partitions in the topic
 * @param {number} p.dirtyThreshold     obsolete fraction tolerated before compacting
 */
export function estimateCompactionSaving({
  eventsInSample,
  distinctKeys,
  keylessEvents,
  currentSizeBytes,
  activeSegmentBytes,
  partitions,
  dirtyThreshold = 0.5,
}) {
  const keyed = eventsInSample - keylessEvents;
  const eventsPerKey = keyed / Math.max(distinctKeys, 1);

  // Keyless records are never removed: they survive in full.
  const keylessFraction = keylessEvents / eventsInSample;
  const keylessBytes = currentSizeBytes * keylessFraction;

  // Of the keyed portion, only the last value of each key survives,
  // extrapolated from the sample to the proportion of the whole topic.
  const keyedFraction = 1 - keylessFraction;
  const keyedBytesAfter =
    eventsPerKey > 0 ? (currentSizeBytes * keyedFraction) / eventsPerKey : 0;

  // The active segment of each partition never enters compaction.
  const activeSegmentTotal = activeSegmentBytes * partitions;

  // The compactor only runs once dirtiness crosses the threshold, so in
  // steady state that fraction of obsolete records always remains on disk.
  const usefulBytes = keylessBytes + keyedBytesAfter;
  const toleratedDirtyBytes = usefulBytes * (dirtyThreshold / (1 - dirtyThreshold));

  const estimatedSize = usefulBytes + toleratedDirtyBytes + activeSegmentTotal;
  const saving = 1 - estimatedSize / currentSizeBytes;

  return {
    eventsPerKey: Number(eventsPerKey.toFixed(2)),
    estimatedSizeBytes: Math.round(estimatedSize),
    savingPercent: Number((saving * 100).toFixed(1)),
    // Below three events per key compaction costs more in processing
    // than it returns in disk.
    worthIt: eventsPerKey >= 3 && saving > 0.2,
    keylessWarning:
      keylessFraction > 0.1
        ? 'more than ten percent of records have no key and will never be removed'
        : null,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The threshold of three events per key in the function return is not arbitrary: below it, the work of reading, building the key map and rewriting the segments costs more processor and memory than the space saved justifies, and on cheap disk that trade rarely pays off. The warning about keyless records is there because it is the most frequent diagnosis for the question that shows up weeks later: why does the compacted topic keep growing.',
        },
      ],
    },
    {
      title: 'The event key stops being a routing detail and becomes a retention policy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a topic with time based retention, the key serves one purpose only: deciding which partition the record lands in, and with that guaranteeing ordering among events of the same entity. Picking the wrong key in that scenario produces partition imbalance, which is a performance problem, annoying but reversible. In a compacted topic the same choice determines the granularity of what survives, and that is not reversible: what was discarded by an overly coarse key does not come back.',
        },
        {
          type: 'paragraph',
          value:
            'The most common case is an order status change topic. If the key is the order identifier, compaction preserves only the current status of each order, and the question of how long an order sat in picking becomes unanswerable forever. If the key is the combination of order and status, each transition becomes its own key, all of them survive, and the topic stops shrinking meaningfully because the ratio of events to keys drops close to one. Both choices are defensible, but they buy opposite things, and the decision has to be made by looking at the queries the system needs to answer rather than at the size of the disk.',
        },
        {
          type: 'table',
          columns: ['Key chosen', 'What survives compaction', 'Question that stays answerable', 'Question that is lost'],
          rows: [
            [
              'Order identifier',
              'One record per order, holding the current status',
              'What is the status of each order right now',
              'How long it spent in each stage',
            ],
            [
              'Order plus status',
              'One record per transition that occurred',
              'Which stages each order went through and when',
              'None, but there is almost no space saving',
            ],
            [
              'Customer identifier',
              'Only the last order of each customer',
              'What was each customer’s latest purchase',
              'The entire history of previous orders',
            ],
            [
              'Order plus day',
              'One record per order per active day',
              'How the order evolved at daily granularity',
              'Multiple transitions inside the same day',
            ],
            [
              'No key',
              'Everything, indefinitely',
              'All of them',
              'None, and the topic never shrinks',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row deserves attention because it is the intermediate solution rarely considered and it handles an entire class of cases well. Composing the key with a time bucket converts compaction from total deduplication into per period sampling: the state of each entity at the end of each day is preserved, which is enough for most evolution analysis, and the high frequency noise inside the period is discarded. The cost in space is the number of keys multiplied by the number of active days, which is usually an order of magnitude below keeping everything and an order above keeping only the current state.',
        },
      ],
    },
    {
      title: 'The two topic topology resolves the tension between audit and state',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the same stream has to simultaneously serve as a complete audit trail and as a source of current state, no single policy fits, because the requirements are contradictory by construction. The way out is to stop trying to configure one topic to do both and to split the roles into two topics with their own policies, fed by the same producer or by a transformation between them.',
        },
        {
          type: 'diagram',
          value: `                    +---------------------+
   producer ------> | orders.events       |  time based retention: 30 days
                    | (complete log)      |  every transition
                    +----------+----------+
                               |
                               | transformation: extracts the latest state
                               v
                    +---------------------+
                    | orders.state        |  compacted, no retention
                    | (key = orderId)     |  one record per order
                    +----------+----------+
                               |
              +----------------+----------------+
              v                                 v
    +-------------------+             +-------------------+
    | search service    |             | operations panel  |
    | rebuilds from zero|             | reads current only|
    +-------------------+             +-------------------+

   Cold archive (outside the broker):
   orders.events --> objects in cheap storage, partitioned by day
                     retention of years, rare reads, cost per gigabyte
                     one to two orders of magnitude lower

   Historical reprocessing reads from the cold archive, not the broker.
   Recent reprocessing reads from orders.events, inside the 30 days.
   A new service bootstraps from orders.state, in minutes.`,
        },
        {
          type: 'paragraph',
          value:
            'This topology solves three problems at once. The events topic keeps the reprocessing window the team actually uses day to day, which is almost always days rather than years, and pays expensive broker storage only for that window. The compacted topic gives any new service a way to reach current state in minutes instead of hours, because it reads one record per entity rather than the whole history. And the cold archive preserves the complete history for audit and for rare reprocessing, in storage whose cost per gigabyte is one to two orders of magnitude below the broker.',
        },
        {
          type: 'ordered',
          items: [
            'Measure the ratio of events to distinct keys on a sample of the current topic, to learn whether compaction has anything to save before any configuration change.',
            'Inventory the consumers and classify each one as history dependent or current state dependent, because that list defines which ones need the events topic and which can move to the compacted one.',
            'Create the compacted topic as a new one instead of changing the existing policy, since the policy change is destructive and has no undo.',
            'Write the transformation that feeds the compacted topic from the events one, validating that the chosen key preserves the granularity the state consumers need.',
            'Turn on the cold archive and verify that a reprocessing run from the archive produces the same result as one from the broker, before reducing any retention.',
            'Only then reduce the retention of the events topic, one step at a time, monitoring the maximum consumer lag at each reduction.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The order of the steps matters more than the content of each one. Reducing retention is the only irreversible step on the list and that is why it comes last, after the alternative reprocessing route is already validated in a real run and not merely planned. The mistake in the opening incident was executing exclusively that step, which is the only one that appears as a single configuration line and therefore looks like the cheapest.',
        },
        {
          type: 'list',
          items: [
            'Maximum lag per consumer group compared against the tombstone retention window: once the first exceeds half of the second, deletions stop being proven end to end.',
            'Proportion of obsolete records per partition: if it does not fall back below the threshold after a cycle, the compactor is not keeping up with the volume and the topic will grow without bound.',
            'Fraction of keyless records produced into the compacted topic: any value above one percent points to a misconfigured new producer and cancels the expected saving.',
            'Age of the oldest record per partition in the events topic, compared against the contracted reprocessing window: that number, not the configuration, says how far back you can actually go today.',
            'Bootstrap time of a consumer starting from zero on the compacted topic: growth in that number is the first sign that the ratio of events to keys has changed.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can compaction be enabled on a topic that already exists and is in production, or does a new one have to be created?',
      answer:
        'Technically it can, it is one configuration line, and that is exactly why this change causes so much damage. As soon as the policy starts including compaction, the compactor begins processing the closed segments that already exist, and every intermediate version of each key that was there is discarded definitively and without confirmation. There is no dry run mode, there is no undo, and the only possible recovery is from an external archive that has to have been created beforehand. That is why the practical recommendation is always to create a new topic with the desired policy and feed it from the original, even when that means keeping both side by side for a few weeks paying double storage. The cost of keeping double for a month is always lower than the cost of discovering, two months later, that an analysis nobody had mapped depended on the intermediate history. There is one reasonable exception: topics that were born as state projections, where every consumer only ever read the current value and where no historical report was ever built from them. Even then it is worth running the saving estimate first, because if the ratio of events to keys is low the change brings all of the risk without any of the benefit. And it is worth documenting the change with a date and an owner, because when someone asks why data before that date has a different granularity, that note is the only answer that will exist.',
    },
    {
      question: 'How do you do historical reprocessing once the broker retention has been reduced?',
      answer:
        'The short answer is that historical reprocessing stops coming out of the broker and starts coming out of the cold archive, and that shift has to be designed and tested before the retention reduction, not after. The design that works well has three parts. The first is continuous archiving: a dedicated consumer that reads the events topic and writes blocks into object storage, partitioned by day and by source partition, in a compressed columnar format, which usually yields a five to ten times reduction relative to the broker format and allows selective reading by date range without scanning everything. The second is the unified read layer: a shared library that takes a time range and decides on its own whether to read from the cold archive, from the broker, or from both in sequence stitching the junction point, so that the reprocessing code is identical regardless of where the data sits. That layer is what prevents each team from reimplementing the stitching logic with a different subtle bug. The third is the recurring equivalence test: a scheduled job that reprocesses a window existing in both places and compares the results record by record, which turns an assumption into a verification and detects serialization, time zone and partition boundary problems before they surface during an incident. On performance, it is worth setting expectations: reprocessing from object storage is typically slower per record than from the broker, but it parallelizes far better because it reads independent files, so with ten concurrent readers it usually finishes sooner.',
    },
    {
      question: 'Does compaction help or hinder a personal data erasure request?',
      answer:
        'It helps on one specific point and hinders on three, and the net balance depends on how the topic was designed. It helps because the tombstone provides an explicit and verifiable removal mechanism per key, which simply does not exist in a topic with time based retention: there the only way to erase a specific record is to rewrite the whole topic or wait for the window to pass. It hinders on the first front because the removal is neither immediate nor bounded by a deterministic deadline, since it only materializes once the compactor processes that segment, which depends on the dirty threshold and the write volume, and can take minutes to days, which is incompatible with a legal deadline expressed in calendar days with no slack. It hinders on the second front because of the active segment, which is never compacted: if the key being erased had a recent write, the personal value remains physically on disk even after the tombstone, until the segment rotates, which in a low volume topic can take a while. It hinders on the third front because the tombstone removes the key but does not remove personal data sitting inside the value of other keys, and it is common for an identifier or an address to appear in the payload of events of neighboring entities. The design that resolves all three is to separate personal data from the event stream from the very beginning, keeping only an opaque identifier in the event and storing the sensitive data in a repository with direct deletion and a controlled deadline. Erasure then becomes an operation in that repository, immediate and provable, and the event log remains full of identifiers that lose any ability to identify anyone the moment the reference key disappears. That is the only topology that answers a formal erasure request with a reliable deadline.',
    },
  ],
  conclusion: {
    title: 'Compaction is a choice about which question the log will keep answering',
    description:
      'Reducing event log storage looks like an infrastructure decision and is, in practice, a decision about which questions the system will still be able to answer a year from now. Time based retention and key based compaction cut the same disk along opposite paths: one erases the entire past, the other erases the path and preserves the destination. The right choice is almost never either one in isolation, but the topology that separates the audit log from the state topic and moves rare history into cold storage before any window reduction. I can measure the ratio of events to keys across your topics, map which consumers depend on history and which only need current state, design the split and validate archive based reprocessing before touching any retention setting.',
    cta: 'Talk about the retention of my event topics',
  },
  related: [
    {
      label: 'Queue migration without losing a message: swapping brokers with traffic on',
      to: '/blog/migracao-fila-sem-perder-mensagem-trocar-broker-com-trafego-ligado',
    },
    {
      label: 'The backup nobody ever restored: turning a copy into a recovery guarantee',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
    },
    {
      label: 'Backend Architecture and Modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El tópico de eventos pasó de cuatrocientos gigabytes a dos terabytes en siete meses y la factura de almacenamiento dejó de ser un detalle al pie. Alguien propuso la solución obvia: reducir la retención de treinta días a siete. La propuesta se aprobó un jueves, se aplicó el viernes, y el martes siguiente el equipo descubrió que el servicio de recomendación ya no lograba reconstruir su propio estado tras un error de cálculo, porque los eventos que necesitaba releer tenían veintidós días. Este artículo muestra por qué la retención por tiempo y la compactación por clave resuelven problemas distintos y por qué cambiar una por la otra es el error más caro de esta área, qué garantiza realmente la compactación y qué destruye para siempre, por qué la lápida es la única forma de borrar una clave y por qué tiene fecha de caducidad, cómo calcular la tasa de compactación real de tu tópico antes de activar nada, por qué la clave del evento deja de ser un detalle de particionado y se vuelve una decisión de retención, cuál es la topología de dos tópicos que preserva auditoría y reprocesamiento al mismo tiempo, y qué indicadores muestran que la compactación dejó de funcionar antes de que el disco se llene.',
  sections: [
    {
      title: 'La retención por tiempo y la compactación por clave no son la misma palanca',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusión empieza porque ambas políticas aparecen una al lado de la otra en la misma pantalla de configuración y ambas reducen el tamaño del tópico. El parecido termina ahí. La retención por tiempo borra segmentos enteros según la edad: pasados los siete días, todo lo que había en ese archivo desaparece sin que nadie mire el contenido. La compactación por clave preserva el último valor conocido de cada clave para siempre y descarta solo las versiones anteriores de esa misma clave. La primera es una política de olvido cronológico, la segunda es una política de deduplicación por identidad.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que las dos responden preguntas diferentes. Con retención por tiempo, la pregunta que el tópico responde es: qué ocurrió en los últimos N días. Con compactación, la pregunta es: cuál es el estado actual de cada entidad. Un servicio que necesita reconstruir un saldo sumando todos los asientos depende de la primera. Un servicio que solo necesita saber la dirección actual de cada cliente depende de la segunda, y quedaría satisfecho con un tópico compactado de una centésima parte del tamaño.',
        },
        {
          type: 'paragraph',
          value:
            'El error del incidente descrito en la apertura fue tratar a las dos como intercambiables porque ambas aparecían como formas de reducir disco. Reducir la ventana de retención destruyó la capacidad de reprocesar, que era justamente la propiedad que el equipo creía estar comprando. Activar compactación en ese tópico habría sido igual de destructivo por otro camino: el historial de asientos se habría convertido en un saldo por cuenta, y la auditoría exigida por contrato habría desaparecido en silencio, sin ningún error, sin ninguna alerta, solo con números que dejan de cuadrar tres meses después.',
        },
        {
          type: 'table',
          columns: ['Propiedad', 'Retención por tiempo', 'Compactación por clave', 'Consecuencia práctica'],
          rows: [
            [
              'Criterio de descarte',
              'Edad del segmento, sin importar el contenido',
              'Existencia de una versión más reciente de la misma clave',
              'Compactar no libera espacio en un tópico de claves únicas',
            ],
            [
              'Lo que queda garantizado',
              'Todo evento dentro de la ventana, incluidos los intermedios',
              'El último valor de cada clave, sin garantía de los anteriores',
              'Solo la retención permite recontar desde cero',
            ],
            [
              'Lo que se pierde',
              'Todo lo más antiguo que la ventana',
              'Todas las transiciones intermedias de cada clave',
              'La compactación destruye la traza de auditoría de cambios',
            ],
            [
              'Tamaño en régimen permanente',
              'Proporcional a la tasa de eventos por la ventana',
              'Proporcional al número de claves distintas',
              'La compactación limita el crecimiento, la retención la edad',
            ],
            [
              'Eventos sin clave',
              'Tratados como cualquier otro',
              'Nunca eliminados, se acumulan indefinidamente',
              'Un productor olvidado sin clave anula todo el ahorro',
            ],
            [
              'Borrar una entidad',
              'Ocurre solo cuando pasa la ventana',
              'Exige lápida explícita y solo después desaparece',
              'El derecho al olvido se vuelve trabajo de aplicación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La quinta fila es la que produce el mayor número de decepciones en producción. Un tópico compactado donde la mitad de los productores emite eventos sin clave no encoge a la mitad: encoge solo en la parte con clave y sigue creciendo linealmente en la otra, porque el núcleo del mecanismo no tiene ningún criterio para comparar dos registros sin identidad. El gráfico de tamaño tras activar la compactación queda con un escalón hacia abajo seguido de la misma pendiente de antes, y el equipo concluye erróneamente que la compactación no funciona.',
        },
      ],
    },
    {
      title: 'Lo que la compactación garantiza es más débil de lo que la mayoría supone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La garantía formal de la compactación tiene una redacción estrecha y vale la pena enunciarla con precisión, porque casi todo error de arquitectura en esta área nace de suponer más de lo que promete. La garantía es: cualquier consumidor que lea el tópico de principio a fin verá, como mínimo, el último valor escrito para cada clave. No se promete que verá solo ese valor, ni que verá los valores intermedios, ni que dos consumidores que lean en momentos distintos verán la misma secuencia.',
        },
        {
          type: 'paragraph',
          value:
            'Tres consecuencias salen directamente de esa redacción. La primera es que el consumidor debe ser idempotente por construcción, porque puede recibir la misma clave varias veces: el segmento activo todavía no fue compactado y puede contener tres versiones de la misma clave que una relectura futura ya no tendrá. La segunda es que cualquier lógica que dependa de la secuencia de transiciones de una entidad tiene prohibido ejecutarse sobre un tópico compactado, porque la secuencia es exactamente lo que se descartó. La tercera es que el resultado de un reprocesamiento deja de ser determinista entre ejecuciones: reprocesar hoy y reprocesar mañana puede producir historiales distintos para la misma entidad, incluso sin ninguna escritura nueva, porque la compactación corrió en medio.',
        },
        {
          type: 'paragraph',
          value:
            'Esa tercera consecuencia es la que suele romper equipos que usan el log como fuente de verdad para cálculos financieros o para modelos entrenados a partir del historial. Un informe reconstruido en enero y reconstruido de nuevo en marzo sobre el mismo tópico compactado no cuadra, y la diferencia no aparece como error en ninguna parte: los dos valores son correctos respecto de lo que el tópico contenía en el momento de cada lectura. Investigar ese tipo de divergencia suele consumir semanas antes de que alguien sospeche de la política de retención.',
        },
        {
          type: 'diagram',
          value: `Topico con una sola particion, claves A, B y C

Antes de la compactacion (offsets 0 a 8):
  off 0  A=10
  off 1  B=20
  off 2  A=11      <- version intermedia de A
  off 3  C=30
  off 4  A=12      <- version intermedia de A
  off 5  B=21      <- version intermedia de B
  off 6  A=13      <- ultimo valor de A
  off 7  B=22      <- ultimo valor de B
  off 8  C=31      <- ultimo valor de C   [segmento activo]

Despues de compactar los segmentos cerrados (0 a 7):
  off 6  A=13
  off 7  B=22
  off 8  C=31      [segmento activo, nunca compactado]

Lo que sobrevive: el ultimo valor de cada clave.
Lo que desaparece: A=10, A=11, A=12, B=20, B=21, C=30.
Los offsets NO se renumeran: 0 a 5 simplemente ya no existen.
Un consumidor que pide el offset 3 recibe el siguiente offset existente.`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle de los offsets al final del diagrama tiene consecuencia operativa directa. Como la compactación abre huecos en la secuencia sin renumerar nada, cualquier código que asuma continuidad de offsets para calcular retraso, para estimar la cantidad de mensajes pendientes o para repartir trabajo entre consumidores producirá números equivocados en un tópico compactado. La diferencia entre el offset mayor y el offset actual del consumidor deja de ser la cantidad de mensajes por procesar y pasa a ser una cota superior que puede estar órdenes de magnitud por encima del valor real.',
        },
      ],
    },
    {
      title: 'Borrar una clave exige lápida, y la lápida tiene plazo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un tópico compactado la ausencia de novedad significa permanencia: el último valor de cada clave queda allí indefinidamente, y ningún paso del tiempo lo elimina. Eso crea un problema específico cuando la entidad deja de existir, sea porque el cliente fue eliminado, porque el producto salió del catálogo o porque hay que honrar una solicitud de supresión de datos personales. El mecanismo para eso es la lápida: un registro con la clave completada y el valor nulo, que la compactación interpreta como instrucción de eliminar la clave entera.',
        },
        {
          type: 'paragraph',
          value:
            'La parte que sorprende es que la lápida no desaparece de inmediato y tampoco se queda para siempre. Tiene que permanecer visible el tiempo suficiente para que todo consumidor que esté leyendo el tópico vea la instrucción de borrar, y después debe ella misma ser eliminada, o el tópico acumularía una lápida por entidad borrada hasta el fin de los tiempos. Existe por tanto una ventana de retención específica para lápidas, típicamente configurada en veinticuatro horas, y esa ventana crea un riesgo silencioso: un consumidor que quede detenido más tiempo que ella, por un incidente largo, por un fin de semana prolongado o por un proceso de reconstrucción lento, vuelve a leer el tópico y nunca ve la lápida. Mantiene en su propio estado una entidad que fue borrada deliberadamente en el origen.',
        },
        {
          type: 'code',
          value: `// Produccion de lapida y verificacion de ventana antes de confiar en el borrado.
// La lapida solo cumple su papel si todos los consumidores leen dentro de la ventana.

/**
 * Emite la lapida que instruye a la compactacion a eliminar la clave por completo.
 * El valor debe ser nulo de verdad, no cadena vacia ni objeto vacio:
 * la comparacion que hace el compactador es contra la ausencia de payload.
 */
async function emitirLapida(productor, topico, clave) {
  await productor.send({
    topic: topico,
    messages: [{ key: clave, value: null }],
  });
}

/**
 * Verifica si es seguro confiar en la lapida, comparando el retraso de cada
 * grupo consumidor con la ventana de retencion de lapidas del topico.
 *
 * @param {Array<{grupo: string, retrasoMs: number}>} gruposConsumidores
 * @param {number} ventanaLapidaMs retencion configurada para lapidas
 * @param {number} margen fraccion de la ventana reservada como holgura (0.5 = mitad)
 */
function evaluarSeguridadDelBorrado(gruposConsumidores, ventanaLapidaMs, margen = 0.5) {
  const limiteSeguro = ventanaLapidaMs * margen;

  const enRiesgo = gruposConsumidores.filter((g) => g.retrasoMs > limiteSeguro);

  return {
    seguro: enRiesgo.length === 0,
    limiteSeguroMs: limiteSeguro,
    // Grupos que podrian no ver nunca la lapida: necesitan reconstruccion
    // completa desde un snapshot, y no lectura incremental.
    gruposQueNecesitanReconstruir: enRiesgo.map((g) => g.grupo),
  };
}

// Uso tipico dentro del flujo de supresion de datos personales.
async function borrarEntidad({ productor, topico, clave, gruposConsumidores, ventanaLapidaMs }) {
  const evaluacion = evaluarSeguridadDelBorrado(gruposConsumidores, ventanaLapidaMs);

  await emitirLapida(productor, topico, clave);

  if (!evaluacion.seguro) {
    // El borrado fue registrado, pero no esta comprobado de punta a punta.
    // El registro de abajo es lo que convierte un riesgo invisible en tarea.
    return {
      lapidaEmitida: true,
      borradoComprobado: false,
      accionNecesaria: 'reconstruir el estado de los grupos atrasados desde un snapshot',
      grupos: evaluacion.gruposQueNecesitanReconstruir,
    };
  }

  return { lapidaEmitida: true, borradoComprobado: true };
}

export { emitirLapida, evaluarSeguridadDelBorrado, borrarEntidad };`,
        },
        {
          type: 'paragraph',
          value:
            'La función de evaluación existe porque la diferencia entre un borrado registrado y un borrado comprobado es exactamente el tipo de cosa que nadie nota hasta que una auditoría pregunta. Emitir la lápida es trivial y siempre funciona del lado del productor. Garantizar que cada consumidor aplicó la eliminación es un problema distribuido que depende del retraso de cada grupo, y la única forma honesta de tratarlo es medir ese retraso en el momento del borrado y escalar a reconstrucción completa a quien esté fuera de la ventana.',
        },
        {
          type: 'paragraph',
          value:
            'Hay además una trampa de implementación lo bastante frecuente como para merecer mención explícita: emitir la lápida con valor de cadena vacía, con objeto vacío o con un payload marcado como eliminado no produce ninguna eliminación. Cualquiera de esos casos es, para el compactador, un valor válido y reciente como cualquier otro, y la clave permanece en el tópico para siempre con ese contenido. El valor debe ser nulo en el sentido de ausencia de payload, y conviene verificarlo en el serializador, porque varias bibliotecas convierten nulo en bytes vacíos en silencio.',
        },
      ],
    },
    {
      title: 'El ahorro real depende de la razón entre eventos y claves distintas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de activar compactación en cualquier tópico conviene calcular cuánto va a ahorrar, porque el resultado varía entre noventa y ocho por ciento y cero según una sola razón: cuántos eventos existen por clave distinta. Un tópico de actualización de posición de repartidor, donde cada repartidor emite un evento cada cinco segundos, tiene una razón altísima y compacta maravillosamente. Un tópico de pedidos creados, donde cada pedido aparece exactamente una vez con identificador único, tiene razón igual a uno y no compacta absolutamente nada, además de salir más caro porque el proceso de compactación pasa a consumir procesador y memoria sin devolver espacio.',
        },
        {
          type: 'paragraph',
          value:
            'La cuenta debe considerar también que el segmento activo nunca se compacta y que la mayoría de las configuraciones solo compacta cuando la proporción de registros obsoletos supera un umbral. El tamaño en régimen permanente, por tanto, no es el número de claves por el tamaño medio del registro: es eso más el segmento activo más el margen tolerado por el umbral, y esos dos añadidos suelen representar una fracción relevante del total en tópicos de volumen alto.',
        },
        {
          type: 'code',
          value: `// Estimacion de ahorro antes de activar compactacion en un topico existente.
// Corre sobre una muestra de offsets, no sobre el topico entero.

/**
 * @param {object} p
 * @param {number} p.eventosEnMuestra     cantidad de registros leidos
 * @param {number} p.clavesDistintas      claves unicas encontradas en la muestra
 * @param {number} p.eventosSinClave      registros sin clave en la muestra
 * @param {number} p.tamanoActualBytes    tamano actual del topico en disco
 * @param {number} p.segmentoActivoBytes  tamano del segmento activo por particion
 * @param {number} p.particiones          numero de particiones del topico
 * @param {number} p.umbralSuciedad       fraccion obsoleta tolerada antes de compactar
 */
export function estimarAhorroDeCompactacion({
  eventosEnMuestra,
  clavesDistintas,
  eventosSinClave,
  tamanoActualBytes,
  segmentoActivoBytes,
  particiones,
  umbralSuciedad = 0.5,
}) {
  const conClave = eventosEnMuestra - eventosSinClave;
  const eventosPorClave = conClave / Math.max(clavesDistintas, 1);

  // Los registros sin clave nunca se eliminan: sobreviven enteros.
  const fraccionSinClave = eventosSinClave / eventosEnMuestra;
  const bytesSinClave = tamanoActualBytes * fraccionSinClave;

  // De la parte con clave sobrevive solo el ultimo valor de cada clave,
  // extrapolado de la muestra a la proporcion del topico entero.
  const fraccionConClave = 1 - fraccionSinClave;
  const bytesConClaveDespues =
    eventosPorClave > 0 ? (tamanoActualBytes * fraccionConClave) / eventosPorClave : 0;

  // El segmento activo de cada particion nunca entra en la compactacion.
  const bytesSegmentoActivo = segmentoActivoBytes * particiones;

  // El compactador solo corre cuando la suciedad pasa el umbral, asi que en
  // regimen permanente siempre queda esa fraccion de registros obsoletos.
  const bytesUtiles = bytesSinClave + bytesConClaveDespues;
  const bytesSuciedadTolerada = bytesUtiles * (umbralSuciedad / (1 - umbralSuciedad));

  const tamanoEstimado = bytesUtiles + bytesSuciedadTolerada + bytesSegmentoActivo;
  const ahorro = 1 - tamanoEstimado / tamanoActualBytes;

  return {
    eventosPorClave: Number(eventosPorClave.toFixed(2)),
    tamanoEstimadoBytes: Math.round(tamanoEstimado),
    ahorroPorcentual: Number((ahorro * 100).toFixed(1)),
    // Por debajo de tres eventos por clave la compactacion cuesta mas en
    // procesamiento de lo que devuelve en disco.
    valeLaPena: eventosPorClave >= 3 && ahorro > 0.2,
    alertaSinClave:
      fraccionSinClave > 0.1
        ? 'mas del diez por ciento de los registros no tiene clave y nunca sera eliminado'
        : null,
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El umbral de tres eventos por clave en el retorno de la función no es arbitrario: por debajo de él, el trabajo de lectura, construcción del mapa de claves y reescritura de los segmentos cuesta más procesador y memoria de lo que el espacio ahorrado justifica, y en disco de costo bajo ese intercambio rara vez compensa. La alerta sobre registros sin clave está ahí porque es el diagnóstico más frecuente para la pregunta que aparece semanas después: por qué el tópico compactado sigue creciendo.',
        },
      ],
    },
    {
      title: 'La clave del evento deja de ser detalle de enrutamiento y se vuelve política de retención',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un tópico con retención por tiempo, la clave sirve para una sola cosa: decidir en qué partición cae el registro, y con eso garantizar orden entre eventos de la misma entidad. Elegir mal la clave en ese escenario produce desequilibrio de partición, que es un problema de rendimiento, molesto pero reversible. En un tópico compactado la misma elección determina la granularidad de lo que sobrevive, y eso no es reversible: lo que se descartó por una clave demasiado gruesa no vuelve.',
        },
        {
          type: 'paragraph',
          value:
            'El caso más común es el de un tópico de cambio de estado de pedido. Si la clave es el identificador del pedido, la compactación preserva solo el estado actual de cada pedido, y la pregunta de cuánto tiempo estuvo un pedido en preparación queda sin respuesta para siempre. Si la clave es la combinación de pedido y estado, cada transición se vuelve una clave propia, todas sobreviven, y el tópico deja de encoger de forma relevante porque la razón entre eventos y claves cae cerca de uno. Ambas elecciones son defendibles, pero compran cosas opuestas, y la decisión debe tomarse mirando las consultas que el sistema necesita responder y no el tamaño del disco.',
        },
        {
          type: 'table',
          columns: ['Clave elegida', 'Lo que sobrevive a la compactación', 'Pregunta que sigue respondible', 'Pregunta que se pierde'],
          rows: [
            [
              'Identificador del pedido',
              'Un registro por pedido, con el estado actual',
              'Cuál es el estado de cada pedido ahora',
              'Cuánto tiempo estuvo en cada etapa',
            ],
            [
              'Pedido más estado',
              'Un registro por transición ocurrida',
              'Qué etapas recorrió cada pedido y cuándo',
              'Ninguna, pero casi no hay ahorro de espacio',
            ],
            [
              'Identificador del cliente',
              'Solo el último pedido de cada cliente',
              'Cuál fue la última compra de cada cliente',
              'Todo el historial de pedidos anteriores',
            ],
            [
              'Pedido más día',
              'Un registro por pedido por día de actividad',
              'Cómo evolucionó el pedido con granularidad diaria',
              'Transiciones múltiples dentro del mismo día',
            ],
            [
              'Sin clave',
              'Todo, indefinidamente',
              'Todas',
              'Ninguna, y el tópico nunca encoge',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila merece atención porque es la solución intermedia que rara vez se considera y que resuelve bien una clase entera de casos. Componer la clave con un recorte temporal convierte la compactación de deduplicación total en muestreo por período: se preserva el estado de cada entidad al final de cada día, lo que basta para la mayoría de los análisis de evolución, y se descarta el ruido de alta frecuencia dentro del período. El costo en espacio es el número de claves multiplicado por el número de días de actividad, que suele ser un orden de magnitud menor que guardarlo todo y un orden mayor que guardar solo el estado actual.',
        },
      ],
    },
    {
      title: 'La topología de dos tópicos resuelve la tensión entre auditoría y estado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando el mismo flujo tiene que servir simultáneamente de traza de auditoría completa y de fuente de estado actual, ninguna política única alcanza, porque las exigencias son contradictorias por construcción. La salida es dejar de intentar configurar un tópico para hacer las dos cosas y separar los papeles en dos tópicos con políticas propias, alimentados por el mismo productor o por una transformación entre ellos.',
        },
        {
          type: 'diagram',
          value: `                    +---------------------+
   productor -----> | pedidos.eventos     |  retencion por tiempo: 30 dias
                    | (log completo)      |  todas las transiciones
                    +----------+----------+
                               |
                               | transformacion: extrae el ultimo estado
                               v
                    +---------------------+
                    | pedidos.estado      |  compactado, sin retencion
                    | (clave = pedidoId)  |  un registro por pedido
                    +----------+----------+
                               |
              +----------------+----------------+
              v                                 v
    +-------------------+             +-------------------+
    | servicio de busca |             | panel operativo   |
    | reconstruye de 0  |             | lee solo el actual|
    +-------------------+             +-------------------+

   Archivado frio (fuera del broker):
   pedidos.eventos --> objetos en almacenamiento barato, particionado por dia
                       retencion de anios, lectura rara, costo por gigabyte
                       de uno a dos ordenes de magnitud menor

   El reprocesamiento historico lee del archivo frio, no del broker.
   El reprocesamiento reciente lee de pedidos.eventos, dentro de los 30 dias.
   Un servicio nuevo arranca desde pedidos.estado, en minutos.`,
        },
        {
          type: 'paragraph',
          value:
            'Esta topología resuelve tres problemas de una vez. El tópico de eventos mantiene la ventana de reprocesamiento que el equipo realmente usa en el día a día, que casi siempre es de días y no de años, y paga almacenamiento caro de broker solo por esa ventana. El tópico compactado da a cualquier servicio nuevo una forma de llegar al estado actual en minutos en lugar de horas, porque lee un registro por entidad en vez de todo el historial. Y el archivado frío preserva el historial completo para auditoría y para reprocesamiento raro, en un almacenamiento cuyo costo por gigabyte es de uno a dos órdenes de magnitud menor que el del broker.',
        },
        {
          type: 'ordered',
          items: [
            'Medir la razón entre eventos y claves distintas en una muestra del tópico actual, para saber si la compactación tiene algo que ahorrar antes de cualquier cambio de configuración.',
            'Inventariar los consumidores y clasificar cada uno como dependiente de historial o dependiente solo de estado actual, porque esa lista define cuáles necesitan el tópico de eventos y cuáles pueden migrar al compactado.',
            'Crear el tópico compactado como uno nuevo en vez de cambiar la política del existente, ya que el cambio de política es destructivo y no tiene vuelta atrás.',
            'Escribir la transformación que alimenta el tópico compactado a partir del de eventos, validando que la clave elegida preserva la granularidad que los consumidores de estado necesitan.',
            'Activar el archivado frío y verificar que un reprocesamiento desde el archivo produce el mismo resultado que uno desde el broker, antes de reducir cualquier retención.',
            'Solo entonces reducir la retención del tópico de eventos, un paso a la vez, monitoreando el retraso máximo de los consumidores en cada reducción.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El orden de los pasos importa más que el contenido de cada uno. La reducción de retención es el único paso irreversible de la lista y por eso es el último, después de que la ruta alternativa de reprocesamiento ya esté validada en una ejecución real y no apenas planeada. El error del incidente de la apertura fue ejecutar exclusivamente ese paso, que es el único que aparece como una línea de configuración y por eso parece el más barato.',
        },
        {
          type: 'list',
          items: [
            'Retraso máximo por grupo consumidor comparado con la ventana de retención de lápidas: cuando el primero supera la mitad de la segunda, los borrados dejan de estar comprobados de punta a punta.',
            'Proporción de registros obsoletos por partición: si no vuelve por debajo del umbral tras un ciclo, el compactador no da abasto con el volumen y el tópico crecerá sin límite.',
            'Fracción de registros sin clave producidos en el tópico compactado: cualquier valor por encima del uno por ciento indica un productor nuevo mal configurado y anula el ahorro esperado.',
            'Edad del registro más antiguo por partición en el tópico de eventos, comparada con la ventana contratada de reprocesamiento: es ese número, y no la configuración, el que dice hasta dónde se puede volver hoy.',
            'Tiempo de arranque de un consumidor desde cero en el tópico compactado: el crecimiento de ese número es la primera señal de que la razón entre eventos y claves cambió.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Se puede activar compactación en un tópico que ya existe y está en producción, o hay que crear otro?',
      answer:
        'Técnicamente se puede, es una línea de configuración, y justamente por eso ese cambio causa tanto daño. Apenas la política pasa a incluir compactación, el compactador empieza a procesar los segmentos cerrados ya existentes, y todas las versiones intermedias de cada clave que había allí se descartan de forma definitiva y sin confirmación. No existe modo de simulación, no existe deshacer, y la única recuperación posible viene de un archivado externo que debe haberse creado antes. Por eso la recomendación práctica es siempre crear un tópico nuevo con la política deseada y alimentarlo a partir del original, incluso cuando eso signifique mantener ambos lado a lado durante algunas semanas pagando almacenamiento doble. El costo de mantener el doble por un mes siempre es menor que el costo de descubrir, dos meses después, que un análisis que nadie había mapeado dependía del historial intermedio. Existe una excepción razonable: tópicos que ya nacieron como proyección de estado, donde todo consumidor siempre leyó solo el valor actual y donde jamás se construyó un informe histórico a partir de ellos. Incluso en ese caso conviene ejecutar antes la estimación de ahorro, porque si la razón entre eventos y claves es baja el cambio trae todo el riesgo sin traer el beneficio. Y conviene documentar el cambio con fecha y responsable, porque cuando alguien pregunte por qué los datos anteriores a esa fecha tienen granularidad distinta, esa anotación será la única respuesta que exista.',
    },
    {
      question: '¿Cómo hacer reprocesamiento histórico después de reducir la retención del broker?',
      answer:
        'La respuesta corta es que el reprocesamiento histórico deja de salir del broker y pasa a salir del archivado frío, y ese cambio debe diseñarse y probarse antes de la reducción de retención, no después. El diseño que funciona bien tiene tres partes. La primera es el archivado continuo: un consumidor dedicado que lee el tópico de eventos y escribe bloques en almacenamiento de objetos, particionados por día y por partición de origen, en formato columnar comprimido, lo que suele rendir una reducción de cinco a diez veces respecto del formato del broker y permite lectura selectiva por intervalo de fecha sin recorrerlo todo. La segunda es la capa de lectura unificada: una biblioteca compartida que recibe un intervalo de tiempo y decide por su cuenta si lee del archivo frío, del broker, o de ambos en secuencia cosiendo el punto de unión, para que el código de reprocesamiento sea idéntico independientemente de dónde esté el dato. Esa capa es lo que evita que cada equipo reimplemente la lógica de unión con un error sutil distinto. La tercera es la prueba de equivalencia recurrente: un trabajo programado que reprocesa una ventana existente en ambos lugares y compara los resultados registro a registro, lo que convierte una suposición en verificación y detecta problemas de serialización, de zona horaria y de límite de partición antes de que aparezcan durante un incidente. Sobre rendimiento, conviene ajustar la expectativa: un reprocesamiento desde almacenamiento de objetos es típicamente más lento por registro que desde el broker, pero paraleliza mucho mejor por ser lectura de archivos independientes, así que con diez lectores concurrentes suele terminar antes.',
    },
    {
      question: '¿La compactación ayuda o estorba en una solicitud de supresión de datos personales?',
      answer:
        'Ayuda en un punto específico y estorba en tres, y el saldo neto depende de cómo se diseñó el tópico. Ayuda porque la lápida da un mecanismo explícito y verificable de eliminación por clave, que en un tópico con retención por tiempo simplemente no existe: allí la única forma de borrar un registro específico es reescribir el tópico entero o esperar a que pase la ventana. Estorba en el primer frente porque la eliminación no es inmediata ni tiene plazo determinista, ya que solo se concreta cuando el compactador procesa ese segmento, lo que depende del umbral de suciedad y del volumen de escritura, y puede tardar de minutos a días, lo que es incompatible con un plazo legal expresado en días corridos sin margen. Estorba en el segundo frente por el segmento activo, que nunca se compacta: si la clave a borrar tuvo escritura reciente, el valor personal sigue físicamente en disco incluso después de la lápida, hasta que el segmento rote, lo que en un tópico de volumen bajo puede demorar. Estorba en el tercer frente porque la lápida elimina la clave pero no elimina datos personales que estén dentro del valor de otras claves, y es común que un identificador o una dirección aparezcan en el payload de eventos de entidades vecinas. El diseño que resuelve los tres es separar el dato personal del flujo de eventos desde el comienzo, manteniendo en el evento apenas un identificador opaco y guardando el dato sensible en un repositorio con borrado directo y plazo controlado. La supresión se vuelve entonces una operación en ese repositorio, inmediata y comprobable, y el log de eventos permanece con identificadores que pierden cualquier capacidad de identificar a alguien en el momento en que la clave de referencia desaparece. Esa es la única topología que responde con plazo confiable a una solicitud formal de supresión.',
    },
  ],
  conclusion: {
    title: 'La compactación es una elección sobre qué pregunta seguirá respondiendo el log',
    description:
      'Reducir el almacenamiento del log de eventos parece una decisión de infraestructura y es, en la práctica, una decisión sobre qué preguntas el sistema seguirá pudiendo responder dentro de un año. La retención por tiempo y la compactación por clave recortan el mismo disco por caminos opuestos: una borra el pasado entero, la otra borra el camino y preserva el destino. La elección correcta casi nunca es una de las dos por separado, sino la topología que separa el log de auditoría del tópico de estado y mueve el historial raro a almacenamiento frío antes de cualquier reducción de ventana. Puedo levantar la razón entre eventos y claves de tus tópicos, mapear qué consumidores dependen del historial y cuáles solo necesitan estado actual, diseñar la separación y validar el reprocesamiento desde el archivo antes de tocar cualquier configuración de retención.',
    cta: 'Hablar sobre la retención de mis tópicos de eventos',
  },
  related: [
    {
      label: 'Migración de cola sin perder mensajes: cambiar de broker con tráfico activo',
      to: '/blog/migracao-fila-sem-perder-mensagem-trocar-broker-com-trafego-ligado',
    },
    {
      label: 'El backup que nunca se restauró: convertir la copia en garantía de recuperación',
      to: '/blog/backup-que-nunca-foi-restaurado-transformar-copia-em-garantia-de-recuperacao',
    },
    {
      label: 'Arquitectura y Modernización Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
