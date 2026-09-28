// Conteudo do artigo: replica de leitura atrasada, ler o que acabou de escrever
// com token de LSN, leituras monotonicas, roteamento por tipo de leitura e
// medicao do atraso real de replicacao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pgLagQueries = `-- No primario: quanto cada replica esta atrasada, em bytes e em tempo
SELECT application_name,
       state,
       pg_wal_lsn_diff(pg_current_wal_lsn(), replay_lsn) AS bytes_atras,
       write_lag,
       flush_lag,
       replay_lag
FROM pg_stat_replication
ORDER BY bytes_atras DESC;

-- Na replica: posicao recebida, posicao aplicada e replay pausado por conflito
SELECT pg_last_wal_receive_lsn() AS recebido,
       pg_last_wal_replay_lsn()  AS aplicado,
       pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn()) AS bytes_por_aplicar;

-- Na replica: consultas canceladas por conflito com o replay, por banco
SELECT datname, confl_snapshot, confl_lock, confl_bufferpin
FROM pg_stat_database_conflicts;`;

const lsnRouterCode = `import pg from 'pg';

const primary = new pg.Pool({ connectionString: process.env.PRIMARY_URL, max: 20 });
const replicas = (process.env.REPLICA_URLS || '')
  .split(',')
  .filter(Boolean)
  .map((url) => new pg.Pool({ connectionString: url, max: 20 }));

const LSN_RE = /^[0-9A-F]{1,8}[/][0-9A-F]{1,8}$/i;
export const isValidLsn = (value) => typeof value === 'string' && LSN_RE.test(value);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Executa a escrita no primario e devolve a posicao do WAL que a proxima
// leitura desse usuario precisa enxergar. Lida depois do COMMIT, ela e maior
// ou igual a posicao do commit, o que torna a garantia conservadora.
export async function writeTx(fn) {
  const client = await primary.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    const { rows } = await client.query('SELECT pg_current_wal_lsn()::text AS lsn');
    return { result, lsn: rows[0].lsn };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Le de uma replica que ja aplicou minLsn. Tenta as replicas por ate maxWaitMs
// e, se nenhuma alcancar a posicao, cai para o primario.
export async function readAfter(minLsn, sql, params = [], { maxWaitMs = 150 } = {}) {
  if (!isValidLsn(minLsn) || replicas.length === 0) {
    const pool = replicas.length ? replicas[Math.floor(Math.random() * replicas.length)] : primary;
    return pool.query(sql, params);
  }

  const deadline = Date.now() + maxWaitMs;
  do {
    for (const pool of replicas) {
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          'SELECT pg_last_wal_replay_lsn() >= $1::pg_lsn AS ok',
          [minLsn],
        );
        // O replay so avanca: se a replica ja passou de minLsn nesta conexao,
        // a consulta seguinte na mesma conexao tambem enxerga a escrita.
        if (rows[0].ok) return await client.query(sql, params);
      } finally {
        client.release();
      }
    }
    await sleep(25);
  } while (Date.now() < deadline);

  return primary.query(sql, params);
}`;

const expressCode = `import express from 'express';
import cookieParser from 'cookie-parser';
import { writeTx, readAfter, isValidLsn } from './db.js';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

const TOKEN_TTL_MS = 30_000;

app.post('/enderecos/:id', async (req, res) => {
  const { lsn } = await writeTx((client) =>
    client.query(
      'UPDATE enderecos SET logradouro = $1, cep = $2, atualizado_em = now() WHERE id = $3 AND usuario_id = $4',
      [req.body.logradouro, req.body.cep, req.params.id, req.user.id],
    ),
  );
  res.cookie('min_lsn', lsn, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: TOKEN_TTL_MS });
  res.redirect(303, '/enderecos/' + req.params.id);
});

app.get('/enderecos/:id', async (req, res) => {
  const minLsn = isValidLsn(req.cookies.min_lsn) ? req.cookies.min_lsn : null;
  const { rows } = await readAfter(
    minLsn,
    'SELECT id, logradouro, cep FROM enderecos WHERE id = $1 AND usuario_id = $2',
    [req.params.id, req.user.id],
  );
  if (rows.length === 0) return res.sendStatus(404);
  res.json(rows[0]);
});`;

const heartbeatCode = `-- No primario: uma linha que um job atualiza a cada segundo
CREATE TABLE replicacao_heartbeat (
  id         int PRIMARY KEY,
  gravado_em timestamptz NOT NULL
);
INSERT INTO replicacao_heartbeat VALUES (1, now());

-- Job no primario, a cada segundo
UPDATE replicacao_heartbeat SET gravado_em = now() WHERE id = 1;

-- Em cada replica: atraso real, mesmo quando o primario esta ocioso
SELECT extract(epoch FROM now() - gravado_em) AS atraso_s
FROM replicacao_heartbeat
WHERE id = 1;`;

const pt = {
  intro:
    'O cliente abre o checkout, corrige o endereço de entrega, clica em salvar e a página recarrega mostrando o endereço antigo. Ele salva de novo, e agora aparece o novo. Na semana em que o time passou a mandar as leituras para duas réplicas do PostgreSQL, o suporte recebeu trezentos e quarenta chamados de "o endereço não salva", o painel registrou pedidos criados que abriam em 404 no redirecionamento e o financeiro encontrou compras duplicadas de clientes que clicaram duas vezes porque o pedido "não apareceu". Nenhum dado se perdeu. Toda escrita estava no primário, e as réplicas a aplicaram corretamente, só que alguns milissegundos depois, e em certos momentos oito ou trinta segundos depois. O banco fez exatamente o que a replicação assíncrona promete, e o sistema foi construído como se ela prometesse outra coisa. Este artigo explica de onde vem o atraso da réplica e por que ele tem picos, quais sintomas ele produz que nem parecem problema de replicação, por que as correções mais comuns falham, como garantir que o usuário leia o que acabou de escrever usando a posição do WAL, como decidir onde cada tipo de leitura deve ir, e como medir o atraso real sem ser enganado pelas métricas padrão.',
  sections: [
    {
      title: 'De onde vem o atraso da réplica e por que ele tem picos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na replicação por streaming do PostgreSQL, o primário confirma o COMMIT assim que grava o WAL no próprio disco e só depois envia esse WAL às réplicas. Cada réplica percorre quatro etapas: recebe os bytes, grava, sincroniza no disco e aplica as mudanças nas páginas de dados. Uma consulta na réplica só enxerga uma transação depois da última etapa, o replay. Em operação normal, tudo isso leva de dez a cinquenta milissegundos, e é por isso que o problema passa despercebido nos testes: o atraso médio é menor que o tempo de um redirecionamento. O que causa os chamados são os picos.',
        },
        {
          type: 'table',
          columns: ['Causa do pico', 'O que acontece', 'Como aparece'],
          rows: [
            [
              'Rajada de escrita no primário',
              'Uma importação ou um UPDATE em massa gera gigabytes de WAL em minutos, e o replay, que aplica o WAL em um único processo, não acompanha',
              'Todas as réplicas atrasam juntas, por segundos ou minutos',
            ],
            [
              'Consulta longa na réplica',
              'O replay precisa remover versões que a consulta ainda lê; ele pausa até max_standby_streaming_delay, trinta segundos por padrão, e depois cancela a consulta',
              'Uma réplica atrasa sozinha, em degraus de até trinta segundos, enquanto a outra está em dia',
            ],
            [
              'Disco ou CPU da réplica saturados',
              'Réplica menor que o primário, ou dividindo recurso com relatórios, aplica mais devagar do que o primário produz',
              'Atraso que cresce continuamente no horário de pico e só zera de madrugada',
            ],
            [
              'Rede entre zonas ou regiões',
              'Latência e banda limitam o envio do WAL, sobretudo em rajadas',
              'Atraso proporcional ao volume escrito, pior na réplica mais distante',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No incidente do checkout, as duas primeiras causas se somavam. Às duas da tarde, a importação de catálogo gerava seis gigabytes de WAL e as duas réplicas chegavam a oito segundos de atraso. Ao longo do dia, um relatório de vendas de vinte e cinco segundos rodava na segunda réplica e pausava o replay dela a cada execução. As consultas abaixo mostram as duas coisas: o atraso por réplica visto do primário, a diferença entre o que a réplica recebeu e o que ela já aplicou, e quantas consultas foram canceladas por conflito com o replay.',
        },
        {
          type: 'code',
          value: pgLagQueries,
        },
        {
          type: 'paragraph',
          value:
            'Quando bytes_por_aplicar cresce na réplica enquanto o recebimento está em dia, o gargalo é o replay, e não a rede. Quando confl_snapshot sobe junto com os degraus de atraso, a causa são consultas longas disputando com o replay. Ligar hot_standby_feedback evita esses cancelamentos, mas transfere o custo para o primário, que passa a segurar versões mortas para proteger a consulta da réplica. É a troca entre atraso na réplica e tabela inchada no primário, e ela precisa ser feita de forma consciente.',
        },
      ],
    },
    {
      title: 'Os sintomas que não parecem problema de replicação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma réplica atrasada nunca devolve erro. Ela devolve um dado que foi verdadeiro alguns segundos atrás, e a aplicação trata esse dado como verdade atual. Por isso os sintomas chegam ao time como bugs de interface, de cache ou de regra de negócio, e raramente alguém olha para a replicação primeiro.',
        },
        {
          type: 'list',
          items: [
            'Salvar e ver o valor antigo: o POST grava no primário, o redirecionamento faz um GET que cai na réplica e mostra o estado anterior. É a quebra da garantia de ler o que se escreveu.',
            'Criar e receber 404: o pedido é criado, o navegador é levado para a página dele, e a réplica ainda não tem a linha. O usuário entende que a compra falhou e tenta de novo.',
            'Valor que aparece e some: com duas réplicas em atrasos diferentes e balanceamento alternado, a primeira leitura cai na réplica em dia e mostra o endereço novo, e a segunda cai na atrasada e mostra o antigo. É a quebra das leituras monotônicas, e é o sintoma mais difícil de reproduzir.',
            'Job que não encontra o registro: a escrita publica uma mensagem na fila, o worker consome em vinte milissegundos, lê da réplica e não encontra a linha. O job falha, vai para retentativa ou, pior, conclui que não há nada a fazer.',
            'Validação que aprova o que não devia: checar saldo, estoque ou unicidade na réplica antes de gravar no primário decide com base em um estado antigo. A escrita passa, e a regra foi violada.',
            'Cache que eterniza o dado velho: a escrita invalida a chave, a próxima leitura busca o valor na réplica atrasada e grava o valor antigo de volta no cache, onde ele fica até o TTL expirar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro e o quinto itens mostram que o problema não se resume à tela de confirmação. O primeiro é um incômodo; o quinto é um defeito de integridade, e ele existe mesmo com atraso de cinquenta milissegundos, porque não depende do tamanho do atraso, só de ele não ser zero.',
        },
      ],
    },
    {
      title: 'Por que as correções mais comuns falham',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira reação costuma ser um sleep depois da escrita ou uma segunda tentativa quando a leitura volta vazia. As duas trocam um defeito por outro: o sleep deixa toda escrita mais lenta para cobrir um atraso que na maior parte do tempo não existe, e não cobre o pico de oito segundos. A segunda tentativa transforma um 404 legítimo em espera e não resolve o caso em que a leitura devolve um valor antigo, que não é vazio. As alternativas sérias são as da tabela abaixo.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Garantia', 'Custo', 'Quando falha'],
          rows: [
            [
              'Todas as leituras no primário',
              'Total',
              'O primário volta a carregar toda a leitura, que era o motivo de ter réplicas',
              'Não falha, mas desfaz o ganho de capacidade',
            ],
            [
              'Primário por N segundos após escrever',
              'Enquanto o atraso for menor que N',
              'Baixo, com uma marca de tempo por sessão',
              'No pico maior que N, e manda para o primário leituras pesadas que não precisavam ir',
            ],
            [
              'synchronous_commit = remote_apply',
              'A réplica síncrona já aplicou quando o COMMIT volta',
              'Todo COMMIT espera o replay; se a réplica síncrona cair, as escritas travam',
              'Só cobre réplicas listadas como síncronas; as outras continuam atrasadas',
            ],
            [
              'Token com a posição do WAL',
              'Exata: lê de onde já aplicou a escrita do próprio usuário',
              'Uma verificação a mais nas leituras de quem escreveu há pouco',
              'Precisa carregar o token até onde a leitura acontece',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A janela de N segundos é um bom primeiro passo, porque se implementa em uma tarde e resolve a maior parte dos chamados. O problema é que ela aposta em um número: com N igual a dois, o pico de oito segundos da importação continua quebrando o checkout; com N igual a trinta, qualquer usuário que salvou algo passa meio minuto lendo tudo do primário, inclusive listagens e relatórios. O remote_apply é útil em escritas pontuais, com SET LOCAL dentro da transação, mas estende a latência de cada COMMIT até o replay e amarra a disponibilidade das escritas à disponibilidade da réplica síncrona. O token com a posição do WAL troca a aposta por uma medição.',
        },
      ],
    },
    {
      title: 'Ler o que escreveu: a posição do WAL como token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda transação confirmada no primário ocupa uma posição no WAL, o LSN, e toda réplica informa até que posição já aplicou com pg_last_wal_replay_lsn(). Se a aplicação guarda a posição logo depois da escrita e, na leitura seguinte do mesmo usuário, só aceita uma réplica que já passou dessa posição, a garantia de ler o que se escreveu é exata, sem aposta de tempo. Se nenhuma réplica chegou lá dentro de uma espera curta, a leitura vai para o primário. Quem não escreveu nada recentemente não carrega token e continua lendo de qualquer réplica, sem custo adicional.',
        },
        {
          type: 'code',
          value: lsnRouterCode,
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes tornam o código correto. O primeiro é que a verificação e a consulta usam a mesma conexão: como o replay só avança, se a réplica já aplicou a posição na verificação, a consulta seguinte naquela conexão também enxerga a escrita. Fazer a verificação em uma conexão e a consulta em outra do mesmo pool funciona na prática, mas depende de a réplica ser a mesma, o que o balanceador não garante. O segundo é que a comparação acontece no próprio PostgreSQL, com o tipo pg_lsn, e não em JavaScript, onde comparar as strings de LSN como texto dá resultado errado assim que a parte alta muda de número de dígitos.',
        },
        {
          type: 'paragraph',
          value:
            'O token precisa chegar até onde a leitura acontece. No fluxo de salvar e redirecionar, um cookie de vida curta basta. Quando o usuário alterna entre celular e computador, o token vai para a sessão no servidor ou para uma chave por usuário no Redis com o mesmo prazo. Quando a escrita dispara um job assíncrono, o LSN vai dentro da mensagem, e o worker chama readAfter com ele. Esse último caso é o que mais se esquece, e é o que transforma o job que não encontra o registro em um problema resolvido de vez.',
        },
        {
          type: 'code',
          value: expressCode,
        },
        {
          type: 'paragraph',
          value:
            'O cookie é controlado pelo cliente, então a validação de formato não é opcional. Um valor fora do padrão pode quebrar o cast para pg_lsn e virar erro 500; um valor válido e absurdamente alto só manda as leituras daquele usuário para o primário por trinta segundos, um custo limitado que o rate limit da aplicação já contém. Se isso ainda for relevante no seu contexto, basta assinar o valor com HMAC antes de gravá-lo. O prazo de trinta segundos cobre os picos normais; um atraso maior que isso é incidente, e quem trata incidente é o monitoramento da última seção, não o token.',
        },
      ],
    },
    {
      title: 'Onde cada leitura deve ir e como manter a ordem entre réplicas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O token resolve a leitura de quem escreveu, mas não decide sozinho para onde cada consulta deve ir. A regra que evita o defeito de integridade é simples: qualquer leitura que decide uma escrita acontece no primário, dentro da mesma transação da escrita e com o bloqueio adequado. Réplica é para mostrar, nunca para decidir.',
        },
        {
          type: 'table',
          columns: ['Tipo de leitura', 'Onde ler', 'Motivo'],
          rows: [
            [
              'Checagem antes de gravar: saldo, estoque, unicidade, estado de um pedido',
              'Primário, na mesma transação, com SELECT ... FOR UPDATE quando aplicável',
              'Decidir com base em estado antigo viola a regra mesmo com atraso de milissegundos',
            ],
            [
              'Tela logo após o usuário salvar',
              'Réplica com token de LSN, primário como fallback',
              'Precisa ver a própria escrita; ninguém mais precisa',
            ],
            [
              'Worker que processa algo recém-criado',
              'Réplica com o LSN que veio na mensagem',
              'O consumo da fila costuma ser mais rápido que o replay',
            ],
            [
              'Listagens, buscas, páginas públicas',
              'Qualquer réplica saudável',
              'Alguns segundos de atraso são aceitáveis e invisíveis',
            ],
            [
              'Relatórios e exportações pesadas',
              'Réplica dedicada, fora do balanceamento das telas',
              'Consultas longas pausam o replay e atrasam quem divide a réplica com elas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O sintoma do valor que aparece e some pede uma segunda garantia, a de leituras monotônicas: depois de ver um estado, o usuário nunca volta a ver um estado mais antigo. Há duas formas de obtê-la. A mais barata é fixar cada sessão em uma réplica, por exemplo com um hash do id do usuário, de modo que as leituras dele acompanhem sempre o mesmo relógio de replay. A mais robusta é tratar o LSN como uma marca d\'água: cada resposta devolve a posição da réplica que a serviu, e a próxima leitura exige pelo menos aquela posição. A segunda sobrevive à saída de uma réplica do pool; a primeira, não.',
        },
        {
          type: 'diagram',
          value: `Leitura chega
  |
  +-- decide uma escrita? ------------------ sim --> primario, mesma transacao
  |
  +-- tem token de LSN (usuario ou job)?
  |     |
  |     +-- alguma replica com replay >= token? -- sim --> essa replica
  |     |
  |     +-- esperou 150 ms e nenhuma chegou? ----------> primario
  |
  +-- relatorio pesado? -------------------- sim --> replica dedicada
  |
  +-- demais leituras -----------------------------> replica saudavel
                                                     (atraso < limite)`,
        },
        {
          type: 'paragraph',
          value:
            'A última linha do diagrama esconde uma decisão de capacidade. Tirar do balanceamento uma réplica cujo atraso passou do limite é correto, mas, se as duas atrasarem juntas, como na importação das duas da tarde, toda a leitura volta para o primário ao mesmo tempo em que ele está processando a rajada de escrita. Antes de ligar essa regra, é preciso saber se o primário aguenta a carga inteira de leitura por alguns minutos. Se não aguenta, o comportamento certo é aceitar réplicas mais atrasadas para leituras sem token durante o pico, ou limitar a própria importação, e não empurrar tudo para o primário.',
        },
      ],
    },
    {
      title: 'Medir o atraso real e saber quando o token está trabalhando demais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As métricas padrão enganam nos dois sentidos. A expressão now() - pg_last_xact_replay_timestamp(), usada em muitos painéis, mede o tempo desde a última transação aplicada, e não o atraso: com o primário ocioso de madrugada, ela sobe sem parar e dispara alertas falsos. As colunas de lag de pg_stat_replication são mais confiáveis, mas deixam de ser atualizadas quando não há tráfego. A forma robusta é um heartbeat: uma linha que o primário atualiza a cada segundo e que cada réplica compara com o próprio relógio.',
        },
        {
          type: 'code',
          value: heartbeatCode,
        },
        {
          type: 'paragraph',
          value:
            'O heartbeat depende de os relógios do primário e das réplicas estarem sincronizados por NTP, o que em qualquer ambiente de nuvem moderno significa um erro de poucos milissegundos, desprezível perto dos atrasos que importam. Com o atraso real medido, os indicadores que valem a pena acompanhar são os que mostram tanto a saúde da replicação quanto o esforço da aplicação para esconder o atraso.',
        },
        {
          type: 'ordered',
          items: [
            'Atraso p99 por réplica, medido pelo heartbeat, com alerta quando passa de um segundo por cinco minutos seguidos, e não em um pico isolado.',
            'Percentual de leituras com token que caíram no primário. Se passa de um ou dois por cento, as réplicas estão atrasando mais do que a espera curta cobre, e o primário está absorvendo leitura sem que ninguém perceba.',
            'Tempo gasto esperando a réplica alcançar o token, em p95. Ele é latência que o usuário sente e que não aparece como tempo de consulta.',
            'Consultas canceladas por conflito de replay em cada réplica, que apontam relatórios no lugar errado antes de eles virarem degraus de atraso.',
            'Volume de WAL gerado por minuto no primário, que antecipa o atraso das réplicas e identifica qual job produz as rajadas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Depois da mudança, o checkout passou a ler o endereço de uma réplica com token em noventa e oito por cento das vezes e do primário nas demais, concentradas nos minutos da importação. Os chamados de endereço que não salva zeraram, os pedidos duplicados por duplo clique também, e a carga de leitura no primário ficou abaixo de quatro por cento do total. A importação passou a ser feita em lotes com pausa entre eles, o que tirou o pico de oito segundos, e o relatório de vendas foi para uma réplica própria.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Isso vale para MySQL, Aurora ou outros bancos com réplica?',
      answer:
        'O problema vale para qualquer replicação assíncrona, e a solução tem a mesma forma, mudando apenas o identificador de posição. No MySQL com GTID, a sessão pode obter o conjunto de GTIDs da própria escrita com session_track_gtids e, na réplica, esperar por ele com WAIT_FOR_EXECUTED_GTID_SET, que aceita um tempo máximo. No Aurora, as réplicas compartilham o armazenamento e o atraso típico fica abaixo de cem milissegundos, o que reduz a frequência do problema, mas não o elimina: o defeito de validar em réplica antes de gravar continua existindo com qualquer atraso diferente de zero. Bancos gerenciados que oferecem leitura consistente por sessão estão implementando, por dentro, a mesma ideia do token.',
    },
    {
      question: 'Tenho cache na frente do banco. A réplica atrasada também afeta o cache?',
      answer:
        'Afeta, e de um jeito pior. O fluxo comum é invalidar a chave depois da escrita e deixar a próxima leitura repopular o cache. Se essa leitura vai para uma réplica atrasada, ela grava o valor antigo de volta, e agora o dado velho não dura o atraso da réplica, dura o TTL do cache, que pode ser de minutos ou horas. As correções são repopular o cache com o valor que acabou de ser escrito, na própria escrita, ou fazer a leitura que repopula com o token de LSN, ou ainda adiar a invalidação com uma segunda remoção alguns segundos depois. A primeira é a mais simples quando a escrita já tem o objeto completo em mãos.',
    },
    {
      question: 'Não é mais simples ler do primário por alguns segundos depois de qualquer escrita?',
      answer:
        'É mais simples e é um bom primeiro passo, porque resolve a maior parte dos casos com uma marca de tempo na sessão. Os limites aparecem com o tempo. A janela aposta em um número que o pico de atraso eventualmente ultrapassa, e nesse momento o defeito volta exatamente quando o sistema está sob mais carga. Ela também manda para o primário todas as leituras do usuário, inclusive listagens pesadas que não têm nada a ver com o que ele escreveu. E ela não cobre jobs assíncronos, que não têm sessão. Se você começar pela janela, meça quantas leituras ela envia ao primário e quantas vezes o atraso passa do limite; quando qualquer um dos dois crescer, é hora de trocar pelo token.',
    },
  ],
  conclusion: {
    title: 'Réplica atrasada não é defeito do banco, é uma garantia que a aplicação precisa pedir',
    description:
      'A replicação assíncrona entrega os dados a todas as réplicas, só não promete quando. Em operação normal o atraso é de milissegundos, mas rajadas de escrita, consultas longas na réplica e recursos saturados produzem picos de segundos, e é nos picos que o usuário salva e não vê, o pedido abre em 404 e a validação aprova o que não devia. Leituras que decidem escritas vão para o primário, na mesma transação. Leituras de quem acabou de escrever usam a posição do WAL como token e só aceitam réplicas que já chegaram lá. Jobs carregam o token na mensagem, e o atraso real é medido por heartbeat. Posso revisar como a sua aplicação distribui leituras entre primário e réplicas, implementar a garantia de ler o que se escreveu e montar o monitoramento que mostra quando ela está sendo exigida demais.',
    cta: 'Falar sobre a arquitetura do meu banco de dados',
  },
  related: [
    {
      label: 'Multi-região com escrita única: o que muda quando a latência vira decisão de produto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Cache invalidado errado: quando o dado velho custa mais caro que a consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The customer opens checkout, corrects the shipping address, clicks save and the page reloads showing the old address. They save again, and now the new one appears. In the week the team started sending reads to two PostgreSQL replicas, support received three hundred and forty tickets saying "the address does not save", the dashboard logged newly created orders that opened as a 404 on redirect, and finance found duplicate purchases from customers who clicked twice because the order "did not show up". No data was lost. Every write was on the primary, and the replicas applied it correctly, only a few milliseconds later, and at certain moments eight or thirty seconds later. The database did exactly what asynchronous replication promises, and the system was built as if it promised something else. This article explains where replica lag comes from and why it spikes, which symptoms it produces that do not even look like replication problems, why the most common fixes fail, how to guarantee that users read what they just wrote using the WAL position, how to decide where each kind of read should go, and how to measure the real lag without being fooled by the default metrics.',
  sections: [
    {
      title: 'Where replica lag comes from and why it spikes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In PostgreSQL streaming replication, the primary acknowledges the COMMIT as soon as it writes the WAL to its own disk, and only then sends that WAL to the replicas. Each replica goes through four stages: it receives the bytes, writes them, flushes them to disk and applies the changes to the data pages. A query on the replica only sees a transaction after the last stage, the replay. Under normal operation all of this takes ten to fifty milliseconds, which is why the problem slips through testing: the average lag is shorter than a redirect. What causes the tickets are the spikes.',
        },
        {
          type: 'table',
          columns: ['Cause of the spike', 'What happens', 'How it shows up'],
          rows: [
            [
              'Write burst on the primary',
              'An import or a bulk UPDATE generates gigabytes of WAL in minutes, and replay, which applies WAL in a single process, cannot keep up',
              'All replicas fall behind together, for seconds or minutes',
            ],
            [
              'Long query on the replica',
              'Replay needs to remove versions the query is still reading; it pauses up to max_standby_streaming_delay, thirty seconds by default, and then cancels the query',
              'One replica lags on its own, in steps of up to thirty seconds, while the other is up to date',
            ],
            [
              'Replica disk or CPU saturated',
              'A replica smaller than the primary, or sharing resources with reports, applies more slowly than the primary produces',
              'Lag that grows steadily during peak hours and only drops to zero overnight',
            ],
            [
              'Network across zones or regions',
              'Latency and bandwidth limit WAL shipping, especially in bursts',
              'Lag proportional to the volume written, worse on the most distant replica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the checkout incident, the first two causes added up. At two in the afternoon, the catalog import generated six gigabytes of WAL and both replicas reached eight seconds of lag. Throughout the day, a twenty-five second sales report ran on the second replica and paused its replay on every run. The queries below show both: the lag per replica as seen from the primary, the gap between what the replica received and what it has already applied, and how many queries were canceled due to conflicts with replay.',
        },
        {
          type: 'code',
          value: pgLagQueries,
        },
        {
          type: 'paragraph',
          value:
            'When bytes_por_aplicar grows on the replica while receiving is up to date, the bottleneck is replay, not the network. When confl_snapshot rises along with the lag steps, the cause is long queries competing with replay. Turning on hot_standby_feedback avoids these cancellations but shifts the cost to the primary, which starts holding dead versions to protect the replica query. It is a trade between lag on the replica and a bloated table on the primary, and it has to be made deliberately.',
        },
      ],
    },
    {
      title: 'Symptoms that do not look like a replication problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A lagging replica never returns an error. It returns data that was true a few seconds ago, and the application treats that data as the current truth. That is why the symptoms reach the team as interface bugs, cache bugs or business rule bugs, and rarely does anyone look at replication first.',
        },
        {
          type: 'list',
          items: [
            'Save and see the old value: the POST writes to the primary, the redirect triggers a GET that lands on the replica and shows the previous state. This breaks the read-your-writes guarantee.',
            'Create and get a 404: the order is created, the browser is sent to its page, and the replica does not have the row yet. The user concludes the purchase failed and tries again.',
            'A value that appears and disappears: with two replicas at different lags and alternating load balancing, the first read lands on the up-to-date replica and shows the new address, and the second lands on the lagging one and shows the old address. This breaks monotonic reads, and it is the hardest symptom to reproduce.',
            'A job that cannot find the record: the write publishes a message to the queue, the worker consumes it in twenty milliseconds, reads from the replica and does not find the row. The job fails, goes to retry or, worse, concludes there is nothing to do.',
            'A validation that approves what it should not: checking balance, stock or uniqueness on the replica before writing to the primary decides based on an old state. The write goes through, and the rule was violated.',
            'A cache that preserves stale data: the write invalidates the key, the next read fetches the value from the lagging replica and writes the old value back into the cache, where it stays until the TTL expires.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third and fifth items show the problem is not limited to the confirmation screen. The first is an annoyance; the fifth is an integrity defect, and it exists even with fifty milliseconds of lag, because it does not depend on how large the lag is, only on it not being zero.',
        },
      ],
    },
    {
      title: 'Why the most common fixes fail',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reaction is usually a sleep after the write or a second attempt when the read comes back empty. Both trade one defect for another: the sleep makes every write slower to cover a lag that most of the time does not exist, and it does not cover the eight second spike. The second attempt turns a legitimate 404 into a wait and does not solve the case where the read returns an old value, which is not empty. The serious alternatives are the ones in the table below.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Guarantee', 'Cost', 'When it fails'],
          rows: [
            [
              'All reads on the primary',
              'Complete',
              'The primary carries all reads again, which was the reason for having replicas',
              'It does not fail, but it undoes the capacity gain',
            ],
            [
              'Primary for N seconds after a write',
              'As long as lag is below N',
              'Low, with a timestamp per session',
              'During spikes longer than N, and it sends heavy reads to the primary that did not need to go there',
            ],
            [
              'synchronous_commit = remote_apply',
              'The synchronous replica has applied it when COMMIT returns',
              'Every COMMIT waits for replay; if the synchronous replica goes down, writes hang',
              'Only covers replicas listed as synchronous; the others still lag',
            ],
            [
              'Token with the WAL position',
              'Exact: reads from where the user\'s own write has been applied',
              'One extra check on reads from users who wrote recently',
              'The token has to be carried to where the read happens',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The N second window is a good first step, because it can be implemented in an afternoon and resolves most tickets. The problem is that it bets on a number: with N set to two, the eight second import spike still breaks checkout; with N set to thirty, any user who saved something spends half a minute reading everything from the primary, including listings and reports. remote_apply is useful for specific writes, with SET LOCAL inside the transaction, but it stretches the latency of every COMMIT until replay and ties write availability to the availability of the synchronous replica. The WAL position token replaces the bet with a measurement.',
        },
      ],
    },
    {
      title: 'Read your writes: the WAL position as a token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every transaction committed on the primary occupies a position in the WAL, the LSN, and every replica reports how far it has applied with pg_last_wal_replay_lsn(). If the application stores the position right after the write and, on that same user\'s next read, only accepts a replica that has already passed that position, the read-your-writes guarantee is exact, with no bet on time. If no replica gets there within a short wait, the read goes to the primary. Users who have not written anything recently carry no token and keep reading from any replica, at no extra cost.',
        },
        {
          type: 'code',
          value: lsnRouterCode,
        },
        {
          type: 'paragraph',
          value:
            'Two details make the code correct. The first is that the check and the query use the same connection: since replay only moves forward, if the replica had already applied the position at check time, the next query on that connection also sees the write. Running the check on one connection and the query on another from the same pool works in practice, but it relies on both landing on the same replica, which the load balancer does not guarantee. The second is that the comparison happens inside PostgreSQL, with the pg_lsn type, and not in JavaScript, where comparing LSN strings as text gives the wrong answer as soon as the high part changes its number of digits.',
        },
        {
          type: 'paragraph',
          value:
            'The token has to reach wherever the read happens. In the save and redirect flow, a short-lived cookie is enough. When the user switches between phone and laptop, the token goes into the server-side session or into a per-user Redis key with the same expiry. When the write triggers an asynchronous job, the LSN goes inside the message, and the worker calls readAfter with it. This last case is the one most often forgotten, and it is the one that turns the job that cannot find the record into a problem solved for good.',
        },
        {
          type: 'code',
          value: expressCode,
        },
        {
          type: 'paragraph',
          value:
            'The cookie is controlled by the client, so format validation is not optional. A malformed value can break the cast to pg_lsn and turn into a 500 error; a valid but absurdly high value only sends that user\'s reads to the primary for thirty seconds, a bounded cost that the application rate limit already contains. If that still matters in your context, sign the value with HMAC before storing it. The thirty second expiry covers normal spikes; lag longer than that is an incident, and incidents are handled by the monitoring in the last section, not by the token.',
        },
      ],
    },
    {
      title: 'Where each read should go and how to keep order across replicas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The token solves reads by users who just wrote, but on its own it does not decide where each query should go. The rule that prevents the integrity defect is simple: any read that decides a write happens on the primary, inside the same transaction as the write and with the appropriate lock. Replicas are for showing, never for deciding.',
        },
        {
          type: 'table',
          columns: ['Kind of read', 'Where to read', 'Reason'],
          rows: [
            [
              'Check before writing: balance, stock, uniqueness, order state',
              'Primary, in the same transaction, with SELECT ... FOR UPDATE where applicable',
              'Deciding on an old state violates the rule even with milliseconds of lag',
            ],
            [
              'Screen right after the user saves',
              'Replica with LSN token, primary as fallback',
              'It needs to see its own write; nobody else does',
            ],
            [
              'Worker processing something just created',
              'Replica with the LSN that came in the message',
              'Queue consumption is usually faster than replay',
            ],
            [
              'Listings, searches, public pages',
              'Any healthy replica',
              'A few seconds of lag are acceptable and invisible',
            ],
            [
              'Heavy reports and exports',
              'Dedicated replica, outside the load balancing for screens',
              'Long queries pause replay and delay everyone sharing the replica with them',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The value that appears and disappears calls for a second guarantee, monotonic reads: after seeing a state, the user never sees an older one again. There are two ways to get it. The cheapest is to pin each session to one replica, for example with a hash of the user id, so that their reads always follow the same replay clock. The most robust is to treat the LSN as a watermark: each response returns the position of the replica that served it, and the next read requires at least that position. The second survives a replica leaving the pool; the first does not.',
        },
        {
          type: 'diagram',
          value: `Read arrives
  |
  +-- does it decide a write? -------------- yes --> primary, same transaction
  |
  +-- has an LSN token (user or job)?
  |     |
  |     +-- any replica with replay >= token? ---- yes --> that replica
  |     |
  |     +-- waited 150 ms and none got there? ----------> primary
  |
  +-- heavy report? ------------------------ yes --> dedicated replica
  |
  +-- other reads ---------------------------------> healthy replica
                                                     (lag < limit)`,
        },
        {
          type: 'paragraph',
          value:
            'The last line of the diagram hides a capacity decision. Removing a replica whose lag has passed the limit from load balancing is correct, but if both lag together, as in the two o\'clock import, all reads return to the primary at the very moment it is processing the write burst. Before enabling that rule, you need to know whether the primary can handle the entire read load for a few minutes. If it cannot, the right behavior is to accept more lagged replicas for token-free reads during the spike, or to throttle the import itself, and not to push everything onto the primary.',
        },
      ],
    },
    {
      title: 'Measure real lag and know when the token is working too hard',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The default metrics mislead in both directions. The expression now() - pg_last_xact_replay_timestamp(), used on many dashboards, measures the time since the last applied transaction, not the lag: with the primary idle overnight, it climbs nonstop and fires false alerts. The lag columns in pg_stat_replication are more reliable, but they stop updating when there is no traffic. The robust approach is a heartbeat: a row that the primary updates every second and that each replica compares with its own clock.',
        },
        {
          type: 'code',
          value: heartbeatCode,
        },
        {
          type: 'paragraph',
          value:
            'The heartbeat depends on the primary and replica clocks being synchronized by NTP, which in any modern cloud environment means an error of a few milliseconds, negligible next to the lags that matter. With the real lag measured, the indicators worth tracking are the ones that show both the health of replication and how hard the application is working to hide the lag.',
        },
        {
          type: 'ordered',
          items: [
            'p99 lag per replica, measured by the heartbeat, with an alert when it exceeds one second for five consecutive minutes, not on an isolated spike.',
            'Percentage of token reads that fell back to the primary. If it goes above one or two percent, replicas are lagging more than the short wait covers, and the primary is absorbing reads without anyone noticing.',
            'Time spent waiting for the replica to reach the token, at p95. It is latency the user feels that does not show up as query time.',
            'Queries canceled by replay conflicts on each replica, which point to reports in the wrong place before they turn into lag steps.',
            'WAL volume generated per minute on the primary, which anticipates replica lag and identifies which job produces the bursts.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'After the change, checkout read the address from a replica with a token ninety-eight percent of the time and from the primary the rest, concentrated in the minutes of the import. Tickets about addresses not saving dropped to zero, as did duplicate orders from double clicks, and the read load on the primary stayed below four percent of the total. The import started running in batches with a pause between them, which removed the eight second spike, and the sales report moved to its own replica.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does this apply to MySQL, Aurora or other databases with replicas?',
      answer:
        'The problem applies to any asynchronous replication, and the solution has the same shape, with only the position identifier changing. On MySQL with GTID, the session can obtain the GTID set of its own write with session_track_gtids and, on the replica, wait for it with WAIT_FOR_EXECUTED_GTID_SET, which accepts a timeout. On Aurora, replicas share storage and typical lag stays below one hundred milliseconds, which makes the problem less frequent but does not eliminate it: the defect of validating on a replica before writing still exists with any lag other than zero. Managed databases that offer session-consistent reads are implementing, internally, the same idea as the token.',
    },
    {
      question: 'I have a cache in front of the database. Does replica lag affect the cache too?',
      answer:
        'It does, and in a worse way. The common flow is to invalidate the key after the write and let the next read repopulate the cache. If that read goes to a lagging replica, it writes the old value back, and now the stale data does not last as long as the replica lag, it lasts as long as the cache TTL, which may be minutes or hours. The fixes are to repopulate the cache with the value that was just written, in the write itself, or to perform the repopulating read with the LSN token, or to delay invalidation with a second delete a few seconds later. The first is the simplest when the write already has the complete object at hand.',
    },
    {
      question: 'Is it not simpler to read from the primary for a few seconds after any write?',
      answer:
        'It is simpler and it is a good first step, because it solves most cases with a timestamp in the session. The limits show up over time. The window bets on a number that lag spikes eventually exceed, and at that moment the defect returns exactly when the system is under the most load. It also sends all of the user\'s reads to the primary, including heavy listings that have nothing to do with what they wrote. And it does not cover asynchronous jobs, which have no session. If you start with the window, measure how many reads it sends to the primary and how often lag exceeds the limit; when either of those grows, it is time to switch to the token.',
    },
  ],
  conclusion: {
    title: 'Replica lag is not a database defect, it is a guarantee the application has to ask for',
    description:
      'Asynchronous replication delivers the data to every replica, it just does not promise when. Under normal operation lag is measured in milliseconds, but write bursts, long queries on the replica and saturated resources produce spikes of seconds, and it is during spikes that users save and do not see it, orders open as a 404 and validations approve what they should not. Reads that decide writes go to the primary, in the same transaction. Reads by users who just wrote use the WAL position as a token and only accept replicas that have already reached it. Jobs carry the token in the message, and real lag is measured by a heartbeat. I can review how your application distributes reads between primary and replicas, implement the read-your-writes guarantee and set up the monitoring that shows when it is being pushed too hard.',
    cta: 'Talk about my database architecture',
  },
  related: [
    {
      label: 'Multi-region with a single writer: what changes when latency becomes a product decision',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Wrongly invalidated cache: when stale data costs more than the query',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El cliente abre el checkout, corrige la dirección de entrega, hace clic en guardar y la página se recarga mostrando la dirección anterior. Guarda de nuevo, y ahora aparece la nueva. En la semana en que el equipo empezó a enviar las lecturas a dos réplicas de PostgreSQL, soporte recibió trescientos cuarenta tickets de "la dirección no se guarda", el panel registró pedidos recién creados que abrían con 404 en la redirección y finanzas encontró compras duplicadas de clientes que hicieron clic dos veces porque el pedido "no apareció". No se perdió ningún dato. Cada escritura estaba en el primario, y las réplicas la aplicaron correctamente, solo que algunos milisegundos después, y en ciertos momentos ocho o treinta segundos después. La base de datos hizo exactamente lo que promete la replicación asíncrona, y el sistema se construyó como si prometiera otra cosa. Este artículo explica de dónde viene el retraso de la réplica y por qué tiene picos, qué síntomas produce que ni parecen un problema de replicación, por qué fallan las correcciones más comunes, cómo garantizar que el usuario lea lo que acaba de escribir usando la posición del WAL, cómo decidir adónde debe ir cada tipo de lectura, y cómo medir el retraso real sin dejarse engañar por las métricas por defecto.',
  sections: [
    {
      title: 'De dónde viene el retraso de la réplica y por qué tiene picos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la replicación por streaming de PostgreSQL, el primario confirma el COMMIT en cuanto escribe el WAL en su propio disco, y solo después envía ese WAL a las réplicas. Cada réplica recorre cuatro etapas: recibe los bytes, los escribe, los sincroniza en disco y aplica los cambios en las páginas de datos. Una consulta en la réplica solo ve una transacción después de la última etapa, el replay. En operación normal, todo esto tarda de diez a cincuenta milisegundos, y por eso el problema pasa desapercibido en las pruebas: el retraso medio es menor que el tiempo de una redirección. Lo que genera los tickets son los picos.',
        },
        {
          type: 'table',
          columns: ['Causa del pico', 'Qué ocurre', 'Cómo se manifiesta'],
          rows: [
            [
              'Ráfaga de escritura en el primario',
              'Una importación o un UPDATE masivo genera gigabytes de WAL en minutos, y el replay, que aplica el WAL en un único proceso, no da abasto',
              'Todas las réplicas se retrasan juntas, durante segundos o minutos',
            ],
            [
              'Consulta larga en la réplica',
              'El replay necesita eliminar versiones que la consulta todavía lee; se pausa hasta max_standby_streaming_delay, treinta segundos por defecto, y luego cancela la consulta',
              'Una réplica se retrasa sola, en escalones de hasta treinta segundos, mientras la otra está al día',
            ],
            [
              'Disco o CPU de la réplica saturados',
              'Una réplica más pequeña que el primario, o que comparte recursos con informes, aplica más despacio de lo que el primario produce',
              'Retraso que crece de forma continua en hora pico y solo vuelve a cero de madrugada',
            ],
            [
              'Red entre zonas o regiones',
              'La latencia y el ancho de banda limitan el envío del WAL, sobre todo en ráfagas',
              'Retraso proporcional al volumen escrito, peor en la réplica más lejana',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el incidente del checkout, las dos primeras causas se sumaban. A las dos de la tarde, la importación del catálogo generaba seis gigabytes de WAL y las dos réplicas llegaban a ocho segundos de retraso. A lo largo del día, un informe de ventas de veinticinco segundos se ejecutaba en la segunda réplica y pausaba su replay en cada ejecución. Las consultas de abajo muestran ambas cosas: el retraso por réplica visto desde el primario, la diferencia entre lo que la réplica recibió y lo que ya aplicó, y cuántas consultas se cancelaron por conflicto con el replay.',
        },
        {
          type: 'code',
          value: pgLagQueries,
        },
        {
          type: 'paragraph',
          value:
            'Cuando bytes_por_aplicar crece en la réplica mientras la recepción está al día, el cuello de botella es el replay, no la red. Cuando confl_snapshot sube junto con los escalones de retraso, la causa son consultas largas compitiendo con el replay. Activar hot_standby_feedback evita esas cancelaciones, pero traslada el costo al primario, que pasa a retener versiones muertas para proteger la consulta de la réplica. Es el intercambio entre retraso en la réplica y tabla hinchada en el primario, y hay que hacerlo de forma consciente.',
        },
      ],
    },
    {
      title: 'Los síntomas que no parecen un problema de replicación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una réplica atrasada nunca devuelve error. Devuelve un dato que era verdadero hace unos segundos, y la aplicación lo trata como la verdad actual. Por eso los síntomas le llegan al equipo como bugs de interfaz, de caché o de regla de negocio, y casi nadie mira primero la replicación.',
        },
        {
          type: 'list',
          items: [
            'Guardar y ver el valor anterior: el POST escribe en el primario, la redirección hace un GET que cae en la réplica y muestra el estado previo. Es la ruptura de la garantía de leer lo que se escribió.',
            'Crear y recibir un 404: el pedido se crea, el navegador va a su página, y la réplica todavía no tiene la fila. El usuario entiende que la compra falló y lo intenta de nuevo.',
            'Un valor que aparece y desaparece: con dos réplicas con retrasos distintos y balanceo alternado, la primera lectura cae en la réplica al día y muestra la dirección nueva, y la segunda cae en la atrasada y muestra la anterior. Es la ruptura de las lecturas monotónicas, y es el síntoma más difícil de reproducir.',
            'Un job que no encuentra el registro: la escritura publica un mensaje en la cola, el worker lo consume en veinte milisegundos, lee de la réplica y no encuentra la fila. El job falla, pasa a reintento o, peor, concluye que no hay nada que hacer.',
            'Una validación que aprueba lo que no debía: comprobar saldo, stock o unicidad en la réplica antes de escribir en el primario decide con base en un estado viejo. La escritura pasa, y la regla se violó.',
            'Una caché que eterniza el dato viejo: la escritura invalida la clave, la siguiente lectura busca el valor en la réplica atrasada y vuelve a escribir el valor anterior en la caché, donde se queda hasta que expire el TTL.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer y el quinto punto muestran que el problema no se limita a la pantalla de confirmación. El primero es una molestia; el quinto es un defecto de integridad, y existe incluso con cincuenta milisegundos de retraso, porque no depende del tamaño del retraso, solo de que no sea cero.',
        },
      ],
    },
    {
      title: 'Por qué fallan las correcciones más comunes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera reacción suele ser un sleep después de la escritura o un segundo intento cuando la lectura vuelve vacía. Ambas cambian un defecto por otro: el sleep hace más lenta cada escritura para cubrir un retraso que la mayor parte del tiempo no existe, y no cubre el pico de ocho segundos. El segundo intento convierte un 404 legítimo en espera y no resuelve el caso en que la lectura devuelve un valor antiguo, que no está vacío. Las alternativas serias son las de la tabla siguiente.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Garantía', 'Costo', 'Cuándo falla'],
          rows: [
            [
              'Todas las lecturas en el primario',
              'Total',
              'El primario vuelve a cargar con toda la lectura, que era el motivo de tener réplicas',
              'No falla, pero deshace la ganancia de capacidad',
            ],
            [
              'Primario durante N segundos después de escribir',
              'Mientras el retraso sea menor que N',
              'Bajo, con una marca de tiempo por sesión',
              'En picos mayores que N, y envía al primario lecturas pesadas que no necesitaban ir',
            ],
            [
              'synchronous_commit = remote_apply',
              'La réplica síncrona ya aplicó cuando el COMMIT retorna',
              'Cada COMMIT espera al replay; si la réplica síncrona cae, las escrituras se bloquean',
              'Solo cubre réplicas listadas como síncronas; las demás siguen atrasadas',
            ],
            [
              'Token con la posición del WAL',
              'Exacta: lee desde donde ya se aplicó la escritura del propio usuario',
              'Una verificación extra en las lecturas de quien escribió hace poco',
              'Hay que llevar el token hasta donde ocurre la lectura',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La ventana de N segundos es un buen primer paso, porque se implementa en una tarde y resuelve la mayoría de los tickets. El problema es que apuesta por un número: con N igual a dos, el pico de ocho segundos de la importación sigue rompiendo el checkout; con N igual a treinta, cualquier usuario que guardó algo pasa medio minuto leyendo todo del primario, incluidos listados e informes. remote_apply es útil en escrituras puntuales, con SET LOCAL dentro de la transacción, pero alarga la latencia de cada COMMIT hasta el replay y ata la disponibilidad de las escrituras a la disponibilidad de la réplica síncrona. El token con la posición del WAL cambia la apuesta por una medición.',
        },
      ],
    },
    {
      title: 'Leer lo que escribiste: la posición del WAL como token',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cada transacción confirmada en el primario ocupa una posición en el WAL, el LSN, y cada réplica informa hasta qué posición ya aplicó con pg_last_wal_replay_lsn(). Si la aplicación guarda la posición justo después de la escritura y, en la siguiente lectura de ese mismo usuario, solo acepta una réplica que ya pasó esa posición, la garantía de leer lo que se escribió es exacta, sin apostar por el tiempo. Si ninguna réplica llega dentro de una espera corta, la lectura va al primario. Quien no escribió nada recientemente no lleva token y sigue leyendo de cualquier réplica, sin costo adicional.',
        },
        {
          type: 'code',
          value: lsnRouterCode,
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles hacen que el código sea correcto. El primero es que la verificación y la consulta usan la misma conexión: como el replay solo avanza, si la réplica ya aplicó la posición en la verificación, la consulta siguiente en esa conexión también ve la escritura. Hacer la verificación en una conexión y la consulta en otra del mismo pool funciona en la práctica, pero depende de que la réplica sea la misma, algo que el balanceador no garantiza. El segundo es que la comparación ocurre dentro de PostgreSQL, con el tipo pg_lsn, y no en JavaScript, donde comparar las cadenas de LSN como texto da un resultado incorrecto en cuanto la parte alta cambia su número de dígitos.',
        },
        {
          type: 'paragraph',
          value:
            'El token tiene que llegar hasta donde ocurre la lectura. En el flujo de guardar y redirigir, basta una cookie de vida corta. Cuando el usuario alterna entre el móvil y el ordenador, el token va a la sesión en el servidor o a una clave por usuario en Redis con el mismo plazo. Cuando la escritura dispara un job asíncrono, el LSN va dentro del mensaje, y el worker llama a readAfter con él. Este último caso es el que más se olvida, y es el que convierte el job que no encuentra el registro en un problema resuelto para siempre.',
        },
        {
          type: 'code',
          value: expressCode,
        },
        {
          type: 'paragraph',
          value:
            'La cookie la controla el cliente, así que validar el formato no es opcional. Un valor mal formado puede romper el cast a pg_lsn y convertirse en un error 500; un valor válido y absurdamente alto solo envía las lecturas de ese usuario al primario durante treinta segundos, un costo acotado que el rate limit de la aplicación ya contiene. Si aun así importa en tu contexto, basta con firmar el valor con HMAC antes de guardarlo. El plazo de treinta segundos cubre los picos normales; un retraso mayor es un incidente, y los incidentes los atiende el monitoreo de la última sección, no el token.',
        },
      ],
    },
    {
      title: 'Adónde debe ir cada lectura y cómo mantener el orden entre réplicas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El token resuelve la lectura de quien escribió, pero por sí solo no decide adónde debe ir cada consulta. La regla que evita el defecto de integridad es simple: cualquier lectura que decide una escritura ocurre en el primario, dentro de la misma transacción de la escritura y con el bloqueo adecuado. La réplica es para mostrar, nunca para decidir.',
        },
        {
          type: 'table',
          columns: ['Tipo de lectura', 'Dónde leer', 'Motivo'],
          rows: [
            [
              'Comprobación antes de escribir: saldo, stock, unicidad, estado de un pedido',
              'Primario, en la misma transacción, con SELECT ... FOR UPDATE cuando corresponda',
              'Decidir con un estado viejo viola la regla incluso con milisegundos de retraso',
            ],
            [
              'Pantalla justo después de que el usuario guarda',
              'Réplica con token de LSN, primario como respaldo',
              'Necesita ver su propia escritura; nadie más lo necesita',
            ],
            [
              'Worker que procesa algo recién creado',
              'Réplica con el LSN que llegó en el mensaje',
              'El consumo de la cola suele ser más rápido que el replay',
            ],
            [
              'Listados, búsquedas, páginas públicas',
              'Cualquier réplica sana',
              'Unos segundos de retraso son aceptables e invisibles',
            ],
            [
              'Informes y exportaciones pesadas',
              'Réplica dedicada, fuera del balanceo de las pantallas',
              'Las consultas largas pausan el replay y retrasan a quien comparte la réplica con ellas',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El valor que aparece y desaparece pide una segunda garantía, la de lecturas monotónicas: después de ver un estado, el usuario nunca vuelve a ver uno más antiguo. Hay dos formas de conseguirla. La más barata es fijar cada sesión a una réplica, por ejemplo con un hash del id del usuario, para que sus lecturas sigan siempre el mismo reloj de replay. La más robusta es tratar el LSN como una marca de agua: cada respuesta devuelve la posición de la réplica que la sirvió, y la siguiente lectura exige al menos esa posición. La segunda sobrevive a que una réplica salga del pool; la primera, no.',
        },
        {
          type: 'diagram',
          value: `Llega una lectura
  |
  +-- decide una escritura? ---------------- si --> primario, misma transaccion
  |
  +-- tiene token de LSN (usuario o job)?
  |     |
  |     +-- alguna replica con replay >= token? -- si --> esa replica
  |     |
  |     +-- espero 150 ms y ninguna llego? --------------> primario
  |
  +-- informe pesado? ---------------------- si --> replica dedicada
  |
  +-- demas lecturas ------------------------------> replica sana
                                                     (retraso < limite)`,
        },
        {
          type: 'paragraph',
          value:
            'La última línea del diagrama esconde una decisión de capacidad. Sacar del balanceo una réplica cuyo retraso superó el límite es correcto, pero, si las dos se atrasan juntas, como en la importación de las dos de la tarde, toda la lectura vuelve al primario justo cuando está procesando la ráfaga de escritura. Antes de activar esa regla, hay que saber si el primario soporta toda la carga de lectura durante algunos minutos. Si no la soporta, el comportamiento correcto es aceptar réplicas más atrasadas para lecturas sin token durante el pico, o limitar la propia importación, y no empujar todo al primario.',
        },
      ],
    },
    {
      title: 'Medir el retraso real y saber cuándo el token trabaja demasiado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las métricas por defecto engañan en los dos sentidos. La expresión now() - pg_last_xact_replay_timestamp(), usada en muchos paneles, mide el tiempo desde la última transacción aplicada, no el retraso: con el primario inactivo de madrugada, sube sin parar y dispara alertas falsas. Las columnas de lag de pg_stat_replication son más fiables, pero dejan de actualizarse cuando no hay tráfico. La forma robusta es un heartbeat: una fila que el primario actualiza cada segundo y que cada réplica compara con su propio reloj.',
        },
        {
          type: 'code',
          value: heartbeatCode,
        },
        {
          type: 'paragraph',
          value:
            'El heartbeat depende de que los relojes del primario y de las réplicas estén sincronizados por NTP, lo que en cualquier entorno de nube moderno significa un error de pocos milisegundos, despreciable frente a los retrasos que importan. Con el retraso real medido, los indicadores que vale la pena seguir son los que muestran tanto la salud de la replicación como el esfuerzo de la aplicación para esconder el retraso.',
        },
        {
          type: 'ordered',
          items: [
            'Retraso p99 por réplica, medido por el heartbeat, con alerta cuando supera un segundo durante cinco minutos seguidos, y no en un pico aislado.',
            'Porcentaje de lecturas con token que cayeron en el primario. Si supera el uno o dos por ciento, las réplicas se atrasan más de lo que cubre la espera corta, y el primario está absorbiendo lectura sin que nadie lo note.',
            'Tiempo esperando a que la réplica alcance el token, en p95. Es latencia que el usuario siente y que no aparece como tiempo de consulta.',
            'Consultas canceladas por conflicto de replay en cada réplica, que señalan informes en el lugar equivocado antes de que se conviertan en escalones de retraso.',
            'Volumen de WAL generado por minuto en el primario, que anticipa el retraso de las réplicas e identifica qué job produce las ráfagas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Después del cambio, el checkout pasó a leer la dirección de una réplica con token el noventa y ocho por ciento de las veces y del primario en el resto, concentradas en los minutos de la importación. Los tickets de dirección que no se guarda bajaron a cero, al igual que los pedidos duplicados por doble clic, y la carga de lectura en el primario quedó por debajo del cuatro por ciento del total. La importación pasó a hacerse en lotes con pausas entre ellos, lo que eliminó el pico de ocho segundos, y el informe de ventas se fue a una réplica propia.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Esto aplica a MySQL, Aurora u otras bases de datos con réplicas?',
      answer:
        'El problema aplica a cualquier replicación asíncrona, y la solución tiene la misma forma, cambiando solo el identificador de posición. En MySQL con GTID, la sesión puede obtener el conjunto de GTID de su propia escritura con session_track_gtids y, en la réplica, esperarlo con WAIT_FOR_EXECUTED_GTID_SET, que acepta un tiempo máximo. En Aurora, las réplicas comparten el almacenamiento y el retraso típico queda por debajo de cien milisegundos, lo que reduce la frecuencia del problema, pero no lo elimina: el defecto de validar en la réplica antes de escribir sigue existiendo con cualquier retraso distinto de cero. Las bases gestionadas que ofrecen lectura consistente por sesión están implementando, por dentro, la misma idea del token.',
    },
    {
      question: 'Tengo una caché delante de la base de datos. ¿La réplica atrasada también afecta a la caché?',
      answer:
        'Sí, y de una forma peor. El flujo habitual es invalidar la clave después de la escritura y dejar que la siguiente lectura vuelva a poblar la caché. Si esa lectura va a una réplica atrasada, escribe de nuevo el valor antiguo, y ahora el dato viejo no dura lo que dura el retraso de la réplica, dura el TTL de la caché, que puede ser de minutos u horas. Las correcciones son poblar la caché con el valor recién escrito, en la propia escritura, o hacer la lectura que vuelve a poblar con el token de LSN, o bien retrasar la invalidación con un segundo borrado unos segundos después. La primera es la más simple cuando la escritura ya tiene el objeto completo a mano.',
    },
    {
      question: '¿No es más simple leer del primario durante algunos segundos después de cualquier escritura?',
      answer:
        'Es más simple y es un buen primer paso, porque resuelve la mayoría de los casos con una marca de tiempo en la sesión. Los límites aparecen con el tiempo. La ventana apuesta por un número que los picos de retraso acaban superando, y en ese momento el defecto vuelve justo cuando el sistema está bajo más carga. También envía al primario todas las lecturas del usuario, incluidos listados pesados que no tienen nada que ver con lo que escribió. Y no cubre los jobs asíncronos, que no tienen sesión. Si empiezas por la ventana, mide cuántas lecturas envía al primario y cuántas veces el retraso supera el límite; cuando cualquiera de los dos crezca, es hora de cambiar al token.',
    },
  ],
  conclusion: {
    title: 'Una réplica atrasada no es un defecto de la base de datos, es una garantía que la aplicación tiene que pedir',
    description:
      'La replicación asíncrona entrega los datos a todas las réplicas, solo no promete cuándo. En operación normal el retraso es de milisegundos, pero las ráfagas de escritura, las consultas largas en la réplica y los recursos saturados producen picos de segundos, y es en los picos cuando el usuario guarda y no lo ve, el pedido abre con 404 y la validación aprueba lo que no debía. Las lecturas que deciden escrituras van al primario, en la misma transacción. Las lecturas de quien acaba de escribir usan la posición del WAL como token y solo aceptan réplicas que ya llegaron. Los jobs llevan el token en el mensaje, y el retraso real se mide con un heartbeat. Puedo revisar cómo tu aplicación reparte las lecturas entre primario y réplicas, implementar la garantía de leer lo que se escribió y montar el monitoreo que muestra cuándo se le está exigiendo demasiado.',
    cta: 'Hablar sobre la arquitectura de mi base de datos',
  },
  related: [
    {
      label: 'Multirregión con escritura única: qué cambia cuando la latencia se vuelve decisión de producto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Caché invalidada mal: cuando el dato viejo cuesta más caro que la consulta',
      to: '/blog/cache-invalidado-errado-dado-velho-custa-mais-caro-que-consulta',
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
