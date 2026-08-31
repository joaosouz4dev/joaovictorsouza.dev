// Conteudo do artigo: multi-regiao com escrita unica, o que muda quando a
// latencia vira decisao de produto.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A segunda região subiu em uma tarde e o painel de latência melhorou na mesma hora: leituras que levavam duzentos e trinta milissegundos passaram a levar dezoito. Três semanas depois começaram os tickets de clientes que salvavam um formulário e viam o valor antigo voltar na tela seguinte. O banco não tinha bug, a replicação estava saudável, e o atraso médio entre as réplicas era de quarenta milissegundos. O problema é que a arquitetura de escrita única transformou uma propriedade física, a distância entre continentes, em um comportamento de produto que ninguém tinha decidido. Este artigo mostra por que a escrita única é quase sempre a escolha certa e por que ela custa caro exatamente onde ninguém olha, qual conta separa a operação que pode ler da réplica local da que precisa atravessar o oceano, como implementar leitura da própria escrita sem grudar o usuário na região primária para sempre, por que o failover de escrita é uma decisão manual disfarçada de automação, e qual métrica prova que a topologia está entregando o que prometeu antes de o cliente reclamar.',
  sections: [
    {
      title: 'A escrita única não é uma limitação técnica, é um contrato de consistência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A discussão sobre multi-região costuma começar errada porque trata a escrita única como uma etapa provisória, algo que se resolve depois com um banco multi-master. A topologia de escrita única existe porque ela é a única que permite manter uma ordem total dos eventos sem coordenação distribuída no caminho crítico. Existe um único lugar onde a sequência de commits é decidida, e por consequência existe uma única resposta para perguntas como qual foi a última alteração desse pedido. Quando você distribui a escrita, essa pergunta deixa de ter resposta única e passa a exigir resolução de conflito, que é uma decisão de negócio, não uma configuração de banco.',
        },
        {
          type: 'paragraph',
          value:
            'O que muda com a segunda região não é a capacidade de escrita, é a geografia da leitura. As réplicas locais transformam consultas de duzentos milissegundos em consultas de vinte, e isso é uma melhoria real e mensurável. O custo aparece porque a réplica local está sempre atrasada em relação ao primário, e esse atraso não é ruído: é o tempo de propagação da rede mais o tempo de aplicação do log, tipicamente entre trinta e cento e cinquenta milissegundos entre continentes em condição saudável, e segundos inteiros durante uma rajada de escrita ou uma manutenção do primário.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que um sistema que antes tinha uma única classe de leitura passa a ter duas, e a distinção entre elas não é técnica. Ela depende de quem está lendo e do que essa pessoa acabou de fazer. Um relatório de vendas do mês passado tolera meio segundo de atraso sem nenhum problema, porque nenhum humano consegue notar. A tela que aparece imediatamente após o usuário salvar um formulário não tolera nem quarenta milissegundos, porque o usuário sabe exatamente o que acabou de escrever e vai comparar. Classificar as operações nessas duas categorias é o trabalho central de uma migração multi-região, e ele é feito no código de aplicação, não na configuração do banco.',
        },
        {
          type: 'table',
          columns: [
            'Operação',
            'Onde ler',
            'Atraso tolerado',
            'O que acontece se errar a escolha',
          ],
          rows: [
            [
              'Catálogo de produtos, listagem pública',
              'Réplica local',
              'Segundos',
              'Nada perceptível, e ler do primário desperdiça latência',
            ],
            [
              'Tela imediatamente após salvar um cadastro',
              'Primário ou réplica com marca de versão',
              'Zero',
              'Usuário vê o valor antigo e salva de novo, gerando duplicidade',
            ],
            [
              'Saldo antes de autorizar uma transferência',
              'Primário, sempre',
              'Zero',
              'Autoriza operação sobre saldo que já foi consumido',
            ],
            [
              'Relatório analítico do período fechado',
              'Réplica local ou réplica dedicada',
              'Minutos',
              'Nenhum impacto, e ler do primário concorre com o tráfego transacional',
            ],
            [
              'Verificação de permissão após troca de perfil',
              'Primário até a replicação alcançar',
              'Zero',
              'Usuário mantém acesso que acabou de ser revogado',
            ],
          ],
        },
      ],
    },
    {
      title: 'Leitura da própria escrita sem prender o usuário no primário',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira solução que aparece para o problema da tela desatualizada é grudar a sessão do usuário no primário depois de qualquer escrita. Funciona, e joga fora a razão de existir da segunda região: qualquer usuário que interaja com o sistema volta a pagar a latência transatlântica em todas as leituras seguintes. A variação um pouco menos ruim, que fixa o usuário no primário por trinta segundos, ainda é um número escolhido no chute, e ele erra nas duas direções: é curto demais quando a replicação atrasa, e longo demais na esmagadora maioria das vezes em que ela está saudável.',
        },
        {
          type: 'paragraph',
          value:
            'A solução correta usa a posição do log de replicação como token. Toda escrita retorna a posição em que ela foi confirmada no primário, essa posição viaja com o usuário em um cookie ou cabeçalho, e cada leitura compara o token com a posição que a réplica local já aplicou. Se a réplica alcançou aquela posição, a leitura local é servida e é comprovadamente consistente com o que o usuário escreveu. Se ainda não alcançou, existe uma escolha explícita entre esperar alguns milissegundos ou desviar aquela leitura específica para o primário. O ponto que torna isso muito melhor que o tempo fixo é que ele se autoajusta: quando a replicação está com quarenta milissegundos de atraso, praticamente nenhuma leitura desvia; quando ela degrada, o desvio acontece exatamente enquanto for necessário.',
        },
        {
          type: 'code',
          value: `// dados/roteador-leitura.js
// Roteia cada leitura para a replica local ou para o primario com base na
// posicao de replicacao que o usuario ja observou (read-your-writes).
// O token nao e um timestamp: comparar relogios entre regioes e justamente
// o que nao funciona. E a posicao monotonica do log do primario.

const ESPERA_MAXIMA_MS = 60;   // acima disso, atravessar o oceano e mais rapido
const INTERVALO_SONDA_MS = 5;

export const criarRoteadorLeitura = ({ primario, replicaLocal, metricas }) => {
  /**
   * @param {object} ctx
   * @param {bigint|null} ctx.posicaoObservada  ultima posicao escrita pelo usuario
   * @param {boolean} ctx.exigeAtual            operacao que nunca aceita atraso
   */
  const escolherConexao = async ({ posicaoObservada, exigeAtual }) => {
    if (exigeAtual) {
      metricas.incrementar('leitura.primario.exigida');
      return primario;
    }

    // Usuario que nunca escreveu nesta sessao nao tem nada a esperar.
    if (posicaoObservada == null) {
      metricas.incrementar('leitura.local.sem_token');
      return replicaLocal;
    }

    const inicio = process.hrtime.bigint();

    // Espera curta e limitada: na maior parte das vezes a replica ja
    // alcancou e o laco encerra na primeira iteracao, sem custo.
    while (true) {
      const aplicada = await replicaLocal.posicaoAplicada();
      if (aplicada >= posicaoObservada) {
        const esperaMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        metricas.observar('leitura.local.espera_ms', esperaMs);
        return replicaLocal;
      }

      const decorridoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      if (decorridoMs >= ESPERA_MAXIMA_MS) {
        // Desviar e a decisao certa aqui: esperar mais custaria ao usuario
        // mais do que a ida ate o primario. O contador abaixo e o sinal de
        // que a replicacao degradou, e ele se move antes de qualquer ticket.
        metricas.incrementar('leitura.primario.desvio_por_atraso');
        return primario;
      }

      await new Promise((r) => setTimeout(r, INTERVALO_SONDA_MS));
    }
  };

  /**
   * Executa a escrita e devolve a posicao para o chamador propagar ao cliente.
   */
  const escrever = async (executar) => {
    const resultado = await primario.transacao(executar);
    const posicao = await primario.posicaoAtual();
    return { resultado, posicao };
  };

  return { escolherConexao, escrever };
};`,
        },
        {
          type: 'paragraph',
          value:
            'O contador chamado de desvio por atraso é a parte mais valiosa desse código e passa despercebida na revisão. Em operação saudável ele fica próximo de zero, e ele sobe minutos antes de qualquer sintoma visível para o usuário, porque a replicação degrada gradualmente antes de degradar de forma perceptível. Alertar sobre a razão entre desvios e leituras totais dá um sinal antecipado que nenhum painel do banco fornece, porque o banco enxerga o atraso em segundos e não sabe quantas leituras da aplicação aquele atraso está de fato prejudicando.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe de implementação que costuma ser esquecido é o que fazer com o token quando o usuário abre uma segunda aba ou troca de dispositivo. O token vive na sessão, não no cliente individual, e por isso o lugar correto de guardá-lo é o armazenamento de sessão do lado do servidor, com o cookie carregando apenas o identificador. Guardar a posição diretamente no cookie funciona para uma aba só e falha silenciosamente quando o usuário abre a segunda, porque a aba antiga carrega uma posição defasada e nada quebra de forma visível: ela apenas serve leituras locais que a outra aba já sabia estarem desatualizadas.',
        },
      ],
    },
    {
      title: 'A escrita continua atravessando o oceano, e isso precisa ser projetado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nenhuma técnica de roteamento de leitura muda o fato de que uma escrita originada em São Paulo com primário em Frankfurt paga cerca de cento e oitenta milissegundos só de ida e volta na rede. Se o fluxo de cadastro faz seis escritas sequenciais, o usuário espera mais de um segundo apenas em propagação, sem nenhum tempo de processamento envolvido. É aqui que a latência deixa de ser uma métrica de infraestrutura e vira uma decisão de produto, porque a correção não está no banco: está em quantas idas e voltas o fluxo exige.',
        },
        {
          type: 'ordered',
          items: [
            'Contar as idas e voltas ao primário por fluxo de negócio, não por endpoint. O número que importa é quantas vezes uma jornada completa atravessa a distância, e ele costuma ser bem maior do que o time imagina.',
            'Agrupar escritas relacionadas em uma única transação enviada de uma vez. Seis escritas sequenciais viram uma chamada, e o custo de rede cai de seis viagens para uma.',
            'Mover validações que só leem dados para a réplica local antes de abrir a transação, para que o caminho longo carregue apenas o que de fato precisa ser confirmado.',
            'Confirmar ao usuário assim que o primário confirmou, sem esperar a replicação alcançar a região de origem, e servir a próxima tela usando o token de posição.',
            'Para escritas que não precisam de resposta imediata, gravar localmente em um outbox e propagar de forma assíncrona, aceitando que aquele dado só existe de verdade depois da propagação.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quinto item é o que exige mais cuidado, porque ele muda a semântica do sistema. Um evento de rastreamento ou um registro de auditoria de leitura pode ser gravado localmente e propagado depois sem que ninguém perceba a diferença. Um pedido de compra não pode, porque a confirmação ao cliente cria uma obrigação que precisa sobreviver à perda daquela região antes da propagação. A pergunta que separa os dois casos é direta: se essa região desaparecer agora, antes de propagar, o dado perdido gera prejuízo, obrigação legal ou apenas uma métrica incompleta?',
        },
        {
          type: 'diagram',
          value: `  Usuário (São Paulo)
        |
        | 1. leitura de catálogo  ~18 ms
        v
  +------------------------+        replicação assíncrona
  |  Réplica local (BR)    | <---------------------------------+
  |  posição aplicada: 941 |                                   |
  +------------------------+                                   |
        ^                                                      |
        | 4. próxima tela: token 942 <= 941? não, então desvia  |
        |                                                      |
        |                                               +--------------+
        +----- 2. escrita (~180 ms ida e volta) ------>  |  Primário    |
        |                                               |  (Frankfurt) |
        +----- 3. leitura desviada (~180 ms) --------->  |  posição 942 |
                                                        +--------------+

  Regra: o desvio do passo 3 dura só até a réplica aplicar a posição 942.
  Sem o token, a alternativa é fixar o usuário no primário por tempo fixo,
  pagando 180 ms em toda leitura mesmo quando a réplica já está em dia.`,
        },
      ],
    },
    {
      title: 'Failover de escrita: automatizar a promoção é como perder dados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A promoção automática de uma réplica a primário parece o complemento natural da topologia, e é a decisão que mais destrói dados em incidentes de multi-região. O motivo é que a condição que dispara a promoção, a região primária parou de responder, é indistinguível da condição em que a região primária está viva e saudável mas a rede entre as regiões particionou. No segundo caso, promover a réplica cria duas regiões que aceitam escrita ao mesmo tempo, cada uma convencida de ser a única, e a reconciliação posterior é manual, cara e frequentemente impossível sem perder alguma coisa.',
        },
        {
          type: 'paragraph',
          value:
            'A propriedade que sustenta uma promoção segura não é a detecção de falha, é o quórum. Enquanto a decisão de promover depende de dois observadores, sempre existe uma configuração de rede em que os dois discordam. Com um terceiro ponto de observação em uma região independente, a promoção só acontece com a maioria dos votos, e a região isolada perde a votação e se recusa a aceitar escrita mesmo estando viva. Isso não é opcional em uma topologia que aceita promoção automática: sem o terceiro observador, a promoção é uma aposta contra a partição de rede.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo componente é o cercamento, que garante que o primário antigo pare de aceitar escrita antes que o novo comece. A forma robusta usa um número de época que só cresce, gravado junto com cada escrita. Quando a nova região é promovida, ela incrementa a época, e o primário antigo, ao voltar da partição, descobre que sua época é inferior à corrente e rejeita as escritas que ainda tinha em voo em vez de aplicá-las sobre um estado que já avançou sem ele.',
        },
        {
          type: 'code',
          value: `// operacao/cercamento-epoca.js
// Cercamento por epoca monotonica. Impede que o primario antigo, ao voltar
// de uma particao de rede, aplique escritas em voo sobre um estado que a
// nova regiao ja avancou. Detectar falha nunca e suficiente: a garantia vem
// de rejeitar escrita com epoca inferior a corrente.

export const criarGuardaEpoca = ({ registro, regiao }) => {
  let epocaLocal = null;

  /**
   * Chamado na promocao. O incremento e condicional no armazenamento
   * consistente (etcd, Consul, tabela com bloqueio) para que duas regioes
   * nunca obtenham a mesma epoca durante uma particao.
   */
  const assumirPrimario = async () => {
    const nova = await registro.incrementarEpoca({ regiao });
    epocaLocal = nova;
    return nova;
  };

  /**
   * Envolve toda escrita. A epoca corrente e lida do registro compartilhado
   * dentro da MESMA transacao da escrita, para que nao exista janela entre
   * a verificacao e a aplicacao.
   */
  const escreverCercado = async (transacao, executar) => {
    if (epocaLocal == null) {
      throw new Error('regiao nao e primaria: escrita recusada');
    }

    const corrente = await transacao.selecionarEpocaParaAtualizacao();

    if (corrente > epocaLocal) {
      // Perdemos a primazia enquanto esta escrita estava em voo. Aplicar
      // agora sobrescreveria decisoes que a nova regiao ja tomou.
      const anterior = epocaLocal;
      epocaLocal = null;
      throw new Error(
        'escrita rejeitada: epoca local ' + anterior + ' inferior a corrente ' + corrente,
      );
    }

    return executar(transacao);
  };

  return { assumirPrimario, escreverCercado };
};`,
        },
        {
          type: 'paragraph',
          value:
            'A leitura da época dentro da mesma transação da escrita é o detalhe que faz a diferença entre uma proteção real e uma checagem decorativa. Se a verificação acontece antes de abrir a transação, existe uma janela entre a comparação e a aplicação, e é exatamente nessa janela que a escrita perdida se encaixa durante um failover. O bloqueio de seleção para atualização é o que fecha essa janela, ao custo de uma linha de contenção por escrita, que é irrelevante comparada ao custo de reconciliar dois primários divergentes.',
        },
      ],
    },
    {
      title: 'O que medir para saber se a topologia está entregando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O painel padrão de multi-região mostra atraso de replicação em segundos e latência por região, e nenhuma das duas responde à pergunta que importa, que é se os usuários estão de fato recebendo respostas consistentes com o que acabaram de fazer. A métrica que responde é a razão entre leituras desviadas para o primário e leituras totais, segmentada por região. Ela mede diretamente quantas vezes a réplica local não conseguiu servir uma leitura que deveria ter servido.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Como calcular', 'Valor saudável', 'O que a variação indica'],
          rows: [
            [
              'Razão de desvio por atraso',
              'desvios dividido por leituras elegíveis a réplica, por região',
              'Abaixo de 1%',
              'Subida gradual antecipa degradação da replicação em minutos',
            ],
            [
              'Espera até consistência',
              'p99 do tempo gasto no laço de espera pela posição',
              'Abaixo de 15 ms',
              'Cauda crescendo mostra que a janela fixa alternativa erraria',
            ],
            [
              'Idas e voltas por jornada',
              'contagem de escritas no primário por fluxo completo',
              'Uma ou duas',
              'Acima disso o custo de rede domina a latência percebida',
            ],
            [
              'Atraso de replicação em posição',
              'posição do primário menos posição aplicada na réplica',
              'Estável e limitado',
              'Crescimento monotônico indica que a réplica não acompanha a escrita',
            ],
            [
              'Escritas rejeitadas por época',
              'contador do guarda de cercamento',
              'Zero fora de failover',
              'Qualquer valor fora de promoção indica dois primários ativos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale destacar por que a linha do atraso em posição é diferente da mesma métrica em segundos, que é a exposta por padrão pela maioria dos bancos. O atraso em segundos é calculado a partir do carimbo de tempo da última transação aplicada, e ele vai a zero quando o primário para de receber escrita, mesmo que a réplica esteja arbitrariamente atrasada. Uma réplica travada em um primário ocioso reporta atraso zero e parece perfeitamente saudável, e essa é justamente a condição que precede o failover que perde dados. A diferença de posições não tem esse ponto cego, porque ela compara duas posições reais do log em vez de comparar um relógio com o silêncio.',
        },
        {
          type: 'list',
          items: [
            'Teste de partição em ambiente controlado: bloquear a rota entre as regiões e verificar que a região isolada rejeita escrita em vez de promover a si mesma.',
            'Teste de leitura da própria escrita: escrever e ler imediatamente na região mais distante, com replicação artificialmente atrasada, confirmando que a leitura desvia em vez de retornar o valor antigo.',
            'Teste de época: promover a réplica, restaurar o primário antigo com escritas em voo e confirmar que elas são rejeitadas e registradas, não aplicadas silenciosamente.',
            'Exercício de failover com cronômetro, medindo o tempo entre a decisão humana e a primeira escrita aceita na nova região, porque esse número é o objetivo de recuperação real.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale a pena colocar uma segunda região quando o tráfego de escrita é alto?',
      answer:
        'A resposta depende quase inteiramente da proporção entre leitura e escrita e da distribuição geográfica dos usuários, e não do volume absoluto. Um sistema com noventa por cento de leitura e usuários espalhados por dois continentes ganha muito com a réplica local, porque a esmagadora maioria das requisições passa a ser servida perto de quem pediu, e as escritas continuam pagando a travessia sem que isso domine a experiência. Um sistema com quarenta por cento de escrita e usuários concentrados em uma região só está trocando complexidade operacional por um ganho que quase não existe, e provavelmente resolveria melhor o problema com cache de leitura e otimização de consulta na região única. O erro que aparece com frequência é considerar apenas a latência média e ignorar quantas idas e voltas ao primário cada jornada faz: um fluxo de cadastro com seis escritas sequenciais fica pior em multi-região do que estava em região única, mesmo com todas as leituras aceleradas, e nenhuma configuração de banco corrige isso. Antes de decidir pela topologia, meça idas e voltas por jornada de negócio, porque esse número determina se a segunda região vai melhorar ou piorar a experiência percebida.',
    },
    {
      question: 'Banco multi-master resolveria o problema da latência de escrita?',
      answer:
        'Ele resolve a latência de escrita e cobra o preço em outro lugar, que é a resolução de conflito, e esse preço quase nunca é de infraestrutura. Quando duas regiões aceitam escrita sobre a mesma entidade, alguma delas precisa decidir qual versão vence, e as estratégias automáticas disponíveis são todas insatisfatórias para dados transacionais: a última escrita vence descarta silenciosamente uma alteração legítima, e a mesclagem por campo produz um estado que nenhum dos dois usuários pediu. O caso em que multi-master funciona bem é aquele em que a estrutura de dados é naturalmente convergente, como um contador incremental, um conjunto ao qual só se adiciona, ou um documento colaborativo com um tipo de dado replicado sem conflito por trás. Para saldo de conta, controle de estoque ou status de pedido, o conflito não tem resolução automática correta, porque a resposta certa depende de regra de negócio que o banco não conhece. Na prática a maioria dos sistemas que adotou multi-master acabou particionando a escrita por chave, o que é escrita única por partição com outro nome, e essa é frequentemente a arquitetura certa desde o começo.',
    },
    {
      question: 'Como lidar com residência de dados quando a escrita é única em uma região?',
      answer:
        'Regulação de residência transforma a topologia de uma decisão de latência em uma restrição de arquitetura, e ela normalmente inviabiliza a escrita única global para os dados afetados. O padrão que funciona é separar o modelo em duas classes: dados regulados, que vivem inteiramente dentro da região exigida e nunca são replicados para fora, e dados globais, como catálogo, configuração e metadados operacionais, que continuam com escrita única e réplicas em toda parte. Isso significa que a chave de particionamento passa a incluir a jurisdição, e que uma consulta que cruza jurisdições deixa de ser uma junção no banco e vira duas consultas com composição na aplicação, o que precisa ser projetado desde cedo porque é caro reformar depois. A parte que costuma ser subestimada é o que conta como dado regulado: registros de log, traços de observabilidade, backups e até chaves de cache podem carregar identificadores pessoais e acabar fora da jurisdição sem que ninguém tenha decidido isso. Vale mapear todo caminho por onde um dado sai da região, incluindo os que existem para operar o sistema e não para servi-lo, porque é por eles que o vazamento de jurisdição acontece na prática.',
    },
  ],
  conclusion: {
    title: 'A distância entre regiões vira comportamento de produto quer você decida ou não',
    description:
      'A segunda região melhora a latência de leitura de forma imediata e mensurável, e introduz uma classe de comportamento que não existia antes: o usuário passa a poder ver um estado anterior ao que ele mesmo acabou de escrever. Ignorar isso não faz o problema desaparecer, apenas transfere a decisão para o acaso da replicação. Posso mapear as operações do seu sistema entre as que toleram réplica local e as que exigem o primário, implementar leitura da própria escrita com token de posição em vez de fixação por tempo, reduzir as idas e voltas ao primário nos fluxos que mais custam latência, introduzir cercamento por época com quórum de três observadores antes de qualquer promoção automática, e deixar no painel a razão de desvio que antecipa a degradação da replicação em minutos.',
    cta: 'Falar sobre a topologia multi-região do meu sistema',
  },
  related: [
    {
      label: 'Cache invalidado errado: quando o dado velho custa mais caro que a consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The second region went up in an afternoon and the latency dashboard improved the same hour: reads that took two hundred and thirty milliseconds started taking eighteen. Three weeks later the tickets began, from customers who saved a form and saw the old value come back on the next screen. The database had no bug, replication was healthy, and the average lag between replicas was forty milliseconds. The problem is that the single writer architecture turned a physical property, the distance between continents, into product behavior nobody had decided on. This article shows why a single writer is almost always the right choice and why it charges you exactly where nobody is looking, which calculation separates the operation that can read from the local replica from the one that has to cross the ocean, how to implement read your writes without pinning the user to the primary region forever, why write failover is a manual decision disguised as automation, and which metric proves the topology is delivering what it promised before the customer complains.',
  sections: [
    {
      title: 'A single writer is not a technical limitation, it is a consistency contract',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The multi-region discussion usually starts off wrong because it treats the single writer as a temporary stage, something to be solved later with a multi-master database. The single writer topology exists because it is the only one that keeps a total ordering of events without distributed coordination on the critical path. There is exactly one place where the sequence of commits is decided, and as a consequence there is exactly one answer to questions like what was the last change to this order. Once you distribute the write, that question stops having a single answer and starts requiring conflict resolution, which is a business decision, not a database setting.',
        },
        {
          type: 'paragraph',
          value:
            'What the second region changes is not write capacity, it is the geography of reads. Local replicas turn two hundred millisecond queries into twenty millisecond queries, and that is a real, measurable improvement. The cost shows up because the local replica is always behind the primary, and that lag is not noise: it is network propagation time plus log apply time, typically between thirty and one hundred and fifty milliseconds across continents under healthy conditions, and whole seconds during a write burst or primary maintenance.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that a system that used to have a single class of read now has two, and the distinction between them is not technical. It depends on who is reading and on what that person just did. A sales report for last month tolerates half a second of lag with no problem at all, because no human can notice it. The screen that appears immediately after the user saves a form tolerates not even forty milliseconds, because the user knows exactly what they just wrote and will compare. Classifying operations into those two categories is the core work of a multi-region migration, and it happens in application code, not in database configuration.',
        },
        {
          type: 'table',
          columns: ['Operation', 'Where to read', 'Tolerated lag', 'What happens if you choose wrong'],
          rows: [
            [
              'Product catalog, public listing',
              'Local replica',
              'Seconds',
              'Nothing noticeable, and reading from the primary wastes latency',
            ],
            [
              'Screen right after saving a record',
              'Primary or replica with a version token',
              'Zero',
              'User sees the old value and saves again, creating duplicates',
            ],
            [
              'Balance before authorizing a transfer',
              'Primary, always',
              'Zero',
              'Authorizes an operation against a balance already spent',
            ],
            [
              'Analytical report for a closed period',
              'Local replica or dedicated replica',
              'Minutes',
              'No impact, and reading from the primary competes with transactional traffic',
            ],
            [
              'Permission check after a role change',
              'Primary until replication catches up',
              'Zero',
              'User keeps access that was just revoked',
            ],
          ],
        },
      ],
    },
    {
      title: 'Read your writes without pinning the user to the primary',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first solution that comes up for the stale screen problem is to pin the user session to the primary after any write. It works, and it throws away the reason the second region exists: any user who interacts with the system goes back to paying transatlantic latency on every following read. The slightly less bad variant, pinning the user to the primary for thirty seconds, is still a number picked by guesswork, and it is wrong in both directions: too short when replication lags, and too long in the overwhelming majority of cases where it is healthy.',
        },
        {
          type: 'paragraph',
          value:
            'The correct solution uses the replication log position as a token. Every write returns the position at which it was committed on the primary, that position travels with the user in a cookie or header, and every read compares the token against the position the local replica has already applied. If the replica reached that position, the local read is served and is provably consistent with what the user wrote. If it has not, there is an explicit choice between waiting a few milliseconds or diverting that specific read to the primary. What makes this far better than a fixed window is that it self-adjusts: when replication lag is forty milliseconds, practically no read diverts; when it degrades, the diversion happens for exactly as long as it is needed.',
        },
        {
          type: 'code',
          value: `// dados/roteador-leitura.js
// Roteia cada leitura para a replica local ou para o primario com base na
// posicao de replicacao que o usuario ja observou (read-your-writes).
// O token nao e um timestamp: comparar relogios entre regioes e justamente
// o que nao funciona. E a posicao monotonica do log do primario.

const ESPERA_MAXIMA_MS = 60;   // acima disso, atravessar o oceano e mais rapido
const INTERVALO_SONDA_MS = 5;

export const criarRoteadorLeitura = ({ primario, replicaLocal, metricas }) => {
  /**
   * @param {object} ctx
   * @param {bigint|null} ctx.posicaoObservada  ultima posicao escrita pelo usuario
   * @param {boolean} ctx.exigeAtual            operacao que nunca aceita atraso
   */
  const escolherConexao = async ({ posicaoObservada, exigeAtual }) => {
    if (exigeAtual) {
      metricas.incrementar('leitura.primario.exigida');
      return primario;
    }

    // Usuario que nunca escreveu nesta sessao nao tem nada a esperar.
    if (posicaoObservada == null) {
      metricas.incrementar('leitura.local.sem_token');
      return replicaLocal;
    }

    const inicio = process.hrtime.bigint();

    // Espera curta e limitada: na maior parte das vezes a replica ja
    // alcancou e o laco encerra na primeira iteracao, sem custo.
    while (true) {
      const aplicada = await replicaLocal.posicaoAplicada();
      if (aplicada >= posicaoObservada) {
        const esperaMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        metricas.observar('leitura.local.espera_ms', esperaMs);
        return replicaLocal;
      }

      const decorridoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      if (decorridoMs >= ESPERA_MAXIMA_MS) {
        // Desviar e a decisao certa aqui: esperar mais custaria ao usuario
        // mais do que a ida ate o primario. O contador abaixo e o sinal de
        // que a replicacao degradou, e ele se move antes de qualquer ticket.
        metricas.incrementar('leitura.primario.desvio_por_atraso');
        return primario;
      }

      await new Promise((r) => setTimeout(r, INTERVALO_SONDA_MS));
    }
  };

  /**
   * Executa a escrita e devolve a posicao para o chamador propagar ao cliente.
   */
  const escrever = async (executar) => {
    const resultado = await primario.transacao(executar);
    const posicao = await primario.posicaoAtual();
    return { resultado, posicao };
  };

  return { escolherConexao, escrever };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The counter for diversions caused by lag is the most valuable part of that code and it goes unnoticed in review. Under healthy operation it sits near zero, and it rises minutes before any symptom visible to the user, because replication degrades gradually before it degrades noticeably. Alerting on the ratio between diversions and total reads gives an early signal that no database dashboard provides, because the database sees lag in seconds and has no idea how many application reads that lag is actually hurting.',
        },
        {
          type: 'paragraph',
          value:
            'An implementation detail that tends to be forgotten is what to do with the token when the user opens a second tab or switches devices. The token belongs to the session, not to the individual client, which is why the right place to keep it is server side session storage, with the cookie carrying only the identifier. Storing the position directly in the cookie works for a single tab and fails silently when the user opens a second one, because the old tab carries a stale position and nothing breaks visibly: it simply serves local reads the other tab already knew were out of date.',
        },
      ],
    },
    {
      title: 'Writes still cross the ocean, and that has to be designed for',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No read routing technique changes the fact that a write originating in Sao Paulo with a primary in Frankfurt pays roughly one hundred and eighty milliseconds in network round trip alone. If the signup flow performs six sequential writes, the user waits more than a second in propagation alone, with no processing time involved at all. This is where latency stops being an infrastructure metric and becomes a product decision, because the fix is not in the database: it is in how many round trips the flow requires.',
        },
        {
          type: 'ordered',
          items: [
            'Count round trips to the primary per business flow, not per endpoint. The number that matters is how many times a complete journey crosses the distance, and it is usually far larger than the team assumes.',
            'Group related writes into a single transaction sent at once. Six sequential writes become one call, and the network cost drops from six trips to one.',
            'Move read only validations to the local replica before opening the transaction, so the long path carries only what actually has to be committed.',
            'Confirm to the user as soon as the primary commits, without waiting for replication to reach the region of origin, and serve the next screen using the position token.',
            'For writes that do not need an immediate answer, record them locally in an outbox and propagate asynchronously, accepting that the data only truly exists after propagation.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth item is the one that demands the most care, because it changes the semantics of the system. A tracking event or a read audit record can be written locally and propagated later without anyone noticing the difference. A purchase order cannot, because the confirmation given to the customer creates an obligation that has to survive the loss of that region before propagation. The question that separates the two cases is direct: if this region disappears right now, before propagating, does the lost data create financial loss, a legal obligation, or just an incomplete metric?',
        },
        {
          type: 'diagram',
          value: `  User (Sao Paulo)
        |
        | 1. catalog read  ~18 ms
        v
  +-------------------------+       asynchronous replication
  |  Local replica (BR)     | <---------------------------------+
  |  applied position: 941  |                                   |
  +-------------------------+                                   |
        ^                                                       |
        | 4. next screen: token 942 <= 941? no, so divert        |
        |                                                       |
        |                                               +--------------+
        +----- 2. write (~180 ms round trip) --------->  |  Primary     |
        |                                               |  (Frankfurt) |
        +----- 3. diverted read (~180 ms) ----------->   |  position 942|
                                                        +--------------+

  Rule: the step 3 diversion lasts only until the replica applies position 942.
  Without the token, the alternative is pinning the user to the primary for a
  fixed window, paying 180 ms on every read even when the replica is caught up.`,
        },
      ],
    },
    {
      title: 'Write failover: automating promotion is how you lose data',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Automatic promotion of a replica to primary looks like the natural complement of the topology, and it is the decision that destroys the most data in multi-region incidents. The reason is that the condition triggering promotion, the primary region stopped responding, is indistinguishable from the condition where the primary region is alive and healthy but the network between regions has partitioned. In the second case, promoting the replica creates two regions accepting writes at the same time, each convinced it is the only one, and the later reconciliation is manual, expensive and frequently impossible without losing something.',
        },
        {
          type: 'paragraph',
          value:
            'The property that supports a safe promotion is not failure detection, it is quorum. As long as the decision to promote depends on two observers, there is always a network configuration in which the two disagree. With a third observation point in an independent region, promotion only happens with a majority of votes, and the isolated region loses the vote and refuses to accept writes even while alive. This is not optional in a topology that allows automatic promotion: without the third observer, promotion is a bet against network partitions.',
        },
        {
          type: 'paragraph',
          value:
            'The second component is fencing, which guarantees that the old primary stops accepting writes before the new one starts. The robust form uses a monotonically increasing epoch number, recorded together with every write. When the new region is promoted it increments the epoch, and the old primary, on returning from the partition, finds that its epoch is below the current one and rejects the writes it still had in flight instead of applying them on top of a state that already moved on without it.',
        },
        {
          type: 'code',
          value: `// operacao/cercamento-epoca.js
// Cercamento por epoca monotonica. Impede que o primario antigo, ao voltar
// de uma particao de rede, aplique escritas em voo sobre um estado que a
// nova regiao ja avancou. Detectar falha nunca e suficiente: a garantia vem
// de rejeitar escrita com epoca inferior a corrente.

export const criarGuardaEpoca = ({ registro, regiao }) => {
  let epocaLocal = null;

  /**
   * Chamado na promocao. O incremento e condicional no armazenamento
   * consistente (etcd, Consul, tabela com bloqueio) para que duas regioes
   * nunca obtenham a mesma epoca durante uma particao.
   */
  const assumirPrimario = async () => {
    const nova = await registro.incrementarEpoca({ regiao });
    epocaLocal = nova;
    return nova;
  };

  /**
   * Envolve toda escrita. A epoca corrente e lida do registro compartilhado
   * dentro da MESMA transacao da escrita, para que nao exista janela entre
   * a verificacao e a aplicacao.
   */
  const escreverCercado = async (transacao, executar) => {
    if (epocaLocal == null) {
      throw new Error('regiao nao e primaria: escrita recusada');
    }

    const corrente = await transacao.selecionarEpocaParaAtualizacao();

    if (corrente > epocaLocal) {
      // Perdemos a primazia enquanto esta escrita estava em voo. Aplicar
      // agora sobrescreveria decisoes que a nova regiao ja tomou.
      const anterior = epocaLocal;
      epocaLocal = null;
      throw new Error(
        'escrita rejeitada: epoca local ' + anterior + ' inferior a corrente ' + corrente,
      );
    }

    return executar(transacao);
  };

  return { assumirPrimario, escreverCercado };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Reading the epoch inside the same transaction as the write is the detail that separates real protection from a decorative check. If the verification happens before opening the transaction, there is a window between the comparison and the application, and that window is exactly where the lost write fits during a failover. The select for update lock is what closes that window, at the cost of one contention row per write, which is irrelevant compared to the cost of reconciling two divergent primaries.',
        },
      ],
    },
    {
      title: 'What to measure to know the topology is delivering',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The standard multi-region dashboard shows replication lag in seconds and latency per region, and neither answers the question that matters, which is whether users are actually receiving responses consistent with what they just did. The metric that answers it is the ratio between reads diverted to the primary and total reads, segmented by region. It directly measures how many times the local replica failed to serve a read it should have served.',
        },
        {
          type: 'table',
          columns: ['Metric', 'How to compute', 'Healthy value', 'What the variation indicates'],
          rows: [
            [
              'Lag diversion ratio',
              'diversions divided by replica eligible reads, per region',
              'Below 1%',
              'A gradual rise anticipates replication degradation by minutes',
            ],
            [
              'Wait until consistency',
              'p99 of the time spent in the position wait loop',
              'Below 15 ms',
              'A growing tail shows the fixed window alternative would be wrong',
            ],
            [
              'Round trips per journey',
              'count of primary writes per complete flow',
              'One or two',
              'Above that, network cost dominates perceived latency',
            ],
            [
              'Replication lag in position',
              'primary position minus position applied on the replica',
              'Stable and bounded',
              'Monotonic growth means the replica is not keeping up with writes',
            ],
            [
              'Writes rejected by epoch',
              'counter from the fencing guard',
              'Zero outside failover',
              'Any value outside promotion means two active primaries',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'It is worth highlighting why the position lag row differs from the same metric in seconds, which is what most databases expose by default. Lag in seconds is computed from the timestamp of the last applied transaction, and it goes to zero when the primary stops receiving writes, even if the replica is arbitrarily behind. A stuck replica on an idle primary reports zero lag and looks perfectly healthy, and that is precisely the condition preceding the failover that loses data. The position difference has no such blind spot, because it compares two real log positions instead of comparing a clock against silence.',
        },
        {
          type: 'list',
          items: [
            'Partition test in a controlled environment: block the route between regions and verify the isolated region rejects writes instead of promoting itself.',
            'Read your writes test: write and immediately read in the most distant region, with replication artificially delayed, confirming the read diverts instead of returning the old value.',
            'Epoch test: promote the replica, restore the old primary with writes in flight and confirm they are rejected and logged, not silently applied.',
            'Failover drill with a stopwatch, measuring the time between the human decision and the first write accepted in the new region, because that number is the real recovery objective.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is a second region worth it when write traffic is high?',
      answer:
        'The answer depends almost entirely on the read to write ratio and on the geographic distribution of users, not on absolute volume. A system with ninety percent reads and users spread across two continents gains a lot from the local replica, because the overwhelming majority of requests are served close to whoever asked, and writes keep paying for the crossing without that dominating the experience. A system with forty percent writes and users concentrated in a single region is trading operational complexity for a gain that barely exists, and would probably solve the problem better with read caching and query optimization inside the single region. The mistake that shows up frequently is looking only at average latency and ignoring how many round trips to the primary each journey makes: a signup flow with six sequential writes ends up worse in multi-region than it was in a single region, even with every read accelerated, and no database configuration fixes that. Before committing to the topology, measure round trips per business journey, because that number determines whether the second region will improve or worsen perceived experience.',
    },
    {
      question: 'Would a multi-master database solve the write latency problem?',
      answer:
        'It solves write latency and charges the price somewhere else, which is conflict resolution, and that price is almost never about infrastructure. When two regions accept writes to the same entity, one of them has to decide which version wins, and the automatic strategies available are all unsatisfactory for transactional data: last write wins silently discards a legitimate change, and field level merging produces a state neither user asked for. The case where multi-master works well is one where the data structure is naturally convergent, such as an incrementing counter, a set you only add to, or a collaborative document backed by a conflict free replicated data type. For account balance, inventory control or order status, the conflict has no correct automatic resolution, because the right answer depends on business rules the database does not know. In practice most systems that adopted multi-master ended up partitioning writes by key, which is a single writer per partition under another name, and that is frequently the right architecture from the start.',
    },
    {
      question: 'How do I handle data residency when the write is single region?',
      answer:
        'Residency regulation turns the topology from a latency decision into an architectural constraint, and it usually rules out a globally single writer for the affected data. The pattern that works is splitting the model into two classes: regulated data, which lives entirely inside the required region and is never replicated outside it, and global data such as catalog, configuration and operational metadata, which keeps a single writer with replicas everywhere. That means the partitioning key now includes the jurisdiction, and that a query crossing jurisdictions stops being a database join and becomes two queries composed in the application, which has to be designed for early because it is expensive to retrofit. The part that tends to be underestimated is what counts as regulated data: log records, observability traces, backups and even cache keys can carry personal identifiers and end up outside the jurisdiction without anyone having decided that. It pays to map every path through which data leaves the region, including the ones that exist to operate the system rather than to serve it, because those are where jurisdiction leakage actually happens.',
    },
  ],
  conclusion: {
    title: 'The distance between regions becomes product behavior whether you decide it or not',
    description:
      'The second region improves read latency immediately and measurably, and it introduces a class of behavior that did not exist before: the user can now see a state older than what they themselves just wrote. Ignoring that does not make the problem go away, it only hands the decision over to whatever replication happens to do. I can map your system operations into those that tolerate the local replica and those that require the primary, implement read your writes with a position token instead of time based pinning, reduce round trips to the primary in the flows where latency costs the most, introduce epoch fencing with a three observer quorum before any automatic promotion, and leave the diversion ratio on the dashboard so replication degradation is visible minutes in advance.',
    cta: 'Talk about the multi-region topology of my system',
  },
  related: [
    {
      label: 'Wrongly invalidated cache: when stale data costs more than the query',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Database migration without a maintenance window: expand, migrate, contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La segunda región se levantó en una tarde y el panel de latencia mejoró en la misma hora: lecturas que tardaban doscientos treinta milisegundos pasaron a tardar dieciocho. Tres semanas después empezaron los tickets de clientes que guardaban un formulario y veían volver el valor antiguo en la pantalla siguiente. La base de datos no tenía ningún bug, la replicación estaba sana, y el retraso medio entre las réplicas era de cuarenta milisegundos. El problema es que la arquitectura de escritura única convirtió una propiedad física, la distancia entre continentes, en un comportamiento de producto que nadie había decidido. Este artículo muestra por qué la escritura única es casi siempre la elección correcta y por qué cobra caro justo donde nadie mira, qué cuenta separa la operación que puede leer de la réplica local de la que tiene que cruzar el océano, cómo implementar lectura de la propia escritura sin fijar al usuario en la región primaria para siempre, por qué el failover de escritura es una decisión manual disfrazada de automatización, y qué métrica demuestra que la topología está entregando lo prometido antes de que el cliente reclame.',
  sections: [
    {
      title: 'La escritura única no es una limitación técnica, es un contrato de consistencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La discusión sobre multirregión suele empezar mal porque trata la escritura única como una etapa provisional, algo que se resuelve después con una base multi-master. La topología de escritura única existe porque es la única que permite mantener un orden total de los eventos sin coordinación distribuida en el camino crítico. Hay un único lugar donde se decide la secuencia de commits, y por consecuencia hay una única respuesta a preguntas como cuál fue el último cambio de ese pedido. Cuando distribuyes la escritura, esa pregunta deja de tener respuesta única y pasa a exigir resolución de conflicto, que es una decisión de negocio, no una configuración de base de datos.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que cambia con la segunda región no es la capacidad de escritura, es la geografía de la lectura. Las réplicas locales convierten consultas de doscientos milisegundos en consultas de veinte, y eso es una mejora real y medible. El costo aparece porque la réplica local siempre está retrasada respecto al primario, y ese retraso no es ruido: es el tiempo de propagación de la red más el tiempo de aplicación del log, típicamente entre treinta y ciento cincuenta milisegundos entre continentes en condición sana, y segundos enteros durante una ráfaga de escritura o un mantenimiento del primario.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que un sistema que antes tenía una única clase de lectura pasa a tener dos, y la distinción entre ellas no es técnica. Depende de quién está leyendo y de lo que esa persona acaba de hacer. Un informe de ventas del mes pasado tolera medio segundo de retraso sin ningún problema, porque ningún humano lo nota. La pantalla que aparece inmediatamente después de que el usuario guarda un formulario no tolera ni cuarenta milisegundos, porque el usuario sabe exactamente lo que acaba de escribir y va a comparar. Clasificar las operaciones en esas dos categorías es el trabajo central de una migración multirregión, y se hace en el código de aplicación, no en la configuración de la base de datos.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Dónde leer', 'Retraso tolerado', 'Qué pasa si se elige mal'],
          rows: [
            [
              'Catálogo de productos, listado público',
              'Réplica local',
              'Segundos',
              'Nada perceptible, y leer del primario desperdicia latencia',
            ],
            [
              'Pantalla justo después de guardar un registro',
              'Primario o réplica con marca de versión',
              'Cero',
              'El usuario ve el valor antiguo y guarda de nuevo, generando duplicados',
            ],
            [
              'Saldo antes de autorizar una transferencia',
              'Primario, siempre',
              'Cero',
              'Autoriza una operación sobre un saldo ya consumido',
            ],
            [
              'Informe analítico del periodo cerrado',
              'Réplica local o réplica dedicada',
              'Minutos',
              'Ningún impacto, y leer del primario compite con el tráfico transaccional',
            ],
            [
              'Verificación de permiso tras cambio de perfil',
              'Primario hasta que la replicación alcance',
              'Cero',
              'El usuario mantiene un acceso que acaba de ser revocado',
            ],
          ],
        },
      ],
    },
    {
      title: 'Lectura de la propia escritura sin atar al usuario al primario',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera solución que aparece para el problema de la pantalla desactualizada es fijar la sesión del usuario al primario después de cualquier escritura. Funciona, y tira a la basura la razón de existir de la segunda región: cualquier usuario que interactúe con el sistema vuelve a pagar la latencia transatlántica en todas las lecturas siguientes. La variante un poco menos mala, que fija al usuario en el primario durante treinta segundos, sigue siendo un número elegido al azar, y se equivoca en las dos direcciones: es demasiado corto cuando la replicación se retrasa, y demasiado largo en la abrumadora mayoría de las veces en que está sana.',
        },
        {
          type: 'paragraph',
          value:
            'La solución correcta usa la posición del log de replicación como token. Toda escritura devuelve la posición en que fue confirmada en el primario, esa posición viaja con el usuario en una cookie o cabecera, y cada lectura compara el token con la posición que la réplica local ya aplicó. Si la réplica alcanzó esa posición, la lectura local se sirve y es demostrablemente consistente con lo que el usuario escribió. Si aún no la alcanzó, existe una elección explícita entre esperar algunos milisegundos o desviar esa lectura específica al primario. Lo que hace esto mucho mejor que una ventana fija es que se autoajusta: cuando la replicación tiene cuarenta milisegundos de retraso, prácticamente ninguna lectura se desvía; cuando degrada, el desvío ocurre exactamente durante el tiempo que haga falta.',
        },
        {
          type: 'code',
          value: `// dados/roteador-leitura.js
// Roteia cada leitura para a replica local ou para o primario com base na
// posicao de replicacao que o usuario ja observou (read-your-writes).
// O token nao e um timestamp: comparar relogios entre regioes e justamente
// o que nao funciona. E a posicao monotonica do log do primario.

const ESPERA_MAXIMA_MS = 60;   // acima disso, atravessar o oceano e mais rapido
const INTERVALO_SONDA_MS = 5;

export const criarRoteadorLeitura = ({ primario, replicaLocal, metricas }) => {
  /**
   * @param {object} ctx
   * @param {bigint|null} ctx.posicaoObservada  ultima posicao escrita pelo usuario
   * @param {boolean} ctx.exigeAtual            operacao que nunca aceita atraso
   */
  const escolherConexao = async ({ posicaoObservada, exigeAtual }) => {
    if (exigeAtual) {
      metricas.incrementar('leitura.primario.exigida');
      return primario;
    }

    // Usuario que nunca escreveu nesta sessao nao tem nada a esperar.
    if (posicaoObservada == null) {
      metricas.incrementar('leitura.local.sem_token');
      return replicaLocal;
    }

    const inicio = process.hrtime.bigint();

    // Espera curta e limitada: na maior parte das vezes a replica ja
    // alcancou e o laco encerra na primeira iteracao, sem custo.
    while (true) {
      const aplicada = await replicaLocal.posicaoAplicada();
      if (aplicada >= posicaoObservada) {
        const esperaMs = Number(process.hrtime.bigint() - inicio) / 1e6;
        metricas.observar('leitura.local.espera_ms', esperaMs);
        return replicaLocal;
      }

      const decorridoMs = Number(process.hrtime.bigint() - inicio) / 1e6;
      if (decorridoMs >= ESPERA_MAXIMA_MS) {
        // Desviar e a decisao certa aqui: esperar mais custaria ao usuario
        // mais do que a ida ate o primario. O contador abaixo e o sinal de
        // que a replicacao degradou, e ele se move antes de qualquer ticket.
        metricas.incrementar('leitura.primario.desvio_por_atraso');
        return primario;
      }

      await new Promise((r) => setTimeout(r, INTERVALO_SONDA_MS));
    }
  };

  /**
   * Executa a escrita e devolve a posicao para o chamador propagar ao cliente.
   */
  const escrever = async (executar) => {
    const resultado = await primario.transacao(executar);
    const posicao = await primario.posicaoAtual();
    return { resultado, posicao };
  };

  return { escolherConexao, escrever };
};`,
        },
        {
          type: 'paragraph',
          value:
            'El contador de desvío por retraso es la parte más valiosa de ese código y pasa desapercibida en la revisión. En operación sana se mantiene cerca de cero, y sube minutos antes de cualquier síntoma visible para el usuario, porque la replicación degrada gradualmente antes de degradar de forma perceptible. Alertar sobre la razón entre desvíos y lecturas totales da una señal anticipada que ningún panel de la base de datos ofrece, porque la base ve el retraso en segundos y no sabe cuántas lecturas de la aplicación está perjudicando ese retraso.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle de implementación que suele olvidarse es qué hacer con el token cuando el usuario abre una segunda pestaña o cambia de dispositivo. El token pertenece a la sesión, no al cliente individual, y por eso el lugar correcto para guardarlo es el almacenamiento de sesión del lado del servidor, con la cookie llevando solo el identificador. Guardar la posición directamente en la cookie funciona para una sola pestaña y falla en silencio cuando el usuario abre la segunda, porque la pestaña antigua lleva una posición desfasada y nada se rompe de forma visible: simplemente sirve lecturas locales que la otra pestaña ya sabía desactualizadas.',
        },
      ],
    },
    {
      title: 'La escritura sigue cruzando el océano, y eso hay que diseñarlo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ninguna técnica de enrutamiento de lectura cambia el hecho de que una escritura originada en São Paulo con primario en Fráncfort paga cerca de ciento ochenta milisegundos solo de ida y vuelta en la red. Si el flujo de registro hace seis escrituras secuenciales, el usuario espera más de un segundo solo en propagación, sin ningún tiempo de procesamiento involucrado. Aquí es donde la latencia deja de ser una métrica de infraestructura y se vuelve una decisión de producto, porque la corrección no está en la base de datos: está en cuántas idas y vueltas exige el flujo.',
        },
        {
          type: 'ordered',
          items: [
            'Contar las idas y vueltas al primario por flujo de negocio, no por endpoint. El número que importa es cuántas veces un recorrido completo cruza la distancia, y suele ser bastante mayor de lo que el equipo imagina.',
            'Agrupar escrituras relacionadas en una única transacción enviada de una vez. Seis escrituras secuenciales se vuelven una llamada, y el costo de red cae de seis viajes a uno.',
            'Mover las validaciones que solo leen datos a la réplica local antes de abrir la transacción, para que el camino largo lleve solo lo que de hecho hay que confirmar.',
            'Confirmar al usuario en cuanto el primario confirmó, sin esperar a que la replicación alcance la región de origen, y servir la pantalla siguiente usando el token de posición.',
            'Para escrituras que no necesitan respuesta inmediata, grabar localmente en un outbox y propagar de forma asíncrona, aceptando que ese dato solo existe de verdad después de la propagación.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El quinto punto es el que exige más cuidado, porque cambia la semántica del sistema. Un evento de seguimiento o un registro de auditoría de lectura puede grabarse localmente y propagarse después sin que nadie note la diferencia. Un pedido de compra no puede, porque la confirmación al cliente crea una obligación que tiene que sobrevivir a la pérdida de esa región antes de la propagación. La pregunta que separa los dos casos es directa: si esa región desaparece ahora, antes de propagar, el dato perdido genera perjuicio, obligación legal o solo una métrica incompleta?',
        },
        {
          type: 'diagram',
          value: `  Usuario (São Paulo)
        |
        | 1. lectura de catálogo  ~18 ms
        v
  +--------------------------+      replicación asíncrona
  |  Réplica local (BR)      | <--------------------------------+
  |  posición aplicada: 941  |                                  |
  +--------------------------+                                  |
        ^                                                       |
        | 4. próxima pantalla: token 942 <= 941? no, se desvía   |
        |                                                       |
        |                                               +---------------+
        +----- 2. escritura (~180 ms ida y vuelta) --->  |  Primario     |
        |                                               |  (Fráncfort)  |
        +----- 3. lectura desviada (~180 ms) -------->   |  posición 942 |
                                                        +---------------+

  Regla: el desvío del paso 3 dura solo hasta que la réplica aplique la 942.
  Sin el token, la alternativa es fijar al usuario en el primario por tiempo
  fijo, pagando 180 ms en cada lectura aunque la réplica ya esté al día.`,
        },
      ],
    },
    {
      title: 'Failover de escritura: automatizar la promoción es perder datos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La promoción automática de una réplica a primario parece el complemento natural de la topología, y es la decisión que más datos destruye en incidentes multirregión. El motivo es que la condición que dispara la promoción, la región primaria dejó de responder, es indistinguible de la condición en que la región primaria está viva y sana pero la red entre las regiones se particionó. En el segundo caso, promover la réplica crea dos regiones que aceptan escritura al mismo tiempo, cada una convencida de ser la única, y la reconciliación posterior es manual, cara y frecuentemente imposible sin perder algo.',
        },
        {
          type: 'paragraph',
          value:
            'La propiedad que sostiene una promoción segura no es la detección de fallo, es el quórum. Mientras la decisión de promover dependa de dos observadores, siempre existe una configuración de red en la que los dos discrepan. Con un tercer punto de observación en una región independiente, la promoción solo ocurre con mayoría de votos, y la región aislada pierde la votación y se niega a aceptar escritura aunque esté viva. Esto no es opcional en una topología que acepta promoción automática: sin el tercer observador, la promoción es una apuesta contra la partición de red.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo componente es el cercado, que garantiza que el primario antiguo deje de aceptar escritura antes de que el nuevo empiece. La forma robusta usa un número de época que solo crece, grabado junto con cada escritura. Cuando la nueva región es promovida, incrementa la época, y el primario antiguo, al volver de la partición, descubre que su época es inferior a la corriente y rechaza las escrituras que aún tenía en vuelo en vez de aplicarlas sobre un estado que ya avanzó sin él.',
        },
        {
          type: 'code',
          value: `// operacao/cercamento-epoca.js
// Cercamento por epoca monotonica. Impede que o primario antigo, ao voltar
// de uma particao de rede, aplique escritas em voo sobre um estado que a
// nova regiao ja avancou. Detectar falha nunca e suficiente: a garantia vem
// de rejeitar escrita com epoca inferior a corrente.

export const criarGuardaEpoca = ({ registro, regiao }) => {
  let epocaLocal = null;

  /**
   * Chamado na promocao. O incremento e condicional no armazenamento
   * consistente (etcd, Consul, tabela com bloqueio) para que duas regioes
   * nunca obtenham a mesma epoca durante uma particao.
   */
  const assumirPrimario = async () => {
    const nova = await registro.incrementarEpoca({ regiao });
    epocaLocal = nova;
    return nova;
  };

  /**
   * Envolve toda escrita. A epoca corrente e lida do registro compartilhado
   * dentro da MESMA transacao da escrita, para que nao exista janela entre
   * a verificacao e a aplicacao.
   */
  const escreverCercado = async (transacao, executar) => {
    if (epocaLocal == null) {
      throw new Error('regiao nao e primaria: escrita recusada');
    }

    const corrente = await transacao.selecionarEpocaParaAtualizacao();

    if (corrente > epocaLocal) {
      // Perdemos a primazia enquanto esta escrita estava em voo. Aplicar
      // agora sobrescreveria decisoes que a nova regiao ja tomou.
      const anterior = epocaLocal;
      epocaLocal = null;
      throw new Error(
        'escrita rejeitada: epoca local ' + anterior + ' inferior a corrente ' + corrente,
      );
    }

    return executar(transacao);
  };

  return { assumirPrimario, escreverCercado };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Leer la época dentro de la misma transacción de la escritura es el detalle que separa una protección real de una verificación decorativa. Si la comprobación ocurre antes de abrir la transacción, existe una ventana entre la comparación y la aplicación, y es exactamente en esa ventana donde encaja la escritura perdida durante un failover. El bloqueo de selección para actualización es lo que cierra esa ventana, al costo de una fila de contención por escritura, que es irrelevante comparado con el costo de reconciliar dos primarios divergentes.',
        },
      ],
    },
    {
      title: 'Qué medir para saber si la topología está entregando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El panel estándar de multirregión muestra retraso de replicación en segundos y latencia por región, y ninguno de los dos responde a la pregunta que importa, que es si los usuarios están recibiendo de hecho respuestas consistentes con lo que acaban de hacer. La métrica que responde es la razón entre lecturas desviadas al primario y lecturas totales, segmentada por región. Mide directamente cuántas veces la réplica local no logró servir una lectura que debería haber servido.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Cómo calcular', 'Valor sano', 'Qué indica la variación'],
          rows: [
            [
              'Razón de desvío por retraso',
              'desvíos dividido por lecturas elegibles a réplica, por región',
              'Por debajo de 1%',
              'La subida gradual anticipa la degradación de la replicación en minutos',
            ],
            [
              'Espera hasta consistencia',
              'p99 del tiempo gastado en el bucle de espera por la posición',
              'Por debajo de 15 ms',
              'Una cola creciente muestra que la ventana fija alternativa fallaría',
            ],
            [
              'Idas y vueltas por recorrido',
              'conteo de escrituras en el primario por flujo completo',
              'Una o dos',
              'Por encima de eso, el costo de red domina la latencia percibida',
            ],
            [
              'Retraso de replicación en posición',
              'posición del primario menos posición aplicada en la réplica',
              'Estable y acotado',
              'Crecimiento monótono indica que la réplica no acompaña la escritura',
            ],
            [
              'Escrituras rechazadas por época',
              'contador del guardia de cercado',
              'Cero fuera de failover',
              'Cualquier valor fuera de promoción indica dos primarios activos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Vale la pena destacar por qué la fila del retraso en posición es distinta de la misma métrica en segundos, que es la que la mayoría de las bases expone por defecto. El retraso en segundos se calcula a partir de la marca de tiempo de la última transacción aplicada, y va a cero cuando el primario deja de recibir escritura, aunque la réplica esté arbitrariamente atrasada. Una réplica trabada sobre un primario ocioso reporta retraso cero y parece perfectamente sana, y esa es justamente la condición que precede al failover que pierde datos. La diferencia de posiciones no tiene ese punto ciego, porque compara dos posiciones reales del log en vez de comparar un reloj con el silencio.',
        },
        {
          type: 'list',
          items: [
            'Prueba de partición en entorno controlado: bloquear la ruta entre las regiones y verificar que la región aislada rechaza escritura en vez de promoverse a sí misma.',
            'Prueba de lectura de la propia escritura: escribir y leer inmediatamente en la región más distante, con replicación artificialmente retrasada, confirmando que la lectura se desvía en vez de devolver el valor antiguo.',
            'Prueba de época: promover la réplica, restaurar el primario antiguo con escrituras en vuelo y confirmar que son rechazadas y registradas, no aplicadas en silencio.',
            'Ejercicio de failover con cronómetro, midiendo el tiempo entre la decisión humana y la primera escritura aceptada en la nueva región, porque ese número es el objetivo de recuperación real.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale la pena poner una segunda región cuando el tráfico de escritura es alto?',
      answer:
        'La respuesta depende casi por completo de la proporción entre lectura y escritura y de la distribución geográfica de los usuarios, y no del volumen absoluto. Un sistema con noventa por ciento de lectura y usuarios repartidos por dos continentes gana mucho con la réplica local, porque la abrumadora mayoría de las peticiones pasa a servirse cerca de quien pidió, y las escrituras siguen pagando la travesía sin que eso domine la experiencia. Un sistema con cuarenta por ciento de escritura y usuarios concentrados en una sola región está cambiando complejidad operativa por una ganancia que casi no existe, y probablemente resolvería mejor el problema con caché de lectura y optimización de consultas dentro de la región única. El error que aparece con frecuencia es mirar solo la latencia media e ignorar cuántas idas y vueltas al primario hace cada recorrido: un flujo de registro con seis escrituras secuenciales queda peor en multirregión de lo que estaba en región única, incluso con todas las lecturas aceleradas, y ninguna configuración de base de datos corrige eso. Antes de decidir la topología, mida idas y vueltas por recorrido de negocio, porque ese número determina si la segunda región va a mejorar o empeorar la experiencia percibida.',
    },
    {
      question: 'Una base multi-master resolvería el problema de latencia de escritura?',
      answer:
        'Resuelve la latencia de escritura y cobra el precio en otro lugar, que es la resolución de conflicto, y ese precio casi nunca es de infraestructura. Cuando dos regiones aceptan escritura sobre la misma entidad, alguna de ellas tiene que decidir qué versión gana, y las estrategias automáticas disponibles son todas insatisfactorias para datos transaccionales: la última escritura gana descarta en silencio un cambio legítimo, y la fusión por campo produce un estado que ninguno de los dos usuarios pidió. El caso en que multi-master funciona bien es aquel en que la estructura de datos es naturalmente convergente, como un contador incremental, un conjunto al que solo se añade, o un documento colaborativo con un tipo de dato replicado sin conflicto por detrás. Para saldo de cuenta, control de inventario o estado de pedido, el conflicto no tiene resolución automática correcta, porque la respuesta correcta depende de reglas de negocio que la base no conoce. En la práctica la mayoría de los sistemas que adoptó multi-master terminó particionando la escritura por clave, que es escritura única por partición con otro nombre, y esa suele ser la arquitectura correcta desde el principio.',
    },
    {
      question: 'Cómo manejar la residencia de datos cuando la escritura es única en una región?',
      answer:
        'La regulación de residencia convierte la topología de una decisión de latencia en una restricción de arquitectura, y normalmente hace inviable la escritura única global para los datos afectados. El patrón que funciona es separar el modelo en dos clases: datos regulados, que viven enteramente dentro de la región exigida y nunca se replican fuera, y datos globales, como catálogo, configuración y metadatos operativos, que siguen con escritura única y réplicas en todas partes. Eso significa que la clave de particionamiento pasa a incluir la jurisdicción, y que una consulta que cruza jurisdicciones deja de ser una unión en la base y se vuelve dos consultas con composición en la aplicación, lo que hay que diseñar desde temprano porque es caro reformar después. La parte que suele subestimarse es qué cuenta como dato regulado: registros de log, trazas de observabilidad, backups e incluso claves de caché pueden llevar identificadores personales y terminar fuera de la jurisdicción sin que nadie lo haya decidido. Conviene mapear todo camino por donde un dato sale de la región, incluyendo los que existen para operar el sistema y no para servirlo, porque es por ellos que la fuga de jurisdicción ocurre en la práctica.',
    },
  ],
  conclusion: {
    title: 'La distancia entre regiones se vuelve comportamiento de producto lo decidas o no',
    description:
      'La segunda región mejora la latencia de lectura de forma inmediata y medible, e introduce una clase de comportamiento que antes no existía: el usuario pasa a poder ver un estado anterior al que él mismo acaba de escribir. Ignorarlo no hace desaparecer el problema, solo transfiere la decisión al azar de la replicación. Puedo mapear las operaciones de tu sistema entre las que toleran réplica local y las que exigen el primario, implementar lectura de la propia escritura con token de posición en vez de fijación por tiempo, reducir las idas y vueltas al primario en los flujos que más cuestan latencia, introducir cercado por época con quórum de tres observadores antes de cualquier promoción automática, y dejar en el panel la razón de desvío que anticipa la degradación de la replicación en minutos.',
    cta: 'Hablar sobre la topología multirregión de mi sistema',
  },
  related: [
    {
      label: 'Caché invalidada mal: cuando el dato viejo cuesta más caro que la consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Migración de base sin ventana: expandir, migrar y contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
