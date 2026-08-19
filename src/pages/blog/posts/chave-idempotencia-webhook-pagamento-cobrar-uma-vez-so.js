// Conteudo do artigo: chave de idempotencia em webhook de pagamento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O provedor de pagamento entrega o mesmo evento três vezes e o cliente recebe três e-mails de confirmação, ou pior, três créditos na conta. Ninguém escreveu um bug: o webhook foi entregue mais de uma vez porque é assim que ele funciona, e o handler tratou cada entrega como se fosse a primeira. Este artigo mostra por que a reentrega não é falha do provedor e sim o contrato dele, por que o identificador do evento é a chave errada e qual é a certa, por que a checagem "já processei?" tem que ser uma restrição do banco e não um SELECT antes do INSERT, como lidar com eventos que chegam fora de ordem e descrevem estados que já foram superados, o que fazer quando o efeito colateral é externo e não participa da sua transação, e como testar tudo isso reenviando o mesmo payload de propósito.',
  sections: [
    {
      title: 'Reentrega não é falha do provedor, é o contrato dele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira coisa a aceitar é que o provedor de pagamento não promete entregar cada evento uma vez. Ele promete entregar pelo menos uma vez, e essa diferença é o artigo inteiro. Se o seu endpoint demora mais que o timeout dele, se responde 500 por causa de um deploy, se a conexão cai depois de o seu servidor ter processado mas antes de a resposta chegar, o provedor reenfileira e tenta de novo. Do lado dele, a tentativa anterior não teve confirmação e portanto não conta. Do lado do seu banco, ela contou perfeitamente.',
        },
        {
          type: 'paragraph',
          value:
            'O caso mais traiçoeiro é justamente esse último: o processamento deu certo, você gravou a transação, disparou o e-mail, liberou o acesso, e só então o processo caiu ou a rede engasgou antes do 200 sair. O provedor vê um timeout, marca a entrega como falha e tenta de novo em trinta segundos. Não existe nada que o seu handler possa responder para desfazer isso, porque a resposta nunca chegou. A única defesa possível está na segunda execução, não na primeira: ela precisa reconhecer que aquele trabalho já foi feito e não refazer.',
        },
        {
          type: 'list',
          items: [
            'Timeout do endpoint: o provedor corta em poucos segundos e reenfileira, mesmo que o seu handler ainda esteja rodando e vá terminar com sucesso.',
            'Resposta perdida: o trabalho foi concluído e persistido, mas o 200 não chegou por queda de processo, deploy ou reset de conexão.',
            'Retentativa por erro real: uma exceção no meio do handler devolve 500, o provedor tenta de novo e a parte que já tinha sido gravada roda pela segunda vez.',
            'Reenvio manual: alguém clica em reenviar no painel do provedor durante uma investigação, e o evento antigo chega de novo semanas depois.',
            'Entrega duplicada sem motivo aparente: sistemas de fila com garantia de pelo menos uma vez duplicam por conta própria, sem que nada tenha falhado do seu lado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A conclusão prática é que o handler de webhook não é um endpoint comum. Ele é um consumidor de fila que precisa ser seguro para reexecução por construção, e todo desenho que assume "isso aqui roda uma vez" está errado desde o primeiro dia, mesmo que só quebre no dia do primeiro incidente.',
        },
      ],
    },
    {
      title: 'A chave certa é a do efeito, não a do evento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O reflexo mais comum é deduplicar pelo identificador do evento que o provedor mandou. Funciona para o caso simples de reentrega literal do mesmo evento e falha em tudo o mais. Dois eventos com identificadores diferentes podem descrever o mesmo efeito no seu domínio: uma cobrança confirmada pode chegar como um evento de pagamento aprovado e depois como um evento de fatura paga, cada um com o seu id, ambos significando "credite este pedido". Deduplicar por id do evento processa os dois e credita duas vezes.',
        },
        {
          type: 'paragraph',
          value:
            'A pergunta correta não é "já vi este evento?" e sim "já produzi este efeito?". A chave de idempotência deve identificar a mudança de estado que você vai aplicar, não a mensagem que a anunciou. Na prática isso significa derivá-la do trio recurso, transição e origem: qual entidade do seu domínio muda, para qual estado ela vai, e a partir de qual referência externa. O identificador do evento continua útil, mas como registro de auditoria e como desempate, não como chave.',
        },
        {
          type: 'table',
          columns: ['Estratégia de chave', 'O que ela deduplica', 'Onde falha'],
          rows: [
            [
              'Id do evento do provedor',
              'Reentrega literal da mesma mensagem',
              'Dois eventos distintos que descrevem a mesma transição de estado',
            ],
            [
              'Hash do corpo inteiro',
              'Payloads byte a byte idênticos',
              'Qualquer campo volátil no corpo, como timestamp de entrega, muda o hash e libera a duplicata',
            ],
            [
              'Id da cobrança do provedor',
              'Todos os eventos daquela cobrança',
              'Colapsa transições legítimas distintas da mesma cobrança, como aprovada e depois estornada',
            ],
            [
              'Recurso mais transição mais referência externa',
              'O efeito, independentemente de quantos eventos o anunciaram',
              'Exige mapear cada tipo de evento para uma transição do seu domínio, o que é trabalho de modelagem',
            ],
          ],
        },
        {
          type: 'code',
          value: `// webhook/idempotency-key.js
// A chave identifica o EFEITO no dominio, nao a mensagem que o anunciou.
// Dois eventos diferentes do provedor que produzem a mesma transicao
// colapsam na mesma chave e so o primeiro executa.
import { createHash } from 'node:crypto';

// Mapa explicito: tipo de evento do provedor -> transicao do seu dominio.
// O que nao esta aqui nao tem efeito e e apenas registrado.
const TRANSITION_BY_EVENT = {
  'payment_intent.succeeded': 'order.paid',
  'invoice.payment_succeeded': 'order.paid', // mesmo efeito, outro evento
  'charge.refunded': 'order.refunded',
  'charge.dispute.created': 'order.disputed',
};

export function effectKey(event) {
  const transition = TRANSITION_BY_EVENT[event.type];
  if (!transition) return null; // evento sem efeito: registrar e sair

  // externalRef ancora a chave na cobranca especifica do provedor.
  // Sem ela, dois pagamentos legitimos do MESMO pedido (uma segunda
  // tentativa apos estorno) colapsariam e o segundo seria engolido.
  const externalRef = event.data.object.id;
  const orderId = event.data.object.metadata.order_id;

  const canonical = [transition, orderId, externalRef].join('|');
  return {
    transition,
    orderId,
    externalRef,
    key: createHash('sha256').update(canonical).digest('hex'),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare no papel da referência externa. Sem ela, a chave seria apenas pedido mais transição, e um cliente que teve o pagamento estornado e pagou de novo veria a segunda cobrança tratada como duplicata da primeira. Com ela, cada cobrança real do provedor tem a sua chave, e apenas as reentregas daquela cobrança específica colapsam. É a mesma armadilha de qualquer chave derivada: ela precisa ser larga o bastante para pegar as duplicatas e estreita o bastante para não engolir intenções legítimas.',
        },
      ],
    },
    {
      title: 'A checagem tem que ser uma restrição, não um SELECT',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a chave definida, o instinto é escrever a verificação mais óbvia: consultar se a chave já existe e, se não existir, processar e gravar. Esse desenho funciona em todos os testes e falha exatamente no cenário que motivou o artigo. Quando o provedor reentrega rápido, ou quando duas instâncias do seu serviço recebem a mesma entrega, as duas consultas rodam antes de qualquer uma das duas gravações. As duas veem a chave ausente, as duas processam, e o efeito duplica com o código de deduplicação instalado e funcionando.',
        },
        {
          type: 'diagram',
          value: `Corrida entre duas entregas do mesmo evento

  instancia A                     instancia B
      |                               |
  SELECT chave -> ausente         SELECT chave -> ausente   <- as duas passam
      |                               |
  processa (credita)              processa (credita)        <- efeito DUPLICADO
      |                               |
  INSERT chave                    INSERT chave

  Com restricao UNICA no banco:

  instancia A                     instancia B
      |                               |
  INSERT chave -> OK              INSERT chave -> violacao  <- so uma vence
      |                               |
  processa (credita)              devolve 200 sem processar
      |                               |
  COMMIT (chave + efeito juntos)  (nenhum efeito aplicado)`,
        },
        {
          type: 'paragraph',
          value:
            'A correção é inverter a ordem e delegar a exclusão mútua ao banco. A primeira coisa que a transação faz é inserir a chave numa tabela com restrição de unicidade. Quem consegue inserir ganhou o direito de processar; quem recebe violação de unicidade sabe que outra execução já assumiu aquele efeito e responde sucesso sem fazer nada. O ponto que sustenta a garantia é que a inserção da chave e a aplicação do efeito acontecem na mesma transação: se o processamento falhar e a transação for revertida, a chave desaparece junto e a próxima entrega poderá tentar de novo.',
        },
        {
          type: 'code',
          value: `-- Tabela de chaves processadas. A restricao UNICA e o mecanismo
-- de exclusao mutua: nao e um indice para acelerar consulta, e a
-- propria garantia de que so uma execucao processa cada efeito.
CREATE TABLE processed_effects (
  key           TEXT PRIMARY KEY,
  transition    TEXT        NOT NULL,
  order_id      TEXT        NOT NULL,
  external_ref  TEXT        NOT NULL,
  event_id      TEXT        NOT NULL,  -- auditoria: qual entrega venceu
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta operacional: quantas reentregas cada efeito recebeu depende
-- de um log separado de entregas, porque esta tabela guarda so a vencedora.
CREATE INDEX processed_effects_order_idx ON processed_effects (order_id);`,
        },
        {
          type: 'code',
          value: `// webhook/handler.js
// Ordem correta: reservar a chave PRIMEIRO, dentro da mesma transacao
// que aplica o efeito. Sem SELECT antes do INSERT.
import { effectKey } from './idempotency-key.js';

export async function handleWebhook(event, db) {
  const effect = effectKey(event);
  if (!effect) {
    await db.logIgnoredEvent(event.id, event.type);
    return { status: 200, body: 'ignored' };
  }

  try {
    await db.transaction(async (tx) => {
      // Se outra execucao ja reservou esta chave, o INSERT viola a
      // restricao UNICA e a transacao inteira aborta aqui, ANTES de
      // qualquer efeito ser aplicado.
      await tx.query(
        \`INSERT INTO processed_effects (key, transition, order_id, external_ref, event_id)
         VALUES ($1, $2, $3, $4, $5)\`,
        [effect.key, effect.transition, effect.orderId, effect.externalRef, event.id],
      );

      // Efeito de dominio na MESMA transacao: se ele falhar, a chave
      // some no rollback e a proxima entrega podera tentar de novo.
      await applyTransition(tx, effect);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicata: alguem ja processou este efeito. 200 para o provedor
      // parar de reentregar. Nao e erro, e o mecanismo funcionando.
      return { status: 200, body: 'duplicate' };
    }
    // Falha real: 500 para o provedor reentregar de proposito.
    throw err;
  }

  return { status: 200, body: 'processed' };
}

const isUniqueViolation = (err) => err.code === '23505'; // Postgres`,
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe de operação que costuma passar batido: a resposta para a duplicata é 200, não 409. Um código de erro faz o provedor reentregar o mesmo evento indefinidamente, e você acaba com uma fila de retentativas que nunca drena porque cada tentativa é corretamente rejeitada. Duplicata detectada é sucesso do ponto de vista do contrato: o efeito está aplicado, é isso que o provedor precisa saber.',
        },
      ],
    },
    {
      title: 'Fora de ordem: idempotência não resolve regressão de estado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Idempotência garante que cada efeito seja aplicado no máximo uma vez. Ela não garante nada sobre a ordem em que os efeitos chegam, e essa é a segunda classe de bug do webhook de pagamento. Um evento de pagamento aprovado sai do provedor às 10h00 e é retentado às 10h05 por timeout. Um evento de estorno da mesma cobrança sai às 10h02 e é entregue de primeira. Do seu lado, o estorno chega antes da aprovação, e a aprovação retentada, tecnicamente não duplicada, sobrescreve o estorno e devolve o pedido para pago.',
        },
        {
          type: 'paragraph',
          value:
            'A defesa aqui não é outra chave, é uma ordem parcial explícita. Cada evento traz um instante de criação do lado do provedor, e cada recurso do seu domínio guarda o instante do último evento que o modificou. Uma transição só se aplica se o evento for mais novo que o último aplicado àquele recurso. Eventos velhos são registrados e descartados, sem erro, porque descrevem um passado que já foi superado. Quando o provedor oferece um número de sequência por recurso, use-o em vez do timestamp: relógio de provedor pode ter granularidade grosseira e dois eventos legítimos podem compartilhar o mesmo instante.',
        },
        {
          type: 'code',
          value: `// webhook/apply-transition.js
// Guarda de ordem: uma transicao so se aplica se for mais nova que a
// ultima ja aplicada AO MESMO recurso. Evento velho nao e erro, e passado.
async function applyTransition(tx, effect, eventCreatedAt) {
  const updated = await tx.query(
    \`UPDATE orders
        SET status = $1,
            last_event_at = $2
      WHERE id = $3
        AND (last_event_at IS NULL OR last_event_at < $2)
      RETURNING id\`,
    [statusFor(effect.transition), eventCreatedAt, effect.orderId],
  );

  // Zero linhas: o pedido ja foi modificado por um evento MAIS NOVO.
  // A chave permanece gravada (o efeito foi considerado e resolvido),
  // e o evento antigo e apenas registrado para auditoria.
  if (updated.rowCount === 0) {
    await tx.query(
      \`INSERT INTO stale_events (order_id, transition, event_created_at)
       VALUES ($1, $2, $3)\`,
      [effect.orderId, effect.transition, eventCreatedAt],
    );
    return { applied: false, reason: 'stale' };
  }

  return { applied: true };
}`,
        },
        {
          type: 'paragraph',
          value:
            'A guarda vive na cláusula WHERE do próprio UPDATE, e não num IF antes dele, pela mesma razão da seção anterior: ler o estado e depois decidir abre uma janela em que outra transação muda o estado no meio. Deixar a comparação dentro da instrução que escreve transforma a decisão numa operação atômica que o banco resolve sozinho.',
        },
      ],
    },
    {
      title: 'Efeitos externos: o que não cabe na transação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo o desenho acima depende de o efeito caber na mesma transação da chave. Isso funciona para escrever no seu banco e falha para tudo que sai dele: enviar e-mail, chamar a API de um parceiro, publicar num tópico, disparar uma mensagem no WhatsApp. Se o handler grava a chave, comita e só depois envia o e-mail, uma queda entre as duas coisas deixa o efeito registrado como aplicado sem que tenha acontecido, e a reentrega seguinte será corretamente rejeitada como duplicata. O cliente nunca recebe o e-mail e a tabela diz que recebeu.',
        },
        {
          type: 'paragraph',
          value:
            'A solução padrão é não fazer o efeito externo dentro do handler. Na mesma transação em que você grava a chave e aplica a mudança de estado, insere também uma linha numa tabela de saída descrevendo a mensagem a enviar. Um processo separado lê essa tabela e faz o envio, marcando cada linha como entregue. Assim o webhook fica inteiramente transacional e o efeito externo herda a durabilidade do banco: se a transação comitou, a intenção de enviar está persistida e alguém vai enviar; se não comitou, nada foi registrado e a reentrega refaz tudo do zero.',
        },
        {
          type: 'ordered',
          items: [
            'O handler abre a transação e insere a chave de idempotência na tabela de efeitos processados.',
            'Na mesma transação, aplica a mudança de estado no recurso do domínio, respeitando a guarda de ordem.',
            'Ainda na mesma transação, insere na tabela de saída a intenção de enviar o e-mail, com destinatário, template e dados.',
            'Comita. A partir daqui, ou tudo existe ou nada existe, e o provedor recebe 200.',
            'Um worker separado lê a tabela de saída, envia com a sua própria chave de idempotência no serviço de e-mail e marca a linha como entregue.',
            'Se o envio falhar, a linha continua pendente e o worker tenta de novo, sem qualquer relação com o retry do provedor de pagamento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O ponto que amarra as duas pontas é que o worker também precisa ser seguro para reexecução, porque ele tem o mesmo problema numa escala menor: pode enviar e cair antes de marcar como entregue. Por isso o envio carrega a sua própria chave de idempotência, derivada do identificador da linha de saída, e o serviço de e-mail resolve a duplicata do lado dele. A propriedade se propaga de camada em camada, e é isso que permite retentar em qualquer ponto sem contar quantas vezes cada etapa rodou.',
        },
      ],
    },
    {
      title: 'Testar reenviando o mesmo payload de propósito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Idempotência é uma propriedade que só existe se for testada, porque ela não aparece em nenhum teste de caminho feliz. Um handler completamente desprotegido passa em todos os testes que enviam cada evento uma vez. O teste que importa é o que envia duas vezes e verifica que o estado do mundo depois da segunda é idêntico ao estado depois da primeira, não apenas que a resposta foi 200.',
        },
        {
          type: 'code',
          value: `// test/webhook-idempotency.test.js
// O teste que prova a propriedade: o estado apos N entregas do mesmo
// evento e igual ao estado apos 1. Comparar o ESTADO, nao a resposta.
import { handleWebhook } from '../webhook/handler.js';

test('entrega repetida nao duplica o efeito', async () => {
  const event = paymentSucceeded({ orderId: 'ord_1', chargeId: 'ch_1' });

  const first = await handleWebhook(event, db);
  const stateAfterFirst = await snapshot(db, 'ord_1');

  // Mesma entrega, tres vezes mais, inclusive em paralelo.
  const repeats = await Promise.all([
    handleWebhook(event, db),
    handleWebhook(event, db),
    handleWebhook(event, db),
  ]);

  expect(first.body).toBe('processed');
  expect(repeats.every((r) => r.status === 200)).toBe(true);
  expect(repeats.filter((r) => r.body === 'processed')).toHaveLength(0);
  expect(await snapshot(db, 'ord_1')).toEqual(stateAfterFirst);
  expect(await db.countOutbox('ord_1')).toBe(1); // um e-mail, nao quatro
});

test('evento distinto com o mesmo efeito tambem colapsa', async () => {
  // O provedor anuncia o mesmo pagamento por dois tipos de evento.
  await handleWebhook(paymentSucceeded({ orderId: 'ord_2', chargeId: 'ch_2' }), db);
  const after = await snapshot(db, 'ord_2');

  const result = await handleWebhook(
    invoicePaid({ orderId: 'ord_2', chargeId: 'ch_2' }), // id de evento diferente
    db,
  );

  expect(result.body).toBe('duplicate');
  expect(await snapshot(db, 'ord_2')).toEqual(after);
});

test('evento fora de ordem nao regride o estado', async () => {
  await handleWebhook(refunded({ orderId: 'ord_3', at: '10:02' }), db);
  await handleWebhook(paymentSucceeded({ orderId: 'ord_3', at: '10:00' }), db);

  expect((await snapshot(db, 'ord_3')).status).toBe('refunded');
});`,
        },
        {
          type: 'paragraph',
          value:
            'Os três testes cobrem as três falhas distintas discutidas aqui, e vale notar que o segundo falharia num sistema que deduplica pelo identificador do evento, e o terceiro falharia num sistema perfeitamente idempotente que ignore ordem. São propriedades independentes: nenhuma implica a outra, e um handler correto precisa das duas. Rodar esses testes em paralelo, como no primeiro caso, é o que expõe a corrida entre o SELECT e o INSERT quando alguém, meses depois, tentar simplificar a reserva de chave.',
        },
        {
          type: 'list',
          items: [
            'Reenvie o mesmo payload em paralelo, não só em sequência: a versão sequencial passa mesmo com a implementação de SELECT antes do INSERT.',
            'Compare o estado final do banco, não o código de resposta: um handler quebrado devolve 200 nas duas entregas e credita duas vezes.',
            'Inclua um par de eventos distintos que descrevem o mesmo efeito, para provar que a chave é do efeito e não da mensagem.',
            'Inclua um evento antigo depois de um novo, para provar que a guarda de ordem existe e não foi removida em algum refactor.',
            'Conte as linhas na tabela de saída, porque é lá que a duplicata vira e-mail enviado duas vezes para o cliente real.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que deduplicar pelo identificador do evento do provedor não é suficiente?',
      answer:
        'Porque o identificador do evento identifica a mensagem, e o que precisa acontecer no máximo uma vez é o efeito. Provedores de pagamento costumam anunciar a mesma mudança de estado por mais de um tipo de evento, por exemplo um evento de pagamento aprovado e outro de fatura paga referentes à mesma cobrança, cada um com o seu identificador próprio. Um handler que deduplica pelo id do evento vê duas mensagens distintas, processa as duas e aplica o efeito duas vezes, mesmo com a deduplicação instalada e funcionando exatamente como foi escrita. A chave correta é derivada da transição de domínio que você vai aplicar, do recurso afetado e da referência externa da cobrança, de modo que qualquer evento que descreva aquele mesmo efeito colapse na mesma chave. O identificador do evento continua valendo a pena guardar, mas como registro de auditoria de qual entrega venceu a corrida, e não como o critério de deduplicação.',
    },
    {
      question: 'Qual é o problema de consultar se a chave já existe antes de processar?',
      answer:
        'O problema é a janela entre a consulta e a gravação. Se duas entregas do mesmo evento chegam quase juntas, seja porque o provedor reentregou rápido ou porque duas instâncias do seu serviço receberam a mesma entrega, as duas consultas rodam antes de qualquer gravação acontecer, as duas encontram a chave ausente e as duas seguem para o processamento. O efeito duplica com o código de deduplicação presente e aparentemente correto, e o bug só aparece sob concorrência, o que faz dele um dos mais difíceis de reproduzir depois. A forma correta é inverter: a transação começa inserindo a chave numa tabela com restrição de unicidade, e quem recebe a violação sabe que perdeu a corrida e responde sucesso sem processar. A exclusão mútua passa a ser responsabilidade do banco, que resolve isso de forma atômica, em vez de depender de uma sequência de duas operações no seu código.',
    },
    {
      question: 'Como enviar e-mail ou chamar uma API externa sem quebrar a garantia?',
      answer:
        'Não fazendo isso dentro do handler. A garantia toda depende de a chave de idempotência e o efeito serem gravados na mesma transação, e uma chamada externa não participa dessa transação: se você comita e depois envia, uma queda no meio deixa a chave registrada sem que o envio tenha acontecido, e a reentrega seguinte é corretamente rejeitada como duplicata, então o cliente nunca recebe nada enquanto a tabela afirma que recebeu. O padrão que resolve é gravar, na mesma transação, uma linha numa tabela de saída descrevendo a mensagem a enviar, e deixar um worker separado ler essa tabela e fazer o envio de verdade, marcando cada linha como entregue. Assim o webhook fica inteiramente transacional e a intenção de enviar herda a durabilidade do banco. O worker precisa ser seguro para reexecução pela mesma razão, então o envio leva a sua própria chave de idempotência derivada do identificador da linha, e o serviço externo resolve a duplicata do lado dele.',
    },
  ],
  conclusion: {
    title: 'O handler seguro é o que assume que vai rodar de novo',
    description:
      'Webhook de pagamento entrega pelo menos uma vez, e nenhum código do lado do handler muda esse contrato. O que você controla é a segunda execução: se ela reconhece o efeito já aplicado, a reentrega é inofensiva; se não reconhece, todo timeout do provedor vira uma cobrança duplicada na conta de um cliente real. Posso revisar ou desenhar a camada de idempotência das suas integrações de pagamento, definindo a chave a partir do efeito e não do evento, movendo a exclusão mútua para uma restrição do banco, adicionando a guarda de ordem que impede regressão de estado e tirando os envios externos de dentro da transação, com os testes de reentrega que provam que a duplicata não passa.',
    cta: 'Falar sobre idempotência nos meus webhooks de pagamento',
  },
  related: [
    {
      label: 'Webhooks de WhatsApp: idempotência e filas',
      to: '/blog/webhook-whatsapp-idempotencia-filas',
    },
    {
      label: 'Idempotência em tool use: evitar ação duplicada do agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Automação e integrações', to: '/servicos/automacao-e-integracoes' },
  ],
};

const en = {
  intro:
    'The payment provider delivers the same event three times and the customer gets three confirmation emails, or worse, three credits on their account. Nobody wrote a bug: the webhook was delivered more than once because that is how it works, and the handler treated every delivery as if it were the first. This article shows why redelivery is not a provider failure but its actual contract, why the event identifier is the wrong key and which one is right, why the "have I processed this?" check has to be a database constraint rather than a SELECT before the INSERT, how to handle events that arrive out of order and describe states that have already been superseded, what to do when the side effect is external and does not take part in your transaction, and how to test all of it by resending the same payload on purpose.',
  sections: [
    {
      title: 'Redelivery is not a provider failure, it is its contract',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first thing to accept is that the payment provider does not promise to deliver each event once. It promises at least once, and that difference is the whole article. If your endpoint takes longer than its timeout, if it returns 500 because of a deploy, if the connection drops after your server processed the event but before the response arrived, the provider requeues and tries again. From its side, the previous attempt had no acknowledgment and therefore does not count. From your database side, it counted perfectly.',
        },
        {
          type: 'paragraph',
          value:
            'The trickiest case is exactly that last one: processing succeeded, you stored the transaction, sent the email, unlocked access, and only then the process crashed or the network stalled before the 200 went out. The provider sees a timeout, marks the delivery as failed and retries in thirty seconds. There is nothing your handler can answer to undo that, because the response never arrived. The only possible defense lives in the second execution, not in the first: it has to recognize that the work was already done and not redo it.',
        },
        {
          type: 'list',
          items: [
            'Endpoint timeout: the provider cuts off after a few seconds and requeues, even if your handler is still running and will finish successfully.',
            'Lost response: the work completed and was persisted, but the 200 never arrived because of a crash, a deploy or a connection reset.',
            'Retry on a real error: an exception in the middle of the handler returns 500, the provider retries, and the part that had already been stored runs a second time.',
            'Manual resend: someone clicks resend in the provider dashboard during an investigation, and the old event arrives again weeks later.',
            'Duplicate delivery with no apparent cause: at-least-once queueing systems duplicate on their own, without anything having failed on your side.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical conclusion is that a webhook handler is not an ordinary endpoint. It is a queue consumer that must be safe to re-execute by construction, and any design that assumes "this runs once" has been wrong since day one, even if it only breaks on the day of the first incident.',
        },
      ],
    },
    {
      title: 'The right key is the effect, not the event',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common reflex is to deduplicate by the event identifier the provider sent. It works for the simple case of a literal redelivery of the same event and fails for everything else. Two events with different identifiers can describe the same effect in your domain: a confirmed charge may arrive as a payment succeeded event and later as an invoice paid event, each with its own id, both meaning "credit this order". Deduplicating by event id processes both and credits twice.',
        },
        {
          type: 'paragraph',
          value:
            'The right question is not "have I seen this event?" but "have I already produced this effect?". The idempotency key should identify the state change you are about to apply, not the message that announced it. In practice that means deriving it from the triple of resource, transition and origin: which entity in your domain changes, which state it moves to, and from which external reference. The event identifier is still useful, but as an audit record and a tiebreaker, not as the key.',
        },
        {
          type: 'table',
          columns: ['Key strategy', 'What it deduplicates', 'Where it fails'],
          rows: [
            [
              'Provider event id',
              'Literal redelivery of the same message',
              'Two distinct events describing the same state transition',
            ],
            [
              'Hash of the whole body',
              'Byte for byte identical payloads',
              'Any volatile field in the body, such as a delivery timestamp, changes the hash and lets the duplicate through',
            ],
            [
              'Provider charge id',
              'Every event for that charge',
              'Collapses legitimately distinct transitions of the same charge, such as succeeded and later refunded',
            ],
            [
              'Resource plus transition plus external reference',
              'The effect, regardless of how many events announced it',
              'Requires mapping each event type to a domain transition, which is modeling work',
            ],
          ],
        },
        {
          type: 'code',
          value: `// webhook/idempotency-key.js
// The key identifies the EFFECT in the domain, not the message that
// announced it. Two different provider events producing the same
// transition collapse into the same key and only the first executes.
import { createHash } from 'node:crypto';

// Explicit map: provider event type -> transition in your domain.
// Anything not listed here has no effect and is only logged.
const TRANSITION_BY_EVENT = {
  'payment_intent.succeeded': 'order.paid',
  'invoice.payment_succeeded': 'order.paid', // same effect, another event
  'charge.refunded': 'order.refunded',
  'charge.dispute.created': 'order.disputed',
};

export function effectKey(event) {
  const transition = TRANSITION_BY_EVENT[event.type];
  if (!transition) return null; // event with no effect: log and return

  // externalRef anchors the key to the specific provider charge.
  // Without it, two legitimate payments for the SAME order (a second
  // attempt after a refund) would collapse and the second be swallowed.
  const externalRef = event.data.object.id;
  const orderId = event.data.object.metadata.order_id;

  const canonical = [transition, orderId, externalRef].join('|');
  return {
    transition,
    orderId,
    externalRef,
    key: createHash('sha256').update(canonical).digest('hex'),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note the role of the external reference. Without it, the key would be just order plus transition, and a customer whose payment was refunded and who paid again would see the second charge treated as a duplicate of the first. With it, each real provider charge has its own key, and only redeliveries of that specific charge collapse. It is the same trap as any derived key: it has to be wide enough to catch the duplicates and narrow enough not to swallow legitimate intents.',
        },
      ],
    },
    {
      title: 'The check has to be a constraint, not a SELECT',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the key defined, the instinct is to write the most obvious check: query whether the key already exists and, if it does not, process and store it. That design works in every test and fails in exactly the scenario that motivated the article. When the provider redelivers quickly, or when two instances of your service receive the same delivery, both queries run before either write happens. Both see the key missing, both process, and the effect duplicates with the deduplication code installed and working.',
        },
        {
          type: 'diagram',
          value: `Race between two deliveries of the same event

  instance A                      instance B
      |                               |
  SELECT key -> missing           SELECT key -> missing     <- both pass
      |                               |
  processes (credits)             processes (credits)       <- DUPLICATED effect
      |                               |
  INSERT key                      INSERT key

  With a UNIQUE constraint in the database:

  instance A                      instance B
      |                               |
  INSERT key -> OK                INSERT key -> violation   <- only one wins
      |                               |
  processes (credits)             returns 200, no processing
      |                               |
  COMMIT (key + effect together)  (no effect applied)`,
        },
        {
          type: 'paragraph',
          value:
            'The fix is to invert the order and delegate mutual exclusion to the database. The first thing the transaction does is insert the key into a table with a uniqueness constraint. Whoever manages to insert has earned the right to process; whoever gets a uniqueness violation knows another execution already claimed that effect and returns success without doing anything. The point that holds the guarantee together is that inserting the key and applying the effect happen in the same transaction: if processing fails and the transaction rolls back, the key disappears with it and the next delivery will be able to try again.',
        },
        {
          type: 'code',
          value: `-- Table of processed keys. The UNIQUE constraint is the mutual
-- exclusion mechanism: it is not an index to speed up a query, it is
-- the guarantee itself that only one execution handles each effect.
CREATE TABLE processed_effects (
  key           TEXT PRIMARY KEY,
  transition    TEXT        NOT NULL,
  order_id      TEXT        NOT NULL,
  external_ref  TEXT        NOT NULL,
  event_id      TEXT        NOT NULL,  -- audit: which delivery won
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Operational query: how many redeliveries each effect received depends
-- on a separate delivery log, because this table keeps only the winner.
CREATE INDEX processed_effects_order_idx ON processed_effects (order_id);`,
        },
        {
          type: 'code',
          value: `// webhook/handler.js
// Correct order: reserve the key FIRST, inside the same transaction
// that applies the effect. No SELECT before the INSERT.
import { effectKey } from './idempotency-key.js';

export async function handleWebhook(event, db) {
  const effect = effectKey(event);
  if (!effect) {
    await db.logIgnoredEvent(event.id, event.type);
    return { status: 200, body: 'ignored' };
  }

  try {
    await db.transaction(async (tx) => {
      // If another execution already reserved this key, the INSERT
      // violates the UNIQUE constraint and the whole transaction aborts
      // here, BEFORE any effect is applied.
      await tx.query(
        \`INSERT INTO processed_effects (key, transition, order_id, external_ref, event_id)
         VALUES ($1, $2, $3, $4, $5)\`,
        [effect.key, effect.transition, effect.orderId, effect.externalRef, event.id],
      );

      // Domain effect in the SAME transaction: if it fails, the key
      // disappears in the rollback and the next delivery can try again.
      await applyTransition(tx, effect);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicate: someone already processed this effect. Return 200 so
      // the provider stops redelivering. Not an error, the mechanism working.
      return { status: 200, body: 'duplicate' };
    }
    // Real failure: 500 so the provider redelivers on purpose.
    throw err;
  }

  return { status: 200, body: 'processed' };
}

const isUniqueViolation = (err) => err.code === '23505'; // Postgres`,
        },
        {
          type: 'paragraph',
          value:
            'One operational detail that usually goes unnoticed: the response to a duplicate is 200, not 409. An error code makes the provider redeliver the same event indefinitely, and you end up with a retry queue that never drains because every attempt is correctly rejected. A detected duplicate is a success from the contract point of view: the effect is applied, and that is what the provider needs to know.',
        },
      ],
    },
    {
      title: 'Out of order: idempotency does not solve state regression',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Idempotency guarantees that each effect is applied at most once. It guarantees nothing about the order in which effects arrive, and that is the second class of payment webhook bug. A payment succeeded event leaves the provider at 10:00 and is retried at 10:05 because of a timeout. A refund event for the same charge leaves at 10:02 and is delivered on the first attempt. On your side, the refund arrives before the payment, and the retried payment, technically not a duplicate, overwrites the refund and moves the order back to paid.',
        },
        {
          type: 'paragraph',
          value:
            'The defense here is not another key, it is an explicit partial order. Each event carries a creation instant from the provider side, and each resource in your domain stores the instant of the last event that modified it. A transition only applies if the event is newer than the last one applied to that resource. Old events are logged and discarded, without an error, because they describe a past that has already been superseded. When the provider offers a per-resource sequence number, use it instead of the timestamp: provider clocks can be coarse and two legitimate events may share the same instant.',
        },
        {
          type: 'code',
          value: `// webhook/apply-transition.js
// Ordering guard: a transition only applies if it is newer than the
// last one applied TO THE SAME resource. An old event is not an error,
// it is the past.
async function applyTransition(tx, effect, eventCreatedAt) {
  const updated = await tx.query(
    \`UPDATE orders
        SET status = $1,
            last_event_at = $2
      WHERE id = $3
        AND (last_event_at IS NULL OR last_event_at < $2)
      RETURNING id\`,
    [statusFor(effect.transition), eventCreatedAt, effect.orderId],
  );

  // Zero rows: the order was already modified by a NEWER event.
  // The key stays stored (the effect was considered and resolved),
  // and the old event is only logged for auditing.
  if (updated.rowCount === 0) {
    await tx.query(
      \`INSERT INTO stale_events (order_id, transition, event_created_at)
       VALUES ($1, $2, $3)\`,
      [effect.orderId, effect.transition, eventCreatedAt],
    );
    return { applied: false, reason: 'stale' };
  }

  return { applied: true };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The guard lives in the WHERE clause of the UPDATE itself, not in an IF before it, for the same reason as the previous section: reading the state and then deciding opens a window in which another transaction changes the state in between. Keeping the comparison inside the statement that writes turns the decision into an atomic operation the database resolves on its own.',
        },
      ],
    },
    {
      title: 'External effects: what does not fit in the transaction',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The whole design above depends on the effect fitting in the same transaction as the key. That works for writing to your database and fails for everything that leaves it: sending an email, calling a partner API, publishing to a topic, firing a WhatsApp message. If the handler stores the key, commits and only then sends the email, a crash between the two leaves the effect recorded as applied without it having happened, and the next redelivery will be correctly rejected as a duplicate. The customer never receives the email and the table says they did.',
        },
        {
          type: 'paragraph',
          value:
            'The standard solution is not to perform the external effect inside the handler. In the same transaction where you store the key and apply the state change, you also insert a row into an outbox table describing the message to send. A separate process reads that table and performs the delivery, marking each row as sent. That way the webhook stays fully transactional and the external effect inherits the durability of the database: if the transaction committed, the intent to send is persisted and someone will send it; if it did not commit, nothing was recorded and the redelivery redoes everything from scratch.',
        },
        {
          type: 'ordered',
          items: [
            'The handler opens the transaction and inserts the idempotency key into the processed effects table.',
            'In the same transaction, it applies the state change to the domain resource, respecting the ordering guard.',
            'Still in the same transaction, it inserts into the outbox table the intent to send the email, with recipient, template and data.',
            'It commits. From here on, either everything exists or nothing does, and the provider receives 200.',
            'A separate worker reads the outbox table, sends with its own idempotency key in the email service and marks the row as delivered.',
            'If the delivery fails, the row stays pending and the worker tries again, with no relation whatsoever to the payment provider retry.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'What ties both ends together is that the worker also has to be safe to re-execute, because it has the same problem at a smaller scale: it can send and crash before marking the row as delivered. That is why the delivery carries its own idempotency key, derived from the outbox row identifier, and the email service resolves the duplicate on its side. The property propagates from layer to layer, and that is what allows retrying at any point without counting how many times each step ran.',
        },
      ],
    },
    {
      title: 'Testing by resending the same payload on purpose',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Idempotency is a property that only exists if it is tested, because it shows up in no happy path test. A completely unprotected handler passes every test that sends each event once. The test that matters is the one that sends twice and verifies that the state of the world after the second delivery is identical to the state after the first, not merely that the response was 200.',
        },
        {
          type: 'code',
          value: `// test/webhook-idempotency.test.js
// The test that proves the property: the state after N deliveries of the
// same event equals the state after 1. Compare the STATE, not the response.
import { handleWebhook } from '../webhook/handler.js';

test('repeated delivery does not duplicate the effect', async () => {
  const event = paymentSucceeded({ orderId: 'ord_1', chargeId: 'ch_1' });

  const first = await handleWebhook(event, db);
  const stateAfterFirst = await snapshot(db, 'ord_1');

  // Same delivery, three more times, including in parallel.
  const repeats = await Promise.all([
    handleWebhook(event, db),
    handleWebhook(event, db),
    handleWebhook(event, db),
  ]);

  expect(first.body).toBe('processed');
  expect(repeats.every((r) => r.status === 200)).toBe(true);
  expect(repeats.filter((r) => r.body === 'processed')).toHaveLength(0);
  expect(await snapshot(db, 'ord_1')).toEqual(stateAfterFirst);
  expect(await db.countOutbox('ord_1')).toBe(1); // one email, not four
});

test('a distinct event with the same effect also collapses', async () => {
  // The provider announces the same payment through two event types.
  await handleWebhook(paymentSucceeded({ orderId: 'ord_2', chargeId: 'ch_2' }), db);
  const after = await snapshot(db, 'ord_2');

  const result = await handleWebhook(
    invoicePaid({ orderId: 'ord_2', chargeId: 'ch_2' }), // different event id
    db,
  );

  expect(result.body).toBe('duplicate');
  expect(await snapshot(db, 'ord_2')).toEqual(after);
});

test('an out of order event does not regress the state', async () => {
  await handleWebhook(refunded({ orderId: 'ord_3', at: '10:02' }), db);
  await handleWebhook(paymentSucceeded({ orderId: 'ord_3', at: '10:00' }), db);

  expect((await snapshot(db, 'ord_3')).status).toBe('refunded');
});`,
        },
        {
          type: 'paragraph',
          value:
            'The three tests cover the three distinct failures discussed here, and it is worth noting that the second would fail in a system that deduplicates by event identifier, and the third would fail in a perfectly idempotent system that ignores ordering. They are independent properties: neither implies the other, and a correct handler needs both. Running these tests in parallel, as in the first case, is what exposes the race between the SELECT and the INSERT when someone, months later, tries to simplify the key reservation.',
        },
        {
          type: 'list',
          items: [
            'Resend the same payload in parallel, not only sequentially: the sequential version passes even with the SELECT before INSERT implementation.',
            'Compare the final database state, not the response code: a broken handler returns 200 on both deliveries and credits twice.',
            'Include a pair of distinct events describing the same effect, to prove the key is about the effect and not about the message.',
            'Include an old event after a newer one, to prove the ordering guard exists and was not removed in some refactor.',
            'Count the rows in the outbox table, because that is where a duplicate turns into an email sent twice to a real customer.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why is deduplicating by the provider event identifier not enough?',
      answer:
        'Because the event identifier identifies the message, and what must happen at most once is the effect. Payment providers commonly announce the same state change through more than one event type, for instance a payment succeeded event and an invoice paid event for the same charge, each with its own identifier. A handler that deduplicates by event id sees two distinct messages, processes both and applies the effect twice, even with the deduplication installed and working exactly as written. The correct key is derived from the domain transition you are about to apply, the affected resource and the external reference of the charge, so that any event describing that same effect collapses into the same key. The event identifier is still worth storing, but as an audit record of which delivery won the race, not as the deduplication criterion.',
    },
    {
      question: 'What is wrong with querying whether the key already exists before processing?',
      answer:
        'The problem is the window between the query and the write. If two deliveries of the same event arrive nearly together, either because the provider redelivered quickly or because two instances of your service received the same delivery, both queries run before any write happens, both find the key missing and both go ahead and process. The effect duplicates with the deduplication code present and seemingly correct, and the bug only appears under concurrency, which makes it one of the hardest to reproduce later. The correct form is to invert it: the transaction starts by inserting the key into a table with a uniqueness constraint, and whoever gets the violation knows it lost the race and returns success without processing. Mutual exclusion becomes the responsibility of the database, which resolves it atomically, instead of depending on a sequence of two operations in your code.',
    },
    {
      question: 'How do you send an email or call an external API without breaking the guarantee?',
      answer:
        'By not doing it inside the handler. The entire guarantee depends on the idempotency key and the effect being stored in the same transaction, and an external call does not take part in that transaction: if you commit and then send, a crash in between leaves the key recorded without the delivery having happened, and the next redelivery is correctly rejected as a duplicate, so the customer never receives anything while the table claims they did. The pattern that solves it is to store, in the same transaction, a row in an outbox table describing the message to send, and let a separate worker read that table and perform the actual delivery, marking each row as sent. The webhook then stays fully transactional and the intent to send inherits the durability of the database. The worker must be safe to re-execute for the same reason, so the delivery carries its own idempotency key derived from the row identifier, and the external service resolves the duplicate on its side.',
    },
  ],
  conclusion: {
    title: 'The safe handler is the one that assumes it will run again',
    description:
      'Payment webhooks deliver at least once, and no code on the handler side changes that contract. What you control is the second execution: if it recognizes the effect as already applied, the redelivery is harmless; if it does not, every provider timeout turns into a duplicate charge on a real customer account. I can review or design the idempotency layer of your payment integrations, defining the key from the effect rather than the event, moving mutual exclusion into a database constraint, adding the ordering guard that prevents state regression and taking external deliveries out of the transaction, with the redelivery tests that prove the duplicate does not get through.',
    cta: 'Talk about idempotency in my payment webhooks',
  },
  related: [
    {
      label: 'WhatsApp webhooks: idempotency and queues',
      to: '/blog/webhook-whatsapp-idempotencia-filas',
    },
    {
      label: 'Idempotency in tool use: avoiding duplicate agent actions',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Automation and integrations', to: '/servicos/automacao-e-integracoes' },
  ],
};

const es = {
  intro:
    'El proveedor de pago entrega el mismo evento tres veces y el cliente recibe tres correos de confirmación, o peor, tres créditos en la cuenta. Nadie escribió un bug: el webhook se entregó más de una vez porque así funciona, y el handler trató cada entrega como si fuera la primera. Este artículo muestra por qué la reentrega no es una falla del proveedor sino su contrato, por qué el identificador del evento es la clave equivocada y cuál es la correcta, por qué la verificación "¿ya lo procesé?" tiene que ser una restricción de la base de datos y no un SELECT antes del INSERT, cómo tratar eventos que llegan fuera de orden y describen estados ya superados, qué hacer cuando el efecto colateral es externo y no participa de tu transacción, y cómo probar todo eso reenviando el mismo payload a propósito.',
  sections: [
    {
      title: 'La reentrega no es una falla del proveedor, es su contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Lo primero que hay que aceptar es que el proveedor de pago no promete entregar cada evento una vez. Promete entregarlo al menos una vez, y esa diferencia es el artículo entero. Si tu endpoint tarda más que su timeout, si responde 500 por un deploy, si la conexión se cae después de que tu servidor procesó pero antes de que llegue la respuesta, el proveedor vuelve a encolar e intenta de nuevo. De su lado, el intento anterior no tuvo confirmación y por lo tanto no cuenta. Del lado de tu base de datos, contó perfectamente.',
        },
        {
          type: 'paragraph',
          value:
            'El caso más traicionero es justamente ese último: el procesamiento salió bien, guardaste la transacción, disparaste el correo, liberaste el acceso, y recién ahí el proceso se cayó o la red se trabó antes de que saliera el 200. El proveedor ve un timeout, marca la entrega como fallida e intenta de nuevo en treinta segundos. No hay nada que tu handler pueda responder para deshacer eso, porque la respuesta nunca llegó. La única defensa posible está en la segunda ejecución, no en la primera: tiene que reconocer que ese trabajo ya se hizo y no rehacerlo.',
        },
        {
          type: 'list',
          items: [
            'Timeout del endpoint: el proveedor corta a los pocos segundos y vuelve a encolar, aunque tu handler siga corriendo y vaya a terminar con éxito.',
            'Respuesta perdida: el trabajo terminó y quedó persistido, pero el 200 no llegó por caída de proceso, deploy o reset de conexión.',
            'Reintento por error real: una excepción en medio del handler devuelve 500, el proveedor reintenta y la parte que ya se había guardado corre por segunda vez.',
            'Reenvío manual: alguien hace clic en reenviar en el panel del proveedor durante una investigación, y el evento viejo llega de nuevo semanas después.',
            'Entrega duplicada sin motivo aparente: los sistemas de cola con garantía de al menos una vez duplican por su cuenta, sin que nada haya fallado de tu lado.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La conclusión práctica es que el handler de webhook no es un endpoint común. Es un consumidor de cola que necesita ser seguro para reejecución por construcción, y todo diseño que asume "esto corre una vez" está mal desde el primer día, aunque solo se rompa el día del primer incidente.',
        },
      ],
    },
    {
      title: 'La clave correcta es la del efecto, no la del evento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El reflejo más común es deduplicar por el identificador del evento que mandó el proveedor. Funciona para el caso simple de una reentrega literal del mismo evento y falla en todo lo demás. Dos eventos con identificadores distintos pueden describir el mismo efecto en tu dominio: un cobro confirmado puede llegar como un evento de pago aprobado y después como un evento de factura pagada, cada uno con su id, ambos significando "acreditá este pedido". Deduplicar por id de evento procesa los dos y acredita dos veces.',
        },
        {
          type: 'paragraph',
          value:
            'La pregunta correcta no es "¿ya vi este evento?" sino "¿ya produje este efecto?". La clave de idempotencia debe identificar el cambio de estado que vas a aplicar, no el mensaje que lo anunció. En la práctica eso significa derivarla del trío recurso, transición y origen: qué entidad de tu dominio cambia, hacia qué estado va, y a partir de qué referencia externa. El identificador del evento sigue siendo útil, pero como registro de auditoría y como desempate, no como clave.',
        },
        {
          type: 'table',
          columns: ['Estrategia de clave', 'Qué deduplica', 'Dónde falla'],
          rows: [
            [
              'Id del evento del proveedor',
              'Reentrega literal del mismo mensaje',
              'Dos eventos distintos que describen la misma transición de estado',
            ],
            [
              'Hash del cuerpo entero',
              'Payloads idénticos byte a byte',
              'Cualquier campo volátil en el cuerpo, como el timestamp de entrega, cambia el hash y deja pasar la duplicada',
            ],
            [
              'Id del cobro del proveedor',
              'Todos los eventos de ese cobro',
              'Colapsa transiciones legítimamente distintas del mismo cobro, como aprobado y luego reembolsado',
            ],
            [
              'Recurso más transición más referencia externa',
              'El efecto, sin importar cuántos eventos lo anunciaron',
              'Exige mapear cada tipo de evento a una transición de tu dominio, que es trabajo de modelado',
            ],
          ],
        },
        {
          type: 'code',
          value: `// webhook/idempotency-key.js
// La clave identifica el EFECTO en el dominio, no el mensaje que lo
// anuncio. Dos eventos distintos del proveedor que producen la misma
// transicion colapsan en la misma clave y solo el primero ejecuta.
import { createHash } from 'node:crypto';

// Mapa explicito: tipo de evento del proveedor -> transicion de tu dominio.
// Lo que no esta aca no tiene efecto y solo se registra.
const TRANSITION_BY_EVENT = {
  'payment_intent.succeeded': 'order.paid',
  'invoice.payment_succeeded': 'order.paid', // mismo efecto, otro evento
  'charge.refunded': 'order.refunded',
  'charge.dispute.created': 'order.disputed',
};

export function effectKey(event) {
  const transition = TRANSITION_BY_EVENT[event.type];
  if (!transition) return null; // evento sin efecto: registrar y salir

  // externalRef ancla la clave al cobro especifico del proveedor.
  // Sin ella, dos pagos legitimos del MISMO pedido (un segundo intento
  // tras un reembolso) colapsarian y el segundo seria descartado.
  const externalRef = event.data.object.id;
  const orderId = event.data.object.metadata.order_id;

  const canonical = [transition, orderId, externalRef].join('|');
  return {
    transition,
    orderId,
    externalRef,
    key: createHash('sha256').update(canonical).digest('hex'),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en el papel de la referencia externa. Sin ella, la clave sería solo pedido más transición, y un cliente al que le reembolsaron el pago y volvió a pagar vería el segundo cobro tratado como duplicado del primero. Con ella, cada cobro real del proveedor tiene su clave, y solo las reentregas de ese cobro específico colapsan. Es la misma trampa de cualquier clave derivada: tiene que ser lo bastante amplia para atrapar las duplicadas y lo bastante estrecha para no descartar intenciones legítimas.',
        },
      ],
    },
    {
      title: 'La verificación tiene que ser una restricción, no un SELECT',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la clave definida, el instinto es escribir la verificación más obvia: consultar si la clave ya existe y, si no existe, procesar y guardarla. Ese diseño funciona en todas las pruebas y falla exactamente en el escenario que motivó el artículo. Cuando el proveedor reentrega rápido, o cuando dos instancias de tu servicio reciben la misma entrega, las dos consultas corren antes de cualquiera de las dos escrituras. Las dos ven la clave ausente, las dos procesan, y el efecto se duplica con el código de deduplicación instalado y funcionando.',
        },
        {
          type: 'diagram',
          value: `Carrera entre dos entregas del mismo evento

  instancia A                     instancia B
      |                               |
  SELECT clave -> ausente         SELECT clave -> ausente   <- las dos pasan
      |                               |
  procesa (acredita)              procesa (acredita)        <- efecto DUPLICADO
      |                               |
  INSERT clave                    INSERT clave

  Con restriccion UNICA en la base:

  instancia A                     instancia B
      |                               |
  INSERT clave -> OK              INSERT clave -> violacion <- solo una gana
      |                               |
  procesa (acredita)              devuelve 200 sin procesar
      |                               |
  COMMIT (clave + efecto juntos)  (ningun efecto aplicado)`,
        },
        {
          type: 'paragraph',
          value:
            'La corrección es invertir el orden y delegar la exclusión mutua a la base de datos. Lo primero que hace la transacción es insertar la clave en una tabla con restricción de unicidad. Quien logra insertar se ganó el derecho de procesar; quien recibe una violación de unicidad sabe que otra ejecución ya se hizo cargo de ese efecto y responde éxito sin hacer nada. El punto que sostiene la garantía es que la inserción de la clave y la aplicación del efecto ocurren en la misma transacción: si el procesamiento falla y la transacción se revierte, la clave desaparece con ella y la próxima entrega podrá intentar de nuevo.',
        },
        {
          type: 'code',
          value: `-- Tabla de claves procesadas. La restriccion UNICA es el mecanismo de
-- exclusion mutua: no es un indice para acelerar consultas, es la
-- garantia misma de que solo una ejecucion procesa cada efecto.
CREATE TABLE processed_effects (
  key           TEXT PRIMARY KEY,
  transition    TEXT        NOT NULL,
  order_id      TEXT        NOT NULL,
  external_ref  TEXT        NOT NULL,
  event_id      TEXT        NOT NULL,  -- auditoria: que entrega gano
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta operativa: cuantas reentregas recibio cada efecto depende de
-- un log separado de entregas, porque esta tabla guarda solo la ganadora.
CREATE INDEX processed_effects_order_idx ON processed_effects (order_id);`,
        },
        {
          type: 'code',
          value: `// webhook/handler.js
// Orden correcto: reservar la clave PRIMERO, dentro de la misma
// transaccion que aplica el efecto. Sin SELECT antes del INSERT.
import { effectKey } from './idempotency-key.js';

export async function handleWebhook(event, db) {
  const effect = effectKey(event);
  if (!effect) {
    await db.logIgnoredEvent(event.id, event.type);
    return { status: 200, body: 'ignored' };
  }

  try {
    await db.transaction(async (tx) => {
      // Si otra ejecucion ya reservo esta clave, el INSERT viola la
      // restriccion UNICA y toda la transaccion aborta aca, ANTES de
      // que cualquier efecto sea aplicado.
      await tx.query(
        \`INSERT INTO processed_effects (key, transition, order_id, external_ref, event_id)
         VALUES ($1, $2, $3, $4, $5)\`,
        [effect.key, effect.transition, effect.orderId, effect.externalRef, event.id],
      );

      // Efecto de dominio en la MISMA transaccion: si falla, la clave
      // desaparece en el rollback y la proxima entrega puede reintentar.
      await applyTransition(tx, effect);
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Duplicado: alguien ya proceso este efecto. 200 para que el
      // proveedor deje de reentregar. No es error, es el mecanismo.
      return { status: 200, body: 'duplicate' };
    }
    // Falla real: 500 para que el proveedor reentregue a proposito.
    throw err;
  }

  return { status: 200, body: 'processed' };
}

const isUniqueViolation = (err) => err.code === '23505'; // Postgres`,
        },
        {
          type: 'paragraph',
          value:
            'Un detalle de operación que suele pasar desapercibido: la respuesta al duplicado es 200, no 409. Un código de error hace que el proveedor reentregue el mismo evento indefinidamente, y terminás con una cola de reintentos que nunca drena porque cada intento es correctamente rechazado. Un duplicado detectado es un éxito desde el punto de vista del contrato: el efecto está aplicado, y eso es lo que el proveedor necesita saber.',
        },
      ],
    },
    {
      title: 'Fuera de orden: la idempotencia no resuelve la regresión de estado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La idempotencia garantiza que cada efecto se aplique a lo sumo una vez. No garantiza nada sobre el orden en que llegan los efectos, y esa es la segunda clase de bug del webhook de pago. Un evento de pago aprobado sale del proveedor a las 10:00 y se reintenta a las 10:05 por timeout. Un evento de reembolso del mismo cobro sale a las 10:02 y se entrega al primer intento. De tu lado, el reembolso llega antes que el pago, y el pago reintentado, técnicamente no duplicado, sobrescribe el reembolso y devuelve el pedido a pagado.',
        },
        {
          type: 'paragraph',
          value:
            'La defensa acá no es otra clave, es un orden parcial explícito. Cada evento trae un instante de creación del lado del proveedor, y cada recurso de tu dominio guarda el instante del último evento que lo modificó. Una transición solo se aplica si el evento es más nuevo que el último aplicado a ese recurso. Los eventos viejos se registran y se descartan, sin error, porque describen un pasado ya superado. Cuando el proveedor ofrece un número de secuencia por recurso, usalo en vez del timestamp: el reloj del proveedor puede tener granularidad gruesa y dos eventos legítimos pueden compartir el mismo instante.',
        },
        {
          type: 'code',
          value: `// webhook/apply-transition.js
// Guarda de orden: una transicion solo se aplica si es mas nueva que la
// ultima aplicada AL MISMO recurso. Un evento viejo no es error, es pasado.
async function applyTransition(tx, effect, eventCreatedAt) {
  const updated = await tx.query(
    \`UPDATE orders
        SET status = $1,
            last_event_at = $2
      WHERE id = $3
        AND (last_event_at IS NULL OR last_event_at < $2)
      RETURNING id\`,
    [statusFor(effect.transition), eventCreatedAt, effect.orderId],
  );

  // Cero filas: el pedido ya fue modificado por un evento MAS NUEVO.
  // La clave permanece guardada (el efecto fue considerado y resuelto),
  // y el evento antiguo solo se registra para auditoria.
  if (updated.rowCount === 0) {
    await tx.query(
      \`INSERT INTO stale_events (order_id, transition, event_created_at)
       VALUES ($1, $2, $3)\`,
      [effect.orderId, effect.transition, eventCreatedAt],
    );
    return { applied: false, reason: 'stale' };
  }

  return { applied: true };
}`,
        },
        {
          type: 'paragraph',
          value:
            'La guarda vive en la cláusula WHERE del propio UPDATE, y no en un IF antes de él, por la misma razón de la sección anterior: leer el estado y después decidir abre una ventana en la que otra transacción cambia el estado en el medio. Dejar la comparación dentro de la instrucción que escribe convierte la decisión en una operación atómica que la base resuelve sola.',
        },
      ],
    },
    {
      title: 'Efectos externos: lo que no cabe en la transacción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo el diseño anterior depende de que el efecto quepa en la misma transacción que la clave. Eso funciona para escribir en tu base de datos y falla para todo lo que sale de ella: enviar un correo, llamar a la API de un socio, publicar en un tópico, disparar un mensaje de WhatsApp. Si el handler guarda la clave, comitea y recién después envía el correo, una caída entre las dos cosas deja el efecto registrado como aplicado sin que haya ocurrido, y la reentrega siguiente será correctamente rechazada como duplicado. El cliente nunca recibe el correo y la tabla dice que lo recibió.',
        },
        {
          type: 'paragraph',
          value:
            'La solución estándar es no hacer el efecto externo dentro del handler. En la misma transacción en la que guardás la clave y aplicás el cambio de estado, insertás también una fila en una tabla de salida describiendo el mensaje a enviar. Un proceso separado lee esa tabla y hace el envío, marcando cada fila como entregada. Así el webhook queda enteramente transaccional y el efecto externo hereda la durabilidad de la base: si la transacción comiteó, la intención de enviar está persistida y alguien va a enviarla; si no comiteó, nada quedó registrado y la reentrega rehace todo desde cero.',
        },
        {
          type: 'ordered',
          items: [
            'El handler abre la transacción e inserta la clave de idempotencia en la tabla de efectos procesados.',
            'En la misma transacción, aplica el cambio de estado en el recurso del dominio, respetando la guarda de orden.',
            'Todavía en la misma transacción, inserta en la tabla de salida la intención de enviar el correo, con destinatario, template y datos.',
            'Comitea. A partir de acá, o todo existe o nada existe, y el proveedor recibe 200.',
            'Un worker separado lee la tabla de salida, envía con su propia clave de idempotencia en el servicio de correo y marca la fila como entregada.',
            'Si el envío falla, la fila queda pendiente y el worker reintenta, sin relación alguna con el retry del proveedor de pago.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El punto que ata las dos puntas es que el worker también tiene que ser seguro para reejecución, porque tiene el mismo problema a menor escala: puede enviar y caerse antes de marcar la fila como entregada. Por eso el envío lleva su propia clave de idempotencia, derivada del identificador de la fila de salida, y el servicio de correo resuelve el duplicado de su lado. La propiedad se propaga de capa en capa, y eso es lo que permite reintentar en cualquier punto sin contar cuántas veces corrió cada etapa.',
        },
      ],
    },
    {
      title: 'Probar reenviando el mismo payload a propósito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La idempotencia es una propiedad que solo existe si se prueba, porque no aparece en ninguna prueba de camino feliz. Un handler completamente desprotegido pasa todas las pruebas que envían cada evento una vez. La prueba que importa es la que envía dos veces y verifica que el estado del mundo después de la segunda es idéntico al estado después de la primera, no apenas que la respuesta fue 200.',
        },
        {
          type: 'code',
          value: `// test/webhook-idempotency.test.js
// La prueba que demuestra la propiedad: el estado tras N entregas del
// mismo evento es igual al estado tras 1. Comparar el ESTADO, no la respuesta.
import { handleWebhook } from '../webhook/handler.js';

test('la entrega repetida no duplica el efecto', async () => {
  const event = paymentSucceeded({ orderId: 'ord_1', chargeId: 'ch_1' });

  const first = await handleWebhook(event, db);
  const stateAfterFirst = await snapshot(db, 'ord_1');

  // Misma entrega, tres veces mas, incluso en paralelo.
  const repeats = await Promise.all([
    handleWebhook(event, db),
    handleWebhook(event, db),
    handleWebhook(event, db),
  ]);

  expect(first.body).toBe('processed');
  expect(repeats.every((r) => r.status === 200)).toBe(true);
  expect(repeats.filter((r) => r.body === 'processed')).toHaveLength(0);
  expect(await snapshot(db, 'ord_1')).toEqual(stateAfterFirst);
  expect(await db.countOutbox('ord_1')).toBe(1); // un correo, no cuatro
});

test('un evento distinto con el mismo efecto tambien colapsa', async () => {
  // El proveedor anuncia el mismo pago por dos tipos de evento.
  await handleWebhook(paymentSucceeded({ orderId: 'ord_2', chargeId: 'ch_2' }), db);
  const after = await snapshot(db, 'ord_2');

  const result = await handleWebhook(
    invoicePaid({ orderId: 'ord_2', chargeId: 'ch_2' }), // id de evento distinto
    db,
  );

  expect(result.body).toBe('duplicate');
  expect(await snapshot(db, 'ord_2')).toEqual(after);
});

test('un evento fuera de orden no regresa el estado', async () => {
  await handleWebhook(refunded({ orderId: 'ord_3', at: '10:02' }), db);
  await handleWebhook(paymentSucceeded({ orderId: 'ord_3', at: '10:00' }), db);

  expect((await snapshot(db, 'ord_3')).status).toBe('refunded');
});`,
        },
        {
          type: 'paragraph',
          value:
            'Las tres pruebas cubren las tres fallas distintas discutidas acá, y vale notar que la segunda fallaría en un sistema que deduplica por identificador del evento, y la tercera fallaría en un sistema perfectamente idempotente que ignore el orden. Son propiedades independientes: ninguna implica la otra, y un handler correcto necesita las dos. Correr estas pruebas en paralelo, como en el primer caso, es lo que expone la carrera entre el SELECT y el INSERT cuando alguien, meses después, intente simplificar la reserva de clave.',
        },
        {
          type: 'list',
          items: [
            'Reenviá el mismo payload en paralelo, no solo en secuencia: la versión secuencial pasa incluso con la implementación de SELECT antes del INSERT.',
            'Compará el estado final de la base, no el código de respuesta: un handler roto devuelve 200 en las dos entregas y acredita dos veces.',
            'Incluí un par de eventos distintos que describen el mismo efecto, para demostrar que la clave es del efecto y no del mensaje.',
            'Incluí un evento antiguo después de uno nuevo, para demostrar que la guarda de orden existe y no fue removida en algún refactor.',
            'Contá las filas en la tabla de salida, porque es ahí donde el duplicado se convierte en un correo enviado dos veces a un cliente real.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Por qué deduplicar por el identificador del evento del proveedor no alcanza?',
      answer:
        'Porque el identificador del evento identifica el mensaje, y lo que tiene que ocurrir a lo sumo una vez es el efecto. Los proveedores de pago suelen anunciar el mismo cambio de estado a través de más de un tipo de evento, por ejemplo un evento de pago aprobado y otro de factura pagada referidos al mismo cobro, cada uno con su propio identificador. Un handler que deduplica por id de evento ve dos mensajes distintos, procesa los dos y aplica el efecto dos veces, incluso con la deduplicación instalada y funcionando exactamente como fue escrita. La clave correcta se deriva de la transición de dominio que vas a aplicar, del recurso afectado y de la referencia externa del cobro, de modo que cualquier evento que describa ese mismo efecto colapse en la misma clave. El identificador del evento sigue valiendo la pena guardarlo, pero como registro de auditoría de qué entrega ganó la carrera, no como criterio de deduplicación.',
    },
    {
      question: '¿Cuál es el problema de consultar si la clave ya existe antes de procesar?',
      answer:
        'El problema es la ventana entre la consulta y la escritura. Si dos entregas del mismo evento llegan casi juntas, ya sea porque el proveedor reentregó rápido o porque dos instancias de tu servicio recibieron la misma entrega, las dos consultas corren antes de que ocurra cualquier escritura, las dos encuentran la clave ausente y las dos siguen al procesamiento. El efecto se duplica con el código de deduplicación presente y aparentemente correcto, y el bug solo aparece bajo concurrencia, lo que lo vuelve uno de los más difíciles de reproducir después. La forma correcta es invertirlo: la transacción empieza insertando la clave en una tabla con restricción de unicidad, y quien recibe la violación sabe que perdió la carrera y responde éxito sin procesar. La exclusión mutua pasa a ser responsabilidad de la base de datos, que lo resuelve de forma atómica, en vez de depender de una secuencia de dos operaciones en tu código.',
    },
    {
      question: '¿Cómo enviar un correo o llamar a una API externa sin romper la garantía?',
      answer:
        'No haciéndolo dentro del handler. Toda la garantía depende de que la clave de idempotencia y el efecto se guarden en la misma transacción, y una llamada externa no participa de esa transacción: si comiteás y después enviás, una caída en el medio deja la clave registrada sin que el envío haya ocurrido, y la reentrega siguiente es correctamente rechazada como duplicado, así que el cliente nunca recibe nada mientras la tabla afirma que sí. El patrón que lo resuelve es guardar, en la misma transacción, una fila en una tabla de salida describiendo el mensaje a enviar, y dejar que un worker separado lea esa tabla y haga el envío real, marcando cada fila como entregada. Así el webhook queda enteramente transaccional y la intención de enviar hereda la durabilidad de la base. El worker tiene que ser seguro para reejecución por la misma razón, así que el envío lleva su propia clave de idempotencia derivada del identificador de la fila, y el servicio externo resuelve el duplicado de su lado.',
    },
  ],
  conclusion: {
    title: 'El handler seguro es el que asume que va a correr de nuevo',
    description:
      'El webhook de pago entrega al menos una vez, y ningún código del lado del handler cambia ese contrato. Lo que vos controlás es la segunda ejecución: si reconoce el efecto ya aplicado, la reentrega es inofensiva; si no lo reconoce, cada timeout del proveedor se convierte en un cobro duplicado en la cuenta de un cliente real. Puedo revisar o diseñar la capa de idempotencia de tus integraciones de pago, definiendo la clave a partir del efecto y no del evento, moviendo la exclusión mutua a una restricción de la base, agregando la guarda de orden que impide la regresión de estado y sacando los envíos externos de dentro de la transacción, con las pruebas de reentrega que demuestran que el duplicado no pasa.',
    cta: 'Hablar sobre idempotencia en mis webhooks de pago',
  },
  related: [
    {
      label: 'Webhooks de WhatsApp: idempotencia y colas',
      to: '/blog/webhook-whatsapp-idempotencia-filas',
    },
    {
      label: 'Idempotencia en tool use: evitar la acción duplicada del agente',
      to: '/blog/idempotencia-tool-use-evitar-acao-duplicada-agente',
    },
    { label: 'Automatización e integraciones', to: '/servicos/automacao-e-integracoes' },
  ],
};

export default { pt, en, es };
