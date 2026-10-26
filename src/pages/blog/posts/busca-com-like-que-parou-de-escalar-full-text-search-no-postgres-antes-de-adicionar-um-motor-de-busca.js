// Conteudo do artigo: busca com LIKE que parou de escalar. Por que LIKE '%termo%' vira varredura
// sequencial, como o pg_trgm resolve busca por trecho e autocomplete, como montar full-text search
// no Postgres com tsvector, configuracao sem acento, pesos e indice GIN, como consultar e ranquear
// na aplicacao com fallback para erro de digitacao, como medir antes e depois e quando o Postgres
// deixa de bastar e chega a hora de um motor de busca dedicado.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const diagnosticoCode = `-- A busca atual: coringa dos dois lados, sem distinguir acento nem maiuscula.
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, nome, preco
FROM produtos
WHERE ativo
  AND (nome ILIKE '%' || 'parafuso inox' || '%' OR descricao ILIKE '%' || 'parafuso inox' || '%')
ORDER BY nome
LIMIT 20;

-- Resultado tipico com 4,2 milhoes de linhas:
--   Limit  (actual time=1793.402..1793.411 rows=20)
--     ->  Sort  (Sort Method: top-N heapsort)
--       ->  Seq Scan on produtos  (rows=11873)
--             Filter: (ativo AND ((nome ~~* '%parafuso inox%') OR (descricao ~~* '%parafuso inox%')))
--             Rows Removed by Filter: 4188127
--             Buffers: shared hit=48211 read=262904
-- O indice B-tree em nome nao serve: ele ordena pelo inicio do texto, e o coringa
-- a esquerda obriga a ler a tabela inteira. "inox parafuso" e "parafusos" nem encontram nada.`;

const trigramaCode = `-- 1. Trigramas: indice para LIKE/ILIKE com coringa em qualquer posicao.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CONCURRENTLY nao bloqueia escrita; demora mais e nao pode rodar dentro de transacao.
CREATE INDEX CONCURRENTLY produtos_nome_trgm_idx
  ON produtos USING gin (nome gin_trgm_ops);
CREATE INDEX CONCURRENTLY produtos_sku_trgm_idx
  ON produtos USING gin (sku gin_trgm_ops);

-- A mesma consulta de antes, agora usando o indice (Bitmap Index Scan).
SELECT id, nome, sku
FROM produtos
WHERE ativo AND (nome ILIKE '%' || $1 || '%' OR sku ILIKE '%' || $1 || '%')
LIMIT 20;

-- Tolerancia a erro de digitacao: o operador % usa o mesmo indice GIN.
SET pg_trgm.similarity_threshold = 0.35;
SELECT id, nome, similarity(nome, $1) AS parecido
FROM produtos
WHERE ativo AND nome % $1
ORDER BY parecido DESC
LIMIT 20;`;

const fullTextCode = `-- 2. Full-text search: palavras normalizadas, sem acento, com radical e peso por campo.
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Configuracao propria: tira acento antes do radical do portugues.
-- "Parafusos sextavados" e "parafuso sextavado" viram os mesmos lexemas.
CREATE TEXT SEARCH CONFIGURATION public.pt_sem_acento (COPY = pg_catalog.portuguese);
ALTER TEXT SEARCH CONFIGURATION public.pt_sem_acento
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, portuguese_stem;

-- Coluna mantida pela aplicacao (e nao GENERATED) para poder preencher em lotes,
-- sem reescrever a tabela de 4,2 milhoes de linhas com lock exclusivo.
ALTER TABLE produtos ADD COLUMN busca tsvector;

CREATE FUNCTION produtos_busca_atualizar() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.busca :=
    setweight(to_tsvector('public.pt_sem_acento', coalesce(NEW.nome, '')), 'A') ||
    setweight(to_tsvector('public.pt_sem_acento', coalesce(NEW.marca, '')), 'B') ||
    setweight(to_tsvector('public.pt_sem_acento', coalesce(NEW.descricao, '')), 'C');
  RETURN NEW;
END $$;

CREATE TRIGGER produtos_busca_trg
  BEFORE INSERT OR UPDATE OF nome, marca, descricao ON produtos
  FOR EACH ROW EXECUTE FUNCTION produtos_busca_atualizar();

-- Preenchimento em lotes de 5 mil ids (repetir avancando a faixa ate o maior id).
-- O UPDATE de nome = nome dispara o trigger sem mudar o dado.
UPDATE produtos SET nome = nome
WHERE id > 0 AND id <= 5000 AND busca IS NULL;

CREATE INDEX CONCURRENTLY produtos_busca_idx ON produtos USING gin (busca);

-- Consulta: websearch_to_tsquery aceita o que o usuario digita ("parafuso inox -zincado").
SELECT id, nome, marca, preco,
       ts_rank_cd(busca, consulta) AS relevancia
FROM produtos,
     websearch_to_tsquery('public.pt_sem_acento', $1) AS consulta
WHERE ativo AND busca @@ consulta
ORDER BY relevancia DESC, id
LIMIT 20;`;

const aplicacaoCode = `// busca-produtos.js
// Full-text primeiro; se nao achar nada, tenta por semelhanca (erro de digitacao).
// Cada consulta tem teto de tempo proprio: busca lenta nao pode segurar conexao do pool.
import pg from 'pg';

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

const SQL_FULL_TEXT = \`
  SELECT id, nome, marca, preco, ts_rank_cd(busca, consulta) AS relevancia
  FROM produtos, websearch_to_tsquery('public.pt_sem_acento', $1) AS consulta
  WHERE ativo AND busca @@ consulta
  ORDER BY relevancia DESC, id
  LIMIT $2\`;

const SQL_SEMELHANCA = \`
  SELECT id, nome, marca, preco, similarity(nome, $1) AS relevancia
  FROM produtos
  WHERE ativo AND nome % $1
  ORDER BY relevancia DESC, id
  LIMIT $2\`;

async function consultarComTeto(sql, params, tetoMs) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // SET LOCAL vale so para esta transacao: a conexao volta limpa para o pool.
    await client.query("SELECT set_config('statement_timeout', $1, true)", [String(tetoMs)]);
    await client.query("SELECT set_config('pg_trgm.similarity_threshold', '0.35', true)");
    const { rows } = await client.query(sql, params);
    await client.query('COMMIT');
    return rows;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}

export async function buscarProdutos(termoBruto, { limite = 20, tetoMs = 800 } = {}) {
  const termo = String(termoBruto ?? '').trim().slice(0, 120);
  if (termo.length < 2) return { modo: 'vazio', itens: [] };

  const porTexto = await consultarComTeto(SQL_FULL_TEXT, [termo, limite], tetoMs);
  if (porTexto.length > 0 || termo.length < 3) return { modo: 'full-text', itens: porTexto };

  // Trigrama precisa de pelo menos 3 caracteres para ter seletividade.
  const parecidos = await consultarComTeto(SQL_SEMELHANCA, [termo, limite], tetoMs);
  return { modo: parecidos.length > 0 ? 'semelhanca' : 'sem-resultado', itens: parecidos };
}`;

const diagramaPt = `Caminho de uma busca depois da mudança.

  usuário digita "parafuzo inox"
          |
          v
  buscarProdutos()  -- termo < 2 caracteres --> resposta vazia
          |
          v
  full-text: busca @@ websearch_to_tsquery('pt_sem_acento')   [índice GIN em busca]
          |
          +-- achou --> ordena por ts_rank_cd, LIMIT 20 --> resposta (modo full-text)
          |
          +-- 0 linhas --> semelhança: nome % termo           [índice GIN trigrama]
                                |
                                +-- achou --> "você quis dizer" (modo semelhança)
                                +-- nada  --> registra termo sem resultado para análise`;

const diagramaEn = `Path of a search after the change.

  user types "parafuzo inox"
          |
          v
  buscarProdutos()  -- term < 2 characters --> empty response
          |
          v
  full-text: busca @@ websearch_to_tsquery('pt_sem_acento')   [GIN index on busca]
          |
          +-- found --> order by ts_rank_cd, LIMIT 20 --> response (full-text mode)
          |
          +-- 0 rows --> similarity: nome % term              [trigram GIN index]
                                |
                                +-- found --> "did you mean" (similarity mode)
                                +-- none  --> log the term with no results for analysis`;

const diagramaEs = `Camino de una búsqueda después del cambio.

  el usuario escribe "parafuzo inox"
          |
          v
  buscarProdutos()  -- término < 2 caracteres --> respuesta vacía
          |
          v
  full-text: busca @@ websearch_to_tsquery('pt_sem_acento')   [índice GIN en busca]
          |
          +-- encontró --> ordena por ts_rank_cd, LIMIT 20 --> respuesta (modo full-text)
          |
          +-- 0 filas --> similitud: nome % término           [índice GIN de trigramas]
                                |
                                +-- encontró --> "quisiste decir" (modo similitud)
                                +-- nada     --> registra el término sin resultado para análisis`;

const pt = {
  intro:
    'Um e-commerce B2B de ferragens tem 4,2 milhões de produtos e uma caixa de busca que funcionou bem por três anos com um WHERE nome ILIKE \'%termo%\'. Na época eram 300 mil itens e a consulta levava 90 ms. Hoje o p99 da busca está em 1,8 segundo, a CPU do banco sobe 25 pontos a cada campanha e o time comercial reclama de outra coisa: quem procura "parafusos inox" não acha "Parafuso Inóx sextavado", e quem digita "parafuzo" recebe uma página vazia. A proposta na mesa é subir um Elasticsearch, com cluster, pipeline de sincronização e mais um sistema no plantão. Antes disso, o próprio Postgres resolve a maior parte do problema. Este artigo mostra por que o LIKE parou de escalar, como o pg_trgm resolve busca por trecho e autocomplete, como montar full-text search com configuração sem acento, pesos por campo e índice GIN sem travar a tabela, como consultar com fallback para erro de digitação, como medir o ganho e em que ponto um motor de busca dedicado passa a valer o custo.',
  sections: [
    {
      title: 'Por que o LIKE com coringa à esquerda vira varredura da tabela inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um índice B-tree guarda os valores ordenados pelo começo do texto. Ele resolve nome LIKE \'paraf%\', porque sabe onde começam as palavras que iniciam com "paraf". Ele não resolve nome LIKE \'%inox%\', porque "inox" pode estar em qualquer posição, e a única forma de saber é ler cada linha. Com 300 mil produtos, ler tudo cabia na memória e custava pouco. Com 4,2 milhões, a consulta lê 310 mil páginas, boa parte do disco, e expulsa do cache as páginas que as outras telas usavam.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'O tempo é só metade do problema. O LIKE compara caracteres, não palavras: não entende plural, não ignora acento, exige que os termos apareçam na ordem digitada e não tem noção de relevância. O resultado é ordenado por nome, então o produto que tem "parafuso inox" no título aparece misturado com o que só cita a expressão no meio da descrição. A busca é lenta e, ao mesmo tempo, ruim.',
        },
        {
          type: 'table',
          columns: ['Padrão de consulta', 'Usa B-tree comum?', 'O que acontece com milhões de linhas'],
          rows: [
            ["nome = 'Parafuso M8'", 'Sim', 'Busca pontual, milissegundos'],
            ["nome LIKE 'Paraf%'", 'Sim, com collation C ou text_pattern_ops', 'Varredura de faixa do índice, rápida'],
            ["nome LIKE '%inox%'", 'Não', 'Seq Scan: lê a tabela inteira a cada busca'],
            ["nome ILIKE '%inox%'", 'Não', 'Seq Scan e ainda converte maiúsculas linha a linha'],
            ["lower(nome) LIKE '%inox%'", 'Só com índice de expressão, e mesmo assim não', 'Seq Scan, o coringa à esquerda continua impedindo'],
          ],
        },
      ],
    },
    {
      title: 'Primeiro passo: trigramas para busca por trecho, SKU e autocomplete',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A extensão pg_trgm quebra o texto em trigramas, sequências de três caracteres, e indexa cada uma num índice GIN. Para responder \'%inox%\', o banco procura as linhas que contêm os trigramas de "inox" e só depois confere o padrão nelas. Não é preciso mudar a consulta: o mesmo ILIKE passa a usar o índice. É a correção certa quando o que o usuário procura é um trecho literal, como código de produto, SKU, número de pedido ou o começo de um nome no autocomplete.',
        },
        {
          type: 'code',
          value: trigramaCode,
        },
        {
          type: 'list',
          items: [
            'Termos com menos de 3 caracteres geram poucos trigramas e o índice deixa de filtrar. Exija pelo menos 3 caracteres no autocomplete.',
            'O índice GIN de trigramas costuma ficar entre 1 e 3 vezes o tamanho da coluna. Para 4,2 milhões de nomes curtos, foram 410 MB.',
            'O operador % (semelhança) também usa o índice e resolve erro de digitação: "parafuzo" encontra "parafuso" com similaridade acima de 0,35.',
            'Ordenar por distância com <-> só usa índice GiST, não GIN. Com GIN, filtre com % e ordene por similarity() dentro do LIMIT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trigrama resolve a lentidão, mas não resolve a qualidade. "Parafusos inox" continua sem achar "Parafuso Inóx", porque plural e acento mudam os trigramas, e a ordem das palavras ainda importa. Para buscar por significado de palavra, e não por trecho de caracteres, o recurso certo é o full-text search.',
        },
      ],
    },
    {
      title: 'Full-text search no Postgres: tsvector, configuração sem acento e pesos por campo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O full-text search transforma o texto em um tsvector, uma lista de lexemas normalizados com posição: "Parafusos Inóx sextavados" vira algo como \'inox\':2 \'parafus\':1 \'sextav\':3. A consulta vira um tsquery normalizado da mesma forma, e o operador @@ responde se o documento contém os termos, em qualquer ordem e flexão. O índice GIN sobre o tsvector torna isso uma busca em índice invertido, o mesmo princípio de um motor de busca.',
        },
        {
          type: 'paragraph',
          value:
            'Três decisões fazem a diferença entre uma busca que funciona em português e uma que frustra. A primeira é a configuração: a portuguese padrão não remove acento, então criamos uma cópia que passa o texto pelo dicionário unaccent antes do radical. A segunda é o peso: um termo no nome (A) vale mais do que na marca (B), que vale mais do que na descrição (C), e o ts_rank_cd usa esses pesos para ordenar. A terceira é a forma de criar a coluna: uma coluna GENERATED ALWAYS reescreve a tabela inteira com lock exclusivo, o que em 4,2 milhões de linhas é uma janela de manutenção. Uma coluna comum mantida por trigger pode ser preenchida em lotes, com a loja no ar.',
        },
        {
          type: 'code',
          value: fullTextCode,
        },
        {
          type: 'paragraph',
          value:
            'O websearch_to_tsquery é o que permite colocar a entrada do usuário direto na consulta sem erro de sintaxe: ele aceita aspas para frase exata, OR e o sinal de menos para excluir, e ignora o resto. O to_tsquery, ao contrário, exige operadores explícitos e lança erro com uma entrada como "parafuso inox", o que vira 500 na API. Também vale registrar os termos que retornaram zero resultados: essa lista mostra sinônimos que faltam e produtos mal cadastrados melhor do que qualquer métrica de latência.',
        },
      ],
    },
    {
      title: 'Na aplicação: full-text primeiro, semelhança como plano B e teto de tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois índices se complementam. O full-text resolve a maioria das buscas por palavra, com relevância. Quando ele não acha nada, quase sempre é erro de digitação ou termo que não existe no catálogo, e é aí que a semelhança por trigrama entra, como um "você quis dizer". A função abaixo encapsula essa ordem, limita o tamanho do termo e aplica um statement_timeout local por consulta, para que uma busca patológica nunca segure uma conexão do pool por segundos.',
        },
        {
          type: 'code',
          value: aplicacaoCode,
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O set_config com terceiro argumento true equivale a SET LOCAL: o valor morre no fim da transação, então a conexão volta ao pool com os padrões originais. Sem isso, um SET comum vazaria o timeout curto para a próxima requisição que pegasse a mesma conexão, como um relatório que precisa de mais tempo.',
        },
      ],
    },
    {
      title: 'Medir antes e depois, e as armadilhas que aparecem em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A troca precisa de número, e não só de sensação. Rode EXPLAIN (ANALYZE, BUFFERS) com os 50 termos mais buscados do último mês, antes e depois, e acompanhe o p99 da rota de busca e o total de buffers lidos pelo banco. No caso do e-commerce de ferragens, o resultado foi este:',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'p99 da busca', 'Buffers por consulta', 'Acha plural e sem acento?', 'Ordena por relevância?'],
          rows: [
            ['ILIKE sem índice', '1.800 ms', '~310.000', 'Não', 'Não'],
            ['ILIKE com GIN de trigramas', '45 ms', '~1.900', 'Não', 'Não'],
            ['Full-text com GIN e pesos', '14 ms', '~600', 'Sim', 'Sim'],
            ['Full-text, termo muito comum ("parafuso")', '230 ms', '~21.000', 'Sim', 'Sim, mas calcula o ranking de 180 mil linhas'],
          ],
        },
        {
          type: 'list',
          items: [
            'Termo muito comum: o ranking é calculado para todas as linhas que casam antes do LIMIT. Combine com um filtro seletivo (categoria, ativo, estoque) ou limite os candidatos numa subconsulta antes de ranquear, aceitando ranking aproximado.',
            'Lista pendente do GIN: com fastupdate ligado, as escritas entram numa lista não indexada que a busca precisa varrer. Em catálogo com importação em massa, ajuste gin_pending_list_limit ou rode VACUUM depois da carga.',
            'Mudou a configuração de texto: o tsvector gravado não se recalcula sozinho. Qualquer mudança em dicionário ou pesos exige reprocessar a coluna em lotes.',
            'Stopwords: "de", "para" e "com" são descartadas. Uma busca só por stopwords volta vazia, então trate esse caso na interface em vez de mostrar "nenhum produto".',
            'Idioma: um catálogo em mais de um idioma precisa de uma coluna de configuração por linha, ou de um tsvector por idioma, porque o radical do português estraga palavras em espanhol.',
          ],
        },
      ],
    },
    {
      title: 'Quando o Postgres deixa de bastar e um motor de busca passa a valer o custo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Elasticsearch, OpenSearch, Meilisearch e Typesense são ótimos, mas trazem um segundo armazenamento que precisa ser sincronizado, consistência eventual entre o que foi salvo e o que aparece na busca, outro cluster para dimensionar e outro ponto de falha no plantão. A troca vale quando a busca deixou de ser uma funcionalidade e virou o produto, e não quando o LIKE ficou lento.',
        },
        {
          type: 'table',
          columns: ['Necessidade', 'Postgres resolve bem?', 'Sinal de que é hora do motor dedicado'],
          rows: [
            ['Busca por palavra com relevância, plural e acento', 'Sim, com full-text e GIN', 'Raramente é o motivo da troca'],
            ['Tolerância a erro de digitação', 'Parcial, com trigrama como plano B', 'Erro de digitação precisa funcionar em toda busca, não só quando o full-text não acha nada'],
            ['Facetas com contagem (marca, faixa de preço, atributo)', 'Com custo: um GROUP BY por faceta', 'Dezenas de facetas dinâmicas recalculadas a cada tecla'],
            ['Sinônimos e regras de negócio na relevância', 'Limitado: dicionário de sinônimos estático', 'Time de produto ajustando relevância toda semana, com boost por estoque, margem ou clique'],
            ['Volume e carga', 'Dezenas de milhões de documentos com busca seletiva', 'Busca concorrendo com a carga transacional mesmo depois de ir para uma réplica de leitura'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Meça o p99 da busca e os buffers lidos com os termos mais frequentes antes de mexer em qualquer coisa.',
            'Crie índices GIN de trigramas com CONCURRENTLY para SKU, código e autocomplete.',
            'Crie a configuração sem acento e a coluna tsvector com pesos, preenchida por trigger e em lotes.',
            'Troque a consulta para websearch_to_tsquery com ts_rank_cd e mantenha a semelhança por trigrama como plano B.',
            'Aplique statement_timeout local na rota de busca e registre os termos sem resultado.',
            'Só considere um motor dedicado quando facetas, sinônimos ou relevância ajustável virarem requisito recorrente, e planeje a migração com consulta ligada.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Trigrama ou full-text: qual eu crio primeiro?',
      answer:
        'Depende do que o usuário digita. Se a busca é por código, SKU, placa, e-mail ou trecho literal, o trigrama resolve sozinho e não muda a consulta. Se a busca é por palavras em linguagem natural, como nome e descrição de produto, o full-text é o que traz plural, acento e relevância. Em catálogo de produto, quase sempre vale ter os dois: full-text para a busca principal e trigrama para autocomplete e erro de digitação.',
    },
    {
      question: 'Criar o índice GIN vai travar a tabela em produção?',
      answer:
        'Com CREATE INDEX CONCURRENTLY, não bloqueia leitura nem escrita, mas demora mais, faz duas passadas na tabela e não pode rodar dentro de uma transação. Se ele falhar no meio, fica um índice marcado como inválido, que precisa ser removido com DROP INDEX CONCURRENTLY antes de tentar de novo. O que trava de verdade é adicionar uma coluna GENERATED STORED, porque reescreve a tabela inteira; por isso a coluna tsvector é comum e preenchida em lotes por trigger.',
    },
    {
      question: 'O full-text do Postgres serve para busca em vários idiomas?',
      answer:
        'Serve, desde que cada documento seja processado com a configuração do próprio idioma. Guarde o idioma em uma coluna e use to_tsvector com essa configuração no trigger, ou mantenha um tsvector por idioma quando o mesmo produto tem textos traduzidos. Na consulta, use a configuração do idioma do usuário. Misturar tudo numa configuração só faz o radical de um idioma estragar as palavras do outro, e a busca perde resultados sem dar erro.',
    },
  ],
  conclusion: {
    title: 'Antes de adicionar um motor de busca, use o índice que o banco já tem',
    description:
      'O LIKE com coringa à esquerda não usa índice B-tree e lê a tabela inteira a cada busca, o que funciona com 300 mil linhas e derruba o p99 com 4 milhões. O pg_trgm com GIN resolve busca por trecho, SKU e autocomplete sem mudar a consulta. O full-text search com configuração sem acento, pesos por campo, coluna tsvector preenchida em lotes e índice GIN resolve plural, acento e relevância, e o websearch_to_tsquery aceita a entrada do usuário sem erro de sintaxe. Com semelhança como plano B, teto de tempo por consulta e medição antes e depois, a busca cai de 1,8 segundo para dezenas de milissegundos. O motor de busca dedicado entra quando facetas, sinônimos e relevância ajustável viram requisito do produto, e não antes.',
    cta: 'Revisar a busca e o banco do meu sistema',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Migração de índice de busca sem janela: trocar o motor com consulta ligada',
      to: '/blog/migracao-indice-busca-sem-janela-trocar-motor-com-consulta-ligada',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B hardware e-commerce has 4.2 million products and a search box that worked well for three years with WHERE nome ILIKE \'%term%\'. Back then there were 300 thousand items and the query took 90 ms. Today the search p99 is 1.8 seconds, database CPU rises 25 points on every campaign, and the sales team complains about something else: whoever searches for "parafusos inox" does not find "Parafuso Inóx sextavado", and whoever types "parafuzo" gets an empty page. The proposal on the table is to stand up Elasticsearch, with a cluster, a sync pipeline and one more system on call. Before that, Postgres itself solves most of the problem. This article shows why LIKE stopped scaling, how pg_trgm handles substring search and autocomplete, how to build full-text search with an accent-insensitive configuration, per-field weights and a GIN index without locking the table, how to query with a fallback for typos, how to measure the gain, and at what point a dedicated search engine becomes worth its cost.',
  sections: [
    {
      title: 'Why LIKE with a leading wildcard turns into a full table scan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A B-tree index stores values sorted by the start of the text. It handles nome LIKE \'paraf%\', because it knows where the words starting with "paraf" begin. It does not handle nome LIKE \'%inox%\', because "inox" can be anywhere, and the only way to know is to read every row. With 300 thousand products, reading everything fit in memory and cost little. With 4.2 million, the query reads 310 thousand pages, much of it from disk, and evicts from the cache the pages other screens were using.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'Time is only half the problem. LIKE compares characters, not words: it does not understand plurals, does not ignore accents, requires the terms to appear in the typed order and has no notion of relevance. Results are sorted by name, so the product with "parafuso inox" in the title is mixed with one that only mentions the phrase in the middle of its description. The search is slow and bad at the same time.',
        },
        {
          type: 'table',
          columns: ['Query pattern', 'Uses a regular B-tree?', 'What happens with millions of rows'],
          rows: [
            ["nome = 'Parafuso M8'", 'Yes', 'Point lookup, milliseconds'],
            ["nome LIKE 'Paraf%'", 'Yes, with C collation or text_pattern_ops', 'Index range scan, fast'],
            ["nome LIKE '%inox%'", 'No', 'Seq Scan: reads the whole table on every search'],
            ["nome ILIKE '%inox%'", 'No', 'Seq Scan, plus case folding row by row'],
            ["lower(nome) LIKE '%inox%'", 'Only with an expression index, and even then no', 'Seq Scan, the leading wildcard still prevents it'],
          ],
        },
      ],
    },
    {
      title: 'First step: trigrams for substring search, SKUs and autocomplete',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The pg_trgm extension splits text into trigrams, sequences of three characters, and indexes each one in a GIN index. To answer \'%inox%\', the database looks up the rows containing the trigrams of "inox" and only then checks the pattern on them. The query does not need to change: the same ILIKE starts using the index. It is the right fix when what the user searches for is a literal fragment, such as a product code, SKU, order number or the beginning of a name in autocomplete.',
        },
        {
          type: 'code',
          value: trigramaCode,
        },
        {
          type: 'list',
          items: [
            'Terms shorter than 3 characters produce few trigrams and the index stops filtering. Require at least 3 characters in autocomplete.',
            'A trigram GIN index is usually 1 to 3 times the size of the column. For 4.2 million short names, it was 410 MB.',
            'The % (similarity) operator also uses the index and handles typos: "parafuzo" finds "parafuso" with similarity above 0.35.',
            'Ordering by distance with <-> only uses a GiST index, not GIN. With GIN, filter with % and order by similarity() within the LIMIT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Trigrams fix the slowness, but not the quality. "Parafusos inox" still does not find "Parafuso Inóx", because plurals and accents change the trigrams, and word order still matters. To search by word meaning rather than by character fragments, the right tool is full-text search.',
        },
      ],
    },
    {
      title: 'Full-text search in Postgres: tsvector, an accent-free configuration and per-field weights',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Full-text search turns text into a tsvector, a list of normalized lexemes with positions: "Parafusos Inóx sextavados" becomes something like \'inox\':2 \'parafus\':1 \'sextav\':3. The query becomes a tsquery normalized the same way, and the @@ operator answers whether the document contains the terms, in any order and inflection. A GIN index over the tsvector makes this an inverted index lookup, the same principle a search engine uses.',
        },
        {
          type: 'paragraph',
          value:
            'Three decisions separate a search that works in Portuguese from one that frustrates. The first is the configuration: the default portuguese configuration does not strip accents, so we create a copy that runs text through the unaccent dictionary before stemming. The second is weighting: a term in the name (A) is worth more than in the brand (B), which is worth more than in the description (C), and ts_rank_cd uses those weights to rank. The third is how the column is created: a GENERATED ALWAYS column rewrites the whole table under an exclusive lock, which for 4.2 million rows means a maintenance window. A regular column maintained by a trigger can be backfilled in batches while the store stays online.',
        },
        {
          type: 'code',
          value: fullTextCode,
        },
        {
          type: 'paragraph',
          value:
            'websearch_to_tsquery is what lets you put user input straight into the query without syntax errors: it accepts quotes for exact phrases, OR and a minus sign to exclude, and ignores everything else. to_tsquery, by contrast, requires explicit operators and throws on input like "parafuso inox", which becomes a 500 in the API. It is also worth logging the terms that returned zero results: that list reveals missing synonyms and badly registered products better than any latency metric.',
        },
      ],
    },
    {
      title: 'In the application: full-text first, similarity as plan B, and a time ceiling',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two indexes complement each other. Full-text handles most word searches, with relevance. When it finds nothing, it is almost always a typo or a term that does not exist in the catalog, and that is where trigram similarity comes in, as a "did you mean". The function below encapsulates that order, caps the term length and applies a local statement_timeout per query, so a pathological search never holds a pool connection for seconds.',
        },
        {
          type: 'code',
          value: aplicacaoCode,
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'set_config with true as the third argument is equivalent to SET LOCAL: the value dies at the end of the transaction, so the connection returns to the pool with its original defaults. Without it, a plain SET would leak the short timeout to the next request that picked up the same connection, such as a report that needs more time.',
        },
      ],
    },
    {
      title: 'Measure before and after, and the traps that show up in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The change needs numbers, not just a feeling. Run EXPLAIN (ANALYZE, BUFFERS) with the 50 most searched terms of the last month, before and after, and track the p99 of the search route and the total buffers read by the database. For the hardware e-commerce, this was the result:',
        },
        {
          type: 'table',
          columns: ['Approach', 'Search p99', 'Buffers per query', 'Handles plurals and accents?', 'Ranks by relevance?'],
          rows: [
            ['ILIKE without an index', '1,800 ms', '~310,000', 'No', 'No'],
            ['ILIKE with a trigram GIN index', '45 ms', '~1,900', 'No', 'No'],
            ['Full-text with GIN and weights', '14 ms', '~600', 'Yes', 'Yes'],
            ['Full-text, very common term ("parafuso")', '230 ms', '~21,000', 'Yes', 'Yes, but ranks 180 thousand rows'],
          ],
        },
        {
          type: 'list',
          items: [
            'Very common term: the rank is computed for every matching row before the LIMIT. Combine it with a selective filter (category, active, in stock) or cap the candidates in a subquery before ranking, accepting an approximate ranking.',
            'GIN pending list: with fastupdate on, writes go into an unindexed list that searches must scan. In catalogs with bulk imports, tune gin_pending_list_limit or run VACUUM after the load.',
            'Changed the text configuration: the stored tsvector does not recompute itself. Any change to dictionaries or weights requires reprocessing the column in batches.',
            'Stopwords: "de", "para" and "com" are discarded. A search made only of stopwords comes back empty, so handle that case in the interface instead of showing "no products".',
            'Language: a catalog in more than one language needs a per-row configuration column, or one tsvector per language, because the Portuguese stemmer mangles Spanish words.',
          ],
        },
      ],
    },
    {
      title: 'When Postgres is no longer enough and a search engine becomes worth the cost',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Elasticsearch, OpenSearch, Meilisearch and Typesense are excellent, but they bring a second store that has to be kept in sync, eventual consistency between what was saved and what shows up in search, another cluster to size and another point of failure on call. The switch pays off when search stops being a feature and becomes the product, not when LIKE got slow.',
        },
        {
          type: 'table',
          columns: ['Need', 'Does Postgres handle it well?', 'Sign it is time for a dedicated engine'],
          rows: [
            ['Word search with relevance, plurals and accents', 'Yes, with full-text and GIN', 'Rarely the reason to switch'],
            ['Typo tolerance', 'Partly, with trigrams as plan B', 'Typos must work on every search, not only when full-text finds nothing'],
            ['Facets with counts (brand, price range, attribute)', 'At a cost: one GROUP BY per facet', 'Dozens of dynamic facets recomputed on every keystroke'],
            ['Synonyms and business rules in relevance', 'Limited: a static synonym dictionary', 'Product team tuning relevance every week, boosting by stock, margin or clicks'],
            ['Volume and load', 'Tens of millions of documents with selective searches', 'Search competing with transactional load even after moving to a read replica'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Measure the search p99 and the buffers read with the most frequent terms before touching anything.',
            'Create trigram GIN indexes with CONCURRENTLY for SKUs, codes and autocomplete.',
            'Create the accent-free configuration and the weighted tsvector column, filled by a trigger and in batches.',
            'Switch the query to websearch_to_tsquery with ts_rank_cd and keep trigram similarity as plan B.',
            'Apply a local statement_timeout on the search route and log terms with no results.',
            'Only consider a dedicated engine when facets, synonyms or tunable relevance become a recurring requirement, and plan the migration with queries running.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Trigrams or full-text: which one do I create first?',
      answer:
        'It depends on what the user types. If search is by code, SKU, plate, email or a literal fragment, trigrams solve it alone without changing the query. If search is by natural language words, such as product names and descriptions, full-text is what brings plurals, accents and relevance. In a product catalog it is almost always worth having both: full-text for the main search and trigrams for autocomplete and typos.',
    },
    {
      question: 'Will creating the GIN index lock the table in production?',
      answer:
        'With CREATE INDEX CONCURRENTLY, it blocks neither reads nor writes, but it takes longer, makes two passes over the table and cannot run inside a transaction. If it fails midway, it leaves an index marked as invalid, which must be removed with DROP INDEX CONCURRENTLY before trying again. What really locks is adding a GENERATED STORED column, because it rewrites the whole table; that is why the tsvector column is a regular one, backfilled in batches by a trigger.',
    },
    {
      question: 'Does Postgres full-text search work for multiple languages?',
      answer:
        'It does, as long as each document is processed with its own language\'s configuration. Store the language in a column and use to_tsvector with that configuration in the trigger, or keep one tsvector per language when the same product has translated texts. At query time, use the configuration of the user\'s language. Mixing everything in a single configuration makes one language\'s stemmer mangle the other\'s words, and the search loses results without raising any error.',
    },
  ],
  conclusion: {
    title: 'Before adding a search engine, use the index the database already has',
    description:
      'LIKE with a leading wildcard does not use a B-tree index and reads the whole table on every search, which works with 300 thousand rows and wrecks the p99 with 4 million. pg_trgm with GIN handles substring search, SKUs and autocomplete without changing the query. Full-text search with an accent-free configuration, per-field weights, a tsvector column backfilled in batches and a GIN index handles plurals, accents and relevance, and websearch_to_tsquery accepts user input without syntax errors. With similarity as plan B, a time ceiling per query and measurement before and after, search drops from 1.8 seconds to tens of milliseconds. A dedicated search engine comes in when facets, synonyms and tunable relevance become product requirements, not before.',
    cta: 'Review the search and database of my system',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Search index migration with no window: swapping the engine with queries running',
      to: '/blog/migracao-indice-busca-sem-janela-trocar-motor-com-consulta-ligada',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un e-commerce B2B de ferretería tiene 4,2 millones de productos y una caja de búsqueda que funcionó bien durante tres años con un WHERE nome ILIKE \'%término%\'. En aquella época eran 300 mil artículos y la consulta tardaba 90 ms. Hoy el p99 de la búsqueda está en 1,8 segundos, la CPU de la base sube 25 puntos en cada campaña y el equipo comercial se queja de otra cosa: quien busca "parafusos inox" no encuentra "Parafuso Inóx sextavado", y quien escribe "parafuzo" recibe una página vacía. La propuesta sobre la mesa es levantar un Elasticsearch, con clúster, pipeline de sincronización y un sistema más en la guardia. Antes de eso, el propio Postgres resuelve la mayor parte del problema. Este artículo muestra por qué el LIKE dejó de escalar, cómo pg_trgm resuelve la búsqueda por fragmento y el autocompletado, cómo montar full-text search con una configuración sin acentos, pesos por campo e índice GIN sin bloquear la tabla, cómo consultar con un respaldo para errores de tipeo, cómo medir la ganancia y en qué punto un motor de búsqueda dedicado empieza a valer su costo.',
  sections: [
    {
      title: 'Por qué el LIKE con comodín a la izquierda se convierte en un recorrido de toda la tabla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un índice B-tree guarda los valores ordenados por el inicio del texto. Resuelve nome LIKE \'paraf%\', porque sabe dónde empiezan las palabras que comienzan con "paraf". No resuelve nome LIKE \'%inox%\', porque "inox" puede estar en cualquier posición, y la única forma de saberlo es leer cada fila. Con 300 mil productos, leer todo cabía en memoria y costaba poco. Con 4,2 millones, la consulta lee 310 mil páginas, buena parte desde disco, y expulsa de la caché las páginas que usaban las demás pantallas.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'El tiempo es solo la mitad del problema. LIKE compara caracteres, no palabras: no entiende plurales, no ignora acentos, exige que los términos aparezcan en el orden escrito y no tiene noción de relevancia. El resultado se ordena por nombre, así que el producto que tiene "parafuso inox" en el título aparece mezclado con el que solo menciona la expresión en medio de la descripción. La búsqueda es lenta y, al mismo tiempo, mala.',
        },
        {
          type: 'table',
          columns: ['Patrón de consulta', '¿Usa un B-tree común?', 'Qué pasa con millones de filas'],
          rows: [
            ["nome = 'Parafuso M8'", 'Sí', 'Búsqueda puntual, milisegundos'],
            ["nome LIKE 'Paraf%'", 'Sí, con collation C o text_pattern_ops', 'Recorrido de rango del índice, rápido'],
            ["nome LIKE '%inox%'", 'No', 'Seq Scan: lee la tabla entera en cada búsqueda'],
            ["nome ILIKE '%inox%'", 'No', 'Seq Scan y además convierte mayúsculas fila por fila'],
            ["lower(nome) LIKE '%inox%'", 'Solo con índice de expresión, y aun así no', 'Seq Scan, el comodín a la izquierda lo sigue impidiendo'],
          ],
        },
      ],
    },
    {
      title: 'Primer paso: trigramas para búsqueda por fragmento, SKU y autocompletado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La extensión pg_trgm divide el texto en trigramas, secuencias de tres caracteres, e indexa cada una en un índice GIN. Para responder \'%inox%\', la base busca las filas que contienen los trigramas de "inox" y solo después verifica el patrón en ellas. No hace falta cambiar la consulta: el mismo ILIKE pasa a usar el índice. Es la corrección adecuada cuando lo que el usuario busca es un fragmento literal, como un código de producto, SKU, número de pedido o el comienzo de un nombre en el autocompletado.',
        },
        {
          type: 'code',
          value: trigramaCode,
        },
        {
          type: 'list',
          items: [
            'Los términos con menos de 3 caracteres generan pocos trigramas y el índice deja de filtrar. Exige al menos 3 caracteres en el autocompletado.',
            'El índice GIN de trigramas suele ocupar entre 1 y 3 veces el tamaño de la columna. Para 4,2 millones de nombres cortos, fueron 410 MB.',
            'El operador % (similitud) también usa el índice y resuelve errores de tipeo: "parafuzo" encuentra "parafuso" con similitud superior a 0,35.',
            'Ordenar por distancia con <-> solo usa un índice GiST, no GIN. Con GIN, filtra con % y ordena por similarity() dentro del LIMIT.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los trigramas resuelven la lentitud, pero no la calidad. "Parafusos inox" sigue sin encontrar "Parafuso Inóx", porque el plural y el acento cambian los trigramas, y el orden de las palabras todavía importa. Para buscar por el significado de las palabras, y no por fragmentos de caracteres, la herramienta adecuada es el full-text search.',
        },
      ],
    },
    {
      title: 'Full-text search en Postgres: tsvector, configuración sin acentos y pesos por campo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El full-text search transforma el texto en un tsvector, una lista de lexemas normalizados con posición: "Parafusos Inóx sextavados" se convierte en algo como \'inox\':2 \'parafus\':1 \'sextav\':3. La consulta se convierte en un tsquery normalizado de la misma forma, y el operador @@ responde si el documento contiene los términos, en cualquier orden y flexión. El índice GIN sobre el tsvector lo convierte en una búsqueda en índice invertido, el mismo principio de un motor de búsqueda.',
        },
        {
          type: 'paragraph',
          value:
            'Tres decisiones marcan la diferencia entre una búsqueda que funciona en portugués y una que frustra. La primera es la configuración: la portuguese por defecto no quita acentos, así que creamos una copia que pasa el texto por el diccionario unaccent antes de la raíz. La segunda es el peso: un término en el nombre (A) vale más que en la marca (B), que vale más que en la descripción (C), y ts_rank_cd usa esos pesos para ordenar. La tercera es la forma de crear la columna: una columna GENERATED ALWAYS reescribe toda la tabla con un lock exclusivo, lo que con 4,2 millones de filas significa una ventana de mantenimiento. Una columna común mantenida por trigger puede llenarse por lotes, con la tienda en línea.',
        },
        {
          type: 'code',
          value: fullTextCode,
        },
        {
          type: 'paragraph',
          value:
            'websearch_to_tsquery es lo que permite poner la entrada del usuario directamente en la consulta sin errores de sintaxis: acepta comillas para frase exacta, OR y el signo menos para excluir, e ignora el resto. to_tsquery, en cambio, exige operadores explícitos y lanza un error con una entrada como "parafuso inox", lo que se convierte en un 500 en la API. También conviene registrar los términos que devolvieron cero resultados: esa lista revela sinónimos que faltan y productos mal cargados mejor que cualquier métrica de latencia.',
        },
      ],
    },
    {
      title: 'En la aplicación: full-text primero, similitud como plan B y un techo de tiempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Los dos índices se complementan. El full-text resuelve la mayoría de las búsquedas por palabra, con relevancia. Cuando no encuentra nada, casi siempre es un error de tipeo o un término que no existe en el catálogo, y ahí entra la similitud por trigramas, como un "quisiste decir". La función siguiente encapsula ese orden, limita el tamaño del término y aplica un statement_timeout local por consulta, para que una búsqueda patológica nunca retenga una conexión del pool durante segundos.',
        },
        {
          type: 'code',
          value: aplicacaoCode,
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'set_config con true como tercer argumento equivale a SET LOCAL: el valor muere al final de la transacción, así que la conexión vuelve al pool con sus valores originales. Sin eso, un SET común filtraría el timeout corto a la siguiente petición que tomara la misma conexión, como un reporte que necesita más tiempo.',
        },
      ],
    },
    {
      title: 'Medir antes y después, y las trampas que aparecen en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El cambio necesita números, no solo una sensación. Ejecuta EXPLAIN (ANALYZE, BUFFERS) con los 50 términos más buscados del último mes, antes y después, y sigue el p99 de la ruta de búsqueda y el total de buffers leídos por la base. En el caso del e-commerce de ferretería, el resultado fue este:',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'p99 de la búsqueda', 'Buffers por consulta', '¿Encuentra plurales y sin acento?', '¿Ordena por relevancia?'],
          rows: [
            ['ILIKE sin índice', '1.800 ms', '~310.000', 'No', 'No'],
            ['ILIKE con GIN de trigramas', '45 ms', '~1.900', 'No', 'No'],
            ['Full-text con GIN y pesos', '14 ms', '~600', 'Sí', 'Sí'],
            ['Full-text, término muy común ("parafuso")', '230 ms', '~21.000', 'Sí', 'Sí, pero calcula el ranking de 180 mil filas'],
          ],
        },
        {
          type: 'list',
          items: [
            'Término muy común: el ranking se calcula para todas las filas que coinciden antes del LIMIT. Combínalo con un filtro selectivo (categoría, activo, stock) o limita los candidatos en una subconsulta antes de ordenar, aceptando un ranking aproximado.',
            'Lista pendiente del GIN: con fastupdate activado, las escrituras entran en una lista no indexada que la búsqueda tiene que recorrer. En catálogos con importaciones masivas, ajusta gin_pending_list_limit o ejecuta VACUUM después de la carga.',
            'Cambió la configuración de texto: el tsvector guardado no se recalcula solo. Cualquier cambio de diccionario o de pesos exige reprocesar la columna por lotes.',
            'Stopwords: "de", "para" y "com" se descartan. Una búsqueda hecha solo de stopwords vuelve vacía, así que trata ese caso en la interfaz en lugar de mostrar "ningún producto".',
            'Idioma: un catálogo en más de un idioma necesita una columna de configuración por fila, o un tsvector por idioma, porque la raíz del portugués estropea palabras en español.',
          ],
        },
      ],
    },
    {
      title: 'Cuándo Postgres deja de bastar y un motor de búsqueda empieza a valer su costo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Elasticsearch, OpenSearch, Meilisearch y Typesense son excelentes, pero traen un segundo almacenamiento que hay que sincronizar, consistencia eventual entre lo que se guardó y lo que aparece en la búsqueda, otro clúster que dimensionar y otro punto de falla en la guardia. El cambio vale la pena cuando la búsqueda deja de ser una funcionalidad y se convierte en el producto, no cuando el LIKE se volvió lento.',
        },
        {
          type: 'table',
          columns: ['Necesidad', '¿Postgres lo resuelve bien?', 'Señal de que es hora del motor dedicado'],
          rows: [
            ['Búsqueda por palabra con relevancia, plurales y acentos', 'Sí, con full-text y GIN', 'Rara vez es el motivo del cambio'],
            ['Tolerancia a errores de tipeo', 'En parte, con trigramas como plan B', 'Los errores de tipeo deben funcionar en toda búsqueda, no solo cuando el full-text no encuentra nada'],
            ['Facetas con conteo (marca, rango de precio, atributo)', 'Con costo: un GROUP BY por faceta', 'Decenas de facetas dinámicas recalculadas en cada tecla'],
            ['Sinónimos y reglas de negocio en la relevancia', 'Limitado: un diccionario de sinónimos estático', 'Equipo de producto ajustando la relevancia cada semana, con boost por stock, margen o clics'],
            ['Volumen y carga', 'Decenas de millones de documentos con búsquedas selectivas', 'La búsqueda compite con la carga transaccional incluso después de ir a una réplica de lectura'],
          ],
        },
        {
          type: 'ordered',
          items: [
            'Mide el p99 de la búsqueda y los buffers leídos con los términos más frecuentes antes de tocar nada.',
            'Crea índices GIN de trigramas con CONCURRENTLY para SKU, códigos y autocompletado.',
            'Crea la configuración sin acentos y la columna tsvector con pesos, llenada por trigger y por lotes.',
            'Cambia la consulta a websearch_to_tsquery con ts_rank_cd y mantén la similitud por trigramas como plan B.',
            'Aplica un statement_timeout local en la ruta de búsqueda y registra los términos sin resultado.',
            'Considera un motor dedicado solo cuando facetas, sinónimos o relevancia ajustable se vuelvan un requisito recurrente, y planifica la migración con consultas activas.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Trigramas o full-text: ¿cuál creo primero?',
      answer:
        'Depende de lo que escribe el usuario. Si la búsqueda es por código, SKU, matrícula, e-mail o fragmento literal, los trigramas lo resuelven solos y no cambian la consulta. Si la búsqueda es por palabras en lenguaje natural, como nombre y descripción de producto, el full-text es lo que trae plurales, acentos y relevancia. En un catálogo de productos casi siempre conviene tener los dos: full-text para la búsqueda principal y trigramas para autocompletado y errores de tipeo.',
    },
    {
      question: '¿Crear el índice GIN va a bloquear la tabla en producción?',
      answer:
        'Con CREATE INDEX CONCURRENTLY no bloquea lecturas ni escrituras, pero tarda más, hace dos pasadas por la tabla y no puede ejecutarse dentro de una transacción. Si falla a mitad de camino, deja un índice marcado como inválido, que hay que eliminar con DROP INDEX CONCURRENTLY antes de intentarlo de nuevo. Lo que bloquea de verdad es añadir una columna GENERATED STORED, porque reescribe toda la tabla; por eso la columna tsvector es común y se llena por lotes mediante un trigger.',
    },
    {
      question: '¿El full-text de Postgres sirve para búsquedas en varios idiomas?',
      answer:
        'Sirve, siempre que cada documento se procese con la configuración de su propio idioma. Guarda el idioma en una columna y usa to_tsvector con esa configuración en el trigger, o mantén un tsvector por idioma cuando el mismo producto tiene textos traducidos. En la consulta, usa la configuración del idioma del usuario. Mezclar todo en una sola configuración hace que la raíz de un idioma estropee las palabras del otro, y la búsqueda pierde resultados sin dar ningún error.',
    },
  ],
  conclusion: {
    title: 'Antes de añadir un motor de búsqueda, usa el índice que la base ya tiene',
    description:
      'El LIKE con comodín a la izquierda no usa un índice B-tree y lee la tabla entera en cada búsqueda, lo que funciona con 300 mil filas y destroza el p99 con 4 millones. pg_trgm con GIN resuelve la búsqueda por fragmento, SKU y autocompletado sin cambiar la consulta. El full-text search con configuración sin acentos, pesos por campo, una columna tsvector llenada por lotes e índice GIN resuelve plurales, acentos y relevancia, y websearch_to_tsquery acepta la entrada del usuario sin errores de sintaxis. Con similitud como plan B, un techo de tiempo por consulta y medición antes y después, la búsqueda baja de 1,8 segundos a decenas de milisegundos. El motor de búsqueda dedicado entra cuando facetas, sinónimos y relevancia ajustable se vuelven requisitos del producto, no antes.',
    cta: 'Revisar la búsqueda y la base de mi sistema',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Migración del índice de búsqueda sin ventana: cambiar el motor con consultas activas',
      to: '/blog/migracao-indice-busca-sem-janela-trocar-motor-com-consulta-ligada',
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
