// Conteudo do artigo: como trocar o motor de busca com a consulta ligada,
// sem janela de manutencao, sem resultado vazio e sem relevancia pior.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A reindexação começou numa quinta às nove da noite com a promessa de terminar em duas horas, e às seis da manhã ainda faltavam quarenta por cento do catálogo. O time apontou a busca para o índice novo mesmo assim, porque o tráfego ia subir às oito. Naquele dia a busca por "tênis branco" devolveu trezentos resultados em vez de onze mil, ninguém percebeu por três horas porque a página não deu erro nenhum, e a receita de busca caiu dezenove por cento antes que alguém ligasse uma coisa à outra. Este artigo mostra por que a troca de motor de busca falha de um jeito silencioso que a troca de banco não tem, como o índice paralelo mais a repetição de escrita eliminam a janela de manutenção, por que a verificação por contagem de documentos aprova índices quebrados e qual verificação a substitui, por que a relevância muda mesmo quando os dados estão corretos e como comparar duas listas ordenadas sem depender de opinião, qual sequência de sete etapas troca o motor com a consulta ligada e reverte em qualquer ponto, e quais indicadores autorizam desligar o índice antigo.',
  sections: [
    {
      title: 'Por que a troca de busca falha em silêncio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma migração de banco relacional que dá errado costuma gritar: a consulta quebra, a transação estoura, a aplicação devolve quinhentos e o alerta dispara. Uma migração de índice de busca que dá errado devolve duzentos com uma lista curta. O contrato da busca é uma lista de resultados ordenada, e uma lista com menos itens, ou com os itens na ordem errada, é indistinguível de uma busca que simplesmente não tinha muito a oferecer.',
        },
        {
          type: 'paragraph',
          value:
            'Isso muda tudo no desenho da migração. Não existe um erro para monitorar, então a validação precisa ser comparativa por construção: o índice novo só pode ser julgado contra o antigo, consulta a consulta, e não contra um limiar absoluto. O painel de erros vai ficar verde durante um incidente de busca inteiro, e o primeiro sinal real costuma vir de fora da engenharia, em forma de queda de conversão, de aumento de busca sem clique ou de chamado de cliente dizendo que um produto sumiu.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo motivo é que o índice não é uma cópia dos dados: é uma interpretação deles. Entre a linha do banco e o documento indexado existe um pipeline com tokenização, remoção de acento, radicalização, sinônimo, decomposição de palavra composta, campo copiado e peso por campo. Dois motores com o mesmo conteúdo produzem resultados diferentes porque interpretam o texto de forma diferente, e é por isso que a pergunta certa nunca é se os dados chegaram inteiros, e sim se as respostas continuam boas.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Migração de banco', 'Migração de índice de busca'],
          rows: [
            [
              'Sinal de falha',
              'Erro explícito, exceção, transação recusada',
              'Resposta válida com a lista errada, sem erro',
            ],
            [
              'Fonte de verdade',
              'O próprio banco, que é a origem',
              'Outro sistema: o índice é sempre derivado',
            ],
            [
              'Validação possível',
              'Contagem e soma de verificação por tabela',
              'Comparação de listas ordenadas por consulta real',
            ],
            [
              'Custo da reversão',
              'Alto: o dado novo já foi escrito no destino',
              'Baixo: basta reapontar a leitura, o índice é reconstruível',
            ],
            [
              'Tempo de reconstrução',
              'Não se aplica, o dado é a origem',
              'Horas a dias, e define o tamanho da janela de repetição',
            ],
            [
              'Quem percebe primeiro',
              'O alerta de erro da aplicação',
              'O negócio, pela queda de conversão',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha é a boa notícia dessa migração e a razão pela qual ela pode ser feita sem janela. O índice é derivado, então manter dois ao mesmo tempo não cria duas fontes de verdade: cria duas interpretações da mesma fonte, e qualquer uma pode ser descartada e reconstruída sem perda. É a propriedade que torna a leitura sombra segura e a reversão barata, e é justamente ela que a janela de manutenção desperdiça.',
        },
      ],
    },
    {
      title: 'Índice paralelo e repetição de escrita: eliminar a janela',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O problema real da reindexação não é o volume, é que o catálogo continua mudando enquanto ela roda. Uma carga completa que leva oito horas é uma fotografia do instante inicial, e ao terminar já está oito horas desatualizada. Preencher esse buraco depois, com uma consulta por data de atualização, funciona mal: depende de relógio confiável, perde a exclusão de documento e ignora alteração feita por rotina que não toca o campo de data.',
        },
        {
          type: 'paragraph',
          value:
            'A solução é inverter a ordem. Primeiro liga a repetição de escrita no índice novo, depois começa a carga histórica. Toda alteração que acontece durante a carga já é aplicada nos dois índices, e a carga histórica preenche o passado por baixo. Como a escrita é idempotente por identificador de documento, a ordem entre a carga e a repetição não importa desde que a repetição use número de versão: um documento sobrescrito pela carga com uma versão mais antiga é descartado.',
        },
        {
          type: 'diagram',
          value: `Fase 1 - so o indice antigo
  aplicacao --escrita--> [INDICE ANTIGO] <--consulta-- aplicacao

Fase 2 - escrita dupla ligada, ainda sem carga historica
  aplicacao --escrita--+--> [INDICE ANTIGO] <--consulta-- aplicacao
                       \\--> [INDICE NOVO]   (so deltas, vazio no passado)
  verificacao: taxa de erro da escrita nova isolada, 0 impacto no caminho critico

Fase 3 - carga historica por baixo, com escrita dupla ligada
  carregador --lote--> [INDICE NOVO] <--delta-- aplicacao
  regra: escrita so aplica se versao maior que a ja indexada
  verificacao: progresso por faixa de chave, nao por contagem total

Fase 4 - leitura sombra (consulta vai nos dois, responde o antigo)
  aplicacao --consulta--+--> [INDICE ANTIGO] --> resposta ao usuario
                        \\--> [INDICE NOVO]   --> so comparacao, descartado
  verificacao: sobreposicao das listas, latencia, ausencia de resultado vazio

Fase 5 - leitura percentual (1% -> 10% -> 50% -> 100%)
  aplicacao --1%--> [INDICE NOVO]   --> resposta ao usuario
            -99%--> [INDICE ANTIGO] --> resposta ao usuario
  verificacao: taxa de clique e busca sem clique por rota

Fase 6 - desligar
  aplicacao --escrita+consulta--> [INDICE NOVO]
  o indice antigo fica recebendo escrita, sem consulta, por um ciclo inteiro`,
        },
        {
          type: 'paragraph',
          value:
            'A fase dois parece inútil e é a que mais salva a migração. Ela não move leitura nenhuma: serve para provar que a escrita no motor novo funciona sob tráfego real, com o formato real dos documentos, incluindo aquele campo que só um fluxo raro preenche. Descobrir um mapeamento incompatível com zero leitura dependendo dele custa uma tarde. Descobrir depois de já ter migrado metade da leitura custa um incidente.',
        },
        {
          type: 'paragraph',
          value:
            'A escrita dupla precisa de uma regra clara sobre falha: o índice novo nunca pode derrubar a escrita principal. Enquanto ele não é fonte de leitura, a falha ali é registrada numa fila de reparo e não propagada. Depois que ele vira fonte de leitura, os papéis se invertem e o antigo passa a ser o lado tolerante. A escrita que falha silenciosamente e não vai para fila nenhuma é o defeito que produz divergência permanente, e é o mais comum dos três.',
        },
        {
          type: 'code',
          value: `// Escrita dupla com versao e fila de reparo. O indice secundario nunca
// derruba a escrita principal: a falha vira item de reparo, nao excecao.
const PAPEIS = { PRIMARIO: 'primario', SECUNDARIO: 'secundario' };

// Configuracao dinamica: a troca de papel precisa valer sem reimplantacao,
// senao a reversao deixa de ser imediata.
const papelDe = (motor) => configuracao.get(\`busca.papel.\${motor.nome}\`, PAPEIS.SECUNDARIO);

async function indexarDocumento(documento) {
  // A versao vem da origem, nao do relogio local. Relogio entre processos
  // diverge e faz a carga historica sobrescrever delta mais novo.
  const payload = {
    id: documento.id,
    versao: documento.atualizadoEmSequencia,
    corpo: montarDocumento(documento),
  };

  const resultados = await Promise.allSettled(
    motoresAtivos().map((motor) => escreverComVersao(motor, payload)),
  );

  const falhas = resultados
    .map((resultado, indice) => ({ resultado, motor: motoresAtivos()[indice] }))
    .filter(({ resultado }) => resultado.status === 'rejected');

  for (const { motor, resultado } of falhas) {
    // Sempre enfileira para reparo, inclusive quando vai relancar:
    // o reparo e o que garante convergencia se a nova tentativa falhar.
    await filaDeReparo.enfileirar({
      motor: motor.nome,
      documentoId: documento.id,
      versao: payload.versao,
      erro: String(resultado.reason),
    });

    if (papelDe(motor) === PAPEIS.PRIMARIO) throw resultado.reason;
  }

  return { indexadoEm: motoresAtivos().length - falhas.length };
}

// escreverComVersao usa o controle de concorrencia do proprio motor:
// a escrita e recusada quando a versao enviada e menor que a indexada,
// e essa recusa e sucesso, nao erro.
async function escreverComVersao(motor, payload) {
  try {
    return await motor.index(payload, { ifVersionGreaterThan: payload.versao - 1 });
  } catch (erro) {
    if (erro.code === 'version_conflict') return { ignorado: true };
    throw erro;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'O tratamento do conflito de versão no fim é o detalhe que separa uma escrita dupla correta de uma que corrompe dados devagar. Durante a carga histórica, conflito de versão é o comportamento esperado e frequente: significa que um delta mais novo já chegou e a carga tentou sobrescrever com a foto antiga. Tratar isso como erro enche a fila de reparo de lixo e esconde as falhas reais. Tratar como sucesso ignorado é o que faz a convergência acontecer sozinha.',
        },
      ],
    },
    {
      title: 'A verificação de contagem aprova índice quebrado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A checagem que quase todo time faz é comparar o número de documentos dos dois índices. Ela é necessária e insuficiente: pega o caso em que a carga parou no meio e não pega nenhum dos outros. Um índice com o número exato de documentos pode ter perdido o campo de descrição, ter analisador diferente no campo de título, ter perdido os sinônimos ou ter pesos diferentes entre campos, e a contagem vai bater em todos esses casos.',
        },
        {
          type: 'table',
          columns: ['Defeito', 'Contagem bate?', 'O que realmente acontece', 'Verificação que pega'],
          rows: [
            [
              'Carga interrompida no meio',
              'Não',
              'Faltam documentos inteiros',
              'Contagem por faixa de chave',
            ],
            [
              'Campo não mapeado',
              'Sim',
              'Busca pelo termo daquele campo devolve vazio',
              'Consulta por campo com resultado esperado',
            ],
            [
              'Analisador diferente',
              'Sim',
              'Acento, plural ou composto param de casar',
              'Conjunto de consultas com variação ortográfica',
            ],
            [
              'Sinônimo não migrado',
              'Sim',
              'Termo comercial deixa de encontrar o produto',
              'Consultas do topo da cauda com sinônimo conhecido',
            ],
            [
              'Peso de campo diferente',
              'Sim',
              'Ordem muda, o item certo cai para a página dois',
              'Sobreposição de lista nas dez primeiras posições',
            ],
            [
              'Filtro com tipo diferente',
              'Sim',
              'Faceta some ou filtra errado por texto e número',
              'Consulta com filtro comparada lado a lado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A verificação que substitui a contagem é a reprodução do tráfego real de consulta contra os dois índices. Não um conjunto inventado de vinte consultas bonitas: as consultas que os usuários realmente fizeram na última semana, com a distribuição real, incluindo a cauda longa de termos digitados errado, que é onde os analisadores divergem. Duas mil consultas amostradas da cauda encontram mais defeitos que duzentas consultas populares, porque as populares casam por qualquer caminho.',
        },
        {
          type: 'code',
          value: `// Comparador de listas ordenadas. Mede sobreposicao no topo e deslocamento
// de posicao, que sao as duas formas de a relevancia piorar sem erro nenhum.
const K_TOPO = 10;

const sobreposicaoNoTopo = (listaA, listaB, k = K_TOPO) => {
  const topoA = listaA.slice(0, k).map((item) => item.id);
  const topoB = new Set(listaB.slice(0, k).map((item) => item.id));
  const comuns = topoA.filter((id) => topoB.has(id)).length;
  return comuns / k;
};

// Deslocamento medio: para cada item do topo antigo, quantas posicoes ele
// andou no novo. Item que sumiu conta como se tivesse ido para o fim.
const deslocamentoMedio = (listaA, listaB, k = K_TOPO) => {
  const posicaoEm = new Map(listaB.map((item, indice) => [item.id, indice]));
  const penalidade = listaB.length || k * 10;

  const desvios = listaA.slice(0, k).map((item, indice) => {
    const posicaoNova = posicaoEm.has(item.id) ? posicaoEm.get(item.id) : penalidade;
    return Math.abs(posicaoNova - indice);
  });

  return desvios.reduce((soma, valor) => soma + valor, 0) / (desvios.length || 1);
};

async function compararTrafego(consultasAmostradas) {
  const relatorio = [];

  for (const consulta of consultasAmostradas) {
    const [antigo, novo] = await Promise.all([
      motorAntigo.buscar(consulta),
      motorNovo.buscar(consulta),
    ]);

    relatorio.push({
      termo: consulta.termo,
      sobreposicao: sobreposicaoNoTopo(antigo.itens, novo.itens),
      deslocamento: deslocamentoMedio(antigo.itens, novo.itens),
      // Queda brusca de total e o sinal de campo faltando no mapeamento.
      razaoDeTotal: novo.total / Math.max(antigo.total, 1),
      vazioApenasNoNovo: antigo.total > 0 && novo.total === 0,
    });
  }

  // Ordena pelo pior caso: esses sao os defeitos, nao a media.
  return relatorio.sort((a, b) => a.sobreposicao - b.sobreposicao);
}`,
        },
        {
          type: 'paragraph',
          value:
            'A última linha da função é a mais importante do método. A média de sobreposição vai parecer ótima mesmo com um defeito grave, porque noventa e cinco por cento das consultas atravessam qualquer mapeamento razoável. O que revela o problema é a ponta de baixo: as cinquenta consultas com pior sobreposição, lidas uma a uma. Quase sempre elas têm uma característica em comum, e essa característica é exatamente o defeito, seja o acento, o hífen, o número no meio do termo ou o campo que ninguém mapeou.',
        },
        {
          type: 'paragraph',
          value:
            'O campo vazioApenasNoNovo merece alerta próprio, com limiar em zero. Uma consulta que devolvia resultado no índice antigo e devolve lista vazia no novo é sempre defeito, nunca melhoria, e é a falha de maior impacto comercial porque produz a página de nenhum resultado para um usuário que estava pronto para comprar. Nenhuma migração deveria avançar de degrau com esse contador acima de zero.',
        },
      ],
    },
    {
      title: 'Leitura sombra e a decisão que ela não resolve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A leitura sombra consulta os dois índices para cada busca real, responde ao usuário com o índice antigo e usa o resultado do novo apenas para comparação. Ela é a forma mais barata de validar com tráfego real, e tem uma limitação que precisa ser dita com clareza: ela mede concordância, não qualidade. Se o índice novo discorda do antigo, a sombra mostra que discorda, mas não diz qual dos dois está certo.',
        },
        {
          type: 'paragraph',
          value:
            'Isso importa porque quase sempre se troca de motor esperando relevância melhor, e relevância melhor é discordância por definição. Um índice novo com noventa e cinco por cento de sobreposição no topo não melhorou nada relevante. Um com setenta por cento pode ter melhorado ou piorado, e a sombra sozinha não decide. A separação prática é entre discordância explicável e discordância inexplicável: se você consegue apontar a mudança de configuração que causa a diferença e ela era intencional, é evolução. Se não consegue, é defeito até prova em contrário.',
        },
        {
          type: 'ordered',
          items: [
            'Custo em latência. A sombra dobra a consulta e, se for feita em série no caminho da resposta, dobra o tempo percebido. A chamada ao índice novo precisa ser disparada sem espera, com limite de tempo agressivo e sem propagar erro, porque uma falha no caminho de comparação nunca pode aparecer para o usuário.',
            'Custo em amostragem. Nem toda consulta precisa de sombra. Cinco a dez por cento do tráfego, amostrado de forma estável por termo, já produz volume suficiente e mantém o custo de infraestrutura sob controle. Amostrar por usuário em vez de por consulta é pior, porque concentra a amostra nos termos de quem busca muito.',
            'Custo em interpretação. O relatório precisa de dono e de horário, senão vira painel que ninguém abre. A leitura das cinquenta piores consultas, feita por uma pessoa, uma vez por dia durante a migração, encontra mais defeito que qualquer limiar automático, porque a maioria dos defeitos tem um padrão visível a olho nu.',
            'Limite do método. A sombra não mede comportamento do usuário. Para saber se a relevância nova é melhor, é preciso tráfego real com resposta real, o que só acontece a partir da leitura percentual, medindo taxa de clique, posição do primeiro clique e busca sem clique por rota.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro item é o que decide entre uma migração de busca boa e uma medíocre, e é o menos automatizável dos quatro. As ferramentas encontram a discordância; a pessoa encontra o motivo. Meia hora por dia lendo as piores consultas, durante uma migração de duas semanas, custa cinco horas de trabalho e costuma evitar o incidente inteiro.',
        },
      ],
    },
    {
      title: 'A sequência de sete etapas com a consulta ligada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A sequência abaixo vale tanto para troca de motor quanto para mudança grande de mapeamento dentro do mesmo motor, que tem exatamente os mesmos riscos. Cada etapa tem critério de saída objetivo, e nenhuma avança por data: todas avançam por indicador.',
        },
        {
          type: 'ordered',
          items: [
            'Torne a indexação idempotente e versionada. Escrita por identificador de documento com número de versão vindo da origem, nunca do relógio local. Critério de saída: reindexar o mesmo documento cinco vezes, em ordens diferentes, produz sempre o mesmo documento final.',
            'Ligue a escrita dupla sem leitura nenhuma no índice novo. Fila de reparo ativa, alerta de atraso da fila configurado, zero impacto na latência de escrita do caminho principal. Critério de saída: vinte e quatro horas com fila de reparo drenando e escrita principal sem regressão de latência.',
            'Rode a carga histórica por faixa de chave, não em lote único. Faixas permitem retomar de onde parou, paralelizar com controle e medir progresso real. Critério de saída: contagem por faixa igual entre os dois índices, com tolerância explícita para documentos criados durante a carga.',
            'Ligue a leitura sombra em cinco por cento do tráfego. Comparação por consulta com sobreposição no topo, deslocamento e detecção de vazio exclusivo. Critério de saída: zero consultas com vazio exclusivo no novo, e as cinquenta piores lidas e explicadas uma a uma.',
            'Migre a leitura em degraus, começando em um por cento. Um por cento é baixo de propósito: a primeira exposição real encontra problemas de infraestrutura, como limite de conexões, cache frio e tempo de resposta sob concorrência, que a sombra não encontra. Critério de saída: latência no percentil noventa e cinco igual ou melhor, e taxa de clique dentro do intervalo do índice antigo.',
            'Avance para dez, cinquenta e cem por cento com pelo menos um ciclo diário completo em cada degrau. O tráfego de busca tem sazonalidade forte dentro do dia, e um degrau validado só no horário calmo não prova nada sobre o pico. Critério de saída: mesmo conjunto de indicadores estável durante o pico de cada degrau.',
            'Mantenha a escrita dupla e o índice antigo por um ciclo completo depois dos cem por cento. Ele é o caminho de volta imediato e o comparador para qualquer dúvida de relevância que aparecer depois. Critério de saída: uma semana em cem por cento sem regressão de negócio, e então desligue primeiro a escrita dupla, depois o índice.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A etapa cinco merece atenção porque é onde a maioria das surpresas aparece, e nenhuma delas é de relevância. O motor novo geralmente é validado em consulta isolada e falha em concorrência: o cache de filtro que estava quente no antigo está frio no novo, o agrupamento por faceta que custava dez milissegundos com cache custa duzentos sem, e o número de conexões simultâneas estoura no primeiro pico. Um por cento é o degrau que transforma essas descobertas em ajuste de configuração em vez de incidente.',
        },
        {
          type: 'paragraph',
          value:
            'A ordem de desligamento da etapa sete não é detalhe. Desligar o índice antigo antes da escrita dupla deixa a escrita falhando contra um destino que não existe, enchendo a fila de reparo de erro permanente e possivelmente degradando o caminho principal. Desligar a escrita dupla primeiro, esperar o ciclo e só então desprovisionar o índice mantém o caminho de volta disponível até o último momento em que ele ainda seria útil.',
        },
      ],
    },
    {
      title: 'Os indicadores que autorizam desligar o índice antigo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O desligamento é a única etapa irreversível, porque reconstruir o índice antigo depois significa rodar a carga histórica de novo, contra um motor que já foi desprovisionado, com a configuração que ninguém mais mantém. Os indicadores abaixo transformam essa decisão em verificação.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'O que mede', 'Critério para desligar', 'O que ele pega'],
          rows: [
            [
              'Busca sem clique',
              'Fração de buscas sem nenhum clique no resultado',
              'Dentro do intervalo histórico por sete dias em cem por cento',
              'Relevância pior que não gera erro nenhum',
            ],
            [
              'Resultado vazio por termo conhecido',
              'Termos com tráfego que passaram a devolver lista vazia',
              'Zero, medido sobre a cauda e não só sobre os populares',
              'Campo não mapeado ou analisador divergente',
            ],
            [
              'Atraso da fila de reparo',
              'Idade do item mais antigo pendente de reindexação',
              'Estável e abaixo do acordo de atualização do catálogo',
              'Escrita dupla falhando em silêncio para um subconjunto',
            ],
            [
              'Divergência por amostragem',
              'Documentos comparados entre origem e índice, por amostra',
              'Abaixo do limiar por um ciclo completo de atualização',
              'Documento que ficou preso numa versão antiga',
            ],
            [
              'Cobertura de fluxos de escrita',
              'Fluxos distintos que indexaram no período',
              'Todos presentes, incluindo rotinas mensais e importações',
              'Fluxo raro que só escreve no índice antigo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O último indicador é o que mais evita incidente pós-desligamento, e é o mais esquecido. Catálogos reais têm fluxos de escrita que rodam uma vez por mês, como a importação de fornecedor, o ajuste de preço em lote ou a correção manual feita por uma tela administrativa antiga. Se esse fluxo escreve direto no índice antigo, sem passar pela camada de escrita dupla, ele funciona durante toda a migração e quebra no dia do desligamento. Medir fluxos distintos, e não volume de escrita, é o que revela o fluxo que escreve cem documentos por mês com o mesmo peso do que escreve um milhão por dia.',
        },
        {
          type: 'paragraph',
          value:
            'O primeiro indicador precisa de uma ressalva honesta: busca sem clique é um sinal ruidoso e influenciado por sazonalidade, campanha e mudança de catálogo. Ele não serve como gatilho automático, serve como condição de bloqueio. Se estiver fora do intervalo, não desligue e investigue. Se estiver dentro, ele não prova que a relevância melhorou, apenas que não piorou de forma detectável, e essa é exatamente a garantia que uma migração de infraestrutura precisa dar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Dá para pular a leitura sombra e ir direto para um por cento do tráfego real, já que a sombra não decide qual índice é melhor?',
      answer:
        'Dá, e em times pequenos com catálogo simples essa é uma escolha defensável, desde que fique claro o que se está trocando. A sombra encontra defeitos categóricos, do tipo que afeta uma classe inteira de consultas, e encontra antes de qualquer usuário ver. Pular a sombra significa que esses defeitos serão descobertos por usuários reais, e em um por cento do tráfego isso é aceitável em volume mas não em natureza: se o defeito for um campo não mapeado, o um por cento dos usuários que buscou por aquele termo recebeu página vazia, e você só vai saber pelo contador de resultado vazio depois do fato. O caminho intermediário que costuma valer mais a pena é rodar a sombra fora do caminho de resposta, em lote, sobre as consultas gravadas da semana anterior, em vez de em tempo real. Isso custa uma execução noturna, não altera latência nenhuma, não exige código no caminho crítico e encontra a mesma classe de defeitos. Perde-se a comparação sob concorrência real, mas essa nunca foi a força da sombra e sim do degrau de um por cento. Para catálogo com mais de alguns milhares de documentos, ou quando a busca é fonte relevante de receita, a comparação em lote é o mínimo que eu recomendaria antes de expor qualquer tráfego.',
    },
    {
      question: 'Como migrar sem escrita dupla quando o índice é alimentado por um pipeline de dados que eu não controlo?',
      answer:
        'A escrita dupla na aplicação é o caminho mais limpo, mas não é o único, e quando a indexação vem de um pipeline de terceiros ou de uma ferramenta de integração fechada existem duas alternativas boas. A primeira é a bifurcação no transporte: se o pipeline publica num tópico ou numa fila antes de indexar, basta adicionar um segundo consumidor que escreve no índice novo, e você ganha a escrita dupla sem tocar no pipeline. Essa é a opção preferida sempre que existe um ponto de mensageria no caminho, porque o novo consumidor é isolado, tem métrica própria e pode ser desligado sem afetar nada. A segunda é a captura de alteração na origem, lendo o registro de alterações do banco e alimentando o índice novo a partir dele. Custa mais para montar, mas tem uma vantagem real: não depende do pipeline estar correto, o que significa que ela também valida o pipeline antigo e às vezes revela que o índice atual já estava divergindo da origem havia meses. A opção que eu evitaria é a sincronização periódica por data de atualização, porque ela não captura exclusão, depende de relógio e perde qualquer alteração feita por rotina que não atualize o campo de data. Se ela for a única possível, compense com uma reconciliação completa por amostragem rodando em paralelo, e trate a divergência encontrada como medida do erro do método, não como exceção.',
    },
    {
      question: 'Quanto tempo devo manter o índice antigo ligado depois de chegar a cem por cento, e o que exatamente estou pagando por isso?',
      answer:
        'A regra prática que funciona é manter por um ciclo completo de negócio, e para a maioria dos catálogos isso significa um mês, não uma semana. O motivo é o fluxo de escrita raro: a importação mensal de fornecedor, o fechamento que reprecifica categorias inteiras, a campanha sazonal que cria atributo novo. Nenhum desses aparece numa janela de sete dias, e todos podem quebrar no índice novo de um jeito que só se percebe quando já não existe comparador. O custo real é menor do que parece. O índice antigo sem tráfego de consulta consome quase só armazenamento e a escrita dupla, e escrita costuma ser uma fração pequena do custo comparada à consulta, que é o que exige memória e processador. Na prática, manter o antigo por um mês adiciona algo entre dez e vinte por cento ao custo do subsistema de busca durante esse período, o que é barato perto de reconstruir tudo sob pressão. Existe um custo não financeiro que importa mais: enquanto os dois índices existem, toda investigação começa perguntando qual deles respondeu, e todo ajuste de relevância precisa ser feito em dois lugares ou explicitamente em um só. Por isso a decisão deve vir com data marcada desde o início. Índice antigo sem data de desligamento vira permanente, e três meses depois ninguém lembra se ele ainda recebe escrita.',
    },
  ],
  conclusion: {
    title: 'Trocar o motor de busca é migrar relevância, não documentos',
    description:
      'A migração de busca raramente falha por perda de dado: falha porque um analisador diferente quebrou uma classe de consultas, porque um campo não mapeado passou a devolver lista vazia, ou porque o índice antigo foi desligado antes da importação mensal provar que o fluxo dela foi migrado. Posso revisar a sua camada de busca e definir o desenho de escrita dupla com versão e fila de reparo, a carga histórica por faixa de chave que convive com o tráfego, a comparação de listas ordenadas sobre o tráfego real de consulta, a sequência de degraus reversível em qualquer ponto e os indicadores que autorizam desligar o índice antigo.',
    cta: 'Falar sobre a migração de busca do meu sistema',
  },
  related: [
    {
      label: 'Migração de banco sem janela: expandir, migrar, contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Migrar embeddings sem reindexar tudo de uma vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'The reindex started on a Thursday at nine in the evening with a promise of two hours, and by six in the morning forty percent of the catalog was still missing. The team pointed search at the new index anyway, because traffic would climb at eight. That day a search for "white sneakers" returned three hundred results instead of eleven thousand, nobody noticed for three hours because the page threw no error at all, and search revenue dropped nineteen percent before anyone connected the two. This article shows why swapping a search engine fails in a silent way that a database swap does not, how a parallel index plus write replication remove the maintenance window, why document count validation approves broken indexes and what replaces it, why relevance changes even when the data is correct and how to compare two ranked lists without relying on opinion, which seven stage sequence swaps the engine with queries running and reverts at any point, and which indicators authorize switching the old index off.',
  sections: [
    {
      title: 'Why a search swap fails silently',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A relational database migration that goes wrong tends to shout: the query breaks, the transaction blows up, the application returns a five hundred and the alert fires. A search index migration that goes wrong returns a two hundred with a short list. The contract of search is a ranked list of results, and a list with fewer items, or with the items in the wrong order, is indistinguishable from a search that simply had little to offer.',
        },
        {
          type: 'paragraph',
          value:
            'That changes everything about how the migration is designed. There is no error to monitor, so validation has to be comparative by construction: the new index can only be judged against the old one, query by query, never against an absolute threshold. The error dashboard will stay green through an entire search incident, and the first real signal usually comes from outside engineering, as a conversion drop, a rise in searches without clicks or a customer ticket saying a product disappeared.',
        },
        {
          type: 'paragraph',
          value:
            'The second reason is that an index is not a copy of the data: it is an interpretation of it. Between the database row and the indexed document sits a pipeline with tokenization, accent folding, stemming, synonyms, compound splitting, copied fields and per field weights. Two engines holding the same content produce different results because they read the text differently, which is why the right question is never whether the data arrived intact, but whether the answers are still good.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Database migration', 'Search index migration'],
          rows: [
            [
              'Failure signal',
              'Explicit error, exception, rejected transaction',
              'Valid response with the wrong list, no error',
            ],
            [
              'Source of truth',
              'The database itself, which is the origin',
              'Another system: the index is always derived',
            ],
            [
              'Possible validation',
              'Row counts and checksums per table',
              'Comparison of ranked lists over real queries',
            ],
            [
              'Reversal cost',
              'High: new data has already been written to the target',
              'Low: repoint the read, the index is rebuildable',
            ],
            [
              'Rebuild time',
              'Not applicable, the data is the origin',
              'Hours to days, and it sets the replication window size',
            ],
            [
              'Who notices first',
              'The application error alert',
              'The business, through the conversion drop',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row is the good news of this migration and the reason it can be done without a window. The index is derived, so keeping two at once does not create two sources of truth: it creates two interpretations of the same source, and either one can be discarded and rebuilt without loss. That is the property that makes shadow reads safe and reversal cheap, and it is exactly what a maintenance window throws away.',
        },
      ],
    },
    {
      title: 'Parallel index and write replication: removing the window',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The real problem with a reindex is not volume, it is that the catalog keeps changing while it runs. A full load that takes eight hours is a photograph of the starting instant, and by the time it finishes it is already eight hours stale. Filling that gap afterwards with a query by updated timestamp works poorly: it depends on a trustworthy clock, misses document deletions and ignores changes made by jobs that do not touch the timestamp field.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to invert the order. First turn on write replication into the new index, then start the historical load. Every change that happens during the load is already applied to both indexes, and the historical load fills in the past underneath. Because writes are idempotent by document identifier, the order between load and replication does not matter as long as replication carries a version number: a document overwritten by the load with an older version is rejected.',
        },
        {
          type: 'diagram',
          value: `Phase 1 - old index only
  application --write--> [OLD INDEX] <--query-- application

Phase 2 - dual write on, no historical load yet
  application --write--+--> [OLD INDEX] <--query-- application
                       \\--> [NEW INDEX]  (deltas only, empty in the past)
  check: new write error rate isolated, 0 impact on the critical path

Phase 3 - historical load underneath, dual write still on
  loader --batch--> [NEW INDEX] <--delta-- application
  rule: a write only applies if its version beats the indexed one
  check: progress per key range, not per total count

Phase 4 - shadow read (query hits both, the old one answers)
  application --query--+--> [OLD INDEX] --> response to the user
                       \\--> [NEW INDEX] --> comparison only, discarded
  check: list overlap, latency, absence of empty results

Phase 5 - percentage read (1% -> 10% -> 50% -> 100%)
  application --1%--> [NEW INDEX] --> response to the user
              -99%--> [OLD INDEX] --> response to the user
  check: click through rate and no click searches per route

Phase 6 - switch off
  application --write+query--> [NEW INDEX]
  the old index keeps receiving writes, with no queries, for a full cycle`,
        },
        {
          type: 'paragraph',
          value:
            'Phase two looks useless and is the one that saves the migration most often. It moves no reads at all: it exists to prove that writing into the new engine works under real traffic, with the real document shape, including that field only one rare flow ever populates. Discovering an incompatible mapping with zero reads depending on it costs an afternoon. Discovering it after half the reads have moved costs an incident.',
        },
        {
          type: 'paragraph',
          value:
            'Dual writing needs a clear rule about failure: the new index must never take down the primary write. While it is not a read source, a failure there is recorded in a repair queue and not propagated. Once it becomes the read source, the roles invert and the old one becomes the tolerant side. A write that fails silently and lands in no queue is the defect that produces permanent divergence, and it is the most common of the three.',
        },
        {
          type: 'code',
          value: `// Dual write with versioning and a repair queue. The secondary index never
// takes down the primary write: a failure becomes a repair item, not an error.
const ROLES = { PRIMARY: 'primary', SECONDARY: 'secondary' };

// Dynamic configuration: swapping roles must take effect without a redeploy,
// otherwise reversal stops being immediate.
const roleOf = (engine) => configuration.get(\`search.role.\${engine.name}\`, ROLES.SECONDARY);

async function indexDocument(document) {
  // The version comes from the origin, not the local clock. Clocks across
  // processes drift and let the historical load overwrite a newer delta.
  const payload = {
    id: document.id,
    version: document.updatedAtSequence,
    body: buildDocument(document),
  };

  const results = await Promise.allSettled(
    activeEngines().map((engine) => writeWithVersion(engine, payload)),
  );

  const failures = results
    .map((result, index) => ({ result, engine: activeEngines()[index] }))
    .filter(({ result }) => result.status === 'rejected');

  for (const { engine, result } of failures) {
    // Always enqueue for repair, even when about to rethrow: the repair
    // queue is what guarantees convergence if the retry also fails.
    await repairQueue.enqueue({
      engine: engine.name,
      documentId: document.id,
      version: payload.version,
      error: String(result.reason),
    });

    if (roleOf(engine) === ROLES.PRIMARY) throw result.reason;
  }

  return { indexedIn: activeEngines().length - failures.length };
}

// writeWithVersion relies on the engine's own concurrency control: the write
// is refused when the submitted version is lower than the indexed one, and
// that refusal is a success, not an error.
async function writeWithVersion(engine, payload) {
  try {
    return await engine.index(payload, { ifVersionGreaterThan: payload.version - 1 });
  } catch (error) {
    if (error.code === 'version_conflict') return { skipped: true };
    throw error;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The version conflict handling at the end is the detail that separates a correct dual write from one that corrupts data slowly. During the historical load, a version conflict is the expected and frequent behavior: it means a newer delta already arrived and the load tried to overwrite it with the old snapshot. Treating that as an error fills the repair queue with noise and hides the real failures. Treating it as a skipped success is what makes convergence happen on its own.',
        },
      ],
    },
    {
      title: 'Count validation approves broken indexes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The check almost every team runs is comparing document counts across both indexes. It is necessary and insufficient: it catches the case where the load stopped midway and catches none of the others. An index with the exact document count can have lost the description field, have a different analyzer on the title field, have lost its synonyms or carry different field weights, and the count will match in all of those cases.',
        },
        {
          type: 'table',
          columns: ['Defect', 'Count matches?', 'What actually happens', 'Check that catches it'],
          rows: [
            [
              'Load interrupted midway',
              'No',
              'Whole documents are missing',
              'Count per key range',
            ],
            [
              'Unmapped field',
              'Yes',
              'Searching by that field returns empty',
              'Field query with an expected result',
            ],
            [
              'Different analyzer',
              'Yes',
              'Accents, plurals or compounds stop matching',
              'Query set with spelling variation',
            ],
            [
              'Synonyms not migrated',
              'Yes',
              'A commercial term stops finding the product',
              'Head of tail queries with known synonyms',
            ],
            [
              'Different field weights',
              'Yes',
              'Order changes, the right item drops to page two',
              'List overlap over the top ten positions',
            ],
            [
              'Filter with a different type',
              'Yes',
              'Facets vanish or filter wrongly across text and number',
              'Filtered query compared side by side',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'What replaces the count is replaying real query traffic against both indexes. Not an invented set of twenty pretty queries: the queries users actually ran last week, with their real distribution, including the long tail of misspelled terms, which is where analyzers diverge. Two thousand queries sampled from the tail find more defects than two hundred popular ones, because popular queries match through any path.',
        },
        {
          type: 'code',
          value: `// Ranked list comparator. It measures top overlap and position drift, the two
// ways relevance can get worse without producing a single error.
const TOP_K = 10;

const topOverlap = (listA, listB, k = TOP_K) => {
  const topA = listA.slice(0, k).map((item) => item.id);
  const topB = new Set(listB.slice(0, k).map((item) => item.id));
  const shared = topA.filter((id) => topB.has(id)).length;
  return shared / k;
};

// Average drift: for each item in the old top, how many positions it moved in
// the new one. An item that vanished counts as if it went to the very end.
const averageDrift = (listA, listB, k = TOP_K) => {
  const positionIn = new Map(listB.map((item, index) => [item.id, index]));
  const penalty = listB.length || k * 10;

  const deviations = listA.slice(0, k).map((item, index) => {
    const newPosition = positionIn.has(item.id) ? positionIn.get(item.id) : penalty;
    return Math.abs(newPosition - index);
  });

  return deviations.reduce((sum, value) => sum + value, 0) / (deviations.length || 1);
};

async function compareTraffic(sampledQueries) {
  const report = [];

  for (const query of sampledQueries) {
    const [old, next] = await Promise.all([
      oldEngine.search(query),
      newEngine.search(query),
    ]);

    report.push({
      term: query.term,
      overlap: topOverlap(old.items, next.items),
      drift: averageDrift(old.items, next.items),
      // A sharp drop in totals is the signature of a missing field mapping.
      totalRatio: next.total / Math.max(old.total, 1),
      emptyOnlyInNew: old.total > 0 && next.total === 0,
    });
  }

  // Sort by worst case: those are the defects, not the average.
  return report.sort((a, b) => a.overlap - b.overlap);
}`,
        },
        {
          type: 'paragraph',
          value:
            'The last line of the function is the most important part of the method. Average overlap will look excellent even with a serious defect, because ninety five percent of queries survive any reasonable mapping. What exposes the problem is the bottom tail: the fifty queries with the worst overlap, read one by one. They almost always share a characteristic, and that characteristic is exactly the defect, whether it is the accent, the hyphen, the digit in the middle of the term or the field nobody mapped.',
        },
        {
          type: 'paragraph',
          value:
            'The emptyOnlyInNew field deserves its own alert with a threshold of zero. A query that returned results in the old index and returns an empty list in the new one is always a defect, never an improvement, and it is the failure with the largest commercial impact because it produces a no results page for a user who was ready to buy. No migration should move to the next step with that counter above zero.',
        },
      ],
    },
    {
      title: 'Shadow reads and the decision they do not settle',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A shadow read queries both indexes for every real search, answers the user from the old index and uses the new result only for comparison. It is the cheapest way to validate against real traffic, and it has a limitation that has to be stated plainly: it measures agreement, not quality. If the new index disagrees with the old one, the shadow shows the disagreement but does not say which one is right.',
        },
        {
          type: 'paragraph',
          value:
            'That matters because engines are almost always swapped expecting better relevance, and better relevance is disagreement by definition. A new index with ninety five percent top overlap has improved nothing meaningful. One with seventy percent may have improved or degraded, and the shadow alone does not decide. The practical split is between explainable and unexplainable disagreement: if you can point to the configuration change that causes the difference and it was intentional, it is evolution. If you cannot, it is a defect until proven otherwise.',
        },
        {
          type: 'ordered',
          items: [
            'Latency cost. The shadow doubles the query, and if it runs serially in the response path it doubles perceived time. The call to the new index must be fired without waiting, with an aggressive timeout and no error propagation, because a failure in the comparison path must never reach the user.',
            'Sampling cost. Not every query needs a shadow. Five to ten percent of traffic, sampled stably by term, already produces enough volume and keeps infrastructure cost under control. Sampling by user instead of by query is worse, because it concentrates the sample on the terms of people who search a lot.',
            'Interpretation cost. The report needs an owner and a time slot, otherwise it becomes a dashboard nobody opens. Reading the fifty worst queries, done by a person, once a day during the migration, finds more defects than any automatic threshold, because most defects have a pattern visible to the naked eye.',
            'Limit of the method. A shadow does not measure user behavior. To know whether the new relevance is better you need real traffic with real responses, which only happens from the percentage read onward, measuring click through rate, first click position and no click searches per route.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third item is what separates a good search migration from a mediocre one, and it is the least automatable of the four. Tools find the disagreement; a person finds the reason. Half an hour a day reading the worst queries, across a two week migration, costs five hours of work and usually prevents the whole incident.',
        },
      ],
    },
    {
      title: 'The seven stage sequence with queries running',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The sequence below applies both to swapping engines and to a large mapping change inside the same engine, which carries exactly the same risks. Every stage has an objective exit criterion, and none advances by date: they all advance by indicator.',
        },
        {
          type: 'ordered',
          items: [
            'Make indexing idempotent and versioned. Write by document identifier with a version number coming from the origin, never from the local clock. Exit criterion: reindexing the same document five times, in different orders, always produces the same final document.',
            'Turn on dual writing with no reads at all on the new index. Repair queue active, queue lag alert configured, zero impact on write latency in the primary path. Exit criterion: twenty four hours with the repair queue draining and the primary write showing no latency regression.',
            'Run the historical load per key range, not as a single batch. Ranges let you resume where it stopped, parallelize with control and measure real progress. Exit criterion: per range counts matching across both indexes, with an explicit tolerance for documents created during the load.',
            'Turn on shadow reads over five percent of traffic. Per query comparison with top overlap, drift and exclusive empty detection. Exit criterion: zero queries empty only in the new index, and the fifty worst read and explained one by one.',
            'Move reads in steps, starting at one percent. One percent is deliberately low: the first real exposure finds infrastructure problems, such as connection limits, cold caches and response time under concurrency, that the shadow never finds. Exit criterion: ninety fifth percentile latency equal or better, and click through rate inside the old index range.',
            'Advance to ten, fifty and one hundred percent with at least one full daily cycle at each step. Search traffic has strong intraday seasonality, and a step validated only during a quiet hour proves nothing about the peak. Exit criterion: the same indicator set stable through the peak at each step.',
            'Keep dual writing and the old index for a full cycle after one hundred percent. It is the immediate way back and the comparator for any relevance question that shows up later. Exit criterion: one week at one hundred percent with no business regression, and then switch off dual writing first, the index second.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Stage five deserves attention because it is where most surprises appear, and none of them are about relevance. The new engine is usually validated on isolated queries and fails under concurrency: the filter cache that was warm on the old one is cold on the new, the facet aggregation that cost ten milliseconds with a cache costs two hundred without it, and the simultaneous connection count blows up at the first peak. One percent is the step that turns those discoveries into configuration tuning rather than an incident.',
        },
        {
          type: 'paragraph',
          value:
            'The shutdown order in stage seven is not a detail. Switching off the old index before dual writing leaves writes failing against a target that no longer exists, filling the repair queue with permanent errors and possibly degrading the primary path. Turning off dual writing first, waiting out the cycle and only then decommissioning the index keeps the way back available until the last moment it would still be useful.',
        },
      ],
    },
    {
      title: 'The indicators that authorize switching the old index off',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Shutdown is the only irreversible stage, because rebuilding the old index afterwards means running the historical load again, against an engine that has been decommissioned, with a configuration nobody maintains anymore. The indicators below turn that decision into a verification.',
        },
        {
          type: 'table',
          columns: ['Indicator', 'What it measures', 'Criterion to switch off', 'What it catches'],
          rows: [
            [
              'Searches without clicks',
              'Fraction of searches with no click on any result',
              'Inside the historical range for seven days at one hundred percent',
              'Worse relevance that produces no error at all',
            ],
            [
              'Empty results for known terms',
              'Terms with traffic that started returning an empty list',
              'Zero, measured over the tail and not only the popular ones',
              'Unmapped field or divergent analyzer',
            ],
            [
              'Repair queue lag',
              'Age of the oldest item pending reindexing',
              'Stable and below the catalog freshness agreement',
              'Dual writing failing silently for a subset',
            ],
            [
              'Divergence by sampling',
              'Documents compared between origin and index, by sample',
              'Below threshold for a full refresh cycle',
              'A document stuck on an older version',
            ],
            [
              'Write flow coverage',
              'Distinct flows that indexed during the period',
              'All present, including monthly jobs and imports',
              'A rare flow that only writes to the old index',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last indicator is the one that most often prevents a post shutdown incident, and the one most often forgotten. Real catalogs have write flows that run once a month, like the supplier import, the bulk price adjustment or the manual fix made through an old admin screen. If that flow writes straight into the old index, bypassing the dual write layer, it works throughout the migration and breaks on shutdown day. Measuring distinct flows, rather than write volume, is what surfaces the flow that writes a hundred documents a month with the same weight as the one writing a million a day.',
        },
        {
          type: 'paragraph',
          value:
            'The first indicator needs an honest caveat: searches without clicks is a noisy signal influenced by seasonality, campaigns and catalog changes. It does not work as an automatic trigger, it works as a blocking condition. If it is outside the range, do not switch off, investigate. If it is inside, it does not prove relevance improved, only that it did not degrade detectably, and that is exactly the guarantee an infrastructure migration needs to give.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I skip the shadow read and go straight to one percent of real traffic, since the shadow does not decide which index is better?',
      answer:
        'You can, and in small teams with a simple catalog that is a defensible choice, as long as it is clear what is being traded. The shadow finds categorical defects, the kind that affects an entire class of queries, and finds them before any user sees them. Skipping the shadow means those defects will be discovered by real users, and at one percent of traffic that is acceptable in volume but not in nature: if the defect is an unmapped field, the one percent of users who searched that term got an empty page, and you only learn about it from the empty result counter after the fact. The middle path that usually pays off is running the shadow outside the response path, as a batch, over last week recorded queries instead of in real time. That costs a nightly run, changes no latency, requires no code in the critical path and finds the same class of defects. You lose the comparison under real concurrency, but that was never the strength of the shadow, it is the strength of the one percent step. For a catalog above a few thousand documents, or when search is a meaningful revenue source, the batch comparison is the minimum I would recommend before exposing any traffic.',
    },
    {
      question: 'How do I migrate without dual writing when the index is fed by a data pipeline I do not control?',
      answer:
        'Dual writing in the application is the cleanest path, but it is not the only one, and when indexing comes from a third party pipeline or a closed integration tool there are two good alternatives. The first is a fork at the transport layer: if the pipeline publishes to a topic or a queue before indexing, you simply add a second consumer writing into the new index, and you get dual writing without touching the pipeline. That is the preferred option whenever a messaging hop exists in the path, because the new consumer is isolated, has its own metrics and can be switched off without affecting anything. The second is change capture at the origin, reading the database change log and feeding the new index from it. It costs more to build, but has a real advantage: it does not depend on the pipeline being correct, which means it also validates the old pipeline and sometimes reveals that the current index had been diverging from the origin for months. The option I would avoid is periodic synchronization by updated timestamp, because it does not capture deletions, depends on a clock and misses any change made by a job that does not update the timestamp field. If it is the only one available, compensate with a full reconciliation by sampling running in parallel, and treat the divergence it finds as a measurement of the method error, not as an exception.',
    },
    {
      question: 'How long should I keep the old index running after reaching one hundred percent, and what exactly am I paying for that?',
      answer:
        'The practical rule that works is keeping it for a full business cycle, and for most catalogs that means a month, not a week. The reason is the rare write flow: the monthly supplier import, the close that reprices whole categories, the seasonal campaign that creates a new attribute. None of those appear inside a seven day window, and all of them can break on the new index in a way you only notice when the comparator is already gone. The real cost is lower than it looks. An old index with no query traffic consumes almost only storage plus the dual writes, and writing is typically a small fraction of the cost compared with querying, which is what demands memory and processor. In practice, keeping the old one for a month adds somewhere between ten and twenty percent to the search subsystem cost during that period, which is cheap next to rebuilding everything under pressure. There is a non financial cost that matters more: while both indexes exist, every investigation starts by asking which one answered, and every relevance tweak has to be made in two places or explicitly in one. That is why the decision should come with a date attached from the start. An old index with no shutdown date becomes permanent, and three months later nobody remembers whether it still receives writes.',
    },
  ],
  conclusion: {
    title: 'Swapping a search engine is migrating relevance, not documents',
    description:
      'A search migration rarely fails from data loss: it fails because a different analyzer broke a class of queries, because an unmapped field started returning empty lists, or because the old index was switched off before the monthly import proved its flow had been migrated. I can review your search layer and define the dual write design with versioning and a repair queue, the historical load per key range that coexists with live traffic, the ranked list comparison over real query traffic, the step sequence that reverts at any point and the indicators that authorize switching the old index off.',
    cta: 'Talk about the search migration in my system',
  },
  related: [
    {
      label: 'Database migration with no window: expand, migrate, contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Migrating embeddings without reindexing everything at once',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La reindexación empezó un jueves a las nueve de la noche con la promesa de terminar en dos horas, y a las seis de la mañana todavía faltaba el cuarenta por ciento del catálogo. El equipo apuntó la búsqueda al índice nuevo de todos modos, porque el tráfico iba a subir a las ocho. Aquel día la búsqueda de "zapatillas blancas" devolvió trescientos resultados en lugar de once mil, nadie lo notó durante tres horas porque la página no dio ningún error, y los ingresos por búsqueda cayeron un diecinueve por ciento antes de que alguien relacionara ambas cosas. Este artículo muestra por qué el cambio de motor de búsqueda falla de una forma silenciosa que el cambio de base de datos no tiene, cómo el índice paralelo más la replicación de escritura eliminan la ventana de mantenimiento, por qué la validación por conteo de documentos aprueba índices rotos y qué la sustituye, por qué la relevancia cambia aunque los datos estén correctos y cómo comparar dos listas ordenadas sin depender de opiniones, qué secuencia de siete etapas cambia el motor con las consultas activas y revierte en cualquier punto, y qué indicadores autorizan apagar el índice antiguo.',
  sections: [
    {
      title: 'Por qué el cambio de búsqueda falla en silencio',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una migración de base de datos relacional que sale mal suele gritar: la consulta se rompe, la transacción revienta, la aplicación devuelve un quinientos y la alerta salta. Una migración de índice de búsqueda que sale mal devuelve un doscientos con una lista corta. El contrato de la búsqueda es una lista ordenada de resultados, y una lista con menos elementos, o con los elementos en el orden equivocado, es indistinguible de una búsqueda que simplemente tenía poco que ofrecer.',
        },
        {
          type: 'paragraph',
          value:
            'Eso lo cambia todo en el diseño de la migración. No hay un error que monitorizar, así que la validación tiene que ser comparativa por construcción: el índice nuevo solo puede juzgarse contra el antiguo, consulta a consulta, nunca contra un umbral absoluto. El panel de errores se mantendrá en verde durante un incidente de búsqueda entero, y la primera señal real suele venir de fuera de ingeniería, como caída de conversión, aumento de búsquedas sin clic o un ticket de cliente diciendo que un producto desapareció.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo motivo es que el índice no es una copia de los datos: es una interpretación de ellos. Entre la fila de la base y el documento indexado hay una tubería con tokenización, eliminación de acentos, lematización, sinónimos, descomposición de palabras compuestas, campos copiados y pesos por campo. Dos motores con el mismo contenido producen resultados distintos porque interpretan el texto de forma distinta, y por eso la pregunta correcta nunca es si los datos llegaron íntegros, sino si las respuestas siguen siendo buenas.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Migración de base de datos', 'Migración de índice de búsqueda'],
          rows: [
            [
              'Señal de fallo',
              'Error explícito, excepción, transacción rechazada',
              'Respuesta válida con la lista equivocada, sin error',
            ],
            [
              'Fuente de verdad',
              'La propia base, que es el origen',
              'Otro sistema: el índice siempre es derivado',
            ],
            [
              'Validación posible',
              'Conteo y suma de verificación por tabla',
              'Comparación de listas ordenadas sobre consultas reales',
            ],
            [
              'Coste de la reversión',
              'Alto: el dato nuevo ya se escribió en el destino',
              'Bajo: basta con reapuntar la lectura, el índice es reconstruible',
            ],
            [
              'Tiempo de reconstrucción',
              'No aplica, el dato es el origen',
              'Horas a días, y define el tamaño de la ventana de replicación',
            ],
            [
              'Quién se da cuenta primero',
              'La alerta de error de la aplicación',
              'El negocio, por la caída de conversión',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila es la buena noticia de esta migración y la razón por la que puede hacerse sin ventana. El índice es derivado, así que mantener dos a la vez no crea dos fuentes de verdad: crea dos interpretaciones de la misma fuente, y cualquiera de ellas puede descartarse y reconstruirse sin pérdida. Es la propiedad que hace segura la lectura en sombra y barata la reversión, y es justamente la que la ventana de mantenimiento desperdicia.',
        },
      ],
    },
    {
      title: 'Índice paralelo y replicación de escritura: eliminar la ventana',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El problema real de la reindexación no es el volumen, es que el catálogo sigue cambiando mientras corre. Una carga completa que tarda ocho horas es una fotografía del instante inicial, y al terminar ya está ocho horas desactualizada. Rellenar ese hueco después con una consulta por fecha de actualización funciona mal: depende de un reloj fiable, pierde las eliminaciones de documentos e ignora los cambios hechos por rutinas que no tocan el campo de fecha.',
        },
        {
          type: 'paragraph',
          value:
            'La solución es invertir el orden. Primero se activa la replicación de escritura hacia el índice nuevo y después empieza la carga histórica. Todo cambio que ocurre durante la carga ya se aplica en ambos índices, y la carga histórica rellena el pasado por debajo. Como la escritura es idempotente por identificador de documento, el orden entre la carga y la replicación no importa siempre que la replicación lleve número de versión: un documento sobrescrito por la carga con una versión más antigua queda descartado.',
        },
        {
          type: 'diagram',
          value: `Fase 1 - solo el indice antiguo
  aplicacion --escritura--> [INDICE ANTIGUO] <--consulta-- aplicacion

Fase 2 - escritura doble activa, aun sin carga historica
  aplicacion --escritura--+--> [INDICE ANTIGUO] <--consulta-- aplicacion
                          \\--> [INDICE NUEVO]   (solo deltas, vacio en el pasado)
  verificacion: tasa de error de la escritura nueva aislada, 0 impacto critico

Fase 3 - carga historica por debajo, con escritura doble activa
  cargador --lote--> [INDICE NUEVO] <--delta-- aplicacion
  regla: la escritura solo aplica si la version supera a la indexada
  verificacion: progreso por rango de clave, no por conteo total

Fase 4 - lectura en sombra (la consulta va a los dos, responde el antiguo)
  aplicacion --consulta--+--> [INDICE ANTIGUO] --> respuesta al usuario
                         \\--> [INDICE NUEVO]   --> solo comparacion, descartado
  verificacion: solapamiento de listas, latencia, ausencia de resultado vacio

Fase 5 - lectura porcentual (1% -> 10% -> 50% -> 100%)
  aplicacion --1%--> [INDICE NUEVO]   --> respuesta al usuario
             -99%--> [INDICE ANTIGUO] --> respuesta al usuario
  verificacion: tasa de clic y busquedas sin clic por ruta

Fase 6 - apagar
  aplicacion --escritura+consulta--> [INDICE NUEVO]
  el indice antiguo sigue recibiendo escritura, sin consultas, un ciclo entero`,
        },
        {
          type: 'paragraph',
          value:
            'La fase dos parece inútil y es la que más salva la migración. No mueve ninguna lectura: sirve para probar que la escritura en el motor nuevo funciona bajo tráfico real, con la forma real de los documentos, incluido ese campo que solo un flujo raro rellena. Descubrir un mapeo incompatible con cero lecturas dependiendo de él cuesta una tarde. Descubrirlo después de haber migrado la mitad de la lectura cuesta un incidente.',
        },
        {
          type: 'paragraph',
          value:
            'La escritura doble necesita una regla clara sobre el fallo: el índice nuevo nunca puede tumbar la escritura principal. Mientras no sea fuente de lectura, el fallo allí se registra en una cola de reparación y no se propaga. Una vez que pasa a ser fuente de lectura, los papeles se invierten y el antiguo se convierte en el lado tolerante. La escritura que falla en silencio y no va a ninguna cola es el defecto que produce divergencia permanente, y es el más común de los tres.',
        },
        {
          type: 'code',
          value: `// Escritura doble con version y cola de reparacion. El indice secundario nunca
// tumba la escritura principal: el fallo se vuelve item de reparacion, no error.
const ROLES = { PRIMARIO: 'primario', SECUNDARIO: 'secundario' };

// Configuracion dinamica: el cambio de rol debe aplicar sin redespliegue,
// si no la reversion deja de ser inmediata.
const rolDe = (motor) => configuracion.get(\`busqueda.rol.\${motor.nombre}\`, ROLES.SECUNDARIO);

async function indexarDocumento(documento) {
  // La version viene del origen, no del reloj local. Los relojes entre
  // procesos derivan y hacen que la carga historica pise un delta mas nuevo.
  const payload = {
    id: documento.id,
    version: documento.actualizadoEnSecuencia,
    cuerpo: construirDocumento(documento),
  };

  const resultados = await Promise.allSettled(
    motoresActivos().map((motor) => escribirConVersion(motor, payload)),
  );

  const fallos = resultados
    .map((resultado, indice) => ({ resultado, motor: motoresActivos()[indice] }))
    .filter(({ resultado }) => resultado.status === 'rejected');

  for (const { motor, resultado } of fallos) {
    // Siempre encola para reparacion, incluso cuando va a relanzar: la cola
    // de reparacion es lo que garantiza convergencia si el reintento falla.
    await colaDeReparacion.encolar({
      motor: motor.nombre,
      documentoId: documento.id,
      version: payload.version,
      error: String(resultado.reason),
    });

    if (rolDe(motor) === ROLES.PRIMARIO) throw resultado.reason;
  }

  return { indexadoEn: motoresActivos().length - fallos.length };
}

// escribirConVersion usa el control de concurrencia del propio motor: la
// escritura se rechaza cuando la version enviada es menor que la indexada,
// y ese rechazo es un exito, no un error.
async function escribirConVersion(motor, payload) {
  try {
    return await motor.index(payload, { ifVersionGreaterThan: payload.version - 1 });
  } catch (error) {
    if (error.code === 'version_conflict') return { omitido: true };
    throw error;
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'El tratamiento del conflicto de versión al final es el detalle que separa una escritura doble correcta de una que corrompe datos despacio. Durante la carga histórica, el conflicto de versión es el comportamiento esperado y frecuente: significa que un delta más nuevo ya llegó y la carga intentó sobrescribirlo con la foto antigua. Tratarlo como error llena la cola de reparación de ruido y esconde los fallos reales. Tratarlo como éxito omitido es lo que hace que la convergencia ocurra sola.',
        },
      ],
    },
    {
      title: 'La validación por conteo aprueba índices rotos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La comprobación que casi todo equipo hace es comparar el número de documentos de ambos índices. Es necesaria e insuficiente: detecta el caso en que la carga se detuvo a medias y no detecta ninguno de los demás. Un índice con el número exacto de documentos puede haber perdido el campo de descripción, tener otro analizador en el campo de título, haber perdido los sinónimos o llevar pesos distintos entre campos, y el conteo cuadrará en todos esos casos.',
        },
        {
          type: 'table',
          columns: ['Defecto', '¿Cuadra el conteo?', 'Qué ocurre realmente', 'Verificación que lo detecta'],
          rows: [
            [
              'Carga interrumpida a medias',
              'No',
              'Faltan documentos enteros',
              'Conteo por rango de clave',
            ],
            [
              'Campo sin mapear',
              'Sí',
              'La búsqueda por ese campo devuelve vacío',
              'Consulta por campo con resultado esperado',
            ],
            [
              'Analizador distinto',
              'Sí',
              'Acentos, plurales o compuestos dejan de casar',
              'Conjunto de consultas con variación ortográfica',
            ],
            [
              'Sinónimos no migrados',
              'Sí',
              'Un término comercial deja de encontrar el producto',
              'Consultas de la cabeza de la cola con sinónimo conocido',
            ],
            [
              'Pesos de campo distintos',
              'Sí',
              'El orden cambia y el artículo correcto cae a la página dos',
              'Solapamiento de lista en las diez primeras posiciones',
            ],
            [
              'Filtro con tipo distinto',
              'Sí',
              'La faceta desaparece o filtra mal entre texto y número',
              'Consulta con filtro comparada lado a lado',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Lo que sustituye al conteo es la reproducción del tráfico real de consultas contra ambos índices. No un conjunto inventado de veinte consultas bonitas: las consultas que los usuarios hicieron realmente la semana pasada, con su distribución real, incluida la cola larga de términos mal escritos, que es donde los analizadores divergen. Dos mil consultas muestreadas de la cola encuentran más defectos que doscientas populares, porque las populares casan por cualquier camino.',
        },
        {
          type: 'code',
          value: `// Comparador de listas ordenadas. Mide solapamiento en el tope y desplazamiento
// de posicion, las dos formas en que la relevancia empeora sin error alguno.
const K_TOPE = 10;

const solapamientoEnTope = (listaA, listaB, k = K_TOPE) => {
  const topeA = listaA.slice(0, k).map((item) => item.id);
  const topeB = new Set(listaB.slice(0, k).map((item) => item.id));
  const comunes = topeA.filter((id) => topeB.has(id)).length;
  return comunes / k;
};

// Desplazamiento medio: para cada item del tope antiguo, cuantas posiciones se
// movio en el nuevo. Un item que desaparecio cuenta como si fuera al final.
const desplazamientoMedio = (listaA, listaB, k = K_TOPE) => {
  const posicionEn = new Map(listaB.map((item, indice) => [item.id, indice]));
  const penalizacion = listaB.length || k * 10;

  const desvios = listaA.slice(0, k).map((item, indice) => {
    const posicionNueva = posicionEn.has(item.id) ? posicionEn.get(item.id) : penalizacion;
    return Math.abs(posicionNueva - indice);
  });

  return desvios.reduce((suma, valor) => suma + valor, 0) / (desvios.length || 1);
};

async function compararTrafico(consultasMuestreadas) {
  const informe = [];

  for (const consulta of consultasMuestreadas) {
    const [antiguo, nuevo] = await Promise.all([
      motorAntiguo.buscar(consulta),
      motorNuevo.buscar(consulta),
    ]);

    informe.push({
      termino: consulta.termino,
      solapamiento: solapamientoEnTope(antiguo.items, nuevo.items),
      desplazamiento: desplazamientoMedio(antiguo.items, nuevo.items),
      // Una caida brusca del total es la firma de un campo sin mapear.
      razonDeTotal: nuevo.total / Math.max(antiguo.total, 1),
      vacioSoloEnNuevo: antiguo.total > 0 && nuevo.total === 0,
    });
  }

  // Ordena por el peor caso: esos son los defectos, no la media.
  return informe.sort((a, b) => a.solapamiento - b.solapamiento);
}`,
        },
        {
          type: 'paragraph',
          value:
            'La última línea de la función es lo más importante del método. La media de solapamiento parecerá excelente incluso con un defecto grave, porque el noventa y cinco por ciento de las consultas atraviesa cualquier mapeo razonable. Lo que revela el problema es la punta inferior: las cincuenta consultas con peor solapamiento, leídas una a una. Casi siempre comparten una característica, y esa característica es exactamente el defecto, sea el acento, el guion, el número en mitad del término o el campo que nadie mapeó.',
        },
        {
          type: 'paragraph',
          value:
            'El campo vacioSoloEnNuevo merece alerta propia, con umbral en cero. Una consulta que devolvía resultados en el índice antiguo y devuelve lista vacía en el nuevo siempre es un defecto, nunca una mejora, y es el fallo de mayor impacto comercial porque produce la página de ningún resultado para un usuario que estaba listo para comprar. Ninguna migración debería avanzar de escalón con ese contador por encima de cero.',
        },
      ],
    },
    {
      title: 'La lectura en sombra y la decisión que no resuelve',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La lectura en sombra consulta ambos índices en cada búsqueda real, responde al usuario con el índice antiguo y usa el resultado del nuevo solo para comparar. Es la forma más barata de validar con tráfico real, y tiene una limitación que conviene decir con claridad: mide concordancia, no calidad. Si el índice nuevo discrepa del antiguo, la sombra muestra que discrepa, pero no dice cuál de los dos tiene razón.',
        },
        {
          type: 'paragraph',
          value:
            'Eso importa porque casi siempre se cambia de motor esperando mejor relevancia, y mejor relevancia es discrepancia por definición. Un índice nuevo con noventa y cinco por ciento de solapamiento en el tope no ha mejorado nada relevante. Uno con setenta por ciento puede haber mejorado o empeorado, y la sombra por sí sola no decide. La separación práctica está entre discrepancia explicable e inexplicable: si puedes señalar el cambio de configuración que causa la diferencia y fue intencionado, es evolución. Si no puedes, es defecto hasta que se demuestre lo contrario.',
        },
        {
          type: 'ordered',
          items: [
            'Coste en latencia. La sombra duplica la consulta y, si se hace en serie dentro del camino de respuesta, duplica el tiempo percibido. La llamada al índice nuevo debe dispararse sin esperar, con un límite de tiempo agresivo y sin propagar el error, porque un fallo en el camino de comparación nunca puede llegar al usuario.',
            'Coste en muestreo. No toda consulta necesita sombra. Entre el cinco y el diez por ciento del tráfico, muestreado de forma estable por término, ya produce volumen suficiente y mantiene el coste de infraestructura bajo control. Muestrear por usuario en vez de por consulta es peor, porque concentra la muestra en los términos de quien busca mucho.',
            'Coste en interpretación. El informe necesita dueño y horario, si no se convierte en un panel que nadie abre. Leer las cincuenta peores consultas, hecho por una persona, una vez al día durante la migración, encuentra más defectos que cualquier umbral automático, porque la mayoría de los defectos tiene un patrón visible a simple vista.',
            'Límite del método. La sombra no mide el comportamiento del usuario. Para saber si la relevancia nueva es mejor hace falta tráfico real con respuesta real, lo que solo ocurre a partir de la lectura porcentual, midiendo tasa de clic, posición del primer clic y búsquedas sin clic por ruta.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercer punto es lo que separa una buena migración de búsqueda de una mediocre, y es el menos automatizable de los cuatro. Las herramientas encuentran la discrepancia; la persona encuentra el motivo. Media hora al día leyendo las peores consultas, durante una migración de dos semanas, cuesta cinco horas de trabajo y suele evitar el incidente entero.',
        },
      ],
    },
    {
      title: 'La secuencia de siete etapas con las consultas activas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La secuencia siguiente vale tanto para cambiar de motor como para un cambio grande de mapeo dentro del mismo motor, que tiene exactamente los mismos riesgos. Cada etapa tiene criterio de salida objetivo, y ninguna avanza por fecha: todas avanzan por indicador.',
        },
        {
          type: 'ordered',
          items: [
            'Haz la indexación idempotente y versionada. Escritura por identificador de documento con número de versión procedente del origen, nunca del reloj local. Criterio de salida: reindexar el mismo documento cinco veces, en órdenes distintos, produce siempre el mismo documento final.',
            'Activa la escritura doble sin ninguna lectura en el índice nuevo. Cola de reparación activa, alerta de retraso de la cola configurada, cero impacto en la latencia de escritura del camino principal. Criterio de salida: veinticuatro horas con la cola de reparación drenando y la escritura principal sin regresión de latencia.',
            'Ejecuta la carga histórica por rango de clave, no como lote único. Los rangos permiten retomar donde se detuvo, paralelizar con control y medir progreso real. Criterio de salida: conteo por rango igual entre ambos índices, con tolerancia explícita para los documentos creados durante la carga.',
            'Activa la lectura en sombra sobre el cinco por ciento del tráfico. Comparación por consulta con solapamiento en el tope, desplazamiento y detección de vacío exclusivo. Criterio de salida: cero consultas vacías solo en el nuevo, y las cincuenta peores leídas y explicadas una a una.',
            'Mueve la lectura por escalones, empezando en el uno por ciento. El uno por ciento es bajo a propósito: la primera exposición real encuentra problemas de infraestructura, como límite de conexiones, caché fría y tiempo de respuesta bajo concurrencia, que la sombra no encuentra. Criterio de salida: latencia en el percentil noventa y cinco igual o mejor, y tasa de clic dentro del rango del índice antiguo.',
            'Avanza a diez, cincuenta y cien por ciento con al menos un ciclo diario completo en cada escalón. El tráfico de búsqueda tiene una estacionalidad fuerte dentro del día, y un escalón validado solo en la hora tranquila no prueba nada sobre el pico. Criterio de salida: el mismo conjunto de indicadores estable durante el pico de cada escalón.',
            'Mantén la escritura doble y el índice antiguo durante un ciclo completo después del cien por cien. Es el camino de vuelta inmediato y el comparador para cualquier duda de relevancia que aparezca después. Criterio de salida: una semana al cien por cien sin regresión de negocio, y entonces apaga primero la escritura doble y después el índice.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La etapa cinco merece atención porque es donde aparecen la mayoría de las sorpresas, y ninguna es de relevancia. El motor nuevo suele validarse en consultas aisladas y falla bajo concurrencia: la caché de filtros que estaba caliente en el antiguo está fría en el nuevo, la agregación por faceta que costaba diez milisegundos con caché cuesta doscientos sin ella, y el número de conexiones simultáneas revienta en el primer pico. El uno por ciento es el escalón que convierte esos hallazgos en ajuste de configuración en lugar de incidente.',
        },
        {
          type: 'paragraph',
          value:
            'El orden de apagado de la etapa siete no es un detalle. Apagar el índice antiguo antes que la escritura doble deja la escritura fallando contra un destino que ya no existe, llenando la cola de reparación de errores permanentes y degradando posiblemente el camino principal. Apagar primero la escritura doble, esperar el ciclo y solo entonces desprovisionar el índice mantiene el camino de vuelta disponible hasta el último momento en que aún sería útil.',
        },
      ],
    },
    {
      title: 'Los indicadores que autorizan apagar el índice antiguo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El apagado es la única etapa irreversible, porque reconstruir el índice antiguo después significa correr la carga histórica otra vez, contra un motor ya desprovisionado, con una configuración que nadie mantiene. Los indicadores siguientes convierten esa decisión en una verificación.',
        },
        {
          type: 'table',
          columns: ['Indicador', 'Qué mide', 'Criterio para apagar', 'Qué detecta'],
          rows: [
            [
              'Búsquedas sin clic',
              'Fracción de búsquedas sin ningún clic en el resultado',
              'Dentro del rango histórico durante siete días al cien por cien',
              'Relevancia peor que no genera ningún error',
            ],
            [
              'Resultado vacío por término conocido',
              'Términos con tráfico que pasaron a devolver lista vacía',
              'Cero, medido sobre la cola y no solo sobre los populares',
              'Campo sin mapear o analizador divergente',
            ],
            [
              'Retraso de la cola de reparación',
              'Edad del elemento más antiguo pendiente de reindexar',
              'Estable y por debajo del acuerdo de frescura del catálogo',
              'Escritura doble fallando en silencio para un subconjunto',
            ],
            [
              'Divergencia por muestreo',
              'Documentos comparados entre origen e índice, por muestra',
              'Por debajo del umbral durante un ciclo completo de actualización',
              'Documento atascado en una versión antigua',
            ],
            [
              'Cobertura de flujos de escritura',
              'Flujos distintos que indexaron en el período',
              'Todos presentes, incluidas rutinas mensuales e importaciones',
              'Flujo raro que solo escribe en el índice antiguo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El último indicador es el que más evita incidentes tras el apagado, y el más olvidado. Los catálogos reales tienen flujos de escritura que corren una vez al mes, como la importación de proveedores, el ajuste masivo de precios o la corrección manual hecha desde una pantalla administrativa antigua. Si ese flujo escribe directo en el índice antiguo, sin pasar por la capa de escritura doble, funciona durante toda la migración y se rompe el día del apagado. Medir flujos distintos, y no volumen de escritura, es lo que revela el flujo que escribe cien documentos al mes con el mismo peso que el que escribe un millón al día.',
        },
        {
          type: 'paragraph',
          value:
            'El primer indicador necesita una salvedad honesta: las búsquedas sin clic son una señal ruidosa e influida por la estacionalidad, las campañas y los cambios de catálogo. No sirve como disparador automático, sirve como condición de bloqueo. Si está fuera del rango, no apagues e investiga. Si está dentro, no prueba que la relevancia mejoró, solo que no empeoró de forma detectable, y esa es exactamente la garantía que una migración de infraestructura debe dar.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Se puede saltar la lectura en sombra e ir directo al uno por ciento de tráfico real, dado que la sombra no decide qué índice es mejor?',
      answer:
        'Se puede, y en equipos pequeños con catálogo simple es una elección defendible, siempre que quede claro qué se está cambiando. La sombra encuentra defectos categóricos, del tipo que afecta a toda una clase de consultas, y los encuentra antes de que ningún usuario los vea. Saltarse la sombra significa que esos defectos los descubrirán usuarios reales, y con el uno por ciento del tráfico eso es aceptable en volumen pero no en naturaleza: si el defecto es un campo sin mapear, ese uno por ciento de usuarios que buscó ese término recibió una página vacía, y solo lo sabrás por el contador de resultado vacío después del hecho. El camino intermedio que suele compensar es ejecutar la sombra fuera del camino de respuesta, por lotes, sobre las consultas grabadas de la semana anterior en vez de en tiempo real. Eso cuesta una ejecución nocturna, no altera ninguna latencia, no exige código en el camino crítico y encuentra la misma clase de defectos. Se pierde la comparación bajo concurrencia real, pero esa nunca fue la fuerza de la sombra sino del escalón del uno por ciento. Para catálogos de más de unos miles de documentos, o cuando la búsqueda es una fuente relevante de ingresos, la comparación por lotes es el mínimo que yo recomendaría antes de exponer cualquier tráfico.',
    },
    {
      question: '¿Cómo migrar sin escritura doble cuando el índice se alimenta de una tubería de datos que no controlo?',
      answer:
        'La escritura doble en la aplicación es el camino más limpio, pero no es el único, y cuando la indexación viene de una tubería de terceros o de una herramienta de integración cerrada hay dos alternativas buenas. La primera es la bifurcación en el transporte: si la tubería publica en un tópico o en una cola antes de indexar, basta con añadir un segundo consumidor que escriba en el índice nuevo, y consigues la escritura doble sin tocar la tubería. Esa es la opción preferida siempre que exista un punto de mensajería en el camino, porque el nuevo consumidor está aislado, tiene métricas propias y puede apagarse sin afectar a nada. La segunda es la captura de cambios en el origen, leyendo el registro de cambios de la base y alimentando el índice nuevo desde ahí. Cuesta más de montar, pero tiene una ventaja real: no depende de que la tubería sea correcta, lo que significa que también valida la tubería antigua y a veces revela que el índice actual llevaba meses divergiendo del origen. La opción que evitaría es la sincronización periódica por fecha de actualización, porque no captura eliminaciones, depende del reloj y pierde cualquier cambio hecho por una rutina que no actualice el campo de fecha. Si es la única posible, compénsala con una reconciliación completa por muestreo corriendo en paralelo, y trata la divergencia encontrada como medida del error del método, no como excepción.',
    },
    {
      question: '¿Cuánto tiempo debo mantener encendido el índice antiguo después de llegar al cien por cien, y qué estoy pagando exactamente por eso?',
      answer:
        'La regla práctica que funciona es mantenerlo durante un ciclo completo de negocio, y para la mayoría de los catálogos eso significa un mes, no una semana. El motivo es el flujo de escritura raro: la importación mensual de proveedores, el cierre que reprecia categorías enteras, la campaña estacional que crea un atributo nuevo. Ninguno de ellos aparece en una ventana de siete días, y todos pueden romperse en el índice nuevo de una forma que solo se percibe cuando ya no existe comparador. El coste real es menor de lo que parece. Un índice antiguo sin tráfico de consultas consume casi solo almacenamiento más la escritura doble, y la escritura suele ser una fracción pequeña del coste comparada con la consulta, que es la que exige memoria y procesador. En la práctica, mantener el antiguo un mes añade entre un diez y un veinte por ciento al coste del subsistema de búsqueda durante ese período, lo que es barato frente a reconstruir todo bajo presión. Hay un coste no financiero que importa más: mientras existan los dos índices, toda investigación empieza preguntando cuál respondió, y todo ajuste de relevancia hay que hacerlo en dos sitios o explícitamente en uno. Por eso la decisión debe venir con fecha marcada desde el principio. Un índice antiguo sin fecha de apagado se vuelve permanente, y tres meses después nadie recuerda si todavía recibe escrituras.',
    },
  ],
  conclusion: {
    title: 'Cambiar el motor de búsqueda es migrar relevancia, no documentos',
    description:
      'La migración de búsqueda rara vez falla por pérdida de datos: falla porque un analizador distinto rompió una clase de consultas, porque un campo sin mapear pasó a devolver listas vacías, o porque el índice antiguo se apagó antes de que la importación mensual demostrara que su flujo había sido migrado. Puedo revisar tu capa de búsqueda y definir el diseño de escritura doble con versión y cola de reparación, la carga histórica por rango de clave que convive con el tráfico, la comparación de listas ordenadas sobre el tráfico real de consultas, la secuencia de escalones reversible en cualquier punto y los indicadores que autorizan apagar el índice antiguo.',
    cta: 'Hablar sobre la migración de búsqueda de mi sistema',
  },
  related: [
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar, contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Migrar embeddings sin reindexar todo de una vez',
      to: '/blog/migrar-embeddings-sem-reindexar-tudo-de-uma-vez',
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
