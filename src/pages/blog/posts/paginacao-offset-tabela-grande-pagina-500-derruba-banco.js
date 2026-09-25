// Conteudo do artigo: paginacao por OFFSET em tabela grande, por que o custo
// cresce com o numero da pagina e como migrar para paginacao por chave.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A listagem de pedidos do painel sempre respondeu em quarenta milissegundos, e ninguém tinha motivo para olhar para ela. Numa quinta-feira à tarde, o banco principal chegou a noventa e cinco por cento de CPU, a latência de todas as rotas triplicou e o checkout começou a expirar. A causa não era tráfego novo de clientes: era um script de exportação de um parceiro percorrendo a mesma listagem página por página, com cinquenta itens por vez, e estava na página quatro mil. Cada chamada fazia o banco ler e descartar duzentas mil linhas para devolver cinquenta, e o script fazia várias por segundo. A consulta era a mesma de sempre, com o mesmo índice e o mesmo plano. O que mudou foi o número da página. Este artigo explica por que a paginação por OFFSET tem custo proporcional à profundidade e não ao tamanho da página, quais outros problemas ela esconde além da lentidão, como funciona a paginação por chave e qual índice ela exige, como expor isso na API com um cursor opaco que não quebra com precisão de data, como migrar clientes e telas que dependem de número de página, e em quais casos o OFFSET continua sendo uma escolha razoável.',
  sections: [
    {
      title: 'Por que a página 500 custa quinhentas páginas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET não é um salto. O banco não tem como saber onde começa a linha de número 24.951 de um resultado ordenado sem percorrer as 24.950 anteriores, porque a posição de uma linha no resultado depende do filtro, da ordenação e do estado da tabela naquele instante. Mesmo com o índice perfeito para a consulta, o executor lê as entradas do índice em ordem, busca cada linha correspondente na tabela, conta e descarta até atingir o deslocamento pedido, e só então começa a devolver o que o cliente queria. O trabalho da página N é proporcional a N vezes o tamanho da página.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, criado_em, status, total
FROM pedidos
WHERE loja_id = 42
ORDER BY criado_em DESC, id DESC
LIMIT 50 OFFSET 24950;

 Limit  (cost=21418.52..21461.44 rows=50 width=32)
        (actual time=1874.221..1874.402 rows=50 loops=1)
   Buffers: shared hit=3121 read=21877
   ->  Index Scan using pedidos_loja_criado_id_idx on pedidos
         (cost=0.56..412936.11 rows=481120 width=32)
         (actual time=0.041..1872.930 rows=25000 loops=1)
         Index Cond: (loja_id = 42)
         Buffers: shared hit=3121 read=21877
 Planning Time: 0.162 ms
 Execution Time: 1874.455 ms`,
        },
        {
          type: 'paragraph',
          value:
            'O plano mostra o problema em duas linhas. O nó de índice produziu vinte e cinco mil linhas para que o Limit devolvesse cinquenta, e para isso tocou quase vinte e cinco mil páginas de dados, a maior parte lida do disco porque linhas antigas de uma loja raramente estão em cache. O índice está sendo usado, o plano é o melhor possível para essa forma de consulta, e mesmo assim a execução levou quase dois segundos. Nenhum ajuste de índice resolve isso, porque o custo não vem de um plano ruim: vem de pedir ao banco uma posição que ele só consegue encontrar contando.',
        },
        {
          type: 'table',
          columns: ['Página (50 itens)', 'Linhas lidas com OFFSET', 'Tempo com OFFSET', 'Tempo com paginação por chave'],
          rows: [
            ['1', '50', '0,3 ms', '0,2 ms'],
            ['50', '2.500', '9 ms', '0,2 ms'],
            ['500', '25.000', '1,9 s (páginas frias)', '0,2 ms'],
            ['4.000', '200.000', '14 s (páginas frias)', '0,3 ms'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'É por isso que o problema demora a aparecer. Pessoas navegando pela interface quase nunca passam da página cinco, e em desenvolvimento a tabela tem poucos milhares de linhas. O custo só se manifesta quando alguém automatiza a navegação: um script de exportação, uma integração que sincroniza o histórico inteiro, um robô de busca seguindo o link de próxima página, ou um usuário que descobriu que pode trocar o número na URL. E como o custo total de percorrer N páginas é quadrático, uma exportação completa que parecia inofensiva lê, no total, dezenas de bilhões de linhas.',
        },
      ],
    },
    {
      title: 'O que o OFFSET esconde além da lentidão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A lentidão é o sintoma que derruba o banco, mas não é o único defeito da paginação por deslocamento. Existem outros três, e eles afetam a correção dos dados e a saúde do banco mesmo quando ninguém chega à página 500.',
        },
        {
          type: 'table',
          columns: ['Problema', 'Como acontece', 'Consequência'],
          rows: [
            [
              'Itens duplicados entre páginas',
              'Um pedido novo entra no topo enquanto o cliente está na página 3, e todos os itens descem uma posição',
              'O último item da página 3 aparece de novo no início da página 4, e a exportação grava duas vezes',
            ],
            [
              'Itens pulados',
              'Um pedido da página 1 é excluído ou muda de filtro, e todos os itens sobem uma posição',
              'O primeiro item da página 4 nunca é lido, e a sincronização perde um registro sem erro',
            ],
            [
              'Contagem total cara',
              'A interface mostra "página 3 de 9.622", o que exige COUNT(*) sobre todo o filtro a cada chamada',
              'A contagem custa mais que a própria página e percorre o mesmo volume da página mais profunda',
            ],
            [
              'Cache do banco contaminado',
              'Varreduras profundas trazem para a memória páginas antigas que só aquele cliente usa',
              'Consultas quentes de outras rotas passam a ler do disco, e a latência sobe para todo mundo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Os dois primeiros itens são os mais traiçoeiros, porque não geram erro nem alerta. Uma sincronização que pagina por deslocamento sobre uma tabela que recebe escrita o tempo todo vai, com certeza estatística, perder e duplicar registros, e o time de dados vai descobrir isso meses depois comparando totais que não batem. O quarto item explica por que o incidente do início afetou o checkout, que não tinha nada a ver com a listagem: a exportação expulsou do cache as páginas que o checkout usava.',
        },
      ],
    },
    {
      title: 'Paginação por chave: continuar de onde parou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A alternativa é parar de pedir uma posição e passar a pedir uma continuação. Em vez de "pule 24.950 linhas", a consulta diz "me dê as próximas 50 depois deste item", usando os valores da ordenação do último item da página anterior como ponto de partida. Com um índice na mesma ordem, o banco desce direto na árvore até esse ponto e lê só as cinquenta linhas seguintes. O custo da página 4.000 passa a ser igual ao da página 1.',
        },
        {
          type: 'code',
          value: `-- Indice na mesma ordem da listagem: filtro de igualdade primeiro,
-- depois a ordenacao, depois o desempate unico.
CREATE INDEX CONCURRENTLY pedidos_loja_criado_id_idx
  ON pedidos (loja_id, criado_em DESC, id DESC);

-- Primeira pagina: sem cursor.
SELECT id, criado_em::text AS criado_em_cursor, status, total
FROM pedidos
WHERE loja_id = $1
ORDER BY criado_em DESC, id DESC
LIMIT 51;  -- um a mais que o tamanho da pagina, para saber se existe proxima

-- Paginas seguintes: continua depois do ultimo item devolvido.
SELECT id, criado_em::text AS criado_em_cursor, status, total
FROM pedidos
WHERE loja_id = $1
  AND (criado_em, id) < ($3::timestamptz, $4::bigint)
ORDER BY criado_em DESC, id DESC
LIMIT $2;`,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem essa consulta funcionar, e errar qualquer um deles produz resultados sutilmente errados. O primeiro é o desempate: criado_em sozinho não é único, e dois pedidos criados no mesmo microssegundo, comuns em importações em lote, fariam o cursor pular ou repetir itens. Acrescentar o id à ordenação e à comparação torna a ordem total e determinística. O segundo é a comparação de linha, (criado_em, id) < (valor, valor), que significa "criado_em menor, ou igual e id menor". Escrever isso à mão com OR costuma impedir o uso do índice, enquanto a forma de linha o PostgreSQL usa diretamente como condição de índice. O terceiro é o índice com as colunas na mesma ordem e direção da cláusula ORDER BY, com a coluna de igualdade do filtro na frente.',
        },
        {
          type: 'code',
          value: ` Limit  (cost=0.56..44.21 rows=50 width=32)
        (actual time=0.052..0.198 rows=50 loops=1)
   Buffers: shared hit=54
   ->  Index Scan using pedidos_loja_criado_id_idx on pedidos
         (actual time=0.050..0.187 rows=50 loops=1)
         Index Cond: ((loja_id = 42) AND
           (ROW(criado_em, id) < ROW('2026-03-14 18:22:07.481213-03'::timestamptz, 88123410)))
         Buffers: shared hit=54
 Execution Time: 0.231 ms`,
        },
        {
          type: 'paragraph',
          value:
            'A linha Index Cond é a confirmação que importa: a comparação de linha aparece dentro da condição do índice, e não como filtro aplicado depois. Se ela aparecer em uma linha Filter, o banco está lendo o índice desde o início e descartando, e o ganho desaparece. Isso acontece quando a direção de alguma coluna do índice não bate com a ordenação, quando a consulta ordena por uma expressão diferente da indexada, ou quando existe um filtro adicional de igualdade que não está no começo do índice. Cada combinação de filtro e ordenação que a interface oferece precisa de um índice compatível, e esse é o custo real da técnica.',
        },
      ],
    },
    {
      title: 'O cursor na API: opaco, assinado e sem perder microssegundos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Expor os valores da ordenação diretamente na URL, como ?depois_de_data=...&depois_de_id=..., funciona, mas amarra o contrato da API à implementação. Se a ordenação mudar, se um novo desempate for necessário ou se a listagem passar a aceitar outra ordem, todos os clientes quebram. O padrão mais durável é um cursor opaco: uma string que o servidor produz, o cliente devolve sem interpretar, e que carrega uma versão para permitir mudanças futuras.',
        },
        {
          type: 'code',
          value: `// Cursor opaco e assinado para paginacao por chave (Express + node-postgres).
import { createHmac, timingSafeEqual } from 'node:crypto';

const SEGREDO_CURSOR = process.env.SEGREDO_CURSOR;
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

const assinar = (dados) =>
  createHmac('sha256', SEGREDO_CURSOR).update(dados).digest('base64url').slice(0, 22);

export function codificarCursor({ criadoEm, id }) {
  const dados = Buffer.from(JSON.stringify({ v: 1, c: criadoEm, i: id })).toString('base64url');
  return dados + '.' + assinar(dados);
}

export function decodificarCursor(cursor) {
  const [dados, assinatura] = String(cursor).split('.');
  if (!dados || !assinatura) return null;
  const esperada = Buffer.from(assinar(dados));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;
  const { v, c, i } = JSON.parse(Buffer.from(dados, 'base64url').toString('utf8'));
  return v === 1 ? { criadoEm: c, id: i } : null;
}

export async function listarPedidos(req, res) {
  const limite = Math.min(Number(req.query.limite) || LIMITE_PADRAO, LIMITE_MAXIMO);
  const cursor = req.query.cursor ? decodificarCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) {
    return res.status(400).json({ erro: 'cursor_invalido' });
  }

  const parametros = [req.lojaId, limite + 1];
  let continuacao = '';
  if (cursor) {
    parametros.push(cursor.criadoEm, cursor.id);
    continuacao = 'AND (criado_em, id) < ($3::timestamptz, $4::bigint)';
  }

  const { rows } = await db.query(
    'SELECT id, criado_em::text AS criado_em_cursor, status, total ' +
      'FROM pedidos WHERE loja_id = $1 ' + continuacao +
      ' ORDER BY criado_em DESC, id DESC LIMIT $2',
    parametros,
  );

  const temProxima = rows.length > limite;
  const itens = temProxima ? rows.slice(0, limite) : rows;
  const ultimo = itens[itens.length - 1];

  return res.json({
    itens: itens.map(({ criado_em_cursor, ...pedido }) => ({ ...pedido, criado_em: criado_em_cursor })),
    proximo_cursor: temProxima
      ? codificarCursor({ criadoEm: ultimo.criado_em_cursor, id: ultimo.id })
      : null,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que mais produz defeito em produção está na coluna criado_em_cursor. O timestamptz do PostgreSQL tem precisão de microssegundos, e o Date do JavaScript só guarda milissegundos. Se o cursor for montado a partir do valor convertido para Date, o ponto de continuação perde os três últimos dígitos, e itens criados dentro do mesmo milissegundo que o último da página são pulados ou repetidos, de forma intermitente e quase impossível de reproduzir. Selecionar a coluna como texto preserva a precisão completa, e o cast de volta para timestamptz na consulta seguinte reconstrói exatamente o mesmo valor. Pela mesma razão o id vai como texto: o node-postgres devolve bigint como string para não perder precisão acima de dois elevado a cinquenta e três.',
        },
        {
          type: 'list',
          items: [
            'A assinatura impede que o cliente fabrique cursores para pular direto para qualquer ponto da tabela, o que reabriria parte do problema e permitiria sondar dados por valor de ordenação.',
            'O campo de versão permite trocar o formato do cursor no futuro aceitando o antigo por um período, sem quebrar clientes no meio de uma paginação.',
            'Buscar um item a mais que o limite responde se existe próxima página sem uma segunda consulta e sem COUNT.',
            'O limite máximo por página é parte da proteção: sem ele, um cliente pede dez mil itens por página e reproduz o custo por outro caminho.',
          ],
        },
      ],
    },
    {
      title: 'Migrar clientes e telas que dependem de número de página',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A consulta nova é a parte fácil. A parte difícil é que a API já tem clientes que mandam ?pagina=4000, e a interface tem um paginador com números e um botão de última página. Nenhum dos dois pode ser trocado de um dia para o outro, e a paginação por chave não oferece o que eles pedem: não existe forma barata de pular para a página 4.000 sem percorrer as anteriores, porque essa é justamente a operação cara.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumente a rota antiga com a profundidade pedida e o cliente que pediu, para descobrir quem realmente navega além das primeiras páginas. Em quase todos os casos são dois ou três clientes automatizados, e não pessoas.',
            'Publique o parâmetro cursor ao lado de pagina, devolvendo proximo_cursor em todas as respostas, inclusive nas que foram pedidas por número de página, para que um cliente possa começar por número e continuar por cursor.',
            'Imponha um teto de profundidade para o parâmetro antigo, por exemplo dez mil itens, e acima dele responda 400 com uma mensagem que aponta o parâmetro cursor e a documentação. Esse teto sozinho elimina o incidente, mesmo antes de qualquer cliente migrar.',
            'Ofereça uma exportação assíncrona para quem precisa do histórico inteiro: o cliente pede, um job percorre a tabela por chave em ritmo controlado, gera o arquivo e avisa quando está pronto. Scripts de exportação por paginação são o maior consumidor de páginas profundas, e esse é o caminho certo para eles.',
            'Na interface, troque o paginador numérico por "carregar mais" ou por anterior e próxima, e substitua o salto para a página N por filtros que as pessoas realmente usam, como intervalo de datas, status e busca.',
            'Remova o parâmetro antigo quando a métrica mostrar que ninguém mais passa do teto, com data comunicada aos clientes que ainda o usam.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro passo merece ênfase porque é o que resolve o risco imediato com uma mudança de poucas linhas. Mecanismos de busca como o Elasticsearch fazem exatamente isso por padrão, recusando deslocamentos acima de dez mil resultados, e a razão é a mesma. O teto transforma um custo ilimitado em um custo conhecido, e o erro com instrução de como migrar faz os clientes automatizados aparecerem sozinhos, em vez de continuarem invisíveis até o próximo incidente.',
        },
        {
          type: 'paragraph',
          value:
            'Para a navegação para trás, a mesma técnica funciona com a comparação invertida: a consulta usa maior que em vez de menor que, ordena em ordem crescente, e o servidor inverte o resultado antes de devolver. O cursor carrega a direção junto com os valores, e a resposta passa a ter anterior_cursor e proximo_cursor. Não é preciso guardar estado no servidor para isso.',
        },
      ],
    },
    {
      title: 'Quando o OFFSET ainda serve, e o que fazer com a contagem total',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET não é proibido. Ele é a ferramenta errada quando a profundidade não tem limite e a tabela é grande, e continua sendo razoável quando alguma das duas coisas não é verdade. Uma tela administrativa sobre uma tabela de configuração com três mil linhas, uma listagem em que o filtro sempre reduz o resultado a algumas centenas de itens, ou um relatório interno que ninguém automatiza podem usar número de página sem risco, e a simplicidade de implementar e de pular para uma página específica tem valor real nesses casos.',
        },
        {
          type: 'table',
          columns: ['Situação', 'Técnica adequada', 'Por quê'],
          rows: [
            ['Tabela pequena ou filtro que sempre limita o resultado', 'OFFSET', 'O custo máximo é baixo e conhecido'],
            ['Feed, histórico ou listagem de API pública', 'Paginação por chave com cursor', 'Profundidade ilimitada e escrita concorrente'],
            ['Exportação ou sincronização completa', 'Job assíncrono percorrendo por chave', 'Precisa ler tudo sem duplicar nem pular'],
            ['Busca textual com relevância', 'Limite de profundidade no motor de busca', 'Ninguém lê o resultado 20.000 de uma busca'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A contagem total é o outro custo que costuma sobreviver à migração. "Mostrando 1 a 50 de 481.120" exige COUNT(*) sobre o filtro inteiro, que no PostgreSQL percorre todas as linhas visíveis, e isso acontece em toda chamada. Na maioria das interfaces, o número exato não é usado para nada além de exibição, e pode ser substituído por uma contagem com teto, que para de contar ao passar de um limite, ou por uma estimativa do planejador quando a ordem de grandeza basta.',
        },
        {
          type: 'code',
          value: `-- Contagem com teto: para de contar ao passar de 10.000 linhas.
-- A interface mostra "10.000+" quando o resultado atinge o teto.
SELECT count(*) AS total
FROM (
  SELECT 1
  FROM pedidos
  WHERE loja_id = $1
  LIMIT 10001
) AS amostra;

-- Estimativa da tabela inteira, sem percorrer nada, a partir das
-- estatisticas mantidas pelo ANALYZE e pelo autovacuum.
SELECT reltuples::bigint AS estimativa
FROM pg_class
WHERE oid = 'pedidos'::regclass;`,
        },
        {
          type: 'paragraph',
          value:
            'A contagem com teto custa no máximo a leitura de dez mil entradas do índice, independentemente do tamanho da loja, e resolve o caso de uso real da interface, que é dizer ao usuário se o resultado é pequeno ou grande. Quando o produto exige o número exato, por exemplo em um relatório financeiro, o lugar certo para ele é uma contagem mantida por gatilho ou por agregação periódica, e não um COUNT a cada abertura da tela.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Um índice melhor não resolve a paginação por OFFSET?',
      answer:
        'Não, e essa é a confusão mais comum. O índice certo é necessário para qualquer técnica de paginação, porque sem ele o banco ordena o resultado inteiro antes de devolver a primeira página. Mas com OFFSET, mesmo o índice perfeito só permite que o banco percorra as linhas em ordem, e ele ainda precisa ler e descartar todas as linhas anteriores ao deslocamento pedido. O plano de uma página profunda com OFFSET já usa o índice, e o tempo continua crescendo linearmente com o número da página. Um índice de cobertura, que inclui todas as colunas selecionadas e permite uma varredura somente no índice, reduz o custo por linha porque evita a visita à tabela, mas não muda a proporção: a página 4.000 continua lendo duzentas mil entradas. O que muda o custo de proporcional à profundidade para constante é trocar a pergunta, de posição para continuação, e isso só a paginação por chave faz.',
    },
    {
      question: 'E se a ordenação for por uma coluna que muda, como status ou pontuação?',
      answer:
        'A paginação por chave continua funcionando, mas com uma semântica que precisa ser entendida. O cursor guarda os valores de ordenação do último item visto, e a próxima página começa depois desses valores no estado atual da tabela. Se um item muda de pontuação enquanto o cliente pagina, ele pode aparecer de novo em uma página posterior ou não aparecer mais, porque saiu da região que ainda não foi lida. Isso não é pior que o OFFSET, que tem o mesmo problema e ainda acrescenta pulos e duplicatas causados por inserções. Para interfaces, esse comportamento costuma ser aceitável. Para sincronização, em que nenhum item pode ser perdido, a ordenação deve ser por uma coluna que só cresce, como um identificador sequencial ou uma coluna atualizado_em com desempate por id, e o cliente precisa aceitar receber o mesmo item mais de uma vez e deduplicar pela chave. Quando a interface precisa de um resultado estável por uma ordenação volátil, a solução é materializar o resultado em uma tabela temporária ou em um snapshot com identificador e paginar sobre ele.',
    },
    {
      question: 'Como oferecer "ir para a página N" sem OFFSET?',
      answer:
        'Na maioria dos casos, a melhor resposta é perguntar para que o usuário quer ir para a página N. Quase sempre é para chegar a um período, a uma letra do alfabeto ou a um status, e um filtro por data, uma busca ou um salto por letra atendem a essa intenção com uma consulta por chave barata, começando direto no ponto desejado. Quando o salto por número é realmente necessário, existem compromissos razoáveis. Um deles é limitar os saltos às primeiras dezenas de páginas, onde o OFFSET é barato, e usar apenas anterior e próxima a partir daí. Outro é manter uma tabela auxiliar com os valores de ordenação a cada mil itens, atualizada periodicamente, o que permite saltar para perto da página pedida por chave e completar com um OFFSET pequeno. O que não deve existir é um botão de última página sobre uma tabela de milhões de linhas, porque ele é, literalmente, a consulta mais cara que a tela consegue produzir, e costuma ser clicado mais do que se imagina.',
    },
  ],
  conclusion: {
    title: 'Paginar por posição é pedir ao banco para contar, e contar não escala',
    description:
      'A paginação por OFFSET funciona em desenvolvimento e nas primeiras páginas, e por isso passa despercebida até que um script, uma integração ou um robô de busca navegue fundo o suficiente para transformar uma listagem inocente no maior consumidor do banco. Além da lentidão, ela duplica e pula registros quando a tabela recebe escrita e contamina o cache que as outras rotas usam. A paginação por chave, com desempate único, comparação de linha e índice na mesma ordem, torna o custo de qualquer página igual ao da primeira, e um cursor opaco, assinado e com precisão completa torna essa técnica um contrato de API durável. Um teto de profundidade no parâmetro antigo resolve o risco imediato enquanto os clientes migram. Posso revisar as listagens da sua API e do seu painel, identificar quais consultas crescem com a profundidade e planejar a migração para cursor sem quebrar os clientes que já existem.',
    cta: 'Falar sobre o desempenho do meu banco de dados',
  },
  related: [
    {
      label: 'Índice que o banco decidiu ignorar: quando o plano de consulta muda sozinho',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Contrato de API sem versão: evoluir o payload sem quebrar o cliente antigo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The dashboard order listing had always answered in forty milliseconds, and nobody had any reason to look at it. On a Thursday afternoon, the primary database hit ninety-five percent CPU, latency on every route tripled and checkout started timing out. The cause was not new customer traffic: it was a partner\'s export script walking the same listing page by page, fifty items at a time, and it was on page four thousand. Each call made the database read and discard two hundred thousand rows to return fifty, and the script made several per second. The query was the same as always, with the same index and the same plan. What changed was the page number. This article explains why OFFSET pagination costs in proportion to depth rather than page size, which other problems it hides besides slowness, how keyset pagination works and which index it requires, how to expose it in the API with an opaque cursor that does not break on timestamp precision, how to migrate clients and screens that depend on page numbers, and in which cases OFFSET is still a reasonable choice.',
  sections: [
    {
      title: 'Why page 500 costs five hundred pages',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET is not a jump. The database has no way of knowing where row number 24,951 of an ordered result begins without walking the 24,950 before it, because a row\'s position in the result depends on the filter, the ordering and the state of the table at that instant. Even with the perfect index for the query, the executor reads index entries in order, fetches each matching row from the table, counts and discards until it reaches the requested offset, and only then starts returning what the client wanted. The work for page N is proportional to N times the page size.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, created_at, status, total
FROM orders
WHERE store_id = 42
ORDER BY created_at DESC, id DESC
LIMIT 50 OFFSET 24950;

 Limit  (cost=21418.52..21461.44 rows=50 width=32)
        (actual time=1874.221..1874.402 rows=50 loops=1)
   Buffers: shared hit=3121 read=21877
   ->  Index Scan using orders_store_created_id_idx on orders
         (cost=0.56..412936.11 rows=481120 width=32)
         (actual time=0.041..1872.930 rows=25000 loops=1)
         Index Cond: (store_id = 42)
         Buffers: shared hit=3121 read=21877
 Planning Time: 0.162 ms
 Execution Time: 1874.455 ms`,
        },
        {
          type: 'paragraph',
          value:
            'The plan shows the problem in two lines. The index node produced twenty-five thousand rows so that Limit could return fifty, and to do so it touched almost twenty-five thousand data pages, most of them read from disk because a store\'s old rows are rarely cached. The index is being used, the plan is the best possible for that query shape, and still execution took almost two seconds. No index tuning fixes this, because the cost does not come from a bad plan: it comes from asking the database for a position it can only find by counting.',
        },
        {
          type: 'table',
          columns: ['Page (50 items)', 'Rows read with OFFSET', 'Time with OFFSET', 'Time with keyset pagination'],
          rows: [
            ['1', '50', '0.3 ms', '0.2 ms'],
            ['50', '2,500', '9 ms', '0.2 ms'],
            ['500', '25,000', '1.9 s (cold pages)', '0.2 ms'],
            ['4,000', '200,000', '14 s (cold pages)', '0.3 ms'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'That is why the problem takes so long to show up. People browsing the interface almost never go past page five, and in development the table has a few thousand rows. The cost only shows up when someone automates the navigation: an export script, an integration that syncs the entire history, a search crawler following the next page link, or a user who found out they can change the number in the URL. And since the total cost of walking N pages is quadratic, a full export that looked harmless reads, in total, tens of billions of rows.',
        },
      ],
    },
    {
      title: 'What OFFSET hides besides slowness',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Slowness is the symptom that takes the database down, but it is not the only defect of offset pagination. There are three more, and they affect data correctness and database health even when nobody reaches page 500.',
        },
        {
          type: 'table',
          columns: ['Problem', 'How it happens', 'Consequence'],
          rows: [
            [
              'Items duplicated across pages',
              'A new order lands at the top while the client is on page 3, and every item shifts down one position',
              'The last item of page 3 shows up again at the start of page 4, and the export writes it twice',
            ],
            [
              'Skipped items',
              'An order on page 1 is deleted or leaves the filter, and every item shifts up one position',
              'The first item of page 4 is never read, and the sync loses a record with no error',
            ],
            [
              'Expensive total count',
              'The interface shows "page 3 of 9,622", which requires COUNT(*) over the whole filter on every call',
              'The count costs more than the page itself and walks the same volume as the deepest page',
            ],
            [
              'Polluted database cache',
              'Deep scans pull into memory old pages that only that client uses',
              'Hot queries from other routes start reading from disk, and latency rises for everyone',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The first two are the most treacherous, because they raise no error and no alert. A sync that paginates by offset over a table receiving constant writes will, with statistical certainty, lose and duplicate records, and the data team will find out months later comparing totals that do not match. The fourth explains why the opening incident hit checkout, which had nothing to do with the listing: the export evicted from cache the pages checkout was using.',
        },
      ],
    },
    {
      title: 'Keyset pagination: continuing where you left off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The alternative is to stop asking for a position and start asking for a continuation. Instead of "skip 24,950 rows", the query says "give me the next 50 after this item", using the ordering values of the last item on the previous page as the starting point. With an index in the same order, the database descends straight down the tree to that point and reads only the next fifty rows. Page 4,000 now costs the same as page 1.',
        },
        {
          type: 'code',
          value: `-- Index in the same order as the listing: equality filter first,
-- then the ordering, then the unique tiebreaker.
CREATE INDEX CONCURRENTLY orders_store_created_id_idx
  ON orders (store_id, created_at DESC, id DESC);

-- First page: no cursor.
SELECT id, created_at::text AS created_at_cursor, status, total
FROM orders
WHERE store_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 51;  -- one more than the page size, to know whether a next page exists

-- Following pages: continue after the last item returned.
SELECT id, created_at::text AS created_at_cursor, status, total
FROM orders
WHERE store_id = $1
  AND (created_at, id) < ($3::timestamptz, $4::bigint)
ORDER BY created_at DESC, id DESC
LIMIT $2;`,
        },
        {
          type: 'paragraph',
          value:
            'Three details make this query work, and getting any of them wrong produces subtly wrong results. The first is the tiebreaker: created_at alone is not unique, and two orders created in the same microsecond, common in batch imports, would make the cursor skip or repeat items. Adding id to the ordering and to the comparison makes the order total and deterministic. The second is the row comparison, (created_at, id) < (value, value), which means "created_at smaller, or equal and id smaller". Writing that by hand with OR usually prevents index use, while PostgreSQL uses the row form directly as an index condition. The third is the index with columns in the same order and direction as the ORDER BY clause, with the filter\'s equality column in front.',
        },
        {
          type: 'code',
          value: ` Limit  (cost=0.56..44.21 rows=50 width=32)
        (actual time=0.052..0.198 rows=50 loops=1)
   Buffers: shared hit=54
   ->  Index Scan using orders_store_created_id_idx on orders
         (actual time=0.050..0.187 rows=50 loops=1)
         Index Cond: ((store_id = 42) AND
           (ROW(created_at, id) < ROW('2026-03-14 18:22:07.481213-03'::timestamptz, 88123410)))
         Buffers: shared hit=54
 Execution Time: 0.231 ms`,
        },
        {
          type: 'paragraph',
          value:
            'The Index Cond line is the confirmation that matters: the row comparison appears inside the index condition, not as a filter applied afterwards. If it shows up on a Filter line, the database is reading the index from the start and discarding, and the gain disappears. That happens when the direction of some index column does not match the ordering, when the query orders by an expression different from the indexed one, or when there is an additional equality filter that is not at the front of the index. Every combination of filter and ordering the interface offers needs a compatible index, and that is the real cost of the technique.',
        },
      ],
    },
    {
      title: 'The cursor in the API: opaque, signed and without losing microseconds',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Exposing the ordering values directly in the URL, as ?after_date=...&after_id=..., works, but it ties the API contract to the implementation. If the ordering changes, if a new tiebreaker is needed or if the listing starts accepting another order, every client breaks. The more durable pattern is an opaque cursor: a string the server produces, the client sends back without interpreting, and which carries a version to allow future changes.',
        },
        {
          type: 'code',
          value: `// Opaque, signed cursor for keyset pagination (Express + node-postgres).
import { createHmac, timingSafeEqual } from 'node:crypto';

const CURSOR_SECRET = process.env.CURSOR_SECRET;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const sign = (data) =>
  createHmac('sha256', CURSOR_SECRET).update(data).digest('base64url').slice(0, 22);

export function encodeCursor({ createdAt, id }) {
  const data = Buffer.from(JSON.stringify({ v: 1, c: createdAt, i: id })).toString('base64url');
  return data + '.' + sign(data);
}

export function decodeCursor(cursor) {
  const [data, signature] = String(cursor).split('.');
  if (!data || !signature) return null;
  const expected = Buffer.from(sign(data));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  const { v, c, i } = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
  return v === 1 ? { createdAt: c, id: i } : null;
}

export async function listOrders(req, res) {
  const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const cursor = req.query.cursor ? decodeCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) {
    return res.status(400).json({ error: 'invalid_cursor' });
  }

  const params = [req.storeId, limit + 1];
  let continuation = '';
  if (cursor) {
    params.push(cursor.createdAt, cursor.id);
    continuation = 'AND (created_at, id) < ($3::timestamptz, $4::bigint)';
  }

  const { rows } = await db.query(
    'SELECT id, created_at::text AS created_at_cursor, status, total ' +
      'FROM orders WHERE store_id = $1 ' + continuation +
      ' ORDER BY created_at DESC, id DESC LIMIT $2',
    params,
  );

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];

  return res.json({
    items: items.map(({ created_at_cursor, ...order }) => ({ ...order, created_at: created_at_cursor })),
    next_cursor: hasNext
      ? encodeCursor({ createdAt: last.created_at_cursor, id: last.id })
      : null,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that causes the most production defects is in the created_at_cursor column. PostgreSQL timestamptz has microsecond precision, and the JavaScript Date only keeps milliseconds. If the cursor is built from the value converted to a Date, the continuation point loses its last three digits, and items created within the same millisecond as the last one on the page are skipped or repeated, intermittently and almost impossible to reproduce. Selecting the column as text keeps full precision, and casting it back to timestamptz on the next query rebuilds exactly the same value. For the same reason the id travels as text: node-postgres returns bigint as a string so it does not lose precision above two to the fifty-third power.',
        },
        {
          type: 'list',
          items: [
            'The signature stops the client from forging cursors to jump straight to any point in the table, which would reopen part of the problem and allow probing data by ordering value.',
            'The version field makes it possible to change the cursor format in the future while accepting the old one for a while, without breaking clients in the middle of a pagination.',
            'Fetching one item more than the limit answers whether a next page exists without a second query and without COUNT.',
            'The maximum page size is part of the protection: without it, a client asks for ten thousand items per page and reproduces the cost by another route.',
          ],
        },
      ],
    },
    {
      title: 'Migrating clients and screens that depend on page numbers',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The new query is the easy part. The hard part is that the API already has clients sending ?page=4000, and the interface has a numbered paginator and a last page button. Neither can be swapped overnight, and keyset pagination does not offer what they ask for: there is no cheap way to jump to page 4,000 without walking the ones before it, because that is precisely the expensive operation.',
        },
        {
          type: 'ordered',
          items: [
            'Instrument the old route with the requested depth and the client that asked for it, to find out who actually navigates past the first pages. In almost every case it is two or three automated clients, not people.',
            'Publish the cursor parameter alongside page, returning next_cursor on every response, including those requested by page number, so a client can start by number and continue by cursor.',
            'Impose a depth ceiling on the old parameter, for example ten thousand items, and above it respond with a 400 whose message points to the cursor parameter and the documentation. That ceiling alone removes the incident, even before any client migrates.',
            'Offer an asynchronous export to anyone who needs the full history: the client requests it, a job walks the table by key at a controlled pace, generates the file and notifies when it is ready. Pagination-based export scripts are the biggest consumer of deep pages, and this is the right path for them.',
            'In the interface, replace the numbered paginator with "load more" or previous and next, and replace the jump to page N with filters people actually use, such as date range, status and search.',
            'Remove the old parameter when the metric shows nobody goes past the ceiling anymore, with a date announced to the clients still using it.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third step deserves emphasis because it resolves the immediate risk with a change of a few lines. Search engines such as Elasticsearch do exactly that by default, refusing offsets above ten thousand results, and for the same reason. The ceiling turns an unbounded cost into a known one, and an error with instructions on how to migrate makes automated clients show up on their own, instead of staying invisible until the next incident.',
        },
        {
          type: 'paragraph',
          value:
            'For backward navigation, the same technique works with the comparison inverted: the query uses greater than instead of less than, orders ascending, and the server reverses the result before returning it. The cursor carries the direction along with the values, and the response gains previous_cursor and next_cursor. No state needs to be stored on the server for this.',
        },
      ],
    },
    {
      title: 'When OFFSET still works, and what to do about the total count',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET is not forbidden. It is the wrong tool when depth is unbounded and the table is large, and it remains reasonable when either of those is not true. An admin screen over a configuration table with three thousand rows, a listing where the filter always narrows the result to a few hundred items, or an internal report nobody automates can use page numbers without risk, and the simplicity of implementing it and of jumping to a specific page has real value in those cases.',
        },
        {
          type: 'table',
          columns: ['Situation', 'Appropriate technique', 'Why'],
          rows: [
            ['Small table or a filter that always bounds the result', 'OFFSET', 'The maximum cost is low and known'],
            ['Feed, history or public API listing', 'Keyset pagination with a cursor', 'Unbounded depth and concurrent writes'],
            ['Full export or sync', 'Asynchronous job walking by key', 'Must read everything without duplicating or skipping'],
            ['Full text search with relevance', 'Depth limit in the search engine', 'Nobody reads result 20,000 of a search'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The total count is the other cost that tends to survive the migration. "Showing 1 to 50 of 481,120" requires COUNT(*) over the whole filter, which in PostgreSQL walks every visible row, and it happens on every call. In most interfaces, the exact number is used for nothing but display, and it can be replaced by a capped count, which stops counting once it passes a limit, or by a planner estimate when the order of magnitude is enough.',
        },
        {
          type: 'code',
          value: `-- Capped count: stops counting after 10,000 rows.
-- The interface shows "10,000+" when the result hits the cap.
SELECT count(*) AS total
FROM (
  SELECT 1
  FROM orders
  WHERE store_id = $1
  LIMIT 10001
) AS sample;

-- Whole table estimate, without walking anything, from the
-- statistics maintained by ANALYZE and autovacuum.
SELECT reltuples::bigint AS estimate
FROM pg_class
WHERE oid = 'orders'::regclass;`,
        },
        {
          type: 'paragraph',
          value:
            'The capped count costs at most reading ten thousand index entries, regardless of the store size, and it covers the interface\'s real use case, which is telling the user whether the result is small or large. When the product requires the exact number, for example in a financial report, the right place for it is a count maintained by a trigger or by periodic aggregation, not a COUNT every time the screen opens.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does a better index not fix OFFSET pagination?',
      answer:
        'No, and that is the most common confusion. The right index is necessary for any pagination technique, because without it the database sorts the entire result before returning the first page. But with OFFSET, even the perfect index only lets the database walk the rows in order, and it still has to read and discard every row before the requested offset. The plan for a deep OFFSET page already uses the index, and the time still grows linearly with the page number. A covering index, which includes every selected column and allows an index only scan, lowers the cost per row because it avoids visiting the table, but it does not change the proportion: page 4,000 still reads two hundred thousand entries. What changes the cost from proportional to depth to constant is changing the question, from position to continuation, and only keyset pagination does that.',
    },
    {
      question: 'What if the ordering is by a column that changes, such as status or score?',
      answer:
        'Keyset pagination still works, but with semantics you need to understand. The cursor stores the ordering values of the last item seen, and the next page starts after those values in the current state of the table. If an item changes score while the client paginates, it may show up again on a later page or not show up at all, because it moved out of the region not yet read. That is no worse than OFFSET, which has the same problem and adds skips and duplicates caused by inserts. For interfaces, that behavior is usually acceptable. For sync, where no item can be lost, the ordering should be by a column that only grows, such as a sequential identifier or an updated_at column with an id tiebreaker, and the client must accept receiving the same item more than once and deduplicate by key. When the interface needs a stable result over a volatile ordering, the solution is to materialize the result into a temporary table or an identified snapshot and paginate over it.',
    },
    {
      question: 'How do you offer "go to page N" without OFFSET?',
      answer:
        'In most cases, the best answer is to ask why the user wants to go to page N. It is almost always to reach a period, a letter of the alphabet or a status, and a date filter, a search or a letter jump serve that intent with a cheap keyset query that starts directly at the desired point. When jumping by number is truly necessary, there are reasonable compromises. One is to limit jumps to the first few dozen pages, where OFFSET is cheap, and offer only previous and next beyond that. Another is to keep an auxiliary table with the ordering values every thousand items, refreshed periodically, which lets you jump close to the requested page by key and finish with a small OFFSET. What should not exist is a last page button over a table with millions of rows, because it is, literally, the most expensive query the screen can produce, and it tends to be clicked more than you would imagine.',
    },
  ],
  conclusion: {
    title: 'Paginating by position is asking the database to count, and counting does not scale',
    description:
      'OFFSET pagination works in development and on the first pages, which is why it goes unnoticed until a script, an integration or a search crawler navigates deep enough to turn an innocent listing into the database\'s biggest consumer. Beyond slowness, it duplicates and skips records when the table receives writes and pollutes the cache other routes rely on. Keyset pagination, with a unique tiebreaker, a row comparison and an index in the same order, makes any page cost the same as the first, and an opaque, signed cursor with full precision turns the technique into a durable API contract. A depth ceiling on the old parameter resolves the immediate risk while clients migrate. I can review the listings in your API and dashboard, identify which queries grow with depth and plan the migration to cursors without breaking the clients you already have.',
    cta: 'Talk about my database performance',
  },
  related: [
    {
      label: 'The index the database decided to ignore: when the query plan changes on its own',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Unversioned API contracts: evolving the payload without breaking the old client',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El listado de pedidos del panel siempre había respondido en cuarenta milisegundos, y nadie tenía motivo para mirarlo. Un jueves por la tarde, la base de datos principal llegó al noventa y cinco por ciento de CPU, la latencia de todas las rutas se triplicó y el checkout empezó a agotar el tiempo de espera. La causa no era tráfico nuevo de clientes: era un script de exportación de un socio recorriendo el mismo listado página por página, cincuenta elementos a la vez, y estaba en la página cuatro mil. Cada llamada hacía que la base leyera y descartara doscientas mil filas para devolver cincuenta, y el script hacía varias por segundo. La consulta era la de siempre, con el mismo índice y el mismo plan. Lo que cambió fue el número de página. Este artículo explica por qué la paginación por OFFSET tiene un costo proporcional a la profundidad y no al tamaño de la página, qué otros problemas esconde además de la lentitud, cómo funciona la paginación por clave y qué índice exige, cómo exponerla en la API con un cursor opaco que no se rompe por la precisión de la fecha, cómo migrar clientes y pantallas que dependen del número de página, y en qué casos el OFFSET sigue siendo una opción razonable.',
  sections: [
    {
      title: 'Por qué la página 500 cuesta quinientas páginas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET no es un salto. La base no tiene forma de saber dónde empieza la fila número 24.951 de un resultado ordenado sin recorrer las 24.950 anteriores, porque la posición de una fila en el resultado depende del filtro, del orden y del estado de la tabla en ese instante. Incluso con el índice perfecto para la consulta, el ejecutor lee las entradas del índice en orden, busca cada fila correspondiente en la tabla, cuenta y descarta hasta alcanzar el desplazamiento pedido, y solo entonces empieza a devolver lo que el cliente quería. El trabajo de la página N es proporcional a N por el tamaño de la página.',
        },
        {
          type: 'code',
          value: `EXPLAIN (ANALYZE, BUFFERS)
SELECT id, creado_en, estado, total
FROM pedidos
WHERE tienda_id = 42
ORDER BY creado_en DESC, id DESC
LIMIT 50 OFFSET 24950;

 Limit  (cost=21418.52..21461.44 rows=50 width=32)
        (actual time=1874.221..1874.402 rows=50 loops=1)
   Buffers: shared hit=3121 read=21877
   ->  Index Scan using pedidos_tienda_creado_id_idx on pedidos
         (cost=0.56..412936.11 rows=481120 width=32)
         (actual time=0.041..1872.930 rows=25000 loops=1)
         Index Cond: (tienda_id = 42)
         Buffers: shared hit=3121 read=21877
 Planning Time: 0.162 ms
 Execution Time: 1874.455 ms`,
        },
        {
          type: 'paragraph',
          value:
            'El plan muestra el problema en dos líneas. El nodo de índice produjo veinticinco mil filas para que el Limit devolviera cincuenta, y para eso tocó casi veinticinco mil páginas de datos, la mayoría leídas del disco porque las filas antiguas de una tienda rara vez están en caché. El índice se está usando, el plan es el mejor posible para esa forma de consulta, y aun así la ejecución tardó casi dos segundos. Ningún ajuste de índice lo resuelve, porque el costo no viene de un plan malo: viene de pedirle a la base una posición que solo puede encontrar contando.',
        },
        {
          type: 'table',
          columns: ['Página (50 elementos)', 'Filas leídas con OFFSET', 'Tiempo con OFFSET', 'Tiempo con paginación por clave'],
          rows: [
            ['1', '50', '0,3 ms', '0,2 ms'],
            ['50', '2.500', '9 ms', '0,2 ms'],
            ['500', '25.000', '1,9 s (páginas frías)', '0,2 ms'],
            ['4.000', '200.000', '14 s (páginas frías)', '0,3 ms'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Por eso el problema tarda en aparecer. Las personas que navegan por la interfaz casi nunca pasan de la página cinco, y en desarrollo la tabla tiene unos pocos miles de filas. El costo solo se manifiesta cuando alguien automatiza la navegación: un script de exportación, una integración que sincroniza todo el historial, un rastreador de búsqueda que sigue el enlace de página siguiente, o un usuario que descubrió que puede cambiar el número en la URL. Y como el costo total de recorrer N páginas es cuadrático, una exportación completa que parecía inofensiva lee, en total, decenas de miles de millones de filas.',
        },
      ],
    },
    {
      title: 'Lo que el OFFSET esconde además de la lentitud',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La lentitud es el síntoma que tumba la base, pero no es el único defecto de la paginación por desplazamiento. Hay otros tres, y afectan la corrección de los datos y la salud de la base incluso cuando nadie llega a la página 500.',
        },
        {
          type: 'table',
          columns: ['Problema', 'Cómo ocurre', 'Consecuencia'],
          rows: [
            [
              'Elementos duplicados entre páginas',
              'Un pedido nuevo entra arriba mientras el cliente está en la página 3, y todos los elementos bajan una posición',
              'El último elemento de la página 3 vuelve a aparecer al inicio de la página 4, y la exportación lo graba dos veces',
            ],
            [
              'Elementos saltados',
              'Un pedido de la página 1 se borra o sale del filtro, y todos los elementos suben una posición',
              'El primer elemento de la página 4 nunca se lee, y la sincronización pierde un registro sin error',
            ],
            [
              'Conteo total caro',
              'La interfaz muestra "página 3 de 9.622", lo que exige COUNT(*) sobre todo el filtro en cada llamada',
              'El conteo cuesta más que la propia página y recorre el mismo volumen que la página más profunda',
            ],
            [
              'Caché de la base contaminada',
              'Los recorridos profundos traen a memoria páginas antiguas que solo ese cliente usa',
              'Las consultas calientes de otras rutas pasan a leer del disco, y la latencia sube para todos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Los dos primeros son los más traicioneros, porque no generan error ni alerta. Una sincronización que pagina por desplazamiento sobre una tabla que recibe escrituras todo el tiempo va a perder y duplicar registros con certeza estadística, y el equipo de datos lo descubrirá meses después comparando totales que no cuadran. El cuarto explica por qué el incidente del inicio afectó al checkout, que no tenía nada que ver con el listado: la exportación expulsó de la caché las páginas que el checkout usaba.',
        },
      ],
    },
    {
      title: 'Paginación por clave: continuar donde se quedó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La alternativa es dejar de pedir una posición y empezar a pedir una continuación. En lugar de "salta 24.950 filas", la consulta dice "dame las siguientes 50 después de este elemento", usando los valores de orden del último elemento de la página anterior como punto de partida. Con un índice en el mismo orden, la base baja directo por el árbol hasta ese punto y lee solo las cincuenta filas siguientes. La página 4.000 pasa a costar lo mismo que la página 1.',
        },
        {
          type: 'code',
          value: `-- Indice en el mismo orden que el listado: filtro de igualdad primero,
-- despues el orden, despues el desempate unico.
CREATE INDEX CONCURRENTLY pedidos_tienda_creado_id_idx
  ON pedidos (tienda_id, creado_en DESC, id DESC);

-- Primera pagina: sin cursor.
SELECT id, creado_en::text AS creado_en_cursor, estado, total
FROM pedidos
WHERE tienda_id = $1
ORDER BY creado_en DESC, id DESC
LIMIT 51;  -- uno mas que el tamano de pagina, para saber si hay siguiente

-- Paginas siguientes: continua despues del ultimo elemento devuelto.
SELECT id, creado_en::text AS creado_en_cursor, estado, total
FROM pedidos
WHERE tienda_id = $1
  AND (creado_en, id) < ($3::timestamptz, $4::bigint)
ORDER BY creado_en DESC, id DESC
LIMIT $2;`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles hacen que esta consulta funcione, y equivocarse en cualquiera produce resultados sutilmente incorrectos. El primero es el desempate: creado_en solo no es único, y dos pedidos creados en el mismo microsegundo, comunes en importaciones por lotes, harían que el cursor saltara o repitiera elementos. Agregar el id al orden y a la comparación vuelve el orden total y determinista. El segundo es la comparación de fila, (creado_en, id) < (valor, valor), que significa "creado_en menor, o igual e id menor". Escribirlo a mano con OR suele impedir el uso del índice, mientras que PostgreSQL usa la forma de fila directamente como condición de índice. El tercero es el índice con las columnas en el mismo orden y dirección que la cláusula ORDER BY, con la columna de igualdad del filtro al frente.',
        },
        {
          type: 'code',
          value: ` Limit  (cost=0.56..44.21 rows=50 width=32)
        (actual time=0.052..0.198 rows=50 loops=1)
   Buffers: shared hit=54
   ->  Index Scan using pedidos_tienda_creado_id_idx on pedidos
         (actual time=0.050..0.187 rows=50 loops=1)
         Index Cond: ((tienda_id = 42) AND
           (ROW(creado_en, id) < ROW('2026-03-14 18:22:07.481213-03'::timestamptz, 88123410)))
         Buffers: shared hit=54
 Execution Time: 0.231 ms`,
        },
        {
          type: 'paragraph',
          value:
            'La línea Index Cond es la confirmación que importa: la comparación de fila aparece dentro de la condición del índice, y no como filtro aplicado después. Si aparece en una línea Filter, la base está leyendo el índice desde el principio y descartando, y la ganancia desaparece. Eso ocurre cuando la dirección de alguna columna del índice no coincide con el orden, cuando la consulta ordena por una expresión distinta de la indexada, o cuando hay un filtro adicional de igualdad que no está al principio del índice. Cada combinación de filtro y orden que ofrece la interfaz necesita un índice compatible, y ese es el costo real de la técnica.',
        },
      ],
    },
    {
      title: 'El cursor en la API: opaco, firmado y sin perder microsegundos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Exponer los valores de orden directamente en la URL, como ?despues_de_fecha=...&despues_de_id=..., funciona, pero ata el contrato de la API a la implementación. Si el orden cambia, si hace falta un nuevo desempate o si el listado empieza a aceptar otro orden, todos los clientes se rompen. El patrón más duradero es un cursor opaco: una cadena que el servidor produce, el cliente devuelve sin interpretar, y que lleva una versión para permitir cambios futuros.',
        },
        {
          type: 'code',
          value: `// Cursor opaco y firmado para paginacion por clave (Express + node-postgres).
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRETO_CURSOR = process.env.SECRETO_CURSOR;
const LIMITE_PREDETERMINADO = 50;
const LIMITE_MAXIMO = 200;

const firmar = (datos) =>
  createHmac('sha256', SECRETO_CURSOR).update(datos).digest('base64url').slice(0, 22);

export function codificarCursor({ creadoEn, id }) {
  const datos = Buffer.from(JSON.stringify({ v: 1, c: creadoEn, i: id })).toString('base64url');
  return datos + '.' + firmar(datos);
}

export function decodificarCursor(cursor) {
  const [datos, firma] = String(cursor).split('.');
  if (!datos || !firma) return null;
  const esperada = Buffer.from(firmar(datos));
  const recibida = Buffer.from(firma);
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
  const { v, c, i } = JSON.parse(Buffer.from(datos, 'base64url').toString('utf8'));
  return v === 1 ? { creadoEn: c, id: i } : null;
}

export async function listarPedidos(req, res) {
  const limite = Math.min(Number(req.query.limite) || LIMITE_PREDETERMINADO, LIMITE_MAXIMO);
  const cursor = req.query.cursor ? decodificarCursor(req.query.cursor) : null;
  if (req.query.cursor && !cursor) {
    return res.status(400).json({ error: 'cursor_invalido' });
  }

  const parametros = [req.tiendaId, limite + 1];
  let continuacion = '';
  if (cursor) {
    parametros.push(cursor.creadoEn, cursor.id);
    continuacion = 'AND (creado_en, id) < ($3::timestamptz, $4::bigint)';
  }

  const { rows } = await db.query(
    'SELECT id, creado_en::text AS creado_en_cursor, estado, total ' +
      'FROM pedidos WHERE tienda_id = $1 ' + continuacion +
      ' ORDER BY creado_en DESC, id DESC LIMIT $2',
    parametros,
  );

  const haySiguiente = rows.length > limite;
  const elementos = haySiguiente ? rows.slice(0, limite) : rows;
  const ultimo = elementos[elementos.length - 1];

  return res.json({
    elementos: elementos.map(({ creado_en_cursor, ...pedido }) => ({ ...pedido, creado_en: creado_en_cursor })),
    siguiente_cursor: haySiguiente
      ? codificarCursor({ creadoEn: ultimo.creado_en_cursor, id: ultimo.id })
      : null,
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que más defectos produce en producción está en la columna creado_en_cursor. El timestamptz de PostgreSQL tiene precisión de microsegundos, y el Date de JavaScript solo guarda milisegundos. Si el cursor se arma a partir del valor convertido a Date, el punto de continuación pierde los tres últimos dígitos, y los elementos creados dentro del mismo milisegundo que el último de la página se saltan o se repiten, de forma intermitente y casi imposible de reproducir. Seleccionar la columna como texto conserva la precisión completa, y el cast de vuelta a timestamptz en la consulta siguiente reconstruye exactamente el mismo valor. Por la misma razón el id viaja como texto: node-postgres devuelve bigint como cadena para no perder precisión por encima de dos elevado a cincuenta y tres.',
        },
        {
          type: 'list',
          items: [
            'La firma impide que el cliente fabrique cursores para saltar directo a cualquier punto de la tabla, lo que reabriría parte del problema y permitiría sondear datos por valor de orden.',
            'El campo de versión permite cambiar el formato del cursor en el futuro aceptando el antiguo durante un periodo, sin romper clientes en medio de una paginación.',
            'Pedir un elemento más que el límite responde si existe página siguiente sin una segunda consulta y sin COUNT.',
            'El límite máximo por página es parte de la protección: sin él, un cliente pide diez mil elementos por página y reproduce el costo por otro camino.',
          ],
        },
      ],
    },
    {
      title: 'Migrar clientes y pantallas que dependen del número de página',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La consulta nueva es la parte fácil. La parte difícil es que la API ya tiene clientes que envían ?pagina=4000, y la interfaz tiene un paginador numérico y un botón de última página. Ninguno de los dos se puede cambiar de un día para otro, y la paginación por clave no ofrece lo que piden: no existe una forma barata de saltar a la página 4.000 sin recorrer las anteriores, porque esa es justamente la operación cara.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumenta la ruta antigua con la profundidad pedida y el cliente que la pidió, para descubrir quién navega realmente más allá de las primeras páginas. En casi todos los casos son dos o tres clientes automatizados, y no personas.',
            'Publica el parámetro cursor junto a pagina, devolviendo siguiente_cursor en todas las respuestas, incluidas las pedidas por número de página, para que un cliente pueda empezar por número y continuar por cursor.',
            'Impón un techo de profundidad al parámetro antiguo, por ejemplo diez mil elementos, y por encima de él responde 400 con un mensaje que apunte al parámetro cursor y a la documentación. Ese techo por sí solo elimina el incidente, incluso antes de que migre cualquier cliente.',
            'Ofrece una exportación asíncrona para quien necesita todo el historial: el cliente la pide, un job recorre la tabla por clave a un ritmo controlado, genera el archivo y avisa cuando está listo. Los scripts de exportación por paginación son el mayor consumidor de páginas profundas, y este es el camino correcto para ellos.',
            'En la interfaz, cambia el paginador numérico por "cargar más" o por anterior y siguiente, y sustituye el salto a la página N por filtros que las personas realmente usan, como rango de fechas, estado y búsqueda.',
            'Elimina el parámetro antiguo cuando la métrica muestre que nadie pasa ya del techo, con una fecha comunicada a los clientes que todavía lo usan.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer paso merece énfasis porque resuelve el riesgo inmediato con un cambio de pocas líneas. Motores de búsqueda como Elasticsearch hacen exactamente eso por defecto, rechazando desplazamientos por encima de diez mil resultados, y por la misma razón. El techo convierte un costo ilimitado en un costo conocido, y el error con instrucciones de cómo migrar hace que los clientes automatizados aparezcan solos, en lugar de seguir invisibles hasta el próximo incidente.',
        },
        {
          type: 'paragraph',
          value:
            'Para navegar hacia atrás, la misma técnica funciona con la comparación invertida: la consulta usa mayor que en lugar de menor que, ordena de forma ascendente, y el servidor invierte el resultado antes de devolverlo. El cursor lleva la dirección junto con los valores, y la respuesta pasa a tener anterior_cursor y siguiente_cursor. No hace falta guardar estado en el servidor para esto.',
        },
      ],
    },
    {
      title: 'Cuándo el OFFSET todavía sirve, y qué hacer con el conteo total',
      blocks: [
        {
          type: 'paragraph',
          value:
            'OFFSET no está prohibido. Es la herramienta equivocada cuando la profundidad no tiene límite y la tabla es grande, y sigue siendo razonable cuando alguna de las dos cosas no se cumple. Una pantalla administrativa sobre una tabla de configuración con tres mil filas, un listado en el que el filtro siempre reduce el resultado a unos cientos de elementos, o un informe interno que nadie automatiza pueden usar número de página sin riesgo, y la simplicidad de implementarlo y de saltar a una página específica tiene valor real en esos casos.',
        },
        {
          type: 'table',
          columns: ['Situación', 'Técnica adecuada', 'Por qué'],
          rows: [
            ['Tabla pequeña o filtro que siempre acota el resultado', 'OFFSET', 'El costo máximo es bajo y conocido'],
            ['Feed, historial o listado de API pública', 'Paginación por clave con cursor', 'Profundidad ilimitada y escrituras concurrentes'],
            ['Exportación o sincronización completa', 'Job asíncrono recorriendo por clave', 'Necesita leer todo sin duplicar ni saltar'],
            ['Búsqueda textual con relevancia', 'Límite de profundidad en el motor de búsqueda', 'Nadie lee el resultado 20.000 de una búsqueda'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El conteo total es el otro costo que suele sobrevivir a la migración. "Mostrando 1 a 50 de 481.120" exige COUNT(*) sobre todo el filtro, que en PostgreSQL recorre todas las filas visibles, y eso ocurre en cada llamada. En la mayoría de las interfaces, el número exacto no se usa para nada más que mostrarlo, y se puede sustituir por un conteo con techo, que deja de contar al pasar un límite, o por una estimación del planificador cuando basta el orden de magnitud.',
        },
        {
          type: 'code',
          value: `-- Conteo con techo: deja de contar al pasar de 10.000 filas.
-- La interfaz muestra "10.000+" cuando el resultado llega al techo.
SELECT count(*) AS total
FROM (
  SELECT 1
  FROM pedidos
  WHERE tienda_id = $1
  LIMIT 10001
) AS muestra;

-- Estimacion de la tabla entera, sin recorrer nada, a partir de las
-- estadisticas que mantienen ANALYZE y el autovacuum.
SELECT reltuples::bigint AS estimacion
FROM pg_class
WHERE oid = 'pedidos'::regclass;`,
        },
        {
          type: 'paragraph',
          value:
            'El conteo con techo cuesta como máximo la lectura de diez mil entradas del índice, sin importar el tamaño de la tienda, y resuelve el caso de uso real de la interfaz, que es decirle al usuario si el resultado es pequeño o grande. Cuando el producto exige el número exacto, por ejemplo en un informe financiero, el lugar correcto es un conteo mantenido por trigger o por agregación periódica, y no un COUNT cada vez que se abre la pantalla.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Un índice mejor no resuelve la paginación por OFFSET?',
      answer:
        'No, y esa es la confusión más común. El índice correcto es necesario para cualquier técnica de paginación, porque sin él la base ordena el resultado entero antes de devolver la primera página. Pero con OFFSET, incluso el índice perfecto solo permite que la base recorra las filas en orden, y todavía tiene que leer y descartar todas las filas anteriores al desplazamiento pedido. El plan de una página profunda con OFFSET ya usa el índice, y el tiempo sigue creciendo linealmente con el número de página. Un índice de cobertura, que incluye todas las columnas seleccionadas y permite un recorrido solo sobre el índice, reduce el costo por fila porque evita visitar la tabla, pero no cambia la proporción: la página 4.000 sigue leyendo doscientas mil entradas. Lo que cambia el costo de proporcional a la profundidad a constante es cambiar la pregunta, de posición a continuación, y eso solo lo hace la paginación por clave.',
    },
    {
      question: '¿Y si el orden es por una columna que cambia, como estado o puntuación?',
      answer:
        'La paginación por clave sigue funcionando, pero con una semántica que hay que entender. El cursor guarda los valores de orden del último elemento visto, y la página siguiente empieza después de esos valores en el estado actual de la tabla. Si un elemento cambia de puntuación mientras el cliente pagina, puede aparecer de nuevo en una página posterior o no aparecer más, porque salió de la región que todavía no se leyó. Eso no es peor que el OFFSET, que tiene el mismo problema y además agrega saltos y duplicados causados por inserciones. Para interfaces, ese comportamiento suele ser aceptable. Para sincronización, donde no se puede perder ningún elemento, el orden debe ser por una columna que solo crece, como un identificador secuencial o una columna actualizado_en con desempate por id, y el cliente tiene que aceptar recibir el mismo elemento más de una vez y deduplicar por clave. Cuando la interfaz necesita un resultado estable sobre un orden volátil, la solución es materializar el resultado en una tabla temporal o en un snapshot con identificador y paginar sobre él.',
    },
    {
      question: '¿Cómo ofrecer "ir a la página N" sin OFFSET?',
      answer:
        'En la mayoría de los casos, la mejor respuesta es preguntar para qué quiere el usuario ir a la página N. Casi siempre es para llegar a un periodo, a una letra del alfabeto o a un estado, y un filtro por fecha, una búsqueda o un salto por letra atienden esa intención con una consulta por clave barata, que empieza directamente en el punto deseado. Cuando el salto por número es realmente necesario, existen compromisos razonables. Uno es limitar los saltos a las primeras decenas de páginas, donde el OFFSET es barato, y ofrecer solo anterior y siguiente a partir de ahí. Otro es mantener una tabla auxiliar con los valores de orden cada mil elementos, actualizada periódicamente, lo que permite saltar cerca de la página pedida por clave y completar con un OFFSET pequeño. Lo que no debe existir es un botón de última página sobre una tabla de millones de filas, porque es, literalmente, la consulta más cara que la pantalla puede producir, y suele pulsarse más de lo que uno imagina.',
    },
  ],
  conclusion: {
    title: 'Paginar por posición es pedirle a la base que cuente, y contar no escala',
    description:
      'La paginación por OFFSET funciona en desarrollo y en las primeras páginas, y por eso pasa desapercibida hasta que un script, una integración o un rastreador de búsqueda navega lo bastante profundo como para convertir un listado inocente en el mayor consumidor de la base. Además de la lentitud, duplica y salta registros cuando la tabla recibe escrituras y contamina la caché que usan las demás rutas. La paginación por clave, con desempate único, comparación de fila e índice en el mismo orden, hace que cualquier página cueste lo mismo que la primera, y un cursor opaco, firmado y con precisión completa convierte la técnica en un contrato de API duradero. Un techo de profundidad en el parámetro antiguo resuelve el riesgo inmediato mientras los clientes migran. Puedo revisar los listados de tu API y de tu panel, identificar qué consultas crecen con la profundidad y planificar la migración a cursor sin romper los clientes que ya existen.',
    cta: 'Hablar sobre el rendimiento de mi base de datos',
  },
  related: [
    {
      label: 'El índice que la base decidió ignorar: cuándo el plan de consulta cambia solo',
      to: '/blog/indice-que-o-banco-decidiu-ignorar-plano-de-consulta-muda-sozinho',
    },
    {
      label: 'Contrato de API sin versión: evolucionar el payload sin romper al cliente antiguo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
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
