// Conteudo do artigo: collation que muda depois da atualizacao do sistema operacional. Por que
// o indice B-tree de texto guarda uma ordem definida pela glibc, o que acontece quando a
// replica ou o servidor novo usa outra versao da biblioteca, como detectar com a versao de
// collation e o amcheck e como corrigir com REINDEX, limpeza de duplicatas e REFRESH VERSION.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const comments = {
  pt: {
    o1: 'Servidor antigo, CentOS 7 (glibc 2.17): o hífen é ignorado no primeiro nível.',
    o2: 'Servidor novo, Rocky Linux 9 (glibc 2.34): o hífen passa a contar.',
    o3: 'A mesma comparação, dentro do Postgres, muda de resposta sem ninguém mudar o banco.',
    o4: 'O índice foi construído com a ordem antiga. Pela PK a linha existe:',
    o5: 'Pelo índice único, que agora desce pelo ramo errado da árvore, ela some:',
    o6: 'E o mesmo índice que não encontra a linha também não impede a duplicata:',
    v1: 'PostgreSQL 15+: versão registrada no banco contra a versão que o SO entrega agora.',
    v2: 'Collations explícitas (libc e ICU): mesma comparação, por collation.',
    v3: 'O aviso que fica no log a cada conexão enquanto nada for corrigido.',
    a1: 'Índices B-tree com pelo menos uma coluna ou expressão em collation da libc diferente de C.',
    a2: 'amcheck lê o índice e o heap; precisa de superusuário ou de GRANT nas funções.',
    a3: 'heapallindexed = true confere também se toda linha do heap está no índice.',
    a4: 'REINDEX CONCURRENTLY não roda dentro de transação: cada índice em um comando.',
    a5: 'Falhou: sobra um índice inválido com sufixo _ccnew, que precisa de DROP INDEX CONCURRENTLY.',
    a6: 'Depois de reconstruir tudo: ALTER DATABASE ... REFRESH COLLATION VERSION.',
    a7: 'O nome vem de ::regclass::text, já com aspas e schema quando necessário.',
    d1: 'Desliga os índices só para encontrar as duplicatas: o GROUP BY não pode confiar no índice corrompido.',
    d2: 'Regra do negócio: mantém o produto mais antigo e aponta as referências para ele.',
    d3: 'A partir daqui os índices voltam: produto_id é bigint e não depende de collation.',
    d4: 'Com as duplicatas removidas, o índice único pode ser reconstruído.',
    d5: 'Só depois de reconstruir todos os índices afetados do banco.',
  },
  en: {
    o1: 'Old server, CentOS 7 (glibc 2.17): the hyphen is ignored at the first level.',
    o2: 'New server, Rocky Linux 9 (glibc 2.34): the hyphen now counts.',
    o3: 'The same comparison, inside Postgres, changes its answer without anyone touching the database.',
    o4: 'The index was built with the old order. Through the PK the row exists:',
    o5: 'Through the unique index, which now descends the wrong branch of the tree, it disappears:',
    o6: 'And the same index that cannot find the row does not prevent the duplicate either:',
    v1: 'PostgreSQL 15+: version recorded in the database against the version the OS provides now.',
    v2: 'Explicit collations (libc and ICU): the same comparison, per collation.',
    v3: 'The warning that lands in the log on every connection until it is fixed.',
    a1: 'B-tree indexes with at least one column or expression in a libc collation other than C.',
    a2: 'amcheck reads the index and the heap; it needs superuser or a GRANT on its functions.',
    a3: 'heapallindexed = true also checks that every heap row is in the index.',
    a4: 'REINDEX CONCURRENTLY cannot run inside a transaction: one command per index.',
    a5: 'Failed: an invalid index with the _ccnew suffix is left behind and needs DROP INDEX CONCURRENTLY.',
    a6: 'After rebuilding everything: ALTER DATABASE ... REFRESH COLLATION VERSION.',
    a7: 'The name comes from ::regclass::text, already quoted and schema-qualified when needed.',
    d1: 'Turns indexes off only to find the duplicates: the GROUP BY cannot trust the corrupted index.',
    d2: 'Business rule: keep the oldest product and point the references to it.',
    d3: 'From here on indexes come back: produto_id is bigint and does not depend on collation.',
    d4: 'With the duplicates removed, the unique index can be rebuilt.',
    d5: 'Only after rebuilding every affected index in the database.',
  },
  es: {
    o1: 'Servidor antiguo, CentOS 7 (glibc 2.17): el guion se ignora en el primer nivel.',
    o2: 'Servidor nuevo, Rocky Linux 9 (glibc 2.34): el guion pasa a contar.',
    o3: 'La misma comparación, dentro de Postgres, cambia de respuesta sin que nadie toque la base.',
    o4: 'El índice se construyó con el orden antiguo. Por la PK la fila existe:',
    o5: 'Por el índice único, que ahora baja por la rama equivocada del árbol, desaparece:',
    o6: 'Y el mismo índice que no encuentra la fila tampoco impide el duplicado:',
    v1: 'PostgreSQL 15+: versión registrada en la base contra la versión que entrega el SO ahora.',
    v2: 'Collations explícitas (libc e ICU): la misma comparación, por collation.',
    v3: 'El aviso que queda en el log en cada conexión mientras no se corrija.',
    a1: 'Índices B-tree con al menos una columna o expresión en una collation de libc distinta de C.',
    a2: 'amcheck lee el índice y el heap; necesita superusuario o GRANT sobre sus funciones.',
    a3: 'heapallindexed = true también verifica que toda fila del heap esté en el índice.',
    a4: 'REINDEX CONCURRENTLY no corre dentro de una transacción: un comando por índice.',
    a5: 'Falló: queda un índice inválido con sufijo _ccnew, que necesita DROP INDEX CONCURRENTLY.',
    a6: 'Después de reconstruir todo: ALTER DATABASE ... REFRESH COLLATION VERSION.',
    a7: 'El nombre sale de ::regclass::text, ya con comillas y schema cuando hace falta.',
    d1: 'Apaga los índices solo para encontrar los duplicados: el GROUP BY no puede confiar en el índice corrupto.',
    d2: 'Regla de negocio: mantiene el producto más antiguo y apunta las referencias hacia él.',
    d3: 'A partir de aquí los índices vuelven: produto_id es bigint y no depende de la collation.',
    d4: 'Con los duplicados eliminados, el índice único puede reconstruirse.',
    d5: 'Solo después de reconstruir todos los índices afectados de la base.',
  },
};

const orderCode = (c) => `# ${c.o1}
$ printf '1-1\\n11\\n1-2\\n1\\n' | LC_COLLATE=en_US.UTF-8 sort
1
1-1
11
1-2

# ${c.o2}
$ printf '1-1\\n11\\n1-2\\n1\\n' | LC_COLLATE=en_US.UTF-8 sort
1
1-1
1-2
11

-- ${c.o3}
SELECT '1-2' < '11' COLLATE "en_US.utf8";
-- glibc 2.17: f    glibc 2.34: t

-- ${c.o4}
SELECT id, sku FROM produtos WHERE id = 88412;
  id   |  sku
-------+-------
 88412 | AB-12
(1 row)

-- ${c.o5}
SELECT id FROM produtos WHERE tenant_id = 731 AND sku = 'AB-12';
(0 rows)

-- ${c.o6}
INSERT INTO produtos (tenant_id, sku, nome) VALUES (731, 'AB-12', 'Cabo 12 vias')
ON CONFLICT (tenant_id, sku) DO NOTHING;
INSERT 0 1`;

const versionCode = (c) => `-- ${c.v1}
SELECT datname,
       datcollate,
       datcollversion                            AS versao_registrada,
       pg_database_collation_actual_version(oid) AS versao_do_so
  FROM pg_database
 WHERE datname = current_database();

 datname | datcollate  | versao_registrada | versao_do_so
---------+-------------+-------------------+--------------
 loja    | pt_BR.UTF-8 | 2.17              | 2.34

-- ${c.v2}
SELECT collname, collprovider, collversion,
       pg_collation_actual_version(oid) AS versao_do_so
  FROM pg_collation
 WHERE collversion IS DISTINCT FROM pg_collation_actual_version(oid);

-- ${c.v3}
WARNING:  database "loja" has a collation version mismatch
DETAIL:  The database was created using collation version 2.17, but the operating system provides version 2.34.
HINT:  Rebuild all objects in this database that use the default collation and run ALTER DATABASE loja REFRESH COLLATION VERSION, or build PostgreSQL with the right library version.`;

const auditCode = (c) => `// auditar-collation.js
// node auditar-collation.js            -> relatorio
// node auditar-collation.js --reindex  -> relatorio + REINDEX CONCURRENTLY
import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const reindexar = process.argv.includes('--reindex');

// ${c.a1}
const SQL_INDICES_AFETADOS = \`
  SELECT DISTINCT
         i.indrelid::regclass::text   AS tabela,
         i.indexrelid::regclass::text AS indice,
         i.indisunique                AS unico
    FROM pg_index i
    JOIN pg_class c      ON c.oid = i.indexrelid
    JOIN pg_am am        ON am.oid = c.relam
    CROSS JOIN LATERAL unnest(i.indcollation::oid[]) AS col(oid)
    JOIN pg_collation co ON co.oid = col.oid
    JOIN pg_database d   ON d.datname = current_database()
   WHERE am.amname = 'btree'
     AND c.relnamespace <> 'pg_catalog'::regnamespace
     AND (
           (co.collprovider = 'c' AND co.collname NOT IN ('C', 'POSIX'))
        OR (co.collprovider = 'd' AND d.datlocprovider = 'c'
            AND d.datcollate NOT IN ('C', 'POSIX'))
         )
   ORDER BY 1, 2\`;

async function main() {
  await client.connect();
  try {
    // ${c.a2}
    await client.query('CREATE EXTENSION IF NOT EXISTS amcheck');

    const { rows: indices } = await client.query(SQL_INDICES_AFETADOS);
    const relatorio = [];

    for (const { tabela, indice, unico } of indices) {
      let amcheck = 'ok';
      try {
        // ${c.a3}
        await client.query('SELECT bt_index_check($1::regclass, true)', [indice]);
      } catch (erro) {
        amcheck = erro.message;
      }
      relatorio.push({ tabela, indice, unico, amcheck });
    }

    console.table(relatorio);
    if (!reindexar) return;

    for (const { indice } of relatorio) {
      try {
        // ${c.a4}
        // ${c.a7}
        await client.query(\`REINDEX INDEX CONCURRENTLY \${indice}\`);
        console.log(\`ok: \${indice}\`);
      } catch (erro) {
        // ${c.a5}
        console.error(\`erro: \${indice}: \${erro.message}\`);
        process.exitCode = 1;
      }
    }
    // ${c.a6}
  } finally {
    await client.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});`;

const dedupeCode = (c) => `BEGIN;

-- ${c.d1}
SET LOCAL enable_indexscan = off;
SET LOCAL enable_indexonlyscan = off;
SET LOCAL enable_bitmapscan = off;

-- ${c.d2}
CREATE TEMP TABLE duplicados ON COMMIT DROP AS
SELECT id, manter
  FROM (SELECT id, min(id) OVER (PARTITION BY tenant_id, sku) AS manter
          FROM produtos) t
 WHERE id <> manter;

-- ${c.d3}
RESET enable_indexscan;
RESET enable_indexonlyscan;
RESET enable_bitmapscan;

UPDATE itens_pedido ip
   SET produto_id = d.manter
  FROM duplicados d
 WHERE ip.produto_id = d.id;

DELETE FROM produtos p
 USING duplicados d
 WHERE p.id = d.id;

COMMIT;

-- ${c.d4}
REINDEX INDEX CONCURRENTLY produtos_tenant_sku_key;

-- ${c.d5}
ALTER DATABASE loja REFRESH COLLATION VERSION;`;

const diagramaPt = `D-30      CentOS 7 chega ao fim de suporte; plano: réplica em Rocky Linux 9 e failover
D0 22:00  réplica física (streaming) no servidor novo, mesmo PostgreSQL 15, pg_basebackup
D0 23:40  promote da réplica, aplicação apontada para o servidor novo; 4 minutos de troca
D0 23:41  WARNING de collation version mismatch começa a aparecer no log, a cada conexão
D1 09:15  suporte: produtos com SKU como 'AB-12' retornam 404 na API, mas aparecem na listagem
D3 14:00  importador de catálogo criou 4.137 produtos duplicados apesar do UNIQUE (tenant_id, sku)
D3 16:30  enable_indexscan = off encontra as linhas; bt_index_check acusa ordem violada
D3 18:00  limpeza de duplicatas, REINDEX CONCURRENTLY de 23 índices, REFRESH COLLATION VERSION`;

const diagramaEn = `D-30      CentOS 7 reaches end of life; plan: replica on Rocky Linux 9 and failover
D0 22:00  physical (streaming) replica on the new server, same PostgreSQL 15, pg_basebackup
D0 23:40  replica promoted, application pointed to the new server; 4 minute switch
D0 23:41  collation version mismatch WARNING starts showing up in the log, on every connection
D1 09:15  support: products with SKUs like 'AB-12' return 404 in the API but show in the listing
D3 14:00  catalog importer created 4,137 duplicate products despite UNIQUE (tenant_id, sku)
D3 16:30  enable_indexscan = off finds the rows; bt_index_check reports violated order
D3 18:00  duplicate cleanup, REINDEX CONCURRENTLY of 23 indexes, REFRESH COLLATION VERSION`;

const diagramaEs = `D-30      CentOS 7 llega al fin de soporte; plan: réplica en Rocky Linux 9 y failover
D0 22:00  réplica física (streaming) en el servidor nuevo, mismo PostgreSQL 15, pg_basebackup
D0 23:40  promote de la réplica, aplicación apuntada al servidor nuevo; 4 minutos de cambio
D0 23:41  el WARNING de collation version mismatch empieza a aparecer en el log, en cada conexión
D1 09:15  soporte: productos con SKU como 'AB-12' devuelven 404 en la API pero aparecen en el listado
D3 14:00  el importador de catálogo creó 4.137 productos duplicados a pesar del UNIQUE (tenant_id, sku)
D3 16:30  enable_indexscan = off encuentra las filas; bt_index_check reporta orden violado
D3 18:00  limpieza de duplicados, REINDEX CONCURRENTLY de 23 índices, REFRESH COLLATION VERSION`;

const pt = {
  intro:
    'Uma plataforma de e-commerce B2B precisava sair do CentOS 7, que tinha chegado ao fim de suporte. O plano parecia o mais seguro possível: subir uma réplica física do PostgreSQL 15 num servidor novo com Rocky Linux 9, esperar ela alcançar o primário e promover. A troca levou quatro minutos e nenhum teste falhou. Na manhã seguinte, o suporte começou a receber chamados de produtos que apareciam na listagem mas davam 404 quando buscados pelo SKU. Três dias depois, o importador de catálogo tinha criado 4.137 produtos duplicados numa tabela com UNIQUE (tenant_id, sku). Nada no banco tinha mudado: mesmos dados, mesma versão do Postgres, mesmos índices copiados byte a byte. O que mudou foi a glibc, que define como o Postgres compara textos em collations como pt_BR.UTF-8, e com ela a ordem que o índice B-tree assume ao ser percorrido. Este artigo explica por que um índice de texto depende da versão da biblioteca do sistema operacional, quais estratégias de migração carregam o problema e quais não, como detectar com a versão de collation e o amcheck e como corrigir com REINDEX, limpeza de duplicatas e REFRESH COLLATION VERSION.',
  sections: [
    {
      title: 'O failover sem erro que fez o índice único deixar passar duplicatas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A tabela produtos tinha 12 milhões de linhas, chave primária bigint e um índice único em (tenant_id, sku), usado tanto pela API de busca por SKU quanto pelo ON CONFLICT do importador. Os SKUs vinham dos ERPs dos clientes e misturavam letras, números, hífens e espaços. Era exatamente o tipo de texto em que a ordenação linguística mudou entre versões da glibc.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O diagnóstico demorou porque os sintomas pareciam bugs da aplicação. A busca por SKU falhava em 0,3% dos casos, sempre com SKUs que tinham hífen ou espaço. O mesmo produto aparecia na listagem, que filtrava por tenant e ordenava por nome. O importador não registrava erro, porque o ON CONFLICT nunca disparava: para o índice, a linha antiga não existia. O aviso que explicava tudo estava no log desde o primeiro minuto, repetido em cada conexão, mas era um WARNING no meio de milhares de linhas e ninguém olhava o log do banco depois de uma troca que tinha dado certo.',
        },
      ],
    },
    {
      title: 'Por que um índice de texto depende da glibc',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um índice B-tree guarda as chaves em ordem e usa essa ordem para navegar: em cada página, compara a chave procurada com as chaves separadoras e desce pelo ramo correspondente. Para tipos como bigint ou timestamptz, a comparação é fixa. Para text e varchar com uma collation da libc, como pt_BR.UTF-8 ou en_US.UTF-8, o Postgres chama strcoll da glibc, e a ordem vem das tabelas de locale da biblioteca instalada no sistema operacional. O índice não guarda a regra de comparação, só o resultado dela: a posição de cada chave foi decidida pela glibc que estava instalada quando a linha foi inserida.',
        },
        {
          type: 'paragraph',
          value:
            'Na glibc 2.28, as tabelas de collation foram atualizadas para uma versão nova da ISO 14651 e a ordem de muitos textos mudou, especialmente com pontuação, hífens e espaços. Debian 10, Ubuntu 18.10 e RHEL 8 em diante já vêm com a regra nova; CentOS 7, Ubuntu 18.04 e Debian 9 têm a antiga. Uma troca entre esses dois grupos é praticamente garantia de índices de texto com ordem errada.',
        },
        {
          type: 'code',
          value: orderCode(comments.pt),
        },
        {
          type: 'list',
          items: [
            'Busca por igualdade ou faixa: a descida pela árvore usa a comparação nova sobre chaves posicionadas pela antiga, cai na página errada e conclui que a chave não existe.',
            'UNIQUE e PRIMARY KEY em texto: a verificação de unicidade é a mesma busca. Se ela não encontra a chave existente, a inserção duplicada passa, e o ON CONFLICT nunca dispara.',
            'ORDER BY atendido pelo índice devolve a ordem antiga, enquanto um Sort devolve a nova. Paginação por keyset que mistura os dois pula ou repete linhas.',
            'Merge join entre colunas de texto pode perder pares, porque assume que as duas entradas estão na mesma ordem.',
            'Particionamento por faixa de texto pode ter linhas em partições cujos limites, pela regra nova, não as aceitariam mais.',
          ],
        },
      ],
    },
    {
      title: 'O que é afetado e o que não é',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O problema está restrito a estruturas que dependem da ordem de texto definida pela libc. Saber exatamente quais são permite estimar o tamanho do REINDEX antes da migração, em vez de reconstruir o banco inteiro por precaução ou, pior, não reconstruir nada.',
        },
        {
          type: 'table',
          columns: ['Estrutura', 'Afetada?', 'Por quê'],
          rows: [
            ['B-tree em text ou varchar com collation libc (pt_BR.UTF-8, en_US.UTF-8)', 'Sim', 'A ordem das chaves vem de strcoll da glibc'],
            ['PRIMARY KEY e UNIQUE em colunas de texto', 'Sim, e aceita duplicatas', 'A verificação de unicidade é uma busca no índice'],
            ['Índice de expressão como lower(email)', 'Sim', 'O resultado é texto ordenado pela mesma collation'],
            ['Índice com COLLATE "C" ou text_pattern_ops', 'Não', 'Comparação byte a byte, independente de locale'],
            ['B-tree em bigint, integer, uuid, timestamptz, numeric', 'Não', 'Comparação definida pelo próprio tipo'],
            ['Índice hash em text', 'Não', 'Depende só de igualdade, que em collation determinística é igualdade de bytes'],
            ['Particionamento por faixa em coluna de texto', 'Sim', 'Os limites das partições são comparados pela collation'],
            ['Collation ICU', 'Depende da versão da ICU, não da glibc', 'O Postgres registra a versão por collation e avisa quando muda'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No incidente, 23 índices entravam na lista: chaves únicas em SKU, e-mail e código externo, índices de expressão em lower(email) e índices compostos com uma coluna de texto depois do tenant_id. Os índices em ids, datas e valores, que eram a maioria, não precisavam de nada.',
        },
      ],
    },
    {
      title: 'Detectar antes que o cliente perceba: versão de collation e amcheck',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A partir do PostgreSQL 15, o banco registra em pg_database.datcollversion a versão da glibc usada quando a collation padrão foi definida, e compara com a versão atual a cada conexão. Collations explícitas têm o mesmo controle em pg_collation.collversion. Essa comparação é a primeira verificação a fazer depois de qualquer troca de servidor, imagem ou sistema operacional, e deveria fazer parte do checklist da migração.',
        },
        {
          type: 'code',
          value: versionCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'A versão diz que há risco, não onde há dano. Para isso existe a extensão amcheck: bt_index_check percorre o índice e verifica se as chaves estão na ordem que o comparador atual espera, e com heapallindexed = true também confere se cada linha da tabela está no índice. O script abaixo lista os índices B-tree que dependem de collation da libc, roda o amcheck em cada um e, com --reindex, reconstrói todos sem bloquear escrita.',
        },
        {
          type: 'code',
          value: auditCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'Dois cuidados. bt_index_check com heapallindexed lê o índice e a tabela inteira, então rode fora do pico ou numa réplica com a mesma glibc do servidor novo. E o amcheck pode não acusar um índice cuja ordem mudou só em pontos que a verificação não alcança: use o resultado para medir o dano e priorizar, mas reconstrua todos os índices da lista, não só os que falharam.',
        },
      ],
    },
    {
      title: 'Corrigir: duplicatas primeiro, REINDEX depois, versão por último',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A ordem importa. Um índice único não pode ser reconstruído enquanto houver duplicatas na tabela: o REINDEX falha com could not create unique index, e no modo CONCURRENTLY ainda deixa um índice inválido com sufixo _ccnew. E a versão registrada só deve ser atualizada quando todos os índices afetados estiverem reconstruídos, porque o REFRESH COLLATION VERSION apenas silencia o aviso, sem corrigir nada.',
        },
        {
          type: 'ordered',
          items: [
            'Tirar do ar ou pausar os processos que inserem em massa nas tabelas afetadas, como importadores, para que novas duplicatas não entrem durante a correção.',
            'Encontrar as duplicatas com os índices desligados na sessão, porque um GROUP BY resolvido pelo índice corrompido pode esconder justamente os grupos repetidos.',
            'Decidir a regra de fusão com o negócio: qual linha fica, o que acontece com estoque, preço e pedidos que apontam para a duplicata.',
            'Reconstruir com REINDEX INDEX CONCURRENTLY, um índice por vez, começando pelos únicos. Se algum falhar, remover o _ccnew com DROP INDEX CONCURRENTLY e tratar o que sobrou.',
            'Rodar o amcheck de novo em todos os índices da lista e só então executar ALTER DATABASE ... REFRESH COLLATION VERSION.',
          ],
        },
        {
          type: 'code',
          value: dedupeCode(comments.pt),
        },
        {
          type: 'paragraph',
          value:
            'No incidente, a limpeza das 4.137 duplicatas e os 23 REINDEX CONCURRENTLY levaram pouco menos de duas horas, sem janela de manutenção. O maior índice, de 1,1 GB, levou 14 minutos. Depois disso, o amcheck passou em todos os índices, a busca por SKU voltou a 100% e o WARNING saiu do log.',
        },
      ],
    },
    {
      title: 'Planejar a troca de sistema operacional e não repetir o problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A causa raiz não foi o Rocky Linux nem a glibc nova, e sim a escolha de uma estratégia de migração que copia os índices sem reconstruí-los. Cada caminho tem um custo diferente de janela e de risco de collation, e essa comparação precisa ser feita antes de escolher.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'O que acontece com os índices', 'Janela', 'Risco de collation'],
          rows: [
            ['pg_dump e pg_restore no servidor novo', 'Construídos no SO novo', 'Proporcional ao tamanho do banco', 'Nenhum'],
            ['Replicação lógica para o servidor novo', 'Construídos no assinante, no SO novo', 'Minutos, só na troca', 'Nenhum'],
            ['Réplica física (streaming) no SO novo e promote', 'Copiados byte a byte', 'Segundos', 'Alto: todos os índices de texto com libc'],
            ['Atualizar o SO no mesmo servidor', 'Mantidos', 'Tempo do upgrade', 'Alto'],
            ['Snapshot do volume em máquina com outra imagem', 'Mantidos', 'Minutos', 'Alto'],
          ],
        },
        {
          type: 'list',
          items: [
            'Se a janela permite, prefira replicação lógica ou dump e restore: os índices nascem no sistema novo e o problema não existe. É a mesma técnica usada para upgrades de versão major sem janela.',
            'Se precisar de réplica física, inclua o REINDEX CONCURRENTLY dos índices afetados no plano, antes de liberar escrita, e meça o tempo num ambiente com o mesmo volume.',
            'Nunca misture versões de glibc entre primário e réplicas físicas. Uma réplica de leitura num SO diferente responde consultas erradas mesmo sem failover.',
            'Para colunas que são identificadores, como SKU, código externo, slug e chave de idempotência, use COLLATE "C": a ordenação linguística não serve para nada nelas e a comparação byte a byte é estável e mais rápida.',
            'Em bancos novos, avalie o provedor builtin com C.UTF-8 (PostgreSQL 17+), que não depende da glibc, ou ICU, cuja versão o Postgres acompanha por collation.',
            'Monitore o log do banco por collation version mismatch, junto com os outros WARNING, e faça a verificação de datcollversion parte do checklist de qualquer troca de máquina.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se o Postgres e os dados são os mesmos, por que a ordem muda?',
      answer:
        'Porque, em collations da libc, o Postgres não implementa a comparação de textos: ele chama strcoll da glibc. Quando a glibc muda as regras de ordenação, a mesma comparação passa a dar outro resultado, mas os índices já construídos continuam com as chaves na posição decidida pela regra antiga. A árvore fica inconsistente com o comparador que a percorre.',
    },
    {
      question: 'O REFRESH COLLATION VERSION resolve o problema?',
      answer:
        'Não. Ele só atualiza a versão registrada no catálogo para a versão atual, o que faz o aviso parar. Os índices continuam com a ordem antiga. O comando deve ser o último passo, depois de reconstruir todos os índices e demais objetos que dependem da collation, e nunca a primeira reação ao WARNING.',
    },
    {
      question: 'Como evitar isso em novos bancos?',
      answer:
        'Use COLLATE "C" nas colunas de texto que são identificadores, já que nelas a ordem linguística não importa. Para o padrão do banco, considere o provedor builtin com C.UTF-8 no PostgreSQL 17 ou ICU, cuja versão é rastreada por collation. E, em qualquer troca de sistema operacional, prefira estratégias que reconstroem os índices, como replicação lógica, ou inclua o REINDEX no plano.',
    },
  ],
  conclusion: {
    title: 'O índice de texto carrega a versão da biblioteca que o construiu',
    description:
      'Em collations da libc, a ordem de um índice B-tree de texto é decidida pela glibc instalada quando as linhas entraram. Trocar o sistema operacional por réplica física, snapshot ou upgrade no mesmo servidor mantém os índices e troca o comparador, e o resultado são buscas que não encontram linhas existentes e chaves únicas que aceitam duplicatas, sem nenhum erro. Verificar datcollversion, rodar o amcheck, reconstruir os índices afetados antes de liberar escrita e escolher estratégias que reconstroem os índices evita que uma migração de infraestrutura vire um problema de dados. Se você vai trocar sistema operacional, servidor ou imagem de um banco em produção, posso revisar o plano de migração, mapear os índices afetados e conduzir a troca com segurança.',
    cta: 'Planejar a migração do banco',
  },
  related: [
    {
      label: 'Upgrade de versão major do Postgres sem janela: replicação lógica para trocar de versão com tráfego ligado',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'Índice parcial e índice de expressão que o banco não usa: predicado, tipo do parâmetro e a consulta que não casa',
      to: '/blog/indice-parcial-e-indice-de-expressao-que-o-banco-nao-usa-predicado-tipo-do-parametro-e-a-consulta-que-nao-casa',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B e-commerce platform had to leave CentOS 7, which had reached end of life. The plan looked as safe as it gets: bring up a physical replica of PostgreSQL 15 on a new Rocky Linux 9 server, let it catch up with the primary and promote it. The switch took four minutes and no test failed. The next morning, support started getting tickets about products that showed up in the listing but returned 404 when searched by SKU. Three days later, the catalog importer had created 4,137 duplicate products in a table with UNIQUE (tenant_id, sku). Nothing in the database had changed: same data, same Postgres version, same indexes copied byte by byte. What changed was glibc, which defines how Postgres compares text in collations like pt_BR.UTF-8, and with it the order the B-tree index assumes while it is traversed. This article explains why a text index depends on the operating system library version, which migration strategies carry the problem and which do not, how to detect it with the collation version and amcheck and how to fix it with REINDEX, duplicate cleanup and REFRESH COLLATION VERSION.',
  sections: [
    {
      title: 'The error-free failover that made the unique index let duplicates through',
      blocks: [
        {
          type: 'paragraph',
          value:
            "The produtos table had 12 million rows, a bigint primary key and a unique index on (tenant_id, sku), used both by the search-by-SKU API and by the importer's ON CONFLICT. SKUs came from the customers' ERPs and mixed letters, digits, hyphens and spaces. That is exactly the kind of text whose linguistic ordering changed between glibc versions.",
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The diagnosis took long because the symptoms looked like application bugs. Search by SKU failed in 0.3% of cases, always with SKUs containing a hyphen or a space. The same product appeared in the listing, which filtered by tenant and sorted by name. The importer logged no errors, because ON CONFLICT never fired: as far as the index knew, the old row did not exist. The warning that explained everything had been in the log since the first minute, repeated on every connection, but it was a WARNING among thousands of lines and nobody read the database log after a switch that had gone well.',
        },
      ],
    },
    {
      title: 'Why a text index depends on glibc',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A B-tree index stores keys in order and uses that order to navigate: on each page it compares the search key with the separator keys and goes down the matching branch. For types like bigint or timestamptz, the comparison is fixed. For text and varchar with a libc collation, such as pt_BR.UTF-8 or en_US.UTF-8, Postgres calls glibc strcoll, and the order comes from the locale tables of the library installed on the operating system. The index does not store the comparison rule, only its result: the position of each key was decided by the glibc installed when the row was inserted.',
        },
        {
          type: 'paragraph',
          value:
            'In glibc 2.28, the collation tables were updated to a new version of ISO 14651 and the order of many strings changed, especially with punctuation, hyphens and spaces. Debian 10, Ubuntu 18.10 and RHEL 8 onwards ship the new rule; CentOS 7, Ubuntu 18.04 and Debian 9 have the old one. A move between those two groups practically guarantees text indexes in the wrong order.',
        },
        {
          type: 'code',
          value: orderCode(comments.en),
        },
        {
          type: 'list',
          items: [
            'Equality or range lookups: the descent through the tree uses the new comparison over keys placed by the old one, lands on the wrong page and concludes the key does not exist.',
            'UNIQUE and PRIMARY KEY on text: the uniqueness check is the same lookup. If it does not find the existing key, the duplicate insert goes through and ON CONFLICT never fires.',
            'ORDER BY served by the index returns the old order, while a Sort returns the new one. Keyset pagination that mixes both skips or repeats rows.',
            'A merge join between text columns can lose pairs, because it assumes both inputs are in the same order.',
            'Range partitioning on text can hold rows in partitions whose bounds, under the new rule, would no longer accept them.',
          ],
        },
      ],
    },
    {
      title: 'What is affected and what is not',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The problem is limited to structures that depend on the text order defined by libc. Knowing exactly which ones lets you size the REINDEX before the migration, instead of rebuilding the whole database out of caution or, worse, rebuilding nothing.',
        },
        {
          type: 'table',
          columns: ['Structure', 'Affected?', 'Why'],
          rows: [
            ['B-tree on text or varchar with a libc collation (pt_BR.UTF-8, en_US.UTF-8)', 'Yes', 'Key order comes from glibc strcoll'],
            ['PRIMARY KEY and UNIQUE on text columns', 'Yes, and accepts duplicates', 'The uniqueness check is an index lookup'],
            ['Expression index such as lower(email)', 'Yes', 'The result is text ordered by the same collation'],
            ['Index with COLLATE "C" or text_pattern_ops', 'No', 'Byte by byte comparison, independent of locale'],
            ['B-tree on bigint, integer, uuid, timestamptz, numeric', 'No', 'Comparison defined by the type itself'],
            ['Hash index on text', 'No', 'Depends only on equality, which for a deterministic collation is byte equality'],
            ['Range partitioning on a text column', 'Yes', 'Partition bounds are compared using the collation'],
            ['ICU collation', 'Depends on the ICU version, not on glibc', 'Postgres records the version per collation and warns when it changes'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the incident, 23 indexes made the list: unique keys on SKU, email and external code, expression indexes on lower(email) and composite indexes with a text column after tenant_id. The indexes on ids, dates and amounts, which were the majority, needed nothing.',
        },
      ],
    },
    {
      title: 'Detect it before the customer does: collation version and amcheck',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Starting with PostgreSQL 15, the database records in pg_database.datcollversion the glibc version used when the default collation was set, and compares it with the current version on every connection. Explicit collations have the same control in pg_collation.collversion. That comparison is the first check to run after any change of server, image or operating system, and it should be part of the migration checklist.',
        },
        {
          type: 'code',
          value: versionCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'The version tells you there is risk, not where there is damage. That is what the amcheck extension is for: bt_index_check walks the index and checks that keys are in the order the current comparator expects, and with heapallindexed = true it also checks that every table row is in the index. The script below lists the B-tree indexes that depend on a libc collation, runs amcheck on each one and, with --reindex, rebuilds all of them without blocking writes.',
        },
        {
          type: 'code',
          value: auditCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'Two caveats. bt_index_check with heapallindexed reads the whole index and table, so run it off peak or on a replica with the same glibc as the new server. And amcheck may not flag an index whose order changed only at points the check does not reach: use the result to measure the damage and prioritize, but rebuild every index on the list, not only the ones that failed.',
        },
      ],
    },
    {
      title: 'Fix it: duplicates first, REINDEX next, version last',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Order matters. A unique index cannot be rebuilt while the table holds duplicates: REINDEX fails with could not create unique index, and in CONCURRENTLY mode it also leaves an invalid index with the _ccnew suffix. And the recorded version should only be refreshed once every affected index has been rebuilt, because REFRESH COLLATION VERSION only silences the warning, it fixes nothing.',
        },
        {
          type: 'ordered',
          items: [
            'Stop or pause the processes that bulk insert into the affected tables, such as importers, so new duplicates do not come in during the fix.',
            'Find the duplicates with indexes turned off in the session, because a GROUP BY resolved through the corrupted index can hide exactly the repeated groups.',
            'Agree on the merge rule with the business: which row stays and what happens to stock, price and orders pointing to the duplicate.',
            'Rebuild with REINDEX INDEX CONCURRENTLY, one index at a time, starting with the unique ones. If one fails, drop the _ccnew index with DROP INDEX CONCURRENTLY and deal with what is left.',
            'Run amcheck again on every index on the list and only then run ALTER DATABASE ... REFRESH COLLATION VERSION.',
          ],
        },
        {
          type: 'code',
          value: dedupeCode(comments.en),
        },
        {
          type: 'paragraph',
          value:
            'In the incident, cleaning up the 4,137 duplicates and the 23 REINDEX CONCURRENTLY runs took a little under two hours, with no maintenance window. The largest index, 1.1 GB, took 14 minutes. After that, amcheck passed on every index, search by SKU was back to 100% and the WARNING was gone from the log.',
        },
      ],
    },
    {
      title: 'Plan the operating system change and do not repeat the problem',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The root cause was neither Rocky Linux nor the new glibc, but the choice of a migration strategy that copies indexes without rebuilding them. Each path has a different cost in downtime and collation risk, and that comparison has to be made before choosing.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'What happens to indexes', 'Downtime', 'Collation risk'],
          rows: [
            ['pg_dump and pg_restore on the new server', 'Built on the new OS', 'Proportional to database size', 'None'],
            ['Logical replication to the new server', 'Built on the subscriber, on the new OS', 'Minutes, only for the switch', 'None'],
            ['Physical (streaming) replica on the new OS and promote', 'Copied byte by byte', 'Seconds', 'High: every text index with libc'],
            ['Upgrading the OS on the same server', 'Kept', 'Upgrade time', 'High'],
            ['Volume snapshot on a machine with another image', 'Kept', 'Minutes', 'High'],
          ],
        },
        {
          type: 'list',
          items: [
            'If the window allows it, prefer logical replication or dump and restore: indexes are born on the new system and the problem does not exist. It is the same technique used for major version upgrades without downtime.',
            'If you need a physical replica, put the REINDEX CONCURRENTLY of the affected indexes in the plan, before allowing writes, and time it in an environment with the same volume.',
            'Never mix glibc versions between a primary and its physical replicas. A read replica on a different OS returns wrong results even without a failover.',
            'For columns that are identifiers, such as SKU, external code, slug and idempotency key, use COLLATE "C": linguistic ordering is useless there and byte by byte comparison is stable and faster.',
            'For new databases, consider the builtin provider with C.UTF-8 (PostgreSQL 17+), which does not depend on glibc, or ICU, whose version Postgres tracks per collation.',
            'Monitor the database log for collation version mismatch along with other WARNINGs, and make the datcollversion check part of the checklist for any machine change.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If Postgres and the data are the same, why does the order change?',
      answer:
        'Because, with libc collations, Postgres does not implement text comparison itself: it calls glibc strcoll. When glibc changes its ordering rules, the same comparison starts returning a different result, but indexes already built keep their keys in the positions decided by the old rule. The tree becomes inconsistent with the comparator that walks it.',
    },
    {
      question: 'Does REFRESH COLLATION VERSION fix the problem?',
      answer:
        'No. It only updates the version recorded in the catalog to the current one, which makes the warning stop. Indexes keep the old order. The command should be the last step, after rebuilding every index and other object that depends on the collation, and never the first reaction to the WARNING.',
    },
    {
      question: 'How do I avoid this in new databases?',
      answer:
        'Use COLLATE "C" on text columns that are identifiers, since linguistic order does not matter for them. For the database default, consider the builtin provider with C.UTF-8 on PostgreSQL 17 or ICU, whose version is tracked per collation. And on any operating system change, prefer strategies that rebuild indexes, such as logical replication, or put the REINDEX in the plan.',
    },
  ],
  conclusion: {
    title: 'A text index carries the version of the library that built it',
    description:
      'With libc collations, the order of a B-tree text index is decided by the glibc installed when the rows went in. Changing the operating system through a physical replica, a snapshot or an in-place upgrade keeps the indexes and swaps the comparator, and the result is lookups that miss existing rows and unique keys that accept duplicates, with no error at all. Checking datcollversion, running amcheck, rebuilding the affected indexes before allowing writes and choosing strategies that rebuild indexes keeps an infrastructure migration from turning into a data problem. If you are about to change the operating system, server or image of a production database, I can review the migration plan, map the affected indexes and run the switch safely.',
    cta: 'Plan the database migration',
  },
  related: [
    {
      label: 'Major Postgres version upgrade without downtime: logical replication to switch versions with traffic on',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'Partial and expression indexes the database does not use: predicate, parameter type and the query that does not match',
      to: '/blog/indice-parcial-e-indice-de-expressao-que-o-banco-nao-usa-predicado-tipo-do-parametro-e-a-consulta-que-nao-casa',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma de e-commerce B2B tenía que salir de CentOS 7, que había llegado al fin de soporte. El plan parecía lo más seguro posible: levantar una réplica física de PostgreSQL 15 en un servidor nuevo con Rocky Linux 9, esperar a que alcanzara al primario y promoverla. El cambio tomó cuatro minutos y ningún test falló. A la mañana siguiente, soporte empezó a recibir tickets de productos que aparecían en el listado pero devolvían 404 cuando se buscaban por SKU. Tres días después, el importador de catálogo había creado 4.137 productos duplicados en una tabla con UNIQUE (tenant_id, sku). Nada en la base había cambiado: mismos datos, misma versión de Postgres, mismos índices copiados byte a byte. Lo que cambió fue glibc, que define cómo Postgres compara textos en collations como pt_BR.UTF-8, y con ella el orden que el índice B-tree asume al recorrerse. Este artículo explica por qué un índice de texto depende de la versión de la biblioteca del sistema operativo, qué estrategias de migración arrastran el problema y cuáles no, cómo detectarlo con la versión de collation y amcheck y cómo corregirlo con REINDEX, limpieza de duplicados y REFRESH COLLATION VERSION.',
  sections: [
    {
      title: 'El failover sin errores que hizo que el índice único dejara pasar duplicados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tabla produtos tenía 12 millones de filas, clave primaria bigint y un índice único en (tenant_id, sku), usado tanto por la API de búsqueda por SKU como por el ON CONFLICT del importador. Los SKU venían de los ERP de los clientes y mezclaban letras, números, guiones y espacios. Era exactamente el tipo de texto cuyo orden lingüístico cambió entre versiones de glibc.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El diagnóstico tardó porque los síntomas parecían bugs de la aplicación. La búsqueda por SKU fallaba en el 0,3% de los casos, siempre con SKU que tenían guion o espacio. El mismo producto aparecía en el listado, que filtraba por tenant y ordenaba por nombre. El importador no registraba errores, porque el ON CONFLICT nunca se disparaba: para el índice, la fila antigua no existía. El aviso que lo explicaba todo estaba en el log desde el primer minuto, repetido en cada conexión, pero era un WARNING entre miles de líneas y nadie miraba el log de la base después de un cambio que había salido bien.',
        },
      ],
    },
    {
      title: 'Por qué un índice de texto depende de glibc',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un índice B-tree guarda las claves en orden y usa ese orden para navegar: en cada página compara la clave buscada con las claves separadoras y baja por la rama correspondiente. Para tipos como bigint o timestamptz, la comparación es fija. Para text y varchar con una collation de libc, como pt_BR.UTF-8 o en_US.UTF-8, Postgres llama a strcoll de glibc, y el orden sale de las tablas de locale de la biblioteca instalada en el sistema operativo. El índice no guarda la regla de comparación, solo su resultado: la posición de cada clave la decidió la glibc instalada cuando se insertó la fila.',
        },
        {
          type: 'paragraph',
          value:
            'En glibc 2.28, las tablas de collation se actualizaron a una versión nueva de ISO 14651 y el orden de muchos textos cambió, especialmente con puntuación, guiones y espacios. Debian 10, Ubuntu 18.10 y RHEL 8 en adelante ya traen la regla nueva; CentOS 7, Ubuntu 18.04 y Debian 9 tienen la antigua. Un cambio entre esos dos grupos es prácticamente garantía de índices de texto con el orden equivocado.',
        },
        {
          type: 'code',
          value: orderCode(comments.es),
        },
        {
          type: 'list',
          items: [
            'Búsqueda por igualdad o rango: el descenso por el árbol usa la comparación nueva sobre claves ubicadas por la antigua, cae en la página equivocada y concluye que la clave no existe.',
            'UNIQUE y PRIMARY KEY en texto: la verificación de unicidad es la misma búsqueda. Si no encuentra la clave existente, la inserción duplicada pasa y el ON CONFLICT nunca se dispara.',
            'Un ORDER BY resuelto por el índice devuelve el orden antiguo, mientras que un Sort devuelve el nuevo. La paginación por keyset que mezcla ambos salta o repite filas.',
            'Un merge join entre columnas de texto puede perder pares, porque asume que las dos entradas están en el mismo orden.',
            'El particionamiento por rango de texto puede tener filas en particiones cuyos límites, con la regla nueva, ya no las aceptarían.',
          ],
        },
      ],
    },
    {
      title: 'Qué se ve afectado y qué no',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El problema se limita a estructuras que dependen del orden de texto definido por libc. Saber exactamente cuáles son permite dimensionar el REINDEX antes de la migración, en lugar de reconstruir la base entera por precaución o, peor, no reconstruir nada.',
        },
        {
          type: 'table',
          columns: ['Estructura', '¿Afectada?', 'Por qué'],
          rows: [
            ['B-tree en text o varchar con collation de libc (pt_BR.UTF-8, en_US.UTF-8)', 'Sí', 'El orden de las claves sale de strcoll de glibc'],
            ['PRIMARY KEY y UNIQUE en columnas de texto', 'Sí, y acepta duplicados', 'La verificación de unicidad es una búsqueda en el índice'],
            ['Índice de expresión como lower(email)', 'Sí', 'El resultado es texto ordenado por la misma collation'],
            ['Índice con COLLATE "C" o text_pattern_ops', 'No', 'Comparación byte a byte, independiente del locale'],
            ['B-tree en bigint, integer, uuid, timestamptz, numeric', 'No', 'Comparación definida por el propio tipo'],
            ['Índice hash en text', 'No', 'Depende solo de igualdad, que en una collation determinística es igualdad de bytes'],
            ['Particionamiento por rango en columna de texto', 'Sí', 'Los límites de las particiones se comparan con la collation'],
            ['Collation ICU', 'Depende de la versión de ICU, no de glibc', 'Postgres registra la versión por collation y avisa cuando cambia'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el incidente, 23 índices entraban en la lista: claves únicas en SKU, e-mail y código externo, índices de expresión en lower(email) e índices compuestos con una columna de texto después de tenant_id. Los índices en ids, fechas y montos, que eran la mayoría, no necesitaban nada.',
        },
      ],
    },
    {
      title: 'Detectarlo antes que el cliente: versión de collation y amcheck',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A partir de PostgreSQL 15, la base registra en pg_database.datcollversion la versión de glibc usada cuando se definió la collation por defecto, y la compara con la versión actual en cada conexión. Las collations explícitas tienen el mismo control en pg_collation.collversion. Esa comparación es la primera verificación a hacer después de cualquier cambio de servidor, imagen o sistema operativo, y debería formar parte del checklist de la migración.',
        },
        {
          type: 'code',
          value: versionCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'La versión dice que hay riesgo, no dónde hay daño. Para eso existe la extensión amcheck: bt_index_check recorre el índice y verifica que las claves estén en el orden que espera el comparador actual, y con heapallindexed = true también verifica que cada fila de la tabla esté en el índice. El script de abajo lista los índices B-tree que dependen de una collation de libc, ejecuta amcheck en cada uno y, con --reindex, los reconstruye todos sin bloquear escritura.',
        },
        {
          type: 'code',
          value: auditCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'Dos cuidados. bt_index_check con heapallindexed lee el índice y la tabla enteros, así que conviene ejecutarlo fuera del pico o en una réplica con la misma glibc que el servidor nuevo. Y amcheck puede no detectar un índice cuyo orden cambió solo en puntos que la verificación no alcanza: use el resultado para medir el daño y priorizar, pero reconstruya todos los índices de la lista, no solo los que fallaron.',
        },
      ],
    },
    {
      title: 'Corregir: primero duplicados, después REINDEX, la versión al final',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El orden importa. Un índice único no puede reconstruirse mientras haya duplicados en la tabla: el REINDEX falla con could not create unique index, y en modo CONCURRENTLY además deja un índice inválido con sufijo _ccnew. Y la versión registrada solo debe actualizarse cuando todos los índices afectados estén reconstruidos, porque REFRESH COLLATION VERSION solo silencia el aviso, no corrige nada.',
        },
        {
          type: 'ordered',
          items: [
            'Detener o pausar los procesos que insertan en masa en las tablas afectadas, como importadores, para que no entren duplicados nuevos durante la corrección.',
            'Encontrar los duplicados con los índices apagados en la sesión, porque un GROUP BY resuelto por el índice corrupto puede esconder justamente los grupos repetidos.',
            'Definir la regla de fusión con el negocio: qué fila se queda y qué pasa con el stock, el precio y los pedidos que apuntan al duplicado.',
            'Reconstruir con REINDEX INDEX CONCURRENTLY, un índice por vez, empezando por los únicos. Si alguno falla, eliminar el _ccnew con DROP INDEX CONCURRENTLY y tratar lo que quedó.',
            'Ejecutar amcheck otra vez en todos los índices de la lista y solo entonces ejecutar ALTER DATABASE ... REFRESH COLLATION VERSION.',
          ],
        },
        {
          type: 'code',
          value: dedupeCode(comments.es),
        },
        {
          type: 'paragraph',
          value:
            'En el incidente, la limpieza de los 4.137 duplicados y los 23 REINDEX CONCURRENTLY tomaron un poco menos de dos horas, sin ventana de mantenimiento. El índice más grande, de 1,1 GB, tardó 14 minutos. Después de eso, amcheck pasó en todos los índices, la búsqueda por SKU volvió al 100% y el WARNING desapareció del log.',
        },
      ],
    },
    {
      title: 'Planificar el cambio de sistema operativo y no repetir el problema',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La causa raíz no fue Rocky Linux ni la glibc nueva, sino la elección de una estrategia de migración que copia los índices sin reconstruirlos. Cada camino tiene un costo distinto en ventana y en riesgo de collation, y esa comparación tiene que hacerse antes de elegir.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Qué pasa con los índices', 'Ventana', 'Riesgo de collation'],
          rows: [
            ['pg_dump y pg_restore en el servidor nuevo', 'Construidos en el SO nuevo', 'Proporcional al tamaño de la base', 'Ninguno'],
            ['Replicación lógica al servidor nuevo', 'Construidos en el suscriptor, en el SO nuevo', 'Minutos, solo en el cambio', 'Ninguno'],
            ['Réplica física (streaming) en el SO nuevo y promote', 'Copiados byte a byte', 'Segundos', 'Alto: todos los índices de texto con libc'],
            ['Actualizar el SO en el mismo servidor', 'Se mantienen', 'Tiempo del upgrade', 'Alto'],
            ['Snapshot del volumen en una máquina con otra imagen', 'Se mantienen', 'Minutos', 'Alto'],
          ],
        },
        {
          type: 'list',
          items: [
            'Si la ventana lo permite, prefiera replicación lógica o dump y restore: los índices nacen en el sistema nuevo y el problema no existe. Es la misma técnica usada para upgrades de versión mayor sin ventana.',
            'Si necesita una réplica física, incluya el REINDEX CONCURRENTLY de los índices afectados en el plan, antes de liberar la escritura, y mida el tiempo en un entorno con el mismo volumen.',
            'Nunca mezcle versiones de glibc entre el primario y sus réplicas físicas. Una réplica de lectura en un SO distinto devuelve resultados equivocados incluso sin failover.',
            'Para columnas que son identificadores, como SKU, código externo, slug y clave de idempotencia, use COLLATE "C": el orden lingüístico no sirve de nada en ellas y la comparación byte a byte es estable y más rápida.',
            'En bases nuevas, evalúe el proveedor builtin con C.UTF-8 (PostgreSQL 17+), que no depende de glibc, o ICU, cuya versión Postgres sigue por collation.',
            'Monitoree el log de la base por collation version mismatch junto con los demás WARNING, y haga que la verificación de datcollversion forme parte del checklist de cualquier cambio de máquina.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si Postgres y los datos son los mismos, ¿por qué cambia el orden?',
      answer:
        'Porque, con collations de libc, Postgres no implementa la comparación de textos: llama a strcoll de glibc. Cuando glibc cambia sus reglas de ordenamiento, la misma comparación pasa a dar otro resultado, pero los índices ya construidos mantienen las claves en la posición que decidió la regla antigua. El árbol queda inconsistente con el comparador que lo recorre.',
    },
    {
      question: '¿REFRESH COLLATION VERSION resuelve el problema?',
      answer:
        'No. Solo actualiza la versión registrada en el catálogo a la actual, lo que hace que el aviso desaparezca. Los índices siguen con el orden antiguo. El comando debe ser el último paso, después de reconstruir todos los índices y demás objetos que dependen de la collation, y nunca la primera reacción al WARNING.',
    },
    {
      question: '¿Cómo evitar esto en bases nuevas?',
      answer:
        'Use COLLATE "C" en las columnas de texto que son identificadores, ya que en ellas el orden lingüístico no importa. Para el valor por defecto de la base, considere el proveedor builtin con C.UTF-8 en PostgreSQL 17 o ICU, cuya versión se sigue por collation. Y en cualquier cambio de sistema operativo, prefiera estrategias que reconstruyen los índices, como la replicación lógica, o incluya el REINDEX en el plan.',
    },
  ],
  conclusion: {
    title: 'El índice de texto lleva la versión de la biblioteca que lo construyó',
    description:
      'Con collations de libc, el orden de un índice B-tree de texto lo decide la glibc instalada cuando entraron las filas. Cambiar el sistema operativo mediante una réplica física, un snapshot o un upgrade en el mismo servidor mantiene los índices y cambia el comparador, y el resultado son búsquedas que no encuentran filas existentes y claves únicas que aceptan duplicados, sin ningún error. Verificar datcollversion, ejecutar amcheck, reconstruir los índices afectados antes de liberar la escritura y elegir estrategias que reconstruyen los índices evita que una migración de infraestructura se convierta en un problema de datos. Si va a cambiar el sistema operativo, el servidor o la imagen de una base en producción, puedo revisar el plan de migración, mapear los índices afectados y conducir el cambio con seguridad.',
    cta: 'Planificar la migración de la base',
  },
  related: [
    {
      label: 'Actualización de versión mayor de Postgres sin ventana: replicación lógica para cambiar de versión con el tráfico activo',
      to: '/blog/upgrade-de-versao-major-do-postgres-sem-janela-replicacao-logica-para-trocar-de-versao-com-trafego-ligado',
    },
    {
      label: 'Índice parcial e índice de expresión que la base no usa: predicado, tipo del parámetro y la consulta que no coincide',
      to: '/blog/indice-parcial-e-indice-de-expressao-que-o-banco-nao-usa-predicado-tipo-do-parametro-e-a-consulta-que-nao-casa',
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
