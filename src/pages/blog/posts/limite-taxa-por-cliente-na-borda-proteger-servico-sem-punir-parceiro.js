// Conteudo do artigo: limite de taxa por cliente na borda e a protecao do servico
// sem punir o parceiro de bom comportamento.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O limite global entrou em produção numa sexta-feira à tarde para conter um parceiro que disparava sessenta chamadas por segundo, e às dezessete horas o time comemorou porque a latência voltou ao normal. Na segunda-feira o maior cliente da empresa abriu um chamado dizendo que a integração de estoque parou de funcionar às nove e quarenta, exatamente quando o parceiro abusivo também estava ativo. O limite funcionou: ele derrubou os dois. Este artigo mostra por que o limite global é um mecanismo de dano colateral e não de proteção, qual é a diferença prática entre os quatro algoritmos de limitação e por que a janela fixa produz o dobro do pico contratado, por que a identidade do chamador precisa ser resolvida antes de qualquer contagem e o que acontece quando ela é o endereço de rede, como o estado distribuído do contador sobrevive a várias instâncias de borda sem virar um gargalo, por que rejeitar não é a única resposta possível e quando enfileirar é melhor, quais cabeçalhos transformam a rejeição em contrato em vez de acidente, e quais quatro indicadores dizem se o limite está protegendo o serviço ou apenas empurrando o problema.',
  sections: [
    {
      title: 'O limite global protege a média e sacrifica o cliente certo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro limite que qualquer serviço ganha costuma ser global: um teto de requisições por segundo aplicado na borda, sem distinguir quem chamou. Ele é fácil de configurar, aparece pronto em qualquer proxy reverso e tem a propriedade que todo mundo quer no momento do incidente, que é conter a carga imediatamente. O problema é que a contenção não escolhe alvo. Quando o teto é atingido, a rejeição recai sobre quem estava chegando naquele instante, e a probabilidade de alguém ser rejeitado é proporcional ao volume que ele envia. O cliente que manda três chamadas por minuto quase nunca é rejeitado. O cliente que manda duzentas por minuto porque o negócio dele exige isso é rejeitado o tempo todo, junto com o abusivo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe um efeito mais perverso que aparece depois. O limite global cria uma competição entre clientes que nunca se conheceram. A capacidade que sobra para o cliente A depende do comportamento do cliente B, o que significa que a qualidade de serviço percebida por um integrador passa a ser função do que outro integrador fez na mesma janela. Isso é impossível de documentar num contrato, impossível de reproduzir em teste e impossível de explicar no chamado. A pergunta que o cliente faz, com razão, é qual é o limite dele, e sob teto global a resposta honesta é que depende dos outros.',
        },
        {
          type: 'paragraph',
          value:
            'A correção conceitual é tratar o limite como uma alocação de capacidade e não como um freio de emergência. Cada chamador recebe um orçamento próprio, verificável e independente, e o serviço passa a ter uma soma de orçamentos que ele sabe sustentar. Um chamador que ultrapassa o próprio orçamento consome apenas a fatia dele, e o excesso dele nunca chega perto da fatia de ninguém. É a mesma mudança de mentalidade que separa um pool de conexões compartilhado de pools isolados por carga: o isolamento custa um pouco de eficiência média e compra previsibilidade, que é o que um contrato de integração precisa vender.',
        },
        {
          type: 'table',
          columns: ['Modelo', 'Quem é penalizado no pico', 'Previsibilidade para o cliente', 'Quando ainda faz sentido'],
          rows: [
            [
              'Teto global na borda',
              'Quem chegou no instante errado, proporcional ao volume legítimo',
              'Nenhuma: o limite efetivo depende dos outros chamadores',
              'Válvula de último recurso acima dos limites por cliente',
            ],
            [
              'Limite por endereço de rede',
              'Todos que compartilham saída NAT ou o mesmo provedor de nuvem',
              'Baixa: o mesmo cliente muda de identidade entre chamadas',
              'Tráfego anônimo, antes da autenticação',
            ],
            [
              'Limite por credencial de cliente',
              'Apenas o chamador que ultrapassou o próprio orçamento',
              'Alta: o número entra no contrato e é reproduzível',
              'Padrão para qualquer API com chamador identificado',
            ],
            [
              'Limite por credencial e por rota',
              'O chamador, apenas na operação cara que ele abusou',
              'Alta, com granularidade que reflete o custo real',
              'Quando uma rota custa ordens de grandeza mais que as outras',
            ],
            [
              'Cota por custo estimado',
              'O chamador, proporcional ao trabalho que gerou',
              'Média: exige explicar a unidade de custo ao integrador',
              'Cargas heterogêneas, como busca, relatório e exportação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda linha da tabela merece um comentário porque ela é a escolha mais comum e a que mais produz chamado. Limitar por endereço de rede parece razoável até o dia em que um cliente corporativo inteiro sai por um único endereço de saída e consome o orçamento de mil funcionários como se fosse um chamador só, ou até o dia em que um integrador roda em funções serverless e aparece com um endereço novo a cada minuto, escapando de qualquer contagem. Endereço de rede é uma identidade útil antes da autenticação e enganosa depois dela.',
        },
      ],
    },
    {
      title: 'A identidade do chamador é a decisão que antecede o algoritmo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de escolher entre janela deslizante e balde de fichas, é preciso responder uma pergunta mais básica: o que exatamente está sendo contado. A chave de limitação é a unidade sobre a qual o orçamento se aplica, e escolher errado torna o algoritmo irrelevante, porque contar perfeitamente a coisa errada continua sendo errado. Em uma API com chamadores identificados, a chave quase sempre é derivada da credencial apresentada, e não do transporte.',
        },
        {
          type: 'paragraph',
          value:
            'A extração dessa chave tem uma ordem que importa. Ela precisa acontecer depois de validar a credencial, porque uma chave extraída de um token não verificado é uma chave que o atacante escolhe, e um atacante que escolhe a própria chave de limitação simplesmente gera uma chave nova a cada requisição e nunca é limitado. Ao mesmo tempo, a validação completa costuma envolver uma consulta, o que significa que o caminho de requisição não autenticada precisa ter o seu próprio limite, mais apertado e baseado em endereço de rede, para que o custo de validar credencial inválida não se torne o próprio vetor de ataque.',
        },
        {
          type: 'code',
          value: `// Resolucao da chave de limitacao antes de qualquer contagem.
// A ordem importa: identidade nao confiavel nunca vira chave de orcamento.

const CLASSE_ANONIMA = 'anon';

/**
 * Deriva a chave de limitacao a partir do contexto da requisicao.
 * Retorna tambem a classe, porque orcamento e politica de excedente
 * mudam conforme o plano do cliente.
 */
export function resolverChaveDeLimite(req, credencialVerificada) {
  // 1) Sem credencial verificada, a unica identidade disponivel e a de rede.
  //    O orcamento aqui e pequeno de proposito: ele cobre login, troca de
  //    token e rotas publicas, nao trafego de integracao.
  if (!credencialVerificada) {
    return {
      chave: \`\${CLASSE_ANONIMA}:\${enderecoDeOrigem(req)}\`,
      classe: CLASSE_ANONIMA,
      escopo: 'rede',
    };
  }

  // 2) Com credencial verificada, a identidade estavel e o cliente,
  //    nao a chave de API: um cliente que gira chaves nao deve ganhar
  //    orcamento novo a cada rotacao.
  const { clienteId, chaveId, plano } = credencialVerificada;

  // 3) Rotas caras recebem escopo proprio. Sem isso, uma exportacao
  //    completa consome o orcamento que sustentaria mil consultas baratas.
  const grupoDeRota = classificarRota(req.method, req.routePattern);

  if (grupoDeRota === 'caro') {
    return {
      chave: \`cli:\${clienteId}:rota:\${grupoDeRota}\`,
      classe: plano,
      escopo: 'cliente+rota',
      chaveId,
    };
  }

  return {
    chave: \`cli:\${clienteId}\`,
    classe: plano,
    escopo: 'cliente',
    chaveId,
  };
}

/**
 * Endereco de origem confiavel exige saber quantos proxies existem
 * a frente. Ler o primeiro valor de X-Forwarded-For sem essa conta e
 * aceitar o endereco que o cliente digitou.
 */
function enderecoDeOrigem(req) {
  const PROXIES_CONFIAVEIS = 1; // borda propria; ajuste por ambiente
  const cadeia = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (cadeia.length > PROXIES_CONFIAVEIS) {
    return cadeia[cadeia.length - 1 - PROXIES_CONFIAVEIS];
  }
  return req.socket.remoteAddress;
}

function classificarRota(metodo, padrao) {
  const CARAS = new Set([
    'GET /v1/relatorios/:id/exportar',
    'POST /v1/buscas/avancada',
    'POST /v1/lotes/importar',
  ]);
  return CARAS.has(\`\${metodo} \${padrao}\`) ? 'caro' : 'padrao';
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe da função de endereço de origem é o que separa um limitador funcional de um que pode ser contornado em uma linha. Ler o primeiro elemento do cabeçalho de encaminhamento é o erro clássico, porque esse elemento é escrito pelo cliente e pode conter qualquer coisa. O valor confiável é contado a partir do fim, pulando exatamente o número de proxies que a própria infraestrutura coloca na frente, e esse número precisa ser configuração explícita, não suposição. Uma borda que ganha um balanceador novo sem atualizar essa contagem passa a limitar o endereço do balanceador, o que na prática limita todo mundo junto.',
        },
        {
          type: 'paragraph',
          value:
            'A escolha de usar o identificador do cliente em vez do identificador da chave de API também tem consequência operacional. Se o orçamento fosse por chave, um integrador poderia multiplicar a própria capacidade simplesmente emitindo mais chaves, e a rotação de credenciais, que é uma prática desejável, criaria orçamento extra como efeito colateral. Vale manter o identificador da chave nos rótulos de métrica, porque ele é o que permite descobrir qual sistema do cliente está gerando o excesso, mas ele não deve entrar na chave de contagem.',
        },
      ],
    },
    {
      title: 'Quatro algoritmos, e por que a janela fixa entrega o dobro do pico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a chave resolvida, a escolha do algoritmo passa a ser sobre qual forma de tráfego o limite permite. Todos os quatro candidatos usuais respeitam a mesma média no longo prazo, e é por isso que a comparação feita apenas com a média não revela diferença nenhuma. A diferença está no formato da rajada que cada um deixa passar e no custo de manter o estado.',
        },
        {
          type: 'paragraph',
          value:
            'A janela fixa conta requisições dentro de um intervalo de relógio e zera a contagem quando o intervalo vira. Ela é a mais simples e tem um defeito que aparece sempre em produção: um cliente que envia todo o orçamento nos últimos instantes de uma janela e repete no primeiro instante da seguinte entrega o dobro do teto contratado dentro de um intervalo contínuo. Um teto de cem requisições por minuto vira duzentas em um segundo, e a borda considera as duas janelas dentro da política. Esse comportamento não é raro nem exige má intenção: qualquer cliente que sincroniza trabalho no início do minuto, o que é o padrão de agendadores, produz exatamente esse formato.',
        },
        {
          type: 'diagram',
          value: `JANELA FIXA: o pico de fronteira

  teto = 100 req/min

  minuto 1                    | minuto 2
  ............................|............................
                       [100]  | [100]
                         ^         ^
                         |         |
                    59.6s |         | 60.2s

  intervalo continuo de 1 segundo -> 200 requisicoes
  contagem da janela 1 = 100 (dentro da politica)
  contagem da janela 2 = 100 (dentro da politica)

JANELA DESLIZANTE PONDERADA: a fronteira desaparece

  estimativa = contagem_atual + contagem_anterior * fracao_restante

  em 60.2s, fracao_restante da janela anterior = 0.997
  estimativa = 100 + 100 * 0.997 = 199.7 -> rejeita

BALDE DE FICHAS: rajada explicita e controlada

  capacidade = 20 fichas (rajada maxima)
  reposicao  = 100/60 fichas por segundo (taxa media)

  cliente ocioso acumula ate 20 e gasta de uma vez,
  depois volta a ser limitado pela taxa de reposicao.`,
        },
        {
          type: 'paragraph',
          value:
            'A janela deslizante ponderada corrige a fronteira sem guardar a lista de carimbos de tempo de cada requisição. Ela mantém duas contagens, a da janela corrente e a da anterior, e estima o consumo como a contagem corrente somada à contagem anterior multiplicada pela fração da janela anterior que ainda está dentro do intervalo de observação. A estimativa não é exata, mas erra por pouco e por um fator conhecido, e custa dois inteiros por chave em vez de uma lista. É a escolha padrão quando o objetivo é fazer valer um número contratado com o mínimo de surpresa.',
        },
        {
          type: 'paragraph',
          value:
            'O balde de fichas resolve um problema diferente: ele permite rajada de propósito. A capacidade do balde é o tamanho da rajada que o cliente pode emitir depois de um período de ociosidade, e a taxa de reposição é a média sustentada. Isso é o que integrações reais querem, porque um sistema que processa um lote de pedidos a cada cinco minutos precisa de rajada, e a janela deslizante o trataria como abusivo. O balde vazante é o inverso: ele aceita rajada na entrada mas entrega numa taxa constante, o que o torna um enfileirador e não um rejeitador, e por isso ele aparece na seção sobre o que fazer com o excedente.',
        },
        {
          type: 'table',
          columns: ['Algoritmo', 'Estado por chave', 'Rajada permitida', 'Falha característica'],
          rows: [
            [
              'Janela fixa',
              'Um contador e um instante de virada',
              'Até duas vezes o teto na fronteira',
              'Pico de fronteira que o painel nunca mostra',
            ],
            [
              'Janela deslizante ponderada',
              'Dois contadores',
              'Praticamente nenhuma, o teto é respeitado',
              'Estimativa levemente conservadora com tráfego irregular',
            ],
            [
              'Balde de fichas',
              'Saldo e instante da última reposição',
              'Explícita, igual à capacidade do balde',
              'Rajada mal dimensionada vira pico real na origem',
            ],
            [
              'Balde vazante',
              'Fila com tamanho máximo',
              'Absorvida pela fila, nunca repassada',
              'Latência cresce em silêncio até a fila encher',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Na prática, os dois últimos não competem entre si: combinam. O balde de fichas decide o que é excesso e o balde vazante decide o que fazer com parte desse excesso. Um arranjo que funciona bem em API de integração usa fichas para o teto por cliente, com capacidade de rajada em torno de dez a vinte por cento do teto por minuto, e um pequeno enfileiramento com espera curta antes de rejeitar, o que absorve a rajada acidental de um agendador sem esconder o abuso sustentado.',
        },
      ],
    },
    {
      title: 'O contador distribuído entre instâncias de borda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um limitador em memória é correto enquanto existe uma instância de borda. Com seis instâncias atrás de um balanceador, cada uma passa a ver aproximadamente um sexto do tráfego do cliente e a aplicar o teto inteiro sobre essa fração, o que multiplica o limite efetivo pelo número de instâncias. Pior: o fator de multiplicação muda sozinho quando o autoescalonamento adiciona instâncias durante o pico, ou seja, o limite afrouxa exatamente quando deveria apertar.',
        },
        {
          type: 'paragraph',
          value:
            'A solução direta é um contador compartilhado, e a implementação que sobrevive a concorrência precisa ser atômica. Ler o valor, decidir e escrever de volta em três operações separadas produz condição de corrida sob carga, que é justamente o regime em que o limite importa. Em um armazenamento de chave e valor com execução de script, a decisão inteira roda do lado do servidor, o que também reduz o número de viagens de rede por requisição para uma.',
        },
        {
          type: 'code',
          value: `-- Balde de fichas atomico em Lua, executado no Redis.
-- KEYS[1]  chave do cliente
-- ARGV[1]  capacidade do balde (rajada maxima)
-- ARGV[2]  taxa de reposicao em fichas por segundo
-- ARGV[3]  instante atual em milissegundos
-- ARGV[4]  fichas pedidas (custo da requisicao)
-- Retorna: { permitido, restante, espera_ms, reset_s }

local capacidade   = tonumber(ARGV[1])
local taxa         = tonumber(ARGV[2])
local agora        = tonumber(ARGV[3])
local pedido       = tonumber(ARGV[4])

local estado   = redis.call('HMGET', KEYS[1], 'fichas', 'ts')
local fichas   = tonumber(estado[1])
local ultimoTs = tonumber(estado[2])

if fichas == nil then
  fichas   = capacidade
  ultimoTs = agora
end

-- Reposicao proporcional ao tempo decorrido, limitada pela capacidade.
local decorrido = math.max(0, agora - ultimoTs) / 1000
fichas = math.min(capacidade, fichas + decorrido * taxa)

local permitido = 0
local espera = 0

if fichas >= pedido then
  fichas = fichas - pedido
  permitido = 1
else
  -- Quanto tempo falta para acumular o que esta faltando.
  espera = math.ceil(((pedido - fichas) / taxa) * 1000)
end

redis.call('HSET', KEYS[1], 'fichas', fichas, 'ts', agora)

-- Expiracao = tempo para reencher o balde do zero, com folga.
-- Sem isso, cada cliente que chamou uma vez fica na memoria para sempre.
local ttl = math.ceil(capacidade / taxa) + 10
redis.call('EXPIRE', KEYS[1], ttl)

local reset = math.ceil((capacidade - fichas) / taxa)
return { permitido, math.floor(fichas), espera, reset }`,
        },
        {
          type: 'paragraph',
          value:
            'A linha da expiração é a que evita o vazamento lento que costuma passar despercebido por meses. Sem tempo de vida, cada cliente que chamou a API uma única vez deixa uma chave residente, e num serviço com chamadores efêmeros isso cresce até o armazenamento ficar sem memória. O tempo de vida correto é o tempo necessário para o balde voltar à capacidade cheia, porque a partir daí o estado guardado é indistinguível do estado inicial e pode ser descartado sem alterar nenhuma decisão.',
        },
        {
          type: 'paragraph',
          value:
            'Existe o custo da viagem até o armazenamento compartilhado em cada requisição, e ele é real. A saída usada em serviços de alto volume é um esquema de duas camadas: cada instância mantém um limitador local que autoriza uma fração do orçamento e sincroniza periodicamente com o contador central, pedindo um bloco de fichas em vez de uma ficha por vez. O limite passa a ser aproximadamente correto em vez de exatamente correto, com um erro máximo igual ao tamanho do bloco multiplicado pelo número de instâncias, o que é aceitável quando o teto é uma proteção e não uma cobrança. Quando o número é faturado, a aproximação deixa de ser aceitável e a viagem central volta a ser obrigatória.',
        },
        {
          type: 'paragraph',
          value:
            'A última decisão dessa camada é o que fazer quando o armazenamento compartilhado fica indisponível. Falhar fechado transforma uma indisponibilidade do limitador em indisponibilidade total da API, o que é desproporcional. Falhar aberto remove a proteção justamente durante um incidente de infraestrutura, que é quando a carga costuma estar anormal. O comportamento equilibrado é falhar para o limitador local de cada instância, com o orçamento dividido pelo número esperado de instâncias e um teto global de segurança acima dele, e registrar essa degradação como evento explícito para que ela não passe despercebida.',
        },
      ],
    },
    {
      title: 'Rejeitar não é a única resposta, e o cabeçalho é parte do contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O tratamento do excedente costuma ser reduzido a uma decisão binária entre passar e rejeitar, e essa redução descarta as respostas mais úteis. Um excedente pode ser enfileirado por um curto período, pode ser servido a partir de um cache com dado ligeiramente mais antigo, pode ser degradado para uma versão mais barata da mesma operação, ou pode ser aceito e processado de forma assíncrona com um identificador de acompanhamento. Cada uma dessas respostas preserva a intenção do chamador em vez de descartá-la, e todas custam menos ao serviço do que o pico original.',
        },
        {
          type: 'list',
          items: [
            'Enfileirar com espera curta, na ordem de cinquenta a duzentos milissegundos, absorve a rajada de agendador sem esconder abuso sustentado, porque o abuso sustentado enche a fila e volta a rejeitar.',
            'Servir do cache é a melhor resposta para leitura de dado que tolera alguns segundos de atraso, e transforma excedente em custo quase zero em vez de erro.',
            'Degradar a operação, respondendo uma busca sem os campos derivados caros ou um relatório com granularidade menor, mantém o fluxo do cliente vivo e sinaliza a degradação no corpo da resposta.',
            'Aceitar de forma assíncrona é o caminho natural para escrita em lote, e troca uma rejeição por um identificador que o cliente consulta depois.',
            'Rejeitar com código 429 permanece a resposta correta para abuso sustentado e para operações que não têm versão barata nem assíncrona.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Quando a rejeição é a resposta, o que separa um limite utilizável de um limite hostil é a informação que acompanha a recusa. Um cliente que recebe apenas o código de status não tem como se comportar bem, e a reação previsível é tentar de novo imediatamente, o que aumenta a carga exatamente no momento de saturação. Os cabeçalhos padronizados de limitação existem para resolver isso e têm um formato que já é esperado por bibliotecas de cliente.',
        },
        {
          type: 'code',
          value: `// Middleware de limitacao com cabecalhos que tornam o limite um contrato.
// Formato dos cabecalhos conforme o draft RateLimit do IETF, que e o que
// bibliotecas de cliente modernas ja sabem interpretar.

import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
const script = await readFile(new URL('./balde.lua', import.meta.url), 'utf8');
const sha = await redis.scriptLoad(script);

const ORCAMENTO = {
  // teto por minuto e rajada por plano; a rajada fica em torno de 15%
  // do teto, suficiente para agendador e insuficiente para abuso.
  free:       { porMinuto: 60,   rajada: 10 },
  pro:        { porMinuto: 600,  rajada: 90 },
  enterprise: { porMinuto: 6000, rajada: 900 },
  anon:       { porMinuto: 20,   rajada: 5 },
};

export function limitadorPorCliente({ aoExceder = 'rejeitar' } = {}) {
  return async function middleware(req, res, next) {
    const { chave, classe } = resolverChaveDeLimite(req, req.credencial);
    const plano = ORCAMENTO[classe] || ORCAMENTO.free;
    const custo = custoDaRequisicao(req);   // 1 por padrao, maior em rota cara

    let resultado;
    try {
      resultado = await redis.evalSha(sha, {
        keys: [\`rl:\${chave}\`],
        arguments: [
          String(plano.rajada),
          String(plano.porMinuto / 60),
          String(Date.now()),
          String(custo),
        ],
      });
    } catch (erro) {
      // Degradacao explicita: o limitador central caiu, nao a API.
      req.log.warn({ erro: erro.message }, 'limitador degradado para local');
      return limitadorLocal(req, res, next, plano);
    }

    const [permitido, restante, esperaMs, resetS] = resultado.map(Number);

    // Cabecalhos em toda resposta, nao apenas na rejeicao: o cliente bem
    // comportado precisa ver a folga encolhendo antes de bater no teto.
    res.setHeader('RateLimit-Limit', String(plano.porMinuto));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, restante)));
    res.setHeader('RateLimit-Reset', String(resetS));
    res.setHeader('RateLimit-Policy', \`\${plano.porMinuto};w=60;burst=\${plano.rajada}\`);

    if (permitido === 1) return next();

    // Espera curta absorve rajada de agendador sem mascarar abuso.
    if (aoExceder === 'enfileirar' && esperaMs <= 200) {
      await new Promise((resolver) => setTimeout(resolver, esperaMs));
      return middleware(req, res, next);
    }

    const retryAfter = Math.max(1, Math.ceil(esperaMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      erro: 'rate_limit_excedido',
      // A mensagem diz o que fazer, nao apenas o que aconteceu.
      mensagem: \`Orcamento de \${plano.porMinuto} requisicoes por minuto excedido. \` +
        \`Tente novamente em \${retryAfter}s ou use o endpoint em lote.\`,
      limite: plano.porMinuto,
      janelaSegundos: 60,
      tentarEmSegundos: retryAfter,
    });
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe de emitir os cabeçalhos em toda resposta, e não apenas na rejeição, é o que muda o comportamento do integrador. Um cliente que vê a folga encolhendo de quinhentos para cinquenta ao longo de trinta segundos tem como desacelerar sozinho antes do erro, e bibliotecas de cliente modernas fazem isso automaticamente quando os cabeçalhos estão presentes. Emitir a informação só no momento da recusa é equivalente a avisar do limite depois que ele já foi ultrapassado, o que serve para explicar e não para prevenir.',
        },
        {
          type: 'paragraph',
          value:
            'O cabeçalho de nova tentativa merece um cuidado específico. Se todos os clientes rejeitados receberem exatamente o mesmo valor, todos voltam exatamente no mesmo instante e produzem um pico sincronizado no fim da espera, que é o mesmo fenômeno de rebanho que derruba serviços depois de uma queda. A correção é adicionar uma dispersão aleatória de dez a vinte por cento sobre o valor calculado, de forma que o retorno seja distribuído em vez de simultâneo.',
        },
      ],
    },
    {
      title: 'Os quatro indicadores que dizem se o limite protege ou empurra',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um limite de taxa é uma política, e políticas precisam de evidência para serem ajustadas. A métrica que quase todo mundo instrumenta primeiro, a contagem de respostas 429, é a menos útil isoladamente, porque ela sobe tanto quando o limite está protegendo corretamente quanto quando ele está apertado demais, e os dois casos exigem ações opostas. O que distingue um do outro é olhar a distribuição por cliente e a proximidade do teto entre os que nunca são rejeitados.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que ele responde', 'Sinal de limite bem calibrado', 'Sinal de problema'],
          rows: [
            [
              'Rejeições por cliente, não agregadas',
              'Quem está batendo no teto',
              'Concentração em poucos chamadores conhecidos',
              'Rejeição espalhada por muitos clientes pequenos',
            ],
            [
              'Utilização do orçamento no percentil noventa e cinco',
              'Quanto da fatia cada cliente usa no pico',
              'Maioria abaixo de setenta por cento',
              'Vários clientes acima de noventa e cinco sem rejeitar ainda',
            ],
            [
              'Latência do próprio limitador',
              'Quanto a proteção custa ao caminho de requisição',
              'Abaixo de dois milissegundos no percentil noventa e nove',
              'Cauda alta, indicando viagem de rede saturada',
            ],
            [
              'Tempo em modo degradado',
              'Quanto o limite ficou aproximado por falha central',
              'Próximo de zero, com eventos isolados',
              'Minutos acumulados por dia sem ninguém saber',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda linha é a que permite agir antes do chamado. Um cliente que passa semanas usando noventa e cinco por cento do orçamento sem ser rejeitado está a um crescimento de dez por cento de virar um incidente, e essa é a hora de conversar sobre plano, sobre endpoint em lote ou sobre um aumento de fatia, e não depois que a integração dele quebrou. Esse indicador transforma o limite de taxa em uma ferramenta comercial além de técnica, porque ele mostra quem está prestes a precisar de mais capacidade.',
        },
        {
          type: 'paragraph',
          value:
            'A primeira linha resolve a pergunta que dá origem à seção inteira. Se as rejeições estão concentradas em poucos chamadores identificáveis, o limite está fazendo exatamente o que foi projetado para fazer: isolar o excesso na fatia de quem o produziu. Se elas estão espalhadas por muitos clientes pequenos, o teto está abaixo do uso legítimo e a política precisa ser revista, porque nesse regime o limite deixou de proteger o serviço e passou a ser a principal causa de erro que os clientes enxergam.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumentar antes de limitar: rodar o limitador em modo de observação por uma ou duas semanas, calculando a decisão e registrando a métrica sem rejeitar nada.',
            'Definir o teto de cada plano no percentil noventa e nove do uso observado, com folga, para que o limite inicial não rejeite nenhum comportamento que já era normal.',
            'Habilitar a rejeição primeiro para a classe anônima e para as rotas caras, que é onde o risco é maior e o impacto em cliente legítimo é menor.',
            'Publicar os limites na documentação junto com os cabeçalhos emitidos, porque um limite não documentado é indistinguível de uma instabilidade do ponto de vista do integrador.',
            'Habilitar a rejeição por cliente autenticado, acompanhando a distribuição de rejeições por chamador durante os primeiros dias.',
            'Revisar mensalmente a utilização no percentil noventa e cinco por cliente e ajustar fatias antes que a rejeição apareça.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Como definir o valor inicial do teto por cliente sem chutar um número redondo?',
      answer:
        'O caminho que evita tanto o limite inútil quanto o limite hostil é derivar o número do uso observado antes de derivar da capacidade. A primeira etapa é rodar o limitador em modo de observação, calculando a decisão completa e registrando a métrica de utilização sem rejeitar nada, por um período que cubra pelo menos um ciclo de negócio inteiro, o que em integrações costuma ser um mês porque existe pico de fechamento. Com essa amostra, o teto inicial de cada classe sai do percentil noventa e nove do uso por cliente dentro da classe, multiplicado por uma folga de trinta a cinquenta por cento. Esse número tem a propriedade de não rejeitar nada que já era comportamento normal, o que é fundamental para que a ativação do limite não seja confundida com uma degradação do serviço. A segunda etapa é confrontar a soma dos tetos com a capacidade real, e aqui aparece o fato incômodo: a soma dos orçamentos individuais quase sempre excede a capacidade do serviço, porque nem todos os clientes atingem o pico ao mesmo tempo. Isso é aceitável e é exatamente a razão de existir um teto global acima dos individuais, funcionando como válvula de último recurso. O que não é aceitável é que a soma exceda a capacidade em uma ordem de grandeza, porque nesse caso os limites individuais nunca serão atingidos e a proteção efetiva volta a ser o teto global, com todo o dano colateral que ele produz. Quando a conta não fecha, a saída é criar classes com tetos diferenciados e mover o custo para o plano, não achatar todo mundo no mesmo número.',
    },
    {
      question: 'Vale a pena limitar por custo estimado em vez de por número de requisições?',
      answer:
        'Vale quando a variação de custo entre operações passa de uma ordem de grandeza, e não vale quando a carga é homogênea, porque a unidade de custo precisa ser explicada ao integrador e uma unidade que ninguém entende gera mais chamado do que protege. O critério prático é medir a distribuição de tempo de processamento por rota: se o percentil noventa e cinco da rota mais cara for até dez vezes o da rota mais barata, contar requisições com um custo maior para as rotas caras já resolve, e essa é a abordagem do exemplo deste artigo, onde a rota cara consome mais fichas do mesmo balde. Se a diferença for de cem vezes ou mais, como acontece entre uma consulta por identificador e uma exportação completa, contar requisições vira ficção e o limite precisa ser expresso em uma unidade que reflita trabalho, seja tempo de processamento, seja linhas retornadas, seja uma unidade sintética publicada na documentação. O ponto de atenção da limitação por custo é que o custo real só é conhecido depois de executar, o que obriga a um esquema de reserva e acerto: cobrar uma estimativa antes da execução e devolver ou cobrar a diferença ao final. Isso é o mesmo mecanismo usado em teto de gasto por cliente e tem o mesmo cuidado, que é garantir que a devolução aconteça mesmo quando a requisição falha no meio, sob pena de o cliente ficar pagando por trabalho que nunca foi feito. Uma alternativa mais simples, e suficiente na maioria dos casos, é manter o limite em requisições e criar um limite separado e paralelo por concorrência, restringindo quantas operações caras cada cliente pode ter em execução simultânea, o que protege a capacidade sem exigir nenhuma unidade nova.',
    },
    {
      question: 'O que muda no limite de taxa quando a API é usada por um front-end do próprio produto e não só por integradores?',
      answer:
        'Muda a identidade que faz sentido contar e muda o significado de uma rejeição. Um front-end distribui a mesma credencial de aplicação entre todos os usuários finais, então limitar por cliente colocaria milhares de pessoas dentro de um único orçamento, e a primeira rajada de uso normal derrubaria a aplicação inteira. A chave correta nesse caso é composta, combinando o identificador da aplicação com o identificador do usuário autenticado, o que dá a cada sessão o seu próprio orçamento e mantém a possibilidade de um teto agregado por aplicação acima dele. Para tráfego não autenticado do próprio produto, como uma página pública com busca, a identidade volta a ser de rede e o orçamento precisa ser pequeno, complementado por controles que não são de taxa, como prova de trabalho leve ou verificação de origem, porque um limite por endereço é contornável com muitos endereços. O segundo ponto é o significado da rejeição: para um integrador, um 429 é uma instrução operacional que a biblioteca dele trata, enquanto para um usuário final é uma tela de erro que ele não tem como resolver. Isso torna as respostas alternativas muito mais valiosas no caminho do produto, e é onde servir do cache, degradar a operação ou simplesmente desacelerar a interface com uma indicação de carregamento valem mais do que qualquer código de status. Vale ainda separar fisicamente os dois caminhos, com limites, políticas e até pontos de entrada distintos para tráfego de produto e tráfego de integração, porque eles têm formatos de carga diferentes e misturá-los força um compromisso que penaliza os dois.',
    },
  ],
  conclusion: {
    title: 'O limite por cliente troca dano colateral por previsibilidade contratada',
    description:
      'Um teto global contém a carga e distribui a rejeição por quem estava chegando, o que faz o cliente certo pagar pelo comportamento do errado e torna a qualidade de serviço impossível de documentar. Resolver a identidade do chamador antes de contar, escolher o algoritmo pelo formato de rajada que ele permite, manter o contador atômico e compartilhado com degradação explícita, e emitir os cabeçalhos em toda resposta transformam o limite em um contrato que o integrador consegue respeitar sozinho. Posso desenhar as classes de orçamento a partir do uso real da sua API, implementar o limitador distribuído com as respostas alternativas ao excedente, definir a política de degradação quando o contador central falha e configurar os quatro indicadores que mostram se o limite está protegendo o serviço ou apenas empurrando o problema para o cliente.',
    cta: 'Falar sobre o limite de taxa da minha API',
  },
  related: [
    {
      label: 'Timeout em cascata: quando o retry do cliente derruba o serviço',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Chave de particionamento errada: a fila que trava porque um cliente ocupa tudo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidade e Confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The global limit shipped on a Friday afternoon to contain a partner firing sixty calls per second, and by five in the evening the team celebrated because latency was back to normal. On Monday the largest customer in the company filed a ticket saying the inventory integration stopped working at nine forty, exactly when the abusive partner was also active. The limit worked: it took both of them down. This article shows why a global ceiling is a collateral damage mechanism rather than a protection mechanism, what the practical difference is between the four limiting algorithms and why a fixed window delivers twice the contracted peak, why caller identity must be resolved before any counting happens and what goes wrong when that identity is the network address, how the distributed counter state survives multiple edge instances without becoming a bottleneck, why rejecting is not the only possible answer and when queueing is better, which headers turn a rejection into a contract instead of an accident, and which four indicators tell you whether the limit is protecting the service or merely pushing the problem elsewhere.',
  sections: [
    {
      title: 'A global limit protects the average and sacrifices the right customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first limit any service gets is usually global: a requests per second ceiling applied at the edge, with no distinction about who called. It is easy to configure, ships ready in any reverse proxy and has the property everybody wants during an incident, which is containing load immediately. The problem is that containment does not pick a target. When the ceiling is reached, rejection falls on whoever was arriving at that instant, and the probability of being rejected is proportional to the volume someone sends. The customer sending three calls per minute is almost never rejected. The customer sending two hundred per minute because their business requires it gets rejected constantly, right alongside the abuser.',
        },
        {
          type: 'paragraph',
          value:
            'There is a more perverse effect that shows up later. A global limit creates competition between customers who never met each other. The capacity left for customer A depends on the behavior of customer B, which means the service quality one integrator perceives becomes a function of what another integrator did in the same window. That is impossible to document in a contract, impossible to reproduce in a test and impossible to explain in a support ticket. The question the customer asks, quite reasonably, is what their limit is, and under a global ceiling the honest answer is that it depends on everybody else.',
        },
        {
          type: 'paragraph',
          value:
            'The conceptual fix is treating the limit as a capacity allocation rather than an emergency brake. Each caller gets their own budget, verifiable and independent, and the service ends up with a sum of budgets it knows it can sustain. A caller who exceeds their own budget consumes only their own slice, and their excess never comes near anybody else slice. It is the same mindset shift that separates a shared connection pool from pools isolated per workload: isolation costs a little average efficiency and buys predictability, which is exactly what an integration contract needs to sell.',
        },
        {
          type: 'table',
          columns: ['Model', 'Who pays at peak', 'Predictability for the customer', 'When it still makes sense'],
          rows: [
            [
              'Global edge ceiling',
              'Whoever arrived at the wrong instant, proportional to legitimate volume',
              'None: the effective limit depends on the other callers',
              'Last resort valve sitting above per customer limits',
            ],
            [
              'Per network address limit',
              'Everybody sharing a NAT exit or the same cloud provider',
              'Low: the same customer changes identity between calls',
              'Anonymous traffic, before authentication',
            ],
            [
              'Per customer credential limit',
              'Only the caller who exceeded their own budget',
              'High: the number goes into the contract and is reproducible',
              'Default for any API with an identified caller',
            ],
            [
              'Per credential and per route limit',
              'The caller, only on the expensive operation they abused',
              'High, with granularity reflecting real cost',
              'When one route costs orders of magnitude more than the others',
            ],
            [
              'Estimated cost quota',
              'The caller, proportional to the work they generated',
              'Medium: requires explaining the cost unit to the integrator',
              'Heterogeneous workloads such as search, reporting and export',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second row deserves a comment because it is the most common choice and the one that produces the most tickets. Limiting by network address looks reasonable until the day an entire corporate customer exits through a single address and consumes the budget of a thousand employees as if they were one caller, or until the day an integrator runs on serverless functions and shows up with a new address every minute, escaping any counting at all. A network address is a useful identity before authentication and a misleading one after it.',
        },
      ],
    },
    {
      title: 'Caller identity is the decision that precedes the algorithm',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before choosing between a sliding window and a token bucket, a more basic question needs an answer: what exactly is being counted. The limiting key is the unit the budget applies to, and choosing it wrong makes the algorithm irrelevant, because counting the wrong thing perfectly is still wrong. In an API with identified callers, the key is almost always derived from the presented credential, not from the transport.',
        },
        {
          type: 'paragraph',
          value:
            'Extracting that key has an order that matters. It has to happen after the credential is validated, because a key extracted from an unverified token is a key the attacker chooses, and an attacker who chooses their own limiting key simply generates a new one per request and is never limited. At the same time, full validation usually involves a lookup, which means the unauthenticated request path needs its own limit, tighter and based on network address, so that the cost of validating an invalid credential does not itself become the attack vector.',
        },
        {
          type: 'code',
          value: `// Resolving the limiting key before any counting happens.
// Order matters: an untrusted identity never becomes a budget key.

const ANONYMOUS_CLASS = 'anon';

/**
 * Derives the limiting key from the request context.
 * It also returns the class, because budget and overflow policy
 * change with the customer plan.
 */
export function resolveLimitKey(req, verifiedCredential) {
  // 1) With no verified credential, the only available identity is the network.
  //    The budget here is small on purpose: it covers login, token exchange
  //    and public routes, not integration traffic.
  if (!verifiedCredential) {
    return {
      key: \`\${ANONYMOUS_CLASS}:\${sourceAddress(req)}\`,
      class: ANONYMOUS_CLASS,
      scope: 'network',
    };
  }

  // 2) With a verified credential, the stable identity is the customer,
  //    not the API key: a customer who rotates keys must not earn a new
  //    budget on every rotation.
  const { customerId, keyId, plan } = verifiedCredential;

  // 3) Expensive routes get their own scope. Without this, a full export
  //    consumes the budget that would sustain a thousand cheap queries.
  const routeGroup = classifyRoute(req.method, req.routePattern);

  if (routeGroup === 'expensive') {
    return {
      key: \`cust:\${customerId}:route:\${routeGroup}\`,
      class: plan,
      scope: 'customer+route',
      keyId,
    };
  }

  return {
    key: \`cust:\${customerId}\`,
    class: plan,
    scope: 'customer',
    keyId,
  };
}

/**
 * A trustworthy source address requires knowing how many proxies sit in
 * front. Reading the first X-Forwarded-For value without that arithmetic
 * means accepting the address the client typed.
 */
function sourceAddress(req) {
  const TRUSTED_PROXIES = 1; // own edge; adjust per environment
  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length > TRUSTED_PROXIES) {
    return chain[chain.length - 1 - TRUSTED_PROXIES];
  }
  return req.socket.remoteAddress;
}

function classifyRoute(method, pattern) {
  const EXPENSIVE = new Set([
    'GET /v1/reports/:id/export',
    'POST /v1/searches/advanced',
    'POST /v1/batches/import',
  ]);
  return EXPENSIVE.has(\`\${method} \${pattern}\`) ? 'expensive' : 'standard';
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail inside the source address function is what separates a working limiter from one that can be bypassed in a single line. Reading the first element of the forwarding header is the classic mistake, because that element is written by the client and can contain anything. The trustworthy value is counted from the end, skipping exactly the number of proxies your own infrastructure puts in front, and that number has to be explicit configuration, not an assumption. An edge that gains a new load balancer without updating this count starts limiting the balancer address, which in practice limits everybody together.',
        },
        {
          type: 'paragraph',
          value:
            'Choosing the customer identifier over the API key identifier also has an operational consequence. If the budget were per key, an integrator could multiply their own capacity simply by issuing more keys, and credential rotation, which is a desirable practice, would create extra budget as a side effect. It is worth keeping the key identifier in metric labels, because that is what lets you find which of the customer systems is generating the excess, but it should not be part of the counting key.',
        },
      ],
    },
    {
      title: 'Four algorithms, and why the fixed window delivers twice the peak',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the key resolved, the algorithm choice becomes a question about which traffic shape the limit permits. All four usual candidates respect the same long run average, which is why a comparison based only on averages reveals no difference at all. The difference lies in the burst shape each one lets through and in the cost of keeping state.',
        },
        {
          type: 'paragraph',
          value:
            'The fixed window counts requests inside a clock interval and resets the count when the interval flips. It is the simplest one and has a defect that always shows up in production: a customer who sends their entire budget in the last instants of one window and repeats it in the first instant of the next delivers twice the contracted ceiling within a continuous interval. A ceiling of one hundred requests per minute becomes two hundred in one second, and the edge considers both windows within policy. That behavior is neither rare nor does it require malice: any customer that synchronizes work at the top of the minute, which is the default for schedulers, produces exactly that shape.',
        },
        {
          type: 'diagram',
          value: `FIXED WINDOW: the boundary burst

  ceiling = 100 req/min

  minute 1                    | minute 2
  ............................|............................
                       [100]  | [100]
                         ^         ^
                         |         |
                    59.6s |         | 60.2s

  continuous 1 second interval -> 200 requests
  window 1 count = 100 (within policy)
  window 2 count = 100 (within policy)

WEIGHTED SLIDING WINDOW: the boundary disappears

  estimate = current_count + previous_count * remaining_fraction

  at 60.2s, remaining fraction of previous window = 0.997
  estimate = 100 + 100 * 0.997 = 199.7 -> reject

TOKEN BUCKET: explicit and controlled burst

  capacity = 20 tokens (maximum burst)
  refill   = 100/60 tokens per second (average rate)

  an idle customer accumulates up to 20 and spends them at once,
  then goes back to being limited by the refill rate.`,
        },
        {
          type: 'paragraph',
          value:
            'The weighted sliding window fixes the boundary without storing the timestamp list of every request. It keeps two counts, the current window and the previous one, and estimates consumption as the current count plus the previous count multiplied by the fraction of the previous window still inside the observation interval. The estimate is not exact, but it errs by a little and by a known factor, and it costs two integers per key instead of a list. It is the default choice when the goal is enforcing a contracted number with the least surprise.',
        },
        {
          type: 'paragraph',
          value:
            'The token bucket solves a different problem: it allows bursting on purpose. Bucket capacity is the burst size a customer may emit after a period of idleness, and the refill rate is the sustained average. That is what real integrations want, because a system processing a batch of orders every five minutes needs a burst, and the sliding window would treat it as abusive. The leaky bucket is the inverse: it accepts bursts on the way in but delivers at a constant rate, which makes it a queuer rather than a rejecter, and that is why it appears in the section about what to do with overflow.',
        },
        {
          type: 'table',
          columns: ['Algorithm', 'State per key', 'Burst allowed', 'Characteristic failure'],
          rows: [
            [
              'Fixed window',
              'One counter and a flip instant',
              'Up to twice the ceiling at the boundary',
              'Boundary burst the dashboard never shows',
            ],
            [
              'Weighted sliding window',
              'Two counters',
              'Practically none, the ceiling is honored',
              'Slightly conservative estimate under irregular traffic',
            ],
            [
              'Token bucket',
              'Balance and last refill instant',
              'Explicit, equal to bucket capacity',
              'A badly sized burst becomes a real peak at the origin',
            ],
            [
              'Leaky bucket',
              'Queue with a maximum size',
              'Absorbed by the queue, never passed through',
              'Latency grows silently until the queue fills',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In practice the last two do not compete: they combine. The token bucket decides what counts as excess and the leaky bucket decides what to do with part of that excess. An arrangement that works well in integration APIs uses tokens for the per customer ceiling, with burst capacity around ten to twenty percent of the per minute ceiling, and a small amount of queueing with a short wait before rejecting, which absorbs the accidental burst of a scheduler without hiding sustained abuse.',
        },
      ],
    },
    {
      title: 'The distributed counter across edge instances',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An in memory limiter is correct while a single edge instance exists. With six instances behind a load balancer, each one sees roughly a sixth of the customer traffic and applies the whole ceiling to that fraction, which multiplies the effective limit by the number of instances. Worse: the multiplication factor changes by itself when autoscaling adds instances during a peak, meaning the limit loosens exactly when it should tighten.',
        },
        {
          type: 'paragraph',
          value:
            'The direct solution is a shared counter, and the implementation that survives concurrency has to be atomic. Reading the value, deciding and writing back as three separate operations produces a race condition under load, which is precisely the regime where the limit matters. In a key value store with script execution, the entire decision runs on the server side, which also reduces network round trips per request to one.',
        },
        {
          type: 'code',
          value: `-- Atomic token bucket in Lua, executed inside Redis.
-- KEYS[1]  customer key
-- ARGV[1]  bucket capacity (maximum burst)
-- ARGV[2]  refill rate in tokens per second
-- ARGV[3]  current instant in milliseconds
-- ARGV[4]  tokens requested (request cost)
-- Returns: { allowed, remaining, wait_ms, reset_s }

local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local now      = tonumber(ARGV[3])
local asked    = tonumber(ARGV[4])

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local lastTs = tonumber(state[2])

if tokens == nil then
  tokens = capacity
  lastTs = now
end

-- Refill proportional to elapsed time, capped at capacity.
local elapsed = math.max(0, now - lastTs) / 1000
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
local wait = 0

if tokens >= asked then
  tokens = tokens - asked
  allowed = 1
else
  -- How long until the missing amount accumulates.
  wait = math.ceil(((asked - tokens) / rate) * 1000)
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)

-- Expiry = time to refill the bucket from empty, plus slack.
-- Without this, every customer who called once stays in memory forever.
local ttl = math.ceil(capacity / rate) + 10
redis.call('EXPIRE', KEYS[1], ttl)

local reset = math.ceil((capacity - tokens) / rate)
return { allowed, math.floor(tokens), wait, reset }`,
        },
        {
          type: 'paragraph',
          value:
            'The expiry line is what avoids the slow leak that usually goes unnoticed for months. With no time to live, every customer who called the API once leaves a resident key, and in a service with ephemeral callers that grows until the store runs out of memory. The correct time to live is the time needed for the bucket to return to full capacity, because from that point on the stored state is indistinguishable from the initial state and can be discarded without changing any decision.',
        },
        {
          type: 'paragraph',
          value:
            'There is a cost to the round trip to the shared store on every request, and it is real. The way out used in high volume services is a two layer scheme: each instance keeps a local limiter that authorizes a fraction of the budget and periodically synchronizes with the central counter, asking for a block of tokens instead of one token at a time. The limit becomes approximately correct rather than exactly correct, with a maximum error equal to the block size multiplied by the number of instances, which is acceptable when the ceiling is a protection and not a charge. When the number is billed, the approximation stops being acceptable and the central round trip becomes mandatory again.',
        },
        {
          type: 'paragraph',
          value:
            'The last decision in this layer is what to do when the shared store is unavailable. Failing closed turns a limiter outage into a full API outage, which is disproportionate. Failing open removes the protection precisely during an infrastructure incident, which is when load tends to be abnormal. The balanced behavior is failing over to the local limiter in each instance, with the budget divided by the expected number of instances and a global safety ceiling above it, and recording that degradation as an explicit event so it does not go unnoticed.',
        },
      ],
    },
    {
      title: 'Rejecting is not the only answer, and the header is part of the contract',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Overflow handling is usually reduced to a binary decision between passing and rejecting, and that reduction discards the most useful answers. Overflow can be queued for a short period, can be served from cache with slightly older data, can be degraded into a cheaper version of the same operation, or can be accepted and processed asynchronously with a tracking identifier. Each of those answers preserves the caller intent instead of discarding it, and all of them cost the service less than the original peak.',
        },
        {
          type: 'list',
          items: [
            'Queueing with a short wait, on the order of fifty to two hundred milliseconds, absorbs the scheduler burst without hiding sustained abuse, because sustained abuse fills the queue and goes back to rejecting.',
            'Serving from cache is the best answer for reads that tolerate a few seconds of staleness, and it turns overflow into near zero cost instead of an error.',
            'Degrading the operation, answering a search without the expensive derived fields or a report with coarser granularity, keeps the customer flow alive and signals the degradation in the response body.',
            'Accepting asynchronously is the natural path for batch writes, and trades a rejection for an identifier the customer polls later.',
            'Rejecting with a 429 remains the correct answer for sustained abuse and for operations that have neither a cheap nor an asynchronous version.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'When rejection is the answer, what separates a usable limit from a hostile one is the information accompanying the refusal. A customer who receives only a status code has no way to behave well, and the predictable reaction is retrying immediately, which increases load exactly at the moment of saturation. Standardized rate limit headers exist to solve this and have a format client libraries already expect.',
        },
        {
          type: 'code',
          value: `// Rate limiting middleware with headers that turn the limit into a contract.
// Header format follows the IETF RateLimit draft, which is what modern
// client libraries already know how to interpret.

import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
const script = await readFile(new URL('./bucket.lua', import.meta.url), 'utf8');
const sha = await redis.scriptLoad(script);

const BUDGET = {
  // per minute ceiling and burst per plan; burst sits around 15% of the
  // ceiling, enough for a scheduler and not enough for abuse.
  free:       { perMinute: 60,   burst: 10 },
  pro:        { perMinute: 600,  burst: 90 },
  enterprise: { perMinute: 6000, burst: 900 },
  anon:       { perMinute: 20,   burst: 5 },
};

export function perCustomerLimiter({ onExceed = 'reject' } = {}) {
  return async function middleware(req, res, next) {
    const { key, class: planClass } = resolveLimitKey(req, req.credential);
    const plan = BUDGET[planClass] || BUDGET.free;
    const cost = requestCost(req);   // 1 by default, higher on expensive routes

    let result;
    try {
      result = await redis.evalSha(sha, {
        keys: [\`rl:\${key}\`],
        arguments: [
          String(plan.burst),
          String(plan.perMinute / 60),
          String(Date.now()),
          String(cost),
        ],
      });
    } catch (error) {
      // Explicit degradation: the central limiter failed, not the API.
      req.log.warn({ error: error.message }, 'limiter degraded to local');
      return localLimiter(req, res, next, plan);
    }

    const [allowed, remaining, waitMs, resetS] = result.map(Number);

    // Headers on every response, not only on rejection: a well behaved
    // client needs to see the headroom shrinking before hitting the ceiling.
    res.setHeader('RateLimit-Limit', String(plan.perMinute));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, remaining)));
    res.setHeader('RateLimit-Reset', String(resetS));
    res.setHeader('RateLimit-Policy', \`\${plan.perMinute};w=60;burst=\${plan.burst}\`);

    if (allowed === 1) return next();

    // A short wait absorbs the scheduler burst without masking abuse.
    if (onExceed === 'queue' && waitMs <= 200) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      return middleware(req, res, next);
    }

    const retryAfter = Math.max(1, Math.ceil(waitMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'rate_limit_exceeded',
      // The message says what to do, not only what happened.
      message: \`Budget of \${plan.perMinute} requests per minute exceeded. \` +
        \`Retry in \${retryAfter}s or use the batch endpoint.\`,
      limit: plan.perMinute,
      windowSeconds: 60,
      retryInSeconds: retryAfter,
    });
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The detail of emitting headers on every response, and not only on rejection, is what changes integrator behavior. A client watching headroom shrink from five hundred to fifty over thirty seconds can slow down on its own before the error, and modern client libraries do that automatically when the headers are present. Emitting the information only at refusal time is equivalent to warning about the limit after it was already exceeded, which serves to explain and not to prevent.',
        },
        {
          type: 'paragraph',
          value:
            'The retry header deserves specific care. If every rejected client receives exactly the same value, they all come back at exactly the same instant and produce a synchronized spike at the end of the wait, which is the same herd phenomenon that takes services down after an outage. The fix is adding a random spread of ten to twenty percent over the computed value, so that the return is distributed instead of simultaneous.',
        },
      ],
    },
    {
      title: 'The four indicators that tell protection from displacement',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A rate limit is a policy, and policies need evidence to be adjusted. The metric almost everyone instruments first, the 429 response count, is the least useful in isolation, because it rises both when the limit is protecting correctly and when it is too tight, and those two cases require opposite actions. What tells them apart is looking at the per customer distribution and at how close to the ceiling the ones who are never rejected sit.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it answers', 'Sign of a well calibrated limit', 'Sign of a problem'],
          rows: [
            [
              'Rejections per customer, not aggregated',
              'Who is hitting the ceiling',
              'Concentration in a few known callers',
              'Rejections spread across many small customers',
            ],
            [
              'Budget utilization at the ninety fifth percentile',
              'How much of the slice each customer uses at peak',
              'Most below seventy percent',
              'Several customers above ninety five without rejecting yet',
            ],
            [
              'Limiter own latency',
              'What the protection costs on the request path',
              'Below two milliseconds at the ninety ninth percentile',
              'High tail, indicating a saturated round trip',
            ],
            [
              'Time in degraded mode',
              'How long the limit was approximate due to central failure',
              'Near zero, with isolated events',
              'Minutes accumulated per day with nobody knowing',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second row is what allows acting before the ticket. A customer spending weeks using ninety five percent of their budget without being rejected is one ten percent growth away from becoming an incident, and that is the moment to talk about plan, about a batch endpoint or about a larger slice, not after their integration broke. This indicator turns rate limiting into a commercial tool as much as a technical one, because it shows who is about to need more capacity.',
        },
        {
          type: 'paragraph',
          value:
            'The first row answers the question that motivates the whole section. If rejections are concentrated in a few identifiable callers, the limit is doing exactly what it was designed to do: isolating excess inside the slice of whoever produced it. If they are spread across many small customers, the ceiling sits below legitimate usage and the policy needs revision, because in that regime the limit stopped protecting the service and became the main source of errors customers see.',
        },
        {
          type: 'ordered',
          items: [
            'Instrument before limiting: run the limiter in observation mode for one or two weeks, computing the decision and recording the metric without rejecting anything.',
            'Set each plan ceiling at the ninety ninth percentile of observed usage, with slack, so the initial limit rejects no behavior that was already normal.',
            'Enable rejection first for the anonymous class and for expensive routes, where risk is highest and impact on legitimate customers is lowest.',
            'Publish the limits in the documentation alongside the emitted headers, because an undocumented limit is indistinguishable from instability from the integrator point of view.',
            'Enable rejection for authenticated customers, watching the per caller rejection distribution during the first days.',
            'Review ninety fifth percentile utilization per customer monthly and adjust slices before rejections appear.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How do you set the initial per customer ceiling without picking a round number out of thin air?',
      answer:
        'The path that avoids both a useless limit and a hostile one is deriving the number from observed usage before deriving it from capacity. The first step is running the limiter in observation mode, computing the full decision and recording the utilization metric without rejecting anything, for a period covering at least one whole business cycle, which in integrations is usually a month because there is a closing peak. With that sample, the initial ceiling for each class comes from the ninety ninth percentile of per customer usage inside the class, multiplied by thirty to fifty percent of slack. That number has the property of rejecting nothing that was already normal behavior, which is essential so that turning the limit on is not mistaken for a service degradation. The second step is confronting the sum of ceilings with real capacity, and here the uncomfortable fact appears: the sum of individual budgets almost always exceeds service capacity, because not every customer peaks at the same time. That is acceptable and is exactly the reason a global ceiling sits above the individual ones, working as a last resort valve. What is not acceptable is the sum exceeding capacity by an order of magnitude, because in that case individual limits are never reached and the effective protection goes back to being the global ceiling, with all the collateral damage it produces. When the arithmetic does not close, the way out is creating classes with differentiated ceilings and moving the cost into the plan, not flattening everybody onto the same number.',
    },
    {
      question: 'Is it worth limiting by estimated cost instead of by request count?',
      answer:
        'It is worth it when cost variation between operations exceeds an order of magnitude, and it is not worth it when the workload is homogeneous, because the cost unit has to be explained to the integrator and a unit nobody understands generates more tickets than it prevents. The practical criterion is measuring the processing time distribution per route: if the ninety fifth percentile of the most expensive route is up to ten times that of the cheapest one, counting requests with a higher cost on expensive routes already solves it, and that is the approach in this article example, where the expensive route consumes more tokens from the same bucket. If the difference is a hundred times or more, as happens between a lookup by identifier and a full export, counting requests becomes fiction and the limit needs to be expressed in a unit that reflects work, whether processing time, returned rows or a synthetic unit published in the documentation. The caveat with cost based limiting is that the real cost is only known after execution, which forces a reserve and settle scheme: charging an estimate before execution and refunding or charging the difference at the end. That is the same mechanism used in per customer spend caps and carries the same care, which is ensuring the refund happens even when the request fails midway, otherwise the customer keeps paying for work never done. A simpler alternative, and sufficient in most cases, is keeping the limit in requests and creating a separate parallel concurrency limit, restricting how many expensive operations each customer may have running simultaneously, which protects capacity without requiring any new unit.',
    },
    {
      question: 'What changes in rate limiting when the API is used by your own product front end and not only by integrators?',
      answer:
        'What changes is the identity that makes sense to count and the meaning of a rejection. A front end distributes the same application credential across all end users, so limiting per customer would put thousands of people inside a single budget, and the first burst of normal usage would take the whole application down. The correct key in that case is composite, combining the application identifier with the authenticated user identifier, which gives each session its own budget and keeps the possibility of an aggregate per application ceiling above it. For unauthenticated traffic from your own product, such as a public page with search, identity goes back to being network based and the budget needs to be small, complemented by controls that are not rate based, such as lightweight proof of work or origin verification, because a per address limit is bypassable with many addresses. The second point is the meaning of a rejection: for an integrator, a 429 is an operational instruction their library handles, while for an end user it is an error screen they have no way to resolve. That makes the alternative answers far more valuable on the product path, and it is where serving from cache, degrading the operation or simply slowing the interface down with a loading indicator are worth more than any status code. It is also worth physically separating the two paths, with distinct limits, policies and even entry points for product traffic and integration traffic, because they have different load shapes and mixing them forces a compromise that penalizes both.',
    },
  ],
  conclusion: {
    title: 'A per customer limit trades collateral damage for contracted predictability',
    description:
      'A global ceiling contains load and distributes rejection across whoever was arriving, which makes the right customer pay for the wrong one behavior and turns service quality into something impossible to document. Resolving caller identity before counting, choosing the algorithm by the burst shape it permits, keeping the counter atomic and shared with explicit degradation, and emitting headers on every response turn the limit into a contract an integrator can honor on their own. I can design your budget classes from the real usage of your API, implement the distributed limiter with alternative overflow answers, define the degradation policy for when the central counter fails and configure the four indicators that show whether the limit is protecting the service or merely pushing the problem onto the customer.',
    cta: 'Talk about the rate limit in my API',
  },
  related: [
    {
      label: 'Cascading timeouts: when the client retry takes down the service',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'The wrong partition key: the queue that stalls because one customer takes it all',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observability and Reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El límite global entró en producción un viernes por la tarde para contener a un socio que disparaba sesenta llamadas por segundo, y a las cinco el equipo celebró porque la latencia volvió a la normalidad. El lunes el mayor cliente de la empresa abrió un ticket diciendo que la integración de inventario dejó de funcionar a las nueve cuarenta, exactamente cuando el socio abusivo también estaba activo. El límite funcionó: tumbó a los dos. Este artículo muestra por qué el techo global es un mecanismo de daño colateral y no de protección, cuál es la diferencia práctica entre los cuatro algoritmos de limitación y por qué la ventana fija entrega el doble del pico contratado, por qué la identidad del llamador debe resolverse antes de cualquier conteo y qué ocurre cuando esa identidad es la dirección de red, cómo el estado distribuido del contador sobrevive a varias instancias de borde sin volverse un cuello de botella, por qué rechazar no es la única respuesta posible y cuándo encolar es mejor, qué cabeceras convierten el rechazo en un contrato en lugar de un accidente, y qué cuatro indicadores dicen si el límite está protegiendo el servicio o solo empujando el problema.',
  sections: [
    {
      title: 'El límite global protege el promedio y sacrifica al cliente correcto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer límite que gana cualquier servicio suele ser global: un techo de peticiones por segundo aplicado en el borde, sin distinguir quién llamó. Es fácil de configurar, viene listo en cualquier proxy inverso y tiene la propiedad que todos quieren durante el incidente, que es contener la carga de inmediato. El problema es que la contención no elige objetivo. Cuando se alcanza el techo, el rechazo recae sobre quien estaba llegando en ese instante, y la probabilidad de ser rechazado es proporcional al volumen que cada uno envía. El cliente que manda tres llamadas por minuto casi nunca es rechazado. El cliente que manda doscientas por minuto porque su negocio lo exige es rechazado todo el tiempo, junto con el abusivo.',
        },
        {
          type: 'paragraph',
          value:
            'Existe un efecto más perverso que aparece después. El límite global crea una competencia entre clientes que nunca se conocieron. La capacidad que le queda al cliente A depende del comportamiento del cliente B, lo que significa que la calidad de servicio que percibe un integrador pasa a ser función de lo que otro integrador hizo en la misma ventana. Eso es imposible de documentar en un contrato, imposible de reproducir en una prueba e imposible de explicar en un ticket. La pregunta que hace el cliente, con razón, es cuál es su límite, y bajo un techo global la respuesta honesta es que depende de los demás.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección conceptual es tratar el límite como una asignación de capacidad y no como un freno de emergencia. Cada llamador recibe su propio presupuesto, verificable e independiente, y el servicio pasa a tener una suma de presupuestos que sabe sostener. Un llamador que supera su propio presupuesto consume solo su porción, y su exceso nunca se acerca a la porción de nadie. Es el mismo cambio de mentalidad que separa un pool de conexiones compartido de pools aislados por carga: el aislamiento cuesta un poco de eficiencia promedio y compra previsibilidad, que es justamente lo que un contrato de integración necesita vender.',
        },
        {
          type: 'table',
          columns: ['Modelo', 'Quién paga en el pico', 'Previsibilidad para el cliente', 'Cuándo sigue teniendo sentido'],
          rows: [
            [
              'Techo global en el borde',
              'Quien llegó en el instante equivocado, proporcional al volumen legítimo',
              'Ninguna: el límite efectivo depende de los demás llamadores',
              'Válvula de último recurso por encima de los límites por cliente',
            ],
            [
              'Límite por dirección de red',
              'Todos los que comparten salida NAT o el mismo proveedor de nube',
              'Baja: el mismo cliente cambia de identidad entre llamadas',
              'Tráfico anónimo, antes de la autenticación',
            ],
            [
              'Límite por credencial de cliente',
              'Solo el llamador que superó su propio presupuesto',
              'Alta: el número entra en el contrato y es reproducible',
              'Estándar para cualquier API con llamador identificado',
            ],
            [
              'Límite por credencial y por ruta',
              'El llamador, solo en la operación cara de la que abusó',
              'Alta, con granularidad que refleja el costo real',
              'Cuando una ruta cuesta órdenes de magnitud más que las otras',
            ],
            [
              'Cuota por costo estimado',
              'El llamador, proporcional al trabajo que generó',
              'Media: exige explicar la unidad de costo al integrador',
              'Cargas heterogéneas, como búsqueda, reporte y exportación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda fila merece un comentario porque es la elección más común y la que más tickets produce. Limitar por dirección de red parece razonable hasta el día en que un cliente corporativo entero sale por una única dirección y consume el presupuesto de mil empleados como si fuera un solo llamador, o hasta el día en que un integrador corre en funciones serverless y aparece con una dirección nueva cada minuto, escapando de cualquier conteo. La dirección de red es una identidad útil antes de la autenticación y engañosa después de ella.',
        },
      ],
    },
    {
      title: 'La identidad del llamador es la decisión que antecede al algoritmo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de elegir entre ventana deslizante y cubeta de fichas hay que responder una pregunta más básica: qué se está contando exactamente. La clave de limitación es la unidad sobre la cual se aplica el presupuesto, y elegirla mal vuelve irrelevante al algoritmo, porque contar perfectamente la cosa equivocada sigue siendo un error. En una API con llamadores identificados, la clave casi siempre se deriva de la credencial presentada, no del transporte.',
        },
        {
          type: 'paragraph',
          value:
            'La extracción de esa clave tiene un orden que importa. Debe ocurrir después de validar la credencial, porque una clave extraída de un token no verificado es una clave que elige el atacante, y un atacante que elige su propia clave de limitación simplemente genera una nueva por petición y nunca es limitado. Al mismo tiempo, la validación completa suele implicar una consulta, lo que significa que el camino de petición no autenticada necesita su propio límite, más estrecho y basado en dirección de red, para que el costo de validar una credencial inválida no se vuelva el propio vector de ataque.',
        },
        {
          type: 'code',
          value: `// Resolucion de la clave de limitacion antes de cualquier conteo.
// El orden importa: una identidad no confiable nunca se vuelve clave
// de presupuesto.

const CLASE_ANONIMA = 'anon';

/**
 * Deriva la clave de limitacion a partir del contexto de la peticion.
 * Devuelve tambien la clase, porque el presupuesto y la politica de
 * excedente cambian segun el plan del cliente.
 */
export function resolverClaveDeLimite(req, credencialVerificada) {
  // 1) Sin credencial verificada, la unica identidad disponible es la de red.
  //    El presupuesto aqui es pequeno a proposito: cubre login, intercambio
  //    de token y rutas publicas, no trafico de integracion.
  if (!credencialVerificada) {
    return {
      clave: \`\${CLASE_ANONIMA}:\${direccionDeOrigen(req)}\`,
      clase: CLASE_ANONIMA,
      alcance: 'red',
    };
  }

  // 2) Con credencial verificada, la identidad estable es el cliente,
  //    no la clave de API: un cliente que rota claves no debe ganar
  //    presupuesto nuevo en cada rotacion.
  const { clienteId, claveId, plan } = credencialVerificada;

  // 3) Las rutas caras reciben su propio alcance. Sin esto, una exportacion
  //    completa consume el presupuesto que sostendria mil consultas baratas.
  const grupoDeRuta = clasificarRuta(req.method, req.routePattern);

  if (grupoDeRuta === 'cara') {
    return {
      clave: \`cli:\${clienteId}:ruta:\${grupoDeRuta}\`,
      clase: plan,
      alcance: 'cliente+ruta',
      claveId,
    };
  }

  return {
    clave: \`cli:\${clienteId}\`,
    clase: plan,
    alcance: 'cliente',
    claveId,
  };
}

/**
 * Una direccion de origen confiable exige saber cuantos proxies hay
 * delante. Leer el primer valor de X-Forwarded-For sin esa cuenta es
 * aceptar la direccion que el cliente escribio.
 */
function direccionDeOrigen(req) {
  const PROXIES_CONFIABLES = 1; // borde propio; ajustar por entorno
  const cadena = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((parte) => parte.trim())
    .filter(Boolean);

  if (cadena.length > PROXIES_CONFIABLES) {
    return cadena[cadena.length - 1 - PROXIES_CONFIABLES];
  }
  return req.socket.remoteAddress;
}

function clasificarRuta(metodo, patron) {
  const CARAS = new Set([
    'GET /v1/reportes/:id/exportar',
    'POST /v1/busquedas/avanzada',
    'POST /v1/lotes/importar',
  ]);
  return CARAS.has(\`\${metodo} \${patron}\`) ? 'cara' : 'estandar';
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle de la función de dirección de origen es lo que separa un limitador funcional de uno que se puede eludir en una línea. Leer el primer elemento de la cabecera de reenvío es el error clásico, porque ese elemento lo escribe el cliente y puede contener cualquier cosa. El valor confiable se cuenta desde el final, saltando exactamente el número de proxies que la propia infraestructura coloca delante, y ese número debe ser configuración explícita, no una suposición. Un borde que gana un balanceador nuevo sin actualizar ese conteo pasa a limitar la dirección del balanceador, lo que en la práctica limita a todos juntos.',
        },
        {
          type: 'paragraph',
          value:
            'La elección de usar el identificador del cliente en lugar del identificador de la clave de API también tiene consecuencia operativa. Si el presupuesto fuera por clave, un integrador podría multiplicar su propia capacidad simplemente emitiendo más claves, y la rotación de credenciales, que es una práctica deseable, crearía presupuesto extra como efecto colateral. Conviene mantener el identificador de la clave en las etiquetas de métrica, porque es lo que permite descubrir qué sistema del cliente está generando el exceso, pero no debe entrar en la clave de conteo.',
        },
      ],
    },
    {
      title: 'Cuatro algoritmos, y por qué la ventana fija entrega el doble del pico',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la clave resuelta, la elección del algoritmo pasa a ser sobre qué forma de tráfico permite el límite. Los cuatro candidatos habituales respetan el mismo promedio a largo plazo, y por eso una comparación hecha solo con el promedio no revela ninguna diferencia. La diferencia está en la forma de la ráfaga que cada uno deja pasar y en el costo de mantener el estado.',
        },
        {
          type: 'paragraph',
          value:
            'La ventana fija cuenta peticiones dentro de un intervalo de reloj y pone el conteo en cero cuando el intervalo cambia. Es la más simple y tiene un defecto que siempre aparece en producción: un cliente que envía todo su presupuesto en los últimos instantes de una ventana y lo repite en el primer instante de la siguiente entrega el doble del techo contratado dentro de un intervalo continuo. Un techo de cien peticiones por minuto se vuelve doscientas en un segundo, y el borde considera ambas ventanas dentro de la política. Ese comportamiento no es raro ni exige mala intención: cualquier cliente que sincroniza trabajo al inicio del minuto, que es el patrón de los planificadores, produce exactamente esa forma.',
        },
        {
          type: 'diagram',
          value: `VENTANA FIJA: el pico de frontera

  techo = 100 req/min

  minuto 1                    | minuto 2
  ............................|............................
                       [100]  | [100]
                         ^         ^
                         |         |
                    59.6s |         | 60.2s

  intervalo continuo de 1 segundo -> 200 peticiones
  conteo de la ventana 1 = 100 (dentro de la politica)
  conteo de la ventana 2 = 100 (dentro de la politica)

VENTANA DESLIZANTE PONDERADA: la frontera desaparece

  estimacion = conteo_actual + conteo_anterior * fraccion_restante

  en 60.2s, fraccion restante de la ventana anterior = 0.997
  estimacion = 100 + 100 * 0.997 = 199.7 -> rechaza

CUBETA DE FICHAS: rafaga explicita y controlada

  capacidad = 20 fichas (rafaga maxima)
  reposicion = 100/60 fichas por segundo (tasa promedio)

  un cliente ocioso acumula hasta 20 y las gasta de una vez,
  despues vuelve a estar limitado por la tasa de reposicion.`,
        },
        {
          type: 'paragraph',
          value:
            'La ventana deslizante ponderada corrige la frontera sin guardar la lista de marcas de tiempo de cada petición. Mantiene dos conteos, el de la ventana actual y el de la anterior, y estima el consumo como el conteo actual sumado al conteo anterior multiplicado por la fracción de la ventana anterior que todavía está dentro del intervalo de observación. La estimación no es exacta, pero se equivoca por poco y por un factor conocido, y cuesta dos enteros por clave en vez de una lista. Es la elección predeterminada cuando el objetivo es hacer valer un número contratado con la mínima sorpresa.',
        },
        {
          type: 'paragraph',
          value:
            'La cubeta de fichas resuelve un problema distinto: permite ráfaga a propósito. La capacidad de la cubeta es el tamaño de la ráfaga que el cliente puede emitir después de un período de ociosidad, y la tasa de reposición es el promedio sostenido. Eso es lo que quieren las integraciones reales, porque un sistema que procesa un lote de pedidos cada cinco minutos necesita ráfaga, y la ventana deslizante lo trataría como abusivo. La cubeta con fuga es lo inverso: acepta ráfaga en la entrada pero entrega a una tasa constante, lo que la convierte en un encolador y no en un rechazador, y por eso aparece en la sección sobre qué hacer con el excedente.',
        },
        {
          type: 'table',
          columns: ['Algoritmo', 'Estado por clave', 'Ráfaga permitida', 'Falla característica'],
          rows: [
            [
              'Ventana fija',
              'Un contador y un instante de cambio',
              'Hasta el doble del techo en la frontera',
              'Pico de frontera que el panel nunca muestra',
            ],
            [
              'Ventana deslizante ponderada',
              'Dos contadores',
              'Prácticamente ninguna, el techo se respeta',
              'Estimación levemente conservadora con tráfico irregular',
            ],
            [
              'Cubeta de fichas',
              'Saldo e instante de la última reposición',
              'Explícita, igual a la capacidad de la cubeta',
              'Una ráfaga mal dimensionada se vuelve pico real en el origen',
            ],
            [
              'Cubeta con fuga',
              'Cola con tamaño máximo',
              'Absorbida por la cola, nunca trasladada',
              'La latencia crece en silencio hasta que la cola se llena',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En la práctica las dos últimas no compiten: se combinan. La cubeta de fichas decide qué es exceso y la cubeta con fuga decide qué hacer con parte de ese exceso. Un arreglo que funciona bien en APIs de integración usa fichas para el techo por cliente, con capacidad de ráfaga en torno al diez o veinte por ciento del techo por minuto, y un pequeño encolamiento con espera corta antes de rechazar, lo que absorbe la ráfaga accidental de un planificador sin ocultar el abuso sostenido.',
        },
      ],
    },
    {
      title: 'El contador distribuido entre instancias de borde',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un limitador en memoria es correcto mientras exista una sola instancia de borde. Con seis instancias detrás de un balanceador, cada una pasa a ver aproximadamente un sexto del tráfico del cliente y a aplicar el techo entero sobre esa fracción, lo que multiplica el límite efectivo por el número de instancias. Peor aún: el factor de multiplicación cambia solo cuando el autoescalado agrega instancias durante el pico, es decir, el límite se afloja exactamente cuando debería apretarse.',
        },
        {
          type: 'paragraph',
          value:
            'La solución directa es un contador compartido, y la implementación que sobrevive a la concurrencia debe ser atómica. Leer el valor, decidir y escribir de vuelta en tres operaciones separadas produce una condición de carrera bajo carga, que es justamente el régimen en el que el límite importa. En un almacén de clave y valor con ejecución de scripts, la decisión entera corre del lado del servidor, lo que además reduce a una la cantidad de viajes de red por petición.',
        },
        {
          type: 'code',
          value: `-- Cubeta de fichas atomica en Lua, ejecutada dentro de Redis.
-- KEYS[1]  clave del cliente
-- ARGV[1]  capacidad de la cubeta (rafaga maxima)
-- ARGV[2]  tasa de reposicion en fichas por segundo
-- ARGV[3]  instante actual en milisegundos
-- ARGV[4]  fichas pedidas (costo de la peticion)
-- Devuelve: { permitido, restante, espera_ms, reset_s }

local capacidad = tonumber(ARGV[1])
local tasa      = tonumber(ARGV[2])
local ahora     = tonumber(ARGV[3])
local pedido    = tonumber(ARGV[4])

local estado    = redis.call('HMGET', KEYS[1], 'fichas', 'ts')
local fichas    = tonumber(estado[1])
local ultimoTs  = tonumber(estado[2])

if fichas == nil then
  fichas   = capacidad
  ultimoTs = ahora
end

-- Reposicion proporcional al tiempo transcurrido, limitada por la capacidad.
local transcurrido = math.max(0, ahora - ultimoTs) / 1000
fichas = math.min(capacidad, fichas + transcurrido * tasa)

local permitido = 0
local espera = 0

if fichas >= pedido then
  fichas = fichas - pedido
  permitido = 1
else
  -- Cuanto falta para acumular lo que hace falta.
  espera = math.ceil(((pedido - fichas) / tasa) * 1000)
end

redis.call('HSET', KEYS[1], 'fichas', fichas, 'ts', ahora)

-- Expiracion = tiempo para rellenar la cubeta desde cero, con holgura.
-- Sin esto, cada cliente que llamo una vez queda en memoria para siempre.
local ttl = math.ceil(capacidad / tasa) + 10
redis.call('EXPIRE', KEYS[1], ttl)

local reset = math.ceil((capacidad - fichas) / tasa)
return { permitido, math.floor(fichas), espera, reset }`,
        },
        {
          type: 'paragraph',
          value:
            'La línea de la expiración es la que evita la fuga lenta que suele pasar desapercibida durante meses. Sin tiempo de vida, cada cliente que llamó la API una sola vez deja una clave residente, y en un servicio con llamadores efímeros eso crece hasta que el almacén se queda sin memoria. El tiempo de vida correcto es el tiempo necesario para que la cubeta vuelva a la capacidad llena, porque a partir de ahí el estado guardado es indistinguible del estado inicial y puede descartarse sin alterar ninguna decisión.',
        },
        {
          type: 'paragraph',
          value:
            'Existe el costo del viaje hasta el almacén compartido en cada petición, y es real. La salida usada en servicios de alto volumen es un esquema de dos capas: cada instancia mantiene un limitador local que autoriza una fracción del presupuesto y se sincroniza periódicamente con el contador central, pidiendo un bloque de fichas en lugar de una ficha por vez. El límite pasa a ser aproximadamente correcto en lugar de exactamente correcto, con un error máximo igual al tamaño del bloque multiplicado por el número de instancias, lo que es aceptable cuando el techo es una protección y no un cobro. Cuando el número se factura, la aproximación deja de ser aceptable y el viaje central vuelve a ser obligatorio.',
        },
        {
          type: 'paragraph',
          value:
            'La última decisión de esa capa es qué hacer cuando el almacén compartido queda indisponible. Fallar cerrado convierte una indisponibilidad del limitador en indisponibilidad total de la API, lo que es desproporcionado. Fallar abierto quita la protección justamente durante un incidente de infraestructura, que es cuando la carga suele ser anormal. El comportamiento equilibrado es caer al limitador local de cada instancia, con el presupuesto dividido por el número esperado de instancias y un techo global de seguridad por encima, y registrar esa degradación como un evento explícito para que no pase desapercibida.',
        },
      ],
    },
    {
      title: 'Rechazar no es la única respuesta, y la cabecera es parte del contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El tratamiento del excedente suele reducirse a una decisión binaria entre pasar y rechazar, y esa reducción descarta las respuestas más útiles. Un excedente puede encolarse por un período corto, puede servirse desde una caché con un dato ligeramente más antiguo, puede degradarse a una versión más barata de la misma operación, o puede aceptarse y procesarse de forma asíncrona con un identificador de seguimiento. Cada una de esas respuestas preserva la intención del llamador en lugar de descartarla, y todas le cuestan menos al servicio que el pico original.',
        },
        {
          type: 'list',
          items: [
            'Encolar con espera corta, del orden de cincuenta a doscientos milisegundos, absorbe la ráfaga del planificador sin ocultar el abuso sostenido, porque el abuso sostenido llena la cola y vuelve a rechazar.',
            'Servir desde la caché es la mejor respuesta para lecturas que toleran algunos segundos de retraso, y convierte el excedente en un costo casi nulo en lugar de un error.',
            'Degradar la operación, respondiendo una búsqueda sin los campos derivados caros o un reporte con menor granularidad, mantiene vivo el flujo del cliente y señala la degradación en el cuerpo de la respuesta.',
            'Aceptar de forma asíncrona es el camino natural para la escritura en lote, y cambia un rechazo por un identificador que el cliente consulta después.',
            'Rechazar con un 429 sigue siendo la respuesta correcta para el abuso sostenido y para operaciones que no tienen versión barata ni asíncrona.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Cuando el rechazo es la respuesta, lo que separa un límite utilizable de uno hostil es la información que acompaña la negativa. Un cliente que recibe solo el código de estado no tiene cómo comportarse bien, y la reacción previsible es reintentar de inmediato, lo que aumenta la carga exactamente en el momento de saturación. Las cabeceras estandarizadas de limitación existen para resolver eso y tienen un formato que las bibliotecas de cliente ya esperan.',
        },
        {
          type: 'code',
          value: `// Middleware de limitacion con cabeceras que convierten el limite en contrato.
// El formato de las cabeceras sigue el draft RateLimit del IETF, que es lo que
// las bibliotecas de cliente modernas ya saben interpretar.

import { createClient } from 'redis';
import { readFile } from 'node:fs/promises';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();
const script = await readFile(new URL('./cubeta.lua', import.meta.url), 'utf8');
const sha = await redis.scriptLoad(script);

const PRESUPUESTO = {
  // techo por minuto y rafaga por plan; la rafaga queda en torno al 15%
  // del techo, suficiente para un planificador e insuficiente para abuso.
  free:       { porMinuto: 60,   rafaga: 10 },
  pro:        { porMinuto: 600,  rafaga: 90 },
  enterprise: { porMinuto: 6000, rafaga: 900 },
  anon:       { porMinuto: 20,   rafaga: 5 },
};

export function limitadorPorCliente({ alExceder = 'rechazar' } = {}) {
  return async function middleware(req, res, next) {
    const { clave, clase } = resolverClaveDeLimite(req, req.credencial);
    const plan = PRESUPUESTO[clase] || PRESUPUESTO.free;
    const costo = costoDeLaPeticion(req);  // 1 por defecto, mayor en ruta cara

    let resultado;
    try {
      resultado = await redis.evalSha(sha, {
        keys: [\`rl:\${clave}\`],
        arguments: [
          String(plan.rafaga),
          String(plan.porMinuto / 60),
          String(Date.now()),
          String(costo),
        ],
      });
    } catch (error) {
      // Degradacion explicita: cayo el limitador central, no la API.
      req.log.warn({ error: error.message }, 'limitador degradado a local');
      return limitadorLocal(req, res, next, plan);
    }

    const [permitido, restante, esperaMs, resetS] = resultado.map(Number);

    // Cabeceras en toda respuesta, no solo en el rechazo: el cliente bien
    // comportado necesita ver la holgura encogiendo antes de tocar el techo.
    res.setHeader('RateLimit-Limit', String(plan.porMinuto));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, restante)));
    res.setHeader('RateLimit-Reset', String(resetS));
    res.setHeader('RateLimit-Policy', \`\${plan.porMinuto};w=60;burst=\${plan.rafaga}\`);

    if (permitido === 1) return next();

    // Una espera corta absorbe la rafaga del planificador sin enmascarar abuso.
    if (alExceder === 'encolar' && esperaMs <= 200) {
      await new Promise((resolver) => setTimeout(resolver, esperaMs));
      return middleware(req, res, next);
    }

    const retryAfter = Math.max(1, Math.ceil(esperaMs / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({
      error: 'rate_limit_excedido',
      // El mensaje dice que hacer, no solo que ocurrio.
      mensaje: \`Presupuesto de \${plan.porMinuto} peticiones por minuto excedido. \` +
        \`Reintente en \${retryAfter}s o use el endpoint por lotes.\`,
      limite: plan.porMinuto,
      ventanaSegundos: 60,
      reintentarEnSegundos: retryAfter,
    });
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle de emitir las cabeceras en toda respuesta, y no solo en el rechazo, es lo que cambia el comportamiento del integrador. Un cliente que ve la holgura encogerse de quinientos a cincuenta a lo largo de treinta segundos puede desacelerar por su cuenta antes del error, y las bibliotecas de cliente modernas lo hacen automáticamente cuando las cabeceras están presentes. Emitir la información solo en el momento de la negativa equivale a avisar del límite después de que ya fue superado, lo que sirve para explicar y no para prevenir.',
        },
        {
          type: 'paragraph',
          value:
            'La cabecera de reintento merece un cuidado específico. Si todos los clientes rechazados reciben exactamente el mismo valor, todos vuelven exactamente en el mismo instante y producen un pico sincronizado al final de la espera, que es el mismo fenómeno de rebaño que tumba servicios después de una caída. La corrección es agregar una dispersión aleatoria del diez al veinte por ciento sobre el valor calculado, de modo que el retorno quede distribuido en lugar de simultáneo.',
        },
      ],
    },
    {
      title: 'Los cuatro indicadores que distinguen proteger de empujar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un límite de tasa es una política, y las políticas necesitan evidencia para ser ajustadas. La métrica que casi todos instrumentan primero, el conteo de respuestas 429, es la menos útil por sí sola, porque sube tanto cuando el límite está protegiendo correctamente como cuando está demasiado apretado, y esos dos casos exigen acciones opuestas. Lo que los distingue es mirar la distribución por cliente y qué tan cerca del techo están los que nunca son rechazados.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué responde', 'Señal de límite bien calibrado', 'Señal de problema'],
          rows: [
            [
              'Rechazos por cliente, no agregados',
              'Quién está tocando el techo',
              'Concentración en pocos llamadores conocidos',
              'Rechazos repartidos entre muchos clientes pequeños',
            ],
            [
              'Utilización del presupuesto en el percentil noventa y cinco',
              'Cuánto de su porción usa cada cliente en el pico',
              'La mayoría por debajo del setenta por ciento',
              'Varios clientes por encima de noventa y cinco sin rechazar aún',
            ],
            [
              'Latencia del propio limitador',
              'Cuánto le cuesta la protección al camino de petición',
              'Por debajo de dos milisegundos en el percentil noventa y nueve',
              'Cola alta, indicando viaje de red saturado',
            ],
            [
              'Tiempo en modo degradado',
              'Cuánto estuvo aproximado el límite por fallo central',
              'Cerca de cero, con eventos aislados',
              'Minutos acumulados por día sin que nadie lo sepa',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda fila es la que permite actuar antes del ticket. Un cliente que pasa semanas usando el noventa y cinco por ciento de su presupuesto sin ser rechazado está a un crecimiento del diez por ciento de volverse un incidente, y ese es el momento de conversar sobre el plan, sobre un endpoint por lotes o sobre un aumento de porción, y no después de que su integración se rompió. Ese indicador convierte al límite de tasa en una herramienta comercial además de técnica, porque muestra quién está a punto de necesitar más capacidad.',
        },
        {
          type: 'paragraph',
          value:
            'La primera fila resuelve la pregunta que da origen a toda la sección. Si los rechazos están concentrados en pocos llamadores identificables, el límite está haciendo exactamente lo que fue diseñado para hacer: aislar el exceso dentro de la porción de quien lo produjo. Si están repartidos entre muchos clientes pequeños, el techo está por debajo del uso legítimo y la política necesita revisión, porque en ese régimen el límite dejó de proteger el servicio y pasó a ser la principal causa de error que los clientes ven.',
        },
        {
          type: 'ordered',
          items: [
            'Instrumentar antes de limitar: correr el limitador en modo de observación durante una o dos semanas, calculando la decisión y registrando la métrica sin rechazar nada.',
            'Definir el techo de cada plan en el percentil noventa y nueve del uso observado, con holgura, para que el límite inicial no rechace ningún comportamiento que ya era normal.',
            'Habilitar el rechazo primero para la clase anónima y para las rutas caras, que es donde el riesgo es mayor y el impacto en clientes legítimos es menor.',
            'Publicar los límites en la documentación junto con las cabeceras emitidas, porque un límite no documentado es indistinguible de una inestabilidad desde el punto de vista del integrador.',
            'Habilitar el rechazo por cliente autenticado, siguiendo la distribución de rechazos por llamador durante los primeros días.',
            'Revisar mensualmente la utilización en el percentil noventa y cinco por cliente y ajustar porciones antes de que aparezcan los rechazos.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cómo definir el valor inicial del techo por cliente sin inventar un número redondo?',
      answer:
        'El camino que evita tanto el límite inútil como el límite hostil es derivar el número del uso observado antes de derivarlo de la capacidad. La primera etapa es correr el limitador en modo de observación, calculando la decisión completa y registrando la métrica de utilización sin rechazar nada, durante un período que cubra al menos un ciclo de negocio entero, que en integraciones suele ser un mes porque existe un pico de cierre. Con esa muestra, el techo inicial de cada clase sale del percentil noventa y nueve del uso por cliente dentro de la clase, multiplicado por una holgura del treinta al cincuenta por ciento. Ese número tiene la propiedad de no rechazar nada que ya era comportamiento normal, lo que es fundamental para que la activación del límite no se confunda con una degradación del servicio. La segunda etapa es confrontar la suma de los techos con la capacidad real, y aquí aparece el hecho incómodo: la suma de presupuestos individuales casi siempre excede la capacidad del servicio, porque no todos los clientes llegan al pico al mismo tiempo. Eso es aceptable y es exactamente la razón de que exista un techo global por encima de los individuales, funcionando como válvula de último recurso. Lo que no es aceptable es que la suma exceda la capacidad en un orden de magnitud, porque en ese caso los límites individuales nunca se alcanzan y la protección efectiva vuelve a ser el techo global, con todo el daño colateral que produce. Cuando la cuenta no cierra, la salida es crear clases con techos diferenciados y mover el costo al plan, no aplanar a todos en el mismo número.',
    },
    {
      question: '¿Vale la pena limitar por costo estimado en lugar de por número de peticiones?',
      answer:
        'Vale cuando la variación de costo entre operaciones supera un orden de magnitud, y no vale cuando la carga es homogénea, porque la unidad de costo debe explicarse al integrador y una unidad que nadie entiende genera más tickets de los que previene. El criterio práctico es medir la distribución de tiempo de procesamiento por ruta: si el percentil noventa y cinco de la ruta más cara es hasta diez veces el de la más barata, contar peticiones con un costo mayor para las rutas caras ya lo resuelve, y ese es el enfoque del ejemplo de este artículo, donde la ruta cara consume más fichas de la misma cubeta. Si la diferencia es de cien veces o más, como ocurre entre una consulta por identificador y una exportación completa, contar peticiones se vuelve ficción y el límite necesita expresarse en una unidad que refleje trabajo, sea tiempo de procesamiento, sean filas devueltas, sea una unidad sintética publicada en la documentación. El punto de atención de la limitación por costo es que el costo real solo se conoce después de ejecutar, lo que obliga a un esquema de reserva y ajuste: cobrar una estimación antes de la ejecución y devolver o cobrar la diferencia al final. Ese es el mismo mecanismo usado en techos de gasto por cliente y tiene el mismo cuidado, que es garantizar que la devolución ocurra incluso cuando la petición falla a la mitad, so pena de que el cliente quede pagando por trabajo que nunca se hizo. Una alternativa más simple, y suficiente en la mayoría de los casos, es mantener el límite en peticiones y crear un límite separado y paralelo por concurrencia, restringiendo cuántas operaciones caras puede tener cada cliente en ejecución simultánea, lo que protege la capacidad sin exigir ninguna unidad nueva.',
    },
    {
      question: '¿Qué cambia en el límite de tasa cuando la API la usa el front end del propio producto y no solo integradores?',
      answer:
        'Cambia la identidad que tiene sentido contar y cambia el significado de un rechazo. Un front end distribuye la misma credencial de aplicación entre todos los usuarios finales, así que limitar por cliente pondría a miles de personas dentro de un único presupuesto, y la primera ráfaga de uso normal tumbaría la aplicación entera. La clave correcta en ese caso es compuesta, combinando el identificador de la aplicación con el identificador del usuario autenticado, lo que le da a cada sesión su propio presupuesto y mantiene la posibilidad de un techo agregado por aplicación por encima. Para el tráfico no autenticado del propio producto, como una página pública con búsqueda, la identidad vuelve a ser de red y el presupuesto debe ser pequeño, complementado por controles que no son de tasa, como prueba de trabajo ligera o verificación de origen, porque un límite por dirección se elude con muchas direcciones. El segundo punto es el significado del rechazo: para un integrador, un 429 es una instrucción operativa que su biblioteca maneja, mientras que para un usuario final es una pantalla de error que no tiene cómo resolver. Eso vuelve mucho más valiosas a las respuestas alternativas en el camino del producto, y es donde servir desde la caché, degradar la operación o simplemente desacelerar la interfaz con una indicación de carga valen más que cualquier código de estado. Conviene además separar físicamente los dos caminos, con límites, políticas e incluso puntos de entrada distintos para el tráfico de producto y el de integración, porque tienen formas de carga diferentes y mezclarlos fuerza un compromiso que penaliza a ambos.',
    },
  ],
  conclusion: {
    title: 'El límite por cliente cambia daño colateral por previsibilidad contratada',
    description:
      'Un techo global contiene la carga y reparte el rechazo entre quienes estaban llegando, lo que hace que el cliente correcto pague por el comportamiento del equivocado y vuelve imposible documentar la calidad de servicio. Resolver la identidad del llamador antes de contar, elegir el algoritmo por la forma de ráfaga que permite, mantener el contador atómico y compartido con degradación explícita, y emitir las cabeceras en toda respuesta convierten el límite en un contrato que el integrador puede respetar por su cuenta. Puedo diseñar las clases de presupuesto a partir del uso real de su API, implementar el limitador distribuido con las respuestas alternativas al excedente, definir la política de degradación cuando el contador central falla y configurar los cuatro indicadores que muestran si el límite está protegiendo el servicio o solo empujando el problema hacia el cliente.',
    cta: 'Hablar sobre el límite de tasa de mi API',
  },
  related: [
    {
      label: 'Timeout en cascada: cuándo el retry del cliente tumba el servicio',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Clave de particionamiento equivocada: la cola que se traba porque un cliente lo ocupa todo',
      to: '/blog/chave-particionamento-errada-fila-trava-cliente-sozinho-ocupa-tudo',
    },
    {
      label: 'Observabilidad y Confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
