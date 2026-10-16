// Conteudo do artigo: reprocessamento de eventos em massa. Por que voltar o offset do
// consumidor reenvia mensagens, cobra de novo e duplica lancamentos, como classificar cada
// efeito antes de reexecutar, como um ledger de efeitos com chave deterministica garante
// que o replay aplique so o que falta, como rodar o replay fora do grupo ao vivo com
// checkpoint, guarda de versao e teto de vazao, como simular e revisar o diff antes de
// aplicar e como provar em teste que o segundo replay nao produz nenhum efeito.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const schemaCode = `-- schema.sql
create table evento_arquivado (
  posicao      bigint primary key,     -- ordem global do log de origem
  id           text not null unique,
  tipo         text not null,
  pedido_id    text not null,
  versao       bigint not null,        -- versao do agregado (o pedido)
  payload      jsonb not null,
  ocorrido_em  timestamptz not null
);
create index on evento_arquivado (ocorrido_em, posicao);

create table comissao (
  pedido_id      text primary key,
  valor_centavos bigint not null,
  versao_evento  bigint not null,
  atualizado_em  timestamptz not null default now()
);

-- Um registro por efeito externo, com a mesma chave no consumidor ao vivo e no replay
create table efeito_aplicado (
  chave         text primary key,      -- '<evento_id>:<tipo_efeito>'
  evento_id     text not null,
  tipo_efeito   text not null,
  estado        text not null check (estado in ('reservado', 'concluido', 'incerto')),
  execucao_id   text not null,         -- 'ao-vivo' ou o id do reprocessamento
  resultado     jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table reprocessamento_checkpoint (
  execucao_id    text primary key,
  ultima_posicao bigint not null,
  atualizado_em  timestamptz not null default now()
);

create table reprocessamento_diff (
  execucao_id text not null,
  pedido_id   text not null,
  antes       bigint,
  depois      bigint not null,
  primary key (execucao_id, pedido_id)
);`;

const comissaoCode = `// comissao.js
export function calcularComissao({ valorCentavos, percentual }) {
  if (!Number.isInteger(valorCentavos) || typeof percentual !== 'number') {
    throw new Error('payload de pedido.pago invalido');
  }
  // A versao com bug dividia por 1.000: percentual 5 virava 0,5%
  return Math.round((valorCentavos * percentual) / 100);
}`;

const aplicadorCode = `// aplicador.js
import { calcularComissao } from './comissao.js';

// Reserva a chave do efeito. Uma reserva abandonada so pode ser retomada
// quando o provedor deduplica pela chave ($5 = true).
const RESERVAR = \`
insert into efeito_aplicado (chave, evento_id, tipo_efeito, estado, execucao_id)
values ($1, $2, $3, 'reservado', $4)
on conflict (chave) do update
  set execucao_id = excluded.execucao_id, atualizado_em = now()
where efeito_aplicado.estado = 'reservado'
  and $5::boolean
  and efeito_aplicado.atualizado_em < now() - interval '5 minutes'
returning chave\`;

export function criarAplicador({
  pool, // pg.Pool
  gateway,
  execucaoId, // 'ao-vivo' ou, por exemplo, 'replay-2026-10-14-v2'
  politica, // { [tipoEfeito]: { modo: 'aplicar' | 'suprimir', aoFalhar: 'liberar' | 'manter' } }
  simular = false,
  metricas,
}) {
  async function gravarComissao(evento, valor) {
    // So sobrescreve se o evento for da mesma versao ou mais novo que o da linha atual
    const { rowCount } = await pool.query(
      \`insert into comissao (pedido_id, valor_centavos, versao_evento)
       values ($1, $2, $3)
       on conflict (pedido_id) do update
         set valor_centavos = excluded.valor_centavos,
             versao_evento = excluded.versao_evento,
             atualizado_em = now()
       where comissao.versao_evento <= excluded.versao_evento\`,
      [evento.pedidoId, valor, evento.versao],
    );
    metricas?.estado(rowCount === 1 ? 'gravado' : 'ignorado-versao-mais-nova');
  }

  async function registrarDiff(evento, valor) {
    const { rows } = await pool.query(
      'select valor_centavos, versao_evento from comissao where pedido_id = $1',
      [evento.pedidoId],
    );
    const atual = rows[0];
    if (atual && Number(atual.versao_evento) > Number(evento.versao)) return;
    await pool.query(
      \`insert into reprocessamento_diff (execucao_id, pedido_id, antes, depois)
       values ($1, $2, $3, $4)
       on conflict (execucao_id, pedido_id) do update
         set antes = excluded.antes, depois = excluded.depois\`,
      [execucaoId, evento.pedidoId, atual ? atual.valor_centavos : null, valor],
    );
  }

  async function efeitoExterno(evento, tipo, executar) {
    const regra = politica[tipo];
    const chave = \`\${evento.id}:\${tipo}\`;

    if (!regra || regra.modo === 'suprimir') {
      metricas?.efeito(tipo, 'suprimido');
      return;
    }
    if (simular) {
      const { rowCount } = await pool.query(
        'select 1 from efeito_aplicado where chave = $1',
        [chave],
      );
      metricas?.efeito(tipo, rowCount ? 'ja-registrado' : 'seria-aplicado');
      return;
    }

    const reserva = await pool.query(RESERVAR, [
      chave,
      evento.id,
      tipo,
      execucaoId,
      regra.aoFalhar === 'liberar',
    ]);
    if (reserva.rowCount === 0) {
      metricas?.efeito(tipo, 'ja-registrado');
      return;
    }

    try {
      const resultado = await executar(chave);
      await pool.query(
        \`update efeito_aplicado
            set estado = 'concluido', resultado = $2, atualizado_em = now()
          where chave = $1\`,
        [chave, JSON.stringify(resultado ?? null)],
      );
      metricas?.efeito(tipo, 'aplicado');
    } catch (erro) {
      if (regra.aoFalhar === 'liberar') {
        // O provedor deduplica pela chave: tentar de novo nao duplica o efeito
        await pool.query(
          "delete from efeito_aplicado where chave = $1 and estado = 'reservado'",
          [chave],
        );
        throw erro;
      }
      // Sem idempotencia no provedor nao da para saber se a mensagem saiu
      await pool.query(
        "update efeito_aplicado set estado = 'incerto', atualizado_em = now() where chave = $1",
        [chave],
      );
      metricas?.efeito(tipo, 'incerto');
    }
  }

  async function aplicar(evento) {
    if (evento.tipo !== 'pedido.pago') return;
    const valor = calcularComissao(evento.payload);

    if (simular) await registrarDiff(evento, valor);
    else await gravarComissao(evento, valor);

    await efeitoExterno(evento, 'notificar-vendedor', (chave) =>
      gateway.notificarVendedor(
        { pedidoId: evento.pedidoId, valorCentavos: valor },
        { chaveIdempotencia: chave },
      ),
    );
  }

  return { aplicar };
}`;

const executorCode = `// fonte-arquivo.js
export function criarFonteArquivo({ pool, inicio, fim }) {
  return {
    async lerLote({ depoisDe, limite }) {
      const { rows } = await pool.query(
        \`select posicao, id, tipo, pedido_id as "pedidoId", versao, payload
           from evento_arquivado
          where ocorrido_em >= $1 and ocorrido_em < $2 and posicao > $3
          order by posicao
          limit $4\`,
        [inicio, fim, depoisDe, limite],
      );
      return rows;
    },
  };
}

// checkpoint.js
export function criarCheckpoint(pool) {
  return {
    async ler(execucaoId) {
      const { rows } = await pool.query(
        'select ultima_posicao from reprocessamento_checkpoint where execucao_id = $1',
        [execucaoId],
      );
      return rows[0]?.ultima_posicao ?? '0';
    },
    async gravar(execucaoId, posicao) {
      await pool.query(
        \`insert into reprocessamento_checkpoint (execucao_id, ultima_posicao)
         values ($1, $2)
         on conflict (execucao_id) do update
           set ultima_posicao = excluded.ultima_posicao, atualizado_em = now()\`,
        [execucaoId, posicao],
      );
    },
  };
}

// reprocessar.js
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function reprocessar({
  fonte,
  aplicador,
  checkpoint,
  execucaoId,
  limitePorSegundo,
  tamanhoLote = 500,
  sinal, // AbortSignal: o botao de parada do replay
}) {
  let cursor = await checkpoint.ler(execucaoId);
  let processados = 0;

  while (!sinal?.aborted) {
    const inicioLote = Date.now();
    const lote = await fonte.lerLote({ depoisDe: cursor, limite: tamanhoLote });
    if (lote.length === 0) break;

    // Em ordem de posicao: eventos do mesmo pedido nunca se invertem
    for (const evento of lote) {
      await aplicador.aplicar(evento);
    }

    cursor = lote.at(-1).posicao;
    await checkpoint.gravar(execucaoId, cursor);
    processados += lote.length;

    // Teto de vazao: o replay nao pode disputar o banco com o trafego ao vivo
    const minimoMs = (lote.length / limitePorSegundo) * 1000;
    await esperar(Math.max(0, minimoMs - (Date.now() - inicioLote)));
  }

  return { cursor, processados };
}`;

const resumoDiffCode = `-- resumo do diff da execucao simulada, revisado antes de aplicar
select count(*) filter (where antes is distinct from depois)     as pedidos_alterados,
       count(*) filter (where antes is null)                     as pedidos_sem_comissao,
       sum(depois - antes) filter (where antes is not null)      as diferenca_centavos,
       max(abs(depois - antes))                                  as maior_diferenca_centavos
  from reprocessamento_diff
 where execucao_id = $1;`;

const testeCode = `// reprocessamento.test.js
// Requer um Postgres de teste com schema.sql aplicado: DATABASE_URL=... node --test
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { criarAplicador } from './aplicador.js';
import { criarFonteArquivo } from './fonte-arquivo.js';
import { criarCheckpoint } from './checkpoint.js';
import { reprocessar } from './reprocessar.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const politica = { 'notificar-vendedor': { modo: 'aplicar', aoFalhar: 'manter' } };

function criarGatewayFalso() {
  const chamadas = [];
  return {
    chamadas,
    async notificarVendedor(_dados, { chaveIdempotencia }) {
      chamadas.push(chaveIdempotencia);
      return { mensagemId: \`msg-\${chamadas.length}\` };
    },
  };
}

async function rodar(execucaoId, gateway) {
  return reprocessar({
    fonte: criarFonteArquivo({
      pool,
      inicio: '2026-10-14T00:00:00Z',
      fim: '2026-10-15T00:00:00Z',
    }),
    aplicador: criarAplicador({ pool, gateway, execucaoId, politica }),
    checkpoint: criarCheckpoint(pool),
    execucaoId,
    limitePorSegundo: 1_000,
  });
}

beforeEach(async () => {
  await pool.query(
    'truncate evento_arquivado, comissao, efeito_aplicado, reprocessamento_checkpoint, reprocessamento_diff',
  );
  await pool.query(\`
    insert into evento_arquivado (posicao, id, tipo, pedido_id, versao, payload, ocorrido_em) values
      (1, 'e1', 'pedido.pago', 'A', 1, '{"valorCentavos": 10000, "percentual": 5}', '2026-10-14T10:00:00Z'),
      (2, 'e2', 'pedido.pago', 'B', 1, '{"valorCentavos": 20000, "percentual": 5}', '2026-10-14T11:00:00Z'),
      (3, 'e3', 'pedido.pago', 'C', 1, '{"valorCentavos": 30000, "percentual": 5}', '2026-10-14T12:00:00Z')\`);
  // e1 foi notificado pelo consumidor ao vivo; e2 e e3 falharam antes de notificar
  await pool.query(\`
    insert into efeito_aplicado (chave, evento_id, tipo_efeito, estado, execucao_id)
    values ('e1:notificar-vendedor', 'e1', 'notificar-vendedor', 'concluido', 'ao-vivo')\`);
  // O pedido C ja recebeu um evento mais novo pelo consumidor ao vivo
  await pool.query(\`
    insert into comissao (pedido_id, valor_centavos, versao_evento) values ('C', 999, 2)\`);
});

after(() => pool.end());

test('o replay aplica so os efeitos que faltam, e o segundo replay nao aplica nenhum', async () => {
  const gateway = criarGatewayFalso();

  await rodar('replay-1', gateway);
  assert.deepEqual(gateway.chamadas, ['e2:notificar-vendedor', 'e3:notificar-vendedor']);

  const segunda = await rodar('replay-2', gateway);
  assert.equal(segunda.processados, 3);
  assert.equal(gateway.chamadas.length, 2);
});

test('retomar a mesma execucao continua do checkpoint, sem reler o dia', async () => {
  await rodar('replay-1', criarGatewayFalso());
  const retomada = await rodar('replay-1', criarGatewayFalso());
  assert.equal(retomada.processados, 0);
});

test('o replay corrige o estado sem sobrescrever o que o ao vivo gravou depois', async () => {
  await rodar('replay-1', criarGatewayFalso());
  const { rows } = await pool.query(
    'select pedido_id, valor_centavos::int as valor, versao_evento::int as versao from comissao order by pedido_id',
  );
  assert.deepEqual(rows, [
    { pedido_id: 'A', valor: 500, versao: 1 },
    { pedido_id: 'B', valor: 1000, versao: 1 },
    { pedido_id: 'C', valor: 999, versao: 2 },
  ]);
});`;

const diagramaPt = `Arquivo do dia 14/10: 210 mil eventos pedido.pago, em ordem de posição
        |
        v
[fonte por posição] --lote de 500--> [aplicador da execução replay-2026-10-14-v2]
        ^                                 |
        |                                 |-- estado: upsert com guarda de versão --> comissao
[checkpoint a cada lote]                  |
                                          '-- efeito externo: reserva a chave no ledger
                                                 |-- chave já registrada -> não faz nada
                                                 '-- chave ausente -> provedor com chaveIdempotencia

[consumidor ao vivo] --> mesmo aplicador, mesmo ledger, execução 'ao-vivo'
(os dois rodam ao mesmo tempo: a guarda de versão e o ledger resolvem a disputa)`;

const diagramaEn = `Archive for Oct 14: 210k pedido.pago events, in position order
        |
        v
[source by position] --batch of 500--> [applier for run replay-2026-10-14-v2]
        ^                                   |
        |                                   |-- state: upsert with version guard --> comissao
[checkpoint per batch]                      |
                                            '-- external effect: reserve the key in the ledger
                                                   |-- key already recorded -> do nothing
                                                   '-- key missing -> provider with chaveIdempotencia

[live consumer] --> same applier, same ledger, run 'ao-vivo'
(both run at the same time: the version guard and the ledger settle the race)`;

const diagramaEs = `Archivo del día 14/10: 210 mil eventos pedido.pago, en orden de posición
        |
        v
[fuente por posición] --lote de 500--> [aplicador de la ejecución replay-2026-10-14-v2]
        ^                                   |
        |                                   |-- estado: upsert con guarda de versión --> comissao
[checkpoint por lote]                       |
                                            '-- efecto externo: reserva la clave en el ledger
                                                   |-- clave ya registrada -> no hace nada
                                                   '-- clave ausente -> proveedor con chaveIdempotencia

[consumidor en vivo] --> mismo aplicador, mismo ledger, ejecución 'ao-vivo'
(los dos corren a la vez: la guarda de versión y el ledger resuelven la disputa)`;

const pt = {
  intro:
    'Às 9h40 do dia 14 um deploy mudou o cálculo de comissão e passou a dividir o percentual por mil em vez de cem. Até as 17h10, quando alguém percebeu, 38 mil pedidos tinham comissão errada, e outros 4.100 eventos tinham falhado antes de notificar o vendedor porque o provedor de WhatsApp ficou instável à tarde. A correção do código levou vinte minutos. A pergunta difícil veio depois: como reexecutar o dia inteiro com o código certo sem mandar de novo 210 mil mensagens, sem somar duas vezes o total vendido e sem publicar de novo os eventos que o financeiro transforma em repasse. Este artigo mostra por que voltar o offset do consumidor é a pior resposta, como classificar cada efeito antes de reexecutar, como um ledger com chave determinística faz o replay aplicar só o que falta, como rodar o replay ao lado do tráfego ao vivo sem disputar estado, como simular e revisar o diff antes de aplicar e como provar em teste que o segundo replay não faz nada.',
  sections: [
    {
      title: 'O que acontece quando você só volta o offset',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A resposta instintiva em quem usa Kafka, SQS com arquivo ou qualquer log de eventos é resetar o offset do consumer group para a meia-noite do dia 14 e deixar o consumidor corrigido trabalhar. O código do consumidor já é idempotente para o estado, então parece seguro. Não é, porque o consumidor não produz só estado: ele produz efeitos fora do banco, e esses efeitos não têm como ser desfeitos.',
        },
        {
          type: 'list',
          items: [
            'Cada um dos 210 mil eventos pedido.pago dispara de novo a notificação de comissão no WhatsApp. O vendedor que já recebeu três mensagens no dia 14 recebe mais três, agora com valores diferentes, sem nenhum contexto.',
            'O contador de total vendido por vendedor no dia é atualizado com incremento. Reexecutar soma o dia duas vezes, e o painel de metas mostra que todo mundo bateu 200%.',
            'O evento derivado pedido.comissionado é publicado de novo com um id novo. O serviço financeiro, que deduplica por id, cria uma segunda linha de repasse para cada pedido.',
            'O reset vale para o grupo inteiro e para tudo depois da meia-noite do dia 14, inclusive o dia 15 inteiro, que estava correto. O replay de um dia vira o replay de dois.',
            'Enquanto o grupo relê o passado, o tráfego do dia 16 fica parado atrás dele. O lag sobe para horas e o incidente de comissão vira um incidente de atendimento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Nenhum desses problemas é bug do consumidor. Todos vêm da mesma premissa errada: tratar o reprocessamento como uma repetição do processamento original. Um replay é uma operação diferente, com outro escopo, outra política de efeitos e outro limite de vazão, e precisa ser modelado como tal antes do primeiro evento ser relido.',
        },
      ],
    },
    {
      title: 'Nem todo efeito é igual: classificar antes de reexecutar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro artefato de um reprocessamento seguro não é código, é uma tabela com cada efeito que o consumidor produz e o que o replay deve fazer com ele. Essa classificação decide quase todo o resto, e fazê-la durante o incidente, com pressa, é o que costuma gerar a segunda onda de problemas.',
        },
        {
          type: 'table',
          columns: ['Efeito', 'Exemplo', 'O que o replay faz', 'Mecanismo'],
          rows: [
            ['Estado sobrescrevível', 'Comissão por pedido', 'Recalcula e grava', 'Upsert com guarda de versão do agregado'],
            ['Acumulador', 'Total vendido por vendedor no dia', 'Reconstrói a janela inteira, nunca incrementa de novo', 'Recalcular o agregado a partir do estado corrigido'],
            ['Chamada externa com idempotência no provedor', 'Criar lançamento no ERP, estorno no gateway', 'Aplica só o que falta', 'Ledger de efeitos e chave repassada ao provedor'],
            ['Chamada externa sem idempotência', 'WhatsApp, e-mail, SMS', 'Aplica só o que falta, e a falha vira revisão humana', 'Ledger de efeitos com estado incerto'],
            ['Evento derivado', 'pedido.comissionado para o financeiro', 'Republica com o mesmo id', 'Outbox com id derivado do evento de origem'],
            ['Efeito dependente do momento', 'Lembrete "seu pedido saiu há uma hora"', 'Suprime', 'Política de supressão por tipo de efeito'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Duas linhas merecem atenção. O acumulador é o efeito que mais engana, porque um incremento parece estado. A correção é parar de incrementar durante o replay e, ao final, recalcular o total do dia a partir da tabela de comissões já corrigida, com um insert ... select ... group by que sobrescreve o valor. O evento derivado só é seguro se o id dele for função do evento de origem, como um hash de evento_id mais o tipo do evento derivado. Se o id é gerado na hora com um UUID aleatório, nenhum consumidor a jusante consegue reconhecer a repetição.',
        },
        {
          type: 'paragraph',
          value:
            'Existe também um efeito que o replay não deve tentar reproduzir: a correção para quem recebeu a informação errada. Os vendedores do dia 14 receberam valores errados por WhatsApp. Reenviar a mensagem original com o valor certo não corrige nada, só confunde. Se o negócio decidir avisar, isso é um efeito novo, notificar-correcao, com chave própria, disparado a partir do diff e não a partir do evento.',
        },
      ],
    },
    {
      title: 'O ledger de efeitos: uma chave determinística por efeito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O mecanismo central é uma tabela que registra cada efeito externo aplicado, com uma chave que depende só do evento e do tipo do efeito: evento_id mais tipo_efeito. O consumidor ao vivo e o replay usam a mesma função de chave e a mesma tabela, então o replay descobre, efeito por efeito, o que já aconteceu no dia 14 e o que ficou faltando. O schema abaixo tem também o arquivo dos eventos, o estado de comissão com a versão do agregado que o produziu, o checkpoint e o diff da simulação.',
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: comissaoCode,
        },
        {
          type: 'paragraph',
          value:
            'O aplicador abaixo é o mesmo código para o consumidor ao vivo e para o replay; muda só o execucaoId, a política e a flag de simulação. O estado de comissão usa um upsert com guarda de versão: a linha só é sobrescrita se o evento for da mesma versão do pedido ou mais novo. Isso permite que o replay corrija a versão 1 de um pedido sem apagar a versão 2 que o consumidor ao vivo gravou enquanto o replay ainda estava no meio da manhã.',
        },
        {
          type: 'code',
          value: aplicadorCode,
        },
        {
          type: 'paragraph',
          value:
            'O efeito externo segue três passos: reservar a chave, chamar o provedor e marcar como concluído. A reserva é um insert com on conflict, então só uma execução consegue reservar a mesma chave, mesmo com o replay e o consumidor ao vivo processando o mesmo evento ao mesmo tempo. A chave também vai para o provedor como chave de idempotência, e é isso que cobre a janela entre a chamada ter funcionado e a marcação de concluído ter sido gravada.',
        },
        {
          type: 'paragraph',
          value:
            'A diferença entre aoFalhar liberar e manter é a decisão mais importante do ledger. Quando o provedor deduplica pela chave, a falha libera a reserva e o replay tenta de novo; o pior caso é o provedor receber a mesma chave duas vezes e ignorar a segunda. Quando o provedor não deduplica, como a maioria das APIs de mensagem, uma falha depois do envio é indistinguível de uma falha antes dele. O estado incerto existe para isso: o efeito sai do fluxo automático e vai para uma fila de revisão, porque reenviar às cegas troca uma mensagem perdida por uma mensagem duplicada. Pelo mesmo motivo, uma reserva abandonada por um processo que morreu só é retomada automaticamente quando o provedor é idempotente; nos outros casos, um job de varredura move a reserva velha para incerto.',
        },
      ],
    },
    {
      title: 'O executor: fora do grupo ao vivo, com checkpoint e teto de vazão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O replay não deve usar o consumer group do tráfego ao vivo. Ele lê de uma fonte própria, que pode ser um consumer group separado apontado para os offsets do dia ou, como no exemplo, uma tabela de arquivo dos eventos, que tem a vantagem de não depender da retenção do broker. A leitura é por posição, em lotes, e o cursor é gravado ao fim de cada lote. Se o processo cair no evento 140 mil, a próxima execução com o mesmo id retoma do último lote completo; os eventos do lote interrompido são aplicados de novo, e isso é seguro porque o aplicador é idempotente.',
        },
        {
          type: 'code',
          value: executorCode,
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O teto de vazão é o que impede o replay de virar o próximo incidente. Sem ele, o executor lê o arquivo o mais rápido que o banco aguenta e disputa conexões, locks e CPU com o tráfego ao vivo. A conta para escolher o teto parte da folga real: se o banco aguenta 3.000 escritas por segundo e o pico do dia usa 1.800, o replay fica com 600 e deixa margem para o imprevisto. Nesse ritmo, 210 mil eventos levam menos de seis minutos, o que é rápido o suficiente para não haver motivo para correr.',
        },
        {
          type: 'paragraph',
          value:
            'A ordem também importa. Ler por posição garante que dois eventos do mesmo pedido nunca se invertam. Para paralelizar, o corte certo é pela chave do agregado, com cada worker lendo apenas os pedidos em que hashtext(pedido_id) módulo N é igual ao seu índice. Paralelizar por intervalo de tempo parece natural e quebra justamente a ordem por pedido, que é a única ordem que a guarda de versão precisa.',
        },
      ],
    },
    {
      title: 'Simular antes de aplicar: o diff como portão',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a flag simular, o mesmo aplicador percorre o dia sem gravar comissão e sem chamar provedor. Em vez disso, ele grava na tabela de diff o valor atual e o valor que gravaria, e as métricas contam quantos efeitos seriam aplicados e quantos já estão registrados. O resumo abaixo é o que o time revisa antes de autorizar a execução real.',
        },
        {
          type: 'code',
          value: resumoDiffCode,
        },
        {
          type: 'paragraph',
          value:
            'O valor desse portão está em comparar o resultado com a expectativa que o incidente já deu. Esperávamos cerca de 38 mil pedidos alterados e cerca de 4.100 notificações a aplicar. Se a simulação diz 205 mil notificações, o ledger não está reconhecendo o que o consumidor ao vivo fez, quase sempre porque a chave mudou de formato entre as versões ou porque o ledger foi criado depois do dia que está sendo reprocessado. Descobrir isso na simulação custa uma consulta; descobrir na execução real custa 200 mil mensagens.',
        },
        {
          type: 'ordered',
          items: [
            'Congelar o escopo: janela de tempo, tipos de evento, versão do código e política de efeitos, tudo registrado junto com o execucaoId.',
            'Rodar a simulação e gerar o resumo do diff e das métricas de efeitos.',
            'Comparar com a expectativa do incidente e investigar qualquer número fora da ordem de grandeza.',
            'Executar com teto de vazão, acompanhando o lag do consumidor ao vivo e a latência do banco, com o AbortSignal ligado a um botão de parada.',
            'Recalcular os acumuladores da janela a partir do estado corrigido.',
            'Revisar a fila de efeitos incertos e decidir, com o negócio, se haverá notificação de correção.',
          ],
        },
      ],
    },
    {
      title: 'Provar em teste que o segundo replay não faz nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As propriedades que importam cabem em três testes contra um Postgres real: o replay aplica exatamente os efeitos que faltavam, um segundo replay com outro id não aplica nenhum, uma execução interrompida retoma do checkpoint e o estado gravado pelo consumidor ao vivo com versão mais nova sobrevive ao replay. Usar banco real, em vez de um mock, é proposital: as garantias moram no on conflict e no where do upsert, e um mock só testaria o que você acha que o banco faz.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'O cenário montado no beforeEach é o incidente em miniatura: um evento já notificado ao vivo, dois que falharam antes de notificar e um pedido que recebeu uma versão mais nova depois. Se alguém mudar o formato da chave, trocar o upsert por um update incondicional ou gerar o id do efeito com um UUID aleatório, um desses testes quebra antes de o próximo reprocessamento acontecer em produção.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que não simplesmente resetar o offset do consumer group?',
      answer:
        'Porque o reset reprocessa tudo a partir do ponto escolhido, para o grupo inteiro, com a política de efeitos do consumidor ao vivo e sem limite de vazão. Você reenvia mensagens, incrementa acumuladores de novo, atrasa o tráfego atual e não consegue simular antes. Um consumer group separado ou uma leitura do arquivo, com um execucaoId próprio, dá escopo, política e teto independentes.',
    },
    {
      question: 'E se o ledger de efeitos não existia quando os eventos originais foram processados?',
      answer:
        'Então o replay não tem como saber o que já aconteceu, e a política padrão precisa ser suprimir os efeitos externos. Antes de aplicar qualquer um, reconstrua o ledger a partir de uma fonte confiável, como os registros do provedor de mensagens ou os lançamentos do ERP, e só depois rode a simulação para conferir se o número de efeitos a aplicar faz sentido.',
    },
    {
      question: 'Como escolher entre suprimir e aplicar só o que falta para um efeito externo?',
      answer:
        'Pergunte se o efeito ainda tem valor depois do atraso e se ausência dele é um erro. Um lançamento no ERP que nunca foi criado é um erro e deve ser aplicado. Um lembrete de entrega com dois dias de atraso não tem valor e deve ser suprimido. Na dúvida, suprimir e gerar uma lista para revisão é reversível; enviar não é.',
    },
  ],
  conclusion: {
    title: 'Reprocessar é uma operação, não uma repetição',
    description:
      'Reexecutar um dia de eventos com segurança depende de decisões tomadas antes do incidente: uma chave determinística por efeito, gravada no mesmo ledger pelo consumidor ao vivo e pelo replay; estado protegido por versão do agregado; acumuladores recalculados em vez de incrementados; e eventos derivados com id estável. Com isso, o replay vira um procedimento com escopo, simulação, diff, teto de vazão e botão de parada. Sem isso, a correção de um bug de comissão vira um segundo incidente, maior que o primeiro.',
    cta: 'Revisar o fluxo de eventos e reprocessamento do meu sistema',
  },
  related: [
    {
      label: 'Fila morta que ninguém lê: transformar mensagem descartada em correção de verdade',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Outbox transacional: gravar no banco e publicar o evento sem perder nenhum dos dois',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Automação e Integrações',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const en = {
  intro:
    'At 9:40 AM on the 14th, a deploy changed the commission calculation and started dividing the percentage by a thousand instead of a hundred. By 5:10 PM, when someone noticed, 38,000 orders had the wrong commission, and another 4,100 events had failed before notifying the seller because the WhatsApp provider became unstable in the afternoon. Fixing the code took twenty minutes. The hard question came next: how to rerun the whole day with the correct code without sending 210,000 messages again, without adding up the day\'s sales total twice, and without republishing the events that finance turns into payouts. This article shows why rewinding the consumer offset is the worst answer, how to classify every effect before rerunning, how a ledger with a deterministic key makes the replay apply only what is missing, how to run the replay next to live traffic without fighting over state, how to simulate and review the diff before applying, and how to prove in a test that the second replay does nothing.',
  sections: [
    {
      title: 'What happens when you just rewind the offset',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The instinctive answer for anyone running Kafka, SQS with an archive, or any event log is to reset the consumer group offset to midnight on the 14th and let the fixed consumer do its job. The consumer is already idempotent for state, so it looks safe. It is not, because the consumer does not produce only state: it produces effects outside the database, and those effects cannot be undone.',
        },
        {
          type: 'list',
          items: [
            'Each of the 210,000 pedido.pago events fires the WhatsApp commission notification again. A seller who already received three messages on the 14th gets three more, now with different amounts and no context.',
            'The per-seller daily sales counter is updated with an increment. Rerunning adds the day twice, and the goals dashboard shows that everyone hit 200%.',
            'The derived pedido.comissionado event is published again with a new id. The finance service, which deduplicates by id, creates a second payout line for every order.',
            'The reset applies to the whole group and to everything after midnight on the 14th, including the entire 15th, which was correct. Replaying one day turns into replaying two.',
            'While the group rereads the past, traffic from the 16th waits behind it. Lag climbs to hours and the commission incident becomes a customer service incident.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'None of these problems is a consumer bug. They all come from the same wrong premise: treating reprocessing as a repetition of the original processing. A replay is a different operation, with a different scope, a different effect policy and a different throughput limit, and it must be modeled as such before the first event is reread.',
        },
      ],
    },
    {
      title: 'Not every effect is the same: classify before rerunning',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first artifact of a safe reprocessing run is not code, it is a table listing every effect the consumer produces and what the replay should do with it. This classification drives almost everything else, and doing it in a hurry during the incident is what usually creates the second wave of problems.',
        },
        {
          type: 'table',
          columns: ['Effect', 'Example', 'What the replay does', 'Mechanism'],
          rows: [
            ['Overwritable state', 'Commission per order', 'Recomputes and writes', 'Upsert with aggregate version guard'],
            ['Accumulator', 'Daily sales total per seller', 'Rebuilds the whole window, never increments again', 'Recompute the aggregate from the corrected state'],
            ['External call with provider idempotency', 'Create an ERP entry, refund at the gateway', 'Applies only what is missing', 'Effect ledger and key forwarded to the provider'],
            ['External call without idempotency', 'WhatsApp, email, SMS', 'Applies only what is missing, and a failure goes to human review', 'Effect ledger with an uncertain state'],
            ['Derived event', 'pedido.comissionado for finance', 'Republishes with the same id', 'Outbox with an id derived from the source event'],
            ['Time-dependent effect', 'Reminder "your order shipped an hour ago"', 'Suppresses', 'Suppression policy per effect type'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two rows deserve attention. The accumulator is the most deceptive effect, because an increment looks like state. The fix is to stop incrementing during the replay and, at the end, recompute the daily total from the already corrected commission table with an insert ... select ... group by that overwrites the value. The derived event is only safe if its id is a function of the source event, such as a hash of evento_id plus the derived event type. If the id is generated on the spot with a random UUID, no downstream consumer can recognize the repetition.',
        },
        {
          type: 'paragraph',
          value:
            'There is also an effect the replay should not try to reproduce: the correction for people who received wrong information. Sellers on the 14th got wrong amounts over WhatsApp. Resending the original message with the right amount fixes nothing and only confuses them. If the business decides to notify them, that is a new effect, notificar-correcao, with its own key, triggered from the diff and not from the event.',
        },
      ],
    },
    {
      title: 'The effect ledger: one deterministic key per effect',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The core mechanism is a table that records every external effect applied, with a key that depends only on the event and the effect type: evento_id plus tipo_efeito. The live consumer and the replay use the same key function and the same table, so the replay finds out, effect by effect, what already happened on the 14th and what was left undone. The schema below also includes the event archive, the commission state with the aggregate version that produced it, the checkpoint and the simulation diff.',
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: comissaoCode,
        },
        {
          type: 'paragraph',
          value:
            'The applier below is the same code for the live consumer and for the replay; only the execucaoId, the policy and the simulation flag change. The commission state uses an upsert with a version guard: the row is only overwritten if the event has the same order version or a newer one. That lets the replay fix version 1 of an order without erasing version 2, which the live consumer wrote while the replay was still somewhere in the morning.',
        },
        {
          type: 'code',
          value: aplicadorCode,
        },
        {
          type: 'paragraph',
          value:
            'The external effect follows three steps: reserve the key, call the provider and mark it as done. The reservation is an insert with on conflict, so only one run can reserve a given key, even when the replay and the live consumer process the same event at the same time. The key is also sent to the provider as an idempotency key, and that is what covers the window between the call succeeding and the done marker being written.',
        },
        {
          type: 'paragraph',
          value:
            'The difference between aoFalhar liberar (release) and manter (keep) is the most important decision in the ledger. When the provider deduplicates by key, a failure releases the reservation and the replay tries again; the worst case is the provider receiving the same key twice and ignoring the second one. When the provider does not deduplicate, as most messaging APIs do not, a failure after sending is indistinguishable from a failure before it. The uncertain state exists for that: the effect leaves the automatic flow and goes to a review queue, because resending blindly trades a lost message for a duplicate one. For the same reason, a reservation abandoned by a process that died is only resumed automatically when the provider is idempotent; otherwise, a sweeper job moves the stale reservation to uncertain.',
        },
      ],
    },
    {
      title: 'The executor: outside the live group, with a checkpoint and a throughput cap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The replay should not use the live traffic consumer group. It reads from its own source, which can be a separate consumer group pointed at the day\'s offsets or, as in the example, an event archive table, which has the advantage of not depending on broker retention. Reads go by position, in batches, and the cursor is saved at the end of each batch. If the process dies at event 140,000, the next run with the same id resumes from the last complete batch; the events of the interrupted batch are applied again, and that is safe because the applier is idempotent.',
        },
        {
          type: 'code',
          value: executorCode,
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The throughput cap is what keeps the replay from becoming the next incident. Without it, the executor reads the archive as fast as the database allows and competes with live traffic for connections, locks and CPU. The math for picking the cap starts from real headroom: if the database handles 3,000 writes per second and the daily peak uses 1,800, the replay gets 600 and leaves room for the unexpected. At that rate, 210,000 events take under six minutes, which is fast enough that there is no reason to rush.',
        },
        {
          type: 'paragraph',
          value:
            'Order matters too. Reading by position guarantees that two events of the same order never swap places. To parallelize, the right split is by aggregate key, with each worker reading only the orders where hashtext(pedido_id) modulo N equals its index. Parallelizing by time range feels natural and breaks exactly the per-order ordering, which is the only ordering the version guard needs.',
        },
      ],
    },
    {
      title: 'Simulate before applying: the diff as a gate',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the simular flag, the same applier walks through the day without writing commissions and without calling providers. Instead, it writes the current value and the value it would write into the diff table, and the metrics count how many effects would be applied and how many are already recorded. The summary below is what the team reviews before authorizing the real run.',
        },
        {
          type: 'code',
          value: resumoDiffCode,
        },
        {
          type: 'paragraph',
          value:
            'The value of this gate lies in comparing the result with the expectation the incident already gave you. We expected about 38,000 changed orders and about 4,100 notifications to apply. If the simulation says 205,000 notifications, the ledger is not recognizing what the live consumer did, almost always because the key changed format between versions or because the ledger was created after the day being reprocessed. Finding this out in the simulation costs one query; finding it out in the real run costs 200,000 messages.',
        },
        {
          type: 'ordered',
          items: [
            'Freeze the scope: time window, event types, code version and effect policy, all recorded together with the execucaoId.',
            'Run the simulation and produce the diff summary and the effect metrics.',
            'Compare against the incident\'s expectation and investigate any number off by an order of magnitude.',
            'Run with a throughput cap, watching live consumer lag and database latency, with the AbortSignal wired to a stop button.',
            'Recompute the window\'s accumulators from the corrected state.',
            'Review the uncertain effects queue and decide, together with the business, whether a correction notice will be sent.',
          ],
        },
      ],
    },
    {
      title: 'Prove in a test that the second replay does nothing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The properties that matter fit in three tests against a real Postgres: the replay applies exactly the missing effects, a second replay with another id applies none, an interrupted run resumes from the checkpoint, and state written by the live consumer with a newer version survives the replay. Using a real database instead of a mock is deliberate: the guarantees live in the on conflict and in the where clause of the upsert, and a mock would only test what you think the database does.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'The scenario built in beforeEach is the incident in miniature: one event already notified live, two that failed before notifying, and one order that received a newer version afterwards. If someone changes the key format, swaps the upsert for an unconditional update, or generates the effect id with a random UUID, one of these tests breaks before the next reprocessing run happens in production.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why not simply reset the consumer group offset?',
      answer:
        'Because the reset reprocesses everything from the chosen point onward, for the whole group, with the live consumer\'s effect policy and no throughput limit. You resend messages, increment accumulators again, delay current traffic and cannot simulate first. A separate consumer group or a read from the archive, with its own execucaoId, gives you independent scope, policy and cap.',
    },
    {
      question: 'What if the effect ledger did not exist when the original events were processed?',
      answer:
        'Then the replay has no way of knowing what already happened, and the default policy must be to suppress external effects. Before applying any of them, rebuild the ledger from a trustworthy source, such as the messaging provider\'s records or the ERP entries, and only then run the simulation to check that the number of effects to apply makes sense.',
    },
    {
      question: 'How do I choose between suppressing and applying only what is missing for an external effect?',
      answer:
        'Ask whether the effect still has value after the delay and whether its absence is an error. An ERP entry that was never created is an error and should be applied. A delivery reminder two days late has no value and should be suppressed. When in doubt, suppressing and producing a list for review is reversible; sending is not.',
    },
  ],
  conclusion: {
    title: 'Reprocessing is an operation, not a repetition',
    description:
      'Safely rerunning a day of events depends on decisions made before the incident: a deterministic key per effect, written to the same ledger by the live consumer and by the replay; state protected by aggregate version; accumulators recomputed instead of incremented; and derived events with stable ids. With that in place, the replay becomes a procedure with scope, simulation, diff, throughput cap and a stop button. Without it, fixing a commission bug becomes a second incident, bigger than the first.',
    cta: 'Review my system\'s event flow and reprocessing',
  },
  related: [
    {
      label: 'The dead letter queue nobody reads: turning discarded messages into real fixes',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Transactional outbox: writing to the database and publishing the event without losing either one',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Automation and Integrations',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

const es = {
  intro:
    'A las 9:40 del día 14 un despliegue cambió el cálculo de comisión y empezó a dividir el porcentaje entre mil en lugar de entre cien. Hasta las 17:10, cuando alguien lo notó, 38.000 pedidos tenían la comisión equivocada, y otros 4.100 eventos habían fallado antes de notificar al vendedor porque el proveedor de WhatsApp se volvió inestable por la tarde. Corregir el código llevó veinte minutos. La pregunta difícil vino después: cómo reejecutar el día entero con el código correcto sin enviar de nuevo 210.000 mensajes, sin sumar dos veces el total vendido y sin volver a publicar los eventos que finanzas convierte en pagos. Este artículo muestra por qué retroceder el offset del consumidor es la peor respuesta, cómo clasificar cada efecto antes de reejecutar, cómo un ledger con clave determinista hace que el replay aplique solo lo que falta, cómo ejecutar el replay junto al tráfico en vivo sin disputar el estado, cómo simular y revisar el diff antes de aplicar y cómo demostrar en una prueba que el segundo replay no hace nada.',
  sections: [
    {
      title: 'Qué pasa cuando solo retrocedes el offset',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La respuesta instintiva de quien usa Kafka, SQS con archivo o cualquier log de eventos es reiniciar el offset del consumer group a la medianoche del día 14 y dejar que el consumidor corregido haga su trabajo. El código del consumidor ya es idempotente para el estado, así que parece seguro. No lo es, porque el consumidor no produce solo estado: produce efectos fuera de la base de datos, y esos efectos no se pueden deshacer.',
        },
        {
          type: 'list',
          items: [
            'Cada uno de los 210.000 eventos pedido.pago vuelve a disparar la notificación de comisión por WhatsApp. El vendedor que ya recibió tres mensajes el día 14 recibe tres más, ahora con valores distintos y sin ningún contexto.',
            'El contador de total vendido por vendedor en el día se actualiza con un incremento. Reejecutar suma el día dos veces, y el panel de metas muestra que todos llegaron al 200%.',
            'El evento derivado pedido.comissionado se publica de nuevo con un id nuevo. El servicio de finanzas, que deduplica por id, crea una segunda línea de pago para cada pedido.',
            'El reinicio vale para el grupo entero y para todo lo posterior a la medianoche del día 14, incluido el día 15 completo, que estaba correcto. El replay de un día se convierte en el de dos.',
            'Mientras el grupo relee el pasado, el tráfico del día 16 queda detenido detrás. El lag sube a horas y el incidente de comisión se convierte en un incidente de atención al cliente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Ninguno de estos problemas es un bug del consumidor. Todos vienen de la misma premisa equivocada: tratar el reprocesamiento como una repetición del procesamiento original. Un replay es una operación distinta, con otro alcance, otra política de efectos y otro límite de caudal, y hay que modelarlo como tal antes de releer el primer evento.',
        },
      ],
    },
    {
      title: 'No todos los efectos son iguales: clasificar antes de reejecutar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer artefacto de un reprocesamiento seguro no es código, es una tabla con cada efecto que produce el consumidor y lo que el replay debe hacer con él. Esa clasificación decide casi todo lo demás, y hacerla con prisa durante el incidente es lo que suele provocar la segunda ola de problemas.',
        },
        {
          type: 'table',
          columns: ['Efecto', 'Ejemplo', 'Qué hace el replay', 'Mecanismo'],
          rows: [
            ['Estado sobrescribible', 'Comisión por pedido', 'Recalcula y escribe', 'Upsert con guarda de versión del agregado'],
            ['Acumulador', 'Total vendido por vendedor en el día', 'Reconstruye la ventana entera, nunca vuelve a incrementar', 'Recalcular el agregado a partir del estado corregido'],
            ['Llamada externa con idempotencia en el proveedor', 'Crear un asiento en el ERP, reembolso en la pasarela', 'Aplica solo lo que falta', 'Ledger de efectos y clave enviada al proveedor'],
            ['Llamada externa sin idempotencia', 'WhatsApp, correo, SMS', 'Aplica solo lo que falta, y el fallo pasa a revisión humana', 'Ledger de efectos con estado incierto'],
            ['Evento derivado', 'pedido.comissionado para finanzas', 'Lo republica con el mismo id', 'Outbox con id derivado del evento de origen'],
            ['Efecto dependiente del momento', 'Recordatorio "tu pedido salió hace una hora"', 'Lo suprime', 'Política de supresión por tipo de efecto'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos filas merecen atención. El acumulador es el efecto que más engaña, porque un incremento parece estado. La corrección es dejar de incrementar durante el replay y, al final, recalcular el total del día a partir de la tabla de comisiones ya corregida, con un insert ... select ... group by que sobrescribe el valor. El evento derivado solo es seguro si su id es función del evento de origen, como un hash de evento_id más el tipo del evento derivado. Si el id se genera en el momento con un UUID aleatorio, ningún consumidor aguas abajo puede reconocer la repetición.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además un efecto que el replay no debe intentar reproducir: la corrección para quien recibió la información equivocada. Los vendedores del día 14 recibieron valores erróneos por WhatsApp. Reenviar el mensaje original con el valor correcto no corrige nada, solo confunde. Si el negocio decide avisar, eso es un efecto nuevo, notificar-correcao, con clave propia, disparado a partir del diff y no del evento.',
        },
      ],
    },
    {
      title: 'El ledger de efectos: una clave determinista por efecto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El mecanismo central es una tabla que registra cada efecto externo aplicado, con una clave que depende solo del evento y del tipo de efecto: evento_id más tipo_efeito. El consumidor en vivo y el replay usan la misma función de clave y la misma tabla, de modo que el replay descubre, efecto por efecto, qué ya ocurrió el día 14 y qué quedó pendiente. El schema de abajo incluye también el archivo de eventos, el estado de comisión con la versión del agregado que lo produjo, el checkpoint y el diff de la simulación.',
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: comissaoCode,
        },
        {
          type: 'paragraph',
          value:
            'El aplicador de abajo es el mismo código para el consumidor en vivo y para el replay; solo cambian el execucaoId, la política y la bandera de simulación. El estado de comisión usa un upsert con guarda de versión: la fila solo se sobrescribe si el evento tiene la misma versión del pedido o una más nueva. Eso permite que el replay corrija la versión 1 de un pedido sin borrar la versión 2 que el consumidor en vivo escribió mientras el replay todavía iba por la mañana.',
        },
        {
          type: 'code',
          value: aplicadorCode,
        },
        {
          type: 'paragraph',
          value:
            'El efecto externo sigue tres pasos: reservar la clave, llamar al proveedor y marcarlo como concluido. La reserva es un insert con on conflict, así que solo una ejecución puede reservar la misma clave, incluso con el replay y el consumidor en vivo procesando el mismo evento a la vez. La clave también se envía al proveedor como clave de idempotencia, y eso es lo que cubre la ventana entre que la llamada funcionó y que la marca de concluido quedó grabada.',
        },
        {
          type: 'paragraph',
          value:
            'La diferencia entre aoFalhar liberar y manter es la decisión más importante del ledger. Cuando el proveedor deduplica por clave, el fallo libera la reserva y el replay lo intenta de nuevo; el peor caso es que el proveedor reciba la misma clave dos veces e ignore la segunda. Cuando el proveedor no deduplica, como la mayoría de las APIs de mensajería, un fallo después del envío es indistinguible de un fallo antes. El estado incierto existe para eso: el efecto sale del flujo automático y va a una cola de revisión, porque reenviar a ciegas cambia un mensaje perdido por uno duplicado. Por el mismo motivo, una reserva abandonada por un proceso que murió solo se retoma automáticamente cuando el proveedor es idempotente; en los demás casos, un job de barrido mueve la reserva vieja a incierto.',
        },
      ],
    },
    {
      title: 'El ejecutor: fuera del grupo en vivo, con checkpoint y techo de caudal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El replay no debe usar el consumer group del tráfico en vivo. Lee de una fuente propia, que puede ser un consumer group separado apuntado a los offsets del día o, como en el ejemplo, una tabla de archivo de eventos, que tiene la ventaja de no depender de la retención del broker. La lectura es por posición, en lotes, y el cursor se graba al final de cada lote. Si el proceso cae en el evento 140.000, la siguiente ejecución con el mismo id retoma desde el último lote completo; los eventos del lote interrumpido se aplican otra vez, y eso es seguro porque el aplicador es idempotente.',
        },
        {
          type: 'code',
          value: executorCode,
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El techo de caudal es lo que impide que el replay se convierta en el próximo incidente. Sin él, el ejecutor lee el archivo tan rápido como la base aguanta y compite con el tráfico en vivo por conexiones, locks y CPU. La cuenta para elegir el techo parte de la holgura real: si la base soporta 3.000 escrituras por segundo y el pico del día usa 1.800, el replay se queda con 600 y deja margen para lo imprevisto. A ese ritmo, 210.000 eventos tardan menos de seis minutos, lo bastante rápido como para no tener motivo para correr.',
        },
        {
          type: 'paragraph',
          value:
            'El orden también importa. Leer por posición garantiza que dos eventos del mismo pedido nunca se inviertan. Para paralelizar, el corte correcto es por clave del agregado, con cada worker leyendo solo los pedidos en los que hashtext(pedido_id) módulo N es igual a su índice. Paralelizar por rango de tiempo parece natural y rompe justamente el orden por pedido, que es el único orden que necesita la guarda de versión.',
        },
      ],
    },
    {
      title: 'Simular antes de aplicar: el diff como puerta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la bandera simular, el mismo aplicador recorre el día sin escribir comisiones y sin llamar a proveedores. En su lugar, graba en la tabla de diff el valor actual y el valor que escribiría, y las métricas cuentan cuántos efectos se aplicarían y cuántos ya están registrados. El resumen de abajo es lo que el equipo revisa antes de autorizar la ejecución real.',
        },
        {
          type: 'code',
          value: resumoDiffCode,
        },
        {
          type: 'paragraph',
          value:
            'El valor de esta puerta está en comparar el resultado con la expectativa que el incidente ya dio. Esperábamos unos 38.000 pedidos modificados y unas 4.100 notificaciones por aplicar. Si la simulación dice 205.000 notificaciones, el ledger no está reconociendo lo que hizo el consumidor en vivo, casi siempre porque la clave cambió de formato entre versiones o porque el ledger se creó después del día que se está reprocesando. Descubrirlo en la simulación cuesta una consulta; descubrirlo en la ejecución real cuesta 200.000 mensajes.',
        },
        {
          type: 'ordered',
          items: [
            'Congelar el alcance: ventana de tiempo, tipos de evento, versión del código y política de efectos, todo registrado junto con el execucaoId.',
            'Ejecutar la simulación y generar el resumen del diff y las métricas de efectos.',
            'Comparar con la expectativa del incidente e investigar cualquier número fuera del orden de magnitud.',
            'Ejecutar con techo de caudal, vigilando el lag del consumidor en vivo y la latencia de la base, con el AbortSignal conectado a un botón de parada.',
            'Recalcular los acumuladores de la ventana a partir del estado corregido.',
            'Revisar la cola de efectos inciertos y decidir, junto con el negocio, si habrá notificación de corrección.',
          ],
        },
      ],
    },
    {
      title: 'Demostrar en una prueba que el segundo replay no hace nada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las propiedades que importan caben en tres pruebas contra un Postgres real: el replay aplica exactamente los efectos que faltaban, un segundo replay con otro id no aplica ninguno, una ejecución interrumpida retoma desde el checkpoint y el estado grabado por el consumidor en vivo con una versión más nueva sobrevive al replay. Usar una base real en lugar de un mock es deliberado: las garantías viven en el on conflict y en el where del upsert, y un mock solo probaría lo que crees que hace la base.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'El escenario montado en el beforeEach es el incidente en miniatura: un evento ya notificado en vivo, dos que fallaron antes de notificar y un pedido que recibió una versión más nueva después. Si alguien cambia el formato de la clave, sustituye el upsert por un update incondicional o genera el id del efecto con un UUID aleatorio, una de estas pruebas se rompe antes de que el próximo reprocesamiento ocurra en producción.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué no simplemente reiniciar el offset del consumer group?',
      answer:
        'Porque el reinicio reprocesa todo desde el punto elegido, para el grupo entero, con la política de efectos del consumidor en vivo y sin límite de caudal. Reenvías mensajes, vuelves a incrementar acumuladores, retrasas el tráfico actual y no puedes simular antes. Un consumer group separado o una lectura del archivo, con un execucaoId propio, te da alcance, política y techo independientes.',
    },
    {
      question: '¿Y si el ledger de efectos no existía cuando se procesaron los eventos originales?',
      answer:
        'Entonces el replay no tiene forma de saber qué ya ocurrió, y la política por defecto tiene que ser suprimir los efectos externos. Antes de aplicar cualquiera, reconstruye el ledger desde una fuente confiable, como los registros del proveedor de mensajería o los asientos del ERP, y solo después ejecuta la simulación para comprobar que el número de efectos por aplicar tiene sentido.',
    },
    {
      question: '¿Cómo elegir entre suprimir y aplicar solo lo que falta para un efecto externo?',
      answer:
        'Pregúntate si el efecto todavía tiene valor después del retraso y si su ausencia es un error. Un asiento en el ERP que nunca se creó es un error y debe aplicarse. Un recordatorio de entrega con dos días de retraso no tiene valor y debe suprimirse. Ante la duda, suprimir y generar una lista para revisión es reversible; enviar no lo es.',
    },
  ],
  conclusion: {
    title: 'Reprocesar es una operación, no una repetición',
    description:
      'Reejecutar un día de eventos con seguridad depende de decisiones tomadas antes del incidente: una clave determinista por efecto, grabada en el mismo ledger por el consumidor en vivo y por el replay; estado protegido por la versión del agregado; acumuladores recalculados en lugar de incrementados; y eventos derivados con id estable. Con eso, el replay se convierte en un procedimiento con alcance, simulación, diff, techo de caudal y botón de parada. Sin eso, la corrección de un bug de comisión se convierte en un segundo incidente, mayor que el primero.',
    cta: 'Revisar el flujo de eventos y el reprocesamiento de mi sistema',
  },
  related: [
    {
      label: 'La cola muerta que nadie lee: convertir el mensaje descartado en una corrección real',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Outbox transaccional: guardar en la base de datos y publicar el evento sin perder ninguno de los dos',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Automatización e Integraciones',
      to: '/servicos/automacao-e-integracoes',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
