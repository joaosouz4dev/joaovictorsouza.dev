// Conteudo do artigo: soft delete que vaza em consulta, relatorio e indice unico,
// indice unico parcial, visao so com os vivos e privilegios, filhos, credenciais,
// sistemas derivados, relatorios de periodo, expurgo e teste de vazamento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const readersDiagram = `Quem le a tabela usuarios             Lembra de excluido_em IS NULL?
----------------------------------    ---------------------------------------------
API, pelo ORM com escopo padrao       sim
Relatorio de cobranca (SQL cru)       nao: conta 212 assentos, 187 estao ativos
Tela de escala (JOIN com turnos)      so em turnos: mostra o nome de quem ja saiu
Job do resumo semanal por e-mail      nao: continua enviando para quem saiu
Indexador da busca                    nao: o apagado aparece no autocompletar
Restricao UNIQUE (empresa, e-mail)    nao tem como: bloqueia o recadastro`;

const leakCode = `CREATE TABLE usuarios (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  empresa_id  bigint      NOT NULL REFERENCES empresas (id),
  email       text        NOT NULL,
  nome        text        NOT NULL,
  criado_em   timestamptz NOT NULL DEFAULT now(),
  excluido_em timestamptz,                 -- NULL = vivo
  UNIQUE (empresa_id, email)               -- criada antes de existir soft delete
);

-- "Apagar" e um UPDATE. A linha continua na tabela.
UPDATE usuarios SET excluido_em = now() WHERE id = 42;

-- Vazamento 1: relatorio de cobranca em SQL cru conta os apagados
SELECT empresa_id, count(*) AS assentos
FROM usuarios
GROUP BY empresa_id;

-- Vazamento 2: o filtro foi lembrado em turnos e esquecido em usuarios
SELECT t.id, t.inicio, u.nome
FROM turnos t
JOIN usuarios u ON u.id = t.usuario_id
WHERE t.excluido_em IS NULL
  AND t.inicio >= now();

-- Vazamento 3: no LEFT JOIN, o filtro no WHERE faz o turno de um usuario apagado
-- sumir do resultado. A condicao tem de ir no ON para ele aparecer sem responsavel.
SELECT t.id, t.inicio, u.nome
FROM turnos t
LEFT JOIN usuarios u ON u.id = t.usuario_id
WHERE t.excluido_em IS NULL
  AND u.excluido_em IS NULL;

-- Vazamento 4: a Carla foi apagada em marco e voltou para a empresa
INSERT INTO usuarios (empresa_id, email, nome)
VALUES (7, 'carla@exemplo.com', 'Carla Nunes');
-- ERROR: duplicate key value violates unique constraint "usuarios_empresa_id_email_key"`;

const uniqueCode = `-- 1. Cria primeiro a regra nova: unicidade so entre os vivos.
--    CONCURRENTLY nao bloqueia escrita e nao pode rodar dentro de uma transacao.
CREATE UNIQUE INDEX CONCURRENTLY usuarios_email_vivo_uk
  ON usuarios (empresa_id, email)
  WHERE excluido_em IS NULL;

-- 2. So entao remove a restricao antiga, que contava os apagados.
ALTER TABLE usuarios DROP CONSTRAINT usuarios_empresa_id_email_key;

-- 3. Indice parcial tambem para as listagens: menor e so com as linhas que a tela usa.
CREATE INDEX CONCURRENTLY usuarios_empresa_nome_vivo_idx
  ON usuarios (empresa_id, nome)
  WHERE excluido_em IS NULL;

-- Upsert precisa repetir o predicado para o Postgres escolher o indice parcial
INSERT INTO usuarios (empresa_id, email, nome)
VALUES ($1, $2, $3)
ON CONFLICT (empresa_id, email) WHERE excluido_em IS NULL
DO UPDATE SET nome = EXCLUDED.nome;`;

const viewCode = `BEGIN;
SET LOCAL lock_timeout = '3s';

-- A tabela fisica ganha um nome que diz o que ela contem
ALTER TABLE usuarios RENAME TO usuarios_todos;

-- O nome antigo passa a ser a visao so com os vivos: consultas e ORM continuam funcionando
CREATE VIEW usuarios AS
  SELECT id, empresa_id, email, nome, criado_em, excluido_em
  FROM usuarios_todos
  WHERE excluido_em IS NULL;

-- A aplicacao so enxerga a visao, e nao recebe DELETE.
-- A tabela fisica fica para os papeis de suporte, faturamento e expurgo.
REVOKE ALL ON usuarios_todos FROM app_api;
GRANT SELECT, INSERT, UPDATE ON usuarios TO app_api;

COMMIT;

-- Apagar continua sendo um UPDATE, agora pela visao.
-- Depois dele a linha deixa de existir para o papel da aplicacao.
UPDATE usuarios SET excluido_em = now() WHERE id = $1;`;

const deleteCode = `// Excluir um usuario e uma operacao de negocio, nao um UPDATE solto:
// tudo o que depende dele muda na mesma transacao.
export async function excluirUsuario(pool, empresaId, usuarioId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rowCount } = await client.query(
      'UPDATE usuarios SET excluido_em = now() WHERE id = $1 AND empresa_id = $2',
      [usuarioId, empresaId],
    );
    if (rowCount === 0) {
      await client.query('ROLLBACK');
      return false; // inexistente ou ja apagado: a visao nao o enxerga mais
    }
    // Credenciais deixam de valer junto com o usuario
    await client.query('DELETE FROM tokens_api WHERE usuario_id = $1', [usuarioId]);
    // Turnos futuros voltam para a fila de sem responsavel; o historico fica intacto
    await client.query(
      'UPDATE turnos SET usuario_id = NULL WHERE usuario_id = $1 AND inicio >= now()',
      [usuarioId],
    );
    // Busca, cache e data warehouse ficam sabendo por um evento explicito (outbox)
    await client.query('INSERT INTO eventos_saida (tipo, payload) VALUES ($1, $2)', [
      'usuario.excluido',
      JSON.stringify({ usuarioId, empresaId }),
    ]);
    await client.query('COMMIT');
    return true;
  } catch (erro) {
    await client.query('ROLLBACK').catch(() => {});
    throw erro;
  } finally {
    client.release();
  }
}`;

const periodCode = `-- Assentos faturaveis: quem esteve ativo em algum momento do periodo.
-- Roda com o papel de faturamento, que le a tabela fisica de proposito.
SELECT empresa_id, count(*) AS assentos
FROM usuarios_todos
WHERE criado_em < $2                               -- fim do periodo (exclusivo)
  AND (excluido_em IS NULL OR excluido_em >= $1)   -- inicio do periodo
GROUP BY empresa_id;`;

const purgeCode = `-- Indice so com os apagados: o expurgo nao varre a tabela inteira
CREATE INDEX CONCURRENTLY usuarios_expurgo_idx
  ON usuarios_todos (excluido_em)
  WHERE excluido_em IS NOT NULL;

-- Job diario, com o papel de expurgo: apaga de verdade o que passou da janela de retencao.
-- Repita ate afetar zero linhas. SKIP LOCKED evita disputar linha com uma restauracao em curso.
WITH lote AS (
  SELECT id
  FROM usuarios_todos
  WHERE excluido_em < now() - interval '90 days'
  ORDER BY excluido_em
  LIMIT 1000
  FOR UPDATE SKIP LOCKED
)
DELETE FROM usuarios_todos u
USING lote
WHERE u.id = lote.id;`;

const testCode = `import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as consultas from './consultas.js'; // toda leitura que a aplicacao expoe
import { excluirUsuario } from './usuarios.js';

// Conecta com o mesmo papel da aplicacao (app_api), nao com o dono do banco.
// Pressupoe as migracoes aplicadas e a empresa 1 criada pelo seed.
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());

async function criarUsuario(empresaId, email) {
  const { rows } = await pool.query(
    'INSERT INTO usuarios (empresa_id, email, nome) VALUES ($1, $2, $3) RETURNING id',
    [empresaId, email, 'Sentinela'],
  );
  return rows[0].id;
}

test('usuario apagado nao aparece em nenhuma leitura da aplicacao', async () => {
  const sentinela = 'sentinela.' + Date.now() + '@exemplo.com';
  const id = await criarUsuario(1, sentinela);
  await pool.query(
    "INSERT INTO turnos (empresa_id, usuario_id, inicio) VALUES (1, $1, now() + interval '1 day')",
    [id],
  );
  assert.equal(await excluirUsuario(pool, 1, id), true);

  // Cada funcao exportada de consultas.js recebe (pool, empresaId) e devolve linhas
  for (const [nome, consulta] of Object.entries(consultas)) {
    const linhas = await consulta(pool, 1);
    assert.ok(!JSON.stringify(linhas).includes(sentinela), 'vazou em ' + nome);
  }
});

test('e-mail de apagado pode ser recadastrado, mas dois vivos nao dividem e-mail', async () => {
  const email = 'carla.' + Date.now() + '@exemplo.com';
  const id = await criarUsuario(1, email);
  await excluirUsuario(pool, 1, id);
  await criarUsuario(1, email); // o recadastro funciona
  await assert.rejects(criarUsuario(1, email), { code: '23505' }); // unique_violation
});

test('o papel da aplicacao nao alcanca a tabela fisica', async () => {
  // 42501 = insufficient_privilege
  await assert.rejects(pool.query('SELECT 1 FROM usuarios_todos LIMIT 1'), { code: '42501' });
});`;

const pt = {
  intro:
    'Uma plataforma B2B de gestão de escalas cobra por usuário ativo e, como quase todo sistema, não apaga nada de verdade: excluir um funcionário preenche a coluna excluido_em e a linha continua na tabela. Em um único mês chegaram três chamados que pareciam não ter relação. Um cliente com 187 usuários ativos recebeu a fatura com 212 assentos. O RH de outro não conseguia recadastrar uma funcionária que tinha voltado para a empresa, porque o sistema respondia que o e-mail já estava cadastrado. E um ex-funcionário, removido em março, continuava aparecendo no autocompletar da escala e recebendo o resumo semanal por e-mail. Os três têm a mesma causa: com soft delete, a regra de que apagado não existe deixa de ser garantida pelo banco e passa a depender de cada consulta, cada índice e cada sistema que lê a tabela se lembrar dela. Este artigo mostra por onde o registro apagado vaza, como reproduzir cada vazamento, como devolver a unicidade aos registros vivos, como tirar o filtro da mão de quem escreve a consulta, o que fazer com filhos, credenciais, busca e relatórios de período, e como expurgar e provar com um teste que o apagado continua apagado.',
  sections: [
    {
      title: 'Por que o soft delete vaza: a regra que mora em cada consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um DELETE de verdade é uma garantia do banco: depois do commit, nenhuma consulta, índice, relatório ou job encontra a linha, sem que ninguém precise fazer nada. O soft delete troca essa garantia por uma convenção. A linha continua existindo, e a exclusão vira um predicado, excluido_em IS NULL, que precisa ser repetido em todo lugar que lê a tabela. Uma regra que precisa ser lembrada em cem lugares vai ser esquecida em algum, e basta um.',
        },
        {
          type: 'diagram',
          value: readersDiagram,
        },
        {
          type: 'paragraph',
          value:
            'O escopo padrão do ORM dá a impressão de que o problema está resolvido, porque as telas principais passam por ele. Só que a tabela tem outros leitores, e o ORM não fala por eles. A tabela abaixo liga cada chamado do mês à sua causa e ao motivo de ninguém ter percebido antes.',
        },
        {
          type: 'table',
          columns: ['Sintoma', 'Causa', 'Por que passou despercebido'],
          rows: [
            [
              'Fatura com 212 assentos para 187 usuários ativos',
              'Agregação em SQL cru sem o filtro de exclusão',
              'O relatório foi escrito fora do ORM, onde o escopo padrão não existe',
            ],
            [
              'E-mail já cadastrado ao reconvidar quem voltou',
              'A restrição UNIQUE também considera a linha apagada',
              'A restrição foi criada antes do soft delete e ninguém a revisou',
            ],
            [
              'Nome de quem saiu na escala e no autocompletar',
              'JOIN e indexador de busca leem a tabela sem o filtro',
              'Em desenvolvimento e em teste quase não existe registro apagado',
            ],
            [
              'Ex-funcionário recebendo o resumo semanal',
              'O job lê outra tabela e nunca consulta excluido_em',
              'Os testes do job só criam usuários vivos',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reproduzindo: o relatório, o JOIN e o recadastro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O esquema abaixo é o ponto de partida mais comum: uma coluna excluido_em, nula enquanto o registro está vivo, e uma restrição UNIQUE criada antes de alguém pensar em soft delete. Cada comando em seguida estava correto para quem o escreveu, e cada um vaza de um jeito diferente.',
        },
        {
          type: 'code',
          value: leakCode,
        },
        {
          type: 'list',
          items: [
            'O relatório de cobrança conta linhas, e linha apagada é linha. Ele foi escrito em SQL cru, fora do ORM, e o escopo padrão que protegia a API nunca passou por ali.',
            'No JOIN, o filtro precisa existir uma vez para cada tabela com soft delete. Quem escreveu lembrou de turnos e esqueceu de usuarios, e a escala passou a exibir o nome de quem já saiu.',
            'No LEFT JOIN, corrigir colocando o filtro no WHERE cria outro defeito: o turno atribuído a um usuário apagado some do resultado, em vez de aparecer como sem responsável. A condição sobre a tabela da direita precisa estar na cláusula ON.',
            'A restrição UNIQUE compara valores e não conhece a regra de negócio. Para ela, a Carla apagada em março ainda ocupa o e-mail, e o recadastro falha com violação de unicidade.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Nenhum desses defeitos aparece em desenvolvimento, onde quase não existe registro apagado, nem em teste, onde as fixtures só criam usuários vivos. Eles crescem com a idade do sistema: quanto mais antiga a base, maior a proporção de linhas apagadas e mais visível cada consulta que esqueceu o filtro.',
        },
      ],
    },
    {
      title: 'Unicidade só entre os vivos: o índice único parcial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O recadastro falha porque a pergunta que a restrição responde, existe outra linha com este e-mail, não é a pergunta do negócio, existe outro usuário vivo com este e-mail. No PostgreSQL a resposta certa é um índice único parcial, que só inclui as linhas que satisfazem um predicado. Uma restrição UNIQUE declarada na tabela não aceita WHERE, por isso a regra passa a ser um índice.',
        },
        {
          type: 'code',
          value: uniqueCode,
        },
        {
          type: 'list',
          items: [
            'A armadilha mais comum é trocar a restrição por UNIQUE (empresa_id, email, excluido_em). Como dois NULL não são considerados iguais para fins de unicidade, duas linhas vivas com o mesmo e-mail passam, e a regra some justamente para os registros que importam. A partir do PostgreSQL 15 é possível declarar NULLS NOT DISTINCT, mas o índice parcial expressa a intenção de forma mais direta.',
            'No MySQL, que não tem índice parcial, o equivalente é uma coluna gerada que vale 1 quando o registro está vivo e NULL quando está apagado, incluída no índice único: as linhas apagadas ficam com NULL e deixam de colidir. No SQL Server, o índice filtrado com WHERE excluido_em IS NULL cumpre o mesmo papel.',
            'Restaurar um registro passa a poder falhar: se alguém recadastrou o mesmo e-mail enquanto o antigo estava apagado, desfazer a exclusão viola o índice. Esse é o comportamento correto. Trate o erro 23505 na restauração como conflito e ofereça unir os cadastros, em vez de devolver um erro 500.',
            'A validação de unicidade feita na aplicação precisa seguir a mesma regra. Se o ORM valida olhando só os vivos e o banco ainda considera os apagados, ou o contrário, o usuário recebe um erro genérico no lugar da mensagem de validação.',
            'O índice parcial das listagens é menor que o índice completo e contém exatamente as linhas que as telas consultam. Para o planejador usá-lo, a consulta precisa trazer o mesmo predicado, excluido_em IS NULL, o que a visão da próxima seção garante.',
          ],
        },
      ],
    },
    {
      title: 'Tirar o filtro da mão de quem escreve a consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Corrigir as consultas que vazaram resolve o chamado de hoje e nada mais. A próxima consulta, escrita daqui a seis meses por alguém que não acompanhou este incidente, vai esquecer o filtro de novo. A correção duradoura é inverter o padrão: ler os vivos passa a ser o caminho sem esforço, e alcançar os apagados passa a exigir uma decisão explícita. No PostgreSQL isso se faz com uma visão e com privilégios.',
        },
        {
          type: 'code',
          value: viewCode,
        },
        {
          type: 'paragraph',
          value:
            'A tabela física ganha um nome que diz o que ela contém, e o nome antigo vira uma visão que só mostra os vivos. Visões simples sobre uma única tabela são atualizáveis no Postgres, então INSERT e UPDATE continuam funcionando pelo nome de sempre e o ORM não percebe a troca. Por padrão, uma visão acessa a tabela com os privilégios do seu dono, por isso o papel da aplicação lê e grava por ela sem ter nenhum acesso à tabela física. O SQL cru de um relatório, um JOIN novo ou um script que use a conexão da aplicação simplesmente não tem como enxergar um apagado. E como o papel não recebeu DELETE, uma exclusão física acidental falha com erro de permissão em vez de destruir dado.',
        },
        {
          type: 'list',
          items: [
            'A lista de colunas da visão é fixada na criação. Coluna nova na tabela física exige recriar a visão na mesma migração, e vale um teste que compare as duas listas.',
            'Papéis que precisam ver os apagados, como o suporte que restaura cadastros, o job de expurgo e o faturamento por período, recebem acesso à tabela física. São poucos, e neles o filtro é uma decisão consciente.',
            'A ferramenta de BI e a réplica analítica devem conectar com um papel que também só enxerga as visões. É por ali que sai a maior parte dos números errados.',
            'O RENAME pede um lock exclusivo por um instante. O lock_timeout curto faz a migração desistir e ser repetida, em vez de ficar na fila atrás de uma transação longa segurando todas as outras consultas da tabela.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A visão não é a única forma de centralizar a regra. A tabela a seguir compara as estratégias pelo que cada uma realmente protege.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'O que protege', 'Onde ainda vaza ou o que custa'],
          rows: [
            [
              'Filtro manual em cada consulta',
              'Nada além da disciplina de quem escreve',
              'Qualquer consulta nova, JOIN, SQL cru ou relatório',
            ],
            [
              'Escopo padrão do ORM',
              'As consultas montadas pelo ORM',
              'SQL cru, agregações e JOINs escritos à mão, ferramentas de BI e o escape para ver apagados, que vira hábito',
            ],
            [
              'Visão só com os vivos e privilégio revogado na tabela física',
              'Tudo o que conecta com o papel da aplicação, inclusive SQL cru',
              'Papéis com acesso à tabela física continuam dependendo de disciplina, e coluna nova exige recriar a visão',
            ],
            [
              'Row-level security',
              'Todo acesso do papel, sem renomear nada',
              'Dono da tabela e superusuário ignoram a política, e uma política só com USING rejeita o próprio UPDATE de exclusão, porque a linha nova deixa de satisfazê-la',
            ],
            [
              'Tabela de arquivo: mover a linha apagada para outra tabela',
              'Nenhuma consulta alcança o apagado, e unicidade e chaves estrangeiras voltam a funcionar sozinhas',
              'Restaurar dá mais trabalho, os filhos precisam de destino no momento da exclusão e o esquema das duas tabelas pode divergir',
            ],
          ],
        },
      ],
    },
    {
      title: 'O que o banco não resolve sozinho: filhos, credenciais, busca e relatórios de período',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com unicidade e leitura resolvidas no banco, sobra o que nenhum índice ou visão alcança: os dados e sistemas que dependem do registro apagado. Em um DELETE de verdade, a chave estrangeira obriga a decidir o destino dos filhos. No soft delete a linha continua lá, a chave estrangeira continua satisfeita e nada obriga ninguém a decidir nada.',
        },
        {
          type: 'list',
          items: [
            'Filhos: decida por tabela filha se a exclusão do pai apaga junto, desvincula ou é bloqueada. Turnos futuros voltam para a fila de sem responsável, e turnos passados ficam intactos porque são histórico. Quando apagar em cascata, grave o mesmo instante em excluido_em do pai e dos filhos, para que restaurar o pai consiga restaurar exatamente os filhos que caíram com ele.',
            'Credenciais: a consulta de autenticação costuma ler só a tabela de tokens ou de sessões. Se ela não passa pelo usuário, o token de um usuário apagado continua valendo. Revogue tokens e sessões na mesma transação da exclusão.',
            'Sistemas derivados: índice de busca, cache e data warehouse guardam cópias. Soft delete é um UPDATE, então a captura de mudanças do banco entrega uma atualização, e o consumidor que só remove documentos ao ver um evento de exclusão nunca remove este. Publique um evento explícito de usuário excluído, gravado na mesma transação.',
            'Jobs e notificações: o resumo semanal lê destinatários de uma tabela de preferências. Qualquer tabela que guarde uma referência ao usuário e seja lida sozinha é um ponto de vazamento.',
          ],
        },
        {
          type: 'code',
          value: deleteCode,
        },
        {
          type: 'paragraph',
          value:
            'Relatórios de período são um caso à parte, porque neles a resposta certa não é nem todas as linhas nem só os vivos de hoje. A fatura com 212 assentos estava errada, mas cobrar os 187 vivos no dia do fechamento também estaria: 4 dos 25 apagados foram removidos durante o mês faturado e, pelo contrato, usuário ativo em qualquer momento do período é cobrado. O número correto era 191. Esse tipo de consulta precisa enxergar os apagados de propósito, com um papel que tenha esse acesso, e precisa de uma definição de ativo no período escrita no SQL.',
        },
        {
          type: 'code',
          value: periodCode,
        },
        {
          type: 'paragraph',
          value:
            'É por isso que excluido_em deve ser um instante e não um booleano: só com a data é possível responder quem estava ativo em março, expurgar por janela de retenção e restaurar em conjunto o que foi apagado junto.',
        },
      ],
    },
    {
      title: 'Expurgar de verdade e provar que o apagado continua apagado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Soft delete sem expurgo é só uma tabela que cresce para sempre. As linhas apagadas pesam nos índices completos, nos backups e nas varreduras, e continuam sendo dado pessoal guardado. Um pedido de eliminação com base na LGPD ou no GDPR não é atendido por uma coluna excluido_em preenchida: o dado continua na tabela, no índice de busca e nas exportações. Defina uma janela de retenção por tabela, o tempo em que restaurar ainda faz sentido, e depois dela apague de verdade.',
        },
        {
          type: 'code',
          value: purgeCode,
        },
        {
          type: 'list',
          items: [
            'Apague em lotes pequenos e repita até não sobrar linha. Um DELETE único de milhões de linhas segura locks por minutos, gera um pico de WAL e atrasa as réplicas.',
            'Os filhos precisam de destino antes do pai: ON DELETE CASCADE, SET NULL ou expurgo próprio. E toda coluna de chave estrangeira que aponta para a tabela precisa de índice, senão cada lote varre as tabelas filhas inteiras.',
            'Quando a retenção for obrigatória por motivo fiscal ou de auditoria, anonimize em vez de apagar: troque nome e e-mail por valores neutros e mantenha o id, para que o histórico continue íntegro sem identificar a pessoa.',
            'O expurgo também precisa chegar aos sistemas derivados e respeitar a rotação dos backups. Documente em quanto tempo um dado apagado deixa de existir em todos os lugares.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Por fim, a prova. O teste abaixo conecta com o mesmo papel da aplicação, cria um usuário sentinela, apaga e percorre todas as funções de leitura exportadas pelo módulo de consultas, exigindo que a sentinela não apareça em nenhuma. Uma consulta nova entra na verificação só por ser exportada, sem depender de alguém se lembrar de escrever o teste dela. Os outros dois testes fixam as garantias do banco: o e-mail de um apagado pode ser reutilizado, dois vivos não dividem e-mail e a aplicação não alcança a tabela física.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Rode contra um Postgres real, em contêiner, com as migrações aplicadas e o papel app_api criado. A garantia que se quer provar está nos privilégios e nos índices, e é exatamente isso que um banco em memória ou um mock não reproduz.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Devo abandonar o soft delete e apagar de verdade?',
      answer:
        'Depende do motivo pelo qual ele existe. Se o objetivo é permitir desfazer uma exclusão por alguns dias, uma tabela de arquivo ou uma lixeira com expurgo resolve sem contaminar as consultas. Se o objetivo é auditoria, uma tabela de histórico registra melhor quem mudou o quê. O soft delete na própria tabela faz sentido quando outros registros precisam continuar apontando para a linha, como o histórico de turnos de quem saiu. O erro é adotá-lo por padrão em todas as tabelas, sem responder para que serve e por quanto tempo.',
    },
    {
      question: 'É melhor um booleano ou uma data de exclusão?',
      answer:
        'A data. Ela responde quando o registro foi apagado, permite expurgar por janela de retenção, calcular quem estava ativo em um período e restaurar em conjunto o que foi apagado no mesmo instante. Um booleano perde tudo isso. Também não misture estado de negócio com exclusão: um usuário suspenso ou inativo continua existindo e deve ter uma coluna de status própria, separada de excluido_em.',
    },
    {
      question: 'Meu ORM já tem soft delete embutido. Isso basta?',
      answer:
        'Não basta. Recursos como o paranoid do Sequelize, o SoftDeletes do Eloquent ou um default_scope no Rails cobrem as consultas montadas pelo ORM, e são bons para a ergonomia do código. Eles não cobrem SQL cru, ferramentas de BI, restrições de unicidade, tokens de acesso nem sistemas que recebem cópias dos dados. Use o recurso do ORM junto com o índice único parcial, a visão com privilégios no banco e um teste de vazamento que rode contra o banco real.',
    },
  ],
  conclusion: {
    title: 'Apagado é uma regra de negócio, e regra repetida em cada consulta acaba esquecida',
    description:
      'O soft delete tira do banco a garantia de que o registro apagado sumiu e a entrega para a memória de quem escreve cada consulta. A correção é devolver a regra a um lugar só: índice único parcial para a unicidade, visão e privilégios para a leitura, uma operação de exclusão que trata filhos, credenciais e sistemas derivados na mesma transação, uma definição explícita de ativo no período para os relatórios e um expurgo que cumpre a janela de retenção. Com um teste de vazamento no CI, a fatura errada, o e-mail bloqueado e o ex-funcionário na escala deixam de ser surpresas e passam a ser casos cobertos.',
    cta: 'Falar sobre a modelagem de dados do meu sistema',
  },
  related: [
    {
      label: 'Chave estrangeira sem índice: a exclusão que trava a tabela inteira',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Retenção de dados em sistema com IA: o que guardar, por quanto tempo e como apagar',
      to: '/blog/retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B shift scheduling platform bills per active user and, like almost every system, never really deletes anything: removing an employee fills the excluido_em column (the deletion timestamp) and the row stays in the table. In a single month three tickets arrived that seemed unrelated. A customer with 187 active users was invoiced for 212 seats. The HR team of another customer could not register again an employee who had come back to the company, because the system answered that the email was already registered. And a former employee, removed in March, kept showing up in the schedule autocomplete and receiving the weekly summary email. All three have the same cause: with soft delete, the rule that a deleted record does not exist is no longer guaranteed by the database and starts to depend on every query, every index and every system that reads the table remembering it. This article shows where deleted records leak, how to reproduce each leak, how to give uniqueness back to live records, how to take the filter out of the hands of whoever writes the query, what to do with child rows, credentials, search and period reports, and how to purge and prove with a test that deleted stays deleted.',
  sections: [
    {
      title: 'Why soft delete leaks: the rule that lives in every query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A real DELETE is a guarantee from the database: after the commit, no query, index, report or job finds the row, and nobody has to do anything for that to be true. Soft delete trades that guarantee for a convention. The row still exists, and deletion becomes a predicate, excluido_em IS NULL, that has to be repeated everywhere the table is read. A rule that must be remembered in a hundred places will be forgotten in one, and one is enough.',
        },
        {
          type: 'diagram',
          value: readersDiagram,
        },
        {
          type: 'paragraph',
          value:
            'The default scope of the ORM gives the impression that the problem is solved, because the main screens go through it. But the table has other readers, and the ORM does not speak for them. The table below links each ticket of that month to its cause and to the reason nobody noticed earlier.',
        },
        {
          type: 'table',
          columns: ['Symptom', 'Cause', 'Why it went unnoticed'],
          rows: [
            [
              'Invoice with 212 seats for 187 active users',
              'Raw SQL aggregation without the deletion filter',
              'The report was written outside the ORM, where the default scope does not exist',
            ],
            [
              'Email already registered when inviting someone who came back',
              'The UNIQUE constraint also counts the deleted row',
              'The constraint was created before soft delete and nobody revisited it',
            ],
            [
              'Name of someone who left in the schedule and the autocomplete',
              'The JOIN and the search indexer read the table without the filter',
              'Development and test databases have almost no deleted records',
            ],
            [
              'Former employee receiving the weekly summary',
              'The job reads another table and never checks excluido_em',
              'The tests of the job only create live users',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reproducing it: the report, the JOIN and the re-registration',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The schema below is the most common starting point: an excluido_em column, null while the record is live, and a UNIQUE constraint created before anyone thought about soft delete. Each statement that follows was correct for whoever wrote it, and each one leaks in a different way.',
        },
        {
          type: 'code',
          value: leakCode,
        },
        {
          type: 'list',
          items: [
            'The billing report counts rows, and a deleted row is a row. It was written in raw SQL, outside the ORM, and the default scope that protected the API never applied there.',
            'In a JOIN, the filter has to exist once for every soft-deleted table. Whoever wrote it remembered turnos (shifts) and forgot usuarios (users), and the schedule started showing the name of someone who had already left.',
            'In a LEFT JOIN, fixing it by putting the filter in the WHERE clause creates another defect: the shift assigned to a deleted user disappears from the result instead of showing up as unassigned. The condition on the right-hand table has to be in the ON clause.',
            'The UNIQUE constraint compares values and knows nothing about the business rule. For it, the Carla deleted in March still holds the email, and the re-registration fails with a unique violation.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'None of these defects shows up in development, where there are almost no deleted records, or in tests, where fixtures only create live users. They grow with the age of the system: the older the database, the larger the share of deleted rows and the more visible every query that forgot the filter.',
        },
      ],
    },
    {
      title: 'Uniqueness only among live rows: the partial unique index',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The re-registration fails because the question the constraint answers, is there another row with this email, is not the business question, is there another live user with this email. In PostgreSQL the right answer is a partial unique index, which only includes the rows that satisfy a predicate. A UNIQUE constraint declared on the table does not accept a WHERE clause, so the rule becomes an index.',
        },
        {
          type: 'code',
          value: uniqueCode,
        },
        {
          type: 'list',
          items: [
            'The most common trap is replacing the constraint with UNIQUE (empresa_id, email, excluido_em). Because two NULLs are not considered equal for uniqueness purposes, two live rows with the same email are accepted, and the rule vanishes precisely for the records that matter. Since PostgreSQL 15 you can declare NULLS NOT DISTINCT, but the partial index expresses the intent more directly.',
            'In MySQL, which has no partial indexes, the equivalent is a generated column that is 1 when the record is live and NULL when it is deleted, included in the unique index: deleted rows carry NULL and stop colliding. In SQL Server, a filtered index with WHERE excluido_em IS NULL plays the same role.',
            'Restoring a record can now fail: if someone registered the same email again while the old one was deleted, undoing the deletion violates the index. That is the correct behavior. Treat error 23505 during a restore as a conflict and offer to merge the records, instead of returning a 500 error.',
            'The uniqueness validation done in the application has to follow the same rule. If the ORM validates looking only at live rows and the database still counts deleted ones, or the other way around, the user gets a generic error in place of the validation message.',
            'The partial index for listings is smaller than the full index and contains exactly the rows the screens query. For the planner to use it, the query has to carry the same predicate, excluido_em IS NULL, which the view in the next section guarantees.',
          ],
        },
      ],
    },
    {
      title: 'Taking the filter out of the hands of whoever writes the query',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Fixing the queries that leaked solves the ticket of today and nothing else. The next query, written six months from now by someone who did not follow this incident, will forget the filter again. The lasting fix is to invert the default: reading live rows becomes the effortless path, and reaching deleted rows requires an explicit decision. In PostgreSQL that is done with a view and with privileges.',
        },
        {
          type: 'code',
          value: viewCode,
        },
        {
          type: 'paragraph',
          value:
            'The physical table gets a name that says what it contains, and the old name becomes a view that only shows live rows. Simple views over a single table are updatable in Postgres, so INSERT and UPDATE keep working under the usual name and the ORM does not notice the swap. By default a view accesses the table with the privileges of its owner, so the application role reads and writes through it without any access to the physical table. The raw SQL of a report, a new JOIN or a script that uses the application connection simply has no way to see a deleted row. And since the role was not granted DELETE, an accidental physical delete fails with a permission error instead of destroying data.',
        },
        {
          type: 'list',
          items: [
            'The column list of the view is fixed at creation. A new column on the physical table requires recreating the view in the same migration, and a test that compares the two lists is worth having.',
            'Roles that need to see deleted rows, such as support restoring accounts, the purge job and period billing, get access to the physical table. They are few, and for them the filter is a conscious decision.',
            'The BI tool and the analytics replica should connect with a role that also only sees the views. That is where most of the wrong numbers come from.',
            'The RENAME needs an exclusive lock for an instant. The short lock_timeout makes the migration give up and be retried, instead of queueing behind a long transaction and holding up every other query on the table.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The view is not the only way to centralize the rule. The table below compares the strategies by what each one actually protects.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'What it protects', 'Where it still leaks or what it costs'],
          rows: [
            [
              'Manual filter in every query',
              'Nothing beyond the discipline of whoever writes it',
              'Any new query, JOIN, raw SQL or report',
            ],
            [
              'ORM default scope',
              'Queries built by the ORM',
              'Raw SQL, hand-written aggregations and JOINs, BI tools and the escape hatch to see deleted rows, which becomes a habit',
            ],
            [
              'View with live rows only and privileges revoked on the physical table',
              'Everything that connects with the application role, including raw SQL',
              'Roles with access to the physical table still depend on discipline, and a new column requires recreating the view',
            ],
            [
              'Row-level security',
              'Every access by the role, without renaming anything',
              'The table owner and superusers bypass the policy, and a policy with only USING rejects the deletion UPDATE itself, because the new row no longer satisfies it',
            ],
            [
              'Archive table: moving the deleted row to another table',
              'No query reaches the deleted row, and uniqueness and foreign keys work on their own again',
              'Restoring takes more work, child rows need a destination at deletion time and the schemas of the two tables can drift apart',
            ],
          ],
        },
      ],
    },
    {
      title: 'What the database does not solve alone: child rows, credentials, search and period reports',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With uniqueness and reads solved in the database, what remains is what no index or view reaches: the data and systems that depend on the deleted record. In a real DELETE, the foreign key forces a decision about the child rows. With soft delete the row is still there, the foreign key is still satisfied and nothing forces anyone to decide anything.',
        },
        {
          type: 'list',
          items: [
            'Child rows: decide per child table whether deleting the parent deletes them too, detaches them or is blocked. Future shifts go back to the unassigned queue, and past shifts stay untouched because they are history. When you cascade, write the same instant to excluido_em on the parent and the children, so that restoring the parent can restore exactly the children that went down with it.',
            'Credentials: the authentication query usually reads only the token or session table. If it does not go through the user, the token of a deleted user keeps working. Revoke tokens and sessions in the same transaction as the deletion.',
            'Derived systems: the search index, the cache and the data warehouse hold copies. Soft delete is an UPDATE, so change data capture delivers an update, and a consumer that only removes documents when it sees a delete event never removes this one. Publish an explicit user deleted event, written in the same transaction.',
            'Jobs and notifications: the weekly summary reads recipients from a preferences table. Any table that stores a reference to the user and is read on its own is a leak point.',
          ],
        },
        {
          type: 'code',
          value: deleteCode,
        },
        {
          type: 'paragraph',
          value:
            'Period reports are a separate case, because in them the right answer is neither all rows nor only the rows that are live today. The invoice with 212 seats was wrong, but charging the 187 users live on closing day would also be wrong: 4 of the 25 deleted users were removed during the billed month and, by contract, a user active at any moment of the period is billed. The correct number was 191. This kind of query has to see deleted rows on purpose, with a role that has that access, and it needs a definition of active in the period written in the SQL.',
        },
        {
          type: 'code',
          value: periodCode,
        },
        {
          type: 'paragraph',
          value:
            'That is why excluido_em should be a timestamp and not a boolean: only with the date can you answer who was active in March, purge by retention window and restore together what was deleted together.',
        },
      ],
    },
    {
      title: 'Purging for real and proving that deleted stays deleted',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Soft delete without a purge is just a table that grows forever. Deleted rows weigh on full indexes, backups and scans, and they are still stored personal data. An erasure request under LGPD or GDPR is not fulfilled by a filled excluido_em column: the data is still in the table, in the search index and in the exports. Define a retention window per table, the time during which restoring still makes sense, and after it delete for real.',
        },
        {
          type: 'code',
          value: purgeCode,
        },
        {
          type: 'list',
          items: [
            'Delete in small batches and repeat until no rows are left. A single DELETE of millions of rows holds locks for minutes, produces a WAL spike and delays the replicas.',
            'Child rows need a destination before the parent: ON DELETE CASCADE, SET NULL or their own purge. And every foreign key column that points to the table needs an index, otherwise each batch scans the child tables in full.',
            'When retention is mandatory for tax or audit reasons, anonymize instead of deleting: replace name and email with neutral values and keep the id, so the history stays consistent without identifying the person.',
            'The purge also has to reach derived systems and respect backup rotation. Document how long it takes for deleted data to stop existing everywhere.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Finally, the proof. The test below connects with the same role as the application, creates a sentinel user, deletes it and walks through every read function exported by the queries module, requiring that the sentinel does not appear in any of them. A new query joins the check just by being exported, without depending on someone remembering to write a test for it. The other two tests pin down the database guarantees: the email of a deleted user can be reused, two live users cannot share an email and the application cannot reach the physical table.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Run it against a real Postgres, in a container, with the migrations applied and the app_api role created. The guarantee you want to prove lives in the privileges and the indexes, and that is exactly what an in-memory database or a mock does not reproduce.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Should I drop soft delete and delete for real?',
      answer:
        'It depends on why it exists. If the goal is to allow undoing a deletion for a few days, an archive table or a trash with a purge solves it without contaminating queries. If the goal is auditing, a history table records who changed what much better. Soft delete in the table itself makes sense when other records need to keep pointing to the row, such as the shift history of someone who left. The mistake is adopting it by default on every table, without answering what it is for and for how long.',
    },
    {
      question: 'Is a boolean or a deletion date better?',
      answer:
        'The date. It tells you when the record was deleted, lets you purge by retention window, compute who was active in a period and restore together what was deleted at the same instant. A boolean loses all of that. Also do not mix business state with deletion: a suspended or inactive user still exists and should have its own status column, separate from excluido_em.',
    },
    {
      question: 'My ORM already has built-in soft delete. Is that enough?',
      answer:
        'It is not enough. Features such as paranoid in Sequelize, SoftDeletes in Eloquent or a default_scope in Rails cover the queries built by the ORM, and they are good for code ergonomics. They do not cover raw SQL, BI tools, uniqueness constraints, access tokens or systems that receive copies of the data. Use the ORM feature together with the partial unique index, the view with privileges in the database and a leak test that runs against the real database.',
    },
  ],
  conclusion: {
    title: 'Deleted is a business rule, and a rule repeated in every query ends up forgotten',
    description:
      'Soft delete takes away from the database the guarantee that a deleted record is gone and hands it to the memory of whoever writes each query. The fix is to give the rule back to a single place: a partial unique index for uniqueness, a view and privileges for reads, a delete operation that handles child rows, credentials and derived systems in the same transaction, an explicit definition of active in the period for reports and a purge that honors the retention window. With a leak test in CI, the wrong invoice, the blocked email and the former employee in the schedule stop being surprises and become covered cases.',
    cta: 'Talk about the data modeling of my system',
  },
  related: [
    {
      label: 'Foreign key without an index: the delete that locks the whole table',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Data retention in an AI system: what to keep, for how long and how to delete it',
      to: '/blog/retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma B2B de gestión de turnos cobra por usuario activo y, como casi todos los sistemas, no borra nada de verdad: eliminar a un empleado rellena la columna excluido_em (la fecha de borrado) y la fila sigue en la tabla. En un solo mes llegaron tres tickets que parecían no tener relación. Un cliente con 187 usuarios activos recibió la factura con 212 licencias. El equipo de RR. HH. de otro no lograba volver a registrar a una empleada que había regresado a la empresa, porque el sistema respondía que el correo ya estaba registrado. Y un exempleado, eliminado en marzo, seguía apareciendo en el autocompletado de los turnos y recibiendo el resumen semanal por correo. Los tres tienen la misma causa: con soft delete, la regla de que lo borrado no existe deja de estar garantizada por la base de datos y pasa a depender de que cada consulta, cada índice y cada sistema que lee la tabla se acuerde de ella. Este artículo muestra por dónde se filtra el registro borrado, cómo reproducir cada fuga, cómo devolver la unicidad a los registros vivos, cómo quitar el filtro de las manos de quien escribe la consulta, qué hacer con los hijos, las credenciales, la búsqueda y los informes de período, y cómo purgar y demostrar con una prueba que lo borrado sigue borrado.',
  sections: [
    {
      title: 'Por qué el soft delete se filtra: la regla que vive en cada consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un DELETE de verdad es una garantía de la base de datos: después del commit, ninguna consulta, índice, informe o job encuentra la fila, sin que nadie tenga que hacer nada. El soft delete cambia esa garantía por una convención. La fila sigue existiendo, y el borrado se convierte en un predicado, excluido_em IS NULL, que hay que repetir en todos los lugares que leen la tabla. Una regla que hay que recordar en cien lugares se olvidará en alguno, y con uno basta.',
        },
        {
          type: 'diagram',
          value: readersDiagram,
        },
        {
          type: 'paragraph',
          value:
            'El scope por defecto del ORM da la impresión de que el problema está resuelto, porque las pantallas principales pasan por él. Pero la tabla tiene otros lectores, y el ORM no habla por ellos. La tabla siguiente relaciona cada ticket del mes con su causa y con el motivo por el que nadie lo notó antes.',
        },
        {
          type: 'table',
          columns: ['Síntoma', 'Causa', 'Por qué pasó desapercibido'],
          rows: [
            [
              'Factura con 212 licencias para 187 usuarios activos',
              'Agregación en SQL crudo sin el filtro de borrado',
              'El informe se escribió fuera del ORM, donde el scope por defecto no existe',
            ],
            [
              'Correo ya registrado al volver a invitar a quien regresó',
              'La restricción UNIQUE también cuenta la fila borrada',
              'La restricción se creó antes del soft delete y nadie la revisó',
            ],
            [
              'Nombre de quien se fue en los turnos y en el autocompletado',
              'El JOIN y el indexador de búsqueda leen la tabla sin el filtro',
              'En desarrollo y en pruebas casi no hay registros borrados',
            ],
            [
              'Exempleado recibiendo el resumen semanal',
              'El job lee otra tabla y nunca consulta excluido_em',
              'Las pruebas del job solo crean usuarios vivos',
            ],
          ],
        },
      ],
    },
    {
      title: 'Reproducirlo: el informe, el JOIN y el nuevo registro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El esquema siguiente es el punto de partida más común: una columna excluido_em, nula mientras el registro está vivo, y una restricción UNIQUE creada antes de que alguien pensara en soft delete. Cada sentencia que sigue era correcta para quien la escribió, y cada una se filtra de una manera distinta.',
        },
        {
          type: 'code',
          value: leakCode,
        },
        {
          type: 'list',
          items: [
            'El informe de facturación cuenta filas, y una fila borrada es una fila. Se escribió en SQL crudo, fuera del ORM, y el scope por defecto que protegía la API nunca pasó por ahí.',
            'En el JOIN, el filtro tiene que existir una vez por cada tabla con soft delete. Quien lo escribió se acordó de turnos y se olvidó de usuarios, y la pantalla de turnos empezó a mostrar el nombre de quien ya se había ido.',
            'En el LEFT JOIN, corregirlo poniendo el filtro en el WHERE crea otro defecto: el turno asignado a un usuario borrado desaparece del resultado, en lugar de aparecer como sin responsable. La condición sobre la tabla de la derecha tiene que estar en la cláusula ON.',
            'La restricción UNIQUE compara valores y no conoce la regla de negocio. Para ella, la Carla borrada en marzo todavía ocupa el correo, y el nuevo registro falla con una violación de unicidad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ninguno de estos defectos aparece en desarrollo, donde casi no existen registros borrados, ni en las pruebas, donde los fixtures solo crean usuarios vivos. Crecen con la edad del sistema: cuanto más antigua es la base, mayor es la proporción de filas borradas y más visible cada consulta que olvidó el filtro.',
        },
      ],
    },
    {
      title: 'Unicidad solo entre los vivos: el índice único parcial',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El nuevo registro falla porque la pregunta que responde la restricción, existe otra fila con este correo, no es la pregunta del negocio, existe otro usuario vivo con este correo. En PostgreSQL la respuesta correcta es un índice único parcial, que solo incluye las filas que cumplen un predicado. Una restricción UNIQUE declarada en la tabla no acepta WHERE, por eso la regla pasa a ser un índice.',
        },
        {
          type: 'code',
          value: uniqueCode,
        },
        {
          type: 'list',
          items: [
            'La trampa más común es cambiar la restricción por UNIQUE (empresa_id, email, excluido_em). Como dos NULL no se consideran iguales a efectos de unicidad, dos filas vivas con el mismo correo pasan, y la regla desaparece justo para los registros que importan. Desde PostgreSQL 15 se puede declarar NULLS NOT DISTINCT, pero el índice parcial expresa la intención de forma más directa.',
            'En MySQL, que no tiene índices parciales, el equivalente es una columna generada que vale 1 cuando el registro está vivo y NULL cuando está borrado, incluida en el índice único: las filas borradas quedan con NULL y dejan de colisionar. En SQL Server, el índice filtrado con WHERE excluido_em IS NULL cumple el mismo papel.',
            'Restaurar un registro ahora puede fallar: si alguien volvió a registrar el mismo correo mientras el antiguo estaba borrado, deshacer el borrado viola el índice. Ese es el comportamiento correcto. Trate el error 23505 en la restauración como un conflicto y ofrezca unir los registros, en lugar de devolver un error 500.',
            'La validación de unicidad hecha en la aplicación tiene que seguir la misma regla. Si el ORM valida mirando solo los vivos y la base todavía cuenta los borrados, o al revés, el usuario recibe un error genérico en lugar del mensaje de validación.',
            'El índice parcial de los listados es más pequeño que el índice completo y contiene exactamente las filas que consultan las pantallas. Para que el planificador lo use, la consulta tiene que traer el mismo predicado, excluido_em IS NULL, algo que la vista de la siguiente sección garantiza.',
          ],
        },
      ],
    },
    {
      title: 'Quitar el filtro de las manos de quien escribe la consulta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Corregir las consultas que se filtraron resuelve el ticket de hoy y nada más. La próxima consulta, escrita dentro de seis meses por alguien que no siguió este incidente, volverá a olvidar el filtro. La corrección duradera es invertir el valor por defecto: leer los vivos pasa a ser el camino sin esfuerzo, y llegar a los borrados pasa a exigir una decisión explícita. En PostgreSQL eso se hace con una vista y con privilegios.',
        },
        {
          type: 'code',
          value: viewCode,
        },
        {
          type: 'paragraph',
          value:
            'La tabla física recibe un nombre que dice lo que contiene, y el nombre antiguo se convierte en una vista que solo muestra los vivos. Las vistas simples sobre una sola tabla son actualizables en Postgres, así que INSERT y UPDATE siguen funcionando con el nombre de siempre y el ORM no nota el cambio. Por defecto, una vista accede a la tabla con los privilegios de su dueño, por eso el rol de la aplicación lee y escribe a través de ella sin tener ningún acceso a la tabla física. El SQL crudo de un informe, un JOIN nuevo o un script que use la conexión de la aplicación simplemente no tiene cómo ver un registro borrado. Y como el rol no recibió DELETE, un borrado físico accidental falla con un error de permisos en lugar de destruir datos.',
        },
        {
          type: 'list',
          items: [
            'La lista de columnas de la vista queda fijada en la creación. Una columna nueva en la tabla física exige recrear la vista en la misma migración, y vale la pena una prueba que compare las dos listas.',
            'Los roles que necesitan ver los borrados, como soporte cuando restaura cuentas, el job de purga y la facturación por período, reciben acceso a la tabla física. Son pocos, y en ellos el filtro es una decisión consciente.',
            'La herramienta de BI y la réplica analítica deben conectarse con un rol que también vea solo las vistas. Por ahí sale la mayor parte de los números equivocados.',
            'El RENAME pide un lock exclusivo durante un instante. El lock_timeout corto hace que la migración desista y se repita, en lugar de quedarse en la cola detrás de una transacción larga y retener todas las demás consultas de la tabla.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La vista no es la única forma de centralizar la regla. La tabla siguiente compara las estrategias por lo que cada una protege realmente.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Qué protege', 'Dónde sigue filtrándose o qué cuesta'],
          rows: [
            [
              'Filtro manual en cada consulta',
              'Nada más allá de la disciplina de quien escribe',
              'Cualquier consulta nueva, JOIN, SQL crudo o informe',
            ],
            [
              'Scope por defecto del ORM',
              'Las consultas armadas por el ORM',
              'SQL crudo, agregaciones y JOIN escritos a mano, herramientas de BI y el escape para ver borrados, que se vuelve costumbre',
            ],
            [
              'Vista solo con los vivos y privilegios revocados en la tabla física',
              'Todo lo que se conecta con el rol de la aplicación, incluido el SQL crudo',
              'Los roles con acceso a la tabla física siguen dependiendo de la disciplina, y una columna nueva exige recrear la vista',
            ],
            [
              'Row-level security',
              'Todo acceso del rol, sin renombrar nada',
              'El dueño de la tabla y el superusuario ignoran la política, y una política solo con USING rechaza el propio UPDATE de borrado, porque la fila nueva deja de cumplirla',
            ],
            [
              'Tabla de archivo: mover la fila borrada a otra tabla',
              'Ninguna consulta alcanza lo borrado, y la unicidad y las claves foráneas vuelven a funcionar solas',
              'Restaurar da más trabajo, los hijos necesitan un destino en el momento del borrado y el esquema de las dos tablas puede divergir',
            ],
          ],
        },
      ],
    },
    {
      title: 'Lo que la base de datos no resuelve sola: hijos, credenciales, búsqueda e informes de período',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la unicidad y la lectura resueltas en la base de datos, queda lo que ningún índice o vista alcanza: los datos y sistemas que dependen del registro borrado. En un DELETE de verdad, la clave foránea obliga a decidir el destino de los hijos. En el soft delete la fila sigue ahí, la clave foránea sigue cumplida y nada obliga a nadie a decidir nada.',
        },
        {
          type: 'list',
          items: [
            'Hijos: decida por cada tabla hija si el borrado del padre los borra también, los desvincula o queda bloqueado. Los turnos futuros vuelven a la cola de sin responsable, y los turnos pasados quedan intactos porque son historial. Cuando borre en cascada, grabe el mismo instante en excluido_em del padre y de los hijos, para que restaurar al padre pueda restaurar exactamente los hijos que cayeron con él.',
            'Credenciales: la consulta de autenticación suele leer solo la tabla de tokens o de sesiones. Si no pasa por el usuario, el token de un usuario borrado sigue valiendo. Revoque tokens y sesiones en la misma transacción del borrado.',
            'Sistemas derivados: el índice de búsqueda, la caché y el data warehouse guardan copias. El soft delete es un UPDATE, así que la captura de cambios de la base entrega una actualización, y el consumidor que solo elimina documentos al ver un evento de borrado nunca elimina este. Publique un evento explícito de usuario borrado, grabado en la misma transacción.',
            'Jobs y notificaciones: el resumen semanal lee los destinatarios de una tabla de preferencias. Cualquier tabla que guarde una referencia al usuario y se lea por separado es un punto de fuga.',
          ],
        },
        {
          type: 'code',
          value: deleteCode,
        },
        {
          type: 'paragraph',
          value:
            'Los informes de período son un caso aparte, porque en ellos la respuesta correcta no es ni todas las filas ni solo los vivos de hoy. La factura con 212 licencias estaba mal, pero cobrar los 187 vivos del día del cierre también lo estaría: 4 de los 25 borrados fueron eliminados durante el mes facturado y, por contrato, se cobra al usuario activo en cualquier momento del período. El número correcto era 191. Este tipo de consulta tiene que ver los borrados a propósito, con un rol que tenga ese acceso, y necesita una definición de activo en el período escrita en el SQL.',
        },
        {
          type: 'code',
          value: periodCode,
        },
        {
          type: 'paragraph',
          value:
            'Por eso excluido_em debe ser un instante y no un booleano: solo con la fecha se puede responder quién estaba activo en marzo, purgar por ventana de retención y restaurar en conjunto lo que se borró junto.',
        },
      ],
    },
    {
      title: 'Purgar de verdad y demostrar que lo borrado sigue borrado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El soft delete sin purga es solo una tabla que crece para siempre. Las filas borradas pesan en los índices completos, en los backups y en los recorridos, y siguen siendo datos personales almacenados. Una solicitud de supresión con base en la LGPD o en el RGPD no se atiende con una columna excluido_em rellenada: el dato sigue en la tabla, en el índice de búsqueda y en las exportaciones. Defina una ventana de retención por tabla, el tiempo en que restaurar todavía tiene sentido, y después de ella borre de verdad.',
        },
        {
          type: 'code',
          value: purgeCode,
        },
        {
          type: 'list',
          items: [
            'Borre en lotes pequeños y repita hasta que no quede ninguna fila. Un DELETE único de millones de filas retiene locks durante minutos, genera un pico de WAL y retrasa las réplicas.',
            'Los hijos necesitan un destino antes que el padre: ON DELETE CASCADE, SET NULL o una purga propia. Y toda columna de clave foránea que apunte a la tabla necesita un índice, porque de lo contrario cada lote recorre las tablas hijas enteras.',
            'Cuando la retención sea obligatoria por motivos fiscales o de auditoría, anonimice en lugar de borrar: cambie el nombre y el correo por valores neutros y conserve el id, para que el historial siga íntegro sin identificar a la persona.',
            'La purga también tiene que llegar a los sistemas derivados y respetar la rotación de los backups. Documente en cuánto tiempo un dato borrado deja de existir en todos los lugares.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Por último, la demostración. La prueba siguiente se conecta con el mismo rol de la aplicación, crea un usuario centinela, lo borra y recorre todas las funciones de lectura exportadas por el módulo de consultas, exigiendo que el centinela no aparezca en ninguna. Una consulta nueva entra en la verificación solo por estar exportada, sin depender de que alguien se acuerde de escribir su prueba. Las otras dos pruebas fijan las garantías de la base de datos: el correo de un borrado se puede reutilizar, dos vivos no comparten correo y la aplicación no alcanza la tabla física.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Ejecútela contra un Postgres real, en contenedor, con las migraciones aplicadas y el rol app_api creado. La garantía que se quiere demostrar está en los privilegios y en los índices, y eso es justo lo que una base de datos en memoria o un mock no reproduce.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Debo abandonar el soft delete y borrar de verdad?',
      answer:
        'Depende del motivo por el que existe. Si el objetivo es permitir deshacer un borrado durante algunos días, una tabla de archivo o una papelera con purga lo resuelve sin contaminar las consultas. Si el objetivo es la auditoría, una tabla de historial registra mejor quién cambió qué. El soft delete en la propia tabla tiene sentido cuando otros registros necesitan seguir apuntando a la fila, como el historial de turnos de quien se fue. El error es adoptarlo por defecto en todas las tablas, sin responder para qué sirve y por cuánto tiempo.',
    },
    {
      question: '¿Es mejor un booleano o una fecha de borrado?',
      answer:
        'La fecha. Responde cuándo se borró el registro, permite purgar por ventana de retención, calcular quién estaba activo en un período y restaurar en conjunto lo que se borró en el mismo instante. Un booleano pierde todo eso. Tampoco mezcle el estado de negocio con el borrado: un usuario suspendido o inactivo sigue existiendo y debe tener su propia columna de estado, separada de excluido_em.',
    },
    {
      question: 'Mi ORM ya tiene soft delete incorporado. ¿Con eso basta?',
      answer:
        'No basta. Funciones como paranoid de Sequelize, SoftDeletes de Eloquent o un default_scope en Rails cubren las consultas armadas por el ORM, y son buenas para la ergonomía del código. No cubren el SQL crudo, las herramientas de BI, las restricciones de unicidad, los tokens de acceso ni los sistemas que reciben copias de los datos. Use la función del ORM junto con el índice único parcial, la vista con privilegios en la base de datos y una prueba de fugas que se ejecute contra la base real.',
    },
  ],
  conclusion: {
    title: 'Borrado es una regla de negocio, y una regla repetida en cada consulta termina olvidada',
    description:
      'El soft delete le quita a la base de datos la garantía de que el registro borrado desapareció y se la entrega a la memoria de quien escribe cada consulta. La corrección es devolver la regla a un solo lugar: índice único parcial para la unicidad, vista y privilegios para la lectura, una operación de borrado que trata hijos, credenciales y sistemas derivados en la misma transacción, una definición explícita de activo en el período para los informes y una purga que cumple la ventana de retención. Con una prueba de fugas en el CI, la factura equivocada, el correo bloqueado y el exempleado en los turnos dejan de ser sorpresas y pasan a ser casos cubiertos.',
    cta: 'Hablar sobre el modelado de datos de mi sistema',
  },
  related: [
    {
      label: 'Clave foránea sin índice: el borrado que bloquea la tabla entera',
      to: '/blog/chave-estrangeira-sem-indice-exclusao-que-trava-tabela-inteira',
    },
    {
      label: 'Retención de datos en un sistema con IA: qué guardar, por cuánto tiempo y cómo borrarlo',
      to: '/blog/retencao-dados-sistema-ia-o-que-guardar-quanto-tempo-como-apagar',
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
