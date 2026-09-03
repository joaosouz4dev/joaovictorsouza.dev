// Conteudo do artigo: evoluir o contrato de uma API sem versao sem quebrar o cliente antigo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O campo foi renomeado numa terça-feira, o teste de integração passou, e na quinta o parceiro que integra desde 2021 abriu um chamado dizendo que o valor do pedido chegava zerado. A API nunca teve versão, ninguém sabia quem consumia o campo antigo, e reverter significava quebrar os três clientes que já tinham migrado. Este artigo mostra por que colocar um número na URL não é o mesmo que versionar um contrato, quais mudanças são realmente compatíveis e quais só parecem ser, como o cliente antigo quebra em campos que você adicionou e não em campos que removeu, como descobrir quem usa cada campo sem perguntar a ninguém, qual o roteiro de expandir e contrair aplicado a payload em vez de banco, e quais três alertas mostram que a remoção pode acontecer sem incidente.',
  sections: [
    {
      title: 'Versionar a URL não é versionar o contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira reação de quase todo time diante desse problema é criar um prefixo de versão e prometer que a partir de agora toda mudança entra em uma versão nova. A promessa dura até a terceira mudança. Manter duas versões completas de uma API significa manter dois caminhos de código, dois conjuntos de testes, duas rotinas de correção de bug e duas superfícies de segurança, e o custo disso é alto o suficiente para que a segunda versão sempre acabe sendo um repasse fino para a mesma implementação da primeira. No momento em que isso acontece, a versão na URL virou decoração: a mudança de comportamento vaza para os dois lados porque só existe um lado de verdade.',
        },
        {
          type: 'paragraph',
          value:
            'O contrato de uma API não é a rota, é o conjunto de suposições que o cliente faz sobre o que ele recebe e o que ele pode mandar. Um cliente que lê o campo de total supõe que ele existe, que é um número, que está em centavos, que não é nulo em pedido concluído, e que o valor cabe no tipo usado para desserializar. Nenhuma dessas suposições aparece na URL, e qualquer uma delas pode ser violada sem trocar de versão. A pergunta útil não é qual versão o cliente chama, é quais dessas quatro suposições a sua mudança está prestes a violar.',
        },
        {
          type: 'table',
          columns: ['Mudança no payload', 'Compatível?', 'O que realmente decide'],
          rows: [
            [
              'Adicionar campo opcional na resposta',
              'Quase sempre',
              'Só quebra se o cliente valida esquema fechado ou desserializa em modo estrito',
            ],
            [
              'Adicionar campo obrigatório na requisição',
              'Não',
              'Todo cliente que ainda não manda o campo passa a receber erro de validação',
            ],
            [
              'Remover campo da resposta',
              'Não',
              'Quebra na hora, mas de forma visível e rastreável',
            ],
            [
              'Renomear campo mantendo os dois',
              'Sim, temporariamente',
              'Vira incompatível no dia da remoção, não no dia da renomeação',
            ],
            [
              'Trocar número por texto com o mesmo valor',
              'Não',
              'Desserialização tipada falha mesmo com o valor idêntico',
            ],
            [
              'Adicionar valor novo a um campo enumerado',
              'Depende',
              'Quebra todo cliente que mapeia o enumerado para um tipo fechado',
            ],
            [
              'Relaxar uma validação de entrada',
              'Sim na entrada, não na saída',
              'O dado mais permissivo que entra hoje sai amanhã para quem não espera por ele',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As duas linhas que costumam surpreender são a do enumerado e a do relaxamento de validação. Adicionar o status de entrega parcial a um campo que antes só tinha três valores parece a mudança mais inofensiva possível, e derruba todo cliente escrito em linguagem com tipos fechados ou com um desvio condicional sem ramo padrão. Relaxar a validação de um campo de texto de cinquenta para quinhentos caracteres não quebra ninguém na entrada, e quebra o cliente que reserva cinquenta caracteres no banco dele no dia em que alguém usar os quinhentos. As duas têm a mesma assinatura: a mudança é aditiva do lado do servidor e restritiva do lado de quem consome.',
        },
      ],
    },
    {
      title: 'O cliente antigo quebra no campo que você adicionou',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição de que adicionar é seguro e remover é perigoso está certa em média e errada nos casos que causam incidente. Adicionar um campo é seguro quando o cliente ignora o que não conhece, e essa é a configuração padrão da maioria das bibliotecas de desserialização. Mas basta um cliente ter ligado a validação estrita de esquema, ou usar uma biblioteca que falha diante de propriedade desconhecida por padrão, ou validar a resposta contra um esquema gerado a partir da especificação de dois anos atrás, para que a adição vire erro. O detalhe cruel é que esse erro acontece no cliente, aparece no log do cliente, e não gera nenhum sinal do lado do servidor: a sua taxa de erro continua em zero enquanto a integração do parceiro está caída.',
        },
        {
          type: 'code',
          value: `// contract/compat.js
// A mesma resposta enviada para tres clientes com politicas de
// desserializacao diferentes. Adicionar um campo e seguro em um caso e
// fatal nos outros dois, e o servidor nao consegue distinguir.

const resposta = {
  id: 'ped_8812',
  total: 24990,          // centavos
  moeda: 'BRL',
  status: 'pago',
  descontoAplicado: 500, // campo novo, adicionado hoje
};

// Cliente A: ignora o que nao conhece. Continua funcionando.
const clienteTolerante = (json) => ({
  id: json.id,
  total: json.total,
});

// Cliente B: valida esquema fechado. Passa a rejeitar a resposta inteira
// por causa de um campo que ele nem queria ler.
const esquemaFechado = new Set(['id', 'total', 'moeda', 'status']);

const clienteEstrito = (json) => {
  for (const chave of Object.keys(json)) {
    if (!esquemaFechado.has(chave)) {
      throw new Error('propriedade desconhecida: ' + chave);
    }
  }
  return { id: json.id, total: json.total };
};

// Cliente C: mapeia o enumerado para um conjunto fechado. Sobrevive ao
// campo novo e morre no dia em que um status novo for adicionado.
const clienteEnumerado = (json) => {
  switch (json.status) {
    case 'pendente':
      return { pagavel: true };
    case 'pago':
      return { pagavel: false };
    case 'cancelado':
      return { pagavel: false };
    default:
      throw new Error('status desconhecido: ' + json.status);
  }
};

// A unica mudanca que os tres toleram e a que nao altera o conjunto de
// chaves nem o dominio de valores dos campos existentes. Qualquer outra
// precisa ser medida antes, nao anunciada depois.
export { clienteTolerante, clienteEstrito, clienteEnumerado, resposta };`,
        },
        {
          type: 'paragraph',
          value:
            'A conclusão prática é que a compatibilidade não é uma propriedade da mudança, é uma propriedade do par formado pela mudança e pelo comportamento real dos clientes que existem hoje. Você não sabe qual dos três clientes acima está do outro lado, e não vai descobrir perguntando, porque quem responde a um formulário de integração é quem lembra de responder, não quem tem o código mais antigo em produção. A única fonte confiável é o tráfego, e é por isso que a primeira etapa de qualquer evolução de contrato é instrumentar antes de mudar.',
        },
      ],
    },
    {
      title: 'Descobrir quem usa cada campo sem perguntar a ninguém',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Do lado da requisição a medição é direta: cada campo que chega é observável, e registrar quais chaves o cliente enviou já responde quem depende do quê. Do lado da resposta o problema é mais difícil, porque o servidor manda tudo e não vê o que o cliente lê. Existem três formas práticas de recuperar essa informação, e a ordem de preferência é a mesma em quase todo sistema.',
        },
        {
          type: 'ordered',
          items: [
            'Pedir ao cliente que declare o que quer. Um parâmetro de seleção de campos, uma consulta com projeção explícita ou um cabeçalho de perfil de resposta transformam a leitura em algo declarado. É a única forma que dá certeza, e é a que exige mudança do outro lado, então serve para clientes novos e não resolve o legado.',
            'Retirar o campo de uma fatia pequena do tráfego e observar quem reclama. É a forma mais barata de descobrir dependência real: remova o campo para um por cento das requisições de um cliente específico, mantenha por vinte e quatro horas e veja se a taxa de erro dele muda. Funciona bem quando você consegue segmentar por credencial e reverter em segundos.',
            'Correlacionar por comportamento observável. Se o cliente lê o total e o campo passa a vir errado, ele para de criar cobranças, ou passa a criar cobranças com valor diferente, ou aumenta a taxa de nova tentativa. Nem sempre existe um sinal desses, mas quando existe ele é o mais honesto, porque mede consequência e não intenção.',
          ],
        },
        {
          type: 'code',
          value: `// contract/uso-de-campo.js
// Instrumentacao minima para responder "quem ainda depende deste campo".
// Registra por credencial, nao por rota, porque a decisao de remover e
// sempre sobre um cliente concreto e nao sobre um endpoint.

const janelaMs = 30 * 24 * 60 * 60 * 1000; // 30 dias
const uso = new Map(); // chave: clienteId + '|' + campo -> ultimoUsoMs

const chaveDe = (clienteId, campo) => clienteId + '|' + campo;

export const registrarCamposRecebidos = (clienteId, corpo) => {
  const agora = Date.now();
  for (const campo of Object.keys(corpo || {})) {
    uso.set(chaveDe(clienteId, campo), agora);
  }
};

// Para a resposta o servidor nao observa a leitura. O que ele observa e a
// declaracao: quando o cliente pede projecao, isso e leitura confirmada.
export const registrarCamposSolicitados = (clienteId, campos) => {
  const agora = Date.now();
  for (const campo of campos) {
    uso.set(chaveDe(clienteId, campo), agora);
  }
};

// Relatorio que decide a remocao: quais clientes tocaram o campo dentro da
// janela. Lista vazia nao prova ausencia de uso, prova ausencia de
// evidencia, e a diferenca entre as duas coisas e o que separa uma
// remocao planejada de um incidente.
export const clientesQueUsam = (campo, agora = Date.now()) => {
  const limite = agora - janelaMs;
  const encontrados = [];
  for (const [chave, ultimoUso] of uso) {
    const separador = chave.lastIndexOf('|');
    const clienteId = chave.slice(0, separador);
    const campoRegistrado = chave.slice(separador + 1);
    if (campoRegistrado === campo && ultimoUso >= limite) {
      encontrados.push({ clienteId, ultimoUso });
    }
  }
  return encontrados.sort((a, b) => b.ultimoUso - a.ultimoUso);
};

// Cobertura da medicao: sem isso o relatorio acima e enganoso, porque um
// cliente que integra uma vez por trimestre nao aparece na janela.
export const coberturaDaJanela = (clienteId, agora = Date.now()) => {
  const limite = agora - janelaMs;
  const prefixo = clienteId + '|';
  for (const [chave, ultimoUso] of uso) {
    if (chave.startsWith(prefixo) && ultimoUso >= limite) {
      return { observado: true };
    }
  }
  return { observado: false, motivo: 'cliente silencioso na janela' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'A função de cobertura é a parte que costuma faltar e é a que evita o erro mais caro dessa etapa. Um relatório que diz que nenhum cliente usou o campo nos últimos trinta dias parece autorização para remover, e não é: pode significar que ninguém usa, ou que o cliente que usa integra uma vez por trimestre no fechamento contábil. A janela de observação precisa ser maior que o maior período de chamada dos seus clientes, e para integração financeira isso raramente é menos de treze meses.',
        },
      ],
    },
    {
      title: 'Expandir, migrar e contrair aplicado ao payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O roteiro que resolve migração de esquema de banco sem janela de manutenção resolve evolução de contrato pelo mesmo motivo: em ambos existe um período em que dois formatos precisam coexistir e o escritor não controla o leitor. A diferença é que no banco o leitor é o seu próprio código e a contração leva semanas, enquanto na API o leitor é de outra empresa e a contração leva trimestres. A estrutura das quatro etapas é idêntica.',
        },
        {
          type: 'diagram',
          value: `EXPANDIR  (semana 0)
  resposta: { valorTotal: 24990, total: 24990 }
  requisicao aceita: valorTotal OU total, ambos validos
  regra: se os dois vierem e divergirem, erro explicito 422
         (aceitar em silencio esconde o bug do cliente)

MIGRAR    (semana 0 ate a evidencia parar)
  clientes novos: documentacao mostra so valorTotal
  clientes antigos: cabecalho Deprecation + Sunset na resposta
  metrica por credencial: quem ainda toca 'total'

MEDIR     (janela >= maior periodo de chamada do cliente)
  relatorio semanal: clientes com uso de 'total' na janela
  contato individual, nao aviso em changelog
  criterio de saida: zero uso E cobertura confirmada

CONTRAIR  (so depois do criterio)
  remocao gradual: 1% -> 10% -> 50% -> 100% do trafego
  reversao em um comando ate os 100%
  campo removido da resposta e rejeitado na requisicao

O QUE NUNCA E ETAPA
  anunciar no changelog e remover no prazo anunciado
  sem medir uso: o prazo mede a sua paciencia, nao o risco`,
        },
        {
          type: 'paragraph',
          value:
            'A regra do erro explícito quando os dois campos chegam divergentes é a parte contraintuitiva e a que evita o pior desfecho. A tentação é aceitar o campo novo e ignorar o antigo, porque isso mantém a requisição funcionando. O problema é que um cliente que manda os dois com valores diferentes tem um defeito, e aceitar em silêncio significa gravar o valor errado sem que ninguém descubra até a conciliação. Responder com erro de validação transforma um dado corrompido em um chamado de suporte, e chamado de suporte é infinitamente mais barato.',
        },
        {
          type: 'paragraph',
          value:
            'A remoção gradual por porcentagem de tráfego é o que diferencia contração de aposta. Remover para um por cento das requisições durante um dia e observar a taxa de erro por credencial expõe o cliente que a medição não pegou, e expõe com um por cento de dano em vez de cem. A regra de operação é que a reversão precisa ser um comando único e imediato até o momento em que o percentual chega a cem, porque é exatamente nessa faixa que o cliente silencioso aparece.',
        },
      ],
    },
    {
      title: 'Cabeçalhos de descontinuação que servem para alguma coisa',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Anunciar descontinuação no changelog tem taxa de leitura próxima de zero, porque quem mantém a integração raramente é quem assinou a lista de novidades. O sinal precisa viajar junto com a resposta que o cliente já está consumindo, e existem dois cabeçalhos padronizados para isso: Deprecation, que diz que o recurso está descontinuado, e Sunset, que diz a data em que ele deixa de existir. Ambos aceitam data em formato HTTP, e a combinação com um link para a documentação da migração é o mínimo que funciona.',
        },
        {
          type: 'code',
          value: `// contract/descontinuacao.js
// Emite os sinais de descontinuacao junto da propria resposta e registra
// que o cliente recebeu o aviso. O registro e o que permite dizer, no dia
// da remocao, ha quanto tempo aquele cliente especifico esta avisado.

const avisosEntregues = new Map(); // clienteId -> { primeiro, ultimo, total }

export const aplicarDescontinuacao = ({
  res,
  clienteId,
  campo,
  sunsetISO,
  docUrl,
}) => {
  const sunset = new Date(sunsetISO);

  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', sunset.toUTCString());
  res.setHeader('Link', '<' + docUrl + '>; rel="deprecation"; type="text/html"');
  res.setHeader(
    'Warning',
    '299 - "campo ' + campo + ' sera removido em ' + sunsetISO + '"',
  );

  const agora = Date.now();
  const registro = avisosEntregues.get(clienteId) || {
    primeiro: agora,
    ultimo: agora,
    total: 0,
  };
  registro.ultimo = agora;
  registro.total += 1;
  avisosEntregues.set(clienteId, registro);
};

// Criterio objetivo para autorizar a contracao de um cliente especifico:
// ele precisa ter recebido o aviso por tempo suficiente e ter parado de
// usar o campo. Um dos dois sozinho nao basta.
export const podeContrair = ({ clienteId, usosRecentes, diasMinimos = 90 }) => {
  const registro = avisosEntregues.get(clienteId);
  if (!registro) {
    return { pode: false, motivo: 'cliente nunca recebeu o aviso' };
  }

  const diasAvisado = (Date.now() - registro.primeiro) / 86400000;
  if (diasAvisado < diasMinimos) {
    return { pode: false, motivo: 'avisado ha ' + Math.floor(diasAvisado) + ' dias' };
  }
  if (usosRecentes > 0) {
    return { pode: false, motivo: usosRecentes + ' usos na janela' };
  }
  return { pode: true, diasAvisado: Math.floor(diasAvisado) };
};`,
        },
        {
          type: 'paragraph',
          value:
            'A função que decide se pode contrair é onde a política vira código auditável. Ela exige duas condições independentes: o cliente foi avisado por tempo suficiente e o cliente parou de usar o campo. Exigir só a primeira é o modelo do prazo anunciado, que quebra quem não leu. Exigir só a segunda é o modelo da medição pura, que quebra quem tem sazonalidade. Juntas, as duas produzem uma decisão por cliente e não por endpoint, e é por cliente que o incidente acontece.',
        },
      ],
    },
    {
      title: 'Três alertas que dizem que a remoção pode acontecer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A instrumentação da evolução de contrato falha de um jeito específico: as métricas ficam boas justamente porque o campo antigo continua sendo servido, e a ausência de erro é lida como ausência de dependência. Os três alertas abaixo medem coisas que mudam antes do incidente e não depois.',
        },
        {
          type: 'table',
          columns: ['Alerta', 'Sinal medido', 'Por que ele antecipa o incidente'],
          rows: [
            [
              'Uso de campo descontinuado por credencial',
              'Contagem semanal por cliente, nunca agregada',
              'O agregado cai para perto de zero enquanto um cliente grande continua em cem por cento',
            ],
            [
              'Taxa de erro do cliente durante a remoção gradual',
              'Erro por credencial comparado à linha de base do próprio cliente',
              'Pega o cliente silencioso a um por cento de tráfego, quando reverter ainda é barato',
            ],
            [
              'Cobertura da janela de observação',
              'Clientes ativos que não apareceram na janela',
              'Distingue quem parou de usar o campo de quem parou de chamar a API',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro alerta é o que evita o erro que este artigo inteiro tenta prevenir. Um cliente que não aparece na janela de trinta dias não é um cliente que migrou, é um cliente sobre o qual você não tem informação. Separar esses dois grupos no relatório transforma a decisão de remover de um palpite baseado em silêncio em uma decisão baseada em evidência, e é a diferença entre encerrar uma migração e descobrir na segunda-feira do fechamento que o parceiro de 2021 nunca leu o changelog.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se toda mudança precisa desse processo, não é mais simples manter versões separadas mesmo?',
      answer:
        'Manter versões separadas parece mais simples porque adia o custo em vez de eliminá-lo, e o adiamento tem juros. Duas versões só são realmente independentes se tiverem código, testes e implantação próprios, e nesse caso toda correção de defeito e toda mudança de segurança precisa ser feita duas vezes, com risco de divergência silenciosa entre elas. O que quase sempre acontece na prática é a versão nova virar uma camada fina de tradução sobre a implementação da versão antiga, e aí você tem o pior dos dois mundos: o custo de manter duas superfícies públicas e nenhuma das garantias de isolamento que justificavam a separação. Há um caso legítimo para versão nova, e ele é específico: quando o modelo de domínio muda, não o formato. Se o recurso deixa de ser um pedido com itens e passa a ser um pedido com remessas que contêm itens, não existe transformação de campos que reconcilie os dois, e tentar coexistir produz um formato que nenhum dos dois lados entende bem. Para renomear campo, mudar tipo, adicionar restrição ou alterar valor padrão, expandir e contrair custa menos e entrega mais controle. A regra prática que uso é versionar quando a mudança tem nome de conceito e evoluir quando a mudança tem nome de campo.',
    },
    {
      question: 'Como lidar com o cliente que simplesmente não migra, mesmo depois de avisado por um ano?',
      answer:
        'Primeiro é preciso separar dois casos que parecem iguais e exigem tratamento oposto. O cliente que não migrou porque não viu o aviso se resolve com contato direto, e o teste é simples: mande uma mensagem para o contato técnico da credencial e veja se alguém responde em uma semana. O cliente que não migra porque não tem equipe para isso é um problema comercial, não técnico, e insistir tecnicamente só transfere a decisão para o dia do incidente. Para o segundo caso existem três saídas viáveis. A primeira é congelar aquela credencial em uma camada de compatibilidade explícita: uma tradução do formato antigo para o novo aplicada só àquele cliente, isolada do caminho principal, com custo de manutenção conhecido e revisado por trimestre. A segunda é degradação progressiva com data, do tipo em que o campo antigo passa a ser servido com latência adicional ou limite de taxa menor, o que cria pressão sem quebrar. A terceira é a remoção com data firme depois de comunicação formal, que é legítima quando o contrato comercial prevê e quando o custo de manter a compatibilidade excede o valor daquele cliente. O erro é não escolher: manter indefinidamente sem decisão explícita é como as APIs acumulam campos que ninguém entende e ninguém pode remover.',
    },
    {
      question: 'Especificação formal com validação automática de compatibilidade substitui a medição de uso?',
      answer:
        'Substitui uma parte importante e deixa de fora exatamente a parte que causa incidente. Uma ferramenta de comparação de especificação pega bem as mudanças estruturais: campo removido, tipo alterado, obrigatoriedade adicionada, valor de enumerado retirado. Rodar isso no fluxo de integração contínua e falhar a construção diante de mudança incompatível elimina a classe inteira de quebra acidental, e é a primeira coisa a montar porque o retorno é imediato. O que ela não pega é a mudança que é compatível no esquema e incompatível no significado. Passar a devolver o total incluindo frete continua sendo um número no mesmo campo com o mesmo tipo, e nenhuma validação estrutural reclama, enquanto todo cliente que soma frete separadamente passa a cobrar a mais. O mesmo vale para mudança de unidade, de fuso horário em campo de data, de precisão decimal, de critério de ordenação de uma lista e de significado do valor nulo. Essas mudanças só aparecem em teste de contrato com exemplo concreto e valor esperado, e no monitoramento do comportamento do cliente depois da implantação. A combinação que funciona é validação estrutural automatizada para o que é verificável, teste de contrato com dados reais para o significado, e medição de uso por credencial para decidir a remoção.',
    },
  ],
  conclusion: {
    title: 'Contrato se evolui com evidência, não com aviso',
    description:
      'Um número de versão na URL não impede que a mudança de significado vaze para o cliente antigo, e um aviso no changelog não prova que alguém leu. Posso revisar como a sua API evolui e definir a classificação de mudanças por compatibilidade real, a instrumentação de uso por credencial com cobertura de janela, o roteiro de expandir e contrair aplicado ao payload, os cabeçalhos de descontinuação com registro auditável de entrega, e os alertas que autorizam a remoção por cliente em vez de por prazo.',
    cta: 'Falar sobre evolução de contrato na minha API',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Testes de contrato para webhooks e APIs: reduzindo regressão em integrações',
      to: '/blog/testes-contrato-webhooks-apis',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The field was renamed on a Tuesday, the integration test passed, and on Thursday the partner who has been integrating since 2021 opened a ticket saying the order amount was arriving as zero. The API never had a version, nobody knew who consumed the old field, and rolling back meant breaking the three clients that had already migrated. This article shows why putting a number in the URL is not the same as versioning a contract, which changes are genuinely compatible and which only look like it, how the old client breaks on fields you added rather than on fields you removed, how to find out who uses each field without asking anyone, what the expand and contract playbook looks like applied to a payload instead of a database, and which three alerts show that removal can happen without an incident.',
  sections: [
    {
      title: 'Versioning the URL is not versioning the contract',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reaction of almost every team facing this problem is to create a version prefix and promise that from now on every change goes into a new version. The promise lasts until the third change. Maintaining two complete versions of an API means maintaining two code paths, two test suites, two bug fix routines and two security surfaces, and the cost of that is high enough that the second version always ends up being a thin pass-through to the same implementation as the first. The moment that happens, the version in the URL has become decoration: the behavior change leaks to both sides because there is only one real side.',
        },
        {
          type: 'paragraph',
          value:
            'An API contract is not the route, it is the set of assumptions the client makes about what it receives and what it is allowed to send. A client reading the total field assumes it exists, that it is a number, that it is in cents, that it is not null on a completed order, and that the value fits the type used to deserialize it. None of those assumptions appears in the URL, and any one of them can be violated without changing version. The useful question is not which version the client calls, it is which of those four assumptions your change is about to violate.',
        },
        {
          type: 'table',
          columns: ['Payload change', 'Compatible?', 'What actually decides'],
          rows: [
            [
              'Adding an optional field to the response',
              'Almost always',
              'Only breaks if the client validates a closed schema or deserializes in strict mode',
            ],
            [
              'Adding a required field to the request',
              'No',
              'Every client not sending the field yet starts receiving a validation error',
            ],
            [
              'Removing a field from the response',
              'No',
              'Breaks immediately, but visibly and traceably',
            ],
            [
              'Renaming a field while keeping both',
              'Yes, temporarily',
              'It becomes incompatible on removal day, not on rename day',
            ],
            [
              'Switching a number to text with the same value',
              'No',
              'Typed deserialization fails even with an identical value',
            ],
            [
              'Adding a new value to an enumerated field',
              'It depends',
              'Breaks every client mapping the enumeration to a closed type',
            ],
            [
              'Relaxing an input validation',
              'Yes on input, no on output',
              'The more permissive data accepted today goes out tomorrow to someone not expecting it',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The two rows that usually surprise people are the enumeration and the relaxed validation. Adding a partial delivery status to a field that previously held only three values looks like the most harmless change possible, and it takes down every client written in a language with closed types or with a switch that has no default branch. Relaxing a text field validation from fifty to five hundred characters breaks nobody on input, and breaks the client that reserves fifty characters in its own database the day someone uses the full five hundred. Both share the same signature: the change is additive on the server side and restrictive on the consumer side.',
        },
      ],
    },
    {
      title: 'The old client breaks on the field you added',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition that adding is safe and removing is dangerous is right on average and wrong in the cases that cause incidents. Adding a field is safe when the client ignores what it does not know, and that is the default configuration of most deserialization libraries. But it only takes one client having turned on strict schema validation, or using a library that fails on unknown properties by default, or validating the response against a schema generated from a two-year-old specification, for the addition to become an error. The cruel detail is that this error happens on the client, shows up in the client log, and produces no signal on the server side: your error rate stays at zero while the partner integration is down.',
        },
        {
          type: 'code',
          value: `// contract/compat.js
// The same response sent to three clients with different deserialization
// policies. Adding a field is safe in one case and fatal in the other two,
// and the server cannot tell them apart.

const response = {
  id: 'ord_8812',
  total: 24990,        // cents
  currency: 'BRL',
  status: 'paid',
  discountApplied: 500, // new field, added today
};

// Client A: ignores what it does not know. Keeps working.
const tolerantClient = (json) => ({
  id: json.id,
  total: json.total,
});

// Client B: validates a closed schema. Starts rejecting the entire
// response because of a field it never wanted to read.
const closedSchema = new Set(['id', 'total', 'currency', 'status']);

const strictClient = (json) => {
  for (const key of Object.keys(json)) {
    if (!closedSchema.has(key)) {
      throw new Error('unknown property: ' + key);
    }
  }
  return { id: json.id, total: json.total };
};

// Client C: maps the enumeration to a closed set. Survives the new field
// and dies the day a new status is added.
const enumeratedClient = (json) => {
  switch (json.status) {
    case 'pending':
      return { payable: true };
    case 'paid':
      return { payable: false };
    case 'cancelled':
      return { payable: false };
    default:
      throw new Error('unknown status: ' + json.status);
  }
};

// The only change all three tolerate is the one that alters neither the
// key set nor the value domain of existing fields. Anything else has to
// be measured beforehand, not announced afterwards.
export { tolerantClient, strictClient, enumeratedClient, response };`,
        },
        {
          type: 'paragraph',
          value:
            'The practical conclusion is that compatibility is not a property of the change, it is a property of the pair formed by the change and the actual behavior of the clients that exist today. You do not know which of the three clients above is on the other side, and you will not find out by asking, because whoever answers an integration survey is whoever remembers to answer, not whoever has the oldest code in production. The only reliable source is traffic, and that is why the first step of any contract evolution is to instrument before changing.',
        },
      ],
    },
    {
      title: 'Finding out who uses each field without asking anyone',
      blocks: [
        {
          type: 'paragraph',
          value:
            'On the request side the measurement is direct: every field that arrives is observable, and recording which keys the client sent already answers who depends on what. On the response side the problem is harder, because the server sends everything and does not see what the client reads. There are three practical ways to recover that information, and the order of preference is the same in almost every system.',
        },
        {
          type: 'ordered',
          items: [
            'Ask the client to declare what it wants. A field selection parameter, a query with an explicit projection or a response profile header turn the read into something declared. It is the only form that gives certainty, and it is the one that requires a change on the other side, so it serves new clients and does not solve the legacy.',
            'Withhold the field from a small slice of traffic and watch who complains. It is the cheapest way to discover real dependency: remove the field for one percent of a specific client requests, keep it for twenty-four hours and see whether its error rate moves. It works well when you can segment by credential and roll back in seconds.',
            'Correlate through observable behavior. If the client reads the total and the field starts coming back wrong, it stops creating charges, or starts creating charges with a different amount, or its retry rate goes up. Such a signal does not always exist, but when it does it is the most honest one, because it measures consequence rather than intent.',
          ],
        },
        {
          type: 'code',
          value: `// contract/field-usage.js
// Minimal instrumentation to answer "who still depends on this field".
// Records per credential, not per route, because the decision to remove is
// always about a concrete client and never about an endpoint.

const windowMs = 30 * 24 * 60 * 60 * 1000; // 30 days
const usage = new Map(); // key: clientId + '|' + field -> lastUsedMs

const keyOf = (clientId, field) => clientId + '|' + field;

export const recordReceivedFields = (clientId, body) => {
  const now = Date.now();
  for (const field of Object.keys(body || {})) {
    usage.set(keyOf(clientId, field), now);
  }
};

// On the response the server does not observe the read. What it observes
// is the declaration: when the client asks for a projection, that is a
// confirmed read.
export const recordRequestedFields = (clientId, fields) => {
  const now = Date.now();
  for (const field of fields) {
    usage.set(keyOf(clientId, field), now);
  }
};

// The report that decides removal: which clients touched the field inside
// the window. An empty list does not prove absence of usage, it proves
// absence of evidence, and the difference between the two is what
// separates a planned removal from an incident.
export const clientsUsing = (field, now = Date.now()) => {
  const cutoff = now - windowMs;
  const found = [];
  for (const [key, lastUsed] of usage) {
    const separator = key.lastIndexOf('|');
    const clientId = key.slice(0, separator);
    const recordedField = key.slice(separator + 1);
    if (recordedField === field && lastUsed >= cutoff) {
      found.push({ clientId, lastUsed });
    }
  }
  return found.sort((a, b) => b.lastUsed - a.lastUsed);
};

// Measurement coverage: without this the report above is misleading,
// because a client integrating once a quarter never shows up in the window.
export const windowCoverage = (clientId, now = Date.now()) => {
  const cutoff = now - windowMs;
  const prefix = clientId + '|';
  for (const [key, lastUsed] of usage) {
    if (key.startsWith(prefix) && lastUsed >= cutoff) {
      return { observed: true };
    }
  }
  return { observed: false, reason: 'client silent within the window' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The coverage function is the part that is usually missing and the one that prevents the most expensive mistake at this stage. A report saying no client used the field in the last thirty days looks like authorization to remove it, and it is not: it may mean nobody uses it, or that the client who does integrates once a quarter at accounting close. The observation window has to be longer than the longest calling period among your clients, and for financial integrations that is rarely less than thirteen months.',
        },
      ],
    },
    {
      title: 'Expand, migrate and contract applied to the payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The playbook that solves database schema migration without a maintenance window solves contract evolution for the same reason: in both there is a period where two formats have to coexist and the writer does not control the reader. The difference is that in the database the reader is your own code and contraction takes weeks, whereas in the API the reader belongs to another company and contraction takes quarters. The structure of the four stages is identical.',
        },
        {
          type: 'diagram',
          value: `EXPAND    (week 0)
  response: { totalAmount: 24990, total: 24990 }
  request accepts: totalAmount OR total, both valid
  rule: if both arrive and disagree, explicit 422 error
        (accepting silently hides the client bug)

MIGRATE   (week 0 until the evidence stops)
  new clients: docs show only totalAmount
  old clients: Deprecation + Sunset headers on the response
  metric per credential: who still touches 'total'

MEASURE   (window >= longest client calling period)
  weekly report: clients with 'total' usage in the window
  individual outreach, not a changelog notice
  exit criterion: zero usage AND confirmed coverage

CONTRACT  (only after the criterion)
  gradual removal: 1% -> 10% -> 50% -> 100% of traffic
  one-command rollback all the way to 100%
  field removed from the response and rejected on the request

WHAT IS NEVER A STAGE
  announcing in the changelog and removing on the announced date
  without measuring usage: the deadline measures your patience,
  not the risk`,
        },
        {
          type: 'paragraph',
          value:
            'The rule of raising an explicit error when both fields arrive with conflicting values is the counterintuitive part and the one that prevents the worst outcome. The temptation is to accept the new field and ignore the old one, because that keeps the request working. The problem is that a client sending both with different values has a defect, and accepting it silently means writing the wrong value with nobody finding out until reconciliation. Responding with a validation error turns corrupted data into a support ticket, and a support ticket is infinitely cheaper.',
        },
        {
          type: 'paragraph',
          value:
            'Gradual removal by percentage of traffic is what separates contraction from gambling. Removing it for one percent of requests over one day and watching the error rate per credential exposes the client the measurement missed, and exposes it with one percent of the damage instead of a hundred. The operational rule is that rollback has to be a single immediate command right up to the point where the percentage reaches a hundred, because that is exactly the band where the silent client shows up.',
        },
      ],
    },
    {
      title: 'Deprecation headers that actually do something',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Announcing deprecation in the changelog has a readership close to zero, because whoever maintains the integration is rarely whoever subscribed to the release notes. The signal has to travel along with the response the client is already consuming, and there are two standardized headers for that: Deprecation, which says the resource is deprecated, and Sunset, which gives the date it stops existing. Both take an HTTP-format date, and combining them with a link to the migration documentation is the minimum that works.',
        },
        {
          type: 'code',
          value: `// contract/deprecation.js
// Emits the deprecation signals along with the response itself and records
// that the client received the notice. That record is what lets you say, on
// removal day, how long that specific client has been warned.

const noticesDelivered = new Map(); // clientId -> { first, last, total }

export const applyDeprecation = ({
  res,
  clientId,
  field,
  sunsetISO,
  docUrl,
}) => {
  const sunset = new Date(sunsetISO);

  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', sunset.toUTCString());
  res.setHeader('Link', '<' + docUrl + '>; rel="deprecation"; type="text/html"');
  res.setHeader(
    'Warning',
    '299 - "field ' + field + ' will be removed on ' + sunsetISO + '"',
  );

  const now = Date.now();
  const record = noticesDelivered.get(clientId) || {
    first: now,
    last: now,
    total: 0,
  };
  record.last = now;
  record.total += 1;
  noticesDelivered.set(clientId, record);
};

// Objective criterion to authorize contraction for a specific client: it
// must have received the notice for long enough and must have stopped
// using the field. Either one alone is not enough.
export const canContract = ({ clientId, recentUsage, minimumDays = 90 }) => {
  const record = noticesDelivered.get(clientId);
  if (!record) {
    return { allowed: false, reason: 'client never received the notice' };
  }

  const daysWarned = (Date.now() - record.first) / 86400000;
  if (daysWarned < minimumDays) {
    return { allowed: false, reason: 'warned for ' + Math.floor(daysWarned) + ' days' };
  }
  if (recentUsage > 0) {
    return { allowed: false, reason: recentUsage + ' uses within the window' };
  }
  return { allowed: true, daysWarned: Math.floor(daysWarned) };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The function deciding whether contraction is allowed is where policy becomes auditable code. It requires two independent conditions: the client was warned for long enough and the client stopped using the field. Requiring only the first is the announced-deadline model, which breaks whoever did not read. Requiring only the second is the pure-measurement model, which breaks whoever has seasonality. Together they produce a decision per client rather than per endpoint, and it is per client that the incident happens.',
        },
      ],
    },
    {
      title: 'Three alerts that say removal can happen',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Instrumentation of contract evolution fails in a specific way: the metrics look good precisely because the old field is still being served, and the absence of errors gets read as absence of dependency. The three alerts below measure things that move before the incident rather than after it.',
        },
        {
          type: 'table',
          columns: ['Alert', 'Signal measured', 'Why it anticipates the incident'],
          rows: [
            [
              'Deprecated field usage per credential',
              'Weekly count per client, never aggregated',
              'The aggregate drops near zero while one large client stays at a hundred percent',
            ],
            [
              'Client error rate during gradual removal',
              'Errors per credential compared to that client own baseline',
              'Catches the silent client at one percent of traffic, while rolling back is still cheap',
            ],
            [
              'Observation window coverage',
              'Active clients that did not appear within the window',
              'Distinguishes who stopped using the field from who stopped calling the API',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third alert is the one that prevents the mistake this entire article tries to avoid. A client that does not appear in the thirty-day window is not a client that migrated, it is a client you have no information about. Separating those two groups in the report turns the removal decision from a guess based on silence into a decision based on evidence, and that is the difference between closing a migration and finding out on accounting close Monday that the 2021 partner never read the changelog.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If every change needs this process, would maintaining separate versions not be simpler after all?',
      answer:
        'Maintaining separate versions looks simpler because it defers the cost instead of eliminating it, and deferral accrues interest. Two versions are only genuinely independent if they have their own code, tests and deployment, and in that case every defect fix and every security change has to be done twice, with the risk of silent divergence between them. What almost always happens in practice is that the new version becomes a thin translation layer over the old version implementation, and then you have the worst of both worlds: the cost of maintaining two public surfaces and none of the isolation guarantees that justified the split. There is a legitimate case for a new version, and it is specific: when the domain model changes, not the format. If the resource stops being an order with items and becomes an order with shipments containing items, no field transformation reconciles the two, and trying to make them coexist produces a format neither side understands well. For renaming a field, changing a type, adding a constraint or altering a default value, expand and contract costs less and gives more control. The rule of thumb I use is to version when the change has the name of a concept and to evolve when the change has the name of a field.',
    },
    {
      question: 'How do you handle the client that simply does not migrate, even after a year of notice?',
      answer:
        'First you have to separate two cases that look identical and require opposite treatment. The client that did not migrate because it never saw the notice is solved by direct contact, and the test is simple: send a message to the technical contact on the credential and see whether anyone answers within a week. The client that does not migrate because it has no team for it is a commercial problem, not a technical one, and pushing technically only moves the decision to incident day. For the second case there are three viable exits. The first is to freeze that credential behind an explicit compatibility layer: a translation from the old format to the new one applied only to that client, isolated from the main path, with a known maintenance cost reviewed each quarter. The second is progressive degradation with a date, where the old field starts being served with added latency or a lower rate limit, which creates pressure without breaking. The third is removal on a firm date after formal communication, which is legitimate when the commercial agreement allows it and when the cost of keeping compatibility exceeds the value of that client. The mistake is not choosing: keeping it indefinitely without an explicit decision is how APIs accumulate fields nobody understands and nobody can remove.',
    },
    {
      question: 'Does a formal specification with automated compatibility checking replace usage measurement?',
      answer:
        'It replaces an important part and leaves out exactly the part that causes incidents. A specification diffing tool catches structural changes well: field removed, type changed, requiredness added, enumeration value withdrawn. Running that in continuous integration and failing the build on an incompatible change eliminates the entire class of accidental breakage, and it is the first thing to set up because the return is immediate. What it does not catch is the change that is compatible in schema and incompatible in meaning. Starting to return the total including shipping is still a number in the same field with the same type, and no structural validation objects, while every client that adds shipping separately starts overcharging. The same holds for changes of unit, of time zone in a date field, of decimal precision, of the sort order of a list and of the meaning of a null value. Those only surface in contract tests with a concrete example and an expected value, and in monitoring client behavior after deployment. The combination that works is automated structural validation for what is verifiable, contract testing with real data for meaning, and usage measurement per credential to decide removal.',
    },
  ],
  conclusion: {
    title: 'Contracts evolve on evidence, not on notice',
    description:
      'A version number in the URL does not stop a meaning change from leaking to the old client, and a changelog notice does not prove anyone read it. I can review how your API evolves and define the classification of changes by real compatibility, usage instrumentation per credential with window coverage, the expand and contract playbook applied to the payload, deprecation headers with an auditable delivery record, and the alerts that authorize removal per client instead of per deadline.',
    cta: 'Talk about contract evolution in my API',
  },
  related: [
    {
      label: 'Database migration without a window: expand, migrate and contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Contract testing for webhooks and APIs: reducing regressions in integrations',
      to: '/blog/testes-contrato-webhooks-apis',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'El campo se renombró un martes, la prueba de integración pasó, y el jueves el socio que integra desde 2021 abrió un ticket diciendo que el importe del pedido llegaba en cero. La API nunca tuvo versión, nadie sabía quién consumía el campo antiguo, y revertir significaba romper a los tres clientes que ya habían migrado. Este artículo muestra por qué poner un número en la URL no es lo mismo que versionar un contrato, qué cambios son realmente compatibles y cuáles solo lo parecen, cómo el cliente antiguo se rompe en campos que agregaste y no en campos que quitaste, cómo descubrir quién usa cada campo sin preguntarle a nadie, cuál es la hoja de ruta de expandir y contraer aplicada al payload en vez de a la base de datos, y qué tres alertas muestran que la eliminación puede ocurrir sin incidente.',
  sections: [
    {
      title: 'Versionar la URL no es versionar el contrato',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera reacción de casi todo equipo frente a este problema es crear un prefijo de versión y prometer que de ahora en adelante todo cambio entra en una versión nueva. La promesa dura hasta el tercer cambio. Mantener dos versiones completas de una API significa mantener dos caminos de código, dos conjuntos de pruebas, dos rutinas de corrección de fallos y dos superficies de seguridad, y el costo de eso es lo bastante alto como para que la segunda versión termine siendo siempre un traspaso fino hacia la misma implementación de la primera. En el momento en que eso ocurre, la versión en la URL se volvió decoración: el cambio de comportamiento se filtra a los dos lados porque solo existe un lado de verdad.',
        },
        {
          type: 'paragraph',
          value:
            'El contrato de una API no es la ruta, es el conjunto de supuestos que el cliente hace sobre lo que recibe y lo que puede enviar. Un cliente que lee el campo del total supone que existe, que es un número, que está en centavos, que no es nulo en un pedido concluido, y que el valor cabe en el tipo que usa para deserializar. Ninguno de esos supuestos aparece en la URL, y cualquiera de ellos puede violarse sin cambiar de versión. La pregunta útil no es qué versión llama el cliente, es cuál de esos cuatro supuestos está a punto de violar tu cambio.',
        },
        {
          type: 'table',
          columns: ['Cambio en el payload', '¿Compatible?', 'Qué lo decide realmente'],
          rows: [
            [
              'Agregar un campo opcional en la respuesta',
              'Casi siempre',
              'Solo rompe si el cliente valida esquema cerrado o deserializa en modo estricto',
            ],
            [
              'Agregar un campo obligatorio en la petición',
              'No',
              'Todo cliente que aún no envía el campo pasa a recibir error de validación',
            ],
            [
              'Quitar un campo de la respuesta',
              'No',
              'Rompe de inmediato, pero de forma visible y rastreable',
            ],
            [
              'Renombrar un campo manteniendo los dos',
              'Sí, temporalmente',
              'Se vuelve incompatible el día de la eliminación, no el día del renombrado',
            ],
            [
              'Cambiar número por texto con el mismo valor',
              'No',
              'La deserialización tipada falla incluso con el valor idéntico',
            ],
            [
              'Agregar un valor nuevo a un campo enumerado',
              'Depende',
              'Rompe a todo cliente que mapea el enumerado a un tipo cerrado',
            ],
            [
              'Relajar una validación de entrada',
              'Sí en la entrada, no en la salida',
              'El dato más permisivo que entra hoy sale mañana hacia quien no lo espera',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las dos filas que suelen sorprender son la del enumerado y la del relajamiento de validación. Agregar el estado de entrega parcial a un campo que antes solo tenía tres valores parece el cambio más inofensivo posible, y tumba a todo cliente escrito en un lenguaje con tipos cerrados o con una bifurcación sin rama por defecto. Relajar la validación de un campo de texto de cincuenta a quinientos caracteres no rompe a nadie en la entrada, y rompe al cliente que reserva cincuenta caracteres en su propia base el día en que alguien use los quinientos. Las dos tienen la misma firma: el cambio es aditivo del lado del servidor y restrictivo del lado de quien consume.',
        },
      ],
    },
    {
      title: 'El cliente antiguo se rompe en el campo que agregaste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición de que agregar es seguro y quitar es peligroso es correcta en promedio y equivocada en los casos que causan incidentes. Agregar un campo es seguro cuando el cliente ignora lo que no conoce, y esa es la configuración por defecto de la mayoría de las bibliotecas de deserialización. Pero basta con que un cliente haya activado la validación estricta de esquema, o use una biblioteca que falla ante una propiedad desconocida por defecto, o valide la respuesta contra un esquema generado a partir de la especificación de hace dos años, para que la adición se convierta en error. El detalle cruel es que ese error ocurre en el cliente, aparece en el registro del cliente, y no genera ninguna señal del lado del servidor: tu tasa de error sigue en cero mientras la integración del socio está caída.',
        },
        {
          type: 'code',
          value: `// contract/compat.js
// La misma respuesta enviada a tres clientes con politicas de
// deserializacion diferentes. Agregar un campo es seguro en un caso y
// fatal en los otros dos, y el servidor no puede distinguirlos.

const respuesta = {
  id: 'ped_8812',
  total: 24990,          // centavos
  moneda: 'BRL',
  estado: 'pagado',
  descuentoAplicado: 500, // campo nuevo, agregado hoy
};

// Cliente A: ignora lo que no conoce. Sigue funcionando.
const clienteTolerante = (json) => ({
  id: json.id,
  total: json.total,
});

// Cliente B: valida esquema cerrado. Pasa a rechazar la respuesta entera
// por culpa de un campo que ni siquiera queria leer.
const esquemaCerrado = new Set(['id', 'total', 'moneda', 'estado']);

const clienteEstricto = (json) => {
  for (const clave of Object.keys(json)) {
    if (!esquemaCerrado.has(clave)) {
      throw new Error('propiedad desconocida: ' + clave);
    }
  }
  return { id: json.id, total: json.total };
};

// Cliente C: mapea el enumerado a un conjunto cerrado. Sobrevive al campo
// nuevo y muere el dia en que se agregue un estado nuevo.
const clienteEnumerado = (json) => {
  switch (json.estado) {
    case 'pendiente':
      return { pagable: true };
    case 'pagado':
      return { pagable: false };
    case 'cancelado':
      return { pagable: false };
    default:
      throw new Error('estado desconocido: ' + json.estado);
  }
};

// El unico cambio que los tres toleran es el que no altera el conjunto de
// claves ni el dominio de valores de los campos existentes. Cualquier otro
// necesita medirse antes, no anunciarse despues.
export { clienteTolerante, clienteEstricto, clienteEnumerado, respuesta };`,
        },
        {
          type: 'paragraph',
          value:
            'La conclusión práctica es que la compatibilidad no es una propiedad del cambio, es una propiedad del par formado por el cambio y el comportamiento real de los clientes que existen hoy. No sabes cuál de los tres clientes de arriba está del otro lado, y no lo vas a descubrir preguntando, porque quien responde un formulario de integración es quien se acuerda de responder, no quien tiene el código más antiguo en producción. La única fuente confiable es el tráfico, y por eso la primera etapa de cualquier evolución de contrato es instrumentar antes de cambiar.',
        },
      ],
    },
    {
      title: 'Descubrir quién usa cada campo sin preguntarle a nadie',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Del lado de la petición la medición es directa: cada campo que llega es observable, y registrar qué claves envió el cliente ya responde quién depende de qué. Del lado de la respuesta el problema es más difícil, porque el servidor manda todo y no ve lo que el cliente lee. Existen tres formas prácticas de recuperar esa información, y el orden de preferencia es el mismo en casi todo sistema.',
        },
        {
          type: 'ordered',
          items: [
            'Pedirle al cliente que declare lo que quiere. Un parámetro de selección de campos, una consulta con proyección explícita o una cabecera de perfil de respuesta convierten la lectura en algo declarado. Es la única forma que da certeza, y es la que exige un cambio del otro lado, así que sirve para clientes nuevos y no resuelve el legado.',
            'Retirar el campo de una porción pequeña del tráfico y observar quién reclama. Es la forma más barata de descubrir dependencia real: quita el campo para el uno por ciento de las peticiones de un cliente específico, mantenlo veinticuatro horas y mira si su tasa de error se mueve. Funciona bien cuando puedes segmentar por credencial y revertir en segundos.',
            'Correlacionar por comportamiento observable. Si el cliente lee el total y el campo pasa a llegar mal, deja de crear cobros, o pasa a crear cobros con un importe distinto, o aumenta su tasa de reintento. No siempre existe una señal así, pero cuando existe es la más honesta, porque mide consecuencia y no intención.',
          ],
        },
        {
          type: 'code',
          value: `// contract/uso-de-campo.js
// Instrumentacion minima para responder "quien todavia depende de este
// campo". Registra por credencial, no por ruta, porque la decision de
// eliminar siempre trata sobre un cliente concreto y no sobre un endpoint.

const ventanaMs = 30 * 24 * 60 * 60 * 1000; // 30 dias
const uso = new Map(); // clave: clienteId + '|' + campo -> ultimoUsoMs

const claveDe = (clienteId, campo) => clienteId + '|' + campo;

export const registrarCamposRecibidos = (clienteId, cuerpo) => {
  const ahora = Date.now();
  for (const campo of Object.keys(cuerpo || {})) {
    uso.set(claveDe(clienteId, campo), ahora);
  }
};

// En la respuesta el servidor no observa la lectura. Lo que observa es la
// declaracion: cuando el cliente pide proyeccion, eso es lectura confirmada.
export const registrarCamposSolicitados = (clienteId, campos) => {
  const ahora = Date.now();
  for (const campo of campos) {
    uso.set(claveDe(clienteId, campo), ahora);
  }
};

// El informe que decide la eliminacion: que clientes tocaron el campo
// dentro de la ventana. Una lista vacia no prueba ausencia de uso, prueba
// ausencia de evidencia, y la diferencia entre ambas cosas es lo que
// separa una eliminacion planificada de un incidente.
export const clientesQueUsan = (campo, ahora = Date.now()) => {
  const limite = ahora - ventanaMs;
  const encontrados = [];
  for (const [clave, ultimoUso] of uso) {
    const separador = clave.lastIndexOf('|');
    const clienteId = clave.slice(0, separador);
    const campoRegistrado = clave.slice(separador + 1);
    if (campoRegistrado === campo && ultimoUso >= limite) {
      encontrados.push({ clienteId, ultimoUso });
    }
  }
  return encontrados.sort((a, b) => b.ultimoUso - a.ultimoUso);
};

// Cobertura de la medicion: sin esto el informe de arriba es enganoso,
// porque un cliente que integra una vez por trimestre no aparece en la
// ventana.
export const coberturaDeLaVentana = (clienteId, ahora = Date.now()) => {
  const limite = ahora - ventanaMs;
  const prefijo = clienteId + '|';
  for (const [clave, ultimoUso] of uso) {
    if (clave.startsWith(prefijo) && ultimoUso >= limite) {
      return { observado: true };
    }
  }
  return { observado: false, motivo: 'cliente silencioso en la ventana' };
};`,
        },
        {
          type: 'paragraph',
          value:
            'La función de cobertura es la parte que suele faltar y la que evita el error más caro de esta etapa. Un informe que dice que ningún cliente usó el campo en los últimos treinta días parece autorización para eliminarlo, y no lo es: puede significar que nadie lo usa, o que el cliente que lo usa integra una vez por trimestre en el cierre contable. La ventana de observación tiene que ser mayor que el mayor período de llamada de tus clientes, y para integraciones financieras eso rara vez es menos de trece meses.',
        },
      ],
    },
    {
      title: 'Expandir, migrar y contraer aplicado al payload',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La hoja de ruta que resuelve la migración de esquema de base de datos sin ventana de mantenimiento resuelve la evolución de contrato por el mismo motivo: en ambas existe un período en que dos formatos tienen que coexistir y el escritor no controla al lector. La diferencia es que en la base el lector es tu propio código y la contracción lleva semanas, mientras que en la API el lector es de otra empresa y la contracción lleva trimestres. La estructura de las cuatro etapas es idéntica.',
        },
        {
          type: 'diagram',
          value: `EXPANDIR  (semana 0)
  respuesta: { importeTotal: 24990, total: 24990 }
  peticion acepta: importeTotal O total, ambos validos
  regla: si llegan los dos y difieren, error explicito 422
         (aceptar en silencio esconde el fallo del cliente)

MIGRAR    (semana 0 hasta que la evidencia se detenga)
  clientes nuevos: la documentacion muestra solo importeTotal
  clientes antiguos: cabeceras Deprecation + Sunset en la respuesta
  metrica por credencial: quien sigue tocando 'total'

MEDIR     (ventana >= mayor periodo de llamada del cliente)
  informe semanal: clientes con uso de 'total' en la ventana
  contacto individual, no aviso en changelog
  criterio de salida: cero uso Y cobertura confirmada

CONTRAER  (solo despues del criterio)
  eliminacion gradual: 1% -> 10% -> 50% -> 100% del trafico
  reversion en un comando hasta el 100%
  campo eliminado de la respuesta y rechazado en la peticion

LO QUE NUNCA ES UNA ETAPA
  anunciar en el changelog y eliminar en el plazo anunciado
  sin medir uso: el plazo mide tu paciencia, no el riesgo`,
        },
        {
          type: 'paragraph',
          value:
            'La regla del error explícito cuando los dos campos llegan con valores divergentes es la parte contraintuitiva y la que evita el peor desenlace. La tentación es aceptar el campo nuevo e ignorar el antiguo, porque eso mantiene la petición funcionando. El problema es que un cliente que envía los dos con valores distintos tiene un defecto, y aceptarlo en silencio significa grabar el valor equivocado sin que nadie lo descubra hasta la conciliación. Responder con error de validación convierte un dato corrompido en un ticket de soporte, y un ticket de soporte es infinitamente más barato.',
        },
        {
          type: 'paragraph',
          value:
            'La eliminación gradual por porcentaje de tráfico es lo que diferencia una contracción de una apuesta. Quitarlo para el uno por ciento de las peticiones durante un día y observar la tasa de error por credencial expone al cliente que la medición no capturó, y lo expone con el uno por ciento del daño en vez del cien. La regla de operación es que la reversión tiene que ser un único comando inmediato hasta el momento en que el porcentaje llega a cien, porque es exactamente en esa franja donde aparece el cliente silencioso.',
        },
      ],
    },
    {
      title: 'Cabeceras de descontinuación que sirven para algo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Anunciar la descontinuación en el changelog tiene una tasa de lectura cercana a cero, porque quien mantiene la integración rara vez es quien se suscribió a las notas de versión. La señal necesita viajar junto con la respuesta que el cliente ya está consumiendo, y existen dos cabeceras estandarizadas para eso: Deprecation, que dice que el recurso está descontinuado, y Sunset, que dice la fecha en que deja de existir. Ambas aceptan fecha en formato HTTP, y la combinación con un enlace a la documentación de la migración es el mínimo que funciona.',
        },
        {
          type: 'code',
          value: `// contract/descontinuacion.js
// Emite las senales de descontinuacion junto con la propia respuesta y
// registra que el cliente recibio el aviso. Ese registro es lo que permite
// decir, el dia de la eliminacion, hace cuanto ese cliente especifico esta
// avisado.

const avisosEntregados = new Map(); // clienteId -> { primero, ultimo, total }

export const aplicarDescontinuacion = ({
  res,
  clienteId,
  campo,
  sunsetISO,
  docUrl,
}) => {
  const sunset = new Date(sunsetISO);

  res.setHeader('Deprecation', 'true');
  res.setHeader('Sunset', sunset.toUTCString());
  res.setHeader('Link', '<' + docUrl + '>; rel="deprecation"; type="text/html"');
  res.setHeader(
    'Warning',
    '299 - "el campo ' + campo + ' sera eliminado el ' + sunsetISO + '"',
  );

  const ahora = Date.now();
  const registro = avisosEntregados.get(clienteId) || {
    primero: ahora,
    ultimo: ahora,
    total: 0,
  };
  registro.ultimo = ahora;
  registro.total += 1;
  avisosEntregados.set(clienteId, registro);
};

// Criterio objetivo para autorizar la contraccion de un cliente especifico:
// tiene que haber recibido el aviso durante tiempo suficiente y haber
// dejado de usar el campo. Uno de los dos por si solo no basta.
export const puedeContraer = ({ clienteId, usosRecientes, diasMinimos = 90 }) => {
  const registro = avisosEntregados.get(clienteId);
  if (!registro) {
    return { permitido: false, motivo: 'el cliente nunca recibio el aviso' };
  }

  const diasAvisado = (Date.now() - registro.primero) / 86400000;
  if (diasAvisado < diasMinimos) {
    return { permitido: false, motivo: 'avisado hace ' + Math.floor(diasAvisado) + ' dias' };
  }
  if (usosRecientes > 0) {
    return { permitido: false, motivo: usosRecientes + ' usos en la ventana' };
  }
  return { permitido: true, diasAvisado: Math.floor(diasAvisado) };
};`,
        },
        {
          type: 'paragraph',
          value:
            'La función que decide si se puede contraer es donde la política se vuelve código auditable. Exige dos condiciones independientes: el cliente fue avisado durante tiempo suficiente y el cliente dejó de usar el campo. Exigir solo la primera es el modelo del plazo anunciado, que rompe a quien no leyó. Exigir solo la segunda es el modelo de la medición pura, que rompe a quien tiene estacionalidad. Juntas, las dos producen una decisión por cliente y no por endpoint, y es por cliente que ocurre el incidente.',
        },
      ],
    },
    {
      title: 'Tres alertas que dicen que la eliminación puede ocurrir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La instrumentación de la evolución de contrato falla de una forma específica: las métricas se ven bien justamente porque el campo antiguo sigue siendo servido, y la ausencia de error se lee como ausencia de dependencia. Las tres alertas de abajo miden cosas que se mueven antes del incidente y no después.',
        },
        {
          type: 'table',
          columns: ['Alerta', 'Señal medida', 'Por qué anticipa el incidente'],
          rows: [
            [
              'Uso de campo descontinuado por credencial',
              'Conteo semanal por cliente, nunca agregado',
              'El agregado cae cerca de cero mientras un cliente grande sigue en el cien por ciento',
            ],
            [
              'Tasa de error del cliente durante la eliminación gradual',
              'Error por credencial comparado con la línea base del propio cliente',
              'Captura al cliente silencioso al uno por ciento de tráfico, cuando revertir aún es barato',
            ],
            [
              'Cobertura de la ventana de observación',
              'Clientes activos que no aparecieron en la ventana',
              'Distingue a quien dejó de usar el campo de quien dejó de llamar a la API',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera alerta es la que evita el error que este artículo entero intenta prevenir. Un cliente que no aparece en la ventana de treinta días no es un cliente que migró, es un cliente sobre el cual no tienes información. Separar esos dos grupos en el informe convierte la decisión de eliminar de una corazonada basada en el silencio en una decisión basada en evidencia, y es la diferencia entre cerrar una migración y descubrir el lunes del cierre contable que el socio de 2021 nunca leyó el changelog.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si todo cambio necesita este proceso, ¿no es más simple mantener versiones separadas de todos modos?',
      answer:
        'Mantener versiones separadas parece más simple porque aplaza el costo en vez de eliminarlo, y el aplazamiento tiene intereses. Dos versiones solo son realmente independientes si tienen código, pruebas y despliegue propios, y en ese caso toda corrección de defecto y todo cambio de seguridad hay que hacerlo dos veces, con riesgo de divergencia silenciosa entre ellas. Lo que casi siempre pasa en la práctica es que la versión nueva se convierte en una capa fina de traducción sobre la implementación de la versión antigua, y entonces tienes lo peor de los dos mundos: el costo de mantener dos superficies públicas y ninguna de las garantías de aislamiento que justificaban la separación. Hay un caso legítimo para una versión nueva, y es específico: cuando cambia el modelo de dominio, no el formato. Si el recurso deja de ser un pedido con artículos y pasa a ser un pedido con envíos que contienen artículos, no existe transformación de campos que reconcilie ambos, e intentar que coexistan produce un formato que ninguno de los dos lados entiende bien. Para renombrar un campo, cambiar un tipo, agregar una restricción o alterar un valor por defecto, expandir y contraer cuesta menos y entrega más control. La regla práctica que uso es versionar cuando el cambio tiene nombre de concepto y evolucionar cuando el cambio tiene nombre de campo.',
    },
    {
      question: '¿Cómo tratar al cliente que simplemente no migra, incluso después de un año de aviso?',
      answer:
        'Primero hay que separar dos casos que parecen iguales y exigen tratamiento opuesto. El cliente que no migró porque no vio el aviso se resuelve con contacto directo, y la prueba es simple: envía un mensaje al contacto técnico de la credencial y mira si alguien responde en una semana. El cliente que no migra porque no tiene equipo para eso es un problema comercial, no técnico, e insistir técnicamente solo traslada la decisión al día del incidente. Para el segundo caso existen tres salidas viables. La primera es congelar esa credencial detrás de una capa de compatibilidad explícita: una traducción del formato antiguo al nuevo aplicada solo a ese cliente, aislada del camino principal, con un costo de mantenimiento conocido y revisado cada trimestre. La segunda es la degradación progresiva con fecha, donde el campo antiguo pasa a servirse con latencia adicional o un límite de tasa menor, lo que crea presión sin romper. La tercera es la eliminación con fecha firme después de una comunicación formal, que es legítima cuando el acuerdo comercial lo prevé y cuando el costo de mantener la compatibilidad supera el valor de ese cliente. El error es no elegir: mantenerlo indefinidamente sin decisión explícita es como las APIs acumulan campos que nadie entiende y nadie puede eliminar.',
    },
    {
      question: '¿Una especificación formal con validación automática de compatibilidad sustituye la medición de uso?',
      answer:
        'Sustituye una parte importante y deja fuera exactamente la parte que causa incidentes. Una herramienta de comparación de especificaciones captura bien los cambios estructurales: campo eliminado, tipo alterado, obligatoriedad agregada, valor de enumerado retirado. Ejecutar eso en el flujo de integración continua y hacer fallar la construcción ante un cambio incompatible elimina la clase entera de rotura accidental, y es lo primero que hay que montar porque el retorno es inmediato. Lo que no captura es el cambio que es compatible en el esquema e incompatible en el significado. Pasar a devolver el total incluyendo el envío sigue siendo un número en el mismo campo con el mismo tipo, y ninguna validación estructural reclama, mientras que todo cliente que suma el envío por separado pasa a cobrar de más. Lo mismo vale para cambios de unidad, de zona horaria en un campo de fecha, de precisión decimal, de criterio de ordenación de una lista y de significado del valor nulo. Esos cambios solo aparecen en pruebas de contrato con un ejemplo concreto y un valor esperado, y en el monitoreo del comportamiento del cliente después del despliegue. La combinación que funciona es validación estructural automatizada para lo que es verificable, pruebas de contrato con datos reales para el significado, y medición de uso por credencial para decidir la eliminación.',
    },
  ],
  conclusion: {
    title: 'El contrato se evoluciona con evidencia, no con aviso',
    description:
      'Un número de versión en la URL no impide que el cambio de significado se filtre hacia el cliente antiguo, y un aviso en el changelog no prueba que alguien lo leyó. Puedo revisar cómo evoluciona tu API y definir la clasificación de cambios por compatibilidad real, la instrumentación de uso por credencial con cobertura de ventana, la hoja de ruta de expandir y contraer aplicada al payload, las cabeceras de descontinuación con registro auditable de entrega, y las alertas que autorizan la eliminación por cliente en vez de por plazo.',
    cta: 'Hablar sobre evolución de contrato en mi API',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Pruebas de contrato para webhooks y APIs: reduciendo regresiones en integraciones',
      to: '/blog/testes-contrato-webhooks-apis',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default { pt, en, es };
