// Conteudo do artigo: relogio dessincronizado entre servicos e a perda da ordem dos eventos.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O suporte abriu o chamado com uma frase que parecia impossível: o cliente respondeu à mensagem trinta e quatro milissegundos antes de ela ter sido enviada. Os dois carimbos de tempo estavam corretos do ponto de vista de cada serviço, e nenhum dos dois relógios estava quebrado. Este artigo mostra por que o carimbo de tempo de parede não é um mecanismo de ordenação, qual é a diferença prática entre desvio e salto de relógio e por que o segundo é o que realmente destrói dados, como um contador lógico por entidade resolve a ordenação sem depender de sincronia, por que a estratégia de última escrita vence apaga alterações silenciosamente sob dessincronia, qual carimbo usar quando o dado precisa ser ordenado e qual usar quando ele precisa ser auditado, e quais três alertas detectam a dessincronia antes de ela virar inconsistência no banco.',
  sections: [
    {
      title: 'Dois carimbos corretos que descrevem uma ordem impossível',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O incidente costuma aparecer como um dado absurdo, não como um erro. Uma resposta anterior à pergunta, um pedido cancelado antes de ser criado, uma sessão que durou menos zero vírgula dois segundos. Ninguém suspeita do relógio primeiro, porque o relógio é a peça de infraestrutura em que todo mundo confia sem pensar. A investigação começa procurando erro de fuso horário, depois erro de serialização, depois condição de corrida no código, e só no fim alguém compara a hora de duas máquinas e descobre que elas discordam em oitenta e sete milissegundos.',
        },
        {
          type: 'paragraph',
          value:
            'A causa raiz não é o desvio em si, é a suposição embutida no código. Quando o serviço A grava createdAt com o relógio dele e o serviço B grava updatedAt com o relógio dele, e alguma consulta depois ordena os dois campos juntos, o sistema está afirmando que existe uma linha do tempo única compartilhada por máquinas independentes. Essa linha do tempo não existe. O que existe é um conjunto de relógios que aproximam a mesma referência com erro variável, e o erro é pequeno o suficiente para passar despercebido em desenvolvimento e grande o suficiente para inverter a ordem de dois eventos separados por poucos milissegundos em produção.',
        },
        {
          type: 'diagram',
          value: `LINHA DO TEMPO REAL (referencia absoluta, inobservavel)

  t=0ms          t=12ms
   |              |
   v              v
  envio          resposta

O QUE CADA SERVICO GRAVOU

  servico-mensageria (relogio +45ms)   envio    -> 10:00:00.045
  servico-inbox      (relogio -42ms)   resposta -> 10:00:00.011  (!)

CONSULTA QUE ORDENA POR carimbo

  10:00:00.011  resposta
  10:00:00.045  envio          <- ordem invertida, dados corretos

  desvio total entre os dois relogios: 87ms
  intervalo real entre os dois eventos: 12ms
  qualquer par de eventos separado por menos de 87ms pode inverter`,
        },
        {
          type: 'paragraph',
          value:
            'A regra que sai desse desenho é o único parâmetro que importa: dois eventos gravados por máquinas diferentes só têm ordem confiável se o intervalo entre eles for maior que o desvio máximo entre os relógios envolvidos. Num ambiente com sincronização por NTP bem configurada em rede local, esse desvio fica na casa de poucos milissegundos. Em contêineres com relógio virtualizado, em máquinas virtuais que sofreram migração ao vivo ou em regiões diferentes com caminhos de rede assimétricos, ele passa facilmente de cem milissegundos. Toda decisão de ordenação baseada em carimbo de parede está apostando que os eventos nunca vão acontecer mais perto do que esse número, e essa aposta é perdida justamente sob carga, quando os eventos ficam mais próximos.',
        },
      ],
    },
    {
      title: 'Desvio é ruído, salto é corrupção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois problemas de relógio são tratados como se fossem o mesmo e produzem falhas de natureza diferente. O desvio é a diferença constante e pequena entre duas máquinas: ele embaralha a ordem de eventos próximos, o que é ruim, mas mantém a propriedade de que o tempo sempre avança. O salto é o momento em que o daemon de sincronização corrige o relógio de uma vez, movendo-o para trás. Nesse instante, uma única máquina passa a produzir carimbos que já foram usados, e a ordem deixa de existir até dentro do próprio processo.',
        },
        {
          type: 'paragraph',
          value:
            'O salto para trás é o que causa perda de dados de verdade, e ele é mais comum do que parece. Acontece quando uma máquina virtual é retomada de um estado suspenso, quando um contêiner sobe com o relógio herdado de um host desatualizado, quando o NTP é configurado para corrigir de uma vez em vez de acelerar ou desacelerar gradualmente, e quando alguém reinicia um servidor cujo relógio de hardware está errado. O sintoma no código é uma duração negativa, um cache que expira antes de ser gravado, um bloqueio distribuído cujo prazo já passou no momento em que foi adquirido.',
        },
        {
          type: 'code',
          value: `// time/clock.js
// Separa o relogio de parede (data absoluta, pode saltar) do relogio
// monotonico (so avanca, nao tem significado absoluto). Misturar os dois
// e a origem da maioria dos bugs de tempo em producao.

// Errado: mede duracao com relogio de parede. Se o NTP corrigir o relogio
// para tras no meio da operacao, a duracao vem negativa e qualquer
// comparacao com limiar passa a decidir o oposto do pretendido.
export const medirErrado = async (fn) => {
  const inicio = Date.now();
  await fn();
  return Date.now() - inicio; // pode ser negativo
};

// Certo: duracao sempre pelo relogio monotonico. Ele nao diz que horas
// sao, mas garante que a diferenca entre duas leituras e o tempo
// decorrido de verdade.
export const medir = async (fn) => {
  const inicio = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - inicio) / 1e6; // ms
};

// Prazos tambem sao duracao, nao data. Um prazo guardado como instante
// absoluto expira cedo demais ou tarde demais quando o relogio salta.
export const criarPrazo = (duracaoMs) => {
  const limite = process.hrtime.bigint() + BigInt(Math.round(duracaoMs * 1e6));
  return {
    expirado: () => process.hrtime.bigint() >= limite,
    restanteMs: () => Number(limite - process.hrtime.bigint()) / 1e6,
  };
};

// Guarda de sanidade para o unico lugar onde o relogio de parede e
// inevitavel: gravar quando o evento aconteceu no mundo real. Um carimbo
// que anda para tras dentro do mesmo processo e um salto detectado, e
// registrar isso e o que transforma um dado absurdo em um alerta.
let ultimoCarimbo = 0;

export const agoraMonotonicoAproximado = () => {
  const parede = Date.now();
  if (parede <= ultimoCarimbo) {
    // Salto para tras: mantem a ordem local avancando um milissegundo e
    // deixa o desvio visivel para a metrica em vez de silencia-lo.
    ultimoCarimbo += 1;
    return { carimbo: ultimoCarimbo, saltoDetectadoMs: ultimoCarimbo - parede };
  }
  ultimoCarimbo = parede;
  return { carimbo: parede, saltoDetectadoMs: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'A separação entre relógio de parede e relógio monotônico é a correção de maior retorno e a mais barata de aplicar. Toda medição de duração, todo prazo de expiração e todo cálculo de tempo restante deve usar o relógio monotônico, que só avança e não tem noção de data. Todo registro de quando algo aconteceu no mundo real usa o relógio de parede, porque é o único que tem significado fora do processo. A confusão entre os dois é o que produz bloqueios distribuídos que expiram no instante em que são criados, e essa classe de falha não aparece em nenhum teste porque exige que o salto aconteça dentro da janela de execução.',
        },
        {
          type: 'table',
          columns: ['Uso', 'Relógio correto', 'O que quebra com o relógio errado'],
          rows: [
            [
              'Medir quanto tempo uma chamada levou',
              'Monotônico',
              'Duração negativa e métrica de latência corrompida',
            ],
            [
              'Expirar um bloqueio distribuído',
              'Monotônico no detentor, parede no árbitro',
              'Dois detentores simultâneos sem erro registrado',
            ],
            [
              'Registrar quando o pedido foi criado',
              'Parede',
              'Data sem significado fora do processo',
            ],
            [
              'Ordenar eventos entre serviços',
              'Nenhum dos dois, usar contador lógico',
              'Inversão silenciosa sob desvio',
            ],
            [
              'Decidir qual escrita é mais recente',
              'Versão da entidade',
              'Escrita apagada sem conflito reportado',
            ],
          ],
        },
      ],
    },
    {
      title: 'Ordenar sem relógio: o contador lógico por entidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A solução para a ordenação não é sincronizar melhor os relógios, é parar de depender deles. O que o sistema precisa quase sempre não é saber que horas o evento aconteceu, e sim saber qual evento veio antes do outro. Essas duas perguntas são diferentes, e a segunda tem uma resposta exata que não custa nada: um contador que incrementa a cada evento daquela entidade. Dois eventos do mesmo pedido são comparáveis pelo contador com precisão absoluta, independentemente de qual máquina os produziu e de quanto os relógios discordam.',
        },
        {
          type: 'paragraph',
          value:
            'O ponto que costuma travar a adoção é o medo de precisar de um contador global, que seria um gargalo. Ele não é necessário. A ordenação global raramente é requisito de negócio: ninguém precisa saber se o pedido do cliente A veio antes do pedido do cliente B. O que importa é a ordem dentro de cada entidade, e essa ordem pode ser mantida por um contador local àquela entidade, que já é serializada pelo próprio banco no momento da atualização. O custo é uma coluna e uma condição no UPDATE.',
        },
        {
          type: 'code',
          value: `// events/sequence.js
// Ordem por contador logico da entidade. Nao depende de relogio nenhum e
// nao exige coordenacao global: o contador e local ao agregado e o banco
// ja serializa as atualizacoes da mesma linha.

export const registrarEvento = async ({ db, entidadeId, tipo, dados }) => {
  // A sequencia vem do proprio banco, na mesma transacao que grava o
  // evento. Ler o valor atual na aplicacao e incrementar em memoria
  // reintroduz a corrida que o contador existe para eliminar.
  const { rows } = await db.query(
    \`INSERT INTO eventos (entidade_id, sequencia, tipo, dados, registrado_em)
     VALUES (
       $1,
       COALESCE((SELECT MAX(sequencia) FROM eventos WHERE entidade_id = $1), 0) + 1,
       $2,
       $3,
       now()
     )
     RETURNING sequencia\`,
    [entidadeId, tipo, dados],
  );

  return rows[0].sequencia;
};

// O consumidor detecta lacuna sem precisar de tempo: se recebeu a
// sequencia 7 e a ultima aplicada foi 5, a 6 esta em transito ou se
// perdeu, e aplicar a 7 agora corrompe o estado.
export const aplicarEmOrdem = ({ ultimaAplicada, evento, pendentes }) => {
  if (evento.sequencia <= ultimaAplicada) {
    return { acao: 'ignorar', motivo: 'duplicata ou reentrega' };
  }

  if (evento.sequencia > ultimaAplicada + 1) {
    pendentes.set(evento.sequencia, evento);
    return { acao: 'aguardar', lacuna: evento.sequencia - ultimaAplicada - 1 };
  }

  // Aplicou o proximo esperado: drena o que ja chegou fora de ordem.
  let cursor = evento.sequencia;
  const aplicar = [evento];
  while (pendentes.has(cursor + 1)) {
    cursor += 1;
    aplicar.push(pendentes.get(cursor));
    pendentes.delete(cursor);
  }

  return { acao: 'aplicar', eventos: aplicar, ultimaAplicada: cursor };
};`,
        },
        {
          type: 'paragraph',
          value:
            'A propriedade que esse desenho entrega e que nenhum carimbo entrega é a detecção de lacuna. Com carimbos de tempo, um evento perdido é indistinguível de um intervalo em que nada aconteceu, e o consumidor aplica o evento seguinte sobre um estado incompleto sem nenhum sinal. Com contador, a lacuna é aritmética: a sequência sete chegando depois da cinco significa que a seis está em trânsito ou se perdeu, e essa é a diferença entre um sistema que detecta a falha em segundos e um que descobre a inconsistência semanas depois numa conciliação.',
        },
      ],
    },
    {
      title: 'Última escrita vence é uma política de perda de dados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A estratégia mais difundida para resolver escritas concorrentes é comparar os carimbos e manter o maior. Ela é atraente porque não exige coordenação e não gera erro para o cliente, e é exatamente por isso que é perigosa: o dado perdido não produz nenhum sintoma. Sob dessincronia, a escrita descartada não é a mais antiga, é a que veio da máquina cujo relógio estava atrasado, e essa escolha é arbitrária em relação à intenção do usuário.',
        },
        {
          type: 'paragraph',
          value:
            'O cenário concreto é banal. Dois atendentes atualizam o mesmo cadastro com dois segundos de diferença. O primeiro escreve pela instância cujo relógio adianta cem milissegundos; o segundo, pela instância cujo relógio atrasa duzentos. A escrita do segundo atendente, que é a correta e a mais recente na realidade, carrega um carimbo menor e é descartada pela regra. O cliente vê o dado antigo, ninguém recebe erro, e o log registra as duas escritas como bem-sucedidas. Investigar isso semanas depois é impossível, porque não há nenhum registro de que uma decisão de descarte aconteceu.',
        },
        {
          type: 'code',
          value: `// storage/write.js
// Substitui 'ultima escrita vence por carimbo' por versao da entidade.
// A comparacao passa a ser sobre o que o cliente leu, nao sobre em qual
// maquina o carimbo foi gerado.

export const atualizar = async ({ db, id, campos, versaoLida }) => {
  // A condicao na versao e o que transforma sobrescrita silenciosa em
  // conflito explicito: o UPDATE so afeta a linha se ninguem escreveu
  // entre a leitura do cliente e este momento.
  const { rowCount, rows } = await db.query(
    \`UPDATE clientes
        SET dados = dados || $2::jsonb,
            versao = versao + 1,
            atualizado_em = now()
      WHERE id = $1 AND versao = $3
      RETURNING versao, dados\`,
    [id, JSON.stringify(campos), versaoLida],
  );

  if (rowCount === 0) {
    const atual = await db.query(
      'SELECT versao, dados FROM clientes WHERE id = $1',
      [id],
    );

    if (atual.rowCount === 0) {
      return { status: 'ausente' };
    }

    // Conflito real: alguem escreveu no intervalo. Devolver o estado
    // atual permite ao chamador decidir entre mesclar campo a campo,
    // repetir sobre a versao nova ou perguntar ao usuario. Nenhuma
    // dessas opcoes existe quando o carimbo decide sozinho.
    return {
      status: 'conflito',
      versaoAtual: atual.rows[0].versao,
      dadosAtuais: atual.rows[0].dados,
      camposEmConflito: Object.keys(campos).filter(
        (campo) => campo in atual.rows[0].dados,
      ),
    };
  }

  return { status: 'gravado', versao: rows[0].versao, dados: rows[0].dados };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Quando o requisito realmente exige convergência automática sem erro para o cliente, a saída não é voltar ao carimbo de parede: é usar uma estrutura em que a mesclagem é definida pelo tipo do dado. Um contador vira soma de incrementos, um conjunto vira união com marcação de remoção, um campo de texto vira o valor da réplica de maior identificador em caso de empate. Todas essas regras são determinísticas e independentes de relógio, e a única coisa que elas pedem em troca é que a escolha de mesclagem seja explícita por campo, em vez de implícita e global.',
        },
      ],
    },
    {
      title: 'Guardar os dois carimbos: um para ordenar, outro para auditar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conclusão natural de tudo isso costuma virar um exagero: abandonar o carimbo de tempo. Isso não funciona, porque existem perguntas legítimas que só o relógio de parede responde. Quanto tempo o cliente esperou de verdade, se o evento aconteceu dentro do horário comercial, se a retenção de trinta dias já venceu, qual foi a hora do incidente no relatório para o cliente. Nenhuma dessas perguntas é respondida por um contador lógico, que não tem relação com o tempo humano.',
        },
        {
          type: 'paragraph',
          value:
            'O desenho que resolve os dois lados é guardar os dois campos com papéis separados e nomes que não se confundem. A sequência lógica é o que o código usa para ordenar, comparar e detectar lacuna. O carimbo de parede é o que a interface exibe e o relatório usa, com a ressalva explícita de que ele é aproximado. Quando os dois discordam, e eles vão discordar, a sequência ganha, porque ela é a única com garantia. E a discordância em si vira um sinal: registrar o desvio observado entre a ordem lógica e a ordem temporal é o que transforma o problema de relógio em uma métrica em vez de um chamado de suporte.',
        },
        {
          type: 'code',
          value: `// events/record.js
// Grava os dois carimbos com papeis distintos e mede a discordancia
// entre eles. A metrica resultante e o que revela dessincronia antes de
// ela virar dado absurdo na tela do cliente.

export const construirRegistro = ({ sequencia, anterior, origem }) => {
  const carimbo = new Date().toISOString();

  // Se o evento anterior da mesma entidade tem sequencia menor mas
  // carimbo maior, os relogios das duas origens discordam pelo menos
  // nessa diferenca. E a unica forma de medir desvio sem instalar agente
  // em cada maquina: usar a ordem causal ja conhecida como referencia.
  const desvioObservadoMs =
    anterior && anterior.sequencia < sequencia
      ? Math.max(0, Date.parse(anterior.carimbo) - Date.parse(carimbo))
      : 0;

  return {
    // Autoridade para ordenar, comparar e detectar lacuna.
    sequencia,
    // Aproximacao para exibir, filtrar por periodo e aplicar retencao.
    // Nunca usado para decidir precedencia.
    carimbo,
    origem,
    desvioObservadoMs,
  };
};

// O consumidor da metrica so precisa do maximo por par de origens: e ele
// que define o intervalo abaixo do qual a ordem por carimbo e ficcao.
export const acumularDesvio = (acumulador, registro, origemAnterior) => {
  if (registro.desvioObservadoMs === 0) return acumulador;
  const chave = [origemAnterior, registro.origem].sort().join('|');
  const atual = acumulador.get(chave) ?? 0;
  acumulador.set(chave, Math.max(atual, registro.desvioObservadoMs));
  return acumulador;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Essa métrica tem uma vantagem operacional que costuma ser subestimada: ela mede o desvio como o sistema o experimenta, não como o daemon de sincronização o reporta. O NTP informa o erro estimado em relação ao servidor de referência, o que não captura o caso em que duas máquinas estão sincronizadas com fontes diferentes, cada uma dentro da própria tolerância, e ainda assim discordam entre si na soma dos erros. Usar a ordem causal já conhecida como referência mede exatamente a grandeza que quebra o sistema.',
        },
      ],
    },
    {
      title: 'Os três alertas que pegam a dessincronia antes do dado absurdo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Monitorar relógio costuma se resumir a um painel com o desvio reportado pelo NTP em cada host, que é o sinal menos útil dos disponíveis: ele é verde em todos os casos em que o problema é de configuração e não de sincronização, como fuso horário errado no contêiner ou relógio virtualizado que o daemon nem gerencia. Três sinais derivados do comportamento do próprio sistema cobrem o que importa.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro é a inversão observada entre ordem lógica e ordem temporal, medida em milissegundos e agregada por par de origens. Ele responde diretamente a pergunta operacional que interessa, que é qual intervalo mínimo entre eventos ainda é confiável. O segundo é o salto para trás dentro de um mesmo processo, contado pela guarda de sanidade: qualquer ocorrência é anômala e indica correção abrupta ou máquina retomada de suspensão. O terceiro é a duração negativa em qualquer medição, que só é possível quando alguém mediu tempo com relógio de parede e é o indicador mais direto de que o código tem a mistura que causa expiração incorreta de bloqueio.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'Detecta', 'Falha se usado sozinho', 'Destino'],
          rows: [
            [
              'Inversão entre sequência e carimbo',
              'Desvio real entre pares de serviços',
              'Só aparece onde já existe contador lógico',
              'Painel e revisão semanal',
            ],
            [
              'Salto de relógio para trás no processo',
              'Correção abrupta ou máquina retomada',
              'Não vê desvio constante entre máquinas',
              'Chamado imediato',
            ],
            [
              'Duração negativa em medição',
              'Uso de relógio de parede para medir tempo',
              'Silencioso enquanto nenhum salto ocorre',
              'Tarefa no dia',
            ],
            [
              'Desvio reportado pelo NTP',
              'Falha de sincronização declarada',
              'Verde em fuso errado e relógio virtualizado',
              'Painel apenas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última recomendação é de configuração e vale mais do que qualquer alerta: o daemon de sincronização deve corrigir o relógio acelerando ou desacelerando gradualmente, nunca dando um salto, exceto no momento da inicialização da máquina, antes de qualquer processo da aplicação subir. Com essa configuração, o relógio nunca anda para trás durante a execução, e a classe inteira de falhas por salto desaparece sem uma linha de código. O que sobra é o desvio, que é ruído previsível, e para ele a resposta já está dada: não ordene por carimbo, ordene por sequência.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Sincronizar todos os relógios com precisão de microssegundos não resolveria o problema?',
      answer:
        'Reduz a frequência, mas não muda a natureza da falha, e o custo de chegar perto disso é alto o suficiente para não compensar na maioria dos sistemas. Sincronização de altíssima precisão exige hardware e caminhos de rede dedicados, do tipo usado em bolsas de valores, e mesmo lá a garantia é de erro limitado, não de erro zero. O ponto que costuma ser esquecido é que o intervalo entre eventos concorrentes diminui conforme o sistema cresce: sob carga, duas atualizações da mesma entidade ficam separadas por microssegundos, e nenhuma precisão prática de relógio ordena isso de forma confiável. Há também um caso que a precisão não toca: o relógio de contêiner que herda o host errado, o servidor que volta de suspensão e a máquina virtual migrada ao vivo produzem discrepância grande independentemente de quão preciso o daemon é. A abordagem que escala é assumir que a ordem entre máquinas não é observável pelo tempo e resolver a ordenação onde ela realmente pode ser garantida, que é dentro de cada entidade. Investir em sincronização continua valendo para carimbos de auditoria e correlação de logs, onde erro de dezenas de milissegundos é aceitável.',
    },
    {
      question: 'Como corrigir dados que já foram gravados com ordem invertida?',
      answer:
        'O primeiro passo é medir a extensão antes de tocar em qualquer linha, e a medida certa não é quantos registros têm carimbo suspeito, e sim quantos têm carimbo dentro da janela de desvio máximo em relação ao registro adjacente da mesma entidade. Fora dessa janela, a ordem por carimbo continua correta e o dado não precisa de correção. Dentro dela, a ordem é indeterminada, e o segundo passo é procurar uma fonte independente de causalidade: identificador de rastreamento que liga requisição a resposta, referência explícita ao evento anterior no payload, número de tentativa, ou a ordem de inserção na chave primária quando ela é sequencial e gerada pelo banco. Essas fontes costumam resolver a maioria dos casos ambíguos sem adivinhação. O terceiro passo é decidir o que fazer com o resto, e a resposta honesta quase sempre é deixar como está e marcar: adicionar uma coluna indicando que a ordem daquele intervalo é incerta é mais útil do que reordenar por heurística, porque a marcação é auditável e a reordenação errada é indistinguível da correta. Reprocessar só compensa quando o efeito da inversão é visível para o cliente e o valor correto é derivável de outra fonte.',
    },
    {
      question: 'Contador lógico por entidade não vira gargalo em entidades com muita escrita?',
      answer:
        'Vira, e o limite prático é justamente a taxa de escrita serializada naquela linha, tipicamente algumas centenas por segundo antes de a contenção aparecer. A boa notícia é que esse limite é o mesmo que a entidade já tem por outros motivos: se duas escritas concorrentes precisam ser ordenadas entre si, elas já competem pelo mesmo estado, e o contador não adiciona serialização, apenas torna visível a que já existia. Quando a taxa realmente excede isso, o problema não é o contador, é a granularidade da entidade, e a correção é dividir o agregado em partes que possam evoluir independentemente. Um caso concreto é o histórico de mensagens de uma conversa muito ativa: usar a conversa como unidade de sequência cria contenção, enquanto usar o par conversa mais participante mantém a ordem que importa para a leitura sem serializar tudo. Existe ainda a alternativa de gerar identificadores ordenáveis com prefixo temporal e sufixo aleatório, que dispensa coordenação e mantém a ordenação aproximada, mas ela volta a depender do relógio para a parte grossa da ordem e só é adequada quando a inversão dentro da mesma janela de milissegundos é tolerável.',
    },
  ],
  conclusion: {
    title: 'A ordem dos eventos precisa ser construída, não observada no relógio',
    description:
      'Um carimbo de tempo diz quando uma máquina achou que era, não em que ordem as coisas aconteceram, e todo sistema distribuído que confunde as duas coisas acaba com um dado absurdo na tela do cliente. Posso revisar como o seu sistema ordena eventos e definir a separação entre relógio monotônico e de parede, o contador lógico por entidade que detecta lacuna, a substituição da regra de última escrita vence por versionamento com conflito explícito, o par de carimbos com papéis separados para ordenar e auditar, e os alertas que medem o desvio pela ordem causal em vez de confiar no que o daemon de sincronização reporta.',
    cta: 'Falar sobre ordenação de eventos no meu sistema',
  },
  related: [
    {
      label: 'Multi-região com escrita única: quando a latência vira decisão de produto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Fila morta que ninguém lê: transformar mensagem descartada em correção',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'Support opened the ticket with a sentence that looked impossible: the customer replied to the message thirty-four milliseconds before it was sent. Both timestamps were correct from each service point of view, and neither clock was broken. This article shows why a wall clock timestamp is not an ordering mechanism, what the practical difference is between clock drift and a clock jump and why the second one actually destroys data, how a logical counter per entity solves ordering without depending on synchronization, why last write wins silently erases changes under drift, which timestamp to use when data has to be ordered and which one when it has to be audited, and which three alerts detect drift before it turns into inconsistency in the database.',
  sections: [
    {
      title: 'Two correct timestamps describing an impossible order',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The incident usually shows up as an absurd value, not as an error. A reply that predates the question, an order cancelled before it was created, a session that lasted minus zero point two seconds. Nobody suspects the clock first, because the clock is the piece of infrastructure everyone trusts without thinking. The investigation starts by looking for a time zone bug, then a serialization bug, then a race condition in the code, and only at the end does someone compare the time on two machines and find that they disagree by eighty-seven milliseconds.',
        },
        {
          type: 'paragraph',
          value:
            'The root cause is not the drift itself, it is the assumption baked into the code. When service A writes createdAt with its own clock and service B writes updatedAt with its own clock, and some query later orders both fields together, the system is asserting that a single shared timeline exists across independent machines. That timeline does not exist. What exists is a set of clocks approximating the same reference with variable error, and the error is small enough to go unnoticed in development and large enough to invert the order of two events separated by a few milliseconds in production.',
        },
        {
          type: 'diagram',
          value: `REAL TIMELINE (absolute reference, unobservable)

  t=0ms          t=12ms
   |              |
   v              v
  send           reply

WHAT EACH SERVICE WROTE

  messaging-service (clock +45ms)   send  -> 10:00:00.045
  inbox-service     (clock -42ms)   reply -> 10:00:00.011  (!)

QUERY THAT ORDERS BY timestamp

  10:00:00.011  reply
  10:00:00.045  send           <- inverted order, correct data

  total drift between the two clocks: 87ms
  real interval between the two events: 12ms
  any pair of events closer than 87ms can invert`,
        },
        {
          type: 'paragraph',
          value:
            'The rule that comes out of this drawing is the only parameter that matters: two events written by different machines have a reliable order only if the interval between them is larger than the maximum drift between the clocks involved. In an environment with well configured NTP synchronization on a local network, that drift sits in the low single-digit milliseconds. In containers with a virtualized clock, on virtual machines that went through live migration, or across regions with asymmetric network paths, it easily exceeds one hundred milliseconds. Every ordering decision based on a wall clock timestamp is betting that events will never happen closer together than that number, and that bet is lost precisely under load, when events get closer together.',
        },
      ],
    },
    {
      title: 'Drift is noise, a jump is corruption',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two clock problems are treated as if they were one and they produce failures of a different nature. Drift is the small constant difference between two machines: it scrambles the order of nearby events, which is bad, but it preserves the property that time always moves forward. A jump is the moment the synchronization daemon corrects the clock all at once, moving it backwards. At that instant, a single machine starts producing timestamps that were already used, and ordering stops existing even within the process itself.',
        },
        {
          type: 'paragraph',
          value:
            'The backward jump is what causes real data loss, and it is more common than it seems. It happens when a virtual machine resumes from a suspended state, when a container starts with a clock inherited from an outdated host, when NTP is configured to step the clock instead of slewing it gradually, and when someone reboots a server whose hardware clock is wrong. The symptom in the code is a negative duration, a cache that expires before it is written, a distributed lock whose deadline had already passed at the moment it was acquired.',
        },
        {
          type: 'code',
          value: `// time/clock.js
// Separates the wall clock (absolute date, can jump) from the monotonic
// clock (only moves forward, no absolute meaning). Mixing the two is the
// source of most time bugs in production.

// Wrong: measures duration with the wall clock. If NTP steps the clock
// backwards mid-operation, the duration comes out negative and any
// threshold comparison starts deciding the opposite of what was intended.
export const measureWrong = async (fn) => {
  const start = Date.now();
  await fn();
  return Date.now() - start; // can be negative
};

// Right: duration always from the monotonic clock. It does not tell you
// what time it is, but it guarantees that the difference between two
// readings is the elapsed time for real.
export const measure = async (fn) => {
  const start = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - start) / 1e6; // ms
};

// Deadlines are durations too, not dates. A deadline stored as an
// absolute instant expires too early or too late when the clock jumps.
export const createDeadline = (durationMs) => {
  const limit = process.hrtime.bigint() + BigInt(Math.round(durationMs * 1e6));
  return {
    expired: () => process.hrtime.bigint() >= limit,
    remainingMs: () => Number(limit - process.hrtime.bigint()) / 1e6,
  };
};

// Sanity guard for the one place where the wall clock is unavoidable:
// recording when the event happened in the real world. A timestamp that
// moves backwards inside the same process is a detected jump, and
// recording it is what turns an absurd value into an alert.
let lastTimestamp = 0;

export const approximateMonotonicNow = () => {
  const wall = Date.now();
  if (wall <= lastTimestamp) {
    // Backward jump: keeps local order moving forward by one millisecond
    // and leaves the drift visible to the metric instead of silencing it.
    lastTimestamp += 1;
    return { timestamp: lastTimestamp, detectedJumpMs: lastTimestamp - wall };
  }
  lastTimestamp = wall;
  return { timestamp: wall, detectedJumpMs: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Separating the wall clock from the monotonic clock is the highest return correction and the cheapest to apply. Every duration measurement, every expiration deadline and every remaining time calculation should use the monotonic clock, which only moves forward and has no notion of date. Every record of when something happened in the real world uses the wall clock, because it is the only one with meaning outside the process. Confusing the two is what produces distributed locks that expire the instant they are created, and that class of failure never shows up in any test because it requires the jump to land inside the execution window.',
        },
        {
          type: 'table',
          columns: ['Use', 'Correct clock', 'What breaks with the wrong clock'],
          rows: [
            [
              'Measuring how long a call took',
              'Monotonic',
              'Negative duration and corrupted latency metric',
            ],
            [
              'Expiring a distributed lock',
              'Monotonic on the holder, wall on the arbiter',
              'Two simultaneous holders with no error recorded',
            ],
            [
              'Recording when the order was created',
              'Wall',
              'A date with no meaning outside the process',
            ],
            [
              'Ordering events across services',
              'Neither, use a logical counter',
              'Silent inversion under drift',
            ],
            [
              'Deciding which write is more recent',
              'Entity version',
              'A write erased with no conflict reported',
            ],
          ],
        },
      ],
    },
    {
      title: 'Ordering without a clock: the logical counter per entity',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix for ordering is not to synchronize clocks better, it is to stop depending on them. What the system almost always needs is not to know what time the event happened, but to know which event came before the other. Those are two different questions, and the second one has an exact answer that costs nothing: a counter that increments on every event of that entity. Two events of the same order are comparable through the counter with absolute precision, regardless of which machine produced them and of how much the clocks disagree.',
        },
        {
          type: 'paragraph',
          value:
            'What usually stalls adoption is the fear of needing a global counter, which would be a bottleneck. It is not necessary. Global ordering is rarely a business requirement: nobody needs to know whether customer A order came before customer B order. What matters is ordering within each entity, and that order can be maintained by a counter local to the entity, which the database already serializes at update time. The cost is one column and one condition in the UPDATE.',
        },
        {
          type: 'code',
          value: `// events/sequence.js
// Ordering by a logical counter on the entity. Depends on no clock and
// requires no global coordination: the counter is local to the aggregate
// and the database already serializes updates on the same row.

export const recordEvent = async ({ db, entityId, type, data }) => {
  // The sequence comes from the database itself, in the same transaction
  // that writes the event. Reading the current value in the application
  // and incrementing in memory reintroduces the race the counter exists
  // to eliminate.
  const { rows } = await db.query(
    \`INSERT INTO events (entity_id, sequence, type, data, recorded_at)
     VALUES (
       $1,
       COALESCE((SELECT MAX(sequence) FROM events WHERE entity_id = $1), 0) + 1,
       $2,
       $3,
       now()
     )
     RETURNING sequence\`,
    [entityId, type, data],
  );

  return rows[0].sequence;
};

// The consumer detects a gap without needing time: if it received
// sequence 7 and the last applied was 5, number 6 is either in flight or
// lost, and applying 7 now corrupts the state.
export const applyInOrder = ({ lastApplied, event, pending }) => {
  if (event.sequence <= lastApplied) {
    return { action: 'ignore', reason: 'duplicate or redelivery' };
  }

  if (event.sequence > lastApplied + 1) {
    pending.set(event.sequence, event);
    return { action: 'wait', gap: event.sequence - lastApplied - 1 };
  }

  // Applied the expected next one: drains what already arrived early.
  let cursor = event.sequence;
  const toApply = [event];
  while (pending.has(cursor + 1)) {
    cursor += 1;
    toApply.push(pending.get(cursor));
    pending.delete(cursor);
  }

  return { action: 'apply', events: toApply, lastApplied: cursor };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The property this design delivers and no timestamp delivers is gap detection. With timestamps, a lost event is indistinguishable from an interval in which nothing happened, and the consumer applies the next event on top of an incomplete state with no signal at all. With a counter, the gap is arithmetic: sequence seven arriving after five means six is in flight or lost, and that is the difference between a system that detects the failure in seconds and one that discovers the inconsistency weeks later during a reconciliation.',
        },
      ],
    },
    {
      title: 'Last write wins is a data loss policy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most widespread strategy for resolving concurrent writes is to compare timestamps and keep the larger one. It is attractive because it requires no coordination and produces no error for the client, and that is exactly why it is dangerous: the lost data produces no symptom. Under drift, the discarded write is not the older one, it is the one that came from the machine whose clock was running behind, and that choice is arbitrary with respect to user intent.',
        },
        {
          type: 'paragraph',
          value:
            'The concrete scenario is mundane. Two agents update the same record two seconds apart. The first one writes through the instance whose clock runs one hundred milliseconds fast; the second one through the instance whose clock runs two hundred milliseconds slow. The second agent write, which is the correct and genuinely more recent one, carries a smaller timestamp and is discarded by the rule. The customer sees the old value, nobody gets an error, and the log records both writes as successful. Investigating that weeks later is impossible, because there is no record that a discard decision ever happened.',
        },
        {
          type: 'code',
          value: `// storage/write.js
// Replaces 'last write wins by timestamp' with entity versioning. The
// comparison becomes about what the client read, not about which machine
// generated the timestamp.

export const update = async ({ db, id, fields, readVersion }) => {
  // The condition on the version is what turns a silent overwrite into an
  // explicit conflict: the UPDATE only affects the row if nobody wrote
  // between the client read and this moment.
  const { rowCount, rows } = await db.query(
    \`UPDATE customers
        SET data = data || $2::jsonb,
            version = version + 1,
            updated_at = now()
      WHERE id = $1 AND version = $3
      RETURNING version, data\`,
    [id, JSON.stringify(fields), readVersion],
  );

  if (rowCount === 0) {
    const current = await db.query(
      'SELECT version, data FROM customers WHERE id = $1',
      [id],
    );

    if (current.rowCount === 0) {
      return { status: 'missing' };
    }

    // Real conflict: someone wrote in the interval. Returning the current
    // state lets the caller decide between merging field by field,
    // retrying on the new version or asking the user. None of those
    // options exist when the timestamp decides on its own.
    return {
      status: 'conflict',
      currentVersion: current.rows[0].version,
      currentData: current.rows[0].data,
      conflictingFields: Object.keys(fields).filter(
        (field) => field in current.rows[0].data,
      ),
    };
  }

  return { status: 'written', version: rows[0].version, data: rows[0].data };
};`,
        },
        {
          type: 'paragraph',
          value:
            'When the requirement genuinely calls for automatic convergence with no error for the client, the way out is not to go back to the wall clock: it is to use a structure where merging is defined by the data type. A counter becomes a sum of increments, a set becomes a union with removal markers, a text field becomes the value from the replica with the higher identifier in case of a tie. All those rules are deterministic and clock independent, and the only thing they ask in return is that the merge choice be explicit per field, instead of implicit and global.',
        },
      ],
    },
    {
      title: 'Keeping both timestamps: one to order, one to audit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The natural conclusion from all this often turns into an overreaction: abandon timestamps altogether. That does not work, because there are legitimate questions only the wall clock answers. How long the customer actually waited, whether the event happened during business hours, whether the thirty day retention has expired, what time the incident started in the report to the customer. None of those questions is answered by a logical counter, which has no relationship to human time.',
        },
        {
          type: 'paragraph',
          value:
            'The design that solves both sides is to keep both fields with separate roles and names that cannot be confused. The logical sequence is what the code uses to order, compare and detect gaps. The wall clock timestamp is what the interface displays and the report uses, with the explicit caveat that it is approximate. When the two disagree, and they will disagree, the sequence wins, because it is the only one with a guarantee. And the disagreement itself becomes a signal: recording the observed skew between logical order and temporal order is what turns a clock problem into a metric instead of a support ticket.',
        },
        {
          type: 'code',
          value: `// events/record.js
// Writes both timestamps with distinct roles and measures the
// disagreement between them. The resulting metric is what reveals drift
// before it becomes an absurd value on the customer screen.

export const buildRecord = ({ sequence, previous, source }) => {
  const timestamp = new Date().toISOString();

  // If the previous event of the same entity has a smaller sequence but a
  // larger timestamp, the clocks of the two sources disagree by at least
  // that difference. It is the only way to measure drift without
  // installing an agent on every machine: use the already known causal
  // order as the reference.
  const observedSkewMs =
    previous && previous.sequence < sequence
      ? Math.max(0, Date.parse(previous.timestamp) - Date.parse(timestamp))
      : 0;

  return {
    // Authority for ordering, comparing and gap detection.
    sequence,
    // Approximation for display, period filtering and retention.
    // Never used to decide precedence.
    timestamp,
    source,
    observedSkewMs,
  };
};

// The metric consumer only needs the maximum per pair of sources: that is
// what defines the interval below which ordering by timestamp is fiction.
export const accumulateSkew = (accumulator, record, previousSource) => {
  if (record.observedSkewMs === 0) return accumulator;
  const key = [previousSource, record.source].sort().join('|');
  const current = accumulator.get(key) ?? 0;
  accumulator.set(key, Math.max(current, record.observedSkewMs));
  return accumulator;
};`,
        },
        {
          type: 'paragraph',
          value:
            'This metric has an operational advantage that is usually underestimated: it measures drift as the system experiences it, not as the synchronization daemon reports it. NTP reports the estimated error relative to the reference server, which does not capture the case where two machines are synchronized against different sources, each within its own tolerance, and still disagree with each other by the sum of the errors. Using the already known causal order as the reference measures exactly the quantity that breaks the system.',
        },
      ],
    },
    {
      title: 'The three alerts that catch drift before the absurd value',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Clock monitoring usually boils down to a dashboard with the drift reported by NTP on each host, which is the least useful of the available signals: it is green in every case where the problem is configuration rather than synchronization, such as a wrong time zone in the container or a virtualized clock the daemon does not even manage. Three signals derived from the behavior of the system itself cover what matters.',
        },
        {
          type: 'paragraph',
          value:
            'The first is the observed inversion between logical order and temporal order, measured in milliseconds and aggregated per pair of sources. It directly answers the operational question that matters, which is what minimum interval between events is still trustworthy. The second is a backward jump inside a single process, counted by the sanity guard: any occurrence is anomalous and points to an abrupt correction or a machine resumed from suspension. The third is a negative duration in any measurement, which is only possible when someone measured time with the wall clock and is the most direct indicator that the code has the mix that causes incorrect lock expiration.',
        },
        {
          type: 'table',
          columns: ['Signal', 'Detects', 'Fails if used alone', 'Destination'],
          rows: [
            [
              'Inversion between sequence and timestamp',
              'Real drift between pairs of services',
              'Only appears where a logical counter already exists',
              'Dashboard and weekly review',
            ],
            [
              'Backward clock jump in the process',
              'Abrupt correction or resumed machine',
              'Does not see constant drift between machines',
              'Immediate page',
            ],
            [
              'Negative duration in a measurement',
              'Use of the wall clock to measure time',
              'Silent while no jump occurs',
              'Same day task',
            ],
            [
              'Drift reported by NTP',
              'Declared synchronization failure',
              'Green with a wrong time zone and virtualized clock',
              'Dashboard only',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last recommendation is a configuration one and it is worth more than any alert: the synchronization daemon should correct the clock by speeding it up or slowing it down gradually, never stepping it, except at machine boot, before any application process starts. With that configuration the clock never moves backwards during execution, and the entire class of jump failures disappears without a line of code. What remains is drift, which is predictable noise, and the answer for it is already given: do not order by timestamp, order by sequence.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would synchronizing every clock to microsecond precision solve the problem?',
      answer:
        'It reduces the frequency but it does not change the nature of the failure, and the cost of getting close to that is high enough not to pay off in most systems. Very high precision synchronization requires dedicated hardware and network paths, of the kind used in stock exchanges, and even there the guarantee is bounded error, not zero error. The point usually forgotten is that the interval between concurrent events shrinks as the system grows: under load, two updates of the same entity end up microseconds apart, and no practical clock precision orders that reliably. There is also a case precision does not touch: a container clock that inherits the wrong host, a server resuming from suspension and a live migrated virtual machine produce large discrepancies regardless of how precise the daemon is. The approach that scales is to assume that ordering across machines is not observable through time and to solve ordering where it can actually be guaranteed, which is inside each entity. Investing in synchronization is still worth it for audit timestamps and log correlation, where an error of tens of milliseconds is acceptable.',
    },
    {
      question: 'How do you fix data that was already written with inverted order?',
      answer:
        'The first step is to measure the extent before touching a single row, and the right measure is not how many records have a suspicious timestamp, but how many have a timestamp within the maximum drift window relative to the adjacent record of the same entity. Outside that window, ordering by timestamp is still correct and the data needs no correction. Inside it, ordering is undetermined, and the second step is to look for an independent source of causality: a trace identifier linking request to response, an explicit reference to the previous event in the payload, an attempt number, or the insertion order in the primary key when it is sequential and generated by the database. Those sources usually resolve most ambiguous cases without guessing. The third step is deciding what to do with the rest, and the honest answer is almost always to leave it as is and mark it: adding a column indicating that the ordering in that interval is uncertain is more useful than reordering by heuristic, because the mark is auditable and a wrong reordering is indistinguishable from a right one. Reprocessing only pays off when the effect of the inversion is visible to the customer and the correct value is derivable from another source.',
    },
    {
      question: 'Does a logical counter per entity become a bottleneck on entities with heavy writes?',
      answer:
        'It does, and the practical limit is exactly the serialized write rate on that row, typically a few hundred per second before contention shows up. The good news is that this limit is the same one the entity already has for other reasons: if two concurrent writes need to be ordered against each other, they already compete for the same state, and the counter adds no serialization, it only makes visible the serialization that was already there. When the rate genuinely exceeds that, the problem is not the counter, it is the granularity of the entity, and the fix is to split the aggregate into parts that can evolve independently. A concrete case is the message history of a very active conversation: using the conversation as the sequence unit creates contention, while using the conversation plus participant pair preserves the ordering that matters for reading without serializing everything. There is also the alternative of generating sortable identifiers with a time prefix and a random suffix, which needs no coordination and preserves approximate ordering, but it goes back to depending on the clock for the coarse part of the order and is only appropriate when inversion within the same millisecond window is tolerable.',
    },
  ],
  conclusion: {
    title: 'Event ordering has to be constructed, not read off a clock',
    description:
      'A timestamp tells you when a machine thought it was, not in what order things happened, and every distributed system that conflates the two ends up with an absurd value on the customer screen. I can review how your system orders events and define the separation between monotonic and wall clock, the logical counter per entity that detects gaps, the replacement of last write wins with versioning and explicit conflicts, the pair of timestamps with separate roles for ordering and auditing, and the alerts that measure drift through causal order instead of trusting what the synchronization daemon reports.',
    cta: 'Talk about event ordering in my system',
  },
  related: [
    {
      label: 'Multi-region with a single writer: when latency becomes a product decision',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'The dead letter queue nobody reads: turning discarded messages into real fixes',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'Soporte abrió el ticket con una frase que parecía imposible: el cliente respondió al mensaje treinta y cuatro milisegundos antes de que fuera enviado. Las dos marcas de tiempo eran correctas desde el punto de vista de cada servicio, y ninguno de los dos relojes estaba roto. Este artículo muestra por qué la marca de tiempo de pared no es un mecanismo de ordenación, cuál es la diferencia práctica entre desvío y salto de reloj y por qué el segundo es el que realmente destruye datos, cómo un contador lógico por entidad resuelve la ordenación sin depender de sincronía, por qué la estrategia de última escritura gana borra cambios en silencio bajo desvío, qué marca usar cuando el dato tiene que ordenarse y cuál cuando tiene que auditarse, y qué tres alertas detectan el desvío antes de que se convierta en inconsistencia en la base de datos.',
  sections: [
    {
      title: 'Dos marcas correctas que describen un orden imposible',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El incidente suele aparecer como un dato absurdo, no como un error. Una respuesta anterior a la pregunta, un pedido cancelado antes de ser creado, una sesión que duró menos cero coma dos segundos. Nadie sospecha primero del reloj, porque el reloj es la pieza de infraestructura en la que todo el mundo confía sin pensar. La investigación empieza buscando un error de zona horaria, después un error de serialización, después una condición de carrera en el código, y solo al final alguien compara la hora de dos máquinas y descubre que discrepan en ochenta y siete milisegundos.',
        },
        {
          type: 'paragraph',
          value:
            'La causa raíz no es el desvío en sí, es la suposición incrustada en el código. Cuando el servicio A escribe createdAt con su reloj y el servicio B escribe updatedAt con el suyo, y alguna consulta después ordena los dos campos juntos, el sistema está afirmando que existe una línea de tiempo única compartida por máquinas independientes. Esa línea de tiempo no existe. Lo que existe es un conjunto de relojes que aproximan la misma referencia con error variable, y el error es lo bastante pequeño para pasar desapercibido en desarrollo y lo bastante grande para invertir el orden de dos eventos separados por pocos milisegundos en producción.',
        },
        {
          type: 'diagram',
          value: `LINEA DE TIEMPO REAL (referencia absoluta, inobservable)

  t=0ms          t=12ms
   |              |
   v              v
  envio          respuesta

LO QUE ESCRIBIO CADA SERVICIO

  servicio-mensajeria (reloj +45ms)  envio     -> 10:00:00.045
  servicio-inbox      (reloj -42ms)  respuesta -> 10:00:00.011  (!)

CONSULTA QUE ORDENA POR marca

  10:00:00.011  respuesta
  10:00:00.045  envio          <- orden invertido, datos correctos

  desvio total entre los dos relojes: 87ms
  intervalo real entre los dos eventos: 12ms
  cualquier par de eventos separado por menos de 87ms puede invertirse`,
        },
        {
          type: 'paragraph',
          value:
            'La regla que sale de este dibujo es el único parámetro que importa: dos eventos escritos por máquinas distintas solo tienen orden confiable si el intervalo entre ellos es mayor que el desvío máximo entre los relojes involucrados. En un entorno con sincronización por NTP bien configurada en red local, ese desvío queda en pocos milisegundos. En contenedores con reloj virtualizado, en máquinas virtuales que sufrieron migración en vivo o en regiones distintas con caminos de red asimétricos, supera fácilmente los cien milisegundos. Toda decisión de ordenación basada en marca de pared está apostando a que los eventos nunca van a ocurrir más cerca que ese número, y esa apuesta se pierde justamente bajo carga, cuando los eventos se acercan.',
        },
      ],
    },
    {
      title: 'El desvío es ruido, el salto es corrupción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los dos problemas de reloj se tratan como si fueran el mismo y producen fallas de naturaleza distinta. El desvío es la diferencia constante y pequeña entre dos máquinas: mezcla el orden de eventos cercanos, lo cual es malo, pero mantiene la propiedad de que el tiempo siempre avanza. El salto es el momento en que el demonio de sincronización corrige el reloj de una vez, moviéndolo hacia atrás. En ese instante, una sola máquina pasa a producir marcas que ya fueron usadas, y el orden deja de existir incluso dentro del propio proceso.',
        },
        {
          type: 'paragraph',
          value:
            'El salto hacia atrás es lo que causa pérdida de datos de verdad, y es más común de lo que parece. Ocurre cuando una máquina virtual se reanuda desde un estado suspendido, cuando un contenedor arranca con el reloj heredado de un host desactualizado, cuando NTP se configura para corregir de golpe en vez de acelerar o frenar gradualmente, y cuando alguien reinicia un servidor cuyo reloj de hardware está mal. El síntoma en el código es una duración negativa, una caché que expira antes de ser escrita, un bloqueo distribuido cuyo plazo ya había pasado en el momento en que fue adquirido.',
        },
        {
          type: 'code',
          value: `// time/clock.js
// Separa el reloj de pared (fecha absoluta, puede saltar) del reloj
// monotonico (solo avanza, sin significado absoluto). Mezclar los dos es
// el origen de la mayoria de los bugs de tiempo en produccion.

// Mal: mide duracion con reloj de pared. Si NTP corrige el reloj hacia
// atras en medio de la operacion, la duracion sale negativa y cualquier
// comparacion con umbral pasa a decidir lo contrario de lo pretendido.
export const medirMal = async (fn) => {
  const inicio = Date.now();
  await fn();
  return Date.now() - inicio; // puede ser negativo
};

// Bien: duracion siempre por el reloj monotonico. No dice que hora es,
// pero garantiza que la diferencia entre dos lecturas es el tiempo
// transcurrido de verdad.
export const medir = async (fn) => {
  const inicio = process.hrtime.bigint();
  await fn();
  return Number(process.hrtime.bigint() - inicio) / 1e6; // ms
};

// Los plazos tambien son duracion, no fecha. Un plazo guardado como
// instante absoluto expira demasiado pronto o demasiado tarde cuando el
// reloj salta.
export const crearPlazo = (duracionMs) => {
  const limite = process.hrtime.bigint() + BigInt(Math.round(duracionMs * 1e6));
  return {
    expirado: () => process.hrtime.bigint() >= limite,
    restanteMs: () => Number(limite - process.hrtime.bigint()) / 1e6,
  };
};

// Guarda de cordura para el unico lugar donde el reloj de pared es
// inevitable: registrar cuando ocurrio el evento en el mundo real. Una
// marca que retrocede dentro del mismo proceso es un salto detectado, y
// registrarlo es lo que convierte un dato absurdo en una alerta.
let ultimaMarca = 0;

export const ahoraMonotonicoAproximado = () => {
  const pared = Date.now();
  if (pared <= ultimaMarca) {
    // Salto hacia atras: mantiene el orden local avanzando un milisegundo
    // y deja el desvio visible para la metrica en vez de silenciarlo.
    ultimaMarca += 1;
    return { marca: ultimaMarca, saltoDetectadoMs: ultimaMarca - pared };
  }
  ultimaMarca = pared;
  return { marca: pared, saltoDetectadoMs: 0 };
};`,
        },
        {
          type: 'paragraph',
          value:
            'La separación entre reloj de pared y reloj monotónico es la corrección de mayor retorno y la más barata de aplicar. Toda medición de duración, todo plazo de expiración y todo cálculo de tiempo restante debe usar el reloj monotónico, que solo avanza y no tiene noción de fecha. Todo registro de cuándo ocurrió algo en el mundo real usa el reloj de pared, porque es el único que tiene significado fuera del proceso. La confusión entre los dos es lo que produce bloqueos distribuidos que expiran en el instante en que se crean, y esa clase de falla no aparece en ninguna prueba porque exige que el salto ocurra dentro de la ventana de ejecución.',
        },
        {
          type: 'table',
          columns: ['Uso', 'Reloj correcto', 'Qué se rompe con el reloj equivocado'],
          rows: [
            [
              'Medir cuánto tardó una llamada',
              'Monotónico',
              'Duración negativa y métrica de latencia corrompida',
            ],
            [
              'Expirar un bloqueo distribuido',
              'Monotónico en el titular, pared en el árbitro',
              'Dos titulares simultáneos sin error registrado',
            ],
            [
              'Registrar cuándo se creó el pedido',
              'Pared',
              'Fecha sin significado fuera del proceso',
            ],
            [
              'Ordenar eventos entre servicios',
              'Ninguno de los dos, usar contador lógico',
              'Inversión silenciosa bajo desvío',
            ],
            [
              'Decidir qué escritura es más reciente',
              'Versión de la entidad',
              'Escritura borrada sin conflicto reportado',
            ],
          ],
        },
      ],
    },
    {
      title: 'Ordenar sin reloj: el contador lógico por entidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La solución para la ordenación no es sincronizar mejor los relojes, es dejar de depender de ellos. Lo que el sistema necesita casi siempre no es saber a qué hora ocurrió el evento, sino saber qué evento vino antes que el otro. Esas son dos preguntas distintas, y la segunda tiene una respuesta exacta que no cuesta nada: un contador que se incrementa en cada evento de esa entidad. Dos eventos del mismo pedido son comparables por el contador con precisión absoluta, sin importar qué máquina los produjo ni cuánto discrepan los relojes.',
        },
        {
          type: 'paragraph',
          value:
            'El punto que suele frenar la adopción es el miedo a necesitar un contador global, que sería un cuello de botella. No es necesario. La ordenación global rara vez es requisito de negocio: nadie necesita saber si el pedido del cliente A vino antes que el del cliente B. Lo que importa es el orden dentro de cada entidad, y ese orden puede mantenerse con un contador local a esa entidad, que la propia base ya serializa en el momento de la actualización. El costo es una columna y una condición en el UPDATE.',
        },
        {
          type: 'code',
          value: `// events/sequence.js
// Orden por contador logico de la entidad. No depende de ningun reloj y
// no exige coordinacion global: el contador es local al agregado y la
// base ya serializa las actualizaciones de la misma fila.

export const registrarEvento = async ({ db, entidadId, tipo, datos }) => {
  // La secuencia viene de la propia base, en la misma transaccion que
  // escribe el evento. Leer el valor actual en la aplicacion e
  // incrementar en memoria reintroduce la carrera que el contador existe
  // para eliminar.
  const { rows } = await db.query(
    \`INSERT INTO eventos (entidad_id, secuencia, tipo, datos, registrado_en)
     VALUES (
       $1,
       COALESCE((SELECT MAX(secuencia) FROM eventos WHERE entidad_id = $1), 0) + 1,
       $2,
       $3,
       now()
     )
     RETURNING secuencia\`,
    [entidadId, tipo, datos],
  );

  return rows[0].secuencia;
};

// El consumidor detecta un hueco sin necesitar tiempo: si recibio la
// secuencia 7 y la ultima aplicada fue 5, la 6 esta en transito o se
// perdio, y aplicar la 7 ahora corrompe el estado.
export const aplicarEnOrden = ({ ultimaAplicada, evento, pendientes }) => {
  if (evento.secuencia <= ultimaAplicada) {
    return { accion: 'ignorar', motivo: 'duplicado o reentrega' };
  }

  if (evento.secuencia > ultimaAplicada + 1) {
    pendientes.set(evento.secuencia, evento);
    return { accion: 'esperar', hueco: evento.secuencia - ultimaAplicada - 1 };
  }

  // Aplico el siguiente esperado: drena lo que ya llego fuera de orden.
  let cursor = evento.secuencia;
  const aplicar = [evento];
  while (pendientes.has(cursor + 1)) {
    cursor += 1;
    aplicar.push(pendientes.get(cursor));
    pendientes.delete(cursor);
  }

  return { accion: 'aplicar', eventos: aplicar, ultimaAplicada: cursor };
};`,
        },
        {
          type: 'paragraph',
          value:
            'La propiedad que este diseño entrega y que ninguna marca entrega es la detección de huecos. Con marcas de tiempo, un evento perdido es indistinguible de un intervalo en el que no pasó nada, y el consumidor aplica el evento siguiente sobre un estado incompleto sin ninguna señal. Con contador, el hueco es aritmético: la secuencia siete llegando después de la cinco significa que la seis está en tránsito o se perdió, y esa es la diferencia entre un sistema que detecta la falla en segundos y uno que descubre la inconsistencia semanas después en una conciliación.',
        },
      ],
    },
    {
      title: 'Última escritura gana es una política de pérdida de datos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La estrategia más difundida para resolver escrituras concurrentes es comparar las marcas y quedarse con la mayor. Es atractiva porque no exige coordinación y no genera error para el cliente, y justamente por eso es peligrosa: el dato perdido no produce ningún síntoma. Bajo desvío, la escritura descartada no es la más antigua, es la que vino de la máquina cuyo reloj estaba atrasado, y esa elección es arbitraria respecto a la intención del usuario.',
        },
        {
          type: 'paragraph',
          value:
            'El escenario concreto es banal. Dos agentes actualizan el mismo registro con dos segundos de diferencia. El primero escribe por la instancia cuyo reloj adelanta cien milisegundos; el segundo, por la instancia cuyo reloj atrasa doscientos. La escritura del segundo agente, que es la correcta y la más reciente en la realidad, lleva una marca menor y es descartada por la regla. El cliente ve el dato antiguo, nadie recibe error, y el log registra las dos escrituras como exitosas. Investigar eso semanas después es imposible, porque no hay ningún registro de que una decisión de descarte haya ocurrido.',
        },
        {
          type: 'code',
          value: `// storage/write.js
// Sustituye 'ultima escritura gana por marca' por version de la entidad.
// La comparacion pasa a ser sobre lo que el cliente leyo, no sobre en
// que maquina se genero la marca.

export const actualizar = async ({ db, id, campos, versionLeida }) => {
  // La condicion sobre la version es lo que convierte una sobrescritura
  // silenciosa en un conflicto explicito: el UPDATE solo afecta la fila
  // si nadie escribio entre la lectura del cliente y este momento.
  const { rowCount, rows } = await db.query(
    \`UPDATE clientes
        SET datos = datos || $2::jsonb,
            version = version + 1,
            actualizado_en = now()
      WHERE id = $1 AND version = $3
      RETURNING version, datos\`,
    [id, JSON.stringify(campos), versionLeida],
  );

  if (rowCount === 0) {
    const actual = await db.query(
      'SELECT version, datos FROM clientes WHERE id = $1',
      [id],
    );

    if (actual.rowCount === 0) {
      return { estado: 'ausente' };
    }

    // Conflicto real: alguien escribio en el intervalo. Devolver el
    // estado actual permite al llamador decidir entre fusionar campo a
    // campo, repetir sobre la version nueva o preguntar al usuario.
    // Ninguna de esas opciones existe cuando la marca decide sola.
    return {
      estado: 'conflicto',
      versionActual: actual.rows[0].version,
      datosActuales: actual.rows[0].datos,
      camposEnConflicto: Object.keys(campos).filter(
        (campo) => campo in actual.rows[0].datos,
      ),
    };
  }

  return { estado: 'escrito', version: rows[0].version, datos: rows[0].datos };
};`,
        },
        {
          type: 'paragraph',
          value:
            'Cuando el requisito realmente exige convergencia automática sin error para el cliente, la salida no es volver a la marca de pared: es usar una estructura en la que la fusión está definida por el tipo del dato. Un contador se vuelve suma de incrementos, un conjunto se vuelve unión con marca de eliminación, un campo de texto se vuelve el valor de la réplica con mayor identificador en caso de empate. Todas esas reglas son deterministas e independientes del reloj, y lo único que piden a cambio es que la elección de fusión sea explícita por campo, en vez de implícita y global.',
        },
      ],
    },
    {
      title: 'Guardar las dos marcas: una para ordenar, otra para auditar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La conclusión natural de todo esto suele volverse una exageración: abandonar la marca de tiempo. Eso no funciona, porque existen preguntas legítimas que solo el reloj de pared responde. Cuánto tiempo esperó el cliente de verdad, si el evento ocurrió dentro del horario comercial, si la retención de treinta días ya venció, cuál fue la hora del incidente en el informe al cliente. Ninguna de esas preguntas la responde un contador lógico, que no tiene relación con el tiempo humano.',
        },
        {
          type: 'paragraph',
          value:
            'El diseño que resuelve los dos lados es guardar los dos campos con papeles separados y nombres que no se confundan. La secuencia lógica es lo que el código usa para ordenar, comparar y detectar huecos. La marca de pared es lo que la interfaz muestra y el informe usa, con la salvedad explícita de que es aproximada. Cuando las dos discrepan, y van a discrepar, gana la secuencia, porque es la única con garantía. Y la discrepancia en sí se vuelve una señal: registrar el desvío observado entre el orden lógico y el orden temporal es lo que convierte el problema de reloj en una métrica en vez de un ticket de soporte.',
        },
        {
          type: 'code',
          value: `// events/record.js
// Escribe las dos marcas con papeles distintos y mide la discrepancia
// entre ellas. La metrica resultante es lo que revela el desvio antes de
// que se convierta en dato absurdo en la pantalla del cliente.

export const construirRegistro = ({ secuencia, anterior, origen }) => {
  const marca = new Date().toISOString();

  // Si el evento anterior de la misma entidad tiene secuencia menor pero
  // marca mayor, los relojes de los dos origenes discrepan al menos en
  // esa diferencia. Es la unica forma de medir el desvio sin instalar un
  // agente en cada maquina: usar el orden causal ya conocido como
  // referencia.
  const desvioObservadoMs =
    anterior && anterior.secuencia < secuencia
      ? Math.max(0, Date.parse(anterior.marca) - Date.parse(marca))
      : 0;

  return {
    // Autoridad para ordenar, comparar y detectar huecos.
    secuencia,
    // Aproximacion para mostrar, filtrar por periodo y aplicar retencion.
    // Nunca usada para decidir precedencia.
    marca,
    origen,
    desvioObservadoMs,
  };
};

// El consumidor de la metrica solo necesita el maximo por par de
// origenes: es lo que define el intervalo por debajo del cual el orden
// por marca es ficcion.
export const acumularDesvio = (acumulador, registro, origenAnterior) => {
  if (registro.desvioObservadoMs === 0) return acumulador;
  const clave = [origenAnterior, registro.origen].sort().join('|');
  const actual = acumulador.get(clave) ?? 0;
  acumulador.set(clave, Math.max(actual, registro.desvioObservadoMs));
  return acumulador;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Esta métrica tiene una ventaja operativa que suele subestimarse: mide el desvío tal como el sistema lo experimenta, no como lo reporta el demonio de sincronización. NTP informa el error estimado respecto al servidor de referencia, lo cual no captura el caso en que dos máquinas están sincronizadas con fuentes distintas, cada una dentro de su propia tolerancia, y aun así discrepan entre sí en la suma de los errores. Usar el orden causal ya conocido como referencia mide exactamente la magnitud que rompe el sistema.',
        },
      ],
    },
    {
      title: 'Las tres alertas que capturan el desvío antes del dato absurdo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Monitorear el reloj suele reducirse a un panel con el desvío reportado por NTP en cada host, que es la señal menos útil de las disponibles: está en verde en todos los casos en que el problema es de configuración y no de sincronización, como zona horaria equivocada en el contenedor o reloj virtualizado que el demonio ni siquiera gestiona. Tres señales derivadas del comportamiento del propio sistema cubren lo que importa.',
        },
        {
          type: 'paragraph',
          value:
            'La primera es la inversión observada entre orden lógico y orden temporal, medida en milisegundos y agregada por par de orígenes. Responde directamente a la pregunta operativa que interesa, que es qué intervalo mínimo entre eventos sigue siendo confiable. La segunda es el salto hacia atrás dentro de un mismo proceso, contado por la guarda de cordura: cualquier ocurrencia es anómala e indica corrección abrupta o máquina reanudada desde suspensión. La tercera es la duración negativa en cualquier medición, que solo es posible cuando alguien midió tiempo con reloj de pared y es el indicador más directo de que el código tiene la mezcla que causa expiración incorrecta de bloqueo.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Detecta', 'Falla si se usa sola', 'Destino'],
          rows: [
            [
              'Inversión entre secuencia y marca',
              'Desvío real entre pares de servicios',
              'Solo aparece donde ya existe contador lógico',
              'Panel y revisión semanal',
            ],
            [
              'Salto de reloj hacia atrás en el proceso',
              'Corrección abrupta o máquina reanudada',
              'No ve desvío constante entre máquinas',
              'Llamado inmediato',
            ],
            [
              'Duración negativa en una medición',
              'Uso del reloj de pared para medir tiempo',
              'Silenciosa mientras no ocurre ningún salto',
              'Tarea del día',
            ],
            [
              'Desvío reportado por NTP',
              'Falla de sincronización declarada',
              'En verde con zona horaria mal y reloj virtualizado',
              'Solo panel',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última recomendación es de configuración y vale más que cualquier alerta: el demonio de sincronización debe corregir el reloj acelerándolo o frenándolo gradualmente, nunca dando un salto, excepto en el momento del arranque de la máquina, antes de que suba cualquier proceso de la aplicación. Con esa configuración el reloj nunca retrocede durante la ejecución, y la clase entera de fallas por salto desaparece sin una línea de código. Lo que queda es el desvío, que es ruido previsible, y para él la respuesta ya está dada: no ordene por marca, ordene por secuencia.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Sincronizar todos los relojes con precisión de microsegundos no resolvería el problema?',
      answer:
        'Reduce la frecuencia, pero no cambia la naturaleza de la falla, y el costo de acercarse a eso es lo bastante alto como para no compensar en la mayoría de los sistemas. La sincronización de altísima precisión exige hardware y caminos de red dedicados, del tipo usado en bolsas de valores, y aun allí la garantía es de error acotado, no de error cero. El punto que suele olvidarse es que el intervalo entre eventos concurrentes disminuye conforme el sistema crece: bajo carga, dos actualizaciones de la misma entidad quedan separadas por microsegundos, y ninguna precisión práctica de reloj ordena eso de forma confiable. También hay un caso que la precisión no toca: el reloj de contenedor que hereda el host equivocado, el servidor que vuelve de suspensión y la máquina virtual migrada en vivo producen discrepancias grandes sin importar cuán preciso sea el demonio. El enfoque que escala es asumir que el orden entre máquinas no es observable por el tiempo y resolver la ordenación donde realmente puede garantizarse, que es dentro de cada entidad. Invertir en sincronización sigue valiendo para marcas de auditoría y correlación de logs, donde un error de decenas de milisegundos es aceptable.',
    },
    {
      question: '¿Cómo corregir datos que ya fueron escritos con orden invertido?',
      answer:
        'El primer paso es medir la extensión antes de tocar cualquier fila, y la medida correcta no es cuántos registros tienen marca sospechosa, sino cuántos tienen marca dentro de la ventana de desvío máximo respecto al registro adyacente de la misma entidad. Fuera de esa ventana, el orden por marca sigue siendo correcto y el dato no necesita corrección. Dentro de ella, el orden es indeterminado, y el segundo paso es buscar una fuente independiente de causalidad: identificador de rastreo que liga petición a respuesta, referencia explícita al evento anterior en el payload, número de intento, o el orden de inserción en la clave primaria cuando es secuencial y generada por la base. Esas fuentes suelen resolver la mayoría de los casos ambiguos sin adivinar. El tercer paso es decidir qué hacer con el resto, y la respuesta honesta casi siempre es dejarlo como está y marcarlo: agregar una columna que indique que el orden de ese intervalo es incierto es más útil que reordenar por heurística, porque la marca es auditable y un reordenamiento equivocado es indistinguible del correcto. Reprocesar solo compensa cuando el efecto de la inversión es visible para el cliente y el valor correcto es derivable de otra fuente.',
    },
    {
      question: '¿El contador lógico por entidad no se vuelve un cuello de botella en entidades con muchas escrituras?',
      answer:
        'Se vuelve, y el límite práctico es justamente la tasa de escritura serializada en esa fila, típicamente algunos cientos por segundo antes de que aparezca la contención. La buena noticia es que ese límite es el mismo que la entidad ya tiene por otros motivos: si dos escrituras concurrentes necesitan ordenarse entre sí, ya compiten por el mismo estado, y el contador no agrega serialización, solo hace visible la que ya existía. Cuando la tasa realmente excede eso, el problema no es el contador, es la granularidad de la entidad, y la corrección es dividir el agregado en partes que puedan evolucionar de forma independiente. Un caso concreto es el historial de mensajes de una conversación muy activa: usar la conversación como unidad de secuencia crea contención, mientras que usar el par conversación más participante mantiene el orden que importa para la lectura sin serializar todo. Existe además la alternativa de generar identificadores ordenables con prefijo temporal y sufijo aleatorio, que no requiere coordinación y mantiene la ordenación aproximada, pero vuelve a depender del reloj para la parte gruesa del orden y solo es adecuada cuando la inversión dentro de la misma ventana de milisegundos es tolerable.',
    },
  ],
  conclusion: {
    title: 'El orden de los eventos hay que construirlo, no leerlo en el reloj',
    description:
      'Una marca de tiempo dice cuándo una máquina creyó que era, no en qué orden ocurrieron las cosas, y todo sistema distribuido que confunde ambas cosas termina con un dato absurdo en la pantalla del cliente. Puedo revisar cómo tu sistema ordena eventos y definir la separación entre reloj monotónico y de pared, el contador lógico por entidad que detecta huecos, la sustitución de la regla de última escritura gana por versionado con conflicto explícito, el par de marcas con papeles separados para ordenar y auditar, y las alertas que miden el desvío por el orden causal en vez de confiar en lo que reporta el demonio de sincronización.',
    cta: 'Hablar sobre ordenación de eventos en mi sistema',
  },
  related: [
    {
      label: 'Multirregión con escritura única: cuándo la latencia se vuelve decisión de producto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'La cola muerta que nadie lee: convertir el mensaje descartado en una corrección real',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
