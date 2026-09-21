// Conteudo do artigo: fuso horario que corrompe relatorio e o fechamento do mes que nao bate entre regioes.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O financeiro fechou setembro com quatro milhões e duzentos, o time de dados reportou quatro milhões e cento e oitenta e sete, e a diferença de treze mil apareceu de novo em outubro com outro valor. Ninguém errou conta: os dois estavam somando o mesmo conjunto de linhas com duas definições diferentes do que é setembro. Este artigo mostra por que o problema de fuso não é conversão de exibição e sim definição de intervalo, por que guardar tudo em UTC resolve metade do problema e cria a outra metade, o que é a janela deslizante de quarenta e oito horas em que uma mesma venda pertence a dois meses ao mesmo tempo, por que o horário de verão faz um dia ter vinte e três ou vinte e cinco horas e o que isso quebra em agregação por hora, qual é a diferença entre instante e data civil e por que misturar os dois tipos na mesma coluna é a causa raiz, como escrever a consulta de fechamento que produz o mesmo número em qualquer região, e quais cinco verificações detectam a corrupção antes de o relatório sair.',
  sections: [
    {
      title: 'Dois relatórios corretos que discordam em treze mil reais',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conversa sempre começa do mesmo jeito. Alguém mostra dois números que deveriam ser idênticos e pergunta qual está errado. A resposta desconfortável é que nenhum dos dois está errado: eles respondem a perguntas diferentes que foram escritas com as mesmas palavras. O relatório do financeiro pergunta quanto foi faturado no mês de setembro no horário de São Paulo. O painel de dados pergunta quanto foi faturado entre o primeiro instante de setembro em UTC e o último instante de setembro em UTC. São dois intervalos distintos, deslocados em três horas, e a diferença entre eles é exatamente o volume de vendas que aconteceu nessas três horas de fronteira.',
        },
        {
          type: 'paragraph',
          value:
            'O que torna esse erro difícil de encontrar é que ele não produz sintoma nenhum na maior parte do tempo. Em um mês de movimento constante, a diferença é pequena o bastante para ser confundida com arredondamento ou com uma venda estornada. Em um mês com campanha que termina à meia-noite do dia trinta, a diferença explode, porque a última hora de uma promoção concentra um volume desproporcional e essa hora cai justamente na fronteira disputada. É por isso que o problema aparece primeiro no mês em que o negócio deu certo, e não no mês tranquilo em que alguém teria tempo de investigar.',
        },
        {
          type: 'diagram',
          value: `FRONTEIRA DE SETEMBRO, DUAS DEFINICOES

  Sao Paulo (UTC-3)        30/set 21:00 ---- 30/set 23:59 ---- 01/out 00:00
  UTC                      01/out 00:00 ---- 01/out 02:59 ---- 01/out 03:00

  Venda registrada em 2026-10-01T01:30:00Z
    -> em UTC:        outubro
    -> em Sao Paulo:  30 de setembro, 22:30

  Relatorio financeiro  (mes civil de Sao Paulo):  a venda entra em setembro
  Painel de dados       (mes civil em UTC):        a venda entra em outubro

  JANELA DE AMBIGUIDADE POR FECHAMENTO

    inicio: 30/set 21:00 UTC
    fim:    01/out 03:00 UTC
    duracao: 3h para UTC-3, ate 14h quando ha regiao em UTC+11 no mesmo relatorio

  Todo registro dentro dessa janela pertence a dois meses ao mesmo tempo,
  e o mes que ele recebe depende de qual consulta o leu primeiro.`,
        },
        {
          type: 'paragraph',
          value:
            'A regra que sai desse desenho vale para qualquer agregação por período: o fuso não é uma propriedade de formatação aplicada no fim, é o parâmetro que define quais linhas entram na soma. Trocar o fuso de exibição muda como uma data aparece na tela e não muda nenhum total. Trocar o fuso do recorte muda o conjunto de linhas somadas e, portanto, muda o total. Times inteiros perdem semanas tratando o primeiro caso quando o problema é o segundo, porque a palavra fuso é usada para os dois.',
        },
      ],
    },
    {
      title: 'Instante e data civil são dois tipos diferentes na mesma coluna',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A causa raiz quase sempre está no esquema, não na consulta. Existem dois tipos temporais distintos e a maioria dos bancos permite guardar os dois na mesma coluna sem reclamar. O instante é um ponto absoluto na linha do tempo: o momento exato em que o pagamento foi autorizado. Ele é o mesmo em qualquer lugar do mundo e só faz sentido comparado com outros instantes. A data civil é uma etiqueta de calendário: a data de vencimento da fatura, o dia da competência contábil, a data de nascimento. Ela não tem instante associado, porque o vencimento no dia dez é o dia dez em qualquer região, e forçá-la a virar instante é o que faz a data de nascimento andar um dia para trás quando o servidor muda de região.',
        },
        {
          type: 'paragraph',
          value:
            'Quando os dois tipos ocupam colunas com o mesmo formato, a diferença desaparece do código e cada leitor aplica a interpretação que achar natural. O serviço de cobrança lê a data de vencimento como instante em UTC, converte para o fuso local e mostra o dia nove para o cliente do Acre. O relatório de inadimplência lê a mesma coluna como data civil e considera o dia dez. Ninguém escreveu um bug: cada lado escolheu uma leitura defensável para um dado que nunca declarou qual delas era a correta.',
        },
        {
          type: 'table',
          columns: ['Dado', 'Tipo correto', 'O que quebra com o tipo errado'],
          rows: [
            [
              'Momento do pagamento autorizado',
              'Instante com fuso (timestamptz)',
              'Ordem de eventos invertida entre regiões e conciliação com o adquirente sem bater',
            ],
            [
              'Data de vencimento da fatura',
              'Data civil (date), sem hora',
              'Vencimento anda um dia ao mudar a região do servidor',
            ],
            [
              'Competência contábil do lançamento',
              'Ano e mês explícitos, não derivados',
              'Lançamento migra de mês quando a consulta troca de fuso',
            ],
            [
              'Início do expediente da loja',
              'Hora local mais identificador de fuso',
              'Loja abre no horário errado após o horário de verão',
            ],
            [
              'Agendamento futuro recorrente',
              'Hora local mais fuso, resolvido na execução',
              'Reunião das nove pula para as dez quando o país muda a regra',
            ],
            [
              'Prazo de retenção de trinta dias',
              'Instante mais duração',
              'Exclusão adiantada ou atrasada em uma hora duas vezes por ano',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A decisão que resolve a ambiguidade não é escolher um fuso padrão, é declarar o tipo no nome e no esquema. Uma coluna chamada pago_em do tipo timestamptz é inequivocamente um instante. Uma coluna chamada vence_em do tipo date é inequivocamente uma data civil. Uma coluna chamada data, do tipo timestamp sem fuso, é uma armadilha que vai custar um fechamento inteiro para alguém descobrir. O custo dessa correção é uma migração de tipo e uma revisão de nomes, e ela é a única que remove a classe inteira de erro em vez de corrigir um relatório por vez.',
        },
      ],
    },
    {
      title: 'A consulta de fechamento que produz o mesmo número em qualquer região',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com o tipo certo no esquema, a consulta de fechamento passa a ser um problema simples de expressar, desde que uma regra seja respeitada: o fuso de recorte é um parâmetro explícito da consulta, nunca uma configuração de sessão herdada do ambiente. Consulta que depende do fuso da sessão produz um resultado no laptop do analista, outro no servidor de relatórios e um terceiro no job noturno, e as três execuções são igualmente defensáveis porque nenhuma delas declarou qual mês estava sendo pedido.',
        },
        {
          type: 'code',
          value: `-- reports/monthly_close.sql
-- Fechamento mensal com fuso de recorte explicito. O parametro nao e
-- decoracao: ele define quais linhas entram na soma, e duas execucoes
-- com fusos diferentes produzem totais diferentes por definicao.

-- ERRADO: depende do fuso da sessao, que muda entre ambientes.
-- SELECT date_trunc('month', pago_em) AS mes, sum(valor)
--   FROM pagamentos GROUP BY 1;

-- CERTO: converte o instante para o fuso do recorte antes de truncar,
-- e devolve o intervalo usado junto do total para que o numero possa
-- ser auditado sem reexecutar a consulta.
WITH parametros AS (
  SELECT
    $1::text AS fuso,            -- 'America/Sao_Paulo'
    $2::date AS mes_referencia   -- '2026-09-01'
),
janela AS (
  SELECT
    fuso,
    mes_referencia,
    -- O timestamp local do primeiro instante do mes vira instante
    -- absoluto aplicando o fuso. AT TIME ZONE sobre timestamp sem fuso
    -- produz timestamptz, que e o que o indice de pago_em compara.
    (mes_referencia::timestamp AT TIME ZONE fuso) AS inicio,
    ((mes_referencia + interval '1 month')::timestamp AT TIME ZONE fuso) AS fim
  FROM parametros
)
SELECT
  j.mes_referencia,
  j.fuso,
  j.inicio,
  j.fim,
  count(*)                         AS quantidade,
  coalesce(sum(p.valor), 0)        AS total
FROM janela j
LEFT JOIN pagamentos p
  -- Comparacao meio aberta: inclui o inicio, exclui o fim. E o que
  -- impede que o instante exato da virada seja contado nos dois meses
  -- quando os dois relatorios rodam em sequencia.
  ON p.pago_em >= j.inicio
 AND p.pago_em <  j.fim
 AND p.estorno_em IS NULL
GROUP BY j.mes_referencia, j.fuso, j.inicio, j.fim;`,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes dessa consulta carregam quase todo o valor. O primeiro é a conversão acontecer no cálculo das bordas e não em cada linha: aplicar a função de fuso sobre a coluna dentro do WHERE desabilita o índice e transforma um fechamento de dois segundos numa varredura de tabela inteira. O segundo é o intervalo meio aberto, que é a única forma de garantir que meses consecutivos particionem o conjunto sem sobreposição e sem buraco. O terceiro é devolver as bordas junto do total, porque um número de fechamento sem o intervalo que o gerou não é auditável e vira exatamente a discussão de treze mil reais que motivou o artigo.',
        },
        {
          type: 'paragraph',
          value:
            'Quando o relatório precisa somar operações de várias regiões ao mesmo tempo, não existe um fuso de recorte único que seja correto. A saída é decidir a política e escrevê-la: ou o grupo inteiro fecha no fuso da matriz, e cada filial aceita que o mês dela termina em um horário local esquisito, ou cada filial fecha no fuso local, e o consolidado é a soma dos fechamentos locais, não um recorte global. As duas opções são válidas e produzem números diferentes. O erro é não escolher, porque aí cada consulta escolhe sozinha.',
        },
      ],
    },
    {
      title: 'Horário de verão: o dia que tem vinte e três horas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A transição de horário de verão quebra uma suposição que está espalhada por todo código de agregação temporal: a de que um dia tem vinte e quatro horas e que somar vinte e quatro horas a um instante avança um dia civil. No dia em que o relógio adianta, o dia civil local tem vinte e três horas e existe uma hora local que simplesmente não aconteceu. No dia em que atrasa, o dia tem vinte e cinco horas e existe uma hora local que aconteceu duas vezes, com dois instantes absolutos distintos mapeando para o mesmo texto de hora.',
        },
        {
          type: 'paragraph',
          value:
            'O sintoma prático é um gráfico de vendas por hora com uma barra vazia ou uma barra com o dobro do volume, duas vezes por ano, em países que adotam a prática. Como o Brasil suspendeu o horário de verão, é comum o time concluir que o problema não se aplica, e essa conclusão é errada por dois motivos. O primeiro é que os dados históricos anteriores à suspensão continuam no banco e continuam sendo reagregados por consultas novas. O segundo é que qualquer cliente, fornecedor ou integração em região que ainda pratica a mudança traz o problema de volta pela borda, e nesse caso ele aparece só na fatia daquele cliente, o que é muito mais difícil de perceber.',
        },
        {
          type: 'code',
          value: `// time/civil.js
// Aritmetica de calendario nao e aritmetica de milissegundos. Somar
// 24h a um instante avanca 24h reais, que nem sempre e um dia civil.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Errado: assume que todo dia tem 24h. Na virada do horario de verao o
// resultado cai no mesmo dia civil ou pula um dia inteiro.
export const proximoDiaErrado = (instante) =>
  new Date(instante.getTime() + MS_POR_DIA);

// Certo: opera sobre os campos civis no fuso alvo e deixa a conversao
// de volta para instante resolver a transicao.
export const partesCivis = (instante, fuso) => {
  const formatador = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const partes = Object.fromEntries(
    formatador.formatToParts(instante).map(({ type, value }) => [type, value]),
  );

  return {
    data: \`\${partes.year}-\${partes.month}-\${partes.day}\`,
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
  };
};

// Duracao real de um dia civil no fuso alvo. Retorna 23, 24 ou 25 horas.
// Qualquer media por hora que divida por 24 fixo erra nesses dois dias.
export const horasNoDiaCivil = (dataCivil, fuso) => {
  const inicio = inicioDoDiaCivil(dataCivil, fuso);
  const fim = inicioDoDiaCivil(somarDiasCivis(dataCivil, 1), fuso);
  return (fim.getTime() - inicio.getTime()) / (60 * 60 * 1000);
};

export const somarDiasCivis = (dataCivil, dias) => {
  const [ano, mes, dia] = dataCivil.split('-').map(Number);
  // Date.UTC faz aritmetica de calendario sem fuso envolvido: e seguro
  // porque aqui a data civil e apenas uma etiqueta, nao um instante.
  const movido = new Date(Date.UTC(ano, mes - 1, dia + dias));
  return movido.toISOString().slice(0, 10);
};

// Resolve a data civil local para o instante absoluto correspondente,
// tratando os dois casos patologicos da transicao.
export const inicioDoDiaCivil = (dataCivil, fuso) => {
  const palpite = new Date(\`\${dataCivil}T00:00:00Z\`);

  // Duas passagens: a primeira estima o deslocamento, a segunda corrige
  // quando a estimativa caiu do outro lado da transicao.
  let instante = palpite;
  for (let i = 0; i < 2; i += 1) {
    const local = partesCivis(instante, fuso);
    const deslocamentoMin =
      (Date.parse(\`\${local.data}T\${String(local.hora).padStart(2, '0')}:\${String(local.minuto).padStart(2, '0')}:00Z\`) -
        instante.getTime()) /
      60000;
    instante = new Date(palpite.getTime() - deslocamentoMin * 60000);
  }

  // Hora inexistente (relogio adiantou): o inicio do dia civil passa a
  // ser a primeira hora que de fato existiu naquele dia.
  const conferencia = partesCivis(instante, fuso);
  if (conferencia.data !== dataCivil) {
    return new Date(instante.getTime() + 60 * 60 * 1000);
  }

  return instante;
};`,
        },
        {
          type: 'paragraph',
          value:
            'A consequência menos óbvia é a comparação ano contra ano. Se o relatório compara o faturamento de uma segunda-feira com o da segunda-feira do ano anterior e uma das duas está dentro do horário de verão, as duas janelas cobrem quantidades diferentes de tempo real e a variação percentual embute um erro que não tem nada a ver com o negócio. A correção não é ajustar o número, é declarar no relatório qual janela foi usada e deixar visível quando as duas não têm a mesma duração.',
        },
      ],
    },
    {
      title: 'Guardar o instante e a competência: dois campos, dois propósitos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção que elimina a classe de erro em definitivo é parar de derivar o mês do instante no momento da consulta e passar a gravar a competência junto do registro. Isso parece redundância e não é: são duas informações diferentes. O instante diz quando a transação aconteceu na linha do tempo absoluta, e ele é imutável e auditável. A competência diz a qual período contábil aquela transação pertence, e essa é uma decisão de negócio que pode divergir do instante de propósito, como acontece com um lançamento feito no dia dois de outubro com competência de setembro porque o serviço foi prestado em setembro.',
        },
        {
          type: 'paragraph',
          value:
            'Com a competência gravada, o fechamento deixa de depender de fuso, de função de conversão e de configuração de sessão. Ele vira um filtro de igualdade sobre uma coluna indexada, que produz exatamente o mesmo número em qualquer região, em qualquer ferramenta, para qualquer pessoa. O fuso continua sendo usado no momento de decidir qual competência atribuir, que é onde a decisão pertence, e essa decisão é tomada uma vez, na escrita, por um código só, em vez de ser retomada em cada consulta por leitores que não sabem que estão tomando uma decisão.',
        },
        {
          type: 'code',
          value: `-- migrations/0042_competencia.sql
-- Separa o instante absoluto da competencia contabil. A competencia e
-- atribuida uma vez, na escrita, com o fuso da operacao explicito.

ALTER TABLE pagamentos
  ADD COLUMN competencia char(7),          -- 'AAAA-MM'
  ADD COLUMN fuso_operacao text NOT NULL   -- 'America/Sao_Paulo'
    DEFAULT 'America/Sao_Paulo';

-- Carga historica: deriva a competencia dos registros existentes usando
-- o fuso da operacao de cada um, nao um fuso unico para todos. Rodar em
-- lotes para nao segurar lock longo na tabela inteira.
UPDATE pagamentos
   SET competencia = to_char(pago_em AT TIME ZONE fuso_operacao, 'YYYY-MM')
 WHERE competencia IS NULL
   AND id IN (
     SELECT id FROM pagamentos WHERE competencia IS NULL
      ORDER BY id LIMIT 50000
   );

-- Depois da carga completa, a coluna vira obrigatoria e ganha indice.
ALTER TABLE pagamentos ALTER COLUMN competencia SET NOT NULL;
CREATE INDEX CONCURRENTLY idx_pagamentos_competencia
  ON pagamentos (competencia)
  WHERE estorno_em IS NULL;

-- Verificacao de consistencia: nenhum registro pode ter competencia que
-- diverge do instante em mais de um mes. Divergencia de ate um mes e
-- legitima (servico prestado em setembro, pago em outubro); mais do que
-- isso e sinal de carga historica com fuso errado.
SELECT competencia,
       to_char(pago_em AT TIME ZONE fuso_operacao, 'YYYY-MM') AS derivada,
       count(*)
  FROM pagamentos
 WHERE competencia <> to_char(pago_em AT TIME ZONE fuso_operacao, 'YYYY-MM')
 GROUP BY 1, 2
 ORDER BY 3 DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'O campo de fuso da operação é o detalhe que torna a carga histórica correta em vez de aproximada. Sem ele, a migração precisa assumir um fuso único para todos os registros, e essa suposição está errada para qualquer operação que atendeu mais de uma região. Com ele, cada linha carrega o contexto em que foi criada e a competência derivada é a que o time local teria atribuído. Quando esse dado não existe no histórico, a honestidade é derivar com o fuso predominante e marcar as linhas derivadas, para que uma conciliação futura saiba quais números são reconstruídos e quais são originais.',
        },
      ],
    },
    {
      title: 'Cinco verificações que detectam a corrupção antes do relatório',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A maior parte dos erros de fuso é detectável de forma automática e barata, porque eles têm assinaturas estatísticas muito específicas. O que falta não é capacidade de detecção, é alguém ter escrito a verificação. Estas cinco cobrem a grande maioria dos casos e rodam em segundos sobre uma tabela de milhões de linhas.',
        },
        {
          type: 'ordered',
          items: [
            'Soma dos meses contra o total do ano. Se os doze fechamentos mensais não somam exatamente o total anual calculado com o mesmo fuso, existe sobreposição ou buraco na fronteira e o culpado costuma ser um intervalo fechado nos dois lados.',
            'Histograma por hora local na virada do mês. Se as horas entre vinte e uma e vinte e três do último dia têm volume próximo de zero e a hora zero do primeiro dia do mês seguinte tem um pico, o recorte está em UTC enquanto o negócio opera em UTC menos três.',
            'Contagem de registros com competência divergente do instante em mais de trinta e um dias. Divergência pequena é legítima, divergência grande é carga histórica feita com o fuso errado.',
            'Duração dos dias civis agregados. Qualquer dia do conjunto que não tenha vinte e quatro horas precisa coincidir com uma transição conhecida de horário de verão naquele fuso; se não coincide, o identificador de fuso usado está desatualizado.',
            'Reexecução do fechamento com dois fusos diferentes. Se os totais são idênticos, a consulta está ignorando o parâmetro e provavelmente usando o fuso da sessão, o que é pior do que usar o fuso errado porque muda silenciosamente entre ambientes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quinta verificação é a mais valiosa e a menos intuitiva. Ela testa a consulta, não os dados, e detecta a falha mais perigosa dessa área: o parâmetro de fuso que existe na assinatura, aparece na documentação e não influencia o resultado. Uma consulta assim passa em toda revisão de código, porque o parâmetro está lá, e produz números diferentes conforme onde roda. Rodar o mesmo fechamento com dois fusos distantes e exigir que os totais sejam diferentes é um teste de duas linhas que fecha essa porta.',
        },
        {
          type: 'paragraph',
          value:
            'Vale também manter uma verificação sobre a base de dados de fusos do ambiente. As regras de fuso mudam por decisão política, com pouca antecedência, e um contêiner com a base congelada há dois anos converte corretamente para todo mundo, exceto para os países que mudaram a regra desde então. O sintoma é um deslocamento de exatamente uma hora que afeta só uma região e só a partir de uma data específica, e ele é praticamente impossível de diagnosticar sem suspeitar da base de fusos primeiro.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Guardar tudo em UTC não resolve o problema de uma vez?',
      answer:
        'Resolve a metade do problema que diz respeito ao armazenamento e não toca na metade que causa a divergência de relatório. Guardar instantes em UTC garante que dois registros gravados por máquinas em regiões diferentes sejam comparáveis entre si e que a ordem dos eventos seja preservada, o que é indispensável. Mas nenhum relatório de negócio pergunta quanto foi faturado em UTC: ele pergunta quanto foi faturado em setembro, e setembro é um conceito civil que só existe dentro de um fuso. O recorte continua precisando de um fuso explícito, e é exatamente aí que os dois números divergem. Existe ainda o caso em que UTC é a resposta errada até para o armazenamento, que são as datas civis puras e os agendamentos futuros. Converter a data de vencimento para um instante em UTC faz o vencimento andar um dia dependendo de onde o código roda, e converter uma reunião recorrente das nove da manhã para um instante fixo faz a reunião mudar de horário quando o país altera a regra de fuso, porque o que foi guardado é o instante e não a intenção. A regra prática é: instante em UTC, data civil como data sem hora, agendamento futuro como hora local mais identificador de fuso resolvido na execução.',
    },
    {
      question: 'Como corrigir relatórios históricos que já foram publicados com o recorte errado?',
      answer:
        'O primeiro passo é medir o tamanho do erro antes de decidir qualquer coisa, e a medida certa é o volume que cai dentro da janela de ambiguidade em cada período, não o total do período. Some apenas as transações entre a borda do recorte antigo e a borda do recorte correto: se isso representa menos de um décimo de por cento do mês e nenhum desses meses foi usado em declaração fiscal ou comunicação a investidor, republicar costuma gerar mais confusão do que corrige. O segundo passo, quando o valor é material, é nunca sobrescrever o número publicado: gere a série corrigida ao lado da original, com o fuso de recorte declarado em cada uma, e mantenha as duas acessíveis. Alguém vai encontrar uma apresentação antiga com o número antigo, e a única forma de essa pessoa não concluir que os dados estão quebrados é existir um registro explicando a diferença. O terceiro passo é congelar o passado: assim que a competência estiver gravada por registro, os fechamentos anteriores deixam de ser recalculáveis por consulta e passam a ser fatos guardados, o que impede que uma mudança futura de fuso mexa em número já auditado. Para o período anterior à existência do campo de competência, materialize o resultado em uma tabela de fechamento em vez de deixá-lo dependente da consulta.',
    },
    {
      question: 'Vale a pena usar uma biblioteca de datas ou dá para resolver com o que a linguagem oferece?',
      answer:
        'A resposta mudou nos últimos anos e depende mais do tipo de operação do que da linguagem. Para converter um instante em texto no fuso do usuário, a API de internacionalização nativa já resolve bem e não justifica dependência. Para aritmética de calendário, que é somar meses, encontrar o primeiro dia da semana ou resolver o início de um dia civil em um fuso, a API tradicional de data do JavaScript é insuficiente e propensa a erro, porque ela mistura instante e data civil no mesmo objeto e usa o fuso do ambiente como padrão implícito. Nesse caso, uma biblioteca com tipos separados para instante, data civil e hora local paga o próprio peso, e a API moderna de tempo que está chegando às plataformas adota justamente essa separação de tipos. O critério de escolha que importa mais do que o nome da biblioteca é este: ela precisa obrigar a passar o fuso explicitamente e falhar quando ele não é informado, em vez de assumir o fuso do ambiente em silêncio. Qualquer função que aceita fuso opcional com padrão implícito reintroduz o problema inteiro, porque o ambiente do servidor de produção nunca é o mesmo do laptop onde a consulta foi escrita. Vale ainda garantir que a base de regras de fuso seja atualizada junto com as dependências, porque uma biblioteca correta com uma base velha erra do mesmo jeito.',
    },
  ],
  conclusion: {
    title: 'O mês é um parâmetro, não um dado que já está no banco',
    description:
      'Relatório que discorda de relatório quase nunca é erro de conta: é a mesma soma feita sobre dois recortes que ninguém declarou. Posso revisar como o seu sistema representa tempo e definir a separação entre instante e data civil no esquema, a consulta de fechamento com fuso de recorte explícito e intervalo meio aberto, a gravação da competência na escrita para tornar o fechamento independente de fuso, o tratamento das transições de horário de verão na agregação por hora e por dia, e as verificações automáticas que detectam a divergência antes de o número chegar ao financeiro.',
    cta: 'Falar sobre o fechamento do meu relatório',
  },
  related: [
    {
      label: 'Relógio dessincronizado entre serviços: a ordem dos eventos que ninguém garante',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Multi-região com escrita única: quando a latência vira decisão de produto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'Finance closed September at four million two hundred thousand, the data team reported four million one hundred eighty-seven thousand, and the thirteen thousand gap showed up again in October with a different value. Nobody miscalculated: both were summing the same set of rows under two different definitions of what September is. This article shows why a time zone problem is not display conversion but interval definition, why storing everything in UTC solves half the problem and creates the other half, what the forty-eight hour sliding window is in which one sale belongs to two months at once, why daylight saving makes a day twenty-three or twenty-five hours long and what that breaks in hourly aggregation, what the difference is between an instant and a civil date and why mixing both types in one column is the root cause, how to write the closing query that produces the same number in any region, and which five checks catch the corruption before the report goes out.',
  sections: [
    {
      title: 'Two correct reports that disagree by thirteen thousand',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The conversation always starts the same way. Someone shows two numbers that should be identical and asks which one is wrong. The uncomfortable answer is that neither is wrong: they answer different questions that were written with the same words. The finance report asks how much was billed in the month of September in São Paulo time. The data dashboard asks how much was billed between the first instant of September in UTC and the last instant of September in UTC. Those are two distinct intervals, offset by three hours, and the difference between them is exactly the sales volume that happened in those three boundary hours.',
        },
        {
          type: 'paragraph',
          value:
            'What makes this mistake hard to find is that it produces no symptom at all most of the time. In a month with steady traffic, the gap is small enough to be mistaken for rounding or for a refunded sale. In a month with a campaign ending at midnight on the thirtieth, the gap explodes, because the last hour of a promotion concentrates a disproportionate volume and that hour falls right on the disputed boundary. That is why the problem first shows up in the month the business did well, not in the quiet month when someone would have had time to investigate.',
        },
        {
          type: 'diagram',
          value: `SEPTEMBER BOUNDARY, TWO DEFINITIONS

  Sao Paulo (UTC-3)        Sep 30 21:00 ---- Sep 30 23:59 ---- Oct 01 00:00
  UTC                      Oct 01 00:00 ---- Oct 01 02:59 ---- Oct 01 03:00

  Sale recorded at 2026-10-01T01:30:00Z
    -> in UTC:        October
    -> in Sao Paulo:  September 30, 22:30

  Finance report  (civil month in Sao Paulo):  the sale lands in September
  Data dashboard  (civil month in UTC):        the sale lands in October

  AMBIGUITY WINDOW PER CLOSING

    start: Sep 30 21:00 UTC
    end:   Oct 01 03:00 UTC
    span:  3h for UTC-3, up to 14h when a UTC+11 region is in the same report

  Every record inside that window belongs to two months at once, and the
  month it gets depends on which query read it first.`,
        },
        {
          type: 'paragraph',
          value:
            'The rule that comes out of this diagram holds for any period aggregation: the time zone is not a formatting property applied at the end, it is the parameter that defines which rows enter the sum. Changing the display time zone changes how a date looks on screen and changes no total. Changing the boundary time zone changes the set of rows being summed and therefore changes the total. Entire teams spend weeks addressing the first case when the problem is the second, because the word time zone is used for both.',
        },
      ],
    },
    {
      title: 'Instant and civil date are two different types in the same column',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The root cause is almost always in the schema, not in the query. There are two distinct temporal types and most databases let you store both in the same column without complaining. An instant is an absolute point on the timeline: the exact moment the payment was authorized. It is the same everywhere in the world and only makes sense compared to other instants. A civil date is a calendar label: the invoice due date, the accounting period, a date of birth. It has no associated instant, because a due date on the tenth is the tenth in any region, and forcing it into an instant is what makes a date of birth shift back a day when the server changes region.',
        },
        {
          type: 'paragraph',
          value:
            'When both types share columns with the same format, the difference disappears from the code and each reader applies whatever interpretation feels natural. The billing service reads the due date as an instant in UTC, converts it to the local zone and shows the ninth to the customer in a western state. The delinquency report reads the same column as a civil date and treats it as the tenth. Nobody wrote a bug: each side picked a defensible reading of a value that never declared which one was correct.',
        },
        {
          type: 'table',
          columns: ['Value', 'Correct type', 'What breaks with the wrong type'],
          rows: [
            [
              'Moment the payment was authorized',
              'Instant with zone (timestamptz)',
              'Event order inverted across regions and acquirer reconciliation that never matches',
            ],
            [
              'Invoice due date',
              'Civil date (date), no time',
              'Due date shifts a day when the server region changes',
            ],
            [
              'Accounting period of an entry',
              'Explicit year and month, not derived',
              'Entry migrates to another month when the query switches zone',
            ],
            [
              'Store opening hour',
              'Local time plus zone identifier',
              'Store opens at the wrong hour after a daylight saving change',
            ],
            [
              'Recurring future appointment',
              'Local time plus zone, resolved at execution',
              'The nine o clock meeting jumps to ten when the country changes the rule',
            ],
            [
              'Thirty day retention deadline',
              'Instant plus duration',
              'Deletion an hour early or late twice a year',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The decision that resolves the ambiguity is not picking a default zone, it is declaring the type in the name and in the schema. A column named paid_at of type timestamptz is unambiguously an instant. A column named due_on of type date is unambiguously a civil date. A column named date, of type timestamp without zone, is a trap that will cost someone an entire closing to discover. The cost of this correction is one type migration and a naming review, and it is the only one that removes the whole class of error instead of fixing one report at a time.',
        },
      ],
    },
    {
      title: 'The closing query that produces the same number in any region',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the right type in the schema, the closing query becomes a simple thing to express, as long as one rule is respected: the boundary time zone is an explicit query parameter, never a session setting inherited from the environment. A query that depends on the session zone produces one result on the analyst laptop, another on the reporting server and a third in the nightly job, and all three runs are equally defensible because none of them declared which month was being asked for.',
        },
        {
          type: 'code',
          value: `-- reports/monthly_close.sql
-- Monthly close with an explicit boundary time zone. The parameter is
-- not decoration: it defines which rows enter the sum, and two runs
-- with different zones produce different totals by definition.

-- WRONG: depends on the session zone, which differs across environments.
-- SELECT date_trunc('month', paid_at) AS month, sum(amount)
--   FROM payments GROUP BY 1;

-- RIGHT: converts the instant to the boundary zone before truncating,
-- and returns the interval used alongside the total so the number can
-- be audited without rerunning the query.
WITH params AS (
  SELECT
    $1::text AS zone,            -- 'America/Sao_Paulo'
    $2::date AS reference_month  -- '2026-09-01'
),
window_bounds AS (
  SELECT
    zone,
    reference_month,
    -- The local timestamp of the first instant of the month becomes an
    -- absolute instant by applying the zone. AT TIME ZONE over a
    -- zoneless timestamp yields timestamptz, which is what the index
    -- on paid_at compares against.
    (reference_month::timestamp AT TIME ZONE zone) AS starts_at,
    ((reference_month + interval '1 month')::timestamp AT TIME ZONE zone) AS ends_at
  FROM params
)
SELECT
  w.reference_month,
  w.zone,
  w.starts_at,
  w.ends_at,
  count(*)                          AS quantity,
  coalesce(sum(p.amount), 0)        AS total
FROM window_bounds w
LEFT JOIN payments p
  -- Half open comparison: includes the start, excludes the end. That is
  -- what stops the exact turnover instant from being counted in both
  -- months when the two reports run back to back.
  ON p.paid_at >= w.starts_at
 AND p.paid_at <  w.ends_at
 AND p.refunded_at IS NULL
GROUP BY w.reference_month, w.zone, w.starts_at, w.ends_at;`,
        },
        {
          type: 'paragraph',
          value:
            'Three details in that query carry almost all of the value. The first is that the conversion happens when computing the bounds and not on every row: applying the zone function over the column inside the WHERE disables the index and turns a two second close into a full table scan. The second is the half open interval, which is the only way to guarantee that consecutive months partition the set with no overlap and no hole. The third is returning the bounds alongside the total, because a closing number without the interval that generated it is not auditable and becomes exactly the thirteen thousand argument that motivated this article.',
        },
        {
          type: 'paragraph',
          value:
            'When the report has to sum operations from several regions at once, there is no single boundary zone that is correct. The way out is to decide the policy and write it down: either the whole group closes in headquarters time, and each branch accepts that its month ends at an odd local hour, or each branch closes in local time and the consolidated figure is the sum of local closings rather than a global cut. Both options are valid and produce different numbers. The mistake is not choosing, because then each query chooses on its own.',
        },
      ],
    },
    {
      title: 'Daylight saving: the day with twenty-three hours',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The daylight saving transition breaks an assumption that is spread across all temporal aggregation code: that a day has twenty-four hours and that adding twenty-four hours to an instant advances one civil day. On the day the clock springs forward, the local civil day has twenty-three hours and there is a local hour that simply did not happen. On the day it falls back, the day has twenty-five hours and there is a local hour that happened twice, with two distinct absolute instants mapping to the same hour text.',
        },
        {
          type: 'paragraph',
          value:
            'The practical symptom is an hourly sales chart with an empty bar or a bar with double the volume, twice a year, in countries that observe the practice. Since Brazil suspended daylight saving, teams commonly conclude the problem does not apply, and that conclusion is wrong for two reasons. The first is that historical data from before the suspension is still in the database and is still being re-aggregated by new queries. The second is that any customer, supplier or integration in a region that still observes the change brings the problem back through the edge, and in that case it only shows up in that customer slice, which is far harder to notice.',
        },
        {
          type: 'code',
          value: `// time/civil.js
// Calendar arithmetic is not millisecond arithmetic. Adding 24h to an
// instant advances 24 real hours, which is not always one civil day.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Wrong: assumes every day has 24h. On a daylight saving turnover the
// result lands on the same civil day or skips a whole day.
export const nextDayWrong = (instant) =>
  new Date(instant.getTime() + MS_PER_DAY);

// Right: operate on the civil fields in the target zone and let the
// conversion back to an instant resolve the transition.
export const civilParts = (instant, zone) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );

  return {
    date: \`\${parts.year}-\${parts.month}-\${parts.day}\`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
  };
};

// Real length of a civil day in the target zone. Returns 23, 24 or 25
// hours. Any hourly average dividing by a fixed 24 is wrong on those days.
export const hoursInCivilDay = (civilDate, zone) => {
  const starts = startOfCivilDay(civilDate, zone);
  const ends = startOfCivilDay(addCivilDays(civilDate, 1), zone);
  return (ends.getTime() - starts.getTime()) / (60 * 60 * 1000);
};

export const addCivilDays = (civilDate, days) => {
  const [year, month, day] = civilDate.split('-').map(Number);
  // Date.UTC does calendar arithmetic with no zone involved: safe here
  // because the civil date is just a label, not an instant.
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
};

// Resolves a local civil date to the matching absolute instant, handling
// both pathological cases of the transition.
export const startOfCivilDay = (civilDate, zone) => {
  const guess = new Date(\`\${civilDate}T00:00:00Z\`);

  // Two passes: the first estimates the offset, the second corrects it
  // when the estimate landed on the other side of the transition.
  let instant = guess;
  for (let i = 0; i < 2; i += 1) {
    const local = civilParts(instant, zone);
    const offsetMin =
      (Date.parse(\`\${local.date}T\${String(local.hour).padStart(2, '0')}:\${String(local.minute).padStart(2, '0')}:00Z\`) -
        instant.getTime()) /
      60000;
    instant = new Date(guess.getTime() - offsetMin * 60000);
  }

  // Nonexistent hour (clock sprang forward): the start of the civil day
  // becomes the first hour that actually existed on that day.
  const check = civilParts(instant, zone);
  if (check.date !== civilDate) {
    return new Date(instant.getTime() + 60 * 60 * 1000);
  }

  return instant;
};`,
        },
        {
          type: 'paragraph',
          value:
            'The less obvious consequence is the year over year comparison. If the report compares a Monday revenue with the same Monday a year earlier and one of them falls inside daylight saving, the two windows cover different amounts of real time and the percentage change embeds an error that has nothing to do with the business. The fix is not adjusting the number, it is declaring in the report which window was used and making it visible when the two do not have the same duration.',
        },
      ],
    },
    {
      title: 'Store the instant and the accounting period: two fields, two purposes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix that eliminates the class of error for good is to stop deriving the month from the instant at query time and start recording the accounting period alongside the record. It looks like redundancy and it is not: they are two different pieces of information. The instant says when the transaction happened on the absolute timeline, and it is immutable and auditable. The accounting period says which financial period that transaction belongs to, and that is a business decision that can deliberately diverge from the instant, as happens with an entry made on October second with a September period because the service was delivered in September.',
        },
        {
          type: 'paragraph',
          value:
            'With the period recorded, the close stops depending on a zone, on a conversion function and on a session setting. It becomes an equality filter over an indexed column, producing exactly the same number in any region, in any tool, for any person. The zone is still used when deciding which period to assign, which is where the decision belongs, and that decision is made once, at write time, by a single piece of code, instead of being retaken in every query by readers who do not know they are making a decision.',
        },
        {
          type: 'code',
          value: `-- migrations/0042_accounting_period.sql
-- Separates the absolute instant from the accounting period. The period
-- is assigned once, at write time, with the operating zone explicit.

ALTER TABLE payments
  ADD COLUMN accounting_period char(7),      -- 'YYYY-MM'
  ADD COLUMN operating_zone text NOT NULL    -- 'America/Sao_Paulo'
    DEFAULT 'America/Sao_Paulo';

-- Historical backfill: derives the period for existing records using
-- each row operating zone, not a single zone for all of them. Run in
-- batches to avoid holding a long lock over the whole table.
UPDATE payments
   SET accounting_period = to_char(paid_at AT TIME ZONE operating_zone, 'YYYY-MM')
 WHERE accounting_period IS NULL
   AND id IN (
     SELECT id FROM payments WHERE accounting_period IS NULL
      ORDER BY id LIMIT 50000
   );

-- After the backfill completes, the column becomes mandatory and indexed.
ALTER TABLE payments ALTER COLUMN accounting_period SET NOT NULL;
CREATE INDEX CONCURRENTLY idx_payments_accounting_period
  ON payments (accounting_period)
  WHERE refunded_at IS NULL;

-- Consistency check: no record may have a period diverging from the
-- instant by more than one month. Divergence up to one month is
-- legitimate (service delivered in September, paid in October); more
-- than that signals a backfill run with the wrong zone.
SELECT accounting_period,
       to_char(paid_at AT TIME ZONE operating_zone, 'YYYY-MM') AS derived,
       count(*)
  FROM payments
 WHERE accounting_period <> to_char(paid_at AT TIME ZONE operating_zone, 'YYYY-MM')
 GROUP BY 1, 2
 ORDER BY 3 DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'The operating zone field is the detail that makes the historical backfill correct rather than approximate. Without it, the migration has to assume a single zone for every record, and that assumption is wrong for any operation that served more than one region. With it, each row carries the context it was created in and the derived period is the one the local team would have assigned. When that value does not exist in the history, the honest move is to derive with the predominant zone and flag the derived rows, so a future reconciliation knows which numbers are reconstructed and which are original.',
        },
      ],
    },
    {
      title: 'Five checks that catch the corruption before the report',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Most time zone errors are detectable automatically and cheaply, because they have very specific statistical signatures. What is missing is not detection capability, it is someone having written the check. These five cover the vast majority of cases and run in seconds over a table with millions of rows.',
        },
        {
          type: 'ordered',
          items: [
            'Sum of months against the yearly total. If the twelve monthly closes do not add up exactly to the annual total computed with the same zone, there is overlap or a hole at the boundary and the culprit is usually an interval closed on both sides.',
            'Local hour histogram around the month turnover. If the hours between twenty-one and twenty-three on the last day have near zero volume and hour zero on the first day of the next month has a spike, the cut is in UTC while the business operates in UTC minus three.',
            'Count of records whose period diverges from the instant by more than thirty-one days. Small divergence is legitimate, large divergence is a backfill done with the wrong zone.',
            'Length of the aggregated civil days. Any day in the set that does not have twenty-four hours must coincide with a known daylight saving transition in that zone; if it does not, the zone database in use is outdated.',
            'Rerun the close with two different zones. If the totals are identical, the query is ignoring the parameter and probably using the session zone, which is worse than using the wrong zone because it changes silently across environments.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth check is the most valuable and the least intuitive. It tests the query, not the data, and catches the most dangerous failure in this area: a zone parameter that exists in the signature, appears in the documentation and does not influence the result. A query like that passes every code review, because the parameter is right there, and produces different numbers depending on where it runs. Running the same close with two distant zones and requiring the totals to differ is a two line test that closes that door.',
        },
        {
          type: 'paragraph',
          value:
            'It is also worth keeping a check on the environment time zone database. Zone rules change by political decision, with little notice, and a container with a database frozen two years ago converts correctly for everyone except the countries that changed the rule since then. The symptom is a shift of exactly one hour that affects only one region and only from a specific date onward, and it is practically impossible to diagnose without suspecting the zone database first.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does storing everything in UTC not solve the problem once and for all?',
      answer:
        'It solves the half of the problem that concerns storage and does not touch the half that causes report divergence. Storing instants in UTC guarantees that two records written by machines in different regions are comparable with each other and that event order is preserved, which is indispensable. But no business report asks how much was billed in UTC: it asks how much was billed in September, and September is a civil concept that only exists inside a time zone. The boundary still needs an explicit zone, and that is exactly where the two numbers diverge. There is also a case where UTC is the wrong answer even for storage, namely pure civil dates and future appointments. Converting a due date to a UTC instant makes the due date shift a day depending on where the code runs, and converting a recurring nine in the morning meeting to a fixed instant makes the meeting change time when the country alters its zone rule, because what was stored is the instant and not the intent. The practical rule is: instant in UTC, civil date as a date with no time, future appointment as local time plus zone identifier resolved at execution.',
    },
    {
      question: 'How do you fix historical reports already published with the wrong boundary?',
      answer:
        'The first step is measuring the size of the error before deciding anything, and the right measure is the volume falling inside the ambiguity window in each period, not the period total. Sum only the transactions between the old boundary and the correct boundary: if that represents less than a tenth of a percent of the month and none of those months was used in a tax filing or investor communication, republishing usually creates more confusion than it fixes. The second step, when the value is material, is never overwriting the published number: generate the corrected series alongside the original, with the boundary zone declared in each one, and keep both accessible. Someone will find an old deck with the old number, and the only way that person does not conclude the data is broken is for a record explaining the difference to exist. The third step is freezing the past: as soon as the accounting period is recorded per row, previous closes stop being recomputable by query and become stored facts, which prevents a future zone change from touching an already audited number. For the period before the period column existed, materialize the result into a closing table instead of leaving it dependent on the query.',
    },
    {
      question: 'Is a date library worth it or can this be solved with what the language offers?',
      answer:
        'The answer has changed in recent years and depends more on the kind of operation than on the language. To convert an instant into text in the user zone, the native internationalization API already works well and does not justify a dependency. For calendar arithmetic, which means adding months, finding the first day of the week or resolving the start of a civil day in a zone, the traditional JavaScript date API is insufficient and error prone, because it mixes instant and civil date in the same object and uses the environment zone as an implicit default. In that case, a library with separate types for instant, civil date and local time pays for its own weight, and the modern temporal API arriving in the platforms adopts exactly that type separation. The selection criterion that matters more than the library name is this: it must force the zone to be passed explicitly and fail when it is missing, instead of silently assuming the environment zone. Any function that accepts an optional zone with an implicit default reintroduces the whole problem, because the production server environment is never the same as the laptop where the query was written. It is also worth ensuring the zone rule database is updated along with dependencies, because a correct library with a stale database is wrong just the same.',
    },
  ],
  conclusion: {
    title: 'The month is a parameter, not a value already sitting in the database',
    description:
      'A report disagreeing with a report is almost never an arithmetic error: it is the same sum over two boundaries nobody declared. I can review how your system represents time and define the separation between instant and civil date in the schema, the closing query with an explicit boundary zone and a half open interval, recording the accounting period at write time to make the close zone independent, the handling of daylight saving transitions in hourly and daily aggregation, and the automated checks that catch the divergence before the number reaches finance.',
    cta: 'Talk about my report closing',
  },
  related: [
    {
      label: 'Clock drift between services: the event order nobody guarantees',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Multi-region with a single writer: when latency becomes a product decision',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Finanzas cerró septiembre con cuatro millones doscientos mil, el equipo de datos reportó cuatro millones ciento ochenta y siete mil, y la diferencia de trece mil volvió a aparecer en octubre con otro valor. Nadie se equivocó en la cuenta: los dos estaban sumando el mismo conjunto de filas con dos definiciones distintas de qué es septiembre. Este artículo muestra por qué el problema de zona horaria no es conversión de visualización sino definición de intervalo, por qué guardar todo en UTC resuelve la mitad del problema y crea la otra mitad, qué es la ventana deslizante de cuarenta y ocho horas en la que una misma venta pertenece a dos meses a la vez, por qué el horario de verano hace que un día tenga veintitrés o veinticinco horas y qué rompe eso en la agregación por hora, cuál es la diferencia entre instante y fecha civil y por qué mezclar los dos tipos en la misma columna es la causa raíz, cómo escribir la consulta de cierre que produce el mismo número en cualquier región, y qué cinco verificaciones detectan la corrupción antes de que salga el informe.',
  sections: [
    {
      title: 'Dos informes correctos que discrepan en trece mil',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La conversación siempre empieza igual. Alguien muestra dos números que deberían ser idénticos y pregunta cuál está mal. La respuesta incómoda es que ninguno de los dos está mal: responden preguntas distintas que se escribieron con las mismas palabras. El informe de finanzas pregunta cuánto se facturó en el mes de septiembre en horario de São Paulo. El panel de datos pregunta cuánto se facturó entre el primer instante de septiembre en UTC y el último instante de septiembre en UTC. Son dos intervalos distintos, desplazados tres horas, y la diferencia entre ellos es exactamente el volumen de ventas ocurrido en esas tres horas de frontera.',
        },
        {
          type: 'paragraph',
          value:
            'Lo que hace difícil encontrar este error es que no produce ningún síntoma la mayor parte del tiempo. En un mes de movimiento constante, la diferencia es lo bastante pequeña como para confundirse con un redondeo o con una venta anulada. En un mes con campaña que termina a medianoche del día treinta, la diferencia explota, porque la última hora de una promoción concentra un volumen desproporcionado y esa hora cae justo en la frontera disputada. Por eso el problema aparece primero en el mes en el que al negocio le fue bien, y no en el mes tranquilo en el que alguien habría tenido tiempo de investigar.',
        },
        {
          type: 'diagram',
          value: `FRONTERA DE SEPTIEMBRE, DOS DEFINICIONES

  Sao Paulo (UTC-3)        30/sep 21:00 ---- 30/sep 23:59 ---- 01/oct 00:00
  UTC                      01/oct 00:00 ---- 01/oct 02:59 ---- 01/oct 03:00

  Venta registrada en 2026-10-01T01:30:00Z
    -> en UTC:        octubre
    -> en Sao Paulo:  30 de septiembre, 22:30

  Informe financiero  (mes civil de Sao Paulo):  la venta entra en septiembre
  Panel de datos      (mes civil en UTC):        la venta entra en octubre

  VENTANA DE AMBIGUEDAD POR CIERRE

    inicio: 30/sep 21:00 UTC
    fin:    01/oct 03:00 UTC
    duracion: 3h para UTC-3, hasta 14h cuando hay una region UTC+11
              en el mismo informe

  Todo registro dentro de esa ventana pertenece a dos meses a la vez, y el
  mes que recibe depende de qué consulta lo leyo primero.`,
        },
        {
          type: 'paragraph',
          value:
            'La regla que sale de este esquema vale para cualquier agregación por período: la zona horaria no es una propiedad de formato aplicada al final, es el parámetro que define qué filas entran en la suma. Cambiar la zona de visualización cambia cómo aparece una fecha en pantalla y no cambia ningún total. Cambiar la zona del recorte cambia el conjunto de filas sumadas y, por lo tanto, cambia el total. Equipos enteros pierden semanas atendiendo el primer caso cuando el problema es el segundo, porque la palabra zona horaria se usa para los dos.',
        },
      ],
    },
    {
      title: 'Instante y fecha civil son dos tipos distintos en la misma columna',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La causa raíz casi siempre está en el esquema, no en la consulta. Existen dos tipos temporales distintos y la mayoría de las bases permite guardar los dos en la misma columna sin quejarse. El instante es un punto absoluto en la línea de tiempo: el momento exacto en que se autorizó el pago. Es el mismo en cualquier parte del mundo y solo tiene sentido comparado con otros instantes. La fecha civil es una etiqueta de calendario: la fecha de vencimiento de la factura, el día del período contable, la fecha de nacimiento. No tiene instante asociado, porque el vencimiento del día diez es el día diez en cualquier región, y forzarla a ser un instante es lo que hace que la fecha de nacimiento retroceda un día cuando el servidor cambia de región.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando los dos tipos ocupan columnas con el mismo formato, la diferencia desaparece del código y cada lector aplica la interpretación que le parezca natural. El servicio de cobranza lee la fecha de vencimiento como instante en UTC, la convierte a la zona local y le muestra el día nueve al cliente de una región occidental. El informe de morosidad lee la misma columna como fecha civil y considera el día diez. Nadie escribió un error: cada lado eligió una lectura defendible para un dato que nunca declaró cuál de ellas era la correcta.',
        },
        {
          type: 'table',
          columns: ['Dato', 'Tipo correcto', 'Qué se rompe con el tipo equivocado'],
          rows: [
            [
              'Momento del pago autorizado',
              'Instante con zona (timestamptz)',
              'Orden de eventos invertido entre regiones y conciliación con el adquirente que no cuadra',
            ],
            [
              'Fecha de vencimiento de la factura',
              'Fecha civil (date), sin hora',
              'El vencimiento se corre un día al cambiar la región del servidor',
            ],
            [
              'Período contable del asiento',
              'Año y mes explícitos, no derivados',
              'El asiento migra de mes cuando la consulta cambia de zona',
            ],
            [
              'Hora de apertura de la tienda',
              'Hora local más identificador de zona',
              'La tienda abre a la hora equivocada tras el horario de verano',
            ],
            [
              'Cita futura recurrente',
              'Hora local más zona, resuelta en la ejecución',
              'La reunión de las nueve salta a las diez cuando el país cambia la regla',
            ],
            [
              'Plazo de retención de treinta días',
              'Instante más duración',
              'Borrado adelantado o atrasado una hora dos veces al año',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La decisión que resuelve la ambigüedad no es elegir una zona por defecto, es declarar el tipo en el nombre y en el esquema. Una columna llamada pagado_en de tipo timestamptz es inequívocamente un instante. Una columna llamada vence_el de tipo date es inequívocamente una fecha civil. Una columna llamada fecha, de tipo timestamp sin zona, es una trampa que le va a costar a alguien un cierre entero descubrir. El costo de esta corrección es una migración de tipo y una revisión de nombres, y es la única que elimina la clase entera de error en lugar de corregir un informe a la vez.',
        },
      ],
    },
    {
      title: 'La consulta de cierre que produce el mismo número en cualquier región',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el tipo correcto en el esquema, la consulta de cierre pasa a ser un problema simple de expresar, siempre que se respete una regla: la zona del recorte es un parámetro explícito de la consulta, nunca una configuración de sesión heredada del entorno. Una consulta que depende de la zona de la sesión produce un resultado en el portátil del analista, otro en el servidor de informes y un tercero en el trabajo nocturno, y las tres ejecuciones son igualmente defendibles porque ninguna declaró qué mes se estaba pidiendo.',
        },
        {
          type: 'code',
          value: `-- reports/monthly_close.sql
-- Cierre mensual con zona de recorte explicita. El parametro no es
-- decoracion: define que filas entran en la suma, y dos ejecuciones con
-- zonas distintas producen totales distintos por definicion.

-- MAL: depende de la zona de la sesion, que cambia entre entornos.
-- SELECT date_trunc('month', pagado_en) AS mes, sum(importe)
--   FROM pagos GROUP BY 1;

-- BIEN: convierte el instante a la zona del recorte antes de truncar y
-- devuelve el intervalo usado junto al total para que el numero pueda
-- auditarse sin reejecutar la consulta.
WITH parametros AS (
  SELECT
    $1::text AS zona,            -- 'America/Sao_Paulo'
    $2::date AS mes_referencia   -- '2026-09-01'
),
ventana AS (
  SELECT
    zona,
    mes_referencia,
    -- El timestamp local del primer instante del mes se vuelve instante
    -- absoluto al aplicar la zona. AT TIME ZONE sobre un timestamp sin
    -- zona produce timestamptz, que es lo que compara el indice de
    -- pagado_en.
    (mes_referencia::timestamp AT TIME ZONE zona) AS inicio,
    ((mes_referencia + interval '1 month')::timestamp AT TIME ZONE zona) AS fin
  FROM parametros
)
SELECT
  v.mes_referencia,
  v.zona,
  v.inicio,
  v.fin,
  count(*)                        AS cantidad,
  coalesce(sum(p.importe), 0)     AS total
FROM ventana v
LEFT JOIN pagos p
  -- Comparacion semiabierta: incluye el inicio, excluye el fin. Es lo
  -- que impide que el instante exacto del cambio se cuente en los dos
  -- meses cuando los dos informes se ejecutan seguidos.
  ON p.pagado_en >= v.inicio
 AND p.pagado_en <  v.fin
 AND p.anulado_en IS NULL
GROUP BY v.mes_referencia, v.zona, v.inicio, v.fin;`,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles de esa consulta concentran casi todo el valor. El primero es que la conversión ocurre al calcular los bordes y no en cada fila: aplicar la función de zona sobre la columna dentro del WHERE deshabilita el índice y convierte un cierre de dos segundos en un recorrido de tabla completa. El segundo es el intervalo semiabierto, que es la única forma de garantizar que meses consecutivos particionen el conjunto sin solapamiento y sin hueco. El tercero es devolver los bordes junto al total, porque un número de cierre sin el intervalo que lo generó no es auditable y se convierte exactamente en la discusión de trece mil que motivó este artículo.',
        },
        {
          type: 'paragraph',
          value:
            'Cuando el informe tiene que sumar operaciones de varias regiones a la vez, no existe una zona de recorte única que sea correcta. La salida es decidir la política y escribirla: o el grupo entero cierra en la zona de la matriz, y cada filial acepta que su mes termina a una hora local rara, o cada filial cierra en zona local y el consolidado es la suma de los cierres locales, no un recorte global. Las dos opciones son válidas y producen números distintos. El error es no elegir, porque entonces cada consulta elige por su cuenta.',
        },
      ],
    },
    {
      title: 'Horario de verano: el día que tiene veintitrés horas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La transición de horario de verano rompe una suposición que está repartida por todo el código de agregación temporal: que un día tiene veinticuatro horas y que sumar veinticuatro horas a un instante avanza un día civil. El día en que el reloj se adelanta, el día civil local tiene veintitrés horas y existe una hora local que sencillamente no ocurrió. El día en que se atrasa, el día tiene veinticinco horas y existe una hora local que ocurrió dos veces, con dos instantes absolutos distintos que se asignan al mismo texto de hora.',
        },
        {
          type: 'paragraph',
          value:
            'El síntoma práctico es un gráfico de ventas por hora con una barra vacía o una barra con el doble de volumen, dos veces al año, en países que aplican la práctica. Como Brasil suspendió el horario de verano, es común que el equipo concluya que el problema no aplica, y esa conclusión es errónea por dos motivos. El primero es que los datos históricos anteriores a la suspensión siguen en la base y siguen siendo reagregados por consultas nuevas. El segundo es que cualquier cliente, proveedor o integración en una región que todavía aplica el cambio trae el problema de vuelta por el borde, y en ese caso aparece solo en la porción de ese cliente, lo que es mucho más difícil de notar.',
        },
        {
          type: 'code',
          value: `// time/civil.js
// La aritmetica de calendario no es aritmetica de milisegundos. Sumar
// 24h a un instante avanza 24h reales, que no siempre es un dia civil.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Mal: asume que todo dia tiene 24h. En el cambio de horario de verano
// el resultado cae en el mismo dia civil o salta un dia entero.
export const siguienteDiaMal = (instante) =>
  new Date(instante.getTime() + MS_POR_DIA);

// Bien: opera sobre los campos civiles en la zona destino y deja que la
// conversion de vuelta a instante resuelva la transicion.
export const partesCiviles = (instante, zona) => {
  const formateador = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const partes = Object.fromEntries(
    formateador.formatToParts(instante).map(({ type, value }) => [type, value]),
  );

  return {
    fecha: \`\${partes.year}-\${partes.month}-\${partes.day}\`,
    hora: Number(partes.hour) % 24,
    minuto: Number(partes.minute),
  };
};

// Duracion real de un dia civil en la zona destino. Devuelve 23, 24 o 25
// horas. Cualquier promedio por hora que divida por 24 fijo se equivoca
// en esos dos dias.
export const horasEnDiaCivil = (fechaCivil, zona) => {
  const inicio = inicioDelDiaCivil(fechaCivil, zona);
  const fin = inicioDelDiaCivil(sumarDiasCiviles(fechaCivil, 1), zona);
  return (fin.getTime() - inicio.getTime()) / (60 * 60 * 1000);
};

export const sumarDiasCiviles = (fechaCivil, dias) => {
  const [anio, mes, dia] = fechaCivil.split('-').map(Number);
  // Date.UTC hace aritmetica de calendario sin zona involucrada: es
  // seguro porque aqui la fecha civil es solo una etiqueta, no un
  // instante.
  const movida = new Date(Date.UTC(anio, mes - 1, dia + dias));
  return movida.toISOString().slice(0, 10);
};

// Resuelve la fecha civil local al instante absoluto correspondiente,
// tratando los dos casos patologicos de la transicion.
export const inicioDelDiaCivil = (fechaCivil, zona) => {
  const tentativa = new Date(\`\${fechaCivil}T00:00:00Z\`);

  // Dos pasadas: la primera estima el desplazamiento, la segunda corrige
  // cuando la estimacion cayo del otro lado de la transicion.
  let instante = tentativa;
  for (let i = 0; i < 2; i += 1) {
    const local = partesCiviles(instante, zona);
    const desplazamientoMin =
      (Date.parse(\`\${local.fecha}T\${String(local.hora).padStart(2, '0')}:\${String(local.minuto).padStart(2, '0')}:00Z\`) -
        instante.getTime()) /
      60000;
    instante = new Date(tentativa.getTime() - desplazamientoMin * 60000);
  }

  // Hora inexistente (el reloj se adelanto): el inicio del dia civil pasa
  // a ser la primera hora que de hecho existio ese dia.
  const verificacion = partesCiviles(instante, zona);
  if (verificacion.fecha !== fechaCivil) {
    return new Date(instante.getTime() + 60 * 60 * 1000);
  }

  return instante;
};`,
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia menos obvia es la comparación año contra año. Si el informe compara la facturación de un lunes con la del lunes del año anterior y una de las dos está dentro del horario de verano, las dos ventanas cubren cantidades distintas de tiempo real y la variación porcentual incorpora un error que no tiene nada que ver con el negocio. La corrección no es ajustar el número, es declarar en el informe qué ventana se usó y dejar visible cuándo las dos no tienen la misma duración.',
        },
      ],
    },
    {
      title: 'Guardar el instante y el período contable: dos campos, dos propósitos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección que elimina la clase de error de forma definitiva es dejar de derivar el mes del instante en el momento de la consulta y pasar a grabar el período contable junto al registro. Parece redundancia y no lo es: son dos informaciones distintas. El instante dice cuándo ocurrió la transacción en la línea de tiempo absoluta, y es inmutable y auditable. El período contable dice a qué período financiero pertenece esa transacción, y esa es una decisión de negocio que puede divergir del instante a propósito, como ocurre con un asiento hecho el dos de octubre con período de septiembre porque el servicio se prestó en septiembre.',
        },
        {
          type: 'paragraph',
          value:
            'Con el período grabado, el cierre deja de depender de la zona, de la función de conversión y de la configuración de sesión. Se convierte en un filtro de igualdad sobre una columna indexada, que produce exactamente el mismo número en cualquier región, en cualquier herramienta, para cualquier persona. La zona sigue usándose al decidir qué período asignar, que es donde pertenece la decisión, y esa decisión se toma una vez, en la escritura, por un solo trozo de código, en lugar de retomarse en cada consulta por lectores que no saben que están tomando una decisión.',
        },
        {
          type: 'code',
          value: `-- migrations/0042_periodo_contable.sql
-- Separa el instante absoluto del periodo contable. El periodo se asigna
-- una vez, en la escritura, con la zona de la operacion explicita.

ALTER TABLE pagos
  ADD COLUMN periodo_contable char(7),      -- 'AAAA-MM'
  ADD COLUMN zona_operacion text NOT NULL   -- 'America/Sao_Paulo'
    DEFAULT 'America/Sao_Paulo';

-- Carga historica: deriva el periodo de los registros existentes usando
-- la zona de operacion de cada uno, no una zona unica para todos.
-- Ejecutar por lotes para no mantener un bloqueo largo sobre la tabla.
UPDATE pagos
   SET periodo_contable = to_char(pagado_en AT TIME ZONE zona_operacion, 'YYYY-MM')
 WHERE periodo_contable IS NULL
   AND id IN (
     SELECT id FROM pagos WHERE periodo_contable IS NULL
      ORDER BY id LIMIT 50000
   );

-- Tras completar la carga, la columna pasa a ser obligatoria e indexada.
ALTER TABLE pagos ALTER COLUMN periodo_contable SET NOT NULL;
CREATE INDEX CONCURRENTLY idx_pagos_periodo_contable
  ON pagos (periodo_contable)
  WHERE anulado_en IS NULL;

-- Verificacion de consistencia: ningun registro puede tener un periodo
-- que diverja del instante en mas de un mes. Una divergencia de hasta un
-- mes es legitima (servicio prestado en septiembre, pagado en octubre);
-- mas que eso es senal de carga historica con la zona equivocada.
SELECT periodo_contable,
       to_char(pagado_en AT TIME ZONE zona_operacion, 'YYYY-MM') AS derivado,
       count(*)
  FROM pagos
 WHERE periodo_contable <> to_char(pagado_en AT TIME ZONE zona_operacion, 'YYYY-MM')
 GROUP BY 1, 2
 ORDER BY 3 DESC;`,
        },
        {
          type: 'paragraph',
          value:
            'El campo de zona de la operación es el detalle que hace que la carga histórica sea correcta en lugar de aproximada. Sin él, la migración tiene que asumir una zona única para todos los registros, y esa suposición es errónea para cualquier operación que atendió más de una región. Con él, cada fila lleva el contexto en el que fue creada y el período derivado es el que el equipo local habría asignado. Cuando ese dato no existe en el histórico, lo honesto es derivar con la zona predominante y marcar las filas derivadas, para que una conciliación futura sepa qué números son reconstruidos y cuáles son originales.',
        },
      ],
    },
    {
      title: 'Cinco verificaciones que detectan la corrupción antes del informe',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La mayor parte de los errores de zona horaria es detectable de forma automática y barata, porque tienen firmas estadísticas muy específicas. Lo que falta no es capacidad de detección, es que alguien haya escrito la verificación. Estas cinco cubren la gran mayoría de los casos y se ejecutan en segundos sobre una tabla de millones de filas.',
        },
        {
          type: 'ordered',
          items: [
            'Suma de los meses contra el total del año. Si los doce cierres mensuales no suman exactamente el total anual calculado con la misma zona, hay solapamiento o hueco en la frontera y el culpable suele ser un intervalo cerrado por los dos lados.',
            'Histograma por hora local en el cambio de mes. Si las horas entre las veintiuna y las veintitrés del último día tienen volumen cercano a cero y la hora cero del primer día del mes siguiente tiene un pico, el recorte está en UTC mientras el negocio opera en UTC menos tres.',
            'Conteo de registros con período que diverge del instante en más de treinta y un días. Una divergencia pequeña es legítima, una divergencia grande es carga histórica hecha con la zona equivocada.',
            'Duración de los días civiles agregados. Cualquier día del conjunto que no tenga veinticuatro horas debe coincidir con una transición conocida de horario de verano en esa zona; si no coincide, la base de zonas en uso está desactualizada.',
            'Reejecución del cierre con dos zonas distintas. Si los totales son idénticos, la consulta está ignorando el parámetro y probablemente usando la zona de la sesión, lo que es peor que usar la zona equivocada porque cambia en silencio entre entornos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La quinta verificación es la más valiosa y la menos intuitiva. Prueba la consulta, no los datos, y detecta el fallo más peligroso de esta área: el parámetro de zona que existe en la firma, aparece en la documentación y no influye en el resultado. Una consulta así pasa cualquier revisión de código, porque el parámetro está ahí, y produce números distintos según dónde se ejecute. Ejecutar el mismo cierre con dos zonas distantes y exigir que los totales sean distintos es una prueba de dos líneas que cierra esa puerta.',
        },
        {
          type: 'paragraph',
          value:
            'También conviene mantener una verificación sobre la base de datos de zonas del entorno. Las reglas de zona cambian por decisión política, con poca antelación, y un contenedor con la base congelada hace dos años convierte correctamente para todo el mundo, excepto para los países que cambiaron la regla desde entonces. El síntoma es un desplazamiento de exactamente una hora que afecta solo a una región y solo a partir de una fecha concreta, y es prácticamente imposible de diagnosticar sin sospechar antes de la base de zonas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Guardar todo en UTC no resuelve el problema de una vez?',
      answer:
        'Resuelve la mitad del problema que corresponde al almacenamiento y no toca la mitad que causa la divergencia de informes. Guardar instantes en UTC garantiza que dos registros escritos por máquinas en regiones distintas sean comparables entre sí y que el orden de los eventos se preserve, lo cual es indispensable. Pero ningún informe de negocio pregunta cuánto se facturó en UTC: pregunta cuánto se facturó en septiembre, y septiembre es un concepto civil que solo existe dentro de una zona. El recorte sigue necesitando una zona explícita, y ahí es exactamente donde los dos números divergen. Existe además el caso en que UTC es la respuesta equivocada incluso para el almacenamiento, que son las fechas civiles puras y las citas futuras. Convertir la fecha de vencimiento a un instante en UTC hace que el vencimiento se corra un día según dónde se ejecute el código, y convertir una reunión recurrente de las nueve de la mañana a un instante fijo hace que la reunión cambie de hora cuando el país altera la regla de zona, porque lo que se guardó es el instante y no la intención. La regla práctica es: instante en UTC, fecha civil como fecha sin hora, cita futura como hora local más identificador de zona resuelto en la ejecución.',
    },
    {
      question: '¿Cómo corregir informes históricos que ya se publicaron con el recorte equivocado?',
      answer:
        'El primer paso es medir el tamaño del error antes de decidir nada, y la medida correcta es el volumen que cae dentro de la ventana de ambigüedad en cada período, no el total del período. Sume solo las transacciones entre el borde del recorte antiguo y el borde del recorte correcto: si eso representa menos de una décima de por ciento del mes y ninguno de esos meses se usó en una declaración fiscal o en comunicación a inversores, republicar suele generar más confusión de la que corrige. El segundo paso, cuando el valor es material, es no sobrescribir nunca el número publicado: genere la serie corregida junto a la original, con la zona de recorte declarada en cada una, y mantenga las dos accesibles. Alguien va a encontrar una presentación antigua con el número antiguo, y la única forma de que esa persona no concluya que los datos están rotos es que exista un registro explicando la diferencia. El tercer paso es congelar el pasado: en cuanto el período contable esté grabado por registro, los cierres anteriores dejan de ser recalculables por consulta y pasan a ser hechos guardados, lo que impide que un cambio futuro de zona toque un número ya auditado. Para el período anterior a la existencia de la columna de período, materialice el resultado en una tabla de cierre en lugar de dejarlo dependiente de la consulta.',
    },
    {
      question: '¿Vale la pena usar una biblioteca de fechas o se puede resolver con lo que ofrece el lenguaje?',
      answer:
        'La respuesta ha cambiado en los últimos años y depende más del tipo de operación que del lenguaje. Para convertir un instante en texto en la zona del usuario, la API de internacionalización nativa ya resuelve bien y no justifica una dependencia. Para aritmética de calendario, que es sumar meses, encontrar el primer día de la semana o resolver el inicio de un día civil en una zona, la API tradicional de fechas de JavaScript es insuficiente y propensa a errores, porque mezcla instante y fecha civil en el mismo objeto y usa la zona del entorno como valor por defecto implícito. En ese caso, una biblioteca con tipos separados para instante, fecha civil y hora local paga su propio peso, y la API moderna de tiempo que está llegando a las plataformas adopta justamente esa separación de tipos. El criterio de elección que importa más que el nombre de la biblioteca es este: tiene que obligar a pasar la zona explícitamente y fallar cuando no se informa, en lugar de asumir la zona del entorno en silencio. Cualquier función que acepta zona opcional con valor por defecto implícito reintroduce el problema entero, porque el entorno del servidor de producción nunca es el mismo que el del portátil donde se escribió la consulta. Conviene además garantizar que la base de reglas de zona se actualice junto con las dependencias, porque una biblioteca correcta con una base vieja se equivoca igual.',
    },
  ],
  conclusion: {
    title: 'El mes es un parámetro, no un dato que ya está en la base',
    description:
      'Un informe que discrepa de otro informe casi nunca es un error de cuenta: es la misma suma hecha sobre dos recortes que nadie declaró. Puedo revisar cómo su sistema representa el tiempo y definir la separación entre instante y fecha civil en el esquema, la consulta de cierre con zona de recorte explícita e intervalo semiabierto, la grabación del período contable en la escritura para que el cierre sea independiente de la zona, el tratamiento de las transiciones de horario de verano en la agregación por hora y por día, y las verificaciones automáticas que detectan la divergencia antes de que el número llegue a finanzas.',
    cta: 'Hablar sobre el cierre de mi informe',
  },
  related: [
    {
      label: 'Reloj desincronizado entre servicios: el orden de los eventos que nadie garantiza',
      to: '/blog/relogio-dessincronizado-entre-servicos-ordem-dos-eventos',
    },
    {
      label: 'Multirregión con escritura única: cuándo la latencia se vuelve decisión de producto',
      to: '/blog/multi-regiao-escrita-unica-latencia-vira-decisao-de-produto',
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
