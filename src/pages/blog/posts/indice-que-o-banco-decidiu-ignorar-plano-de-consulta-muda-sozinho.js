// Conteudo do artigo: por que o banco para de usar um indice existente e o
// plano de consulta muda sem que ninguem altere codigo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A consulta rodava em quatro milissegundos havia dois anos, ninguém alterou o código, ninguém alterou o índice, e numa quarta-feira ela passou a levar onze segundos e derrubou o painel do time comercial. O índice continuava lá, íntegro, e o banco simplesmente decidiu não usá-lo. Este artigo mostra por que o plano de consulta é uma decisão recalculada e não uma propriedade fixa da consulta, quais quatro entradas do otimizador mudam sozinhas em produção, por que a estatística desatualizada e a correlação entre colunas produzem o mesmo sintoma por caminhos opostos, como o parâmetro capturado na primeira execução condena todas as execuções seguintes, qual a diferença entre estabilizar o plano e esconder o problema, e quais três alertas pegam a mudança de plano antes do cliente.',
  sections: [
    {
      title: 'O plano não é da consulta, é do momento em que ela foi planejada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição de quem escreve SQL é que a consulta descreve o resultado e o banco descreve o caminho, e essa parte está certa. O que quase sempre falta é o passo seguinte: o caminho é escolhido por um otimizador baseado em custo, que estima quantas linhas cada operação vai devolver e escolhe o plano mais barato segundo essa estimativa. A estimativa não é uma medição, é uma projeção feita a partir de estatísticas amostradas em algum momento do passado. Nada disso é estável, e nenhuma parte disso está no seu código.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência é que a mesma consulta pode ter planos diferentes em dias diferentes sem que uma linha tenha mudado. Isso não é um defeito do banco, é o comportamento desejado: se a tabela cresceu de dez mil para dez milhões de linhas, o plano correto mudou de verdade, e um otimizador que insistisse no plano antigo seria pior. O problema aparece quando a estimativa está errada, porque aí o otimizador escolhe corretamente segundo uma realidade que não existe.',
        },
        {
          type: 'paragraph',
          value:
            'A pergunta útil quando uma consulta degrada sem alteração de código não é o que mudou no código, é qual das entradas do otimizador mudou. Existem quatro, e cada uma tem um sintoma e um teste próprios.',
        },
        {
          type: 'table',
          columns: ['Entrada do otimizador', 'O que muda sozinho', 'Sintoma típico', 'Como confirmar'],
          rows: [
            [
              'Estatísticas de distribuição',
              'Envelhecem conforme a tabela cresce ou muda de perfil',
              'Estimativa de linhas ordens de grandeza abaixo do real',
              'Comparar linhas estimadas com linhas retornadas no plano executado',
            ],
            [
              'Parâmetro capturado no primeiro planejamento',
              'Depende de qual valor chegou primeiro após reinício ou invalidação',
              'Consulta rápida para um cliente e lenta para outro, mesmo SQL',
              'Executar com valor literal e comparar com a versão parametrizada',
            ],
            [
              'Volume e seletividade real dos dados',
              'Cresce com o negócio, muda com sazonalidade',
              'Degradação gradual que vira degrau ao cruzar um limiar',
              'Histórico de tempo médio contra histórico de contagem de linhas',
            ],
            [
              'Correlação entre colunas do filtro',
              'Aparece quando dados novos criam dependência entre campos',
              'Estimativa erra por multiplicação de seletividades independentes',
              'Contar linhas do filtro combinado e comparar com o produto das partes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas linhas que mais enganam são a terceira e a quarta. A degradação por volume parece contínua, mas na prática é um degrau: enquanto o custo estimado da varredura sequencial for maior que o do índice, nada acontece, e no dia em que a tabela cruza o ponto de empate o plano vira de uma execução para a outra. A correlação entre colunas é ainda mais silenciosa, porque o otimizador supõe independência por padrão. Se você filtra por cidade e por estado, ele multiplica as duas seletividades como se fossem eventos independentes e estima cem vezes menos linhas do que existem, quando na verdade cidade determina estado.',
        },
      ],
    },
    {
      title: 'Ler o plano executado, não o plano estimado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro operacional mais comum na investigação é olhar apenas o plano estimado. Ele mostra o que o otimizador pretende fazer e quantas linhas ele acha que vai encontrar, e é exatamente essa crença que está errada quando a consulta degrada. O que resolve o diagnóstico é o plano executado, que traz lado a lado a estimativa e o número real de linhas de cada nó. A razão entre esses dois números é o sinal mais informativo que existe nesse tipo de incidente.',
        },
        {
          type: 'code',
          value: `-- PostgreSQL: o que pedir quando a consulta degradou sem mudanca de codigo.
-- ANALYZE executa de verdade, BUFFERS mostra quanta pagina foi lida.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT p.id, p.total_centavos, p.criado_em
FROM pedidos p
WHERE p.cliente_id = $1
  AND p.status = 'pago'
  AND p.criado_em >= now() - interval '90 days'
ORDER BY p.criado_em DESC
LIMIT 50;

-- Trecho tipico do plano ruim. O que importa nao e o tempo, e a razao
-- entre rows estimado e rows real: 12 contra 184392 e um erro de 15000x.
--
-- Limit  (cost=0.43..812.10 rows=50 width=28)
--        (actual time=11240.882..11240.901 rows=50 loops=1)
--   ->  Index Scan Backward using pedidos_criado_em_idx on pedidos p
--         (cost=0.43..2996318.55 rows=12 width=28)
--         (actual time=11240.879..11240.895 rows=50 loops=1)
--         Filter: (cliente_id = 8812 AND status = 'pago')
--         Rows Removed by Filter: 4183992
--         Buffers: shared hit=91204 read=812118
--
-- Leitura: o banco escolheu percorrer o indice de data de tras para frente
-- apostando que acharia 50 linhas do cliente rapidamente. Como esse cliente
-- tem poucos pedidos num universo grande, ele varreu 4,1 milhoes de linhas
-- ate juntar as 50. O indice existe, esta integro, e foi usado. O plano e
-- que estava errado.

-- Confirmacao de que o problema e estimativa, nao falta de indice:
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_mod_since_analyze,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'pedidos';

-- n_mod_since_analyze proximo de n_live_tup significa que a estatistica
-- descreve uma tabela que nao existe mais.`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que fecha o diagnóstico nesse exemplo é a linha de linhas removidas pelo filtro. Ela mostra que o banco leu quatro milhões de registros e descartou quase todos, o que é a assinatura clássica de um plano que usou o índice errado com convicção. Não adianta olhar se o índice existe: ele existe, foi usado, e o uso é que foi improdutivo. Um índice composto sobre cliente, status e data resolveria esse caso, mas antes de criar qualquer índice vale medir se a estatística estava correta, porque criar índice para compensar estimativa ruim gera uma coleção de índices que ninguém consegue remover depois.',
        },
        {
          type: 'paragraph',
          value:
            'A prática que economiza mais tempo é registrar o plano executado das consultas críticas em condições normais, antes do incidente. Sem o plano de referência, a investigação vira comparação com a memória de alguém, e a memória tende a lembrar do tempo, não do caminho. Guardar o plano bom permite responder em minutos a única pergunta que importa no meio do incidente: o plano mudou ou os dados mudaram.',
        },
      ],
    },
    {
      title: 'O parâmetro capturado que condena as execuções seguintes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma classe de incidente que confunde até times experientes: a mesma consulta, com o mesmo SQL, roda rápido para uma parte dos clientes e lenta para outra, e o comportamento vira do avesso depois de um reinício. A causa é o plano ser preparado uma vez, a partir do primeiro conjunto de parâmetros que chegou, e reaproveitado para todos os valores seguintes. Se o primeiro valor era atípico, todo o resto herda um plano feito sob medida para um caso que quase nunca acontece.',
        },
        {
          type: 'diagram',
          value: `CENARIO: consulta parametrizada por cliente_id
tabela pedidos: 40 milhoes de linhas, 12 mil clientes

  Cliente A (varejo pequeno): 38 pedidos
  Cliente B (marketplace):    9,2 milhoes de pedidos

PRIMEIRO PLANEJAMENTO COM CLIENTE A
  otimizador ve: filtro devolve ~38 linhas
  escolhe: Index Scan em pedidos_cliente_idx  -> correto para A
  plano fica em cache e passa a valer para todos

  execucao com A:  3 ms      (38 buscas no indice)
  execucao com B:  47 s      (9,2 milhoes de buscas no indice,
                              cada uma com salto aleatorio no heap)

APOS REINICIO, PRIMEIRO PLANEJAMENTO COM CLIENTE B
  otimizador ve: filtro devolve ~9,2 milhoes de linhas
  escolhe: Seq Scan + agregacao             -> correto para B
  plano fica em cache e passa a valer para todos

  execucao com B:  6 s       (uma varredura, leitura sequencial)
  execucao com A:  6 s       (varre 40 milhoes para achar 38 linhas)

O QUE ISSO SIGNIFICA NA PRATICA
  o mesmo SQL tem dois planos corretos e nenhum plano correto para os dois
  o sintoma reportado depende de quem reiniciou o servico e quando
  medir a media esconde tudo: a media dos dois casos nao existe na realidade

SAIDAS REAIS
  1. planejar por execucao nas consultas com distribuicao torta
     (custo: replanejamento por chamada, so vale para consulta cara)
  2. separar a consulta por faixa de cardinalidade na aplicacao
     (dois caminhos explicitos, cada um com o plano que lhe cabe)
  3. aumentar o alvo de estatistica na coluna e deixar o banco
     enxergar a distribuicao real em vez do valor medio`,
        },
        {
          type: 'paragraph',
          value:
            'A saída que quase todo time tenta primeiro é a que menos funciona: desativar o cache de plano globalmente. Isso troca um problema pontual por um custo permanente de planejamento em todas as consultas do sistema, inclusive nas milhares que estavam perfeitamente bem. A decisão correta é por consulta, e o critério é a assimetria da distribuição do parâmetro. Se o mesmo filtro devolve trinta e oito linhas para um valor e nove milhões para outro, essa consulta precisa de tratamento explícito. Se a distribuição é razoavelmente uniforme, o plano em cache é uma otimização legítima e não deve ser tocado.',
        },
        {
          type: 'paragraph',
          value:
            'A terceira saída é a mais barata e a mais esquecida. O banco mantém um histograma por coluna com um número limitado de compartimentos, e quando a distribuição tem uma cauda longa esse número padrão não representa os valores extremos. Aumentar o alvo de estatística para a coluna de cliente e reanalisar a tabela costuma fazer o otimizador enxergar que existe um valor com nove milhões de ocorrências, e a partir daí ele escolhe planos diferentes para valores diferentes sempre que puder planejar por execução. É uma mudança de uma linha e resolve mais casos do que parece.',
        },
      ],
    },
    {
      title: 'Estatística envelhecida e o momento em que ela mata',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A coleta automática de estatísticas dispara quando uma fração da tabela é modificada, e essa fração é proporcional ao tamanho. Numa tabela de dez mil linhas, o gatilho ocorre depois de algumas centenas de alterações. Numa tabela de quarenta milhões, ele só ocorre depois de milhões. Quanto maior a tabela, mais tempo ela passa com estatísticas velhas, e o problema é justamente que as tabelas grandes são as que mais dependem de estimativas boas.',
        },
        {
          type: 'paragraph',
          value:
            'Existe um caso específico que causa incidente com frequência desproporcional: a coluna de data em tabela que só cresce. A estatística guarda o valor máximo observado na última coleta. Toda consulta que filtra pelos últimos sete dias cai fora do intervalo conhecido, e o otimizador estima uma quantidade minúscula de linhas porque, segundo o que ele sabe, aquele intervalo está além do fim dos dados. A estimativa de uma linha em um filtro que devolve duzentas mil é uma receita para o plano errado, e ela acontece todo dia em toda tabela de eventos que não é reanalisada com frequência.',
        },
        {
          type: 'ordered',
          items: [
            'Identifique as tabelas cuja distância entre modificações e última análise é maior que a fração de gatilho, começando pelas maiores.',
            'Para tabelas de eventos com coluna de data crescente, reduza o gatilho de análise automática na própria tabela em vez de mexer no ajuste global.',
            'Aumente o alvo de estatística nas colunas usadas em filtros com distribuição torta e reanalise, medindo o plano antes e depois.',
            'Declare a dependência entre colunas correlacionadas quando o banco suportar estatística estendida, para eliminar o erro por multiplicação de seletividades.',
            'Registre o plano executado das consultas críticas como referência versionada, para que a próxima investigação comece com uma comparação e não com uma hipótese.',
          ],
        },
        {
          type: 'code',
          value: `-- Ajustes por objeto, nao globais. Cada um resolve uma causa distinta.

-- 1) Tabela de eventos que so cresce: analisar com mais frequencia.
--    O padrao dispara depois de 10% da tabela modificada, o que em
--    40 milhoes de linhas significa 4 milhoes de insercoes de atraso.
ALTER TABLE pedidos SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);

-- 2) Coluna com distribuicao torta: mais compartimentos no histograma.
--    O padrao de 100 nao representa um cliente que sozinho responde
--    por 20% das linhas.
ALTER TABLE pedidos ALTER COLUMN cliente_id SET STATISTICS 1000;
ANALYZE pedidos;

-- 3) Colunas correlacionadas: dizer ao otimizador que elas nao sao
--    independentes. Sem isso ele multiplica as seletividades e erra
--    por ordens de grandeza em filtros combinados.
CREATE STATISTICS pedidos_cliente_status_deps (dependencies, ndistinct)
  ON cliente_id, status FROM pedidos;
ANALYZE pedidos;

-- 4) Verificar se o erro de estimativa caiu de fato, comparando o
--    numero estimado com o real no mesmo filtro.
EXPLAIN (ANALYZE, SUMMARY OFF)
SELECT count(*) FROM pedidos
WHERE cliente_id = 8812 AND status = 'pago';

-- Antes:  rows=12      actual rows=184392   -> erro de 15000x
-- Depois: rows=176410  actual rows=184392   -> erro de 1,04x`,
        },
        {
          type: 'paragraph',
          value:
            'A estatística estendida sobre colunas correlacionadas é o ajuste com melhor relação entre esforço e resultado nesse conjunto, e é o menos usado. O caso clássico é filtro por dois campos onde um determina o outro: cidade e estado, categoria e subcategoria, cliente e canal de origem. Sem a declaração, o otimizador trata cada filtro como um sorteio independente e multiplica as probabilidades, chegando a uma estimativa que pode estar cem ou mil vezes abaixo da realidade. Com a declaração, ele passa a usar a contagem conjunta observada, e o plano muda na primeira execução seguinte.',
        },
      ],
    },
    {
      title: 'Estabilizar o plano sem esconder o problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Depois do segundo incidente do mesmo tipo, alguém sempre propõe fixar o plano. A ideia é legítima e o risco é conhecido: um plano fixado é uma decisão tomada com os dados de hoje e aplicada aos dados de daqui a dois anos. Se a tabela dobrar de tamanho ou o perfil de acesso mudar, o plano fixado deixa de ser o melhor e não existe mecanismo que perceba isso sozinho. Fixar plano não é errado, é uma dívida com data de vencimento que precisa estar escrita em algum lugar.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Quando é a escolha certa', 'O que ela custa'],
          rows: [
            [
              'Corrigir a estatística',
              'Erro de estimativa acima de dez vezes no nó problemático',
              'Análise mais frequente e um pouco mais de trabalho em segundo plano',
            ],
            [
              'Criar índice composto na ordem do filtro',
              'O plano correto existe mas nenhum índice o suporta bem',
              'Escrita mais lenta e mais espaço, permanentes',
            ],
            [
              'Reescrever a consulta',
              'A forma escrita impede o plano bom, com subconsulta ou função na coluna',
              'Mudança de código com teste, mas sem dívida operacional',
            ],
            [
              'Planejar por execução nessa consulta',
              'Distribuição torta do parâmetro, com planos corretos diferentes',
              'Custo de planejamento em toda chamada dessa consulta',
            ],
            [
              'Fixar o plano',
              'Incidente em curso e nenhuma das opções acima disponível a tempo',
              'Dívida com revisão obrigatória por trimestre e alerta de validade',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A ordem dessa tabela é a ordem de tentativa, e ela não é arbitrária. Corrigir a estatística é reversível, barato e ataca a causa. Criar índice é permanente e cobra em toda escrita, então merece a pergunta de se o plano bom já não existia. Reescrever a consulta é a única opção que remove o problema em vez de compensá-lo, e vale sempre que a forma escrita for a culpada, o que acontece com mais frequência do que o time admite: uma função aplicada sobre a coluna indexada, uma conversão implícita de tipo ou um filtro com valor nulo tratado de forma ingênua são suficientes para tornar um índice inutilizável.',
        },
        {
          type: 'paragraph',
          value:
            'Fixar o plano fica em último lugar não porque seja ilegítimo, mas porque é a única opção que congela uma decisão e desliga o mecanismo que a corrigiria. Quando for necessário durante um incidente, a regra que evita o arrependimento é simples: toda fixação de plano nasce com data de revisão e com um alerta que dispara se a razão entre linhas estimadas e reais naquele nó ultrapassar o limiar. Sem esses dois itens, a fixação vira uma decisão de dois anos atrás que ninguém lembra de ter tomado.',
        },
      ],
    },
    {
      title: 'Três alertas que pegam a mudança de plano antes do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O monitoramento habitual de banco observa tempo médio de consulta, e o tempo médio é justamente a métrica que perde esse incidente. Uma consulta que roda dez mil vezes por minuto em quatro milissegundos e passa a rodar em onze segundos para dois por cento dos parâmetros mantém a média em uma faixa aceitável por horas. O que muda imediatamente e de forma inequívoca é o plano, e é isso que precisa ser observado.',
        },
        {
          type: 'list',
          items: [
            'Mudança de identificador de plano para uma consulta na lista de críticas: alerta imediato, sem limiar de tempo, porque um plano novo é um evento discreto e a comparação é exata. O alerta carrega o plano anterior e o novo lado a lado, para que a decisão de reverter ou aceitar seja tomada em minutos.',
            'Razão entre linhas estimadas e linhas reais acima de dez vezes em qualquer nó de consulta crítica: alerta diário agregado, porque esse número denuncia estatística envelhecida antes de o plano virar. É o único alerta dessa lista que dispara enquanto o desempenho ainda está bom, e por isso é o que mais evita incidente.',
            'Percentil noventa e nove da consulta acima de vinte vezes a mediana da mesma consulta na mesma janela: alerta de assimetria, que pega o caso do parâmetro capturado. A comparação precisa ser com a mediana da própria consulta, não com um limiar absoluto, porque o que importa é a distância entre os casos bons e os ruins do mesmo SQL.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O segundo alerta é o que muda o modo de operação do time. Ele não reporta lentidão, reporta que o otimizador está trabalhando com uma descrição errada da tabela, o que é uma condição que precede a lentidão por dias ou semanas. Tratá-lo como manutenção de rotina, e não como incidente, é o que transforma esse tipo de degradação de surpresa em tarefa agendada. O terceiro alerta é o que distingue a consulta que está lenta para todo mundo daquela que está lenta para alguns, e essa distinção decide entre corrigir estatística e separar caminhos de execução.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar o que nenhum desses alertas faz: nenhum deles diz que o plano novo é pior. Um plano pode mudar porque a tabela cresceu e a mudança pode estar correta. O papel do alerta é garantir que a mudança seja vista por alguém no dia em que acontece, com os dois planos disponíveis para comparação, em vez de ser descoberta três semanas depois pelo time comercial que parou de conseguir abrir o painel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se o plano muda sozinho, não é mais seguro fixar todos os planos das consultas críticas de uma vez?',
      answer:
        'Fixar tudo troca uma classe de problema por outra que demora muito mais para aparecer e é muito mais difícil de diagnosticar. O plano fixado é correto para a distribuição de dados que existia no dia da fixação, e a partir daí ele para de acompanhar a realidade. O caso que dói é o inverso do incidente original: a tabela cresce, o plano bom passa a ser outro, e o banco continua executando o plano antigo porque foi mandado a fazer isso. A degradação nesse cenário é gradual, ninguém associa a uma decisão tomada dois anos antes, e a investigação é mais longa porque a primeira coisa que se verifica é justamente se o plano mudou, e ele não mudou. Existe um segundo custo, menos óbvio: fixar plano cria uma configuração fora do código da aplicação, e configuração fora do código tende a divergir entre ambientes. O teste que passa em homologação com plano livre não prova nada sobre produção com plano fixado. A abordagem que se sustenta é fixar por exceção, com data de revisão, alerta de erro de estimativa naquele nó e um registro escrito do motivo. Se a lista de planos fixados cresce a cada trimestre, o problema real não é o otimizador, é a ausência de manutenção de estatística.',
    },
    {
      question: 'Como distinguir na prática degradação por mudança de plano de degradação por concorrência ou bloqueio?',
      answer:
        'Os três têm assinaturas diferentes e a separação é rápida quando se sabe o que olhar. Mudança de plano produz um degrau: o tempo muda de patamar entre duas execuções e permanece no patamar novo, e o consumo de páginas lidas por execução muda junto, geralmente por ordens de grandeza. Concorrência produz correlação com carga: o tempo sobe e desce junto com o número de execuções simultâneas, o consumo de páginas por execução permanece o mesmo, e o tempo total é maior que a soma dos tempos dos nós do plano. Bloqueio produz espera sem trabalho: a consulta passa a maior parte do tempo aguardando, o tempo de processamento é baixo, o consumo de páginas é normal e existe um evento de espera identificável na visão de atividade do banco. O teste que separa os três em menos de um minuto é comparar páginas lidas por execução antes e depois. Se esse número mudou, é plano. Se ele está igual e o tempo subiu junto com a carga, é concorrência. Se ele está igual, a carga não mudou e o tempo de processamento é uma fração pequena do tempo total, é espera, e aí a pergunta seguinte é por qual recurso.',
    },
    {
      question: 'Vale a pena manter o histórico de planos executados em produção, considerando o custo de coleta?',
      answer:
        'Vale, e o custo é menor do que a intuição sugere quando a coleta é feita por amostragem em vez de coleta total. Coletar o plano executado de toda execução tem custo real e não é o que se propõe. O que funciona é amostrar: registrar o plano executado de uma fração pequena das execuções das consultas que estão na lista de críticas, mais o plano de toda execução que ultrapassar um limiar de tempo. A amostra de rotina dá a linha de base, e a captura por limiar garante que o caso ruim nunca escape, que é exatamente o oposto do que acontece quando se amostra uniformemente. Sobre retenção, o histórico útil é curto para o detalhe e longo para o identificador. Guardar o texto completo do plano por sete a catorze dias cobre a investigação de qualquer incidente recente, e guardar apenas o identificador do plano com carimbo de tempo por seis meses ou mais custa quase nada e responde a pergunta mais valiosa que existe nesse assunto: desde quando essa consulta usa esse plano. Sem esse histórico, toda investigação começa reconstruindo a linha do tempo a partir da memória de quem estava de plantão, e a memória é a pior fonte disponível.',
    },
  ],
  conclusion: {
    title: 'Plano de consulta é uma decisão observável, não um efeito colateral',
    description:
      'O índice continuar existindo não garante que ele seja usado, e o tempo médio da consulta é a métrica que perde exatamente o incidente que importa. Posso revisar o comportamento do seu banco em produção e definir a captura do plano executado das consultas críticas, a política de estatística por tabela em vez de ajuste global, a estatística estendida nas colunas correlacionadas, o tratamento das consultas com distribuição torta de parâmetro, e os alertas que mostram a mudança de plano no dia em que ela acontece.',
    cta: 'Falar sobre desempenho do meu banco em produção',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Cache invalidado errado: quando o dado velho custa mais caro que a consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The query had been running in four milliseconds for two years, nobody changed the code, nobody changed the index, and on a Wednesday it started taking eleven seconds and took down the sales team dashboard. The index was still there, intact, and the database simply decided not to use it. This article shows why a query plan is a recomputed decision and not a fixed property of the query, which four optimizer inputs change on their own in production, why stale statistics and column correlation produce the same symptom through opposite paths, how the parameter captured on the first execution condemns every execution after it, what the difference is between stabilizing a plan and hiding the problem, and which three alerts catch a plan change before the customer does.',
  sections: [
    {
      title: 'The plan belongs to the moment it was planned, not to the query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition of anyone who writes SQL is that the query describes the result and the database describes the path, and that part is right. What is almost always missing is the next step: the path is chosen by a cost-based optimizer that estimates how many rows each operation will return and picks the cheapest plan according to that estimate. The estimate is not a measurement, it is a projection built from statistics sampled at some point in the past. None of that is stable, and none of it lives in your code.',
        },
        {
          type: 'paragraph',
          value:
            'The consequence is that the same query can get different plans on different days without a single line changing. That is not a database defect, it is the intended behavior: if the table grew from ten thousand to ten million rows, the correct plan genuinely changed, and an optimizer that insisted on the old plan would be worse. The problem shows up when the estimate is wrong, because then the optimizer chooses correctly according to a reality that does not exist.',
        },
        {
          type: 'paragraph',
          value:
            'The useful question when a query degrades with no code change is not what changed in the code, it is which optimizer input changed. There are four, and each one has its own symptom and its own test.',
        },
        {
          type: 'table',
          columns: ['Optimizer input', 'What changes on its own', 'Typical symptom', 'How to confirm'],
          rows: [
            [
              'Distribution statistics',
              'Age as the table grows or shifts profile',
              'Row estimate orders of magnitude below the real count',
              'Compare estimated rows against returned rows in the executed plan',
            ],
            [
              'Parameter captured at first planning',
              'Depends on which value arrived first after a restart or invalidation',
              'Query fast for one customer and slow for another, same SQL',
              'Run with a literal value and compare against the parameterized version',
            ],
            [
              'Real data volume and selectivity',
              'Grows with the business, shifts with seasonality',
              'Gradual degradation that turns into a step when a threshold is crossed',
              'Average time history against row count history',
            ],
            [
              'Correlation between filter columns',
              'Appears when new data creates a dependency between fields',
              'Estimate is wrong by multiplying independent selectivities',
              'Count rows for the combined filter and compare against the product of the parts',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The two most deceiving rows are the third and the fourth. Volume degradation looks continuous, but in practice it is a step: while the estimated cost of a sequential scan stays above the index cost, nothing happens, and on the day the table crosses the tie point the plan flips from one execution to the next. Column correlation is even quieter, because the optimizer assumes independence by default. If you filter by city and by state, it multiplies the two selectivities as if they were independent events and estimates a hundred times fewer rows than exist, when in fact city determines state.',
        },
      ],
    },
    {
      title: 'Read the executed plan, not the estimated plan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common operational mistake during investigation is looking only at the estimated plan. It shows what the optimizer intends to do and how many rows it believes it will find, and that belief is exactly what is wrong when the query degrades. What settles the diagnosis is the executed plan, which places the estimate and the real row count of each node side by side. The ratio between those two numbers is the most informative signal available in this kind of incident.',
        },
        {
          type: 'code',
          value: `-- PostgreSQL: what to ask for when the query degraded with no code change.
-- ANALYZE actually executes it, BUFFERS shows how many pages were read.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT p.id, p.total_cents, p.created_at
FROM orders p
WHERE p.customer_id = $1
  AND p.status = 'paid'
  AND p.created_at >= now() - interval '90 days'
ORDER BY p.created_at DESC
LIMIT 50;

-- Typical excerpt from the bad plan. What matters is not the time, it is
-- the ratio between estimated rows and real rows: 12 against 184392 is a
-- 15000x error.
--
-- Limit  (cost=0.43..812.10 rows=50 width=28)
--        (actual time=11240.882..11240.901 rows=50 loops=1)
--   ->  Index Scan Backward using orders_created_at_idx on orders p
--         (cost=0.43..2996318.55 rows=12 width=28)
--         (actual time=11240.879..11240.895 rows=50 loops=1)
--         Filter: (customer_id = 8812 AND status = 'paid')
--         Rows Removed by Filter: 4183992
--         Buffers: shared hit=91204 read=812118
--
-- Reading: the database chose to walk the date index backwards betting it
-- would find 50 rows for that customer quickly. Since this customer has few
-- orders inside a large universe, it scanned 4.1 million rows to collect the
-- 50. The index exists, it is intact, and it was used. The plan is what was
-- wrong.

-- Confirming the problem is estimation, not a missing index:
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_mod_since_analyze,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'orders';

-- n_mod_since_analyze close to n_live_tup means the statistics describe a
-- table that no longer exists.`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that closes the diagnosis in this example is the rows removed by filter line. It shows the database read four million records and discarded almost all of them, which is the classic signature of a plan that used the wrong index with conviction. Checking whether the index exists is beside the point: it exists, it was used, and the use is what was unproductive. A composite index over customer, status and date would solve this case, but before creating any index it pays to measure whether the statistics were correct, because creating indexes to compensate for bad estimates produces a collection of indexes nobody can remove later.',
        },
        {
          type: 'paragraph',
          value:
            'The practice that saves the most time is recording the executed plan of critical queries under normal conditions, before the incident. Without the reference plan, the investigation becomes a comparison against somebody memory, and memory tends to remember the time, not the path. Keeping the good plan lets you answer in minutes the only question that matters mid-incident: did the plan change or did the data change.',
        },
      ],
    },
    {
      title: 'The captured parameter that condemns every execution after it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a class of incident that confuses even experienced teams: the same query, with the same SQL, runs fast for some customers and slow for others, and the behavior flips after a restart. The cause is that the plan is prepared once, from the first parameter set that arrived, and reused for every value after that. If the first value was atypical, everything else inherits a plan tailored to a case that almost never happens.',
        },
        {
          type: 'diagram',
          value: `SCENARIO: query parameterized by customer_id
orders table: 40 million rows, 12 thousand customers

  Customer A (small retail): 38 orders
  Customer B (marketplace):  9.2 million orders

FIRST PLANNING WITH CUSTOMER A
  optimizer sees: filter returns ~38 rows
  chooses: Index Scan on orders_customer_idx  -> correct for A
  plan is cached and now applies to everyone

  execution with A:  3 ms      (38 index lookups)
  execution with B:  47 s      (9.2 million index lookups,
                                each one a random jump into the heap)

AFTER RESTART, FIRST PLANNING WITH CUSTOMER B
  optimizer sees: filter returns ~9.2 million rows
  chooses: Seq Scan + aggregation             -> correct for B
  plan is cached and now applies to everyone

  execution with B:  6 s       (one scan, sequential reads)
  execution with A:  6 s       (scans 40 million to find 38 rows)

WHAT THIS MEANS IN PRACTICE
  the same SQL has two correct plans and no plan correct for both
  the reported symptom depends on who restarted the service and when
  measuring the average hides everything: the average of the two cases
  does not exist in reality

REAL EXITS
  1. plan per execution for queries with skewed distribution
     (cost: replanning per call, only worth it for an expensive query)
  2. split the query by cardinality range in the application
     (two explicit paths, each with the plan that fits it)
  3. raise the statistics target on the column and let the database
     see the real distribution instead of the average value`,
        },
        {
          type: 'paragraph',
          value:
            'The exit almost every team tries first is the one that works least: disabling the plan cache globally. That trades a localized problem for a permanent planning cost across every query in the system, including the thousands that were perfectly fine. The correct decision is per query, and the criterion is the skew of the parameter distribution. If the same filter returns thirty-eight rows for one value and nine million for another, that query needs explicit treatment. If the distribution is reasonably uniform, the cached plan is a legitimate optimization and should not be touched.',
        },
        {
          type: 'paragraph',
          value:
            'The third exit is the cheapest and the most forgotten. The database keeps a per-column histogram with a limited number of buckets, and when the distribution has a long tail that default number does not represent the extreme values. Raising the statistics target on the customer column and reanalyzing the table usually makes the optimizer see that one value has nine million occurrences, and from there it picks different plans for different values whenever it can plan per execution. It is a one-line change and it solves more cases than it seems.',
        },
      ],
    },
    {
      title: 'Stale statistics and the moment they kill',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Automatic statistics collection fires when a fraction of the table is modified, and that fraction is proportional to the size. In a ten thousand row table, the trigger happens after a few hundred changes. In a forty million row table, it only happens after millions. The bigger the table, the more time it spends with stale statistics, and the problem is precisely that large tables are the ones that depend most on good estimates.',
        },
        {
          type: 'paragraph',
          value:
            'There is one specific case that causes incidents with disproportionate frequency: the date column in an append-only table. Statistics store the maximum value observed at the last collection. Every query filtering the last seven days falls outside the known range, and the optimizer estimates a tiny number of rows because, as far as it knows, that range is beyond the end of the data. An estimate of one row on a filter that returns two hundred thousand is a recipe for the wrong plan, and it happens every day in every event table that is not reanalyzed often.',
        },
        {
          type: 'ordered',
          items: [
            'Identify tables whose distance between modifications and last analysis exceeds the trigger fraction, starting with the largest ones.',
            'For event tables with a growing date column, lower the automatic analysis trigger on the table itself rather than touching the global setting.',
            'Raise the statistics target on columns used in filters with skewed distribution and reanalyze, measuring the plan before and after.',
            'Declare the dependency between correlated columns when the database supports extended statistics, to eliminate the error from multiplying selectivities.',
            'Record the executed plan of critical queries as a versioned reference, so the next investigation starts from a comparison and not from a hypothesis.',
          ],
        },
        {
          type: 'code',
          value: `-- Per-object adjustments, not global ones. Each solves a distinct cause.

-- 1) Append-only event table: analyze more often.
--    The default fires after 10% of the table is modified, which in
--    40 million rows means 4 million inserts of lag.
ALTER TABLE orders SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);

-- 2) Column with skewed distribution: more histogram buckets.
--    The default of 100 does not represent a customer that alone
--    accounts for 20% of the rows.
ALTER TABLE orders ALTER COLUMN customer_id SET STATISTICS 1000;
ANALYZE orders;

-- 3) Correlated columns: tell the optimizer they are not independent.
--    Without this it multiplies the selectivities and is wrong by
--    orders of magnitude on combined filters.
CREATE STATISTICS orders_customer_status_deps (dependencies, ndistinct)
  ON customer_id, status FROM orders;
ANALYZE orders;

-- 4) Check the estimation error actually dropped, comparing the
--    estimated number against the real one on the same filter.
EXPLAIN (ANALYZE, SUMMARY OFF)
SELECT count(*) FROM orders
WHERE customer_id = 8812 AND status = 'paid';

-- Before: rows=12      actual rows=184392   -> 15000x error
-- After:  rows=176410  actual rows=184392   -> 1.04x error`,
        },
        {
          type: 'paragraph',
          value:
            'Extended statistics over correlated columns is the adjustment with the best effort to result ratio in this set, and it is the least used. The classic case is a filter on two fields where one determines the other: city and state, category and subcategory, customer and source channel. Without the declaration, the optimizer treats each filter as an independent draw and multiplies the probabilities, arriving at an estimate that can be a hundred or a thousand times below reality. With the declaration, it starts using the observed joint count, and the plan changes on the very next execution.',
        },
      ],
    },
    {
      title: 'Stabilizing the plan without hiding the problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'After the second incident of the same kind, someone always proposes pinning the plan. The idea is legitimate and the risk is known: a pinned plan is a decision made with today data and applied to the data of two years from now. If the table doubles in size or the access profile changes, the pinned plan stops being the best one and no mechanism notices that on its own. Pinning a plan is not wrong, it is a debt with a due date that has to be written down somewhere.',
        },
        {
          type: 'table',
          columns: ['Approach', 'When it is the right choice', 'What it costs'],
          rows: [
            [
              'Fix the statistics',
              'Estimation error above ten times on the problematic node',
              'More frequent analysis and slightly more background work',
            ],
            [
              'Create a composite index in filter order',
              'The correct plan exists but no index supports it well',
              'Slower writes and more space, permanently',
            ],
            [
              'Rewrite the query',
              'The written form blocks the good plan, with a subquery or a function on the column',
              'A code change with tests, but no operational debt',
            ],
            [
              'Plan per execution for that query',
              'Skewed parameter distribution, with different correct plans',
              'Planning cost on every call of that query',
            ],
            [
              'Pin the plan',
              'Incident in progress and none of the options above available in time',
              'Debt with mandatory quarterly review and an expiry alert',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The order of that table is the order to try, and it is not arbitrary. Fixing statistics is reversible, cheap and attacks the cause. Creating an index is permanent and charges on every write, so it deserves the question of whether the good plan already existed. Rewriting the query is the only option that removes the problem instead of compensating for it, and it is worth it whenever the written form is to blame, which happens more often than teams admit: a function applied over the indexed column, an implicit type conversion or a null value handled naively are enough to make an index unusable.',
        },
        {
          type: 'paragraph',
          value:
            'Pinning the plan comes last not because it is illegitimate, but because it is the only option that freezes a decision and turns off the mechanism that would correct it. When it is necessary during an incident, the rule that prevents regret is simple: every plan pin is born with a review date and an alert that fires if the ratio between estimated and real rows on that node crosses the threshold. Without those two items, the pin becomes a decision from two years ago that nobody remembers making.',
        },
      ],
    },
    {
      title: 'Three alerts that catch the plan change before the customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Usual database monitoring watches average query time, and average time is exactly the metric that misses this incident. A query that runs ten thousand times a minute in four milliseconds and starts taking eleven seconds for two percent of the parameters keeps the average inside an acceptable band for hours. What changes immediately and unambiguously is the plan, and that is what has to be watched.',
        },
        {
          type: 'list',
          items: [
            'Plan identifier change for a query on the critical list: immediate alert, with no time threshold, because a new plan is a discrete event and the comparison is exact. The alert carries the previous plan and the new one side by side, so the decision to revert or accept is made in minutes.',
            'Ratio between estimated and real rows above ten times on any node of a critical query: aggregated daily alert, because that number exposes stale statistics before the plan flips. It is the only alert on this list that fires while performance is still good, which is why it prevents the most incidents.',
            'Ninety-ninth percentile of the query above twenty times the median of the same query in the same window: skew alert, which catches the captured parameter case. The comparison has to be against the median of the query itself, not against an absolute threshold, because what matters is the distance between the good and the bad cases of the same SQL.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second alert is the one that changes how the team operates. It does not report slowness, it reports that the optimizer is working from a wrong description of the table, which is a condition that precedes slowness by days or weeks. Treating it as routine maintenance, and not as an incident, is what turns this kind of degradation from a surprise into a scheduled task. The third alert is what distinguishes the query that is slow for everyone from the one that is slow for some, and that distinction decides between fixing statistics and splitting execution paths.',
        },
        {
          type: 'paragraph',
          value:
            'It is worth recording what none of these alerts does: none of them says the new plan is worse. A plan can change because the table grew and the change can be correct. The role of the alert is to guarantee the change is seen by someone on the day it happens, with both plans available for comparison, instead of being discovered three weeks later by the sales team that stopped being able to open the dashboard.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If the plan changes on its own, would it not be safer to pin every critical query plan at once?',
      answer:
        'Pinning everything trades one class of problem for another that takes far longer to appear and is far harder to diagnose. The pinned plan is correct for the data distribution that existed on the day it was pinned, and from then on it stops tracking reality. The painful case is the inverse of the original incident: the table grows, the good plan becomes a different one, and the database keeps executing the old plan because it was told to. Degradation in that scenario is gradual, nobody associates it with a decision made two years earlier, and the investigation takes longer because the first thing you check is precisely whether the plan changed, and it did not. There is a second, less obvious cost: pinning a plan creates configuration outside the application code, and configuration outside the code tends to diverge between environments. A test passing in staging with free planning proves nothing about production with a pinned plan. The approach that holds up is pinning by exception, with a review date, an estimation error alert on that node and a written record of the reason. If the list of pinned plans grows every quarter, the real problem is not the optimizer, it is the absence of statistics maintenance.',
    },
    {
      question: 'How do you tell degradation from a plan change apart from degradation from concurrency or locking in practice?',
      answer:
        'The three have different signatures and separating them is quick once you know what to look at. A plan change produces a step: the time moves to a new level between two executions and stays there, and the pages read per execution move along with it, usually by orders of magnitude. Concurrency produces correlation with load: the time rises and falls with the number of simultaneous executions, pages read per execution stay the same, and the total time exceeds the sum of the node times in the plan. Locking produces waiting without work: the query spends most of its time waiting, processing time is low, page consumption is normal and there is an identifiable wait event in the database activity view. The test that separates the three in under a minute is comparing pages read per execution before and after. If that number changed, it is the plan. If it is unchanged and the time rose along with load, it is concurrency. If it is unchanged, load did not move and processing time is a small fraction of total time, it is waiting, and then the next question is on which resource.',
    },
    {
      question: 'Is keeping a history of executed plans in production worth the collection cost?',
      answer:
        'It is worth it, and the cost is lower than intuition suggests when collection is done by sampling instead of capturing everything. Collecting the executed plan of every execution has a real cost and is not what is being proposed. What works is sampling: recording the executed plan of a small fraction of the executions of queries on the critical list, plus the plan of every execution that crosses a time threshold. The routine sample gives the baseline, and threshold capture guarantees the bad case never escapes, which is exactly the opposite of what happens with uniform sampling. On retention, the useful history is short for the detail and long for the identifier. Keeping the full plan text for seven to fourteen days covers the investigation of any recent incident, and keeping only the plan identifier with a timestamp for six months or more costs almost nothing and answers the most valuable question in this subject: since when has this query been using this plan. Without that history, every investigation starts by reconstructing the timeline from the memory of whoever was on call, and memory is the worst available source.',
    },
  ],
  conclusion: {
    title: 'A query plan is an observable decision, not a side effect',
    description:
      'The index continuing to exist does not guarantee it is used, and average query time is the metric that misses exactly the incident that matters. I can review how your database behaves in production and define executed plan capture for critical queries, a per-table statistics policy instead of a global setting, extended statistics on correlated columns, the treatment of queries with skewed parameter distribution, and the alerts that surface a plan change on the day it happens.',
    cta: 'Talk about my database performance in production',
  },
  related: [
    {
      label: 'Database migration without a window: expand, migrate and contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Wrongly invalidated cache: when stale data costs more than the query',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'La consulta corría en cuatro milisegundos desde hacía dos años, nadie cambió el código, nadie cambió el índice, y un miércoles pasó a tardar once segundos y tumbó el panel del equipo comercial. El índice seguía ahí, íntegro, y la base de datos simplemente decidió no usarlo. Este artículo muestra por qué el plan de consulta es una decisión recalculada y no una propiedad fija de la consulta, qué cuatro entradas del optimizador cambian solas en producción, por qué la estadística desactualizada y la correlación entre columnas producen el mismo síntoma por caminos opuestos, cómo el parámetro capturado en la primera ejecución condena todas las ejecuciones siguientes, cuál es la diferencia entre estabilizar el plan y esconder el problema, y qué tres alertas detectan el cambio de plan antes que el cliente.',
  sections: [
    {
      title: 'El plan no es de la consulta, es del momento en que fue planificada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición de quien escribe SQL es que la consulta describe el resultado y la base describe el camino, y esa parte es correcta. Lo que casi siempre falta es el paso siguiente: el camino lo elige un optimizador basado en costo, que estima cuántas filas devolverá cada operación y elige el plan más barato según esa estimación. La estimación no es una medición, es una proyección hecha a partir de estadísticas muestreadas en algún momento del pasado. Nada de eso es estable, y ninguna parte de eso está en tu código.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia es que la misma consulta puede tener planes distintos en días distintos sin que haya cambiado una sola línea. Eso no es un defecto de la base, es el comportamiento buscado: si la tabla creció de diez mil a diez millones de filas, el plan correcto cambió de verdad, y un optimizador que insistiera en el plan antiguo sería peor. El problema aparece cuando la estimación está equivocada, porque entonces el optimizador elige correctamente según una realidad que no existe.',
        },
        {
          type: 'paragraph',
          value:
            'La pregunta útil cuando una consulta se degrada sin cambio de código no es qué cambió en el código, es cuál de las entradas del optimizador cambió. Hay cuatro, y cada una tiene su síntoma y su prueba.',
        },
        {
          type: 'table',
          columns: ['Entrada del optimizador', 'Qué cambia solo', 'Síntoma típico', 'Cómo confirmarlo'],
          rows: [
            [
              'Estadísticas de distribución',
              'Envejecen conforme la tabla crece o cambia de perfil',
              'Estimación de filas órdenes de magnitud por debajo de lo real',
              'Comparar filas estimadas con filas devueltas en el plan ejecutado',
            ],
            [
              'Parámetro capturado en la primera planificación',
              'Depende de qué valor llegó primero tras un reinicio o invalidación',
              'Consulta rápida para un cliente y lenta para otro, mismo SQL',
              'Ejecutar con valor literal y comparar con la versión parametrizada',
            ],
            [
              'Volumen y selectividad real de los datos',
              'Crece con el negocio, cambia con la estacionalidad',
              'Degradación gradual que se vuelve escalón al cruzar un umbral',
              'Historial de tiempo medio contra historial de conteo de filas',
            ],
            [
              'Correlación entre columnas del filtro',
              'Aparece cuando datos nuevos crean dependencia entre campos',
              'La estimación falla por multiplicar selectividades independientes',
              'Contar filas del filtro combinado y comparar con el producto de las partes',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos filas que más engañan son la tercera y la cuarta. La degradación por volumen parece continua, pero en la práctica es un escalón: mientras el costo estimado del recorrido secuencial sea mayor que el del índice, no pasa nada, y el día en que la tabla cruza el punto de empate el plan cambia de una ejecución a la siguiente. La correlación entre columnas es todavía más silenciosa, porque el optimizador supone independencia por defecto. Si filtras por ciudad y por provincia, multiplica ambas selectividades como si fueran eventos independientes y estima cien veces menos filas de las que existen, cuando en realidad la ciudad determina la provincia.',
        },
      ],
    },
    {
      title: 'Leer el plan ejecutado, no el plan estimado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error operativo más común en la investigación es mirar solo el plan estimado. Muestra lo que el optimizador pretende hacer y cuántas filas cree que va a encontrar, y es exactamente esa creencia la que está equivocada cuando la consulta se degrada. Lo que resuelve el diagnóstico es el plan ejecutado, que trae lado a lado la estimación y el número real de filas de cada nodo. La razón entre esos dos números es la señal más informativa que existe en este tipo de incidente.',
        },
        {
          type: 'code',
          value: `-- PostgreSQL: que pedir cuando la consulta se degrado sin cambio de codigo.
-- ANALYZE ejecuta de verdad, BUFFERS muestra cuanta pagina se leyo.
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, SETTINGS)
SELECT p.id, p.total_centavos, p.creado_en
FROM pedidos p
WHERE p.cliente_id = $1
  AND p.estado = 'pagado'
  AND p.creado_en >= now() - interval '90 days'
ORDER BY p.creado_en DESC
LIMIT 50;

-- Fragmento tipico del plan malo. Lo que importa no es el tiempo, es la
-- razon entre filas estimadas y filas reales: 12 contra 184392 es un error
-- de 15000x.
--
-- Limit  (cost=0.43..812.10 rows=50 width=28)
--        (actual time=11240.882..11240.901 rows=50 loops=1)
--   ->  Index Scan Backward using pedidos_creado_en_idx on pedidos p
--         (cost=0.43..2996318.55 rows=12 width=28)
--         (actual time=11240.879..11240.895 rows=50 loops=1)
--         Filter: (cliente_id = 8812 AND estado = 'pagado')
--         Rows Removed by Filter: 4183992
--         Buffers: shared hit=91204 read=812118
--
-- Lectura: la base eligio recorrer el indice de fecha hacia atras apostando
-- a que encontraria 50 filas del cliente rapidamente. Como ese cliente tiene
-- pocos pedidos en un universo grande, recorrio 4,1 millones de filas hasta
-- juntar las 50. El indice existe, esta integro, y fue usado. El plan es lo
-- que estaba mal.

-- Confirmacion de que el problema es estimacion, no falta de indice:
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_mod_since_analyze,
  last_analyze,
  last_autoanalyze
FROM pg_stat_user_tables
WHERE relname = 'pedidos';

-- n_mod_since_analyze cercano a n_live_tup significa que la estadistica
-- describe una tabla que ya no existe.`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que cierra el diagnóstico en este ejemplo es la línea de filas eliminadas por el filtro. Muestra que la base leyó cuatro millones de registros y descartó casi todos, que es la firma clásica de un plan que usó el índice equivocado con convicción. No sirve mirar si el índice existe: existe, fue usado, y el uso es lo que resultó improductivo. Un índice compuesto sobre cliente, estado y fecha resolvería este caso, pero antes de crear cualquier índice conviene medir si la estadística era correcta, porque crear índices para compensar estimaciones malas genera una colección de índices que después nadie logra eliminar.',
        },
        {
          type: 'paragraph',
          value:
            'La práctica que más tiempo ahorra es registrar el plan ejecutado de las consultas críticas en condiciones normales, antes del incidente. Sin el plan de referencia, la investigación se vuelve una comparación con la memoria de alguien, y la memoria tiende a recordar el tiempo, no el camino. Guardar el plan bueno permite responder en minutos la única pregunta que importa en medio del incidente: cambió el plan o cambiaron los datos.',
        },
      ],
    },
    {
      title: 'El parámetro capturado que condena las ejecuciones siguientes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una clase de incidente que confunde incluso a equipos con experiencia: la misma consulta, con el mismo SQL, corre rápido para una parte de los clientes y lenta para otra, y el comportamiento se invierte tras un reinicio. La causa es que el plan se prepara una vez, a partir del primer conjunto de parámetros que llegó, y se reutiliza para todos los valores siguientes. Si el primer valor era atípico, todo el resto hereda un plan hecho a medida para un caso que casi nunca ocurre.',
        },
        {
          type: 'diagram',
          value: `ESCENARIO: consulta parametrizada por cliente_id
tabla pedidos: 40 millones de filas, 12 mil clientes

  Cliente A (comercio pequeno): 38 pedidos
  Cliente B (marketplace):      9,2 millones de pedidos

PRIMERA PLANIFICACION CON CLIENTE A
  el optimizador ve: el filtro devuelve ~38 filas
  elige: Index Scan en pedidos_cliente_idx  -> correcto para A
  el plan queda en cache y pasa a valer para todos

  ejecucion con A:  3 ms      (38 busquedas en el indice)
  ejecucion con B:  47 s      (9,2 millones de busquedas en el indice,
                               cada una con salto aleatorio al heap)

TRAS REINICIO, PRIMERA PLANIFICACION CON CLIENTE B
  el optimizador ve: el filtro devuelve ~9,2 millones de filas
  elige: Seq Scan + agregacion              -> correcto para B
  el plan queda en cache y pasa a valer para todos

  ejecucion con B:  6 s       (un recorrido, lectura secuencial)
  ejecucion con A:  6 s       (recorre 40 millones para hallar 38 filas)

QUE SIGNIFICA ESTO EN LA PRACTICA
  el mismo SQL tiene dos planes correctos y ningun plan correcto para ambos
  el sintoma reportado depende de quien reinicio el servicio y cuando
  medir el promedio lo esconde todo: el promedio de los dos casos no existe
  en la realidad

SALIDAS REALES
  1. planificar por ejecucion en consultas con distribucion sesgada
     (costo: replanificacion por llamada, solo vale para consulta cara)
  2. separar la consulta por rango de cardinalidad en la aplicacion
     (dos caminos explicitos, cada uno con el plan que le corresponde)
  3. aumentar el objetivo de estadistica en la columna y dejar que la
     base vea la distribucion real en vez del valor promedio`,
        },
        {
          type: 'paragraph',
          value:
            'La salida que casi todo equipo intenta primero es la que menos funciona: desactivar la caché de planes globalmente. Eso cambia un problema puntual por un costo permanente de planificación en todas las consultas del sistema, incluidas las miles que estaban perfectamente bien. La decisión correcta es por consulta, y el criterio es la asimetría de la distribución del parámetro. Si el mismo filtro devuelve treinta y ocho filas para un valor y nueve millones para otro, esa consulta necesita tratamiento explícito. Si la distribución es razonablemente uniforme, el plan en caché es una optimización legítima y no debe tocarse.',
        },
        {
          type: 'paragraph',
          value:
            'La tercera salida es la más barata y la más olvidada. La base mantiene un histograma por columna con un número limitado de compartimentos, y cuando la distribución tiene una cola larga ese número por defecto no representa los valores extremos. Aumentar el objetivo de estadística para la columna de cliente y reanalizar la tabla suele hacer que el optimizador vea que existe un valor con nueve millones de ocurrencias, y a partir de ahí elige planes distintos para valores distintos siempre que pueda planificar por ejecución. Es un cambio de una línea y resuelve más casos de los que parece.',
        },
      ],
    },
    {
      title: 'Estadística envejecida y el momento en que mata',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La recolección automática de estadísticas se dispara cuando se modifica una fracción de la tabla, y esa fracción es proporcional al tamaño. En una tabla de diez mil filas, el disparo ocurre después de unos cientos de cambios. En una de cuarenta millones, solo ocurre después de millones. Cuanto más grande la tabla, más tiempo pasa con estadísticas viejas, y el problema es justamente que las tablas grandes son las que más dependen de buenas estimaciones.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un caso específico que causa incidentes con frecuencia desproporcionada: la columna de fecha en una tabla que solo crece. La estadística guarda el valor máximo observado en la última recolección. Toda consulta que filtra por los últimos siete días cae fuera del intervalo conocido, y el optimizador estima una cantidad minúscula de filas porque, según lo que sabe, ese intervalo está más allá del fin de los datos. Una estimación de una fila en un filtro que devuelve doscientas mil es una receta para el plan equivocado, y ocurre todos los días en toda tabla de eventos que no se reanaliza con frecuencia.',
        },
        {
          type: 'ordered',
          items: [
            'Identifica las tablas cuya distancia entre modificaciones y último análisis supera la fracción de disparo, empezando por las más grandes.',
            'Para tablas de eventos con columna de fecha creciente, reduce el disparo de análisis automático en la propia tabla en vez de tocar el ajuste global.',
            'Aumenta el objetivo de estadística en las columnas usadas en filtros con distribución sesgada y reanaliza, midiendo el plan antes y después.',
            'Declara la dependencia entre columnas correlacionadas cuando la base soporte estadística extendida, para eliminar el error por multiplicación de selectividades.',
            'Registra el plan ejecutado de las consultas críticas como referencia versionada, para que la próxima investigación empiece con una comparación y no con una hipótesis.',
          ],
        },
        {
          type: 'code',
          value: `-- Ajustes por objeto, no globales. Cada uno resuelve una causa distinta.

-- 1) Tabla de eventos que solo crece: analizar con mas frecuencia.
--    El valor por defecto dispara tras el 10% de la tabla modificada, lo
--    que en 40 millones de filas significa 4 millones de inserciones de
--    retraso.
ALTER TABLE pedidos SET (
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_analyze_threshold = 5000
);

-- 2) Columna con distribucion sesgada: mas compartimentos en el histograma.
--    El valor por defecto de 100 no representa a un cliente que por si solo
--    responde por el 20% de las filas.
ALTER TABLE pedidos ALTER COLUMN cliente_id SET STATISTICS 1000;
ANALYZE pedidos;

-- 3) Columnas correlacionadas: decirle al optimizador que no son
--    independientes. Sin esto multiplica las selectividades y falla por
--    ordenes de magnitud en filtros combinados.
CREATE STATISTICS pedidos_cliente_estado_deps (dependencies, ndistinct)
  ON cliente_id, estado FROM pedidos;
ANALYZE pedidos;

-- 4) Verificar que el error de estimacion bajo de verdad, comparando el
--    numero estimado con el real en el mismo filtro.
EXPLAIN (ANALYZE, SUMMARY OFF)
SELECT count(*) FROM pedidos
WHERE cliente_id = 8812 AND estado = 'pagado';

-- Antes:   rows=12      actual rows=184392   -> error de 15000x
-- Despues: rows=176410  actual rows=184392   -> error de 1,04x`,
        },
        {
          type: 'paragraph',
          value:
            'La estadística extendida sobre columnas correlacionadas es el ajuste con mejor relación entre esfuerzo y resultado de este conjunto, y es el menos usado. El caso clásico es un filtro por dos campos donde uno determina el otro: ciudad y provincia, categoría y subcategoría, cliente y canal de origen. Sin la declaración, el optimizador trata cada filtro como un sorteo independiente y multiplica las probabilidades, llegando a una estimación que puede estar cien o mil veces por debajo de la realidad. Con la declaración, pasa a usar el conteo conjunto observado, y el plan cambia en la primera ejecución siguiente.',
        },
      ],
    },
    {
      title: 'Estabilizar el plan sin esconder el problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Después del segundo incidente del mismo tipo, alguien siempre propone fijar el plan. La idea es legítima y el riesgo es conocido: un plan fijado es una decisión tomada con los datos de hoy y aplicada a los datos de dentro de dos años. Si la tabla duplica su tamaño o el perfil de acceso cambia, el plan fijado deja de ser el mejor y no existe un mecanismo que lo perciba solo. Fijar el plan no está mal, es una deuda con fecha de vencimiento que necesita estar escrita en algún lugar.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Cuándo es la elección correcta', 'Qué cuesta'],
          rows: [
            [
              'Corregir la estadística',
              'Error de estimación por encima de diez veces en el nodo problemático',
              'Análisis más frecuente y algo más de trabajo en segundo plano',
            ],
            [
              'Crear índice compuesto en el orden del filtro',
              'El plan correcto existe pero ningún índice lo soporta bien',
              'Escritura más lenta y más espacio, de forma permanente',
            ],
            [
              'Reescribir la consulta',
              'La forma escrita impide el plan bueno, con subconsulta o función sobre la columna',
              'Cambio de código con pruebas, pero sin deuda operativa',
            ],
            [
              'Planificar por ejecución en esa consulta',
              'Distribución sesgada del parámetro, con planes correctos distintos',
              'Costo de planificación en cada llamada de esa consulta',
            ],
            [
              'Fijar el plan',
              'Incidente en curso y ninguna de las opciones anteriores disponible a tiempo',
              'Deuda con revisión obligatoria trimestral y alerta de vigencia',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El orden de esa tabla es el orden de intento, y no es arbitrario. Corregir la estadística es reversible, barato y ataca la causa. Crear un índice es permanente y cobra en cada escritura, así que merece la pregunta de si el plan bueno no existía ya. Reescribir la consulta es la única opción que elimina el problema en vez de compensarlo, y vale siempre que la forma escrita sea la culpable, lo que ocurre con más frecuencia de la que el equipo admite: una función aplicada sobre la columna indexada, una conversión implícita de tipo o un filtro con valor nulo tratado de forma ingenua bastan para volver inutilizable un índice.',
        },
        {
          type: 'paragraph',
          value:
            'Fijar el plan queda en último lugar no porque sea ilegítimo, sino porque es la única opción que congela una decisión y apaga el mecanismo que la corregiría. Cuando sea necesario durante un incidente, la regla que evita el arrepentimiento es simple: toda fijación de plan nace con fecha de revisión y con una alerta que se dispara si la razón entre filas estimadas y reales en ese nodo supera el umbral. Sin esos dos elementos, la fijación se convierte en una decisión de hace dos años que nadie recuerda haber tomado.',
        },
      ],
    },
    {
      title: 'Tres alertas que detectan el cambio de plan antes que el cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El monitoreo habitual de base de datos observa el tiempo medio de consulta, y el tiempo medio es justamente la métrica que pierde este incidente. Una consulta que corre diez mil veces por minuto en cuatro milisegundos y pasa a correr en once segundos para el dos por ciento de los parámetros mantiene el promedio en una franja aceptable durante horas. Lo que cambia de inmediato y de forma inequívoca es el plan, y eso es lo que hay que observar.',
        },
        {
          type: 'list',
          items: [
            'Cambio de identificador de plan para una consulta de la lista de críticas: alerta inmediata, sin umbral de tiempo, porque un plan nuevo es un evento discreto y la comparación es exacta. La alerta lleva el plan anterior y el nuevo lado a lado, para que la decisión de revertir o aceptar se tome en minutos.',
            'Razón entre filas estimadas y filas reales por encima de diez veces en cualquier nodo de consulta crítica: alerta diaria agregada, porque ese número delata estadística envejecida antes de que el plan cambie. Es la única alerta de esta lista que se dispara mientras el rendimiento todavía es bueno, y por eso es la que más incidentes evita.',
            'Percentil noventa y nueve de la consulta por encima de veinte veces la mediana de la misma consulta en la misma ventana: alerta de asimetría, que captura el caso del parámetro capturado. La comparación tiene que ser con la mediana de la propia consulta, no con un umbral absoluto, porque lo que importa es la distancia entre los casos buenos y los malos del mismo SQL.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda alerta es la que cambia el modo de operación del equipo. No reporta lentitud, reporta que el optimizador está trabajando con una descripción equivocada de la tabla, que es una condición que precede a la lentitud por días o semanas. Tratarla como mantenimiento de rutina, y no como incidente, es lo que convierte este tipo de degradación de sorpresa en tarea agendada. La tercera alerta es la que distingue la consulta que está lenta para todos de la que está lenta para algunos, y esa distinción decide entre corregir estadística y separar caminos de ejecución.',
        },
        {
          type: 'paragraph',
          value:
            'Conviene registrar lo que ninguna de estas alertas hace: ninguna dice que el plan nuevo sea peor. Un plan puede cambiar porque la tabla creció y el cambio puede ser correcto. El papel de la alerta es garantizar que el cambio sea visto por alguien el día en que ocurre, con los dos planes disponibles para comparación, en vez de ser descubierto tres semanas después por el equipo comercial que dejó de poder abrir el panel.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Si el plan cambia solo, no es más seguro fijar de una vez todos los planes de las consultas críticas?',
      answer:
        'Fijar todo cambia una clase de problema por otra que tarda mucho más en aparecer y es mucho más difícil de diagnosticar. El plan fijado es correcto para la distribución de datos que existía el día de la fijación, y a partir de ahí deja de acompañar la realidad. El caso que duele es el inverso del incidente original: la tabla crece, el plan bueno pasa a ser otro, y la base sigue ejecutando el plan antiguo porque se le ordenó hacerlo. La degradación en ese escenario es gradual, nadie la asocia con una decisión tomada dos años antes, y la investigación es más larga porque lo primero que se verifica es justamente si el plan cambió, y no cambió. Hay un segundo costo, menos obvio: fijar el plan crea configuración fuera del código de la aplicación, y la configuración fuera del código tiende a divergir entre entornos. Una prueba que pasa en preproducción con planificación libre no prueba nada sobre producción con plan fijado. El enfoque que se sostiene es fijar por excepción, con fecha de revisión, alerta de error de estimación en ese nodo y un registro escrito del motivo. Si la lista de planes fijados crece cada trimestre, el problema real no es el optimizador, es la ausencia de mantenimiento de estadística.',
    },
    {
      question: '¿Cómo distinguir en la práctica la degradación por cambio de plan de la degradación por concurrencia o bloqueo?',
      answer:
        'Las tres tienen firmas distintas y la separación es rápida cuando se sabe qué mirar. El cambio de plan produce un escalón: el tiempo pasa a otro nivel entre dos ejecuciones y se queda en el nivel nuevo, y el consumo de páginas leídas por ejecución cambia junto, generalmente por órdenes de magnitud. La concurrencia produce correlación con la carga: el tiempo sube y baja junto con el número de ejecuciones simultáneas, el consumo de páginas por ejecución se mantiene igual, y el tiempo total es mayor que la suma de los tiempos de los nodos del plan. El bloqueo produce espera sin trabajo: la consulta pasa la mayor parte del tiempo aguardando, el tiempo de procesamiento es bajo, el consumo de páginas es normal y existe un evento de espera identificable en la vista de actividad de la base. La prueba que separa las tres en menos de un minuto es comparar páginas leídas por ejecución antes y después. Si ese número cambió, es el plan. Si está igual y el tiempo subió junto con la carga, es concurrencia. Si está igual, la carga no cambió y el tiempo de procesamiento es una fracción pequeña del tiempo total, es espera, y entonces la pregunta siguiente es por cuál recurso.',
    },
    {
      question: '¿Vale la pena mantener el historial de planes ejecutados en producción, considerando el costo de recolección?',
      answer:
        'Vale la pena, y el costo es menor de lo que sugiere la intuición cuando la recolección se hace por muestreo en vez de recolección total. Recolectar el plan ejecutado de cada ejecución tiene un costo real y no es lo que se propone. Lo que funciona es muestrear: registrar el plan ejecutado de una fracción pequeña de las ejecuciones de las consultas que están en la lista de críticas, más el plan de toda ejecución que supere un umbral de tiempo. La muestra de rutina da la línea base, y la captura por umbral garantiza que el caso malo nunca se escape, que es exactamente lo opuesto de lo que ocurre cuando se muestrea de forma uniforme. Sobre retención, el historial útil es corto para el detalle y largo para el identificador. Guardar el texto completo del plan de siete a catorce días cubre la investigación de cualquier incidente reciente, y guardar solo el identificador del plan con marca de tiempo durante seis meses o más cuesta casi nada y responde la pregunta más valiosa que existe en este asunto: desde cuándo esta consulta usa este plan. Sin ese historial, toda investigación empieza reconstruyendo la línea de tiempo a partir de la memoria de quien estaba de guardia, y la memoria es la peor fuente disponible.',
    },
  ],
  conclusion: {
    title: 'El plan de consulta es una decisión observable, no un efecto colateral',
    description:
      'Que el índice siga existiendo no garantiza que se use, y el tiempo medio de la consulta es la métrica que pierde exactamente el incidente que importa. Puedo revisar el comportamiento de tu base en producción y definir la captura del plan ejecutado de las consultas críticas, la política de estadística por tabla en vez de un ajuste global, la estadística extendida en las columnas correlacionadas, el tratamiento de las consultas con distribución sesgada de parámetro, y las alertas que muestran el cambio de plan el día en que ocurre.',
    cta: 'Hablar sobre el rendimiento de mi base en producción',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Caché invalidada mal: cuando el dato viejo cuesta más caro que la consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default { pt, en, es };
