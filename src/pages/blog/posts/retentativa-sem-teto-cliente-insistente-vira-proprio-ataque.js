// Conteudo do artigo: retentativa sem teto e o cliente legitimo que, ao
// insistir sem limite, produz no servidor o mesmo efeito de um ataque.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A dependência de pagamentos ficou fora do ar por doze minutos. Quando ela voltou, o serviço não voltou junto: passou as três horas seguintes recebendo nove vezes o tráfego normal, com a CPU no teto, a fila de conexões cheia e a taxa de erro alta o bastante para manter a situação exatamente como estava. O time de segurança olhou os gráficos e abriu um incidente de negação de serviço. Não havia atacante. Oitenta e cinco por cento daquele tráfego vinha de clientes legítimos repetindo pedidos que tinham falhado: uma versão do aplicativo que tentava de novo a cada segundo sem limite, a integração de um parceiro que reenviava o lote inteiro a cada falha parcial, uma fila de sincronização offline que esvaziou em todos os celulares no mesmo minuto em que a rede voltou. Este artigo é sobre o lado do servidor desse problema: por que a retentativa sem teto de clientes que você não controla transforma uma queda curta em uma longa, por que o tráfego resultante tem a assinatura de um ataque e não pode ser tratado como um, como enxergar a repetição do lado do servidor quando o cliente não avisa que está repetindo, qual contrato de resposta ensina o cliente a parar, como descartar tentativas antes de pedidos originais quando a capacidade acaba, e o que corrigir na origem quando o cliente insistente é o seu próprio aplicativo.',
  sections: [
    {
      title: 'A queda termina e o tráfego não volta ao normal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O comportamento esperado depois de uma falha curta é uma recuperação curta: a dependência volta, as requisições voltam a ter sucesso e o tráfego retorna ao patamar anterior em alguns minutos. O que aconteceu nesse incidente foi diferente, e a diferença está na população de clientes. Durante os doze minutos de falha, cada cliente que recebeu erro não desistiu. Ele guardou o pedido e continuou tentando, e cada tentativa que falhou gerou outra. Quando a dependência voltou, o serviço não encontrou o tráfego normal esperando por ele: encontrou o tráfego normal somado a doze minutos de pedidos acumulados, todos chegando ao mesmo tempo.',
        },
        {
          type: 'paragraph',
          value:
            'Esse volume é suficiente para derrubar o serviço de novo, e aí está o mecanismo que prolonga o incidente. Com o serviço sobrecarregado, uma parte das requisições volta a falhar por tempo esgotado, e cada falha gera uma nova tentativa, que chega a um serviço ainda mais sobrecarregado. O sistema entra em um estado estável que não é o saudável: a carga que o mantém caído é produzida pela própria queda. Ele só sai desse estado quando alguém reduz a carga de fora, desligando uma rota, bloqueando um cliente ou esperando que os usuários desistam por conta própria.',
        },
        {
          type: 'diagram',
          value: `Tráfego recebido pelo servico (1x = pico normal de uma terca-feira)

  9x |              ##
     |              ####
  6x |              ######   ###
     |              ######## #####  ###
  3x |              ###############  ######  ##
     |              #########################  ###
  1x |##########################################################
     +-----+--------+--------+--------+--------+--------+-------
         14:00    14:12    14:40    15:10    16:00    17:10
                 volta a    |        |        |        normal
               dependencia  +-- serviço recai por sobrecarga, repete
                                a cada onda de tentativas sincronizadas

  Queda da dependencia: 12 minutos
  Queda percebida pelo usuario: 3 horas e 10 minutos
  Participacao de repeticoes no pico: 85% das requisicoes recebidas`,
        },
        {
          type: 'paragraph',
          value:
            'Visto de fora, o gráfico é idêntico ao de um ataque volumétrico, e a reação instintiva é tratá-lo como um: ativar a regra do firewall de aplicação, bloquear os endereços com mais requisições, ligar o desafio contra robôs. As três medidas pioram o problema. Os endereços com mais requisições são os clientes mais importantes, como a integração do maior parceiro, que envia muito porque vende muito. O desafio contra robôs quebra o aplicativo e as integrações, que não conseguem resolvê-lo, e transforma a falha temporária em falha permanente para quem estava apenas repetindo um pedido legítimo. O tráfego é abusivo no efeito e legítimo na origem, e a defesa precisa separar as duas coisas.',
        },
      ],
    },
    {
      title: 'De onde vem a insistência sem teto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quase nenhum cliente foi escrito para insistir para sempre. A insistência sem teto surge da combinação de decisões individualmente razoáveis, tomadas em camadas diferentes por pessoas diferentes, cada uma assumindo que as outras não repetem. Conhecer as fontes importa porque cada uma pede uma correção diferente, e várias delas estão fora do alcance do time que opera o servidor.',
        },
        {
          type: 'table',
          columns: ['Fonte', 'Como a repetição acontece', 'Por que não tem teto', 'Quem pode corrigir'],
          rows: [
            [
              'Aplicativo em versão antiga',
              'Laço de repetição com intervalo fixo ao falhar',
              'A versão com o defeito continua instalada por meses em aparelhos que não atualizam',
              'Você, mas só para versões futuras',
            ],
            [
              'SDK sobre SDK',
              'O código do cliente repete e a biblioteca embaixo dele também repete',
              'Cada camada tem teto próprio, e os tetos se multiplicam em vez de se somar',
              'Quem integra, se souber que a biblioteca repete',
            ],
            [
              'Integração de parceiro em lote',
              'Uma falha parcial faz o lote inteiro ser reenviado',
              'O agendador roda de novo no próximo ciclo com o lote acumulado, que só cresce',
              'O parceiro, com a sua orientação',
            ],
            [
              'Fila de sincronização offline',
              'O aparelho guarda pedidos enquanto está sem rede e envia tudo ao reconectar',
              'Todos os aparelhos reconectam juntos quando a falha termina',
              'Você, no aplicativo',
            ],
            [
              'Consumidor de fila com reentrega',
              'A mensagem que falhou volta para a fila e é processada de novo',
              'Sem contador de entregas nem fila de mensagens mortas, a mesma mensagem volta indefinidamente',
              'Você, na configuração do consumidor',
            ],
            [
              'Repetição de erro determinístico',
              'O cliente repete qualquer erro, inclusive requisição inválida ou não autorizada',
              'O pedido nunca vai ter sucesso, então nenhuma condição encerra o laço',
              'Quem escreveu o cliente, com um contrato de erro claro',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda linha da tabela é a que produz os números mais altos, porque o efeito é multiplicativo. Se o código do aplicativo faz até três tentativas, a biblioteca HTTP embaixo dele faz outras três para cada uma, o proxy de saída da rede corporativa repete duas vezes em caso de conexão reiniciada e a mensagem chegou de uma fila que reentrega até cinco vezes, uma única ação do usuário pode produzir noventa chamadas no servidor. Nenhum dos quatro números parece exagerado isoladamente, e cada time que escolheu o seu tinha uma boa razão.',
        },
        {
          type: 'diagram',
          value: `Uma acao do usuario, quatro camadas que repetem sem saber umas das outras

  fila (ate 5 entregas)
    └─ codigo do app (ate 3 tentativas)
         └─ biblioteca HTTP (ate 3 tentativas)
              └─ proxy de saida (ate 2 tentativas)
                   └─ servidor

  Pior caso = 5 x 3 x 3 x 2 = 90 chamadas para 1 acao
  Durante a queda, com todas as tentativas falhando,
  o pior caso deixa de ser teorico e vira o caso comum.`,
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a mais barata de corrigir e a mais comum. Um cliente que repete um erro de validação vai repeti-lo para sempre, porque o mesmo corpo sempre produz o mesmo erro. Esse tráfego não aparece apenas durante incidentes: ele existe o tempo todo, em volume baixo, e passa despercebido porque o servidor responde rápido a requisições inválidas. Em uma auditoria típica, entre dois e cinco por cento do tráfego total de uma API pública é repetição de pedidos que nunca vão ter sucesso.',
        },
      ],
    },
    {
      title: 'Enxergar a repetição do lado do servidor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O servidor não sabe, por padrão, que uma requisição é uma repetição. Para ele, a décima tentativa do mesmo pedido é idêntica a uma requisição nova, e o painel mostra apenas o total. Essa cegueira é a razão pela qual o incidente do início foi classificado como ataque: sem saber quanto do tráfego era repetição, não havia como distinguir clientes insistentes de agressores. O primeiro passo da defesa é tornar a repetição visível, e existem duas fontes de informação para isso.',
        },
        {
          type: 'list',
          items: [
            'O que o cliente declara: um cabeçalho com o número da tentativa, que o seu SDK pode enviar e que você pode pedir aos parceiros que enviem. É barato e preciso, mas só existe para clientes que você controla ou convenceu.',
            'O que o servidor deduz: uma impressão digital da requisição, calculada a partir do cliente, da rota e da chave de idempotência ou do conteúdo do corpo, e comparada com as impressões recentes do mesmo cliente. Funciona para qualquer cliente, inclusive os que você não controla, com o custo de uma memória de curto prazo.',
          ],
        },
        {
          type: 'code',
          value: `// Deteccao de repeticao do lado do servidor, sem depender do cliente avisar.
// A impressao digital identifica "o mesmo pedido" dentro de uma janela curta,
// e a razao de repeticao por cliente vira metrica e criterio de descarte.
import { createHash } from 'node:crypto';

const JANELA_MS = 60_000;
const impressoesRecentes = new Map(); // impressao -> { visto_em, vezes }

// O corpo cru precisa ser guardado pelo parser, por exemplo:
// app.use(express.json({ verify: (req, _res, buf) => { req.corpoBruto = buf; } }));
function impressaoDaRequisicao(req) {
  const chaveIdempotencia = req.get('idempotency-key');
  const partes = chaveIdempotencia
    ? [req.clienteId, chaveIdempotencia]
    : [
        req.clienteId,
        req.method,
        req.path,
        createHash('sha256').update(req.corpoBruto || '').digest('hex'),
      ];
  return createHash('sha256').update(partes.join('|')).digest('base64url');
}

export function detectarRepeticao(req, _res, next) {
  const agora = Date.now();
  const impressao = impressaoDaRequisicao(req);
  const anterior = impressoesRecentes.get(impressao);
  const declarada = Number(req.get('x-tentativa') || 0);

  const repetida = declarada > 0 || (anterior && agora - anterior.visto_em < JANELA_MS);
  const vezes = anterior ? anterior.vezes + 1 : 1;
  impressoesRecentes.set(impressao, { visto_em: agora, vezes });

  // Disponivel para o controle de admissao e para o log estruturado.
  req.repeticao = { repetida: Boolean(repetida), vezes, declarada };

  metricas.increment('requisicoes_total', {
    cliente: req.clienteId,
    repetida: String(Boolean(repetida)),
  });
  next();
}

// Limpeza periodica: sem ela o mapa cresce com o trafego e vira o proximo
// problema de memoria. unref() evita que o timer segure o processo aberto.
setInterval(() => {
  const limite = Date.now() - JANELA_MS;
  for (const [impressao, dado] of impressoesRecentes) {
    if (dado.visto_em < limite) impressoesRecentes.delete(impressao);
  }
}, JANELA_MS).unref();`,
        },
        {
          type: 'paragraph',
          value:
            'Com a métrica rotulada por cliente e pelo indicador de repetição, a razão de repetição passa a ser o sinal mais útil do painel durante um incidente. Em operação normal ela fica abaixo de dois ou três por cento. Quando uma dependência falha, ela sobe, e o valor dela na recuperação responde a pergunta que o time de segurança não conseguiu responder: se oitenta por cento do tráfego é repetição de pedidos de clientes conhecidos, não é ataque, é demanda acumulada, e a resposta certa é organizar a fila e não bloquear a porta.',
        },
        {
          type: 'paragraph',
          value:
            'Duas ressalvas sobre a implementação. O mapa em memória funciona por instância, o que é suficiente para métrica e para descarte local, porque a razão de repetição de uma amostra é representativa do todo; um armazenamento compartilhado só se justifica se a decisão precisar ser exata entre instâncias. E a impressão pelo conteúdo do corpo pode marcar como repetidos dois pedidos legítimos idênticos, como duas consultas iguais em sequência, o que é aceitável para um sinal estatístico e é o motivo pelo qual a chave de idempotência, quando existe, tem precedência.',
        },
      ],
    },
    {
      title: 'O contrato de resposta que ensina o cliente a parar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um cliente só consegue parar de insistir se a resposta disser a ele que deve parar e por quanto tempo. A maioria das APIs responde a sobrecarga com um código genérico de erro de servidor, sem corpo e sem indicação de espera, e deixa para cada cliente a decisão sobre o que fazer. Com essa resposta, o comportamento de cada cliente depende inteiramente de quem o escreveu, e o pior deles define a carga que o servidor recebe. O contrato de resposta existe para reduzir essa variação.',
        },
        {
          type: 'table',
          columns: ['Situação', 'Código', 'O que a resposta deve dizer', 'O que o cliente deve fazer'],
          rows: [
            [
              'Limite do cliente excedido',
              '429',
              'Retry-After com o tempo até a cota se renovar',
              'Esperar pelo menos o tempo indicado; não repetir antes',
            ],
            [
              'Servidor sobrecarregado ou dependência fora',
              '503',
              'Retry-After com variação aleatória por cliente',
              'Esperar o tempo indicado, que já vem espalhado',
            ],
            [
              'Requisição inválida ou incompleta',
              '400 ou 422',
              'Campo repetivel igual a false e o motivo em formato legível por máquina',
              'Nunca repetir o mesmo corpo; corrigir ou descartar',
            ],
            [
              'Credencial inválida ou sem permissão',
              '401 ou 403',
              'Campo repetivel igual a false',
              'Nunca repetir; renovar a credencial uma vez e parar se falhar de novo',
            ],
            [
              'Conflito com estado atual',
              '409',
              'O estado atual ou onde consultá-lo',
              'Consultar o estado antes de decidir; repetir cegamente não resolve',
            ],
            [
              'Tempo esgotado em operação não idempotente',
              '504',
              'Identificador para consultar o resultado',
              'Consultar o resultado antes de repetir, para não duplicar o efeito',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O detalhe mais importante da tabela está na segunda linha. Se o servidor responde a todos os clientes com Retry-After de trinta segundos, ele não evitou a onda, apenas marcou a hora dela: todos os clientes que obedecem voltam juntos daqui a trinta segundos. O tempo de espera precisa ser espalhado pelo próprio servidor, porque não dá para confiar que cada cliente vai adicionar variação aleatória por conta própria. E a variação precisa ser estável por cliente, para que o mesmo cliente não receba um valor diferente a cada tentativa e acabe sempre escolhendo o menor.',
        },
        {
          type: 'code',
          value: `// Resposta de sobrecarga que espalha as tentativas no tempo em vez de
// marcar a hora da proxima onda. O deslocamento e deterministico por cliente:
// cada um recebe sempre a mesma fatia da janela.
import { createHash } from 'node:crypto';

const ESPERA_BASE_S = 10;
const JANELA_ESPALHAMENTO_S = 50;

function deslocamentoDoCliente(clienteId) {
  const hash = createHash('sha256').update(String(clienteId)).digest();
  return hash.readUInt32BE(0) % JANELA_ESPALHAMENTO_S;
}

export function responderSobrecarga(req, res, motivo) {
  const esperaS = ESPERA_BASE_S + deslocamentoDoCliente(req.clienteId);

  res.set('Retry-After', String(esperaS));
  return res.status(503).json({
    erro: motivo,
    repetivel: true,
    tentar_apos_s: esperaS,
    // Quantas vezes vimos este mesmo pedido: ajuda quem investiga do lado do
    // cliente a perceber que o laco de repeticao dele nao tem teto.
    tentativas_observadas: req.repeticao?.vezes ?? 1,
  });
}

export function responderErroDeterministico(res, status, codigo, detalhe) {
  // Sem Retry-After de proposito: a mesma requisicao vai falhar do mesmo jeito.
  return res.status(status).json({ erro: codigo, repetivel: false, detalhe });
}`,
        },
        {
          type: 'paragraph',
          value:
            'O campo repetivel no corpo resolve um problema que o código de status sozinho não resolve. Muitas bibliotecas de cliente decidem se repetem pela faixa do código, repetindo tudo que é da família cinco e nada da família quatro, o que funciona mal nas bordas: um 409 às vezes merece nova tentativa depois de consultar o estado, e um 500 causado por um corpo que quebra o servidor nunca vai ter sucesso. Um campo explícito, documentado e testado no contrato da API, transfere a decisão para quem tem a informação, que é o servidor.',
        },
      ],
    },
    {
      title: 'Descartar tentativas antes de pedidos originais quando a capacidade acaba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O contrato de resposta reduz a insistência dos clientes que obedecem. Os que não obedecem, como a versão antiga do aplicativo que ninguém consegue atualizar, continuam chegando, e o servidor precisa de uma forma de proteger a capacidade que resta para quem ainda não foi atendido. A ideia central é que, sob sobrecarga, nem toda requisição vale o mesmo: um pedido original de um usuário que acabou de chegar tem mais valor que a décima tentativa de um pedido que já falhou nove vezes, porque a chance de a décima tentativa virar um resultado útil é menor e o custo que ela impõe ao sistema é o mesmo.',
        },
        {
          type: 'paragraph',
          value:
            'O controle de admissão abaixo implementa essa prioridade com dois limiares de concorrência. Abaixo do primeiro, tudo entra. Entre o primeiro e o segundo, só entram pedidos originais, e as repetições recebem a resposta de sobrecarga com espera espalhada. Acima do segundo, nada entra. A rejeição acontece antes de qualquer trabalho caro, o que é essencial: rejeitar depois de consultar o banco não economiza nada.',
        },
        {
          type: 'code',
          value: `// Controle de admissao que descarta repeticoes antes de pedidos originais.
// Usa a marcacao feita por detectarRepeticao e a resposta de responderSobrecarga.
import { responderSobrecarga } from './respostas.js';

const CAPACIDADE = 200;                                // requisicoes simultaneas sustentaveis
const LIMIAR_REPETICOES = Math.floor(CAPACIDADE * 0.7); // acima disso, repeticao nao entra

let emAndamento = 0;

export function controleDeAdmissao(req, res, next) {
  const repetida = req.repeticao?.repetida === true;

  if (emAndamento >= CAPACIDADE) {
    metricas.increment('admissao_rejeitada', { motivo: 'capacidade', repetida: String(repetida) });
    return responderSobrecarga(req, res, 'capacidade_esgotada');
  }

  if (repetida && emAndamento >= LIMIAR_REPETICOES) {
    // Os 30% finais da capacidade ficam reservados para pedidos novos.
    metricas.increment('admissao_rejeitada', { motivo: 'reserva', repetida: 'true' });
    return responderSobrecarga(req, res, 'repeticao_adiada');
  }

  emAndamento += 1;
  let liberado = false;
  const liberar = () => {
    // finish e close podem disparar os dois; o contador so pode cair uma vez.
    if (liberado) return;
    liberado = true;
    emAndamento -= 1;
  };
  res.on('finish', liberar);
  res.on('close', liberar);
  next();
}

// Ordem no pipeline: identificar cliente -> detectarRepeticao -> controleDeAdmissao
// -> rotas. A deteccao precisa vir antes para a admissao conseguir priorizar.`,
        },
        {
          type: 'paragraph',
          value:
            'O efeito desse mecanismo sobre a recuperação é desproporcional ao tamanho dele. No incidente do início, o serviço gastava a maior parte da capacidade processando repetições que falhavam por tempo esgotado, o que produzia mais repetições. Com a reserva, a fatia de capacidade destinada a pedidos originais continua funcionando mesmo no pico, os usuários novos são atendidos, e as repetições são empurradas para frente no tempo de forma espalhada, drenando a demanda acumulada em vez de se somarem a ela.',
        },
        {
          type: 'paragraph',
          value:
            'Esse controle convive com o limite de taxa por cliente, mas resolve outro problema. O limite de taxa protege o serviço de um cliente que consome mais do que o combinado em condições normais. O controle de admissão por tipo de requisição protege o serviço dele mesmo, no momento em que a capacidade encolheu e a demanda acumulada chegou toda de uma vez. Um cliente perfeitamente dentro da sua cota pode, junto com outros mil clientes dentro das cotas deles, produzir a onda que derruba o serviço na volta.',
        },
      ],
    },
    {
      title: 'Corrigir na origem quando o cliente insistente é o seu',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Tudo o que foi descrito até aqui é defesa. Quando o cliente insistente é o seu próprio aplicativo ou o SDK que você distribui para parceiros, existe uma correção mais barata e mais definitiva: dar teto à insistência na origem. O teto tem quatro componentes, e faltar qualquer um deles reabre o problema por um caminho diferente.',
        },
        {
          type: 'code',
          value: `// Cliente com teto de insistencia: numero maximo de tentativas, prazo total,
// espera com variacao aleatoria completa, respeito ao Retry-After e parada
// imediata em erro que o servidor declarou como nao repetivel.
const PADRAO = {
  tentativasMax: 4,        // incluindo a primeira
  prazoTotalMs: 20_000,    // depois disso desiste, mesmo com tentativas sobrando
  esperaBaseMs: 500,
  esperaMaxMs: 8_000,
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function lerRepetivel(resposta) {
  if (resposta.status === 429 || resposta.status === 503) return true;
  if (resposta.status < 500) return false;
  try {
    const corpo = await resposta.clone().json();
    return corpo.repetivel !== false;
  } catch {
    return true; // 5xx sem corpo legivel: tratado como transitorio
  }
}

export async function chamarComTeto(url, opcoes = {}, config = PADRAO) {
  const inicio = Date.now();

  for (let tentativa = 0; tentativa < config.tentativasMax; tentativa += 1) {
    const resposta = await fetch(url, {
      ...opcoes,
      headers: { ...opcoes.headers, 'x-tentativa': String(tentativa) },
    });

    if (resposta.ok) return resposta;
    if (!(await lerRepetivel(resposta))) return resposta; // erro deterministico: para aqui

    // Retry-After do servidor tem precedencia sobre o calculo local.
    const retryAfterS = Number(resposta.headers.get('retry-after'));
    const exponencial = Math.min(config.esperaMaxMs, config.esperaBaseMs * 2 ** tentativa);
    const espera = Number.isFinite(retryAfterS) && retryAfterS > 0
      ? retryAfterS * 1000
      : Math.random() * exponencial; // variacao completa: espalha os clientes

    const ultima = tentativa === config.tentativasMax - 1;
    if (ultima || Date.now() - inicio + espera > config.prazoTotalMs) return resposta;

    await esperar(espera);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O prazo total é o componente mais esquecido. Um número máximo de tentativas sem prazo total permite que um servidor que manda esperar sessenta segundos a cada resposta segure o cliente por quatro minutos, com o usuário olhando para uma tela carregando. E um prazo total sem número máximo permite dezenas de tentativas rápidas quando o servidor falha instantaneamente. Os dois limites juntos definem um envelope que o usuário e o servidor conseguem prever.',
        },
        {
          type: 'ordered',
          items: [
            'Coloque o teto em uma única camada. Se o código do aplicativo repete, desligue a repetição da biblioteca HTTP embaixo dele, e documente no SDK distribuído a parceiros que ele já repete, para que o código deles não repita por cima.',
            'Dê à fila de sincronização offline um envio espalhado na reconexão: um atraso aleatório inicial de alguns segundos a alguns minutos, proporcional ao tamanho da fila, em vez de enviar tudo no instante em que a rede volta.',
            'Mantenha um interruptor remoto que reduz ou desliga as repetições do aplicativo por configuração, sem publicar versão nova, porque durante o incidente não há tempo para passar pela loja de aplicativos.',
            'Registre a versão do cliente em toda requisição e defina uma versão mínima suportada, com resposta clara para versões abaixo dela, para conseguir retirar de circulação a versão com o laço sem teto.',
            'Configure o consumidor de fila com número máximo de entregas e fila de mensagens mortas, e trate o aumento dela como alerta, não como depósito.',
            'Escreva um teste que simula o servidor respondendo 503 com Retry-After e verifica quantas chamadas o cliente fez e quanto tempo levou, porque sem teste o teto é removido na primeira refatoração.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro item é o que decide quanto dura o próximo incidente causado pelo aplicativo. Uma versão com defeito no laço de repetição leva semanas para sair dos aparelhos, e durante esse tempo a única alavanca disponível é o que o aplicativo lê do servidor. Um aplicativo que consulta, ao iniciar e periodicamente, um documento de configuração com o número máximo de tentativas e a espera mínima pode ser corrigido em minutos, mesmo em versões antigas, desde que a leitura dessa configuração tenha existido antes do defeito.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como diferenciar um cliente legítimo insistente de um ataque de verdade durante o incidente?',
      answer:
        'Pelo conteúdo do tráfego, não pelo volume. Um ataque volumétrico e uma onda de repetições legítimas têm o mesmo gráfico de requisições por segundo, mas diferem em quatro sinais que podem ser verificados em poucos minutos se a instrumentação existir antes do incidente. O primeiro é a razão de repetição: repetições legítimas são o mesmo pedido chegando várias vezes, com a mesma impressão digital ou a mesma chave de idempotência, enquanto tráfego de ataque costuma variar parâmetros para escapar de cache e de deduplicação. O segundo é a identidade: repetições legítimas vêm autenticadas, de clientes que já existiam antes do incidente e com a distribuição de clientes parecida com a de um dia normal, apenas multiplicada. O terceiro é a correlação temporal: a onda legítima começa no instante em que a dependência falhou ou voltou, e as ondas seguintes têm intervalo compatível com o laço de repetição de uma versão específica do cliente, o que aparece claramente quando o tráfego é agrupado pela versão declarada. O quarto é a rota: repetições se concentram nas rotas que falharam, enquanto ataques costumam mirar as mais caras ou a raiz. Quando os quatro sinais apontam para demanda acumulada, a resposta é o controle de admissão com prioridade para pedidos originais e a espera espalhada no Retry-After. Quando apontam para ataque, as ferramentas de proteção de borda são adequadas. O erro caro é aplicar a segunda resposta ao primeiro caso, porque desafios e bloqueios por endereço transformam a falha temporária do maior cliente em falha permanente.',
    },
    {
      question: 'O servidor pode confiar que o cliente vai respeitar o Retry-After?',
      answer:
        'Não, e o desenho da defesa deve partir do pressuposto de que uma parte relevante dos clientes vai ignorá-lo. O Retry-After é uma instrução, não uma imposição, e a obediência depende de o cliente ter sido escrito para lê-lo, o que muitas bibliotecas HTTP não fazem por padrão e muitas integrações feitas às pressas nunca implementam. Isso não torna o cabeçalho inútil: nos clientes que você controla e nos parceiros que você orienta, ele é a ferramenta mais eficaz para espalhar a demanda no tempo, e costuma cobrir a maior parte do volume. Para os clientes que ignoram, a camada seguinte é o controle de admissão, que rejeita as repetições deles antes de qualquer trabalho caro, a um custo por rejeição de microssegundos. A combinação é o que funciona: o cabeçalho reduz a quantidade de repetições que chega, e o controle de admissão garante que as que chegam mesmo assim não consumam a capacidade reservada aos pedidos novos. Um passo adicional, útil para parceiros, é registrar por cliente a taxa de requisições que chegam antes do tempo indicado no último Retry-After. Esse número, apresentado ao parceiro com datas e exemplos, costuma resolver em uma conversa um problema que meses de incidentes não resolveram, porque torna visível que o laço de repetição dele não tem teto.',
    },
    {
      question: 'Qual é o número certo de tentativas e a espera certa para um cliente?',
      answer:
        'O número certo é pequeno e a espera certa é definida pelo prazo que o usuário tolera, não pela vontade de conseguir a resposta a qualquer custo. Para chamadas interativas, em que um usuário espera diante da tela, três ou quatro tentativas no total, com espera exponencial e variação aleatória completa começando em algumas centenas de milissegundos e um prazo total entre dez e trinta segundos, cobrem as falhas transitórias que realmente se resolvem sozinhas, como uma conexão reiniciada ou uma instância reiniciando. Falhas que duram mais do que isso não são transitórias do ponto de vista do usuário, e continuar tentando só adia a mensagem de erro e adiciona carga ao servidor que está tentando se recuperar. Para trabalho em segundo plano, como sincronização ou envio de lotes, o número de tentativas pode ser maior e as esperas podem chegar a minutos, desde que exista um prazo final depois do qual o item vai para uma fila de revisão, e não volta ao início do laço. Em ambos os casos, três regras independem dos números: não repetir erros declarados como não repetíveis, obedecer ao Retry-After quando ele existir, e manter a repetição em uma única camada da pilha. Se for preciso um número para começar, quatro tentativas no total com vinte segundos de prazo para chamadas interativas é um ponto de partida defensável, a ser ajustado pela distribuição real de duração das falhas transitórias que o seu serviço observa.',
    },
  ],
  conclusion: {
    title: 'Insistência sem teto é demanda acumulada, e demanda acumulada precisa de fila, não de porta fechada',
    description:
      'A queda de doze minutos que vira indisponibilidade de três horas não é causada pelo servidor nem pela dependência: é causada pela soma de clientes legítimos que repetem sem teto, cada um com uma decisão razoável e nenhum com a visão do todo. O tráfego resultante parece ataque e precisa ser tratado como demanda. Tornar a repetição visível com impressão digital e cabeçalho de tentativa, responder com Retry-After espalhado por cliente e com um campo explícito de repetível, reservar capacidade para pedidos originais quando ela acaba, e dar teto à insistência na origem dos clientes que você controla transformam a recuperação em algo que acontece em minutos, sem depender de o último usuário desistir. Posso instrumentar a razão de repetição no seu serviço, desenhar o contrato de resposta e o controle de admissão para a sua capacidade real, e revisar o laço de repetição do seu aplicativo e do SDK que você distribui antes do próximo incidente.',
    cta: 'Falar sobre a resiliência da minha API',
  },
  related: [
    {
      label: 'Timeout mal calibrado: quando tentar de novo piora o incidente',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Limite de taxa por cliente na borda: proteger o serviço sem punir o parceiro certo',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The payments dependency was down for twelve minutes. When it came back, the service did not come back with it: it spent the next three hours receiving nine times its normal traffic, with CPU pegged, the connection queue full and an error rate high enough to keep things exactly as they were. The security team looked at the graphs and opened a denial of service incident. There was no attacker. Eighty-five percent of that traffic came from legitimate clients repeating requests that had failed: an app version that retried every second with no limit, a partner integration that resent the entire batch on every partial failure, an offline sync queue that drained on every phone in the same minute the network came back. This article is about the server side of that problem: why unbounded retries from clients you do not control turn a short outage into a long one, why the resulting traffic has the signature of an attack and cannot be treated as one, how to see repetition on the server side when the client does not say it is retrying, which response contract teaches the client to stop, how to shed retries before original requests when capacity runs out, and what to fix at the source when the insistent client is your own app.',
  sections: [
    {
      title: 'The outage ends and traffic does not return to normal',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The expected behavior after a short failure is a short recovery: the dependency comes back, requests succeed again and traffic returns to its previous level within a few minutes. What happened in this incident was different, and the difference lies in the client population. During the twelve minutes of failure, each client that got an error did not give up. It kept the request and kept trying, and every failed attempt generated another. When the dependency came back, the service did not find normal traffic waiting for it: it found normal traffic plus twelve minutes of accumulated requests, all arriving at once.',
        },
        {
          type: 'paragraph',
          value:
            'That volume is enough to take the service down again, and that is the mechanism that prolongs the incident. With the service overloaded, part of the requests fail again by timeout, and each failure produces a new attempt, which reaches an even more overloaded service. The system enters a stable state that is not the healthy one: the load keeping it down is produced by the outage itself. It only leaves that state when someone reduces load from the outside, by turning off a route, blocking a client or waiting for users to give up on their own.',
        },
        {
          type: 'diagram',
          value: `Traffic received by the service (1x = normal Tuesday peak)

  9x |              ##
     |              ####
  6x |              ######   ###
     |              ######## #####  ###
  3x |              ###############  ######  ##
     |              #########################  ###
  1x |##############################################################
     +-----+--------+--------+--------+--------+--------+-------
         14:00    14:12    14:40    15:10    16:00    17:10
                dependency  |        |        |        normal
                comes back  +-- service falls again from overload, repeats
                                with each wave of synchronized attempts

  Dependency outage: 12 minutes
  Outage perceived by users: 3 hours and 10 minutes
  Share of retries at peak: 85% of received requests`,
        },
        {
          type: 'paragraph',
          value:
            'From the outside the graph is identical to a volumetric attack, and the instinctive reaction is to treat it as one: turn on the web application firewall rule, block the addresses with the most requests, enable the bot challenge. All three measures make the problem worse. The addresses with the most requests are the most important clients, such as the largest partner integration, which sends a lot because it sells a lot. The bot challenge breaks the app and the integrations, which cannot solve it, and turns a temporary failure into a permanent one for anyone who was simply repeating a legitimate request. The traffic is abusive in effect and legitimate in origin, and the defense has to separate the two.',
        },
      ],
    },
    {
      title: 'Where unbounded insistence comes from',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Almost no client was written to insist forever. Unbounded insistence arises from the combination of individually reasonable decisions, made in different layers by different people, each assuming the others do not retry. Knowing the sources matters because each one calls for a different fix, and several of them are out of reach of the team that runs the server.',
        },
        {
          type: 'table',
          columns: ['Source', 'How the repetition happens', 'Why it has no ceiling', 'Who can fix it'],
          rows: [
            [
              'Old app version',
              'Retry loop with a fixed interval on failure',
              'The buggy version stays installed for months on devices that do not update',
              'You, but only for future versions',
            ],
            [
              'SDK on top of SDK',
              'Client code retries and the library underneath retries too',
              'Each layer has its own ceiling, and the ceilings multiply instead of adding up',
              'The integrator, if they know the library retries',
            ],
            [
              'Partner batch integration',
              'A partial failure makes the whole batch be resent',
              'The scheduler runs again on the next cycle with the accumulated batch, which only grows',
              'The partner, with your guidance',
            ],
            [
              'Offline sync queue',
              'The device stores requests while offline and sends everything on reconnect',
              'Every device reconnects together when the failure ends',
              'You, in the app',
            ],
            [
              'Queue consumer with redelivery',
              'The failed message goes back to the queue and is processed again',
              'Without a delivery counter or dead letter queue, the same message comes back indefinitely',
              'You, in the consumer configuration',
            ],
            [
              'Retrying a deterministic error',
              'The client retries any error, including invalid or unauthorized requests',
              'The request will never succeed, so no condition ends the loop',
              'Whoever wrote the client, with a clear error contract',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second row of the table produces the highest numbers, because the effect is multiplicative. If the app code makes up to three attempts, the HTTP library underneath makes another three for each, the corporate network egress proxy retries twice on a reset connection and the message came from a queue that redelivers up to five times, a single user action can produce ninety calls on the server. None of the four numbers looks excessive on its own, and each team that chose theirs had a good reason.',
        },
        {
          type: 'diagram',
          value: `One user action, four layers retrying without knowing about each other

  queue (up to 5 deliveries)
    └─ app code (up to 3 attempts)
         └─ HTTP library (up to 3 attempts)
              └─ egress proxy (up to 2 attempts)
                   └─ server

  Worst case = 5 x 3 x 3 x 2 = 90 calls for 1 action
  During the outage, with every attempt failing,
  the worst case stops being theoretical and becomes the common case.`,
        },
        {
          type: 'paragraph',
          value:
            'The last row is the cheapest to fix and the most common. A client that retries a validation error will retry it forever, because the same body always produces the same error. That traffic does not only show up during incidents: it exists all the time, at low volume, and goes unnoticed because the server answers invalid requests quickly. In a typical audit, between two and five percent of the total traffic of a public API is repetition of requests that will never succeed.',
        },
      ],
    },
    {
      title: 'Seeing repetition on the server side',
      blocks: [
        {
          type: 'paragraph',
          value:
            'By default the server does not know a request is a repetition. To it, the tenth attempt of the same request is identical to a new one, and the dashboard shows only the total. That blindness is why the incident at the beginning was classified as an attack: without knowing how much of the traffic was repetition, there was no way to tell insistent clients from attackers. The first step of the defense is making repetition visible, and there are two sources of information for that.',
        },
        {
          type: 'list',
          items: [
            'What the client declares: a header with the attempt number, which your SDK can send and which you can ask partners to send. It is cheap and precise, but it only exists for clients you control or have convinced.',
            'What the server infers: a fingerprint of the request, computed from the client, the route and the idempotency key or the body content, and compared with the same client recent fingerprints. It works for any client, including those you do not control, at the cost of a short term memory.',
          ],
        },
        {
          type: 'code',
          value: `// Server side repetition detection, without relying on the client to say so.
// The fingerprint identifies "the same request" within a short window, and the
// per client repetition ratio becomes a metric and a shedding criterion.
import { createHash } from 'node:crypto';

const WINDOW_MS = 60_000;
const recentFingerprints = new Map(); // fingerprint -> { seen_at, times }

// The raw body has to be kept by the parser, for example:
// app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
function requestFingerprint(req) {
  const idempotencyKey = req.get('idempotency-key');
  const parts = idempotencyKey
    ? [req.clientId, idempotencyKey]
    : [
        req.clientId,
        req.method,
        req.path,
        createHash('sha256').update(req.rawBody || '').digest('hex'),
      ];
  return createHash('sha256').update(parts.join('|')).digest('base64url');
}

export function detectRepetition(req, _res, next) {
  const now = Date.now();
  const fingerprint = requestFingerprint(req);
  const previous = recentFingerprints.get(fingerprint);
  const declared = Number(req.get('x-attempt') || 0);

  const repeated = declared > 0 || (previous && now - previous.seen_at < WINDOW_MS);
  const times = previous ? previous.times + 1 : 1;
  recentFingerprints.set(fingerprint, { seen_at: now, times });

  // Available to admission control and to the structured log.
  req.repetition = { repeated: Boolean(repeated), times, declared };

  metrics.increment('requests_total', {
    client: req.clientId,
    repeated: String(Boolean(repeated)),
  });
  next();
}

// Periodic cleanup: without it the map grows with traffic and becomes the next
// memory problem. unref() keeps the timer from holding the process open.
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [fingerprint, entry] of recentFingerprints) {
    if (entry.seen_at < cutoff) recentFingerprints.delete(fingerprint);
  }
}, WINDOW_MS).unref();`,
        },
        {
          type: 'paragraph',
          value:
            'With the metric labeled by client and by the repetition flag, the repetition ratio becomes the most useful signal on the dashboard during an incident. In normal operation it stays below two or three percent. When a dependency fails it climbs, and its value during recovery answers the question the security team could not: if eighty percent of the traffic is repetition of requests from known clients, it is not an attack, it is accumulated demand, and the right answer is to organize the queue, not to shut the door.',
        },
        {
          type: 'paragraph',
          value:
            'Two caveats about the implementation. The in-memory map works per instance, which is enough for metrics and for local shedding, because the repetition ratio of a sample is representative of the whole; a shared store is only justified if the decision must be exact across instances. And fingerprinting by body content can mark two identical legitimate requests as repeated, such as two equal queries in sequence, which is acceptable for a statistical signal and is why the idempotency key, when present, takes precedence.',
        },
      ],
    },
    {
      title: 'The response contract that teaches the client to stop',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A client can only stop insisting if the response tells it to stop and for how long. Most APIs answer overload with a generic server error code, no body and no wait indication, and leave each client to decide what to do. With that response, each client behavior depends entirely on whoever wrote it, and the worst of them defines the load the server receives. The response contract exists to reduce that variation.',
        },
        {
          type: 'table',
          columns: ['Situation', 'Code', 'What the response should say', 'What the client should do'],
          rows: [
            [
              'Client limit exceeded',
              '429',
              'Retry-After with the time until the quota renews',
              'Wait at least the indicated time; do not retry sooner',
            ],
            [
              'Server overloaded or dependency down',
              '503',
              'Retry-After with random spread per client',
              'Wait the indicated time, which already comes spread out',
            ],
            [
              'Invalid or incomplete request',
              '400 or 422',
              'A retryable field set to false and the reason in machine readable form',
              'Never repeat the same body; fix it or discard it',
            ],
            [
              'Invalid credential or no permission',
              '401 or 403',
              'A retryable field set to false',
              'Never repeat; refresh the credential once and stop if it fails again',
            ],
            [
              'Conflict with current state',
              '409',
              'The current state or where to query it',
              'Query the state before deciding; blind retries do not help',
            ],
            [
              'Timeout on a non idempotent operation',
              '504',
              'An identifier to query the result',
              'Query the result before retrying, so the effect is not duplicated',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most important detail of the table is in the second row. If the server answers every client with a thirty second Retry-After, it has not avoided the wave, it has only scheduled it: every client that obeys comes back together thirty seconds later. The wait time has to be spread by the server itself, because you cannot trust each client to add randomness on its own. And the spread has to be stable per client, so the same client does not get a different value on each attempt and end up always picking the smallest one.',
        },
        {
          type: 'code',
          value: `// Overload response that spreads attempts over time instead of scheduling
// the next wave. The offset is deterministic per client: each one always gets
// the same slice of the window.
import { createHash } from 'node:crypto';

const BASE_WAIT_S = 10;
const SPREAD_WINDOW_S = 50;

function clientOffset(clientId) {
  const hash = createHash('sha256').update(String(clientId)).digest();
  return hash.readUInt32BE(0) % SPREAD_WINDOW_S;
}

export function respondOverload(req, res, reason) {
  const waitS = BASE_WAIT_S + clientOffset(req.clientId);

  res.set('Retry-After', String(waitS));
  return res.status(503).json({
    error: reason,
    retryable: true,
    retry_after_s: waitS,
    // How many times we saw this same request: helps whoever investigates on
    // the client side notice that their retry loop has no ceiling.
    observed_attempts: req.repetition?.times ?? 1,
  });
}

export function respondDeterministicError(res, status, code, detail) {
  // No Retry-After on purpose: the same request will fail the same way.
  return res.status(status).json({ error: code, retryable: false, detail });
}`,
        },
        {
          type: 'paragraph',
          value:
            'The retryable field in the body solves a problem the status code alone does not. Many client libraries decide whether to retry by the code range, retrying everything in the five hundreds and nothing in the four hundreds, which works poorly at the edges: a 409 sometimes deserves a new attempt after querying state, and a 500 caused by a body that breaks the server will never succeed. An explicit field, documented and tested in the API contract, moves the decision to whoever has the information, which is the server.',
        },
      ],
    },
    {
      title: 'Shedding retries before original requests when capacity runs out',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The response contract reduces insistence from clients that obey. Those that do not, like the old app version nobody can update, keep arriving, and the server needs a way to protect the remaining capacity for those who have not been served yet. The central idea is that, under overload, not every request is worth the same: an original request from a user who just arrived is worth more than the tenth attempt of a request that has already failed nine times, because the chance of the tenth attempt producing a useful result is lower and the cost it imposes on the system is the same.',
        },
        {
          type: 'paragraph',
          value:
            'The admission control below implements that priority with two concurrency thresholds. Below the first, everything gets in. Between the first and the second, only original requests get in, and repetitions receive the overload response with spread wait. Above the second, nothing gets in. The rejection happens before any expensive work, which is essential: rejecting after querying the database saves nothing.',
        },
        {
          type: 'code',
          value: `// Admission control that sheds repetitions before original requests.
// Uses the flag set by detectRepetition and the response from respondOverload.
import { respondOverload } from './responses.js';

const CAPACITY = 200;                                   // sustainable concurrent requests
const RETRY_THRESHOLD = Math.floor(CAPACITY * 0.7);     // above this, retries do not get in

let inFlight = 0;

export function admissionControl(req, res, next) {
  const repeated = req.repetition?.repeated === true;

  if (inFlight >= CAPACITY) {
    metrics.increment('admission_rejected', { reason: 'capacity', repeated: String(repeated) });
    return respondOverload(req, res, 'capacity_exhausted');
  }

  if (repeated && inFlight >= RETRY_THRESHOLD) {
    // The last 30% of capacity is reserved for new requests.
    metrics.increment('admission_rejected', { reason: 'reserve', repeated: 'true' });
    return respondOverload(req, res, 'retry_deferred');
  }

  inFlight += 1;
  let released = false;
  const release = () => {
    // finish and close can both fire; the counter must only drop once.
    if (released) return;
    released = true;
    inFlight -= 1;
  };
  res.on('finish', release);
  res.on('close', release);
  next();
}

// Pipeline order: identify client -> detectRepetition -> admissionControl
// -> routes. Detection has to come first so admission can prioritize.`,
        },
        {
          type: 'paragraph',
          value:
            'The effect of this mechanism on recovery is out of proportion to its size. In the opening incident, the service spent most of its capacity processing repetitions that failed by timeout, which produced more repetitions. With the reserve, the slice of capacity meant for original requests keeps working even at peak, new users get served, and repetitions are pushed forward in time in a spread way, draining the accumulated demand instead of adding to it.',
        },
        {
          type: 'paragraph',
          value:
            'This control coexists with per client rate limiting, but it solves a different problem. Rate limiting protects the service from a client consuming more than agreed under normal conditions. Admission control by request type protects the service from itself, at the moment capacity has shrunk and accumulated demand arrived all at once. A client perfectly within its quota can, together with a thousand other clients within theirs, produce the wave that takes the service down on the way back.',
        },
      ],
    },
    {
      title: 'Fixing it at the source when the insistent client is yours',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Everything described so far is defense. When the insistent client is your own app or the SDK you distribute to partners, there is a cheaper and more definitive fix: put a ceiling on insistence at the source. The ceiling has four components, and missing any one of them reopens the problem through a different path.',
        },
        {
          type: 'code',
          value: `// Client with a ceiling on insistence: maximum attempts, total deadline,
// wait with full random jitter, honoring Retry-After and stopping immediately
// on an error the server declared as not retryable.
const DEFAULTS = {
  maxAttempts: 4,          // including the first
  totalDeadlineMs: 20_000, // gives up after this, even with attempts left
  baseWaitMs: 500,
  maxWaitMs: 8_000,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function readRetryable(response) {
  if (response.status === 429 || response.status === 503) return true;
  if (response.status < 500) return false;
  try {
    const body = await response.clone().json();
    return body.retryable !== false;
  } catch {
    return true; // 5xx without a readable body: treated as transient
  }
}

export async function callWithCeiling(url, options = {}, config = DEFAULTS) {
  const start = Date.now();

  for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, 'x-attempt': String(attempt) },
    });

    if (response.ok) return response;
    if (!(await readRetryable(response))) return response; // deterministic error: stop here

    // The server Retry-After takes precedence over the local computation.
    const retryAfterS = Number(response.headers.get('retry-after'));
    const exponential = Math.min(config.maxWaitMs, config.baseWaitMs * 2 ** attempt);
    const wait = Number.isFinite(retryAfterS) && retryAfterS > 0
      ? retryAfterS * 1000
      : Math.random() * exponential; // full jitter: spreads clients apart

    const last = attempt === config.maxAttempts - 1;
    if (last || Date.now() - start + wait > config.totalDeadlineMs) return response;

    await sleep(wait);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The total deadline is the most forgotten component. A maximum number of attempts with no total deadline lets a server that says to wait sixty seconds on every response hold the client for four minutes, with the user staring at a loading screen. And a total deadline with no maximum number of attempts allows dozens of fast attempts when the server fails instantly. Both limits together define an envelope that both the user and the server can predict.',
        },
        {
          type: 'ordered',
          items: [
            'Put the ceiling in a single layer. If the app code retries, turn off retries in the HTTP library underneath it, and document in the SDK you distribute to partners that it already retries, so their code does not retry on top of it.',
            'Give the offline sync queue a spread send on reconnect: an initial random delay of a few seconds to a few minutes, proportional to the queue size, instead of sending everything the instant the network comes back.',
            'Keep a remote switch that reduces or disables app retries through configuration, without shipping a new version, because during the incident there is no time to go through the app store.',
            'Record the client version on every request and define a minimum supported version, with a clear response for versions below it, so you can retire the version with the unbounded loop.',
            'Configure the queue consumer with a maximum number of deliveries and a dead letter queue, and treat its growth as an alert, not as storage.',
            'Write a test that simulates the server answering 503 with Retry-After and checks how many calls the client made and how long it took, because without a test the ceiling gets removed in the first refactor.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third item decides how long the next app caused incident lasts. A version with a bug in its retry loop takes weeks to leave devices, and during that time the only lever available is what the app reads from the server. An app that reads, at startup and periodically, a configuration document with the maximum number of attempts and the minimum wait can be fixed in minutes, even in old versions, as long as reading that configuration existed before the bug.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do you tell an insistent legitimate client from a real attack during the incident?',
      answer:
        'By the content of the traffic, not the volume. A volumetric attack and a wave of legitimate retries have the same requests per second graph, but they differ in four signals that can be checked in a few minutes if the instrumentation exists before the incident. The first is the repetition ratio: legitimate retries are the same request arriving several times, with the same fingerprint or the same idempotency key, while attack traffic usually varies parameters to escape caching and deduplication. The second is identity: legitimate retries come authenticated, from clients that existed before the incident, with a client distribution similar to a normal day, only multiplied. The third is timing correlation: the legitimate wave starts the instant the dependency failed or came back, and the following waves have intervals compatible with the retry loop of a specific client version, which shows clearly when traffic is grouped by declared version. The fourth is the route: retries concentrate on the routes that failed, while attacks tend to target the most expensive ones or the root. When all four signals point to accumulated demand, the answer is admission control with priority for original requests and spread wait in Retry-After. When they point to an attack, edge protection tools are appropriate. The expensive mistake is applying the second answer to the first case, because challenges and address blocks turn the largest client temporary failure into a permanent one.',
    },
    {
      question: 'Can the server trust the client to honor Retry-After?',
      answer:
        'No, and the defense design should start from the assumption that a relevant share of clients will ignore it. Retry-After is an instruction, not an enforcement, and obedience depends on the client having been written to read it, which many HTTP libraries do not do by default and many rushed integrations never implement. That does not make the header useless: in the clients you control and in the partners you guide, it is the most effective tool for spreading demand over time, and it usually covers most of the volume. For clients that ignore it, the next layer is admission control, which rejects their retries before any expensive work, at a per rejection cost of microseconds. The combination is what works: the header reduces the number of retries that arrive, and admission control ensures that the ones arriving anyway do not consume the capacity reserved for new requests. An additional step, useful with partners, is recording per client the rate of requests that arrive before the time indicated in the last Retry-After. That number, presented to the partner with dates and examples, often solves in one conversation a problem that months of incidents did not, because it makes visible that their retry loop has no ceiling.',
    },
    {
      question: 'What is the right number of attempts and the right wait for a client?',
      answer:
        'The right number is small and the right wait is defined by the deadline the user tolerates, not by the desire to get the answer at any cost. For interactive calls, where a user waits in front of the screen, three or four attempts in total, with exponential wait and full random jitter starting at a few hundred milliseconds and a total deadline between ten and thirty seconds, cover the transient failures that genuinely resolve themselves, such as a reset connection or an instance restarting. Failures that last longer than that are not transient from the user point of view, and continuing to try only postpones the error message and adds load to the server trying to recover. For background work, such as sync or batch submission, the number of attempts can be higher and waits can reach minutes, provided there is a final deadline after which the item goes to a review queue and does not return to the start of the loop. In both cases, three rules are independent of the numbers: do not retry errors declared as not retryable, honor Retry-After when present, and keep retries in a single layer of the stack. If you need a number to start with, four attempts in total with a twenty second deadline for interactive calls is a defensible starting point, to be adjusted by the real distribution of transient failure durations your service observes.',
    },
  ],
  conclusion: {
    title: 'Unbounded insistence is accumulated demand, and accumulated demand needs a queue, not a closed door',
    description:
      'The twelve minute outage that becomes three hours of unavailability is not caused by the server or the dependency: it is caused by the sum of legitimate clients retrying with no ceiling, each with a reasonable decision and none with a view of the whole. The resulting traffic looks like an attack and must be treated as demand. Making repetition visible with a fingerprint and an attempt header, answering with a Retry-After spread per client and an explicit retryable field, reserving capacity for original requests when it runs out, and putting a ceiling on insistence at the source of the clients you control turn recovery into something that happens in minutes, without depending on the last user giving up. I can instrument the repetition ratio in your service, design the response contract and admission control for your real capacity, and review the retry loop of your app and of the SDK you distribute before the next incident.',
    cta: 'Talk about my API resilience',
  },
  related: [
    {
      label: 'Badly calibrated timeouts: when retrying makes the incident worse',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Per customer rate limiting at the edge: protecting the service without punishing the right partner',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Observability and reliability',
      to: '/services/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'La dependencia de pagos estuvo caída doce minutos. Cuando volvió, el servicio no volvió con ella: pasó las tres horas siguientes recibiendo nueve veces el tráfico normal, con la CPU al tope, la cola de conexiones llena y una tasa de error lo bastante alta como para mantener la situación exactamente igual. El equipo de seguridad miró los gráficos y abrió un incidente de denegación de servicio. No había atacante. El ochenta y cinco por ciento de ese tráfico venía de clientes legítimos repitiendo peticiones que habían fallado: una versión de la aplicación que reintentaba cada segundo sin límite, la integración de un socio que reenviaba el lote entero ante cada fallo parcial, una cola de sincronización offline que se vació en todos los teléfonos en el mismo minuto en que volvió la red. Este artículo trata del lado del servidor de ese problema: por qué el reintento sin techo de clientes que no controlas convierte una caída corta en una larga, por qué el tráfico resultante tiene la firma de un ataque y no puede tratarse como tal, cómo ver la repetición del lado del servidor cuando el cliente no avisa que está reintentando, qué contrato de respuesta le enseña al cliente a detenerse, cómo descartar reintentos antes que peticiones originales cuando se acaba la capacidad, y qué corregir en el origen cuando el cliente insistente es tu propia aplicación.',
  sections: [
    {
      title: 'La caída termina y el tráfico no vuelve a la normalidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El comportamiento esperado después de un fallo corto es una recuperación corta: la dependencia vuelve, las peticiones vuelven a tener éxito y el tráfico regresa al nivel anterior en pocos minutos. Lo que pasó en este incidente fue distinto, y la diferencia está en la población de clientes. Durante los doce minutos de fallo, cada cliente que recibió un error no se rindió. Guardó la petición y siguió intentando, y cada intento fallido generó otro. Cuando la dependencia volvió, el servicio no encontró el tráfico normal esperándolo: encontró el tráfico normal sumado a doce minutos de peticiones acumuladas, todas llegando al mismo tiempo.',
        },
        {
          type: 'paragraph',
          value:
            'Ese volumen alcanza para tumbar el servicio de nuevo, y ahí está el mecanismo que prolonga el incidente. Con el servicio sobrecargado, una parte de las peticiones vuelve a fallar por tiempo agotado, y cada fallo genera un nuevo intento, que llega a un servicio todavía más sobrecargado. El sistema entra en un estado estable que no es el saludable: la carga que lo mantiene caído la produce la propia caída. Solo sale de ese estado cuando alguien reduce la carga desde fuera, apagando una ruta, bloqueando un cliente o esperando a que los usuarios se rindan por su cuenta.',
        },
        {
          type: 'diagram',
          value: `Trafico recibido por el servicio (1x = pico normal de un martes)

  9x |              ##
     |              ####
  6x |              ######   ###
     |              ######## #####  ###
  3x |              ###############  ######  ##
     |              #########################  ###
  1x |##############################################################
     +-----+--------+--------+--------+--------+--------+-------
         14:00    14:12    14:40    15:10    16:00    17:10
                vuelve la   |        |        |        normal
               dependencia  +-- el servicio recae por sobrecarga, se repite
                                con cada ola de intentos sincronizados

  Caida de la dependencia: 12 minutos
  Caida percibida por el usuario: 3 horas y 10 minutos
  Participacion de reintentos en el pico: 85% de las peticiones recibidas`,
        },
        {
          type: 'paragraph',
          value:
            'Visto desde fuera, el gráfico es idéntico al de un ataque volumétrico, y la reacción instintiva es tratarlo como tal: activar la regla del firewall de aplicaciones, bloquear las direcciones con más peticiones, encender el desafío contra bots. Las tres medidas empeoran el problema. Las direcciones con más peticiones son los clientes más importantes, como la integración del mayor socio, que envía mucho porque vende mucho. El desafío contra bots rompe la aplicación y las integraciones, que no pueden resolverlo, y convierte el fallo temporal en un fallo permanente para quien solo estaba repitiendo una petición legítima. El tráfico es abusivo en el efecto y legítimo en el origen, y la defensa tiene que separar las dos cosas.',
        },
      ],
    },
    {
      title: 'De dónde viene la insistencia sin techo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Casi ningún cliente se escribió para insistir para siempre. La insistencia sin techo surge de la combinación de decisiones razonables por separado, tomadas en capas distintas por personas distintas, cada una suponiendo que las demás no reintentan. Conocer las fuentes importa porque cada una pide una corrección distinta, y varias están fuera del alcance del equipo que opera el servidor.',
        },
        {
          type: 'table',
          columns: ['Fuente', 'Cómo ocurre la repetición', 'Por qué no tiene techo', 'Quién puede corregirla'],
          rows: [
            [
              'Aplicación en versión antigua',
              'Bucle de reintento con intervalo fijo al fallar',
              'La versión con el defecto sigue instalada durante meses en dispositivos que no se actualizan',
              'Tú, pero solo para versiones futuras',
            ],
            [
              'SDK sobre SDK',
              'El código del cliente reintenta y la biblioteca de abajo también',
              'Cada capa tiene su propio techo, y los techos se multiplican en lugar de sumarse',
              'Quien integra, si sabe que la biblioteca reintenta',
            ],
            [
              'Integración de socio por lotes',
              'Un fallo parcial hace que se reenvíe el lote entero',
              'El planificador vuelve a correr en el siguiente ciclo con el lote acumulado, que solo crece',
              'El socio, con tu orientación',
            ],
            [
              'Cola de sincronización offline',
              'El dispositivo guarda peticiones sin red y envía todo al reconectar',
              'Todos los dispositivos se reconectan juntos cuando termina el fallo',
              'Tú, en la aplicación',
            ],
            [
              'Consumidor de cola con reentrega',
              'El mensaje que falló vuelve a la cola y se procesa otra vez',
              'Sin contador de entregas ni cola de mensajes muertos, el mismo mensaje vuelve indefinidamente',
              'Tú, en la configuración del consumidor',
            ],
            [
              'Reintento de un error determinista',
              'El cliente reintenta cualquier error, incluso peticiones inválidas o no autorizadas',
              'La petición nunca va a tener éxito, así que ninguna condición cierra el bucle',
              'Quien escribió el cliente, con un contrato de error claro',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda fila de la tabla es la que produce los números más altos, porque el efecto es multiplicativo. Si el código de la aplicación hace hasta tres intentos, la biblioteca HTTP de abajo hace otros tres por cada uno, el proxy de salida de la red corporativa reintenta dos veces ante una conexión reiniciada y el mensaje vino de una cola que reentrega hasta cinco veces, una única acción del usuario puede producir noventa llamadas en el servidor. Ninguno de los cuatro números parece exagerado por separado, y cada equipo que eligió el suyo tenía una buena razón.',
        },
        {
          type: 'diagram',
          value: `Una accion del usuario, cuatro capas que reintentan sin saber de las otras

  cola (hasta 5 entregas)
    └─ codigo de la app (hasta 3 intentos)
         └─ biblioteca HTTP (hasta 3 intentos)
              └─ proxy de salida (hasta 2 intentos)
                   └─ servidor

  Peor caso = 5 x 3 x 3 x 2 = 90 llamadas por 1 accion
  Durante la caida, con todos los intentos fallando,
  el peor caso deja de ser teorico y se vuelve el caso comun.`,
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la más barata de corregir y la más común. Un cliente que reintenta un error de validación va a reintentarlo para siempre, porque el mismo cuerpo siempre produce el mismo error. Ese tráfico no aparece solo durante incidentes: existe todo el tiempo, en volumen bajo, y pasa desapercibido porque el servidor responde rápido a peticiones inválidas. En una auditoría típica, entre el dos y el cinco por ciento del tráfico total de una API pública es repetición de peticiones que nunca van a tener éxito.',
        },
      ],
    },
    {
      title: 'Ver la repetición del lado del servidor',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Por defecto, el servidor no sabe que una petición es una repetición. Para él, el décimo intento de la misma petición es idéntico a una petición nueva, y el panel muestra solo el total. Esa ceguera es la razón por la que el incidente del principio se clasificó como ataque: sin saber cuánto del tráfico era repetición, no había forma de distinguir clientes insistentes de atacantes. El primer paso de la defensa es hacer visible la repetición, y hay dos fuentes de información para eso.',
        },
        {
          type: 'list',
          items: [
            'Lo que el cliente declara: una cabecera con el número de intento, que tu SDK puede enviar y que puedes pedir a los socios que envíen. Es barata y precisa, pero solo existe para los clientes que controlas o convenciste.',
            'Lo que el servidor deduce: una huella de la petición, calculada a partir del cliente, la ruta y la clave de idempotencia o el contenido del cuerpo, y comparada con las huellas recientes del mismo cliente. Funciona para cualquier cliente, incluidos los que no controlas, con el costo de una memoria de corto plazo.',
          ],
        },
        {
          type: 'code',
          value: `// Deteccion de repeticion del lado del servidor, sin depender de que el cliente avise.
// La huella identifica "la misma peticion" dentro de una ventana corta, y la
// razon de repeticion por cliente se vuelve metrica y criterio de descarte.
import { createHash } from 'node:crypto';

const VENTANA_MS = 60_000;
const huellasRecientes = new Map(); // huella -> { visto_en, veces }

// El cuerpo crudo tiene que guardarlo el parser, por ejemplo:
// app.use(express.json({ verify: (req, _res, buf) => { req.cuerpoCrudo = buf; } }));
function huellaDeLaPeticion(req) {
  const claveIdempotencia = req.get('idempotency-key');
  const partes = claveIdempotencia
    ? [req.clienteId, claveIdempotencia]
    : [
        req.clienteId,
        req.method,
        req.path,
        createHash('sha256').update(req.cuerpoCrudo || '').digest('hex'),
      ];
  return createHash('sha256').update(partes.join('|')).digest('base64url');
}

export function detectarRepeticion(req, _res, next) {
  const ahora = Date.now();
  const huella = huellaDeLaPeticion(req);
  const anterior = huellasRecientes.get(huella);
  const declarada = Number(req.get('x-intento') || 0);

  const repetida = declarada > 0 || (anterior && ahora - anterior.visto_en < VENTANA_MS);
  const veces = anterior ? anterior.veces + 1 : 1;
  huellasRecientes.set(huella, { visto_en: ahora, veces });

  // Disponible para el control de admision y para el log estructurado.
  req.repeticion = { repetida: Boolean(repetida), veces, declarada };

  metricas.increment('peticiones_total', {
    cliente: req.clienteId,
    repetida: String(Boolean(repetida)),
  });
  next();
}

// Limpieza periodica: sin ella el mapa crece con el trafico y se vuelve el
// proximo problema de memoria. unref() evita que el timer mantenga vivo el proceso.
setInterval(() => {
  const limite = Date.now() - VENTANA_MS;
  for (const [huella, dato] of huellasRecientes) {
    if (dato.visto_en < limite) huellasRecientes.delete(huella);
  }
}, VENTANA_MS).unref();`,
        },
        {
          type: 'paragraph',
          value:
            'Con la métrica etiquetada por cliente y por el indicador de repetición, la razón de repetición pasa a ser la señal más útil del panel durante un incidente. En operación normal se mantiene por debajo del dos o tres por ciento. Cuando una dependencia falla, sube, y su valor durante la recuperación responde la pregunta que el equipo de seguridad no pudo responder: si el ochenta por ciento del tráfico es repetición de peticiones de clientes conocidos, no es un ataque, es demanda acumulada, y la respuesta correcta es ordenar la cola y no cerrar la puerta.',
        },
        {
          type: 'paragraph',
          value:
            'Dos salvedades sobre la implementación. El mapa en memoria funciona por instancia, lo que basta para la métrica y para el descarte local, porque la razón de repetición de una muestra es representativa del total; un almacenamiento compartido solo se justifica si la decisión tiene que ser exacta entre instancias. Y la huella por contenido del cuerpo puede marcar como repetidas dos peticiones legítimas idénticas, como dos consultas iguales seguidas, lo que es aceptable para una señal estadística y es la razón por la que la clave de idempotencia, cuando existe, tiene prioridad.',
        },
      ],
    },
    {
      title: 'El contrato de respuesta que le enseña al cliente a detenerse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un cliente solo puede dejar de insistir si la respuesta le dice que debe detenerse y durante cuánto tiempo. La mayoría de las APIs responde a la sobrecarga con un código genérico de error de servidor, sin cuerpo y sin indicación de espera, y deja a cada cliente la decisión sobre qué hacer. Con esa respuesta, el comportamiento de cada cliente depende por completo de quien lo escribió, y el peor de ellos define la carga que recibe el servidor. El contrato de respuesta existe para reducir esa variación.',
        },
        {
          type: 'table',
          columns: ['Situación', 'Código', 'Qué debe decir la respuesta', 'Qué debe hacer el cliente'],
          rows: [
            [
              'Límite del cliente excedido',
              '429',
              'Retry-After con el tiempo hasta que se renueve la cuota',
              'Esperar al menos el tiempo indicado; no reintentar antes',
            ],
            [
              'Servidor sobrecargado o dependencia caída',
              '503',
              'Retry-After con variación aleatoria por cliente',
              'Esperar el tiempo indicado, que ya viene repartido',
            ],
            [
              'Petición inválida o incompleta',
              '400 o 422',
              'Campo reintentable en falso y el motivo en formato legible por máquina',
              'Nunca repetir el mismo cuerpo; corregirlo o descartarlo',
            ],
            [
              'Credencial inválida o sin permiso',
              '401 o 403',
              'Campo reintentable en falso',
              'Nunca repetir; renovar la credencial una vez y parar si vuelve a fallar',
            ],
            [
              'Conflicto con el estado actual',
              '409',
              'El estado actual o dónde consultarlo',
              'Consultar el estado antes de decidir; reintentar a ciegas no resuelve',
            ],
            [
              'Tiempo agotado en una operación no idempotente',
              '504',
              'Un identificador para consultar el resultado',
              'Consultar el resultado antes de reintentar, para no duplicar el efecto',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El detalle más importante de la tabla está en la segunda fila. Si el servidor responde a todos los clientes con un Retry-After de treinta segundos, no evitó la ola, solo le puso hora: todos los clientes que obedecen vuelven juntos dentro de treinta segundos. El tiempo de espera tiene que repartirlo el propio servidor, porque no se puede confiar en que cada cliente agregue variación aleatoria por su cuenta. Y la variación tiene que ser estable por cliente, para que el mismo cliente no reciba un valor distinto en cada intento y termine eligiendo siempre el menor.',
        },
        {
          type: 'code',
          value: `// Respuesta de sobrecarga que reparte los intentos en el tiempo en lugar de
// ponerle hora a la proxima ola. El desplazamiento es determinista por cliente:
// cada uno recibe siempre la misma franja de la ventana.
import { createHash } from 'node:crypto';

const ESPERA_BASE_S = 10;
const VENTANA_REPARTO_S = 50;

function desplazamientoDelCliente(clienteId) {
  const hash = createHash('sha256').update(String(clienteId)).digest();
  return hash.readUInt32BE(0) % VENTANA_REPARTO_S;
}

export function responderSobrecarga(req, res, motivo) {
  const esperaS = ESPERA_BASE_S + desplazamientoDelCliente(req.clienteId);

  res.set('Retry-After', String(esperaS));
  return res.status(503).json({
    error: motivo,
    reintentable: true,
    reintentar_tras_s: esperaS,
    // Cuantas veces vimos esta misma peticion: ayuda a quien investiga del lado
    // del cliente a notar que su bucle de reintento no tiene techo.
    intentos_observados: req.repeticion?.veces ?? 1,
  });
}

export function responderErrorDeterminista(res, status, codigo, detalle) {
  // Sin Retry-After a proposito: la misma peticion va a fallar igual.
  return res.status(status).json({ error: codigo, reintentable: false, detalle });
}`,
        },
        {
          type: 'paragraph',
          value:
            'El campo reintentable en el cuerpo resuelve un problema que el código de estado solo no resuelve. Muchas bibliotecas cliente deciden si reintentan por el rango del código, reintentando todo lo de la familia quinientos y nada de la familia cuatrocientos, lo que funciona mal en los bordes: un 409 a veces merece un nuevo intento después de consultar el estado, y un 500 causado por un cuerpo que rompe el servidor nunca va a tener éxito. Un campo explícito, documentado y probado en el contrato de la API, traslada la decisión a quien tiene la información, que es el servidor.',
        },
      ],
    },
    {
      title: 'Descartar reintentos antes que peticiones originales cuando se acaba la capacidad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El contrato de respuesta reduce la insistencia de los clientes que obedecen. Los que no obedecen, como la versión antigua de la aplicación que nadie logra actualizar, siguen llegando, y el servidor necesita una forma de proteger la capacidad que queda para quienes todavía no fueron atendidos. La idea central es que, bajo sobrecarga, no todas las peticiones valen lo mismo: una petición original de un usuario que acaba de llegar vale más que el décimo intento de una petición que ya falló nueve veces, porque la probabilidad de que el décimo intento produzca un resultado útil es menor y el costo que impone al sistema es el mismo.',
        },
        {
          type: 'paragraph',
          value:
            'El control de admisión de abajo implementa esa prioridad con dos umbrales de concurrencia. Por debajo del primero, entra todo. Entre el primero y el segundo, solo entran peticiones originales, y las repeticiones reciben la respuesta de sobrecarga con espera repartida. Por encima del segundo, no entra nada. El rechazo ocurre antes de cualquier trabajo caro, lo que es esencial: rechazar después de consultar la base de datos no ahorra nada.',
        },
        {
          type: 'code',
          value: `// Control de admision que descarta repeticiones antes que peticiones originales.
// Usa la marca de detectarRepeticion y la respuesta de responderSobrecarga.
import { responderSobrecarga } from './respuestas.js';

const CAPACIDAD = 200;                                  // peticiones simultaneas sostenibles
const UMBRAL_REPETICIONES = Math.floor(CAPACIDAD * 0.7); // por encima, la repeticion no entra

let enCurso = 0;

export function controlDeAdmision(req, res, next) {
  const repetida = req.repeticion?.repetida === true;

  if (enCurso >= CAPACIDAD) {
    metricas.increment('admision_rechazada', { motivo: 'capacidad', repetida: String(repetida) });
    return responderSobrecarga(req, res, 'capacidad_agotada');
  }

  if (repetida && enCurso >= UMBRAL_REPETICIONES) {
    // El 30% final de la capacidad queda reservado para peticiones nuevas.
    metricas.increment('admision_rechazada', { motivo: 'reserva', repetida: 'true' });
    return responderSobrecarga(req, res, 'repeticion_aplazada');
  }

  enCurso += 1;
  let liberado = false;
  const liberar = () => {
    // finish y close pueden dispararse los dos; el contador solo puede bajar una vez.
    if (liberado) return;
    liberado = true;
    enCurso -= 1;
  };
  res.on('finish', liberar);
  res.on('close', liberar);
  next();
}

// Orden en el pipeline: identificar cliente -> detectarRepeticion -> controlDeAdmision
// -> rutas. La deteccion tiene que venir antes para que la admision pueda priorizar.`,
        },
        {
          type: 'paragraph',
          value:
            'El efecto de este mecanismo sobre la recuperación es desproporcionado respecto de su tamaño. En el incidente del principio, el servicio gastaba la mayor parte de la capacidad procesando repeticiones que fallaban por tiempo agotado, lo que producía más repeticiones. Con la reserva, la franja de capacidad destinada a peticiones originales sigue funcionando incluso en el pico, los usuarios nuevos son atendidos, y las repeticiones se empujan hacia adelante en el tiempo de forma repartida, drenando la demanda acumulada en lugar de sumarse a ella.',
        },
        {
          type: 'paragraph',
          value:
            'Este control convive con el límite de tasa por cliente, pero resuelve otro problema. El límite de tasa protege al servicio de un cliente que consume más de lo acordado en condiciones normales. El control de admisión por tipo de petición protege al servicio de sí mismo, en el momento en que la capacidad se encogió y la demanda acumulada llegó de golpe. Un cliente perfectamente dentro de su cuota puede, junto con otros mil clientes dentro de las suyas, producir la ola que tumba el servicio a la vuelta.',
        },
      ],
    },
    {
      title: 'Corregir en el origen cuando el cliente insistente es el tuyo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo lo descrito hasta aquí es defensa. Cuando el cliente insistente es tu propia aplicación o el SDK que distribuyes a socios, existe una corrección más barata y más definitiva: ponerle techo a la insistencia en el origen. El techo tiene cuatro componentes, y la falta de cualquiera de ellos reabre el problema por otro camino.',
        },
        {
          type: 'code',
          value: `// Cliente con techo de insistencia: numero maximo de intentos, plazo total,
// espera con variacion aleatoria completa, respeto al Retry-After y parada
// inmediata ante un error que el servidor declaro como no reintentable.
const POR_DEFECTO = {
  intentosMax: 4,          // incluido el primero
  plazoTotalMs: 20_000,    // despues de esto desiste, aunque queden intentos
  esperaBaseMs: 500,
  esperaMaxMs: 8_000,
};

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function leerReintentable(respuesta) {
  if (respuesta.status === 429 || respuesta.status === 503) return true;
  if (respuesta.status < 500) return false;
  try {
    const cuerpo = await respuesta.clone().json();
    return cuerpo.reintentable !== false;
  } catch {
    return true; // 5xx sin cuerpo legible: se trata como transitorio
  }
}

export async function llamarConTecho(url, opciones = {}, config = POR_DEFECTO) {
  const inicio = Date.now();

  for (let intento = 0; intento < config.intentosMax; intento += 1) {
    const respuesta = await fetch(url, {
      ...opciones,
      headers: { ...opciones.headers, 'x-intento': String(intento) },
    });

    if (respuesta.ok) return respuesta;
    if (!(await leerReintentable(respuesta))) return respuesta; // error determinista: para aqui

    // El Retry-After del servidor tiene prioridad sobre el calculo local.
    const retryAfterS = Number(respuesta.headers.get('retry-after'));
    const exponencial = Math.min(config.esperaMaxMs, config.esperaBaseMs * 2 ** intento);
    const espera = Number.isFinite(retryAfterS) && retryAfterS > 0
      ? retryAfterS * 1000
      : Math.random() * exponencial; // variacion completa: reparte a los clientes

    const ultimo = intento === config.intentosMax - 1;
    if (ultimo || Date.now() - inicio + espera > config.plazoTotalMs) return respuesta;

    await esperar(espera);
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El plazo total es el componente más olvidado. Un número máximo de intentos sin plazo total permite que un servidor que manda esperar sesenta segundos en cada respuesta retenga al cliente durante cuatro minutos, con el usuario mirando una pantalla de carga. Y un plazo total sin número máximo permite decenas de intentos rápidos cuando el servidor falla al instante. Los dos límites juntos definen un margen que el usuario y el servidor pueden prever.',
        },
        {
          type: 'ordered',
          items: [
            'Pon el techo en una sola capa. Si el código de la aplicación reintenta, desactiva el reintento de la biblioteca HTTP de abajo, y documenta en el SDK que distribuyes a socios que ya reintenta, para que su código no reintente encima.',
            'Dale a la cola de sincronización offline un envío repartido al reconectar: un retraso aleatorio inicial de unos segundos a unos minutos, proporcional al tamaño de la cola, en lugar de enviar todo en el instante en que vuelve la red.',
            'Mantén un interruptor remoto que reduce o desactiva los reintentos de la aplicación por configuración, sin publicar una versión nueva, porque durante el incidente no hay tiempo para pasar por la tienda de aplicaciones.',
            'Registra la versión del cliente en cada petición y define una versión mínima soportada, con una respuesta clara para las versiones por debajo, para poder retirar de circulación la versión con el bucle sin techo.',
            'Configura el consumidor de cola con un número máximo de entregas y una cola de mensajes muertos, y trata su crecimiento como alerta, no como depósito.',
            'Escribe una prueba que simula al servidor respondiendo 503 con Retry-After y verifica cuántas llamadas hizo el cliente y cuánto tardó, porque sin prueba el techo desaparece en la primera refactorización.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer punto es el que decide cuánto dura el próximo incidente causado por la aplicación. Una versión con un defecto en el bucle de reintento tarda semanas en salir de los dispositivos, y durante ese tiempo la única palanca disponible es lo que la aplicación lee del servidor. Una aplicación que consulta, al iniciar y periódicamente, un documento de configuración con el número máximo de intentos y la espera mínima puede corregirse en minutos, incluso en versiones antiguas, siempre que la lectura de esa configuración haya existido antes del defecto.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cómo diferenciar a un cliente legítimo insistente de un ataque real durante el incidente?',
      answer:
        'Por el contenido del tráfico, no por el volumen. Un ataque volumétrico y una ola de reintentos legítimos tienen el mismo gráfico de peticiones por segundo, pero difieren en cuatro señales que pueden verificarse en pocos minutos si la instrumentación existe antes del incidente. La primera es la razón de repetición: los reintentos legítimos son la misma petición llegando varias veces, con la misma huella o la misma clave de idempotencia, mientras que el tráfico de ataque suele variar parámetros para escapar de la caché y de la deduplicación. La segunda es la identidad: los reintentos legítimos llegan autenticados, de clientes que ya existían antes del incidente y con una distribución de clientes parecida a la de un día normal, solo multiplicada. La tercera es la correlación temporal: la ola legítima empieza en el instante en que la dependencia falló o volvió, y las olas siguientes tienen un intervalo compatible con el bucle de reintento de una versión específica del cliente, lo que se ve claramente cuando el tráfico se agrupa por la versión declarada. La cuarta es la ruta: los reintentos se concentran en las rutas que fallaron, mientras que los ataques suelen apuntar a las más caras o a la raíz. Cuando las cuatro señales apuntan a demanda acumulada, la respuesta es el control de admisión con prioridad para peticiones originales y la espera repartida en el Retry-After. Cuando apuntan a un ataque, las herramientas de protección de borde son adecuadas. El error caro es aplicar la segunda respuesta al primer caso, porque los desafíos y los bloqueos por dirección convierten el fallo temporal del mayor cliente en un fallo permanente.',
    },
    {
      question: '¿Puede el servidor confiar en que el cliente va a respetar el Retry-After?',
      answer:
        'No, y el diseño de la defensa debe partir de la premisa de que una parte relevante de los clientes lo va a ignorar. El Retry-After es una instrucción, no una imposición, y la obediencia depende de que el cliente haya sido escrito para leerlo, cosa que muchas bibliotecas HTTP no hacen por defecto y muchas integraciones hechas con prisa nunca implementan. Eso no vuelve inútil la cabecera: en los clientes que controlas y en los socios que orientas, es la herramienta más eficaz para repartir la demanda en el tiempo, y suele cubrir la mayor parte del volumen. Para los clientes que la ignoran, la capa siguiente es el control de admisión, que rechaza sus reintentos antes de cualquier trabajo caro, con un costo por rechazo de microsegundos. La combinación es lo que funciona: la cabecera reduce la cantidad de reintentos que llega, y el control de admisión garantiza que los que llegan de todos modos no consuman la capacidad reservada a las peticiones nuevas. Un paso adicional, útil con socios, es registrar por cliente la tasa de peticiones que llegan antes del tiempo indicado en el último Retry-After. Ese número, presentado al socio con fechas y ejemplos, suele resolver en una conversación un problema que meses de incidentes no resolvieron, porque hace visible que su bucle de reintento no tiene techo.',
    },
    {
      question: '¿Cuál es el número correcto de intentos y la espera correcta para un cliente?',
      answer:
        'El número correcto es pequeño y la espera correcta la define el plazo que el usuario tolera, no el deseo de obtener la respuesta a cualquier costo. Para llamadas interactivas, en las que un usuario espera frente a la pantalla, tres o cuatro intentos en total, con espera exponencial y variación aleatoria completa empezando en unos cientos de milisegundos y un plazo total de entre diez y treinta segundos, cubren los fallos transitorios que realmente se resuelven solos, como una conexión reiniciada o una instancia reiniciándose. Los fallos que duran más que eso no son transitorios desde el punto de vista del usuario, y seguir intentando solo aplaza el mensaje de error y agrega carga al servidor que intenta recuperarse. Para trabajo en segundo plano, como sincronización o envío de lotes, el número de intentos puede ser mayor y las esperas pueden llegar a minutos, siempre que exista un plazo final tras el cual el elemento va a una cola de revisión y no vuelve al inicio del bucle. En ambos casos, tres reglas son independientes de los números: no reintentar errores declarados como no reintentables, obedecer el Retry-After cuando exista, y mantener el reintento en una sola capa de la pila. Si hace falta un número para empezar, cuatro intentos en total con veinte segundos de plazo para llamadas interactivas es un punto de partida defendible, a ajustar según la distribución real de duración de los fallos transitorios que observa tu servicio.',
    },
  ],
  conclusion: {
    title: 'La insistencia sin techo es demanda acumulada, y la demanda acumulada necesita cola, no una puerta cerrada',
    description:
      'La caída de doce minutos que se convierte en tres horas de indisponibilidad no la causa el servidor ni la dependencia: la causa la suma de clientes legítimos que reintentan sin techo, cada uno con una decisión razonable y ninguno con la visión del conjunto. El tráfico resultante parece un ataque y tiene que tratarse como demanda. Hacer visible la repetición con huella y cabecera de intento, responder con un Retry-After repartido por cliente y un campo explícito de reintentable, reservar capacidad para las peticiones originales cuando se acaba, y ponerle techo a la insistencia en el origen de los clientes que controlas convierten la recuperación en algo que ocurre en minutos, sin depender de que el último usuario se rinda. Puedo instrumentar la razón de repetición en tu servicio, diseñar el contrato de respuesta y el control de admisión para tu capacidad real, y revisar el bucle de reintento de tu aplicación y del SDK que distribuyes antes del próximo incidente.',
    cta: 'Hablar sobre la resiliencia de mi API',
  },
  related: [
    {
      label: 'Timeout mal calibrado: cuándo reintentar empeora el incidente',
      to: '/blog/timeout-mal-calibrado-quando-tentar-de-novo-piora-o-incidente',
    },
    {
      label: 'Límite de tasa por cliente en el borde: proteger el servicio sin castigar al socio correcto',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicios/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
