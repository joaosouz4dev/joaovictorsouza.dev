// Conteudo do artigo: migracao de banco sem janela com expandir, migrar e contrair.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A janela de manutenção pedida era de quarenta minutos num domingo de madrugada, e a resposta do time de negócio foi que o sistema atende clientes em três fusos horários e não existe madrugada para todo mundo ao mesmo tempo. É a situação normal, não a exceção: a maioria dos bancos em produção hoje não tem hora morta. A saída não é escolher um horário menos ruim, é mudar a forma da migração para que ela nunca precise de exclusividade. Este artigo mostra por que o padrão expandir, migrar e contrair funciona, qual é a regra de compatibilidade que decide a ordem de cada deploy, por que o backfill precisa ser um trabalho retomável e não uma transação gigante, o que muda quando o banco reescreve a tabela inteira sob um lock que ninguém pediu, como a escrita dupla se torna verificável em vez de esperançosa, e qual é o único momento em que a contração deixa de ser reversível.',
  sections: [
    {
      title: 'A janela não some, ela é trocada por compatibilidade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migração com janela é simples por um motivo específico: durante a parada existe apenas uma versão do código e uma versão do schema, e por isso o schema pode mudar de forma incompatível sem consequência. Tirar a janela não elimina esse problema, apenas obriga a resolvê-lo de outro jeito. Sem parada, existe pelo menos um intervalo em que a versão antiga e a versão nova do código conversam com o mesmo banco ao mesmo tempo, seja porque o deploy é gradual, seja porque um pod demora a terminar de drenar, seja porque um worker de fila só reinicia quando termina o lote atual.',
        },
        {
          type: 'paragraph',
          value:
            'Daí sai a regra que governa tudo o que vem depois e que é o verdadeiro conteúdo do padrão: cada deploy precisa ser compatível com o deploy imediatamente anterior, tanto no schema quanto no código. Não é compatibilidade com a versão de seis meses atrás, o que seria caro demais, e não é compatibilidade só com a versão final, o que seria justamente o erro. É a vizinhança de dois passos. Uma vez aceita essa restrição, o número de passos deixa de ser negociável: adicionar uma coluna nova, preencher a coluna, passar a ler dela e só então remover a antiga são quatro deploys porque nenhum par consecutivo entre eles quebra, e não porque alguém gosta de burocracia.',
        },
        {
          type: 'diagram',
          value: `MIGRACAO COM JANELA (uma versao viva de cada vez)

  [app v1 + schema v1]  --- PARADA ---  [app v2 + schema v2]
                          40 min sem
                          atender ninguem


EXPANDIR / MIGRAR / CONTRAIR (duas versoes vivas por deploy)

  D1 expandir   schema aceita v1 e v2      app v1 roda intacto
                (coluna nova, anulavel)

  D2 escrita    app escreve nos dois       leitura ainda no antigo
     dupla      campos                     backfill roda em lotes

  D3 leitura    app le do campo novo       escrita continua dupla
                                           rollback = trocar a flag

  D4 contrair   app para de escrever no    coluna antiga sem leitor
                antigo, coluna removida    ponto sem volta

  ^ em nenhum instante existe um par (app, schema) incompativel`,
        },
        {
          type: 'paragraph',
          value:
            'Vale nomear o custo dessa escolha em vez de escondê-lo, porque ele é real e aparece no planejamento de sprint. Uma mudança que caberia em um pull request vira quatro, espalhados por dias ou semanas, e nesse meio tempo o código carrega uma complexidade temporária que precisa ser removida depois. Times que ignoram a última etapa acumulam colunas mortas, escritas duplas esquecidas e flags permanentes, e o preço disso é pago em toda leitura futura daquele arquivo. A contração não é opcional, é a metade da migração que ninguém agenda.',
        },
      ],
    },
    {
      title: 'Expandir sem travar a tabela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A etapa de expansão parece a mais inofensiva e é onde acontecem os incidentes mais rápidos, porque a mesma instrução DDL tem custos radicalmente diferentes dependendo de um detalhe que não aparece na sintaxe. Em Postgres moderno, adicionar uma coluna anulável ou com valor padrão constante é uma mudança apenas no catálogo e termina em milissegundos. Adicionar a mesma coluna com NOT NULL sem valor padrão, ou com um valor padrão volátil, força a reescrita da tabela inteira sob um lock exclusivo, e numa tabela de duzentos milhões de linhas isso significa que toda leitura e toda escrita param até terminar.',
        },
        {
          type: 'paragraph',
          value:
            'Há um segundo efeito que costuma pegar os times de surpresa e que é pior que a lentidão em si. O lock exclusivo não é adquirido só ao final: o comando entra na fila de locks e passa a bloquear todas as consultas que chegam depois dele, mesmo que ele próprio ainda esteja esperando uma transação antiga terminar. Uma migração que parecia rápida fica presa atrás de um SELECT de relatório que roda há três minutos, e enquanto isso o tráfego normal se enfileira atrás da migração. O sintoma é uma tabela indisponível por causa de um comando que, sozinho, levaria dez milissegundos.',
        },
        {
          type: 'table',
          columns: ['Operação', 'Custo real em Postgres', 'Risco sem cuidado', 'Forma segura'],
          rows: [
            [
              'Adicionar coluna anulável',
              'Catálogo, milissegundos',
              'Baixo, ainda pega lock breve',
              'Direto, com lock_timeout curto',
            ],
            [
              'Adicionar coluna NOT NULL',
              'Reescrita da tabela inteira',
              'Alto: tabela travada por minutos',
              'Anulável, backfill, constraint NOT VALID e depois VALIDATE',
            ],
            [
              'Criar índice',
              'Bloqueia escrita durante a construção',
              'Alto em tabela quente',
              'CREATE INDEX CONCURRENTLY, fora de transação',
            ],
            [
              'Adicionar chave estrangeira',
              'Varredura completa das duas tabelas',
              'Alto: lock em ambas',
              'NOT VALID no primeiro passo, VALIDATE CONSTRAINT depois',
            ],
            [
              'Renomear coluna',
              'Catálogo, instantâneo',
              'Crítico: quebra a versão antiga do app',
              'Nunca renomear, criar nova e contrair depois',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a que mais causa incidente porque parece a mais barata. Renomear uma coluna custa nada para o banco e quebra imediatamente qualquer instância do código antigo que ainda esteja rodando, o que inclui a instância que está drenando enquanto o deploy acontece. Em um rollout gradual, isso significa erro em produção durante toda a janela de convivência. A regra prática é que renomear é sempre a soma de expandir e contrair, e tratar assim desde o começo evita a pior categoria de erro, que é aquela que só aparece durante o deploy e some quando ele termina.',
        },
        {
          type: 'code',
          value: `-- migrations/001_expand.sql
-- Expandir: o schema passa a aceitar as duas versoes do app.
-- Nada aqui pode exigir que o codigo novo ja esteja rodando.

-- Sem lock_timeout, uma migracao que esperaria 10ms fica presa atras de
-- uma transacao longa e enfileira todo o trafego atras dela. Falhar rapido
-- e tentar de novo e melhor do que travar a tabela por minutos.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Coluna anulavel: mudanca de catalogo, milissegundos, nao reescreve a tabela.
-- Com NOT NULL e sem default, o Postgres reescreveria as 200M de linhas
-- sob lock exclusivo.
ALTER TABLE conversations
  ADD COLUMN customer_uuid uuid;

-- Indice concorrente nao bloqueia escrita, mas nao roda dentro de
-- transacao. Se o framework de migracao envolve tudo em BEGIN/COMMIT,
-- este comando precisa de um arquivo proprio marcado como nao transacional.
-- Em caso de falha, o indice fica INVALID e precisa ser derrubado a mao
-- antes de tentar de novo.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_customer_uuid_idx
  ON conversations (customer_uuid);

-- A constraint entra como NOT VALID: passa a valer para linha nova e
-- atualizada sem varrer as antigas, o que evita o lock longo. A validacao
-- das linhas existentes vem depois do backfill, em outro deploy.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_customer_uuid_not_null
  CHECK (customer_uuid IS NOT NULL) NOT VALID;`,
        },
      ],
    },
    {
      title: 'Escrita dupla que é verificável e não apenas esperançosa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A escrita dupla é o coração da migração e é onde a maioria dos times para no meio do caminho. A parte fácil é fazer o código gravar nos dois lugares. A parte que decide se a migração vai dar certo é conseguir provar, antes de trocar a leitura, que os dois lugares concordam. Sem essa prova, a virada de leitura é um salto de fé: se houver qualquer caminho de escrita que escapou, um job antigo, uma rotina de importação, um gatilho no banco, a divergência só aparece depois que o campo novo já virou a fonte da verdade, e aí o dado errado já está sendo servido para o cliente.',
        },
        {
          type: 'paragraph',
          value:
            'A forma de tornar isso verificável tem duas metades. A primeira é escrever nos dois campos dentro da mesma transação, e não em duas operações separadas, para que nunca exista um estado em que um foi gravado e o outro não por causa de uma falha no meio. A segunda é ler dos dois durante uma fase de sombra, comparar e contar a divergência como métrica em vez de exceção. Comparar e não usar o resultado parece inútil, mas é exatamente esse contador que autoriza ou bloqueia o deploy seguinte, porque ele responde à única pergunta que importa: existe algum caminho de escrita que ainda não foi coberto?',
        },
        {
          type: 'code',
          value: `// src/repositories/conversation-repository.js
// Escrita dupla e leitura em sombra. A leitura em sombra existe para
// autorizar o deploy seguinte com dado, nao com confianca.

export const createConversationRepository = ({ db, flags, metrics }) => {
  const save = async (conversation) => {
    // Os dois campos na MESMA transacao. Em duas operacoes separadas,
    // uma falha no meio deixa os campos divergentes de forma permanente
    // e sem nenhum registro de que isso aconteceu.
    await db.transaction(async (trx) => {
      await trx('conversations')
        .insert({
          id: conversation.id,
          customer_id: conversation.customerId, // legado: int
          customer_uuid: conversation.customerUuid, // novo: uuid
        })
        .onConflict('id')
        .merge(['customer_id', 'customer_uuid']);
    });
  };

  const findByCustomer = async (customer) => {
    const readFromNew = flags.enabled('conversations.read_uuid');

    // Fase de sombra: le dos dois e compara sem usar o resultado novo.
    // O contador de divergencia e o que autoriza a virada da leitura.
    if (!readFromNew && flags.enabled('conversations.shadow_read')) {
      const [legacy, next] = await Promise.all([
        db('conversations').where({ customer_id: customer.id }).orderBy('id'),
        db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id'),
      ]);

      // Comparar por conjunto de ids, nao por contagem: contagens iguais
      // com ids diferentes e o caso que passa despercebido.
      const legacyIds = new Set(legacy.map((row) => row.id));
      const matches =
        legacy.length === next.length && next.every((row) => legacyIds.has(row.id));

      metrics.increment('conversations.shadow_read', {
        result: matches ? 'match' : 'divergent',
      });

      return legacy;
    }

    return readFromNew
      ? db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id')
      : db('conversations').where({ customer_id: customer.id }).orderBy('id');
  };

  return { save, findByCustomer };
};`,
        },
        {
          type: 'list',
          items: [
            'A divergência precisa ser rotulada por caminho de escrita, não apenas contada em agregado. Saber que existem 0,3% de divergências não ajuda; saber que todas vêm do importador de CSV resolve o problema em uma tarde.',
            'A leitura em sombra dobra a carga de leitura naquela consulta específica. Em tabela quente vale amostrar uma fração do tráfego em vez de comparar tudo, desde que a amostra cubra todos os caminhos de escrita.',
            'Gatilhos e views no banco também são caminhos de escrita e são invisíveis para quem procura apenas no código da aplicação. Vale listar as dependências da tabela antes de assumir que o mapeamento está completo.',
            'A ordem entre backfill e escrita dupla não é indiferente: a escrita dupla entra primeiro, senão o backfill preenche linhas antigas enquanto as novas continuam nascendo sem o campo, e o trabalho nunca converge.',
            'A flag de leitura precisa ser avaliada por requisição e não lida uma vez na inicialização, senão o rollback exige um novo deploy e deixa de ser instantâneo justamente no momento em que a velocidade importa.',
          ],
        },
      ],
    },
    {
      title: 'Backfill como trabalho retomável, não como transação gigante',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O backfill em uma única instrução UPDATE sobre a tabela toda é a forma mais direta de transformar uma migração sem janela em uma parada não planejada. Uma transação que percorre duzentos milhões de linhas mantém locks de linha durante todo o tempo, faz o volume de WAL explodir, impede o vacuum de limpar versões mortas e, se for cancelada no minuto quarenta, desfaz tudo e volta ao ponto zero. Pior: enquanto ela roda, a replicação atrasa, e um atraso de réplica grande costuma ser o primeiro sintoma percebido pelo usuário, porque as leituras que vão para a réplica passam a devolver dado velho.',
        },
        {
          type: 'paragraph',
          value:
            'A forma correta trata o backfill como um trabalho em lotes com estado próprio, capaz de parar e retomar de onde estava. Três propriedades tornam isso seguro na prática. O lote precisa avançar por chave e não por deslocamento, porque OFFSET fica progressivamente mais lento e pula linhas quando há remoções concorrentes. Cada lote precisa ser uma transação própria e curta, para que o cancelamento custe no máximo um lote. E o ritmo precisa ser adaptativo, reagindo ao atraso de replicação, porque é ele que traduz a pressão do backfill em impacto visível para o cliente.',
        },
        {
          type: 'code',
          value: `// scripts/backfill-customer-uuid.js
// Backfill retomavel: lotes por chave, transacao curta por lote e ritmo
// que reage ao atraso de replicacao.

const BATCH_SIZE = 2_000;
const MAX_REPLICA_LAG_MS = 1_000;

// Cursor por chave, nao OFFSET: com OFFSET o banco percorre e descarta as
// linhas anteriores a cada lote, entao o lote 5000 le 10M de linhas para
// devolver 2k. Alem disso, remocoes concorrentes deslocam a janela e o
// OFFSET pula linhas silenciosamente.
export const runBackfill = async ({ db, checkpoint, logger, sleep, replicaLagMs }) => {
  let cursor = await checkpoint.read('conversations.customer_uuid');
  let processed = 0;

  for (;;) {
    const lag = await replicaLagMs();
    if (lag > MAX_REPLICA_LAG_MS) {
      // Nao aborta: desacelera. O backfill e trabalho de fundo e sempre
      // perde a prioridade para o trafego do cliente.
      logger.warn({ lag }, 'replica lag alto, pausando backfill');
      await sleep(5_000);
      continue;
    }

    // Uma transacao por lote. Um UPDATE unico sobre a tabela inteira
    // mantem locks por horas, infla o WAL, bloqueia o vacuum e, se for
    // cancelado no minuto 40, desfaz tudo.
    const updated = await db.transaction(async (trx) => {
      const rows = await trx('conversations')
        .select('id', 'customer_id')
        .where('id', '>', cursor)
        .whereNull('customer_uuid')
        .orderBy('id')
        .limit(BATCH_SIZE)
        // FOR UPDATE SKIP LOCKED: se o trafego normal esta editando uma
        // linha, o backfill pula em vez de esperar. A linha volta no
        // proximo passe porque a condicao whereNull continua valendo.
        .forUpdate()
        .skipLocked();

      if (rows.length === 0) return [];

      await trx.raw(
        \`UPDATE conversations c
            SET customer_uuid = m.uuid
           FROM customer_uuid_map m
          WHERE c.customer_id = m.customer_id
            AND c.id = ANY(?)\`,
        [rows.map((row) => row.id)],
      );

      return rows;
    });

    if (updated.length === 0) break;

    // O checkpoint avanca DEPOIS do commit. Avancar antes significa pular
    // um lote inteiro se o processo morrer entre as duas operacoes.
    cursor = updated[updated.length - 1].id;
    await checkpoint.write('conversations.customer_uuid', cursor);

    processed += updated.length;
    logger.info({ processed, cursor }, 'lote concluido');

    // Pausa curta e deliberada: da espaco para o vacuum e evita que o
    // backfill monopolize a conexao e a banda de WAL.
    await sleep(50);
  }

  logger.info({ processed }, 'backfill concluido');
  return processed;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe do código acima merece destaque porque é a diferença entre um backfill que termina e um que precisa ser reiniciado do zero na segunda-feira: o checkpoint é gravado depois do commit do lote, nunca antes. Se o processo morre entre o commit e a escrita do checkpoint, o pior caso é reprocessar um lote já feito, o que é inofensivo porque a condição de filtro exclui as linhas já preenchidas. Se a ordem fosse invertida, o pior caso seria pular um lote inteiro sem que nada registrasse o buraco, e a divergência só apareceria muito depois, na forma de linhas com o campo novo vazio que ninguém sabe explicar.',
        },
      ],
    },
    {
      title: 'Contrair é o único passo sem volta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Até a virada da leitura, tudo é reversível trocando uma flag: a coluna antiga continua sendo escrita e continua correta, então voltar a ler dela é instantâneo. A contração rompe essa propriedade. No momento em que o código para de escrever no campo antigo, ele começa a envelhecer, e cada minuto que passa aumenta o custo de um eventual rollback, porque não basta mais trocar a flag, é preciso reconciliar tudo o que mudou desde então. Remover a coluna transforma o custo em impossibilidade.',
        },
        {
          type: 'paragraph',
          value:
            'Por isso a contração se divide em dois deploys separados por um período de observação, e não em um só. O primeiro para a escrita dupla e mantém a coluna antiga no lugar, intocada. Esse é o intervalo em que qualquer consumidor esquecido, um relatório mensal, um job de fechamento, uma integração externa, tem chance de falhar e ser notado enquanto a volta ainda é barata. O segundo deploy remove a coluna, e é o único passo da sequência inteira que não tem plano de rollback além de restaurar backup.',
        },
        {
          type: 'table',
          columns: ['Deploy', 'Muda no schema', 'Muda no código', 'Rollback'],
          rows: [
            [
              'D1 expandir',
              'Coluna nova anulável, índice concorrente, constraint NOT VALID',
              'Nada',
              'Derrubar a coluna, sem impacto no app',
            ],
            [
              'D2 escrita dupla',
              'Nada',
              'Grava nos dois campos na mesma transação, sombra de leitura',
              'Desligar a flag de escrita dupla',
            ],
            [
              'D3 backfill e validação',
              'VALIDATE CONSTRAINT ao final',
              'Nada, roda fora do deploy',
              'Parar o job, nada foi trocado',
            ],
            [
              'D4 virar a leitura',
              'Nada',
              'Passa a ler do campo novo, escrita continua dupla',
              'Desligar a flag de leitura, instantâneo',
            ],
            [
              'D5 parar escrita antiga',
              'Nada',
              'Remove a escrita no campo legado',
              'Reversível, mas exige reconciliar o período',
            ],
            [
              'D6 remover coluna',
              'DROP COLUMN',
              'Remove código morto e flags',
              'Nenhum: só restaurar backup',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Antes do último deploy vale um passo de verificação que custa pouco e evita o incidente mais constrangedor da lista. Marcar a coluna como ignorada no ORM e observar por alguns dias captura o consumidor que ninguém lembrava, porque o código deixa de acessá-la sem que ela desapareça. Complementarmente, ativar o log de instruções que referenciam a coluna, ou consultar as estatísticas de uso do índice associado, mostra se ainda existe tráfego real chegando nela. Descobrir que a coluna ainda é lida por um serviço de terceiros é constrangedor na segunda-feira e é um incidente de dados no sábado seguinte.',
        },
      ],
    },
    {
      title: 'O teste que prova a compatibilidade entre versões vizinhas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A propriedade que a migração precisa garantir não é que a versão nova funciona, isso os testes normais já cobrem. É que a versão antiga continua funcionando contra o schema novo, e que a versão nova funciona contra o schema antigo caso o rollback aconteça antes da migração ser revertida. Nenhuma suíte convencional testa isso, porque cada suíte roda uma versão do código contra a versão correspondente do schema. A verificação precisa ser explícita e é barata de montar: aplicar a migração de expansão em um banco de teste e rodar a suíte da versão anterior contra ele.',
        },
        {
          type: 'code',
          value: `// test/migration-compatibility.test.js
// A suite normal testa app novo + schema novo. O que quebra em producao
// e o par que ninguem testa: app ANTIGO + schema NOVO, que existe durante
// todo rollout gradual e toda drenagem de pod.

import { describe, it, beforeAll, expect } from 'vitest';
import { applyMigrationsUpTo, resetDatabase } from './helpers/db.js';
import { createConversationRepository } from '../src/repositories/conversation-repository.js';

// Repositorio da versao anterior, congelado. Nao importar o atual: o teste
// perde todo o valor no dia em que os dois convergirem.
import { createLegacyRepository } from './fixtures/repository-v1.js';

describe('compatibilidade entre deploys vizinhos', () => {
  beforeAll(async () => {
    await resetDatabase();
    await applyMigrationsUpTo('001_expand');
  });

  it('a versao anterior do app opera sobre o schema expandido', async () => {
    const legacy = createLegacyRepository({ db });

    // O app antigo nao conhece customer_uuid. Se a coluna fosse NOT NULL
    // sem default, este insert falharia e o rollout quebraria em producao
    // no primeiro pod que ainda nao tivesse reiniciado.
    await legacy.save({ id: 'conv-1', customerId: 42 });

    const found = await legacy.findByCustomer({ id: 42 });
    expect(found).toHaveLength(1);
  });

  it('a escrita dupla mantem os dois campos consistentes', async () => {
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: () => {} },
    });

    await repo.save({ id: 'conv-2', customerId: 43, customerUuid: UUID_43 });

    const [row] = await db('conversations').where({ id: 'conv-2' });
    expect(row.customer_id).toBe(43);
    expect(row.customer_uuid).toBe(UUID_43);
  });

  it('a leitura em sombra acusa divergencia quando um caminho escapa', async () => {
    const divergences = [];
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: (_, tags) => divergences.push(tags.result) },
    });

    // Escrita que ignorou o campo novo, como faria um job legado ou um
    // gatilho no banco. O contador precisa registrar, nao lancar excecao.
    await db('conversations').insert({ id: 'conv-3', customer_id: 44 });

    await repo.findByCustomer({ id: 44, uuid: UUID_44 });
    expect(divergences).toContain('divergent');
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'A terceira asserção é a que costuma faltar e a que mais paga por si mesma. Ela verifica que uma escrita que escapou da aplicação, exatamente o cenário do job legado ou do gatilho esquecido, produz um sinal de divergência em vez de uma exceção. A distinção importa porque durante a migração a divergência é esperada e informativa: ela é o mapa dos caminhos de escrita que ainda faltam cobrir. Transformá-la em erro faria o time desligar a verificação por ruído justamente na fase em que ela é a única fonte de informação confiável sobre o estado real da migração.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Quanto tempo manter a escrita dupla antes de contrair?',
      answer:
        'O critério não é tempo de calendário, é cobertura de ciclos. A escrita dupla precisa sobreviver a pelo menos uma execução completa de cada processo que toca aquela tabela, e o processo mais lento é quem define o prazo. Se existe um fechamento mensal que lê a coluna, o mínimo é um mês mais uma margem, porque só nessa execução é que um consumidor esquecido se revela. Se o mais lento é um job semanal, duas semanas cobrem com folga. Três sinais autorizam a contração e nenhum deles é a passagem do tempo isolada: a taxa de divergência da leitura em sombra em zero durante todo o período, incluindo os dias de pico e os dias de fechamento; a estatística de uso do índice antigo estável, mostrando que ninguém consulta mais por aquele caminho; e a lista de dependências da tabela revisada à mão, incluindo views, gatilhos, funções e integrações externas, que não aparecem em busca no código da aplicação. A pressa aqui tem um custo assimétrico e é isso que deve orientar a decisão: esperar mais uma semana custa uma semana de complexidade temporária no código, enquanto contrair cedo demais custa um incidente de dados com reconciliação manual e sem rollback barato.',
    },
    {
      question: 'Como fazer isso quando a mudança é o tipo da coluna e não uma coluna nova?',
      answer:
        'A mudança de tipo é o caso em que a tentação de usar ALTER COLUMN TYPE é maior e o resultado é pior, porque esse comando reescreve a tabela inteira sob lock exclusivo e ainda invalida os planos em cache, de forma que o impacto se estende para depois do término. O padrão continua sendo o mesmo, apenas com uma etapa extra de conversão. Cria-se uma coluna nova com o tipo alvo, a aplicação passa a escrever nas duas convertendo em código, o backfill preenche o histórico em lotes e a leitura vira quando a divergência estiver em zero. A etapa extra aparece nos casos em que a conversão não é total, que é a maioria: passar de integer para bigint é seguro, mas de texto livre para enum, de timestamp sem fuso para timestamptz, ou de decimal para inteiro em centavos, cada um tem linhas que não convertem. Essas linhas precisam ser levantadas antes de começar, porque a decisão sobre elas é de negócio e não de engenharia, e descobri-las no meio do backfill significa parar o trabalho para tomar uma decisão que ninguém tem autoridade para tomar às duas da manhã. Vale registrar que em Postgres alguns casos específicos evitam a reescrita, como aumentar o limite de um varchar, mas depender disso exige verificar o comportamento da versão exata em uso, e o plano seguro não deve depender de uma otimização condicional do motor.',
    },
    {
      question: 'O padrão vale também para bancos sem schema fixo, como MongoDB?',
      answer:
        'Vale, e por um motivo que costuma ser mal compreendido: a ausência de schema no banco não elimina o schema, apenas o transfere para o código, que passa a ser o único lugar onde ele existe. Como o banco aceita documentos com formatos diferentes sem reclamar, a etapa de expansão fica de graça, mas a etapa de contração fica mais difícil, porque não há um comando que garanta que nenhum documento antigo restou. Na prática o padrão fica assim: o código passa a ler os dois formatos e escrever no novo, um backfill em lotes reescreve os documentos antigos usando o mesmo cuidado de cursor por chave e ritmo adaptativo, e a leitura do formato antigo só é removida depois que uma contagem confirma que nenhum documento com o formato legado restou na coleção. A diferença prática mais relevante é que o momento de remover o código de leitura antiga precisa ser decidido por consulta de verificação e não por confiança no backfill, porque não existe constraint que impeça um caminho esquecido de gravar no formato antigo no dia seguinte. Vale também usar o validador de schema da coleção depois da contração, para que o formato consolidado passe a ser aplicado pelo banco em vez de permanecer apenas como convenção.',
    },
  ],
  conclusion: {
    title: 'A migração segura é a que nunca precisa de exclusividade',
    description:
      'Um banco que atende clientes em três fusos horários não tem madrugada, e insistir em encontrar a janela menos ruim é resolver o problema errado. Expandir, migrar e contrair troca a exclusividade por compatibilidade entre deploys vizinhos, e o preço disso é um número maior de passos, cada um deles reversível até o último. Posso desenhar a sequência de migração do seu banco, definir quais operações exigem índice concorrente e constraint em duas fases, montar o backfill retomável com controle de atraso de replicação, instrumentar a leitura em sombra que autoriza a virada com dado em vez de confiança e definir os critérios objetivos para contrair sem deixar coluna morta nem flag permanente.',
    cta: 'Falar sobre a migração de banco do meu sistema',
  },
  related: [
    {
      label: 'Migrar embeddings sem reindexar tudo de uma vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Rollback de base de conhecimento sem derrubar o atendimento',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The maintenance window requested was forty minutes on a Sunday at dawn, and the answer from the business side was that the system serves customers in three time zones and there is no dawn that covers everyone at once. That is the normal situation, not the exception: most databases in production today have no dead hour. The way out is not picking a less bad time slot, it is changing the shape of the migration so that it never needs exclusivity. This article shows why the expand, migrate and contract pattern works, which compatibility rule decides the order of every deploy, why the backfill has to be resumable work rather than one giant transaction, what changes when the database rewrites the whole table under a lock nobody asked for, how dual writes become verifiable instead of hopeful, and which is the single moment where contraction stops being reversible.',
  sections: [
    {
      title: 'The window does not disappear, it is traded for compatibility',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A migration with a window is simple for one specific reason: during the outage there is exactly one version of the code and one version of the schema, and therefore the schema can change incompatibly with no consequence. Removing the window does not eliminate that problem, it only forces you to solve it differently. With no outage, there is at least one interval in which the old and the new version of the code talk to the same database at the same time, whether because the deploy is gradual, because a pod takes a while to finish draining, or because a queue worker only restarts once it finishes the current batch.',
        },
        {
          type: 'paragraph',
          value:
            'From that comes the rule that governs everything after it and that is the real content of the pattern: each deploy must be compatible with the deploy immediately before it, in both schema and code. It is not compatibility with the version from six months ago, which would be too expensive, and it is not compatibility only with the final version, which is exactly the mistake. It is a two-step neighborhood. Once that constraint is accepted, the number of steps stops being negotiable: adding a new column, filling it, switching reads to it and only then dropping the old one are four deploys because no consecutive pair among them breaks, not because someone enjoys bureaucracy.',
        },
        {
          type: 'diagram',
          value: `MIGRATION WITH A WINDOW (one live version at a time)

  [app v1 + schema v1]  --- OUTAGE ---  [app v2 + schema v2]
                         40 min serving
                         nobody


EXPAND / MIGRATE / CONTRACT (two live versions per deploy)

  D1 expand     schema accepts v1 and v2   app v1 runs untouched
                (new nullable column)

  D2 dual       app writes to both         reads still on the old one
     write      fields                     backfill runs in batches

  D3 read       app reads the new field    dual write continues
     switch                                rollback = flip the flag

  D4 contract   app stops writing the      old column has no reader
                old field, column dropped  point of no return

  ^ at no instant does an incompatible (app, schema) pair exist`,
        },
        {
          type: 'paragraph',
          value:
            'It is worth naming the cost of that choice instead of hiding it, because it is real and shows up in sprint planning. A change that would fit in one pull request becomes four, spread over days or weeks, and in the meantime the code carries temporary complexity that has to be removed later. Teams that skip the last step accumulate dead columns, forgotten dual writes and permanent flags, and the price is paid on every future reading of that file. Contraction is not optional, it is the half of the migration nobody schedules.',
        },
      ],
    },
    {
      title: 'Expanding without locking the table',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The expansion step looks like the harmless one and it is where the fastest incidents happen, because the same DDL statement has radically different costs depending on a detail that does not show up in the syntax. In modern Postgres, adding a nullable column or one with a constant default is a catalog-only change that finishes in milliseconds. Adding the same column with NOT NULL and no default, or with a volatile default, forces a rewrite of the entire table under an exclusive lock, and on a table with two hundred million rows that means every read and every write stops until it completes.',
        },
        {
          type: 'paragraph',
          value:
            'There is a second effect that usually catches teams off guard and is worse than the slowness itself. The exclusive lock is not acquired only at the end: the statement enters the lock queue and starts blocking every query that arrives after it, even while it is itself still waiting for an old transaction to finish. A migration that looked fast gets stuck behind a reporting SELECT that has been running for three minutes, and meanwhile normal traffic queues up behind the migration. The symptom is an unavailable table caused by a statement that on its own would take ten milliseconds.',
        },
        {
          type: 'table',
          columns: ['Operation', 'Real cost in Postgres', 'Risk if done carelessly', 'Safe form'],
          rows: [
            [
              'Add nullable column',
              'Catalog only, milliseconds',
              'Low, still takes a brief lock',
              'Directly, with a short lock_timeout',
            ],
            [
              'Add NOT NULL column',
              'Rewrite of the entire table',
              'High: table locked for minutes',
              'Nullable, backfill, NOT VALID constraint and then VALIDATE',
            ],
            [
              'Create index',
              'Blocks writes while it builds',
              'High on a hot table',
              'CREATE INDEX CONCURRENTLY, outside a transaction',
            ],
            [
              'Add foreign key',
              'Full scan of both tables',
              'High: locks on both',
              'NOT VALID first, VALIDATE CONSTRAINT later',
            ],
            [
              'Rename column',
              'Catalog only, instant',
              'Critical: breaks the old app version',
              'Never rename, add a new one and contract later',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is the one that causes the most incidents because it looks like the cheapest. Renaming a column costs the database nothing and immediately breaks any instance of the old code still running, which includes the instance draining while the deploy happens. In a gradual rollout that means errors in production throughout the coexistence window. The practical rule is that renaming is always the sum of expanding and contracting, and treating it that way from the start avoids the worst category of error, the one that only appears during the deploy and disappears when it ends.',
        },
        {
          type: 'code',
          value: `-- migrations/001_expand.sql
-- Expand: the schema starts accepting both versions of the app.
-- Nothing here may require the new code to already be running.

-- Without lock_timeout, a migration that would wait 10ms gets stuck behind
-- a long transaction and queues all traffic behind it. Failing fast and
-- retrying beats locking the table for minutes.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Nullable column: catalog change, milliseconds, no table rewrite.
-- With NOT NULL and no default, Postgres would rewrite all 200M rows
-- under an exclusive lock.
ALTER TABLE conversations
  ADD COLUMN customer_uuid uuid;

-- A concurrent index does not block writes, but it cannot run inside a
-- transaction. If the migration framework wraps everything in BEGIN/COMMIT,
-- this statement needs its own file marked as non-transactional. On
-- failure the index is left INVALID and must be dropped by hand before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_customer_uuid_idx
  ON conversations (customer_uuid);

-- The constraint comes in as NOT VALID: it applies to new and updated rows
-- without scanning the old ones, which avoids the long lock. Validating
-- the existing rows comes after the backfill, in another deploy.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_customer_uuid_not_null
  CHECK (customer_uuid IS NOT NULL) NOT VALID;`,
        },
      ],
    },
    {
      title: 'Dual writes that are verifiable, not merely hopeful',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The dual write is the heart of the migration and it is where most teams stop halfway. The easy part is making the code write to both places. The part that decides whether the migration succeeds is being able to prove, before switching reads, that both places agree. Without that proof, the read switch is a leap of faith: if any write path escaped, an old job, an import routine, a database trigger, the divergence only surfaces once the new field is already the source of truth, and by then the wrong data is already being served to the customer.',
        },
        {
          type: 'paragraph',
          value:
            'Making that verifiable has two halves. The first is writing to both fields inside the same transaction, not in two separate operations, so that no state exists where one was written and the other was not because of a failure in between. The second is reading from both during a shadow phase, comparing and counting divergence as a metric instead of an exception. Comparing and not using the result looks pointless, but that counter is exactly what authorizes or blocks the next deploy, because it answers the only question that matters: is there any write path still uncovered?',
        },
        {
          type: 'code',
          value: `// src/repositories/conversation-repository.js
// Dual write and shadow read. The shadow read exists to authorize the next
// deploy with data, not with confidence.

export const createConversationRepository = ({ db, flags, metrics }) => {
  const save = async (conversation) => {
    // Both fields in the SAME transaction. In two separate operations, a
    // failure in between leaves the fields permanently divergent with no
    // record that it happened.
    await db.transaction(async (trx) => {
      await trx('conversations')
        .insert({
          id: conversation.id,
          customer_id: conversation.customerId, // legacy: int
          customer_uuid: conversation.customerUuid, // new: uuid
        })
        .onConflict('id')
        .merge(['customer_id', 'customer_uuid']);
    });
  };

  const findByCustomer = async (customer) => {
    const readFromNew = flags.enabled('conversations.read_uuid');

    // Shadow phase: read from both and compare without using the new
    // result. The divergence counter is what authorizes the read switch.
    if (!readFromNew && flags.enabled('conversations.shadow_read')) {
      const [legacy, next] = await Promise.all([
        db('conversations').where({ customer_id: customer.id }).orderBy('id'),
        db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id'),
      ]);

      // Compare by id set, not by count: equal counts with different ids
      // is exactly the case that slips through.
      const legacyIds = new Set(legacy.map((row) => row.id));
      const matches =
        legacy.length === next.length && next.every((row) => legacyIds.has(row.id));

      metrics.increment('conversations.shadow_read', {
        result: matches ? 'match' : 'divergent',
      });

      return legacy;
    }

    return readFromNew
      ? db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id')
      : db('conversations').where({ customer_id: customer.id }).orderBy('id');
  };

  return { save, findByCustomer };
};`,
        },
        {
          type: 'list',
          items: [
            'Divergence has to be labeled by write path, not just counted in aggregate. Knowing there is 0.3% divergence does not help; knowing it all comes from the CSV importer solves the problem in one afternoon.',
            'Shadow reading doubles the read load on that specific query. On a hot table it is worth sampling a fraction of traffic instead of comparing everything, provided the sample covers every write path.',
            'Database triggers and views are write paths too, and they are invisible to anyone searching only the application code. List the table dependencies before assuming the mapping is complete.',
            'The order between backfill and dual write is not indifferent: the dual write goes first, otherwise the backfill fills old rows while new ones keep being created without the field, and the work never converges.',
            'The read flag has to be evaluated per request rather than read once at startup, otherwise rollback requires a new deploy and stops being instantaneous precisely when speed matters.',
          ],
        },
      ],
    },
    {
      title: 'Backfill as resumable work, not as a giant transaction',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A backfill as a single UPDATE over the whole table is the most direct way to turn a zero-downtime migration into an unplanned outage. A transaction that walks two hundred million rows holds row locks the entire time, makes WAL volume explode, prevents vacuum from cleaning dead tuples and, if cancelled at minute forty, rolls everything back to square one. Worse: while it runs, replication falls behind, and a large replica lag is usually the first symptom users notice, because reads routed to the replica start returning stale data.',
        },
        {
          type: 'paragraph',
          value:
            'The correct form treats the backfill as batched work with its own state, able to stop and resume where it left off. Three properties make that safe in practice. The batch must advance by key rather than by offset, because OFFSET gets progressively slower and skips rows when there are concurrent deletes. Each batch must be its own short transaction, so that cancellation costs at most one batch. And the pace must be adaptive, reacting to replication lag, because that is what translates backfill pressure into visible customer impact.',
        },
        {
          type: 'code',
          value: `// scripts/backfill-customer-uuid.js
// Resumable backfill: batches by key, one short transaction per batch and
// a pace that reacts to replication lag.

const BATCH_SIZE = 2_000;
const MAX_REPLICA_LAG_MS = 1_000;

// Key cursor, not OFFSET: with OFFSET the database walks and discards the
// preceding rows on every batch, so batch 5000 reads 10M rows to return
// 2k. On top of that, concurrent deletes shift the window and OFFSET
// silently skips rows.
export const runBackfill = async ({ db, checkpoint, logger, sleep, replicaLagMs }) => {
  let cursor = await checkpoint.read('conversations.customer_uuid');
  let processed = 0;

  for (;;) {
    const lag = await replicaLagMs();
    if (lag > MAX_REPLICA_LAG_MS) {
      // Does not abort: slows down. The backfill is background work and
      // always loses priority to customer traffic.
      logger.warn({ lag }, 'replica lag high, pausing backfill');
      await sleep(5_000);
      continue;
    }

    // One transaction per batch. A single UPDATE over the whole table
    // holds locks for hours, inflates the WAL, blocks vacuum and, if
    // cancelled at minute 40, undoes everything.
    const updated = await db.transaction(async (trx) => {
      const rows = await trx('conversations')
        .select('id', 'customer_id')
        .where('id', '>', cursor)
        .whereNull('customer_uuid')
        .orderBy('id')
        .limit(BATCH_SIZE)
        // FOR UPDATE SKIP LOCKED: if normal traffic is editing a row, the
        // backfill skips it instead of waiting. The row comes back on the
        // next pass because the whereNull condition still holds.
        .forUpdate()
        .skipLocked();

      if (rows.length === 0) return [];

      await trx.raw(
        \`UPDATE conversations c
            SET customer_uuid = m.uuid
           FROM customer_uuid_map m
          WHERE c.customer_id = m.customer_id
            AND c.id = ANY(?)\`,
        [rows.map((row) => row.id)],
      );

      return rows;
    });

    if (updated.length === 0) break;

    // The checkpoint advances AFTER the commit. Advancing before means
    // skipping a whole batch if the process dies between the two.
    cursor = updated[updated.length - 1].id;
    await checkpoint.write('conversations.customer_uuid', cursor);

    processed += updated.length;
    logger.info({ processed, cursor }, 'batch done');

    // A short deliberate pause: gives vacuum room and keeps the backfill
    // from monopolizing the connection and the WAL bandwidth.
    await sleep(50);
  }

  logger.info({ processed }, 'backfill complete');
  return processed;
};`,
        },
        {
          type: 'paragraph',
          value:
            'One detail in the code above deserves attention because it is the difference between a backfill that finishes and one that has to be restarted from scratch on Monday: the checkpoint is written after the batch commits, never before. If the process dies between the commit and the checkpoint write, the worst case is reprocessing a batch already done, which is harmless because the filter condition excludes the rows already filled. If the order were reversed, the worst case would be skipping an entire batch with nothing recording the gap, and the divergence would only surface much later, as rows with an empty new field that nobody can explain.',
        },
      ],
    },
    {
      title: 'Contracting is the only step with no way back',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Up to the read switch, everything is reversible by flipping a flag: the old column is still written and still correct, so going back to reading from it is instantaneous. Contraction breaks that property. The moment the code stops writing the old field, it starts going stale, and every minute that passes raises the cost of an eventual rollback, because flipping the flag is no longer enough, you also have to reconcile everything that changed since. Dropping the column turns the cost into impossibility.',
        },
        {
          type: 'paragraph',
          value:
            'That is why contraction splits into two deploys separated by an observation period, not one. The first stops the dual write and keeps the old column in place, untouched. That is the interval in which any forgotten consumer, a monthly report, a period-close job, an external integration, gets a chance to fail and be noticed while going back is still cheap. The second deploy drops the column, and it is the only step in the whole sequence with no rollback plan beyond restoring a backup.',
        },
        {
          type: 'table',
          columns: ['Deploy', 'Schema change', 'Code change', 'Rollback'],
          rows: [
            [
              'D1 expand',
              'New nullable column, concurrent index, NOT VALID constraint',
              'None',
              'Drop the column, no app impact',
            ],
            [
              'D2 dual write',
              'None',
              'Writes both fields in the same transaction, shadow read',
              'Turn off the dual write flag',
            ],
            [
              'D3 backfill and validate',
              'VALIDATE CONSTRAINT at the end',
              'None, runs outside the deploy',
              'Stop the job, nothing was switched',
            ],
            [
              'D4 switch reads',
              'None',
              'Starts reading the new field, dual write continues',
              'Turn off the read flag, instantaneous',
            ],
            [
              'D5 stop the old write',
              'None',
              'Removes the write to the legacy field',
              'Reversible, but requires reconciling the period',
            ],
            [
              'D6 drop the column',
              'DROP COLUMN',
              'Removes dead code and flags',
              'None: only restoring a backup',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Before the last deploy, one cheap verification step avoids the most embarrassing incident on the list. Marking the column as ignored in the ORM and observing for a few days catches the consumer nobody remembered, because the code stops touching it without the column disappearing. Complementarily, enabling logging of statements referencing the column, or checking the usage statistics of its index, shows whether real traffic still reaches it. Finding out the column is still read by a third-party service is embarrassing on Monday and is a data incident the following Saturday.',
        },
      ],
    },
    {
      title: 'The test that proves compatibility between neighboring versions',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The property the migration has to guarantee is not that the new version works, ordinary tests already cover that. It is that the old version keeps working against the new schema, and that the new version works against the old schema in case a rollback happens before the migration is reverted. No conventional suite tests that, because each suite runs one version of the code against the matching version of the schema. The check has to be explicit and it is cheap to set up: apply the expansion migration to a test database and run the previous version suite against it.',
        },
        {
          type: 'code',
          value: `// test/migration-compatibility.test.js
// The normal suite tests new app + new schema. What breaks in production
// is the pair nobody tests: OLD app + NEW schema, which exists throughout
// every gradual rollout and every pod drain.

import { describe, it, beforeAll, expect } from 'vitest';
import { applyMigrationsUpTo, resetDatabase } from './helpers/db.js';
import { createConversationRepository } from '../src/repositories/conversation-repository.js';

// Previous version repository, frozen. Do not import the current one: the
// test loses all its value the day the two converge.
import { createLegacyRepository } from './fixtures/repository-v1.js';

describe('compatibility between neighboring deploys', () => {
  beforeAll(async () => {
    await resetDatabase();
    await applyMigrationsUpTo('001_expand');
  });

  it('the previous app version operates on the expanded schema', async () => {
    const legacy = createLegacyRepository({ db });

    // The old app knows nothing about customer_uuid. If the column were
    // NOT NULL with no default, this insert would fail and the rollout
    // would break in production on the first pod not yet restarted.
    await legacy.save({ id: 'conv-1', customerId: 42 });

    const found = await legacy.findByCustomer({ id: 42 });
    expect(found).toHaveLength(1);
  });

  it('the dual write keeps both fields consistent', async () => {
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: () => {} },
    });

    await repo.save({ id: 'conv-2', customerId: 43, customerUuid: UUID_43 });

    const [row] = await db('conversations').where({ id: 'conv-2' });
    expect(row.customer_id).toBe(43);
    expect(row.customer_uuid).toBe(UUID_43);
  });

  it('the shadow read reports divergence when a path escapes', async () => {
    const divergences = [];
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: (_, tags) => divergences.push(tags.result) },
    });

    // A write that ignored the new field, as a legacy job or a database
    // trigger would. The counter has to record it, not throw.
    await db('conversations').insert({ id: 'conv-3', customer_id: 44 });

    await repo.findByCustomer({ id: 44, uuid: UUID_44 });
    expect(divergences).toContain('divergent');
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'The third assertion is the one usually missing and the one that pays for itself the most. It verifies that a write which escaped the application, exactly the legacy job or forgotten trigger scenario, produces a divergence signal instead of an exception. The distinction matters because during the migration divergence is expected and informative: it is the map of write paths still left to cover. Turning it into an error would make the team disable the check as noise precisely in the phase where it is the only reliable source of information about the real state of the migration.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How long should the dual write stay in place before contracting?',
      answer:
        'The criterion is not calendar time, it is cycle coverage. The dual write has to survive at least one full run of every process that touches that table, and the slowest process defines the deadline. If there is a monthly close that reads the column, the minimum is a month plus a margin, because only in that run does a forgotten consumer reveal itself. If the slowest one is a weekly job, two weeks cover it comfortably. Three signals authorize contraction and none of them is the passage of time alone: a shadow read divergence rate at zero for the whole period, including peak days and close days; stable usage statistics on the old index, showing nobody queries through that path anymore; and the table dependency list reviewed by hand, including views, triggers, functions and external integrations, which do not show up in an application code search. Haste here has an asymmetric cost and that is what should drive the decision: waiting one more week costs one week of temporary complexity in the code, while contracting too early costs a data incident with manual reconciliation and no cheap rollback.',
    },
    {
      question: 'How do you do this when the change is the column type rather than a new column?',
      answer:
        'A type change is the case where the temptation to use ALTER COLUMN TYPE is strongest and the result is worst, because that statement rewrites the entire table under an exclusive lock and also invalidates cached plans, so the impact extends beyond its completion. The pattern stays the same, only with one extra conversion step. You create a new column with the target type, the application starts writing to both while converting in code, the backfill fills history in batches and reads switch once divergence is at zero. The extra step shows up in the cases where the conversion is not total, which is most of them: going from integer to bigint is safe, but from free text to enum, from timestamp without time zone to timestamptz, or from decimal to integer cents, each has rows that do not convert. Those rows have to be surveyed before starting, because the decision about them is a business one and not an engineering one, and discovering them mid-backfill means halting the work for a decision nobody has authority to make at two in the morning. Worth noting that in Postgres some specific cases avoid the rewrite, such as increasing a varchar limit, but relying on that requires verifying the behavior of the exact version in use, and a safe plan should not depend on a conditional engine optimization.',
    },
    {
      question: 'Does the pattern also apply to schemaless databases like MongoDB?',
      answer:
        'It does, for a reason that is often misunderstood: the absence of a schema in the database does not eliminate the schema, it only moves it into the code, which becomes the only place where it exists. Since the database accepts documents in different shapes without complaining, the expansion step is free, but the contraction step gets harder, because there is no command guaranteeing that no old document remains. In practice the pattern looks like this: the code starts reading both shapes and writing the new one, a batched backfill rewrites the old documents with the same care around key cursors and adaptive pacing, and reading of the old shape is only removed after a count confirms that no document with the legacy shape is left in the collection. The most relevant practical difference is that the moment to remove the old read code has to be decided by a verification query and not by confidence in the backfill, because no constraint prevents a forgotten path from writing the old shape the next day. It is also worth applying the collection schema validator after contraction, so that the consolidated shape is enforced by the database instead of remaining a mere convention.',
    },
  ],
  conclusion: {
    title: 'The safe migration is the one that never needs exclusivity',
    description:
      'A database serving customers in three time zones has no dawn, and insisting on finding the least bad window is solving the wrong problem. Expand, migrate and contract trades exclusivity for compatibility between neighboring deploys, and the price is a larger number of steps, each reversible until the last one. I can design the migration sequence for your database, define which operations require a concurrent index and a two-phase constraint, build the resumable backfill with replication lag control, instrument the shadow read that authorizes the switch with data instead of confidence, and set the objective criteria for contracting without leaving dead columns or permanent flags behind.',
    cta: 'Talk about the database migration in my system',
  },
  related: [
    {
      label: 'Migrating embeddings without reindexing everything at once',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Knowledge base rollback without taking support down',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La ventana de mantenimiento pedida era de cuarenta minutos un domingo de madrugada, y la respuesta del equipo de negocio fue que el sistema atiende clientes en tres husos horarios y no existe una madrugada que sirva para todos a la vez. Es la situación normal, no la excepción: la mayoría de las bases en producción hoy no tiene hora muerta. La salida no es elegir un horario menos malo, es cambiar la forma de la migración para que nunca necesite exclusividad. Este artículo muestra por qué funciona el patrón expandir, migrar y contraer, cuál es la regla de compatibilidad que decide el orden de cada despliegue, por qué el backfill tiene que ser un trabajo reanudable y no una transacción gigante, qué cambia cuando la base reescribe la tabla entera bajo un lock que nadie pidió, cómo la escritura doble se vuelve verificable en lugar de esperanzada, y cuál es el único momento en que la contracción deja de ser reversible.',
  sections: [
    {
      title: 'La ventana no desaparece, se cambia por compatibilidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La migración con ventana es simple por un motivo específico: durante la parada existe exactamente una versión del código y una versión del esquema, y por eso el esquema puede cambiar de forma incompatible sin consecuencias. Quitar la ventana no elimina ese problema, solo obliga a resolverlo de otra manera. Sin parada, existe al menos un intervalo en que la versión vieja y la nueva del código hablan con la misma base al mismo tiempo, sea porque el despliegue es gradual, porque un pod tarda en terminar de drenar, o porque un worker de cola solo reinicia cuando termina el lote actual.',
        },
        {
          type: 'paragraph',
          value:
            'De ahí sale la regla que gobierna todo lo que viene después y que es el verdadero contenido del patrón: cada despliegue tiene que ser compatible con el despliegue inmediatamente anterior, tanto en esquema como en código. No es compatibilidad con la versión de hace seis meses, que sería demasiado cara, y no es compatibilidad solo con la versión final, que es justamente el error. Es una vecindad de dos pasos. Una vez aceptada esa restricción, la cantidad de pasos deja de ser negociable: agregar una columna nueva, llenarla, pasar a leer de ella y solo entonces eliminar la vieja son cuatro despliegues porque ningún par consecutivo entre ellos se rompe, y no porque a alguien le guste la burocracia.',
        },
        {
          type: 'diagram',
          value: `MIGRACION CON VENTANA (una version viva por vez)

  [app v1 + esquema v1]  --- PARADA ---  [app v2 + esquema v2]
                          40 min sin
                          atender a nadie


EXPANDIR / MIGRAR / CONTRAER (dos versiones vivas por despliegue)

  D1 expandir   el esquema acepta v1 y v2   app v1 corre intacta
                (columna nueva, anulable)

  D2 escritura  la app escribe en los dos   la lectura sigue en la vieja
     doble      campos                      el backfill corre en lotes

  D3 lectura    la app lee del campo nuevo  la escritura sigue doble
                                            rollback = cambiar la flag

  D4 contraer   la app deja de escribir en  la columna vieja sin lector
                el viejo, columna eliminada punto sin retorno

  ^ en ningun instante existe un par (app, esquema) incompatible`,
        },
        {
          type: 'paragraph',
          value:
            'Vale nombrar el costo de esa elección en lugar de esconderlo, porque es real y aparece en la planificación del sprint. Un cambio que cabría en un pull request se vuelve cuatro, repartidos en días o semanas, y mientras tanto el código carga una complejidad temporal que hay que remover después. Los equipos que se saltan la última etapa acumulan columnas muertas, escrituras dobles olvidadas y flags permanentes, y el precio se paga en cada lectura futura de ese archivo. La contracción no es opcional, es la mitad de la migración que nadie agenda.',
        },
      ],
    },
    {
      title: 'Expandir sin trabar la tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La etapa de expansión parece la más inofensiva y es donde ocurren los incidentes más rápidos, porque la misma instrucción DDL tiene costos radicalmente distintos según un detalle que no aparece en la sintaxis. En Postgres moderno, agregar una columna anulable o con valor por defecto constante es un cambio solo de catálogo y termina en milisegundos. Agregar la misma columna con NOT NULL y sin valor por defecto, o con un valor por defecto volátil, fuerza la reescritura de la tabla entera bajo un lock exclusivo, y en una tabla de doscientos millones de filas eso significa que toda lectura y toda escritura se detienen hasta que termine.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un segundo efecto que suele tomar por sorpresa a los equipos y que es peor que la lentitud en sí. El lock exclusivo no se adquiere solo al final: la instrucción entra en la cola de locks y pasa a bloquear todas las consultas que llegan después, incluso mientras ella misma sigue esperando que termine una transacción vieja. Una migración que parecía rápida queda atrapada detrás de un SELECT de reporte que lleva tres minutos corriendo, y mientras tanto el tráfico normal se encola detrás de la migración. El síntoma es una tabla indisponible por culpa de una instrucción que, sola, tardaría diez milisegundos.',
        },
        {
          type: 'table',
          columns: ['Operación', 'Costo real en Postgres', 'Riesgo sin cuidado', 'Forma segura'],
          rows: [
            [
              'Agregar columna anulable',
              'Solo catálogo, milisegundos',
              'Bajo, aun así toma un lock breve',
              'Directo, con lock_timeout corto',
            ],
            [
              'Agregar columna NOT NULL',
              'Reescritura de la tabla entera',
              'Alto: tabla trabada por minutos',
              'Anulable, backfill, constraint NOT VALID y después VALIDATE',
            ],
            [
              'Crear índice',
              'Bloquea escritura mientras se construye',
              'Alto en tabla caliente',
              'CREATE INDEX CONCURRENTLY, fuera de transacción',
            ],
            [
              'Agregar clave foránea',
              'Recorrido completo de las dos tablas',
              'Alto: lock en ambas',
              'NOT VALID primero, VALIDATE CONSTRAINT después',
            ],
            [
              'Renombrar columna',
              'Solo catálogo, instantáneo',
              'Crítico: rompe la versión vieja de la app',
              'Nunca renombrar, crear una nueva y contraer después',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la que más incidentes causa porque parece la más barata. Renombrar una columna no le cuesta nada a la base y rompe de inmediato cualquier instancia del código viejo que siga corriendo, lo que incluye la instancia que está drenando mientras ocurre el despliegue. En un rollout gradual eso significa error en producción durante toda la ventana de convivencia. La regla práctica es que renombrar es siempre la suma de expandir y contraer, y tratarlo así desde el principio evita la peor categoría de error, la que solo aparece durante el despliegue y desaparece cuando termina.',
        },
        {
          type: 'code',
          value: `-- migrations/001_expand.sql
-- Expandir: el esquema pasa a aceptar las dos versiones de la app.
-- Nada aqui puede exigir que el codigo nuevo ya este corriendo.

-- Sin lock_timeout, una migracion que esperaria 10ms queda atrapada detras
-- de una transaccion larga y encola todo el trafico detras de ella. Fallar
-- rapido y reintentar es mejor que trabar la tabla por minutos.
SET lock_timeout = '3s';
SET statement_timeout = '30s';

-- Columna anulable: cambio de catalogo, milisegundos, no reescribe la tabla.
-- Con NOT NULL y sin default, Postgres reescribiria las 200M de filas bajo
-- lock exclusivo.
ALTER TABLE conversations
  ADD COLUMN customer_uuid uuid;

-- El indice concurrente no bloquea escritura, pero no corre dentro de una
-- transaccion. Si el framework de migracion envuelve todo en BEGIN/COMMIT,
-- esta instruccion necesita su propio archivo marcado como no transaccional.
-- Si falla, el indice queda INVALID y hay que eliminarlo a mano antes de
-- reintentar.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_customer_uuid_idx
  ON conversations (customer_uuid);

-- La constraint entra como NOT VALID: vale para filas nuevas y actualizadas
-- sin recorrer las viejas, lo que evita el lock largo. La validacion de las
-- filas existentes viene despues del backfill, en otro despliegue.
ALTER TABLE conversations
  ADD CONSTRAINT conversations_customer_uuid_not_null
  CHECK (customer_uuid IS NOT NULL) NOT VALID;`,
        },
      ],
    },
    {
      title: 'Escritura doble verificable y no solo esperanzada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La escritura doble es el corazón de la migración y es donde la mayoría de los equipos se detiene a mitad de camino. La parte fácil es hacer que el código grabe en los dos lugares. La parte que decide si la migración sale bien es poder probar, antes de cambiar la lectura, que los dos lugares coinciden. Sin esa prueba, el cambio de lectura es un salto de fe: si algún camino de escritura se escapó, un job viejo, una rutina de importación, un trigger en la base, la divergencia solo aparece después de que el campo nuevo ya es la fuente de verdad, y para entonces el dato equivocado ya se está sirviendo al cliente.',
        },
        {
          type: 'paragraph',
          value:
            'Volver eso verificable tiene dos mitades. La primera es escribir en los dos campos dentro de la misma transacción, y no en dos operaciones separadas, para que nunca exista un estado en que uno fue grabado y el otro no por una falla intermedia. La segunda es leer de los dos durante una fase de sombra, comparar y contar la divergencia como métrica en lugar de excepción. Comparar y no usar el resultado parece inútil, pero ese contador es exactamente lo que autoriza o bloquea el despliegue siguiente, porque responde a la única pregunta que importa: queda algún camino de escritura sin cubrir?',
        },
        {
          type: 'code',
          value: `// src/repositories/conversation-repository.js
// Escritura doble y lectura en sombra. La lectura en sombra existe para
// autorizar el despliegue siguiente con datos, no con confianza.

export const createConversationRepository = ({ db, flags, metrics }) => {
  const save = async (conversation) => {
    // Los dos campos en la MISMA transaccion. En dos operaciones separadas,
    // una falla intermedia deja los campos divergentes de forma permanente
    // y sin ningun registro de que ocurrio.
    await db.transaction(async (trx) => {
      await trx('conversations')
        .insert({
          id: conversation.id,
          customer_id: conversation.customerId, // legado: int
          customer_uuid: conversation.customerUuid, // nuevo: uuid
        })
        .onConflict('id')
        .merge(['customer_id', 'customer_uuid']);
    });
  };

  const findByCustomer = async (customer) => {
    const readFromNew = flags.enabled('conversations.read_uuid');

    // Fase de sombra: lee de los dos y compara sin usar el resultado nuevo.
    // El contador de divergencia es lo que autoriza el cambio de lectura.
    if (!readFromNew && flags.enabled('conversations.shadow_read')) {
      const [legacy, next] = await Promise.all([
        db('conversations').where({ customer_id: customer.id }).orderBy('id'),
        db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id'),
      ]);

      // Comparar por conjunto de ids, no por cantidad: cantidades iguales
      // con ids distintos es justamente el caso que pasa desapercibido.
      const legacyIds = new Set(legacy.map((row) => row.id));
      const matches =
        legacy.length === next.length && next.every((row) => legacyIds.has(row.id));

      metrics.increment('conversations.shadow_read', {
        result: matches ? 'match' : 'divergent',
      });

      return legacy;
    }

    return readFromNew
      ? db('conversations').where({ customer_uuid: customer.uuid }).orderBy('id')
      : db('conversations').where({ customer_id: customer.id }).orderBy('id');
  };

  return { save, findByCustomer };
};`,
        },
        {
          type: 'list',
          items: [
            'La divergencia tiene que estar etiquetada por camino de escritura, no solo contada en agregado. Saber que hay 0,3% de divergencias no ayuda; saber que todas vienen del importador de CSV resuelve el problema en una tarde.',
            'La lectura en sombra duplica la carga de lectura en esa consulta específica. En tabla caliente conviene muestrear una fracción del tráfico en lugar de comparar todo, siempre que la muestra cubra todos los caminos de escritura.',
            'Los triggers y las views de la base también son caminos de escritura y son invisibles para quien busca solo en el código de la aplicación. Conviene listar las dependencias de la tabla antes de asumir que el mapeo está completo.',
            'El orden entre backfill y escritura doble no es indiferente: la escritura doble va primero, si no el backfill llena filas viejas mientras las nuevas siguen naciendo sin el campo, y el trabajo nunca converge.',
            'La flag de lectura tiene que evaluarse por petición y no leerse una vez al arrancar, si no el rollback exige un nuevo despliegue y deja de ser instantáneo justo cuando la velocidad importa.',
          ],
        },
      ],
    },
    {
      title: 'Backfill como trabajo reanudable, no como transacción gigante',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El backfill en una sola instrucción UPDATE sobre la tabla entera es la forma más directa de convertir una migración sin ventana en una parada no planificada. Una transacción que recorre doscientos millones de filas mantiene locks de fila todo el tiempo, hace explotar el volumen de WAL, impide que el vacuum limpie versiones muertas y, si se cancela en el minuto cuarenta, deshace todo y vuelve al punto cero. Peor: mientras corre, la replicación se atrasa, y un atraso de réplica grande suele ser el primer síntoma que percibe el usuario, porque las lecturas que van a la réplica pasan a devolver dato viejo.',
        },
        {
          type: 'paragraph',
          value:
            'La forma correcta trata el backfill como un trabajo por lotes con estado propio, capaz de parar y reanudar donde quedó. Tres propiedades lo vuelven seguro en la práctica. El lote tiene que avanzar por clave y no por desplazamiento, porque OFFSET se vuelve progresivamente más lento y salta filas cuando hay eliminaciones concurrentes. Cada lote tiene que ser su propia transacción corta, para que la cancelación cueste como máximo un lote. Y el ritmo tiene que ser adaptativo, reaccionando al atraso de replicación, porque es eso lo que traduce la presión del backfill en impacto visible para el cliente.',
        },
        {
          type: 'code',
          value: `// scripts/backfill-customer-uuid.js
// Backfill reanudable: lotes por clave, una transaccion corta por lote y
// un ritmo que reacciona al atraso de replicacion.

const BATCH_SIZE = 2_000;
const MAX_REPLICA_LAG_MS = 1_000;

// Cursor por clave, no OFFSET: con OFFSET la base recorre y descarta las
// filas anteriores en cada lote, entonces el lote 5000 lee 10M de filas
// para devolver 2k. Ademas, las eliminaciones concurrentes desplazan la
// ventana y el OFFSET salta filas en silencio.
export const runBackfill = async ({ db, checkpoint, logger, sleep, replicaLagMs }) => {
  let cursor = await checkpoint.read('conversations.customer_uuid');
  let processed = 0;

  for (;;) {
    const lag = await replicaLagMs();
    if (lag > MAX_REPLICA_LAG_MS) {
      // No aborta: desacelera. El backfill es trabajo de fondo y siempre
      // pierde prioridad frente al trafico del cliente.
      logger.warn({ lag }, 'atraso de replica alto, pausando backfill');
      await sleep(5_000);
      continue;
    }

    // Una transaccion por lote. Un UPDATE unico sobre la tabla entera
    // mantiene locks por horas, infla el WAL, bloquea el vacuum y, si se
    // cancela en el minuto 40, deshace todo.
    const updated = await db.transaction(async (trx) => {
      const rows = await trx('conversations')
        .select('id', 'customer_id')
        .where('id', '>', cursor)
        .whereNull('customer_uuid')
        .orderBy('id')
        .limit(BATCH_SIZE)
        // FOR UPDATE SKIP LOCKED: si el trafico normal esta editando una
        // fila, el backfill la salta en vez de esperar. La fila vuelve en
        // la pasada siguiente porque la condicion whereNull sigue valiendo.
        .forUpdate()
        .skipLocked();

      if (rows.length === 0) return [];

      await trx.raw(
        \`UPDATE conversations c
            SET customer_uuid = m.uuid
           FROM customer_uuid_map m
          WHERE c.customer_id = m.customer_id
            AND c.id = ANY(?)\`,
        [rows.map((row) => row.id)],
      );

      return rows;
    });

    if (updated.length === 0) break;

    // El checkpoint avanza DESPUES del commit. Avanzar antes significa
    // saltar un lote entero si el proceso muere entre las dos operaciones.
    cursor = updated[updated.length - 1].id;
    await checkpoint.write('conversations.customer_uuid', cursor);

    processed += updated.length;
    logger.info({ processed, cursor }, 'lote concluido');

    // Pausa corta y deliberada: da espacio al vacuum y evita que el
    // backfill monopolice la conexion y el ancho de banda de WAL.
    await sleep(50);
  }

  logger.info({ processed }, 'backfill concluido');
  return processed;
};`,
        },
        {
          type: 'paragraph',
          value:
            'Un detalle del código anterior merece destaque porque es la diferencia entre un backfill que termina y uno que hay que reiniciar desde cero el lunes: el checkpoint se graba después del commit del lote, nunca antes. Si el proceso muere entre el commit y la escritura del checkpoint, el peor caso es reprocesar un lote ya hecho, lo cual es inofensivo porque la condición de filtro excluye las filas ya llenas. Si el orden estuviera invertido, el peor caso sería saltar un lote entero sin que nada registre el hueco, y la divergencia solo aparecería mucho después, en forma de filas con el campo nuevo vacío que nadie sabe explicar.',
        },
      ],
    },
    {
      title: 'Contraer es el único paso sin vuelta atrás',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hasta el cambio de lectura, todo es reversible cambiando una flag: la columna vieja se sigue escribiendo y sigue correcta, así que volver a leer de ella es instantáneo. La contracción rompe esa propiedad. En el momento en que el código deja de escribir en el campo viejo, este empieza a envejecer, y cada minuto que pasa aumenta el costo de un eventual rollback, porque ya no basta con cambiar la flag, hay que reconciliar todo lo que cambió desde entonces. Eliminar la columna convierte el costo en imposibilidad.',
        },
        {
          type: 'paragraph',
          value:
            'Por eso la contracción se divide en dos despliegues separados por un período de observación, y no en uno solo. El primero detiene la escritura doble y mantiene la columna vieja en su lugar, intacta. Ese es el intervalo en que cualquier consumidor olvidado, un reporte mensual, un job de cierre, una integración externa, tiene la oportunidad de fallar y ser notado mientras la vuelta atrás todavía es barata. El segundo despliegue elimina la columna, y es el único paso de toda la secuencia que no tiene plan de rollback más allá de restaurar un backup.',
        },
        {
          type: 'table',
          columns: ['Despliegue', 'Cambio en el esquema', 'Cambio en el código', 'Rollback'],
          rows: [
            [
              'D1 expandir',
              'Columna nueva anulable, índice concurrente, constraint NOT VALID',
              'Ninguno',
              'Eliminar la columna, sin impacto en la app',
            ],
            [
              'D2 escritura doble',
              'Ninguno',
              'Graba los dos campos en la misma transacción, lectura en sombra',
              'Apagar la flag de escritura doble',
            ],
            [
              'D3 backfill y validación',
              'VALIDATE CONSTRAINT al final',
              'Ninguno, corre fuera del despliegue',
              'Parar el job, nada fue cambiado',
            ],
            [
              'D4 cambiar la lectura',
              'Ninguno',
              'Pasa a leer del campo nuevo, la escritura sigue doble',
              'Apagar la flag de lectura, instantáneo',
            ],
            [
              'D5 detener la escritura vieja',
              'Ninguno',
              'Quita la escritura en el campo legado',
              'Reversible, pero exige reconciliar el período',
            ],
            [
              'D6 eliminar la columna',
              'DROP COLUMN',
              'Quita código muerto y flags',
              'Ninguno: solo restaurar un backup',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Antes del último despliegue vale un paso de verificación que cuesta poco y evita el incidente más vergonzoso de la lista. Marcar la columna como ignorada en el ORM y observar por algunos días captura al consumidor que nadie recordaba, porque el código deja de accederla sin que ella desaparezca. De forma complementaria, activar el log de instrucciones que referencian la columna, o consultar las estadísticas de uso de su índice, muestra si todavía llega tráfico real hasta ella. Descubrir que la columna aún es leída por un servicio de terceros es vergonzoso el lunes y es un incidente de datos el sábado siguiente.',
        },
      ],
    },
    {
      title: 'La prueba que demuestra la compatibilidad entre versiones vecinas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La propiedad que la migración tiene que garantizar no es que la versión nueva funciona, eso ya lo cubren las pruebas normales. Es que la versión vieja sigue funcionando contra el esquema nuevo, y que la versión nueva funciona contra el esquema viejo si el rollback ocurre antes de revertir la migración. Ninguna suite convencional prueba eso, porque cada suite corre una versión del código contra la versión correspondiente del esquema. La verificación tiene que ser explícita y es barata de montar: aplicar la migración de expansión en una base de prueba y correr la suite de la versión anterior contra ella.',
        },
        {
          type: 'code',
          value: `// test/migration-compatibility.test.js
// La suite normal prueba app nueva + esquema nuevo. Lo que se rompe en
// produccion es el par que nadie prueba: app VIEJA + esquema NUEVO, que
// existe durante todo rollout gradual y todo drenaje de pod.

import { describe, it, beforeAll, expect } from 'vitest';
import { applyMigrationsUpTo, resetDatabase } from './helpers/db.js';
import { createConversationRepository } from '../src/repositories/conversation-repository.js';

// Repositorio de la version anterior, congelado. No importar el actual: la
// prueba pierde todo su valor el dia en que los dos converjan.
import { createLegacyRepository } from './fixtures/repository-v1.js';

describe('compatibilidad entre despliegues vecinos', () => {
  beforeAll(async () => {
    await resetDatabase();
    await applyMigrationsUpTo('001_expand');
  });

  it('la version anterior de la app opera sobre el esquema expandido', async () => {
    const legacy = createLegacyRepository({ db });

    // La app vieja no conoce customer_uuid. Si la columna fuera NOT NULL
    // sin default, este insert fallaria y el rollout se romperia en
    // produccion en el primer pod que aun no hubiera reiniciado.
    await legacy.save({ id: 'conv-1', customerId: 42 });

    const found = await legacy.findByCustomer({ id: 42 });
    expect(found).toHaveLength(1);
  });

  it('la escritura doble mantiene los dos campos consistentes', async () => {
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: () => {} },
    });

    await repo.save({ id: 'conv-2', customerId: 43, customerUuid: UUID_43 });

    const [row] = await db('conversations').where({ id: 'conv-2' });
    expect(row.customer_id).toBe(43);
    expect(row.customer_uuid).toBe(UUID_43);
  });

  it('la lectura en sombra acusa divergencia cuando un camino se escapa', async () => {
    const divergences = [];
    const repo = createConversationRepository({
      db,
      flags: { enabled: (name) => name === 'conversations.shadow_read' },
      metrics: { increment: (_, tags) => divergences.push(tags.result) },
    });

    // Escritura que ignoro el campo nuevo, como haria un job legado o un
    // trigger en la base. El contador tiene que registrarlo, no lanzar.
    await db('conversations').insert({ id: 'conv-3', customer_id: 44 });

    await repo.findByCustomer({ id: 44, uuid: UUID_44 });
    expect(divergences).toContain('divergent');
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'La tercera aserción es la que suele faltar y la que más se paga a sí misma. Verifica que una escritura que se escapó de la aplicación, exactamente el escenario del job legado o del trigger olvidado, produce una señal de divergencia en lugar de una excepción. La distinción importa porque durante la migración la divergencia es esperada e informativa: es el mapa de los caminos de escritura que todavía falta cubrir. Convertirla en error haría que el equipo desactivara la verificación por ruido justo en la fase en que es la única fuente confiable de información sobre el estado real de la migración.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Cuánto tiempo mantener la escritura doble antes de contraer?',
      answer:
        'El criterio no es tiempo de calendario, es cobertura de ciclos. La escritura doble tiene que sobrevivir al menos a una ejecución completa de cada proceso que toca esa tabla, y el proceso más lento es quien define el plazo. Si existe un cierre mensual que lee la columna, el mínimo es un mes más un margen, porque solo en esa ejecución se revela un consumidor olvidado. Si el más lento es un job semanal, dos semanas cubren de sobra. Tres señales autorizan la contracción y ninguna de ellas es el paso del tiempo por sí solo: la tasa de divergencia de la lectura en sombra en cero durante todo el período, incluyendo los días pico y los días de cierre; las estadísticas de uso del índice viejo estables, mostrando que ya nadie consulta por ese camino; y la lista de dependencias de la tabla revisada a mano, incluyendo views, triggers, funciones e integraciones externas, que no aparecen en una búsqueda del código de la aplicación. La prisa aquí tiene un costo asimétrico y eso es lo que debe orientar la decisión: esperar una semana más cuesta una semana de complejidad temporal en el código, mientras que contraer demasiado pronto cuesta un incidente de datos con reconciliación manual y sin rollback barato.',
    },
    {
      question: 'Cómo hacer esto cuando el cambio es el tipo de la columna y no una columna nueva?',
      answer:
        'El cambio de tipo es el caso donde la tentación de usar ALTER COLUMN TYPE es mayor y el resultado es peor, porque esa instrucción reescribe la tabla entera bajo lock exclusivo y además invalida los planes en caché, de modo que el impacto se extiende más allá de su término. El patrón sigue siendo el mismo, solo con una etapa extra de conversión. Se crea una columna nueva con el tipo destino, la aplicación pasa a escribir en las dos convirtiendo en código, el backfill llena el histórico en lotes y la lectura cambia cuando la divergencia esté en cero. La etapa extra aparece en los casos en que la conversión no es total, que son la mayoría: pasar de integer a bigint es seguro, pero de texto libre a enum, de timestamp sin huso a timestamptz, o de decimal a entero en centavos, cada uno tiene filas que no convierten. Esas filas hay que relevarlas antes de empezar, porque la decisión sobre ellas es de negocio y no de ingeniería, y descubrirlas en medio del backfill significa detener el trabajo para tomar una decisión que nadie tiene autoridad de tomar a las dos de la mañana. Vale registrar que en Postgres algunos casos específicos evitan la reescritura, como aumentar el límite de un varchar, pero depender de eso exige verificar el comportamiento de la versión exacta en uso, y un plan seguro no debería depender de una optimización condicional del motor.',
    },
    {
      question: 'El patrón también vale para bases sin esquema fijo, como MongoDB?',
      answer:
        'Vale, por un motivo que suele malinterpretarse: la ausencia de esquema en la base no elimina el esquema, solo lo traslada al código, que pasa a ser el único lugar donde existe. Como la base acepta documentos con formatos distintos sin reclamar, la etapa de expansión sale gratis, pero la etapa de contracción se vuelve más difícil, porque no hay un comando que garantice que no quedó ningún documento viejo. En la práctica el patrón queda así: el código pasa a leer los dos formatos y a escribir el nuevo, un backfill por lotes reescribe los documentos viejos con el mismo cuidado de cursor por clave y ritmo adaptativo, y la lectura del formato viejo solo se remueve después de que un conteo confirme que no queda ningún documento con el formato legado en la colección. La diferencia práctica más relevante es que el momento de remover el código de lectura vieja tiene que decidirse por consulta de verificación y no por confianza en el backfill, porque no existe constraint que impida que un camino olvidado grabe en el formato viejo al día siguiente. También conviene usar el validador de esquema de la colección después de la contracción, para que el formato consolidado pase a ser aplicado por la base en lugar de quedar solo como convención.',
    },
  ],
  conclusion: {
    title: 'La migración segura es la que nunca necesita exclusividad',
    description:
      'Una base que atiende clientes en tres husos horarios no tiene madrugada, e insistir en encontrar la ventana menos mala es resolver el problema equivocado. Expandir, migrar y contraer cambia la exclusividad por compatibilidad entre despliegues vecinos, y el precio es una cantidad mayor de pasos, cada uno reversible hasta el último. Puedo diseñar la secuencia de migración de tu base, definir qué operaciones exigen índice concurrente y constraint en dos fases, montar el backfill reanudable con control de atraso de replicación, instrumentar la lectura en sombra que autoriza el cambio con datos en lugar de confianza y definir los criterios objetivos para contraer sin dejar columna muerta ni flag permanente.',
    cta: 'Hablar sobre la migración de base de mi sistema',
  },
  related: [
    {
      label: 'Migrar embeddings sin reindexar todo de una vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Rollback de base de conocimiento sin tumbar la atención',
      to: '/blog/rollback-base-conhecimento-voltar-indice-sem-derrubar-atendimento',
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
