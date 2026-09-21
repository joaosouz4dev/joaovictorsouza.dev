// Conteudo do artigo: limite de tamanho de payload e a requisicao legitima que
// passa a ser recusada por um teto que ninguem escolheu de forma consciente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O parceiro integrou em janeiro, rodou nove meses sem um único erro e na terça-feira passou a receber recusa em uma requisição a cada cem. O corpo era o mesmo formato de sempre, o token era válido, o endereço não mudou e o erro chegava antes de qualquer log da aplicação: o serviço nunca viu aquela requisição. O que mudou não foi o cliente e não foi o servidor, foi a distribuição do tamanho dos pedidos, que cresceu o suficiente para encostar em um teto que ninguém escolheu conscientemente e que está declarado em quatro lugares diferentes do caminho. Este artigo mostra por que o limite efetivo é o menor de uma cadeia e não o que está no seu código, por que o erro aparece sem corpo e sem rastro e o que isso faz com o suporte, qual é a diferença entre o limite que protege memória e o limite que protege tempo e por que confundir os dois cria uma brecha, por que aumentar o número é a correção errada na maioria dos casos e qual é a certa, como transformar um teto invisível em contrato explícito que o cliente consegue respeitar antes de enviar, e quais cinco verificações separam um pedido abusivo de um pedido legítimo que simplesmente cresceu.',
  sections: [
    {
      title: 'O limite que vale é o menor da cadeia, e ele não está no seu código',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira reação de quem recebe o relato é abrir o código do serviço e procurar onde o tamanho máximo do corpo está configurado. Encontra-se um valor, ele parece generoso, e a conclusão imediata é que o problema deve estar em outro lugar. A conclusão está certa pelo motivo errado: o problema realmente está em outro lugar, porque o valor encontrado no código é apenas um dos quatro ou cinco tetos que uma requisição precisa atravessar, e o que decide o destino dela é o menor deles, não o último.',
        },
        {
          type: 'paragraph',
          value:
            'Uma requisição típica em produção passa por uma rede de distribuição de conteúdo, um balanceador gerenciado, um servidor de borda que faz terminação de conexão segura, um proxy reverso interno e finalmente o processo da aplicação. Cada uma dessas camadas tem um limite próprio, cada uma tem um padrão diferente, e nenhuma delas consulta as outras. O padrão de um servidor de borda popular é um megabyte, o de um gateway gerenciado costuma ser dez, o de um framework de aplicação frequentemente é cem kilobytes, e o da função sem servidor que alguém colocou no meio do caminho no ano passado pode ser seis megabytes com codificação obrigatória em base 64, o que derruba a capacidade útil para pouco mais de quatro.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência prática é que a resposta para a pergunta qual é o tamanho máximo que o meu serviço aceita não pode ser lida em nenhum arquivo de configuração isolado. Ela precisa ser medida atravessando o caminho inteiro, com uma requisição real, do lado de fora. Essa medição leva quinze minutos e é a única forma honesta de responder a um parceiro que pergunta quanto ele pode enviar.',
        },
        {
          type: 'table',
          columns: ['Camada do caminho', 'Padrão típico quando ninguém configurou', 'Formato do erro que ela devolve', 'Aparece no log da aplicação'],
          rows: [
            [
              'Rede de distribuição de conteúdo',
              'Entre 100 MB e sem limite, conforme o plano',
              'Página de erro genérica do provedor',
              'Não, a requisição nunca sai da borda',
            ],
            [
              'Balanceador gerenciado da nuvem',
              '1 MB a 10 MB conforme o tipo',
              'Código 413 sem corpo ou com corpo padrão',
              'Só na métrica do balanceador, não na aplicação',
            ],
            [
              'Servidor de borda ou proxy reverso',
              '1 MB na configuração padrão mais comum',
              'Página HTML de erro, não JSON',
              'No log do proxy, não no da aplicação',
            ],
            [
              'Framework ou middleware de corpo',
              '100 KB em vários ecossistemas',
              'Exceção tratável, formato controlado por você',
              'Sim, e é o único ponto onde isso é verdade',
            ],
            [
              'Função sem servidor no meio do caminho',
              '6 MB já contando a codificação de transporte',
              'Erro de invocação, frequentemente 502',
              'Não, e o rastro fica no provedor',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A coluna mais importante é a última. Em quatro das cinco camadas a requisição recusada não gera nenhuma linha no log da aplicação, o que significa que o painel de erros do time permanece limpo enquanto o parceiro acumula falhas. Esse descompasso é o que faz o incidente durar dias: o suporte pede o identificador de rastreamento da requisição, o parceiro não tem um porque nenhuma resposta o devolveu, e o time procura no lugar onde o evento nunca foi registrado.',
        },
        {
          type: 'diagram',
          value: `Requisicao de 2,4 MB atravessando a cadeia:

  cliente
    |  POST /v1/lotes  (2,4 MB)
    v
  +------------------------+
  | CDN          limite 100 MB   | -> passa
  +------------------------+
    |
    v
  +------------------------+
  | balanceador  limite 10 MB    | -> passa
  +------------------------+
    |
    v
  +------------------------+
  | proxy reverso limite 1 MB    | -> RECUSA AQUI
  +------------------------+       413, HTML, sem rastreio
    |                              log da aplicacao: vazio
    X  (a requisicao morre)
  +------------------------+
  | aplicacao    limite 8 MB     | -> nunca executa
  +------------------------+

Limite efetivo = min(100, 10, 1, 8) = 1 MB
O valor no codigo da aplicacao (8 MB) e irrelevante.`,
        },
      ],
    },
    {
      title: 'Por que o erro chega sem corpo, sem rastreio e sem explicação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma razão técnica para a recusa por tamanho ser a mais pobre em informação de toda a família de erros de cliente. Quando um serviço recusa uma requisição por autenticação inválida, por exemplo, ele já leu o cabeçalho, já identificou o chamador, já tem um identificador de rastreamento e pode devolver um corpo estruturado explicando o que falhou. Na recusa por tamanho nada disso aconteceu, porque a decisão precisa ser tomada antes de ler o corpo, justamente para não gastar o recurso que o limite existe para proteger.',
        },
        {
          type: 'paragraph',
          value:
            'Há um segundo efeito, menos conhecido e mais desagradável, que explica por que às vezes o cliente vê uma conexão fechada abruptamente em vez de um código de erro limpo. Quando o servidor decide recusar no meio do envio, ele responde e quer encerrar, mas o cliente ainda está escrevendo os megabytes restantes no soquete. O servidor então fecha a conexão com os dados pendentes, e o cliente, que estava no meio de uma escrita, recebe um erro de conexão reiniciada pelo par antes de conseguir ler a resposta que já tinha chegado. O parceiro reporta erro de rede, o servidor registra 413, e os dois têm razão.',
        },
        {
          type: 'paragraph',
          value:
            'Esse é o motivo pelo qual a correção mais valiosa desse incidente raramente é mexer no número. É fazer a recusa carregar informação. Um erro que diz quanto foi enviado, quanto é permitido, qual camada recusou e o que fazer em seguida transforma um chamado de suporte de três dias em uma correção de dez minutos do lado do cliente, e isso vale mesmo quando o limite permanece exatamente onde estava.',
        },
        {
          type: 'code',
          value: `// Middleware de recusa informativa. A decisao acontece antes de ler o corpo,
// olhando apenas o cabecalho anunciado, e a resposta carrega o que o cliente
// precisa para se corrigir sozinho.

const LIMITE_BYTES = 1 * 1024 * 1024; // teto efetivo medido na cadeia, nao o do framework

export function limitePayload(req, res, next) {
  const anunciado = Number(req.headers['content-length']);

  // Requisicao sem tamanho anunciado usa transferencia em partes: o teto
  // precisa ser aplicado durante a leitura, nao antes dela.
  if (!Number.isFinite(anunciado)) return limitarDuranteLeitura(req, res, next);

  if (anunciado > LIMITE_BYTES) {
    // Responder sem consumir o corpo. O cliente pode estar no meio do envio,
    // entao pedimos o encerramento explicito da conexao para evitar que ele
    // receba um erro de soquete em vez desta resposta.
    res.set('Connection', 'close');
    return res.status(413).json({
      erro: 'payload_acima_do_limite',
      limite_bytes: LIMITE_BYTES,
      recebido_bytes: anunciado,
      camada: 'aplicacao',
      // O ponto que resolve o chamado: dizer o que fazer, nao so o que falhou.
      acao: 'Divida o lote em partes de no maximo 500 itens ou use POST /v1/lotes/upload para envio em duas etapas.',
      documentacao: 'https://exemplo.dev/docs/limites',
    });
  }

  return next();
}

// Para envio em partes o tamanho real so e conhecido ao longo da leitura.
// Contamos os bytes e abortamos assim que o teto e ultrapassado, sem
// acumular o restante em memoria.
function limitarDuranteLeitura(req, res, next) {
  let lidos = 0;

  req.on('data', (parte) => {
    lidos += parte.length;
    if (lidos <= LIMITE_BYTES) return;

    res.set('Connection', 'close');
    res.status(413).json({
      erro: 'payload_acima_do_limite',
      limite_bytes: LIMITE_BYTES,
      recebido_bytes: lidos,
      camada: 'aplicacao',
      acao: 'Anuncie content-length ou reduza o tamanho do envio em partes.',
    });

    // Interrompe a leitura: sem isso o processo continua recebendo bytes que
    // ja decidimos descartar, que e exatamente o custo que o limite evita.
    req.destroy();
  });

  req.on('end', () => {
    if (!res.headersSent) next();
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Duas linhas desse trecho costumam ser esquecidas em implementações caseiras e ambas têm consequência operacional direta. A primeira é o encerramento explícito da conexão, sem o qual o cliente frequentemente perde a resposta que o serviço acabou de enviar. A segunda é a destruição do fluxo de entrada quando o limite é ultrapassado durante a leitura: sem ela o processo continua recebendo e descartando bytes até o fim do envio, gastando exatamente a banda e a memória que o limite deveria ter economizado.',
        },
      ],
    },
    {
      title: 'Dois limites diferentes com o mesmo nome: memória e tempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Quando alguém pergunta por que existe um limite de tamanho, a resposta padrão é proteção contra abuso. A resposta está incompleta e a incompletude cria uma brecha real. Existem dois motivos distintos para limitar tamanho, eles protegem recursos diferentes, e um limite calibrado para um deles não protege contra o outro.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro motivo é memória. Um corpo de requisição que é lido inteiro para dentro do processo antes de ser processado ocupa memória proporcional ao tamanho, multiplicada pelo número de requisições simultâneas e novamente por um fator de expansão que quase ninguém contabiliza. Um JSON de dez megabytes vira uma estrutura de objetos que ocupa entre três e dez vezes isso na memória do processo, dependendo da linguagem e do formato dos dados. Com cinquenta requisições simultâneas desse tamanho, o cálculo que parecia confortável vira encerramento do processo por falta de memória.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo motivo é tempo de ocupação. Uma requisição grande enviada lentamente prende um trabalhador do servidor durante todo o envio, e é esse o vetor da classe de ataque em que o agressor anuncia um corpo pequeno e o envia byte a byte, sem nunca ultrapassar limite algum de tamanho. Nenhum teto de bytes protege contra isso, porque o tamanho total é legítimo: o que é abusivo é a taxa. A defesa é outra, chama-se tempo mínimo de recebimento ou taxa mínima de entrada, e é uma configuração separada que vive em outro lugar da pilha.',
        },
        {
          type: 'table',
          columns: ['Risco', 'Recurso protegido', 'Configuração correta', 'O que NÃO protege contra ele'],
          rows: [
            [
              'Corpo grande demais carregado em memória',
              'Memória do processo',
              'Teto de bytes aplicado antes da desserialização',
              'Timeout de requisição, que dispara tarde demais',
            ],
            [
              'Envio deliberadamente lento de corpo pequeno',
              'Trabalhadores e conexões livres',
              'Taxa mínima de recebimento e timeout de leitura',
              'Limite de tamanho, porque o total é legítimo',
            ],
            [
              'Expansão durante a desserialização',
              'Memória e processador',
              'Limite de profundidade e de número de nós do documento',
              'Limite de bytes, que mede o comprimido e não o expandido',
            ],
            [
              'Corpo comprimido que expande muitas vezes',
              'Memória do processo',
              'Teto do tamanho descomprimido, verificado durante a expansão',
              'Teto de bytes, que vê apenas o tamanho na rede',
            ],
            [
              'Muitas requisições no limite ao mesmo tempo',
              'Memória agregada do serviço',
              'Orçamento de bytes em voo, não apenas por requisição',
              'Limite por requisição isolado, que ignora a soma',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas últimas linhas são as que mais frequentemente faltam em serviços que já se consideram protegidos. Um corpo comprimido de cem kilobytes que expande para um gigabyte passa por qualquer teto de bytes medido na rede, e a defesa precisa contar os bytes descomprimidos ao longo da expansão, abortando no meio dela. E um limite de dez megabytes por requisição, com duzentas requisições simultâneas permitidas, é na prática uma autorização para dois gigabytes de corpos em voo, que é um número que ninguém teria aprovado se tivesse sido escrito assim.',
        },
        {
          type: 'code',
          value: `// Verificacao de corpo comprimido com teto sobre o tamanho descomprimido.
// O teto de bytes na rede nao enxerga expansao: 100 KB comprimidos podem
// virar 1 GB em memoria, e a checagem precisa acontecer durante a expansao.

import { createGunzip } from 'node:zlib';

const LIMITE_DESCOMPRIMIDO = 8 * 1024 * 1024;
const RAZAO_MAXIMA = 50; // expansao acima disso e sinal de payload construido

export async function lerCorpoComprimido(req) {
  const comprimidoAnunciado = Number(req.headers['content-length']) || 0;
  let descomprimido = 0;
  const partes = [];

  const expansor = req.pipe(createGunzip());

  try {
    // Iterar sobre o fluxo expandido permite decidir a cada bloco, antes de
    // ter o documento inteiro em memoria. E o unico ponto onde a checagem
    // ainda e barata.
    for await (const parte of expansor) {
      descomprimido += parte.length;

      // Dois tetos independentes: o absoluto protege a memoria do processo,
      // o de razao detecta o payload desenhado para expandir.
      if (descomprimido > LIMITE_DESCOMPRIMIDO) {
        throw new ErroPayload('descomprimido_acima_do_limite', {
          limite_bytes: LIMITE_DESCOMPRIMIDO,
          recebido_bytes: descomprimido,
        });
      }

      if (comprimidoAnunciado > 0 && descomprimido / comprimidoAnunciado > RAZAO_MAXIMA) {
        throw new ErroPayload('razao_de_expansao_suspeita', {
          razao: Math.round(descomprimido / comprimidoAnunciado),
          razao_maxima: RAZAO_MAXIMA,
        });
      }

      partes.push(parte);
    }
  } finally {
    // Encerra a expansao e a leitura da requisicao mesmo quando abortamos no
    // meio: sem isso o processo continua recebendo bytes ja descartados.
    expansor.destroy();
    req.destroy();
  }

  return Buffer.concat(partes);
}

class ErroPayload extends Error {
  constructor(codigo, detalhes) {
    super(codigo);
    this.codigo = codigo;
    this.detalhes = detalhes;
    this.status = 413;
  }
}`,
        },
      ],
    },
    {
      title: 'Aumentar o número é a correção errada na maioria dos casos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A pressão do incidente empurra para a solução de um caractere: trocar um por dez na configuração e encerrar o chamado. Essa mudança funciona, custa nada e é a resposta certa em exatamente um cenário, que é quando o limite atual foi herdado de um padrão que ninguém escolheu e o novo valor foi calculado contra a memória disponível. Em todos os outros cenários ela apenas move a data do próximo incidente e piora a exposição enquanto isso.',
        },
        {
          type: 'paragraph',
          value:
            'O sinal que distingue os casos é a forma da distribuição de tamanhos. Se a recusa atinge uma fração pequena e estável das requisições e o percentil noventa e nove está logo abaixo do teto, o crescimento é orgânico e o limite realmente ficou apertado. Se a recusa atinge pouquíssimas requisições e o tamanho delas é uma ordem de grandeza maior que o percentil noventa e nove, não é crescimento: é um cliente específico fazendo algo diferente, e aumentar o limite vai transformar uma recusa barata em um processamento caro que ninguém dimensionou.',
        },
        {
          type: 'ordered',
          items: [
            'Meça a distribuição real de tamanhos por cliente nos últimos trinta dias, não a média agregada, e olhe o percentil cinquenta, o noventa e nove e o máximo separadamente.',
            'Identifique se as requisições recusadas são a cauda natural da distribuição ou um grupo isolado muito acima dela, porque as duas formas pedem correções opostas.',
            'Calcule o teto que a memória suporta: memória disponível por instância dividida pelo fator de expansão do formato, dividida pelo número de requisições simultâneas permitidas.',
            'Compare o teto suportado com o teto desejado, e se o desejado for maior, a correção não é configuração, é mudar o padrão de envio do cliente.',
            'Ofereça um caminho alternativo explícito para os pedidos grandes legítimos, como paginação no envio ou envio em duas etapas, antes de subir qualquer número.',
            'Aplique o mesmo valor em todas as camadas da cadeia, porque um teto maior na aplicação com o proxy inalterado não muda absolutamente nada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro item é o que costuma encerrar a discussão em times que estavam prestes a subir o limite para cinquenta megabytes. Uma instância com dois gigabytes de memória, um fator de expansão de cinco para JSON e cem requisições simultâneas permitidas suporta um teto teórico de quatro megabytes por corpo, e isso sem contar nenhuma outra alocação do processo. O número que o time queria configurar estava uma ordem de grandeza acima do que a máquina aguenta, e a única razão pela qual isso não tinha quebrado antes é que ninguém tinha enviado corpos daquele tamanho ainda.',
        },
        {
          type: 'code',
          value: `// Teto sustentavel de corpo por requisicao, derivado da memoria da instancia
// em vez de escolhido por intuicao. O numero que sai daqui costuma ser bem
// menor do que o que o time pretendia configurar.

/**
 * @param {number} memoriaMb        memoria disponivel por instancia
 * @param {number} reservaMb        memoria que o processo usa sem nenhuma requisicao
 * @param {number} simultaneas      requisicoes concorrentes permitidas
 * @param {number} fatorExpansao    quantas vezes o corpo cresce ao virar objeto
 * @param {number} margemSeguranca  fracao da memoria que fica livre de proposito
 */
export function tetoSustentavelDeCorpo({
  memoriaMb = 2048,
  reservaMb = 400,
  simultaneas = 100,
  fatorExpansao = 5,
  margemSeguranca = 0.3,
}) {
  const disponivelMb = (memoriaMb - reservaMb) * (1 - margemSeguranca);

  // Cada requisicao em voo ocupa o corpo cru mais a estrutura expandida.
  // Ignorar o fator de expansao e o erro que faz o calculo dar cinco vezes
  // mais do que a maquina realmente aguenta.
  const porRequisicaoMb = disponivelMb / simultaneas;
  const tetoMb = porRequisicaoMb / (1 + fatorExpansao);

  return {
    tetoMb: Number(tetoMb.toFixed(2)),
    tetoBytes: Math.floor(tetoMb * 1024 * 1024),
    // Se o teto desejado for maior que este, a correcao nao e configuracao:
    // e reduzir a concorrencia, aumentar a memoria ou mudar o padrao de envio.
    observacao: \`Com \${simultaneas} requisicoes simultaneas e expansao de \${fatorExpansao}x, o teto seguro e \${tetoMb.toFixed(2)} MB por corpo.\`,
  };
}

// 2048 MB, reserva 400, margem 30%, 100 simultaneas, expansao 5x
// -> 1153 MB uteis / 100 = 11,53 MB por requisicao / 6 = 1,92 MB de corpo.
// O time queria configurar 50 MB.`,
        },
      ],
    },
    {
      title: 'Transformar o teto invisível em contrato que o cliente consegue respeitar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A propriedade que torna esse incidente recorrente é que o limite só é comunicado no momento da falha, e de forma pobre. Nenhum cliente consegue respeitar um contrato que ele descobre por tentativa e erro em produção. A correção estrutural é publicar o limite de três formas complementares, cada uma atendendo a um momento diferente do ciclo de vida da integração.',
        },
        {
          type: 'list',
          items: [
            'Na documentação e no esquema da API, com o valor em bytes e a regra de contagem explícita: se o que conta é o corpo cru ou o descomprimido, e se cabeçalhos entram na conta.',
            'Em um endereço de descoberta que devolve os limites vigentes, para que o cliente possa validar antes de enviar e para que uma mudança de teto não exija um novo ciclo de deploy do parceiro.',
            'Na própria resposta de erro, com o limite, o tamanho recebido e a ação recomendada, porque é ali que a informação chega a quem está com o problema na mão.',
            'Em um cabeçalho de resposta presente também nas requisições bem-sucedidas, indicando quanto da margem aquele pedido consumiu, o que dá ao cliente um sinal de aproximação antes da primeira recusa.',
            'Em um caminho alternativo documentado para os casos legítimos que excedem o teto, sem o qual a única saída do parceiro é dividir o pedido de forma que pode não ser correta no domínio dele.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quarto item é o de melhor relação entre esforço e retorno e o menos implementado dos cinco. Um cabeçalho que informa em toda resposta bem-sucedida a fração do limite consumida transforma o teto de um penhasco em uma rampa: o cliente que está em oitenta por cento sabe disso meses antes de bater, pode alertar o próprio time e pode ajustar o padrão de envio sem nenhum incidente no meio. O custo de produzir esse cabeçalho é um número que o servidor já tem na mão.',
        },
        {
          type: 'code',
          value: `// Endereco de descoberta e cabecalho de proximidade. O objetivo e que o
// cliente nunca descubra o limite por tentativa e erro em producao.

const LIMITES = {
  corpo_bytes: 1_048_576,
  corpo_descomprimido_bytes: 8_388_608,
  itens_por_lote: 500,
  conta: 'corpo cru apos descompressao, cabecalhos nao entram',
  alternativa_para_envios_maiores: '/v1/lotes/upload',
};

// 1) Descoberta: o cliente consulta e se adapta sem depender de deploy nosso.
export function rotaDeLimites(_req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ limites: LIMITES, versao: '2026-09-21' });
}

// 2) Proximidade: toda resposta bem-sucedida diz quanto da margem foi usada.
// O cliente em 80% descobre meses antes de bater no teto, e nao no incidente.
export function anunciarConsumo(req, res, next) {
  const tamanho = Number(req.headers['content-length']) || 0;
  if (tamanho > 0) {
    const fracao = tamanho / LIMITES.corpo_bytes;
    res.set('X-Payload-Limit', String(LIMITES.corpo_bytes));
    res.set('X-Payload-Size', String(tamanho));
    res.set('X-Payload-Usage', fracao.toFixed(3));

    // Aviso formal a partir de 80%: da ao time do cliente um gancho para
    // alertar sem precisar interpretar um numero solto.
    if (fracao >= 0.8) {
      res.set(
        'Warning',
        \`199 - "payload em \${Math.round(fracao * 100)}% do limite; veja \${LIMITES.alternativa_para_envios_maiores}"\`,
      );
    }
  }

  next();
}`,
        },
        {
          type: 'paragraph',
          value:
            'O endereço de descoberta tem um benefício de segunda ordem que costuma decidir a discussão: ele permite reduzir um limite sem quebrar ninguém. Com o valor publicado e consultado, o serviço pode anunciar o teto novo com semanas de antecedência, medir quantos clientes ainda enviam acima dele e só então aplicar a mudança. Sem isso, qualquer redução de limite é uma quebra silenciosa que aparece como incidente do lado do parceiro.',
        },
      ],
    },
    {
      title: 'Cinco verificações que separam crescimento legítimo de abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A decisão operacional que o time precisa tomar durante o incidente é uma só: este pedido grande é legítimo e merece acomodação, ou é anômalo e a recusa está certa? Responder por intuição leva a dois erros caros em direções opostas, que são acomodar um padrão abusivo e rejeitar um cliente importante que apenas cresceu. As cinco verificações a seguir respondem com dados em poucos minutos.',
        },
        {
          type: 'ordered',
          items: [
            'Compare o tamanho recusado com o percentil noventa e nove histórico daquele mesmo cliente: dentro da mesma ordem de grandeza indica crescimento, uma ordem acima indica mudança de comportamento.',
            'Verifique se o crescimento é no número de itens do lote ou no tamanho médio por item, porque o primeiro é resolvido com paginação e o segundo frequentemente indica campo novo ou dado duplicado no payload.',
            'Procure repetição interna no corpo recusado: chaves repetidas, o mesmo objeto aninhado várias vezes ou campos preenchidos com valores idênticos indicam defeito de montagem do lado do cliente, não necessidade real.',
            'Confirme se o mesmo cliente passou a enviar sem compressão, porque uma mudança de biblioteca que desliga a compressão multiplica o tamanho na rede sem que nada tenha mudado no dado.',
            'Cheque a correlação com uma data de deploy do parceiro: um salto em degrau no gráfico de tamanhos coincidindo com uma data única é mudança de código, e um crescimento suave ao longo de semanas é volume de negócio.',
          ],
        },
        {
          type: 'table',
          columns: ['Padrão observado', 'Leitura', 'Ação recomendada', 'Prazo'],
          rows: [
            [
              'Crescimento suave, percentil 99 encostando no teto',
              'Volume de negócio real do cliente',
              'Recalcular o teto pela memória e subir em toda a cadeia',
              'Dias, com janela planejada',
            ],
            [
              'Salto em degrau em uma data única',
              'Mudança de código do parceiro',
              'Acionar o parceiro com o dado antes de mexer no limite',
              'Horas, é reversível do lado dele',
            ],
            [
              'Corpo com repetição interna alta',
              'Defeito de montagem do payload',
              'Devolver o diagnóstico ao cliente e manter a recusa',
              'Imediato, a recusa está correta',
            ],
            [
              'Mesmo dado, tamanho maior, compressão ausente',
              'Regressão de configuração do cliente',
              'Exigir compressão no contrato e sinalizar no erro',
              'Imediato, correção é de uma linha',
            ],
            [
              'Poucos pedidos, várias ordens acima do normal',
              'Abuso ou teste automatizado fora de ambiente',
              'Manter recusa, aplicar limite por cliente e registrar',
              'Imediato, sem acomodação',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira linha merece destaque porque é a mais comum das cinco e a que mais frequentemente recebe a correção errada. Um payload com repetição interna alta quase sempre vem de um laço que acumula sem limpar, de um campo de contexto que é anexado a cada item em vez de uma vez por lote, ou de uma serialização que repete o objeto pai dentro de cada filho. Aumentar o limite nesse caso é pagar com memória do seu serviço por um defeito no cliente, e o crescimento não para no valor novo: ele volta a encostar no teto na próxima vez que o laço rodar mais vezes.',
        },
        {
          type: 'paragraph',
          value:
            'A instrumentação que sustenta essas cinco verificações é modesta: um histograma de tamanho de corpo com rótulo por cliente e por rota, um contador de recusas com o mesmo rótulo, e a razão entre tamanho comprimido e descomprimido. Com esses três sinais, a pergunta que hoje leva três dias de troca de mensagens com o parceiro passa a ser respondida por um painel em dois minutos, e a resposta vem com o dado que convence os dois lados.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual é o valor certo para o limite de tamanho de corpo em uma API pública?',
      answer:
        'Não existe um valor universal, mas existe um método que produz o valor certo para um caso concreto, e ele tem quatro passos que podem ser executados em uma tarde. O primeiro é derivar o teto que a infraestrutura sustenta, que é a memória disponível por instância menos a reserva do processo, aplicada a margem de segurança, dividida pelo número de requisições simultâneas permitidas e novamente pelo fator de expansão do formato, que fica entre três e dez para JSON dependendo da linguagem e da proporção de números e strings nos dados. Esse cálculo quase sempre devolve um número menor do que o time esperava, e é ele que define o máximo aceitável do ponto de vista de sobrevivência do serviço. O segundo passo é medir a distribuição real de tamanhos dos clientes existentes nos últimos trinta dias, separando por cliente e olhando o percentil noventa e nove de cada um, porque a mediana agregada esconde exatamente o cliente que vai quebrar. O terceiro é escolher o teto como um múltiplo confortável do maior percentil noventa e nove legítimo, tipicamente entre duas e três vezes, desde que esse valor caiba abaixo do teto que a infraestrutura sustenta. Se não couber, o resultado do exercício não é um limite maior: é a constatação de que aquele caso de uso precisa de um caminho de envio diferente, seja em duas etapas com um endereço de upload, seja paginado, seja assíncrono com um identificador de trabalho. O quarto passo é aplicar o valor escolhido em todas as camadas do caminho e verificar de fora que ele é realmente o efetivo, porque um teto novo na aplicação com o proxy inalterado não muda absolutamente nada e produz um incidente de segunda rodada com o time convencido de que já tinha corrigido. Como ordem de grandeza para calibrar a intuição, APIs de integração empresarial costumam ficar entre um e dez megabytes, e valores acima disso quase sempre indicam que o caso de uso é de transferência de arquivo disfarçada de chamada de API.',
    },
    {
      question: 'Como oferecer um caminho para pedidos legítimos que realmente não cabem no limite?',
      answer:
        'Há três padrões consolidados e a escolha entre eles depende de uma pergunta de domínio, não de infraestrutura: o pedido grande precisa ser atômico? Se a resposta for não, que é o caso mais comum, a solução é paginação no envio com uma chave de agrupamento. O cliente divide o lote em partes de tamanho previsível, envia cada uma com o mesmo identificador de lote e uma marcação de última parte, e o servidor consolida ao receber o encerramento. Esse padrão preserva a semântica de conjunto, permite reenvio de uma parte isolada sem repetir tudo e mantém cada requisição dentro do teto normal, o que significa que nada na cadeia precisa ser afrouxado. A chave de idempotência por parte é o que torna o reenvio seguro. Se a resposta for sim, e o pedido precisa ser atômico, o padrão correto é o envio em duas etapas: uma primeira chamada pequena solicita um endereço de escrita temporário e devolve um identificador, o cliente escreve o conteúdo diretamente no armazenamento de objetos usando aquele endereço, e uma segunda chamada pequena informa que o conteúdo está pronto e dispara o processamento. Essa forma tem três vantagens que compensam a complexidade extra: o corpo grande nunca atravessa a sua cadeia de serviço, o armazenamento cuida de retomada e integridade sem código seu, e o limite da API permanece baixo para todos os outros clientes. O terceiro padrão é o processamento assíncrono com identificador de trabalho, apropriado quando o pedido é grande porque representa uma operação demorada e não porque carrega muitos dados: o cliente envia a descrição compacta do trabalho, recebe um identificador imediatamente e consulta o resultado depois. O erro comum nos três casos é não documentar o caminho alternativo junto com o limite, o que deixa o parceiro com a impressão de que a única saída é insistir no pedido grande até alguém do outro lado subir o número.',
    },
    {
      question: 'O limite deve ser o mesmo para todos os clientes ou pode variar por contrato?',
      answer:
        'Pode e frequentemente deve variar, mas a variação precisa ser implementada de uma forma específica para não virar uma fonte de incidentes pior do que o limite único. O princípio é que existem dois tetos com naturezas diferentes e apenas um deles pode ser negociado. O teto de infraestrutura, derivado da memória e da concorrência, é um limite físico do serviço: nenhum contrato comercial pode exceder esse valor, porque o que está do outro lado não é uma política e sim o encerramento do processo por falta de memória. O teto de política, que é o valor aplicado a cada cliente, vive abaixo do teto de infraestrutura e pode perfeitamente ser diferenciado por plano, por integração ou por rota. A implementação precisa observar três cuidados. O primeiro é que o teto por cliente deve ser resolvido a partir de uma configuração consultável e cacheada, nunca de uma lista embutida no código, porque senão cada ajuste comercial vira um ciclo de deploy e a diferenciação acaba abandonada na prática. O segundo é que o limite da camada de borda precisa ser o teto de infraestrutura e não o teto do cliente mais generoso, com a diferenciação aplicada na camada de aplicação, que é a única que sabe quem é o chamador: tentar diferenciar no proxy exige identificar o cliente antes de ler o corpo, o que é frágil e costuma quebrar quando a autenticação muda. O terceiro é que o valor vigente para aquele chamador precisa aparecer no endereço de descoberta e no cabeçalho de proximidade, porque um limite diferenciado que o cliente não consegue consultar é indistinguível de um limite instável do ponto de vista dele. Um efeito colateral positivo dessa arquitetura é que ela dá ao time um mecanismo de contenção granular durante incidentes: reduzir temporariamente o teto de um único cliente abusivo é uma operação de configuração, não de deploy, e não afeta ninguém mais.',
    },
  ],
  conclusion: {
    title: 'Limite de tamanho é contrato, e contrato que só aparece no erro não é contrato',
    description:
      'A recusa por tamanho é o erro mais pobre em informação de toda a família de erros de cliente, e é assim por uma razão técnica legítima: a decisão precisa ser tomada antes de ler o corpo. Isso não obriga a resposta a ser inútil. Medir o limite efetivo atravessando a cadeia inteira, derivar o teto sustentável da memória em vez de escolhê-lo por intuição, separar o limite que protege memória do que protege tempo, publicar o valor em um endereço de descoberta e anunciar a proximidade em toda resposta bem-sucedida transformam um penhasco invisível em uma rampa que o cliente enxerga meses antes de bater. Posso levantar o limite efetivo real do seu caminho, calcular o teto que a sua infraestrutura sustenta, desenhar o caminho alternativo para os pedidos grandes legítimos e instrumentar os sinais que separam crescimento de abuso antes do próximo chamado.',
    cta: 'Falar sobre os limites da minha API',
  },
  related: [
    {
      label: 'Contrato de API sem versão: evoluir o payload sem quebrar o cliente antigo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Limite de taxa por cliente na borda: proteger o serviço sem punir o parceiro',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Arquitetura e Modernização Backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The partner integrated in January, ran nine months without a single error and last Tuesday started getting refusals on one request out of a hundred. The body was the same format as always, the token was valid, the address did not change and the error arrived before any application log: the service never saw that request. What changed was not the client and not the server, it was the distribution of request sizes, which grew enough to touch a ceiling nobody consciously chose and that is declared in four different places along the path. This article shows why the effective limit is the smallest of a chain and not the one in your code, why the error arrives with no body and no trace and what that does to support, what the difference is between the limit that protects memory and the limit that protects time and why confusing the two opens a gap, why raising the number is the wrong fix in most cases and what the right one is, how to turn an invisible ceiling into an explicit contract the client can respect before sending, and which five checks separate an abusive request from a legitimate one that simply grew.',
  sections: [
    {
      title: 'The limit that matters is the smallest in the chain, and it is not in your code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reaction of whoever receives the report is to open the service code and look for where the maximum body size is configured. A value is found, it looks generous, and the immediate conclusion is that the problem must be elsewhere. The conclusion is right for the wrong reason: the problem really is elsewhere, because the value found in the code is just one of the four or five ceilings a request has to cross, and what decides its fate is the smallest of them, not the last.',
        },
        {
          type: 'paragraph',
          value:
            'A typical production request passes through a content delivery network, a managed load balancer, an edge server terminating the secure connection, an internal reverse proxy and finally the application process. Each of those layers has its own limit, each has a different default, and none of them consults the others. A popular edge server defaults to one megabyte, a managed gateway usually allows ten, an application framework is frequently at one hundred kilobytes, and the serverless function someone put in the path last year may cap at six megabytes with mandatory base 64 encoding, which drops usable capacity to a little over four.',
        },
        {
          type: 'paragraph',
          value:
            'The practical consequence is that the answer to the question what is the maximum size my service accepts cannot be read from any single configuration file. It has to be measured by crossing the whole path, with a real request, from the outside. That measurement takes fifteen minutes and is the only honest way to answer a partner asking how much they can send.',
        },
        {
          type: 'table',
          columns: ['Layer in the path', 'Typical default when nobody configured it', 'Shape of the error it returns', 'Shows up in the application log'],
          rows: [
            [
              'Content delivery network',
              'Between 100 MB and unlimited, depending on plan',
              'Generic provider error page',
              'No, the request never leaves the edge',
            ],
            [
              'Managed cloud load balancer',
              '1 MB to 10 MB depending on the type',
              'Status 413 with no body or a default body',
              'Only in the balancer metric, not the application',
            ],
            [
              'Edge server or reverse proxy',
              '1 MB in the most common default configuration',
              'HTML error page, not JSON',
              'In the proxy log, not the application one',
            ],
            [
              'Framework or body parsing middleware',
              '100 KB across several ecosystems',
              'Catchable exception, format under your control',
              'Yes, and it is the only place where that is true',
            ],
            [
              'Serverless function in the path',
              '6 MB already counting transport encoding',
              'Invocation error, frequently a 502',
              'No, and the trace stays with the provider',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The most important column is the last one. In four of the five layers the refused request produces no line at all in the application log, which means the team error dashboard stays clean while the partner accumulates failures. That mismatch is what makes the incident last days: support asks for the request trace identifier, the partner has none because no response returned one, and the team looks in the place where the event was never recorded.',
        },
        {
          type: 'diagram',
          value: `A 2.4 MB request crossing the chain:

  client
    |  POST /v1/batches  (2.4 MB)
    v
  +------------------------+
  | CDN            limit 100 MB  | -> passes
  +------------------------+
    |
    v
  +------------------------+
  | load balancer  limit 10 MB   | -> passes
  +------------------------+
    |
    v
  +------------------------+
  | reverse proxy  limit 1 MB    | -> REFUSED HERE
  +------------------------+        413, HTML, no trace
    |                               application log: empty
    X  (the request dies)
  +------------------------+
  | application    limit 8 MB    | -> never runs
  +------------------------+

Effective limit = min(100, 10, 1, 8) = 1 MB
The value in the application code (8 MB) is irrelevant.`,
        },
      ],
    },
    {
      title: 'Why the error arrives with no body, no trace and no explanation',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a technical reason why size refusal is the least informative of the whole client error family. When a service refuses a request for invalid authentication, for example, it has already read the header, already identified the caller, already has a trace identifier and can return a structured body explaining what failed. In a size refusal none of that happened, because the decision has to be made before reading the body, precisely so it does not spend the resource the limit exists to protect.',
        },
        {
          type: 'paragraph',
          value:
            'There is a second effect, less known and more unpleasant, that explains why the client sometimes sees an abruptly closed connection instead of a clean error code. When the server decides to refuse mid upload, it responds and wants to close, but the client is still writing the remaining megabytes into the socket. The server then closes the connection with data pending, and the client, in the middle of a write, gets a connection reset by peer before it manages to read the response that had already arrived. The partner reports a network error, the server logs a 413, and both are right.',
        },
        {
          type: 'paragraph',
          value:
            'That is why the most valuable fix in this incident is rarely touching the number. It is making the refusal carry information. An error that states how much was sent, how much is allowed, which layer refused and what to do next turns a three day support ticket into a ten minute fix on the client side, and that holds even when the limit stays exactly where it was.',
        },
        {
          type: 'code',
          value: `// Informative refusal middleware. The decision happens before reading the
// body, looking only at the announced header, and the response carries what
// the client needs to correct itself.

const LIMIT_BYTES = 1 * 1024 * 1024; // effective ceiling measured across the chain, not the framework one

export function payloadLimit(req, res, next) {
  const announced = Number(req.headers['content-length']);

  // A request with no announced size uses chunked transfer: the ceiling has
  // to be enforced during the read, not before it.
  if (!Number.isFinite(announced)) return limitWhileReading(req, res, next);

  if (announced > LIMIT_BYTES) {
    // Respond without consuming the body. The client may be mid upload, so we
    // ask for an explicit connection close to avoid it receiving a socket
    // error instead of this response.
    res.set('Connection', 'close');
    return res.status(413).json({
      error: 'payload_above_limit',
      limit_bytes: LIMIT_BYTES,
      received_bytes: announced,
      layer: 'application',
      // The part that closes the ticket: say what to do, not only what failed.
      action: 'Split the batch into chunks of at most 500 items or use POST /v1/batches/upload for a two step send.',
      documentation: 'https://example.dev/docs/limits',
    });
  }

  return next();
}

// For chunked uploads the real size is only known along the read. We count
// bytes and abort as soon as the ceiling is crossed, without accumulating
// the rest in memory.
function limitWhileReading(req, res, next) {
  let read = 0;

  req.on('data', (chunk) => {
    read += chunk.length;
    if (read <= LIMIT_BYTES) return;

    res.set('Connection', 'close');
    res.status(413).json({
      error: 'payload_above_limit',
      limit_bytes: LIMIT_BYTES,
      received_bytes: read,
      layer: 'application',
      action: 'Announce content-length or reduce the size of the chunked upload.',
    });

    // Stop reading: without this the process keeps receiving bytes we already
    // decided to discard, which is exactly the cost the limit avoids.
    req.destroy();
  });

  req.on('end', () => {
    if (!res.headersSent) next();
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Two lines of that snippet are usually forgotten in homemade implementations and both have direct operational consequences. The first is the explicit connection close, without which the client frequently loses the response the service just sent. The second is destroying the input stream when the limit is crossed during the read: without it the process keeps receiving and discarding bytes until the end of the upload, spending exactly the bandwidth and memory the limit was supposed to save.',
        },
      ],
    },
    {
      title: 'Two different limits with the same name: memory and time',
      blocks: [
        {
          type: 'paragraph',
          value:
            'When someone asks why a size limit exists, the standard answer is protection against abuse. That answer is incomplete and the incompleteness creates a real gap. There are two distinct reasons to limit size, they protect different resources, and a limit calibrated for one of them does not protect against the other.',
        },
        {
          type: 'paragraph',
          value:
            'The first reason is memory. A request body read entirely into the process before being handled occupies memory proportional to its size, multiplied by the number of concurrent requests and again by an expansion factor almost nobody accounts for. A ten megabyte JSON becomes an object structure taking between three and ten times that in process memory, depending on the language and the shape of the data. With fifty concurrent requests of that size, the math that looked comfortable turns into the process being killed for lack of memory.',
        },
        {
          type: 'paragraph',
          value:
            'The second reason is occupancy time. A large request sent slowly holds a server worker for the whole upload, and that is the vector of the attack class in which the attacker announces a small body and sends it byte by byte, never crossing any size limit at all. No byte ceiling protects against that, because the total size is legitimate: what is abusive is the rate. The defense is a different one, called minimum receive time or minimum input rate, and it is a separate setting that lives elsewhere in the stack.',
        },
        {
          type: 'table',
          columns: ['Risk', 'Protected resource', 'Correct setting', 'What does NOT protect against it'],
          rows: [
            [
              'Oversized body loaded into memory',
              'Process memory',
              'Byte ceiling applied before deserialization',
              'Request timeout, which fires far too late',
            ],
            [
              'Deliberately slow upload of a small body',
              'Workers and free connections',
              'Minimum receive rate and read timeout',
              'Size limit, because the total is legitimate',
            ],
            [
              'Expansion during deserialization',
              'Memory and processor',
              'Document depth and node count limits',
              'Byte limit, which measures compressed, not expanded',
            ],
            [
              'Compressed body that expands many times over',
              'Process memory',
              'Ceiling on decompressed size, checked during expansion',
              'Byte ceiling, which only sees the size on the wire',
            ],
            [
              'Many requests at the limit at the same time',
              'Aggregate service memory',
              'Budget of bytes in flight, not just per request',
              'Isolated per request limit, which ignores the sum',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last two rows are the ones most frequently missing from services that already consider themselves protected. A hundred kilobyte compressed body that expands into a gigabyte passes any byte ceiling measured on the wire, and the defense has to count decompressed bytes along the expansion, aborting in the middle of it. And a ten megabyte limit per request, with two hundred concurrent requests allowed, is in practice an authorization for two gigabytes of bodies in flight, a number nobody would have approved had it been written that way.',
        },
        {
          type: 'code',
          value: `// Compressed body check with a ceiling on the decompressed size. A byte
// ceiling on the wire cannot see expansion: 100 KB compressed can become
// 1 GB in memory, and the check has to happen during the expansion.

import { createGunzip } from 'node:zlib';

const DECOMPRESSED_LIMIT = 8 * 1024 * 1024;
const MAX_RATIO = 50; // expansion above this is a sign of a crafted payload

export async function readCompressedBody(req) {
  const announcedCompressed = Number(req.headers['content-length']) || 0;
  let decompressed = 0;
  const chunks = [];

  const expander = req.pipe(createGunzip());

  try {
    // Iterating over the expanded stream lets us decide on every chunk,
    // before holding the whole document in memory. It is the only point
    // where the check is still cheap.
    for await (const chunk of expander) {
      decompressed += chunk.length;

      // Two independent ceilings: the absolute one protects process memory,
      // the ratio one detects the payload designed to expand.
      if (decompressed > DECOMPRESSED_LIMIT) {
        throw new PayloadError('decompressed_above_limit', {
          limit_bytes: DECOMPRESSED_LIMIT,
          received_bytes: decompressed,
        });
      }

      if (announcedCompressed > 0 && decompressed / announcedCompressed > MAX_RATIO) {
        throw new PayloadError('suspicious_expansion_ratio', {
          ratio: Math.round(decompressed / announcedCompressed),
          max_ratio: MAX_RATIO,
        });
      }

      chunks.push(chunk);
    }
  } finally {
    // Tear down the expansion and the request read even when we abort in the
    // middle: without this the process keeps receiving already discarded bytes.
    expander.destroy();
    req.destroy();
  }

  return Buffer.concat(chunks);
}

class PayloadError extends Error {
  constructor(code, details) {
    super(code);
    this.code = code;
    this.details = details;
    this.status = 413;
  }
}`,
        },
      ],
    },
    {
      title: 'Raising the number is the wrong fix in most cases',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incident pressure pushes toward the one character solution: change a one into a ten in the configuration and close the ticket. That change works, costs nothing and is the right answer in exactly one scenario, which is when the current limit was inherited from a default nobody chose and the new value was computed against available memory. In every other scenario it merely moves the date of the next incident and worsens exposure meanwhile.',
        },
        {
          type: 'paragraph',
          value:
            'The signal that tells the cases apart is the shape of the size distribution. If the refusal hits a small and stable fraction of requests and the ninety ninth percentile sits just below the ceiling, the growth is organic and the limit really did get tight. If the refusal hits very few requests and their size is an order of magnitude above the ninety ninth percentile, it is not growth: it is a specific client doing something different, and raising the limit will turn a cheap refusal into expensive processing nobody sized for.',
        },
        {
          type: 'ordered',
          items: [
            'Measure the real size distribution per client over the last thirty days, not the aggregate average, and look at the fiftieth, ninety ninth and maximum separately.',
            'Identify whether the refused requests are the natural tail of the distribution or an isolated group far above it, because the two shapes call for opposite fixes.',
            'Compute the ceiling memory supports: memory available per instance divided by the format expansion factor, divided by the number of concurrent requests allowed.',
            'Compare the supported ceiling with the desired one, and if the desired one is larger, the fix is not configuration, it is changing the client sending pattern.',
            'Offer an explicit alternative path for legitimate large requests, such as paginated sending or a two step upload, before raising any number.',
            'Apply the same value across every layer of the chain, because a higher ceiling in the application with the proxy untouched changes absolutely nothing.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third item is what usually ends the discussion in teams about to raise the limit to fifty megabytes. An instance with two gigabytes of memory, an expansion factor of five for JSON and a hundred concurrent requests allowed supports a theoretical ceiling of four megabytes per body, and that is before counting any other allocation the process makes. The number the team wanted to configure was an order of magnitude above what the machine can take, and the only reason it had not broken earlier is that nobody had sent bodies that size yet.',
        },
        {
          type: 'code',
          value: `// Sustainable body ceiling per request, derived from instance memory instead
// of chosen by intuition. The number that comes out is usually far smaller
// than what the team intended to configure.

/**
 * @param {number} memoryMb       memory available per instance
 * @param {number} reserveMb      memory the process uses with no requests at all
 * @param {number} concurrent     concurrent requests allowed
 * @param {number} expansionFactor how many times the body grows once parsed
 * @param {number} safetyMargin   fraction of memory deliberately left free
 */
export function sustainableBodyCeiling({
  memoryMb = 2048,
  reserveMb = 400,
  concurrent = 100,
  expansionFactor = 5,
  safetyMargin = 0.3,
}) {
  const availableMb = (memoryMb - reserveMb) * (1 - safetyMargin);

  // Each in flight request holds the raw body plus the expanded structure.
  // Ignoring the expansion factor is the mistake that makes the math give
  // five times more than the machine can actually take.
  const perRequestMb = availableMb / concurrent;
  const ceilingMb = perRequestMb / (1 + expansionFactor);

  return {
    ceilingMb: Number(ceilingMb.toFixed(2)),
    ceilingBytes: Math.floor(ceilingMb * 1024 * 1024),
    // If the desired ceiling is above this one, the fix is not configuration:
    // it is lowering concurrency, adding memory or changing the send pattern.
    note: \`With \${concurrent} concurrent requests and \${expansionFactor}x expansion, the safe ceiling is \${ceilingMb.toFixed(2)} MB per body.\`,
  };
}

// 2048 MB, reserve 400, margin 30%, 100 concurrent, 5x expansion
// -> 1153 MB usable / 100 = 11.53 MB per request / 6 = 1.92 MB of body.
// The team wanted to configure 50 MB.`,
        },
      ],
    },
    {
      title: 'Turning the invisible ceiling into a contract the client can respect',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The property that makes this incident recurrent is that the limit is only communicated at the moment of failure, and poorly. No client can respect a contract discovered by trial and error in production. The structural fix is publishing the limit in three complementary ways, each serving a different moment in the integration lifecycle.',
        },
        {
          type: 'list',
          items: [
            'In the documentation and the API schema, with the value in bytes and the counting rule spelled out: whether what counts is the raw or the decompressed body, and whether headers count toward it.',
            'At a discovery endpoint returning the limits in force, so the client can validate before sending and so a ceiling change does not require a new deploy cycle from the partner.',
            'In the error response itself, with the limit, the received size and the recommended action, because that is where the information reaches whoever has the problem in hand.',
            'In a response header present on successful requests too, stating how much of the margin that request consumed, which gives the client an approach signal before the first refusal.',
            'In a documented alternative path for legitimate cases exceeding the ceiling, without which the partner only option is splitting the request in a way that may be wrong in their domain.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth item has the best effort to payoff ratio and is the least implemented of the five. A header that reports on every successful response the fraction of the limit consumed turns the ceiling from a cliff into a ramp: the client sitting at eighty percent knows it months before hitting, can alert their own team and can adjust the sending pattern with no incident in between. The cost of producing that header is a number the server already has in hand.',
        },
        {
          type: 'code',
          value: `// Discovery endpoint and proximity header. The goal is that the client never
// discovers the limit by trial and error in production.

const LIMITS = {
  body_bytes: 1_048_576,
  decompressed_body_bytes: 8_388_608,
  items_per_batch: 500,
  counting: 'raw body after decompression, headers do not count',
  alternative_for_larger_sends: '/v1/batches/upload',
};

// 1) Discovery: the client queries and adapts without depending on our deploy.
export function limitsRoute(_req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ limits: LIMITS, version: '2026-09-21' });
}

// 2) Proximity: every successful response states how much margin was used.
// The client at 80% finds out months ahead, not during the incident.
export function announceUsage(req, res, next) {
  const size = Number(req.headers['content-length']) || 0;

  if (size > 0) {
    const fraction = size / LIMITS.body_bytes;
    res.set('X-Payload-Limit', String(LIMITS.body_bytes));
    res.set('X-Payload-Size', String(size));
    res.set('X-Payload-Usage', fraction.toFixed(3));

    // Formal warning from 80% on: gives the client team a hook to alert on
    // without having to interpret a bare number.
    if (fraction >= 0.8) {
      res.set(
        'Warning',
        \`199 - "payload at \${Math.round(fraction * 100)}% of the limit; see \${LIMITS.alternative_for_larger_sends}"\`,
      );
    }
  }

  next();
}`,
        },
        {
          type: 'paragraph',
          value:
            'The discovery endpoint has a second order benefit that usually settles the discussion: it allows lowering a limit without breaking anyone. With the value published and queried, the service can announce the new ceiling weeks in advance, measure how many clients still send above it and only then apply the change. Without that, any limit reduction is a silent break that shows up as an incident on the partner side.',
        },
      ],
    },
    {
      title: 'Five checks that separate legitimate growth from abuse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The operational decision the team has to make during the incident is a single one: is this large request legitimate and deserving of accommodation, or is it anomalous and the refusal correct? Answering by intuition leads to two expensive mistakes in opposite directions, which are accommodating an abusive pattern and rejecting an important client that merely grew. The five checks below answer with data in a few minutes.',
        },
        {
          type: 'ordered',
          items: [
            'Compare the refused size with that same client historical ninety ninth percentile: within the same order of magnitude means growth, an order above means a behavior change.',
            'Check whether the growth is in the number of items in the batch or in the average size per item, because the first is solved with pagination and the second frequently signals a new field or duplicated data in the payload.',
            'Look for internal repetition in the refused body: repeated keys, the same nested object several times or fields filled with identical values point to a client side assembly defect, not real need.',
            'Confirm whether that same client started sending without compression, because a library change that turns compression off multiplies the size on the wire with nothing having changed in the data.',
            'Check correlation with a partner deploy date: a step jump in the size chart coinciding with a single date is a code change, and smooth growth over weeks is business volume.',
          ],
        },
        {
          type: 'table',
          columns: ['Observed pattern', 'Reading', 'Recommended action', 'Timeframe'],
          rows: [
            [
              'Smooth growth, 99th percentile touching the ceiling',
              'Real client business volume',
              'Recompute the ceiling from memory and raise it across the chain',
              'Days, with a planned window',
            ],
            [
              'Step jump on a single date',
              'Partner code change',
              'Engage the partner with the data before touching the limit',
              'Hours, it is reversible on their side',
            ],
            [
              'Body with high internal repetition',
              'Payload assembly defect',
              'Return the diagnosis to the client and keep the refusal',
              'Immediate, the refusal is correct',
            ],
            [
              'Same data, larger size, compression absent',
              'Client configuration regression',
              'Require compression in the contract and flag it in the error',
              'Immediate, the fix is one line',
            ],
            [
              'Few requests, several orders above normal',
              'Abuse or automated test outside its environment',
              'Keep the refusal, apply a per client limit and record it',
              'Immediate, no accommodation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third row deserves attention because it is the most common of the five and the one that most frequently receives the wrong fix. A payload with high internal repetition almost always comes from a loop that accumulates without clearing, from a context field attached to every item instead of once per batch, or from a serialization that repeats the parent object inside each child. Raising the limit in that case is paying with your service memory for a defect in the client, and the growth does not stop at the new value: it touches the ceiling again the next time the loop runs more iterations.',
        },
        {
          type: 'paragraph',
          value:
            'The instrumentation that supports those five checks is modest: a body size histogram labeled by client and by route, a refusal counter with the same labels, and the ratio between compressed and decompressed size. With those three signals, the question that today takes three days of messages with the partner gets answered by a dashboard in two minutes, and the answer comes with the data that convinces both sides.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is the right value for a body size limit in a public API?',
      answer:
        'There is no universal value, but there is a method that produces the right value for a concrete case, and it has four steps that can be executed in an afternoon. The first is deriving the ceiling the infrastructure sustains, which is the memory available per instance minus the process reserve, with the safety margin applied, divided by the number of concurrent requests allowed and again by the format expansion factor, which sits between three and ten for JSON depending on the language and the proportion of numbers and strings in the data. That computation almost always returns a smaller number than the team expected, and it is what defines the maximum acceptable from the service survival standpoint. The second step is measuring the real size distribution of existing clients over the last thirty days, separated by client and looking at each one ninety ninth percentile, because the aggregate median hides exactly the client that will break. The third is choosing the ceiling as a comfortable multiple of the largest legitimate ninety ninth percentile, typically between two and three times, provided that value fits below the ceiling the infrastructure sustains. If it does not fit, the result of the exercise is not a larger limit: it is the finding that that use case needs a different sending path, be it two step with an upload endpoint, be it paginated, be it asynchronous with a job identifier. The fourth step is applying the chosen value across every layer of the path and verifying from the outside that it really is the effective one, because a new ceiling in the application with the proxy untouched changes absolutely nothing and produces a second round incident with the team convinced they had already fixed it. As an order of magnitude to calibrate intuition, enterprise integration APIs usually sit between one and ten megabytes, and values above that almost always indicate the use case is file transfer disguised as an API call.',
    },
    {
      question: 'How do you offer a path for legitimate requests that genuinely do not fit the limit?',
      answer:
        'There are three established patterns and the choice among them depends on a domain question, not an infrastructure one: does the large request need to be atomic? If the answer is no, which is the most common case, the solution is paginated sending with a grouping key. The client splits the batch into chunks of predictable size, sends each one with the same batch identifier and a last chunk marker, and the server consolidates on receiving the close. That pattern preserves set semantics, allows resending an isolated chunk without repeating everything and keeps each request inside the normal ceiling, which means nothing in the chain has to be loosened. A per chunk idempotency key is what makes the resend safe. If the answer is yes, and the request must be atomic, the correct pattern is the two step upload: a small first call requests a temporary write address and returns an identifier, the client writes the content directly into object storage using that address, and a small second call reports the content is ready and triggers processing. That form has three advantages that pay for the extra complexity: the large body never crosses your service chain, the storage handles resumption and integrity with no code of yours, and the API limit stays low for every other client. The third pattern is asynchronous processing with a job identifier, appropriate when the request is large because it represents a lengthy operation and not because it carries much data: the client sends a compact job description, receives an identifier immediately and queries the result later. The common mistake across all three is not documenting the alternative path alongside the limit, which leaves the partner with the impression that the only way out is insisting on the large request until someone on the other side raises the number.',
    },
    {
      question: 'Should the limit be the same for every client or can it vary by contract?',
      answer:
        'It can and frequently should vary, but the variation has to be implemented in a specific way so it does not become a worse source of incidents than a single limit. The principle is that there are two ceilings of different natures and only one of them is negotiable. The infrastructure ceiling, derived from memory and concurrency, is a physical limit of the service: no commercial contract can exceed that value, because what lies on the other side is not a policy but the process being killed for lack of memory. The policy ceiling, which is the value applied to each client, lives below the infrastructure ceiling and can perfectly well be differentiated by plan, by integration or by route. The implementation has to observe three precautions. The first is that the per client ceiling must be resolved from a queryable, cached configuration, never from a list embedded in the code, because otherwise every commercial adjustment becomes a deploy cycle and the differentiation ends up abandoned in practice. The second is that the edge layer limit has to be the infrastructure ceiling and not the most generous client ceiling, with differentiation applied in the application layer, the only one that knows who the caller is: trying to differentiate at the proxy requires identifying the client before reading the body, which is fragile and tends to break when authentication changes. The third is that the value in force for that caller must appear at the discovery endpoint and in the proximity header, because a differentiated limit the client cannot query is indistinguishable from an unstable limit from their point of view. A positive side effect of that architecture is that it gives the team a granular containment mechanism during incidents: temporarily lowering the ceiling of a single abusive client is a configuration operation, not a deploy, and it affects nobody else.',
    },
  ],
  conclusion: {
    title: 'A size limit is a contract, and a contract that only appears in the error is not a contract',
    description:
      'Size refusal is the least informative error in the whole client error family, and it is that way for a legitimate technical reason: the decision has to be made before reading the body. That does not force the response to be useless. Measuring the effective limit by crossing the whole chain, deriving the sustainable ceiling from memory instead of choosing it by intuition, separating the limit that protects memory from the one that protects time, publishing the value at a discovery endpoint and announcing proximity on every successful response turn an invisible cliff into a ramp the client sees months before hitting. I can map the real effective limit of your path, compute the ceiling your infrastructure sustains, design the alternative path for legitimate large requests and instrument the signals that separate growth from abuse before the next ticket.',
    cta: 'Talk about my API limits',
  },
  related: [
    {
      label: 'Unversioned API contracts: evolving the payload without breaking old clients',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Per client rate limiting at the edge: protecting the service without punishing the partner',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Backend Architecture and Modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El socio integró en enero, funcionó nueve meses sin un solo error y el martes pasado empezó a recibir rechazos en una petición de cada cien. El cuerpo era el mismo formato de siempre, el token era válido, la dirección no cambió y el error llegaba antes de cualquier registro de la aplicación: el servicio nunca vio esa petición. Lo que cambió no fue el cliente ni el servidor, fue la distribución del tamaño de las peticiones, que creció lo suficiente para rozar un techo que nadie eligió conscientemente y que está declarado en cuatro lugares distintos del camino. Este artículo muestra por qué el límite efectivo es el menor de una cadena y no el que está en tu código, por qué el error llega sin cuerpo y sin rastro y qué le hace eso al soporte, cuál es la diferencia entre el límite que protege memoria y el que protege tiempo y por qué confundirlos abre una brecha, por qué subir el número es la corrección equivocada en la mayoría de los casos y cuál es la correcta, cómo convertir un techo invisible en un contrato explícito que el cliente pueda respetar antes de enviar, y qué cinco verificaciones separan una petición abusiva de una legítima que simplemente creció.',
  sections: [
    {
      title: 'El límite que vale es el menor de la cadena, y no está en tu código',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera reacción de quien recibe el reporte es abrir el código del servicio y buscar dónde está configurado el tamaño máximo del cuerpo. Se encuentra un valor, parece generoso, y la conclusión inmediata es que el problema debe estar en otro lugar. La conclusión es correcta por la razón equivocada: el problema realmente está en otro lugar, porque el valor encontrado en el código es solo uno de los cuatro o cinco techos que una petición tiene que atravesar, y lo que decide su destino es el menor de ellos, no el último.',
        },
        {
          type: 'paragraph',
          value:
            'Una petición típica en producción pasa por una red de distribución de contenido, un balanceador gestionado, un servidor de borde que termina la conexión segura, un proxy inverso interno y finalmente el proceso de la aplicación. Cada una de esas capas tiene su propio límite, cada una tiene un valor por defecto distinto, y ninguna consulta a las demás. El valor por defecto de un servidor de borde popular es un megabyte, el de una pasarela gestionada suele ser diez, el de un framework de aplicación es con frecuencia cien kilobytes, y el de la función sin servidor que alguien puso en el camino el año pasado puede ser seis megabytes con codificación obligatoria en base 64, lo que baja la capacidad útil a poco más de cuatro.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia práctica es que la respuesta a la pregunta cuál es el tamaño máximo que acepta mi servicio no puede leerse en ningún archivo de configuración aislado. Hay que medirla atravesando el camino entero, con una petición real, desde fuera. Esa medición toma quince minutos y es la única forma honesta de responder a un socio que pregunta cuánto puede enviar.',
        },
        {
          type: 'table',
          columns: ['Capa del camino', 'Valor por defecto típico cuando nadie lo configuró', 'Forma del error que devuelve', 'Aparece en el registro de la aplicación'],
          rows: [
            [
              'Red de distribución de contenido',
              'Entre 100 MB y sin límite, según el plan',
              'Página de error genérica del proveedor',
              'No, la petición nunca sale del borde',
            ],
            [
              'Balanceador gestionado de la nube',
              'De 1 MB a 10 MB según el tipo',
              'Código 413 sin cuerpo o con cuerpo por defecto',
              'Solo en la métrica del balanceador, no en la aplicación',
            ],
            [
              'Servidor de borde o proxy inverso',
              '1 MB en la configuración por defecto más común',
              'Página HTML de error, no JSON',
              'En el registro del proxy, no en el de la aplicación',
            ],
            [
              'Framework o middleware de cuerpo',
              '100 KB en varios ecosistemas',
              'Excepción capturable, formato bajo tu control',
              'Sí, y es el único punto donde eso es verdad',
            ],
            [
              'Función sin servidor en el camino',
              '6 MB contando ya la codificación de transporte',
              'Error de invocación, con frecuencia un 502',
              'No, y el rastro se queda en el proveedor',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La columna más importante es la última. En cuatro de las cinco capas la petición rechazada no genera ninguna línea en el registro de la aplicación, lo que significa que el panel de errores del equipo se mantiene limpio mientras el socio acumula fallos. Ese desfase es lo que hace que el incidente dure días: el soporte pide el identificador de traza de la petición, el socio no tiene ninguno porque ninguna respuesta lo devolvió, y el equipo busca en el lugar donde el evento nunca se registró.',
        },
        {
          type: 'diagram',
          value: `Peticion de 2,4 MB atravesando la cadena:

  cliente
    |  POST /v1/lotes  (2,4 MB)
    v
  +------------------------+
  | CDN           limite 100 MB  | -> pasa
  +------------------------+
    |
    v
  +------------------------+
  | balanceador   limite 10 MB   | -> pasa
  +------------------------+
    |
    v
  +------------------------+
  | proxy inverso limite 1 MB    | -> RECHAZA AQUI
  +------------------------+        413, HTML, sin traza
    |                               registro de la app: vacio
    X  (la peticion muere)
  +------------------------+
  | aplicacion    limite 8 MB    | -> nunca se ejecuta
  +------------------------+

Limite efectivo = min(100, 10, 1, 8) = 1 MB
El valor en el codigo de la aplicacion (8 MB) es irrelevante.`,
        },
      ],
    },
    {
      title: 'Por qué el error llega sin cuerpo, sin traza y sin explicación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay una razón técnica por la que el rechazo por tamaño es el más pobre en información de toda la familia de errores de cliente. Cuando un servicio rechaza una petición por autenticación inválida, por ejemplo, ya leyó la cabecera, ya identificó a quien llama, ya tiene un identificador de traza y puede devolver un cuerpo estructurado explicando qué falló. En el rechazo por tamaño nada de eso ocurrió, porque la decisión hay que tomarla antes de leer el cuerpo, justamente para no gastar el recurso que el límite existe para proteger.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un segundo efecto, menos conocido y más desagradable, que explica por qué a veces el cliente ve una conexión cerrada de golpe en vez de un código de error limpio. Cuando el servidor decide rechazar en medio del envío, responde y quiere cerrar, pero el cliente sigue escribiendo los megabytes restantes en el socket. El servidor entonces cierra la conexión con datos pendientes, y el cliente, que estaba en medio de una escritura, recibe un error de conexión reiniciada por el par antes de lograr leer la respuesta que ya había llegado. El socio reporta error de red, el servidor registra 413, y los dos tienen razón.',
        },
        {
          type: 'paragraph',
          value:
            'Esa es la razón por la que la corrección más valiosa de este incidente rara vez es tocar el número. Es hacer que el rechazo lleve información. Un error que dice cuánto se envió, cuánto se permite, qué capa rechazó y qué hacer a continuación convierte un ticket de soporte de tres días en una corrección de diez minutos del lado del cliente, y eso vale incluso cuando el límite permanece exactamente donde estaba.',
        },
        {
          type: 'code',
          value: `// Middleware de rechazo informativo. La decision ocurre antes de leer el
// cuerpo, mirando solo la cabecera anunciada, y la respuesta lleva lo que el
// cliente necesita para corregirse solo.

const LIMITE_BYTES = 1 * 1024 * 1024; // techo efectivo medido en la cadena, no el del framework

export function limitePayload(req, res, next) {
  const anunciado = Number(req.headers['content-length']);

  // Una peticion sin tamano anunciado usa transferencia por partes: el techo
  // hay que aplicarlo durante la lectura, no antes de ella.
  if (!Number.isFinite(anunciado)) return limitarDuranteLectura(req, res, next);

  if (anunciado > LIMITE_BYTES) {
    // Responder sin consumir el cuerpo. El cliente puede estar en medio del
    // envio, asi que pedimos el cierre explicito de la conexion para evitar
    // que reciba un error de socket en vez de esta respuesta.
    res.set('Connection', 'close');
    return res.status(413).json({
      error: 'payload_por_encima_del_limite',
      limite_bytes: LIMITE_BYTES,
      recibido_bytes: anunciado,
      capa: 'aplicacion',
      // Lo que cierra el ticket: decir que hacer, no solo que fallo.
      accion: 'Divide el lote en partes de como maximo 500 items o usa POST /v1/lotes/upload para envio en dos pasos.',
      documentacion: 'https://ejemplo.dev/docs/limites',
    });
  }

  return next();
}

// Para envio por partes el tamano real solo se conoce a lo largo de la
// lectura. Contamos los bytes y abortamos en cuanto se cruza el techo, sin
// acumular el resto en memoria.
function limitarDuranteLectura(req, res, next) {
  let leidos = 0;

  req.on('data', (parte) => {
    leidos += parte.length;
    if (leidos <= LIMITE_BYTES) return;

    res.set('Connection', 'close');
    res.status(413).json({
      error: 'payload_por_encima_del_limite',
      limite_bytes: LIMITE_BYTES,
      recibido_bytes: leidos,
      capa: 'aplicacion',
      accion: 'Anuncia content-length o reduce el tamano del envio por partes.',
    });

    // Interrumpe la lectura: sin esto el proceso sigue recibiendo bytes que
    // ya decidimos descartar, que es exactamente el coste que el limite evita.
    req.destroy();
  });

  req.on('end', () => {
    if (!res.headersSent) next();
  });
}`,
        },
        {
          type: 'paragraph',
          value:
            'Dos líneas de ese fragmento suelen olvidarse en implementaciones caseras y ambas tienen consecuencia operativa directa. La primera es el cierre explícito de la conexión, sin el cual el cliente pierde con frecuencia la respuesta que el servicio acaba de enviar. La segunda es destruir el flujo de entrada cuando se cruza el límite durante la lectura: sin eso el proceso sigue recibiendo y descartando bytes hasta el final del envío, gastando exactamente el ancho de banda y la memoria que el límite debía haber ahorrado.',
        },
      ],
    },
    {
      title: 'Dos límites distintos con el mismo nombre: memoria y tiempo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cuando alguien pregunta por qué existe un límite de tamaño, la respuesta estándar es protección contra abuso. Esa respuesta está incompleta y la incompletitud crea una brecha real. Hay dos motivos distintos para limitar tamaño, protegen recursos diferentes, y un límite calibrado para uno de ellos no protege contra el otro.',
        },
        {
          type: 'paragraph',
          value:
            'El primer motivo es memoria. Un cuerpo de petición que se lee entero dentro del proceso antes de procesarlo ocupa memoria proporcional al tamaño, multiplicada por el número de peticiones simultáneas y otra vez por un factor de expansión que casi nadie contabiliza. Un JSON de diez megabytes se convierte en una estructura de objetos que ocupa entre tres y diez veces eso en la memoria del proceso, según el lenguaje y la forma de los datos. Con cincuenta peticiones simultáneas de ese tamaño, la cuenta que parecía cómoda se convierte en la terminación del proceso por falta de memoria.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo motivo es tiempo de ocupación. Una petición grande enviada lentamente retiene a un trabajador del servidor durante todo el envío, y ese es el vector de la clase de ataque en la que el agresor anuncia un cuerpo pequeño y lo envía byte a byte, sin cruzar nunca ningún límite de tamaño. Ningún techo de bytes protege contra eso, porque el tamaño total es legítimo: lo abusivo es la tasa. La defensa es otra, se llama tiempo mínimo de recepción o tasa mínima de entrada, y es una configuración separada que vive en otro lugar de la pila.',
        },
        {
          type: 'table',
          columns: ['Riesgo', 'Recurso protegido', 'Configuración correcta', 'Lo que NO protege contra él'],
          rows: [
            [
              'Cuerpo demasiado grande cargado en memoria',
              'Memoria del proceso',
              'Techo de bytes aplicado antes de la deserialización',
              'Timeout de petición, que dispara demasiado tarde',
            ],
            [
              'Envío deliberadamente lento de un cuerpo pequeño',
              'Trabajadores y conexiones libres',
              'Tasa mínima de recepción y timeout de lectura',
              'Límite de tamaño, porque el total es legítimo',
            ],
            [
              'Expansión durante la deserialización',
              'Memoria y procesador',
              'Límite de profundidad y de número de nodos del documento',
              'Límite de bytes, que mide lo comprimido y no lo expandido',
            ],
            [
              'Cuerpo comprimido que se expande muchas veces',
              'Memoria del proceso',
              'Techo del tamaño descomprimido, verificado durante la expansión',
              'Techo de bytes, que solo ve el tamaño en la red',
            ],
            [
              'Muchas peticiones en el límite al mismo tiempo',
              'Memoria agregada del servicio',
              'Presupuesto de bytes en vuelo, no solo por petición',
              'Límite por petición aislado, que ignora la suma',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos últimas filas son las que faltan con más frecuencia en servicios que ya se consideran protegidos. Un cuerpo comprimido de cien kilobytes que se expande a un gigabyte pasa por cualquier techo de bytes medido en la red, y la defensa tiene que contar los bytes descomprimidos a lo largo de la expansión, abortando en medio de ella. Y un límite de diez megabytes por petición, con doscientas peticiones simultáneas permitidas, es en la práctica una autorización para dos gigabytes de cuerpos en vuelo, un número que nadie habría aprobado si se hubiera escrito así.',
        },
        {
          type: 'code',
          value: `// Verificacion de cuerpo comprimido con techo sobre el tamano descomprimido.
// El techo de bytes en la red no ve la expansion: 100 KB comprimidos pueden
// convertirse en 1 GB en memoria, y la comprobacion debe ocurrir durante ella.

import { createGunzip } from 'node:zlib';

const LIMITE_DESCOMPRIMIDO = 8 * 1024 * 1024;
const RAZON_MAXIMA = 50; // expansion por encima de esto es senal de payload construido

export async function leerCuerpoComprimido(req) {
  const comprimidoAnunciado = Number(req.headers['content-length']) || 0;
  let descomprimido = 0;
  const partes = [];

  const expansor = req.pipe(createGunzip());

  try {
    // Iterar sobre el flujo expandido permite decidir en cada bloque, antes
    // de tener el documento entero en memoria. Es el unico punto donde la
    // comprobacion sigue siendo barata.
    for await (const parte of expansor) {
      descomprimido += parte.length;

      // Dos techos independientes: el absoluto protege la memoria del
      // proceso, el de razon detecta el payload disenado para expandirse.
      if (descomprimido > LIMITE_DESCOMPRIMIDO) {
        throw new ErrorPayload('descomprimido_por_encima_del_limite', {
          limite_bytes: LIMITE_DESCOMPRIMIDO,
          recibido_bytes: descomprimido,
        });
      }

      if (comprimidoAnunciado > 0 && descomprimido / comprimidoAnunciado > RAZON_MAXIMA) {
        throw new ErrorPayload('razon_de_expansion_sospechosa', {
          razon: Math.round(descomprimido / comprimidoAnunciado),
          razon_maxima: RAZON_MAXIMA,
        });
      }

      partes.push(parte);
    }
  } finally {
    // Cierra la expansion y la lectura de la peticion incluso si abortamos en
    // medio: sin esto el proceso sigue recibiendo bytes ya descartados.
    expansor.destroy();
    req.destroy();
  }

  return Buffer.concat(partes);
}

class ErrorPayload extends Error {
  constructor(codigo, detalles) {
    super(codigo);
    this.codigo = codigo;
    this.detalles = detalles;
    this.status = 413;
  }
}`,
        },
      ],
    },
    {
      title: 'Subir el número es la corrección equivocada en la mayoría de los casos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La presión del incidente empuja hacia la solución de un carácter: cambiar un uno por un diez en la configuración y cerrar el ticket. Ese cambio funciona, no cuesta nada y es la respuesta correcta en exactamente un escenario, que es cuando el límite actual se heredó de un valor por defecto que nadie eligió y el nuevo valor se calculó contra la memoria disponible. En todos los demás escenarios solo mueve la fecha del próximo incidente y empeora la exposición mientras tanto.',
        },
        {
          type: 'paragraph',
          value:
            'La señal que distingue los casos es la forma de la distribución de tamaños. Si el rechazo alcanza una fracción pequeña y estable de las peticiones y el percentil noventa y nueve está justo por debajo del techo, el crecimiento es orgánico y el límite realmente quedó estrecho. Si el rechazo alcanza poquísimas peticiones y su tamaño es un orden de magnitud mayor que el percentil noventa y nueve, no es crecimiento: es un cliente específico haciendo algo distinto, y subir el límite convertirá un rechazo barato en un procesamiento caro que nadie dimensionó.',
        },
        {
          type: 'ordered',
          items: [
            'Mide la distribución real de tamaños por cliente en los últimos treinta días, no el promedio agregado, y observa el percentil cincuenta, el noventa y nueve y el máximo por separado.',
            'Identifica si las peticiones rechazadas son la cola natural de la distribución o un grupo aislado muy por encima de ella, porque las dos formas piden correcciones opuestas.',
            'Calcula el techo que la memoria soporta: memoria disponible por instancia dividida por el factor de expansión del formato, dividida por el número de peticiones simultáneas permitidas.',
            'Compara el techo soportado con el deseado, y si el deseado es mayor, la corrección no es configuración, es cambiar el patrón de envío del cliente.',
            'Ofrece un camino alternativo explícito para las peticiones grandes legítimas, como paginación en el envío o envío en dos pasos, antes de subir cualquier número.',
            'Aplica el mismo valor en todas las capas de la cadena, porque un techo mayor en la aplicación con el proxy intacto no cambia absolutamente nada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer punto es el que suele cerrar la discusión en equipos que estaban a punto de subir el límite a cincuenta megabytes. Una instancia con dos gigabytes de memoria, un factor de expansión de cinco para JSON y cien peticiones simultáneas permitidas soporta un techo teórico de cuatro megabytes por cuerpo, y eso sin contar ninguna otra asignación del proceso. El número que el equipo quería configurar estaba un orden de magnitud por encima de lo que la máquina aguanta, y la única razón por la que eso no había roto antes es que nadie había enviado cuerpos de ese tamaño todavía.',
        },
        {
          type: 'code',
          value: `// Techo sostenible de cuerpo por peticion, derivado de la memoria de la
// instancia en vez de elegido por intuicion. El numero que sale suele ser
// bastante menor que el que el equipo pretendia configurar.

/**
 * @param {number} memoriaMb       memoria disponible por instancia
 * @param {number} reservaMb       memoria que el proceso usa sin ninguna peticion
 * @param {number} simultaneas     peticiones concurrentes permitidas
 * @param {number} factorExpansion cuantas veces crece el cuerpo al volverse objeto
 * @param {number} margenSeguridad fraccion de memoria que queda libre a proposito
 */
export function techoSostenibleDeCuerpo({
  memoriaMb = 2048,
  reservaMb = 400,
  simultaneas = 100,
  factorExpansion = 5,
  margenSeguridad = 0.3,
}) {
  const disponibleMb = (memoriaMb - reservaMb) * (1 - margenSeguridad);

  // Cada peticion en vuelo ocupa el cuerpo crudo mas la estructura expandida.
  // Ignorar el factor de expansion es el error que hace que la cuenta de
  // cinco veces mas de lo que la maquina realmente aguanta.
  const porPeticionMb = disponibleMb / simultaneas;
  const techoMb = porPeticionMb / (1 + factorExpansion);

  return {
    techoMb: Number(techoMb.toFixed(2)),
    techoBytes: Math.floor(techoMb * 1024 * 1024),
    // Si el techo deseado es mayor que este, la correccion no es configuracion:
    // es reducir la concurrencia, ampliar la memoria o cambiar el patron de envio.
    nota: \`Con \${simultaneas} peticiones simultaneas y expansion de \${factorExpansion}x, el techo seguro es \${techoMb.toFixed(2)} MB por cuerpo.\`,
  };
}

// 2048 MB, reserva 400, margen 30%, 100 simultaneas, expansion 5x
// -> 1153 MB utiles / 100 = 11,53 MB por peticion / 6 = 1,92 MB de cuerpo.
// El equipo queria configurar 50 MB.`,
        },
      ],
    },
    {
      title: 'Convertir el techo invisible en un contrato que el cliente pueda respetar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La propiedad que hace recurrente este incidente es que el límite solo se comunica en el momento del fallo, y de forma pobre. Ningún cliente puede respetar un contrato que descubre por ensayo y error en producción. La corrección estructural es publicar el límite de tres formas complementarias, cada una atendiendo a un momento distinto del ciclo de vida de la integración.',
        },
        {
          type: 'list',
          items: [
            'En la documentación y en el esquema de la API, con el valor en bytes y la regla de conteo explícita: si lo que cuenta es el cuerpo crudo o el descomprimido, y si las cabeceras entran en la cuenta.',
            'En un endpoint de descubrimiento que devuelve los límites vigentes, para que el cliente pueda validar antes de enviar y para que un cambio de techo no exija un nuevo ciclo de despliegue del socio.',
            'En la propia respuesta de error, con el límite, el tamaño recibido y la acción recomendada, porque ahí es donde la información llega a quien tiene el problema en la mano.',
            'En una cabecera de respuesta presente también en las peticiones exitosas, indicando cuánto del margen consumió esa petición, lo que da al cliente una señal de proximidad antes del primer rechazo.',
            'En un camino alternativo documentado para los casos legítimos que exceden el techo, sin el cual la única salida del socio es dividir la petición de una forma que puede no ser correcta en su dominio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El cuarto punto es el de mejor relación entre esfuerzo y retorno y el menos implementado de los cinco. Una cabecera que informa en toda respuesta exitosa la fracción del límite consumida convierte el techo de un precipicio en una rampa: el cliente que está al ochenta por ciento lo sabe meses antes de chocar, puede alertar a su propio equipo y puede ajustar el patrón de envío sin ningún incidente de por medio. El coste de producir esa cabecera es un número que el servidor ya tiene en la mano.',
        },
        {
          type: 'code',
          value: `// Endpoint de descubrimiento y cabecera de proximidad. El objetivo es que el
// cliente nunca descubra el limite por ensayo y error en produccion.

const LIMITES = {
  cuerpo_bytes: 1_048_576,
  cuerpo_descomprimido_bytes: 8_388_608,
  items_por_lote: 500,
  conteo: 'cuerpo crudo tras la descompresion, las cabeceras no cuentan',
  alternativa_para_envios_mayores: '/v1/lotes/upload',
};

// 1) Descubrimiento: el cliente consulta y se adapta sin depender de nuestro despliegue.
export function rutaDeLimites(_req, res) {
  res.set('Cache-Control', 'public, max-age=3600');
  res.json({ limites: LIMITES, version: '2026-09-21' });
}

// 2) Proximidad: toda respuesta exitosa dice cuanto del margen se uso.
// El cliente al 80% se entera meses antes, y no durante el incidente.
export function anunciarConsumo(req, res, next) {
  const tamano = Number(req.headers['content-length']) || 0;

  if (tamano > 0) {
    const fraccion = tamano / LIMITES.cuerpo_bytes;
    res.set('X-Payload-Limit', String(LIMITES.cuerpo_bytes));
    res.set('X-Payload-Size', String(tamano));
    res.set('X-Payload-Usage', fraccion.toFixed(3));

    // Aviso formal a partir del 80%: da al equipo del cliente un gancho para
    // alertar sin tener que interpretar un numero suelto.
    if (fraccion >= 0.8) {
      res.set(
        'Warning',
        \`199 - "payload al \${Math.round(fraccion * 100)}% del limite; ver \${LIMITES.alternativa_para_envios_mayores}"\`,
      );
    }
  }

  next();
}`,
        },
        {
          type: 'paragraph',
          value:
            'El endpoint de descubrimiento tiene un beneficio de segundo orden que suele decidir la discusión: permite reducir un límite sin romper a nadie. Con el valor publicado y consultado, el servicio puede anunciar el techo nuevo con semanas de antelación, medir cuántos clientes siguen enviando por encima de él y solo entonces aplicar el cambio. Sin eso, cualquier reducción de límite es una ruptura silenciosa que aparece como incidente del lado del socio.',
        },
      ],
    },
    {
      title: 'Cinco verificaciones que separan crecimiento legítimo de abuso',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La decisión operativa que el equipo tiene que tomar durante el incidente es una sola: ¿esta petición grande es legítima y merece acomodación, o es anómala y el rechazo es correcto? Responder por intuición lleva a dos errores caros en direcciones opuestas, que son acomodar un patrón abusivo y rechazar a un cliente importante que simplemente creció. Las cinco verificaciones siguientes responden con datos en pocos minutos.',
        },
        {
          type: 'ordered',
          items: [
            'Compara el tamaño rechazado con el percentil noventa y nueve histórico de ese mismo cliente: dentro del mismo orden de magnitud indica crecimiento, un orden por encima indica cambio de comportamiento.',
            'Verifica si el crecimiento está en el número de items del lote o en el tamaño medio por item, porque lo primero se resuelve con paginación y lo segundo suele indicar un campo nuevo o datos duplicados en el payload.',
            'Busca repetición interna en el cuerpo rechazado: claves repetidas, el mismo objeto anidado varias veces o campos rellenados con valores idénticos indican defecto de montaje del lado del cliente, no necesidad real.',
            'Confirma si ese mismo cliente pasó a enviar sin compresión, porque un cambio de biblioteca que desactiva la compresión multiplica el tamaño en la red sin que nada haya cambiado en el dato.',
            'Comprueba la correlación con una fecha de despliegue del socio: un salto escalonado en el gráfico de tamaños coincidiendo con una fecha única es cambio de código, y un crecimiento suave a lo largo de semanas es volumen de negocio.',
          ],
        },
        {
          type: 'table',
          columns: ['Patrón observado', 'Lectura', 'Acción recomendada', 'Plazo'],
          rows: [
            [
              'Crecimiento suave, percentil 99 rozando el techo',
              'Volumen de negocio real del cliente',
              'Recalcular el techo por la memoria y subirlo en toda la cadena',
              'Días, con ventana planificada',
            ],
            [
              'Salto escalonado en una fecha única',
              'Cambio de código del socio',
              'Contactar al socio con el dato antes de tocar el límite',
              'Horas, es reversible de su lado',
            ],
            [
              'Cuerpo con alta repetición interna',
              'Defecto de montaje del payload',
              'Devolver el diagnóstico al cliente y mantener el rechazo',
              'Inmediato, el rechazo es correcto',
            ],
            [
              'Mismo dato, tamaño mayor, compresión ausente',
              'Regresión de configuración del cliente',
              'Exigir compresión en el contrato y señalarlo en el error',
              'Inmediato, la corrección es de una línea',
            ],
            [
              'Pocas peticiones, varios órdenes por encima de lo normal',
              'Abuso o prueba automatizada fuera de su entorno',
              'Mantener el rechazo, aplicar límite por cliente y registrarlo',
              'Inmediato, sin acomodación',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera fila merece atención porque es la más común de las cinco y la que con más frecuencia recibe la corrección equivocada. Un payload con alta repetición interna casi siempre viene de un bucle que acumula sin limpiar, de un campo de contexto que se adjunta a cada item en vez de una vez por lote, o de una serialización que repite el objeto padre dentro de cada hijo. Subir el límite en ese caso es pagar con la memoria de tu servicio un defecto del cliente, y el crecimiento no se detiene en el valor nuevo: vuelve a rozar el techo la próxima vez que el bucle corra más iteraciones.',
        },
        {
          type: 'paragraph',
          value:
            'La instrumentación que sostiene esas cinco verificaciones es modesta: un histograma de tamaño de cuerpo con etiqueta por cliente y por ruta, un contador de rechazos con las mismas etiquetas, y la razón entre tamaño comprimido y descomprimido. Con esas tres señales, la pregunta que hoy toma tres días de intercambio de mensajes con el socio pasa a responderse por un panel en dos minutos, y la respuesta viene con el dato que convence a ambos lados.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es el valor correcto para el límite de tamaño de cuerpo en una API pública?',
      answer:
        'No existe un valor universal, pero existe un método que produce el valor correcto para un caso concreto, y tiene cuatro pasos que pueden ejecutarse en una tarde. El primero es derivar el techo que la infraestructura sostiene, que es la memoria disponible por instancia menos la reserva del proceso, aplicado el margen de seguridad, dividido por el número de peticiones simultáneas permitidas y otra vez por el factor de expansión del formato, que queda entre tres y diez para JSON según el lenguaje y la proporción de números y cadenas en los datos. Ese cálculo casi siempre devuelve un número menor del que el equipo esperaba, y es el que define el máximo aceptable desde el punto de vista de la supervivencia del servicio. El segundo paso es medir la distribución real de tamaños de los clientes existentes en los últimos treinta días, separando por cliente y mirando el percentil noventa y nueve de cada uno, porque la mediana agregada esconde exactamente al cliente que va a romper. El tercero es elegir el techo como un múltiplo cómodo del mayor percentil noventa y nueve legítimo, típicamente entre dos y tres veces, siempre que ese valor quepa por debajo del techo que la infraestructura sostiene. Si no cabe, el resultado del ejercicio no es un límite mayor: es la constatación de que ese caso de uso necesita un camino de envío distinto, sea en dos pasos con un endpoint de carga, sea paginado, sea asíncrono con un identificador de trabajo. El cuarto paso es aplicar el valor elegido en todas las capas del camino y verificar desde fuera que realmente es el efectivo, porque un techo nuevo en la aplicación con el proxy intacto no cambia absolutamente nada y produce un incidente de segunda ronda con el equipo convencido de que ya lo había corregido. Como orden de magnitud para calibrar la intuición, las APIs de integración empresarial suelen quedar entre uno y diez megabytes, y valores por encima de eso casi siempre indican que el caso de uso es transferencia de archivo disfrazada de llamada de API.',
    },
    {
      question: '¿Cómo ofrecer un camino para peticiones legítimas que realmente no caben en el límite?',
      answer:
        'Hay tres patrones consolidados y la elección entre ellos depende de una pregunta de dominio, no de infraestructura: ¿la petición grande necesita ser atómica? Si la respuesta es no, que es el caso más común, la solución es paginación en el envío con una clave de agrupación. El cliente divide el lote en partes de tamaño previsible, envía cada una con el mismo identificador de lote y una marca de última parte, y el servidor consolida al recibir el cierre. Ese patrón preserva la semántica de conjunto, permite reenviar una parte aislada sin repetir todo y mantiene cada petición dentro del techo normal, lo que significa que nada en la cadena necesita aflojarse. La clave de idempotencia por parte es lo que hace seguro el reenvío. Si la respuesta es sí, y la petición debe ser atómica, el patrón correcto es el envío en dos pasos: una primera llamada pequeña solicita una dirección de escritura temporal y devuelve un identificador, el cliente escribe el contenido directamente en el almacenamiento de objetos usando esa dirección, y una segunda llamada pequeña informa que el contenido está listo y dispara el procesamiento. Esa forma tiene tres ventajas que compensan la complejidad extra: el cuerpo grande nunca atraviesa tu cadena de servicio, el almacenamiento se encarga de la reanudación y la integridad sin código tuyo, y el límite de la API permanece bajo para todos los demás clientes. El tercer patrón es el procesamiento asíncrono con identificador de trabajo, apropiado cuando la petición es grande porque representa una operación larga y no porque cargue muchos datos: el cliente envía la descripción compacta del trabajo, recibe un identificador de inmediato y consulta el resultado después. El error común en los tres casos es no documentar el camino alternativo junto con el límite, lo que deja al socio con la impresión de que la única salida es insistir en la petición grande hasta que alguien del otro lado suba el número.',
    },
    {
      question: '¿El límite debe ser el mismo para todos los clientes o puede variar por contrato?',
      answer:
        'Puede y con frecuencia debe variar, pero la variación hay que implementarla de una forma específica para que no se convierta en una fuente de incidentes peor que el límite único. El principio es que existen dos techos de naturalezas distintas y solo uno de ellos es negociable. El techo de infraestructura, derivado de la memoria y la concurrencia, es un límite físico del servicio: ningún contrato comercial puede exceder ese valor, porque lo que está del otro lado no es una política sino la terminación del proceso por falta de memoria. El techo de política, que es el valor aplicado a cada cliente, vive por debajo del techo de infraestructura y puede perfectamente diferenciarse por plan, por integración o por ruta. La implementación debe observar tres cuidados. El primero es que el techo por cliente debe resolverse desde una configuración consultable y cacheada, nunca desde una lista incrustada en el código, porque si no cada ajuste comercial se convierte en un ciclo de despliegue y la diferenciación acaba abandonada en la práctica. El segundo es que el límite de la capa de borde debe ser el techo de infraestructura y no el techo del cliente más generoso, con la diferenciación aplicada en la capa de aplicación, la única que sabe quién llama: intentar diferenciar en el proxy exige identificar al cliente antes de leer el cuerpo, lo que es frágil y suele romperse cuando la autenticación cambia. El tercero es que el valor vigente para ese llamante debe aparecer en el endpoint de descubrimiento y en la cabecera de proximidad, porque un límite diferenciado que el cliente no puede consultar es indistinguible de un límite inestable desde su punto de vista. Un efecto colateral positivo de esa arquitectura es que da al equipo un mecanismo de contención granular durante incidentes: reducir temporalmente el techo de un único cliente abusivo es una operación de configuración, no de despliegue, y no afecta a nadie más.',
    },
  ],
  conclusion: {
    title: 'El límite de tamaño es un contrato, y un contrato que solo aparece en el error no es contrato',
    description:
      'El rechazo por tamaño es el error más pobre en información de toda la familia de errores de cliente, y lo es por una razón técnica legítima: la decisión hay que tomarla antes de leer el cuerpo. Eso no obliga a que la respuesta sea inútil. Medir el límite efectivo atravesando la cadena entera, derivar el techo sostenible de la memoria en vez de elegirlo por intuición, separar el límite que protege memoria del que protege tiempo, publicar el valor en un endpoint de descubrimiento y anunciar la proximidad en toda respuesta exitosa convierten un precipicio invisible en una rampa que el cliente ve meses antes de chocar. Puedo levantar el límite efectivo real de tu camino, calcular el techo que tu infraestructura sostiene, diseñar el camino alternativo para las peticiones grandes legítimas e instrumentar las señales que separan crecimiento de abuso antes del próximo ticket.',
    cta: 'Hablar sobre los límites de mi API',
  },
  related: [
    {
      label: 'Contrato de API sin versión: evolucionar el payload sin romper al cliente antiguo',
      to: '/blog/contrato-api-sem-versao-evoluir-payload-sem-quebrar-cliente-antigo',
    },
    {
      label: 'Límite de tasa por cliente en el borde: proteger el servicio sin castigar al socio',
      to: '/blog/limite-taxa-por-cliente-na-borda-proteger-servico-sem-punir-parceiro',
    },
    {
      label: 'Arquitectura y Modernización Backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
