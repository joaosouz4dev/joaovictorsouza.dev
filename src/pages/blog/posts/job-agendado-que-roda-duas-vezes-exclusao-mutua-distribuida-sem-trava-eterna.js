// Conteudo do artigo: job agendado que roda duas vezes, por que isso acontece
// com varias replicas e como implementar exclusao mutua com lease, geracao e
// registro de execucao por janela, sem criar uma trava que nunca expira.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O fechamento de comissões rodava todo dia às 00:05 e nunca tinha dado problema, até a semana em que o serviço passou de uma para três réplicas para aguentar o tráfego de uma campanha. Na manhã seguinte, cento e doze vendedores receberam três e-mails de comissão, e o financeiro encontrou três lançamentos por loja. O agendador estava embutido na aplicação, e cada réplica disparou o job no mesmo minuto. A correção feita às pressas foi uma trava no Redis com SET NX, sem expiração, liberada no final do job. Funcionou por três semanas, até que um pod foi morto por falta de memória no meio do fechamento. A trava nunca foi liberada, as réplicas seguintes encontraram a chave ocupada e desistiram em silêncio, e o fechamento ficou nove dias sem rodar até alguém perguntar por que as comissões não tinham chegado. Os dois incidentes são faces do mesmo problema: exclusão mútua entre processos que não compartilham memória, podem morrer a qualquer momento e podem ficar parados sem saber. Este artigo mostra de onde vêm as execuções duplicadas, por que a trava sem prazo e a trava com prazo ingênuo falham de formas opostas, como implementar um lease no PostgreSQL com renovação e número de geração, como usar esse número como cerca para rejeitar a escrita de quem perdeu a trava, por que ainda é preciso registrar a execução por janela agendada, e como operar tudo isso com métricas que avisam antes do cliente.',
  sections: [
    {
      title: 'Por que um job agendado roda duas vezes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um agendador dentro da aplicação, seja node-cron, um @Scheduled do Spring ou um setInterval, só sabe do processo em que está. Enquanto o serviço tem uma instância, "rodar às 00:05" e "rodar uma vez às 00:05" significam a mesma coisa. No dia em que a infraestrutura escala horizontalmente, a segunda frase deixa de ser verdade sem que nenhuma linha de código mude. E réplicas são só a causa mais óbvia: mesmo com uma instância, existem pelo menos quatro outros caminhos para a mesma ocorrência executar mais de uma vez.',
        },
        {
          type: 'table',
          columns: ['Causa', 'Como acontece', 'Sinal nos logs'],
          rows: [
            [
              'Várias réplicas com agendador embutido',
              'Cada instância carrega o mesmo cron; escalar de uma para três réplicas triplica as execuções',
              'Mesmo horário de início em hosts diferentes',
            ],
            [
              'Deploy com sobreposição',
              'O rolling update mantém o pod antigo e o novo vivos ao mesmo tempo; se o horário cai nessa janela, os dois disparam',
              'Duas execuções com versões diferentes da aplicação',
            ],
            [
              'Execução mais longa que o intervalo',
              'O job de cinco em cinco minutos passa a levar sete, e a próxima ocorrência começa com a anterior ainda rodando',
              'Duração maior que o intervalo e execuções sobrepostas no mesmo host',
            ],
            [
              'Reentrega do agendador externo',
              'CronJob do Kubernetes, EventBridge e Cloud Scheduler entregam pelo menos uma vez; um timeout gera nova tentativa de algo que já executou',
              'Dois inícios com segundos de diferença para a mesma ocorrência',
            ],
            [
              'Recuperação de disparo perdido',
              'O agendador executa ao reiniciar as ocorrências que "perdeu" enquanto estava fora, inclusive as que outra instância já cobriu',
              'Execução fora do horário logo depois de um deploy ou reinício',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A consequência de rodar duas vezes depende do que o job faz. Um job que recalcula um cache desperdiça CPU e ninguém percebe. Um job que envia e-mails, gera cobranças, lança comissões ou chama uma API externa com efeito colateral produz dano visível ao cliente. É por isso que a pergunta certa não é "como garantir que roda uma vez", que nenhum sistema distribuído garante sozinho, e sim "o que acontece se rodar duas vezes, e quais camadas impedem que isso vire dano".',
        },
      ],
    },
    {
      title: 'A trava sem prazo e a trava com prazo ingênuo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira ideia de quase todo time é uma trava compartilhada: antes de rodar, grava uma chave; se a chave já existe, outra instância está rodando e esta desiste. O problema está em quem apaga a chave. Se só o próprio job apaga no final, qualquer morte abrupta entre o início e o fim, como falta de memória, deploy que mata o processo, nó que some ou um kill -9, deixa a trava para sempre. O job não falha, simplesmente para de rodar, e o único sinal é a ausência de algo que deveria ter acontecido.',
        },
        {
          type: 'code',
          value: `// Trava sem prazo: correta enquanto nada morre no meio do caminho.
const ok = await redis.set('trava:fechamento', 'ocupado', 'NX');
if (!ok) return; // outra instancia rodando... ou uma instancia que morreu ha nove dias
try {
  await fecharComissoes();
} finally {
  await redis.del('trava:fechamento'); // nunca executa se o processo for morto
}

// Trava com prazo: expira sozinha, mas pode expirar com o dono ainda vivo.
const ok2 = await redis.set('trava:fechamento', idDoProcesso, 'NX', 'PX', 60000);`,
        },
        {
          type: 'paragraph',
          value:
            'A correção natural é dar prazo à trava, e ela resolve a trava eterna, mas cria o problema oposto. O prazo é uma aposta sobre quanto tempo o dono vai precisar dela, e o dono não controla o próprio tempo. Uma pausa longa de coleta de lixo, uma CPU estrangulada pelo limite do contêiner, uma VM migrada a quente ou uma consulta lenta podem fazer o processo ficar parado mais que o prazo. Quando ele volta, não tem como saber que a trava venceu, e continua de onde parou.',
        },
        {
          type: 'diagram',
          value: `t=0s    A adquire a trava (prazo de 60s) e começa o fechamento
t=20s   A fica parado: pausa de GC, CPU estrangulada ou VM migrada
t=60s   a trava vence; ninguém liberou, ela apenas expirou
t=61s   B adquire a trava e começa o mesmo fechamento
t=75s   A volta, sem saber que perdeu a trava, e grava as comissões
t=80s   B grava as comissões
        -> duas escritas, as duas feitas "com a trava"`,
        },
        {
          type: 'paragraph',
          value:
            'Há ainda um terceiro defeito, mais sutil, no DEL do exemplo: se A volta depois que B adquiriu a trava e executa o finally, apaga a trava de B, e uma terceira instância pode entrar. Liberar exige conferir o dono, e conferir e apagar precisam ser uma única operação atômica. Os três defeitos juntos mostram o que uma trava distribuída precisa ter: prazo para sobreviver à morte do dono, renovação para que o prazo não precise adivinhar a duração do job, liberação condicionada ao dono, e uma forma de o recurso protegido recusar a escrita de quem perdeu a trava sem saber.',
        },
      ],
    },
    {
      title: 'Lease no PostgreSQL com dono, renovação e geração',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Se o job já escreve no PostgreSQL, a forma mais simples de ter essas quatro propriedades é uma tabela de leases no próprio banco. Cada linha representa uma trava nomeada, com o identificador do dono, o instante em que vence e um número de geração que só cresce. Toda tomada de posse incrementa a geração, e esse número passa a identificar a posse de forma única, algo que o nome do host ou o PID não fazem, porque o mesmo processo pode perder e retomar a trava.',
        },
        {
          type: 'code',
          value: `CREATE TABLE travas_job (
  nome      text PRIMARY KEY,
  dono      text NOT NULL,
  geracao   bigint NOT NULL,
  expira_em timestamptz NOT NULL
);

-- Adquirir: cria a linha ou toma posse de uma trava vencida.
-- Devolve a nova geracao, ou nenhuma linha se outro dono ainda esta valido.
INSERT INTO travas_job AS t (nome, dono, geracao, expira_em)
VALUES ($1, $2, 1, now() + make_interval(secs => $3))
ON CONFLICT (nome) DO UPDATE
   SET dono      = EXCLUDED.dono,
       geracao   = t.geracao + 1,
       expira_em = EXCLUDED.expira_em
 WHERE t.expira_em <= now()
RETURNING geracao;

-- Renovar: so o dono atual, na mesma geracao e antes de vencer.
UPDATE travas_job
   SET expira_em = now() + make_interval(secs => $3)
 WHERE nome = $1 AND dono = $2 AND geracao = $4 AND expira_em > now();

-- Liberar: vence a trava sem apagar a linha, para a geracao nunca voltar a 1.
UPDATE travas_job
   SET expira_em = now()
 WHERE nome = $1 AND dono = $2 AND geracao = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'A aquisição é uma única instrução: o INSERT com ON CONFLICT DO UPDATE e a cláusula WHERE só toma posse se a trava atual estiver vencida, e o RETURNING só devolve linha quando a posse mudou. Duas instâncias disputando ao mesmo tempo se serializam no índice da chave primária, e a segunda reavalia a condição sobre a versão já atualizada pela primeira, então apenas uma recebe a geração. Não existe janela entre ler e escrever, que é o erro clássico de quem implementa isso com um SELECT seguido de UPDATE.',
        },
        {
          type: 'list',
          items: [
            'Todos os prazos usam now() do banco, e não o relógio de cada réplica. Hosts com relógios diferentes discordariam sobre quando a trava venceu, e um host adiantado tomaria posse de uma trava que para o dono ainda é válida.',
            'A liberação não apaga a linha. Se apagasse, a próxima aquisição criaria a trava de novo com geração 1, e um dono antigo com geração 7 pareceria mais recente. A geração precisa ser monotônica para servir de cerca.',
            'A renovação exige dono, geração e prazo ainda válido. Quem já perdeu a trava recebe zero linhas afetadas e sabe que deve parar, em vez de estender silenciosamente uma posse que já é de outro.',
            'O prazo deixa de ser uma estimativa da duração do job. Com renovação a cada terço do prazo, um job de duas horas funciona com prazo de noventa segundos, e uma instância morta é substituída em no máximo noventa segundos.',
          ],
        },
      ],
    },
    {
      title: 'O executor em Node.js e a cerca na escrita',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O executor encapsula o ciclo completo: tenta adquirir, desiste sem erro se outro dono estiver ativo, renova em segundo plano enquanto a tarefa roda, sinaliza a tarefa para parar se a renovação falhar e libera no final. A tarefa recebe a geração e um AbortSignal, e fica responsável por conferir o sinal entre unidades de trabalho.',
        },
        {
          type: 'code',
          value: `// trava-job.js: lease no PostgreSQL com renovacao e geracao (node-postgres).
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const DONO = os.hostname() + ':' + process.pid + ':' + randomUUID().slice(0, 8);

const SQL_ADQUIRIR =
  'INSERT INTO travas_job AS t (nome, dono, geracao, expira_em) ' +
  'VALUES ($1, $2, 1, now() + make_interval(secs => $3)) ' +
  'ON CONFLICT (nome) DO UPDATE SET dono = EXCLUDED.dono, ' +
  'geracao = t.geracao + 1, expira_em = EXCLUDED.expira_em ' +
  'WHERE t.expira_em <= now() RETURNING geracao';
const SQL_RENOVAR =
  'UPDATE travas_job SET expira_em = now() + make_interval(secs => $3) ' +
  'WHERE nome = $1 AND dono = $2 AND geracao = $4 AND expira_em > now()';
const SQL_LIBERAR =
  'UPDATE travas_job SET expira_em = now() ' +
  'WHERE nome = $1 AND dono = $2 AND geracao = $3';

export async function executarComTrava(pool, nome, ttlSegundos, tarefa) {
  const { rows } = await pool.query(SQL_ADQUIRIR, [nome, DONO, ttlSegundos]);
  if (rows.length === 0) return { executou: false };

  const geracao = rows[0].geracao; // bigint chega como string no node-postgres
  const controle = new AbortController();

  // Renova a cada terco do prazo. Na duvida (erro ou posse perdida), para a tarefa.
  const renovacao = setInterval(async () => {
    try {
      const r = await pool.query(SQL_RENOVAR, [nome, DONO, ttlSegundos, geracao]);
      if (r.rowCount === 0) controle.abort(new Error('trava perdida'));
    } catch (erro) {
      controle.abort(erro);
    }
  }, (ttlSegundos * 1000) / 3);

  try {
    const resultado = await tarefa({ geracao, sinal: controle.signal });
    return { executou: true, resultado };
  } finally {
    clearInterval(renovacao);
    await pool.query(SQL_LIBERAR, [nome, DONO, geracao]).catch(() => {});
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O AbortSignal reduz a janela de dano, mas não a elimina. Um processo pausado não executa o callback de renovação, não percebe o abort e não confere o sinal: ele simplesmente volta a rodar a próxima linha, que pode ser uma escrita. Para fechar essa janela, a escrita precisa conferir a posse no mesmo lugar em que acontece. Quando o recurso protegido está no mesmo banco, isso é uma consulta com FOR SHARE dentro da transação da escrita.',
        },
        {
          type: 'code',
          value: `// fechamento-diario.js: cada loja e gravada em uma transacao que confere a posse.
import { executarComTrava } from './trava-job.js';

const SQL_CONFERIR_POSSE =
  'SELECT 1 FROM travas_job ' +
  'WHERE nome = $1 AND geracao = $2 AND expira_em > now() FOR SHARE';

export function fechamentoDiario(pool, dia) {
  return executarComTrava(pool, 'fechamento-diario', 90, async ({ geracao, sinal }) => {
    const { rows: lojas } = await pool.query('SELECT id FROM lojas WHERE ativa ORDER BY id');

    for (const loja of lojas) {
      sinal.throwIfAborted();
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const posse = await cliente.query(SQL_CONFERIR_POSSE, ['fechamento-diario', geracao]);
        if (posse.rowCount === 0) throw new Error('trava perdida antes da escrita');

        await cliente.query(
          'INSERT INTO comissoes (loja_id, dia, valor) ' +
            'SELECT $1::bigint, $2::date, coalesce(sum(total), 0) * 0.05 FROM pedidos ' +
            'WHERE loja_id = $1::bigint AND criado_em >= $2::date AND criado_em < $2::date + 1 ' +
            'ON CONFLICT (loja_id, dia) DO NOTHING',
          [loja.id, dia],
        );
        await cliente.query('COMMIT');
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw erro;
      } finally {
        cliente.release();
      }
    }
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'O FOR SHARE é o que transforma a conferência em cerca. Ele trava a linha da trava em modo compartilhado até o COMMIT, e a tomada de posse por outra instância precisa de um bloqueio de atualização sobre a mesma linha, que conflita com ele. Assim, ou a conferência vê a geração vencida e aborta, ou a escrita termina antes que qualquer outro dono possa assumir. FOR KEY SHARE não serviria, porque não conflita com uma atualização que não muda a chave primária. A restrição única em comissoes com ON CONFLICT DO NOTHING é a última camada: mesmo que tudo acima falhe, a segunda gravação da mesma loja no mesmo dia não produz um segundo lançamento.',
        },
        {
          type: 'paragraph',
          value:
            'Quando o efeito é externo, como uma API de pagamentos ou um envio de e-mail, a mesma ideia vale na forma de fencing token: a geração vai junto com a requisição e o destino recusa qualquer requisição com geração menor que a maior já vista para aquele recurso. Se o destino não oferece isso, o recurso disponível é a chave de idempotência derivada da ocorrência, como fechamento-2026-09-25-loja-42, que faz a segunda chamada devolver o resultado da primeira em vez de repetir o efeito.',
        },
      ],
    },
    {
      title: 'Trava impede concorrência, não repetição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o lease funcionando, duas instâncias nunca executam o fechamento ao mesmo tempo. Isso não significa que ele executa uma vez por dia. Se a réplica A termina às 00:05:40 e libera a trava, e a réplica B tem o agendador atrasado por um reinício, um deploy ou um relógio dois minutos atrás, B adquire uma trava livre às 00:07 e fecha o dia de novo. A trava resolve sobreposição, e o problema aqui é sequência. Para ele, o job precisa registrar qual ocorrência já foi concluída.',
        },
        {
          type: 'code',
          value: `CREATE TABLE execucoes_job (
  nome         text NOT NULL,
  janela       date NOT NULL,
  dono         text NOT NULL,
  tentativas   int  NOT NULL DEFAULT 1,
  iniciado_em  timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  PRIMARY KEY (nome, janela)
);

-- Reivindicar a janela, ja com a trava em maos: so segue se ela nunca foi concluida.
-- Uma execucao que morreu no meio pode ser retomada; uma concluida, nao.
INSERT INTO execucoes_job AS e (nome, janela, dono)
VALUES ($1, $2, $3)
ON CONFLICT (nome, janela) DO UPDATE
   SET dono        = EXCLUDED.dono,
       tentativas  = e.tentativas + 1,
       iniciado_em = now()
 WHERE e.concluido_em IS NULL
RETURNING tentativas;

-- Ao terminar com sucesso, marcar a janela como concluida.
UPDATE execucoes_job
   SET concluido_em = now()
 WHERE nome = $1 AND janela = $2 AND dono = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe decisivo é como a janela é calculada. Ela precisa vir da ocorrência que o agendador pretendia executar, e não do horário em que a execução começou. Para um fechamento diário, a janela é o dia sendo fechado, no fuso do negócio: tanto a execução pontual das 00:05 quanto uma atrasada das 03:40 chegam à mesma chave, e a segunda encontra a janela concluída. Se a janela fosse derivada do timestamp de início arredondado para o minuto, cada atraso produziria uma chave nova e a proteção desapareceria justamente nos casos em que ela é necessária.',
        },
        {
          type: 'table',
          columns: ['Camada', 'O que impede', 'O que não impede'],
          rows: [
            [
              'Lease com renovação',
              'Duas execuções simultâneas do mesmo job',
              'Uma segunda execução depois que a primeira terminou',
            ],
            [
              'Cerca pela geração na escrita',
              'Escrita de um dono que ficou parado e perdeu a trava',
              'Efeitos em sistemas que não conferem a geração',
            ],
            [
              'Registro de execução por janela',
              'Repetir uma ocorrência já concluída',
              'Duplicidade dentro de uma execução que morreu no meio',
            ],
            [
              'Restrição única ou chave de idempotência no efeito',
              'Duplicar o resultado de uma unidade de trabalho',
              'Custo de processar de novo o que já foi feito',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Nenhuma camada sozinha é suficiente, e a tabela mostra por quê. A última linha é a mais importante, porque é a única que protege o dado mesmo quando todas as outras falham, e é também a que torna seguro retomar uma execução interrompida: a tentativa seguinte refaz as lojas que faltaram e passa pelas já gravadas sem duplicar nada.',
        },
      ],
    },
    {
      title: 'Operar sem surpresa: métricas, prazo e alternativas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A trava eterna do início durou nove dias porque o sistema só registrava o que acontecia, e o defeito era algo que deixou de acontecer. Jobs agendados precisam de monitoramento por ausência, além do monitoramento por erro.',
        },
        {
          type: 'list',
          items: [
            'Alerta de janela não concluída: se execucoes_job não tem linha concluída para ontem até as 02:00, alguém é avisado, independentemente do motivo.',
            'Idade da trava: uma trava com expira_em no futuro e sem renovação recente, ou com a mesma geração há mais tempo que a maior duração conhecida do job, indica um dono travado.',
            'Execuções puladas por trava ocupada, por job e por host. Algumas por dia são normais com várias réplicas; um aumento súbito indica uma execução que não termina.',
            'Posses perdidas: toda renovação com zero linhas afetadas e toda escrita recusada pela cerca devem virar log estruturado e métrica, porque são a evidência de pausas longas ou de prazo curto demais.',
            'Duração comparada ao intervalo: quando a duração de um job recorrente passa de metade do intervalo, a sobreposição deixou de ser hipótese.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O prazo deve ser várias vezes maior que o pior atraso esperado de uma renovação, somando latência do banco, pausas de GC e estrangulamento de CPU, e pequeno o bastante para que a substituição de uma instância morta não atrase o job de forma relevante. Entre sessenta e cento e vinte segundos, com renovação a cada terço, costuma funcionar para jobs de negócio. Prazos de poucos segundos transformam qualquer lentidão do banco em troca de dono, e prazos de meia hora reintroduzem a trava eterna em escala menor.',
        },
        {
          type: 'table',
          columns: ['Mecanismo', 'Sobrevive à morte do dono', 'Protege contra dono pausado', 'Observação'],
          rows: [
            ['Redis SET NX sem prazo', 'Não', 'Não', 'Produz a trava eterna'],
            [
              'Redis SET NX PX com liberação condicional',
              'Sim, pelo prazo',
              'Não, sem geração',
              'Adequado quando rodar duas vezes custa só processamento',
            ],
            [
              'pg_try_advisory_lock de sessão',
              'Sim, quando a conexão cai',
              'Parcialmente, se toda escrita usar a mesma conexão',
              'Prende uma conexão durante o job e não funciona com PgBouncer em modo transação',
            ],
            [
              'Tabela de lease com geração',
              'Sim, pelo prazo',
              'Sim, com a cerca na escrita',
              'Exige conferir a geração no recurso protegido',
            ],
            [
              'CronJob com concurrencyPolicy: Forbid',
              'Sim',
              'Não',
              'Impede Jobs sobrepostos, mas a própria documentação do Kubernetes admite disparos duplicados raros',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Mover o agendamento para fora da aplicação, com um CronJob ou um agendador gerenciado, resolve a multiplicação por réplicas e costuma ser a decisão certa quando o job é pesado. Mas não resolve reentregas nem execuções sequenciais, e por isso o registro por janela e a idempotência no efeito continuam necessários. O que muda é onde fica o primeiro filtro, não a necessidade das outras camadas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Redlock com vários servidores Redis resolve o problema do dono pausado?',
      answer:
        'Não. O Redlock aumenta a disponibilidade do serviço de trava, porque a trava sobrevive à queda de um dos servidores Redis, mas não muda o que acontece do lado do cliente. Um processo que adquiriu a trava e ficou parado por mais tempo que o prazo continua acreditando que a possui quando volta, e nenhum número de servidores Redis impede essa escrita tardia. O que impede é o recurso protegido conferir um número monotônico a cada escrita e recusar números antigos, e o Redlock não fornece esse número. Para jobs em que a duplicidade custa só processamento, um único Redis com SET NX PX e liberação condicional é suficiente. Para jobs com efeito sobre dinheiro ou comunicação com clientes, a proteção precisa estar na escrita, com geração ou com chave de idempotência, e aí a escolha entre um ou vários Redis deixa de ser a decisão importante.',
    },
    {
      question: 'Por que não usar apenas pg_try_advisory_lock?',
      answer:
        'O advisory lock de sessão é barato e tem uma propriedade valiosa: é liberado automaticamente quando a conexão fecha, então não existe trava eterna enquanto o banco detectar a queda. Ele funciona bem quando o job inteiro roda na mesma conexão que segura o lock. Os problemas aparecem fora desse cenário. O job precisa manter uma conexão dedicada aberta durante toda a execução, o que pesa em pools pequenos. Com PgBouncer em modo transação, cada instrução pode ir para uma conexão diferente do servidor, e o lock pode ser adquirido em uma e ficar preso a outro cliente. E se o job escreve por outras conexões do pool, a perda da conexão do lock não impede essas escritas, então não há cerca. A variante de transação, pg_try_advisory_xact_lock, funciona com PgBouncer quando o job cabe em uma única transação, o que raramente vale para fechamentos longos. A tabela de lease custa algumas linhas a mais e resolve todos esses casos com a mesma lógica.',
    },
    {
      question: 'Qual prazo usar para a trava e de quanto em quanto tempo renovar?',
      answer:
        'O prazo não é a duração esperada do job, e esse é o erro mais comum. Ele é o tempo máximo que o sistema aceita esperar para outra instância assumir depois que o dono morreu, e precisa ser várias vezes maior que o pior atraso de uma renovação. Renovar a cada terço do prazo dá ao dono duas tentativas antes de perder a posse por uma lentidão pontual. Para a maioria dos jobs de negócio, um prazo de sessenta a cento e vinte segundos com renovação a cada vinte a quarenta segundos equilibra as duas pontas. Prazos muito curtos transformam picos de latência do banco em troca de dono e em execuções abortadas; prazos muito longos atrasam a recuperação e escondem instâncias travadas. A métrica que diz se o prazo está certo é a de posses perdidas: se ela aparece sem instâncias mortas, o prazo está curto demais para o ambiente.',
    },
  ],
  conclusion: {
    title: 'Rodar uma vez é uma propriedade construída em camadas, não um horário no cron',
    description:
      'Um job agendado roda duas vezes porque réplicas, deploys, reentregas e atrasos criam ocorrências extras sem que nenhum código mude, e a trava ingênua troca esse problema por outro: sem prazo, ela prende o job para sempre quando o dono morre; com prazo e sem cerca, ela deixa um dono pausado escrever depois de perder a posse. Um lease no banco, com dono, renovação e geração monotônica, resolve a concorrência; a conferência da geração dentro da transação da escrita fecha a janela do dono pausado; o registro de execução por janela impede a repetição sequencial; e a restrição única no efeito protege o dado quando todo o resto falha. Com alertas por ausência, a trava eterna deixa de durar nove dias. Posso revisar os jobs agendados do seu sistema, mapear onde uma execução duplicada vira dano ao cliente e implementar as camadas que faltam sem parar a operação.',
    cta: 'Falar sobre a confiabilidade dos meus jobs',
  },
  related: [
    {
      label: 'Relógio dessincronizado entre serviços: quando a ordem dos eventos deixa de existir',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Chave de idempotência no checkout: cobrar uma vez sem travar o fluxo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The commission close ran every day at 00:05 and had never caused trouble, until the week the service went from one to three replicas to handle traffic from a campaign. The next morning, one hundred and twelve sales reps received three commission emails each, and finance found three entries per store. The scheduler was embedded in the application, and every replica fired the job in the same minute. The rushed fix was a Redis lock with SET NX, no expiry, released at the end of the job. It worked for three weeks, until a pod was killed for running out of memory in the middle of the close. The lock was never released, the following replicas found the key taken and silently gave up, and the close did not run for nine days until someone asked why commissions had not arrived. Both incidents are faces of the same problem: mutual exclusion between processes that share no memory, can die at any moment and can stall without knowing it. This article shows where duplicate runs come from, why a lock with no deadline and a lock with a naive deadline fail in opposite ways, how to implement a lease in PostgreSQL with renewal and a generation number, how to use that number as a fence that rejects writes from whoever lost the lock, why you still need to record each run per scheduled window, and how to operate all of it with metrics that warn you before the customer does.',
  sections: [
    {
      title: 'Why a scheduled job runs twice',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A scheduler inside the application, whether node-cron, a Spring @Scheduled or a setInterval, only knows about the process it lives in. While the service has one instance, "run at 00:05" and "run once at 00:05" mean the same thing. The day the infrastructure scales horizontally, the second sentence stops being true without a single line of code changing. And replicas are only the most obvious cause: even with one instance, there are at least four other paths for the same occurrence to run more than once.',
        },
        {
          type: 'table',
          columns: ['Cause', 'How it happens', 'Signal in the logs'],
          rows: [
            [
              'Several replicas with an embedded scheduler',
              'Every instance loads the same cron; scaling from one to three replicas triples the runs',
              'Same start time on different hosts',
            ],
            [
              'Overlapping deploy',
              'A rolling update keeps the old and new pods alive at the same time; if the schedule falls in that window, both fire',
              'Two runs with different application versions',
            ],
            [
              'Run longer than the interval',
              'The every-five-minutes job starts taking seven, and the next occurrence begins with the previous one still running',
              'Duration above the interval and overlapping runs on the same host',
            ],
            [
              'Redelivery from an external scheduler',
              'Kubernetes CronJob, EventBridge and Cloud Scheduler deliver at least once; a timeout triggers a retry of something that already ran',
              'Two starts a few seconds apart for the same occurrence',
            ],
            [
              'Missed-run recovery',
              'On restart, the scheduler runs the occurrences it "missed" while down, including ones another instance already covered',
              'An off-schedule run right after a deploy or restart',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The consequence of running twice depends on what the job does. A job that rebuilds a cache wastes CPU and nobody notices. A job that sends emails, creates charges, books commissions or calls an external API with side effects causes damage the customer can see. That is why the right question is not "how do I guarantee it runs once", which no distributed system guarantees on its own, but "what happens if it runs twice, and which layers stop that from becoming damage".',
        },
      ],
    },
    {
      title: 'The lock with no deadline and the lock with a naive deadline',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost every team starts with a shared lock: before running, write a key; if the key already exists, another instance is running and this one backs off. The problem is who deletes the key. If only the job itself deletes it at the end, any abrupt death between start and finish, such as running out of memory, a deploy that kills the process, a node that disappears or a kill -9, leaves the lock in place forever. The job does not fail, it simply stops running, and the only signal is the absence of something that should have happened.',
        },
        {
          type: 'code',
          value: `// Lock with no deadline: correct as long as nothing dies halfway.
const ok = await redis.set('lock:commission-close', 'busy', 'NX');
if (!ok) return; // another instance running... or one that died nine days ago
try {
  await closeCommissions();
} finally {
  await redis.del('lock:commission-close'); // never runs if the process is killed
}

// Lock with a deadline: expires on its own, but may expire while the owner is alive.
const ok2 = await redis.set('lock:commission-close', processId, 'NX', 'PX', 60000);`,
        },
        {
          type: 'paragraph',
          value:
            'The natural fix is to give the lock a deadline, and it does solve the eternal lock, but it creates the opposite problem. The deadline is a bet on how long the owner will need it, and the owner does not control its own time. A long garbage collection pause, a CPU throttled by the container limit, a live-migrated VM or a slow query can keep the process stalled longer than the deadline. When it comes back, it has no way of knowing the lock expired, and it continues where it left off.',
        },
        {
          type: 'diagram',
          value: `t=0s    A acquires the lock (60s deadline) and starts the close
t=20s   A stalls: GC pause, throttled CPU or migrated VM
t=60s   the lock expires; nobody released it, it just ran out
t=61s   B acquires the lock and starts the same close
t=75s   A resumes, unaware it lost the lock, and writes the commissions
t=80s   B writes the commissions
        -> two writes, both made "holding the lock"`,
        },
        {
          type: 'paragraph',
          value:
            'There is a third, subtler defect in the DEL of the example: if A comes back after B acquired the lock and runs the finally block, it deletes B\'s lock, and a third instance can get in. Releasing requires checking the owner, and checking and deleting must be one atomic operation. Together, the three defects show what a distributed lock needs: a deadline to survive the owner dying, renewal so the deadline does not have to guess the job duration, release conditioned on ownership, and a way for the protected resource to reject writes from someone who lost the lock without knowing it.',
        },
      ],
    },
    {
      title: 'A PostgreSQL lease with owner, renewal and generation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'If the job already writes to PostgreSQL, the simplest way to get these four properties is a lease table in the same database. Each row represents a named lock, with the owner identifier, the instant it expires and a generation number that only grows. Every takeover increments the generation, and that number becomes a unique identifier of ownership, something the hostname or PID cannot provide, because the same process can lose the lock and take it back.',
        },
        {
          type: 'code',
          value: `CREATE TABLE job_locks (
  name       text PRIMARY KEY,
  owner      text NOT NULL,
  generation bigint NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Acquire: create the row or take over an expired lock.
-- Returns the new generation, or no row if another owner is still valid.
INSERT INTO job_locks AS l (name, owner, generation, expires_at)
VALUES ($1, $2, 1, now() + make_interval(secs => $3))
ON CONFLICT (name) DO UPDATE
   SET owner      = EXCLUDED.owner,
       generation = l.generation + 1,
       expires_at = EXCLUDED.expires_at
 WHERE l.expires_at <= now()
RETURNING generation;

-- Renew: only the current owner, in the same generation, before expiry.
UPDATE job_locks
   SET expires_at = now() + make_interval(secs => $3)
 WHERE name = $1 AND owner = $2 AND generation = $4 AND expires_at > now();

-- Release: expire the lock without deleting the row, so the generation never resets to 1.
UPDATE job_locks
   SET expires_at = now()
 WHERE name = $1 AND owner = $2 AND generation = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'Acquisition is a single statement: the INSERT with ON CONFLICT DO UPDATE and its WHERE clause only takes over if the current lock has expired, and RETURNING only yields a row when ownership changed. Two instances competing at the same time serialize on the primary key index, and the second one re-evaluates the condition against the version already updated by the first, so only one receives the generation. There is no gap between reading and writing, which is the classic mistake of implementing this with a SELECT followed by an UPDATE.',
        },
        {
          type: 'list',
          items: [
            'Every deadline uses the database now(), not each replica\'s clock. Hosts with different clocks would disagree on when the lock expired, and a host running ahead would take over a lock that is still valid for its owner.',
            'Release does not delete the row. If it did, the next acquisition would create the lock again with generation 1, and an old owner holding generation 7 would look newer. The generation must be monotonic to work as a fence.',
            'Renewal requires owner, generation and a still-valid deadline. Whoever already lost the lock gets zero affected rows and knows it must stop, instead of silently extending ownership that already belongs to someone else.',
            'The deadline stops being an estimate of job duration. With renewal every third of the deadline, a two-hour job works with a ninety-second deadline, and a dead instance is replaced in at most ninety seconds.',
          ],
        },
      ],
    },
    {
      title: 'The Node.js runner and the fence on the write',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The runner wraps the full cycle: try to acquire, back off without an error if another owner is active, renew in the background while the task runs, signal the task to stop if renewal fails, and release at the end. The task receives the generation and an AbortSignal, and is responsible for checking the signal between units of work.',
        },
        {
          type: 'code',
          value: `// job-lock.js: PostgreSQL lease with renewal and generation (node-postgres).
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const OWNER = os.hostname() + ':' + process.pid + ':' + randomUUID().slice(0, 8);

const SQL_ACQUIRE =
  'INSERT INTO job_locks AS l (name, owner, generation, expires_at) ' +
  'VALUES ($1, $2, 1, now() + make_interval(secs => $3)) ' +
  'ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner, ' +
  'generation = l.generation + 1, expires_at = EXCLUDED.expires_at ' +
  'WHERE l.expires_at <= now() RETURNING generation';
const SQL_RENEW =
  'UPDATE job_locks SET expires_at = now() + make_interval(secs => $3) ' +
  'WHERE name = $1 AND owner = $2 AND generation = $4 AND expires_at > now()';
const SQL_RELEASE =
  'UPDATE job_locks SET expires_at = now() ' +
  'WHERE name = $1 AND owner = $2 AND generation = $3';

export async function runWithLock(pool, name, ttlSeconds, task) {
  const { rows } = await pool.query(SQL_ACQUIRE, [name, OWNER, ttlSeconds]);
  if (rows.length === 0) return { ran: false };

  const generation = rows[0].generation; // bigint arrives as a string in node-postgres
  const controller = new AbortController();

  // Renew every third of the deadline. When in doubt (error or lost ownership), stop the task.
  const renewal = setInterval(async () => {
    try {
      const r = await pool.query(SQL_RENEW, [name, OWNER, ttlSeconds, generation]);
      if (r.rowCount === 0) controller.abort(new Error('lock lost'));
    } catch (error) {
      controller.abort(error);
    }
  }, (ttlSeconds * 1000) / 3);

  try {
    const result = await task({ generation, signal: controller.signal });
    return { ran: true, result };
  } finally {
    clearInterval(renewal);
    await pool.query(SQL_RELEASE, [name, OWNER, generation]).catch(() => {});
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The AbortSignal narrows the damage window, but does not close it. A stalled process does not run the renewal callback, does not notice the abort and does not check the signal: it simply resumes at the next line, which may be a write. To close that window, the write must check ownership in the same place where it happens. When the protected resource lives in the same database, that is a query with FOR SHARE inside the write transaction.',
        },
        {
          type: 'code',
          value: `// daily-close.js: each store is written in a transaction that checks ownership.
import { runWithLock } from './job-lock.js';

const SQL_CHECK_OWNERSHIP =
  'SELECT 1 FROM job_locks ' +
  'WHERE name = $1 AND generation = $2 AND expires_at > now() FOR SHARE';

export function dailyClose(pool, day) {
  return runWithLock(pool, 'daily-close', 90, async ({ generation, signal }) => {
    const { rows: stores } = await pool.query('SELECT id FROM stores WHERE active ORDER BY id');

    for (const store of stores) {
      signal.throwIfAborted();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const owned = await client.query(SQL_CHECK_OWNERSHIP, ['daily-close', generation]);
        if (owned.rowCount === 0) throw new Error('lock lost before the write');

        await client.query(
          'INSERT INTO commissions (store_id, day, amount) ' +
            'SELECT $1::bigint, $2::date, coalesce(sum(total), 0) * 0.05 FROM orders ' +
            'WHERE store_id = $1::bigint AND created_at >= $2::date AND created_at < $2::date + 1 ' +
            'ON CONFLICT (store_id, day) DO NOTHING',
          [store.id, day],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'FOR SHARE is what turns the check into a fence. It locks the lock row in shared mode until COMMIT, and a takeover by another instance needs an update lock on that same row, which conflicts with it. So either the check sees the expired generation and aborts, or the write finishes before any other owner can take over. FOR KEY SHARE would not work, because it does not conflict with an update that leaves the primary key untouched. The unique constraint on commissions with ON CONFLICT DO NOTHING is the last layer: even if everything above fails, a second write for the same store on the same day does not produce a second entry.',
        },
        {
          type: 'paragraph',
          value:
            'When the effect is external, such as a payments API or an email send, the same idea applies as a fencing token: the generation travels with the request and the destination rejects any request with a generation lower than the highest one already seen for that resource. If the destination does not support that, the available tool is an idempotency key derived from the occurrence, such as close-2026-09-25-store-42, which makes the second call return the result of the first instead of repeating the effect.',
        },
      ],
    },
    {
      title: 'A lock prevents concurrency, not repetition',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the lease working, two instances never run the close at the same time. That does not mean it runs once a day. If replica A finishes at 00:05:40 and releases the lock, and replica B has its scheduler delayed by a restart, a deploy or a clock two minutes behind, B acquires a free lock at 00:07 and closes the day again. The lock solves overlap, and the problem here is sequence. For that, the job needs to record which occurrence has already been completed.',
        },
        {
          type: 'code',
          value: `CREATE TABLE job_runs (
  name         text NOT NULL,
  run_window   date NOT NULL,
  owner        text NOT NULL,
  attempts     int  NOT NULL DEFAULT 1,
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (name, run_window)
);

-- Claim the window, already holding the lock: proceed only if it was never completed.
-- A run that died halfway can be resumed; a completed one cannot.
INSERT INTO job_runs AS r (name, run_window, owner)
VALUES ($1, $2, $3)
ON CONFLICT (name, run_window) DO UPDATE
   SET owner      = EXCLUDED.owner,
       attempts   = r.attempts + 1,
       started_at = now()
 WHERE r.completed_at IS NULL
RETURNING attempts;

-- On success, mark the window as completed.
UPDATE job_runs
   SET completed_at = now()
 WHERE name = $1 AND run_window = $2 AND owner = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'The deciding detail is how the window is computed. It must come from the occurrence the scheduler intended to run, not from the time the run started. For a daily close, the window is the day being closed, in the business time zone: both the on-time run at 00:05 and a delayed one at 03:40 map to the same key, and the second finds the window completed. If the window were derived from the start timestamp rounded to the minute, each delay would produce a new key and the protection would vanish exactly in the cases where it is needed.',
        },
        {
          type: 'table',
          columns: ['Layer', 'What it prevents', 'What it does not prevent'],
          rows: [
            [
              'Lease with renewal',
              'Two simultaneous runs of the same job',
              'A second run after the first one finished',
            ],
            [
              'Generation fence on the write',
              'Writes from an owner that stalled and lost the lock',
              'Effects on systems that do not check the generation',
            ],
            [
              'Run record per window',
              'Repeating an occurrence already completed',
              'Duplicates inside a run that died halfway',
            ],
            [
              'Unique constraint or idempotency key on the effect',
              'Duplicating the result of a unit of work',
              'The cost of processing again what was already done',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No single layer is enough, and the table shows why. The last row is the most important, because it is the only one that protects the data even when all the others fail, and it is also what makes resuming an interrupted run safe: the next attempt redoes the missing stores and passes over the ones already written without duplicating anything.',
        },
      ],
    },
    {
      title: 'Operating without surprises: metrics, deadlines and alternatives',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The eternal lock from the opening lasted nine days because the system only recorded what happened, and the defect was something that stopped happening. Scheduled jobs need monitoring for absence, not just monitoring for errors.',
        },
        {
          type: 'list',
          items: [
            'Uncompleted window alert: if job_runs has no completed row for yesterday by 02:00, someone is paged, whatever the reason.',
            'Lock age: a lock with expires_at in the future and no recent renewal, or with the same generation for longer than the longest known job duration, points to a stuck owner.',
            'Runs skipped because the lock was taken, per job and per host. A few per day are normal with several replicas; a sudden increase points to a run that never finishes.',
            'Lost ownership: every renewal with zero affected rows and every write rejected by the fence must become a structured log and a metric, because they are the evidence of long pauses or a deadline that is too short.',
            'Duration compared to the interval: once a recurring job takes more than half its interval, overlap is no longer hypothetical.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The deadline should be several times larger than the worst expected delay of a renewal, adding database latency, GC pauses and CPU throttling, and small enough that replacing a dead instance does not delay the job in a meaningful way. Between sixty and one hundred and twenty seconds, with renewal every third, usually works for business jobs. Deadlines of a few seconds turn any database slowdown into an ownership change, and half-hour deadlines bring back the eternal lock on a smaller scale.',
        },
        {
          type: 'table',
          columns: ['Mechanism', 'Survives owner death', 'Protects against a stalled owner', 'Notes'],
          rows: [
            ['Redis SET NX with no deadline', 'No', 'No', 'Produces the eternal lock'],
            [
              'Redis SET NX PX with conditional release',
              'Yes, through the deadline',
              'No, there is no generation',
              'Fine when running twice only costs processing',
            ],
            [
              'Session-level pg_try_advisory_lock',
              'Yes, when the connection drops',
              'Partly, if every write uses the same connection',
              'Holds a connection for the whole job and does not work with PgBouncer in transaction mode',
            ],
            [
              'Lease table with generation',
              'Yes, through the deadline',
              'Yes, with the fence on the write',
              'Requires checking the generation at the protected resource',
            ],
            [
              'CronJob with concurrencyPolicy: Forbid',
              'Yes',
              'No',
              'Prevents overlapping Jobs, but the Kubernetes documentation itself admits rare duplicate triggers',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Moving scheduling out of the application, with a CronJob or a managed scheduler, solves the multiplication by replicas and is usually the right call when the job is heavy. But it does not solve redeliveries or sequential runs, which is why the per-window record and idempotency on the effect are still needed. What changes is where the first filter sits, not the need for the other layers.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does Redlock with several Redis servers solve the stalled owner problem?',
      answer:
        'No. Redlock increases the availability of the lock service, because the lock survives one Redis server going down, but it does not change what happens on the client side. A process that acquired the lock and stalled for longer than the deadline still believes it holds the lock when it resumes, and no number of Redis servers prevents that late write. What prevents it is the protected resource checking a monotonic number on every write and rejecting old numbers, and Redlock does not provide that number. For jobs where a duplicate only costs processing, a single Redis with SET NX PX and conditional release is enough. For jobs that affect money or customer communication, the protection has to live in the write, with a generation or an idempotency key, and then choosing one or several Redis servers stops being the important decision.',
    },
    {
      question: 'Why not just use pg_try_advisory_lock?',
      answer:
        'A session advisory lock is cheap and has a valuable property: it is released automatically when the connection closes, so there is no eternal lock as long as the database detects the drop. It works well when the whole job runs on the same connection that holds the lock. The problems show up outside that scenario. The job must keep a dedicated connection open for the entire run, which hurts with small pools. With PgBouncer in transaction mode, each statement may go to a different server connection, and the lock can be acquired on one and end up attached to another client. And if the job writes through other pool connections, losing the lock connection does not stop those writes, so there is no fence. The transaction variant, pg_try_advisory_xact_lock, works with PgBouncer when the job fits in a single transaction, which is rarely the case for long closes. The lease table costs a few more lines and handles all these cases with the same logic.',
    },
    {
      question: 'What deadline should the lock use, and how often should it be renewed?',
      answer:
        'The deadline is not the expected job duration, and that is the most common mistake. It is the maximum time the system accepts waiting for another instance to take over after the owner died, and it must be several times larger than the worst renewal delay. Renewing every third of the deadline gives the owner two attempts before losing ownership to a one-off slowdown. For most business jobs, a deadline of sixty to one hundred and twenty seconds with renewal every twenty to forty seconds balances both ends. Very short deadlines turn database latency spikes into ownership changes and aborted runs; very long ones delay recovery and hide stuck instances. The metric that tells you whether the deadline is right is lost ownership: if it shows up without dead instances, the deadline is too short for the environment.',
    },
  ],
  conclusion: {
    title: 'Running once is a property built in layers, not a time in the cron',
    description:
      'A scheduled job runs twice because replicas, deploys, redeliveries and delays create extra occurrences without any code changing, and the naive lock trades that problem for another: without a deadline, it blocks the job forever when the owner dies; with a deadline and no fence, it lets a stalled owner write after losing ownership. A lease in the database, with owner, renewal and a monotonic generation, solves concurrency; checking the generation inside the write transaction closes the stalled-owner window; the per-window run record prevents sequential repetition; and the unique constraint on the effect protects the data when everything else fails. With absence alerts, an eternal lock no longer lasts nine days. I can review the scheduled jobs in your system, map where a duplicate run turns into customer damage and implement the missing layers without stopping operations.',
    cta: 'Talk about the reliability of my jobs',
  },
  related: [
    {
      label: 'Clock skew between services: when event ordering stops existing',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Idempotency key at checkout: charging once without freezing the flow',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El cierre de comisiones corría todos los días a las 00:05 y nunca había dado problemas, hasta la semana en que el servicio pasó de una a tres réplicas para aguantar el tráfico de una campaña. A la mañana siguiente, ciento doce vendedores recibieron tres correos de comisión, y finanzas encontró tres asientos por tienda. El programador de tareas estaba embebido en la aplicación, y cada réplica disparó el job en el mismo minuto. La corrección hecha a las apuradas fue un bloqueo en Redis con SET NX, sin expiración, liberado al final del job. Funcionó tres semanas, hasta que un pod fue terminado por falta de memoria en medio del cierre. El bloqueo nunca se liberó, las réplicas siguientes encontraron la clave ocupada y desistieron en silencio, y el cierre pasó nueve días sin correr hasta que alguien preguntó por qué no habían llegado las comisiones. Los dos incidentes son caras del mismo problema: exclusión mutua entre procesos que no comparten memoria, pueden morir en cualquier momento y pueden quedar detenidos sin saberlo. Este artículo muestra de dónde vienen las ejecuciones duplicadas, por qué el bloqueo sin plazo y el bloqueo con plazo ingenuo fallan de formas opuestas, cómo implementar un lease en PostgreSQL con renovación y número de generación, cómo usar ese número como barrera para rechazar la escritura de quien perdió el bloqueo, por qué aun así hay que registrar la ejecución por ventana programada, y cómo operar todo eso con métricas que avisan antes que el cliente.',
  sections: [
    {
      title: 'Por qué un job programado corre dos veces',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un programador dentro de la aplicación, sea node-cron, un @Scheduled de Spring o un setInterval, solo conoce el proceso en el que vive. Mientras el servicio tiene una instancia, "correr a las 00:05" y "correr una vez a las 00:05" significan lo mismo. El día en que la infraestructura escala horizontalmente, la segunda frase deja de ser verdad sin que cambie una sola línea de código. Y las réplicas son solo la causa más obvia: incluso con una instancia, existen al menos otros cuatro caminos para que la misma ocurrencia se ejecute más de una vez.',
        },
        {
          type: 'table',
          columns: ['Causa', 'Cómo ocurre', 'Señal en los logs'],
          rows: [
            [
              'Varias réplicas con programador embebido',
              'Cada instancia carga el mismo cron; escalar de una a tres réplicas triplica las ejecuciones',
              'Misma hora de inicio en hosts distintos',
            ],
            [
              'Despliegue con superposición',
              'El rolling update mantiene vivos el pod antiguo y el nuevo al mismo tiempo; si el horario cae en esa ventana, los dos disparan',
              'Dos ejecuciones con versiones distintas de la aplicación',
            ],
            [
              'Ejecución más larga que el intervalo',
              'El job de cada cinco minutos pasa a tardar siete, y la siguiente ocurrencia empieza con la anterior todavía corriendo',
              'Duración mayor que el intervalo y ejecuciones superpuestas en el mismo host',
            ],
            [
              'Reentrega del programador externo',
              'El CronJob de Kubernetes, EventBridge y Cloud Scheduler entregan al menos una vez; un timeout genera un reintento de algo que ya se ejecutó',
              'Dos inicios con segundos de diferencia para la misma ocurrencia',
            ],
            [
              'Recuperación de disparos perdidos',
              'Al reiniciar, el programador ejecuta las ocurrencias que "perdió" mientras estaba caído, incluidas las que otra instancia ya cubrió',
              'Ejecución fuera de horario justo después de un despliegue o reinicio',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia de correr dos veces depende de lo que hace el job. Un job que recalcula una caché desperdicia CPU y nadie lo nota. Un job que envía correos, genera cobros, registra comisiones o llama a una API externa con efectos secundarios produce un daño visible para el cliente. Por eso la pregunta correcta no es "cómo garantizo que corra una vez", algo que ningún sistema distribuido garantiza por sí solo, sino "qué pasa si corre dos veces, y qué capas impiden que eso se convierta en daño".',
        },
      ],
    },
    {
      title: 'El bloqueo sin plazo y el bloqueo con plazo ingenuo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi todos los equipos empiezan con un bloqueo compartido: antes de correr, se escribe una clave; si la clave ya existe, otra instancia está corriendo y esta desiste. El problema está en quién borra la clave. Si solo el propio job la borra al final, cualquier muerte abrupta entre el inicio y el fin, como falta de memoria, un despliegue que mata el proceso, un nodo que desaparece o un kill -9, deja el bloqueo para siempre. El job no falla, simplemente deja de correr, y la única señal es la ausencia de algo que debería haber ocurrido.',
        },
        {
          type: 'code',
          value: `// Bloqueo sin plazo: correcto mientras nada muera a mitad de camino.
const ok = await redis.set('bloqueo:cierre', 'ocupado', 'NX');
if (!ok) return; // otra instancia corriendo... o una que murio hace nueve dias
try {
  await cerrarComisiones();
} finally {
  await redis.del('bloqueo:cierre'); // nunca se ejecuta si el proceso es terminado
}

// Bloqueo con plazo: expira solo, pero puede expirar con el dueño todavia vivo.
const ok2 = await redis.set('bloqueo:cierre', idDelProceso, 'NX', 'PX', 60000);`,
        },
        {
          type: 'paragraph',
          value:
            'La corrección natural es darle plazo al bloqueo, y eso resuelve el bloqueo eterno, pero crea el problema opuesto. El plazo es una apuesta sobre cuánto tiempo lo va a necesitar el dueño, y el dueño no controla su propio tiempo. Una pausa larga de recolección de basura, una CPU estrangulada por el límite del contenedor, una VM migrada en caliente o una consulta lenta pueden dejar el proceso detenido más tiempo que el plazo. Cuando vuelve, no tiene cómo saber que el bloqueo venció, y sigue donde se quedó.',
        },
        {
          type: 'diagram',
          value: `t=0s    A adquiere el bloqueo (plazo de 60s) y empieza el cierre
t=20s   A se detiene: pausa de GC, CPU estrangulada o VM migrada
t=60s   el bloqueo vence; nadie lo liberó, simplemente expiró
t=61s   B adquiere el bloqueo y empieza el mismo cierre
t=75s   A vuelve, sin saber que perdió el bloqueo, y graba las comisiones
t=80s   B graba las comisiones
        -> dos escrituras, las dos hechas "con el bloqueo"`,
        },
        {
          type: 'paragraph',
          value:
            'Hay un tercer defecto, más sutil, en el DEL del ejemplo: si A vuelve después de que B adquirió el bloqueo y ejecuta el finally, borra el bloqueo de B, y una tercera instancia puede entrar. Liberar exige verificar el dueño, y verificar y borrar tienen que ser una única operación atómica. Juntos, los tres defectos muestran lo que necesita un bloqueo distribuido: plazo para sobrevivir a la muerte del dueño, renovación para que el plazo no tenga que adivinar la duración del job, liberación condicionada al dueño, y una forma de que el recurso protegido rechace la escritura de quien perdió el bloqueo sin saberlo.',
        },
      ],
    },
    {
      title: 'Lease en PostgreSQL con dueño, renovación y generación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Si el job ya escribe en PostgreSQL, la forma más simple de tener estas cuatro propiedades es una tabla de leases en la misma base. Cada fila representa un bloqueo con nombre, con el identificador del dueño, el instante en que vence y un número de generación que solo crece. Cada toma de posesión incrementa la generación, y ese número pasa a identificar la posesión de forma única, algo que el nombre del host o el PID no logran, porque el mismo proceso puede perder el bloqueo y recuperarlo.',
        },
        {
          type: 'code',
          value: `CREATE TABLE bloqueos_job (
  nombre     text PRIMARY KEY,
  dueno      text NOT NULL,
  generacion bigint NOT NULL,
  expira_en  timestamptz NOT NULL
);

-- Adquirir: crea la fila o toma posesion de un bloqueo vencido.
-- Devuelve la nueva generacion, o ninguna fila si otro dueño sigue vigente.
INSERT INTO bloqueos_job AS b (nombre, dueno, generacion, expira_en)
VALUES ($1, $2, 1, now() + make_interval(secs => $3))
ON CONFLICT (nombre) DO UPDATE
   SET dueno      = EXCLUDED.dueno,
       generacion = b.generacion + 1,
       expira_en  = EXCLUDED.expira_en
 WHERE b.expira_en <= now()
RETURNING generacion;

-- Renovar: solo el dueño actual, en la misma generacion y antes de vencer.
UPDATE bloqueos_job
   SET expira_en = now() + make_interval(secs => $3)
 WHERE nombre = $1 AND dueno = $2 AND generacion = $4 AND expira_en > now();

-- Liberar: vence el bloqueo sin borrar la fila, para que la generacion nunca vuelva a 1.
UPDATE bloqueos_job
   SET expira_en = now()
 WHERE nombre = $1 AND dueno = $2 AND generacion = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'La adquisición es una única instrucción: el INSERT con ON CONFLICT DO UPDATE y su cláusula WHERE solo toma posesión si el bloqueo actual está vencido, y el RETURNING solo devuelve fila cuando la posesión cambió. Dos instancias compitiendo al mismo tiempo se serializan en el índice de la clave primaria, y la segunda reevalúa la condición sobre la versión ya actualizada por la primera, así que solo una recibe la generación. No existe una ventana entre leer y escribir, que es el error clásico de implementar esto con un SELECT seguido de un UPDATE.',
        },
        {
          type: 'list',
          items: [
            'Todos los plazos usan el now() de la base, y no el reloj de cada réplica. Hosts con relojes distintos discreparían sobre cuándo venció el bloqueo, y un host adelantado tomaría posesión de un bloqueo que para su dueño sigue vigente.',
            'La liberación no borra la fila. Si la borrara, la siguiente adquisición crearía el bloqueo de nuevo con generación 1, y un dueño antiguo con generación 7 parecería más reciente. La generación tiene que ser monotónica para servir de barrera.',
            'La renovación exige dueño, generación y plazo todavía vigente. Quien ya perdió el bloqueo recibe cero filas afectadas y sabe que debe detenerse, en lugar de extender en silencio una posesión que ya es de otro.',
            'El plazo deja de ser una estimación de la duración del job. Con renovación cada tercio del plazo, un job de dos horas funciona con un plazo de noventa segundos, y una instancia muerta se reemplaza en como máximo noventa segundos.',
          ],
        },
      ],
    },
    {
      title: 'El ejecutor en Node.js y la barrera en la escritura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El ejecutor encapsula el ciclo completo: intenta adquirir, desiste sin error si otro dueño está activo, renueva en segundo plano mientras la tarea corre, avisa a la tarea que se detenga si la renovación falla y libera al final. La tarea recibe la generación y un AbortSignal, y es responsable de verificar la señal entre unidades de trabajo.',
        },
        {
          type: 'code',
          value: `// bloqueo-job.js: lease en PostgreSQL con renovacion y generacion (node-postgres).
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const DUENO = os.hostname() + ':' + process.pid + ':' + randomUUID().slice(0, 8);

const SQL_ADQUIRIR =
  'INSERT INTO bloqueos_job AS b (nombre, dueno, generacion, expira_en) ' +
  'VALUES ($1, $2, 1, now() + make_interval(secs => $3)) ' +
  'ON CONFLICT (nombre) DO UPDATE SET dueno = EXCLUDED.dueno, ' +
  'generacion = b.generacion + 1, expira_en = EXCLUDED.expira_en ' +
  'WHERE b.expira_en <= now() RETURNING generacion';
const SQL_RENOVAR =
  'UPDATE bloqueos_job SET expira_en = now() + make_interval(secs => $3) ' +
  'WHERE nombre = $1 AND dueno = $2 AND generacion = $4 AND expira_en > now()';
const SQL_LIBERAR =
  'UPDATE bloqueos_job SET expira_en = now() ' +
  'WHERE nombre = $1 AND dueno = $2 AND generacion = $3';

export async function ejecutarConBloqueo(pool, nombre, ttlSegundos, tarea) {
  const { rows } = await pool.query(SQL_ADQUIRIR, [nombre, DUENO, ttlSegundos]);
  if (rows.length === 0) return { ejecuto: false };

  const generacion = rows[0].generacion; // bigint llega como string en node-postgres
  const control = new AbortController();

  // Renueva cada tercio del plazo. Ante la duda (error o posesion perdida), detiene la tarea.
  const renovacion = setInterval(async () => {
    try {
      const r = await pool.query(SQL_RENOVAR, [nombre, DUENO, ttlSegundos, generacion]);
      if (r.rowCount === 0) control.abort(new Error('bloqueo perdido'));
    } catch (error) {
      control.abort(error);
    }
  }, (ttlSegundos * 1000) / 3);

  try {
    const resultado = await tarea({ generacion, senal: control.signal });
    return { ejecuto: true, resultado };
  } finally {
    clearInterval(renovacion);
    await pool.query(SQL_LIBERAR, [nombre, DUENO, generacion]).catch(() => {});
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El AbortSignal reduce la ventana de daño, pero no la elimina. Un proceso detenido no ejecuta el callback de renovación, no percibe el abort y no verifica la señal: simplemente vuelve a ejecutar la línea siguiente, que puede ser una escritura. Para cerrar esa ventana, la escritura tiene que verificar la posesión en el mismo lugar donde ocurre. Cuando el recurso protegido está en la misma base, eso es una consulta con FOR SHARE dentro de la transacción de la escritura.',
        },
        {
          type: 'code',
          value: `// cierre-diario.js: cada tienda se graba en una transaccion que verifica la posesion.
import { ejecutarConBloqueo } from './bloqueo-job.js';

const SQL_VERIFICAR_POSESION =
  'SELECT 1 FROM bloqueos_job ' +
  'WHERE nombre = $1 AND generacion = $2 AND expira_en > now() FOR SHARE';

export function cierreDiario(pool, dia) {
  return ejecutarConBloqueo(pool, 'cierre-diario', 90, async ({ generacion, senal }) => {
    const { rows: tiendas } = await pool.query('SELECT id FROM tiendas WHERE activa ORDER BY id');

    for (const tienda of tiendas) {
      senal.throwIfAborted();
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const posesion = await cliente.query(SQL_VERIFICAR_POSESION, ['cierre-diario', generacion]);
        if (posesion.rowCount === 0) throw new Error('bloqueo perdido antes de la escritura');

        await cliente.query(
          'INSERT INTO comisiones (tienda_id, dia, valor) ' +
            'SELECT $1::bigint, $2::date, coalesce(sum(total), 0) * 0.05 FROM pedidos ' +
            'WHERE tienda_id = $1::bigint AND creado_en >= $2::date AND creado_en < $2::date + 1 ' +
            'ON CONFLICT (tienda_id, dia) DO NOTHING',
          [tienda.id, dia],
        );
        await cliente.query('COMMIT');
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
      } finally {
        cliente.release();
      }
    }
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'El FOR SHARE es lo que convierte la verificación en barrera. Bloquea la fila del bloqueo en modo compartido hasta el COMMIT, y la toma de posesión por otra instancia necesita un bloqueo de actualización sobre esa misma fila, que entra en conflicto con él. Así, o la verificación ve la generación vencida y aborta, o la escritura termina antes de que cualquier otro dueño pueda asumir. FOR KEY SHARE no serviría, porque no entra en conflicto con una actualización que no cambia la clave primaria. La restricción única en comisiones con ON CONFLICT DO NOTHING es la última capa: aunque todo lo anterior falle, la segunda escritura de la misma tienda el mismo día no produce un segundo asiento.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando el efecto es externo, como una API de pagos o un envío de correo, la misma idea vale en forma de fencing token: la generación viaja con la solicitud y el destino rechaza cualquier solicitud con una generación menor que la mayor ya vista para ese recurso. Si el destino no ofrece eso, el recurso disponible es una clave de idempotencia derivada de la ocurrencia, como cierre-2026-09-25-tienda-42, que hace que la segunda llamada devuelva el resultado de la primera en lugar de repetir el efecto.',
        },
      ],
    },
    {
      title: 'El bloqueo impide la concurrencia, no la repetición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el lease funcionando, dos instancias nunca ejecutan el cierre al mismo tiempo. Eso no significa que se ejecute una vez por día. Si la réplica A termina a las 00:05:40 y libera el bloqueo, y la réplica B tiene el programador retrasado por un reinicio, un despliegue o un reloj dos minutos atrasado, B adquiere un bloqueo libre a las 00:07 y cierra el día de nuevo. El bloqueo resuelve la superposición, y el problema aquí es la secuencia. Para eso, el job tiene que registrar qué ocurrencia ya fue concluida.',
        },
        {
          type: 'code',
          value: `CREATE TABLE ejecuciones_job (
  nombre        text NOT NULL,
  ventana       date NOT NULL,
  dueno         text NOT NULL,
  intentos      int  NOT NULL DEFAULT 1,
  iniciado_en   timestamptz NOT NULL DEFAULT now(),
  concluido_en  timestamptz,
  PRIMARY KEY (nombre, ventana)
);

-- Reclamar la ventana, ya con el bloqueo en mano: solo sigue si nunca fue concluida.
-- Una ejecucion que murio a la mitad puede retomarse; una concluida, no.
INSERT INTO ejecuciones_job AS e (nombre, ventana, dueno)
VALUES ($1, $2, $3)
ON CONFLICT (nombre, ventana) DO UPDATE
   SET dueno       = EXCLUDED.dueno,
       intentos    = e.intentos + 1,
       iniciado_en = now()
 WHERE e.concluido_en IS NULL
RETURNING intentos;

-- Al terminar con exito, marcar la ventana como concluida.
UPDATE ejecuciones_job
   SET concluido_en = now()
 WHERE nombre = $1 AND ventana = $2 AND dueno = $3;`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle decisivo es cómo se calcula la ventana. Tiene que venir de la ocurrencia que el programador pretendía ejecutar, y no de la hora en que empezó la ejecución. Para un cierre diario, la ventana es el día que se está cerrando, en la zona horaria del negocio: tanto la ejecución puntual de las 00:05 como una retrasada de las 03:40 llegan a la misma clave, y la segunda encuentra la ventana concluida. Si la ventana se derivara del timestamp de inicio redondeado al minuto, cada retraso produciría una clave nueva y la protección desaparecería justo en los casos en que hace falta.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Qué impide', 'Qué no impide'],
          rows: [
            [
              'Lease con renovación',
              'Dos ejecuciones simultáneas del mismo job',
              'Una segunda ejecución después de que terminó la primera',
            ],
            [
              'Barrera por generación en la escritura',
              'La escritura de un dueño que quedó detenido y perdió el bloqueo',
              'Efectos en sistemas que no verifican la generación',
            ],
            [
              'Registro de ejecución por ventana',
              'Repetir una ocurrencia ya concluida',
              'Duplicados dentro de una ejecución que murió a la mitad',
            ],
            [
              'Restricción única o clave de idempotencia en el efecto',
              'Duplicar el resultado de una unidad de trabajo',
              'El costo de procesar de nuevo lo que ya se hizo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ninguna capa sola es suficiente, y la tabla muestra por qué. La última fila es la más importante, porque es la única que protege el dato incluso cuando todas las demás fallan, y es también la que hace seguro retomar una ejecución interrumpida: el intento siguiente rehace las tiendas que faltaron y pasa por las ya grabadas sin duplicar nada.',
        },
      ],
    },
    {
      title: 'Operar sin sorpresas: métricas, plazo y alternativas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El bloqueo eterno del inicio duró nueve días porque el sistema solo registraba lo que pasaba, y el defecto era algo que dejó de pasar. Los jobs programados necesitan monitoreo por ausencia, además del monitoreo por error.',
        },
        {
          type: 'list',
          items: [
            'Alerta de ventana no concluida: si ejecuciones_job no tiene una fila concluida para ayer antes de las 02:00, alguien recibe el aviso, sea cual sea el motivo.',
            'Edad del bloqueo: un bloqueo con expira_en en el futuro y sin renovación reciente, o con la misma generación durante más tiempo que la mayor duración conocida del job, indica un dueño trabado.',
            'Ejecuciones omitidas por bloqueo ocupado, por job y por host. Algunas por día son normales con varias réplicas; un aumento repentino indica una ejecución que no termina.',
            'Posesiones perdidas: toda renovación con cero filas afectadas y toda escritura rechazada por la barrera deben convertirse en log estructurado y en métrica, porque son la evidencia de pausas largas o de un plazo demasiado corto.',
            'Duración comparada con el intervalo: cuando la duración de un job recurrente supera la mitad del intervalo, la superposición dejó de ser una hipótesis.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El plazo debe ser varias veces mayor que el peor retraso esperado de una renovación, sumando latencia de la base, pausas de GC y estrangulamiento de CPU, y lo bastante pequeño para que el reemplazo de una instancia muerta no retrase el job de forma relevante. Entre sesenta y ciento veinte segundos, con renovación cada tercio, suele funcionar para jobs de negocio. Plazos de pocos segundos convierten cualquier lentitud de la base en cambio de dueño, y plazos de media hora reintroducen el bloqueo eterno a menor escala.',
        },
        {
          type: 'table',
          columns: ['Mecanismo', 'Sobrevive a la muerte del dueño', 'Protege contra un dueño detenido', 'Observación'],
          rows: [
            ['Redis SET NX sin plazo', 'No', 'No', 'Produce el bloqueo eterno'],
            [
              'Redis SET NX PX con liberación condicional',
              'Sí, por el plazo',
              'No, no hay generación',
              'Adecuado cuando correr dos veces solo cuesta procesamiento',
            ],
            [
              'pg_try_advisory_lock de sesión',
              'Sí, cuando cae la conexión',
              'En parte, si toda escritura usa la misma conexión',
              'Retiene una conexión durante el job y no funciona con PgBouncer en modo transacción',
            ],
            [
              'Tabla de lease con generación',
              'Sí, por el plazo',
              'Sí, con la barrera en la escritura',
              'Exige verificar la generación en el recurso protegido',
            ],
            [
              'CronJob con concurrencyPolicy: Forbid',
              'Sí',
              'No',
              'Impide Jobs superpuestos, pero la propia documentación de Kubernetes admite disparos duplicados raros',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Sacar la programación de la aplicación, con un CronJob o un programador gestionado, resuelve la multiplicación por réplicas y suele ser la decisión correcta cuando el job es pesado. Pero no resuelve reentregas ni ejecuciones secuenciales, y por eso el registro por ventana y la idempotencia en el efecto siguen siendo necesarios. Lo que cambia es dónde queda el primer filtro, no la necesidad de las demás capas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Redlock con varios servidores Redis resuelve el problema del dueño detenido?',
      answer:
        'No. Redlock aumenta la disponibilidad del servicio de bloqueo, porque el bloqueo sobrevive a la caída de uno de los servidores Redis, pero no cambia lo que pasa del lado del cliente. Un proceso que adquirió el bloqueo y quedó detenido más tiempo que el plazo sigue creyendo que lo tiene cuando vuelve, y ningún número de servidores Redis impide esa escritura tardía. Lo que la impide es que el recurso protegido verifique un número monotónico en cada escritura y rechace números antiguos, y Redlock no provee ese número. Para jobs en los que el duplicado solo cuesta procesamiento, un único Redis con SET NX PX y liberación condicional es suficiente. Para jobs con efecto sobre dinero o comunicación con clientes, la protección tiene que estar en la escritura, con generación o con clave de idempotencia, y entonces elegir uno o varios Redis deja de ser la decisión importante.',
    },
    {
      question: '¿Por qué no usar solo pg_try_advisory_lock?',
      answer:
        'El advisory lock de sesión es barato y tiene una propiedad valiosa: se libera automáticamente cuando se cierra la conexión, así que no hay bloqueo eterno mientras la base detecte la caída. Funciona bien cuando todo el job corre en la misma conexión que retiene el lock. Los problemas aparecen fuera de ese escenario. El job tiene que mantener una conexión dedicada abierta durante toda la ejecución, lo que pesa en pools pequeños. Con PgBouncer en modo transacción, cada instrucción puede ir a una conexión distinta del servidor, y el lock puede adquirirse en una y quedar atado a otro cliente. Y si el job escribe por otras conexiones del pool, perder la conexión del lock no impide esas escrituras, así que no hay barrera. La variante de transacción, pg_try_advisory_xact_lock, funciona con PgBouncer cuando el job cabe en una única transacción, algo que rara vez vale para cierres largos. La tabla de lease cuesta algunas líneas más y resuelve todos estos casos con la misma lógica.',
    },
    {
      question: '¿Qué plazo usar para el bloqueo y cada cuánto renovarlo?',
      answer:
        'El plazo no es la duración esperada del job, y ese es el error más común. Es el tiempo máximo que el sistema acepta esperar para que otra instancia asuma después de que el dueño murió, y tiene que ser varias veces mayor que el peor retraso de una renovación. Renovar cada tercio del plazo le da al dueño dos intentos antes de perder la posesión por una lentitud puntual. Para la mayoría de los jobs de negocio, un plazo de sesenta a ciento veinte segundos con renovación cada veinte a cuarenta segundos equilibra los dos extremos. Plazos muy cortos convierten picos de latencia de la base en cambios de dueño y en ejecuciones abortadas; plazos muy largos retrasan la recuperación y esconden instancias trabadas. La métrica que dice si el plazo es correcto es la de posesiones perdidas: si aparece sin instancias muertas, el plazo es demasiado corto para el entorno.',
    },
  ],
  conclusion: {
    title: 'Correr una vez es una propiedad construida en capas, no un horario en el cron',
    description:
      'Un job programado corre dos veces porque réplicas, despliegues, reentregas y retrasos crean ocurrencias extra sin que cambie ningún código, y el bloqueo ingenuo cambia ese problema por otro: sin plazo, traba el job para siempre cuando el dueño muere; con plazo y sin barrera, deja que un dueño detenido escriba después de perder la posesión. Un lease en la base, con dueño, renovación y generación monotónica, resuelve la concurrencia; verificar la generación dentro de la transacción de la escritura cierra la ventana del dueño detenido; el registro de ejecución por ventana impide la repetición secuencial; y la restricción única en el efecto protege el dato cuando todo lo demás falla. Con alertas por ausencia, un bloqueo eterno deja de durar nueve días. Puedo revisar los jobs programados de tu sistema, mapear dónde una ejecución duplicada se convierte en daño al cliente e implementar las capas que faltan sin detener la operación.',
    cta: 'Hablar sobre la confiabilidad de mis jobs',
  },
  related: [
    {
      label: 'Relojes desincronizados entre servicios: cuándo el orden de los eventos deja de existir',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Clave de idempotencia en el checkout: cobrar una vez sin trabar el flujo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Arquitectura y modernización backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
