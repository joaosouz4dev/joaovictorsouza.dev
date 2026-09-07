// Conteudo do artigo: por que a sessao pegajosa no balanceador cobra um custo
// escondido em escala, implantacao e recuperacao de incidente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O time subiu quatro instâncias novas às nove da manhã de uma segunda-feira de campanha, e às nove e vinte três delas estavam com dois por cento de CPU enquanto a quinta, a antiga, atendia noventa por cento do tráfego e devolvia erro. Ninguém errou a configuração de escala: o balanceador estava fazendo exatamente o que foi mandado a fazer, que é manter cada usuário grudado na instância que o atendeu primeiro. Este artigo mostra por que a sessão pegajosa transforma capacidade em número enganoso, quais quatro custos ela cobra e quando cada um aparece, por que o problema real quase nunca é o balanceador e sim o estado que ficou no processo, como migrar para estado externo sem derrubar sessão de usuário logado, qual configuração de afinidade sobrevive a um reinício de instância e quais três alertas mostram o desbalanceamento antes do cliente reclamar.',
  sections: [
    {
      title: 'O que a afinidade de sessão realmente promete e o que ela não promete',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A afinidade de sessão é um mecanismo simples: o balanceador escolhe uma instância na primeira requisição de um cliente e passa a mandar todas as requisições seguintes daquele cliente para a mesma instância. A implementação varia, mas o efeito é sempre o mesmo, e a promessa também: se o processo guardou algo na memória durante a primeira requisição, esse algo continua disponível na segunda. É isso, e só isso, que a afinidade entrega.',
        },
        {
          type: 'paragraph',
          value:
            'O que ela não entrega é a parte que quebra em produção. Ela não garante que a instância continue existindo, e num ambiente com escala automática, implantação contínua e verificação de saúde, a instância deixa de existir várias vezes por dia. Ela não garante que o cliente continue sendo reconhecido, porque a identificação depende de um cookie que o cliente pode não aceitar ou de um endereço de origem que muda quando o usuário troca de rede. E ela não garante distribuição, que é justamente o motivo pelo qual o balanceador existe.',
        },
        {
          type: 'paragraph',
          value:
            'A confusão mais cara nesse assunto é tratar afinidade como um ajuste de desempenho. Ela não é. Afinidade é uma restrição de roteamento adotada para compensar estado que ficou no lugar errado, e toda vez que ela é ligada por conveniência sem que ninguém escreva o motivo, o sistema ganha uma dependência invisível entre o cliente e um processo específico. A pergunta que separa uso legítimo de dívida é objetiva: se essa instância for reiniciada agora, o que o usuário perde. Se a resposta for nada, a afinidade está sobrando. Se for alguma coisa, o problema é o estado, não o roteamento.',
        },
        {
          type: 'table',
          columns: ['Mecanismo de afinidade', 'Como identifica o cliente', 'Onde quebra na prática', 'Sobrevive a reinício da instância'],
          rows: [
            [
              'Cookie emitido pelo balanceador',
              'Cookie próprio, opaco para a aplicação',
              'Cliente que bloqueia cookie, chamada de API sem navegador',
              'Não, o cliente é remanejado sem aviso',
            ],
            [
              'Cookie da aplicação usado como chave',
              'Valor de um cookie que a aplicação já define',
              'Renovação do cookie no login troca a instância no meio do fluxo',
              'Não, e ainda pode trocar sem que a instância caia',
            ],
            [
              'Hash do endereço de origem',
              'Endereço IP do cliente',
              'Rede móvel, saída NAT corporativa, proxy compartilhado',
              'Não, e distribui muito mal atrás de NAT',
            ],
            [
              'Hash consistente por chave de aplicação',
              'Identificador de usuário ou de tenant enviado na requisição',
              'Exige que a chave venha em toda requisição, inclusive nas anônimas',
              'Parcialmente, remaneja só a fatia da instância removida',
            ],
            [
              'Sem afinidade, estado externo',
              'Não precisa identificar, qualquer instância serve',
              'Custo de latência da leitura de estado a cada requisição',
              'Sim, é o único que sobrevive por construção',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha é a que costuma ser esquecida nas discussões, e é a mais útil quando existe uma razão legítima para manter localidade, como um cache local caro de aquecer. Hash consistente por chave de aplicação não amarra o usuário a uma instância pela ordem de chegada, e sim por uma função determinística: quando uma instância sai do conjunto, apenas a fatia dela é redistribuída, e as demais chaves continuam onde estavam. É a diferença entre remanejar cem por cento dos clientes de uma instância que caiu e remanejar exatamente os clientes que estavam nela.',
        },
      ],
    },
    {
      title: 'Os quatro custos, e o dia em que cada um aparece',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O custo da sessão pegajosa não é um só, e eles não chegam juntos. Cada um tem um gatilho próprio, e é por isso que a configuração parece inofensiva por meses antes de virar incidente. Separar os quatro ajuda a decidir o que é urgente e o que é dívida controlada.',
        },
        {
          type: 'ordered',
          items: [
            'Escala que não escala. A instância nova entra no conjunto sem carga porque as sessões existentes continuam presas onde estão. O alívio só chega conforme as sessões antigas expiram, o que num pico significa que a capacidade adicionada chega tarde demais para o evento que motivou a adição.',
            'Carga desigual permanente. Uma instância que ficou de fora do conjunto por dez minutos durante uma implantação volta vazia e permanece relativamente vazia por horas, porque só recebe clientes novos. O gráfico de CPU médio do serviço fica saudável enquanto uma instância específica satura.',
            'Implantação que derruba usuário. Ao encerrar uma instância, todo cliente preso a ela é remanejado de uma vez. Se havia estado em memória, esse estado se perde em bloco, e o sintoma é um pico de erro ou de logout concentrado no minuto exato da implantação, que é fácil confundir com defeito da versão nova.',
            'Recuperação mais lenta do incidente. Quando uma instância degrada mas ainda passa na verificação de saúde, os clientes presos a ela continuam sendo enviados para ela. O balanceador não tira ninguém de lá, porque a afinidade tem precedência sobre a distribuição, e o incidente fica restrito a uma parcela dos usuários por tempo indefinido.',
          ],
        },
        {
          type: 'diagram',
          value: `Segunda-feira de campanha, escala automatica com afinidade ligada

09h00  4 instancias, 12.000 sessoes ativas presas
       A[3000] B[3000] C[3000] D[3000]     CPU media 78%

09h05  escala automatica sobe 4 instancias novas
       A[3000] B[3000] C[3000] D[3000] E[0] F[0] G[0] H[0]
       CPU media do servico: 39%   <- metrica diz "resolvido"
       CPU de A,B,C,D:       78%   <- realidade nao mudou

09h20  sessoes novas comecam a cair nas instancias vazias
       A[2900] B[2950] C[2880] D[2910] E[120] F[130] G[110] H[125]
       CPU media 41%, A ainda em 76%, comeca a devolver erro

09h34  D falha na verificacao de saude e sai do conjunto
       2910 clientes remanejados de uma vez -> perdem estado em memoria
       pico de logout e de erro concentrado em um minuto

Sem afinidade, com estado externo:
09h05  8 instancias, qualquer requisicao em qualquer instancia
       CPU media 39% e CPU real por instancia 39%
       saida de uma instancia = 1/8 das requisicoes seguintes redistribuidas
       nenhum estado perdido, nenhum logout`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que mais engana nesse cenário é a linha da CPU média. Ela é matematicamente correta e operacionalmente inútil: com quatro instâncias em setenta e oito por cento e quatro em zero, a média é trinta e nove, e é esse número que o painel mostra em letra grande. O sinal que importa não é a média, é a dispersão entre instâncias, e ele quase nunca está no painel padrão.',
        },
      ],
    },
    {
      title: 'O estado que ficou no processo, que é o problema de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Desligar a afinidade sem antes tratar o estado troca um problema previsível por um imprevisível. Antes de mexer no balanceador, é preciso inventariar o que a aplicação guarda em memória entre requisições do mesmo cliente. Na prática esse inventário quase sempre cabe em cinco categorias, e cada uma tem um destino diferente.',
        },
        {
          type: 'table',
          columns: ['Estado na memória do processo', 'Exemplo comum', 'Destino correto', 'Custo da mudança'],
          rows: [
            [
              'Sessão de autenticação',
              'Mapa de identificador de sessão para usuário',
              'Armazenamento externo compartilhado ou token assinado',
              'Baixo, é o caso mais bem resolvido da lista',
            ],
            [
              'Carrinho ou formulário em várias etapas',
              'Rascunho do pedido acumulado entre telas',
              'Persistência por identificador estável, não por sessão',
              'Médio, exige decidir a chave e o tempo de expiração',
            ],
            [
              'Cache local de dados de referência',
              'Tabela de preços, catálogo, configuração de tenant',
              'Continua local, com invalidação por evento',
              'Baixo, não precisa de afinidade se for reconstituível',
            ],
            [
              'Conexão de longa duração',
              'WebSocket, streaming de resposta, upload em partes',
              'Continua na instância, com reconexão explícita no cliente',
              'Médio, exige tratar reconexão como caso normal',
            ],
            [
              'Trabalho em andamento não persistido',
              'Processamento iniciado numa requisição e lido na seguinte',
              'Fila com identificador de tarefa e consulta de status',
              'Alto, costuma exigir mudança de contrato da API',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas linhas que mudam a estratégia são a terceira e a quarta. Cache local de dados de referência não justifica afinidade: se ele é reconstituível a partir da origem, a instância nova apenas paga a primeira leitura mais cara, e a solução é aquecimento no início do processo, não roteamento fixo. Conexão de longa duração justifica localidade de verdade, mas não justifica cookie de afinidade: a conexão já está fisicamente presa àquela instância, e o que precisa ser resolvido é a reconexão do cliente, não a rota da próxima requisição HTTP.',
        },
        {
          type: 'code',
          value: `// Antes: sessao na memoria do processo. Funciona com afinidade ligada
// e some quando a instancia sai do conjunto.
const sessoes = new Map();

app.post('/login', async (req, res) => {
  const usuario = await autenticar(req.body);
  const id = crypto.randomUUID();
  sessoes.set(id, { usuarioId: usuario.id, criadaEm: Date.now() });
  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/perfil', (req, res) => {
  const sessao = sessoes.get(req.cookies.sid);
  if (!sessao) return res.status(401).json({ erro: 'sessao_invalida' });
  res.json({ usuarioId: sessao.usuarioId });
});

// Depois: sessao em armazenamento externo. Qualquer instancia atende,
// e a afinidade deixa de ser necessaria para este fluxo.
const TTL_SESSAO_SEGUNDOS = 60 * 60 * 8;

app.post('/login', async (req, res) => {
  const usuario = await autenticar(req.body);
  const id = crypto.randomUUID();

  await redis.set(
    \`sessao:\${id}\`,
    JSON.stringify({ usuarioId: usuario.id, criadaEm: Date.now(), versao: 2 }),
    { EX: TTL_SESSAO_SEGUNDOS },
  );

  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/perfil', async (req, res) => {
  const bruto = await redis.get(\`sessao:\${req.cookies.sid}\`);
  if (!bruto) return res.status(401).json({ erro: 'sessao_invalida' });

  const sessao = JSON.parse(bruto);
  // Renovacao deslizante: cada requisicao estende a sessao sem reescrever
  // o corpo, o que evita perder dado gravado por outra instancia.
  await redis.expire(\`sessao:\${req.cookies.sid}\`, TTL_SESSAO_SEGUNDOS);
  res.json({ usuarioId: sessao.usuarioId });
});`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto sutil na versão externa é a renovação com expiração em vez de reescrita do corpo. Quando duas requisições do mesmo usuário chegam em instâncias diferentes ao mesmo tempo, o que é exatamente o cenário que a afinidade escondia, reescrever o objeto inteiro faz a última escrita apagar o campo que a outra acabou de gravar. Estender o tempo de vida sem tocar no conteúdo elimina essa classe de perda sem precisar de bloqueio.',
        },
      ],
    },
    {
      title: 'Migrar sem derrubar quem está logado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migração precisa funcionar com usuários no meio de uma sessão, porque não existe janela em que ninguém esteja logado. A sequência abaixo mantém o sistema funcionando em todas as etapas e permite reverter em qualquer ponto sem perder sessão, que é a diferença entre uma migração planejada e uma troca torcida por sorte.',
        },
        {
          type: 'ordered',
          items: [
            'Escreva em ambos os lugares. A aplicação passa a gravar a sessão na memória e no armazenamento externo, e continua lendo apenas da memória. Nada muda para o usuário, e a afinidade continua ligada. Nesta etapa só se mede: taxa de erro de escrita externa e latência adicionada por requisição.',
            'Leia do externo com retorno para a memória. A leitura passa a consultar o armazenamento externo primeiro e, se não encontrar, cai na memória local. Sessões antigas continuam válidas e sessões novas já funcionam em qualquer instância. Essa é a etapa que precisa de mais tempo, porque ela dura o tempo de vida da sessão mais longa.',
            'Confirme que a memória local está vazia de leitura. O indicador é o contador de acertos no retorno para a memória: quando ele fica em zero por um período maior que o tempo de expiração da sessão, nenhuma sessão viva depende mais de instância específica.',
            'Desligue a afinidade no balanceador. Faça isso em um ambiente por vez e observe a dispersão de CPU entre instâncias, não a média. A distribuição deve ficar visivelmente mais uniforme em minutos, e a taxa de erro não deve mudar.',
            'Remova a escrita na memória e o código de retorno. Só depois de a afinidade estar desligada por tempo suficiente para cobrir uma implantação, um evento de escala e um reinício de instância. Antes disso, o código de retorno é o caminho de volta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro de sequência mais comum é desligar a afinidade no mesmo momento em que a leitura externa entra. As duas mudanças produzem sintomas parecidos, um logout inesperado pode vir de qualquer uma das duas, e a investigação perde o dia inteiro separando as causas. Separar as etapas por pelo menos uma janela de expiração de sessão faz o diagnóstico ser imediato caso algo apareça.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar o caso em que a resposta correta é manter a afinidade. Se o serviço mantém conexões de longa duração, o roteamento por chave de aplicação com hash consistente é preferível ao cookie do balanceador, porque ele degrada de forma proporcional: perder uma instância entre oito remaneja um oitavo das chaves, não a totalidade dos clientes daquela instância para uma escolha arbitrária. E se existe cache local caro de reconstruir, a afinidade compra desempenho de verdade, desde que o sistema continue correto quando ela falhar, o que significa tratar a ausência do cache como caminho normal e não como erro.',
        },
      ],
    },
    {
      title: 'Os alertas que mostram o desbalanceamento antes do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nenhuma métrica de média detecta esse problema, e é por isso que ele costuma ser descoberto pelo cliente. Os três alertas abaixo cobrem os três modos de falha e nenhum deles depende de instrumentação nova além do que já existe por instância.',
        },
        {
          type: 'table',
          columns: ['Alerta', 'O que mede', 'Limiar prático', 'Modo de falha que ele pega'],
          rows: [
            [
              'Dispersão de carga entre instâncias',
              'Razão entre a instância mais carregada e a mediana',
              'Acima de 1,8 por mais de dez minutos',
              'Escala que não alivia e instância que voltou vazia',
            ],
            [
              'Instância ociosa com serviço saturado',
              'Instância abaixo de dez por cento com serviço acima de setenta',
              'Qualquer ocorrência sustentada por cinco minutos',
              'Capacidade adicionada que não está sendo usada',
            ],
            [
              'Erro concentrado em uma instância',
              'Fração do erro total vinda de uma única instância',
              'Acima de 60 por cento com mais de três instâncias no conjunto',
              'Instância degradada que ainda passa na verificação de saúde',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro alerta é o que muda o desfecho do incidente, porque ele detecta a situação em que a afinidade impede a recuperação automática. Uma instância que responde à verificação de saúde mas erra nas requisições reais continua recebendo exatamente os mesmos clientes, e para eles o serviço está fora do ar mesmo com o painel geral verde. A ação associada a esse alerta deve ser remover a instância do conjunto, não reiniciá-la, porque reiniciar mantém a instância no conjunto e apenas repete o ciclo.',
        },
        {
          type: 'paragraph',
          value:
            'Há ainda uma verificação barata que vale como rotina e não como alerta: registrar, na resposta de saúde de cada instância, quantas sessões ela guarda na memória. Se o serviço está declaradamente sem estado, esse número tem que ser zero, e um valor diferente de zero denuncia a introdução acidental de estado em memória por um caminho que ninguém revisou. É a única forma de impedir que a afinidade volte a ser necessária depois de removida.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se a afinidade é o problema, por que o balanceador oferece esse recurso por padrão em quase toda plataforma?',
      answer:
        'Porque ela resolve um problema real e imediato num contexto específico, e o contexto em que ela foi criada ainda existe. Numa aplicação que guarda sessão em memória do processo, que é o comportamento padrão de vários frameworks até hoje, a afinidade é a diferença entre funcionar e não funcionar assim que a segunda instância entra no ar. Ela é o caminho de menor esforço para colocar em produção uma aplicação escrita para rodar em um servidor só, e nesse papel ela é legítima. O problema não é o recurso, é ele permanecer ligado depois que o motivo desapareceu, ou ser ligado sem que ninguém registre por quê. O padrão que se repete é este: alguém liga a afinidade para resolver um logout intermitente numa sexta-feira, o logout para, e a decisão nunca mais é revisitada. Dois anos depois a aplicação já move sessão para armazenamento externo, mas a afinidade continua ligada e ninguém sabe se pode desligar, porque desligar virou um risco não medido. A prática que evita isso é tratar afinidade como qualquer outra exceção operacional: registro escrito do motivo, data de revisão e um teste que prove que o sistema funciona sem ela. Se esse teste não existe, a afinidade não é uma escolha, é uma dependência.',
    },
    {
      question: 'Mover a sessão para um armazenamento externo não cria um ponto único de falha e um custo de latência em toda requisição?',
      answer:
        'Cria uma dependência nova, e vale tratá-la de frente em vez de aceitar a troca sem medir. Sobre latência, a leitura de sessão num armazenamento em memória na mesma zona custa tipicamente entre meio e dois milissegundos, e comparar esse número com zero é a comparação errada: o correto é comparar com o custo de uma implantação que desloga uma parcela dos usuários e com o custo de capacidade que não alivia num pico. Além disso, boa parte desse custo é eliminável, porque a sessão pode ser mantida num cache local de tempo curto, na ordem de cinco a trinta segundos, o que reduz drasticamente as leituras sem reintroduzir a dependência de instância, já que a ausência do cache continua sendo um caminho normal. Sobre disponibilidade, o ponto único existe e precisa das mesmas defesas de qualquer dependência crítica: réplica com promoção automática, tempo limite curto na leitura e um comportamento definido para a falha. O comportamento definido é o que mais importa e o que mais falta. Se o armazenamento de sessão fica indisponível, a decisão de negócio precisa estar escrita antes: derrubar todo mundo, ou aceitar token assinado com validade curta como caminho degradado, ou deixar navegação anônima seguir e bloquear apenas as ações que exigem identidade. Qualquer uma das três é defensável, e a única resposta ruim é descobrir qual é durante o incidente.',
    },
    {
      question: 'Como testar se o sistema realmente funciona sem afinidade, sem esperar o próximo incidente para descobrir?',
      answer:
        'O teste que dá a resposta é barato e não precisa de ambiente especial. Em homologação, com carga sintética representativa, force o roteamento aleatório por requisição em vez de por sessão e execute os fluxos que atravessam mais de uma requisição do mesmo usuário: login, checkout em várias etapas, upload, qualquer coisa que dependa de contexto acumulado. Qualquer estado que estivesse escondido na memória do processo aparece como erro imediato, e a taxa de erro sob roteamento aleatório é a medida direta de quanto o sistema depende de afinidade. Em produção existe uma versão mais forte e igualmente controlada, que é encerrar uma instância de propósito durante o horário de menor tráfego e medir três números: quantos usuários viram erro, quantos foram deslogados e quanto tempo levou para a carga voltar a se distribuir. Esses três números transformam uma discussão de opinião em dado, e costumam ser o argumento que destrava a migração, porque a quantidade de usuários afetados por um encerramento planejado é sempre maior do que a estimativa que as pessoas fazem de cabeça. O erro a evitar é fazer esse teste apenas uma vez: o valor está na repetição periódica, porque estado em memória volta a aparecer por caminhos novos a cada trimestre e o único jeito de saber é exercitando a falha antes que ela aconteça sozinha.',
    },
  ],
  conclusion: {
    title: 'Afinidade é uma dívida de arquitetura cobrada no pior dia possível',
    description:
      'A sessão pegajosa nunca falha no dia em que é configurada: ela falha na segunda-feira de campanha, no meio da implantação, no minuto em que uma instância degrada sem cair. Posso revisar como o seu tráfego é distribuído hoje e definir o inventário de estado em memória, a sequência de migração para estado externo sem derrubar usuário logado, o comportamento degradado quando o armazenamento de sessão falha, a escolha entre afinidade por cookie e hash consistente onde a localidade for legítima, e os alertas de dispersão que mostram o desbalanceamento antes do cliente.',
    cta: 'Falar sobre distribuição de carga e estado da minha aplicação',
  },
  related: [
    {
      label: 'Multi-região com escrita única: o que muda quando a latência vira decisão de produto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Chave de particionamento errada: a fila que trava porque um cliente sozinho ocupa tudo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The team brought up four new instances at nine in the morning on a campaign Monday, and by nine twenty three of them were sitting at two percent CPU while the fifth, the old one, served ninety percent of the traffic and returned errors. Nobody misconfigured autoscaling: the load balancer was doing exactly what it had been told to do, which is keep every user glued to the instance that served them first. This article shows why sticky sessions turn capacity into a misleading number, which four costs they charge and when each one shows up, why the real problem is almost never the balancer but the state left inside the process, how to migrate to external state without dropping logged in users, which affinity configuration survives an instance restart, and which three alerts surface the imbalance before the customer complains.',
  sections: [
    {
      title: 'What session affinity actually promises and what it does not',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Session affinity is a simple mechanism: the load balancer picks an instance on a client first request and from then on sends every subsequent request from that client to the same instance. Implementations vary, but the effect is always the same, and so is the promise: if the process stored something in memory during the first request, that something is still available on the second. That is what affinity delivers, and nothing more.',
        },
        {
          type: 'paragraph',
          value:
            'What it does not deliver is the part that breaks in production. It does not guarantee the instance will keep existing, and in an environment with autoscaling, continuous deployment and health checks, instances stop existing several times a day. It does not guarantee the client keeps being recognized, because identification depends on a cookie the client may refuse or a source address that changes when the user switches networks. And it does not guarantee distribution, which is precisely why the load balancer exists in the first place.',
        },
        {
          type: 'paragraph',
          value:
            'The most expensive confusion on this subject is treating affinity as a performance tweak. It is not. Affinity is a routing constraint adopted to compensate for state that ended up in the wrong place, and every time it is switched on for convenience without anyone writing down why, the system gains an invisible dependency between a client and a specific process. The question that separates legitimate use from debt is objective: if this instance is restarted right now, what does the user lose. If the answer is nothing, affinity is redundant. If it is something, the problem is the state, not the routing.',
        },
        {
          type: 'table',
          columns: ['Affinity mechanism', 'How it identifies the client', 'Where it breaks in practice', 'Survives an instance restart'],
          rows: [
            [
              'Cookie issued by the load balancer',
              'Its own cookie, opaque to the application',
              'Clients that block cookies, API calls without a browser',
              'No, the client is reassigned without warning',
            ],
            [
              'Application cookie used as the key',
              'The value of a cookie the application already sets',
              'Cookie rotation at login switches the instance mid flow',
              'No, and it can switch without the instance going down',
            ],
            [
              'Source address hash',
              'Client IP address',
              'Mobile networks, corporate NAT egress, shared proxies',
              'No, and it distributes very poorly behind NAT',
            ],
            [
              'Consistent hashing on an application key',
              'User or tenant identifier sent with the request',
              'Requires the key on every request, anonymous ones included',
              'Partially, only the removed instance share is reassigned',
            ],
            [
              'No affinity, external state',
              'No identification needed, any instance will do',
              'Latency cost of reading state on every request',
              'Yes, the only one that survives by construction',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row is usually left out of these discussions, and it is the most useful one when there is a legitimate reason to keep locality, such as a local cache that is expensive to warm up. Consistent hashing on an application key does not bind the user to an instance by arrival order, but by a deterministic function: when an instance leaves the pool, only its share is redistributed and the remaining keys stay where they were. That is the difference between reassigning one hundred percent of the clients of a failed instance and reassigning exactly the clients that were on it.',
        },
      ],
    },
    {
      title: 'The four costs, and the day each one shows up',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The cost of sticky sessions is not one cost, and they do not arrive together. Each has its own trigger, and that is why the configuration looks harmless for months before turning into an incident. Separating the four helps decide what is urgent and what is controlled debt.',
        },
        {
          type: 'ordered',
          items: [
            'Scaling that does not scale. The new instance joins the pool with no load because existing sessions stay pinned where they are. Relief only arrives as old sessions expire, which during a peak means the added capacity arrives too late for the event that motivated adding it.',
            'Permanent uneven load. An instance that was out of the pool for ten minutes during a deployment comes back empty and stays relatively empty for hours, because it only receives new clients. The service average CPU chart looks healthy while one specific instance saturates.',
            'Deployments that drop users. When an instance is terminated, every client pinned to it is reassigned at once. If there was in memory state, that state is lost in bulk, and the symptom is a spike of errors or logouts concentrated in the exact minute of the deployment, which is easy to mistake for a defect in the new version.',
            'Slower incident recovery. When an instance degrades but still passes the health check, clients pinned to it keep being sent to it. The balancer does not move anyone away, because affinity takes precedence over distribution, and the incident stays confined to a subset of users for an indefinite time.',
          ],
        },
        {
          type: 'diagram',
          value: `Campaign Monday, autoscaling with affinity enabled

09:00  4 instances, 12,000 active pinned sessions
       A[3000] B[3000] C[3000] D[3000]     average CPU 78%

09:05  autoscaling brings up 4 new instances
       A[3000] B[3000] C[3000] D[3000] E[0] F[0] G[0] H[0]
       service average CPU: 39%   <- the metric says "fixed"
       CPU of A,B,C,D:      78%   <- reality did not change

09:20  new sessions start landing on the empty instances
       A[2900] B[2950] C[2880] D[2910] E[120] F[130] G[110] H[125]
       average CPU 41%, A still at 76%, starts returning errors

09:34  D fails the health check and leaves the pool
       2910 clients reassigned at once -> in memory state lost
       logout and error spike concentrated in one minute

Without affinity, with external state:
09:05  8 instances, any request on any instance
       average CPU 39% and real per instance CPU 39%
       one instance leaving = 1/8 of following requests redistributed
       no state lost, no logouts`,
        },
        {
          type: 'paragraph',
          value:
            'The most deceiving detail in that scenario is the average CPU line. It is mathematically correct and operationally useless: with four instances at seventy eight percent and four at zero, the average is thirty nine, and that is the number the dashboard shows in large type. The signal that matters is not the average, it is the spread across instances, and it is almost never on the default dashboard.',
        },
      ],
    },
    {
      title: 'The state left inside the process, which is the real problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Turning affinity off without first dealing with state trades a predictable problem for an unpredictable one. Before touching the balancer you have to inventory what the application keeps in memory between requests from the same client. In practice that inventory almost always fits into five categories, and each has a different destination.',
        },
        {
          type: 'table',
          columns: ['State in process memory', 'Common example', 'Correct destination', 'Cost of the change'],
          rows: [
            [
              'Authentication session',
              'Map from session identifier to user',
              'Shared external store or signed token',
              'Low, the best solved case on this list',
            ],
            [
              'Cart or multi step form',
              'Order draft accumulated across screens',
              'Persistence keyed by a stable identifier, not by session',
              'Medium, requires deciding the key and the expiry',
            ],
            [
              'Local cache of reference data',
              'Price table, catalog, tenant configuration',
              'Stays local, with event based invalidation',
              'Low, needs no affinity if it is rebuildable',
            ],
            [
              'Long lived connection',
              'WebSocket, response streaming, multipart upload',
              'Stays on the instance, with explicit client reconnection',
              'Medium, requires treating reconnection as the normal case',
            ],
            [
              'Unpersisted work in progress',
              'Processing started in one request and read in the next',
              'Queue with a task identifier and a status endpoint',
              'High, usually requires an API contract change',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The two rows that change the strategy are the third and the fourth. A local cache of reference data does not justify affinity: if it is rebuildable from the source, the new instance merely pays a more expensive first read, and the fix is warming it at process start, not fixed routing. A long lived connection does justify real locality, but it does not justify an affinity cookie: the connection is already physically bound to that instance, and what needs solving is client reconnection, not the route of the next HTTP request.',
        },
        {
          type: 'code',
          value: `// Before: session in process memory. Works with affinity enabled
// and disappears when the instance leaves the pool.
const sessions = new Map();

app.post('/login', async (req, res) => {
  const user = await authenticate(req.body);
  const id = crypto.randomUUID();
  sessions.set(id, { userId: user.id, createdAt: Date.now() });
  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/profile', (req, res) => {
  const session = sessions.get(req.cookies.sid);
  if (!session) return res.status(401).json({ error: 'invalid_session' });
  res.json({ userId: session.userId });
});

// After: session in an external store. Any instance can serve it,
// and affinity stops being necessary for this flow.
const SESSION_TTL_SECONDS = 60 * 60 * 8;

app.post('/login', async (req, res) => {
  const user = await authenticate(req.body);
  const id = crypto.randomUUID();

  await redis.set(
    \`session:\${id}\`,
    JSON.stringify({ userId: user.id, createdAt: Date.now(), version: 2 }),
    { EX: SESSION_TTL_SECONDS },
  );

  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/profile', async (req, res) => {
  const raw = await redis.get(\`session:\${req.cookies.sid}\`);
  if (!raw) return res.status(401).json({ error: 'invalid_session' });

  const session = JSON.parse(raw);
  // Sliding renewal: each request extends the session without rewriting
  // the body, which avoids losing data written by another instance.
  await redis.expire(\`session:\${req.cookies.sid}\`, SESSION_TTL_SECONDS);
  res.json({ userId: session.userId });
});`,
        },
        {
          type: 'paragraph',
          value:
            'The subtle point in the external version is renewing the expiry instead of rewriting the body. When two requests from the same user land on different instances at the same time, which is exactly the scenario affinity was hiding, rewriting the whole object makes the last write erase the field the other one just stored. Extending the lifetime without touching the content eliminates that class of loss without needing a lock.',
        },
      ],
    },
    {
      title: 'Migrating without dropping logged in users',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The migration has to work with users in the middle of a session, because there is no window in which nobody is logged in. The sequence below keeps the system working at every stage and allows reverting at any point without losing sessions, which is the difference between a planned migration and a swap done on hope.',
        },
        {
          type: 'ordered',
          items: [
            'Write to both places. The application starts writing the session to memory and to the external store, and keeps reading only from memory. Nothing changes for the user, and affinity stays enabled. This stage is purely measurement: external write error rate and latency added per request.',
            'Read from the external store with a fallback to memory. Reads start hitting the external store first and, on a miss, fall back to local memory. Old sessions stay valid and new sessions already work on any instance. This is the stage that needs the most time, because it lasts as long as the longest session lifetime.',
            'Confirm local memory is no longer being read. The indicator is the fallback hit counter: when it stays at zero for longer than the session expiry, no live session depends on a specific instance anymore.',
            'Turn affinity off at the balancer. Do it one environment at a time and watch CPU spread across instances, not the average. Distribution should become visibly more uniform within minutes, and the error rate should not move.',
            'Remove the memory write and the fallback code. Only after affinity has been off long enough to cover a deployment, a scaling event and an instance restart. Until then, the fallback code is the way back.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most common sequencing mistake is turning affinity off at the same moment external reads go live. Both changes produce similar symptoms, an unexpected logout can come from either one, and the investigation burns a whole day separating the causes. Spacing the stages by at least one session expiry window makes the diagnosis immediate if anything shows up.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth recording the case where keeping affinity is the correct answer. If the service holds long lived connections, routing by application key with consistent hashing is preferable to the balancer cookie, because it degrades proportionally: losing one instance out of eight reassigns one eighth of the keys, not the entirety of that instance clients to an arbitrary choice. And if there is a local cache that is expensive to rebuild, affinity buys real performance, provided the system stays correct when it fails, which means treating a cache miss as the normal path and not as an error.',
        },
      ],
    },
    {
      title: 'The alerts that surface the imbalance before the customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No average based metric detects this problem, which is why the customer usually finds it first. The three alerts below cover the three failure modes and none of them requires new instrumentation beyond what already exists per instance.',
        },
        {
          type: 'table',
          columns: ['Alert', 'What it measures', 'Practical threshold', 'Failure mode it catches'],
          rows: [
            [
              'Load spread across instances',
              'Ratio between the busiest instance and the median',
              'Above 1.8 for more than ten minutes',
              'Scaling that brings no relief and instances that came back empty',
            ],
            [
              'Idle instance with a saturated service',
              'Instance below ten percent while the service is above seventy',
              'Any occurrence sustained for five minutes',
              'Added capacity that is not being used',
            ],
            [
              'Errors concentrated on one instance',
              'Share of total errors coming from a single instance',
              'Above 60 percent with more than three instances in the pool',
              'A degraded instance that still passes the health check',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third alert is the one that changes the outcome of an incident, because it detects the situation where affinity prevents automatic recovery. An instance that answers the health check but fails real requests keeps receiving exactly the same clients, and for them the service is down even with the overall dashboard green. The action tied to that alert should be removing the instance from the pool, not restarting it, because restarting keeps the instance in the pool and merely repeats the cycle.',
        },
        {
          type: 'paragraph',
          value:
            'There is also a cheap check worth running as routine rather than as an alert: report, in each instance health response, how many sessions it holds in memory. If the service is declared stateless, that number has to be zero, and any nonzero value exposes state accidentally reintroduced through a path nobody reviewed. It is the only way to keep affinity from becoming necessary again after it has been removed.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If affinity is the problem, why does nearly every platform offer it as a default load balancer feature?',
      answer:
        'Because it solves a real and immediate problem in a specific context, and that context still exists. In an application that keeps sessions in process memory, which is the default behavior of several frameworks to this day, affinity is the difference between working and not working the moment a second instance goes live. It is the lowest effort path to putting an application written for a single server into production, and in that role it is legitimate. The problem is not the feature, it is leaving it on after the reason disappeared, or turning it on without anyone recording why. The pattern that repeats is this: someone enables affinity to fix an intermittent logout on a Friday, the logout stops, and the decision is never revisited. Two years later the application already moves sessions to an external store, but affinity is still on and nobody knows whether it can be turned off, because turning it off became an unmeasured risk. The practice that avoids this is treating affinity like any other operational exception: a written record of the reason, a review date, and a test proving the system works without it. If that test does not exist, affinity is not a choice, it is a dependency.',
    },
    {
      question: 'Does moving the session to an external store not create a single point of failure and a latency cost on every request?',
      answer:
        'It creates a new dependency, and it is worth addressing head on rather than accepting the trade without measuring. On latency, reading a session from an in memory store in the same zone typically costs between half a millisecond and two milliseconds, and comparing that number to zero is the wrong comparison: the right one is against the cost of a deployment that logs out a share of your users and against the cost of capacity that brings no relief during a peak. Beyond that, much of that cost is removable, because the session can be held in a short lived local cache, on the order of five to thirty seconds, which drastically reduces reads without reintroducing the instance dependency, since a cache miss remains a normal path. On availability, the single point does exist and needs the same defenses as any critical dependency: a replica with automatic promotion, a short read timeout and a defined behavior on failure. The defined behavior is what matters most and what is most often missing. If the session store becomes unavailable, the business decision has to be written down beforehand: drop everyone, or accept a short lived signed token as the degraded path, or let anonymous browsing continue and block only the actions that require identity. Any of the three is defensible, and the only bad answer is discovering which one during the incident.',
    },
    {
      question: 'How do you test that the system really works without affinity, without waiting for the next incident to find out?',
      answer:
        'The test that answers this is cheap and needs no special environment. In staging, with representative synthetic load, force random per request routing instead of per session routing and run the flows that span more than one request from the same user: login, multi step checkout, upload, anything that depends on accumulated context. Any state hidden in process memory shows up as an immediate error, and the error rate under random routing is the direct measure of how much the system depends on affinity. In production there is a stronger and equally controlled version, which is terminating an instance on purpose during the lowest traffic window and measuring three numbers: how many users saw an error, how many were logged out and how long it took for load to redistribute. Those three numbers turn an opinion debate into data, and they are usually the argument that unblocks the migration, because the number of users affected by a planned termination is always larger than the estimate people make in their heads. The mistake to avoid is running this test only once: the value is in repeating it periodically, because in memory state reappears through new paths every quarter and the only way to know is exercising the failure before it happens on its own.',
    },
  ],
  conclusion: {
    title: 'Affinity is architectural debt collected on the worst possible day',
    description:
      'Sticky sessions never fail on the day they are configured: they fail on campaign Monday, in the middle of a deployment, in the minute an instance degrades without going down. I can review how your traffic is distributed today and define the in memory state inventory, the migration sequence to external state without dropping logged in users, the degraded behavior when the session store fails, the choice between cookie affinity and consistent hashing where locality is legitimate, and the spread alerts that surface the imbalance before the customer.',
    cta: 'Talk about load distribution and application state',
  },
  related: [
    {
      label: 'Multi-region with a single writer: what changes when latency becomes a product decision',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'The wrong partition key: the queue that stalls because one customer takes it all',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El equipo levantó cuatro instancias nuevas a las nueve de la mañana de un lunes de campaña, y a las nueve y veinte tres de ellas estaban al dos por ciento de CPU mientras la quinta, la antigua, atendía el noventa por ciento del tráfico y devolvía error. Nadie configuró mal el escalado: el balanceador estaba haciendo exactamente lo que se le mandó hacer, que es mantener a cada usuario pegado a la instancia que lo atendió primero. Este artículo muestra por qué la sesión pegajosa convierte la capacidad en un número engañoso, qué cuatro costos cobra y cuándo aparece cada uno, por qué el problema real casi nunca es el balanceador sino el estado que quedó en el proceso, cómo migrar a estado externo sin tumbar la sesión del usuario conectado, qué configuración de afinidad sobrevive al reinicio de una instancia y qué tres alertas muestran el desbalanceo antes de que el cliente reclame.',
  sections: [
    {
      title: 'Qué promete realmente la afinidad de sesión y qué no promete',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La afinidad de sesión es un mecanismo simple: el balanceador elige una instancia en la primera petición de un cliente y a partir de ahí manda todas las peticiones siguientes de ese cliente a la misma instancia. La implementación varía, pero el efecto siempre es el mismo, y la promesa también: si el proceso guardó algo en memoria durante la primera petición, ese algo sigue disponible en la segunda. Eso es lo que entrega la afinidad, y nada más.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que no entrega es la parte que se rompe en producción. No garantiza que la instancia siga existiendo, y en un entorno con escalado automático, despliegue continuo y verificación de salud, la instancia deja de existir varias veces al día. No garantiza que el cliente siga siendo reconocido, porque la identificación depende de una cookie que el cliente puede no aceptar o de una dirección de origen que cambia cuando el usuario cambia de red. Y no garantiza distribución, que es justamente el motivo por el cual existe el balanceador.',
        },
        {
          type: 'paragraph',
          value:
            'La confusión más cara en este tema es tratar la afinidad como un ajuste de rendimiento. No lo es. La afinidad es una restricción de enrutamiento adoptada para compensar un estado que quedó en el lugar equivocado, y cada vez que se activa por conveniencia sin que nadie escriba el motivo, el sistema gana una dependencia invisible entre el cliente y un proceso específico. La pregunta que separa el uso legítimo de la deuda es objetiva: si esta instancia se reinicia ahora, qué pierde el usuario. Si la respuesta es nada, la afinidad sobra. Si es algo, el problema es el estado, no el enrutamiento.',
        },
        {
          type: 'table',
          columns: ['Mecanismo de afinidad', 'Cómo identifica al cliente', 'Dónde se rompe en la práctica', 'Sobrevive al reinicio de la instancia'],
          rows: [
            [
              'Cookie emitida por el balanceador',
              'Cookie propia, opaca para la aplicación',
              'Cliente que bloquea cookies, llamada de API sin navegador',
              'No, el cliente se reasigna sin aviso',
            ],
            [
              'Cookie de la aplicación usada como clave',
              'Valor de una cookie que la aplicación ya define',
              'La renovación de la cookie en el login cambia la instancia a mitad del flujo',
              'No, y además puede cambiar sin que la instancia caiga',
            ],
            [
              'Hash de la dirección de origen',
              'Dirección IP del cliente',
              'Red móvil, salida NAT corporativa, proxy compartido',
              'No, y distribuye muy mal detrás de NAT',
            ],
            [
              'Hash consistente por clave de aplicación',
              'Identificador de usuario o de tenant enviado en la petición',
              'Exige que la clave venga en cada petición, incluidas las anónimas',
              'Parcialmente, reasigna solo la porción de la instancia retirada',
            ],
            [
              'Sin afinidad, estado externo',
              'No necesita identificar, cualquier instancia sirve',
              'Costo de latencia de leer el estado en cada petición',
              'Sí, es el único que sobrevive por construcción',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila suele quedar fuera de estas discusiones, y es la más útil cuando existe una razón legítima para mantener localidad, como una caché local cara de calentar. El hash consistente por clave de aplicación no ata al usuario a una instancia por orden de llegada, sino por una función determinista: cuando una instancia sale del conjunto, solo su porción se redistribuye y las demás claves siguen donde estaban. Es la diferencia entre reasignar el cien por ciento de los clientes de una instancia caída y reasignar exactamente los clientes que estaban en ella.',
        },
      ],
    },
    {
      title: 'Los cuatro costos, y el día en que aparece cada uno',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El costo de la sesión pegajosa no es uno solo, y no llegan juntos. Cada uno tiene su propio disparador, y por eso la configuración parece inofensiva durante meses antes de convertirse en incidente. Separar los cuatro ayuda a decidir qué es urgente y qué es deuda controlada.',
        },
        {
          type: 'ordered',
          items: [
            'Escalado que no escala. La instancia nueva entra al conjunto sin carga porque las sesiones existentes siguen atadas donde están. El alivio solo llega conforme expiran las sesiones antiguas, lo que en un pico significa que la capacidad agregada llega demasiado tarde para el evento que motivó agregarla.',
            'Carga desigual permanente. Una instancia que quedó fuera del conjunto durante diez minutos por un despliegue vuelve vacía y permanece relativamente vacía durante horas, porque solo recibe clientes nuevos. El gráfico de CPU media del servicio se ve sano mientras una instancia específica se satura.',
            'Despliegue que tumba usuarios. Al terminar una instancia, todo cliente atado a ella se reasigna de golpe. Si había estado en memoria, ese estado se pierde en bloque, y el síntoma es un pico de error o de cierre de sesión concentrado en el minuto exacto del despliegue, fácil de confundir con un defecto de la versión nueva.',
            'Recuperación más lenta del incidente. Cuando una instancia se degrada pero todavía pasa la verificación de salud, los clientes atados a ella siguen siendo enviados a ella. El balanceador no saca a nadie de ahí, porque la afinidad tiene precedencia sobre la distribución, y el incidente queda confinado a una parte de los usuarios por tiempo indefinido.',
          ],
        },
        {
          type: 'diagram',
          value: `Lunes de campana, escalado automatico con afinidad activada

09:00  4 instancias, 12.000 sesiones activas atadas
       A[3000] B[3000] C[3000] D[3000]     CPU media 78%

09:05  el escalado automatico levanta 4 instancias nuevas
       A[3000] B[3000] C[3000] D[3000] E[0] F[0] G[0] H[0]
       CPU media del servicio: 39%   <- la metrica dice "resuelto"
       CPU de A,B,C,D:         78%   <- la realidad no cambio

09:20  las sesiones nuevas empiezan a caer en las instancias vacias
       A[2900] B[2950] C[2880] D[2910] E[120] F[130] G[110] H[125]
       CPU media 41%, A sigue en 76%, empieza a devolver error

09:34  D falla la verificacion de salud y sale del conjunto
       2910 clientes reasignados de golpe -> pierden estado en memoria
       pico de cierre de sesion y de error concentrado en un minuto

Sin afinidad, con estado externo:
09:05  8 instancias, cualquier peticion en cualquier instancia
       CPU media 39% y CPU real por instancia 39%
       salida de una instancia = 1/8 de las peticiones siguientes redistribuidas
       ningun estado perdido, ningun cierre de sesion`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que más engaña en ese escenario es la línea de la CPU media. Es matemáticamente correcta y operativamente inútil: con cuatro instancias al setenta y ocho por ciento y cuatro en cero, la media es treinta y nueve, y ese es el número que el panel muestra en letra grande. La señal que importa no es la media, es la dispersión entre instancias, y casi nunca está en el panel por defecto.',
        },
      ],
    },
    {
      title: 'El estado que quedó en el proceso, que es el problema de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Apagar la afinidad sin tratar antes el estado cambia un problema previsible por uno imprevisible. Antes de tocar el balanceador hay que inventariar qué guarda la aplicación en memoria entre peticiones del mismo cliente. En la práctica ese inventario casi siempre cabe en cinco categorías, y cada una tiene un destino diferente.',
        },
        {
          type: 'table',
          columns: ['Estado en la memoria del proceso', 'Ejemplo común', 'Destino correcto', 'Costo del cambio'],
          rows: [
            [
              'Sesión de autenticación',
              'Mapa de identificador de sesión a usuario',
              'Almacenamiento externo compartido o token firmado',
              'Bajo, es el caso mejor resuelto de la lista',
            ],
            [
              'Carrito o formulario de varios pasos',
              'Borrador del pedido acumulado entre pantallas',
              'Persistencia por identificador estable, no por sesión',
              'Medio, exige decidir la clave y el tiempo de expiración',
            ],
            [
              'Caché local de datos de referencia',
              'Tabla de precios, catálogo, configuración de tenant',
              'Sigue local, con invalidación por evento',
              'Bajo, no necesita afinidad si es reconstruible',
            ],
            [
              'Conexión de larga duración',
              'WebSocket, streaming de respuesta, carga en partes',
              'Sigue en la instancia, con reconexión explícita en el cliente',
              'Medio, exige tratar la reconexión como caso normal',
            ],
            [
              'Trabajo en curso no persistido',
              'Procesamiento iniciado en una petición y leído en la siguiente',
              'Cola con identificador de tarea y consulta de estado',
              'Alto, suele exigir cambiar el contrato de la API',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos filas que cambian la estrategia son la tercera y la cuarta. Una caché local de datos de referencia no justifica afinidad: si es reconstruible desde el origen, la instancia nueva solo paga la primera lectura más cara, y la solución es calentarla al iniciar el proceso, no el enrutamiento fijo. Una conexión de larga duración sí justifica localidad real, pero no justifica cookie de afinidad: la conexión ya está físicamente atada a esa instancia, y lo que hay que resolver es la reconexión del cliente, no la ruta de la próxima petición HTTP.',
        },
        {
          type: 'code',
          value: `// Antes: sesion en la memoria del proceso. Funciona con afinidad activada
// y desaparece cuando la instancia sale del conjunto.
const sesiones = new Map();

app.post('/login', async (req, res) => {
  const usuario = await autenticar(req.body);
  const id = crypto.randomUUID();
  sesiones.set(id, { usuarioId: usuario.id, creadaEn: Date.now() });
  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/perfil', (req, res) => {
  const sesion = sesiones.get(req.cookies.sid);
  if (!sesion) return res.status(401).json({ error: 'sesion_invalida' });
  res.json({ usuarioId: sesion.usuarioId });
});

// Despues: sesion en almacenamiento externo. Cualquier instancia atiende,
// y la afinidad deja de ser necesaria para este flujo.
const TTL_SESION_SEGUNDOS = 60 * 60 * 8;

app.post('/login', async (req, res) => {
  const usuario = await autenticar(req.body);
  const id = crypto.randomUUID();

  await redis.set(
    \`sesion:\${id}\`,
    JSON.stringify({ usuarioId: usuario.id, creadaEn: Date.now(), version: 2 }),
    { EX: TTL_SESION_SEGUNDOS },
  );

  res.cookie('sid', id, { httpOnly: true, secure: true, sameSite: 'lax' });
  res.json({ ok: true });
});

app.get('/perfil', async (req, res) => {
  const bruto = await redis.get(\`sesion:\${req.cookies.sid}\`);
  if (!bruto) return res.status(401).json({ error: 'sesion_invalida' });

  const sesion = JSON.parse(bruto);
  // Renovacion deslizante: cada peticion extiende la sesion sin reescribir
  // el cuerpo, lo que evita perder datos escritos por otra instancia.
  await redis.expire(\`sesion:\${req.cookies.sid}\`, TTL_SESION_SEGUNDOS);
  res.json({ usuarioId: sesion.usuarioId });
});`,
        },
        {
          type: 'paragraph',
          value:
            'El punto sutil en la versión externa es renovar la expiración en vez de reescribir el cuerpo. Cuando dos peticiones del mismo usuario llegan a instancias diferentes al mismo tiempo, que es exactamente el escenario que la afinidad escondía, reescribir el objeto entero hace que la última escritura borre el campo que la otra acaba de guardar. Extender el tiempo de vida sin tocar el contenido elimina esa clase de pérdida sin necesitar un bloqueo.',
        },
      ],
    },
    {
      title: 'Migrar sin tumbar a quien está conectado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La migración tiene que funcionar con usuarios en medio de una sesión, porque no existe una ventana en la que nadie esté conectado. La secuencia siguiente mantiene el sistema funcionando en todas las etapas y permite revertir en cualquier punto sin perder sesiones, que es la diferencia entre una migración planificada y un cambio hecho con los dedos cruzados.',
        },
        {
          type: 'ordered',
          items: [
            'Escribe en ambos lugares. La aplicación pasa a guardar la sesión en memoria y en el almacenamiento externo, y sigue leyendo solo de memoria. Nada cambia para el usuario, y la afinidad sigue activada. En esta etapa solo se mide: tasa de error de escritura externa y latencia agregada por petición.',
            'Lee del externo con retorno a la memoria. La lectura pasa a consultar primero el almacenamiento externo y, si no encuentra, cae en la memoria local. Las sesiones antiguas siguen válidas y las nuevas ya funcionan en cualquier instancia. Es la etapa que necesita más tiempo, porque dura lo que dure la sesión más larga.',
            'Confirma que la memoria local ya no se lee. El indicador es el contador de aciertos del retorno a memoria: cuando queda en cero por un período mayor que el tiempo de expiración de la sesión, ninguna sesión viva depende ya de una instancia específica.',
            'Apaga la afinidad en el balanceador. Hazlo en un entorno a la vez y observa la dispersión de CPU entre instancias, no la media. La distribución debe volverse visiblemente más uniforme en minutos, y la tasa de error no debe moverse.',
            'Elimina la escritura en memoria y el código de retorno. Solo después de que la afinidad haya estado apagada el tiempo suficiente para cubrir un despliegue, un evento de escalado y un reinicio de instancia. Antes de eso, el código de retorno es el camino de vuelta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error de secuencia más común es apagar la afinidad en el mismo momento en que entra la lectura externa. Los dos cambios producen síntomas parecidos, un cierre de sesión inesperado puede venir de cualquiera de los dos, y la investigación pierde el día entero separando las causas. Separar las etapas por al menos una ventana de expiración de sesión hace que el diagnóstico sea inmediato si aparece algo.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar el caso en el que mantener la afinidad es la respuesta correcta. Si el servicio mantiene conexiones de larga duración, el enrutamiento por clave de aplicación con hash consistente es preferible a la cookie del balanceador, porque degrada de forma proporcional: perder una instancia entre ocho reasigna un octavo de las claves, no la totalidad de los clientes de esa instancia hacia una elección arbitraria. Y si existe una caché local cara de reconstruir, la afinidad compra rendimiento real, siempre que el sistema siga siendo correcto cuando ella falle, lo que significa tratar la ausencia de la caché como camino normal y no como error.',
        },
      ],
    },
    {
      title: 'Las alertas que muestran el desbalanceo antes que el cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Ninguna métrica de media detecta este problema, y por eso suele descubrirlo el cliente. Las tres alertas siguientes cubren los tres modos de falla y ninguna depende de instrumentación nueva más allá de lo que ya existe por instancia.',
        },
        {
          type: 'table',
          columns: ['Alerta', 'Qué mide', 'Umbral práctico', 'Modo de falla que captura'],
          rows: [
            [
              'Dispersión de carga entre instancias',
              'Razón entre la instancia más cargada y la mediana',
              'Por encima de 1,8 durante más de diez minutos',
              'Escalado que no alivia e instancia que volvió vacía',
            ],
            [
              'Instancia ociosa con servicio saturado',
              'Instancia por debajo del diez por ciento con el servicio por encima del setenta',
              'Cualquier ocurrencia sostenida durante cinco minutos',
              'Capacidad agregada que no se está usando',
            ],
            [
              'Error concentrado en una instancia',
              'Fracción del error total proveniente de una sola instancia',
              'Por encima del 60 por ciento con más de tres instancias en el conjunto',
              'Instancia degradada que todavía pasa la verificación de salud',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera alerta es la que cambia el desenlace del incidente, porque detecta la situación en la que la afinidad impide la recuperación automática. Una instancia que responde a la verificación de salud pero falla en las peticiones reales sigue recibiendo exactamente los mismos clientes, y para ellos el servicio está caído incluso con el panel general en verde. La acción asociada a esa alerta debe ser retirar la instancia del conjunto, no reiniciarla, porque reiniciar la mantiene en el conjunto y solo repite el ciclo.',
        },
        {
          type: 'paragraph',
          value:
            'Hay además una verificación barata que vale como rutina y no como alerta: reportar, en la respuesta de salud de cada instancia, cuántas sesiones guarda en memoria. Si el servicio se declara sin estado, ese número tiene que ser cero, y un valor distinto de cero delata la introducción accidental de estado en memoria por un camino que nadie revisó. Es la única forma de impedir que la afinidad vuelva a ser necesaria después de haberla quitado.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Si la afinidad es el problema, por qué el balanceador ofrece ese recurso por defecto en casi toda plataforma?',
      answer:
        'Porque resuelve un problema real e inmediato en un contexto específico, y ese contexto todavía existe. En una aplicación que guarda la sesión en la memoria del proceso, que es el comportamiento por defecto de varios frameworks hasta hoy, la afinidad es la diferencia entre funcionar y no funcionar en cuanto entra en línea la segunda instancia. Es el camino de menor esfuerzo para poner en producción una aplicación escrita para correr en un solo servidor, y en ese papel es legítima. El problema no es el recurso, es que siga activado después de que el motivo desapareció, o que se active sin que nadie registre por qué. El patrón que se repite es este: alguien activa la afinidad para resolver un cierre de sesión intermitente un viernes, el cierre para, y la decisión nunca se revisa. Dos años después la aplicación ya mueve la sesión a un almacenamiento externo, pero la afinidad sigue activada y nadie sabe si se puede apagar, porque apagarla se volvió un riesgo no medido. La práctica que evita esto es tratar la afinidad como cualquier otra excepción operativa: registro escrito del motivo, fecha de revisión y una prueba que demuestre que el sistema funciona sin ella. Si esa prueba no existe, la afinidad no es una elección, es una dependencia.',
    },
    {
      question: '¿Mover la sesión a un almacenamiento externo no crea un punto único de falla y un costo de latencia en cada petición?',
      answer:
        'Crea una dependencia nueva, y vale tratarla de frente en vez de aceptar el intercambio sin medir. Sobre la latencia, leer la sesión en un almacenamiento en memoria en la misma zona cuesta típicamente entre medio y dos milisegundos, y comparar ese número con cero es la comparación equivocada: lo correcto es compararlo con el costo de un despliegue que cierra la sesión de una parte de los usuarios y con el costo de una capacidad que no alivia en un pico. Además, buena parte de ese costo es eliminable, porque la sesión puede mantenerse en una caché local de tiempo corto, del orden de cinco a treinta segundos, lo que reduce drásticamente las lecturas sin reintroducir la dependencia de instancia, ya que la ausencia de la caché sigue siendo un camino normal. Sobre la disponibilidad, el punto único existe y necesita las mismas defensas que cualquier dependencia crítica: réplica con promoción automática, tiempo límite corto en la lectura y un comportamiento definido para la falla. El comportamiento definido es lo que más importa y lo que más falta. Si el almacenamiento de sesión queda indisponible, la decisión de negocio tiene que estar escrita antes: tumbar a todos, o aceptar un token firmado de validez corta como camino degradado, o dejar seguir la navegación anónima y bloquear solo las acciones que exigen identidad. Cualquiera de las tres es defendible, y la única respuesta mala es descubrir cuál durante el incidente.',
    },
    {
      question: '¿Cómo probar que el sistema realmente funciona sin afinidad, sin esperar al próximo incidente para descubrirlo?',
      answer:
        'La prueba que da la respuesta es barata y no necesita un entorno especial. En homologación, con carga sintética representativa, fuerza el enrutamiento aleatorio por petición en vez de por sesión y ejecuta los flujos que atraviesan más de una petición del mismo usuario: login, checkout de varios pasos, carga de archivos, cualquier cosa que dependa de contexto acumulado. Cualquier estado escondido en la memoria del proceso aparece como error inmediato, y la tasa de error bajo enrutamiento aleatorio es la medida directa de cuánto depende el sistema de la afinidad. En producción existe una versión más fuerte e igualmente controlada, que es terminar una instancia a propósito durante el horario de menor tráfico y medir tres números: cuántos usuarios vieron error, cuántos perdieron la sesión y cuánto tardó la carga en volver a distribuirse. Esos tres números convierten una discusión de opinión en dato, y suelen ser el argumento que destraba la migración, porque la cantidad de usuarios afectados por una terminación planificada siempre es mayor que la estimación que la gente hace de cabeza. El error a evitar es hacer esta prueba una sola vez: el valor está en repetirla periódicamente, porque el estado en memoria vuelve a aparecer por caminos nuevos cada trimestre y la única forma de saberlo es ejercitar la falla antes de que ocurra sola.',
    },
  ],
  conclusion: {
    title: 'La afinidad es deuda de arquitectura cobrada en el peor día posible',
    description:
      'La sesión pegajosa nunca falla el día en que se configura: falla el lunes de campaña, en medio del despliegue, en el minuto en que una instancia se degrada sin caer. Puedo revisar cómo se distribuye tu tráfico hoy y definir el inventario de estado en memoria, la secuencia de migración a estado externo sin tumbar al usuario conectado, el comportamiento degradado cuando el almacenamiento de sesión falla, la elección entre afinidad por cookie y hash consistente donde la localidad sea legítima, y las alertas de dispersión que muestran el desbalanceo antes que el cliente.',
    cta: 'Hablar sobre distribución de carga y estado de mi aplicación',
  },
  related: [
    {
      label: 'Multirregión con escritura única: qué cambia cuando la latencia se vuelve decisión de producto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Clave de particionamiento equivocada: la cola que se traba porque un cliente lo ocupa todo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
