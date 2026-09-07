// Conteudo do artigo: como trocar o broker de fila com o trafego ligado sem
// perder mensagem, duplicar efeito ou inverter ordem no meio da migracao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A migração estava marcada para as duas da manhã de um sábado, com trinta minutos de janela e um plano de três passos que cabia num bilhete: para o produtor, espera a fila esvaziar, aponta tudo para o broker novo. Às duas e dezoito a fila antiga ainda tinha quatro mil mensagens que não esvaziavam porque um consumidor lento continuava reprocessando, e às duas e trinta e um alguém apontou o produtor mesmo assim. Na segunda-feira o financeiro encontrou dezenove cobranças duplicadas e sete pedidos que nunca saíram do lugar. Este artigo mostra por que a janela de manutenção é a estratégia mais arriscada disponível, quais quatro garantias precisam ser inventariadas antes de escolher o método, como a fase de consumo duplo elimina a perda sem criar duplicidade, por que a ordem entre mensagens só sobrevive se você aceitar quebrar uma das duas propriedades, qual sequência de sete etapas migra com o tráfego ligado e reverte em qualquer ponto, e quais três indicadores dizem que a fila antiga pode ser desligada de verdade.',
  sections: [
    {
      title: 'Por que a janela de manutenção é o plano mais arriscado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O plano de parar o produtor, drenar a fila e religar apontando para o broker novo parece o mais seguro porque elimina o período em que as duas filas existem ao mesmo tempo. Na prática ele concentra todo o risco num intervalo curto, sem ensaio e sem caminho de volta, e depende de uma premissa que quase nunca se sustenta: a de que a fila drena em tempo previsível.',
        },
        {
          type: 'paragraph',
          value:
            'A fila não drena em tempo previsível porque o tempo de drenagem não depende só do que está nela. Depende do consumidor mais lento, das mensagens que entram em nova tentativa e voltam para o fim, do lote que falha e é reprocessado inteiro, e da mensagem envenenada que ocupa uma partição indefinidamente. Uma fila com quatro mil mensagens e vazão de trezentas por segundo não leva treze segundos para esvaziar se dez por cento delas estão em ciclo de nova tentativa com espera exponencial de até cinco minutos.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo problema é que a janela não tem reversão barata. Depois que o produtor foi apontado para o broker novo e um consumidor confirmou a primeira mensagem lá, voltar atrás significa ter duas fontes de verdade parciais, e nenhuma equipe toma essa decisão bem às três da manhã. Migração com tráfego ligado inverte essa relação: cada etapa é pequena, observável e reversível, e a decisão difícil nunca acontece sob pressão de relógio.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Como funciona', 'Risco principal', 'Reversão'],
          rows: [
            [
              'Janela de manutenção',
              'Para o produtor, drena, aponta para o broker novo',
              'A drenagem não termina dentro da janela e alguém corta mesmo assim',
              'Cara, exige reprocessar ou reconciliar manualmente',
            ],
            [
              'Consumo duplo',
              'Consumidor lê dos dois brokers, produtor migra depois',
              'Duplicidade se o consumidor não for idempotente',
              'Imediata, basta parar de ler do broker novo',
            ],
            [
              'Ponte entre filas',
              'Um processo copia mensagem do broker antigo para o novo',
              'A ponte vira ponto único e pode duplicar em falha parcial',
              'Imediata, basta desligar a ponte',
            ],
            [
              'Produção dupla',
              'Produtor publica nos dois, consumidor migra depois',
              'Divergência quando uma publicação falha e a outra não',
              'Imediata, mas exige decidir o que fazer com o já publicado',
            ],
            [
              'Roteamento por porcentagem',
              'Fração do tráfego novo vai para o broker novo',
              'Ordem entre mensagens do mesmo agregado quebra entre brokers',
              'Imediata, basta zerar a porcentagem',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas linhas do meio são as que resolvem a maioria dos casos, e a escolha entre elas depende de quem você controla. Se o produtor é código seu, produção dupla e roteamento por porcentagem são possíveis. Se o produtor é um parceiro externo, um dispositivo em campo ou um serviço legado que ninguém quer tocar, a ponte entre filas é o único caminho, e ela precisa ser tratada com o cuidado de um componente de produção, não como script temporário.',
        },
      ],
    },
    {
      title: 'As quatro garantias que precisam ser inventariadas antes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Migrar broker é migrar as garantias que o sistema assumia sem escrever em lugar nenhum. Antes de escolher o método, cada uma das quatro precisa de resposta explícita, porque o método correto muda conforme a resposta.',
        },
        {
          type: 'ordered',
          items: [
            'Entrega. O broker antigo garantia pelo menos uma entrega, no máximo uma, ou exatamente uma dentro de um escopo limitado. Se o consumidor foi escrito assumindo no máximo uma e o broker novo entrega pelo menos uma, cada nova tentativa vira efeito duplicado. Essa é a origem das dezenove cobranças duplicadas do exemplo de abertura.',
            'Ordem. A ordem era global, por partição, por chave, ou não existia. Ordem global é a mais cara de preservar numa migração e a menos frequentemente necessária de verdade. Ordem por chave é a que o negócio quase sempre precisa e a que quebra silenciosamente quando duas filas coexistem.',
            'Persistência e confirmação. Quando o produtor recebe a confirmação de publicação, a mensagem já está em disco e replicada, ou apenas aceita em memória. Brokers diferentes têm padrões diferentes aqui, e uma migração que troca uma configuração conservadora por uma permissiva perde mensagens só em falha de nó, que é justamente o caso que ninguém testa.',
            'Retenção e reprocessamento. A mensagem some depois de confirmada, ou fica retida por um período e pode ser relida do começo. Essa diferença define se a reversão consiste em reapontar um cursor ou em reconstruir estado a partir de outra fonte, e é o que separa uma migração reversível de uma migração de mão única.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A garantia de entrega merece um destaque prático. Nenhum broker entrega exatamente uma vez de ponta a ponta na presença de falha de rede, porque o produtor que não recebe a confirmação não sabe se a publicação aconteceu. O que existe é deduplicação dentro de uma janela, do lado do broker, e idempotência do lado do consumidor. A migração é o momento em que essa diferença deixa de ser teórica: durante a coexistência dos dois brokers, a mesma mensagem pode chegar por dois caminhos, e a única defesa que funciona em todos os casos é a chave de idempotência do lado de quem aplica o efeito.',
        },
        {
          type: 'code',
          value: `// Consumidor idempotente por chave de negocio, nao por identificador
// gerado pelo broker: durante a migracao a mesma mensagem chega com
// identificadores diferentes pelos dois caminhos.
const JANELA_DEDUP_SEGUNDOS = 60 * 60 * 24 * 7;

async function processarMensagem(mensagem) {
  // A chave vem do payload e e estavel entre brokers. Usar o offset,
  // o messageId do broker ou o deliveryTag quebra na coexistencia.
  const chave = \`efeito:\${mensagem.tipo}:\${mensagem.agregadoId}:\${mensagem.eventoId}\`;

  // SET com NX e a operacao atomica que decide quem processa. Sem NX,
  // dois consumidores leem "nao existe" ao mesmo tempo e ambos aplicam.
  const primeiro = await redis.set(chave, 'processando', {
    NX: true,
    EX: JANELA_DEDUP_SEGUNDOS,
  });

  if (!primeiro) {
    const estado = await redis.get(chave);
    if (estado === 'concluido') return { status: 'duplicada_ignorada' };
    // Outro consumidor pegou e ainda nao terminou: devolve para nova
    // tentativa em vez de confirmar, senao a mensagem some se o outro falhar.
    throw new ErroTentarDepois('efeito_em_andamento');
  }

  try {
    await aplicarEfeito(mensagem);
    await redis.set(chave, 'concluido', { EX: JANELA_DEDUP_SEGUNDOS });
    return { status: 'processada' };
  } catch (erro) {
    // Libera a chave para que a nova tentativa possa reprocessar.
    await redis.del(chave);
    throw erro;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que mais falha em implementações reais é o bloco de erro. Sem o descarte da chave, uma falha transitória no efeito deixa a marca de processamento no lugar e a nova tentativa é descartada como duplicata, o que transforma um erro recuperável em mensagem perdida. É o modo de falha mais difícil de detectar depois, porque não gera erro nem alerta: a mensagem simplesmente não produziu efeito e ninguém percebe até a conciliação.',
        },
      ],
    },
    {
      title: 'Consumo duplo: a fase que elimina a perda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem correta de migração é contraintuitiva: o consumidor migra primeiro, o produtor migra depois. Quem começa apontando o produtor para o broker novo cria imediatamente uma janela em que existem mensagens do lado novo sem ninguém para lê-las, e mensagens do lado antigo que ainda precisam ser drenadas. Quem começa pelo consumidor cria uma janela em que existe capacidade de leitura sobrando dos dois lados, que é inofensiva.',
        },
        {
          type: 'diagram',
          value: `Fase 1 - so o broker antigo
  produtor --> [FILA ANTIGA] --> consumidor

Fase 2 - consumo duplo (consumidor le dos dois, so o antigo tem trafego)
  produtor --> [FILA ANTIGA] --\\
                                >--> consumidor (idempotente)
               [FILA NOVA]   --/     nenhuma mensagem chega pela nova ainda
  ponto de verificacao: consumidor conectado, com 0 mensagens lidas da nova

Fase 3 - producao percentual (5% -> 25% -> 50% -> 100%)
  produtor --5%--> [FILA NOVA]   --\\
           -95%--> [FILA ANTIGA] --/--> consumidor
  ponto de verificacao: taxa de erro igual dos dois lados,
  latencia de ponta a ponta comparavel, 0 duplicatas aplicadas

Fase 4 - drenagem da fila antiga (producao 100% na nova)
  produtor -100%-> [FILA NOVA]   --\\
                                    >--> consumidor
               [FILA ANTIGA] ------/     drenando o residual
  ponto de verificacao: profundidade da antiga em 0 por
  tempo maior que o backoff maximo da nova tentativa

Fase 5 - desligar
  produtor --> [FILA NOVA] --> consumidor
  a fila antiga sai do consumidor so depois da fase 4 confirmada`,
        },
        {
          type: 'paragraph',
          value:
            'A fase dois é a que dá segurança ao resto e a que mais gente pula. Ela não move tráfego nenhum: serve para provar que o consumidor consegue se conectar ao broker novo, autenticar, desserializar o formato de mensagem, respeitar o limite de mensagens em voo e confirmar corretamente. Todos esses são pontos de falha reais numa troca de broker, e descobri-los com zero mensagens em jogo custa uma tarde, enquanto descobri-los com cinquenta por cento do tráfego custa um incidente.',
        },
        {
          type: 'paragraph',
          value:
            'A fase quatro tem uma armadilha de tempo. A fila antiga chegar a zero uma vez não significa que ela esvaziou: mensagens em ciclo de nova tentativa reaparecem depois do tempo de espera, e se a espera exponencial chega a quinze minutos, a fila pode ficar em zero por dez minutos e voltar a ter conteúdo. O critério correto é profundidade zero por um período maior que o maior tempo de espera configurado, somado ao tempo de visibilidade da mensagem, e não a primeira leitura de zero no painel.',
        },
      ],
    },
    {
      title: 'Ordem entre mensagens: escolher qual propriedade quebrar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante a coexistência, mensagens do mesmo agregado podem estar nas duas filas ao mesmo tempo, e não existe forma de ordená-las entre si sem coordenação externa. Essa é a restrição dura da migração com tráfego ligado, e ela não tem solução gratuita: você escolhe qual propriedade quebrar durante a transição.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'O que preserva', 'O que sacrifica', 'Quando usar'],
          rows: [
            [
              'Migrar por chave de agregado',
              'Ordem dentro de cada agregado, sempre',
              'Migração deixa de ser percentual e vira por fatia de chave',
              'Ordem por chave é requisito de negócio',
            ],
            [
              'Drenar antes de mover a chave',
              'Ordem total dentro do agregado migrado',
              'Latência da última mensagem do agregado durante a troca',
              'Agregados com volume baixo e picos raros',
            ],
            [
              'Aceitar reordenação e versionar',
              'Disponibilidade e simplicidade da migração',
              'Ordem, que passa a ser resolvida pelo consumidor',
              'O consumidor já descarta versão antiga por número',
            ],
            [
              'Pausar o agregado por segundos',
              'Ordem, com custo previsível e limitado',
              'Disponibilidade daquele agregado durante a pausa',
              'Poucos agregados críticos e pausa tolerável',
            ],
            [
              'Ignorar o problema',
              'Nada',
              'Consistência, de forma silenciosa e difícil de detectar',
              'Nunca, e é o que mais acontece na prática',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A primeira linha é a que mais vale conhecer, porque transforma a migração percentual em algo compatível com ordem. Em vez de sortear cinco por cento das mensagens, você usa um hash estável do identificador do agregado e migra a fatia inteira de uma vez: todas as mensagens do pedido 4711 vão para o broker novo, ou nenhuma vai. Isso preserva ordem por chave por construção, e o percentual continua controlável, só que em degraus de fatia em vez de mensagem a mensagem.',
        },
        {
          type: 'code',
          value: `// Roteamento por fatia estavel de chave: preserva ordem por agregado
// durante a coexistencia dos dois brokers.
import { createHash } from 'node:crypto';

const TOTAL_FATIAS = 128;

const fatiaDe = (chaveAgregado) => {
  const digest = createHash('sha256').update(chaveAgregado).digest();
  return digest.readUInt32BE(0) % TOTAL_FATIAS;
};

// Vem de configuracao dinamica, nao de variavel de ambiente: a mudanca
// precisa valer sem reimplantacao para que a reversao seja imediata.
const fatiasMigradas = () => configuracao.get('fila.fatiasMigradas', 0);

async function publicar(mensagem) {
  const fatia = fatiaDe(mensagem.agregadoId);
  const destino = fatia < fatiasMigradas() ? brokerNovo : brokerAntigo;

  await destino.publicar({
    ...mensagem,
    // Carimbo de rota no proprio payload: sem isso e impossivel
    // reconstruir depois por onde cada mensagem passou.
    rota: { broker: destino.nome, fatia, migradoEm: Date.now() },
  });
}

// Aumento de degrau: 0 -> 6 -> 32 -> 64 -> 128 fatias.
// Cada degrau so avanca depois de uma janela de observacao completa,
// e voltar um degrau nao gera reordenacao porque a fatia inteira volta.`,
        },
        {
          type: 'paragraph',
          value:
            'A reversão nesse desenho tem uma propriedade que a migração aleatória não tem: reduzir o número de fatias migradas devolve o agregado inteiro para o broker antigo, e como todas as mensagens dele estavam do mesmo lado, não existe intercalação entre os dois. A única mensagem que pode ficar fora de ordem é a que estava em voo no instante exato da mudança de degrau, e isso é resolvido drenando a fatia antes de mover, ou aceitando que o consumidor descarte versão antiga por número de versão.',
        },
      ],
    },
    {
      title: 'A sequência de sete etapas com o tráfego ligado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sequência abaixo funciona para os dois casos, produtor sob seu controle ou não, e cada etapa tem um critério de saída objetivo. A regra que sustenta o método é simples: nenhuma etapa avança por horário, todas avançam por indicador.',
        },
        {
          type: 'ordered',
          items: [
            'Torne o consumidor idempotente antes de tocar em qualquer broker. Chave de idempotência derivada do payload, não do identificador do broker, e verificação de que reprocessar a mesma mensagem duas vezes não muda o resultado. Critério de saída: teste que republica a mesma mensagem cinco vezes e confirma um único efeito.',
            'Suba o broker novo e conecte o consumidor a ele sem tráfego. Autenticação, formato, limite de mensagens em voo, confirmação, tratamento da fila morta. Critério de saída: consumidor conectado por vinte e quatro horas com zero mensagens lidas e zero erro de conexão.',
            'Publique tráfego sintético no broker novo. Mensagens marcadas que percorrem o caminho completo e produzem efeito verificável em ambiente controlado. Critério de saída: latência de ponta a ponta medida e comparável à do broker antigo, e comportamento de nova tentativa igual ao esperado.',
            'Migre a primeira fatia de chaves, algo entre três e cinco por cento. Observe por pelo menos uma janela que contenha um pico de tráfego, não apenas trinta minutos de horário calmo. Critério de saída: taxa de erro, latência e contagem de duplicatas aplicadas iguais entre as duas rotas.',
            'Aumente em degraus com observação entre eles. Vinte e cinco, cinquenta, cem por cento das fatias. Cada degrau precisa passar por um ciclo completo de operação, incluindo uma implantação da aplicação, para provar que a reconexão funciona sob o broker novo.',
            'Drene a fila antiga e confirme a drenagem pelo critério certo. Profundidade zero por período maior que o maior tempo de espera de nova tentativa somado ao tempo de visibilidade. Verifique também a fila morta antiga, que costuma ser esquecida e contém exatamente as mensagens que mais precisam de tratamento.',
            'Desconecte o consumidor do broker antigo e só então desprovisione. Mantenha o broker antigo ligado, sem tráfego, por pelo menos um ciclo de retenção completo. Ele é o caminho de volta e o registro de auditoria do período de transição, e desligá-lo cedo troca economia pequena por risco grande.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A etapa cinco tem um detalhe que costuma ser descoberto tarde: incluir uma implantação da aplicação dentro de cada degrau. Reconexão a broker é um dos comportamentos menos exercitados de um serviço, e uma configuração de reconexão que não funciona só aparece quando o processo reinicia. Descobrir isso com cinco por cento do tráfego é um bilhete de tarefa, descobrir com cem por cento é um incidente com mensagens paradas em fila.',
        },
        {
          type: 'paragraph',
          value:
            'Quando o produtor não é seu, as etapas quatro e cinco mudam de forma mas não de lógica. A ponte entre filas assume o papel do roteamento: ela lê do broker antigo e publica no novo, e o percentual passa a ser aplicado dentro dela pela mesma função de fatia. A ponte precisa confirmar no broker antigo somente depois de receber a confirmação de publicação no novo, nessa ordem, porque a ordem inversa perde mensagem em qualquer falha entre as duas operações, e ela precisa da mesma chave de idempotência, porque confirmar depois de publicar significa que uma falha no meio republica a mensagem.',
        },
      ],
    },
    {
      title: 'Os três indicadores que autorizam desligar a fila antiga',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O desligamento é a decisão que mais costuma ser tomada por sensação, e é a que tem consequência mais permanente, porque depois dela não há caminho de volta. Os três indicadores abaixo transformam essa decisão em verificação.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que mede', 'Critério para desligar', 'O que ele pega'],
          rows: [
            [
              'Profundidade residual sustentada',
              'Mensagens na fila antiga, incluindo a fila morta',
              'Zero por período maior que o maior tempo de espera mais a visibilidade',
              'Mensagem em ciclo de nova tentativa que ressurge depois',
            ],
            [
              'Cobertura de produtores',
              'Produtores distintos que publicaram no broker antigo na janela',
              'Zero por um ciclo de negócio completo, incluindo rotinas mensais',
              'Trabalho agendado raro que ninguém lembrou de migrar',
            ],
            [
              'Duplicatas aplicadas',
              'Efeitos bloqueados pela chave de idempotência por origem',
              'Estável e explicável, sem crescimento durante a coexistência',
              'Ponte ou produtor duplo publicando o mesmo evento duas vezes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O segundo indicador é o que mais evita incidente pós-migração. Sistemas reais têm produtores que publicam uma vez por mês, no fechamento, e que ninguém inventariou porque não aparecem no gráfico de tráfego do dia. Medir produtores distintos por janela, em vez de volume de mensagens, revela esses casos: um produtor que publicou uma única mensagem em trinta dias tem o mesmo peso de um que publicou um milhão, e é exatamente ele que quebra depois do desligamento.',
        },
        {
          type: 'paragraph',
          value:
            'O terceiro indicador precisa ser lido pela origem, não pelo total. Um número absoluto de duplicatas bloqueadas não diz nada sozinho, porque nova tentativa legítima produz duplicata bloqueada e isso é o sistema funcionando. O que importa é a quebra por rota: se as duplicatas vindas da ponte crescem enquanto as vindas do consumo normal ficam estáveis, a ponte está republicando, e esse é o defeito que produz cobrança duplicada mesmo com consumidor idempotente, quando a janela de deduplicação é menor que o intervalo entre as duas publicações.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale a pena manter a ponte entre filas depois da migração, como camada de compatibilidade permanente?',
      answer:
        'Quase nunca, e o motivo é que a ponte tem um custo que só aparece meses depois. Enquanto ela existe, o sistema tem dois brokers em produção, duas configurações de retenção, duas políticas de fila morta, dois conjuntos de credenciais para rotacionar e dois lugares onde procurar uma mensagem durante um incidente. Nada disso é dramático isoladamente, mas junto significa que toda investigação começa com a pergunta de por qual caminho a mensagem veio, e essa pergunta custa minutos em cada incidente pelo resto da vida do sistema. Existe um caso legítimo, que é o produtor externo que você não controla e que tem um cronograma próprio de migração, tipicamente um parceiro com contrato. Nesse caso a ponte deixa de ser transitória e vira componente de produção, e a consequência prática é que ela precisa ser tratada como tal: alerta próprio de atraso e de erro, teste automatizado, dono definido, documentação de comportamento em falha parcial e revisão periódica. O padrão que dá errado é o intermediário, em que a ponte fica ligada por conveniência sem dono e sem alerta, e alguém descobre seis meses depois que ela parou há três semanas quando o parceiro reclama de dados faltando. Se a decisão for manter, escreva a data de revisão junto com a decisão, porque uma ponte sem data de fim nunca é removida.',
    },
    {
      question: 'Como testar a migração antes de fazer, se o ambiente de homologação não tem o volume nem os produtores reais de produção?',
      answer:
        'Homologação não vai reproduzir o volume, e insistir nisso costuma consumir mais tempo do que a migração inteira. O que ela reproduz bem é comportamento, e comportamento é onde a maioria das migrações falha: formato de mensagem, autenticação, semântica de confirmação, política de nova tentativa, tratamento de fila morta e reconexão após queda. Testar essas seis coisas em homologação já elimina a maior parte dos incidentes, e um teste específico vale mais que todos os outros: derrubar o broker novo no meio do consumo e verificar que nenhuma mensagem foi perdida nem duplicada. Ele é fácil de executar e falha com frequência surpreendente. Para o que homologação não cobre, existem duas técnicas melhores do que tentar simular volume. A primeira é o espelhamento de tráfego real: copiar mensagens de produção para o broker novo e processá-las com um consumidor que aplica efeito em ambiente separado. Isso exercita o formato real, incluindo aquele campo que só um produtor manda e que ninguém documentou. A segunda é a própria migração por fatia, que é o teste em produção com dano limitado por construção: cinco por cento das chaves atravessam o caminho completo com efeito real, e se algo quebrar, o alcance é conhecido de antemão e a reversão é uma mudança de configuração. Migração por degraus não é uma alternativa ao teste, é a forma de teste que produção aceita.',
    },
    {
      question: 'A ordem das mensagens realmente importa no meu caso, ou estou complicando uma migração que poderia ser simples?',
      answer:
        'Na maioria dos sistemas a ordem global não importa e a ordem por chave importa em poucos fluxos específicos, então vale medir em vez de assumir qualquer um dos extremos. O teste mental que resolve rápido é este: para cada tipo de mensagem, pergunte o que acontece se duas mensagens do mesmo agregado forem aplicadas na ordem inversa. Em atualização de cadastro com sobrescrita de campo, o resultado é dado antigo vencendo dado novo, o que é uma falha silenciosa e real. Em incremento de contador, a ordem não muda nada. Em máquina de estados com transição válida declarada, a mensagem fora de ordem é rejeitada e vira nova tentativa, o que é comportamento correto e não perda. Essa separação costuma mostrar que ordem importa em dois ou três fluxos, não em todos, e isso muda a estratégia: migre esses fluxos por fatia de chave e o resto por percentual simples, em vez de submeter o sistema inteiro à restrição mais cara. Vale registrar que a proteção mais durável não é a ordem e sim o número de versão no payload, com o consumidor descartando aplicação de versão menor que a já aplicada. Quem tem isso pode migrar sem se preocupar com ordenação entre brokers, porque a reordenação deixa de produzir efeito errado e passa a produzir apenas descarte. Se o sistema não tem número de versão, adicioná-lo antes da migração costuma ser mais barato que preservar ordem durante ela, e o benefício permanece depois que a migração termina.',
    },
  ],
  conclusion: {
    title: 'Trocar o broker é migrar garantias, não endereços de conexão',
    description:
      'A troca de fila raramente falha por causa do broker novo: falha porque a garantia de entrega mudou sem ninguém notar, porque a ordem por chave quebrou durante a coexistência, ou porque a fila antiga foi desligada antes da última mensagem em nova tentativa reaparecer. Posso revisar as garantias que a sua fila entrega hoje e definir o inventário de entrega, ordem, persistência e retenção, a chave de idempotência que sobrevive à coexistência dos dois brokers, o roteamento por fatia de chave que preserva ordem durante os degraus, a sequência de migração reversível em qualquer ponto e os indicadores que autorizam desligar a fila antiga.',
    cta: 'Falar sobre a migração de fila do meu sistema',
  },
  related: [
    {
      label: 'Fila morta que ninguém lê: quando a mensagem descartada vira correção',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Chave de particionamento errada: a fila que trava porque um cliente sozinho ocupa tudo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Migração de banco sem janela: expandir, migrar, contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
  ],
};

const en = {
  intro:
    'The migration was scheduled for two in the morning on a Saturday, with a thirty minute window and a three step plan that fit on a sticky note: stop the producer, wait for the queue to drain, point everything at the new broker. At two eighteen the old queue still held four thousand messages that would not drain because a slow consumer kept reprocessing, and at two thirty-one somebody pointed the producer anyway. On Monday, finance found nineteen duplicate charges and seven orders that never moved. This article shows why the maintenance window is the riskiest strategy available, which four guarantees must be inventoried before choosing a method, how the dual consumption phase eliminates loss without creating duplication, why ordering between messages only survives if you accept breaking one of two properties, which seven stage sequence migrates with traffic on and reverts at any point, and which three indicators say the old queue can genuinely be switched off.',
  sections: [
    {
      title: 'Why the maintenance window is the riskiest plan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The plan of stopping the producer, draining the queue and switching over to the new broker looks safest because it removes the period in which both queues exist at once. In practice it concentrates all the risk in a short interval, with no rehearsal and no way back, and it depends on a premise that almost never holds: that the queue drains in predictable time.',
        },
        {
          type: 'paragraph',
          value:
            'The queue does not drain in predictable time because drain time does not depend only on what sits in it. It depends on the slowest consumer, on messages that enter retry and go back to the tail, on the batch that fails and gets reprocessed whole, and on the poison message that occupies a partition indefinitely. A queue with four thousand messages and a throughput of three hundred per second does not take thirteen seconds to empty if ten percent of them are in a retry cycle with exponential backoff of up to five minutes.',
        },
        {
          type: 'paragraph',
          value:
            'The second problem is that the window has no cheap reversal. Once the producer has been pointed at the new broker and a consumer has acknowledged the first message there, going back means having two partial sources of truth, and no team makes that decision well at three in the morning. Migrating with traffic on inverts that relationship: every stage is small, observable and reversible, and the hard decision never happens under clock pressure.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'How it works', 'Main risk', 'Reversal'],
          rows: [
            [
              'Maintenance window',
              'Stop the producer, drain, point at the new broker',
              'The drain does not finish inside the window and somebody cuts over anyway',
              'Expensive, requires reprocessing or manual reconciliation',
            ],
            [
              'Dual consumption',
              'Consumer reads from both brokers, producer migrates later',
              'Duplication if the consumer is not idempotent',
              'Immediate, just stop reading from the new broker',
            ],
            [
              'Queue bridge',
              'A process copies messages from the old broker to the new one',
              'The bridge becomes a single point and can duplicate on partial failure',
              'Immediate, just turn the bridge off',
            ],
            [
              'Dual production',
              'Producer publishes to both, consumer migrates later',
              'Divergence when one publish fails and the other does not',
              'Immediate, but requires deciding what to do with what was published',
            ],
            [
              'Percentage routing',
              'A fraction of new traffic goes to the new broker',
              'Ordering between messages of the same aggregate breaks across brokers',
              'Immediate, just set the percentage to zero',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The two middle rows solve most cases, and the choice between them depends on who you control. If the producer is your code, dual production and percentage routing are available. If the producer is an external partner, a field device or a legacy service nobody wants to touch, the queue bridge is the only path, and it must be treated with the care of a production component, not as a temporary script.',
        },
      ],
    },
    {
      title: 'The four guarantees that must be inventoried first',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Migrating a broker means migrating the guarantees the system assumed without writing them down anywhere. Before choosing a method, each of the four needs an explicit answer, because the right method changes with the answer.',
        },
        {
          type: 'ordered',
          items: [
            'Delivery. The old broker guaranteed at least once, at most once, or exactly once within a limited scope. If the consumer was written assuming at most once and the new broker delivers at least once, every retry becomes a duplicated effect. That is the origin of the nineteen duplicate charges in the opening example.',
            'Ordering. Ordering was global, per partition, per key, or nonexistent. Global ordering is the most expensive to preserve in a migration and the least frequently genuinely needed. Per key ordering is what the business almost always needs and what breaks silently when two queues coexist.',
            'Durability and acknowledgement. When the producer receives a publish acknowledgement, is the message already on disk and replicated, or merely accepted in memory. Different brokers have different defaults here, and a migration that swaps a conservative setting for a permissive one loses messages only on node failure, which is exactly the case nobody tests.',
            'Retention and reprocessing. Does the message disappear once acknowledged, or is it retained for a period and replayable from the beginning. That difference defines whether reversal means repointing a cursor or rebuilding state from another source, and it is what separates a reversible migration from a one way one.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The delivery guarantee deserves a practical note. No broker delivers exactly once end to end in the presence of network failure, because a producer that does not receive the acknowledgement does not know whether the publish happened. What exists is deduplication within a window on the broker side, and idempotency on the consumer side. The migration is the moment that difference stops being theoretical: while both brokers coexist, the same message can arrive through two paths, and the only defense that works in every case is the idempotency key on the side that applies the effect.',
        },
        {
          type: 'code',
          value: `// Idempotent consumer keyed on business identity, not on a broker
// generated identifier: during the migration the same message arrives
// with different identifiers through the two paths.
const DEDUP_WINDOW_SECONDS = 60 * 60 * 24 * 7;

async function processMessage(message) {
  // The key comes from the payload and is stable across brokers. Using the
  // offset, the broker messageId or the deliveryTag breaks under coexistence.
  const key = \`effect:\${message.type}:\${message.aggregateId}:\${message.eventId}\`;

  // SET with NX is the atomic operation that decides who processes. Without
  // NX, two consumers read "does not exist" at once and both apply.
  const first = await redis.set(key, 'processing', {
    NX: true,
    EX: DEDUP_WINDOW_SECONDS,
  });

  if (!first) {
    const state = await redis.get(key);
    if (state === 'done') return { status: 'duplicate_ignored' };
    // Another consumer took it and has not finished: send it back for retry
    // instead of acknowledging, otherwise the message vanishes if that one fails.
    throw new RetryLaterError('effect_in_progress');
  }

  try {
    await applyEffect(message);
    await redis.set(key, 'done', { EX: DEDUP_WINDOW_SECONDS });
    return { status: 'processed' };
  } catch (error) {
    // Release the key so the retry can reprocess.
    await redis.del(key);
    throw error;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The part that fails most often in real implementations is the error block. Without releasing the key, a transient failure in the effect leaves the processing marker in place and the retry is discarded as a duplicate, which turns a recoverable error into a lost message. It is the hardest failure mode to detect afterwards, because it raises neither an error nor an alert: the message simply produced no effect and nobody notices until reconciliation.',
        },
      ],
    },
    {
      title: 'Dual consumption: the phase that eliminates loss',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The correct migration order is counterintuitive: the consumer migrates first, the producer migrates later. Starting by pointing the producer at the new broker immediately creates a window in which messages sit on the new side with nobody to read them, and messages on the old side still need draining. Starting with the consumer creates a window in which there is spare read capacity on both sides, which is harmless.',
        },
        {
          type: 'diagram',
          value: `Phase 1 - old broker only
  producer --> [OLD QUEUE] --> consumer

Phase 2 - dual consumption (consumer reads both, only the old has traffic)
  producer --> [OLD QUEUE] --\\
                              >--> consumer (idempotent)
               [NEW QUEUE] --/     no message arrives through the new one yet
  checkpoint: consumer connected, 0 messages read from the new queue

Phase 3 - percentage production (5% -> 25% -> 50% -> 100%)
  producer --5%--> [NEW QUEUE] --\\
           -95%--> [OLD QUEUE] --/--> consumer
  checkpoint: equal error rate on both sides,
  comparable end to end latency, 0 duplicates applied

Phase 4 - draining the old queue (production 100% on the new one)
  producer -100%-> [NEW QUEUE] --\\
                                  >--> consumer
               [OLD QUEUE] ------/     draining the residual
  checkpoint: old queue depth at 0 for longer
  than the maximum retry backoff

Phase 5 - shut down
  producer --> [NEW QUEUE] --> consumer
  the old queue leaves the consumer only after phase 4 is confirmed`,
        },
        {
          type: 'paragraph',
          value:
            'Phase two is what gives the rest its safety and the one most people skip. It moves no traffic at all: it exists to prove the consumer can connect to the new broker, authenticate, deserialize the message format, respect the in flight message limit and acknowledge correctly. All of those are real failure points in a broker swap, and finding them with zero messages at stake costs an afternoon, while finding them at fifty percent of traffic costs an incident.',
        },
        {
          type: 'paragraph',
          value:
            'Phase four has a timing trap. The old queue reaching zero once does not mean it drained: messages in a retry cycle reappear after the backoff, and if exponential backoff reaches fifteen minutes, the queue can sit at zero for ten minutes and then have content again. The correct criterion is zero depth for a period longer than the largest configured backoff plus the message visibility timeout, not the first zero reading on the dashboard.',
        },
      ],
    },
    {
      title: 'Message ordering: choosing which property to break',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During coexistence, messages of the same aggregate can sit in both queues at once, and there is no way to order them relative to each other without external coordination. That is the hard constraint of migrating with traffic on, and it has no free solution: you choose which property to break during the transition.',
        },
        {
          type: 'table',
          columns: ['Approach', 'What it preserves', 'What it sacrifices', 'When to use it'],
          rows: [
            [
              'Migrate by aggregate key',
              'Ordering within each aggregate, always',
              'The migration stops being percentage based and becomes key slice based',
              'Per key ordering is a business requirement',
            ],
            [
              'Drain before moving the key',
              'Total ordering within the migrated aggregate',
              'Latency of the aggregate last message during the switch',
              'Low volume aggregates with rare spikes',
            ],
            [
              'Accept reordering and version',
              'Availability and migration simplicity',
              'Ordering, which moves to the consumer to resolve',
              'The consumer already discards stale versions by number',
            ],
            [
              'Pause the aggregate for seconds',
              'Ordering, at a predictable and bounded cost',
              'Availability of that aggregate during the pause',
              'Few critical aggregates and a tolerable pause',
            ],
            [
              'Ignore the problem',
              'Nothing',
              'Consistency, silently and hard to detect',
              'Never, and it is what happens most in practice',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The first row is the one most worth knowing, because it makes percentage migration compatible with ordering. Instead of sampling five percent of the messages, you use a stable hash of the aggregate identifier and migrate the whole slice at once: every message of order 4711 goes to the new broker, or none does. That preserves per key ordering by construction, and the percentage stays controllable, only in slice steps rather than message by message.',
        },
        {
          type: 'code',
          value: `// Stable key slice routing: preserves per aggregate ordering while both
// brokers coexist.
import { createHash } from 'node:crypto';

const TOTAL_SLICES = 128;

const sliceOf = (aggregateKey) => {
  const digest = createHash('sha256').update(aggregateKey).digest();
  return digest.readUInt32BE(0) % TOTAL_SLICES;
};

// Comes from dynamic configuration, not from an environment variable: the
// change must take effect without redeploying so reversal is immediate.
const migratedSlices = () => configuration.get('queue.migratedSlices', 0);

async function publish(message) {
  const slice = sliceOf(message.aggregateId);
  const target = slice < migratedSlices() ? newBroker : oldBroker;

  await target.publish({
    ...message,
    // Route stamp in the payload itself: without it there is no way to
    // reconstruct afterwards which path each message took.
    route: { broker: target.name, slice, migratedAt: Date.now() },
  });
}

// Step increase: 0 -> 6 -> 32 -> 64 -> 128 slices.
// Each step only advances after a full observation window, and stepping
// back causes no reordering because the whole slice moves back.`,
        },
        {
          type: 'paragraph',
          value:
            'Reversal in this design has a property random migration lacks: reducing the number of migrated slices returns the whole aggregate to the old broker, and because all of its messages were on the same side, there is no interleaving between the two. The only message that can end up out of order is the one in flight at the exact instant of the step change, and that is solved by draining the slice before moving it, or by accepting that the consumer discards stale versions by version number.',
        },
      ],
    },
    {
      title: 'The seven stage sequence with traffic on',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The sequence below works for both cases, producer under your control or not, and every stage has an objective exit criterion. The rule that holds the method together is simple: no stage advances by the clock, all of them advance by an indicator.',
        },
        {
          type: 'ordered',
          items: [
            'Make the consumer idempotent before touching any broker. An idempotency key derived from the payload, not from the broker identifier, and a check that reprocessing the same message twice does not change the outcome. Exit criterion: a test that republishes the same message five times and confirms a single effect.',
            'Bring up the new broker and connect the consumer to it with no traffic. Authentication, format, in flight limit, acknowledgement, dead letter handling. Exit criterion: consumer connected for twenty-four hours with zero messages read and zero connection errors.',
            'Publish synthetic traffic to the new broker. Marked messages that travel the full path and produce a verifiable effect in a controlled environment. Exit criterion: end to end latency measured and comparable to the old broker, and retry behavior matching expectations.',
            'Migrate the first slice of keys, somewhere between three and five percent. Observe for at least one window containing a traffic peak, not just thirty quiet minutes. Exit criterion: error rate, latency and applied duplicate count equal across the two routes.',
            'Increase in steps with observation between them. Twenty-five, fifty, one hundred percent of the slices. Each step must go through a full operating cycle, including an application deploy, to prove reconnection works against the new broker.',
            'Drain the old queue and confirm the drain by the right criterion. Zero depth for longer than the largest retry backoff plus the visibility timeout. Also check the old dead letter queue, which tends to be forgotten and holds exactly the messages that most need handling.',
            'Disconnect the consumer from the old broker and only then decommission. Keep the old broker running, with no traffic, for at least one full retention cycle. It is the way back and the audit record of the transition period, and shutting it down early trades a small saving for a large risk.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Stage five carries a detail usually discovered late: including an application deploy inside each step. Broker reconnection is one of the least exercised behaviors of a service, and a reconnection setting that does not work only shows up when the process restarts. Finding that at five percent of traffic is a ticket, finding it at one hundred percent is an incident with messages stuck in a queue.',
        },
        {
          type: 'paragraph',
          value:
            'When the producer is not yours, stages four and five change shape but not logic. The queue bridge takes over the routing role: it reads from the old broker and publishes to the new one, and the percentage is applied inside it by the same slice function. The bridge must acknowledge on the old broker only after receiving the publish acknowledgement on the new one, in that order, because the reverse order loses messages on any failure between the two operations, and it needs the same idempotency key, because acknowledging after publishing means a failure in between republishes the message.',
        },
      ],
    },
    {
      title: 'The three indicators that authorize shutting down the old queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Shutdown is the decision most often taken on a feeling, and the one with the most permanent consequence, because after it there is no way back. The three indicators below turn that decision into a check.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it measures', 'Criterion for shutting down', 'What it catches'],
          rows: [
            [
              'Sustained residual depth',
              'Messages in the old queue, dead letter queue included',
              'Zero for longer than the largest backoff plus the visibility timeout',
              'A message in a retry cycle that resurfaces later',
            ],
            [
              'Producer coverage',
              'Distinct producers that published to the old broker in the window',
              'Zero for a full business cycle, monthly routines included',
              'A rare scheduled job nobody remembered to migrate',
            ],
            [
              'Applied duplicates',
              'Effects blocked by the idempotency key, broken down by source',
              'Stable and explainable, with no growth during coexistence',
              'A bridge or dual producer publishing the same event twice',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second indicator prevents the most post migration incidents. Real systems have producers that publish once a month, at closing, and that nobody inventoried because they never show up on the daily traffic chart. Measuring distinct producers per window, rather than message volume, reveals those cases: a producer that published a single message in thirty days weighs the same as one that published a million, and it is exactly the one that breaks after shutdown.',
        },
        {
          type: 'paragraph',
          value:
            'The third indicator has to be read by source, not by total. An absolute count of blocked duplicates says nothing on its own, because a legitimate retry produces a blocked duplicate and that is the system working. What matters is the breakdown by route: if duplicates coming from the bridge grow while those from normal consumption stay flat, the bridge is republishing, and that is the defect that produces duplicate charges even with an idempotent consumer, when the deduplication window is shorter than the interval between the two publishes.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is it worth keeping the queue bridge after the migration, as a permanent compatibility layer?',
      answer:
        'Almost never, and the reason is that the bridge carries a cost that only shows up months later. While it exists, the system has two brokers in production, two retention settings, two dead letter policies, two sets of credentials to rotate and two places to look for a message during an incident. None of that is dramatic on its own, but together it means every investigation starts with the question of which path the message came through, and that question costs minutes in every incident for the rest of the system life. There is one legitimate case, which is the external producer you do not control and that has its own migration schedule, typically a partner under contract. In that case the bridge stops being transitional and becomes a production component, and the practical consequence is that it must be treated as one: its own lag and error alerts, automated tests, a defined owner, documented behavior under partial failure and periodic review. The pattern that goes wrong is the in between one, where the bridge stays on out of convenience with no owner and no alerting, and somebody discovers six months later that it stopped three weeks ago when the partner complains about missing data. If the decision is to keep it, write the review date alongside the decision, because a bridge with no end date is never removed.',
    },
    {
      question: 'How do you test the migration beforehand if the staging environment has neither the volume nor the real production producers?',
      answer:
        'Staging will not reproduce the volume, and insisting on that usually consumes more time than the whole migration. What it does reproduce well is behavior, and behavior is where most migrations fail: message format, authentication, acknowledgement semantics, retry policy, dead letter handling and reconnection after a drop. Testing those six in staging already removes most incidents, and one specific test is worth more than all the others: kill the new broker mid consumption and verify no message was lost or duplicated. It is easy to run and fails with surprising frequency. For what staging does not cover, two techniques beat trying to simulate volume. The first is mirroring real traffic: copying production messages to the new broker and processing them with a consumer that applies effects in a separate environment. That exercises the real format, including the field only one producer sends and nobody documented. The second is the slice migration itself, which is the production test with damage bounded by construction: five percent of the keys travel the full path with real effects, and if something breaks, the blast radius is known in advance and reversal is a configuration change. Step migration is not an alternative to testing, it is the form of testing production accepts.',
    },
    {
      question: 'Does message ordering really matter in my case, or am I complicating a migration that could be simple?',
      answer:
        'In most systems global ordering does not matter and per key ordering matters in a few specific flows, so it is worth measuring rather than assuming either extreme. The thought experiment that settles it quickly is this: for each message type, ask what happens if two messages of the same aggregate are applied in reverse order. In a profile update that overwrites a field, the result is old data beating new data, which is a real silent failure. In a counter increment, ordering changes nothing. In a state machine with declared valid transitions, the out of order message is rejected and becomes a retry, which is correct behavior and not loss. That separation usually shows ordering matters in two or three flows, not all of them, and it changes the strategy: migrate those flows by key slice and the rest by simple percentage, instead of subjecting the whole system to the most expensive constraint. It is worth noting that the most durable protection is not ordering but a version number in the payload, with the consumer discarding any application of a version lower than the one already applied. A system with that can migrate without worrying about ordering across brokers, because reordering stops producing wrong effects and starts producing only discards. If the system has no version number, adding one before the migration is usually cheaper than preserving ordering during it, and the benefit remains after the migration ends.',
    },
  ],
  conclusion: {
    title: 'Swapping the broker means migrating guarantees, not connection strings',
    description:
      'A queue swap rarely fails because of the new broker: it fails because the delivery guarantee changed without anyone noticing, because per key ordering broke during coexistence, or because the old queue was shut down before the last retrying message resurfaced. I can review the guarantees your queue delivers today and define the inventory of delivery, ordering, durability and retention, the idempotency key that survives the coexistence of both brokers, the key slice routing that preserves ordering across the steps, the migration sequence reversible at any point and the indicators that authorize shutting down the old queue.',
    cta: 'Talk about the queue migration in my system',
  },
  related: [
    {
      label: 'The dead letter queue nobody reads: when a discarded message becomes a fix',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'The wrong partition key: the queue that stalls because one customer takes it all',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Database migration without a window: expand, migrate, contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
  ],
};

const es = {
  intro:
    'La migración estaba agendada para las dos de la madrugada de un sábado, con treinta minutos de ventana y un plan de tres pasos que cabía en una nota: para el productor, espera a que la cola se vacíe, apunta todo al broker nuevo. A las dos y dieciocho la cola antigua todavía tenía cuatro mil mensajes que no se vaciaban porque un consumidor lento seguía reprocesando, y a las dos y treinta y uno alguien apuntó el productor de todos modos. El lunes, finanzas encontró diecinueve cobros duplicados y siete pedidos que nunca se movieron. Este artículo muestra por qué la ventana de mantenimiento es la estrategia más arriesgada disponible, qué cuatro garantías hay que inventariar antes de elegir el método, cómo la fase de consumo doble elimina la pérdida sin crear duplicidad, por qué el orden entre mensajes solo sobrevive si aceptas romper una de dos propiedades, qué secuencia de siete etapas migra con el tráfico encendido y revierte en cualquier punto, y qué tres indicadores dicen que la cola antigua puede apagarse de verdad.',
  sections: [
    {
      title: 'Por qué la ventana de mantenimiento es el plan más arriesgado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El plan de parar el productor, drenar la cola y reencender apuntando al broker nuevo parece el más seguro porque elimina el período en que las dos colas existen a la vez. En la práctica concentra todo el riesgo en un intervalo corto, sin ensayo y sin camino de vuelta, y depende de una premisa que casi nunca se sostiene: que la cola drena en tiempo previsible.',
        },
        {
          type: 'paragraph',
          value:
            'La cola no drena en tiempo previsible porque el tiempo de drenaje no depende solo de lo que hay en ella. Depende del consumidor más lento, de los mensajes que entran en reintento y vuelven al final, del lote que falla y se reprocesa entero, y del mensaje envenenado que ocupa una partición indefinidamente. Una cola con cuatro mil mensajes y un rendimiento de trescientos por segundo no tarda trece segundos en vaciarse si el diez por ciento está en ciclo de reintento con espera exponencial de hasta cinco minutos.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo problema es que la ventana no tiene reversión barata. Una vez que el productor apunta al broker nuevo y un consumidor confirma el primer mensaje ahí, volver atrás significa tener dos fuentes de verdad parciales, y ningún equipo toma bien esa decisión a las tres de la madrugada. Migrar con el tráfico encendido invierte esa relación: cada etapa es pequeña, observable y reversible, y la decisión difícil nunca ocurre bajo presión de reloj.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cómo funciona', 'Riesgo principal', 'Reversión'],
          rows: [
            [
              'Ventana de mantenimiento',
              'Para el productor, drena, apunta al broker nuevo',
              'El drenaje no termina dentro de la ventana y alguien corta igual',
              'Cara, exige reprocesar o conciliar a mano',
            ],
            [
              'Consumo doble',
              'El consumidor lee de los dos brokers, el productor migra después',
              'Duplicidad si el consumidor no es idempotente',
              'Inmediata, basta con dejar de leer del broker nuevo',
            ],
            [
              'Puente entre colas',
              'Un proceso copia mensajes del broker antiguo al nuevo',
              'El puente se vuelve punto único y puede duplicar en falla parcial',
              'Inmediata, basta con apagar el puente',
            ],
            [
              'Producción doble',
              'El productor publica en los dos, el consumidor migra después',
              'Divergencia cuando una publicación falla y la otra no',
              'Inmediata, pero exige decidir qué hacer con lo ya publicado',
            ],
            [
              'Enrutamiento por porcentaje',
              'Una fracción del tráfico nuevo va al broker nuevo',
              'El orden entre mensajes del mismo agregado se rompe entre brokers',
              'Inmediata, basta con poner el porcentaje en cero',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos filas del medio resuelven la mayoría de los casos, y la elección entre ellas depende de a quién controlas. Si el productor es código tuyo, la producción doble y el enrutamiento por porcentaje están disponibles. Si el productor es un socio externo, un dispositivo en campo o un servicio heredado que nadie quiere tocar, el puente entre colas es el único camino, y hay que tratarlo con el cuidado de un componente de producción, no como un script temporal.',
        },
      ],
    },
    {
      title: 'Las cuatro garantías que hay que inventariar antes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Migrar el broker es migrar las garantías que el sistema asumía sin escribirlas en ningún lado. Antes de elegir el método, cada una de las cuatro necesita una respuesta explícita, porque el método correcto cambia según la respuesta.',
        },
        {
          type: 'ordered',
          items: [
            'Entrega. El broker antiguo garantizaba al menos una entrega, como máximo una, o exactamente una dentro de un alcance limitado. Si el consumidor se escribió asumiendo como máximo una y el broker nuevo entrega al menos una, cada reintento se vuelve efecto duplicado. Ese es el origen de los diecinueve cobros duplicados del ejemplo de apertura.',
            'Orden. El orden era global, por partición, por clave, o no existía. El orden global es el más caro de preservar en una migración y el menos frecuentemente necesario de verdad. El orden por clave es el que el negocio casi siempre necesita y el que se rompe en silencio cuando dos colas coexisten.',
            'Durabilidad y confirmación. Cuando el productor recibe la confirmación de publicación, el mensaje ya está en disco y replicado, o solo aceptado en memoria. Brokers distintos tienen valores por defecto distintos aquí, y una migración que cambia una configuración conservadora por una permisiva pierde mensajes solo en falla de nodo, que es justamente el caso que nadie prueba.',
            'Retención y reprocesamiento. El mensaje desaparece al confirmarse, o queda retenido un período y puede releerse desde el inicio. Esa diferencia define si la reversión consiste en reapuntar un cursor o en reconstruir estado desde otra fuente, y es lo que separa una migración reversible de una de una sola vía.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La garantía de entrega merece una nota práctica. Ningún broker entrega exactamente una vez de punta a punta ante una falla de red, porque el productor que no recibe la confirmación no sabe si la publicación ocurrió. Lo que existe es deduplicación dentro de una ventana del lado del broker, e idempotencia del lado del consumidor. La migración es el momento en que esa diferencia deja de ser teórica: durante la coexistencia de los dos brokers, el mismo mensaje puede llegar por dos caminos, y la única defensa que funciona en todos los casos es la clave de idempotencia del lado de quien aplica el efecto.',
        },
        {
          type: 'code',
          value: `// Consumidor idempotente por clave de negocio, no por identificador
// generado por el broker: durante la migracion el mismo mensaje llega
// con identificadores distintos por los dos caminos.
const VENTANA_DEDUP_SEGUNDOS = 60 * 60 * 24 * 7;

async function procesarMensaje(mensaje) {
  // La clave viene del payload y es estable entre brokers. Usar el offset,
  // el messageId del broker o el deliveryTag se rompe en la coexistencia.
  const clave = \`efecto:\${mensaje.tipo}:\${mensaje.agregadoId}:\${mensaje.eventoId}\`;

  // SET con NX es la operacion atomica que decide quien procesa. Sin NX,
  // dos consumidores leen "no existe" a la vez y ambos aplican.
  const primero = await redis.set(clave, 'procesando', {
    NX: true,
    EX: VENTANA_DEDUP_SEGUNDOS,
  });

  if (!primero) {
    const estado = await redis.get(clave);
    if (estado === 'completado') return { estado: 'duplicado_ignorado' };
    // Otro consumidor lo tomo y aun no termina: lo devuelve a reintento en
    // vez de confirmar, si no el mensaje desaparece cuando el otro falla.
    throw new ErrorReintentarLuego('efecto_en_curso');
  }

  try {
    await aplicarEfecto(mensaje);
    await redis.set(clave, 'completado', { EX: VENTANA_DEDUP_SEGUNDOS });
    return { estado: 'procesado' };
  } catch (error) {
    // Libera la clave para que el reintento pueda reprocesar.
    await redis.del(clave);
    throw error;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'Lo que más falla en implementaciones reales es el bloque de error. Sin liberar la clave, una falla transitoria en el efecto deja la marca de procesamiento en su lugar y el reintento se descarta como duplicado, lo que convierte un error recuperable en mensaje perdido. Es el modo de falla más difícil de detectar después, porque no genera error ni alerta: el mensaje simplemente no produjo efecto y nadie lo nota hasta la conciliación.',
        },
      ],
    },
    {
      title: 'Consumo doble: la fase que elimina la pérdida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden correcto de migración es contraintuitivo: el consumidor migra primero, el productor migra después. Quien empieza apuntando el productor al broker nuevo crea de inmediato una ventana en la que hay mensajes del lado nuevo sin nadie que los lea, y mensajes del lado antiguo que todavía hay que drenar. Quien empieza por el consumidor crea una ventana en la que sobra capacidad de lectura de los dos lados, lo cual es inofensivo.',
        },
        {
          type: 'diagram',
          value: `Fase 1 - solo el broker antiguo
  productor --> [COLA ANTIGUA] --> consumidor

Fase 2 - consumo doble (el consumidor lee de las dos, solo la antigua tiene trafico)
  productor --> [COLA ANTIGUA] --\\
                                  >--> consumidor (idempotente)
               [COLA NUEVA]    --/     ningun mensaje llega por la nueva aun
  punto de control: consumidor conectado, 0 mensajes leidos de la nueva

Fase 3 - produccion porcentual (5% -> 25% -> 50% -> 100%)
  productor --5%--> [COLA NUEVA]   --\\
            -95%--> [COLA ANTIGUA] --/--> consumidor
  punto de control: misma tasa de error de los dos lados,
  latencia de punta a punta comparable, 0 duplicados aplicados

Fase 4 - drenaje de la cola antigua (produccion 100% en la nueva)
  productor -100%-> [COLA NUEVA]   --\\
                                      >--> consumidor
               [COLA ANTIGUA] ------/     drenando el residual
  punto de control: profundidad de la antigua en 0 por
  mas tiempo que la espera maxima del reintento

Fase 5 - apagar
  productor --> [COLA NUEVA] --> consumidor
  la cola antigua sale del consumidor solo tras confirmar la fase 4`,
        },
        {
          type: 'paragraph',
          value:
            'La fase dos es la que da seguridad al resto y la que más gente se salta. No mueve tráfico alguno: sirve para probar que el consumidor logra conectarse al broker nuevo, autenticarse, deserializar el formato de mensaje, respetar el límite de mensajes en vuelo y confirmar correctamente. Todos esos son puntos de falla reales en un cambio de broker, y descubrirlos con cero mensajes en juego cuesta una tarde, mientras que descubrirlos con el cincuenta por ciento del tráfico cuesta un incidente.',
        },
        {
          type: 'paragraph',
          value:
            'La fase cuatro tiene una trampa de tiempo. Que la cola antigua llegue a cero una vez no significa que se vació: los mensajes en ciclo de reintento reaparecen tras la espera, y si la espera exponencial llega a quince minutos, la cola puede estar en cero diez minutos y volver a tener contenido. El criterio correcto es profundidad cero durante un período mayor que la mayor espera configurada, sumado al tiempo de visibilidad del mensaje, y no la primera lectura de cero en el panel.',
        },
      ],
    },
    {
      title: 'Orden entre mensajes: elegir qué propiedad romper',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Durante la coexistencia, mensajes del mismo agregado pueden estar en las dos colas a la vez, y no hay forma de ordenarlos entre sí sin coordinación externa. Esa es la restricción dura de migrar con el tráfico encendido, y no tiene solución gratuita: eliges qué propiedad romper durante la transición.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Qué preserva', 'Qué sacrifica', 'Cuándo usarlo'],
          rows: [
            [
              'Migrar por clave de agregado',
              'El orden dentro de cada agregado, siempre',
              'La migración deja de ser porcentual y pasa a ser por porción de clave',
              'El orden por clave es requisito de negocio',
            ],
            [
              'Drenar antes de mover la clave',
              'Orden total dentro del agregado migrado',
              'Latencia del último mensaje del agregado durante el cambio',
              'Agregados de bajo volumen y picos raros',
            ],
            [
              'Aceptar el reordenamiento y versionar',
              'Disponibilidad y simplicidad de la migración',
              'El orden, que pasa a resolverlo el consumidor',
              'El consumidor ya descarta versiones viejas por número',
            ],
            [
              'Pausar el agregado por segundos',
              'El orden, con costo previsible y acotado',
              'Disponibilidad de ese agregado durante la pausa',
              'Pocos agregados críticos y una pausa tolerable',
            ],
            [
              'Ignorar el problema',
              'Nada',
              'Consistencia, de forma silenciosa y difícil de detectar',
              'Nunca, y es lo que más pasa en la práctica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La primera fila es la que más vale conocer, porque hace la migración porcentual compatible con el orden. En vez de sortear el cinco por ciento de los mensajes, usas un hash estable del identificador del agregado y migras la porción entera de una vez: todos los mensajes del pedido 4711 van al broker nuevo, o ninguno va. Eso preserva el orden por clave por construcción, y el porcentaje sigue siendo controlable, solo que en escalones de porción en lugar de mensaje a mensaje.',
        },
        {
          type: 'code',
          value: `// Enrutamiento por porcion estable de clave: preserva el orden por
// agregado mientras los dos brokers coexisten.
import { createHash } from 'node:crypto';

const TOTAL_PORCIONES = 128;

const porcionDe = (claveAgregado) => {
  const digest = createHash('sha256').update(claveAgregado).digest();
  return digest.readUInt32BE(0) % TOTAL_PORCIONES;
};

// Viene de configuracion dinamica, no de variable de entorno: el cambio
// debe valer sin redespliegue para que la reversion sea inmediata.
const porcionesMigradas = () => configuracion.get('cola.porcionesMigradas', 0);

async function publicar(mensaje) {
  const porcion = porcionDe(mensaje.agregadoId);
  const destino = porcion < porcionesMigradas() ? brokerNuevo : brokerAntiguo;

  await destino.publicar({
    ...mensaje,
    // Sello de ruta en el propio payload: sin el es imposible reconstruir
    // despues por donde paso cada mensaje.
    ruta: { broker: destino.nombre, porcion, migradoEn: Date.now() },
  });
}

// Aumento por escalon: 0 -> 6 -> 32 -> 64 -> 128 porciones.
// Cada escalon solo avanza tras una ventana de observacion completa, y
// retroceder no genera reordenamiento porque vuelve la porcion entera.`,
        },
        {
          type: 'paragraph',
          value:
            'La reversión en este diseño tiene una propiedad que la migración aleatoria no tiene: reducir el número de porciones migradas devuelve el agregado entero al broker antiguo, y como todos sus mensajes estaban del mismo lado, no hay intercalado entre los dos. El único mensaje que puede quedar fuera de orden es el que estaba en vuelo en el instante exacto del cambio de escalón, y eso se resuelve drenando la porción antes de moverla, o aceptando que el consumidor descarte versiones viejas por número de versión.',
        },
      ],
    },
    {
      title: 'La secuencia de siete etapas con el tráfico encendido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La secuencia siguiente funciona para los dos casos, con el productor bajo tu control o no, y cada etapa tiene un criterio de salida objetivo. La regla que sostiene el método es simple: ninguna etapa avanza por horario, todas avanzan por indicador.',
        },
        {
          type: 'ordered',
          items: [
            'Haz el consumidor idempotente antes de tocar cualquier broker. Clave de idempotencia derivada del payload, no del identificador del broker, y verificación de que reprocesar el mismo mensaje dos veces no cambia el resultado. Criterio de salida: una prueba que republica el mismo mensaje cinco veces y confirma un único efecto.',
            'Levanta el broker nuevo y conecta el consumidor sin tráfico. Autenticación, formato, límite de mensajes en vuelo, confirmación, manejo de la cola muerta. Criterio de salida: consumidor conectado durante veinticuatro horas con cero mensajes leídos y cero errores de conexión.',
            'Publica tráfico sintético en el broker nuevo. Mensajes marcados que recorren el camino completo y producen un efecto verificable en entorno controlado. Criterio de salida: latencia de punta a punta medida y comparable a la del broker antiguo, y comportamiento de reintento igual al esperado.',
            'Migra la primera porción de claves, entre un tres y un cinco por ciento. Observa durante al menos una ventana que contenga un pico de tráfico, no solo treinta minutos de horario tranquilo. Criterio de salida: tasa de error, latencia y conteo de duplicados aplicados iguales entre las dos rutas.',
            'Aumenta por escalones con observación entre ellos. Veinticinco, cincuenta, cien por ciento de las porciones. Cada escalón tiene que atravesar un ciclo completo de operación, incluido un despliegue de la aplicación, para probar que la reconexión funciona contra el broker nuevo.',
            'Drena la cola antigua y confirma el drenaje con el criterio correcto. Profundidad cero durante más tiempo que la mayor espera de reintento sumada al tiempo de visibilidad. Revisa también la cola muerta antigua, que suele olvidarse y contiene justamente los mensajes que más necesitan tratamiento.',
            'Desconecta el consumidor del broker antiguo y solo entonces desaprovisiona. Mantén el broker antiguo encendido, sin tráfico, al menos durante un ciclo completo de retención. Es el camino de vuelta y el registro de auditoría del período de transición, y apagarlo temprano cambia un ahorro pequeño por un riesgo grande.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La etapa cinco tiene un detalle que suele descubrirse tarde: incluir un despliegue de la aplicación dentro de cada escalón. La reconexión al broker es uno de los comportamientos menos ejercitados de un servicio, y una configuración de reconexión que no funciona solo aparece cuando el proceso reinicia. Descubrirlo con el cinco por ciento del tráfico es una tarea, descubrirlo con el cien por ciento es un incidente con mensajes detenidos en cola.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando el productor no es tuyo, las etapas cuatro y cinco cambian de forma pero no de lógica. El puente entre colas asume el papel del enrutamiento: lee del broker antiguo y publica en el nuevo, y el porcentaje pasa a aplicarse dentro de él con la misma función de porción. El puente tiene que confirmar en el broker antiguo solo después de recibir la confirmación de publicación en el nuevo, en ese orden, porque el orden inverso pierde mensajes ante cualquier falla entre las dos operaciones, y necesita la misma clave de idempotencia, porque confirmar después de publicar significa que una falla en el medio republica el mensaje.',
        },
      ],
    },
    {
      title: 'Los tres indicadores que autorizan apagar la cola antigua',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El apagado es la decisión que más suele tomarse por sensación, y la que tiene la consecuencia más permanente, porque después de ella no hay camino de vuelta. Los tres indicadores siguientes convierten esa decisión en una verificación.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué mide', 'Criterio para apagar', 'Qué detecta'],
          rows: [
            [
              'Profundidad residual sostenida',
              'Mensajes en la cola antigua, cola muerta incluida',
              'Cero durante más tiempo que la mayor espera más la visibilidad',
              'Mensaje en ciclo de reintento que resurge después',
            ],
            [
              'Cobertura de productores',
              'Productores distintos que publicaron en el broker antiguo en la ventana',
              'Cero durante un ciclo de negocio completo, rutinas mensuales incluidas',
              'Trabajo programado raro que nadie recordó migrar',
            ],
            [
              'Duplicados aplicados',
              'Efectos bloqueados por la clave de idempotencia, por origen',
              'Estable y explicable, sin crecimiento durante la coexistencia',
              'Puente o productor doble publicando el mismo evento dos veces',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El segundo indicador es el que más incidentes posmigración evita. Los sistemas reales tienen productores que publican una vez al mes, en el cierre, y que nadie inventarió porque no aparecen en el gráfico de tráfico del día. Medir productores distintos por ventana, en vez de volumen de mensajes, revela esos casos: un productor que publicó un solo mensaje en treinta días pesa lo mismo que uno que publicó un millón, y es justamente el que se rompe después del apagado.',
        },
        {
          type: 'paragraph',
          value:
            'El tercer indicador hay que leerlo por origen, no por total. Un número absoluto de duplicados bloqueados no dice nada por sí solo, porque un reintento legítimo produce un duplicado bloqueado y eso es el sistema funcionando. Lo que importa es el desglose por ruta: si los duplicados que vienen del puente crecen mientras los del consumo normal se mantienen estables, el puente está republicando, y ese es el defecto que produce cobros duplicados incluso con un consumidor idempotente, cuando la ventana de deduplicación es menor que el intervalo entre las dos publicaciones.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Vale la pena mantener el puente entre colas después de la migración, como capa de compatibilidad permanente?',
      answer:
        'Casi nunca, y el motivo es que el puente tiene un costo que solo aparece meses después. Mientras existe, el sistema tiene dos brokers en producción, dos configuraciones de retención, dos políticas de cola muerta, dos conjuntos de credenciales para rotar y dos lugares donde buscar un mensaje durante un incidente. Nada de eso es dramático por separado, pero junto significa que toda investigación empieza con la pregunta de por qué camino llegó el mensaje, y esa pregunta cuesta minutos en cada incidente por el resto de la vida del sistema. Existe un caso legítimo, que es el productor externo que no controlas y que tiene su propio cronograma de migración, típicamente un socio con contrato. En ese caso el puente deja de ser transitorio y se vuelve componente de producción, y la consecuencia práctica es que hay que tratarlo como tal: alerta propia de atraso y de error, prueba automatizada, dueño definido, documentación del comportamiento en falla parcial y revisión periódica. El patrón que sale mal es el intermedio, en el que el puente queda encendido por conveniencia sin dueño y sin alerta, y alguien descubre seis meses después que se detuvo hace tres semanas cuando el socio reclama datos faltantes. Si la decisión es mantenerlo, escribe la fecha de revisión junto con la decisión, porque un puente sin fecha de fin nunca se elimina.',
    },
    {
      question: '¿Cómo probar la migración antes de hacerla, si el entorno de homologación no tiene ni el volumen ni los productores reales de producción?',
      answer:
        'Homologación no va a reproducir el volumen, e insistir en eso suele consumir más tiempo que la migración entera. Lo que sí reproduce bien es el comportamiento, y el comportamiento es donde falla la mayoría de las migraciones: formato de mensaje, autenticación, semántica de confirmación, política de reintento, manejo de cola muerta y reconexión tras una caída. Probar esas seis cosas en homologación ya elimina la mayor parte de los incidentes, y una prueba específica vale más que todas las demás: tumbar el broker nuevo en medio del consumo y verificar que ningún mensaje se perdió ni se duplicó. Es fácil de ejecutar y falla con una frecuencia sorprendente. Para lo que homologación no cubre, hay dos técnicas mejores que intentar simular volumen. La primera es el espejado de tráfico real: copiar mensajes de producción al broker nuevo y procesarlos con un consumidor que aplica efectos en un entorno separado. Eso ejercita el formato real, incluido ese campo que solo un productor envía y que nadie documentó. La segunda es la propia migración por porción, que es la prueba en producción con daño acotado por construcción: el cinco por ciento de las claves atraviesa el camino completo con efecto real, y si algo se rompe, el alcance se conoce de antemano y la reversión es un cambio de configuración. La migración por escalones no es una alternativa a la prueba, es la forma de prueba que producción acepta.',
    },
    {
      question: '¿El orden de los mensajes realmente importa en mi caso, o estoy complicando una migración que podría ser simple?',
      answer:
        'En la mayoría de los sistemas el orden global no importa y el orden por clave importa en pocos flujos específicos, así que conviene medirlo en vez de asumir cualquiera de los extremos. La prueba mental que lo resuelve rápido es esta: para cada tipo de mensaje, pregunta qué pasa si dos mensajes del mismo agregado se aplican en orden inverso. En una actualización de datos que sobrescribe un campo, el resultado es que el dato viejo le gana al nuevo, lo que es una falla silenciosa y real. En un incremento de contador, el orden no cambia nada. En una máquina de estados con transiciones válidas declaradas, el mensaje fuera de orden se rechaza y se convierte en reintento, lo que es comportamiento correcto y no pérdida. Esa separación suele mostrar que el orden importa en dos o tres flujos, no en todos, y eso cambia la estrategia: migra esos flujos por porción de clave y el resto por porcentaje simple, en vez de someter todo el sistema a la restricción más cara. Vale registrar que la protección más duradera no es el orden sino el número de versión en el payload, con el consumidor descartando la aplicación de una versión menor que la ya aplicada. Quien tiene eso puede migrar sin preocuparse por el orden entre brokers, porque el reordenamiento deja de producir efectos equivocados y pasa a producir solo descartes. Si el sistema no tiene número de versión, agregarlo antes de la migración suele ser más barato que preservar el orden durante ella, y el beneficio permanece después de que la migración termina.',
    },
  ],
  conclusion: {
    title: 'Cambiar el broker es migrar garantías, no cadenas de conexión',
    description:
      'El cambio de cola rara vez falla por culpa del broker nuevo: falla porque la garantía de entrega cambió sin que nadie lo notara, porque el orden por clave se rompió durante la coexistencia, o porque la cola antigua se apagó antes de que reapareciera el último mensaje en reintento. Puedo revisar las garantías que tu cola entrega hoy y definir el inventario de entrega, orden, durabilidad y retención, la clave de idempotencia que sobrevive a la coexistencia de los dos brokers, el enrutamiento por porción de clave que preserva el orden durante los escalones, la secuencia de migración reversible en cualquier punto y los indicadores que autorizan apagar la cola antigua.',
    cta: 'Hablar sobre la migración de cola de mi sistema',
  },
  related: [
    {
      label: 'La cola muerta que nadie lee: cuándo el mensaje descartado se vuelve corrección',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Clave de particionamiento equivocada: la cola que se traba porque un cliente lo ocupa todo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Migración de base sin ventana: expandir, migrar, contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
  ],
};

export default { pt, en, es };
