// Conteudo do artigo: tabela de auditoria que virou a maior do banco. Por que o gatilho que grava
// a linha inteira antes e depois explode em tamanho e em latencia de escrita, como medir onde esta
// o custo, gravar apenas o que mudou, particionar por mes com indice BRIN, aposentar o historico
// antigo para fora do banco e, quando a latencia de escrita ainda importa, tirar a gravacao do
// caminho critico com decodificacao logica.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const medirCode = `-- 1. Quem ocupa o banco: tabela, indices e total, em ordem decrescente.
SELECT relname,
       pg_size_pretty(pg_total_relation_size(relid)) AS total,
       pg_size_pretty(pg_relation_size(relid))       AS tabela,
       pg_size_pretty(pg_indexes_size(relid))        AS indices
  FROM pg_stat_user_tables
 ORDER BY pg_total_relation_size(relid) DESC
 LIMIT 5;

-- 2. O que realmente mudou nos ultimos 7 dias, coluna por coluna. A tabela antiga guarda a linha
--    inteira em antes e depois, entao o que mudou e a diferenca entre as duas.
SELECT d.k AS coluna, count(*) AS alteracoes
  FROM auditoria a,
       LATERAL jsonb_each(a.depois) AS d(k, v)
 WHERE a.tabela = 'pedidos'
   AND a.operacao = 'U'
   AND a.criado_em > now() - interval '7 days'
   AND (a.antes -> d.k) IS DISTINCT FROM d.v
 GROUP BY d.k
 ORDER BY alteracoes DESC
 LIMIT 10;

-- 3. Quanto o gatilho custa em cada UPDATE: a ultima linha do plano mostra o tempo do gatilho.
BEGIN;
EXPLAIN (ANALYZE, BUFFERS) UPDATE pedidos SET status = 'pago' WHERE id = 981;
ROLLBACK;
-- ... Trigger auditar_alteracao: time=4.812 calls=1`;

const gatilhoCode = `-- Tabela nova, particionada por mes. A PK inclui a chave de particao.
CREATE TABLE auditoria_v2 (
  id          bigserial,
  ocorrido_em timestamptz NOT NULL DEFAULT now(),
  tabela      text        NOT NULL,
  registro_id text        NOT NULL,
  operacao    char(1)     NOT NULL CHECK (operacao IN ('I', 'U', 'D')),
  ator        text,
  antes       jsonb,
  depois      jsonb,
  PRIMARY KEY (id, ocorrido_em)
) PARTITION BY RANGE (ocorrido_em);

-- Grava so o que mudou. Colunas ruidosas passam como argumento do gatilho e sao ignoradas.
-- SECURITY DEFINER: a aplicacao nao precisa (nem deve ter) permissao de escrita na auditoria.
CREATE OR REPLACE FUNCTION auditar_alteracao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  ignoradas text[] := COALESCE(TG_ARGV, ARRAY[]::text[]);
  chave     text;
  antes     jsonb;
  depois    jsonb;
  mudou     jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    chave  := NEW.id::text;
    depois := to_jsonb(NEW);
  ELSIF TG_OP = 'DELETE' THEN
    chave := OLD.id::text;
    antes := to_jsonb(OLD);
  ELSE
    chave := NEW.id::text;
    antes := to_jsonb(OLD);
    SELECT jsonb_object_agg(n.key, n.value) INTO mudou
      FROM jsonb_each(to_jsonb(NEW)) AS n
     WHERE n.key <> ALL (ignoradas)
       AND (antes -> n.key) IS DISTINCT FROM n.value;
    IF mudou IS NULL THEN
      RETURN NULL;  -- so colunas ruidosas mudaram: nada a registrar
    END IF;
    SELECT jsonb_object_agg(o.key, o.value) INTO antes
      FROM jsonb_each(antes) AS o
     WHERE mudou ? o.key;
    depois := mudou;
  END IF;

  INSERT INTO auditoria_v2 (tabela, registro_id, operacao, ator, antes, depois)
  VALUES (TG_TABLE_NAME, chave, left(TG_OP, 1),
          NULLIF(current_setting('app.usuario_id', true), ''), antes, depois);
  RETURN NULL;
END;
$$;

-- Troca do gatilho antigo pelo novo em uma transacao curta, com lock_timeout para nao formar fila.
BEGIN;
SET LOCAL lock_timeout = '2s';
DROP TRIGGER IF EXISTS auditar ON pedidos;
CREATE TRIGGER auditar
  AFTER INSERT OR UPDATE OR DELETE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION auditar_alteracao('atualizado_em', 'ultimo_acesso', 'visualizacoes');
COMMIT;`;

const atorCode = `// com-ator.js - informa ao gatilho quem esta alterando, sem mudar nenhuma consulta existente.
import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function comAtor(usuarioId, trabalho) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Terceiro argumento true: o valor vale so ate o fim da transacao. Por isso funciona
    // com PgBouncer em modo transaction e nao vaza para a proxima requisicao da conexao.
    await client.query("SELECT set_config('app.usuario_id', $1, true)", [String(usuarioId)]);
    const resultado = await trabalho(client);
    await client.query('COMMIT');
    return resultado;
  } catch (erro) {
    await client.query('ROLLBACK');
    throw erro;
  } finally {
    client.release();
  }
}

// Uso: o UPDATE e o registro de auditoria nascem na mesma transacao, com o mesmo ator.
await comAtor(42, (client) =>
  client.query('UPDATE pedidos SET status = $1 WHERE id = $2', ['pago', 981]),
);`;

const particoesCode = `-- Indices na tabela pai: nascem em cada particao.
-- 1. Historico de um registro: "o que aconteceu com o pedido 981?"
CREATE INDEX auditoria_v2_registro_idx
  ON auditoria_v2 (tabela, registro_id, ocorrido_em DESC);
-- 2. Consulta por periodo: BRIN ocupa megabytes porque a gravacao segue a ordem do tempo.
CREATE INDEX auditoria_v2_ocorrido_brin
  ON auditoria_v2 USING brin (ocorrido_em) WITH (pages_per_range = 32);

-- Particoes criadas com antecedencia pela rotina diaria (mesma ideia do artigo de particionamento).
CREATE TABLE auditoria_v2_2026_11 PARTITION OF auditoria_v2
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');
CREATE TABLE auditoria_v2_2026_12 PARTITION OF auditoria_v2
  FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

-- Imutabilidade: a aplicacao le, mas nao escreve nem apaga. Quem escreve e a funcao SECURITY DEFINER.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON auditoria_v2 FROM app_rw;
GRANT SELECT ON auditoria_v2 TO app_rw;

-- Aposentadoria de um mes vencido (psql), na ordem: exportar, conferir, so entao remover.
\\copy (SELECT * FROM auditoria_v2_2025_10) TO PROGRAM 'zstd -T0 -19 > auditoria_2025_10.csv.zst' WITH (FORMAT csv, HEADER)
-- (enviar o arquivo ao armazenamento de objetos e conferir contagem e checksum)
ALTER TABLE auditoria_v2 DETACH PARTITION auditoria_v2_2025_10 CONCURRENTLY;
DROP TABLE auditoria_v2_2025_10;`;

const decodificacaoCode = `-- Alternativa que tira a auditoria do caminho da escrita: ler o WAL e gravar fora da transacao.
-- 1. Publicar as tabelas auditadas. REPLICA IDENTITY FULL leva a linha antiga no WAL,
--    o que aumenta o volume de WAL: so ligue nas tabelas que precisam de "antes".
ALTER TABLE pedidos REPLICA IDENTITY FULL;
CREATE PUBLICATION auditoria_pub FOR TABLE pedidos, clientes;

-- 2. O ator nao esta no WAL. A aplicacao emite uma mensagem logica dentro da mesma transacao;
--    ela chega ao consumidor na ordem certa, junto com as linhas daquela transacao.
SELECT pg_logical_emit_message(true, 'auditoria.ator', '42');`;

const diagramaPt = `Gatilho sincrono (hoje) versus leitura do WAL (alternativa)

  Gatilho:     API --UPDATE--> pedidos --gatilho--> auditoria (mesma transacao, mesmo COMMIT)
                                           custo na latencia de cada escrita

  Decodificacao logica:
               API --UPDATE--> pedidos --WAL--> slot --> consumidor --> auditoria (fora do banco)
                                           custo fora do caminho, mas com atraso e slot a vigiar`;

const diagramaEn = `Synchronous trigger (today) versus reading the WAL (alternative)

  Trigger:     API --UPDATE--> pedidos --trigger--> auditoria (same transaction, same COMMIT)
                                           cost in the latency of every write

  Logical decoding:
               API --UPDATE--> pedidos --WAL--> slot --> consumer --> auditoria (outside the database)
                                           cost off the path, but with lag and a slot to watch`;

const diagramaEs = `Trigger síncrono (hoy) versus lectura del WAL (alternativa)

  Trigger:     API --UPDATE--> pedidos --trigger--> auditoria (misma transacción, mismo COMMIT)
                                           costo en la latencia de cada escritura

  Decodificación lógica:
               API --UPDATE--> pedidos --WAL--> slot --> consumidor --> auditoria (fuera de la base)
                                           costo fuera del camino, pero con retraso y un slot que vigilar`;

const pt = {
  intro:
    'A tabela auditoria de uma plataforma de pedidos chegou a 2,1 TB e 6,4 bilhões de linhas, 58% de um banco de 3,6 TB. Ela nasceu como um gatilho de quatro linhas que grava a linha inteira antes e depois de cada alteração, e ficou assim porque funcionava. Hoje o backup demora mais por causa dela, os quatro índices somam 740 GB, o UPDATE de pedidos subiu de 9 ms para 14 ms no p95 só pelo tempo do gatilho, e ninguém ousa apagar nada porque a auditoria é "obrigatória". Este artigo mostra como medir onde está o custo, gravar apenas o que mudou, particionar por mês com um índice que ocupa megabytes, aposentar o histórico antigo para fora do banco e, quando a latência de escrita ainda pesa, tirar a gravação do caminho crítico.',
  sections: [
    {
      title: 'Por que a tabela de auditoria vira a maior do banco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Auditoria cresce por três razões que se multiplicam. A primeira é a amplificação: cada UPDATE de uma linha de 1 KB vira outra linha de mais de 2 KB, porque o gatilho guarda o estado inteiro antes e depois em JSONB, mesmo quando só uma coluna mudou. A segunda é o ruído: colunas como atualizado_em, ultimo_acesso e contador de visualizações mudam o tempo todo e geram registros que ninguém consulta. No cenário do artigo, 62% das linhas de auditoria de pedidos registravam apenas mudanças nessas colunas. A terceira é a ausência de fim: ninguém definiu por quanto tempo o dado precisa estar rápido de consultar, então tudo fica no mesmo lugar para sempre.',
        },
        {
          type: 'paragraph',
          value:
            'Os sintomas aparecem longe da tabela. O backup e a restauração crescem com ela. O autovacuum e a construção de índices passam a competir com o tráfego. A cada alteração, o gatilho acrescenta uma gravação em outra tabela, com quatro índices para manter, dentro da mesma transação do usuário. Cada milissegundo desse trabalho é latência da API, e a conta é feita em todas as escritas, não só nas que alguém vai auditar um dia.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Antes', 'Meta do artigo'],
          rows: [
            ['Tamanho online da auditoria', '2,1 TB e 740 GB só de índices', 'Cerca de 330 GB, com 12 meses online'],
            ['Linhas por dia', '14 milhões, 1,1 KB cada, 15 GB/dia', '5,3 milhões, 140 bytes cada, 0,8 GB/dia'],
            ['Tempo do gatilho no UPDATE (p95)', '5 ms', '1,2 ms'],
            ['p95 do UPDATE em pedidos', '14 ms', '10,4 ms'],
            ['Índices na auditoria', '4, mantidos a cada gravação', '1 composto + 1 BRIN de poucos MB'],
            ['Remoção de dado vencido', 'Não existe', 'DROP de partição, milissegundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A meta não pede ferramenta nova. Pede três decisões: gravar menos por evento, organizar o que fica por tempo e escolher onde cada idade do dado deve morar.',
        },
      ],
    },
    {
      title: 'Onde está o custo: medir antes de mexer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de reescrever o gatilho, três medições separam o que é problema de tamanho, de ruído e de latência. A primeira lista as maiores tabelas com a divisão entre dados e índices. A segunda compara antes e depois de cada linha da auditoria e conta quais colunas realmente mudaram, o que mostra o tamanho do ruído. A terceira usa EXPLAIN ANALYZE dentro de uma transação revertida para ver, na última linha do plano, quanto tempo o gatilho consome em um UPDATE real.',
        },
        {
          type: 'code',
          value: medirCode,
        },
        {
          type: 'paragraph',
          value:
            'No caso do artigo, a segunda consulta mostrou que atualizado_em, ultimo_acesso e visualizacoes respondiam por 62% das alterações, e a terceira mostrou 4,8 ms de gatilho em um UPDATE de 9 ms. Esses números definem o que atacar e em que ordem, e comparam o antes e o depois sem depender de impressão. As opções reais de arquitetura são as da tabela abaixo.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Custo na escrita', 'Tamanho', 'Garantia', 'Quando usar'],
          rows: [
            ['Gatilho gravando linha inteira', 'Alto', 'Máximo', 'Mesma transação, nunca perde', 'Tabela pequena, volume baixo'],
            ['Gatilho gravando só o diff', 'Médio', 'Cerca de 8 vezes menor', 'Mesma transação, nunca perde', 'Ponto de partida para a maioria'],
            ['Diff + partição mensal + BRIN', 'Médio', 'Menor e com retenção barata', 'Mesma transação, nunca perde', 'Auditoria consultada por registro e por período'],
            ['Decodificação lógica (WAL)', 'Baixo', 'Escolha do consumidor', 'Eventual, com atraso e slot a vigiar', 'Latência de escrita crítica, volume muito alto'],
            ['Auditoria na aplicação', 'Depende do código', 'Escolha da equipe', 'Perde o que passa por fora da aplicação', 'Evitar para dados regulados'],
          ],
        },
      ],
    },
    {
      title: 'Gravar só o que mudou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maior economia vem de duas regras simples. A primeira: se nada relevante mudou, não registre. A segunda: quando algo mudou, guarde só as colunas que mudaram, com o valor antigo e o novo. Em INSERT guarda-se o estado novo, em DELETE o estado antigo, e em UPDATE apenas a diferença. O gatilho abaixo implementa isso comparando os dois JSONB, aceita uma lista de colunas ruidosas como argumento e devolve sem gravar nada quando só elas mudaram.',
        },
        {
          type: 'code',
          value: gatilhoCode,
        },
        {
          type: 'list',
          items: [
            'O gatilho é AFTER ... FOR EACH ROW e devolve NULL, o que é válido nesse tipo, e roda na mesma transação do UPDATE. Se a transação for revertida, o registro some junto, o que é o comportamento certo para auditoria.',
            'SECURITY DEFINER com search_path fixo faz a função gravar com o dono, para que o papel da aplicação não precise de permissão de escrita na auditoria. Sem o search_path fixo, a função ficaria sujeita a sequestro por objetos criados em outro esquema.',
            'O argumento da lista de colunas ignoradas fica no CREATE TRIGGER, ao lado da tabela. Cada tabela pode ter a sua lista sem copiar a função.',
            'O ator vem de uma configuração local da transação, preenchida pela aplicação. Se ela não estiver definida, o campo fica nulo, e uma consulta por linhas sem ator é um bom alerta de alteração feita fora do caminho esperado, como um acesso direto ao banco.',
            'O código assume uma coluna id em cada tabela auditada. Para chave composta, concatene as colunas em chave antes do INSERT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para o ator, a aplicação precisa informar quem está alterando dentro da mesma transação. O trecho em Node.js usa set_config com o terceiro argumento verdadeiro, que limita o valor à transação. Isso importa com PgBouncer em modo de transação, em que a mesma conexão atende clientes diferentes em sequência e uma configuração de sessão vazaria de um usuário para outro.',
        },
        {
          type: 'code',
          value: atorCode,
        },
        {
          type: 'paragraph',
          value:
            'No cenário medido, a linha média de auditoria caiu de 1,1 KB para 140 bytes, o volume diário de 14 milhões para 5,3 milhões de linhas, e o gatilho de 4,8 ms para 1,2 ms. Cada UPDATE ficou, no p95, em 10,4 ms. O ganho veio quase todo de gravar menos, não de um truque de otimização.',
        },
      ],
    },
    {
      title: 'Partição mensal, índice BRIN e retenção em camadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o volume menor, o que resta é organizar o histórico pelo único eixo que ele tem: o tempo. Particionar a auditoria por mês faz a gravação cair sempre na partição corrente, mantém os índices dessa partição pequenos o bastante para ficar em memória e transforma a expiração em um DROP TABLE. Há dois padrões de leitura, e cada um ganha o índice certo. O histórico de um registro usa um índice composto por tabela, registro e data. A consulta por período usa BRIN, um índice que guarda apenas o mínimo e o máximo de cada faixa de páginas, e funciona aqui porque a gravação segue a ordem do tempo. Ele ocupa megabytes no lugar de centenas de gigabytes.',
        },
        {
          type: 'code',
          value: particoesCode,
        },
        {
          type: 'list',
          items: [
            'Camada quente: 12 meses em partições no banco, com os dois índices. Cobre as consultas da operação, do suporte e da maioria das auditorias internas.',
            'Camada fria: meses vencidos exportados em CSV comprimido com zstd para o armazenamento de objetos, com contagem e checksum conferidos antes de remover a partição. No cenário, os 2,1 TB legados comprimiram para cerca de 240 GB.',
            'Consulta sobre o frio: sob demanda, carregando o arquivo do mês em um banco temporário. É lenta de propósito, e o prazo de resposta combinado com quem pede é parte da política de retenção.',
            'Imutabilidade: a aplicação só lê. O papel de manutenção que faz DETACH e DROP não é o papel da aplicação, e todo DROP deve ficar registrado em um log fora do banco.',
            'Partições futuras precisam existir antes do primeiro dia do mês. A rotina de criação e o cuidado com a partição padrão seguem o que o artigo sobre particionamento por data descreve.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe de escolha: a retenção legal costuma ser medida em anos, e a consulta rápida em meses. Misturar as duas é o que fez a tabela chegar a 2,1 TB. Separar o prazo de guarda do prazo de consulta é a decisão de produto que sustenta o resto da engenharia.',
        },
      ],
    },
    {
      title: 'Tirar a gravação do caminho crítico com decodificação lógica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo enxuto, o gatilho ainda custa 1,2 ms e uma gravação a mais em cada escrita. Para a maioria dos sistemas, isso é um preço razoável pela garantia mais forte: o registro nasce e morre junto com a alteração. Quando a latência de escrita é crítica ou o volume é muito alto, a alternativa é deixar o banco escrever apenas o que já escreve, o WAL, e um consumidor externo montar a auditoria a partir dele.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'code',
          value: decodificacaoCode,
        },
        {
          type: 'list',
          items: [
            'O custo sai do caminho do usuário, mas a garantia vira eventual: a auditoria chega com atraso, e o consumidor precisa ser idempotente porque a entrega pode repetir.',
            'REPLICA IDENTITY FULL é necessário para ter o valor antigo no UPDATE e no DELETE, e faz o WAL crescer. Ligue só nas tabelas em que o "antes" importa.',
            'O slot de replicação segura WAL enquanto o consumidor estiver parado. Um consumidor fora do ar por horas pode encher o disco do servidor, então monitore o atraso do slot e defina um limite com max_slot_wal_keep_size.',
            'O ator não está no WAL. A mensagem lógica emitida pela aplicação dentro da transação carrega essa informação até o consumidor, na ordem correta.',
            'A mudança de esquema da tabela auditada passa a ser também um contrato com o consumidor, e uma coluna nova precisa ser tratada nos dois lados.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A escolha entre as duas formas é de risco, não de modismo. Se perder um registro de auditoria é inaceitável e o orçamento de latência aguenta 1 ms, fique com o gatilho. Se a latência de escrita é o gargalo medido e o negócio tolera segundos de atraso na auditoria, a decodificação compensa o custo operacional.',
        },
      ],
    },
    {
      title: 'Migrar a tabela atual sem parar nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A troca não exige janela. A tabela nova nasce ao lado, o gatilho novo passa a gravar nela, e a antiga envelhece até caber na política de retenção. O que a aplicação enxerga durante a transição é uma visão que une as duas.',
        },
        {
          type: 'ordered',
          items: [
            'Crie auditoria_v2, a função nova e as partições dos próximos meses. Nada muda para quem escreve.',
            'Troque o gatilho tabela por tabela, começando pelas de menor risco, em uma transação curta com lock_timeout. A troca de gatilho pede um bloqueio curto na tabela, e a falha por timeout é segura: tenta-se de novo.',
            'Durante uma semana, compare por amostra: para cada UPDATE auditado nas duas estruturas, o diff novo precisa conter as mesmas colunas que a diferença entre antes e depois do registro antigo, menos as ruidosas.',
            'Crie uma visão auditoria_historico que une a tabela antiga e a nova, para que telas e relatórios existentes continuem funcionando sem alteração.',
            'Exporte e remova a tabela antiga por faixa de data, usando o mesmo processo de aposentadoria. Se a antiga for particionada em um segundo momento, o artigo sobre particionamento por data mostra como transformá-la em partição sem copiar linhas.',
            'Documente a política: o que é auditado, quais colunas são ignoradas e por quê, quanto tempo fica online, quanto tempo fica arquivado e quem pode pedir uma restauração.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O resultado no cenário foi 330 GB online contra 2,1 TB, um backup 6 vezes menor, a gravação de auditoria sem índice pesado e um UPDATE de pedidos em 10,4 ms no p95. A auditoria continuou com a mesma garantia de antes: nenhuma alteração sem registro, e nenhum registro sem alteração.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Gravar só o diff não perde informação importante?',
      answer:
        'Perde a foto completa da linha em cada evento, mas ela pode ser reconstruída: o INSERT guarda o estado inicial e cada UPDATE guarda o que mudou, então o estado em qualquer data é a aplicação em ordem das diferenças. Para registros em que a reconstrução precisa ser instantânea, guarde um instantâneo completo de tempos em tempos, por exemplo no fechamento do mês. O que deve ficar de fora é só o ruído que ninguém consulta, e a lista de colunas ignoradas deve ser revisada com quem usa a auditoria.',
    },
    {
      question: 'O pgaudit resolve esse problema?',
      answer:
        'Resolve outro. O pgaudit registra comandos SQL no log do servidor, o que serve a conformidade de acesso e a investigação de quem executou o quê, mas não responde "o que mudou neste registro entre as datas X e Y" com consulta direta. Para histórico de dados por registro, o gatilho ou a decodificação lógica entregam uma tabela consultável. As duas abordagens podem coexistir.',
    },
    {
      question: 'Como garantir que ninguém altere ou apague a auditoria?',
      answer:
        'Em camadas. O papel da aplicação só tem SELECT na tabela, e quem grava é a função SECURITY DEFINER. O papel de manutenção que remove partições vencidas é separado, com os DROP registrados fora do banco. Para exigência mais forte, grave um hash encadeado por registro ou exporte periodicamente os arquivos comprimidos para armazenamento com bloqueio de exclusão. Nenhuma dessas medidas substitui acesso restrito ao banco, mas elas tornam a adulteração detectável.',
    },
  ],
  conclusion: {
    title: 'Auditoria boa registra o que importa, organiza por tempo e sabe quando esquecer',
    description:
      'A tabela de 2,1 TB não cresceu porque auditar é caro, e sim porque ninguém decidiu o que registrar, por quanto tempo consultar e onde cada idade do dado deve ficar. Gravar apenas o que mudou cortou o volume e o tempo do gatilho, a partição mensal com BRIN deixou a expiração em milissegundos, a camada fria tirou os anos antigos do banco, e a decodificação lógica ficou como saída para quando a latência de escrita for o gargalo medido. A garantia continua a mesma, com um banco menor e uma escrita mais rápida.',
    cta: 'Revisar a auditoria e o histórico de dados do meu banco',
  },
  related: [
    {
      label: 'Tabela que cresceu demais: particionar por data no Postgres sem reescrever a aplicação',
      to: '/blog/tabela-que-cresceu-demais-particionar-por-data-no-postgres-sem-reescrever-a-aplicacao',
    },
    {
      label: 'Autovacuum que não acompanha: quando a tabela incha e a consulta fica lenta sem mudar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The auditoria table of an order platform reached 2.1 TB and 6.4 billion rows, 58% of a 3.6 TB database. It started as a four-line trigger that stores the whole row before and after every change, and it stayed that way because it worked. Today the backup takes longer because of it, its four indexes add up to 740 GB, the orders UPDATE went from 9 ms to 14 ms at p95 just from the trigger time, and nobody dares delete anything because auditing is "mandatory". This article shows how to measure where the cost is, store only what changed, partition by month with an index that takes megabytes, retire old history out of the database and, when write latency still matters, take the write off the critical path.',
  sections: [
    {
      title: 'Why the audit table becomes the largest in the database',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Audit data grows for three reasons that multiply each other. The first is amplification: every UPDATE of a 1 KB row becomes another row of more than 2 KB, because the trigger stores the whole state before and after as JSONB, even when a single column changed. The second is noise: columns such as atualizado_em, ultimo_acesso and a view counter change all the time and produce records nobody reads. In the scenario of this article, 62% of the audit rows for orders recorded changes in those columns only. The third is the lack of an end: nobody defined for how long the data needs to be fast to query, so everything stays in the same place forever.',
        },
        {
          type: 'paragraph',
          value:
            'The symptoms show up far from the table. Backup and restore grow with it. Autovacuum and index builds start competing with traffic. On every change, the trigger adds a write to another table, with four indexes to maintain, inside the same transaction as the user. Every millisecond of that work is API latency, and the bill is paid on all writes, not only the ones somebody will audit one day.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'Before', 'Goal of the article'],
          rows: [
            ['Online size of the audit data', '2.1 TB and 740 GB of indexes alone', 'About 330 GB, with 12 months online'],
            ['Rows per day', '14 million, 1.1 KB each, 15 GB/day', '5.3 million, 140 bytes each, 0.8 GB/day'],
            ['Trigger time in the UPDATE (p95)', '5 ms', '1.2 ms'],
            ['p95 of the UPDATE on orders', '14 ms', '10.4 ms'],
            ['Indexes on the audit data', '4, maintained on every write', '1 composite + 1 BRIN of a few MB'],
            ['Removing expired data', 'Does not exist', 'Partition DROP, milliseconds'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The goal does not call for a new tool. It calls for three decisions: write less per event, organize what remains by time, and choose where each age of the data should live.',
        },
      ],
    },
    {
      title: 'Where the cost is: measure before touching anything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before rewriting the trigger, three measurements separate what is a size problem, a noise problem and a latency problem. The first lists the largest tables with the split between data and indexes. The second compares the before and after of each audit row and counts which columns actually changed, which shows how big the noise is. The third uses EXPLAIN ANALYZE inside a rolled-back transaction to see, on the last line of the plan, how much time the trigger takes in a real UPDATE.',
        },
        {
          type: 'code',
          value: medirCode,
        },
        {
          type: 'paragraph',
          value:
            'In the case of this article, the second query showed that atualizado_em, ultimo_acesso and visualizacoes accounted for 62% of the changes, and the third showed 4.8 ms of trigger in a 9 ms UPDATE. These numbers define what to attack and in what order, and they let you compare before and after without relying on impressions. The real architecture options are in the table below.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Write cost', 'Size', 'Guarantee', 'When to use'],
          rows: [
            ['Trigger storing the whole row', 'High', 'Maximum', 'Same transaction, never loses', 'Small table, low volume'],
            ['Trigger storing only the diff', 'Medium', 'About 8 times smaller', 'Same transaction, never loses', 'Starting point for most cases'],
            ['Diff + monthly partition + BRIN', 'Medium', 'Smaller, with cheap retention', 'Same transaction, never loses', 'Audit queried by record and by period'],
            ['Logical decoding (WAL)', 'Low', 'Consumer choice', 'Eventual, with lag and a slot to watch', 'Critical write latency, very high volume'],
            ['Auditing in the application', 'Depends on the code', 'Team choice', 'Misses whatever goes around the application', 'Avoid for regulated data'],
          ],
        },
      ],
    },
    {
      title: 'Store only what changed',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The biggest saving comes from two simple rules. First: if nothing relevant changed, do not record anything. Second: when something did change, keep only the columns that changed, with the old and the new value. On INSERT the new state is stored, on DELETE the old state, and on UPDATE only the difference. The trigger below implements this by comparing the two JSONB values, accepts a list of noisy columns as an argument and returns without writing anything when only they changed.',
        },
        {
          type: 'code',
          value: gatilhoCode,
        },
        {
          type: 'list',
          items: [
            'The trigger is AFTER ... FOR EACH ROW and returns NULL, which is valid for that kind, and it runs in the same transaction as the UPDATE. If the transaction is rolled back, the record disappears with it, which is the right behavior for auditing.',
            'SECURITY DEFINER with a fixed search_path makes the function write as the owner, so the application role does not need write permission on the audit data. Without the fixed search_path, the function would be open to hijacking by objects created in another schema.',
            'The argument with the list of ignored columns sits in CREATE TRIGGER, next to the table. Each table can have its own list without copying the function.',
            'The actor comes from a transaction-local setting filled by the application. If it is not set, the field stays null, and a query for rows without an actor is a good alert for changes made outside the expected path, such as direct access to the database.',
            'The code assumes an id column in every audited table. For a composite key, concatenate the columns into chave before the INSERT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'For the actor, the application must say who is making the change inside the same transaction. The Node.js snippet uses set_config with the third argument true, which limits the value to the transaction. That matters with PgBouncer in transaction mode, where the same connection serves different clients in sequence and a session setting would leak from one user to another.',
        },
        {
          type: 'code',
          value: atorCode,
        },
        {
          type: 'paragraph',
          value:
            'In the measured scenario, the average audit row dropped from 1.1 KB to 140 bytes, the daily volume from 14 million to 5.3 million rows, and the trigger from 4.8 ms to 1.2 ms. Each UPDATE ended at 10.4 ms at p95. The gain came almost entirely from writing less, not from an optimization trick.',
        },
      ],
    },
    {
      title: 'Monthly partition, BRIN index and tiered retention',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the volume smaller, what remains is organizing the history along the only axis it has: time. Partitioning the audit data by month makes writes always land in the current partition, keeps that partition indexes small enough to stay in memory and turns expiry into a DROP TABLE. There are two read patterns, and each gets the right index. The history of one record uses a composite index on table, record and date. The query by period uses BRIN, an index that only stores the minimum and maximum of each range of pages, and it works here because writes follow the order of time. It takes megabytes instead of hundreds of gigabytes.',
        },
        {
          type: 'code',
          value: particoesCode,
        },
        {
          type: 'list',
          items: [
            'Hot tier: 12 months in partitions inside the database, with both indexes. It covers operations, support and most internal audits.',
            'Cold tier: expired months exported as zstd-compressed CSV to object storage, with count and checksum verified before the partition is removed. In the scenario, the 2.1 TB legacy compressed to about 240 GB.',
            'Querying the cold tier: on demand, loading the month file into a temporary database. It is slow on purpose, and the response time agreed with whoever asks is part of the retention policy.',
            'Immutability: the application only reads. The maintenance role that runs DETACH and DROP is not the application role, and every DROP must be recorded in a log outside the database.',
            'Future partitions must exist before the first day of the month. The creation routine and the care with the default partition follow what the article on date partitioning describes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'One note on the choice: legal retention is usually measured in years, and fast querying in months. Mixing the two is what made the table reach 2.1 TB. Separating the keeping period from the querying period is the product decision that supports the rest of the engineering.',
        },
      ],
    },
    {
      title: 'Taking the write off the critical path with logical decoding',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even lean, the trigger still costs 1.2 ms and one extra write on every write. For most systems that is a fair price for the strongest guarantee: the record is born and dies together with the change. When write latency is critical or the volume is very high, the alternative is to let the database write only what it already writes, the WAL, and have an external consumer build the audit data from it.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'code',
          value: decodificacaoCode,
        },
        {
          type: 'list',
          items: [
            'The cost leaves the user path, but the guarantee becomes eventual: the audit data arrives late, and the consumer must be idempotent because delivery can repeat.',
            'REPLICA IDENTITY FULL is needed to have the old value on UPDATE and DELETE, and it makes the WAL grow. Turn it on only for the tables where the "before" matters.',
            'The replication slot holds WAL while the consumer is stopped. A consumer down for hours can fill the server disk, so monitor slot lag and set a limit with max_slot_wal_keep_size.',
            'The actor is not in the WAL. The logical message emitted by the application inside the transaction carries that information to the consumer, in the correct order.',
            'A schema change on the audited table also becomes a contract with the consumer, and a new column must be handled on both sides.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Choosing between the two is about risk, not fashion. If losing an audit record is unacceptable and the latency budget can take 1 ms, keep the trigger. If write latency is the measured bottleneck and the business tolerates seconds of delay in the audit data, logical decoding pays for its operational cost.',
        },
      ],
    },
    {
      title: 'Migrating the current table without stopping anything',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The swap needs no window. The new table is born next to the old one, the new trigger starts writing to it, and the old one ages until it fits the retention policy. What the application sees during the transition is a view that joins both.',
        },
        {
          type: 'ordered',
          items: [
            'Create auditoria_v2, the new function and the partitions for the coming months. Nothing changes for whoever writes.',
            'Swap the trigger table by table, starting with the lowest-risk ones, in a short transaction with lock_timeout. Swapping a trigger needs a brief lock on the table, and failing on timeout is safe: you just try again.',
            'For a week, compare by sampling: for each UPDATE audited in both structures, the new diff must contain the same columns as the difference between before and after in the old record, minus the noisy ones.',
            'Create an auditoria_historico view that joins the old and the new table, so existing screens and reports keep working unchanged.',
            'Export and remove the old table by date range, using the same retirement process. If the old one is partitioned later, the article on date partitioning shows how to turn it into a partition without copying rows.',
            'Document the policy: what is audited, which columns are ignored and why, how long data stays online, how long it stays archived and who can ask for a restore.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The result in the scenario was 330 GB online against 2.1 TB, a backup 6 times smaller, audit writes without a heavy index and an orders UPDATE at 10.4 ms at p95. Auditing kept the same guarantee as before: no change without a record, and no record without a change.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does storing only the diff lose important information?',
      answer:
        'It loses the full snapshot of the row at each event, but it can be rebuilt: the INSERT keeps the initial state and each UPDATE keeps what changed, so the state at any date is the ordered application of the differences. For records where reconstruction must be instant, keep a full snapshot from time to time, for example at month close. What should stay out is only the noise nobody queries, and the list of ignored columns should be reviewed with the people who use the audit data.',
    },
    {
      question: 'Does pgaudit solve this problem?',
      answer:
        'It solves a different one. pgaudit records SQL commands in the server log, which serves access compliance and the investigation of who ran what, but it does not answer "what changed in this record between dates X and Y" with a direct query. For per-record data history, the trigger or logical decoding deliver a queryable table. The two approaches can coexist.',
    },
    {
      question: 'How do I make sure nobody alters or deletes the audit data?',
      answer:
        'In layers. The application role only has SELECT on the table, and the writer is the SECURITY DEFINER function. The maintenance role that removes expired partitions is separate, with DROPs recorded outside the database. For a stronger requirement, store a chained hash per record or periodically export the compressed files to storage with deletion lock. None of these measures replaces restricted access to the database, but they make tampering detectable.',
    },
  ],
  conclusion: {
    title: 'Good auditing records what matters, organizes by time and knows when to forget',
    description:
      'The 2.1 TB table did not grow because auditing is expensive, but because nobody decided what to record, for how long to query it and where each age of the data should live. Writing only what changed cut the volume and the trigger time, the monthly partition with BRIN made expiry take milliseconds, the cold tier took the old years out of the database, and logical decoding stayed as the way out for when write latency is the measured bottleneck. The guarantee is the same, with a smaller database and faster writes.',
    cta: 'Review the auditing and data history of my database',
  },
  related: [
    {
      label: 'The table that grew too large: partitioning by date in Postgres without rewriting the application',
      to: '/blog/tabela-que-cresceu-demais-particionar-por-data-no-postgres-sem-reescrever-a-aplicacao',
    },
    {
      label: 'Autovacuum that cannot keep up: when the table bloats and the query slows down with no change',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La tabla auditoria de una plataforma de pedidos llegó a 2,1 TB y 6,4 mil millones de filas, el 58% de una base de 3,6 TB. Nació como un trigger de cuatro líneas que guarda la fila completa antes y después de cada cambio, y se quedó así porque funcionaba. Hoy el backup tarda más por su causa, sus cuatro índices suman 740 GB, el UPDATE de pedidos pasó de 9 ms a 14 ms en el p95 solo por el tiempo del trigger, y nadie se atreve a borrar nada porque la auditoría es "obligatoria". Este artículo muestra cómo medir dónde está el costo, guardar solo lo que cambió, particionar por mes con un índice que ocupa megabytes, retirar el historial antiguo de la base y, cuando la latencia de escritura todavía pesa, sacar la grabación del camino crítico.',
  sections: [
    {
      title: 'Por qué la tabla de auditoría se vuelve la más grande de la base',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La auditoría crece por tres razones que se multiplican. La primera es la amplificación: cada UPDATE de una fila de 1 KB se convierte en otra fila de más de 2 KB, porque el trigger guarda el estado completo antes y después en JSONB, incluso cuando solo cambió una columna. La segunda es el ruido: columnas como atualizado_em, ultimo_acesso y un contador de visualizaciones cambian todo el tiempo y generan registros que nadie consulta. En el escenario del artículo, el 62% de las filas de auditoría de pedidos registraban solo cambios en esas columnas. La tercera es la ausencia de final: nadie definió por cuánto tiempo el dato necesita ser rápido de consultar, así que todo queda en el mismo lugar para siempre.',
        },
        {
          type: 'paragraph',
          value:
            'Los síntomas aparecen lejos de la tabla. El backup y la restauración crecen con ella. El autovacuum y la construcción de índices pasan a competir con el tráfico. En cada cambio, el trigger agrega una escritura en otra tabla, con cuatro índices que mantener, dentro de la misma transacción del usuario. Cada milisegundo de ese trabajo es latencia de la API, y la cuenta se paga en todas las escrituras, no solo en las que alguien auditará algún día.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Antes', 'Meta del artículo'],
          rows: [
            ['Tamaño en línea de la auditoría', '2,1 TB y 740 GB solo de índices', 'Cerca de 330 GB, con 12 meses en línea'],
            ['Filas por día', '14 millones, 1,1 KB cada una, 15 GB/día', '5,3 millones, 140 bytes cada una, 0,8 GB/día'],
            ['Tiempo del trigger en el UPDATE (p95)', '5 ms', '1,2 ms'],
            ['p95 del UPDATE en pedidos', '14 ms', '10,4 ms'],
            ['Índices en la auditoría', '4, mantenidos en cada escritura', '1 compuesto + 1 BRIN de pocos MB'],
            ['Eliminación de dato vencido', 'No existe', 'DROP de partición, milisegundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La meta no pide una herramienta nueva. Pide tres decisiones: grabar menos por evento, organizar lo que queda por tiempo y elegir dónde debe vivir cada edad del dato.',
        },
      ],
    },
    {
      title: 'Dónde está el costo: medir antes de tocar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de reescribir el trigger, tres mediciones separan lo que es problema de tamaño, de ruido y de latencia. La primera lista las tablas más grandes con la división entre datos e índices. La segunda compara el antes y el después de cada fila de la auditoría y cuenta qué columnas realmente cambiaron, lo que muestra el tamaño del ruido. La tercera usa EXPLAIN ANALYZE dentro de una transacción revertida para ver, en la última línea del plan, cuánto tiempo consume el trigger en un UPDATE real.',
        },
        {
          type: 'code',
          value: medirCode,
        },
        {
          type: 'paragraph',
          value:
            'En el caso del artículo, la segunda consulta mostró que atualizado_em, ultimo_acesso y visualizacoes respondían por el 62% de los cambios, y la tercera mostró 4,8 ms de trigger en un UPDATE de 9 ms. Esos números definen qué atacar y en qué orden, y permiten comparar el antes y el después sin depender de impresiones. Las opciones reales de arquitectura están en la tabla siguiente.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Costo en la escritura', 'Tamaño', 'Garantía', 'Cuándo usar'],
          rows: [
            ['Trigger guardando la fila completa', 'Alto', 'Máximo', 'Misma transacción, nunca pierde', 'Tabla pequeña, volumen bajo'],
            ['Trigger guardando solo el diff', 'Medio', 'Cerca de 8 veces menor', 'Misma transacción, nunca pierde', 'Punto de partida para la mayoría'],
            ['Diff + partición mensual + BRIN', 'Medio', 'Menor y con retención barata', 'Misma transacción, nunca pierde', 'Auditoría consultada por registro y por período'],
            ['Decodificación lógica (WAL)', 'Bajo', 'Elección del consumidor', 'Eventual, con retraso y un slot que vigilar', 'Latencia de escritura crítica, volumen muy alto'],
            ['Auditoría en la aplicación', 'Depende del código', 'Elección del equipo', 'Pierde lo que pasa por fuera de la aplicación', 'Evitar para datos regulados'],
          ],
        },
      ],
    },
    {
      title: 'Guardar solo lo que cambió',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El mayor ahorro viene de dos reglas simples. La primera: si nada relevante cambió, no registres. La segunda: cuando algo cambió, guarda solo las columnas que cambiaron, con el valor antiguo y el nuevo. En INSERT se guarda el estado nuevo, en DELETE el estado antiguo, y en UPDATE solo la diferencia. El trigger siguiente implementa esto comparando los dos JSONB, acepta una lista de columnas ruidosas como argumento y retorna sin grabar nada cuando solo ellas cambiaron.',
        },
        {
          type: 'code',
          value: gatilhoCode,
        },
        {
          type: 'list',
          items: [
            'El trigger es AFTER ... FOR EACH ROW y devuelve NULL, lo que es válido para ese tipo, y corre en la misma transacción del UPDATE. Si la transacción se revierte, el registro desaparece con ella, que es el comportamiento correcto para auditoría.',
            'SECURITY DEFINER con search_path fijo hace que la función grabe con el dueño, de modo que el rol de la aplicación no necesite permiso de escritura en la auditoría. Sin el search_path fijo, la función quedaría expuesta al secuestro por objetos creados en otro esquema.',
            'El argumento con la lista de columnas ignoradas queda en el CREATE TRIGGER, junto a la tabla. Cada tabla puede tener su lista sin copiar la función.',
            'El actor viene de una configuración local de la transacción, completada por la aplicación. Si no está definida, el campo queda nulo, y una consulta de filas sin actor es una buena alerta de cambio hecho fuera del camino esperado, como un acceso directo a la base.',
            'El código asume una columna id en cada tabla auditada. Para clave compuesta, concatena las columnas en chave antes del INSERT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Para el actor, la aplicación necesita informar quién está haciendo el cambio dentro de la misma transacción. El fragmento en Node.js usa set_config con el tercer argumento verdadero, que limita el valor a la transacción. Eso importa con PgBouncer en modo transacción, donde la misma conexión atiende clientes distintos en secuencia y una configuración de sesión se filtraría de un usuario a otro.',
        },
        {
          type: 'code',
          value: atorCode,
        },
        {
          type: 'paragraph',
          value:
            'En el escenario medido, la fila promedio de auditoría bajó de 1,1 KB a 140 bytes, el volumen diario de 14 millones a 5,3 millones de filas, y el trigger de 4,8 ms a 1,2 ms. Cada UPDATE quedó en 10,4 ms en el p95. La ganancia vino casi toda de grabar menos, no de un truco de optimización.',
        },
      ],
    },
    {
      title: 'Partición mensual, índice BRIN y retención en capas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el volumen menor, lo que queda es organizar el historial por el único eje que tiene: el tiempo. Particionar la auditoría por mes hace que la escritura caiga siempre en la partición corriente, mantiene los índices de esa partición lo bastante pequeños para quedar en memoria y convierte la expiración en un DROP TABLE. Hay dos patrones de lectura, y cada uno recibe el índice correcto. El historial de un registro usa un índice compuesto por tabla, registro y fecha. La consulta por período usa BRIN, un índice que solo guarda el mínimo y el máximo de cada rango de páginas, y funciona aquí porque la escritura sigue el orden del tiempo. Ocupa megabytes en lugar de cientos de gigabytes.',
        },
        {
          type: 'code',
          value: particoesCode,
        },
        {
          type: 'list',
          items: [
            'Capa caliente: 12 meses en particiones dentro de la base, con los dos índices. Cubre las consultas de operación, soporte y la mayoría de las auditorías internas.',
            'Capa fría: meses vencidos exportados en CSV comprimido con zstd al almacenamiento de objetos, con conteo y checksum verificados antes de eliminar la partición. En el escenario, los 2,1 TB heredados se comprimieron a cerca de 240 GB.',
            'Consulta sobre lo frío: bajo demanda, cargando el archivo del mes en una base temporal. Es lenta a propósito, y el plazo de respuesta acordado con quien pide es parte de la política de retención.',
            'Inmutabilidad: la aplicación solo lee. El rol de mantenimiento que hace DETACH y DROP no es el rol de la aplicación, y todo DROP debe quedar registrado en un log fuera de la base.',
            'Las particiones futuras deben existir antes del primer día del mes. La rutina de creación y el cuidado con la partición predeterminada siguen lo que describe el artículo sobre particionamiento por fecha.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Un detalle de elección: la retención legal suele medirse en años, y la consulta rápida en meses. Mezclar las dos es lo que hizo que la tabla llegara a 2,1 TB. Separar el plazo de guarda del plazo de consulta es la decisión de producto que sostiene el resto de la ingeniería.',
        },
      ],
    },
    {
      title: 'Sacar la grabación del camino crítico con decodificación lógica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun reducido, el trigger todavía cuesta 1,2 ms y una escritura extra en cada escritura. Para la mayoría de los sistemas, es un precio razonable por la garantía más fuerte: el registro nace y muere junto con el cambio. Cuando la latencia de escritura es crítica o el volumen es muy alto, la alternativa es dejar que la base escriba solo lo que ya escribe, el WAL, y que un consumidor externo arme la auditoría a partir de él.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'code',
          value: decodificacaoCode,
        },
        {
          type: 'list',
          items: [
            'El costo sale del camino del usuario, pero la garantía se vuelve eventual: la auditoría llega con retraso, y el consumidor debe ser idempotente porque la entrega puede repetirse.',
            'REPLICA IDENTITY FULL es necesario para tener el valor antiguo en UPDATE y DELETE, y hace crecer el WAL. Actívalo solo en las tablas donde el "antes" importa.',
            'El slot de replicación retiene WAL mientras el consumidor esté detenido. Un consumidor caído por horas puede llenar el disco del servidor, así que monitorea el retraso del slot y define un límite con max_slot_wal_keep_size.',
            'El actor no está en el WAL. El mensaje lógico emitido por la aplicación dentro de la transacción lleva esa información hasta el consumidor, en el orden correcto.',
            'El cambio de esquema de la tabla auditada pasa a ser también un contrato con el consumidor, y una columna nueva debe tratarse en ambos lados.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La elección entre las dos formas es de riesgo, no de moda. Si perder un registro de auditoría es inaceptable y el presupuesto de latencia aguanta 1 ms, quédate con el trigger. Si la latencia de escritura es el cuello de botella medido y el negocio tolera segundos de retraso en la auditoría, la decodificación compensa el costo operativo.',
        },
      ],
    },
    {
      title: 'Migrar la tabla actual sin parar nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio no exige ventana. La tabla nueva nace al lado, el trigger nuevo pasa a grabar en ella, y la antigua envejece hasta caber en la política de retención. Lo que la aplicación ve durante la transición es una vista que une las dos.',
        },
        {
          type: 'ordered',
          items: [
            'Crea auditoria_v2, la función nueva y las particiones de los próximos meses. Nada cambia para quien escribe.',
            'Cambia el trigger tabla por tabla, empezando por las de menor riesgo, en una transacción corta con lock_timeout. El cambio de trigger pide un bloqueo breve en la tabla, y fallar por timeout es seguro: se reintenta.',
            'Durante una semana, compara por muestreo: para cada UPDATE auditado en las dos estructuras, el diff nuevo debe contener las mismas columnas que la diferencia entre antes y después del registro antiguo, menos las ruidosas.',
            'Crea una vista auditoria_historico que una la tabla antigua y la nueva, para que las pantallas y reportes existentes sigan funcionando sin cambios.',
            'Exporta y elimina la tabla antigua por rango de fecha, usando el mismo proceso de retiro. Si la antigua se particiona más adelante, el artículo sobre particionamiento por fecha muestra cómo convertirla en partición sin copiar filas.',
            'Documenta la política: qué se audita, qué columnas se ignoran y por qué, cuánto tiempo queda en línea, cuánto queda archivado y quién puede pedir una restauración.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El resultado en el escenario fue 330 GB en línea contra 2,1 TB, un backup 6 veces menor, la escritura de auditoría sin índice pesado y un UPDATE de pedidos en 10,4 ms en el p95. La auditoría mantuvo la misma garantía de antes: ningún cambio sin registro, y ningún registro sin cambio.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Guardar solo el diff no pierde información importante?',
      answer:
        'Pierde la foto completa de la fila en cada evento, pero se puede reconstruir: el INSERT guarda el estado inicial y cada UPDATE guarda lo que cambió, así que el estado en cualquier fecha es la aplicación ordenada de las diferencias. Para registros donde la reconstrucción debe ser instantánea, guarda una instantánea completa de tanto en tanto, por ejemplo en el cierre del mes. Lo que debe quedar fuera es solo el ruido que nadie consulta, y la lista de columnas ignoradas debe revisarse con quien usa la auditoría.',
    },
    {
      question: '¿pgaudit resuelve este problema?',
      answer:
        'Resuelve otro. pgaudit registra comandos SQL en el log del servidor, lo que sirve para el cumplimiento de acceso y la investigación de quién ejecutó qué, pero no responde "qué cambió en este registro entre las fechas X e Y" con una consulta directa. Para el historial de datos por registro, el trigger o la decodificación lógica entregan una tabla consultable. Los dos enfoques pueden convivir.',
    },
    {
      question: '¿Cómo garantizar que nadie altere o borre la auditoría?',
      answer:
        'En capas. El rol de la aplicación solo tiene SELECT en la tabla, y quien escribe es la función SECURITY DEFINER. El rol de mantenimiento que elimina particiones vencidas es aparte, con los DROP registrados fuera de la base. Para una exigencia más fuerte, guarda un hash encadenado por registro o exporta periódicamente los archivos comprimidos a un almacenamiento con bloqueo de eliminación. Ninguna de estas medidas reemplaza el acceso restringido a la base, pero hacen detectable la manipulación.',
    },
  ],
  conclusion: {
    title: 'Una buena auditoría registra lo que importa, organiza por tiempo y sabe cuándo olvidar',
    description:
      'La tabla de 2,1 TB no creció porque auditar sea caro, sino porque nadie decidió qué registrar, por cuánto tiempo consultar y dónde debe quedar cada edad del dato. Grabar solo lo que cambió redujo el volumen y el tiempo del trigger, la partición mensual con BRIN dejó la expiración en milisegundos, la capa fría sacó los años antiguos de la base, y la decodificación lógica quedó como salida para cuando la latencia de escritura sea el cuello de botella medido. La garantía es la misma, con una base menor y una escritura más rápida.',
    cta: 'Revisar la auditoría y el historial de datos de mi base',
  },
  related: [
    {
      label: 'La tabla que creció demasiado: particionar por fecha en Postgres sin reescribir la aplicación',
      to: '/blog/tabela-que-cresceu-demais-particionar-por-data-no-postgres-sem-reescrever-a-aplicacao',
    },
    {
      label: 'Autovacuum que no da abasto: cuando la tabla se hincha y la consulta se vuelve lenta sin cambiar nada',
      to: '/blog/autovacuum-que-nao-acompanha-tabela-incha-consulta-lenta-sem-mudar-nada',
    },
    {
      label: 'Servicio de arquitectura y modernización backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
