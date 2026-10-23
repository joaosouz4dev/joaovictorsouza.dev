// Conteudo do artigo: saga sem compensacao. Como desfazer um fluxo distribuido que falhou
// no meio, por que compensacao nao e rollback, como ordenar os passos em compensaveis, pivo
// e re-tentaveis, como persistir o estado da saga para sobreviver a queda do orquestrador,
// como tratar o resultado incerto de um timeout, o isolamento que a saga nao tem e como
// provar em teste que nenhuma falha deixa efeito orfao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const esquemaSql = `-- saga.sql
-- O estado da saga mora no banco, nao na memoria do processo: se o orquestrador
-- cair entre o passo 2 e o passo 3, outro processo sabe exatamente onde retomar.
CREATE TABLE saga_execucoes (
  id                uuid PRIMARY KEY,
  tipo              text        NOT NULL,
  estado            text        NOT NULL CHECK (estado IN
                      ('EXECUTANDO', 'COMPENSANDO', 'CONCLUIDA', 'COMPENSADA', 'INTERVENCAO')),
  dados             jsonb       NOT NULL,
  tentativas        int         NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);

-- Um registro por passo. INICIADO significa "chamamos e nao sabemos o resultado":
-- e o estado que obriga a compensar mesmo sem confirmacao de que o efeito aconteceu.
CREATE TABLE saga_passos (
  saga_id       uuid NOT NULL REFERENCES saga_execucoes (id),
  ordem         int  NOT NULL,
  nome          text NOT NULL,
  estado        text NOT NULL CHECK (estado IN ('INICIADO', 'CONCLUIDO', 'FALHOU', 'COMPENSADO')),
  resultado     jsonb,
  erro          text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (saga_id, ordem)
);

-- O worker so procura sagas vivas e vencidas; as terminadas nao entram no indice.
CREATE INDEX saga_execucoes_pendentes
    ON saga_execucoes (proxima_tentativa)
 WHERE estado IN ('EXECUTANDO', 'COMPENSANDO');`;

const orquestradorCode = `// saga-pedido.js
import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// A ordem e a decisao de arquitetura: compensaveis primeiro, o pivo no meio,
// e depois do pivo so passos que sempre terminam se forem repetidos.
export const passos = [
  { nome: 'reservar_estoque', tipo: 'compensavel' },
  { nome: 'pre_autorizar_pagamento', tipo: 'compensavel' },
  { nome: 'agendar_coleta', tipo: 'compensavel' },
  { nome: 'capturar_pagamento', tipo: 'pivo' },
  { nome: 'emitir_nota_fiscal', tipo: 'retentavel' },
];

// Erro de negocio: o participante respondeu "nao" e nenhum efeito aconteceu
// (cartao recusado, produto sem estoque). Qualquer outro erro e resultado incerto.
export class ErroDefinitivo extends Error {}

const MAX_TENTATIVAS_COMPENSAVEL = 5;
const LIMITE_INTERVENCAO = 20;
const backoffSegundos = (n) => (n === 0 ? 0 : Math.min(2 ** n, 300));

export async function iniciarSaga(dados) {
  const id = randomUUID();
  await pool.query(
    \`INSERT INTO saga_execucoes (id, tipo, estado, dados) VALUES ($1, 'pedido', 'EXECUTANDO', $2)\`,
    [id, dados],
  );
  return id;
}

async function agendar(sagaId, estado, tentativas) {
  await pool.query(
    \`UPDATE saga_execucoes
        SET estado = $2, tentativas = $3,
            proxima_tentativa = now() + make_interval(secs => $4),
            atualizado_em = now()
      WHERE id = $1\`,
    [sagaId, estado, tentativas, backoffSegundos(tentativas)],
  );
}

// Reivindica uma saga vencida com um arrendamento de 2 minutos. Nenhuma transacao
// fica aberta durante a chamada externa: se o worker morrer, o arrendamento expira
// e outro worker retoma. Por isso toda chamada a participante precisa de timeout
// menor que o arrendamento.
async function reivindicar() {
  const { rows } = await pool.query(
    \`UPDATE saga_execucoes
        SET proxima_tentativa = now() + interval '2 minutes'
      WHERE id = (
        SELECT id FROM saga_execucoes
         WHERE estado IN ('EXECUTANDO', 'COMPENSANDO') AND proxima_tentativa <= now()
         ORDER BY proxima_tentativa
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *\`,
  );
  return rows[0] ?? null;
}

async function executarProximo(saga, acoes) {
  const { rows } = await pool.query(
    \`SELECT count(*)::int AS n FROM saga_passos WHERE saga_id = $1 AND estado = 'CONCLUIDO'\`,
    [saga.id],
  );
  const ordem = rows[0].n;
  if (ordem === passos.length) {
    await agendar(saga.id, 'CONCLUIDA', 0);
    return;
  }
  const passo = passos[ordem];

  // INICIADO e gravado antes da chamada: se o processo cair durante ela, a
  // retomada sabe que o efeito pode ter acontecido.
  await pool.query(
    \`INSERT INTO saga_passos (saga_id, ordem, nome, estado) VALUES ($1, $2, $3, 'INICIADO')
     ON CONFLICT (saga_id, ordem) DO UPDATE SET estado = 'INICIADO', atualizado_em = now()\`,
    [saga.id, ordem, passo.nome],
  );

  try {
    // A mesma chave em toda tentativa: repetir o passo nunca duplica o efeito.
    const resultado = await acoes[passo.nome].executar(saga.dados, \`\${saga.id}:\${passo.nome}\`);
    await pool.query(
      \`UPDATE saga_passos SET estado = 'CONCLUIDO', resultado = $3, erro = NULL, atualizado_em = now()
        WHERE saga_id = $1 AND ordem = $2\`,
      [saga.id, ordem, resultado ?? null],
    );
    await agendar(saga.id, 'EXECUTANDO', 0);
  } catch (erro) {
    const definitivo = erro instanceof ErroDefinitivo;
    const tentativas = saga.tentativas + 1;
    await pool.query(
      \`UPDATE saga_passos SET estado = $3, erro = $4, atualizado_em = now()
        WHERE saga_id = $1 AND ordem = $2\`,
      [saga.id, ordem, definitivo ? 'FALHOU' : 'INICIADO', String(erro.message)],
    );

    let proximo;
    if (passo.tipo === 'retentavel') {
      // Depois do pivo nao existe volta: so seguir em frente ou chamar uma pessoa.
      proximo = definitivo || tentativas >= LIMITE_INTERVENCAO ? 'INTERVENCAO' : 'EXECUTANDO';
    } else if (definitivo) {
      proximo = 'COMPENSANDO';
    } else if (passo.tipo === 'compensavel' && tentativas >= MAX_TENTATIVAS_COMPENSAVEL) {
      // Incerto e compensavel: desistir e desfazer, inclusive este passo.
      proximo = 'COMPENSANDO';
    } else {
      // Pivo incerto: nunca compensar no escuro. Repetir com a mesma chave ate
      // saber se a captura aconteceu.
      proximo = tentativas >= LIMITE_INTERVENCAO ? 'INTERVENCAO' : 'EXECUTANDO';
    }
    await agendar(saga.id, proximo, proximo === 'COMPENSANDO' ? 0 : tentativas);
  }
}

async function compensarProximo(saga, acoes) {
  // Do ultimo para o primeiro, so o que aconteceu (CONCLUIDO) ou pode ter
  // acontecido (INICIADO). FALHOU nao entra: o participante disse que nada mudou.
  const { rows } = await pool.query(
    \`SELECT ordem, nome, resultado FROM saga_passos
      WHERE saga_id = $1 AND estado IN ('CONCLUIDO', 'INICIADO')
      ORDER BY ordem DESC
      LIMIT 1\`,
    [saga.id],
  );
  if (rows.length === 0) {
    await agendar(saga.id, 'COMPENSADA', 0);
    return;
  }
  const passo = rows[0];
  try {
    await acoes[passo.nome].compensar(saga.dados, passo.resultado, \`\${saga.id}:\${passo.nome}\`);
    await pool.query(
      \`UPDATE saga_passos SET estado = 'COMPENSADO', atualizado_em = now()
        WHERE saga_id = $1 AND ordem = $2\`,
      [saga.id, passo.ordem],
    );
    await agendar(saga.id, 'COMPENSANDO', 0);
  } catch {
    // Compensacao nao tem desistencia: repete com backoff e, passado o limite,
    // continua parada em INTERVENCAO ate alguem resolver.
    const tentativas = saga.tentativas + 1;
    await agendar(saga.id, tentativas >= LIMITE_INTERVENCAO ? 'INTERVENCAO' : 'COMPENSANDO', tentativas);
  }
}

// Processa um passo de uma saga. Rodar em loop, em quantos workers quiser.
export async function processarUma(acoes) {
  const saga = await reivindicar();
  if (!saga) return false;
  if (saga.estado === 'EXECUTANDO') await executarProximo(saga, acoes);
  else await compensarProximo(saga, acoes);
  return true;
}`;

const participanteCode = `// coletas.js (servico da transportadora, lado do participante)
// A compensacao pode chegar antes da acao: o orquestrador desistiu por timeout
// enquanto o pedido de coleta ainda estava na fila do participante. O cancelamento
// grava uma lapide na chave; a criacao atrasada encontra a lapide e nao agenda nada.
//
// CREATE TABLE coletas (
//   chave_idempotencia text PRIMARY KEY,
//   pedido_id          bigint,
//   estado             text NOT NULL CHECK (estado IN ('AGENDADA', 'CANCELADA'))
// );

export async function agendarColeta(db, chave, pedidoId) {
  const { rows } = await db.query(
    \`INSERT INTO coletas (chave_idempotencia, pedido_id, estado)
     VALUES ($1, $2, 'AGENDADA')
     ON CONFLICT (chave_idempotencia) DO NOTHING
     RETURNING chave_idempotencia, estado\`,
    [chave, pedidoId],
  );
  if (rows.length > 0) return { status: 201, coleta: rows[0] };

  // Chave repetida: devolve o que ja existe, seja a coleta criada antes ou a lapide.
  const { rows: [existente] } = await db.query(
    'SELECT chave_idempotencia, estado FROM coletas WHERE chave_idempotencia = $1',
    [chave],
  );
  return { status: existente.estado === 'CANCELADA' ? 409 : 200, coleta: existente };
}

export async function cancelarColeta(db, chave) {
  // Idempotente e tolerante a ausencia: cancelar o que nao existe grava a lapide,
  // cancelar duas vezes nao muda nada, e a resposta e sempre sucesso.
  await db.query(
    \`INSERT INTO coletas (chave_idempotencia, pedido_id, estado)
     VALUES ($1, NULL, 'CANCELADA')
     ON CONFLICT (chave_idempotencia) DO UPDATE SET estado = 'CANCELADA'\`,
    [chave],
  );
  return { status: 200 };
}`;

const testeCode = `// saga-pedido.test.js
// Roda contra um Postgres descartavel com saga.sql aplicado:
//   DATABASE_URL=postgres://localhost/saga_teste node --test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { passos, processarUma, iniciarSaga, ErroDefinitivo, pool } from './saga-pedido.js';

after(() => pool.end());

// Participantes falsos que registram cada efeito por chave. O modo 'timeout'
// aplica o efeito e depois lanca erro: e o pior caso real, o participante fez
// e a resposta se perdeu no caminho.
function participantesFalsos({ falharEm, modo, vezes }) {
  const efeitos = new Map();
  let falhasRestantes = vezes;
  const acoes = {};
  for (const { nome } of passos) {
    acoes[nome] = {
      async executar(_dados, chave) {
        if (nome === falharEm && falhasRestantes > 0) {
          falhasRestantes -= 1;
          if (modo === 'definitivo') throw new ErroDefinitivo('recusado');
          efeitos.set(chave, 'feito');
          throw new Error('timeout');
        }
        efeitos.set(chave, 'feito');
        return { ok: true };
      },
      async compensar(_dados, _resultado, chave) {
        if (efeitos.get(chave) === 'feito') efeitos.set(chave, 'desfeito');
      },
    };
  }
  return { acoes, efeitos };
}

async function rodarAteParar(id, acoes) {
  for (let i = 0; i < 200; i += 1) {
    const { rows: [saga] } = await pool.query('SELECT estado FROM saga_execucoes WHERE id = $1', [id]);
    if (['CONCLUIDA', 'COMPENSADA', 'INTERVENCAO'].includes(saga.estado)) return saga.estado;
    // O teste nao espera o backoff: torna a saga elegivel de novo na hora.
    await pool.query('UPDATE saga_execucoes SET proxima_tentativa = now() WHERE id = $1', [id]);
    await processarUma(acoes);
  }
  throw new Error('saga nao terminou em 200 iteracoes');
}

const casos = [
  { falharEm: 'reservar_estoque', modo: 'definitivo', vezes: Infinity, esperado: 'COMPENSADA' },
  { falharEm: 'agendar_coleta', modo: 'definitivo', vezes: Infinity, esperado: 'COMPENSADA' },
  { falharEm: 'agendar_coleta', modo: 'timeout', vezes: Infinity, esperado: 'COMPENSADA' },
  { falharEm: 'capturar_pagamento', modo: 'definitivo', vezes: Infinity, esperado: 'COMPENSADA' },
  { falharEm: 'capturar_pagamento', modo: 'timeout', vezes: 2, esperado: 'CONCLUIDA' },
  { falharEm: 'emitir_nota_fiscal', modo: 'timeout', vezes: 3, esperado: 'CONCLUIDA' },
];

for (const caso of casos) {
  test(\`falha \${caso.modo} em \${caso.falharEm} termina \${caso.esperado} sem efeito orfao\`, async () => {
    await pool.query('TRUNCATE saga_passos, saga_execucoes');
    const { acoes, efeitos } = participantesFalsos(caso);
    const id = await iniciarSaga({ pedidoId: 42 });

    const final = await rodarAteParar(id, acoes);
    assert.equal(final, caso.esperado);

    const estados = [...efeitos.values()];
    if (final === 'COMPENSADA') {
      // Invariante: tudo o que aconteceu foi desfeito, inclusive o passo incerto.
      assert.ok(estados.every((e) => e === 'desfeito'), JSON.stringify([...efeitos]));
    } else {
      // Invariante: todos os passos aconteceram e nenhum foi desfeito.
      assert.equal(efeitos.size, passos.length);
      assert.ok(estados.every((e) => e === 'feito'));
    }
  });
}`;

const diagramaPt = `Pedido: cinco passos, um pivô, e o que acontece quando algo falha em cada trecho.

 [1] reservar estoque        compensável   desfaz: liberar reserva
 [2] pré-autorizar cartão    compensável   desfaz: cancelar pré-autorização (void)
 [3] agendar coleta          compensável   desfaz: cancelar coleta (aceita "não existe")
 ─────────────────────────── PIVÔ ───────────────────────────────────────────
 [4] capturar pagamento      pivô          sucesso: só existe ir em frente
                                           recusa: compensar 3, 2, 1
                                           timeout: repetir com a mesma chave
 ────────────────────────────────────────────────────────────────────────────
 [5] emitir nota fiscal      re-tentável   falhou: repetir até emitir ou chamar alguém

 Falha definitiva em 1..4  ──>  COMPENSANDO  ──>  desfaz do último ao primeiro  ──>  COMPENSADA
 Timeout em 1..3 (5 vezes) ──>  COMPENSANDO  (o passo incerto também é desfeito)
 Qualquer falha em 5       ──>  repetir      ──>  CONCLUIDA ou INTERVENCAO, nunca COMPENSADA`;

const diagramaEn = `Order: five steps, one pivot, and what happens when something fails in each stretch.

 [1] reserve stock           compensable   undo: release reservation
 [2] pre-authorize card      compensable   undo: void the pre-authorization
 [3] schedule pickup         compensable   undo: cancel pickup (accepts "does not exist")
 ─────────────────────────── PIVOT ──────────────────────────────────────────
 [4] capture payment         pivot         success: the only way is forward
                                           declined: compensate 3, 2, 1
                                           timeout: retry with the same key
 ────────────────────────────────────────────────────────────────────────────
 [5] issue invoice           retriable     failed: retry until issued or page someone

 Definitive failure in 1..4  ──>  COMPENSANDO  ──>  undo from last to first  ──>  COMPENSADA
 Timeout in 1..3 (5 times)   ──>  COMPENSANDO  (the uncertain step is undone too)
 Any failure in 5            ──>  retry        ──>  CONCLUIDA or INTERVENCAO, never COMPENSADA`;

const diagramaEs = `Pedido: cinco pasos, un pivote, y lo que ocurre cuando algo falla en cada tramo.

 [1] reservar stock          compensable   deshacer: liberar la reserva
 [2] preautorizar tarjeta    compensable   deshacer: anular la preautorización (void)
 [3] programar recogida      compensable   deshacer: cancelar recogida (acepta "no existe")
 ─────────────────────────── PIVOTE ─────────────────────────────────────────
 [4] capturar el pago        pivote        éxito: solo queda avanzar
                                           rechazo: compensar 3, 2, 1
                                           timeout: reintentar con la misma clave
 ────────────────────────────────────────────────────────────────────────────
 [5] emitir factura          reintentable  falló: reintentar hasta emitir o llamar a alguien

 Fallo definitivo en 1..4  ──>  COMPENSANDO  ──>  deshacer del último al primero  ──>  COMPENSADA
 Timeout en 1..3 (5 veces) ──>  COMPENSANDO  (el paso incierto también se deshace)
 Cualquier fallo en 5      ──>  reintentar   ──>  CONCLUIDA o INTERVENCAO, nunca COMPENSADA`;

const pt = {
  intro:
    'O checkout de um e-commerce tem cinco passos que falam com quatro sistemas diferentes: reservar o estoque no serviço de inventário, cobrar o cartão no provedor de pagamento, agendar a coleta na transportadora, emitir a nota fiscal e avisar o cliente. Numa terça-feira, a API da transportadora começa a responder em 40 segundos e o checkout passa a falhar no terceiro passo. O código faz o que foi escrito para fazer: registra o erro e devolve 500. Uma semana depois, o financeiro encontra 312 cartões cobrados sem pedido, o estoque mostra 1.140 unidades reservadas para ninguém, e a transportadora fatura 27 coletas que chegaram a ser agendadas, porque o timeout aconteceu depois que ela já tinha gravado o pedido. Não houve bug de lógica; houve um fluxo distribuído sem caminho de volta. Este artigo mostra por que compensação não é rollback, como ordenar os passos em compensáveis, pivô e re-tentáveis para que exista um ponto de não retorno bem definido, como persistir o estado da saga para sobreviver à queda do orquestrador, como tratar o timeout que pode ou não ter produzido efeito, qual isolamento a saga não oferece e como compensar essa ausência, e como provar em teste que nenhuma falha, em nenhum passo, deixa efeito órfão.',
  sections: [
    {
      title: 'O que sobra quando o terceiro passo falha: efeitos que ninguém vai desfazer sozinho',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dentro de um único banco, uma falha no meio da operação é resolvida pelo ROLLBACK: nada do que foi escrito na transação chega a existir para os outros. Quando os passos atravessam serviços, não há transação que os envolva. Cada chamada bem-sucedida é um fato consumado em outro sistema, com outra equipe, outro banco e outro ciclo de vida. Se o passo 3 falha, os passos 1 e 2 continuam valendo até que alguém execute, de propósito, uma ação que os anule. O fluxo original não tinha essa ação, então quem a executava era o financeiro, com planilha, uma semana depois.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro exercício é olhar cada passo e responder três perguntas: que efeito ele deixa no mundo, que ação o anula e se essa anulação devolve exatamente o estado anterior. A resposta raramente é sim. Estornar uma cobrança não apaga a cobrança: gera um segundo lançamento, aparece na fatura do cliente e pode levar dias. Uma nota fiscal autorizada só pode ser cancelada dentro do prazo da SEFAZ, normalmente 24 horas, e depois disso só com carta de correção ou nota de devolução. Um e-mail enviado não volta.',
        },
        {
          type: 'table',
          columns: ['Passo', 'Efeito no mundo', 'Ação que anula', 'Anulação é perfeita?'],
          rows: [
            ['Reservar estoque', 'Unidades indisponíveis para outros clientes', 'Liberar a reserva', 'Sim, se feita antes do vencimento da reserva'],
            ['Cobrar o cartão (captura)', 'Dinheiro movimentado, lançamento na fatura', 'Estorno (refund)', 'Não: dois lançamentos, prazo de dias, taxa do adquirente'],
            ['Pré-autorizar o cartão', 'Limite bloqueado, sem lançamento', 'Cancelar a pré-autorização (void)', 'Quase: o limite volta, sem lançamento na fatura'],
            ['Agendar coleta', 'Transportadora reserva veículo e janela', 'Cancelar a coleta', 'Sim, se cancelada antes da janela'],
            ['Emitir nota fiscal', 'Documento fiscal autorizado', 'Cancelamento na SEFAZ', 'Só dentro do prazo; depois, só nota de devolução'],
            ['Avisar o cliente', 'Mensagem entregue', 'Nenhuma', 'Não existe; no máximo, uma segunda mensagem'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tabela já sugere o desenho. Passos com anulação perfeita e barata podem vir antes de qualquer coisa arriscada. Passos com anulação cara ou inexistente precisam vir depois de todo o resto ter dado certo. O erro do checkout original não era a falta de compensação no passo 3; era cobrar o cartão, o passo de anulação mais cara, logo no segundo passo.',
        },
      ],
    },
    {
      title: 'Compensável, pivô e re-tentável: a ordem dos passos é a decisão de arquitetura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma saga é uma sequência de transações locais em que cada uma tem uma transação de compensação semanticamente inversa. A formulação original, de Garcia-Molina e Salem em 1987, já deixava claro que compensar não é desfazer: é executar uma nova ação de negócio que neutraliza o efeito da anterior. Na prática, os passos se dividem em três tipos. Compensáveis são os que têm uma ação de anulação confiável. O pivô é o passo que decide o destino da saga: se ele confirma, a saga vai até o fim; se ele recusa, tudo antes dele é compensado. Re-tentáveis são os passos posteriores ao pivô, que não podem ser desfeitos e por isso precisam ter a garantia de que, repetidos, eventualmente terminam.',
        },
        {
          type: 'paragraph',
          value:
            'Com essa classificação, o checkout é reordenado. A cobrança vira duas operações: uma pré-autorização no passo 2, que bloqueia o limite e é anulável com um void sem lançamento na fatura, e a captura no passo 4, que é o pivô. A coleta entra antes da captura, porque é cancelável. A nota fiscal vem depois, porque só deve existir se o pagamento existir, e a emissão é re-tentável: a SEFAZ pode estar fora, mas uma hora volta, e a chave de idempotência garante que a repetição não gera duas notas.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'paragraph',
          value:
            'O valor desse desenho está no que ele proíbe. Nenhum caminho leva a compensar um passo depois do pivô, então nunca é preciso cancelar nota fiscal ou estornar captura por causa de uma falha técnica. Toda falha antes do pivô é resolvida com ações baratas e quase perfeitas. Toda falha depois dele é resolvida insistindo, e o pior caso é uma pessoa sendo chamada para destravar uma emissão, não um cliente cobrado sem pedido. Quando um passo de anulação cara precisa existir antes do pivô, isso é um sinal de que o fluxo deve ser redesenhado, não de que a compensação deve ficar mais esperta.',
        },
      ],
    },
    {
      title: 'O estado da saga mora no banco: orquestrador que cai no meio não pode esquecer onde parou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma saga implementada como uma função async com try/catch funciona até o processo morrer entre o passo 2 e o passo 3, num deploy, num OOM ou num nó que some. Nesse momento, a única cópia do "onde eu estava" desaparece com a memória, e os passos 1 e 2 ficam órfãos exatamente como no checkout original. O estado precisa ser persistido antes de cada chamada externa, num lugar que sobreviva ao processo, e a forma mais direta é uma tabela de execuções e uma tabela de passos no próprio banco do serviço orquestrador.',
        },
        {
          type: 'code',
          value: esquemaSql,
        },
        {
          type: 'paragraph',
          value:
            'O orquestrador abaixo processa um passo por vez. Ele reivindica uma saga vencida com FOR UPDATE SKIP LOCKED e um arrendamento de dois minutos, executa ou compensa o próximo passo, grava o resultado e agenda a próxima rodada. Nenhuma transação fica aberta durante a chamada ao participante, o que permite rodar quantos workers forem necessários e garante que um worker que morre só atrasa a saga até o arrendamento vencer. A escolha entre orquestração e coreografia, em que cada serviço reage aos eventos do anterior, pesa aqui: com cinco passos e regras de compensação diferentes por tipo, ter um único lugar que conhece a ordem e o estado vale mais do que o desacoplamento da coreografia.',
        },
        {
          type: 'code',
          value: orquestradorCode,
        },
        {
          type: 'list',
          items: [
            'A chave de idempotência é sagaId:passo e é a mesma em toda tentativa e na compensação. É ela que permite repetir sem medo e que conecta a compensação ao efeito certo no participante.',
            'O passo é gravado como INICIADO antes da chamada. Se o processo cair durante ela, a retomada encontra INICIADO e trata o efeito como possível, não como inexistente.',
            'O contador de tentativas é da saga e volta a zero a cada passo concluído, então um passo instável não herda as falhas do anterior.',
            'Toda chamada a participante precisa de timeout menor que o arrendamento; caso contrário, um worker lento e outro que assumiu a saga chamam o mesmo passo ao mesmo tempo. A chave de idempotência torna isso inofensivo, mas não gratuito.',
          ],
        },
      ],
    },
    {
      title: 'O timeout não é falha: compensar o que talvez tenha acontecido',
      blocks: [
        {
          type: 'paragraph',
          value:
            'As 27 coletas faturadas do incidente vieram de um detalhe que o try/catch esconde: o timeout diz que a resposta não chegou, não que a ação não aconteceu. A transportadora recebeu o pedido, gravou a coleta e demorou para responder; o checkout desistiu e tratou o passo como não executado. Por isso o orquestrador distingue dois tipos de erro. ErroDefinitivo é a resposta explícita do participante dizendo que nada mudou, como cartão recusado ou produto sem estoque, e o passo vai para FALHOU, fora da compensação. Qualquer outro erro, timeout, 502, conexão resetada, deixa o passo em INICIADO, e a compensação inclui esse passo.',
        },
        {
          type: 'paragraph',
          value:
            'Compensar algo que talvez não tenha acontecido só é seguro se a compensação aceitar "não existe" como sucesso. E há um caso pior: a compensação pode chegar antes da ação. O orquestrador desistiu por timeout e mandou cancelar, mas o pedido original ainda estava numa fila interna da transportadora e é processado dois segundos depois do cancelamento. Se o cancelamento simplesmente não encontrar nada e responder 200, a coleta é agendada logo em seguida e fica órfã para sempre. A defesa é do lado do participante: o cancelamento grava uma lápide na chave de idempotência, e a criação atrasada encontra a lápide e se recusa.',
        },
        {
          type: 'code',
          value: participanteCode,
        },
        {
          type: 'paragraph',
          value:
            'Esse contrato precisa estar escrito para cada participante, e é aí que mora a maior parte do trabalho real: serviços internos aceitam a mudança; APIs de terceiros nem sempre. Quando o terceiro não oferece idempotência nem cancelamento por chave, a alternativa é consultar antes de compensar, buscando a coleta pelo identificador do pedido, e tratar a consulta como mais um passo que pode ser incerto. O pivô é o caso em que não se compensa no escuro: captura incerta é repetida com a mesma chave até o provedor responder se capturou, porque compensar uma captura que não aconteceu e depois descobrir que ela aconteceu é exatamente o cliente cobrado sem pedido.',
        },
      ],
    },
    {
      title: 'O isolamento que a saga não tem: o cliente vê o pedido que vai ser desfeito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma saga tem atomicidade eventual, consistência eventual e durabilidade, mas não tem isolamento. Entre o passo 1 e a compensação, a reserva de estoque é visível para todo mundo: outro cliente vê o produto como esgotado, um relatório conta a venda, e a tela de pedidos mostra "confirmado" para algo que vai ser desfeito trinta segundos depois. São as mesmas anomalias que os níveis de isolamento de um banco existem para impedir, agora sem banco para impedir.',
        },
        {
          type: 'table',
          columns: ['Anomalia', 'Como aparece no checkout', 'Contramedida'],
          rows: [
            ['Leitura suja', 'Cliente recebe "pedido confirmado" de uma saga que depois é compensada', 'Bloqueio semântico: pedido nasce PENDENTE e só vira CONFIRMADO depois do pivô; nenhuma comunicação antes disso'],
            ['Atualização perdida', 'Compensação devolve 3 unidades ao estoque com SET quantidade = 10, apagando uma venda concorrente', 'Operações comutativas: compensar com quantidade = quantidade + 3, nunca com valor absoluto'],
            ['Leitura não repetível', 'Preço muda entre a reserva e a captura, e a captura cobra o valor novo', 'Reler e comparar: a captura usa o valor gravado na saga e falha definitivamente se divergir'],
            ['Decisão sobre dado provisório', 'Antifraude aprova um segundo pedido porque o primeiro, ainda não capturado, conta como histórico', 'Expor o estado provisório: consumidores filtram PENDENTE ou o tratam explicitamente'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A contramedida mais importante é a primeira, e ela muda o produto, não só o código. O pedido precisa ter um estado visível que significa "em andamento", e a interface precisa saber mostrá-lo: "estamos confirmando seu pagamento" é honesto; "pedido confirmado" seguido de um e-mail de cancelamento não é. É também por isso que avisar o cliente fica depois do pivô, de preferência disparado pelo evento de saga concluída, e não como um passo da saga.',
        },
      ],
    },
    {
      title: 'Provar que nenhuma falha deixa efeito órfão: o teste que injeta erro em cada passo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A propriedade que importa numa saga é uma invariante global: ao final, ou todos os efeitos aconteceram e nenhum foi desfeito, ou todo efeito que aconteceu foi desfeito. Ela não aparece em teste de caminho feliz, e o caminho feliz é o único que costuma ser testado. O teste abaixo usa participantes falsos que registram cada efeito por chave, injeta falha definitiva e timeout em cada trecho do fluxo, roda o orquestrador real contra um Postgres descartável e verifica a invariante. O modo timeout aplica o efeito antes de lançar o erro, que é o caso que gerou as coletas órfãs.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'Os seis casos cobrem as quatro fronteiras que o desenho cria: falha definitiva antes do pivô, incerteza persistente num passo compensável, recusa e incerteza no próprio pivô, e falha depois dele. Vale acrescentar dois testes que exigem um pouco mais de estrutura: matar o worker entre gravar INICIADO e chamar o participante, verificando que outro worker retoma depois do arrendamento, e fazer a compensação falhar algumas vezes antes de passar, verificando que a saga não termina COMPENSADA com um passo ainda CONCLUIDO. Em produção, o complemento do teste é uma consulta diária por sagas em INTERVENCAO e por sagas em EXECUTANDO ou COMPENSANDO há mais de uma hora; qualquer linha nessa consulta é um efeito potencialmente órfão com nome, chave e passo.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Não seria mais simples usar uma transação distribuída com two-phase commit?',
      answer:
        'Só se todos os participantes suportarem o protocolo, e provedores de pagamento, transportadoras e a SEFAZ não suportam. Mesmo entre serviços internos, o two-phase commit mantém locks em todos os participantes enquanto o coordenador decide, e um coordenador que cai na hora errada deixa recursos travados até alguém intervir. A saga troca isolamento por disponibilidade: cada passo confirma localmente e libera seus recursos na hora, e o preço é ter que desenhar a compensação e lidar com estados intermediários visíveis. Para fluxos que atravessam fronteiras de empresa, é a única opção real.',
    },
    {
      question: 'Preciso de um motor de workflow como Temporal ou Step Functions para fazer isso?',
      answer:
        'Não para começar. As duas tabelas e o orquestrador do artigo cabem em um serviço existente e resolvem o problema central: estado persistido, retomada depois de queda, retentativa com backoff e compensação em ordem reversa. Um motor de workflow passa a compensar quando há muitas sagas diferentes, passos que esperam dias por um evento humano, necessidade de versionar o fluxo com execuções antigas ainda rodando ou de visualizar o histórico de cada execução. Nesses casos, o motor entrega a infraestrutura pronta, mas a parte difícil continua sendo sua: classificar os passos, ordenar pelo pivô e escrever compensações idempotentes que aceitam "não existe".',
    },
    {
      question: 'O que fazer quando a compensação também falha?',
      answer:
        'Repetir, porque a compensação não tem alternativa: desistir dela é aceitar o efeito órfão. O orquestrador repete com backoff exponencial e, depois de um limite, coloca a saga em INTERVENCAO, que é um estado parado, visível e alertado, não um estado terminal. A falha de compensação mais comum é transitória, o serviço de estoque fora por alguns minutos, e se resolve sozinha. A menos comum é semântica, a reserva já expirou ou a coleta já foi realizada, e precisa de uma decisão de negócio. Por isso cada compensação deve devolver sucesso para "já está no estado desejado" e erro só quando o estado desejado é impossível, para que a fila de intervenção contenha apenas o que realmente precisa de uma pessoa.',
    },
  ],
  conclusion: {
    title: 'Toda falha no meio de um fluxo distribuído já tem um plano de volta; a questão é se ele está no código ou na planilha do financeiro',
    description:
      'Um fluxo que atravessa serviços deixa um fato consumado a cada passo, e sem compensação explícita esses fatos ficam órfãos sempre que algo falha no meio. O caminho é classificar os passos em compensáveis, pivô e re-tentáveis e ordená-los de modo que nada caro de desfazer aconteça antes do ponto de não retorno; persistir o estado da saga antes de cada chamada para sobreviver à queda do orquestrador; tratar timeout como resultado incerto, compensando passos compensáveis e repetindo o pivô até ter certeza; exigir dos participantes compensações idempotentes, tolerantes a ausência e com lápide para a ação atrasada; tornar visível o estado provisório para compensar a falta de isolamento; e provar com teste de injeção de falha que a invariante "tudo ou nada, eventualmente" vale para cada passo.',
    cta: 'Revisar os fluxos distribuídos dos meus sistemas',
  },
  related: [
    {
      label: 'Outbox transacional: gravar no banco e publicar o evento sem perder nenhum dos dois',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Chave de idempotência no checkout: cobrar uma vez sem travar o fluxo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'An e-commerce checkout has five steps that talk to four different systems: reserve stock in the inventory service, charge the card at the payment provider, schedule the pickup with the carrier, issue the invoice and notify the customer. One Tuesday, the carrier API starts answering in 40 seconds and checkout begins failing at step three. The code does what it was written to do: it logs the error and returns 500. A week later, finance finds 312 cards charged without an order, inventory shows 1,140 units reserved for nobody, and the carrier bills 27 pickups that did get scheduled, because the timeout happened after the carrier had already saved the request. There was no logic bug; there was a distributed flow with no way back. This article shows why compensation is not rollback, how to order steps into compensable, pivot and retriable so that there is a well defined point of no return, how to persist saga state so it survives the orchestrator going down, how to handle a timeout that may or may not have produced an effect, which isolation a saga does not give you and how to make up for it, and how to prove in a test that no failure, at any step, leaves an orphaned effect.',
  sections: [
    {
      title: 'What is left when step three fails: effects nobody is going to undo on their own',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Inside a single database, a failure halfway through is solved by ROLLBACK: nothing written in the transaction ever exists for anyone else. When the steps cross services, there is no transaction around them. Every successful call is a done deal in another system, with another team, another database and another lifecycle. If step 3 fails, steps 1 and 2 remain in effect until someone deliberately runs an action that cancels them. The original flow had no such action, so the person running it was someone in finance, with a spreadsheet, a week later.',
        },
        {
          type: 'paragraph',
          value:
            'The first exercise is to look at each step and answer three questions: what effect it leaves in the world, which action cancels it, and whether that cancellation restores exactly the previous state. The answer is rarely yes. Refunding a charge does not erase the charge: it creates a second entry, shows up on the customer statement and can take days. An authorized Brazilian electronic invoice can only be cancelled within the tax authority window, usually 24 hours, and after that only through a correction letter or a return invoice. A sent email does not come back.',
        },
        {
          type: 'table',
          columns: ['Step', 'Effect in the world', 'Cancelling action', 'Is the cancellation perfect?'],
          rows: [
            ['Reserve stock', 'Units unavailable to other customers', 'Release the reservation', 'Yes, if done before the reservation expires'],
            ['Charge the card (capture)', 'Money moved, entry on the statement', 'Refund', 'No: two entries, takes days, acquirer fee'],
            ['Pre-authorize the card', 'Credit limit held, no statement entry', 'Void the pre-authorization', 'Almost: the limit comes back, no statement entry'],
            ['Schedule pickup', 'Carrier reserves a vehicle and a time window', 'Cancel the pickup', 'Yes, if cancelled before the window'],
            ['Issue invoice', 'Authorized tax document', 'Cancellation at the tax authority', 'Only within the window; after that, only a return invoice'],
            ['Notify the customer', 'Message delivered', 'None', 'Does not exist; at most, a second message'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The table already suggests the design. Steps with a perfect, cheap cancellation can come before anything risky. Steps whose cancellation is expensive or nonexistent must come after everything else has succeeded. The mistake in the original checkout was not the missing compensation at step 3; it was charging the card, the step with the most expensive cancellation, as early as step two.',
        },
      ],
    },
    {
      title: 'Compensable, pivot and retriable: the order of the steps is the architectural decision',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A saga is a sequence of local transactions in which each one has a semantically inverse compensating transaction. The original formulation, by Garcia-Molina and Salem in 1987, already made it clear that compensating is not undoing: it is running a new business action that neutralizes the effect of the previous one. In practice, steps fall into three kinds. Compensable steps have a reliable cancelling action. The pivot is the step that decides the fate of the saga: if it confirms, the saga runs to the end; if it refuses, everything before it is compensated. Retriable steps come after the pivot; they cannot be undone, so they must be guaranteed to eventually finish when repeated.',
        },
        {
          type: 'paragraph',
          value:
            'With that classification, the checkout gets reordered. The charge becomes two operations: a pre-authorization at step 2, which holds the credit limit and can be voided without a statement entry, and the capture at step 4, which is the pivot. The pickup goes before the capture, because it can be cancelled. The invoice comes after, because it should only exist if the payment exists, and issuing it is retriable: the tax authority may be down, but it will come back, and the idempotency key guarantees that the retry does not create two invoices.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'paragraph',
          value:
            'The value of this design lies in what it forbids. No path leads to compensating a step after the pivot, so there is never a need to cancel an invoice or refund a capture because of a technical failure. Every failure before the pivot is solved with cheap, almost perfect actions. Every failure after it is solved by insisting, and the worst case is someone being paged to unblock an invoice, not a customer charged without an order. When a step with an expensive cancellation has to exist before the pivot, that is a sign the flow should be redesigned, not that the compensation should get smarter.',
        },
      ],
    },
    {
      title: 'Saga state lives in the database: an orchestrator that dies halfway cannot forget where it stopped',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A saga implemented as an async function with try/catch works until the process dies between step 2 and step 3, during a deploy, an OOM or a node that disappears. At that moment, the only copy of "where I was" vanishes with the memory, and steps 1 and 2 are orphaned exactly as in the original checkout. State has to be persisted before every external call, somewhere that outlives the process, and the most direct way is an executions table and a steps table in the orchestrator service database itself.',
        },
        {
          type: 'code',
          value: esquemaSql,
        },
        {
          type: 'paragraph',
          value:
            'The orchestrator below processes one step at a time. It claims a due saga with FOR UPDATE SKIP LOCKED and a two minute lease, executes or compensates the next step, records the result and schedules the next round. No transaction stays open during the call to the participant, which allows running as many workers as needed and guarantees that a worker that dies only delays the saga until the lease expires. The choice between orchestration and choreography, where each service reacts to the events of the previous one, matters here: with five steps and different compensation rules per kind, having a single place that knows the order and the state is worth more than the decoupling of choreography.',
        },
        {
          type: 'code',
          value: orquestradorCode,
        },
        {
          type: 'list',
          items: [
            'The idempotency key is sagaId:step and is the same on every attempt and in the compensation. It is what allows retrying without fear and what links the compensation to the right effect at the participant.',
            'The step is recorded as INICIADO before the call. If the process dies during it, recovery finds INICIADO and treats the effect as possible, not as nonexistent.',
            'The attempt counter belongs to the saga and resets to zero on every completed step, so an unstable step does not inherit the failures of the previous one.',
            'Every call to a participant needs a timeout shorter than the lease; otherwise, a slow worker and another that took over the saga call the same step at the same time. The idempotency key makes that harmless, but not free.',
          ],
        },
      ],
    },
    {
      title: 'A timeout is not a failure: compensating what may have happened',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The 27 billed pickups in the incident came from a detail that try/catch hides: a timeout says the response did not arrive, not that the action did not happen. The carrier received the request, saved the pickup and was slow to respond; checkout gave up and treated the step as not executed. That is why the orchestrator distinguishes two kinds of error. ErroDefinitivo is the participant explicitly saying nothing changed, such as a declined card or an out of stock product, and the step goes to FALHOU, outside the compensation. Any other error, timeout, 502, connection reset, leaves the step in INICIADO, and the compensation includes that step.',
        },
        {
          type: 'paragraph',
          value:
            'Compensating something that may not have happened is only safe if the compensation accepts "does not exist" as success. And there is a worse case: the compensation may arrive before the action. The orchestrator gave up on a timeout and sent the cancellation, but the original request was still in an internal queue at the carrier and is processed two seconds after the cancellation. If the cancellation simply finds nothing and returns 200, the pickup is scheduled right afterwards and stays orphaned forever. The defense lives on the participant side: the cancellation writes a tombstone on the idempotency key, and the late creation finds the tombstone and refuses.',
        },
        {
          type: 'code',
          value: participanteCode,
        },
        {
          type: 'paragraph',
          value:
            'This contract has to be written down for each participant, and that is where most of the real work lies: internal services accept the change; third party APIs do not always. When the third party offers neither idempotency nor cancellation by key, the alternative is to query before compensating, looking up the pickup by order identifier, and to treat that query as one more step that can be uncertain. The pivot is the case where you never compensate in the dark: an uncertain capture is retried with the same key until the provider says whether it captured, because compensating a capture that did not happen and then finding out it did is exactly the customer charged without an order.',
        },
      ],
    },
    {
      title: 'The isolation a saga does not have: the customer sees the order that is about to be undone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A saga has eventual atomicity, eventual consistency and durability, but no isolation. Between step 1 and the compensation, the stock reservation is visible to everyone: another customer sees the product as sold out, a report counts the sale, and the orders screen shows "confirmed" for something that will be undone thirty seconds later. These are the same anomalies that database isolation levels exist to prevent, now with no database to prevent them.',
        },
        {
          type: 'table',
          columns: ['Anomaly', 'How it shows up in checkout', 'Countermeasure'],
          rows: [
            ['Dirty read', 'Customer gets "order confirmed" from a saga that is later compensated', 'Semantic lock: the order is born PENDENTE and only becomes CONFIRMADO after the pivot; no communication before that'],
            ['Lost update', 'Compensation returns 3 units to stock with SET quantity = 10, erasing a concurrent sale', 'Commutative operations: compensate with quantity = quantity + 3, never with an absolute value'],
            ['Non-repeatable read', 'Price changes between reservation and capture, and the capture charges the new amount', 'Reread and compare: the capture uses the amount stored in the saga and fails definitively if it diverges'],
            ['Decision on provisional data', 'Fraud check approves a second order because the first one, not yet captured, counts as history', 'Expose the provisional state: consumers filter out PENDENTE or handle it explicitly'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most important countermeasure is the first one, and it changes the product, not just the code. The order needs a visible state that means "in progress", and the interface needs to know how to show it: "we are confirming your payment" is honest; "order confirmed" followed by a cancellation email is not. That is also why notifying the customer comes after the pivot, ideally triggered by the saga completed event, and not as a step of the saga.',
        },
      ],
    },
    {
      title: 'Proving that no failure leaves an orphaned effect: the test that injects an error at every step',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The property that matters in a saga is a global invariant: at the end, either every effect happened and none was undone, or every effect that happened was undone. It does not show up in happy path tests, and the happy path is usually the only one tested. The test below uses fake participants that record each effect by key, injects definitive failures and timeouts at each stretch of the flow, runs the real orchestrator against a disposable Postgres and checks the invariant. The timeout mode applies the effect before throwing, which is the case that produced the orphaned pickups.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'The six cases cover the four boundaries the design creates: definitive failure before the pivot, persistent uncertainty at a compensable step, refusal and uncertainty at the pivot itself, and failure after it. Two more tests are worth adding, at the cost of a bit more scaffolding: killing the worker between recording INICIADO and calling the participant, checking that another worker resumes after the lease, and making the compensation fail a few times before succeeding, checking that the saga never ends COMPENSADA with a step still CONCLUIDO. In production, the complement to the test is a daily query for sagas in INTERVENCAO and for sagas in EXECUTANDO or COMPENSANDO for more than an hour; every row in that query is a potentially orphaned effect with a name, a key and a step.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would it not be simpler to use a distributed transaction with two-phase commit?',
      answer:
        'Only if every participant supports the protocol, and payment providers, carriers and tax authorities do not. Even between internal services, two-phase commit holds locks on every participant while the coordinator decides, and a coordinator that dies at the wrong moment leaves resources locked until someone steps in. A saga trades isolation for availability: each step commits locally and releases its resources right away, and the price is having to design the compensation and deal with visible intermediate states. For flows that cross company boundaries, it is the only real option.',
    },
    {
      question: 'Do I need a workflow engine such as Temporal or Step Functions to do this?',
      answer:
        'Not to get started. The two tables and the orchestrator in this article fit inside an existing service and solve the core problem: persisted state, recovery after a crash, retries with backoff and compensation in reverse order. A workflow engine starts paying off when there are many different sagas, steps that wait days for a human event, a need to version the flow while old executions are still running, or a need to inspect the history of each execution. In those cases the engine gives you the infrastructure ready-made, but the hard part is still yours: classifying the steps, ordering them around the pivot and writing idempotent compensations that accept "does not exist".',
    },
    {
      question: 'What should happen when the compensation itself fails?',
      answer:
        'Retry, because compensation has no alternative: giving up on it means accepting the orphaned effect. The orchestrator retries with exponential backoff and, after a limit, moves the saga to INTERVENCAO, which is a stopped, visible and alerted state, not a terminal one. The most common compensation failure is transient, the stock service down for a few minutes, and it resolves itself. The less common one is semantic, the reservation already expired or the pickup already happened, and it needs a business decision. That is why every compensation should return success for "already in the desired state" and an error only when the desired state is impossible, so that the intervention queue holds only what truly needs a person.',
    },
  ],
  conclusion: {
    title: 'Every failure halfway through a distributed flow already has a way back; the question is whether it lives in the code or in a finance spreadsheet',
    description:
      'A flow that crosses services leaves a done deal at every step, and without explicit compensation those facts are orphaned whenever something fails halfway. The path is to classify the steps as compensable, pivot and retriable and order them so that nothing expensive to undo happens before the point of no return; to persist saga state before every call so it survives the orchestrator going down; to treat a timeout as an uncertain outcome, compensating compensable steps and retrying the pivot until certain; to require idempotent compensations from participants that tolerate absence and leave a tombstone for the late action; to make the provisional state visible to make up for the missing isolation; and to prove with failure injection tests that the "all or nothing, eventually" invariant holds for every step.',
    cta: 'Review the distributed flows in my systems',
  },
  related: [
    {
      label: 'Transactional outbox: write to the database and publish the event without losing either',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Idempotency key at checkout: charge once without blocking the flow',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El checkout de un e-commerce tiene cinco pasos que hablan con cuatro sistemas distintos: reservar el stock en el servicio de inventario, cobrar la tarjeta en el proveedor de pagos, programar la recogida con la transportista, emitir la factura y avisar al cliente. Un martes, la API de la transportista empieza a responder en 40 segundos y el checkout empieza a fallar en el tercer paso. El código hace lo que se escribió para hacer: registra el error y devuelve 500. Una semana después, finanzas encuentra 312 tarjetas cobradas sin pedido, el inventario muestra 1.140 unidades reservadas para nadie y la transportista factura 27 recogidas que sí llegaron a programarse, porque el timeout ocurrió después de que ella ya había guardado la solicitud. No hubo un bug de lógica; hubo un flujo distribuido sin camino de vuelta. Este artículo muestra por qué compensar no es hacer rollback, cómo ordenar los pasos en compensables, pivote y reintentables para que exista un punto de no retorno bien definido, cómo persistir el estado de la saga para que sobreviva a la caída del orquestador, cómo tratar un timeout que puede o no haber producido efecto, qué aislamiento no ofrece la saga y cómo suplir esa falta, y cómo demostrar en una prueba que ningún fallo, en ningún paso, deja un efecto huérfano.',
  sections: [
    {
      title: 'Lo que queda cuando falla el tercer paso: efectos que nadie va a deshacer por sí solo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Dentro de una sola base de datos, un fallo a mitad de la operación se resuelve con ROLLBACK: nada de lo escrito en la transacción llega a existir para los demás. Cuando los pasos atraviesan servicios, no hay transacción que los envuelva. Cada llamada exitosa es un hecho consumado en otro sistema, con otro equipo, otra base de datos y otro ciclo de vida. Si el paso 3 falla, los pasos 1 y 2 siguen vigentes hasta que alguien ejecute, a propósito, una acción que los anule. El flujo original no tenía esa acción, así que quien la ejecutaba era alguien de finanzas, con una hoja de cálculo, una semana después.',
        },
        {
          type: 'paragraph',
          value:
            'El primer ejercicio es mirar cada paso y responder tres preguntas: qué efecto deja en el mundo, qué acción lo anula y si esa anulación devuelve exactamente el estado anterior. La respuesta rara vez es sí. Reembolsar un cobro no borra el cobro: genera un segundo movimiento, aparece en el extracto del cliente y puede tardar días. Una factura electrónica autorizada en Brasil solo puede anularse dentro del plazo de la autoridad fiscal, normalmente 24 horas, y después solo con carta de corrección o factura de devolución. Un correo enviado no vuelve.',
        },
        {
          type: 'table',
          columns: ['Paso', 'Efecto en el mundo', 'Acción que lo anula', '¿La anulación es perfecta?'],
          rows: [
            ['Reservar stock', 'Unidades no disponibles para otros clientes', 'Liberar la reserva', 'Sí, si se hace antes de que la reserva venza'],
            ['Cobrar la tarjeta (captura)', 'Dinero movido, movimiento en el extracto', 'Reembolso (refund)', 'No: dos movimientos, tarda días, comisión del adquirente'],
            ['Preautorizar la tarjeta', 'Límite bloqueado, sin movimiento', 'Anular la preautorización (void)', 'Casi: el límite vuelve, sin movimiento en el extracto'],
            ['Programar recogida', 'La transportista reserva vehículo y franja horaria', 'Cancelar la recogida', 'Sí, si se cancela antes de la franja'],
            ['Emitir factura', 'Documento fiscal autorizado', 'Anulación ante la autoridad fiscal', 'Solo dentro del plazo; después, solo factura de devolución'],
            ['Avisar al cliente', 'Mensaje entregado', 'Ninguna', 'No existe; como mucho, un segundo mensaje'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tabla ya sugiere el diseño. Los pasos con anulación perfecta y barata pueden ir antes de cualquier cosa arriesgada. Los pasos con anulación cara o inexistente tienen que ir después de que todo lo demás haya salido bien. El error del checkout original no era la falta de compensación en el paso 3; era cobrar la tarjeta, el paso de anulación más cara, ya en el segundo paso.',
        },
      ],
    },
    {
      title: 'Compensable, pivote y reintentable: el orden de los pasos es la decisión de arquitectura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una saga es una secuencia de transacciones locales en la que cada una tiene una transacción de compensación semánticamente inversa. La formulación original, de Garcia-Molina y Salem en 1987, ya dejaba claro que compensar no es deshacer: es ejecutar una nueva acción de negocio que neutraliza el efecto de la anterior. En la práctica, los pasos se dividen en tres tipos. Los compensables tienen una acción de anulación confiable. El pivote es el paso que decide el destino de la saga: si confirma, la saga llega hasta el final; si rechaza, todo lo anterior se compensa. Los reintentables vienen después del pivote; no se pueden deshacer, así que necesitan la garantía de que, repetidos, terminan tarde o temprano.',
        },
        {
          type: 'paragraph',
          value:
            'Con esa clasificación, el checkout se reordena. El cobro se convierte en dos operaciones: una preautorización en el paso 2, que bloquea el límite y se puede anular con un void sin movimiento en el extracto, y la captura en el paso 4, que es el pivote. La recogida va antes de la captura, porque se puede cancelar. La factura va después, porque solo debe existir si existe el pago, y su emisión es reintentable: la autoridad fiscal puede estar caída, pero en algún momento vuelve, y la clave de idempotencia garantiza que el reintento no genere dos facturas.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'paragraph',
          value:
            'El valor de este diseño está en lo que prohíbe. Ningún camino lleva a compensar un paso posterior al pivote, así que nunca hace falta anular una factura ni reembolsar una captura por un fallo técnico. Todo fallo antes del pivote se resuelve con acciones baratas y casi perfectas. Todo fallo después se resuelve insistiendo, y el peor caso es llamar a una persona para destrabar una emisión, no un cliente cobrado sin pedido. Cuando un paso de anulación cara tiene que existir antes del pivote, es señal de que hay que rediseñar el flujo, no de que la compensación deba volverse más ingeniosa.',
        },
      ],
    },
    {
      title: 'El estado de la saga vive en la base de datos: un orquestador que cae a mitad no puede olvidar dónde se quedó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una saga implementada como una función async con try/catch funciona hasta que el proceso muere entre el paso 2 y el paso 3, en un despliegue, un OOM o un nodo que desaparece. En ese momento, la única copia de "dónde estaba" desaparece con la memoria, y los pasos 1 y 2 quedan huérfanos exactamente como en el checkout original. El estado tiene que persistirse antes de cada llamada externa, en un lugar que sobreviva al proceso, y la forma más directa es una tabla de ejecuciones y una tabla de pasos en la propia base de datos del servicio orquestador.',
        },
        {
          type: 'code',
          value: esquemaSql,
        },
        {
          type: 'paragraph',
          value:
            'El orquestador de abajo procesa un paso a la vez. Reclama una saga vencida con FOR UPDATE SKIP LOCKED y un arrendamiento de dos minutos, ejecuta o compensa el siguiente paso, guarda el resultado y programa la siguiente ronda. Ninguna transacción queda abierta durante la llamada al participante, lo que permite ejecutar tantos workers como haga falta y garantiza que un worker que muere solo retrasa la saga hasta que vence el arrendamiento. La elección entre orquestación y coreografía, en la que cada servicio reacciona a los eventos del anterior, pesa aquí: con cinco pasos y reglas de compensación distintas por tipo, tener un único lugar que conoce el orden y el estado vale más que el desacoplamiento de la coreografía.',
        },
        {
          type: 'code',
          value: orquestradorCode,
        },
        {
          type: 'list',
          items: [
            'La clave de idempotencia es sagaId:paso y es la misma en cada intento y en la compensación. Es lo que permite reintentar sin miedo y lo que conecta la compensación con el efecto correcto en el participante.',
            'El paso se guarda como INICIADO antes de la llamada. Si el proceso cae durante ella, la recuperación encuentra INICIADO y trata el efecto como posible, no como inexistente.',
            'El contador de intentos es de la saga y vuelve a cero en cada paso completado, así que un paso inestable no hereda los fallos del anterior.',
            'Toda llamada a un participante necesita un timeout menor que el arrendamiento; si no, un worker lento y otro que tomó la saga llaman al mismo paso a la vez. La clave de idempotencia lo vuelve inofensivo, pero no gratuito.',
          ],
        },
      ],
    },
    {
      title: 'Un timeout no es un fallo: compensar lo que quizá ocurrió',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las 27 recogidas facturadas del incidente vinieron de un detalle que el try/catch esconde: el timeout dice que la respuesta no llegó, no que la acción no ocurrió. La transportista recibió la solicitud, guardó la recogida y tardó en responder; el checkout desistió y trató el paso como no ejecutado. Por eso el orquestador distingue dos tipos de error. ErroDefinitivo es la respuesta explícita del participante diciendo que nada cambió, como una tarjeta rechazada o un producto sin stock, y el paso pasa a FALHOU, fuera de la compensación. Cualquier otro error, timeout, 502, conexión reiniciada, deja el paso en INICIADO, y la compensación incluye ese paso.',
        },
        {
          type: 'paragraph',
          value:
            'Compensar algo que quizá no ocurrió solo es seguro si la compensación acepta "no existe" como éxito. Y hay un caso peor: la compensación puede llegar antes que la acción. El orquestador desistió por timeout y envió la cancelación, pero la solicitud original seguía en una cola interna de la transportista y se procesa dos segundos después de la cancelación. Si la cancelación simplemente no encuentra nada y responde 200, la recogida se programa justo después y queda huérfana para siempre. La defensa está del lado del participante: la cancelación graba una lápida en la clave de idempotencia, y la creación tardía encuentra la lápida y se niega.',
        },
        {
          type: 'code',
          value: participanteCode,
        },
        {
          type: 'paragraph',
          value:
            'Este contrato tiene que estar escrito para cada participante, y ahí está la mayor parte del trabajo real: los servicios internos aceptan el cambio; las APIs de terceros no siempre. Cuando el tercero no ofrece idempotencia ni cancelación por clave, la alternativa es consultar antes de compensar, buscando la recogida por el identificador del pedido, y tratar esa consulta como un paso más que puede ser incierto. El pivote es el caso en el que nunca se compensa a ciegas: una captura incierta se reintenta con la misma clave hasta que el proveedor responda si capturó, porque compensar una captura que no ocurrió y luego descubrir que sí ocurrió es exactamente el cliente cobrado sin pedido.',
        },
      ],
    },
    {
      title: 'El aislamiento que la saga no tiene: el cliente ve el pedido que se va a deshacer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una saga tiene atomicidad eventual, consistencia eventual y durabilidad, pero no tiene aislamiento. Entre el paso 1 y la compensación, la reserva de stock es visible para todos: otro cliente ve el producto agotado, un informe cuenta la venta y la pantalla de pedidos muestra "confirmado" para algo que se va a deshacer treinta segundos después. Son las mismas anomalías que los niveles de aislamiento de una base de datos existen para impedir, ahora sin base de datos que las impida.',
        },
        {
          type: 'table',
          columns: ['Anomalía', 'Cómo aparece en el checkout', 'Contramedida'],
          rows: [
            ['Lectura sucia', 'El cliente recibe "pedido confirmado" de una saga que luego se compensa', 'Bloqueo semántico: el pedido nace PENDENTE y solo pasa a CONFIRMADO después del pivote; ninguna comunicación antes'],
            ['Actualización perdida', 'La compensación devuelve 3 unidades al stock con SET cantidad = 10 y borra una venta concurrente', 'Operaciones conmutativas: compensar con cantidad = cantidad + 3, nunca con un valor absoluto'],
            ['Lectura no repetible', 'El precio cambia entre la reserva y la captura, y la captura cobra el valor nuevo', 'Releer y comparar: la captura usa el valor guardado en la saga y falla de forma definitiva si difiere'],
            ['Decisión sobre dato provisional', 'El antifraude aprueba un segundo pedido porque el primero, aún sin capturar, cuenta como historial', 'Exponer el estado provisional: los consumidores filtran PENDENTE o lo tratan de forma explícita'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La contramedida más importante es la primera, y cambia el producto, no solo el código. El pedido necesita un estado visible que signifique "en curso", y la interfaz necesita saber mostrarlo: "estamos confirmando tu pago" es honesto; "pedido confirmado" seguido de un correo de cancelación no lo es. También por eso avisar al cliente va después del pivote, idealmente disparado por el evento de saga completada, y no como un paso de la saga.',
        },
      ],
    },
    {
      title: 'Demostrar que ningún fallo deja un efecto huérfano: la prueba que inyecta errores en cada paso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La propiedad que importa en una saga es una invariante global: al final, o todos los efectos ocurrieron y ninguno se deshizo, o todo efecto que ocurrió se deshizo. No aparece en pruebas del camino feliz, y el camino feliz suele ser el único que se prueba. La prueba de abajo usa participantes falsos que registran cada efecto por clave, inyecta fallos definitivos y timeouts en cada tramo del flujo, ejecuta el orquestador real contra un Postgres desechable y verifica la invariante. El modo timeout aplica el efecto antes de lanzar el error, que es el caso que generó las recogidas huérfanas.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'Los seis casos cubren las cuatro fronteras que crea el diseño: fallo definitivo antes del pivote, incertidumbre persistente en un paso compensable, rechazo e incertidumbre en el propio pivote, y fallo después de él. Vale la pena añadir dos pruebas que exigen algo más de estructura: matar el worker entre guardar INICIADO y llamar al participante, comprobando que otro worker retoma tras el arrendamiento, y hacer que la compensación falle algunas veces antes de pasar, comprobando que la saga nunca termina COMPENSADA con un paso todavía CONCLUIDO. En producción, el complemento de la prueba es una consulta diaria de sagas en INTERVENCAO y de sagas en EXECUTANDO o COMPENSANDO desde hace más de una hora; cada fila de esa consulta es un efecto potencialmente huérfano con nombre, clave y paso.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿No sería más sencillo usar una transacción distribuida con two-phase commit?',
      answer:
        'Solo si todos los participantes soportan el protocolo, y los proveedores de pago, las transportistas y la autoridad fiscal no lo soportan. Incluso entre servicios internos, el two-phase commit mantiene bloqueos en todos los participantes mientras el coordinador decide, y un coordinador que cae en el peor momento deja recursos bloqueados hasta que alguien intervenga. La saga cambia aislamiento por disponibilidad: cada paso confirma localmente y libera sus recursos enseguida, y el precio es tener que diseñar la compensación y convivir con estados intermedios visibles. Para flujos que cruzan fronteras entre empresas, es la única opción real.',
    },
    {
      question: '¿Necesito un motor de workflows como Temporal o Step Functions para hacer esto?',
      answer:
        'No para empezar. Las dos tablas y el orquestador del artículo caben en un servicio existente y resuelven el problema central: estado persistido, recuperación tras una caída, reintentos con backoff y compensación en orden inverso. Un motor de workflows empieza a compensar cuando hay muchas sagas distintas, pasos que esperan días un evento humano, necesidad de versionar el flujo con ejecuciones antiguas aún en curso o de inspeccionar el historial de cada ejecución. En esos casos el motor te da la infraestructura hecha, pero la parte difícil sigue siendo tuya: clasificar los pasos, ordenarlos alrededor del pivote y escribir compensaciones idempotentes que acepten "no existe".',
    },
    {
      question: '¿Qué hacer cuando la compensación también falla?',
      answer:
        'Reintentar, porque la compensación no tiene alternativa: renunciar a ella es aceptar el efecto huérfano. El orquestador reintenta con backoff exponencial y, pasado un límite, pone la saga en INTERVENCAO, que es un estado detenido, visible y con alerta, no un estado terminal. El fallo de compensación más común es transitorio, el servicio de stock caído unos minutos, y se resuelve solo. El menos común es semántico, la reserva ya venció o la recogida ya se realizó, y necesita una decisión de negocio. Por eso cada compensación debe devolver éxito para "ya está en el estado deseado" y error solo cuando el estado deseado es imposible, para que la cola de intervención contenga únicamente lo que de verdad necesita a una persona.',
    },
  ],
  conclusion: {
    title: 'Todo fallo a mitad de un flujo distribuido ya tiene un plan de vuelta; la cuestión es si está en el código o en la hoja de cálculo de finanzas',
    description:
      'Un flujo que atraviesa servicios deja un hecho consumado en cada paso, y sin compensación explícita esos hechos quedan huérfanos cada vez que algo falla a mitad. El camino es clasificar los pasos en compensables, pivote y reintentables y ordenarlos para que nada caro de deshacer ocurra antes del punto de no retorno; persistir el estado de la saga antes de cada llamada para sobrevivir a la caída del orquestador; tratar el timeout como un resultado incierto, compensando los pasos compensables y reintentando el pivote hasta tener certeza; exigir a los participantes compensaciones idempotentes, tolerantes a la ausencia y con lápida para la acción tardía; hacer visible el estado provisional para suplir la falta de aislamiento; y demostrar con pruebas de inyección de fallos que la invariante "todo o nada, tarde o temprano" se cumple en cada paso.',
    cta: 'Revisar los flujos distribuidos de mis sistemas',
  },
  related: [
    {
      label: 'Outbox transaccional: guardar en la base de datos y publicar el evento sin perder ninguno de los dos',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Clave de idempotencia en el checkout: cobrar una sola vez sin bloquear el flujo',
      to: '/blog/chave-idempotencia-checkout-cobrar-uma-vez-sem-travar-o-fluxo',
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
