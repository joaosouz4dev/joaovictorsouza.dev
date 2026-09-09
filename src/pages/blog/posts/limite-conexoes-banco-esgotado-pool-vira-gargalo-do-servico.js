// Conteudo do artigo: limite de conexoes do banco esgotado e o pool como gargalo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O erro chegou às onze da manhã de uma terça-feira comum, dizendo que o banco recusou a conexão porque atingiu o limite de clientes, e a primeira reação do time foi aumentar o número máximo de conexões no servidor. Funcionou por quarenta minutos. Depois o banco voltou a recusar, agora com a CPU em noventa por cento e consultas que antes levavam dois milissegundos levando quatrocentos. Este artigo mostra por que aumentar o limite é a única resposta que piora o problema de forma garantida, qual é a conta que dimensiona o pool a partir da capacidade real do banco e não do número de contêineres, por que a fila de espera do pool é a métrica que enxerga o problema antes do erro aparecer, como uma transação que espera resposta de HTTP consome uma conexão sem usar o banco, qual é a diferença prática entre pool por processo e pool centralizado e quando cada um vale a pena, e quais três alertas mostram o esgotamento com antecedência suficiente para agir.',
  sections: [
    {
      title: 'A conexão do banco é um recurso caro, não um objeto barato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A camada de acesso a dados da maior parte das aplicações apresenta a conexão como se ela fosse um detalhe de implementação, e o resultado é que quase ninguém sabe quanto ela custa. Numa base relacional que usa processo por conexão, como o PostgreSQL, cada conexão aberta corresponde a um processo do sistema operacional com sua própria área de memória de trabalho, seu próprio cache de catálogo e sua própria participação nas estruturas compartilhadas que o banco precisa varrer a cada snapshot de transação. O número que aparece no arquivo de configuração como limite máximo não é uma trava arbitrária que alguém colocou por precaução: ele é a capacidade que o banco consegue sustentar antes que o custo de coordenar processos passe a consumir mais do que o trabalho útil.',
        },
        {
          type: 'paragraph',
          value:
            'Isso explica o comportamento que confunde quem investiga o incidente pela primeira vez. Enquanto o número de conexões ativas está abaixo do ponto de saturação, adicionar concorrência aumenta a vazão de forma quase linear, e a intuição de que mais conexões significa mais capacidade se confirma. Depois desse ponto, a vazão para de crescer e a latência começa a subir, porque as consultas passam a competir por CPU, por páginas do cache compartilhado e por trilhas de disco. Continuando a adicionar, a vazão cai de verdade, e o sistema entra na região em que mais concorrência produz menos trabalho concluído por segundo. O erro de conexão recusada aparece perto dessa região e é interpretado como falta de conexões, quando na prática ele é o banco recusando entrar num regime onde ninguém sairia ganhando.',
        },
        {
          type: 'diagram',
          value: `VAZAO x CONEXOES ATIVAS (forma tipica)

  vazao
   ^
   |            .--------.
   |          .'          '-.
   |        .'                '--.
   |      .'                       '---.
   |    .'                               '----.
   |  .'                                        '-----
   +--+-----------+------------+----------------------> conexoes ativas
      A           B            C

  A = subutilizado: adicionar conexao aumenta vazao
  B = ponto de saturacao: perto de (nucleos x 2) + discos efetivos
  C = colapso: mais conexao, menos trabalho concluido por segundo

  O erro "too many clients" aparece em C.
  Aumentar o limite move o sistema para a DIREITA de C.`,
        },
        {
          type: 'paragraph',
          value:
            'Daí vem a conclusão que orienta todo o resto: o limite de conexões não é um teto de segurança que atrapalha, é o mecanismo que impede o banco de entrar em colapso por excesso de concorrência. Aumentar o limite remove a proteção sem adicionar capacidade nenhuma, e transforma um erro rápido e visível, que a aplicação pode tratar, num degrau de latência distribuído por todas as requisições, que ninguém consegue atribuir a nada. O erro de conexão recusada é um sintoma incômodo mas honesto. A alternativa produzida por aumentar o limite é um sistema lento sem culpado aparente.',
        },
      ],
    },
    {
      title: 'A conta que dimensiona o pool a partir da capacidade do banco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O dimensionamento do pool costuma ser feito de trás para frente. Alguém pega o número de requisições simultâneas que a aplicação recebe no pico, arredonda para cima e usa isso como tamanho do pool, porque parece razoável que cada requisição tenha a sua conexão. O problema é que esse raciocínio parte da demanda e ignora a oferta. O tamanho correto do pool não vem do número de requisições que chegam, vem da quantidade de trabalho simultâneo que o banco consegue executar sem degradar, e esse número é surpreendentemente pequeno.',
        },
        {
          type: 'paragraph',
          value:
            'A regra de partida mais usada estima a concorrência útil como o dobro do número de núcleos de CPU do servidor de banco somado ao número de discos que servem leituras efetivas em paralelo. O dobro dos núcleos existe porque metade do tempo de uma consulta típica é gasto esperando entrada e saída, então cada núcleo consegue intercalar duas consultas sem ficar ocioso. Em máquina com armazenamento em memória flash e conjunto de dados que cabe no cache compartilhado, a parcela de disco tende a zero e o número converge para o dobro dos núcleos. Um servidor com oito núcleos, portanto, sustenta algo próximo de dezesseis a vinte conexões executando trabalho ao mesmo tempo, e não as duzentas que a soma dos pools costuma produzir.',
        },
        {
          type: 'code',
          value: `// Dimensionamento do pool a partir da capacidade do banco,
// e nao do numero de requisicoes simultaneas da aplicacao.

// 1) Capacidade util do banco (concorrencia que ele sustenta sem degradar).
const NUCLEOS_BANCO = 8;
const DISCOS_EFETIVOS = 0;          // 0 em NVMe com dataset em cache
const CONEXOES_RESERVADAS = 5;      // superusuario, replicacao, migracao, backup

const capacidadeUtil = NUCLEOS_BANCO * 2 + DISCOS_EFETIVOS;   // 16

// 2) Divisao entre os consumidores. Toda instancia que abre pool conta,
//    inclusive worker, cron e job de relatorio, que sempre sao esquecidos.
const consumidores = [
  { nome: 'api', instancias: 6, peso: 3 },        // trafego sincrono
  { nome: 'worker-fila', instancias: 4, peso: 2 }, // processamento assincrono
  { nome: 'cron-relatorio', instancias: 1, peso: 1 },
];

const pesoTotal = consumidores.reduce(
  (soma, c) => soma + c.instancias * c.peso,
  0,
);                                                  // 6*3 + 4*2 + 1*1 = 27

const orcamento = capacidadeUtil - CONEXOES_RESERVADAS; // 11 conexoes uteis

const plano = consumidores.map((c) => {
  const fatia = (c.instancias * c.peso) / pesoTotal;
  const total = Math.max(1, Math.floor(orcamento * fatia));
  return {
    servico: c.nome,
    poolPorInstancia: Math.max(1, Math.floor(total / c.instancias)),
    totalDoServico: total,
  };
});

console.table(plano);
// api            -> pool 1 por instancia, 7 no total
// worker-fila    -> pool 1 por instancia, 3 no total
// cron-relatorio -> pool 1, 1 no total
//
// Total conectado ao banco: 11. Parece pouco e provoca reacao imediata:
// "com pool 1 a api nao aguenta 400 requisicoes por segundo". Aguenta,
// desde que a consulta dure 5 ms: 1 conexao x (1000 / 5) = 200 req/s por
// instancia, 1200 req/s no conjunto. O limite nunca foi a conexao,
// sempre foi o tempo que cada uma fica ocupada.

// 3) Verificacao: a vazao teorica precisa cobrir o pico com folga.
const DURACAO_MEDIA_MS = 5;
const vazaoTeorica = plano
  .filter((p) => p.servico === 'api')
  .reduce((soma, p) => soma + p.totalDoServico * (1000 / DURACAO_MEDIA_MS), 0);

console.log(\`vazao teorica da api: \${vazaoTeorica} req/s\`);  // 1400 req/s`,
        },
        {
          type: 'paragraph',
          value:
            'A verificação no final do exemplo é a parte que muda a conversa dentro do time. Um pool pequeno provoca resistência imediata porque o número parece incompatível com o volume de tráfego, e a objeção só se dissolve quando a vazão é calculada explicitamente. Uma conexão que executa consultas de cinco milissegundos entrega duzentas consultas por segundo. Se a mesma consulta passa a levar cinquenta milissegundos, ela entrega vinte, e nenhum tamanho de pool compensa isso, porque a fila apenas transfere a espera para dentro da aplicação. É por isso que otimizar a consulta lenta libera mais capacidade do que qualquer ajuste de pool, e é por isso que o dimensionamento precisa vir depois da medição de duração, nunca antes.',
        },
      ],
    },
    {
      title: 'A fila de espera do pool é a métrica que vê o problema chegando',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A instrumentação padrão de um pool de conexões costuma expor o número de conexões ativas e o número de conexões ociosas, e esses dois valores dizem muito pouco sobre saúde. Conexões ativas em número alto podem significar tanto um sistema saudável trabalhando no limite planejado quanto um sistema afogado. O que separa os dois casos é uma terceira métrica, quase sempre disponível e quase nunca observada: o tempo que uma requisição passa esperando para receber uma conexão do pool.',
        },
        {
          type: 'paragraph',
          value:
            'Essa métrica tem uma propriedade que a torna especialmente útil. Ela é zero enquanto existe folga e sobe de forma abrupta quando a folga acaba, o que significa que ela não avisa cedo demais nem tarde demais. Diferente da taxa de erro, que só se move quando o tempo limite de aquisição já foi ultrapassado e a requisição já falhou, o tempo de espera começa a subir no momento em que a demanda encosta na capacidade, e costuma dar de um a cinco minutos de antecedência num pico de crescimento típico. Diferente do número de conexões ativas, ela não depende do tamanho do pool para ser interpretada: espera acima de zero significa saturação, em qualquer configuração.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'O que ela responde', 'Quando se move', 'Limite prático'],
          rows: [
            [
              'Conexões ativas',
              'Quantas conexões estão executando consulta agora',
              'Junto com o tráfego',
              'Não distingue saudável de afogado',
            ],
            [
              'Conexões ociosas',
              'Quanta folga instantânea existe no pool',
              'Junto com o tráfego',
              'Cai a zero antes de o problema aparecer, sem avisar quanto falta',
            ],
            [
              'Tempo de espera por conexão (p95)',
              'Quanto a requisição espera antes de trabalhar',
              'No instante em que a demanda encosta na capacidade',
              'Precisa de instrumentação explícita na maioria dos pools',
            ],
            [
              'Duração da conexão em uso (p95)',
              'Por quanto tempo cada conexão fica retida',
              'Quando entra consulta lenta ou chamada externa na transação',
              'Sobe também por causas fora do banco, o que é justamente o valor',
            ],
            [
              'Timeout de aquisição por minuto',
              'Quantas requisições desistiram de esperar',
              'Depois que o usuário já viu o erro',
              'Serve para confirmar, nunca para prevenir',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha da tabela merece atenção porque ela é a que explica a maior parte dos esgotamentos que não têm relação com aumento de tráfego. A duração da conexão em uso sobe quando a conexão fica retida por algo que não é o banco, e quando isso acontece o pool esgota com o mesmo volume de sempre. A causa mais comum é uma chamada de rede dentro de um bloco que já abriu a transação, e é o assunto da próxima seção.',
        },
        {
          type: 'code',
          value: `// Instrumentacao minima do tempo de espera do pool.
// A ideia vale para qualquer driver: medir o intervalo entre pedir a
// conexao e receber, separado do tempo de execucao da consulta.

import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';

const pool = new Pool({
  max: 7,                          // vindo do dimensionamento, nao do palpite
  connectionTimeoutMillis: 2000,   // desistir rapido, nao esperar sem limite
  idleTimeoutMillis: 30000,
});

export async function comConexao(rotulo, executar) {
  const pedidoEm = performance.now();
  let cliente;

  try {
    cliente = await pool.connect();
  } catch (erro) {
    metricas.incrementar('db.pool.timeout_aquisicao', { rotulo });
    throw erro;
  }

  const esperaMs = performance.now() - pedidoEm;
  metricas.histograma('db.pool.espera_ms', esperaMs, { rotulo });

  const usoEm = performance.now();
  try {
    return await executar(cliente);
  } finally {
    metricas.histograma('db.pool.uso_ms', performance.now() - usoEm, { rotulo });
    cliente.release();
  }
}

// O rotulo por caminho de codigo e o que torna a metrica acionavel:
// sem ele o painel mostra que o pool saturou, com ele mostra que quem
// segura a conexao por 800 ms e o relatorio, nao o checkout.`,
        },
      ],
    },
    {
      title: 'Transação que espera resposta de rede consome conexão sem usar o banco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma categoria de esgotamento que não aparece em nenhum gráfico de tráfego porque o tráfego não mudou. O pool esgota, o banco continua com CPU baixa, as consultas continuam rápidas quando executadas manualmente, e a soma disso deixa o time procurando no lugar errado. A causa é quase sempre a mesma: alguma transação passou a segurar a conexão enquanto espera por algo que não é o banco.',
        },
        {
          type: 'paragraph',
          value:
            'O padrão nasce de uma intenção correta. O desenvolvedor quer que a criação do pedido e o registro da cobrança sejam atômicos, então envolve os dois numa transação. Como a cobrança acontece num provedor externo, a chamada de rede acaba dentro do bloco transacional. Enquanto o provedor responde em cento e cinquenta milissegundos, ninguém percebe. No dia em que o provedor degrada para três segundos, cada pedido passa a reter uma conexão por três segundos, e um pool que atendia tranquilamente cem pedidos por minuto satura com dez. O banco não tem culpa nenhuma e o painel do banco não mostra nada.',
        },
        {
          type: 'code',
          value: `// ERRADO: a chamada HTTP acontece dentro da transacao.
// A conexao fica retida pelo tempo de resposta do provedor externo.
async function criarPedidoErrado(dados) {
  return db.transaction(async (tx) => {
    const pedido = await tx.pedidos.insert(dados);

    // Aqui a conexao esta aberta, com transacao ativa, segurando locks,
    // esperando um servico que voce nao controla.
    const cobranca = await gatewayPagamento.cobrar({
      pedidoId: pedido.id,
      valor: pedido.total,
    });

    await tx.cobrancas.insert({ pedidoId: pedido.id, externoId: cobranca.id });
    return pedido;
  });
}

// CERTO: a transacao cobre apenas o trabalho de banco.
// A chamada externa fica fora, e a atomicidade vira uma maquina de estados.
async function criarPedido(dados) {
  // Transacao 1: curta, so escreve estado local e registra a intencao.
  const pedido = await db.transaction(async (tx) => {
    const criado = await tx.pedidos.insert({ ...dados, status: 'aguardando_cobranca' });
    await tx.outbox.insert({
      tipo: 'cobranca.solicitar',
      pedidoId: criado.id,
      chaveIdempotencia: \`pedido-\${criado.id}\`,
    });
    return criado;
  });

  return pedido;
}

// O worker do outbox faz a chamada externa SEM conexao de banco retida,
// e so pega uma conexao de volta para gravar o resultado.
async function processarCobranca(evento) {
  const cobranca = await gatewayPagamento.cobrar({
    pedidoId: evento.pedidoId,
    chaveIdempotencia: evento.chaveIdempotencia,  // seguro para retentativa
  });

  await db.transaction(async (tx) => {           // transacao 2: curta de novo
    await tx.cobrancas.insert({
      pedidoId: evento.pedidoId,
      externoId: cobranca.id,
    });
    await tx.pedidos.update(evento.pedidoId, { status: 'cobrado' });
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'A troca que esse desenho faz precisa ser dita com clareza para não parecer gratuita. A versão errada oferece atomicidade real entre as duas escritas, e a versão correta não oferece: existe um intervalo em que o pedido está criado e a cobrança ainda não aconteceu. O que se ganha em troca é que a duração da transação deixa de depender de um sistema externo, o que significa que a degradação do provedor vira atraso na fila em vez de esgotamento do pool. Além disso, a atomicidade da versão errada era parcialmente ilusória: se a aplicação caísse depois da cobrança e antes do commit, a transação faria rollback e o cliente estaria cobrado sem pedido. A chave de idempotência no worker resolve isso de forma explícita, o que a transação nunca resolveu.',
        },
        {
          type: 'list',
          items: [
            'Chamada HTTP a serviço externo dentro do bloco transacional, o caso mais frequente e o mais caro.',
            'Escrita em fila ou tópico de mensageria antes do commit, que adiciona a latência do broker à duração da transação.',
            'Laço que processa uma lista item a item com uma consulta por item, mantendo a conexão retida durante todo o percurso.',
            'Leitura de arquivo, geração de PDF ou processamento de imagem no meio da transação, retendo conexão durante trabalho de CPU.',
            'Espera por bloqueio de outra transação, que não aparece como consulta lenta porque a consulta ainda nem começou.',
            'Sessão de depuração ou console interativo aberto contra o banco de produção, que sozinho consome uma conexão por horas.',
          ],
        },
      ],
    },
    {
      title: 'Pool por processo contra pool centralizado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O pool por processo é o arranjo padrão e funciona bem enquanto o número de processos é estável e conhecido. Ele deixa de funcionar no momento em que a escala automática entra em cena, porque o total de conexões abertas passa a ser o tamanho do pool multiplicado por um número que muda sozinho. Um pool de dez conexões em seis instâncias consome sessenta conexões, o que é administrável. O mesmo pool com a escala configurada para quarenta instâncias no pico consome quatrocentas, e o limite do banco é atingido pela política de escala e não pelo tráfego.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda um agravante que passa despercebido em ambiente sem servidor dedicado, onde cada invocação pode criar seu próprio pool. Nesse arranjo, o número de conexões acompanha a concorrência de invocações, e a ideia de dimensionar o pool perde sentido porque não existe um processo de vida longa para segurá-lo. É o cenário em que o pool centralizado deixa de ser uma otimização e passa a ser requisito de funcionamento.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Pool por processo', 'Pool centralizado'],
          rows: [
            [
              'Total de conexões no banco',
              'Tamanho do pool multiplicado por instâncias, cresce com a escala',
              'Fixo e configurado num ponto só, independente da escala',
            ],
            [
              'Comportamento na escala automática',
              'Cada instância nova abre conexões, o pico de escala vira pico de conexão',
              'Instância nova conecta ao intermediário, o banco não percebe',
            ],
            [
              'Latência adicional por consulta',
              'Nenhuma',
              'Um salto de rede a mais, tipicamente abaixo de um milissegundo na mesma rede',
            ],
            [
              'Transação e recurso de sessão',
              'Suporte total: transação longa, prepared statement, tabela temporária',
              'Depende do modo: no modo por transação, recurso de sessão quebra',
            ],
            [
              'Ponto único de falha',
              'Falha isolada por instância',
              'O intermediário precisa de redundância própria',
            ],
            [
              'Quando compensa',
              'Número de instâncias estável e conhecido',
              'Escala automática, ambiente sem servidor, muitos serviços no mesmo banco',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A linha sobre modo de operação é a que produz incidente quando ignorada. No modo por transação, o intermediário devolve a conexão física ao conjunto assim que a transação termina, o que é justamente o que permite atender muitos clientes com poucas conexões. A consequência é que qualquer estado preso à sessão deixa de valer entre uma consulta e a seguinte: prepared statements nomeados, tabelas temporárias, variáveis de sessão e bloqueios consultivos. A migração para esse modo é simples do lado da configuração e exige revisão do lado da aplicação, e o erro clássico é fazer a primeira parte e descobrir a segunda em produção, com o driver reclamando de um prepared statement que não existe mais.',
        },
      ],
    },
    {
      title: 'Sequência de diagnóstico e os três alertas que dão antecedência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o erro de conexão recusada aparece, a sequência abaixo separa em poucos minutos os três cenários possíveis, que exigem respostas completamente diferentes: demanda cresceu de verdade, alguma coisa está segurando conexão por tempo demais, ou existem conexões abandonadas que ninguém está usando. Fazer o diagnóstico nessa ordem evita a resposta reflexa de aumentar o limite.',
        },
        {
          type: 'ordered',
          items: [
            'Liste as conexões por estado e por aplicação de origem. Se a maioria estiver em estado ocioso dentro de transação, o problema é transação aberta sem trabalho e não falta de capacidade.',
            'Meça o tempo da conexão mais antiga em cada estado. Uma conexão ociosa dentro de transação há mais de trinta segundos indica código que abriu transação e foi esperar por rede, por bloqueio ou por entrada humana.',
            'Compare o total de conexões com a soma teórica dos pools configurados. Se o total for maior, existe algum consumidor não inventariado: migração, ferramenta de análise, console aberto ou serviço legado.',
            'Verifique o tempo de espera do pool na aplicação, e não só no banco. Espera alta com poucas conexões ativas significa que o pool da aplicação está subdimensionado em relação ao que o banco aceitaria.',
            'Meça a duração das consultas no percentil noventa e cinco na última hora e compare com a semana anterior. Consulta que dobrou de duração dobra a demanda de conexões sem que nenhum usuário a mais tenha chegado.',
            'Só depois de excluir os quatro anteriores, avalie se a capacidade do banco é realmente o limite, e nesse caso a decisão é ampliar a máquina ou distribuir leitura para réplica, não aumentar o limite na mesma máquina.',
          ],
        },
        {
          type: 'code',
          value: `-- Passos 1 a 3 do diagnostico, em PostgreSQL.

-- 1) Distribuicao por estado e por aplicacao de origem.
SELECT
  application_name,
  state,
  count(*) AS conexoes,
  max(now() - state_change) AS mais_antiga
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY application_name, state
ORDER BY conexoes DESC;

-- 2) Transacoes abertas sem trabalho ativo: o padrao mais caro.
--    Cada linha aqui e uma conexao retida sem usar o banco.
SELECT
  pid,
  application_name,
  now() - xact_start   AS transacao_aberta_ha,
  now() - state_change AS parada_ha,
  left(query, 120)     AS ultima_consulta
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '30 seconds'
ORDER BY parada_ha DESC;

-- 3) Consumo real contra o limite configurado.
SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')
    AS conexoes_em_uso,
  current_setting('max_connections')::int
    AS limite,
  current_setting('superuser_reserved_connections')::int
    AS reservadas;

-- Rede de seguranca no servidor, para que codigo esquecido nao
-- consuma conexao indefinidamente. Vale por banco ou por papel.
ALTER DATABASE aplicacao SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE relatorios  SET statement_timeout = '30s';`,
        },
        {
          type: 'paragraph',
          value:
            'O tempo limite de sessão ociosa dentro de transação no final do exemplo é a única configuração do servidor que vale ajustar antes de qualquer mudança de limite. Ele transforma um vazamento silencioso, que consome conexão até alguém reiniciar o serviço, num erro imediato e atribuível ao caminho de código responsável. É uma configuração que gera reclamação no primeiro dia e evita incidente para sempre, porque o erro aparece no ambiente de testes com o mesmo comportamento que teria em produção.',
        },
        {
          type: 'list',
          items: [
            'Tempo de espera do pool no percentil noventa e cinco acima de cinquenta milissegundos por cinco minutos seguidos: a demanda encostou na capacidade e o esgotamento vem em seguida.',
            'Conexões em estado ocioso dentro de transação acima de dois por cento do total por três minutos: existe código segurando transação sem trabalhar, e o volume atual apenas ainda não expôs o problema.',
            'Razão entre conexões em uso e limite acima de setenta por cento no percentil noventa e cinco da janela de uma hora: a folga acabou e o próximo evento de escala provoca recusa, mesmo sem crescimento de tráfego.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que um pool pequeno entrega mais vazão que um pool grande se as requisições vão ficar na fila?',
      answer:
        'Porque a fila do pool é mais barata que a fila do banco, e as duas existem de qualquer jeito. Quando o pool é grande o suficiente para que todas as requisições recebam conexão imediatamente, elas não deixam de esperar: elas passam a esperar dentro do banco, competindo por CPU, por páginas do cache compartilhado e por bloqueios, e essa espera é destrutiva porque o próprio ato de coordenar mais processos consome recursos que deixam de executar consulta. Com o pool pequeno, a espera acontece antes de a requisição tocar o banco, o banco trabalha na concorrência em que é mais eficiente, e cada consulta termina no menor tempo possível, o que faz a conexão ficar disponível mais cedo para a próxima da fila. O efeito prático é que a vazão total sobe e a latência no percentil noventa e cinco cai ao mesmo tempo, o que parece contraditório mas é apenas a diferença entre uma fila ordenada e uma disputa. A analogia que costuma convencer o time é a do caixa de supermercado: dez caixas abertos com um operador cada atendem mais gente por hora do que trinta caixas abertos com o mesmo operador correndo entre eles. Existe um limite inferior, claro, e ele é dado pela vazão teórica: se a duração média da consulta multiplicada pelo pico de requisições por segundo exceder o tamanho do pool, a fila cresce sem parar e a resposta correta é reduzir a duração da consulta, não ampliar o pool.',
    },
    {
      question: 'Quando faz sentido separar pools por tipo de carga em vez de usar um pool único por aplicação?',
      answer:
        'Faz sentido no momento em que uma carga lenta e tolerante a atraso divide o mesmo pool com uma carga rápida e sensível a latência, porque nesse arranjo a lenta sempre vence a disputa por acidente. Um relatório que retém a conexão por oitocentos milissegundos ocupa o mesmo espaço que cento e sessenta consultas de checkout de cinco milissegundos, e como o pool não distingue as duas, uma sequência de relatórios simultâneos faz o checkout falhar. A separação em pools independentes, cada um com seu próprio limite, cria um isolamento que impede que uma carga consuma a capacidade da outra: o relatório passa a esperar na sua própria fila e o checkout mantém as conexões que lhe foram reservadas. A divisão que costuma funcionar tem três pools, um para tráfego síncrono de usuário com o maior orçamento e tempo limite de aquisição curto, um para processamento assíncrono com orçamento médio e tempo limite generoso, e um pequeno para trabalho analítico com orçamento mínimo e tempo limite de instrução agressivo. Vale acrescentar que o pool analítico é o candidato natural a apontar para uma réplica de leitura em vez do primário, o que remove a carga do banco principal em vez de apenas isolá-la. O custo da separação é que a soma dos limites precisa continuar respeitando a capacidade total do banco, então dividir pools sem revisar a conta apenas redistribui o esgotamento.',
    },
    {
      question: 'Como identificar qual caminho de código está segurando conexões por tempo demais quando nada mudou no tráfego?',
      answer:
        'O primeiro passo é garantir que cada conexão carregue a identificação de quem a abriu, porque sem isso o diagnóstico depende de adivinhação. A maioria dos drivers permite definir o nome da aplicação na conexão, e vale usar um valor composto pelo serviço e pela versão implantada, o que faz a origem aparecer diretamente nas visões de atividade do banco. Um passo além, mais barato do que parece, é anexar um comentário estruturado à consulta com o caminho de código, o identificador do rastro distribuído e o nome do trabalho, porque esse comentário viaja junto com o texto da consulta e aparece nas visões de estatística e nos registros de consulta lenta, o que permite atribuir uma conexão retida a uma rota específica sem instrumentação adicional. Com isso disponível, a consulta que lista sessões ociosas dentro de transação passa a responder diretamente qual rota é a responsável, em vez de mostrar apenas um identificador de processo anônimo. Do lado da aplicação, a métrica que fecha o diagnóstico é o histograma da duração da conexão em uso rotulado por caminho de código, porque ela expõe o percentil noventa e nove por rota e revela o caso raro que retém por segundos enquanto a mediana permanece em milissegundos. Quando nada mudou no tráfego e o pool passou a esgotar, a resposta quase sempre aparece nessa cauda: uma rota pouco usada que começou a esperar por uma dependência externa lenta dentro de uma transação, ou um laço que passou a percorrer uma lista que cresceu.',
    },
  ],
  conclusion: {
    title: 'O limite de conexões protege o banco, e o pool traduz capacidade em política',
    description:
      'O erro de conexão recusada raramente significa falta de conexões: ele significa que a demanda de concorrência ultrapassou o que o banco sustenta sem degradar, e aumentar o limite apenas troca um erro visível por lentidão sem culpado. Dimensionar o pool a partir da capacidade real, medir o tempo de espera antes que o erro apareça e tirar chamada externa de dentro da transação resolvem a maior parte dos casos sem tocar em infraestrutura. Posso dimensionar os pools do seu sistema a partir da capacidade do banco, instrumentar o tempo de espera e a duração da conexão em uso por caminho de código, revisar as transações que retêm conexão esperando rede, avaliar se o pool centralizado compensa no seu arranjo de escala e configurar os três alertas que dão antecedência real.',
    cta: 'Falar sobre o pool de conexões do meu sistema',
  },
  related: [
    {
      label: 'Timeout em cascata: quando o retry do cliente derruba o serviço',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The error arrived at eleven in the morning on an ordinary Tuesday, saying the database refused the connection because it had reached the client limit, and the team first reaction was to raise the maximum connection count on the server. It worked for forty minutes. Then the database started refusing again, now with CPU at ninety percent and queries that used to take two milliseconds taking four hundred. This article shows why raising the limit is the one answer that reliably makes things worse, which calculation sizes the pool from the real capacity of the database instead of from the number of containers, why the pool wait queue is the metric that sees the problem before the error shows up, how a transaction waiting on an HTTP response consumes a connection without using the database, what the practical difference is between a per process pool and a centralized pool and when each one pays off, and which three alerts surface exhaustion early enough to act on.',
  sections: [
    {
      title: 'A database connection is an expensive resource, not a cheap object',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The data access layer of most applications presents the connection as if it were an implementation detail, and the result is that almost nobody knows what it costs. On a relational database that uses one process per connection, such as PostgreSQL, every open connection corresponds to an operating system process with its own working memory area, its own catalog cache and its own share of the shared structures the database must scan on every transaction snapshot. The number that appears in the configuration file as the maximum limit is not an arbitrary lock somebody added out of caution: it is the capacity the database can sustain before the cost of coordinating processes starts consuming more than the useful work.',
        },
        {
          type: 'paragraph',
          value:
            'That explains the behavior that confuses whoever investigates the incident for the first time. While the number of active connections stays below the saturation point, adding concurrency increases throughput almost linearly, and the intuition that more connections means more capacity holds. Past that point, throughput stops growing and latency starts climbing, because queries begin competing for CPU, for shared cache pages and for disk tracks. Keep adding and throughput actually falls, and the system enters the region where more concurrency produces less completed work per second. The connection refused error appears near that region and is read as a shortage of connections, when in practice it is the database refusing to enter a regime where nobody would come out ahead.',
        },
        {
          type: 'diagram',
          value: `THROUGHPUT x ACTIVE CONNECTIONS (typical shape)

  throughput
   ^
   |            .--------.
   |          .'          '-.
   |        .'                '--.
   |      .'                       '---.
   |    .'                               '----.
   |  .'                                        '-----
   +--+-----------+------------+----------------------> active connections
      A           B            C

  A = underused: adding a connection raises throughput
  B = saturation point: near (cores x 2) + effective spindles
  C = collapse: more connections, less completed work per second

  The "too many clients" error shows up at C.
  Raising the limit moves the system to the RIGHT of C.`,
        },
        {
          type: 'paragraph',
          value:
            'From that comes the conclusion that drives everything else: the connection limit is not a safety ceiling getting in the way, it is the mechanism that stops the database from collapsing under excess concurrency. Raising the limit removes the protection without adding any capacity, and turns a fast, visible error the application can handle into a latency step spread across every request, which nobody can attribute to anything. The connection refused error is an annoying but honest symptom. The alternative produced by raising the limit is a slow system with no apparent culprit.',
        },
      ],
    },
    {
      title: 'The calculation that sizes the pool from database capacity',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Pool sizing is usually done backwards. Somebody takes the number of concurrent requests the application receives at peak, rounds it up and uses that as the pool size, because it seems reasonable that every request should have its own connection. The problem is that this reasoning starts from demand and ignores supply. The correct pool size does not come from the number of arriving requests, it comes from how much simultaneous work the database can execute without degrading, and that number is surprisingly small.',
        },
        {
          type: 'paragraph',
          value:
            'The most common starting rule estimates useful concurrency as twice the number of CPU cores on the database server plus the number of disks that serve effective parallel reads. Twice the cores exists because half of a typical query time is spent waiting on input and output, so each core can interleave two queries without going idle. On a machine with flash storage and a dataset that fits the shared cache, the disk term tends to zero and the number converges to twice the cores. An eight core server therefore sustains something close to sixteen to twenty connections doing work at the same time, and not the two hundred that the sum of the pools usually produces.',
        },
        {
          type: 'code',
          value: `// Pool sizing derived from database capacity,
// not from the number of concurrent application requests.

// 1) Useful database capacity (concurrency it sustains without degrading).
const DB_CORES = 8;
const EFFECTIVE_SPINDLES = 0;      // 0 on NVMe with dataset in cache
const RESERVED_CONNECTIONS = 5;    // superuser, replication, migration, backup

const usefulCapacity = DB_CORES * 2 + EFFECTIVE_SPINDLES;   // 16

// 2) Split across consumers. Every instance that opens a pool counts,
//    including workers, crons and report jobs, which are always forgotten.
const consumers = [
  { name: 'api', instances: 6, weight: 3 },          // synchronous traffic
  { name: 'queue-worker', instances: 4, weight: 2 }, // asynchronous processing
  { name: 'report-cron', instances: 1, weight: 1 },
];

const totalWeight = consumers.reduce(
  (sum, c) => sum + c.instances * c.weight,
  0,
);                                                    // 6*3 + 4*2 + 1*1 = 27

const budget = usefulCapacity - RESERVED_CONNECTIONS; // 11 usable connections

const plan = consumers.map((c) => {
  const share = (c.instances * c.weight) / totalWeight;
  const total = Math.max(1, Math.floor(budget * share));
  return {
    service: c.name,
    poolPerInstance: Math.max(1, Math.floor(total / c.instances)),
    serviceTotal: total,
  };
});

console.table(plan);
// api          -> pool 1 per instance, 7 total
// queue-worker -> pool 1 per instance, 3 total
// report-cron  -> pool 1, 1 total
//
// Total connected to the database: 11. It looks tiny and triggers an
// immediate reaction: "with pool 1 the api cannot serve 400 requests per
// second". It can, as long as the query takes 5 ms: 1 connection x
// (1000 / 5) = 200 req/s per instance, 1200 req/s across the set. The
// limit was never the connection, it was always how long each one is busy.

// 3) Check: theoretical throughput must cover the peak with headroom.
const AVG_DURATION_MS = 5;
const theoreticalThroughput = plan
  .filter((p) => p.service === 'api')
  .reduce((sum, p) => sum + p.serviceTotal * (1000 / AVG_DURATION_MS), 0);

console.log(\`api theoretical throughput: \${theoreticalThroughput} req/s\`);  // 1400 req/s`,
        },
        {
          type: 'paragraph',
          value:
            'The check at the end of the example is the part that changes the conversation inside the team. A small pool triggers immediate resistance because the number looks incompatible with the traffic volume, and the objection only dissolves once throughput is computed explicitly. One connection running five millisecond queries delivers two hundred queries per second. If the same query starts taking fifty milliseconds, it delivers twenty, and no pool size compensates for that, because the queue merely moves the wait inside the application. That is why optimizing the slow query frees more capacity than any pool tuning, and why sizing must come after measuring duration, never before.',
        },
      ],
    },
    {
      title: 'The pool wait queue is the metric that sees the problem coming',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Standard instrumentation of a connection pool usually exposes the number of active connections and the number of idle connections, and those two values say very little about health. A high count of active connections can mean either a healthy system working at its planned limit or a drowning one. What separates the two cases is a third metric, almost always available and almost never watched: the time a request spends waiting to receive a connection from the pool.',
        },
        {
          type: 'paragraph',
          value:
            'That metric has a property that makes it especially useful. It is zero while headroom exists and rises abruptly when the headroom runs out, which means it warns neither too early nor too late. Unlike the error rate, which only moves once the acquisition timeout has already been exceeded and the request has already failed, wait time starts rising the moment demand touches capacity, and typically gives one to five minutes of warning in a typical growth spike. Unlike the active connection count, it does not depend on pool size to be interpreted: any wait above zero means saturation, in any configuration.',
        },
        {
          type: 'table',
          columns: ['Metric', 'What it answers', 'When it moves', 'Practical limitation'],
          rows: [
            [
              'Active connections',
              'How many connections are running a query right now',
              'Together with traffic',
              'Does not distinguish healthy from drowning',
            ],
            [
              'Idle connections',
              'How much instant headroom the pool has',
              'Together with traffic',
              'Drops to zero before the problem shows, without saying how much is left',
            ],
            [
              'Connection wait time (p95)',
              'How long a request waits before doing work',
              'The instant demand touches capacity',
              'Requires explicit instrumentation in most pools',
            ],
            [
              'Connection hold time (p95)',
              'How long each connection stays checked out',
              'When a slow query or an external call enters the transaction',
              'Also rises for reasons outside the database, which is exactly its value',
            ],
            [
              'Acquisition timeouts per minute',
              'How many requests gave up waiting',
              'After the user has already seen the error',
              'Useful to confirm, never to prevent',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row deserves attention because it explains most exhaustions that have nothing to do with a traffic increase. Connection hold time rises when the connection stays checked out for something that is not the database, and when that happens the pool exhausts at the same volume as always. The most common cause is a network call inside a block that already opened the transaction, and that is the subject of the next section.',
        },
        {
          type: 'code',
          value: `// Minimal instrumentation of pool wait time.
// The idea works for any driver: measure the interval between asking for
// the connection and receiving it, separate from query execution time.

import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';

const pool = new Pool({
  max: 7,                          // from the sizing exercise, not a guess
  connectionTimeoutMillis: 2000,   // give up fast, do not wait forever
  idleTimeoutMillis: 30000,
});

export async function withConnection(label, run) {
  const requestedAt = performance.now();
  let client;

  try {
    client = await pool.connect();
  } catch (error) {
    metrics.increment('db.pool.acquisition_timeout', { label });
    throw error;
  }

  const waitMs = performance.now() - requestedAt;
  metrics.histogram('db.pool.wait_ms', waitMs, { label });

  const heldFrom = performance.now();
  try {
    return await run(client);
  } finally {
    metrics.histogram('db.pool.hold_ms', performance.now() - heldFrom, { label });
    client.release();
  }
}

// The per code path label is what makes the metric actionable: without it
// the dashboard shows that the pool saturated, with it the dashboard shows
// that what holds the connection for 800 ms is the report, not the checkout.`,
        },
      ],
    },
    {
      title: 'A transaction waiting on the network holds a connection without using the database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a class of exhaustion that appears in no traffic chart because traffic did not change. The pool exhausts, the database keeps low CPU, queries stay fast when run manually, and the sum of that leaves the team looking in the wrong place. The cause is almost always the same: some transaction started holding the connection while waiting for something that is not the database.',
        },
        {
          type: 'paragraph',
          value:
            'The pattern comes from a correct intention. The developer wants order creation and charge recording to be atomic, so they wrap both in a transaction. Since the charge happens at an external provider, the network call ends up inside the transactional block. While the provider answers in one hundred and fifty milliseconds, nobody notices. On the day the provider degrades to three seconds, every order holds a connection for three seconds, and a pool that comfortably served a hundred orders per minute saturates at ten. The database is entirely blameless and the database dashboard shows nothing.',
        },
        {
          type: 'code',
          value: `// WRONG: the HTTP call happens inside the transaction.
// The connection stays checked out for the external provider response time.
async function createOrderWrong(data) {
  return db.transaction(async (tx) => {
    const order = await tx.orders.insert(data);

    // Here the connection is open, with an active transaction, holding locks,
    // waiting on a service you do not control.
    const charge = await paymentGateway.charge({
      orderId: order.id,
      amount: order.total,
    });

    await tx.charges.insert({ orderId: order.id, externalId: charge.id });
    return order;
  });
}

// RIGHT: the transaction covers database work only.
// The external call moves out, and atomicity becomes a state machine.
async function createOrder(data) {
  // Transaction 1: short, writes local state and records the intent only.
  const order = await db.transaction(async (tx) => {
    const created = await tx.orders.insert({ ...data, status: 'awaiting_charge' });
    await tx.outbox.insert({
      type: 'charge.request',
      orderId: created.id,
      idempotencyKey: \`order-\${created.id}\`,
    });
    return created;
  });

  return order;
}

// The outbox worker makes the external call WITHOUT holding a database
// connection, and only takes one back to record the result.
async function processCharge(event) {
  const charge = await paymentGateway.charge({
    orderId: event.orderId,
    idempotencyKey: event.idempotencyKey,   // safe to retry
  });

  await db.transaction(async (tx) => {      // transaction 2: short again
    await tx.charges.insert({
      orderId: event.orderId,
      externalId: charge.id,
    });
    await tx.orders.update(event.orderId, { status: 'charged' });
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'The trade this design makes must be stated clearly so it does not look gratuitous. The wrong version offers real atomicity between the two writes, and the correct one does not: there is an interval where the order exists and the charge has not happened yet. What you get in exchange is that transaction duration stops depending on an external system, which means provider degradation becomes queue delay instead of pool exhaustion. Besides that, the atomicity of the wrong version was partly an illusion: if the application crashed after the charge and before the commit, the transaction would roll back and the customer would be charged with no order. The idempotency key in the worker solves that explicitly, which the transaction never did.',
        },
        {
          type: 'list',
          items: [
            'An HTTP call to an external service inside the transactional block, the most frequent and most expensive case.',
            'Writing to a queue or messaging topic before the commit, adding broker latency to transaction duration.',
            'A loop that processes a list item by item with one query per item, keeping the connection held for the whole traversal.',
            'Reading a file, generating a PDF or processing an image in the middle of the transaction, holding a connection during CPU work.',
            'Waiting on a lock held by another transaction, which does not show as a slow query because the query has not even started.',
            'A debugging session or interactive console left open against the production database, which alone consumes a connection for hours.',
          ],
        },
      ],
    },
    {
      title: 'Per process pool versus centralized pool',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The per process pool is the default arrangement and works well while the number of processes is stable and known. It stops working the moment autoscaling enters the picture, because the total of open connections becomes the pool size multiplied by a number that changes on its own. A ten connection pool across six instances consumes sixty connections, which is manageable. The same pool with scaling configured for forty instances at peak consumes four hundred, and the database limit is hit by the scaling policy and not by traffic.',
        },
        {
          type: 'paragraph',
          value:
            'There is a further complication that goes unnoticed in serverless environments, where each invocation may create its own pool. In that arrangement the number of connections tracks invocation concurrency, and the idea of sizing the pool loses meaning because there is no long lived process to hold it. That is the scenario where the centralized pool stops being an optimization and becomes a functional requirement.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Per process pool', 'Centralized pool'],
          rows: [
            [
              'Total connections at the database',
              'Pool size times instances, grows with scaling',
              'Fixed and configured in one place, independent of scaling',
            ],
            [
              'Behavior under autoscaling',
              'Every new instance opens connections, a scaling spike becomes a connection spike',
              'A new instance connects to the proxy, the database does not notice',
            ],
            [
              'Extra latency per query',
              'None',
              'One additional network hop, typically under a millisecond on the same network',
            ],
            [
              'Transactions and session resources',
              'Full support: long transactions, prepared statements, temporary tables',
              'Depends on the mode: in transaction mode, session resources break',
            ],
            [
              'Single point of failure',
              'Failure isolated per instance',
              'The proxy needs its own redundancy',
            ],
            [
              'When it pays off',
              'Stable and known instance count',
              'Autoscaling, serverless, many services on the same database',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The row about operating mode is the one that produces incidents when ignored. In transaction mode the proxy returns the physical connection to the set as soon as the transaction ends, which is exactly what allows serving many clients with few connections. The consequence is that any state tied to the session stops holding between one query and the next: named prepared statements, temporary tables, session variables and advisory locks. Migrating to that mode is simple on the configuration side and requires review on the application side, and the classic mistake is doing the first part and discovering the second in production, with the driver complaining about a prepared statement that no longer exists.',
        },
      ],
    },
    {
      title: 'Diagnostic sequence and the three alerts that give warning',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When the connection refused error shows up, the sequence below separates in a few minutes the three possible scenarios, which demand completely different answers: demand really grew, something is holding connections for too long, or there are abandoned connections nobody is using. Running the diagnosis in this order avoids the reflex answer of raising the limit.',
        },
        {
          type: 'ordered',
          items: [
            'List the connections by state and by originating application. If most sit idle inside a transaction, the problem is an open transaction doing no work and not a lack of capacity.',
            'Measure how old the oldest connection in each state is. A connection idle inside a transaction for over thirty seconds points to code that opened a transaction and went waiting on the network, on a lock or on human input.',
            'Compare total connections against the theoretical sum of the configured pools. If the total is larger, there is an uninventoried consumer: a migration, an analytics tool, an open console or a legacy service.',
            'Check pool wait time on the application side, not only on the database. High wait with few active connections means the application pool is undersized relative to what the database would accept.',
            'Measure query duration at the ninety fifth percentile over the last hour and compare it with the previous week. A query that doubled in duration doubles connection demand without a single extra user arriving.',
            'Only after ruling out the previous four, evaluate whether database capacity is really the limit, and in that case the decision is to grow the machine or move reads to a replica, not to raise the limit on the same machine.',
          ],
        },
        {
          type: 'code',
          value: `-- Diagnostic steps 1 to 3, in PostgreSQL.

-- 1) Distribution by state and originating application.
SELECT
  application_name,
  state,
  count(*) AS connections,
  max(now() - state_change) AS oldest
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY application_name, state
ORDER BY connections DESC;

-- 2) Open transactions with no active work: the most expensive pattern.
--    Every row here is a connection held without using the database.
SELECT
  pid,
  application_name,
  now() - xact_start   AS transaction_open_for,
  now() - state_change AS stalled_for,
  left(query, 120)     AS last_query
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '30 seconds'
ORDER BY stalled_for DESC;

-- 3) Real consumption against the configured limit.
SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')
    AS connections_in_use,
  current_setting('max_connections')::int
    AS limit_value,
  current_setting('superuser_reserved_connections')::int
    AS reserved;

-- Safety net at the server, so forgotten code does not consume a
-- connection indefinitely. Applies per database or per role.
ALTER DATABASE application SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE reporting      SET statement_timeout = '30s';`,
        },
        {
          type: 'paragraph',
          value:
            'The idle in transaction session timeout at the end of the example is the one server setting worth adjusting before any limit change. It turns a silent leak, which consumes a connection until somebody restarts the service, into an immediate error attributable to the responsible code path. It is a setting that generates complaints on day one and prevents incidents forever, because the error shows up in the test environment with the same behavior it would have in production.',
        },
        {
          type: 'list',
          items: [
            'Pool wait time at the ninety fifth percentile above fifty milliseconds for five consecutive minutes: demand touched capacity and exhaustion follows.',
            'Connections idle inside a transaction above two percent of the total for three minutes: some code is holding a transaction without working, and current volume merely has not exposed it yet.',
            'Ratio of connections in use to the limit above seventy percent at the ninety fifth percentile of a one hour window: the headroom is gone and the next scaling event causes refusals, even with no traffic growth.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does a small pool deliver more throughput than a large one if requests end up queued anyway?',
      answer:
        'Because the pool queue is cheaper than the database queue, and both exist either way. When the pool is large enough that every request gets a connection immediately, they do not stop waiting: they start waiting inside the database, competing for CPU, for shared cache pages and for locks, and that wait is destructive because the very act of coordinating more processes consumes resources that stop executing queries. With a small pool, the wait happens before the request touches the database, the database works at the concurrency where it is most efficient, and each query finishes in the shortest possible time, which frees the connection earlier for the next in line. The practical effect is that total throughput rises and ninety fifth percentile latency falls at the same time, which sounds contradictory but is merely the difference between an ordered queue and a scramble. The analogy that usually convinces a team is the supermarket checkout: ten open lanes with one operator each serve more people per hour than thirty open lanes with the same operator running between them. There is a lower bound, of course, and it comes from theoretical throughput: if average query duration times peak requests per second exceeds pool size, the queue grows without end and the correct answer is to reduce query duration, not to enlarge the pool.',
    },
    {
      question: 'When does it make sense to split pools by workload type instead of using one pool per application?',
      answer:
        'It makes sense the moment a slow, delay tolerant workload shares the same pool with a fast, latency sensitive one, because in that arrangement the slow one always wins the contention by accident. A report that holds a connection for eight hundred milliseconds occupies the same space as one hundred and sixty five millisecond checkout queries, and since the pool does not distinguish the two, a run of simultaneous reports makes checkout fail. Splitting into independent pools, each with its own limit, creates an isolation that stops one workload from consuming the other capacity: the report waits in its own queue and checkout keeps the connections reserved for it. The split that usually works has three pools, one for synchronous user traffic with the largest budget and a short acquisition timeout, one for asynchronous processing with a medium budget and a generous timeout, and a small one for analytical work with a minimal budget and an aggressive statement timeout. It is worth adding that the analytical pool is the natural candidate to point at a read replica rather than the primary, which removes load from the main database instead of merely isolating it. The cost of splitting is that the sum of the limits must still respect total database capacity, so dividing pools without revisiting the arithmetic merely redistributes the exhaustion.',
    },
    {
      question: 'How do you identify which code path is holding connections too long when nothing changed in traffic?',
      answer:
        'The first step is making sure every connection carries the identification of whoever opened it, because without that the diagnosis relies on guessing. Most drivers allow setting the application name on the connection, and it is worth using a value composed of the service and the deployed version, which makes the origin appear directly in the database activity views. One step further, cheaper than it sounds, is attaching a structured comment to the query with the code path, the distributed trace identifier and the job name, because that comment travels along with the query text and shows up in statistics views and slow query logs, which allows attributing a held connection to a specific route with no extra instrumentation. With that available, the query listing sessions idle inside a transaction starts answering directly which route is responsible, instead of showing only an anonymous process identifier. On the application side, the metric that closes the diagnosis is the connection hold time histogram labeled by code path, because it exposes the ninety ninth percentile per route and reveals the rare case that holds for seconds while the median stays in milliseconds. When nothing changed in traffic and the pool started exhausting, the answer almost always shows up in that tail: a rarely used route that started waiting on a slow external dependency inside a transaction, or a loop that started traversing a list that grew.',
    },
  ],
  conclusion: {
    title: 'The connection limit protects the database, and the pool turns capacity into policy',
    description:
      'The connection refused error rarely means a shortage of connections: it means concurrency demand exceeded what the database sustains without degrading, and raising the limit merely trades a visible error for slowness with no culprit. Sizing the pool from real capacity, measuring wait time before the error appears and moving external calls out of the transaction solve most cases without touching infrastructure. I can size the pools in your system from database capacity, instrument wait time and connection hold time per code path, review the transactions that hold connections waiting on the network, evaluate whether a centralized pool pays off in your scaling arrangement and configure the three alerts that give real warning.',
    cta: 'Talk about the connection pool in my system',
  },
  related: [
    {
      label: 'Cascading timeouts: when the client retry takes down the service',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El error llegó a las once de la mañana de un martes cualquiera, diciendo que la base rechazó la conexión porque alcanzó el límite de clientes, y la primera reacción del equipo fue aumentar el número máximo de conexiones en el servidor. Funcionó durante cuarenta minutos. Después la base volvió a rechazar, ahora con la CPU al noventa por ciento y consultas que antes tardaban dos milisegundos tardando cuatrocientos. Este artículo muestra por qué aumentar el límite es la única respuesta que empeora el problema de forma garantizada, cuál es la cuenta que dimensiona el pool a partir de la capacidad real de la base y no del número de contenedores, por qué la cola de espera del pool es la métrica que ve el problema antes de que aparezca el error, cómo una transacción que espera respuesta de HTTP consume una conexión sin usar la base, cuál es la diferencia práctica entre pool por proceso y pool centralizado y cuándo conviene cada uno, y qué tres alertas muestran el agotamiento con anticipación suficiente para actuar.',
  sections: [
    {
      title: 'La conexión de base de datos es un recurso caro, no un objeto barato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La capa de acceso a datos de la mayoría de las aplicaciones presenta la conexión como si fuera un detalle de implementación, y el resultado es que casi nadie sabe cuánto cuesta. En una base relacional que usa un proceso por conexión, como PostgreSQL, cada conexión abierta corresponde a un proceso del sistema operativo con su propia área de memoria de trabajo, su propia caché de catálogo y su propia participación en las estructuras compartidas que la base debe recorrer en cada snapshot de transacción. El número que aparece en el archivo de configuración como límite máximo no es una traba arbitraria que alguien puso por precaución: es la capacidad que la base logra sostener antes de que el costo de coordinar procesos pase a consumir más que el trabajo útil.',
        },
        {
          type: 'paragraph',
          value:
            'Eso explica el comportamiento que confunde a quien investiga el incidente por primera vez. Mientras el número de conexiones activas está por debajo del punto de saturación, agregar concurrencia aumenta el rendimiento de forma casi lineal, y la intuición de que más conexiones significa más capacidad se confirma. Después de ese punto, el rendimiento deja de crecer y la latencia empieza a subir, porque las consultas pasan a competir por CPU, por páginas de la caché compartida y por pistas de disco. Si se sigue agregando, el rendimiento cae de verdad, y el sistema entra en la región donde más concurrencia produce menos trabajo terminado por segundo. El error de conexión rechazada aparece cerca de esa región y se interpreta como falta de conexiones, cuando en la práctica es la base negándose a entrar en un régimen donde nadie saldría ganando.',
        },
        {
          type: 'diagram',
          value: `RENDIMIENTO x CONEXIONES ACTIVAS (forma tipica)

  rendimiento
   ^
   |            .--------.
   |          .'          '-.
   |        .'                '--.
   |      .'                       '---.
   |    .'                               '----.
   |  .'                                        '-----
   +--+-----------+------------+----------------------> conexiones activas
      A           B            C

  A = subutilizado: agregar conexion aumenta rendimiento
  B = punto de saturacion: cerca de (nucleos x 2) + discos efectivos
  C = colapso: mas conexiones, menos trabajo terminado por segundo

  El error "too many clients" aparece en C.
  Aumentar el limite mueve el sistema a la DERECHA de C.`,
        },
        {
          type: 'paragraph',
          value:
            'De ahí viene la conclusión que orienta todo lo demás: el límite de conexiones no es un techo de seguridad que estorba, es el mecanismo que impide que la base colapse por exceso de concurrencia. Aumentar el límite quita la protección sin agregar capacidad alguna, y convierte un error rápido y visible, que la aplicación puede tratar, en un escalón de latencia repartido por todas las peticiones, que nadie logra atribuir a nada. El error de conexión rechazada es un síntoma incómodo pero honesto. La alternativa que produce aumentar el límite es un sistema lento sin culpable aparente.',
        },
      ],
    },
    {
      title: 'La cuenta que dimensiona el pool a partir de la capacidad de la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El dimensionamiento del pool suele hacerse al revés. Alguien toma el número de peticiones simultáneas que la aplicación recibe en el pico, redondea hacia arriba y lo usa como tamaño del pool, porque parece razonable que cada petición tenga su conexión. El problema es que ese razonamiento parte de la demanda e ignora la oferta. El tamaño correcto del pool no viene del número de peticiones que llegan, viene de cuánto trabajo simultáneo logra ejecutar la base sin degradarse, y ese número es sorprendentemente pequeño.',
        },
        {
          type: 'paragraph',
          value:
            'La regla de partida más usada estima la concurrencia útil como el doble del número de núcleos de CPU del servidor de base sumado al número de discos que sirven lecturas efectivas en paralelo. El doble de los núcleos existe porque la mitad del tiempo de una consulta típica se gasta esperando entrada y salida, así que cada núcleo logra intercalar dos consultas sin quedar ocioso. En una máquina con almacenamiento flash y un conjunto de datos que cabe en la caché compartida, la parte de disco tiende a cero y el número converge al doble de los núcleos. Un servidor de ocho núcleos, por lo tanto, sostiene algo cercano a dieciséis o veinte conexiones ejecutando trabajo al mismo tiempo, y no las doscientas que la suma de los pools suele producir.',
        },
        {
          type: 'code',
          value: `// Dimensionamiento del pool a partir de la capacidad de la base,
// y no del numero de peticiones simultaneas de la aplicacion.

// 1) Capacidad util de la base (concurrencia que sostiene sin degradarse).
const NUCLEOS_BASE = 8;
const DISCOS_EFECTIVOS = 0;         // 0 en NVMe con dataset en cache
const CONEXIONES_RESERVADAS = 5;    // superusuario, replicacion, migracion, backup

const capacidadUtil = NUCLEOS_BASE * 2 + DISCOS_EFECTIVOS;   // 16

// 2) Reparto entre los consumidores. Toda instancia que abre pool cuenta,
//    incluidos worker, cron y job de reportes, que siempre se olvidan.
const consumidores = [
  { nombre: 'api', instancias: 6, peso: 3 },        // trafico sincrono
  { nombre: 'worker-cola', instancias: 4, peso: 2 }, // procesamiento asincrono
  { nombre: 'cron-reporte', instancias: 1, peso: 1 },
];

const pesoTotal = consumidores.reduce(
  (suma, c) => suma + c.instancias * c.peso,
  0,
);                                                   // 6*3 + 4*2 + 1*1 = 27

const presupuesto = capacidadUtil - CONEXIONES_RESERVADAS; // 11 conexiones utiles

const plan = consumidores.map((c) => {
  const porcion = (c.instancias * c.peso) / pesoTotal;
  const total = Math.max(1, Math.floor(presupuesto * porcion));
  return {
    servicio: c.nombre,
    poolPorInstancia: Math.max(1, Math.floor(total / c.instancias)),
    totalDelServicio: total,
  };
});

console.table(plan);
// api          -> pool 1 por instancia, 7 en total
// worker-cola  -> pool 1 por instancia, 3 en total
// cron-reporte -> pool 1, 1 en total
//
// Total conectado a la base: 11. Parece poco y provoca una reaccion
// inmediata: "con pool 1 la api no aguanta 400 peticiones por segundo".
// Si aguanta, siempre que la consulta dure 5 ms: 1 conexion x (1000 / 5)
// = 200 pet/s por instancia, 1200 pet/s en el conjunto. El limite nunca
// fue la conexion, siempre fue el tiempo que cada una queda ocupada.

// 3) Verificacion: el rendimiento teorico debe cubrir el pico con holgura.
const DURACION_MEDIA_MS = 5;
const rendimientoTeorico = plan
  .filter((p) => p.servicio === 'api')
  .reduce((suma, p) => suma + p.totalDelServicio * (1000 / DURACION_MEDIA_MS), 0);

console.log(\`rendimiento teorico de la api: \${rendimientoTeorico} pet/s\`);  // 1400 pet/s`,
        },
        {
          type: 'paragraph',
          value:
            'La verificación al final del ejemplo es la parte que cambia la conversación dentro del equipo. Un pool pequeño provoca resistencia inmediata porque el número parece incompatible con el volumen de tráfico, y la objeción solo se disuelve cuando el rendimiento se calcula explícitamente. Una conexión que ejecuta consultas de cinco milisegundos entrega doscientas consultas por segundo. Si la misma consulta pasa a tardar cincuenta milisegundos, entrega veinte, y ningún tamaño de pool compensa eso, porque la cola solo traslada la espera hacia dentro de la aplicación. Por eso optimizar la consulta lenta libera más capacidad que cualquier ajuste de pool, y por eso el dimensionamiento tiene que venir después de medir la duración, nunca antes.',
        },
      ],
    },
    {
      title: 'La cola de espera del pool es la métrica que ve venir el problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La instrumentación estándar de un pool de conexiones suele exponer el número de conexiones activas y el número de conexiones ociosas, y esos dos valores dicen muy poco sobre salud. Un número alto de conexiones activas puede significar tanto un sistema sano trabajando en el límite planificado como uno ahogado. Lo que separa los dos casos es una tercera métrica, casi siempre disponible y casi nunca observada: el tiempo que una petición pasa esperando para recibir una conexión del pool.',
        },
        {
          type: 'paragraph',
          value:
            'Esa métrica tiene una propiedad que la vuelve especialmente útil. Es cero mientras existe holgura y sube de forma abrupta cuando la holgura se acaba, lo que significa que no avisa ni demasiado temprano ni demasiado tarde. A diferencia de la tasa de error, que solo se mueve cuando el tiempo límite de adquisición ya se superó y la petición ya falló, el tiempo de espera empieza a subir en el momento en que la demanda toca la capacidad, y suele dar de uno a cinco minutos de anticipación en un pico de crecimiento típico. A diferencia del número de conexiones activas, no depende del tamaño del pool para interpretarse: espera por encima de cero significa saturación, en cualquier configuración.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Qué responde', 'Cuándo se mueve', 'Límite práctico'],
          rows: [
            [
              'Conexiones activas',
              'Cuántas conexiones están ejecutando consulta ahora',
              'Junto con el tráfico',
              'No distingue sano de ahogado',
            ],
            [
              'Conexiones ociosas',
              'Cuánta holgura instantánea hay en el pool',
              'Junto con el tráfico',
              'Cae a cero antes de que aparezca el problema, sin avisar cuánto falta',
            ],
            [
              'Tiempo de espera por conexión (p95)',
              'Cuánto espera la petición antes de trabajar',
              'En el instante en que la demanda toca la capacidad',
              'Requiere instrumentación explícita en la mayoría de los pools',
            ],
            [
              'Duración de la conexión en uso (p95)',
              'Cuánto tiempo queda retenida cada conexión',
              'Cuando entra consulta lenta o llamada externa en la transacción',
              'Sube también por causas fuera de la base, que es justamente su valor',
            ],
            [
              'Timeouts de adquisición por minuto',
              'Cuántas peticiones desistieron de esperar',
              'Después de que el usuario ya vio el error',
              'Sirve para confirmar, nunca para prevenir',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila merece atención porque explica la mayor parte de los agotamientos que no tienen relación con un aumento de tráfico. La duración de la conexión en uso sube cuando la conexión queda retenida por algo que no es la base, y cuando eso pasa el pool se agota con el mismo volumen de siempre. La causa más común es una llamada de red dentro de un bloque que ya abrió la transacción, y es el tema de la siguiente sección.',
        },
        {
          type: 'code',
          value: `// Instrumentacion minima del tiempo de espera del pool.
// La idea vale para cualquier driver: medir el intervalo entre pedir la
// conexion y recibirla, separado del tiempo de ejecucion de la consulta.

import { Pool } from 'pg';
import { performance } from 'node:perf_hooks';

const pool = new Pool({
  max: 7,                          // del dimensionamiento, no de la corazonada
  connectionTimeoutMillis: 2000,   // desistir rapido, no esperar sin limite
  idleTimeoutMillis: 30000,
});

export async function conConexion(etiqueta, ejecutar) {
  const pedidoEn = performance.now();
  let cliente;

  try {
    cliente = await pool.connect();
  } catch (error) {
    metricas.incrementar('db.pool.timeout_adquisicion', { etiqueta });
    throw error;
  }

  const esperaMs = performance.now() - pedidoEn;
  metricas.histograma('db.pool.espera_ms', esperaMs, { etiqueta });

  const usoEn = performance.now();
  try {
    return await ejecutar(cliente);
  } finally {
    metricas.histograma('db.pool.uso_ms', performance.now() - usoEn, { etiqueta });
    cliente.release();
  }
}

// La etiqueta por camino de codigo es lo que vuelve accionable la metrica:
// sin ella el panel muestra que el pool se saturo, con ella muestra que
// quien retiene la conexion 800 ms es el reporte, no el checkout.`,
        },
      ],
    },
    {
      title: 'La transacción que espera respuesta de red consume conexión sin usar la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una categoría de agotamiento que no aparece en ningún gráfico de tráfico porque el tráfico no cambió. El pool se agota, la base sigue con CPU baja, las consultas siguen rápidas cuando se ejecutan manualmente, y la suma de eso deja al equipo buscando en el lugar equivocado. La causa es casi siempre la misma: alguna transacción pasó a retener la conexión mientras espera por algo que no es la base.',
        },
        {
          type: 'paragraph',
          value:
            'El patrón nace de una intención correcta. La persona que desarrolla quiere que la creación del pedido y el registro del cobro sean atómicos, así que envuelve ambos en una transacción. Como el cobro ocurre en un proveedor externo, la llamada de red termina dentro del bloque transaccional. Mientras el proveedor responde en ciento cincuenta milisegundos, nadie lo nota. El día en que el proveedor se degrada a tres segundos, cada pedido pasa a retener una conexión por tres segundos, y un pool que atendía tranquilamente cien pedidos por minuto se satura con diez. La base no tiene culpa alguna y el panel de la base no muestra nada.',
        },
        {
          type: 'code',
          value: `// INCORRECTO: la llamada HTTP ocurre dentro de la transaccion.
// La conexion queda retenida por el tiempo de respuesta del proveedor externo.
async function crearPedidoIncorrecto(datos) {
  return db.transaction(async (tx) => {
    const pedido = await tx.pedidos.insert(datos);

    // Aqui la conexion esta abierta, con transaccion activa, reteniendo locks,
    // esperando un servicio que no controlas.
    const cobro = await pasarelaPago.cobrar({
      pedidoId: pedido.id,
      monto: pedido.total,
    });

    await tx.cobros.insert({ pedidoId: pedido.id, externoId: cobro.id });
    return pedido;
  });
}

// CORRECTO: la transaccion cubre solo el trabajo de base de datos.
// La llamada externa queda fuera, y la atomicidad pasa a ser una maquina de estados.
async function crearPedido(datos) {
  // Transaccion 1: corta, solo escribe estado local y registra la intencion.
  const pedido = await db.transaction(async (tx) => {
    const creado = await tx.pedidos.insert({ ...datos, estado: 'esperando_cobro' });
    await tx.outbox.insert({
      tipo: 'cobro.solicitar',
      pedidoId: creado.id,
      claveIdempotencia: \`pedido-\${creado.id}\`,
    });
    return creado;
  });

  return pedido;
}

// El worker del outbox hace la llamada externa SIN conexion de base retenida,
// y solo toma una de vuelta para grabar el resultado.
async function procesarCobro(evento) {
  const cobro = await pasarelaPago.cobrar({
    pedidoId: evento.pedidoId,
    claveIdempotencia: evento.claveIdempotencia,  // seguro para reintento
  });

  await db.transaction(async (tx) => {           // transaccion 2: corta de nuevo
    await tx.cobros.insert({
      pedidoId: evento.pedidoId,
      externoId: cobro.id,
    });
    await tx.pedidos.update(evento.pedidoId, { estado: 'cobrado' });
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'El intercambio que hace este diseño hay que decirlo con claridad para que no parezca gratuito. La versión incorrecta ofrece atomicidad real entre las dos escrituras, y la correcta no: existe un intervalo en el que el pedido está creado y el cobro todavía no ocurrió. Lo que se gana a cambio es que la duración de la transacción deja de depender de un sistema externo, lo que significa que la degradación del proveedor se convierte en retraso en la cola en vez de agotamiento del pool. Además, la atomicidad de la versión incorrecta era parcialmente ilusoria: si la aplicación caía después del cobro y antes del commit, la transacción hacía rollback y el cliente quedaba cobrado sin pedido. La clave de idempotencia en el worker resuelve eso de forma explícita, lo que la transacción nunca resolvió.',
        },
        {
          type: 'list',
          items: [
            'Llamada HTTP a servicio externo dentro del bloque transaccional, el caso más frecuente y el más caro.',
            'Escritura en cola o tópico de mensajería antes del commit, que agrega la latencia del broker a la duración de la transacción.',
            'Bucle que procesa una lista elemento por elemento con una consulta por elemento, manteniendo la conexión retenida durante todo el recorrido.',
            'Lectura de archivo, generación de PDF o procesamiento de imagen en medio de la transacción, reteniendo conexión durante trabajo de CPU.',
            'Espera por un bloqueo de otra transacción, que no aparece como consulta lenta porque la consulta ni siquiera empezó.',
            'Sesión de depuración o consola interactiva abierta contra la base de producción, que por sí sola consume una conexión durante horas.',
          ],
        },
      ],
    },
    {
      title: 'Pool por proceso frente a pool centralizado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El pool por proceso es el arreglo por defecto y funciona bien mientras el número de procesos es estable y conocido. Deja de funcionar en el momento en que entra en escena el escalado automático, porque el total de conexiones abiertas pasa a ser el tamaño del pool multiplicado por un número que cambia solo. Un pool de diez conexiones en seis instancias consume sesenta conexiones, lo que es administrable. El mismo pool con el escalado configurado para cuarenta instancias en el pico consume cuatrocientas, y el límite de la base se alcanza por la política de escalado y no por el tráfico.',
        },
        {
          type: 'paragraph',
          value:
            'Hay además un agravante que pasa desapercibido en entornos sin servidor dedicado, donde cada invocación puede crear su propio pool. En ese arreglo el número de conexiones acompaña la concurrencia de invocaciones, y la idea de dimensionar el pool pierde sentido porque no existe un proceso de vida larga que lo sostenga. Es el escenario en el que el pool centralizado deja de ser una optimización y pasa a ser un requisito de funcionamiento.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Pool por proceso', 'Pool centralizado'],
          rows: [
            [
              'Total de conexiones en la base',
              'Tamaño del pool por instancias, crece con el escalado',
              'Fijo y configurado en un solo punto, independiente del escalado',
            ],
            [
              'Comportamiento en escalado automático',
              'Cada instancia nueva abre conexiones, el pico de escalado se vuelve pico de conexión',
              'La instancia nueva se conecta al intermediario, la base no lo percibe',
            ],
            [
              'Latencia adicional por consulta',
              'Ninguna',
              'Un salto de red más, típicamente por debajo de un milisegundo en la misma red',
            ],
            [
              'Transacción y recursos de sesión',
              'Soporte total: transacción larga, prepared statement, tabla temporal',
              'Depende del modo: en modo por transacción, los recursos de sesión se rompen',
            ],
            [
              'Punto único de falla',
              'Falla aislada por instancia',
              'El intermediario necesita redundancia propia',
            ],
            [
              'Cuándo compensa',
              'Número de instancias estable y conocido',
              'Escalado automático, entorno sin servidor, muchos servicios en la misma base',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La fila sobre el modo de operación es la que produce incidentes cuando se ignora. En modo por transacción, el intermediario devuelve la conexión física al conjunto en cuanto termina la transacción, que es justamente lo que permite atender a muchos clientes con pocas conexiones. La consecuencia es que cualquier estado atado a la sesión deja de valer entre una consulta y la siguiente: prepared statements con nombre, tablas temporales, variables de sesión y bloqueos consultivos. La migración a ese modo es simple del lado de la configuración y exige revisión del lado de la aplicación, y el error clásico es hacer la primera parte y descubrir la segunda en producción, con el driver quejándose de un prepared statement que ya no existe.',
        },
      ],
    },
    {
      title: 'Secuencia de diagnóstico y las tres alertas que dan anticipación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando aparece el error de conexión rechazada, la secuencia de abajo separa en pocos minutos los tres escenarios posibles, que exigen respuestas completamente distintas: la demanda creció de verdad, algo está reteniendo conexiones demasiado tiempo, o existen conexiones abandonadas que nadie está usando. Hacer el diagnóstico en ese orden evita la respuesta refleja de aumentar el límite.',
        },
        {
          type: 'ordered',
          items: [
            'Liste las conexiones por estado y por aplicación de origen. Si la mayoría está en estado ocioso dentro de transacción, el problema es una transacción abierta sin trabajo y no falta de capacidad.',
            'Mida el tiempo de la conexión más antigua en cada estado. Una conexión ociosa dentro de transacción hace más de treinta segundos indica código que abrió transacción y se fue a esperar por red, por bloqueo o por entrada humana.',
            'Compare el total de conexiones con la suma teórica de los pools configurados. Si el total es mayor, existe algún consumidor no inventariado: migración, herramienta de análisis, consola abierta o servicio heredado.',
            'Verifique el tiempo de espera del pool en la aplicación, y no solo en la base. Espera alta con pocas conexiones activas significa que el pool de la aplicación está subdimensionado frente a lo que la base aceptaría.',
            'Mida la duración de las consultas en el percentil noventa y cinco de la última hora y compárela con la semana anterior. Una consulta que duplicó su duración duplica la demanda de conexiones sin que haya llegado ni un usuario más.',
            'Solo después de descartar los cuatro anteriores, evalúe si la capacidad de la base es realmente el límite, y en ese caso la decisión es ampliar la máquina o distribuir la lectura a una réplica, no aumentar el límite en la misma máquina.',
          ],
        },
        {
          type: 'code',
          value: `-- Pasos 1 a 3 del diagnostico, en PostgreSQL.

-- 1) Distribucion por estado y por aplicacion de origen.
SELECT
  application_name,
  state,
  count(*) AS conexiones,
  max(now() - state_change) AS mas_antigua
FROM pg_stat_activity
WHERE backend_type = 'client backend'
GROUP BY application_name, state
ORDER BY conexiones DESC;

-- 2) Transacciones abiertas sin trabajo activo: el patron mas caro.
--    Cada fila aqui es una conexion retenida sin usar la base.
SELECT
  pid,
  application_name,
  now() - xact_start   AS transaccion_abierta_hace,
  now() - state_change AS detenida_hace,
  left(query, 120)     AS ultima_consulta
FROM pg_stat_activity
WHERE state = 'idle in transaction'
  AND now() - state_change > interval '30 seconds'
ORDER BY detenida_hace DESC;

-- 3) Consumo real contra el limite configurado.
SELECT
  (SELECT count(*) FROM pg_stat_activity WHERE backend_type = 'client backend')
    AS conexiones_en_uso,
  current_setting('max_connections')::int
    AS limite,
  current_setting('superuser_reserved_connections')::int
    AS reservadas;

-- Red de seguridad en el servidor, para que codigo olvidado no consuma
-- conexion indefinidamente. Vale por base o por rol.
ALTER DATABASE aplicacion SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE reportes      SET statement_timeout = '30s';`,
        },
        {
          type: 'paragraph',
          value:
            'El tiempo límite de sesión ociosa dentro de transacción al final del ejemplo es la única configuración del servidor que vale ajustar antes de cualquier cambio de límite. Convierte una fuga silenciosa, que consume conexión hasta que alguien reinicia el servicio, en un error inmediato y atribuible al camino de código responsable. Es una configuración que genera reclamos el primer día y evita incidentes para siempre, porque el error aparece en el entorno de pruebas con el mismo comportamiento que tendría en producción.',
        },
        {
          type: 'list',
          items: [
            'Tiempo de espera del pool en el percentil noventa y cinco por encima de cincuenta milisegundos durante cinco minutos seguidos: la demanda tocó la capacidad y el agotamiento viene enseguida.',
            'Conexiones en estado ocioso dentro de transacción por encima del dos por ciento del total durante tres minutos: hay código reteniendo transacción sin trabajar, y el volumen actual solo todavía no expuso el problema.',
            'Razón entre conexiones en uso y límite por encima del setenta por ciento en el percentil noventa y cinco de una ventana de una hora: la holgura se acabó y el próximo evento de escalado provoca rechazos, incluso sin crecimiento de tráfico.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué un pool pequeño entrega más rendimiento que uno grande si las peticiones van a quedar en cola igual?',
      answer:
        'Porque la cola del pool es más barata que la cola de la base, y las dos existen de todos modos. Cuando el pool es lo bastante grande para que todas las peticiones reciban conexión de inmediato, no dejan de esperar: pasan a esperar dentro de la base, compitiendo por CPU, por páginas de la caché compartida y por bloqueos, y esa espera es destructiva porque el propio acto de coordinar más procesos consume recursos que dejan de ejecutar consultas. Con el pool pequeño, la espera ocurre antes de que la petición toque la base, la base trabaja en la concurrencia donde es más eficiente, y cada consulta termina en el menor tiempo posible, lo que deja la conexión disponible antes para la siguiente de la cola. El efecto práctico es que el rendimiento total sube y la latencia en el percentil noventa y cinco baja al mismo tiempo, lo que parece contradictorio pero es apenas la diferencia entre una cola ordenada y una disputa. La analogía que suele convencer al equipo es la de las cajas del supermercado: diez cajas abiertas con un operador cada una atienden a más gente por hora que treinta cajas abiertas con el mismo operador corriendo entre ellas. Existe un límite inferior, claro, y lo da el rendimiento teórico: si la duración media de la consulta multiplicada por el pico de peticiones por segundo supera el tamaño del pool, la cola crece sin parar y la respuesta correcta es reducir la duración de la consulta, no ampliar el pool.',
    },
    {
      question: '¿Cuándo tiene sentido separar pools por tipo de carga en vez de usar un pool único por aplicación?',
      answer:
        'Tiene sentido en el momento en que una carga lenta y tolerante al retraso comparte el mismo pool con una carga rápida y sensible a la latencia, porque en ese arreglo la lenta siempre gana la disputa por accidente. Un reporte que retiene la conexión ochocientos milisegundos ocupa el mismo espacio que ciento sesenta consultas de checkout de cinco milisegundos, y como el pool no distingue las dos, una secuencia de reportes simultáneos hace que el checkout falle. La separación en pools independientes, cada uno con su propio límite, crea un aislamiento que impide que una carga consuma la capacidad de la otra: el reporte pasa a esperar en su propia cola y el checkout mantiene las conexiones que le fueron reservadas. La división que suele funcionar tiene tres pools, uno para tráfico síncrono de usuario con el mayor presupuesto y un tiempo límite de adquisición corto, uno para procesamiento asíncrono con presupuesto medio y tiempo límite generoso, y uno pequeño para trabajo analítico con presupuesto mínimo y tiempo límite de instrucción agresivo. Vale agregar que el pool analítico es el candidato natural a apuntar a una réplica de lectura en vez del primario, lo que quita carga de la base principal en vez de solo aislarla. El costo de la separación es que la suma de los límites tiene que seguir respetando la capacidad total de la base, así que dividir pools sin revisar la cuenta solo redistribuye el agotamiento.',
    },
    {
      question: '¿Cómo identificar qué camino de código está reteniendo conexiones demasiado tiempo cuando nada cambió en el tráfico?',
      answer:
        'El primer paso es garantizar que cada conexión lleve la identificación de quien la abrió, porque sin eso el diagnóstico depende de adivinar. La mayoría de los drivers permite definir el nombre de la aplicación en la conexión, y conviene usar un valor compuesto por el servicio y la versión desplegada, lo que hace que el origen aparezca directamente en las vistas de actividad de la base. Un paso más allá, más barato de lo que parece, es adjuntar un comentario estructurado a la consulta con el camino de código, el identificador de la traza distribuida y el nombre del trabajo, porque ese comentario viaja junto con el texto de la consulta y aparece en las vistas de estadística y en los registros de consulta lenta, lo que permite atribuir una conexión retenida a una ruta específica sin instrumentación adicional. Con eso disponible, la consulta que lista sesiones ociosas dentro de transacción pasa a responder directamente qué ruta es la responsable, en vez de mostrar solo un identificador de proceso anónimo. Del lado de la aplicación, la métrica que cierra el diagnóstico es el histograma de la duración de la conexión en uso etiquetado por camino de código, porque expone el percentil noventa y nueve por ruta y revela el caso raro que retiene durante segundos mientras la mediana permanece en milisegundos. Cuando nada cambió en el tráfico y el pool empezó a agotarse, la respuesta casi siempre aparece en esa cola: una ruta poco usada que empezó a esperar por una dependencia externa lenta dentro de una transacción, o un bucle que pasó a recorrer una lista que creció.',
    },
  ],
  conclusion: {
    title: 'El límite de conexiones protege la base, y el pool traduce capacidad en política',
    description:
      'El error de conexión rechazada rara vez significa falta de conexiones: significa que la demanda de concurrencia superó lo que la base sostiene sin degradarse, y aumentar el límite solo cambia un error visible por lentitud sin culpable. Dimensionar el pool a partir de la capacidad real, medir el tiempo de espera antes de que aparezca el error y sacar la llamada externa de dentro de la transacción resuelven la mayor parte de los casos sin tocar infraestructura. Puedo dimensionar los pools de su sistema a partir de la capacidad de la base, instrumentar el tiempo de espera y la duración de la conexión en uso por camino de código, revisar las transacciones que retienen conexión esperando red, evaluar si el pool centralizado compensa en su arreglo de escalado y configurar las tres alertas que dan anticipación real.',
    cta: 'Hablar sobre el pool de conexiones de mi sistema',
  },
  related: [
    {
      label: 'Timeout en cascada: cuando el retry del cliente tumba el servicio',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
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
