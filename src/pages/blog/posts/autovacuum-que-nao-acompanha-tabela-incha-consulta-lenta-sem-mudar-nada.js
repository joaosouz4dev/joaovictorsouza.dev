// Conteudo do artigo: autovacuum que nao acompanha, tabela inchada por tuplas
// mortas, horizonte de xmin preso, ajuste por tabela e recuperacao do espaco.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A consulta que lista as entregas pendentes de mensagens respondia em quinze milissegundos desde o lançamento do produto. Em três semanas, sem nenhum deploy, sem mudança de índice e sem aumento relevante de tráfego, ela passou a levar dois segundos e trezentos milissegundos, e a tabela de entregas, que tinha vinte e dois gigabytes, chegou a cento e setenta. O número de linhas vivas era praticamente o mesmo. O plano de execução também. O que tinha mudado era a quantidade de páginas que o banco precisava ler para encontrar as mesmas duzentas linhas, porque a maior parte do que estava no disco eram versões antigas de linhas que ninguém mais via, e que o autovacuum não estava removendo. Ele rodou cento e quarenta vezes nessas três semanas, e em todas terminou sem remover nada, porque uma conexão de uma ferramenta de BI tinha aberto uma transação dezenove dias antes e nunca a fechou. Este artigo explica por que um UPDATE deixa lixo no PostgreSQL, quando o autovacuum dispara e por que em tabelas grandes isso acontece tarde demais, como descobrir o que está segurando a limpeza, como ajustar o autovacuum por tabela, como recuperar o espaço de uma tabela que já inchou sem travar a produção, e quais sinais avisam antes de a consulta ficar lenta.',
  sections: [
    {
      title: 'Por que um UPDATE deixa lixo: MVCC e tuplas mortas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O PostgreSQL não altera uma linha no lugar. Um UPDATE grava uma versão nova da linha e marca a antiga como encerrada por aquela transação, e um DELETE apenas marca a versão como encerrada. A versão antiga continua ocupando espaço na página, porque outras transações abertas podem precisar dela para enxergar os dados como estavam quando começaram. Quando nenhuma transação ativa pode mais vê-la, ela vira uma tupla morta, e só o VACUUM a remove, marcando o espaço como reutilizável para novas versões. Ele não devolve esse espaço ao sistema operacional: a tabela não encolhe, ela para de crescer.',
        },
        {
          type: 'table',
          columns: ['Operação', 'O que fica na tabela', 'O que fica nos índices'],
          rows: [
            ['INSERT', 'Uma versão viva', 'Uma entrada em cada índice'],
            [
              'UPDATE de coluna indexada',
              'Versão nova viva e versão antiga que vai morrer',
              'Uma entrada nova em cada índice, e a antiga continua lá até o VACUUM',
            ],
            [
              'UPDATE HOT, sem coluna indexada e com espaço na página',
              'Versão nova na mesma página, encadeada à antiga',
              'Nenhuma entrada nova',
            ],
            ['DELETE', 'Versão antiga que vai morrer', 'Entradas continuam lá até o VACUUM'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Tabelas de status são o caso mais sensível. Cada mensagem enviada gera uma linha em entregas e, em seguida, três ou quatro atualizações: enviada, entregue, lida, às vezes falhou. Como a coluna status é indexada para a consulta de pendentes, nenhuma dessas atualizações é HOT, e cada uma deixa uma versão morta na tabela e uma entrada morta em cada índice. Se o VACUUM não acompanha esse ritmo, as páginas passam a conter mais versões mortas que vivas, e o sintoma aparece no plano como o mesmo nó de índice lendo muito mais páginas para devolver as mesmas linhas.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, mensagem_id, tentativas
FROM entregas
WHERE status = 'pendente'
ORDER BY criado_em
LIMIT 200;

-- Tres semanas antes: 15 ms
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.031..14.870 rows=200 loops=1)
--     Buffers: shared hit=1204 read=87
--
-- Hoje, mesmo plano, mesmas 200 linhas: 2,3 s
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.044..2291.502 rows=200 loops=1)
--     Buffers: shared hit=48210 read=91022`,
        },
        {
          type: 'paragraph',
          value:
            'Nenhum ajuste no plano resolve isso, porque o plano está certo. O índice aponta para centenas de milhares de versões com status pendente que já foram atualizadas para entregue ou lida, e o executor precisa visitar cada uma na tabela para descobrir que ela não é mais visível. O custo da consulta passou a depender do lixo acumulado, e não dos dados.',
        },
      ],
    },
    {
      title: 'Quando o autovacuum dispara e por que em tabela grande é tarde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O autovacuum acorda a cada minuto, por padrão, e escolhe as tabelas cujo número de tuplas mortas ultrapassou um gatilho calculado por uma fórmula simples: um limite fixo mais uma fração do número de linhas da tabela. Com os valores padrão, isso é 50 mais vinte por cento das linhas. Numa tabela de dez mil linhas, o gatilho é 2.050 tuplas mortas, o que é razoável. Numa tabela de noventa milhões, são dezoito milhões de tuplas mortas antes da primeira limpeza, e a essa altura as páginas quentes já estão cheias de versões que ninguém enxerga.',
        },
        {
          type: 'table',
          columns: ['Parâmetro', 'Padrão', 'Efeito'],
          rows: [
            ['autovacuum_vacuum_scale_factor', '0.2', 'Fração das linhas que precisa estar morta para disparar'],
            ['autovacuum_vacuum_threshold', '50', 'Parcela fixa somada ao gatilho'],
            ['autovacuum_naptime', '1min', 'Intervalo entre as verificações de cada banco'],
            ['autovacuum_max_workers', '3', 'Quantas tabelas podem ser limpas ao mesmo tempo na instância'],
            [
              'autovacuum_vacuum_cost_limit',
              '-1 (usa vacuum_cost_limit = 200)',
              'Orçamento de I/O por rodada, dividido entre todos os workers ativos',
            ],
            ['autovacuum_vacuum_cost_delay', '2ms', 'Pausa depois de gastar o orçamento de cada rodada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Os dois últimos parâmetros explicam o segundo problema: mesmo quando dispara, o autovacuum trabalha devagar de propósito, para não competir com as consultas. Ele gasta um orçamento de custo por rodada, em que cada página que precisa sujar custa bem mais que uma página lida da memória, e dorme ao atingir o limite. Esse orçamento é dividido entre os workers ativos, então três tabelas grandes sendo limpas ao mesmo tempo andam cada uma a um terço da velocidade. Numa tabela que recebe milhões de atualizações por hora, o VACUUM pode simplesmente nunca alcançar a taxa de produção de lixo. A consulta abaixo mostra, para cada tabela, quantas tuplas mortas existem e a partir de quantas o autovacuum vai agir.',
        },
        {
          type: 'code',
          value: `-- Tuplas mortas por tabela e o gatilho do autovacuum com os valores globais.
-- Tabelas com ajuste proprio (ALTER TABLE ... SET) aparecem em c.reloptions.
SELECT s.relname,
       s.n_live_tup,
       s.n_dead_tup,
       round(current_setting('autovacuum_vacuum_threshold')::numeric
             + current_setting('autovacuum_vacuum_scale_factor')::numeric
               * greatest(c.reltuples, 0)::numeric) AS gatilho,
       s.last_autovacuum,
       s.autovacuum_count,
       c.reloptions
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY s.n_dead_tup DESC
LIMIT 15;`,
        },
        {
          type: 'paragraph',
          value:
            'Se n_dead_tup está muito acima do gatilho e last_autovacuum é recente, o autovacuum está rodando, mas não está conseguindo remover o que encontra. Esse é o caso mais comum e o mais mal diagnosticado, porque a reação natural é deixá-lo mais agressivo, e isso não muda nada enquanto a causa real continua ativa.',
        },
      ],
    },
    {
      title: 'O autovacuum roda e não remove nada: o horizonte de xmin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O VACUUM só pode remover versões que morreram antes do snapshot mais antigo ainda em uso em todo o cluster. Esse limite é o horizonte de xmin, e basta uma única coisa segurando esse horizonte para que nenhuma versão morta depois dele seja removida, em nenhuma tabela, por mais vezes que o autovacuum rode. No incidente, a limpeza parou dezenove dias antes, no minuto em que a ferramenta de BI abriu a transação.',
        },
        {
          type: 'diagram',
          value: `dia 0   BI abre transacao (xmin = 8.201.334) e fica "idle in transaction"
dia 1   autovacuum em entregas: 2,1 mi mortas encontradas, 0 removidas
dia 7   autovacuum em entregas: 14 mi mortas encontradas, 0 removidas
dia 19  autovacuum em entregas: 41 mi mortas encontradas, 0 removidas
        horizonte continua em 8.201.334: tudo que morreu depois dele e irremovivel
dia 19  sessao do BI encerrada -> proximo autovacuum remove 41 mi em 38 min`,
        },
        {
          type: 'paragraph',
          value:
            'A sessão ociosa dentro de uma transação é o culpado mais frequente, mas não o único. Um slot de replicação lógica abandonado, de um consumidor de CDC que foi desligado sem remover o slot, segura o horizonte do catálogo e acumula WAL. Uma réplica com hot_standby_feedback ligado, rodando relatórios de horas, empresta o snapshot dela para o primário. E uma transação preparada esquecida, de um gerenciador de transações distribuídas que falhou, fica aberta até alguém executar COMMIT PREPARED ou ROLLBACK PREPARED. A consulta abaixo lista todas essas fontes, ordenadas pela idade.',
        },
        {
          type: 'code',
          value: `-- Quem esta segurando o horizonte de xmin: sessoes, replicas, slots e transacoes preparadas.
SELECT 'sessao' AS origem, pid::text AS id, state,
       greatest(age(backend_xmin), age(backend_xid)) AS idade_xmin,
       now() - xact_start AS duracao,
       left(query, 60) AS detalhe
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
UNION ALL
SELECT 'replica', application_name, state, age(backend_xmin), NULL, NULL
FROM pg_stat_replication
WHERE backend_xmin IS NOT NULL
UNION ALL
SELECT 'slot', slot_name::text, CASE WHEN active THEN 'ativo' ELSE 'inativo' END,
       greatest(age(xmin), age(catalog_xmin)), NULL, slot_type
FROM pg_replication_slots
WHERE xmin IS NOT NULL OR catalog_xmin IS NOT NULL
UNION ALL
SELECT 'preparada', gid, NULL, age(transaction), now() - prepared, NULL
FROM pg_prepared_xacts
ORDER BY idade_xmin DESC NULLS LAST;`,
        },
        {
          type: 'paragraph',
          value:
            'O log do autovacuum confirma o diagnóstico sem ambiguidade. Com log_autovacuum_min_duration configurado, cada execução registra quantas tuplas removeu e quantas encontrou mortas, mas ainda não removíveis, e as versões mais recentes do PostgreSQL também informam a idade do limite de remoção. Uma linha com zero removidas e milhões ainda não removíveis é a assinatura do horizonte preso.',
        },
        {
          type: 'paragraph',
          value:
            'A correção imediata é encerrar a fonte: pg_terminate_backend na sessão, pg_drop_replication_slot no slot abandonado, ROLLBACK PREPARED na transação esquecida. A correção permanente são limites que impedem a repetição: idle_in_transaction_session_timeout para toda a instância, statement_timeout e, a partir do PostgreSQL 17, transaction_timeout nos papéis usados por ferramentas de análise, max_slot_wal_keep_size para que um slot abandonado seja invalidado em vez de segurar tudo indefinidamente, e relatórios longos numa réplica sem hot_standby_feedback, aceitando que eles possam ser cancelados por conflito de replicação.',
        },
      ],
    },
    {
      title: 'Ajustar o autovacuum por tabela, não pela instância inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o horizonte liberado, o próximo passo é fazer o autovacuum chegar antes. Mudar o fator de escala para toda a instância faz com que milhares de tabelas pequenas sejam limpas sem necessidade. O ajuste certo é por tabela, nas poucas que concentram atualizações, trocando a fração por um limite absoluto que faça sentido para o volume delas.',
        },
        {
          type: 'code',
          value: `-- Tabela de status com milhoes de atualizacoes por hora:
-- dispara a cada ~200 mil tuplas mortas, independentemente do tamanho,
-- e com orcamento de I/O proprio, maior que o padrao.
ALTER TABLE entregas SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold    = 200000,
  autovacuum_vacuum_cost_limit   = 2000,
  autovacuum_vacuum_cost_delay   = 1
);

-- Deixa espaco livre em cada pagina para que atualizacoes sem coluna
-- indexada caibam na mesma pagina (HOT). Vale para paginas novas ou reescritas.
ALTER TABLE entregas SET (fillfactor = 85);

-- Na instancia: mais workers e mais orcamento total, porque o limite e
-- dividido entre os workers ativos. Workers exigem reinicio.
ALTER SYSTEM SET autovacuum_max_workers = 6;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 1200;
ALTER SYSTEM SET autovacuum_work_mem = '1GB';
SELECT pg_reload_conf();`,
        },
        {
          type: 'paragraph',
          value:
            'Três observações evitam surpresas. A primeira é que uma tabela com orçamento próprio de custo sai da divisão com os outros workers, então vale reservar isso para as tabelas que realmente precisam. A segunda é que autovacuum_work_mem define quanta memória cada worker usa para guardar os identificadores das tuplas mortas: com pouca memória, a mesma execução precisa varrer todos os índices da tabela várias vezes, e em tabelas com muitos índices isso domina o tempo total. A terceira é revisar se todos os índices que impedem atualizações HOT são necessários: um índice sobre atualizado_em que ninguém consulta transforma toda atualização em escrita em todos os índices.',
        },
        {
          type: 'table',
          columns: ['Sintoma', 'Ajuste', 'Onde'],
          rows: [
            [
              'Gatilho alto demais em tabela grande',
              'scale_factor = 0 e threshold absoluto',
              'Por tabela',
            ],
            [
              'Autovacuum dispara, mas leva horas',
              'cost_limit maior, cost_delay menor',
              'Por tabela ou na instância',
            ],
            ['Várias tabelas grandes na fila ao mesmo tempo', 'Mais autovacuum_max_workers e mais orçamento total', 'Instância'],
            ['Execução varre os índices várias vezes', 'Mais autovacuum_work_mem', 'Instância'],
            ['Poucas atualizações HOT', 'fillfactor menor e remoção de índices desnecessários', 'Por tabela'],
            ['Nenhuma tupla removida', 'Nenhum ajuste de autovacuum ajuda: liberar o horizonte de xmin', 'Sessões, slots e réplicas'],
          ],
        },
      ],
    },
    {
      title: 'Recuperar uma tabela que já inchou sem parar a produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando o horizonte é liberado, o VACUUM remove as versões mortas e a consulta volta a ficar rápida, porque o espaço passa a ser reutilizado e as páginas quentes voltam a ter linhas vivas. Mas o arquivo continua com cento e setenta gigabytes, e isso tem custo: backups maiores, réplicas novas mais lentas para sincronizar, varreduras sequenciais lendo espaço vazio e índices com páginas quase vazias. Antes de decidir reescrever, vale medir o quanto da tabela é realmente espaço livre.',
        },
        {
          type: 'code',
          value: `CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- Estimativa rapida: le apenas as paginas que o mapa de visibilidade nao garante.
SELECT pg_size_pretty(table_len) AS tamanho,
       approx_tuple_percent       AS pct_vivo,
       dead_tuple_percent         AS pct_morto,
       approx_free_percent        AS pct_livre
FROM pgstattuple_approx('entregas');

-- Densidade das folhas de um indice: abaixo de ~50% indica reconstrucao.
SELECT avg_leaf_density, leaf_fragmentation
FROM pgstatindex('entregas_status_criado_idx');`,
        },
        {
          type: 'paragraph',
          value:
            'Se a tabela tem mais de metade de espaço livre e ele não vai ser reaproveitado tão cedo, reescrever compensa. As opções diferem no bloqueio que exigem, e escolher a errada transforma uma manutenção em indisponibilidade.',
        },
        {
          type: 'table',
          columns: ['Opção', 'Bloqueio', 'Espaço extra', 'Quando usar'],
          rows: [
            [
              'VACUUM',
              'Não bloqueia leitura nem escrita',
              'Nenhum',
              'Sempre, primeiro; torna o espaço reutilizável, mas não encolhe o arquivo',
            ],
            [
              'VACUUM FULL',
              'ACCESS EXCLUSIVE durante toda a reescrita',
              'Tamanho da tabela compactada',
              'Só com janela de manutenção ou tabelas pequenas',
            ],
            [
              'pg_repack',
              'ACCESS EXCLUSIVE breve no início e no fim',
              'Tamanho da tabela compactada e dos índices',
              'Tabelas grandes em produção; exige chave primária ou índice único não nulo',
            ],
            [
              'REINDEX CONCURRENTLY',
              'Não bloqueia escrita',
              'Tamanho do índice novo',
              'Índices inchados quando a tabela em si está saudável',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A ordem importa. Reescrever a tabela antes de liberar o horizonte e ajustar o autovacuum é desperdício, porque ela volta a inchar no mesmo ritmo. E o pg_repack também precisa de cuidado com o horizonte: ele roda por horas em tabelas grandes, e enquanto roda também segura o xmin, então o ideal é executá-lo num período de menor volume de atualizações e acompanhar as tuplas mortas das outras tabelas enquanto ele trabalha.',
        },
      ],
    },
    {
      title: 'Sinais que avisam antes de a consulta ficar lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O inchaço é um problema que cresce devagar e aparece de repente, porque a consulta só fica lenta quando as versões mortas passam a dominar as páginas que ela lê. Isso significa que existe uma janela de dias ou semanas em que o problema é visível nas métricas e ainda invisível para o usuário. Os sinais abaixo cobrem essa janela.',
        },
        {
          type: 'table',
          columns: ['Sinal', 'O que revela', 'Quando alertar'],
          rows: [
            [
              'Idade do horizonte de xmin mais antigo',
              'Sessão, slot, réplica ou transação preparada impedindo a limpeza em todo o cluster',
              'Acima de algumas horas em sistema transacional',
            ],
            [
              'Execuções do autovacuum com zero tuplas removidas',
              'Autovacuum rodando em vão por causa do horizonte',
              'Duas execuções seguidas na mesma tabela',
            ],
            [
              'n_dead_tup em relação a n_live_tup nas tabelas quentes',
              'Limpeza que não acompanha a taxa de atualização',
              'Acima de 20% de forma sustentada',
            ],
            [
              'Crescimento do tamanho sem crescimento de linhas vivas',
              'Inchaço acumulando',
              'Tamanho cresce mais que o dobro do ritmo das linhas',
            ],
            [
              'Idade de datfrozenxid por banco',
              'Aproximação do vacuum agressivo contra wraparound',
              'Acima de metade de autovacuum_freeze_max_age',
            ],
          ],
        },
        {
          type: 'code',
          value: `-- Registra toda execucao do autovacuum acima de 10 segundos,
-- incluindo tuplas removidas e mortas ainda nao removiveis.
ALTER SYSTEM SET log_autovacuum_min_duration = '10s';
SELECT pg_reload_conf();

-- Distancia de cada banco ate o vacuum agressivo contra wraparound.
SELECT datname,
       age(datfrozenxid) AS idade_xid,
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::int, 1) AS pct_do_gatilho
FROM pg_database
ORDER BY idade_xid DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'O primeiro sinal da tabela é o mais valioso, porque é o único que aponta para a causa em vez de medir a consequência, e teria disparado no primeiro dia do incidente, dezoito dias antes da primeira reclamação. Ele também é barato: a consulta da terceira seção roda em milissegundos e pode alimentar um alerta a cada minuto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Vale desligar o autovacuum de uma tabela e rodar VACUUM manual de madrugada?',
      answer:
        'Quase nunca. Um VACUUM noturno deixa a tabela acumular um dia inteiro de versões mortas no horário de pico, que é justamente quando as consultas mais precisam de páginas limpas, e concentra toda a limpeza numa execução longa que compete com backups e rotinas noturnas. Além disso, desligar o autovacuum não desliga o vacuum contra wraparound, que dispara de qualquer forma quando a idade das transações chega ao limite, e costuma fazer isso no pior momento. O caminho certo é o oposto: deixar o autovacuum mais frequente e mais rápido nessa tabela, com gatilho absoluto e orçamento próprio, para que cada execução seja curta. Um VACUUM manual agendado faz sentido como complemento, por exemplo depois de um expurgo em massa, e não como substituto.',
    },
    {
      question: 'O que é o autovacuum "to prevent wraparound" e por que ele não para quando preciso?',
      answer:
        'O PostgreSQL identifica transações com um contador de 32 bits, e para que versões antigas continuem visíveis depois que o contador dá a volta, o VACUUM precisa congelar essas versões antes que a idade delas chegue perto de dois bilhões de transações. Quando uma tabela passa de autovacuum_freeze_max_age, duzentos milhões por padrão, o autovacuum inicia uma execução agressiva que varre todas as páginas não congeladas e que, ao contrário da execução normal, não se cancela sozinha quando outra sessão pede um bloqueio conflitante. É por isso que um ALTER TABLE fica esperando atrás dele. Cancelar manualmente só adia o problema, porque ele volta no minuto seguinte, e se a idade continuar subindo o banco acaba recusando novas transações para se proteger. A solução é não chegar lá: monitorar a idade de datfrozenxid, garantir que o horizonte de xmin não fique preso, que é também o que impede o congelamento, e deixar o autovacuum normal fazer esse trabalho aos poucos.',
    },
    {
      question: 'Por que a tabela não diminuiu depois que o VACUUM rodou?',
      answer:
        'Porque não é essa a função dele. O VACUUM comum marca o espaço das versões mortas como livre dentro das páginas e atualiza o mapa de espaço livre, para que novas versões ocupem esse espaço em vez de estender o arquivo. Ele só devolve espaço ao sistema operacional quando as páginas vazias estão no fim do arquivo, e mesmo isso exige um bloqueio breve que ele desiste de pegar se houver concorrência. Na prática, isso é bom: uma tabela de atualizações constantes vai precisar desse espaço de novo, e o que importa para o desempenho é que ele seja reutilizado. Encolher o arquivo só é necessário quando o inchaço é muito maior que o volume que a tabela vai voltar a usar, e aí a ferramenta é pg_repack ou, com janela de manutenção, VACUUM FULL.',
    },
  ],
  conclusion: {
    title: 'Tabela inchada é lixo que ninguém recolheu, e quase sempre alguém está segurando a porta',
    description:
      'No PostgreSQL, todo UPDATE e todo DELETE deixam uma versão antiga que só o VACUUM remove, e em tabelas de status com muitas atualizações o ritmo de produção desse lixo é alto. O autovacuum padrão dispara tarde em tabelas grandes e trabalha devagar de propósito, mas a causa mais comum de inchaço é outra: uma sessão ociosa dentro de uma transação, um slot de replicação abandonado, uma réplica com hot_standby_feedback ou uma transação preparada esquecida segurando o horizonte de xmin, o que faz o autovacuum rodar sem remover nada. Liberar o horizonte e impor limites que impeçam a repetição vem primeiro, depois o ajuste por tabela, e só então a reescrita com pg_repack. Posso analisar o seu banco, encontrar o que está segurando a limpeza, ajustar o autovacuum nas tabelas certas e recuperar o espaço sem janela de manutenção.',
    cta: 'Falar sobre o desempenho do meu banco de dados',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Paginação por offset em tabela grande: quando a página 500 derruba o banco',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The query that lists pending message deliveries had answered in fifteen milliseconds since the product launched. Over three weeks, with no deploy, no index change and no meaningful traffic increase, it started taking two seconds and three hundred milliseconds, and the deliveries table, which had been twenty-two gigabytes, reached one hundred and seventy. The number of live rows was practically the same. So was the execution plan. What had changed was how many pages the database had to read to find the same two hundred rows, because most of what was on disk were old versions of rows nobody could see anymore, which autovacuum was not removing. It ran one hundred and forty times in those three weeks, and every time it finished without removing anything, because a connection from a BI tool had opened a transaction nineteen days earlier and never closed it. This article explains why an UPDATE leaves garbage behind in PostgreSQL, when autovacuum triggers and why on large tables that happens too late, how to find what is holding back the cleanup, how to tune autovacuum per table, how to reclaim space from a table that has already bloated without locking production, and which signals warn you before the query gets slow.',
  sections: [
    {
      title: 'Why an UPDATE leaves garbage: MVCC and dead tuples',
      blocks: [
        {
          type: 'paragraph',
          value:
            'PostgreSQL does not change a row in place. An UPDATE writes a new version of the row and marks the old one as ended by that transaction, and a DELETE only marks the version as ended. The old version keeps taking up space on the page, because other open transactions may need it to see the data as it was when they started. When no active transaction can see it anymore, it becomes a dead tuple, and only VACUUM removes it, marking the space as reusable for new versions. It does not give that space back to the operating system: the table does not shrink, it stops growing.',
        },
        {
          type: 'table',
          columns: ['Operation', 'What stays in the table', 'What stays in the indexes'],
          rows: [
            ['INSERT', 'One live version', 'One entry in each index'],
            [
              'UPDATE of an indexed column',
              'A new live version and an old version that will die',
              'A new entry in each index, and the old one stays until VACUUM',
            ],
            [
              'HOT UPDATE, no indexed column and room on the page',
              'New version on the same page, chained to the old one',
              'No new entry',
            ],
            ['DELETE', 'Old version that will die', 'Entries stay until VACUUM'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Status tables are the most sensitive case. Each message sent creates a row in entregas and then three or four updates: sent, delivered, read, sometimes failed. Because the status column is indexed for the pending query, none of those updates is HOT, and each one leaves a dead version in the table and a dead entry in every index. If VACUUM does not keep up with that pace, pages end up holding more dead versions than live ones, and the symptom shows in the plan as the same index node reading many more pages to return the same rows.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, mensagem_id, tentativas
FROM entregas
WHERE status = 'pendente'
ORDER BY criado_em
LIMIT 200;

-- Three weeks earlier: 15 ms
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.031..14.870 rows=200 loops=1)
--     Buffers: shared hit=1204 read=87
--
-- Today, same plan, same 200 rows: 2.3 s
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.044..2291.502 rows=200 loops=1)
--     Buffers: shared hit=48210 read=91022`,
        },
        {
          type: 'paragraph',
          value:
            'No plan tweak fixes this, because the plan is right. The index points to hundreds of thousands of versions with a pending status that have already been updated to delivered or read, and the executor has to visit each one in the table to find out it is no longer visible. The cost of the query now depends on accumulated garbage, not on the data.',
        },
      ],
    },
    {
      title: 'When autovacuum triggers and why on a large table it is too late',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Autovacuum wakes up every minute by default and picks the tables whose number of dead tuples has crossed a trigger computed by a simple formula: a fixed threshold plus a fraction of the table\'s row count. With the default values, that is 50 plus twenty percent of the rows. On a table with ten thousand rows, the trigger is 2,050 dead tuples, which is reasonable. On a table with ninety million, it is eighteen million dead tuples before the first cleanup, and by then the hot pages are already full of versions nobody can see.',
        },
        {
          type: 'table',
          columns: ['Parameter', 'Default', 'Effect'],
          rows: [
            ['autovacuum_vacuum_scale_factor', '0.2', 'Fraction of rows that must be dead to trigger'],
            ['autovacuum_vacuum_threshold', '50', 'Fixed amount added to the trigger'],
            ['autovacuum_naptime', '1min', 'Interval between checks of each database'],
            ['autovacuum_max_workers', '3', 'How many tables can be vacuumed at once across the instance'],
            [
              'autovacuum_vacuum_cost_limit',
              '-1 (uses vacuum_cost_limit = 200)',
              'I/O budget per round, split among all active workers',
            ],
            ['autovacuum_vacuum_cost_delay', '2ms', 'Pause after spending each round\'s budget'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last two parameters explain the second problem: even when it triggers, autovacuum works slowly on purpose, so as not to compete with queries. It spends a cost budget per round, in which each page it has to dirty costs far more than a page read from memory, and it sleeps when it hits the limit. That budget is split among the active workers, so three large tables being vacuumed at the same time each move at a third of the speed. On a table that receives millions of updates per hour, VACUUM may simply never catch up with the rate of garbage production. The query below shows, for each table, how many dead tuples exist and at what point autovacuum will act.',
        },
        {
          type: 'code',
          value: `-- Dead tuples per table and the autovacuum trigger with the global values.
-- Tables with their own settings (ALTER TABLE ... SET) show up in c.reloptions.
SELECT s.relname,
       s.n_live_tup,
       s.n_dead_tup,
       round(current_setting('autovacuum_vacuum_threshold')::numeric
             + current_setting('autovacuum_vacuum_scale_factor')::numeric
               * greatest(c.reltuples, 0)::numeric) AS gatilho,
       s.last_autovacuum,
       s.autovacuum_count,
       c.reloptions
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY s.n_dead_tup DESC
LIMIT 15;`,
        },
        {
          type: 'paragraph',
          value:
            'If n_dead_tup is far above the trigger and last_autovacuum is recent, autovacuum is running but cannot remove what it finds. This is the most common case and the most misdiagnosed one, because the natural reaction is to make it more aggressive, and that changes nothing while the real cause is still active.',
        },
      ],
    },
    {
      title: 'Autovacuum runs and removes nothing: the xmin horizon',
      blocks: [
        {
          type: 'paragraph',
          value:
            'VACUUM can only remove versions that died before the oldest snapshot still in use anywhere in the cluster. That limit is the xmin horizon, and a single thing holding it back is enough to make every version that died after it unremovable, in every table, no matter how many times autovacuum runs. In the incident, cleanup stopped nineteen days earlier, the minute the BI tool opened its transaction.',
        },
        {
          type: 'diagram',
          value: `day 0   BI opens a transaction (xmin = 8,201,334) and sits "idle in transaction"
day 1   autovacuum on entregas: 2.1 M dead found, 0 removed
day 7   autovacuum on entregas: 14 M dead found, 0 removed
day 19  autovacuum on entregas: 41 M dead found, 0 removed
        horizon still at 8,201,334: everything that died after it is unremovable
day 19  BI session terminated -> next autovacuum removes 41 M in 38 min`,
        },
        {
          type: 'paragraph',
          value:
            'A session idle inside a transaction is the most frequent culprit, but not the only one. An abandoned logical replication slot, from a CDC consumer that was shut down without removing the slot, holds back the catalog horizon and piles up WAL. A replica with hot_standby_feedback enabled, running hour-long reports, lends its snapshot to the primary. And a forgotten prepared transaction, from a distributed transaction manager that failed, stays open until someone runs COMMIT PREPARED or ROLLBACK PREPARED. The query below lists all of these sources, ordered by age.',
        },
        {
          type: 'code',
          value: `-- Who is holding back the xmin horizon: sessions, replicas, slots and prepared transactions.
SELECT 'sessao' AS origem, pid::text AS id, state,
       greatest(age(backend_xmin), age(backend_xid)) AS idade_xmin,
       now() - xact_start AS duracao,
       left(query, 60) AS detalhe
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
UNION ALL
SELECT 'replica', application_name, state, age(backend_xmin), NULL, NULL
FROM pg_stat_replication
WHERE backend_xmin IS NOT NULL
UNION ALL
SELECT 'slot', slot_name::text, CASE WHEN active THEN 'ativo' ELSE 'inativo' END,
       greatest(age(xmin), age(catalog_xmin)), NULL, slot_type
FROM pg_replication_slots
WHERE xmin IS NOT NULL OR catalog_xmin IS NOT NULL
UNION ALL
SELECT 'preparada', gid, NULL, age(transaction), now() - prepared, NULL
FROM pg_prepared_xacts
ORDER BY idade_xmin DESC NULLS LAST;`,
        },
        {
          type: 'paragraph',
          value:
            'The autovacuum log confirms the diagnosis without ambiguity. With log_autovacuum_min_duration configured, each run records how many tuples it removed and how many it found dead but not yet removable, and recent PostgreSQL versions also report the age of the removal cutoff. A line with zero removed and millions not yet removable is the signature of a stuck horizon.',
        },
        {
          type: 'paragraph',
          value:
            'The immediate fix is to end the source: pg_terminate_backend on the session, pg_drop_replication_slot on the abandoned slot, ROLLBACK PREPARED on the forgotten transaction. The permanent fix is limits that prevent a repeat: idle_in_transaction_session_timeout for the whole instance, statement_timeout and, from PostgreSQL 17 on, transaction_timeout on the roles used by analytics tools, max_slot_wal_keep_size so that an abandoned slot gets invalidated instead of holding everything back indefinitely, and long reports on a replica without hot_standby_feedback, accepting that they may be canceled by replication conflicts.',
        },
      ],
    },
    {
      title: 'Tune autovacuum per table, not for the whole instance',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the horizon released, the next step is to make autovacuum arrive earlier. Changing the scale factor for the whole instance makes thousands of small tables get vacuumed for no reason. The right adjustment is per table, on the few that concentrate updates, replacing the fraction with an absolute threshold that makes sense for their volume.',
        },
        {
          type: 'code',
          value: `-- Status table with millions of updates per hour:
-- triggers every ~200 thousand dead tuples, regardless of size,
-- and with its own I/O budget, larger than the default.
ALTER TABLE entregas SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold    = 200000,
  autovacuum_vacuum_cost_limit   = 2000,
  autovacuum_vacuum_cost_delay   = 1
);

-- Leaves free space in each page so updates without an indexed
-- column fit on the same page (HOT). Applies to new or rewritten pages.
ALTER TABLE entregas SET (fillfactor = 85);

-- On the instance: more workers and a larger total budget, because the limit
-- is split among the active workers. Workers require a restart.
ALTER SYSTEM SET autovacuum_max_workers = 6;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 1200;
ALTER SYSTEM SET autovacuum_work_mem = '1GB';
SELECT pg_reload_conf();`,
        },
        {
          type: 'paragraph',
          value:
            'Three observations avoid surprises. The first is that a table with its own cost budget leaves the split with the other workers, so it is worth reserving that for the tables that really need it. The second is that autovacuum_work_mem defines how much memory each worker uses to hold the identifiers of dead tuples: with little memory, the same run has to scan every index of the table several times, and on tables with many indexes that dominates the total time. The third is to check whether every index that prevents HOT updates is necessary: an index on atualizado_em that nobody queries turns every update into a write to every index.',
        },
        {
          type: 'table',
          columns: ['Symptom', 'Adjustment', 'Where'],
          rows: [
            ['Trigger too high on a large table', 'scale_factor = 0 and an absolute threshold', 'Per table'],
            ['Autovacuum triggers but takes hours', 'Higher cost_limit, lower cost_delay', 'Per table or on the instance'],
            ['Several large tables queued at once', 'More autovacuum_max_workers and a larger total budget', 'Instance'],
            ['A run scans the indexes several times', 'More autovacuum_work_mem', 'Instance'],
            ['Few HOT updates', 'Lower fillfactor and removal of unnecessary indexes', 'Per table'],
            ['No tuples removed', 'No autovacuum setting helps: release the xmin horizon', 'Sessions, slots and replicas'],
          ],
        },
      ],
    },
    {
      title: 'Reclaim a table that has already bloated without stopping production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Once the horizon is released, VACUUM removes the dead versions and the query becomes fast again, because the space is reused and the hot pages hold live rows again. But the file is still one hundred and seventy gigabytes, and that has a cost: larger backups, new replicas slower to sync, sequential scans reading empty space and indexes with nearly empty pages. Before deciding to rewrite, it is worth measuring how much of the table is actually free space.',
        },
        {
          type: 'code',
          value: `CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- Quick estimate: reads only the pages the visibility map does not vouch for.
SELECT pg_size_pretty(table_len) AS tamanho,
       approx_tuple_percent       AS pct_vivo,
       dead_tuple_percent         AS pct_morto,
       approx_free_percent        AS pct_livre
FROM pgstattuple_approx('entregas');

-- Leaf density of an index: below ~50% suggests a rebuild.
SELECT avg_leaf_density, leaf_fragmentation
FROM pgstatindex('entregas_status_criado_idx');`,
        },
        {
          type: 'paragraph',
          value:
            'If more than half the table is free space and it will not be reused any time soon, rewriting pays off. The options differ in the lock they require, and picking the wrong one turns maintenance into downtime.',
        },
        {
          type: 'table',
          columns: ['Option', 'Lock', 'Extra space', 'When to use'],
          rows: [
            [
              'VACUUM',
              'Blocks neither reads nor writes',
              'None',
              'Always, first; makes the space reusable but does not shrink the file',
            ],
            [
              'VACUUM FULL',
              'ACCESS EXCLUSIVE for the whole rewrite',
              'Size of the compacted table',
              'Only with a maintenance window or on small tables',
            ],
            [
              'pg_repack',
              'Brief ACCESS EXCLUSIVE at the start and end',
              'Size of the compacted table and its indexes',
              'Large tables in production; requires a primary key or a non-null unique index',
            ],
            [
              'REINDEX CONCURRENTLY',
              'Does not block writes',
              'Size of the new index',
              'Bloated indexes when the table itself is healthy',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Order matters. Rewriting the table before releasing the horizon and tuning autovacuum is wasted effort, because it bloats again at the same pace. And pg_repack also needs care with the horizon: it runs for hours on large tables, and while it runs it also holds back xmin, so ideally run it during a period of lower update volume and watch the dead tuples of the other tables while it works.',
        },
      ],
    },
    {
      title: 'Signals that warn you before the query gets slow',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Bloat is a problem that grows slowly and shows up suddenly, because the query only gets slow when dead versions come to dominate the pages it reads. That means there is a window of days or weeks in which the problem is visible in the metrics and still invisible to users. The signals below cover that window.',
        },
        {
          type: 'table',
          columns: ['Signal', 'What it reveals', 'When to alert'],
          rows: [
            [
              'Age of the oldest xmin horizon',
              'A session, slot, replica or prepared transaction preventing cleanup across the cluster',
              'Above a few hours on a transactional system',
            ],
            [
              'Autovacuum runs with zero tuples removed',
              'Autovacuum running in vain because of the horizon',
              'Two consecutive runs on the same table',
            ],
            [
              'n_dead_tup relative to n_live_tup on hot tables',
              'Cleanup that cannot keep up with the update rate',
              'Above 20% on a sustained basis',
            ],
            [
              'Size growth without live row growth',
              'Bloat accumulating',
              'Size grows at more than twice the pace of the rows',
            ],
            [
              'Age of datfrozenxid per database',
              'Approaching the aggressive anti-wraparound vacuum',
              'Above half of autovacuum_freeze_max_age',
            ],
          ],
        },
        {
          type: 'code',
          value: `-- Logs every autovacuum run longer than 10 seconds,
-- including removed tuples and dead tuples not yet removable.
ALTER SYSTEM SET log_autovacuum_min_duration = '10s';
SELECT pg_reload_conf();

-- Distance of each database to the aggressive anti-wraparound vacuum.
SELECT datname,
       age(datfrozenxid) AS idade_xid,
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::int, 1) AS pct_do_gatilho
FROM pg_database
ORDER BY idade_xid DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'The first signal in the table is the most valuable, because it is the only one that points at the cause instead of measuring the consequence, and it would have fired on the first day of the incident, eighteen days before the first complaint. It is also cheap: the query from the third section runs in milliseconds and can feed an alert every minute.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Is it worth disabling autovacuum on a table and running a manual VACUUM overnight?',
      answer:
        'Almost never. A nightly VACUUM lets the table accumulate a full day of dead versions during peak hours, which is exactly when queries most need clean pages, and it concentrates all the cleanup into one long run that competes with backups and nightly jobs. Besides, disabling autovacuum does not disable the anti-wraparound vacuum, which triggers anyway when transaction age reaches the limit, and tends to do so at the worst moment. The right path is the opposite: make autovacuum more frequent and faster on that table, with an absolute trigger and its own budget, so that each run is short. A scheduled manual VACUUM makes sense as a complement, for example after a mass purge, not as a replacement.',
    },
    {
      question: 'What is the "to prevent wraparound" autovacuum and why does it not stop when I need it to?',
      answer:
        'PostgreSQL identifies transactions with a 32-bit counter, and for old versions to remain visible after the counter wraps around, VACUUM has to freeze those versions before their age gets close to two billion transactions. When a table goes past autovacuum_freeze_max_age, two hundred million by default, autovacuum starts an aggressive run that scans every unfrozen page and that, unlike a normal run, does not cancel itself when another session requests a conflicting lock. That is why an ALTER TABLE ends up waiting behind it. Canceling it manually only postpones the problem, because it comes back the next minute, and if the age keeps rising the database eventually refuses new transactions to protect itself. The solution is not getting there: monitor the age of datfrozenxid, make sure the xmin horizon does not get stuck, which is also what prevents freezing, and let the normal autovacuum do that work gradually.',
    },
    {
      question: 'Why did the table not shrink after VACUUM ran?',
      answer:
        'Because that is not what it does. A plain VACUUM marks the space of dead versions as free inside the pages and updates the free space map, so new versions take that space instead of extending the file. It only returns space to the operating system when the empty pages are at the end of the file, and even that requires a brief lock it gives up on if there is contention. In practice, that is good: a table with constant updates will need that space again, and what matters for performance is that it gets reused. Shrinking the file is only necessary when the bloat is much larger than the volume the table will use again, and then the tool is pg_repack or, with a maintenance window, VACUUM FULL.',
    },
  ],
  conclusion: {
    title: 'A bloated table is garbage nobody collected, and someone is almost always holding the door',
    description:
      'In PostgreSQL, every UPDATE and every DELETE leaves an old version that only VACUUM removes, and on status tables with many updates the rate of garbage production is high. The default autovacuum triggers late on large tables and works slowly on purpose, but the most common cause of bloat is something else: a session idle inside a transaction, an abandoned replication slot, a replica with hot_standby_feedback or a forgotten prepared transaction holding back the xmin horizon, which makes autovacuum run without removing anything. Releasing the horizon and enforcing limits that prevent a repeat comes first, then per table tuning, and only then a rewrite with pg_repack. I can analyze your database, find what is holding back the cleanup, tune autovacuum on the right tables and reclaim the space without a maintenance window.',
    cta: 'Talk about my database performance',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Offset pagination on a large table: when page 500 takes down the database',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La consulta que lista las entregas pendientes de mensajes respondía en quince milisegundos desde el lanzamiento del producto. En tres semanas, sin ningún despliegue, sin cambios de índice y sin un aumento relevante de tráfico, pasó a tardar dos segundos y trescientos milisegundos, y la tabla de entregas, que tenía veintidós gigabytes, llegó a ciento setenta. El número de filas vivas era prácticamente el mismo. El plan de ejecución también. Lo que había cambiado era la cantidad de páginas que la base tenía que leer para encontrar las mismas doscientas filas, porque la mayor parte de lo que había en disco eran versiones antiguas de filas que nadie veía ya, y que el autovacuum no estaba eliminando. Se ejecutó ciento cuarenta veces en esas tres semanas, y en todas terminó sin eliminar nada, porque una conexión de una herramienta de BI había abierto una transacción diecinueve días antes y nunca la cerró. Este artículo explica por qué un UPDATE deja basura en PostgreSQL, cuándo se dispara el autovacuum y por qué en tablas grandes eso ocurre demasiado tarde, cómo descubrir qué está reteniendo la limpieza, cómo ajustar el autovacuum por tabla, cómo recuperar el espacio de una tabla que ya se hinchó sin bloquear producción, y qué señales avisan antes de que la consulta se vuelva lenta.',
  sections: [
    {
      title: 'Por qué un UPDATE deja basura: MVCC y tuplas muertas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'PostgreSQL no modifica una fila en su lugar. Un UPDATE escribe una versión nueva de la fila y marca la antigua como terminada por esa transacción, y un DELETE solo marca la versión como terminada. La versión antigua sigue ocupando espacio en la página, porque otras transacciones abiertas pueden necesitarla para ver los datos como estaban cuando empezaron. Cuando ninguna transacción activa puede verla, se convierte en una tupla muerta, y solo el VACUUM la elimina, marcando el espacio como reutilizable para versiones nuevas. No devuelve ese espacio al sistema operativo: la tabla no se encoge, deja de crecer.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Qué queda en la tabla', 'Qué queda en los índices'],
          rows: [
            ['INSERT', 'Una versión viva', 'Una entrada en cada índice'],
            [
              'UPDATE de columna indexada',
              'Versión nueva viva y versión antigua que va a morir',
              'Una entrada nueva en cada índice, y la antigua sigue ahí hasta el VACUUM',
            ],
            [
              'UPDATE HOT, sin columna indexada y con espacio en la página',
              'Versión nueva en la misma página, encadenada a la antigua',
              'Ninguna entrada nueva',
            ],
            ['DELETE', 'Versión antigua que va a morir', 'Las entradas siguen ahí hasta el VACUUM'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las tablas de estado son el caso más sensible. Cada mensaje enviado genera una fila en entregas y, a continuación, tres o cuatro actualizaciones: enviado, entregado, leído, a veces fallido. Como la columna status está indexada para la consulta de pendientes, ninguna de esas actualizaciones es HOT, y cada una deja una versión muerta en la tabla y una entrada muerta en cada índice. Si el VACUUM no sigue ese ritmo, las páginas pasan a contener más versiones muertas que vivas, y el síntoma aparece en el plan como el mismo nodo de índice leyendo muchas más páginas para devolver las mismas filas.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, mensagem_id, tentativas
FROM entregas
WHERE status = 'pendente'
ORDER BY criado_em
LIMIT 200;

-- Tres semanas antes: 15 ms
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.031..14.870 rows=200 loops=1)
--     Buffers: shared hit=1204 read=87
--
-- Hoy, mismo plan, mismas 200 filas: 2,3 s
--   Index Scan using entregas_status_criado_idx on entregas
--     (actual time=0.044..2291.502 rows=200 loops=1)
--     Buffers: shared hit=48210 read=91022`,
        },
        {
          type: 'paragraph',
          value:
            'Ningún ajuste del plan resuelve esto, porque el plan es correcto. El índice apunta a cientos de miles de versiones con estado pendiente que ya se actualizaron a entregado o leído, y el ejecutor tiene que visitar cada una en la tabla para descubrir que ya no es visible. El costo de la consulta pasó a depender de la basura acumulada, y no de los datos.',
        },
      ],
    },
    {
      title: 'Cuándo se dispara el autovacuum y por qué en una tabla grande es tarde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El autovacuum despierta cada minuto por defecto y elige las tablas cuyo número de tuplas muertas superó un umbral calculado con una fórmula simple: un límite fijo más una fracción del número de filas de la tabla. Con los valores por defecto, eso es 50 más el veinte por ciento de las filas. En una tabla de diez mil filas, el umbral es de 2.050 tuplas muertas, lo que es razonable. En una de noventa millones, son dieciocho millones de tuplas muertas antes de la primera limpieza, y para entonces las páginas calientes ya están llenas de versiones que nadie ve.',
        },
        {
          type: 'table',
          columns: ['Parámetro', 'Por defecto', 'Efecto'],
          rows: [
            ['autovacuum_vacuum_scale_factor', '0.2', 'Fracción de las filas que debe estar muerta para dispararse'],
            ['autovacuum_vacuum_threshold', '50', 'Parte fija sumada al umbral'],
            ['autovacuum_naptime', '1min', 'Intervalo entre las revisiones de cada base'],
            ['autovacuum_max_workers', '3', 'Cuántas tablas se pueden limpiar a la vez en la instancia'],
            [
              'autovacuum_vacuum_cost_limit',
              '-1 (usa vacuum_cost_limit = 200)',
              'Presupuesto de I/O por ronda, repartido entre todos los workers activos',
            ],
            ['autovacuum_vacuum_cost_delay', '2ms', 'Pausa después de gastar el presupuesto de cada ronda'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los dos últimos parámetros explican el segundo problema: incluso cuando se dispara, el autovacuum trabaja despacio a propósito, para no competir con las consultas. Gasta un presupuesto de costo por ronda, en el que cada página que tiene que ensuciar cuesta mucho más que una página leída de memoria, y duerme al alcanzar el límite. Ese presupuesto se reparte entre los workers activos, así que tres tablas grandes limpiándose a la vez avanzan cada una a un tercio de la velocidad. En una tabla que recibe millones de actualizaciones por hora, el VACUUM puede simplemente no alcanzar nunca el ritmo de producción de basura. La consulta siguiente muestra, para cada tabla, cuántas tuplas muertas hay y a partir de cuántas actuará el autovacuum.',
        },
        {
          type: 'code',
          value: `-- Tuplas muertas por tabla y el umbral del autovacuum con los valores globales.
-- Las tablas con ajuste propio (ALTER TABLE ... SET) aparecen en c.reloptions.
SELECT s.relname,
       s.n_live_tup,
       s.n_dead_tup,
       round(current_setting('autovacuum_vacuum_threshold')::numeric
             + current_setting('autovacuum_vacuum_scale_factor')::numeric
               * greatest(c.reltuples, 0)::numeric) AS gatilho,
       s.last_autovacuum,
       s.autovacuum_count,
       c.reloptions
FROM pg_stat_user_tables s
JOIN pg_class c ON c.oid = s.relid
ORDER BY s.n_dead_tup DESC
LIMIT 15;`,
        },
        {
          type: 'paragraph',
          value:
            'Si n_dead_tup está muy por encima del umbral y last_autovacuum es reciente, el autovacuum se está ejecutando, pero no logra eliminar lo que encuentra. Es el caso más común y el peor diagnosticado, porque la reacción natural es hacerlo más agresivo, y eso no cambia nada mientras la causa real siga activa.',
        },
      ],
    },
    {
      title: 'El autovacuum se ejecuta y no elimina nada: el horizonte de xmin',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El VACUUM solo puede eliminar versiones que murieron antes del snapshot más antiguo todavía en uso en todo el clúster. Ese límite es el horizonte de xmin, y basta una sola cosa reteniéndolo para que ninguna versión muerta después de él pueda eliminarse, en ninguna tabla, por muchas veces que se ejecute el autovacuum. En el incidente, la limpieza se detuvo diecinueve días antes, en el minuto en que la herramienta de BI abrió la transacción.',
        },
        {
          type: 'diagram',
          value: `dia 0   BI abre una transaccion (xmin = 8.201.334) y queda "idle in transaction"
dia 1   autovacuum en entregas: 2,1 M muertas encontradas, 0 eliminadas
dia 7   autovacuum en entregas: 14 M muertas encontradas, 0 eliminadas
dia 19  autovacuum en entregas: 41 M muertas encontradas, 0 eliminadas
        el horizonte sigue en 8.201.334: todo lo que murio despues no se puede eliminar
dia 19  sesion del BI terminada -> el siguiente autovacuum elimina 41 M en 38 min`,
        },
        {
          type: 'paragraph',
          value:
            'La sesión inactiva dentro de una transacción es el culpable más frecuente, pero no el único. Un slot de replicación lógica abandonado, de un consumidor de CDC que se apagó sin eliminar el slot, retiene el horizonte del catálogo y acumula WAL. Una réplica con hot_standby_feedback activado, ejecutando informes de horas, le presta su snapshot al primario. Y una transacción preparada olvidada, de un gestor de transacciones distribuidas que falló, queda abierta hasta que alguien ejecute COMMIT PREPARED o ROLLBACK PREPARED. La consulta siguiente lista todas esas fuentes, ordenadas por antigüedad.',
        },
        {
          type: 'code',
          value: `-- Quien retiene el horizonte de xmin: sesiones, replicas, slots y transacciones preparadas.
SELECT 'sessao' AS origem, pid::text AS id, state,
       greatest(age(backend_xmin), age(backend_xid)) AS idade_xmin,
       now() - xact_start AS duracao,
       left(query, 60) AS detalhe
FROM pg_stat_activity
WHERE backend_xmin IS NOT NULL OR backend_xid IS NOT NULL
UNION ALL
SELECT 'replica', application_name, state, age(backend_xmin), NULL, NULL
FROM pg_stat_replication
WHERE backend_xmin IS NOT NULL
UNION ALL
SELECT 'slot', slot_name::text, CASE WHEN active THEN 'ativo' ELSE 'inativo' END,
       greatest(age(xmin), age(catalog_xmin)), NULL, slot_type
FROM pg_replication_slots
WHERE xmin IS NOT NULL OR catalog_xmin IS NOT NULL
UNION ALL
SELECT 'preparada', gid, NULL, age(transaction), now() - prepared, NULL
FROM pg_prepared_xacts
ORDER BY idade_xmin DESC NULLS LAST;`,
        },
        {
          type: 'paragraph',
          value:
            'El registro del autovacuum confirma el diagnóstico sin ambigüedad. Con log_autovacuum_min_duration configurado, cada ejecución registra cuántas tuplas eliminó y cuántas encontró muertas pero todavía no eliminables, y las versiones recientes de PostgreSQL también informan la antigüedad del límite de eliminación. Una línea con cero eliminadas y millones todavía no eliminables es la firma del horizonte atascado.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección inmediata es terminar la fuente: pg_terminate_backend en la sesión, pg_drop_replication_slot en el slot abandonado, ROLLBACK PREPARED en la transacción olvidada. La corrección permanente son límites que impidan la repetición: idle_in_transaction_session_timeout para toda la instancia, statement_timeout y, a partir de PostgreSQL 17, transaction_timeout en los roles que usan las herramientas de análisis, max_slot_wal_keep_size para que un slot abandonado se invalide en lugar de retenerlo todo indefinidamente, e informes largos en una réplica sin hot_standby_feedback, aceptando que puedan cancelarse por conflicto de replicación.',
        },
      ],
    },
    {
      title: 'Ajustar el autovacuum por tabla, no para toda la instancia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el horizonte liberado, el siguiente paso es que el autovacuum llegue antes. Cambiar el factor de escala para toda la instancia hace que miles de tablas pequeñas se limpien sin necesidad. El ajuste correcto es por tabla, en las pocas que concentran actualizaciones, sustituyendo la fracción por un umbral absoluto que tenga sentido para su volumen.',
        },
        {
          type: 'code',
          value: `-- Tabla de estado con millones de actualizaciones por hora:
-- se dispara cada ~200 mil tuplas muertas, sin importar el tamano,
-- y con presupuesto de I/O propio, mayor que el por defecto.
ALTER TABLE entregas SET (
  autovacuum_vacuum_scale_factor = 0,
  autovacuum_vacuum_threshold    = 200000,
  autovacuum_vacuum_cost_limit   = 2000,
  autovacuum_vacuum_cost_delay   = 1
);

-- Deja espacio libre en cada pagina para que las actualizaciones sin columna
-- indexada quepan en la misma pagina (HOT). Aplica a paginas nuevas o reescritas.
ALTER TABLE entregas SET (fillfactor = 85);

-- En la instancia: mas workers y mas presupuesto total, porque el limite
-- se reparte entre los workers activos. Los workers requieren reinicio.
ALTER SYSTEM SET autovacuum_max_workers = 6;
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 1200;
ALTER SYSTEM SET autovacuum_work_mem = '1GB';
SELECT pg_reload_conf();`,
        },
        {
          type: 'paragraph',
          value:
            'Tres observaciones evitan sorpresas. La primera es que una tabla con presupuesto de costo propio sale del reparto con los demás workers, así que conviene reservarlo para las tablas que de verdad lo necesitan. La segunda es que autovacuum_work_mem define cuánta memoria usa cada worker para guardar los identificadores de las tuplas muertas: con poca memoria, la misma ejecución tiene que recorrer todos los índices de la tabla varias veces, y en tablas con muchos índices eso domina el tiempo total. La tercera es revisar si todos los índices que impiden actualizaciones HOT son necesarios: un índice sobre atualizado_em que nadie consulta convierte cada actualización en una escritura en todos los índices.',
        },
        {
          type: 'table',
          columns: ['Síntoma', 'Ajuste', 'Dónde'],
          rows: [
            ['Umbral demasiado alto en una tabla grande', 'scale_factor = 0 y umbral absoluto', 'Por tabla'],
            ['El autovacuum se dispara, pero tarda horas', 'cost_limit mayor, cost_delay menor', 'Por tabla o en la instancia'],
            ['Varias tablas grandes en cola a la vez', 'Más autovacuum_max_workers y más presupuesto total', 'Instancia'],
            ['La ejecución recorre los índices varias veces', 'Más autovacuum_work_mem', 'Instancia'],
            ['Pocas actualizaciones HOT', 'fillfactor menor y eliminación de índices innecesarios', 'Por tabla'],
            ['Ninguna tupla eliminada', 'Ningún ajuste del autovacuum ayuda: liberar el horizonte de xmin', 'Sesiones, slots y réplicas'],
          ],
        },
      ],
    },
    {
      title: 'Recuperar una tabla que ya se hinchó sin detener producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando se libera el horizonte, el VACUUM elimina las versiones muertas y la consulta vuelve a ser rápida, porque el espacio pasa a reutilizarse y las páginas calientes vuelven a tener filas vivas. Pero el archivo sigue teniendo ciento setenta gigabytes, y eso tiene costo: copias de seguridad más grandes, réplicas nuevas más lentas de sincronizar, escaneos secuenciales leyendo espacio vacío e índices con páginas casi vacías. Antes de decidir reescribir, conviene medir cuánto de la tabla es realmente espacio libre.',
        },
        {
          type: 'code',
          value: `CREATE EXTENSION IF NOT EXISTS pgstattuple;

-- Estimacion rapida: lee solo las paginas que el mapa de visibilidad no garantiza.
SELECT pg_size_pretty(table_len) AS tamanho,
       approx_tuple_percent       AS pct_vivo,
       dead_tuple_percent         AS pct_morto,
       approx_free_percent        AS pct_livre
FROM pgstattuple_approx('entregas');

-- Densidad de las hojas de un indice: por debajo de ~50% sugiere reconstruirlo.
SELECT avg_leaf_density, leaf_fragmentation
FROM pgstatindex('entregas_status_criado_idx');`,
        },
        {
          type: 'paragraph',
          value:
            'Si más de la mitad de la tabla es espacio libre y no se va a reutilizar pronto, reescribir compensa. Las opciones difieren en el bloqueo que exigen, y elegir la equivocada convierte un mantenimiento en una indisponibilidad.',
        },
        {
          type: 'table',
          columns: ['Opción', 'Bloqueo', 'Espacio extra', 'Cuándo usarla'],
          rows: [
            [
              'VACUUM',
              'No bloquea lecturas ni escrituras',
              'Ninguno',
              'Siempre, primero; vuelve el espacio reutilizable, pero no encoge el archivo',
            ],
            [
              'VACUUM FULL',
              'ACCESS EXCLUSIVE durante toda la reescritura',
              'Tamaño de la tabla compactada',
              'Solo con ventana de mantenimiento o en tablas pequeñas',
            ],
            [
              'pg_repack',
              'ACCESS EXCLUSIVE breve al inicio y al final',
              'Tamaño de la tabla compactada y de sus índices',
              'Tablas grandes en producción; exige clave primaria o índice único no nulo',
            ],
            [
              'REINDEX CONCURRENTLY',
              'No bloquea escrituras',
              'Tamaño del índice nuevo',
              'Índices hinchados cuando la tabla en sí está sana',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El orden importa. Reescribir la tabla antes de liberar el horizonte y ajustar el autovacuum es un desperdicio, porque vuelve a hincharse al mismo ritmo. Y pg_repack también exige cuidado con el horizonte: se ejecuta durante horas en tablas grandes, y mientras se ejecuta también retiene el xmin, así que lo ideal es lanzarlo en un periodo de menor volumen de actualizaciones y vigilar las tuplas muertas de las demás tablas mientras trabaja.',
        },
      ],
    },
    {
      title: 'Señales que avisan antes de que la consulta se vuelva lenta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La hinchazón es un problema que crece despacio y aparece de golpe, porque la consulta solo se vuelve lenta cuando las versiones muertas pasan a dominar las páginas que lee. Eso significa que existe una ventana de días o semanas en la que el problema es visible en las métricas y todavía invisible para el usuario. Las señales siguientes cubren esa ventana.',
        },
        {
          type: 'table',
          columns: ['Señal', 'Qué revela', 'Cuándo alertar'],
          rows: [
            [
              'Antigüedad del horizonte de xmin más antiguo',
              'Una sesión, slot, réplica o transacción preparada impidiendo la limpieza en todo el clúster',
              'Por encima de unas pocas horas en un sistema transaccional',
            ],
            [
              'Ejecuciones del autovacuum con cero tuplas eliminadas',
              'Autovacuum ejecutándose en vano por culpa del horizonte',
              'Dos ejecuciones seguidas en la misma tabla',
            ],
            [
              'n_dead_tup en relación con n_live_tup en las tablas calientes',
              'Limpieza que no sigue el ritmo de actualización',
              'Por encima del 20% de forma sostenida',
            ],
            [
              'Crecimiento del tamaño sin crecimiento de filas vivas',
              'Hinchazón acumulándose',
              'El tamaño crece a más del doble del ritmo de las filas',
            ],
            [
              'Antigüedad de datfrozenxid por base',
              'Acercamiento al vacuum agresivo contra wraparound',
              'Por encima de la mitad de autovacuum_freeze_max_age',
            ],
          ],
        },
        {
          type: 'code',
          value: `-- Registra toda ejecucion del autovacuum de mas de 10 segundos,
-- incluidas las tuplas eliminadas y las muertas todavia no eliminables.
ALTER SYSTEM SET log_autovacuum_min_duration = '10s';
SELECT pg_reload_conf();

-- Distancia de cada base hasta el vacuum agresivo contra wraparound.
SELECT datname,
       age(datfrozenxid) AS idade_xid,
       round(100.0 * age(datfrozenxid)
             / current_setting('autovacuum_freeze_max_age')::int, 1) AS pct_do_gatilho
FROM pg_database
ORDER BY idade_xid DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'La primera señal de la tabla es la más valiosa, porque es la única que apunta a la causa en lugar de medir la consecuencia, y se habría disparado el primer día del incidente, dieciocho días antes de la primera queja. Además es barata: la consulta de la tercera sección se ejecuta en milisegundos y puede alimentar una alerta cada minuto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Vale la pena desactivar el autovacuum de una tabla y ejecutar un VACUUM manual de madrugada?',
      answer:
        'Casi nunca. Un VACUUM nocturno deja que la tabla acumule un día entero de versiones muertas en horario pico, que es justo cuando las consultas más necesitan páginas limpias, y concentra toda la limpieza en una ejecución larga que compite con las copias de seguridad y las rutinas nocturnas. Además, desactivar el autovacuum no desactiva el vacuum contra wraparound, que se dispara igualmente cuando la antigüedad de las transacciones llega al límite, y suele hacerlo en el peor momento. El camino correcto es el contrario: hacer el autovacuum más frecuente y más rápido en esa tabla, con umbral absoluto y presupuesto propio, para que cada ejecución sea corta. Un VACUUM manual programado tiene sentido como complemento, por ejemplo después de una purga masiva, y no como sustituto.',
    },
    {
      question: '¿Qué es el autovacuum "to prevent wraparound" y por qué no se detiene cuando lo necesito?',
      answer:
        'PostgreSQL identifica las transacciones con un contador de 32 bits, y para que las versiones antiguas sigan siendo visibles después de que el contador dé la vuelta, el VACUUM tiene que congelarlas antes de que su antigüedad se acerque a dos mil millones de transacciones. Cuando una tabla supera autovacuum_freeze_max_age, doscientos millones por defecto, el autovacuum inicia una ejecución agresiva que recorre todas las páginas no congeladas y que, a diferencia de la ejecución normal, no se cancela sola cuando otra sesión pide un bloqueo conflictivo. Por eso un ALTER TABLE se queda esperando detrás de él. Cancelarlo manualmente solo aplaza el problema, porque vuelve al minuto siguiente, y si la antigüedad sigue subiendo la base termina rechazando transacciones nuevas para protegerse. La solución es no llegar ahí: monitorear la antigüedad de datfrozenxid, asegurarse de que el horizonte de xmin no se atasque, que es también lo que impide el congelamiento, y dejar que el autovacuum normal haga ese trabajo poco a poco.',
    },
    {
      question: '¿Por qué la tabla no se redujo después de que se ejecutara el VACUUM?',
      answer:
        'Porque esa no es su función. El VACUUM normal marca como libre el espacio de las versiones muertas dentro de las páginas y actualiza el mapa de espacio libre, para que las versiones nuevas ocupen ese espacio en lugar de extender el archivo. Solo devuelve espacio al sistema operativo cuando las páginas vacías están al final del archivo, e incluso eso exige un bloqueo breve que abandona si hay concurrencia. En la práctica, eso es bueno: una tabla con actualizaciones constantes va a necesitar ese espacio otra vez, y lo que importa para el rendimiento es que se reutilice. Encoger el archivo solo es necesario cuando la hinchazón es mucho mayor que el volumen que la tabla volverá a usar, y entonces la herramienta es pg_repack o, con ventana de mantenimiento, VACUUM FULL.',
    },
  ],
  conclusion: {
    title: 'Una tabla hinchada es basura que nadie recogió, y casi siempre alguien está sujetando la puerta',
    description:
      'En PostgreSQL, cada UPDATE y cada DELETE dejan una versión antigua que solo el VACUUM elimina, y en tablas de estado con muchas actualizaciones el ritmo de producción de esa basura es alto. El autovacuum por defecto se dispara tarde en tablas grandes y trabaja despacio a propósito, pero la causa más común de la hinchazón es otra: una sesión inactiva dentro de una transacción, un slot de replicación abandonado, una réplica con hot_standby_feedback o una transacción preparada olvidada reteniendo el horizonte de xmin, lo que hace que el autovacuum se ejecute sin eliminar nada. Liberar el horizonte e imponer límites que impidan la repetición va primero, después el ajuste por tabla, y solo entonces la reescritura con pg_repack. Puedo analizar tu base de datos, encontrar qué está reteniendo la limpieza, ajustar el autovacuum en las tablas correctas y recuperar el espacio sin ventana de mantenimiento.',
    cta: 'Hablar sobre el rendimiento de mi base de datos',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Paginación por offset en una tabla grande: cuándo la página 500 tumba la base de datos',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
