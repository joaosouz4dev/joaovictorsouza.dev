// Conteudo do artigo: feature flag que virou divida, removendo a bandeira sem
// quebrar producao.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'A busca por uma flag específica no código retornou setenta e quatro ocorrências e a data do commit que a criou era de vinte e dois meses atrás. O rollout terminou em uma semana, a variante nova ganhou, e ninguém voltou para apagar a chave. Esse é o estado normal de quase todo sistema que adotou flags: a ferramenta que existe para reduzir risco de deploy acumula um passivo que multiplica o número de caminhos possíveis do código a cada release. Este artigo mostra por que a flag esquecida é uma dívida com juros compostos e não apenas um if morto, por que a decisão de remover depende de dado de avaliação e não de memória de quem estava no time, qual é a ordem de remoção que não quebra a requisição que está em voo neste exato momento, por que o kill switch nunca deve entrar na mesma fila de limpeza que a flag de rollout, e qual verificação automática impede que a próxima flag repita o ciclo.',
  sections: [
    {
      title: 'A flag esquecida não é um if morto, é um multiplicador de estados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O argumento mais comum contra a limpeza é que a flag desligada não custa nada, porque a condição resolve em falso e o corpo nunca executa. O custo real não está no tempo de execução, está no número de estados que o sistema declara suportar. Cada flag booleana viva dobra o espaço de combinação do código que ela envolve, e como as flags não são independentes entre si, dez flags ativas descrevem mil vinte e quatro configurações possíveis. Nenhum time testa mil vinte e quatro configurações. O que acontece na prática é que uma dúzia de combinações é exercitada em produção e o restante existe apenas como promessa não verificada dentro do repositório.',
        },
        {
          type: 'paragraph',
          value:
            'A consequência aparece quando alguém precisa mudar o código adjacente. O engenheiro que abre o arquivo dois anos depois não sabe se a variante antiga ainda tem tráfego, não sabe se pode apagar o ramo do else, e o caminho mais barato para ele é preservar os dois lados e adicionar o terceiro. É assim que a dívida cresce sem que ninguém tome uma decisão errada isoladamente: cada escolha individual de preservar o desconhecido é razoável, e a soma delas produz um arquivo onde ninguém mais consegue afirmar o que está em produção.',
        },
        {
          type: 'paragraph',
          value:
            'Existe ainda um custo que aparece só no incidente e que é o mais caro dos três. Quando algo quebra às duas da manhã, a primeira pergunta é qual código o cliente afetado estava executando, e a resposta depende de resolver o estado de todas as flags que atravessam aquele caminho para aquele usuário naquele instante. Com flags limpas, isso é ler o arquivo. Com setenta flags vivas e histórico de valores não retido, isso é uma investigação que consome o tempo do incidente inteiro antes de qualquer diagnóstico começar.',
        },
        {
          type: 'table',
          columns: ['Tipo de flag', 'Vida esperada', 'Sinal de que virou dívida', 'Destino correto'],
          rows: [
            [
              'Rollout de release',
              'Dias a semanas',
              'Cem por cento em uma variante há mais de um ciclo',
              'Remover código e chave',
            ],
            [
              'Experimento A/B',
              'Duração do teste',
              'Análise já publicada e decisão tomada',
              'Remover o braço perdedor e a chave',
            ],
            [
              'Kill switch operacional',
              'Permanente por design',
              'Nunca acionada e sem teste de acionamento',
              'Manter, documentar e exercitar',
            ],
            [
              'Permissão por plano ou cliente',
              'Permanente por design',
              'Regra de negócio escondida em serviço de flags',
              'Mover para autorização, sair do sistema de flags',
            ],
            [
              'Configuração de ambiente',
              'Permanente',
              'Valor idêntico em todos os ambientes há meses',
              'Fixar no código e remover a chave',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tabela existe porque o erro mais frequente na limpeza não é esquecer de remover, é remover a coisa errada. Um kill switch de dependência externa passa anos sem ser acionado e parece exatamente igual a uma flag de rollout esquecida quando você olha só a telemetria de uso. A diferença não está no dado, está na intenção declarada no momento da criação, e é por isso que o tipo precisa ser um campo obrigatório da flag e não uma convenção de nome.',
        },
      ],
    },
    {
      title: 'Decidir com dado de avaliação, não com memória do time',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A pergunta que trava a remoção é sempre a mesma: alguém ainda depende disso? Responder por memória não funciona porque a pessoa que criou a flag frequentemente já saiu do time, e responder por busca no código também não, porque a busca mostra onde a flag é lida e não quem a está recebendo como verdadeira. A única resposta confiável vem de instrumentar a própria avaliação, registrando cada consulta com a chave, o valor retornado, o motivo da decisão e o identificador do sujeito avaliado.',
        },
        {
          type: 'paragraph',
          value:
            'O campo mais importante desses quatro é o motivo, e é o que costuma faltar nas implementações caseiras. Saber que a flag retornou verdadeiro dez mil vezes não diz nada sobre poder removê-la. Saber que retornou verdadeiro dez mil vezes por causa da regra padrão e zero vez por causa de uma regra de segmento diz que o segmento pode ser apagado agora. Saber que retornou falso um milhão de vezes por causa do padrão e trinta e sete vezes por causa de uma lista nominal de clientes diz que existem trinta e sete contratos que quebram se você apagar o ramo antigo.',
        },
        {
          type: 'code',
          value: `// flags/evaluate.js
// A avaliacao emite telemetria com o MOTIVO da decisao, nao so o valor.
// Sem o motivo, "retornou true 10k vezes" nao autoriza remover nada:
// pode ser a regra padrao ou uma regra de segmento com 3 clientes presos.

const REASONS = {
  DEFAULT: 'default',    // caiu no valor padrao da flag
  SEGMENT: 'segment',    // bateu numa regra de segmento
  OVERRIDE: 'override',  // override explicito por sujeito
  KILL_SWITCH: 'kill',   // desligada manualmente pela operacao
  MISSING: 'missing',    // chave nao existe mais no provedor
};

export const createFlagClient = ({ store, metrics, clock }) => {
  const evaluate = (key, subject) => {
    const definition = store.get(key);

    // Chave removida do provedor mas ainda lida pelo codigo. Este e o
    // caminho que produz o incidente silencioso: o fallback assume um
    // valor e ninguem percebe ate o comportamento divergir em producao.
    if (!definition) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.MISSING });
      return { value: false, reason: REASONS.MISSING };
    }

    if (definition.killed) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.KILL_SWITCH });
      return { value: false, reason: REASONS.KILL_SWITCH };
    }

    const override = definition.overrides?.[subject.id];
    if (override !== undefined) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(override),
        reason: REASONS.OVERRIDE,
      });
      return { value: override, reason: REASONS.OVERRIDE, subjectId: subject.id };
    }

    const segment = definition.segments?.find((rule) => rule.matches(subject));
    if (segment) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(segment.value),
        reason: REASONS.SEGMENT,
        segment: segment.name,
      });
      return { value: segment.value, reason: REASONS.SEGMENT, segment: segment.name };
    }

    metrics.increment('flag.evaluation', {
      key,
      value: String(definition.defaultValue),
      reason: REASONS.DEFAULT,
    });
    return { value: definition.defaultValue, reason: REASONS.DEFAULT };
  };

  // O relatorio de candidatas nao pergunta "ha quanto tempo a flag existe",
  // pergunta "ha quantos dias so existe uma resposta e ela vem do padrao".
  const removalCandidates = ({ window }) => {
    const since = clock.now() - window;

    return store.keys().flatMap((key) => {
      const definition = store.get(key);

      // Kill switch e permissao sao excluidos ANTES da analise. Eles sao
      // justamente os que retornam sempre o mesmo valor, e sem esta linha
      // o relatorio poe no topo da lista o disjuntor do provedor de pagamento.
      if (definition.type === 'kill_switch' || definition.type === 'permission') return [];

      const stats = metrics.query('flag.evaluation', { key, since });
      if (stats.length === 0) return [];

      const distinctValues = new Set(stats.map((row) => row.value));
      const nonDefaultReasons = stats.filter((row) => row.reason !== REASONS.DEFAULT);

      if (distinctValues.size !== 1) return [];
      if (nonDefaultReasons.length > 0) return [];

      return [{ key, winner: [...distinctValues][0], evaluations: stats.length }];
    });
  };

  return { evaluate, removalCandidates, REASONS };
};`,
        },
        {
          type: 'paragraph',
          value:
            'O detalhe do relatório que costuma ser subestimado é a exclusão explícita de kill switches e permissões antes de qualquer análise estatística. Sem essa linha, o relatório coloca no topo da lista exatamente as flags que nunca devem ser removidas, porque elas são justamente as que retornam sempre o mesmo valor. Um time que confia num relatório sem esse filtro apaga o disjuntor da integração de pagamento no primeiro ciclo de limpeza e descobre o problema no próximo incidente do provedor.',
        },
        {
          type: 'paragraph',
          value:
            'A janela de observação também merece um critério explícito em vez de um número redondo. Ela precisa cobrir pelo menos um ciclo completo do processo mais lento que toca aquele caminho, o que na maioria dos sistemas significa o fechamento mensal ou o relatório trimestral. Uma flag que atende um fluxo executado uma vez por mês parece morta em qualquer janela de duas semanas, e apagá-la produz uma falha que só aparece trinta dias depois do merge, quando ninguém mais associa o incidente à limpeza.',
        },
      ],
    },
    {
      title: 'A ordem de remoção que não quebra a requisição em voo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A tentação é resolver tudo em um pull request só: apaga o if, apaga o ramo perdedor, apaga a chave no provedor e fecha o ticket. Isso funciona no ambiente local e falha em produção pela mesma razão que uma migração de banco sem etapas falha. Durante o deploy existem instâncias antigas ainda respondendo, requisições que já leram a flag e ainda não terminaram, e consumidores de fila que capturaram o valor no início do lote. Remover a chave do provedor antes de remover a leitura no código deixa o código antigo caindo no caminho de chave inexistente, que resolve pelo valor de fallback e não necessariamente pelo valor que estava em produção.',
        },
        {
          type: 'diagram',
          value: `ORDEM ERRADA (um PR so)

  apaga chave no provedor + apaga if + apaga ramo antigo
        |
        v
  instancias antigas ainda vivas leem chave inexistente
        |
        v
  fallback assume false, ramo perdedor volta a rodar
  por 3 minutos, sem alerta, sem rastro


ORDEM CORRETA (tres passos, cada um reversivel)

  P1  codigo    fixa a leitura no valor vencedor
                constante local no lugar da consulta
                chave AINDA existe no provedor
                rollback = reverter o commit

  P2  codigo    remove o if, o ramo perdedor e os
                testes exclusivos do ramo perdedor
                chave AINDA existe, agora sem leitor
                rollback = reverter o commit

  P3  provedor  arquiva a chave apos a janela de
                retencao, com metrica de avaliacao
                em zero durante toda a janela
                rollback = restaurar a definicao

  ^ em nenhum passo existe codigo vivo lendo chave ausente`,
        },
        {
          type: 'paragraph',
          value:
            'O primeiro passo é o que quase todo time pula e é o que torna os outros dois seguros. Fixar o valor vencedor no código, mantendo a chave viva no provedor, cria uma janela em que o comportamento novo é permanente mas a reversão ainda é um revert de commit e não uma mudança de configuração sob pressão. Se algo estava dependendo do ramo antigo por um caminho que a telemetria não capturou, o sintoma aparece nessa janela e o custo é um revert, não um incidente com dado inconsistente.',
        },
        {
          type: 'paragraph',
          value:
            'Entre o segundo e o terceiro passo é obrigatório esperar, e o critério de espera é o tempo de vida do processo mais longo que pode ter capturado o valor. Em um serviço web isso é o tempo de drenagem do deploy, em minutos. Em um consumidor de fila que processa lotes grandes isso pode ser meia hora. Em um job agendado que roda semanalmente isso é uma semana. Arquivar a chave enquanto um consumidor antigo ainda está no meio de um lote produz exatamente o cenário do diagrama, com a diferença de que na fila o efeito é gravado no banco em vez de devolvido numa resposta HTTP.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar no relatório de avaliação que a flag tem valor único e motivo padrão durante a janela que cobre o processo mais lento do domínio.',
            'Fixar o valor vencedor no código com uma constante local, mantendo a chave existente no provedor, e fazer deploy.',
            'Observar a janela de drenagem completa, verificando que a taxa de erro e as métricas de negócio do caminho afetado não mudaram.',
            'Remover o condicional, o ramo perdedor, os testes exclusivos do ramo perdedor e a constante local, em um pull request separado.',
            'Confirmar que a métrica de avaliação daquela chave caiu a zero e permaneceu em zero pela janela inteira.',
            'Arquivar a chave no provedor, mantendo a definição por um período de retenção antes da exclusão definitiva.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O quinto item é o único que oferece prova em vez de confiança. Enquanto a métrica de avaliação daquela chave não chegar a zero e permanecer em zero pela janela inteira, existe pelo menos um caller vivo, e ele pode ser um serviço que ninguém mapeou, um script de operação ou um cliente móvel com versão antiga. Arquivar antes disso é trocar uma limpeza de código por uma investigação futura de causa desconhecida.',
        },
      ],
    },
    {
      title: 'O que fazer quando a flag está espalhada em setenta lugares',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A flag que aparece em setenta e quatro lugares não é uma flag, é uma decisão arquitetural implementada como condicional distribuído. Tratar cada ocorrência como item de checklist produz um pull request gigantesco que ninguém revisa com atenção, e revisar mal é justamente o modo mais fácil de apagar o ramo errado em três dos setenta e quatro pontos. A abordagem que funciona é reduzir o número de pontos de decisão antes de tentar remover qualquer coisa.',
        },
        {
          type: 'paragraph',
          value:
            'A redução acontece em duas fases. Primeiro, todas as leituras dispersas são substituídas por uma única leitura no ponto de entrada do fluxo, e o valor resolvido passa a viajar como parte do contexto da requisição. Isso não remove nenhuma condicional ainda, mas transforma setenta e quatro avaliações independentes em uma avaliação e setenta e três leituras de um valor imutável, o que já elimina a classe de bug em que a flag muda no meio da requisição. Segundo, com a decisão centralizada, o polimorfismo substitui a condicional: duas implementações da mesma interface, escolhidas uma vez, e o corpo do código deixa de saber que a flag existe.',
        },
        {
          type: 'code',
          value: `// ANTES: 74 pontos consultam a flag de forma independente.
// Alem de ilegivel, a flag pode mudar no meio da requisicao e produzir
// uma execucao que seguiu os dois caminhos ao mesmo tempo.
function calcularFrete(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.cotar(pedido);
  }
  return motorAntigo.cotar(pedido);
}

function estimarPrazo(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.prazo(pedido);
  }
  return motorAntigo.prazo(pedido);
}

// DEPOIS, FASE 1: uma avaliacao na borda, valor congelado no contexto.
// As 74 condicionais continuam existindo, mas agora leem um valor
// imutavel em vez de consultar o provedor 74 vezes por requisicao.
export const resolverContexto = (req, { flags }) => ({
  cliente: req.cliente,
  motorFrete: flags.enabled('novo_motor_frete', req.cliente) ? 'novo' : 'antigo',
});

// DEPOIS, FASE 2: a decisao vira selecao de implementacao, uma vez so.
// O corpo do dominio nao sabe mais que existe uma flag, e a remocao
// futura e apagar uma linha do mapa, nao 74 condicionais.
const MOTORES = { novo: motorNovo, antigo: motorAntigo };

export const criarServicoFrete = (contexto) => {
  const motor = MOTORES[contexto.motorFrete];

  return {
    cotar: (pedido) => motor.cotar(pedido),
    prazo: (pedido) => motor.prazo(pedido),
  };
};

// FASE 3, quando o relatorio autorizar: o mapa perde a entrada antiga,
// resolverContexto perde a linha da flag, e motorAntigo sai do
// repositorio inteiro em vez de sair em 74 diffs espalhados.`,
        },
        {
          type: 'paragraph',
          value:
            'A objeção legítima a essa sequência é que ela transforma uma limpeza em uma refatoração, e refatoração custa tempo que o time não tem. O contra-argumento é que a alternativa não é uma limpeza barata, é um pull request de setenta e quatro pontos que o revisor aprova por cansaço. A refatoração intermediária tem uma propriedade que o pull request gigante não tem: cada passo é individualmente revisável, individualmente reversível, e deixa o sistema em estado válido mesmo se o time abandonar a limpeza no meio, o que acontece com frequência.',
        },
      ],
    },
    {
      title: 'A limpeza que se sustenta sozinha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Toda equipe que acumulou dívida de flags já tentou resolver com um mutirão, e o mutirão funciona uma vez. Seis meses depois o número volta ao patamar anterior porque o processo que gerou a dívida continua igual. O que muda o resultado não é a intensidade da limpeza, é tornar a criação da flag um evento que já carrega a data da própria remoção.',
        },
        {
          type: 'paragraph',
          value:
            'Isso significa exigir três campos obrigatórios no momento da criação, sem os quais o cadastro é recusado: o tipo, que separa rollout de kill switch e determina se a flag entra na fila de limpeza; a data de expiração esperada, que é uma estimativa e não um contrato; e o dono, que precisa ser um time e nunca uma pessoa, porque pessoas mudam de time e a flag continua. Nenhum desses campos impede a dívida sozinho, mas juntos eles transformam a pergunta de alguém sabe se isso ainda é usado em uma consulta.',
        },
        {
          type: 'paragraph',
          value:
            'A automação que faltava vem em seguida e é modesta de propósito. Uma verificação no pipeline que falha sempre que existe flag de rollout vencida produz atrito no momento errado, porque bloqueia um deploy sem nenhuma relação com a flag em questão. O que funciona é o alerta semanal para o time dono, com a lista de flags vencidas e o dado de avaliação de cada uma, mais um bloqueio no pipeline apenas para o caso específico da flag órfã, quando o time dono não existe mais.',
        },
        {
          type: 'code',
          value: `// scripts/flag-debt-report.mjs
// Roda semanalmente e abre uma issue por time dono, nunca uma issue
// gigante com tudo. A lista precisa caber numa sprint para ser lida.

import { createFlagClient } from '../src/flags/evaluate.js';
import { store, metrics, equipesAtivas, abrirIssue } from './deps.mjs';

const DIA = 24 * 60 * 60 * 1000;

const client = createFlagClient({ store, metrics, clock: { now: () => Date.now() } });

// Janela de 45 dias: cobre um fechamento mensal completo mais margem.
// Com 14 dias, todo fluxo mensal aparece como morto e a limpeza gera
// um incidente 30 dias depois do merge.
const candidatas = client.removalCandidates({ window: 45 * DIA });

const definicoes = candidatas.map(({ key, winner, evaluations }) => {
  const def = store.get(key);

  return {
    key,
    winner,
    evaluations,
    owner: def.owner,
    idadeDias: Math.floor((Date.now() - def.createdAt) / DIA),
    vencida: def.expiresAt != null && Date.now() > def.expiresAt,
  };
});

// Flag orfa: o time dono nao existe mais no diretorio da organizacao.
// Esta e a unica categoria que bloqueia o pipeline, porque nao existe
// destinatario para o alerta semanal.
const orfas = definicoes.filter((flag) => !equipesAtivas.has(flag.owner));

if (orfas.length > 0) {
  console.error(\`Flags sem time dono ativo: \${orfas.map((f) => f.key).join(', ')}\`);
  process.exitCode = 1;
}

const porTime = definicoes.reduce((acc, flag) => {
  const lista = acc.get(flag.owner) ?? [];
  lista.push(flag);
  return acc.set(flag.owner, lista);
}, new Map());

for (const [owner, flags] of porTime) {
  const vencidas = flags.filter((flag) => flag.vencida);
  if (vencidas.length === 0) continue;

  await abrirIssue({
    time: owner,
    titulo: \`\${vencidas.length} feature flags prontas para remocao\`,
    corpo: vencidas
      .map(
        (flag) =>
          \`- \${flag.key}: valor unico "\${flag.winner}" em \${flag.evaluations} \` +
          \`avaliacoes, \${flag.idadeDias} dias de idade, motivo padrao em 100% das leituras\`,
      )
      .join('\\n'),
  });
}`,
        },
        {
          type: 'list',
          items: [
            'O relatório é por time dono e nunca uma lista única, porque uma lista de oitenta itens não é acionável e uma de seis é.',
            'A janela de análise cobre o processo mais lento do domínio, não um número redondo de dias escolhido por conveniência.',
            'Kill switches e permissões são excluídos antes da análise, não filtrados depois por revisão humana.',
            'O único bloqueio de pipeline é a flag órfã, porque nesse caso não existe destinatário para o alerta.',
            'A data de expiração é tratada como estimativa que gera conversa, não como contrato que gera bloqueio automático.',
          ],
        },
      ],
    },
    {
      title: 'Provar que a remoção não mudou comportamento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A parte que fecha o ciclo é a que garante que apagar o condicional produziu exatamente o mesmo comportamento que a flag ligada produzia. A intuição diz que isso é trivial porque o código do ramo vencedor não mudou, e a intuição erra em dois pontos específicos: o valor de fallback quando a chave some, que raramente é igual ao valor que estava em produção, e os efeitos colaterais que existiam apenas dentro do bloco condicional, como logs, contadores e caches que outros trechos consomem.',
        },
        {
          type: 'paragraph',
          value:
            'O teste que pega os dois casos é uma comparação de saída entre a versão com a flag forçada em verdadeiro e a versão já limpa, rodando sobre o mesmo conjunto de entradas. Ele é barato porque não precisa de provedor de flags nem de rede, e é a única evidência objetiva de que o pull request de remoção é neutro.',
        },
        {
          type: 'code',
          value: `// test/remocao-flag-novo-motor-frete.test.js
// Compara a saida do codigo COM a flag forcada em true contra a saida do
// codigo JA LIMPO. Rodar antes do merge do PR de remocao e descartar
// depois: e um teste de transicao, nao de regressao permanente.

import { calcularFreteLegado } from './fixtures/frete-com-flag.js';
import { criarServicoFrete } from '../src/frete/servico.js';
import { pedidosDeAmostra } from './fixtures/pedidos.js';

describe('remocao da flag novo_motor_frete e neutra', () => {
  it('produz a mesma cotacao para toda a amostra de pedidos', () => {
    const servicoLimpo = criarServicoFrete({ motorFrete: 'novo' });

    for (const pedido of pedidosDeAmostra) {
      const antes = calcularFreteLegado(pedido, { flagLigada: true });
      const depois = servicoLimpo.cotar(pedido);

      expect(depois).toEqual(antes);
    }
  });

  it('mantem os efeitos colaterais que estavam dentro do condicional', () => {
    // O ramo da flag incrementava um contador que o painel de operacao
    // consome. Apagar o if apaga o contador junto, e o grafico vira uma
    // linha reta em zero que ninguem associa a limpeza de flag.
    const metricas = [];
    const servico = criarServicoFrete(
      { motorFrete: 'novo' },
      { metrics: { increment: (nome) => metricas.push(nome) } },
    );

    servico.cotar(pedidosDeAmostra[0]);

    expect(metricas).toContain('frete.cotacao');
  });

  it('nao consulta mais o provedor de flags', () => {
    // Se qualquer caminho do servico limpo ainda ler a flag, este stub
    // estoura. E a prova de que a leitura saiu do caminho de execucao e
    // nao apenas de que ela retorna sempre o mesmo valor.
    const provedorProibido = {
      enabled: () => {
        throw new Error('o servico limpo nao pode consultar flags');
      },
    };

    const servico = criarServicoFrete({ motorFrete: 'novo' }, { flags: provedorProibido });

    expect(() => servico.cotar(pedidosDeAmostra[0])).not.toThrow();
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'A segunda asserção é a que mais paga por si mesma e a que quase nunca é escrita. Métricas emitidas de dentro do bloco condicional desaparecem junto com o bloco, e o efeito visível não é um erro e sim um gráfico que vira uma linha reta em zero. Ninguém associa isso à limpeza de flag três semanas depois, e o painel de operação perde um sinal permanentemente porque o alerta configurado em cima dele nunca mais dispara.',
        },
        {
          type: 'paragraph',
          value:
            'A terceira asserção protege contra a limpeza pela metade, que é o resultado mais comum quando o pull request é grande. Um caminho que continua consultando o provedor é indistinguível de um caminho limpo em qualquer teste de saída, porque o provedor devolve o valor certo. Ele só se revela no dia em que a chave for arquivada, e nesse dia o comportamento muda sem nenhum deploy associado, que é a pior forma possível de descobrir um problema.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual o número saudável de flags ativas por serviço?',
      answer:
        'A pergunta pelo número absoluto leva a uma meta arbitrária que o time contorna renomeando categorias, e o que importa é a composição da lista e não o tamanho dela. Um serviço com quarenta flags onde trinta e cinco são kill switches documentados e cinco são rollouts com menos de trinta dias está mais saudável que um serviço com doze flags onde nove são rollouts de mais de um ano. A métrica que funciona é a idade mediana das flags de rollout, porque ela captura exatamente o comportamento que se quer mudar: se a mediana está em nove dias, o processo de remoção está funcionando; se está em oito meses, existe uma dívida crescendo independente do total ser doze ou quarenta. A segunda métrica útil é a proporção de flags sem time dono ativo, que deveria ser zero e que na prática revela o quanto o cadastro virou formalidade. Vale acompanhar também quantas flags foram criadas contra quantas foram removidas no trimestre, porque um saldo positivo persistente diz que o processo não se sustenta, mesmo que o total absoluto ainda pareça confortável.',
    },
    {
      question: 'Como remover uma flag quando o ramo antigo ainda tem clientes específicos?',
      answer:
        'Esse é o caso em que a resposta correta não é remover, e reconhecer isso cedo economiza semanas. Uma flag que serve uma lista nominal de clientes deixou de ser flag de rollout e virou regra de negócio, e o problema não é a limpeza e sim que a regra está no lugar errado. A movimentação correta é migrar a condição para onde ela pertence, que geralmente é o modelo de autorização ou o cadastro de plano do cliente, deixando o código de domínio consultar uma capacidade nomeada em vez de uma chave de flag. Isso não reduz o número de caminhos no código, mas muda a natureza da dívida: uma capacidade de plano é uma decisão de produto documentada, com dono claro e ciclo de vida próprio, enquanto uma flag esquecida com trinta e sete clientes na lista é uma regra de negócio que só existe na configuração de uma ferramenta de deploy. Depois da migração a chave de flag é removida pelo procedimento normal, porque nesse ponto ela realmente não tem mais leitor. Se a lista tiver poucos clientes e o ramo antigo for caro de manter, existe ainda a opção de negociar a migração desses contratos, mas essa é uma conversa comercial que precisa acontecer antes e não durante o pull request de limpeza.',
    },
    {
      question: 'Vale a pena manter o código do ramo antigo em algum lugar depois da remoção?',
      answer:
        'Não, e a intuição contrária vem de confundir preservar informação com preservar código executável. O histórico do Git já mantém o ramo antigo integralmente, com contexto de quando foi escrito, por quem e junto de qual mudança, e recuperá-lo é uma operação de segundos. Manter o código no repositório em um arquivo de legado ou atrás de uma flag permanentemente desligada tem custo contínuo e valor nulo: ele aparece em toda busca, é lido por quem tenta entender o fluxo, precisa continuar compilando quando as dependências mudam de assinatura e é atualizado por refatorações automáticas que ninguém revisa com atenção porque o código está morto. Pior, se ele fica atrás de uma flag desligada, ele apodrece sem que ninguém perceba, e no dia em que alguém ligar a flag para tentar um rollback de emergência o código que roda não é mais aquele que funcionava, é aquele que sobreviveu a dezoito meses de mudanças não testadas. A prática que resolve a ansiedade legítima por trás da pergunta é registrar no commit de remoção o hash do commit anterior e um resumo do que o ramo antigo fazia, o que dá um ponto de partida imediato para quem precisar consultar sem manter nada vivo no repositório.',
    },
  ],
  conclusion: {
    title: 'A flag só termina quando o código dela sai do repositório',
    description:
      'A ferramenta que existe para reduzir risco de deploy vira, em dezoito meses, o maior obstáculo para entender o que está em produção. A saída não é um mutirão de limpeza, é tratar a remoção como parte do rollout e não como um trabalho separado que nunca é priorizado. Posso instrumentar a avaliação das flags do seu sistema com motivo e sujeito, montar o relatório que separa candidatas reais de kill switches, desenhar a sequência de remoção em três passos que não quebra requisição em voo, refatorar as flags espalhadas para um ponto único de decisão e deixar o alerta semanal por time dono funcionando sem virar ruído.',
    cta: 'Falar sobre a dívida de feature flags do meu sistema',
  },
  related: [
    {
      label: 'Feature flag em fluxo de agente: ligar comportamento novo para poucos',
      to: '/blog/feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos',
    },
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'Searching the codebase for one specific flag returned seventy-four occurrences, and the commit that created it was twenty-two months old. The rollout finished in a week, the new variant won, and nobody went back to delete the key. This is the normal state of almost every system that adopted flags: the tool that exists to reduce deploy risk accumulates a liability that multiplies the number of possible code paths with every release. This article shows why a forgotten flag is debt with compound interest and not just a dead if, why the decision to remove depends on evaluation data and not on the memory of whoever was on the team, which removal order does not break the request that is in flight right now, why a kill switch must never enter the same cleanup queue as a rollout flag, and which automated check stops the next flag from repeating the cycle.',
  sections: [
    {
      title: 'A forgotten flag is not a dead if, it is a state multiplier',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common argument against cleanup is that a disabled flag costs nothing, because the condition resolves to false and the body never runs. The real cost is not in execution time, it is in the number of states the system declares it supports. Every live boolean flag doubles the combination space of the code it wraps, and since flags are not independent from one another, ten active flags describe one thousand and twenty-four possible configurations. No team tests one thousand and twenty-four configurations. What happens in practice is that a dozen combinations get exercised in production and the rest exist only as an unverified promise inside the repository.',
        },
        {
          type: 'paragraph',
          value:
            'The consequence shows up when someone needs to change the adjacent code. The engineer who opens the file two years later does not know whether the old variant still gets traffic, does not know whether the else branch can be deleted, and the cheapest path for them is to preserve both sides and add a third. That is how the debt grows without anyone making a wrong decision in isolation: each individual choice to preserve the unknown is reasonable, and their sum produces a file where nobody can state what is actually in production anymore.',
        },
        {
          type: 'paragraph',
          value:
            'There is a third cost that only shows up during an incident and it is the most expensive of the three. When something breaks at two in the morning, the first question is which code the affected customer was running, and the answer depends on resolving the state of every flag that crosses that path for that user at that instant. With clean flags, that means reading the file. With seventy live flags and no retained value history, that is an investigation that consumes the entire incident window before any diagnosis even starts.',
        },
        {
          type: 'table',
          columns: ['Flag type', 'Expected lifetime', 'Sign it became debt', 'Correct destination'],
          rows: [
            [
              'Release rollout',
              'Days to weeks',
              'One hundred percent on one variant for more than one cycle',
              'Remove code and key',
            ],
            [
              'A/B experiment',
              'Duration of the test',
              'Analysis already published and decision made',
              'Remove the losing arm and the key',
            ],
            [
              'Operational kill switch',
              'Permanent by design',
              'Never triggered and never exercised in a test',
              'Keep, document and exercise',
            ],
            [
              'Plan or customer entitlement',
              'Permanent by design',
              'Business rule hidden inside a flag service',
              'Move to authorization, out of the flag system',
            ],
            [
              'Environment configuration',
              'Permanent',
              'Identical value across all environments for months',
              'Hardcode it and remove the key',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The table exists because the most frequent mistake in cleanup is not forgetting to remove, it is removing the wrong thing. A kill switch for an external dependency goes years without being triggered and looks exactly like a forgotten rollout flag when you only look at usage telemetry. The difference is not in the data, it is in the intent declared at creation time, and that is why the type has to be a mandatory field on the flag and not a naming convention.',
        },
      ],
    },
    {
      title: 'Decide with evaluation data, not with team memory',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The question that stalls removal is always the same: does anyone still depend on this? Answering from memory does not work because whoever created the flag has often already left the team, and answering by searching the code does not work either, because the search shows where the flag is read and not who is receiving it as true. The only reliable answer comes from instrumenting the evaluation itself, recording every lookup with the key, the returned value, the reason for the decision and the identifier of the evaluated subject.',
        },
        {
          type: 'paragraph',
          value:
            'The most important of those four fields is the reason, and it is the one usually missing from homegrown implementations. Knowing that the flag returned true ten thousand times says nothing about whether it can be removed. Knowing it returned true ten thousand times because of the default rule and zero times because of a segment rule says the segment can be deleted now. Knowing it returned false a million times because of the default and thirty-seven times because of a named customer list says there are thirty-seven contracts that break if you delete the old branch.',
        },
        {
          type: 'code',
          value: `// flags/evaluate.js
// A avaliacao emite telemetria com o MOTIVO da decisao, nao so o valor.
// Sem o motivo, "retornou true 10k vezes" nao autoriza remover nada:
// pode ser a regra padrao ou uma regra de segmento com 3 clientes presos.

const REASONS = {
  DEFAULT: 'default',    // caiu no valor padrao da flag
  SEGMENT: 'segment',    // bateu numa regra de segmento
  OVERRIDE: 'override',  // override explicito por sujeito
  KILL_SWITCH: 'kill',   // desligada manualmente pela operacao
  MISSING: 'missing',    // chave nao existe mais no provedor
};

export const createFlagClient = ({ store, metrics, clock }) => {
  const evaluate = (key, subject) => {
    const definition = store.get(key);

    // Chave removida do provedor mas ainda lida pelo codigo. Este e o
    // caminho que produz o incidente silencioso: o fallback assume um
    // valor e ninguem percebe ate o comportamento divergir em producao.
    if (!definition) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.MISSING });
      return { value: false, reason: REASONS.MISSING };
    }

    if (definition.killed) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.KILL_SWITCH });
      return { value: false, reason: REASONS.KILL_SWITCH };
    }

    const override = definition.overrides?.[subject.id];
    if (override !== undefined) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(override),
        reason: REASONS.OVERRIDE,
      });
      return { value: override, reason: REASONS.OVERRIDE, subjectId: subject.id };
    }

    const segment = definition.segments?.find((rule) => rule.matches(subject));
    if (segment) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(segment.value),
        reason: REASONS.SEGMENT,
        segment: segment.name,
      });
      return { value: segment.value, reason: REASONS.SEGMENT, segment: segment.name };
    }

    metrics.increment('flag.evaluation', {
      key,
      value: String(definition.defaultValue),
      reason: REASONS.DEFAULT,
    });
    return { value: definition.defaultValue, reason: REASONS.DEFAULT };
  };

  // O relatorio de candidatas nao pergunta "ha quanto tempo a flag existe",
  // pergunta "ha quantos dias so existe uma resposta e ela vem do padrao".
  const removalCandidates = ({ window }) => {
    const since = clock.now() - window;

    return store.keys().flatMap((key) => {
      const definition = store.get(key);

      // Kill switch e permissao sao excluidos ANTES da analise. Eles sao
      // justamente os que retornam sempre o mesmo valor, e sem esta linha
      // o relatorio poe no topo da lista o disjuntor do provedor de pagamento.
      if (definition.type === 'kill_switch' || definition.type === 'permission') return [];

      const stats = metrics.query('flag.evaluation', { key, since });
      if (stats.length === 0) return [];

      const distinctValues = new Set(stats.map((row) => row.value));
      const nonDefaultReasons = stats.filter((row) => row.reason !== REASONS.DEFAULT);

      if (distinctValues.size !== 1) return [];
      if (nonDefaultReasons.length > 0) return [];

      return [{ key, winner: [...distinctValues][0], evaluations: stats.length }];
    });
  };

  return { evaluate, removalCandidates, REASONS };
};`,
        },
        {
          type: 'paragraph',
          value:
            'The detail of the report that usually gets underestimated is the explicit exclusion of kill switches and entitlements before any statistical analysis. Without that line, the report puts at the top of the list exactly the flags that must never be removed, because they are precisely the ones that always return the same value. A team that trusts a report without that filter deletes the payment integration breaker in the first cleanup cycle and discovers the problem during the provider next outage.',
        },
        {
          type: 'paragraph',
          value:
            'The observation window also deserves an explicit criterion instead of a round number. It has to cover at least one full cycle of the slowest process that touches that path, which in most systems means the monthly close or the quarterly report. A flag serving a flow that runs once a month looks dead in any two-week window, and deleting it produces a failure that only shows up thirty days after the merge, when nobody associates the incident with the cleanup anymore.',
        },
      ],
    },
    {
      title: 'The removal order that does not break the in-flight request',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The temptation is to solve everything in a single pull request: delete the if, delete the losing branch, delete the key in the provider and close the ticket. That works locally and fails in production for the same reason a database migration without stages fails. During the deploy there are old instances still responding, requests that already read the flag and have not finished, and queue consumers that captured the value at the start of the batch. Removing the key from the provider before removing the read from the code leaves the old code falling into the missing-key path, which resolves to the fallback value and not necessarily to the value that was in production.',
        },
        {
          type: 'diagram',
          value: `ORDEM ERRADA (um PR so)

  apaga chave no provedor + apaga if + apaga ramo antigo
        |
        v
  instancias antigas ainda vivas leem chave inexistente
        |
        v
  fallback assume false, ramo perdedor volta a rodar
  por 3 minutos, sem alerta, sem rastro


ORDEM CORRETA (tres passos, cada um reversivel)

  P1  codigo    fixa a leitura no valor vencedor
                constante local no lugar da consulta
                chave AINDA existe no provedor
                rollback = reverter o commit

  P2  codigo    remove o if, o ramo perdedor e os
                testes exclusivos do ramo perdedor
                chave AINDA existe, agora sem leitor
                rollback = reverter o commit

  P3  provedor  arquiva a chave apos a janela de
                retencao, com metrica de avaliacao
                em zero durante toda a janela
                rollback = restaurar a definicao

  ^ em nenhum passo existe codigo vivo lendo chave ausente`,
        },
        {
          type: 'paragraph',
          value:
            'The first step is the one almost every team skips and it is what makes the other two safe. Pinning the winning value in the code while keeping the key alive in the provider creates a window where the new behavior is permanent but reverting is still a commit revert and not a configuration change under pressure. If something was depending on the old branch through a path telemetry did not capture, the symptom shows up in that window and the cost is a revert, not an incident with inconsistent data.',
        },
        {
          type: 'paragraph',
          value:
            'Between the second and the third step waiting is mandatory, and the waiting criterion is the lifetime of the longest process that may have captured the value. In a web service that is the deploy drain time, in minutes. In a queue consumer processing large batches it can be half an hour. In a scheduled job that runs weekly it is a week. Archiving the key while an old consumer is still in the middle of a batch produces exactly the diagram scenario, with the difference that in the queue the effect gets written to the database instead of returned in an HTTP response.',
        },
        {
          type: 'ordered',
          items: [
            'Confirm in the evaluation report that the flag has a single value and the default reason during a window that covers the slowest process in the domain.',
            'Pin the winning value in the code with a local constant, keeping the key in the provider, and deploy.',
            'Observe the full drain window, checking that the error rate and the business metrics of the affected path did not change.',
            'Remove the conditional, the losing branch, the tests exclusive to the losing branch and the local constant, in a separate pull request.',
            'Confirm that the evaluation metric for that key dropped to zero and stayed at zero for the entire window.',
            'Archive the key in the provider, keeping the definition for a retention period before final deletion.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fifth item is the only one that offers proof instead of confidence. As long as the evaluation metric for that key has not reached zero and stayed at zero for the whole window, there is at least one live caller, and it may be a service nobody mapped, an operations script or a mobile client on an old version. Archiving before that trades a code cleanup for a future investigation with an unknown cause.',
        },
      ],
    },
    {
      title: 'What to do when the flag is spread across seventy places',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A flag that appears in seventy-four places is not a flag, it is an architectural decision implemented as a distributed conditional. Treating every occurrence as a checklist item produces a giant pull request nobody reviews carefully, and reviewing badly is precisely the easiest way to delete the wrong branch in three of the seventy-four spots. The approach that works is to reduce the number of decision points before trying to remove anything.',
        },
        {
          type: 'paragraph',
          value:
            'The reduction happens in two phases. First, every scattered read is replaced by a single read at the entry point of the flow, and the resolved value travels as part of the request context. That removes no conditional yet, but it turns seventy-four independent evaluations into one evaluation and seventy-three reads of an immutable value, which already eliminates the class of bug where the flag changes mid-request. Second, with the decision centralized, polymorphism replaces the conditional: two implementations of the same interface, chosen once, and the body of the code stops knowing the flag exists.',
        },
        {
          type: 'code',
          value: `// ANTES: 74 pontos consultam a flag de forma independente.
// Alem de ilegivel, a flag pode mudar no meio da requisicao e produzir
// uma execucao que seguiu os dois caminhos ao mesmo tempo.
function calcularFrete(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.cotar(pedido);
  }
  return motorAntigo.cotar(pedido);
}

function estimarPrazo(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.prazo(pedido);
  }
  return motorAntigo.prazo(pedido);
}

// DEPOIS, FASE 1: uma avaliacao na borda, valor congelado no contexto.
// As 74 condicionais continuam existindo, mas agora leem um valor
// imutavel em vez de consultar o provedor 74 vezes por requisicao.
export const resolverContexto = (req, { flags }) => ({
  cliente: req.cliente,
  motorFrete: flags.enabled('novo_motor_frete', req.cliente) ? 'novo' : 'antigo',
});

// DEPOIS, FASE 2: a decisao vira selecao de implementacao, uma vez so.
// O corpo do dominio nao sabe mais que existe uma flag, e a remocao
// futura e apagar uma linha do mapa, nao 74 condicionais.
const MOTORES = { novo: motorNovo, antigo: motorAntigo };

export const criarServicoFrete = (contexto) => {
  const motor = MOTORES[contexto.motorFrete];

  return {
    cotar: (pedido) => motor.cotar(pedido),
    prazo: (pedido) => motor.prazo(pedido),
  };
};

// FASE 3, quando o relatorio autorizar: o mapa perde a entrada antiga,
// resolverContexto perde a linha da flag, e motorAntigo sai do
// repositorio inteiro em vez de sair em 74 diffs espalhados.`,
        },
        {
          type: 'paragraph',
          value:
            'The legitimate objection to this sequence is that it turns a cleanup into a refactor, and refactoring costs time the team does not have. The counter-argument is that the alternative is not a cheap cleanup, it is a seventy-four-point pull request the reviewer approves out of fatigue. The intermediate refactor has a property the giant pull request does not: each step is individually reviewable, individually reversible, and leaves the system in a valid state even if the team abandons the cleanup halfway, which happens often.',
        },
      ],
    },
    {
      title: 'Cleanup that sustains itself',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every team that accumulated flag debt has already tried to solve it with a cleanup sprint, and the cleanup sprint works once. Six months later the number is back to the previous level because the process that generated the debt is unchanged. What changes the outcome is not the intensity of the cleanup, it is making flag creation an event that already carries the date of its own removal.',
        },
        {
          type: 'paragraph',
          value:
            'That means requiring three mandatory fields at creation time, without which registration is refused: the type, which separates rollout from kill switch and determines whether the flag enters the cleanup queue; the expected expiration date, which is an estimate and not a contract; and the owner, which has to be a team and never a person, because people change teams and the flag stays. None of these fields prevents debt on its own, but together they turn the question does anyone know whether this is still used into a query.',
        },
        {
          type: 'paragraph',
          value:
            'The missing automation comes next and it is deliberately modest. A pipeline check that fails whenever an expired rollout flag exists produces friction at the wrong moment, because it blocks a deploy that has nothing to do with the flag in question. What works is a weekly alert for the owning team, with the list of expired flags and the evaluation data for each, plus a pipeline block only for the specific case of an orphaned flag, where the owning team no longer exists.',
        },
        {
          type: 'code',
          value: `// scripts/flag-debt-report.mjs
// Roda semanalmente e abre uma issue por time dono, nunca uma issue
// gigante com tudo. A lista precisa caber numa sprint para ser lida.

import { createFlagClient } from '../src/flags/evaluate.js';
import { store, metrics, equipesAtivas, abrirIssue } from './deps.mjs';

const DIA = 24 * 60 * 60 * 1000;

const client = createFlagClient({ store, metrics, clock: { now: () => Date.now() } });

// Janela de 45 dias: cobre um fechamento mensal completo mais margem.
// Com 14 dias, todo fluxo mensal aparece como morto e a limpeza gera
// um incidente 30 dias depois do merge.
const candidatas = client.removalCandidates({ window: 45 * DIA });

const definicoes = candidatas.map(({ key, winner, evaluations }) => {
  const def = store.get(key);

  return {
    key,
    winner,
    evaluations,
    owner: def.owner,
    idadeDias: Math.floor((Date.now() - def.createdAt) / DIA),
    vencida: def.expiresAt != null && Date.now() > def.expiresAt,
  };
});

// Flag orfa: o time dono nao existe mais no diretorio da organizacao.
// Esta e a unica categoria que bloqueia o pipeline, porque nao existe
// destinatario para o alerta semanal.
const orfas = definicoes.filter((flag) => !equipesAtivas.has(flag.owner));

if (orfas.length > 0) {
  console.error(\`Flags sem time dono ativo: \${orfas.map((f) => f.key).join(', ')}\`);
  process.exitCode = 1;
}

const porTime = definicoes.reduce((acc, flag) => {
  const lista = acc.get(flag.owner) ?? [];
  lista.push(flag);
  return acc.set(flag.owner, lista);
}, new Map());

for (const [owner, flags] of porTime) {
  const vencidas = flags.filter((flag) => flag.vencida);
  if (vencidas.length === 0) continue;

  await abrirIssue({
    time: owner,
    titulo: \`\${vencidas.length} feature flags prontas para remocao\`,
    corpo: vencidas
      .map(
        (flag) =>
          \`- \${flag.key}: valor unico "\${flag.winner}" em \${flag.evaluations} \` +
          \`avaliacoes, \${flag.idadeDias} dias de idade, motivo padrao em 100% das leituras\`,
      )
      .join('\\n'),
  });
}`,
        },
        {
          type: 'list',
          items: [
            'The report is per owning team and never a single list, because a list of eighty items is not actionable and a list of six is.',
            'The analysis window covers the slowest process in the domain, not a round number of days chosen out of convenience.',
            'Kill switches and entitlements are excluded before the analysis, not filtered afterwards by human review.',
            'The only pipeline block is the orphaned flag, because in that case there is no recipient for the alert.',
            'The expiration date is treated as an estimate that starts a conversation, not as a contract that triggers an automatic block.',
          ],
        },
      ],
    },
    {
      title: 'Proving the removal did not change behavior',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The part that closes the loop is the one that guarantees deleting the conditional produced exactly the behavior the enabled flag produced. Intuition says this is trivial because the winning branch code did not change, and intuition is wrong on two specific points: the fallback value when the key disappears, which is rarely equal to the value that was in production, and the side effects that existed only inside the conditional block, such as logs, counters and caches other parts consume.',
        },
        {
          type: 'paragraph',
          value:
            'The test that catches both cases is an output comparison between the version with the flag forced to true and the already cleaned version, running over the same set of inputs. It is cheap because it needs no flag provider and no network, and it is the only objective evidence that the removal pull request is neutral.',
        },
        {
          type: 'code',
          value: `// test/remocao-flag-novo-motor-frete.test.js
// Compara a saida do codigo COM a flag forcada em true contra a saida do
// codigo JA LIMPO. Rodar antes do merge do PR de remocao e descartar
// depois: e um teste de transicao, nao de regressao permanente.

import { calcularFreteLegado } from './fixtures/frete-com-flag.js';
import { criarServicoFrete } from '../src/frete/servico.js';
import { pedidosDeAmostra } from './fixtures/pedidos.js';

describe('remocao da flag novo_motor_frete e neutra', () => {
  it('produz a mesma cotacao para toda a amostra de pedidos', () => {
    const servicoLimpo = criarServicoFrete({ motorFrete: 'novo' });

    for (const pedido of pedidosDeAmostra) {
      const antes = calcularFreteLegado(pedido, { flagLigada: true });
      const depois = servicoLimpo.cotar(pedido);

      expect(depois).toEqual(antes);
    }
  });

  it('mantem os efeitos colaterais que estavam dentro do condicional', () => {
    // O ramo da flag incrementava um contador que o painel de operacao
    // consome. Apagar o if apaga o contador junto, e o grafico vira uma
    // linha reta em zero que ninguem associa a limpeza de flag.
    const metricas = [];
    const servico = criarServicoFrete(
      { motorFrete: 'novo' },
      { metrics: { increment: (nome) => metricas.push(nome) } },
    );

    servico.cotar(pedidosDeAmostra[0]);

    expect(metricas).toContain('frete.cotacao');
  });

  it('nao consulta mais o provedor de flags', () => {
    // Se qualquer caminho do servico limpo ainda ler a flag, este stub
    // estoura. E a prova de que a leitura saiu do caminho de execucao e
    // nao apenas de que ela retorna sempre o mesmo valor.
    const provedorProibido = {
      enabled: () => {
        throw new Error('o servico limpo nao pode consultar flags');
      },
    };

    const servico = criarServicoFrete({ motorFrete: 'novo' }, { flags: provedorProibido });

    expect(() => servico.cotar(pedidosDeAmostra[0])).not.toThrow();
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'The second assertion is the one that pays for itself the most and the one that almost never gets written. Metrics emitted from inside the conditional block disappear along with the block, and the visible effect is not an error but a chart that becomes a flat line at zero. Nobody associates that with a flag cleanup three weeks later, and the operations dashboard permanently loses a signal because the alert built on top of it never fires again.',
        },
        {
          type: 'paragraph',
          value:
            'The third assertion protects against the half-finished cleanup, which is the most common outcome when the pull request is large. A path that keeps querying the provider is indistinguishable from a clean path in any output test, because the provider returns the right value. It only reveals itself the day the key is archived, and on that day the behavior changes with no associated deploy, which is the worst possible way to discover a problem.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What is a healthy number of active flags per service?',
      answer:
        'Asking for the absolute number leads to an arbitrary target the team works around by renaming categories, and what matters is the composition of the list and not its size. A service with forty flags where thirty-five are documented kill switches and five are rollouts less than thirty days old is healthier than a service with twelve flags where nine are rollouts over a year old. The metric that works is the median age of rollout flags, because it captures exactly the behavior you want to change: if the median is nine days, the removal process is working; if it is eight months, there is debt growing regardless of whether the total is twelve or forty. The second useful metric is the share of flags without an active owning team, which should be zero and which in practice reveals how far registration has become a formality. It is also worth tracking how many flags were created against how many were removed in the quarter, because a persistent positive balance says the process does not sustain itself, even if the absolute total still looks comfortable.',
    },
    {
      question: 'How do you remove a flag when the old branch still has specific customers?',
      answer:
        'This is the case where the correct answer is not to remove, and recognizing it early saves weeks. A flag serving a named customer list stopped being a rollout flag and became a business rule, and the problem is not the cleanup but that the rule sits in the wrong place. The correct move is to migrate the condition to where it belongs, which is usually the authorization model or the customer plan record, letting the domain code query a named capability instead of a flag key. That does not reduce the number of paths in the code, but it changes the nature of the debt: a plan capability is a documented product decision, with a clear owner and its own lifecycle, while a forgotten flag with thirty-seven customers on the list is a business rule that only exists in the configuration of a deploy tool. After the migration the flag key is removed through the normal procedure, because at that point it genuinely has no reader left. If the list has few customers and the old branch is expensive to maintain, there is also the option of negotiating the migration of those contracts, but that is a commercial conversation that has to happen before and not during the cleanup pull request.',
    },
    {
      question: 'Is it worth keeping the old branch code somewhere after removal?',
      answer:
        'No, and the opposite intuition comes from confusing preserving information with preserving executable code. Git history already keeps the old branch in full, with context on when it was written, by whom and alongside which change, and recovering it is a matter of seconds. Keeping the code in the repository in a legacy file or behind a permanently disabled flag has continuous cost and zero value: it shows up in every search, it gets read by whoever is trying to understand the flow, it has to keep compiling when dependencies change signatures, and it gets updated by automated refactors nobody reviews carefully because the code is dead. Worse, if it sits behind a disabled flag, it rots without anyone noticing, and the day someone enables the flag to attempt an emergency rollback the code that runs is no longer the one that worked, it is the one that survived eighteen months of untested changes. The practice that resolves the legitimate anxiety behind the question is to record in the removal commit the hash of the previous commit and a summary of what the old branch did, which gives an immediate starting point to whoever needs to look it up without keeping anything alive in the repository.',
    },
  ],
  conclusion: {
    title: 'A flag is only finished when its code leaves the repository',
    description:
      'The tool that exists to reduce deploy risk becomes, in eighteen months, the biggest obstacle to understanding what is in production. The way out is not a cleanup sprint, it is treating removal as part of the rollout and not as separate work that never gets prioritized. I can instrument your flag evaluation with reason and subject, build the report that separates real candidates from kill switches, design the three-step removal sequence that does not break in-flight requests, refactor the scattered flags into a single decision point and leave the weekly per-team alert running without turning into noise.',
    cta: 'Talk about the feature flag debt in my system',
  },
  related: [
    {
      label: 'Feature flags in agent flows: enabling new behavior for a few',
      to: '/blog/feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos',
    },
    {
      label: 'Zero downtime database migration: expand, migrate and contract',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'La búsqueda de una bandera específica en el código devolvió setenta y cuatro ocurrencias y la fecha del commit que la creó era de hace veintidós meses. El rollout terminó en una semana, la variante nueva ganó, y nadie volvió para borrar la clave. Ese es el estado normal de casi todo sistema que adoptó banderas: la herramienta que existe para reducir el riesgo de despliegue acumula un pasivo que multiplica la cantidad de caminos posibles del código en cada release. Este artículo muestra por qué la bandera olvidada es una deuda con intereses compuestos y no apenas un if muerto, por qué la decisión de removerla depende del dato de evaluación y no de la memoria de quien estaba en el equipo, cuál es el orden de remoción que no rompe la petición que está en vuelo en este mismo instante, por qué el kill switch nunca debe entrar en la misma cola de limpieza que la bandera de rollout, y qué verificación automática impide que la próxima bandera repita el ciclo.',
  sections: [
    {
      title: 'La bandera olvidada no es un if muerto, es un multiplicador de estados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El argumento más común contra la limpieza es que la bandera apagada no cuesta nada, porque la condición resuelve en falso y el cuerpo nunca se ejecuta. El costo real no está en el tiempo de ejecución, está en la cantidad de estados que el sistema declara soportar. Cada bandera booleana viva duplica el espacio de combinación del código que envuelve, y como las banderas no son independientes entre sí, diez banderas activas describen mil veinticuatro configuraciones posibles. Ningún equipo prueba mil veinticuatro configuraciones. Lo que pasa en la práctica es que una docena de combinaciones se ejercita en producción y el resto existe apenas como una promesa no verificada dentro del repositorio.',
        },
        {
          type: 'paragraph',
          value:
            'La consecuencia aparece cuando alguien necesita cambiar el código adyacente. El ingeniero que abre el archivo dos años después no sabe si la variante antigua todavía tiene tráfico, no sabe si puede borrar la rama del else, y el camino más barato para él es preservar los dos lados y agregar el tercero. Así crece la deuda sin que nadie tome una decisión equivocada de forma aislada: cada elección individual de preservar lo desconocido es razonable, y la suma de ellas produce un archivo donde nadie más puede afirmar qué está en producción.',
        },
        {
          type: 'paragraph',
          value:
            'Existe además un costo que aparece solo en el incidente y que es el más caro de los tres. Cuando algo se rompe a las dos de la madrugada, la primera pregunta es qué código estaba ejecutando el cliente afectado, y la respuesta depende de resolver el estado de todas las banderas que atraviesan ese camino para ese usuario en ese instante. Con banderas limpias, eso es leer el archivo. Con setenta banderas vivas y sin histórico de valores retenido, eso es una investigación que consume el tiempo del incidente entero antes de que cualquier diagnóstico empiece.',
        },
        {
          type: 'table',
          columns: ['Tipo de bandera', 'Vida esperada', 'Señal de que se volvió deuda', 'Destino correcto'],
          rows: [
            [
              'Rollout de release',
              'Días a semanas',
              'Cien por ciento en una variante hace más de un ciclo',
              'Remover código y clave',
            ],
            [
              'Experimento A/B',
              'Duración de la prueba',
              'Análisis ya publicado y decisión tomada',
              'Remover el brazo perdedor y la clave',
            ],
            [
              'Kill switch operativo',
              'Permanente por diseño',
              'Nunca accionado y sin prueba de accionamiento',
              'Mantener, documentar y ejercitar',
            ],
            [
              'Permiso por plan o cliente',
              'Permanente por diseño',
              'Regla de negocio escondida en el servicio de banderas',
              'Mover a autorización, salir del sistema de banderas',
            ],
            [
              'Configuración de entorno',
              'Permanente',
              'Valor idéntico en todos los entornos hace meses',
              'Fijar en el código y remover la clave',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tabla existe porque el error más frecuente en la limpieza no es olvidarse de remover, es remover la cosa equivocada. Un kill switch de dependencia externa pasa años sin ser accionado y se parece exactamente a una bandera de rollout olvidada cuando uno mira solo la telemetría de uso. La diferencia no está en el dato, está en la intención declarada en el momento de la creación, y por eso el tipo necesita ser un campo obligatorio de la bandera y no una convención de nombre.',
        },
      ],
    },
    {
      title: 'Decidir con dato de evaluación, no con memoria del equipo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La pregunta que traba la remoción es siempre la misma: ¿alguien todavía depende de esto? Responder por memoria no funciona porque la persona que creó la bandera con frecuencia ya salió del equipo, y responder por búsqueda en el código tampoco, porque la búsqueda muestra dónde se lee la bandera y no quién la está recibiendo como verdadera. La única respuesta confiable viene de instrumentar la propia evaluación, registrando cada consulta con la clave, el valor devuelto, el motivo de la decisión y el identificador del sujeto evaluado.',
        },
        {
          type: 'paragraph',
          value:
            'El campo más importante de esos cuatro es el motivo, y es el que suele faltar en las implementaciones caseras. Saber que la bandera devolvió verdadero diez mil veces no dice nada sobre poder removerla. Saber que devolvió verdadero diez mil veces por la regla por defecto y cero veces por una regla de segmento dice que el segmento puede borrarse ahora. Saber que devolvió falso un millón de veces por el valor por defecto y treinta y siete veces por una lista nominal de clientes dice que hay treinta y siete contratos que se rompen si borras la rama antigua.',
        },
        {
          type: 'code',
          value: `// flags/evaluate.js
// A avaliacao emite telemetria com o MOTIVO da decisao, nao so o valor.
// Sem o motivo, "retornou true 10k vezes" nao autoriza remover nada:
// pode ser a regra padrao ou uma regra de segmento com 3 clientes presos.

const REASONS = {
  DEFAULT: 'default',    // caiu no valor padrao da flag
  SEGMENT: 'segment',    // bateu numa regra de segmento
  OVERRIDE: 'override',  // override explicito por sujeito
  KILL_SWITCH: 'kill',   // desligada manualmente pela operacao
  MISSING: 'missing',    // chave nao existe mais no provedor
};

export const createFlagClient = ({ store, metrics, clock }) => {
  const evaluate = (key, subject) => {
    const definition = store.get(key);

    // Chave removida do provedor mas ainda lida pelo codigo. Este e o
    // caminho que produz o incidente silencioso: o fallback assume um
    // valor e ninguem percebe ate o comportamento divergir em producao.
    if (!definition) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.MISSING });
      return { value: false, reason: REASONS.MISSING };
    }

    if (definition.killed) {
      metrics.increment('flag.evaluation', { key, value: 'false', reason: REASONS.KILL_SWITCH });
      return { value: false, reason: REASONS.KILL_SWITCH };
    }

    const override = definition.overrides?.[subject.id];
    if (override !== undefined) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(override),
        reason: REASONS.OVERRIDE,
      });
      return { value: override, reason: REASONS.OVERRIDE, subjectId: subject.id };
    }

    const segment = definition.segments?.find((rule) => rule.matches(subject));
    if (segment) {
      metrics.increment('flag.evaluation', {
        key,
        value: String(segment.value),
        reason: REASONS.SEGMENT,
        segment: segment.name,
      });
      return { value: segment.value, reason: REASONS.SEGMENT, segment: segment.name };
    }

    metrics.increment('flag.evaluation', {
      key,
      value: String(definition.defaultValue),
      reason: REASONS.DEFAULT,
    });
    return { value: definition.defaultValue, reason: REASONS.DEFAULT };
  };

  // O relatorio de candidatas nao pergunta "ha quanto tempo a flag existe",
  // pergunta "ha quantos dias so existe uma resposta e ela vem do padrao".
  const removalCandidates = ({ window }) => {
    const since = clock.now() - window;

    return store.keys().flatMap((key) => {
      const definition = store.get(key);

      // Kill switch e permissao sao excluidos ANTES da analise. Eles sao
      // justamente os que retornam sempre o mesmo valor, e sem esta linha
      // o relatorio poe no topo da lista o disjuntor do provedor de pagamento.
      if (definition.type === 'kill_switch' || definition.type === 'permission') return [];

      const stats = metrics.query('flag.evaluation', { key, since });
      if (stats.length === 0) return [];

      const distinctValues = new Set(stats.map((row) => row.value));
      const nonDefaultReasons = stats.filter((row) => row.reason !== REASONS.DEFAULT);

      if (distinctValues.size !== 1) return [];
      if (nonDefaultReasons.length > 0) return [];

      return [{ key, winner: [...distinctValues][0], evaluations: stats.length }];
    });
  };

  return { evaluate, removalCandidates, REASONS };
};`,
        },
        {
          type: 'paragraph',
          value:
            'El detalle del reporte que suele subestimarse es la exclusión explícita de kill switches y permisos antes de cualquier análisis estadístico. Sin esa línea, el reporte pone en el tope de la lista justamente las banderas que nunca deben removerse, porque son precisamente las que devuelven siempre el mismo valor. Un equipo que confía en un reporte sin ese filtro borra el disyuntor de la integración de pagos en el primer ciclo de limpieza y descubre el problema en el próximo incidente del proveedor.',
        },
        {
          type: 'paragraph',
          value:
            'La ventana de observación también merece un criterio explícito en lugar de un número redondo. Necesita cubrir al menos un ciclo completo del proceso más lento que toca ese camino, lo que en la mayoría de los sistemas significa el cierre mensual o el reporte trimestral. Una bandera que atiende un flujo ejecutado una vez por mes parece muerta en cualquier ventana de dos semanas, y borrarla produce una falla que solo aparece treinta días después del merge, cuando nadie asocia ya el incidente con la limpieza.',
        },
      ],
    },
    {
      title: 'El orden de remoción que no rompe la petición en vuelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La tentación es resolver todo en un solo pull request: borrar el if, borrar la rama perdedora, borrar la clave en el proveedor y cerrar el ticket. Eso funciona en el entorno local y falla en producción por la misma razón que falla una migración de base sin etapas. Durante el despliegue hay instancias antiguas todavía respondiendo, peticiones que ya leyeron la bandera y aún no terminaron, y consumidores de cola que capturaron el valor al inicio del lote. Remover la clave del proveedor antes de remover la lectura en el código deja al código antiguo cayendo en el camino de clave inexistente, que resuelve por el valor de fallback y no necesariamente por el valor que estaba en producción.',
        },
        {
          type: 'diagram',
          value: `ORDEM ERRADA (um PR so)

  apaga chave no provedor + apaga if + apaga ramo antigo
        |
        v
  instancias antigas ainda vivas leem chave inexistente
        |
        v
  fallback assume false, ramo perdedor volta a rodar
  por 3 minutos, sem alerta, sem rastro


ORDEM CORRETA (tres passos, cada um reversivel)

  P1  codigo    fixa a leitura no valor vencedor
                constante local no lugar da consulta
                chave AINDA existe no provedor
                rollback = reverter o commit

  P2  codigo    remove o if, o ramo perdedor e os
                testes exclusivos do ramo perdedor
                chave AINDA existe, agora sem leitor
                rollback = reverter o commit

  P3  provedor  arquiva a chave apos a janela de
                retencao, com metrica de avaliacao
                em zero durante toda a janela
                rollback = restaurar a definicao

  ^ em nenhum passo existe codigo vivo lendo chave ausente`,
        },
        {
          type: 'paragraph',
          value:
            'El primer paso es el que casi todo equipo se salta y es el que vuelve seguros a los otros dos. Fijar el valor ganador en el código, manteniendo la clave viva en el proveedor, crea una ventana donde el comportamiento nuevo es permanente pero la reversión sigue siendo un revert de commit y no un cambio de configuración bajo presión. Si algo dependía de la rama antigua por un camino que la telemetría no capturó, el síntoma aparece en esa ventana y el costo es un revert, no un incidente con dato inconsistente.',
        },
        {
          type: 'paragraph',
          value:
            'Entre el segundo y el tercer paso es obligatorio esperar, y el criterio de espera es el tiempo de vida del proceso más largo que pudo haber capturado el valor. En un servicio web eso es el tiempo de drenaje del despliegue, en minutos. En un consumidor de cola que procesa lotes grandes puede ser media hora. En un job agendado que corre semanalmente es una semana. Archivar la clave mientras un consumidor antiguo todavía está en medio de un lote produce exactamente el escenario del diagrama, con la diferencia de que en la cola el efecto queda grabado en la base en lugar de devuelto en una respuesta HTTP.',
        },
        {
          type: 'ordered',
          items: [
            'Confirmar en el reporte de evaluación que la bandera tiene valor único y motivo por defecto durante la ventana que cubre el proceso más lento del dominio.',
            'Fijar el valor ganador en el código con una constante local, manteniendo la clave existente en el proveedor, y desplegar.',
            'Observar la ventana de drenaje completa, verificando que la tasa de error y las métricas de negocio del camino afectado no cambiaron.',
            'Remover el condicional, la rama perdedora, las pruebas exclusivas de la rama perdedora y la constante local, en un pull request separado.',
            'Confirmar que la métrica de evaluación de esa clave cayó a cero y permaneció en cero durante toda la ventana.',
            'Archivar la clave en el proveedor, manteniendo la definición por un período de retención antes de la eliminación definitiva.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El quinto ítem es el único que ofrece prueba en lugar de confianza. Mientras la métrica de evaluación de esa clave no llegue a cero y permanezca en cero durante toda la ventana, existe al menos un caller vivo, y puede ser un servicio que nadie mapeó, un script de operación o un cliente móvil con versión antigua. Archivar antes de eso es cambiar una limpieza de código por una investigación futura de causa desconocida.',
        },
      ],
    },
    {
      title: 'Qué hacer cuando la bandera está esparcida en setenta lugares',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La bandera que aparece en setenta y cuatro lugares no es una bandera, es una decisión arquitectónica implementada como condicional distribuido. Tratar cada ocurrencia como ítem de checklist produce un pull request gigantesco que nadie revisa con atención, y revisar mal es justamente el modo más fácil de borrar la rama equivocada en tres de los setenta y cuatro puntos. El enfoque que funciona es reducir la cantidad de puntos de decisión antes de intentar remover cualquier cosa.',
        },
        {
          type: 'paragraph',
          value:
            'La reducción ocurre en dos fases. Primero, todas las lecturas dispersas se sustituyen por una única lectura en el punto de entrada del flujo, y el valor resuelto pasa a viajar como parte del contexto de la petición. Eso todavía no remueve ningún condicional, pero transforma setenta y cuatro evaluaciones independientes en una evaluación y setenta y tres lecturas de un valor inmutable, lo que ya elimina la clase de bug donde la bandera cambia en medio de la petición. Segundo, con la decisión centralizada, el polimorfismo sustituye al condicional: dos implementaciones de la misma interfaz, elegidas una sola vez, y el cuerpo del código deja de saber que la bandera existe.',
        },
        {
          type: 'code',
          value: `// ANTES: 74 pontos consultam a flag de forma independente.
// Alem de ilegivel, a flag pode mudar no meio da requisicao e produzir
// uma execucao que seguiu os dois caminhos ao mesmo tempo.
function calcularFrete(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.cotar(pedido);
  }
  return motorAntigo.cotar(pedido);
}

function estimarPrazo(pedido) {
  if (flags.enabled('novo_motor_frete', pedido.cliente)) {
    return motorNovo.prazo(pedido);
  }
  return motorAntigo.prazo(pedido);
}

// DEPOIS, FASE 1: uma avaliacao na borda, valor congelado no contexto.
// As 74 condicionais continuam existindo, mas agora leem um valor
// imutavel em vez de consultar o provedor 74 vezes por requisicao.
export const resolverContexto = (req, { flags }) => ({
  cliente: req.cliente,
  motorFrete: flags.enabled('novo_motor_frete', req.cliente) ? 'novo' : 'antigo',
});

// DEPOIS, FASE 2: a decisao vira selecao de implementacao, uma vez so.
// O corpo do dominio nao sabe mais que existe uma flag, e a remocao
// futura e apagar uma linha do mapa, nao 74 condicionais.
const MOTORES = { novo: motorNovo, antigo: motorAntigo };

export const criarServicoFrete = (contexto) => {
  const motor = MOTORES[contexto.motorFrete];

  return {
    cotar: (pedido) => motor.cotar(pedido),
    prazo: (pedido) => motor.prazo(pedido),
  };
};

// FASE 3, quando o relatorio autorizar: o mapa perde a entrada antiga,
// resolverContexto perde a linha da flag, e motorAntigo sai do
// repositorio inteiro em vez de sair em 74 diffs espalhados.`,
        },
        {
          type: 'paragraph',
          value:
            'La objeción legítima a esa secuencia es que convierte una limpieza en una refactorización, y refactorizar cuesta tiempo que el equipo no tiene. El contraargumento es que la alternativa no es una limpieza barata, es un pull request de setenta y cuatro puntos que el revisor aprueba por cansancio. La refactorización intermedia tiene una propiedad que el pull request gigante no tiene: cada paso es individualmente revisable, individualmente reversible, y deja el sistema en estado válido incluso si el equipo abandona la limpieza a la mitad, lo que ocurre con frecuencia.',
        },
      ],
    },
    {
      title: 'La limpieza que se sostiene sola',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo equipo que acumuló deuda de banderas ya intentó resolverla con una jornada de limpieza, y esa jornada funciona una vez. Seis meses después el número vuelve al nivel anterior porque el proceso que generó la deuda sigue igual. Lo que cambia el resultado no es la intensidad de la limpieza, es volver la creación de la bandera un evento que ya carga la fecha de su propia remoción.',
        },
        {
          type: 'paragraph',
          value:
            'Eso significa exigir tres campos obligatorios en el momento de la creación, sin los cuales el registro es rechazado: el tipo, que separa rollout de kill switch y determina si la bandera entra en la cola de limpieza; la fecha de expiración esperada, que es una estimación y no un contrato; y el dueño, que necesita ser un equipo y nunca una persona, porque las personas cambian de equipo y la bandera se queda. Ninguno de esos campos impide la deuda por sí solo, pero juntos transforman la pregunta de si alguien sabe si esto todavía se usa en una consulta.',
        },
        {
          type: 'paragraph',
          value:
            'La automatización que faltaba viene después y es modesta a propósito. Una verificación en el pipeline que falla siempre que existe una bandera de rollout vencida produce fricción en el momento equivocado, porque bloquea un despliegue sin ninguna relación con la bandera en cuestión. Lo que funciona es la alerta semanal al equipo dueño, con la lista de banderas vencidas y el dato de evaluación de cada una, más un bloqueo en el pipeline solo para el caso específico de la bandera huérfana, cuando el equipo dueño ya no existe.',
        },
        {
          type: 'code',
          value: `// scripts/flag-debt-report.mjs
// Roda semanalmente e abre uma issue por time dono, nunca uma issue
// gigante com tudo. A lista precisa caber numa sprint para ser lida.

import { createFlagClient } from '../src/flags/evaluate.js';
import { store, metrics, equipesAtivas, abrirIssue } from './deps.mjs';

const DIA = 24 * 60 * 60 * 1000;

const client = createFlagClient({ store, metrics, clock: { now: () => Date.now() } });

// Janela de 45 dias: cobre um fechamento mensal completo mais margem.
// Com 14 dias, todo fluxo mensal aparece como morto e a limpeza gera
// um incidente 30 dias depois do merge.
const candidatas = client.removalCandidates({ window: 45 * DIA });

const definicoes = candidatas.map(({ key, winner, evaluations }) => {
  const def = store.get(key);

  return {
    key,
    winner,
    evaluations,
    owner: def.owner,
    idadeDias: Math.floor((Date.now() - def.createdAt) / DIA),
    vencida: def.expiresAt != null && Date.now() > def.expiresAt,
  };
});

// Flag orfa: o time dono nao existe mais no diretorio da organizacao.
// Esta e a unica categoria que bloqueia o pipeline, porque nao existe
// destinatario para o alerta semanal.
const orfas = definicoes.filter((flag) => !equipesAtivas.has(flag.owner));

if (orfas.length > 0) {
  console.error(\`Flags sem time dono ativo: \${orfas.map((f) => f.key).join(', ')}\`);
  process.exitCode = 1;
}

const porTime = definicoes.reduce((acc, flag) => {
  const lista = acc.get(flag.owner) ?? [];
  lista.push(flag);
  return acc.set(flag.owner, lista);
}, new Map());

for (const [owner, flags] of porTime) {
  const vencidas = flags.filter((flag) => flag.vencida);
  if (vencidas.length === 0) continue;

  await abrirIssue({
    time: owner,
    titulo: \`\${vencidas.length} feature flags prontas para remocao\`,
    corpo: vencidas
      .map(
        (flag) =>
          \`- \${flag.key}: valor unico "\${flag.winner}" em \${flag.evaluations} \` +
          \`avaliacoes, \${flag.idadeDias} dias de idade, motivo padrao em 100% das leituras\`,
      )
      .join('\\n'),
  });
}`,
        },
        {
          type: 'list',
          items: [
            'El reporte es por equipo dueño y nunca una lista única, porque una lista de ochenta ítems no es accionable y una de seis sí lo es.',
            'La ventana de análisis cubre el proceso más lento del dominio, no un número redondo de días elegido por conveniencia.',
            'Los kill switches y los permisos se excluyen antes del análisis, no se filtran después por revisión humana.',
            'El único bloqueo de pipeline es la bandera huérfana, porque en ese caso no existe destinatario para la alerta.',
            'La fecha de expiración se trata como estimación que genera conversación, no como contrato que genera bloqueo automático.',
          ],
        },
      ],
    },
    {
      title: 'Probar que la remoción no cambió el comportamiento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La parte que cierra el ciclo es la que garantiza que borrar el condicional produjo exactamente el mismo comportamiento que producía la bandera encendida. La intuición dice que eso es trivial porque el código de la rama ganadora no cambió, y la intuición se equivoca en dos puntos específicos: el valor de fallback cuando la clave desaparece, que rara vez es igual al valor que estaba en producción, y los efectos colaterales que existían solo dentro del bloque condicional, como logs, contadores y cachés que otros fragmentos consumen.',
        },
        {
          type: 'paragraph',
          value:
            'La prueba que atrapa los dos casos es una comparación de salida entre la versión con la bandera forzada en verdadero y la versión ya limpia, corriendo sobre el mismo conjunto de entradas. Es barata porque no necesita proveedor de banderas ni red, y es la única evidencia objetiva de que el pull request de remoción es neutro.',
        },
        {
          type: 'code',
          value: `// test/remocao-flag-novo-motor-frete.test.js
// Compara a saida do codigo COM a flag forcada em true contra a saida do
// codigo JA LIMPO. Rodar antes do merge do PR de remocao e descartar
// depois: e um teste de transicao, nao de regressao permanente.

import { calcularFreteLegado } from './fixtures/frete-com-flag.js';
import { criarServicoFrete } from '../src/frete/servico.js';
import { pedidosDeAmostra } from './fixtures/pedidos.js';

describe('remocao da flag novo_motor_frete e neutra', () => {
  it('produz a mesma cotacao para toda a amostra de pedidos', () => {
    const servicoLimpo = criarServicoFrete({ motorFrete: 'novo' });

    for (const pedido of pedidosDeAmostra) {
      const antes = calcularFreteLegado(pedido, { flagLigada: true });
      const depois = servicoLimpo.cotar(pedido);

      expect(depois).toEqual(antes);
    }
  });

  it('mantem os efeitos colaterais que estavam dentro do condicional', () => {
    // O ramo da flag incrementava um contador que o painel de operacao
    // consome. Apagar o if apaga o contador junto, e o grafico vira uma
    // linha reta em zero que ninguem associa a limpeza de flag.
    const metricas = [];
    const servico = criarServicoFrete(
      { motorFrete: 'novo' },
      { metrics: { increment: (nome) => metricas.push(nome) } },
    );

    servico.cotar(pedidosDeAmostra[0]);

    expect(metricas).toContain('frete.cotacao');
  });

  it('nao consulta mais o provedor de flags', () => {
    // Se qualquer caminho do servico limpo ainda ler a flag, este stub
    // estoura. E a prova de que a leitura saiu do caminho de execucao e
    // nao apenas de que ela retorna sempre o mesmo valor.
    const provedorProibido = {
      enabled: () => {
        throw new Error('o servico limpo nao pode consultar flags');
      },
    };

    const servico = criarServicoFrete({ motorFrete: 'novo' }, { flags: provedorProibido });

    expect(() => servico.cotar(pedidosDeAmostra[0])).not.toThrow();
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'La segunda aserción es la que más se paga sola y la que casi nunca se escribe. Las métricas emitidas desde dentro del bloque condicional desaparecen junto con el bloque, y el efecto visible no es un error sino un gráfico que se vuelve una línea recta en cero. Nadie asocia eso con la limpieza de banderas tres semanas después, y el panel de operación pierde una señal de forma permanente porque la alerta configurada encima de ella nunca vuelve a dispararse.',
        },
        {
          type: 'paragraph',
          value:
            'La tercera aserción protege contra la limpieza a medias, que es el resultado más común cuando el pull request es grande. Un camino que sigue consultando al proveedor es indistinguible de un camino limpio en cualquier prueba de salida, porque el proveedor devuelve el valor correcto. Solo se revela el día en que la clave sea archivada, y ese día el comportamiento cambia sin ningún despliegue asociado, que es la peor forma posible de descubrir un problema.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cuál es la cantidad saludable de banderas activas por servicio?',
      answer:
        'La pregunta por el número absoluto lleva a una meta arbitraria que el equipo esquiva renombrando categorías, y lo que importa es la composición de la lista y no su tamaño. Un servicio con cuarenta banderas donde treinta y cinco son kill switches documentados y cinco son rollouts de menos de treinta días está más sano que un servicio con doce banderas donde nueve son rollouts de más de un año. La métrica que funciona es la edad mediana de las banderas de rollout, porque captura exactamente el comportamiento que se quiere cambiar: si la mediana está en nueve días, el proceso de remoción está funcionando; si está en ocho meses, hay una deuda creciendo independientemente de que el total sea doce o cuarenta. La segunda métrica útil es la proporción de banderas sin equipo dueño activo, que debería ser cero y que en la práctica revela cuánto el registro se volvió una formalidad. Vale seguir también cuántas banderas se crearon contra cuántas se removieron en el trimestre, porque un saldo positivo persistente dice que el proceso no se sostiene, aunque el total absoluto todavía parezca cómodo.',
    },
    {
      question: '¿Cómo remover una bandera cuando la rama antigua todavía tiene clientes específicos?',
      answer:
        'Ese es el caso donde la respuesta correcta no es remover, y reconocerlo temprano ahorra semanas. Una bandera que sirve a una lista nominal de clientes dejó de ser bandera de rollout y se volvió regla de negocio, y el problema no es la limpieza sino que la regla está en el lugar equivocado. El movimiento correcto es migrar la condición a donde pertenece, que generalmente es el modelo de autorización o el registro de plan del cliente, dejando que el código de dominio consulte una capacidad nombrada en lugar de una clave de bandera. Eso no reduce la cantidad de caminos en el código, pero cambia la naturaleza de la deuda: una capacidad de plan es una decisión de producto documentada, con dueño claro y ciclo de vida propio, mientras que una bandera olvidada con treinta y siete clientes en la lista es una regla de negocio que solo existe en la configuración de una herramienta de despliegue. Después de la migración la clave de bandera se remueve por el procedimiento normal, porque en ese punto realmente ya no tiene lector. Si la lista tiene pocos clientes y la rama antigua es cara de mantener, existe además la opción de negociar la migración de esos contratos, pero esa es una conversación comercial que necesita ocurrir antes y no durante el pull request de limpieza.',
    },
    {
      question: '¿Vale la pena mantener el código de la rama antigua en algún lugar después de la remoción?',
      answer:
        'No, y la intuición contraria viene de confundir preservar información con preservar código ejecutable. El historial de Git ya mantiene la rama antigua íntegramente, con contexto de cuándo fue escrita, por quién y junto a qué cambio, y recuperarla es una operación de segundos. Mantener el código en el repositorio en un archivo de legado o detrás de una bandera permanentemente apagada tiene costo continuo y valor nulo: aparece en toda búsqueda, es leído por quien intenta entender el flujo, necesita seguir compilando cuando las dependencias cambian de firma y es actualizado por refactorizaciones automáticas que nadie revisa con atención porque el código está muerto. Peor aún, si queda detrás de una bandera apagada, se pudre sin que nadie lo note, y el día en que alguien encienda la bandera para intentar un rollback de emergencia el código que corre ya no es el que funcionaba, es el que sobrevivió a dieciocho meses de cambios no probados. La práctica que resuelve la ansiedad legítima detrás de la pregunta es registrar en el commit de remoción el hash del commit anterior y un resumen de lo que hacía la rama antigua, lo que da un punto de partida inmediato a quien necesite consultarlo sin mantener nada vivo en el repositorio.',
    },
  ],
  conclusion: {
    title: 'La bandera solo termina cuando su código sale del repositorio',
    description:
      'La herramienta que existe para reducir el riesgo de despliegue se vuelve, en dieciocho meses, el mayor obstáculo para entender qué está en producción. La salida no es una jornada de limpieza, es tratar la remoción como parte del rollout y no como un trabajo aparte que nunca se prioriza. Puedo instrumentar la evaluación de las banderas de tu sistema con motivo y sujeto, armar el reporte que separa candidatas reales de kill switches, diseñar la secuencia de remoción en tres pasos que no rompe peticiones en vuelo, refactorizar las banderas esparcidas hacia un punto único de decisión y dejar la alerta semanal por equipo dueño funcionando sin volverse ruido.',
    cta: 'Hablar sobre la deuda de feature flags de mi sistema',
  },
  related: [
    {
      label: 'Feature flag en flujo de agente: encender comportamiento nuevo para pocos',
      to: '/blog/feature-flag-fluxo-agente-ligar-comportamento-novo-para-poucos',
    },
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
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
