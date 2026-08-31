// Conteudo do artigo: chave de idempotencia no checkout, garantindo cobranca
// unica sem transformar a chave num bloqueio que trava o fluxo do cliente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O cliente clicou em finalizar compra, a resposta demorou, ele clicou de novo, e o extrato mostrou duas cobranças de trezentos e quarenta reais. O time colocou uma chave de idempotência, o problema da cobrança dupla acabou, e nasceu outro: a segunda requisição passou a esperar quarenta segundos pela primeira, e o cliente que desistia com duas cobranças passou a desistir com uma tela travada. Este artigo trata dos dois problemas juntos: por que a chave precisa ser gerada pelo cliente antes do primeiro envio e não pelo servidor, o que acontece quando duas requisições com a mesma chave chegam ao mesmo tempo e por que a resposta correta é um estado e não uma espera, por que a impressão digital do corpo é obrigatória para não devolver o resultado errado, como armazenar a resposta para repetir a mesma saída sem repetir o efeito, e quais testes de concorrência provam que a implementação funciona antes de o cliente descobrir.',
  sections: [
    {
      title: 'A chave nasce no cliente, antes da primeira tentativa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira decisão de projeto define se o resto funciona ou não: quem gera a chave. Se ela é gerada pelo servidor e devolvida ao cliente, a proteção só passa a valer depois que a primeira resposta chegou, e o caso que mais produz cobrança dupla é exatamente o caso em que a primeira resposta nunca chega. O cliente que perdeu a conexão no meio do envio não recebeu chave nenhuma, então a segunda tentativa dele é indistinguível de uma compra nova.',
        },
        {
          type: 'paragraph',
          value:
            'A chave tem que existir antes do primeiro byte sair do navegador. Na prática ela é criada no momento em que a tela de pagamento é montada e permanece a mesma enquanto o usuário estiver naquela tentativa de compra, sobrevivendo a um recarregamento da página se for guardada no armazenamento da sessão. Um identificador aleatório de cento e vinte e oito bits basta, e ele deve mudar apenas quando o usuário voltar e alterar algo do pedido, porque nesse momento a intenção passou a ser outra.',
        },
        {
          type: 'paragraph',
          value:
            'O erro simétrico é derivar a chave de dados do pedido, como o identificador do carrinho somado ao valor total. Parece elegante porque dispensa armazenar estado no cliente, e falha no caso legítimo em que a mesma pessoa compra o mesmo item duas vezes de propósito, num intervalo curto. Nesse cenário a segunda compra é engolida pela deduplicação, o cliente não recebe o produto e o suporte demora dias para entender o que aconteceu, porque nos registros do sistema não existe erro nenhum.',
        },
        {
          type: 'table',
          columns: [
            'Origem da chave',
            'Protege a retentativa após queda de rede?',
            'Bloqueia compra repetida legítima?',
            'Veredito',
          ],
          rows: [
            [
              'Gerada no cliente ao abrir o checkout',
              'Sim, existe antes do primeiro envio',
              'Não, muda a cada nova intenção de compra',
              'É o desenho correto',
            ],
            [
              'Gerada no servidor e devolvida na resposta',
              'Não, a resposta perdida é justamente o caso crítico',
              'Não',
              'Não resolve o problema principal',
            ],
            [
              'Derivada de carrinho mais valor total',
              'Sim',
              'Sim, engole a segunda compra idêntica',
              'Cria um bug pior que o original',
            ],
            [
              'Identificador da sessão do usuário',
              'Sim',
              'Sim, toda a sessão vira uma compra só',
              'Escopo grande demais',
            ],
            [
              'Timestamp com precisão de segundo',
              'Parcialmente, colide entre usuários',
              'Depende do relógio',
              'Colisão entre clientes distintos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quinta linha merece atenção porque o problema dela não é teórico. Uma chave que não inclui a identidade de quem paga permite que a requisição de um cliente devolva a resposta armazenada da compra de outro, e o resultado é vazamento de dado de pagamento entre contas. A chave precisa ser escopada pela identidade autenticada no servidor, nunca por um valor que veio somente do corpo da requisição.',
        },
      ],
    },
    {
      title: 'Duas requisições ao mesmo tempo: responder estado, não esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O caso interessante não é a repetição depois que a primeira terminou, esse é fácil. O caso que trava o checkout é a repetição enquanto a primeira ainda está em andamento, e ele é frequente justamente porque a lentidão é o que motiva o segundo clique. A implementação ingênua tranca a segunda requisição num bloqueio e a faz esperar pela primeira, o que transforma um problema de duplicidade num problema de latência: se a primeira demora quarenta segundos, a segunda demora quarenta segundos também, e agora existem duas conexões presas em vez de uma.',
        },
        {
          type: 'paragraph',
          value:
            'A saída é tratar a chave como um registro com estado próprio, gravado antes de qualquer efeito acontecer. A primeira requisição insere o registro com estado em andamento e segue para o processamento. A segunda tenta inserir, colide na restrição de unicidade, lê o registro existente e responde imediatamente com um código que diz ao cliente que o pedido já está sendo processado. Não há espera, não há conexão retida, e o cliente pode consultar o resultado depois em vez de segurar a linha.',
        },
        {
          type: 'diagram',
          value: `ESPERAR PELO BLOQUEIO (o que trava o checkout)

  req A  --> adquire lock --> processa 40s ---------> responde 201
  req B  --> espera lock ..........................--> responde 201
             40s de conexao presa sem fazer nada
             cliente ve tela travada, tenta de novo, req C espera tambem


RESPONDER ESTADO (o que mantem o fluxo)

  req A  --> INSERT chave (in_progress) --> processa 40s --> UPDATE
             |                                               (completed +
             |                                                resposta)
             v
  req B  --> INSERT falha na unicidade
             --> le o registro: in_progress
             --> responde 409 em 8ms com Retry-After: 2
                 cliente faz polling, nao segura conexao

  req D (depois de A terminar)
         --> INSERT falha na unicidade
             --> le o registro: completed
             --> devolve a MESMA resposta gravada, sem reprocessar`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe que costuma passar batido é que o registro da chave precisa ser gravado e confirmado antes de o efeito começar, e não junto dele. Se a inserção da chave acontece na mesma transação que cria a cobrança, ela só fica visível para outras conexões quando a transação inteira confirmar, e durante os quarenta segundos de processamento a segunda requisição não enxerga nada: ela insere com sucesso e cria a segunda cobrança. A separação em duas transações é o que torna a proteção efetiva no intervalo em que ela realmente importa.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.mjs
// A chave vira um registro com estado, gravado e CONFIRMADO antes do efeito.
// Se a insercao acontecesse na mesma transacao do pagamento, ela so ficaria
// visivel no commit, e durante o processamento a segunda requisicao nao veria
// nada: inseriria com sucesso e criaria a segunda cobranca.
//
// CREATE TABLE idempotency_keys (
//   key            text        NOT NULL,
//   subject_id     text        NOT NULL,  -- identidade AUTENTICADA, nao do corpo
//   endpoint       text        NOT NULL,  -- mesma chave em rotas diferentes e outra operacao
//   request_hash   text        NOT NULL,  -- impressao digital do corpo
//   status         text        NOT NULL,  -- in_progress | completed | failed
//   response_code  int,
//   response_body  jsonb,
//   created_at     timestamptz NOT NULL DEFAULT now(),
//   PRIMARY KEY (key, subject_id, endpoint)
// );

import { createHash } from 'node:crypto';

const IN_PROGRESS_TTL_MS = 90_000; // acima do timeout do gateway

export const fingerprint = (body) =>
  createHash('sha256')
    // Chaves ordenadas: { a, b } e { b, a } sao o mesmo pedido e precisam
    // produzir a mesma impressao digital, senao a retentativa vira conflito.
    .update(JSON.stringify(body, Object.keys(body).sort()))
    .digest('hex');

export class IdempotencyConflict extends Error {
  constructor(status, payload) {
    super('conflito de idempotencia');
    this.name = 'IdempotencyConflict';
    this.status = status;
    this.payload = payload;
  }
}

// Retorna { claimed: true } quando esta requisicao ganhou o direito de
// executar o efeito. Nos demais casos lanca com a resposta ja pronta.
export const claim = async (db, { key, subjectId, endpoint, requestHash }) => {
  const inserted = await db.query(
    \`INSERT INTO idempotency_keys (key, subject_id, endpoint, request_hash, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (key, subject_id, endpoint) DO NOTHING
     RETURNING key\`,
    [key, subjectId, endpoint, requestHash],
  );

  if (inserted.rowCount === 1) return { claimed: true };

  const [existing] = (
    await db.query(
      \`SELECT request_hash, status, response_code, response_body, created_at
       FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
      [key, subjectId, endpoint],
    )
  ).rows;

  // Mesma chave com corpo diferente e erro do cliente, nao repeticao.
  // Devolver a resposta da primeira compra aqui confirmaria um pedido que
  // o cliente nao fez.
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyConflict(422, {
      error: 'idempotency_key_reuse',
      message: 'a chave ja foi usada com um corpo diferente',
    });
  }

  if (existing.status === 'completed') {
    // Mesma saida, sem repetir o efeito.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  if (existing.status === 'failed') {
    // Falha definitiva ja registrada: repetir produziria o mesmo erro.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  const ageMs = Date.now() - new Date(existing.created_at).getTime();

  // Registro preso em andamento alem do TTL: o processo que o criou morreu
  // antes de finalizar. Liberar para uma nova tentativa em vez de deixar o
  // cliente travado para sempre.
  if (ageMs > IN_PROGRESS_TTL_MS) {
    const retaken = await db.query(
      \`UPDATE idempotency_keys
       SET created_at = now()
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3
         AND status = 'in_progress' AND created_at = $4
       RETURNING key\`,
      [key, subjectId, endpoint, existing.created_at],
    );
    if (retaken.rowCount === 1) return { claimed: true };
  }

  // Em andamento dentro do prazo: responder AGORA, sem esperar.
  throw new IdempotencyConflict(409, {
    error: 'in_progress',
    message: 'o pedido ja esta sendo processado',
    retryAfterSeconds: 2,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'A comparação da impressão digital do corpo é a parte que quase sempre falta e a que tem a pior consequência quando falta. Sem ela, um cliente que reaproveita a chave por engano, seja porque o armazenamento da sessão não foi limpo ou porque o aplicativo móvel restaurou um estado antigo, recebe como resposta a confirmação de uma compra diferente da que acabou de pedir. Ele vê um pedido confirmado, o valor não bate, e o sistema não registrou erro nenhum porque do ponto de vista dele tudo funcionou.',
        },
      ],
    },
    {
      title: 'A chave que atravessa a borda: repassar ao gateway, não recriar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Proteger a própria API é metade do caminho. A outra metade é o que acontece entre o seu servidor e o processador de pagamento, porque ali existe exatamente o mesmo problema com um agravante: quando a chamada ao gateway expira por timeout, você não sabe se a cobrança foi criada. A resposta se perdeu, mas o efeito do outro lado pode ter acontecido, e a decisão de tentar de novo é uma aposta de trezentos e quarenta reais.',
        },
        {
          type: 'paragraph',
          value:
            'Todos os gateways relevantes aceitam um cabeçalho de idempotência, e a regra é derivar esse valor de forma determinística a partir da sua chave interna, nunca gerar um novo por tentativa. Se cada retentativa envia um identificador aleatório diferente, o gateway trata cada uma como uma cobrança nova e a proteção some justamente onde o dinheiro está. A derivação determinística faz a segunda tentativa recair sobre a mesma chave e devolve a cobrança já criada em vez de criar outra.',
        },
        {
          type: 'code',
          value: `// checkout/gateway.mjs
// A chave interna atravessa a borda de forma DETERMINISTICA. Gerar um valor
// novo por tentativa faz o gateway tratar cada retentativa como uma cobranca
// nova, e a protecao desaparece justamente onde o dinheiro esta.

import { createHash } from 'node:crypto';

// Prefixo por operacao: a mesma chave interna pode originar uma autorizacao e,
// depois, uma captura. Sem o prefixo, a captura recairia sobre a chave da
// autorizacao e o gateway devolveria a autorizacao ja feita.
const gatewayKey = (internalKey, operation) =>
  createHash('sha256').update(\`\${operation}:\${internalKey}\`).digest('hex').slice(0, 40);

export const authorize = async (gateway, { internalKey, amountCents, currency, source }) => {
  const headers = { 'Idempotency-Key': gatewayKey(internalKey, 'authorize') };

  try {
    return await gateway.post('/charges', { amountCents, currency, source }, { headers });
  } catch (error) {
    // Timeout e o caso ambiguo: a cobranca pode ter sido criada do outro lado.
    // NUNCA assumir que nao foi. Repetir com a MESMA chave e seguro; repetir
    // com uma chave nova cobra duas vezes.
    if (error.code === 'ETIMEDOUT' || error.status >= 500) {
      return await gateway.post('/charges', { amountCents, currency, source }, { headers });
    }
    throw error;
  }
};

// Finalizacao: grava o resultado no registro da chave para que qualquer
// repeticao futura devolva a MESMA saida sem tocar no gateway de novo.
export const settle = async (db, { key, subjectId, endpoint, status, code, body }) => {
  await db.query(
    \`UPDATE idempotency_keys
     SET status = $4, response_code = $5, response_body = $6
     WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
    [key, subjectId, endpoint, status, code, body],
  );
};

// Uso no handler. A ordem importa: reivindicar, executar, gravar o resultado.
export const handleCheckout = async (db, gateway, request) => {
  const requestHash = fingerprint(request.body);
  const scope = {
    key: request.headers['idempotency-key'],
    subjectId: request.auth.customerId, // do token, nunca do corpo
    endpoint: 'POST /checkout',
    requestHash,
  };

  await claim(db, scope); // lanca IdempotencyConflict com a resposta pronta

  try {
    const charge = await authorize(gateway, {
      internalKey: scope.key,
      amountCents: request.body.amountCents,
      currency: request.body.currency,
      source: request.body.source,
    });

    const body = { orderId: charge.id, status: 'confirmed' };
    await settle(db, { ...scope, status: 'completed', code: 201, body });
    return { code: 201, body };
  } catch (error) {
    // Recusa do emissor e resultado definitivo: gravar como falha para que a
    // repeticao devolva a mesma recusa em vez de tentar cobrar de novo.
    if (error.declined) {
      const body = { error: 'card_declined', reason: error.reason };
      await settle(db, { ...scope, status: 'failed', code: 402, body });
      return { code: 402, body };
    }

    // Falha transitoria: apagar o registro para que a proxima tentativa do
    // cliente possa reivindicar de novo. Deixar em andamento travaria o
    // checkout ate o TTL expirar.
    await db.query(
      \`DELETE FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3 AND status = 'in_progress'\`,
      [scope.key, scope.subjectId, scope.endpoint],
    );
    throw error;
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'A distinção entre falha definitiva e falha transitória no bloco final é o que separa uma implementação usável de uma que gera chamado de suporte. Um cartão recusado é um resultado, e repetir a requisição deve devolver a mesma recusa sem uma nova tentativa de cobrança no emissor, porque tentativas repetidas em cartões recusados afetam a reputação do estabelecimento junto às bandeiras. Já uma indisponibilidade momentânea do gateway não é um resultado, e manter o registro travado nesse caso impede o cliente de tentar de novo durante o tempo inteiro do TTL.',
        },
      ],
    },
    {
      title: 'Escopo, expiração e o custo de guardar a resposta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A chave primária composta por chave, identidade e rota não é preciosismo de modelagem. O identificador do sujeito evita que a chave de um cliente devolva a resposta de outro, o que seria vazamento de dado. A rota evita que a mesma chave, reaproveitada por um aplicativo que a gera uma vez por sessão, faça um pedido de reembolso receber como resposta a confirmação da compra original. Cada componente fecha uma porta específica, e retirar qualquer um deles abre exatamente a porta correspondente.',
        },
        {
          type: 'paragraph',
          value:
            'A expiração tem dois prazos diferentes e confundi-los causa problemas opostos. O prazo do registro em andamento é curto, na casa dos noventa segundos, e existe apenas para destravar o cliente quando o processo que reivindicou a chave morreu. O prazo do registro finalizado é longo, tipicamente vinte e quatro horas, e existe para que a retentativa do aplicativo móvel que ficou offline continue encontrando a resposta gravada. Usar o prazo curto para os dois faz o cliente conseguir cobrar duas vezes com um intervalo de dois minutos.',
        },
        {
          type: 'table',
          columns: ['Decisão', 'Escolha recomendada', 'O que quebra se você errar'],
          rows: [
            [
              'Escopo da chave',
              'Chave mais identidade autenticada mais rota',
              'Resposta de um cliente devolvida para outro',
            ],
            [
              'Momento de gravar o registro',
              'Antes do efeito, em transação própria já confirmada',
              'A janela de processamento fica desprotegida',
            ],
            [
              'Prazo do estado em andamento',
              'Noventa segundos, acima do timeout do gateway',
              'Curto trava o fluxo, longo permite cobrança dupla',
            ],
            [
              'Prazo do estado finalizado',
              'Vinte e quatro horas',
              'Retentativa tardia vira uma segunda compra',
            ],
            [
              'Corpo divergente com a mesma chave',
              'Recusar com quatrocentos e vinte e dois',
              'Cliente recebe a confirmação de outro pedido',
            ],
            [
              'Chave enviada ao gateway',
              'Derivada da interna com prefixo por operação',
              'Retentativa cria uma segunda cobrança real',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Guardar o corpo da resposta tem um custo de armazenamento que costuma ser levantado como objeção e quase nunca se sustenta. Uma resposta de checkout serializada ocupa algo entre quinhentos bytes e dois quilobytes, e um sistema com cem mil pedidos por dia acumula menos de duzentos megabytes em vinte e quatro horas, que é o prazo em que a linha ainda serve para alguma coisa. A rotina de limpeza que apaga registros finalizados além do prazo cabe em uma consulta e roda em minutos, e o custo real dessa tabela é irrelevante perto do custo de um único estorno.',
        },
      ],
    },
    {
      title: 'Provar que funciona antes de o cliente descobrir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Testes sequenciais dão uma falsa sensação de cobertura porque passam mesmo quando a implementação está errada. Chamar o handler duas vezes uma depois da outra exercita o caminho em que a primeira já terminou, que é justamente o caminho fácil, e não toca no caminho concorrente, que é onde a cobrança dupla nasce. O teste que importa dispara as duas chamadas em paralelo, com a primeira segurada de propósito num ponto controlado do processamento.',
        },
        {
          type: 'paragraph',
          value:
            'São quatro asserções, e todas são consequências diretas das decisões das seções anteriores: que a chamada concorrente responde imediatamente em vez de esperar, que o gateway foi acionado exatamente uma vez, que a repetição posterior devolve o corpo idêntico ao da primeira resposta e que a mesma chave com corpo diferente é recusada em vez de confirmar um pedido que o cliente não fez.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.test.mjs
// O teste sequencial passa mesmo com a implementacao errada, porque exercita
// so o caminho em que a primeira ja terminou. O caso que gera cobranca dupla
// e o concorrente, e ele precisa de uma barreira controlada.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleCheckout, IdempotencyConflict } from './gateway.mjs';

const pedido = (overrides = {}) => ({
  headers: { 'idempotency-key': 'k-abc-123' },
  auth: { customerId: 'cus_42' },
  body: { amountCents: 34000, currency: 'BRL', source: 'tok_visa', ...overrides },
});

// Gateway que segura a primeira chamada ate ser liberado de proposito.
const gatewayComBarreira = () => {
  let liberar;
  const barreira = new Promise((resolve) => {
    liberar = resolve;
  });
  const chamadas = [];

  return {
    chamadas,
    liberar: () => liberar(),
    post: async (path, body, options) => {
      chamadas.push({ path, body, headers: options.headers });
      if (chamadas.length === 1) await barreira;
      return { id: \`ch_\${chamadas.length}\` };
    },
  };
};

test('a requisicao concorrente responde na hora e nao espera a primeira', async () => {
  const db = criarBancoDeTeste();
  const gateway = gatewayComBarreira();

  const primeira = handleCheckout(db, gateway, pedido());

  // Enquanto a primeira esta presa no gateway, a segunda chega.
  const segunda = await handleCheckout(db, gateway, pedido()).catch((error) => error);

  assert.ok(segunda instanceof IdempotencyConflict);
  assert.equal(segunda.status, 409);
  assert.equal(segunda.payload.error, 'in_progress');

  gateway.liberar();
  const resultado = await primeira;
  assert.equal(resultado.code, 201);

  // A assercao que prova a ausencia de cobranca dupla.
  assert.equal(gateway.chamadas.length, 1, 'o gateway foi acionado mais de uma vez');
});

test('a repeticao posterior devolve o corpo identico sem tocar no gateway', async () => {
  const db = criarBancoDeTeste();
  const gateway = gatewayComBarreira();
  gateway.liberar();

  const primeira = await handleCheckout(db, gateway, pedido());
  const repetida = await handleCheckout(db, gateway, pedido()).catch((error) => error);

  assert.deepEqual(repetida.payload, primeira.body);
  assert.equal(repetida.status, primeira.code);
  assert.equal(gateway.chamadas.length, 1);
});

test('a mesma chave com corpo diferente e recusada', async () => {
  const db = criarBancoDeTeste();
  const gateway = gatewayComBarreira();
  gateway.liberar();

  await handleCheckout(db, gateway, pedido());

  // Mesma chave, valor diferente: aplicativo que restaurou um estado antigo.
  // Devolver a resposta da primeira compra confirmaria um pedido inexistente.
  const conflito = await handleCheckout(db, gateway, pedido({ amountCents: 99900 })).catch(
    (error) => error,
  );

  assert.equal(conflito.status, 422);
  assert.equal(conflito.payload.error, 'idempotency_key_reuse');
  assert.equal(gateway.chamadas.length, 1);
});`,
        },
        {
          type: 'ordered',
          items: [
            'Gere a chave no cliente ao montar a tela de pagamento e mantenha o mesmo valor enquanto o pedido não mudar, guardando no armazenamento da sessão para sobreviver a recarregamento.',
            'Crie a tabela com chave primária composta por chave, identidade autenticada e rota, e grave a impressão digital do corpo junto do registro.',
            'Reivindique a chave em uma transação própria já confirmada antes de iniciar o efeito, nunca dentro da transação que cria a cobrança.',
            'Responda quatrocentos e nove com indicação de espera para a requisição concorrente, sem bloquear, e ajuste o cliente para consultar o resultado em vez de segurar a conexão.',
            'Derive a chave enviada ao gateway da chave interna com um prefixo por operação, e repita com o mesmo valor em caso de timeout ou erro do servidor.',
            'Separe os prazos de expiração em andamento e finalizado, e cubra a implementação com o teste concorrente que conta quantas vezes o gateway foi acionado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A contagem de chamadas ao gateway é a asserção mais valiosa do conjunto porque é a única que mede o efeito real em vez do formato da resposta. Uma implementação com o registro gravado na transação errada devolve exatamente os mesmos códigos e os mesmos corpos que a implementação correta, e passa em qualquer teste que só verifique a saída. Ela só se distingue pelo número de cobranças criadas, que é precisamente o que o cliente vê no extrato.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'A chave de idempotência substitui o tratamento de webhook do gateway?',
      answer:
        'Não, os dois resolvem problemas diferentes e um sistema de pagamento sério precisa dos dois. A chave de idempotência protege a direção de saída, que é a sua aplicação chamando o gateway, e responde à pergunta de quantas cobranças foram criadas quando o cliente clicou duas vezes ou a rede caiu no meio. O tratamento idempotente de webhook protege a direção de entrada, que é o gateway notificando a sua aplicação, e responde à pergunta de quantas vezes você creditou o pedido quando o provedor entregou o mesmo evento três vezes, o que é o comportamento normal de qualquer entrega com garantia de pelo menos uma vez. São caminhos distintos, com tabelas distintas e chaves derivadas de forma distinta: no checkout a chave vem do cliente antes da tentativa, no webhook ela é derivada do recurso, da transição de estado e da referência externa, porque ali quem gera o evento é o provedor. Confundir os dois costuma produzir um sistema que não cobra duas vezes mas credita três, ou o contrário, e nos dois casos o sintoma que chega ao suporte é o mesmo: o valor no extrato não bate com o pedido.',
    },
    {
      question: 'O que fazer quando o gateway responde com timeout e não se sabe se a cobrança existe?',
      answer:
        'Repetir a chamada com exatamente a mesma chave de idempotência, e essa é a única ação segura das três possíveis. Assumir que a cobrança não existe e criar outra sem a chave produz cobrança dupla quando ela existia, e assumir que existe e confirmar o pedido para o cliente entrega o produto sem receber quando ela não existia. Com a mesma chave, o gateway devolve a cobrança já criada se ela existir e cria uma nova se não existir, e nos dois casos o resultado final é uma cobrança só. É por isso que a derivação determinística da chave importa tanto: se cada retentativa gerar um identificador novo, essa propriedade desaparece justamente no momento em que ela é necessária. Quando o timeout se repete e não é possível concluir a chamada, a decisão correta é deixar o pedido em um estado explícito de aguardando confirmação, com uma tarefa em segundo plano que consulta o gateway pela chave até obter uma resposta definitiva, e comunicar isso ao cliente. Confirmar um pedido cujo pagamento você não conseguiu verificar transfere o risco para a operação, e reverter isso depois custa mais que a espera de alguns minutos.',
    },
    {
      question: 'Devolver quatrocentos e nove na requisição concorrente não piora a experiência do usuário?',
      answer:
        'Piora se o cliente exibir o código bruto ao usuário, e melhora bastante se ele tratar o estado como o que é. O contraste correto não é entre um erro e um sucesso, é entre uma resposta imediata que diz que o pedido está sendo processado e uma tela congelada por quarenta segundos sem nenhuma informação, que é o que a espera pelo bloqueio produz. Com a resposta de estado, a interface mostra que o pagamento está em andamento, desabilita o botão e passa a consultar o resultado a cada dois segundos, o que é exatamente o que uma barra de progresso honesta faria. Do lado do servidor o ganho é maior ainda: nenhuma conexão fica retida esperando outra terminar, o pool não satura quando o gateway degrada, e o segundo clique do usuário deixa de ser um multiplicador de carga. Vale notar que alguns times preferem devolver duzentos e dois com o mesmo corpo de estado em vez de quatrocentos e nove, e isso é uma escolha de contrato legítima desde que o cliente saiba distinguir uma resposta de aceitação de uma resposta de conclusão. O que não funciona é qualquer desenho em que a segunda requisição fique esperando a primeira.',
    },
  ],
  conclusion: {
    title: 'Cobrar uma vez só não pode custar quarenta segundos de tela travada',
    description:
      'A chave de idempotência resolve a cobrança dupla e, mal implementada, cria um problema de latência no lugar dela. A diferença está em tratar a chave como um registro com estado, gravado antes do efeito e respondido de imediato, em vez de um bloqueio que faz a segunda requisição esperar pela primeira. Posso desenhar o escopo e os prazos da tabela de chaves no seu checkout, separar a reivindicação do efeito nas transações certas, derivar a chave que atravessa a borda até o gateway, ajustar o cliente para consultar o estado em vez de segurar a conexão e deixar o teste concorrente que conta as chamadas ao gateway rodando no seu pipeline.',
    cta: 'Falar sobre a idempotência do meu checkout',
  },
  related: [
    {
      label: 'Chave de idempotência em webhook de pagamento: cobrar uma vez só',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'Idempotência em tool use: evitar ação duplicada do agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The customer clicked to finish the purchase, the response took a while, they clicked again, and the statement showed two charges of three hundred and forty. The team added an idempotency key, the double charge problem went away, and another one was born: the second request started waiting forty seconds for the first one, and the customer who used to give up with two charges now gives up staring at a frozen screen. This article covers both problems together: why the key has to be generated by the client before the first send and not by the server, what happens when two requests carrying the same key arrive at the same time and why the right answer is a state rather than a wait, why the request body fingerprint is mandatory to avoid returning the wrong result, how to store the response so a repeat returns the same output without repeating the effect, and which concurrency tests prove the implementation works before the customer finds out.',
  sections: [
    {
      title: 'The key is born on the client, before the first attempt',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first design decision determines whether the rest works at all: who generates the key. If the server generates it and returns it to the client, the protection only starts applying after the first response has arrived, and the case that produces the most double charges is exactly the case where the first response never arrives. A client that lost the connection mid send received no key at all, so their second attempt is indistinguishable from a brand new purchase.',
        },
        {
          type: 'paragraph',
          value:
            'The key has to exist before the first byte leaves the browser. In practice it is created the moment the payment screen mounts and stays the same for as long as the user is on that purchase attempt, surviving a page reload if it is kept in session storage. A random one hundred and twenty-eight bit identifier is enough, and it should only change when the user goes back and modifies something in the order, because at that point the intent has become a different one.',
        },
        {
          type: 'paragraph',
          value:
            'The symmetric mistake is deriving the key from order data, such as the cart identifier plus the total amount. It looks elegant because it avoids storing state on the client, and it fails in the legitimate case where the same person deliberately buys the same item twice within a short interval. In that scenario the second purchase is swallowed by deduplication, the customer never gets the product, and support takes days to work out what happened, because there is no error anywhere in the system logs.',
        },
        {
          type: 'table',
          columns: [
            'Key origin',
            'Protects retries after a network drop?',
            'Blocks a legitimate repeat purchase?',
            'Verdict',
          ],
          rows: [
            [
              'Generated on the client when checkout opens',
              'Yes, it exists before the first send',
              'No, it changes with each new purchase intent',
              'This is the correct design',
            ],
            [
              'Generated on the server and returned in the response',
              'No, the lost response is precisely the critical case',
              'No',
              'Does not solve the main problem',
            ],
            [
              'Derived from cart plus total amount',
              'Yes',
              'Yes, it swallows the second identical purchase',
              'Creates a worse bug than the original',
            ],
            [
              'The user session identifier',
              'Yes',
              'Yes, the whole session becomes one purchase',
              'Scope far too broad',
            ],
            [
              'Timestamp at one second precision',
              'Partially, it collides across users',
              'Depends on the clock',
              'Collisions between distinct customers',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth row deserves attention because its problem is not theoretical. A key that does not include the identity of the payer allows one customer request to return the stored response from another customer purchase, and the result is payment data leaking across accounts. The key has to be scoped by the identity authenticated on the server, never by a value that came only from the request body.',
        },
      ],
    },
    {
      title: 'Two requests at once: answer with state, do not wait',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The interesting case is not the repeat after the first one finished, that one is easy. The case that freezes checkout is the repeat while the first is still running, and it is frequent precisely because slowness is what motivates the second click. The naive implementation locks the second request and makes it wait for the first, which turns a duplication problem into a latency problem: if the first takes forty seconds, the second takes forty seconds too, and now there are two connections stuck instead of one.',
        },
        {
          type: 'paragraph',
          value:
            'The way out is to treat the key as a record with its own state, written before any effect happens. The first request inserts the record in the in progress state and moves on to processing. The second tries to insert, collides with the uniqueness constraint, reads the existing record and answers immediately with a code telling the client the order is already being processed. There is no wait, no connection held, and the client can check the result later instead of holding the line open.',
        },
        {
          type: 'diagram',
          value: `WAITING ON THE LOCK (what freezes checkout)

  req A  --> acquires lock --> processes 40s --------> answers 201
  req B  --> waits on lock ........................--> answers 201
             40s of connection held doing nothing
             customer sees a frozen screen, retries, req C waits too


ANSWERING WITH STATE (what keeps the flow going)

  req A  --> INSERT key (in_progress) --> processes 40s --> UPDATE
             |                                              (completed +
             |                                               response)
             v
  req B  --> INSERT fails on uniqueness
             --> reads the record: in_progress
             --> answers 409 in 8ms with Retry-After: 2
                 client polls, holds no connection

  req D (after A has finished)
         --> INSERT fails on uniqueness
             --> reads the record: completed
             --> returns the SAME stored response, no reprocessing`,
        },
        {
          type: 'paragraph',
          value:
            'The detail that usually goes unnoticed is that the key record has to be written and committed before the effect starts, not alongside it. If the key insert happens in the same transaction that creates the charge, it only becomes visible to other connections when the whole transaction commits, and during the forty seconds of processing the second request sees nothing: it inserts successfully and creates the second charge. Splitting this into two transactions is what makes the protection effective in the very window where it matters.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.mjs
// The key becomes a record with state, written and COMMITTED before the
// effect. If the insert happened in the same transaction as the payment, it
// would only be visible at commit time, and during processing the second
// request would see nothing: it would insert fine and create a second charge.
//
// CREATE TABLE idempotency_keys (
//   key            text        NOT NULL,
//   subject_id     text        NOT NULL,  -- AUTHENTICATED identity, not from the body
//   endpoint       text        NOT NULL,  -- same key on another route is another operation
//   request_hash   text        NOT NULL,  -- request body fingerprint
//   status         text        NOT NULL,  -- in_progress | completed | failed
//   response_code  int,
//   response_body  jsonb,
//   created_at     timestamptz NOT NULL DEFAULT now(),
//   PRIMARY KEY (key, subject_id, endpoint)
// );

import { createHash } from 'node:crypto';

const IN_PROGRESS_TTL_MS = 90_000; // above the gateway timeout

export const fingerprint = (body) =>
  createHash('sha256')
    // Sorted keys: { a, b } and { b, a } are the same order and must produce
    // the same fingerprint, otherwise a retry turns into a conflict.
    .update(JSON.stringify(body, Object.keys(body).sort()))
    .digest('hex');

export class IdempotencyConflict extends Error {
  constructor(status, payload) {
    super('idempotency conflict');
    this.name = 'IdempotencyConflict';
    this.status = status;
    this.payload = payload;
  }
}

// Returns { claimed: true } when this request won the right to run the effect.
// In every other case it throws with the response already prepared.
export const claim = async (db, { key, subjectId, endpoint, requestHash }) => {
  const inserted = await db.query(
    \`INSERT INTO idempotency_keys (key, subject_id, endpoint, request_hash, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (key, subject_id, endpoint) DO NOTHING
     RETURNING key\`,
    [key, subjectId, endpoint, requestHash],
  );

  if (inserted.rowCount === 1) return { claimed: true };

  const [existing] = (
    await db.query(
      \`SELECT request_hash, status, response_code, response_body, created_at
       FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
      [key, subjectId, endpoint],
    )
  ).rows;

  // Same key with a different body is a client error, not a repeat.
  // Returning the first purchase response here would confirm an order the
  // customer never placed.
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyConflict(422, {
      error: 'idempotency_key_reuse',
      message: 'the key was already used with a different body',
    });
  }

  if (existing.status === 'completed') {
    // Same output, without repeating the effect.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  if (existing.status === 'failed') {
    // A definitive failure is already recorded: repeating yields the same error.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  const ageMs = Date.now() - new Date(existing.created_at).getTime();

  // Record stuck in progress past the TTL: the process that created it died
  // before finishing. Release it for a new attempt instead of leaving the
  // customer stuck forever.
  if (ageMs > IN_PROGRESS_TTL_MS) {
    const retaken = await db.query(
      \`UPDATE idempotency_keys
       SET created_at = now()
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3
         AND status = 'in_progress' AND created_at = $4
       RETURNING key\`,
      [key, subjectId, endpoint, existing.created_at],
    );
    if (retaken.rowCount === 1) return { claimed: true };
  }

  // In progress within the deadline: answer NOW, do not wait.
  throw new IdempotencyConflict(409, {
    error: 'in_progress',
    message: 'the order is already being processed',
    retryAfterSeconds: 2,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'Comparing the body fingerprint is the part that is almost always missing and the one with the worst consequence when it is. Without it, a client that reuses the key by mistake, whether because session storage was not cleared or because the mobile app restored an old state, gets back the confirmation of a purchase different from the one it just requested. They see a confirmed order, the amount does not match, and the system logged no error at all because from its point of view everything worked.',
        },
      ],
    },
    {
      title: 'The key that crosses the boundary: forward it to the gateway, do not recreate it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Protecting your own API is half the way. The other half is what happens between your server and the payment processor, because the exact same problem exists there with an aggravating factor: when the gateway call times out, you do not know whether the charge was created. The response was lost, but the effect on the other side may well have happened, and deciding to retry is a three hundred and forty unit bet.',
        },
        {
          type: 'paragraph',
          value:
            'Every relevant gateway accepts an idempotency header, and the rule is to derive that value deterministically from your internal key, never to generate a new one per attempt. If each retry sends a different random identifier, the gateway treats each one as a new charge and the protection vanishes exactly where the money is. Deterministic derivation makes the second attempt land on the same key and returns the charge that was already created instead of creating another one.',
        },
        {
          type: 'code',
          value: `// checkout/gateway.mjs
// The internal key crosses the boundary DETERMINISTICALLY. Generating a new
// value per attempt makes the gateway treat every retry as a new charge, and
// the protection disappears exactly where the money is.

import { createHash } from 'node:crypto';

// Prefix per operation: the same internal key may originate an authorization
// and, later, a capture. Without the prefix, the capture would land on the
// authorization key and the gateway would return the authorization instead.
const gatewayKey = (internalKey, operation) =>
  createHash('sha256').update(\`\${operation}:\${internalKey}\`).digest('hex').slice(0, 40);

export const authorize = async (gateway, { internalKey, amountCents, currency, source }) => {
  const headers = { 'Idempotency-Key': gatewayKey(internalKey, 'authorize') };

  try {
    return await gateway.post('/charges', { amountCents, currency, source }, { headers });
  } catch (error) {
    // A timeout is the ambiguous case: the charge may exist on the other side.
    // NEVER assume it does not. Retrying with the SAME key is safe; retrying
    // with a new key charges twice.
    if (error.code === 'ETIMEDOUT' || error.status >= 500) {
      return await gateway.post('/charges', { amountCents, currency, source }, { headers });
    }
    throw error;
  }
};

// Settlement: records the outcome on the key row so any future repeat returns
// the SAME output without touching the gateway again.
export const settle = async (db, { key, subjectId, endpoint, status, code, body }) => {
  await db.query(
    \`UPDATE idempotency_keys
     SET status = $4, response_code = $5, response_body = $6
     WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
    [key, subjectId, endpoint, status, code, body],
  );
};

// Handler usage. The order matters: claim, execute, record the outcome.
export const handleCheckout = async (db, gateway, request) => {
  const requestHash = fingerprint(request.body);
  const scope = {
    key: request.headers['idempotency-key'],
    subjectId: request.auth.customerId, // from the token, never from the body
    endpoint: 'POST /checkout',
    requestHash,
  };

  await claim(db, scope); // throws IdempotencyConflict with the response ready

  try {
    const charge = await authorize(gateway, {
      internalKey: scope.key,
      amountCents: request.body.amountCents,
      currency: request.body.currency,
      source: request.body.source,
    });

    const body = { orderId: charge.id, status: 'confirmed' };
    await settle(db, { ...scope, status: 'completed', code: 201, body });
    return { code: 201, body };
  } catch (error) {
    // An issuer decline is a definitive outcome: record it as failed so the
    // repeat returns the same decline instead of charging again.
    if (error.declined) {
      const body = { error: 'card_declined', reason: error.reason };
      await settle(db, { ...scope, status: 'failed', code: 402, body });
      return { code: 402, body };
    }

    // Transient failure: delete the record so the customer next attempt can
    // claim again. Leaving it in progress would freeze checkout until the
    // TTL expires.
    await db.query(
      \`DELETE FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3 AND status = 'in_progress'\`,
      [scope.key, scope.subjectId, scope.endpoint],
    );
    throw error;
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'The distinction between a definitive and a transient failure in the final block is what separates a usable implementation from one that generates support tickets. A declined card is an outcome, and repeating the request should return the same decline without a new charge attempt at the issuer, because repeated attempts on declined cards affect the merchant standing with the card networks. A momentary gateway outage, on the other hand, is not an outcome, and keeping the record locked in that case prevents the customer from retrying for the whole TTL.',
        },
      ],
    },
    {
      title: 'Scope, expiry and the cost of storing the response',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primary key composed of key, identity and route is not modeling perfectionism. The subject identifier prevents one customer key from returning another customer response, which would be a data leak. The route prevents the same key, reused by an app that generates it once per session, from making a refund request receive the original purchase confirmation as its answer. Each component closes a specific door, and removing any of them opens exactly the matching one.',
        },
        {
          type: 'paragraph',
          value:
            'Expiry has two different deadlines and confusing them causes opposite problems. The in progress deadline is short, around ninety seconds, and exists only to unfreeze the customer when the process that claimed the key died. The settled record deadline is long, typically twenty-four hours, and exists so the retry from a mobile app that went offline still finds the stored response. Using the short deadline for both lets a customer be charged twice two minutes apart.',
        },
        {
          type: 'table',
          columns: ['Decision', 'Recommended choice', 'What breaks if you get it wrong'],
          rows: [
            [
              'Key scope',
              'Key plus authenticated identity plus route',
              'One customer response returned to another',
            ],
            [
              'When to write the record',
              'Before the effect, in its own already committed transaction',
              'The processing window is left unprotected',
            ],
            [
              'In progress deadline',
              'Ninety seconds, above the gateway timeout',
              'Too short freezes the flow, too long allows a double charge',
            ],
            [
              'Settled record deadline',
              'Twenty-four hours',
              'A late retry becomes a second purchase',
            ],
            [
              'Divergent body under the same key',
              'Refuse with four hundred and twenty-two',
              'Customer receives the confirmation of a different order',
            ],
            [
              'Key sent to the gateway',
              'Derived from the internal one with a per operation prefix',
              'A retry creates a second real charge',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Storing the response body has a storage cost that is often raised as an objection and almost never holds up. A serialized checkout response takes between five hundred bytes and two kilobytes, and a system handling one hundred thousand orders a day accumulates less than two hundred megabytes over the twenty-four hours in which the row is still useful for anything. The cleanup routine that deletes settled records past the deadline fits in a single query and runs in minutes, and the real cost of that table is negligible next to the cost of a single chargeback.',
        },
      ],
    },
    {
      title: 'Prove it works before the customer finds out',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sequential tests give a false sense of coverage because they pass even when the implementation is wrong. Calling the handler twice one after the other exercises the path where the first has already finished, which is precisely the easy path, and never touches the concurrent path, which is where the double charge is born. The test that matters fires both calls in parallel, with the first one deliberately held at a controlled point in the processing.',
        },
        {
          type: 'paragraph',
          value:
            'There are four assertions, and all of them are direct consequences of the decisions in the previous sections: that the concurrent call answers immediately instead of waiting, that the gateway was called exactly once, that a later repeat returns a body identical to the first response, and that the same key with a different body is refused instead of confirming an order the customer never placed.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.test.mjs
// A sequential test passes even with a wrong implementation, because it only
// exercises the path where the first call already finished. The case that
// creates a double charge is the concurrent one, and it needs a barrier.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleCheckout, IdempotencyConflict } from './gateway.mjs';

const order = (overrides = {}) => ({
  headers: { 'idempotency-key': 'k-abc-123' },
  auth: { customerId: 'cus_42' },
  body: { amountCents: 34000, currency: 'BRL', source: 'tok_visa', ...overrides },
});

// A gateway that holds the first call until deliberately released.
const gatewayWithBarrier = () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];

  return {
    calls,
    release: () => release(),
    post: async (path, body, options) => {
      calls.push({ path, body, headers: options.headers });
      if (calls.length === 1) await barrier;
      return { id: \`ch_\${calls.length}\` };
    },
  };
};

test('the concurrent request answers right away and does not wait', async () => {
  const db = createTestDatabase();
  const gateway = gatewayWithBarrier();

  const first = handleCheckout(db, gateway, order());

  // While the first is stuck at the gateway, the second arrives.
  const second = await handleCheckout(db, gateway, order()).catch((error) => error);

  assert.ok(second instanceof IdempotencyConflict);
  assert.equal(second.status, 409);
  assert.equal(second.payload.error, 'in_progress');

  gateway.release();
  const result = await first;
  assert.equal(result.code, 201);

  // The assertion that proves there is no double charge.
  assert.equal(gateway.calls.length, 1, 'the gateway was called more than once');
});

test('a later repeat returns an identical body without touching the gateway', async () => {
  const db = createTestDatabase();
  const gateway = gatewayWithBarrier();
  gateway.release();

  const first = await handleCheckout(db, gateway, order());
  const repeated = await handleCheckout(db, gateway, order()).catch((error) => error);

  assert.deepEqual(repeated.payload, first.body);
  assert.equal(repeated.status, first.code);
  assert.equal(gateway.calls.length, 1);
});

test('the same key with a different body is refused', async () => {
  const db = createTestDatabase();
  const gateway = gatewayWithBarrier();
  gateway.release();

  await handleCheckout(db, gateway, order());

  // Same key, different amount: an app that restored an old state. Returning
  // the first purchase response would confirm an order that does not exist.
  const conflict = await handleCheckout(db, gateway, order({ amountCents: 99900 })).catch(
    (error) => error,
  );

  assert.equal(conflict.status, 422);
  assert.equal(conflict.payload.error, 'idempotency_key_reuse');
  assert.equal(gateway.calls.length, 1);
});`,
        },
        {
          type: 'ordered',
          items: [
            'Generate the key on the client when the payment screen mounts and keep the same value while the order does not change, storing it in session storage so it survives a reload.',
            'Create the table with a primary key composed of key, authenticated identity and route, and store the request body fingerprint alongside the record.',
            'Claim the key in its own already committed transaction before starting the effect, never inside the transaction that creates the charge.',
            'Answer four hundred and nine with a retry hint for the concurrent request, without blocking, and adjust the client to poll for the result instead of holding the connection.',
            'Derive the key sent to the gateway from the internal one with a per operation prefix, and retry with the same value on timeouts or server errors.',
            'Split the in progress and settled expiry deadlines, and cover the implementation with the concurrent test that counts how many times the gateway was called.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Counting gateway calls is the most valuable assertion of the set because it is the only one measuring the real effect rather than the response shape. An implementation with the record written in the wrong transaction returns exactly the same codes and the same bodies as the correct one, and passes any test that only checks the output. It is distinguishable only by the number of charges created, which is precisely what the customer sees on their statement.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does the idempotency key replace idempotent handling of gateway webhooks?',
      answer:
        'No, the two solve different problems and a serious payment system needs both. The idempotency key protects the outbound direction, which is your application calling the gateway, and answers the question of how many charges were created when the customer clicked twice or the network dropped mid call. Idempotent webhook handling protects the inbound direction, which is the gateway notifying your application, and answers the question of how many times you credited the order when the provider delivered the same event three times, which is the normal behavior of any at-least-once delivery. They are distinct paths, with distinct tables and keys derived in distinct ways: at checkout the key comes from the client before the attempt, in the webhook it is derived from the resource, the state transition and the external reference, because there the event is generated by the provider. Confusing the two usually produces a system that does not charge twice but credits three times, or the other way around, and in both cases the symptom that reaches support is the same: the amount on the statement does not match the order.',
    },
    {
      question: 'What do you do when the gateway times out and you do not know whether the charge exists?',
      answer:
        'Retry the call with exactly the same idempotency key, and that is the only safe action of the three available. Assuming the charge does not exist and creating another one without the key produces a double charge when it did exist, and assuming it does exist and confirming the order to the customer delivers the product without getting paid when it did not. With the same key, the gateway returns the already created charge if it exists and creates a new one if it does not, and in both cases the end result is a single charge. That is exactly why deterministic key derivation matters so much: if every retry generated a new identifier, that property would disappear precisely when it is needed. When the timeout repeats and the call cannot be completed, the correct decision is to leave the order in an explicit awaiting confirmation state, with a background task querying the gateway by that key until it gets a definitive answer, and to communicate that to the customer. Confirming an order whose payment you could not verify transfers the risk to operations, and reversing that later costs more than a few minutes of waiting.',
    },
    {
      question: 'Does returning four hundred and nine on the concurrent request not hurt the user experience?',
      answer:
        'It hurts if the client shows the raw status code to the user, and it improves things considerably if the client treats the state as what it is. The right contrast is not between an error and a success, it is between an immediate response saying the order is being processed and a screen frozen for forty seconds with no information at all, which is what waiting on the lock produces. With the state response, the interface shows the payment is in progress, disables the button and starts polling for the result every couple of seconds, which is exactly what an honest progress indicator would do. On the server side the gain is even larger: no connection is held waiting for another to finish, the pool does not saturate when the gateway degrades, and the user second click stops being a load multiplier. It is worth noting that some teams prefer to return two hundred and two with the same state body instead of four hundred and nine, and that is a legitimate contract choice as long as the client can tell an acceptance response apart from a completion response. What does not work is any design where the second request waits for the first.',
    },
  ],
  conclusion: {
    title: 'Charging exactly once cannot cost forty seconds of frozen screen',
    description:
      'The idempotency key solves the double charge and, badly implemented, creates a latency problem in its place. The difference lies in treating the key as a record with state, written before the effect and answered immediately, rather than as a lock that makes the second request wait for the first. I can design the scope and deadlines of the key table in your checkout, split the claim from the effect across the right transactions, derive the key that crosses the boundary to the gateway, adjust the client to poll for state instead of holding the connection and leave the concurrent test that counts gateway calls running in your pipeline.',
    cta: 'Talk about idempotency in my checkout',
  },
  related: [
    {
      label: 'Idempotency key in payment webhooks: charging exactly once',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'Idempotency in tool use: preventing duplicate agent actions',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El cliente hizo clic en finalizar compra, la respuesta tardó, volvió a hacer clic, y el extracto mostró dos cobros de trescientos cuarenta. El equipo puso una clave de idempotencia, el problema del cobro duplicado desapareció, y nació otro: la segunda petición pasó a esperar cuarenta segundos por la primera, y el cliente que antes abandonaba con dos cobros ahora abandona frente a una pantalla congelada. Este artículo cubre los dos problemas juntos: por qué la clave tiene que generarla el cliente antes del primer envío y no el servidor, qué pasa cuando dos peticiones con la misma clave llegan al mismo tiempo y por qué la respuesta correcta es un estado y no una espera, por qué la huella digital del cuerpo es obligatoria para no devolver el resultado equivocado, cómo almacenar la respuesta para repetir la misma salida sin repetir el efecto, y qué pruebas de concurrencia demuestran que la implementación funciona antes de que el cliente lo descubra.',
  sections: [
    {
      title: 'La clave nace en el cliente, antes del primer intento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera decisión de diseño determina si el resto funciona o no: quién genera la clave. Si la genera el servidor y la devuelve al cliente, la protección solo empieza a valer después de que llegó la primera respuesta, y el caso que más cobros duplicados produce es exactamente aquel en que la primera respuesta nunca llega. El cliente que perdió la conexión a mitad del envío no recibió ninguna clave, así que su segundo intento es indistinguible de una compra nueva.',
        },
        {
          type: 'paragraph',
          value:
            'La clave tiene que existir antes de que salga el primer byte del navegador. En la práctica se crea en el momento en que se monta la pantalla de pago y permanece igual mientras el usuario siga en ese intento de compra, sobreviviendo a una recarga de la página si se guarda en el almacenamiento de sesión. Un identificador aleatorio de ciento veintiocho bits alcanza, y solo debería cambiar cuando el usuario vuelva atrás y modifique algo del pedido, porque en ese momento la intención pasó a ser otra.',
        },
        {
          type: 'paragraph',
          value:
            'El error simétrico es derivar la clave de datos del pedido, como el identificador del carrito sumado al monto total. Parece elegante porque evita guardar estado en el cliente, y falla en el caso legítimo en que la misma persona compra el mismo artículo dos veces a propósito, en un intervalo corto. En ese escenario la segunda compra queda absorbida por la deduplicación, el cliente nunca recibe el producto y soporte tarda días en entender qué pasó, porque en los registros del sistema no hay ningún error.',
        },
        {
          type: 'table',
          columns: [
            'Origen de la clave',
            '¿Protege el reintento tras una caída de red?',
            '¿Bloquea una compra repetida legítima?',
            'Veredicto',
          ],
          rows: [
            [
              'Generada en el cliente al abrir el checkout',
              'Sí, existe antes del primer envío',
              'No, cambia con cada nueva intención de compra',
              'Es el diseño correcto',
            ],
            [
              'Generada en el servidor y devuelta en la respuesta',
              'No, la respuesta perdida es justo el caso crítico',
              'No',
              'No resuelve el problema principal',
            ],
            [
              'Derivada de carrito más monto total',
              'Sí',
              'Sí, absorbe la segunda compra idéntica',
              'Crea un bug peor que el original',
            ],
            [
              'Identificador de la sesión del usuario',
              'Sí',
              'Sí, toda la sesión se vuelve una sola compra',
              'Alcance demasiado amplio',
            ],
            [
              'Marca de tiempo con precisión de segundo',
              'Parcialmente, colisiona entre usuarios',
              'Depende del reloj',
              'Colisión entre clientes distintos',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La quinta fila merece atención porque su problema no es teórico. Una clave que no incluye la identidad de quien paga permite que la petición de un cliente devuelva la respuesta almacenada de la compra de otro, y el resultado es una fuga de datos de pago entre cuentas. La clave tiene que estar acotada por la identidad autenticada en el servidor, nunca por un valor que vino solo del cuerpo de la petición.',
        },
      ],
    },
    {
      title: 'Dos peticiones a la vez: responder estado, no esperar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El caso interesante no es la repetición después de que la primera terminó, ese es fácil. El caso que congela el checkout es la repetición mientras la primera todavía está en curso, y es frecuente justamente porque la lentitud es lo que motiva el segundo clic. La implementación ingenua encierra la segunda petición en un bloqueo y la hace esperar a la primera, lo que convierte un problema de duplicidad en un problema de latencia: si la primera tarda cuarenta segundos, la segunda tarda cuarenta segundos también, y ahora hay dos conexiones retenidas en lugar de una.',
        },
        {
          type: 'paragraph',
          value:
            'La salida es tratar la clave como un registro con estado propio, escrito antes de que ocurra cualquier efecto. La primera petición inserta el registro en estado en curso y sigue con el procesamiento. La segunda intenta insertar, choca con la restricción de unicidad, lee el registro existente y responde de inmediato con un código que le dice al cliente que el pedido ya se está procesando. No hay espera, no hay conexión retenida, y el cliente puede consultar el resultado después en lugar de mantener la línea abierta.',
        },
        {
          type: 'diagram',
          value: `ESPERAR EL BLOQUEO (lo que congela el checkout)

  pet A  --> toma el lock --> procesa 40s -----------> responde 201
  pet B  --> espera el lock .......................--> responde 201
             40s de conexion retenida sin hacer nada
             el cliente ve pantalla congelada, reintenta, pet C tambien espera


RESPONDER ESTADO (lo que mantiene el flujo)

  pet A  --> INSERT clave (in_progress) --> procesa 40s --> UPDATE
             |                                              (completed +
             |                                               respuesta)
             v
  pet B  --> INSERT falla por unicidad
             --> lee el registro: in_progress
             --> responde 409 en 8ms con Retry-After: 2
                 el cliente hace polling, no retiene conexion

  pet D (despues de que A termino)
         --> INSERT falla por unicidad
             --> lee el registro: completed
             --> devuelve la MISMA respuesta guardada, sin reprocesar`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle que suele pasar desapercibido es que el registro de la clave tiene que escribirse y confirmarse antes de que empiece el efecto, y no junto con él. Si la inserción de la clave ocurre en la misma transacción que crea el cobro, solo se vuelve visible para otras conexiones cuando la transacción entera confirma, y durante los cuarenta segundos de procesamiento la segunda petición no ve nada: inserta con éxito y crea el segundo cobro. Separarlo en dos transacciones es lo que vuelve efectiva la protección en la ventana donde realmente importa.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.mjs
// La clave se vuelve un registro con estado, escrito y CONFIRMADO antes del
// efecto. Si la insercion ocurriera en la misma transaccion del pago, solo
// seria visible al confirmar, y durante el procesamiento la segunda peticion
// no veria nada: insertaria con exito y crearia el segundo cobro.
//
// CREATE TABLE idempotency_keys (
//   key            text        NOT NULL,
//   subject_id     text        NOT NULL,  -- identidad AUTENTICADA, no del cuerpo
//   endpoint       text        NOT NULL,  -- la misma clave en otra ruta es otra operacion
//   request_hash   text        NOT NULL,  -- huella digital del cuerpo
//   status         text        NOT NULL,  -- in_progress | completed | failed
//   response_code  int,
//   response_body  jsonb,
//   created_at     timestamptz NOT NULL DEFAULT now(),
//   PRIMARY KEY (key, subject_id, endpoint)
// );

import { createHash } from 'node:crypto';

const IN_PROGRESS_TTL_MS = 90_000; // por encima del timeout del gateway

export const fingerprint = (body) =>
  createHash('sha256')
    // Claves ordenadas: { a, b } y { b, a } son el mismo pedido y tienen que
    // producir la misma huella, o el reintento se vuelve un conflicto.
    .update(JSON.stringify(body, Object.keys(body).sort()))
    .digest('hex');

export class IdempotencyConflict extends Error {
  constructor(status, payload) {
    super('conflicto de idempotencia');
    this.name = 'IdempotencyConflict';
    this.status = status;
    this.payload = payload;
  }
}

// Devuelve { claimed: true } cuando esta peticion gano el derecho de ejecutar
// el efecto. En los demas casos lanza con la respuesta ya lista.
export const claim = async (db, { key, subjectId, endpoint, requestHash }) => {
  const inserted = await db.query(
    \`INSERT INTO idempotency_keys (key, subject_id, endpoint, request_hash, status)
     VALUES ($1, $2, $3, $4, 'in_progress')
     ON CONFLICT (key, subject_id, endpoint) DO NOTHING
     RETURNING key\`,
    [key, subjectId, endpoint, requestHash],
  );

  if (inserted.rowCount === 1) return { claimed: true };

  const [existing] = (
    await db.query(
      \`SELECT request_hash, status, response_code, response_body, created_at
       FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
      [key, subjectId, endpoint],
    )
  ).rows;

  // Misma clave con cuerpo distinto es error del cliente, no repeticion.
  // Devolver aqui la respuesta de la primera compra confirmaria un pedido
  // que el cliente nunca hizo.
  if (existing.request_hash !== requestHash) {
    throw new IdempotencyConflict(422, {
      error: 'idempotency_key_reuse',
      message: 'la clave ya fue usada con un cuerpo distinto',
    });
  }

  if (existing.status === 'completed') {
    // Misma salida, sin repetir el efecto.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  if (existing.status === 'failed') {
    // Falla definitiva ya registrada: repetir produciria el mismo error.
    throw new IdempotencyConflict(existing.response_code, existing.response_body);
  }

  const ageMs = Date.now() - new Date(existing.created_at).getTime();

  // Registro atascado en curso mas alla del TTL: el proceso que lo creo murio
  // antes de terminar. Liberarlo para un intento nuevo en vez de dejar al
  // cliente bloqueado para siempre.
  if (ageMs > IN_PROGRESS_TTL_MS) {
    const retaken = await db.query(
      \`UPDATE idempotency_keys
       SET created_at = now()
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3
         AND status = 'in_progress' AND created_at = $4
       RETURNING key\`,
      [key, subjectId, endpoint, existing.created_at],
    );
    if (retaken.rowCount === 1) return { claimed: true };
  }

  // En curso dentro del plazo: responder AHORA, sin esperar.
  throw new IdempotencyConflict(409, {
    error: 'in_progress',
    message: 'el pedido ya se esta procesando',
    retryAfterSeconds: 2,
  });
};`,
        },
        {
          type: 'paragraph',
          value:
            'La comparación de la huella digital del cuerpo es la parte que casi siempre falta y la que tiene la peor consecuencia cuando falta. Sin ella, un cliente que reutiliza la clave por error, sea porque el almacenamiento de sesión no se limpió o porque la aplicación móvil restauró un estado antiguo, recibe como respuesta la confirmación de una compra distinta de la que acaba de pedir. Ve un pedido confirmado, el monto no coincide, y el sistema no registró ningún error porque desde su punto de vista todo funcionó.',
        },
      ],
    },
    {
      title: 'La clave que cruza el borde: reenviarla al gateway, no recrearla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Proteger tu propia API es la mitad del camino. La otra mitad es lo que ocurre entre tu servidor y el procesador de pagos, porque ahí existe exactamente el mismo problema con un agravante: cuando la llamada al gateway expira por timeout, no sabes si el cobro fue creado. La respuesta se perdió, pero el efecto del otro lado puede haber ocurrido, y decidir reintentar es una apuesta de trescientos cuarenta.',
        },
        {
          type: 'paragraph',
          value:
            'Todos los gateways relevantes aceptan una cabecera de idempotencia, y la regla es derivar ese valor de forma determinista a partir de tu clave interna, nunca generar uno nuevo por intento. Si cada reintento envía un identificador aleatorio distinto, el gateway trata cada uno como un cobro nuevo y la protección desaparece justo donde está el dinero. La derivación determinista hace que el segundo intento recaiga sobre la misma clave y devuelva el cobro ya creado en lugar de crear otro.',
        },
        {
          type: 'code',
          value: `// checkout/gateway.mjs
// La clave interna cruza el borde de forma DETERMINISTA. Generar un valor
// nuevo por intento hace que el gateway trate cada reintento como un cobro
// nuevo, y la proteccion desaparece justo donde esta el dinero.

import { createHash } from 'node:crypto';

// Prefijo por operacion: la misma clave interna puede originar una
// autorizacion y, despues, una captura. Sin el prefijo, la captura recaeria
// sobre la clave de la autorizacion y el gateway devolveria la autorizacion.
const gatewayKey = (internalKey, operation) =>
  createHash('sha256').update(\`\${operation}:\${internalKey}\`).digest('hex').slice(0, 40);

export const authorize = async (gateway, { internalKey, amountCents, currency, source }) => {
  const headers = { 'Idempotency-Key': gatewayKey(internalKey, 'authorize') };

  try {
    return await gateway.post('/charges', { amountCents, currency, source }, { headers });
  } catch (error) {
    // El timeout es el caso ambiguo: el cobro puede existir del otro lado.
    // NUNCA asumir que no. Reintentar con la MISMA clave es seguro;
    // reintentar con una clave nueva cobra dos veces.
    if (error.code === 'ETIMEDOUT' || error.status >= 500) {
      return await gateway.post('/charges', { amountCents, currency, source }, { headers });
    }
    throw error;
  }
};

// Cierre: guarda el resultado en el registro de la clave para que cualquier
// repeticion futura devuelva la MISMA salida sin tocar el gateway de nuevo.
export const settle = async (db, { key, subjectId, endpoint, status, code, body }) => {
  await db.query(
    \`UPDATE idempotency_keys
     SET status = $4, response_code = $5, response_body = $6
     WHERE key = $1 AND subject_id = $2 AND endpoint = $3\`,
    [key, subjectId, endpoint, status, code, body],
  );
};

// Uso en el handler. El orden importa: reclamar, ejecutar, guardar resultado.
export const handleCheckout = async (db, gateway, request) => {
  const requestHash = fingerprint(request.body);
  const scope = {
    key: request.headers['idempotency-key'],
    subjectId: request.auth.customerId, // del token, nunca del cuerpo
    endpoint: 'POST /checkout',
    requestHash,
  };

  await claim(db, scope); // lanza IdempotencyConflict con la respuesta lista

  try {
    const charge = await authorize(gateway, {
      internalKey: scope.key,
      amountCents: request.body.amountCents,
      currency: request.body.currency,
      source: request.body.source,
    });

    const body = { orderId: charge.id, status: 'confirmed' };
    await settle(db, { ...scope, status: 'completed', code: 201, body });
    return { code: 201, body };
  } catch (error) {
    // El rechazo del emisor es un resultado definitivo: guardarlo como falla
    // para que la repeticion devuelva el mismo rechazo en vez de cobrar otra vez.
    if (error.declined) {
      const body = { error: 'card_declined', reason: error.reason };
      await settle(db, { ...scope, status: 'failed', code: 402, body });
      return { code: 402, body };
    }

    // Falla transitoria: borrar el registro para que el proximo intento del
    // cliente pueda reclamar de nuevo. Dejarlo en curso congelaria el checkout
    // hasta que expire el TTL.
    await db.query(
      \`DELETE FROM idempotency_keys
       WHERE key = $1 AND subject_id = $2 AND endpoint = $3 AND status = 'in_progress'\`,
      [scope.key, scope.subjectId, scope.endpoint],
    );
    throw error;
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'La distinción entre falla definitiva y falla transitoria en el bloque final es lo que separa una implementación usable de una que genera tickets de soporte. Una tarjeta rechazada es un resultado, y repetir la petición debe devolver el mismo rechazo sin un nuevo intento de cobro en el emisor, porque los intentos repetidos sobre tarjetas rechazadas afectan la reputación del comercio ante las marcas. Una indisponibilidad momentánea del gateway, en cambio, no es un resultado, y mantener el registro bloqueado en ese caso impide que el cliente reintente durante todo el TTL.',
        },
      ],
    },
    {
      title: 'Alcance, expiración y el costo de guardar la respuesta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La clave primaria compuesta por clave, identidad y ruta no es perfeccionismo de modelado. El identificador del sujeto evita que la clave de un cliente devuelva la respuesta de otro, lo que sería una fuga de datos. La ruta evita que la misma clave, reutilizada por una aplicación que la genera una vez por sesión, haga que una solicitud de reembolso reciba como respuesta la confirmación de la compra original. Cada componente cierra una puerta específica, y quitar cualquiera de ellos abre exactamente la puerta correspondiente.',
        },
        {
          type: 'paragraph',
          value:
            'La expiración tiene dos plazos distintos y confundirlos causa problemas opuestos. El plazo del registro en curso es corto, del orden de noventa segundos, y existe solo para desbloquear al cliente cuando el proceso que reclamó la clave murió. El plazo del registro finalizado es largo, típicamente veinticuatro horas, y existe para que el reintento de la aplicación móvil que quedó sin conexión siga encontrando la respuesta guardada. Usar el plazo corto para los dos permite que un cliente sea cobrado dos veces con dos minutos de diferencia.',
        },
        {
          type: 'table',
          columns: ['Decisión', 'Elección recomendada', 'Qué se rompe si te equivocas'],
          rows: [
            [
              'Alcance de la clave',
              'Clave más identidad autenticada más ruta',
              'Respuesta de un cliente devuelta a otro',
            ],
            [
              'Momento de escribir el registro',
              'Antes del efecto, en transacción propia ya confirmada',
              'La ventana de procesamiento queda desprotegida',
            ],
            [
              'Plazo del estado en curso',
              'Noventa segundos, por encima del timeout del gateway',
              'Corto congela el flujo, largo permite cobro duplicado',
            ],
            [
              'Plazo del estado finalizado',
              'Veinticuatro horas',
              'Un reintento tardío se vuelve una segunda compra',
            ],
            [
              'Cuerpo divergente con la misma clave',
              'Rechazar con cuatrocientos veintidós',
              'El cliente recibe la confirmación de otro pedido',
            ],
            [
              'Clave enviada al gateway',
              'Derivada de la interna con prefijo por operación',
              'El reintento crea un segundo cobro real',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Guardar el cuerpo de la respuesta tiene un costo de almacenamiento que suele plantearse como objeción y casi nunca se sostiene. Una respuesta de checkout serializada ocupa entre quinientos bytes y dos kilobytes, y un sistema con cien mil pedidos por día acumula menos de doscientos megabytes en las veinticuatro horas en que la fila todavía sirve para algo. La rutina de limpieza que borra los registros finalizados vencidos cabe en una consulta y corre en minutos, y el costo real de esa tabla es irrelevante frente al costo de un solo contracargo.',
        },
      ],
    },
    {
      title: 'Demostrar que funciona antes de que lo descubra el cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las pruebas secuenciales dan una falsa sensación de cobertura porque pasan incluso con la implementación equivocada. Llamar al handler dos veces una después de la otra ejercita el camino en que la primera ya terminó, que es justamente el camino fácil, y nunca toca el camino concurrente, que es donde nace el cobro duplicado. La prueba que importa dispara las dos llamadas en paralelo, con la primera retenida a propósito en un punto controlado del procesamiento.',
        },
        {
          type: 'paragraph',
          value:
            'Son cuatro aserciones, y todas son consecuencia directa de las decisiones de las secciones anteriores: que la llamada concurrente responde de inmediato en lugar de esperar, que el gateway fue invocado exactamente una vez, que la repetición posterior devuelve un cuerpo idéntico al de la primera respuesta y que la misma clave con cuerpo distinto es rechazada en vez de confirmar un pedido que el cliente no hizo.',
        },
        {
          type: 'code',
          value: `// checkout/idempotency.test.mjs
// La prueba secuencial pasa incluso con la implementacion equivocada, porque
// ejercita solo el camino en que la primera ya termino. El caso que genera
// cobro duplicado es el concurrente, y necesita una barrera controlada.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleCheckout, IdempotencyConflict } from './gateway.mjs';

const pedido = (overrides = {}) => ({
  headers: { 'idempotency-key': 'k-abc-123' },
  auth: { customerId: 'cus_42' },
  body: { amountCents: 34000, currency: 'BRL', source: 'tok_visa', ...overrides },
});

// Gateway que retiene la primera llamada hasta ser liberado a proposito.
const gatewayConBarrera = () => {
  let liberar;
  const barrera = new Promise((resolve) => {
    liberar = resolve;
  });
  const llamadas = [];

  return {
    llamadas,
    liberar: () => liberar(),
    post: async (path, body, options) => {
      llamadas.push({ path, body, headers: options.headers });
      if (llamadas.length === 1) await barrera;
      return { id: \`ch_\${llamadas.length}\` };
    },
  };
};

test('la peticion concurrente responde al instante y no espera a la primera', async () => {
  const db = crearBaseDePrueba();
  const gateway = gatewayConBarrera();

  const primera = handleCheckout(db, gateway, pedido());

  // Mientras la primera esta retenida en el gateway, llega la segunda.
  const segunda = await handleCheckout(db, gateway, pedido()).catch((error) => error);

  assert.ok(segunda instanceof IdempotencyConflict);
  assert.equal(segunda.status, 409);
  assert.equal(segunda.payload.error, 'in_progress');

  gateway.liberar();
  const resultado = await primera;
  assert.equal(resultado.code, 201);

  // La asercion que demuestra la ausencia de cobro duplicado.
  assert.equal(gateway.llamadas.length, 1, 'el gateway fue invocado mas de una vez');
});

test('la repeticion posterior devuelve el cuerpo identico sin tocar el gateway', async () => {
  const db = crearBaseDePrueba();
  const gateway = gatewayConBarrera();
  gateway.liberar();

  const primera = await handleCheckout(db, gateway, pedido());
  const repetida = await handleCheckout(db, gateway, pedido()).catch((error) => error);

  assert.deepEqual(repetida.payload, primera.body);
  assert.equal(repetida.status, primera.code);
  assert.equal(gateway.llamadas.length, 1);
});

test('la misma clave con cuerpo distinto es rechazada', async () => {
  const db = crearBaseDePrueba();
  const gateway = gatewayConBarrera();
  gateway.liberar();

  await handleCheckout(db, gateway, pedido());

  // Misma clave, monto distinto: aplicacion que restauro un estado antiguo.
  // Devolver la respuesta de la primera compra confirmaria un pedido inexistente.
  const conflicto = await handleCheckout(db, gateway, pedido({ amountCents: 99900 })).catch(
    (error) => error,
  );

  assert.equal(conflicto.status, 422);
  assert.equal(conflicto.payload.error, 'idempotency_key_reuse');
  assert.equal(gateway.llamadas.length, 1);
});`,
        },
        {
          type: 'ordered',
          items: [
            'Genera la clave en el cliente al montar la pantalla de pago y mantén el mismo valor mientras el pedido no cambie, guardándolo en el almacenamiento de sesión para sobrevivir a una recarga.',
            'Crea la tabla con clave primaria compuesta por clave, identidad autenticada y ruta, y guarda la huella digital del cuerpo junto al registro.',
            'Reclama la clave en una transacción propia ya confirmada antes de iniciar el efecto, nunca dentro de la transacción que crea el cobro.',
            'Responde cuatrocientos nueve con indicación de espera para la petición concurrente, sin bloquear, y ajusta el cliente para consultar el resultado en vez de retener la conexión.',
            'Deriva la clave enviada al gateway a partir de la interna con un prefijo por operación, y reintenta con el mismo valor ante timeout o error del servidor.',
            'Separa los plazos de expiración en curso y finalizado, y cubre la implementación con la prueba concurrente que cuenta cuántas veces fue invocado el gateway.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El conteo de llamadas al gateway es la aserción más valiosa del conjunto porque es la única que mide el efecto real en vez de la forma de la respuesta. Una implementación con el registro escrito en la transacción equivocada devuelve exactamente los mismos códigos y los mismos cuerpos que la implementación correcta, y pasa cualquier prueba que solo verifique la salida. Solo se distingue por la cantidad de cobros creados, que es precisamente lo que el cliente ve en su extracto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿La clave de idempotencia sustituye al manejo idempotente de webhooks del gateway?',
      answer:
        'No, los dos resuelven problemas distintos y un sistema de pagos serio necesita ambos. La clave de idempotencia protege la dirección de salida, que es tu aplicación llamando al gateway, y responde a la pregunta de cuántos cobros se crearon cuando el cliente hizo doble clic o la red se cayó a mitad de la llamada. El manejo idempotente de webhooks protege la dirección de entrada, que es el gateway notificando a tu aplicación, y responde a cuántas veces acreditaste el pedido cuando el proveedor entregó el mismo evento tres veces, que es el comportamiento normal de cualquier entrega con garantía de al menos una vez. Son caminos distintos, con tablas distintas y claves derivadas de forma distinta: en el checkout la clave viene del cliente antes del intento, en el webhook se deriva del recurso, la transición de estado y la referencia externa, porque ahí quien genera el evento es el proveedor. Confundir los dos suele producir un sistema que no cobra dos veces pero acredita tres, o al revés, y en ambos casos el síntoma que llega a soporte es el mismo: el monto del extracto no coincide con el pedido.',
    },
    {
      question: '¿Qué hacer cuando el gateway responde con timeout y no se sabe si el cobro existe?',
      answer:
        'Reintentar la llamada con exactamente la misma clave de idempotencia, y esa es la única acción segura de las tres posibles. Asumir que el cobro no existe y crear otro sin la clave produce un cobro duplicado cuando sí existía, y asumir que existe y confirmar el pedido al cliente entrega el producto sin cobrar cuando no existía. Con la misma clave, el gateway devuelve el cobro ya creado si existe y crea uno nuevo si no existe, y en ambos casos el resultado final es un solo cobro. Por eso la derivación determinista de la clave importa tanto: si cada reintento generara un identificador nuevo, esa propiedad desaparecería justo en el momento en que se necesita. Cuando el timeout se repite y no es posible concluir la llamada, la decisión correcta es dejar el pedido en un estado explícito de esperando confirmación, con una tarea en segundo plano que consulta al gateway por esa clave hasta obtener una respuesta definitiva, y comunicarlo al cliente. Confirmar un pedido cuyo pago no pudiste verificar transfiere el riesgo a la operación, y revertir eso después cuesta más que la espera de unos minutos.',
    },
    {
      question: '¿Devolver cuatrocientos nueve en la petición concurrente no empeora la experiencia del usuario?',
      answer:
        'Empeora si el cliente muestra el código crudo al usuario, y mejora bastante si el cliente trata el estado como lo que es. El contraste correcto no es entre un error y un éxito, es entre una respuesta inmediata que dice que el pedido se está procesando y una pantalla congelada durante cuarenta segundos sin ninguna información, que es lo que produce esperar el bloqueo. Con la respuesta de estado, la interfaz muestra que el pago está en curso, deshabilita el botón y pasa a consultar el resultado cada dos segundos, que es exactamente lo que haría un indicador de progreso honesto. Del lado del servidor la ganancia es aún mayor: ninguna conexión queda retenida esperando a que otra termine, el pool no se satura cuando el gateway se degrada, y el segundo clic del usuario deja de ser un multiplicador de carga. Vale notar que algunos equipos prefieren devolver doscientos dos con el mismo cuerpo de estado en lugar de cuatrocientos nueve, y esa es una elección de contrato legítima siempre que el cliente sepa distinguir una respuesta de aceptación de una de finalización. Lo que no funciona es cualquier diseño en que la segunda petición espere a la primera.',
    },
  ],
  conclusion: {
    title: 'Cobrar una sola vez no puede costar cuarenta segundos de pantalla congelada',
    description:
      'La clave de idempotencia resuelve el cobro duplicado y, mal implementada, crea un problema de latencia en su lugar. La diferencia está en tratar la clave como un registro con estado, escrito antes del efecto y respondido de inmediato, en vez de un bloqueo que hace esperar a la segunda petición. Puedo diseñar el alcance y los plazos de la tabla de claves en tu checkout, separar la reclamación del efecto en las transacciones correctas, derivar la clave que cruza el borde hacia el gateway, ajustar el cliente para consultar el estado en lugar de retener la conexión y dejar la prueba concurrente que cuenta las llamadas al gateway corriendo en tu pipeline.',
    cta: 'Hablar sobre la idempotencia de mi checkout',
  },
  related: [
    {
      label: 'Clave de idempotencia en webhook de pago: cobrar una sola vez',
      to: '/blog/chave-idempotencia-webhook-pagamento-cobrar-uma-vez-so',
    },
    {
      label: 'Idempotencia en tool use: evitar acción duplicada del agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
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
