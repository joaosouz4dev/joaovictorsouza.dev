// Conteudo do artigo: congelar o conjunto de avaliacao e renovar sem perder comparabilidade.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'Você montou um conjunto de avaliação para o seu agente, ele acertava 78% dos casos, e seis meses depois acerta 94%. A leitura óbvia é que o sistema melhorou. A leitura provável é que o conjunto envelheceu: cada bug corrigido virou um caso do eval, cada caso adicionado foi um que o sistema já errava e passou a acertar, e o que sobrou é um retrato do passado. O eval continua rodando verde enquanto o cliente reclama de coisas que ele não mede. Esse é o problema central: um conjunto de avaliação precisa ser estável para você comparar versões ao longo do tempo, e precisa mudar para continuar representando o tráfego real, e essas duas exigências se contradizem. A saída não é escolher uma delas, é separar o conjunto em partes com regras diferentes de mudança, versionar cada mudança como se fosse código, e nunca comparar números que vieram de versões distintas sem dizer que são distintas. Este artigo mostra como fazer isso na prática, com o que congelar, o que renovar, como saber que chegou a hora e como medir se o eval ainda tem alguma coisa a dizer sobre o sistema.',
  sections: [
    {
      title: 'Por que o eval envelhece mesmo sem ninguém mexer nele',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um conjunto de avaliação é uma amostra de um mundo que se move. Ele fica velho por três caminhos independentes, e os três acontecem em paralelo em qualquer produto vivo. O primeiro é a mudança do tráfego: os clientes passam a perguntar coisas que não perguntavam, entram novos produtos no catálogo, uma campanha muda o perfil de quem chega, uma feature nova cria uma classe inteira de dúvida que não existia. O eval montado no trimestre passado mede um público que não é mais o seu.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo caminho é o vazamento por correção, e é o mais insidioso porque é consequência direta de fazer a coisa certa. Todo caso que entra no eval porque o sistema errou é um caso que alguém vai corrigir logo em seguida. Com o tempo, o conjunto se transforma numa lista de problemas já resolvidos, e a nota sobe sem que a qualidade percebida pelo cliente mude. O terceiro é a otimização contra a régua: quando o time ajusta o prompt olhando o resultado do eval, o eval deixa de ser uma medição independente e vira um alvo, e o sistema aprende a acertar aqueles casos específicos em vez de aprender a tarefa.',
        },
        {
          type: 'table',
          columns: ['Forma de envelhecer', 'Sintoma no painel', 'O que o número passa a significar'],
          rows: [
            [
              'Deriva de tráfego',
              'Nota estável enquanto reclamações sobem',
              'Qualidade em um público que não é mais o seu',
            ],
            [
              'Vazamento por correção',
              'Nota sobe de forma monótona, sem platô',
              'Quantos bugs antigos continuam corrigidos',
            ],
            [
              'Otimização contra a régua',
              'Nota alta no eval, queda em amostra nova',
              'Aderência aos casos do eval, não à tarefa',
            ],
            [
              'Rótulo desatualizado',
              'Falhas que a revisão humana considera corretas',
              'Aderência a uma política que já mudou',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A quarta linha merece destaque porque quase nunca é lembrada. As respostas esperadas do eval refletem a política do produto no dia em que foram escritas. Se a empresa mudou a regra de reembolso, o eval continua exigindo a resposta antiga e marcando como erro a resposta certa. Nesse ponto o eval não está apenas velho, ele está ativamente errado, e um time disciplinado que persegue eval verde vai empurrar o sistema de volta para o comportamento que o produto abandonou.',
        },
      ],
    },
    {
      title: 'Congelar não é deixar parado: as três camadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A confusão que trava a maioria dos times é tratar o eval como um objeto único que ou está congelado ou está mudando. Ele deve ser dividido em camadas com contratos de mudança diferentes, e cada camada responde a uma pergunta distinta. Uma camada existe para detectar regressão e nunca pode mudar. Outra existe para representar o tráfego atual e precisa mudar. A terceira existe para proteger contra otimização e você nem pode olhar.',
        },
        {
          type: 'diagram',
          value: `Camadas do conjunto de avaliacao

  +-- NUCLEO CONGELADO (30-40% dos casos) ------------+
  |  Casos canonicos, invariantes de seguranca,       |
  |  comportamentos que nunca podem regredir.         |
  |  Muda so por RFC explicita. Comparavel entre       |
  |  todas as versoes do sistema.                     |
  +---------------------------------------------------+

  +-- JANELA ROTATIVA (40-50% dos casos) -------------+
  |  Amostra do trafego dos ultimos N meses.          |
  |  Renovada a cada ciclo. Comparavel apenas         |
  |  dentro da mesma versao do conjunto.              |
  +---------------------------------------------------+

  +-- HOLDOUT SELADO (20-30% dos casos) --------------+
  |  Nunca olhado durante o desenvolvimento.          |
  |  Aberto so na decisao de release.                 |
  |  Detecta otimizacao contra a regua.               |
  +---------------------------------------------------+

  nucleo verde + janela verde + holdout muito abaixo
     -> o time otimizou contra o eval, nao melhorou o sistema`,
        },
        {
          type: 'paragraph',
          value:
            'O núcleo congelado é o que dá comparabilidade histórica. Ele contém os casos que definem o mínimo aceitável: a recusa que o bot precisa fazer, o dado sensível que ele não pode repetir, a escalada que ele precisa disparar, o cálculo que ele não pode errar. Esses casos não mudam porque o tráfego mudou; eles mudam quando a política do produto muda, e aí a mudança passa por revisão explícita e vira uma nova versão do núcleo, com o número antigo preservado.',
        },
        {
          type: 'paragraph',
          value:
            'A janela rotativa é o oposto: ela deve mudar, porque a função dela é responder "como o sistema se sai no que os clientes estão perguntando agora". Amostrar essa janela do tráfego real, e não de casos que alguém escreveu à mão, é o que evita o vazamento por correção. E o holdout selado é o instrumento de honestidade: se a nota do holdout acompanha as outras duas, a melhoria é real; se ela fica para trás, o ganho foi decorado.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Conjunto de avaliacao em tres camadas com contratos de mudanca distintos.
// O nucleo congela, a janela rotaciona, o holdout so abre no release.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

export function loadEvalSuite({ allowHoldout = false } = {}) {
  const core = load('./core.frozen.json');       // muda so por RFC
  const window = load('./window.current.json');  // rotaciona por ciclo
  const holdout = load('./holdout.sealed.json'); // aberto so no release

  // O hash do nucleo entra em todo relatorio: dois numeros so sao
  // comparaveis se vierem do mesmo hash de nucleo.
  const coreHash = createHash('sha256')
    .update(JSON.stringify(core.cases))
    .digest('hex')
    .slice(0, 12);

  const suite = {
    coreVersion: core.version,
    coreHash,
    windowVersion: window.version,
    layers: { core: core.cases, window: window.cases },
  };

  // Barreira explicita: acessar o holdout fora do release e o erro
  // que transforma o instrumento de honestidade em mais um alvo.
  if (allowHoldout) {
    suite.layers.holdout = holdout.cases;
  }

  return suite;
}

export function assertComparable(reportA, reportB) {
  if (reportA.coreHash !== reportB.coreHash) {
    throw new Error(
      \`Nucleo diferente (\${reportA.coreVersion} vs \${reportB.coreVersion}): \` +
        'as notas nao sao comparaveis diretamente.',
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'A função de comparabilidade no final não é um detalhe de engenharia, é o mecanismo que impede o erro mais comum na renovação: trocar o conjunto e continuar plotando a série histórica como se nada tivesse acontecido. Um salto de cinco pontos no gráfico que na verdade foi troca de conjunto contamina toda decisão tomada em cima dele, e como o gráfico não avisa, ninguém percebe.',
        },
      ],
    },
    {
      title: 'Como renovar a janela sem quebrar a série histórica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renovar a janela é substituir casos antigos por uma amostra nova do tráfego. O erro que arruina a comparabilidade é fazer isso de um dia para o outro e seguir olhando o mesmo número. O procedimento que preserva a leitura tem uma etapa a mais: antes de aposentar o conjunto velho, rode as duas versões na mesma versão do sistema e registre a diferença. Essa diferença é a calibração entre os dois conjuntos, e ela separa "o sistema mudou" de "a régua mudou".',
        },
        {
          type: 'ordered',
          items: [
            'Amostre o novo tráfego por estrato, não uniformemente: preserve a proporção de intenções, canais e idiomas do período, senão o conjunto novo mede um recorte enviesado.',
            'Rotule com a política vigente, não com a política do conjunto antigo, e registre a data da política junto com o caso.',
            'Rode o sistema atual, sem mudanças, nas duas versões do conjunto e anote o delta: essa é a diferença de dificuldade entre conjuntos, não de qualidade do sistema.',
            'Publique a série histórica com uma marca visível de troca de conjunto no ponto da renovação, e o delta de calibração ao lado.',
            'Guarde o conjunto antigo executável, não apenas arquivado: sem poder rodá-lo de novo, você perde a capacidade de reinterpretar decisões passadas.',
            'Promova ao núcleo os casos da janela que viraram invariantes de fato, mas só via revisão, nunca automaticamente por antiguidade.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O item três é o que a maioria pula por pressa, e é o único que custa quase nada: uma execução extra do sistema atual contra o conjunto velho, no mesmo dia da troca. Sem esse número, quando a nota cair três pontos no mês seguinte ninguém vai saber se o sistema piorou ou se o conjunto novo é mais difícil, e a discussão vira opinião. Com ele, a resposta é aritmética.',
        },
        {
          type: 'table',
          columns: ['Camada', 'Frequência de mudança', 'Quem autoriza', 'Comparável com'],
          rows: [
            [
              'Núcleo congelado',
              'Só quando a política muda',
              'Revisão explícita com registro do motivo',
              'Todo o histórico com o mesmo hash',
            ],
            [
              'Janela rotativa',
              'A cada ciclo definido, tipicamente mensal ou trimestral',
              'Dono do eval, seguindo o procedimento de amostragem',
              'Apenas a mesma versão da janela',
            ],
            [
              'Holdout selado',
              'Renovado quando é aberto',
              'Aberto só na decisão de release',
              'Nada: é medida pontual, não série',
            ],
          ],
        },
      ],
    },
    {
      title: 'Os gatilhos que dizem que chegou a hora',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renovar por calendário funciona, mas é grosseiro: renova cedo demais quando o produto está estável e tarde demais quando ele muda rápido. Os gatilhos abaixo são sinais mensuráveis de que o conjunto perdeu representatividade, e vale monitorá-los como se fossem alertas de produção, porque é exatamente isso que eles são.',
        },
        {
          type: 'list',
          items: [
            'Cobertura de intenção abaixo do limite: uma fatia relevante do tráfego cai em intenções que o conjunto não representa, tipicamente quando um lançamento cria uma família nova de perguntas.',
            'Saturação da nota: o conjunto passou de um teto alto e parou de discriminar, ou seja, versões claramente diferentes do sistema tiram notas praticamente iguais.',
            'Divergência entre eval e realidade: a nota fica estável enquanto reclamações, transbordos para humano ou reaberturas de ticket sobem.',
            'Abertura do holdout revelando distância: a diferença entre a nota da janela e a do holdout cresce, sinal de otimização contra a régua.',
            'Mudança de política registrada: qualquer alteração na regra de negócio invalida os rótulos afetados, e isso é gatilho imediato, não do próximo ciclo.',
            'Troca de modelo ou de provedor: a mudança pode alterar o perfil de erro e revelar classes de falha que o conjunto atual não cobre.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A saturação merece um cuidado extra porque costuma ser confundida com sucesso. Quando o conjunto está saturado, ele para de responder à pergunta para a qual existe, que é distinguir uma versão da outra. Um eval em que todas as versões tiram 96% não diz que o sistema está ótimo, diz que o instrumento chegou ao fim da escala. A checagem barata é o poder discriminatório: pegue duas versões que você sabe serem diferentes, por exemplo o modelo atual e um modelo notoriamente mais fraco, e veja se o conjunto separa as duas. Se não separar, o conjunto parou de medir.',
        },
        {
          type: 'code',
          value: `// eval/health.js
// Saude do proprio conjunto de avaliacao. Um eval que nao discrimina
// versoes diferentes parou de responder a pergunta para a qual existe.

export function evalHealth({ scores, trafficIntents, coveredIntents, weakBaseline }) {
  const covered = new Set(coveredIntents);
  const totalTraffic = trafficIntents.reduce((sum, i) => sum + i.volume, 0);
  const uncovered = trafficIntents
    .filter((i) => !covered.has(i.name))
    .reduce((sum, i) => sum + i.volume, 0);

  // Quanto do trafego real cai em intencoes que o conjunto nao representa.
  const coverageGap = totalTraffic > 0 ? uncovered / totalTraffic : 0;

  // Poder discriminatorio: distancia entre o sistema atual e uma baseline
  // que sabemos ser pior. Se encolhe, o conjunto saturou.
  const discrimination = scores.current - weakBaseline;

  // Distancia janela x holdout: cresce quando se otimiza contra a regua.
  const overfitGap = scores.window - scores.holdout;

  return {
    coverageGap,
    discrimination,
    overfitGap,
    needsRenewal: coverageGap > 0.15 || discrimination < 0.1 || overfitGap > 0.08,
    reasons: [
      coverageGap > 0.15 && 'cobertura de intencao insuficiente',
      discrimination < 0.1 && 'conjunto saturado, nao discrimina versoes',
      overfitGap > 0.08 && 'otimizacao contra a regua detectada',
    ].filter(Boolean),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Os limiares desse código são pontos de partida, não constantes universais: eles dependem do tamanho do conjunto e da variância do seu domínio, e a forma honesta de calibrá-los é medir a variância de execuções repetidas do mesmo sistema no mesmo conjunto. Se rodar duas vezes o mesmo sistema já produz três pontos de diferença, um limiar de oito pontos para vazamento é razoável; se produz meio ponto, oito é frouxo demais e você vai demorar a enxergar o problema.',
        },
      ],
    },
    {
      title: 'Governança: quem muda o quê e com qual registro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A parte técnica de renovar um eval é simples. O que costuma falhar é a governança, porque o conjunto de avaliação tem um dono difuso: todo mundo adiciona casos, ninguém remove, e nenhuma mudança fica registrada. Depois de um ano, ninguém sabe por que aquele caso está lá, se o rótulo ainda vale, nem quem decidiu que a resposta esperada é aquela. O conjunto vira um sedimento em vez de um instrumento.',
        },
        {
          type: 'paragraph',
          value:
            'O tratamento é o mesmo que se dá a qualquer artefato de produção: o conjunto vive no repositório, mudanças passam por revisão, e cada caso carrega procedência. Um caso sem origem, sem data de rótulo e sem justificativa é um caso que ninguém vai poder auditar quando ele começar a falhar por motivo legítimo.',
        },
        {
          type: 'code',
          value: `// eval/core.frozen.json (trecho)
{
  "version": "core-2026-03",
  "policyDate": "2026-03-14",
  "cases": [
    {
      "id": "core-refund-window-001",
      "layer": "core",
      "input": "comprei ontem e quero cancelar, ainda da tempo?",
      "expected": {
        "mustState": ["prazo de 7 dias corridos"],
        "mustNotState": ["reembolso imediato garantido"],
        "mustCall": ["consultar_pedido"]
      },
      "rationale": "Prazo legal: errar aqui gera risco juridico, nao so ma experiencia.",
      "source": "politica-comercial-v4",
      "labeledAt": "2026-03-14",
      "labeledBy": "suporte-lead",
      "frozenSince": "2026-03-14"
    }
  ]
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que a expectativa não é uma string de resposta ideal. Comparar a saída do modelo com um texto exato é frágil e reprova respostas boas por diferença de redação. Descrever o que a resposta precisa afirmar, o que não pode afirmar e qual ferramenta precisa chamar é um contrato verificável que sobrevive a mudanças de estilo do modelo, e é justamente o que permite congelar o caso por muito tempo sem que ele fique falso.',
        },
        {
          type: 'ordered',
          items: [
            'Dono nomeado por camada: alguém responde pelo núcleo e alguém pela janela, com autoridade para recusar adição de caso.',
            'Toda mudança de rótulo registra a data e a política de referência, para reconstruir por que a expectativa era aquela.',
            'Remoção é tão legítima quanto adição: caso obsoleto sai do conjunto e vai para o arquivo executável, não fica ocupando espaço e distorcendo a média.',
            'Relatório sempre carimba a versão do conjunto e o hash do núcleo junto com a nota, sem exceção.',
            'Nenhum resultado de holdout entra em painel de acompanhamento contínuo: o holdout só aparece na decisão de release.',
          ],
        },
      ],
    },
    {
      title: 'O que o eval renovado deve devolver',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um conjunto de avaliação bem mantido não devolve um número, devolve uma leitura com três eixos que dizem coisas diferentes e não devem ser somados em uma média única. A nota do núcleo responde "alguma coisa que nunca podia quebrar quebrou?", e ela deve ser um portão binário: qualquer queda aqui bloqueia release, independentemente do resto. A nota da janela responde "como estamos no tráfego de hoje?", e ela é um indicador de tendência, comparável apenas dentro da mesma versão de janela. A nota do holdout responde "a melhoria é real?", e ela só é consultada quando há decisão a tomar.',
        },
        {
          type: 'table',
          columns: ['Eixo', 'Pergunta que responde', 'Como usar', 'Erro comum'],
          rows: [
            [
              'Núcleo',
              'Algo que nunca podia regredir regrediu?',
              'Portão binário de release',
              'Diluir na média geral e deixar uma regressão crítica passar',
            ],
            [
              'Janela',
              'Como o sistema vai no tráfego atual?',
              'Tendência dentro da mesma versão',
              'Comparar entre versões diferentes sem calibrar',
            ],
            [
              'Holdout',
              'A melhoria é real ou decorada?',
              'Consulta pontual na decisão de release',
              'Colocar no painel diário e transformar em novo alvo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A tentação de colapsar os três em um índice único é forte porque um número é mais fácil de reportar. Mas a média esconde exatamente o que cada eixo existe para revelar: uma regressão de segurança no núcleo desaparece dentro de uma janela grande com desempenho bom, e é essa a falha que você menos pode deixar passar. Reportar três números com significados distintos custa uma linha a mais no relatório e preserva a informação inteira.',
        },
        {
          type: 'paragraph',
          value:
            'No fim, congelar e renovar não são fases opostas de um ciclo, são responsabilidades simultâneas de partes diferentes do mesmo conjunto. O que precisa ficar parado fica parado para que você possa comparar hoje com o ano passado. O que precisa se mover se move para que você continue medindo o cliente que existe agora. E a parte que ninguém pode olhar existe para que as outras duas continuem dizendo a verdade. Um eval que só congela vira folclore; um que só renova vira ruído. A disciplina está em saber qual pedaço é qual, e registrar toda vez que essa fronteira muda.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Com que frequência devo renovar o conjunto de avaliação?',
      answer:
        'Renovar por calendário puro é grosseiro, porque renova cedo demais quando o produto está estável e tarde demais quando ele muda rápido. Um ciclo de referência mensal ou trimestral para a janela rotativa funciona como base, mas a decisão real deve vir de gatilhos mensuráveis: cobertura de intenção abaixo do limite quando um lançamento cria uma família nova de perguntas, saturação da nota quando versões claramente diferentes do sistema tiram resultados praticamente iguais, divergência entre a nota estável e reclamações ou transbordos que sobem, e distância crescente entre a nota da janela e a do holdout. Mudança de política de produto e troca de modelo ou provedor são gatilhos imediatos, não do próximo ciclo, porque a primeira invalida rótulos e a segunda muda o perfil de erro. O núcleo congelado segue outra regra: ele só muda quando a política muda, e via revisão explícita.',
    },
    {
      question: 'Se eu trocar o conjunto, perco a comparação com os resultados anteriores?',
      answer:
        'Perde se trocar sem calibrar, e é o erro mais comum da renovação: substituir os casos e continuar plotando a mesma série histórica como se nada tivesse acontecido, o que transforma diferença de dificuldade entre conjuntos em falsa evidência de melhoria ou piora. O procedimento que preserva a leitura acrescenta uma etapa barata: antes de aposentar o conjunto velho, rode o sistema atual sem nenhuma mudança nas duas versões do conjunto e registre o delta. Esse delta é a diferença de dificuldade, não de qualidade, e permite ler a série depois da troca. Junto com isso, marque visivelmente o ponto de troca no gráfico, guarde o conjunto antigo executável e não apenas arquivado, e carimbe a versão do conjunto e o hash do núcleo em todo relatório, para que dois números só sejam comparados diretamente quando vierem da mesma régua.',
    },
    {
      question: 'Por que manter um holdout que nunca é olhado durante o desenvolvimento?',
      answer:
        'Porque ele é o único instrumento que detecta otimização contra a régua. Quando o time ajusta o prompt olhando o resultado do eval, o conjunto deixa de ser medição independente e vira alvo, e o sistema aprende a acertar aqueles casos específicos em vez de aprender a tarefa, o que produz uma nota alta que não se traduz em qualidade percebida. O holdout selado, amostrado do mesmo tráfego mas nunca consultado durante o desenvolvimento, dá a resposta: se a nota dele acompanha as demais, a melhoria é real; se fica para trás, o ganho foi decorado. Por isso ele nunca pode entrar em painel de acompanhamento contínuo, já que um holdout olhado toda semana vira apenas mais um alvo, e por isso ele é renovado quando é aberto, na decisão de release.',
    },
  ],
  conclusion: {
    title: 'Um eval só continua útil se você souber qual parte pode mudar',
    description:
      'Conjunto de avaliação não é artefato que se monta uma vez: ele envelhece por deriva de tráfego, por vazamento de casos já corrigidos, por otimização contra a régua e por rótulo preso a uma política que mudou, e envelhece em silêncio, com a nota subindo enquanto o cliente reclama. Separar o conjunto em núcleo congelado, janela rotativa e holdout selado, calibrar toda troca rodando o sistema atual nas duas versões, carimbar versão e hash em todo relatório e monitorar a saúde do próprio eval transforma um número que ninguém confia em três leituras que decidem release. Posso montar e versionar esse conjunto no seu sistema de IA, definir o que congela e o que rotaciona, instalar o holdout e deixar o relatório com os três eixos separados, para você saber se melhorou de verdade em vez de comemorar um instrumento saturado.',
    cta: 'Falar sobre avaliação do meu sistema de IA',
  },
  related: [
    { label: 'Avaliação contínua de bots com eval automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Detectar deriva de qualidade antes do cliente reclamar', to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

const en = {
  intro:
    'You built an evaluation set for your agent, it scored 78%, and six months later it scores 94%. The obvious reading is that the system improved. The likely reading is that the set aged: every fixed bug became an eval case, every case added was one the system was already failing and then started passing, and what is left is a portrait of the past. The eval keeps running green while customers complain about things it does not measure. That is the core problem: an evaluation set has to be stable so you can compare versions over time, and it has to change so it keeps representing real traffic, and those two requirements contradict each other. The way out is not picking one, it is splitting the set into parts with different rules for change, versioning every change as if it were code, and never comparing numbers from different versions without saying they are different. This article shows how to do that in practice: what to freeze, what to renew, how to know when it is time, and how to measure whether the eval still has anything to say about the system.',
  sections: [
    {
      title: 'Why the eval ages even when nobody touches it',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An evaluation set is a sample of a world that moves. It gets old through three independent paths, and all three happen in parallel in any live product. The first is traffic drift: customers start asking things they did not ask before, new products enter the catalog, a campaign shifts the profile of who arrives, a new feature creates an entire class of question that did not exist. The eval built last quarter measures an audience that is no longer yours.',
        },
        {
          type: 'paragraph',
          value:
            'The second path is leakage through fixing, and it is the most insidious because it is a direct consequence of doing the right thing. Every case that enters the eval because the system failed is a case someone will fix right after. Over time, the set turns into a list of already solved problems, and the score rises without customer-perceived quality changing. The third is optimizing against the ruler: when the team tunes the prompt while watching the eval result, the eval stops being an independent measurement and becomes a target, and the system learns to pass those specific cases instead of learning the task.',
        },
        {
          type: 'table',
          columns: ['Way of aging', 'Symptom on the dashboard', 'What the number starts to mean'],
          rows: [
            [
              'Traffic drift',
              'Stable score while complaints rise',
              'Quality on an audience that is no longer yours',
            ],
            [
              'Leakage through fixing',
              'Score rises monotonically, never plateaus',
              'How many old bugs are still fixed',
            ],
            [
              'Optimizing against the ruler',
              'High eval score, drop on a fresh sample',
              'Adherence to eval cases, not to the task',
            ],
            [
              'Outdated label',
              'Failures that human review considers correct',
              'Adherence to a policy that already changed',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fourth row deserves attention because it is almost never remembered. The expected answers in the eval reflect the product policy on the day they were written. If the company changed the refund rule, the eval keeps demanding the old answer and marking the correct one as a failure. At that point the eval is not merely old, it is actively wrong, and a disciplined team chasing a green eval will push the system back toward the behavior the product abandoned.',
        },
      ],
    },
    {
      title: 'Freezing is not standing still: the three layers',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The confusion that stalls most teams is treating the eval as a single object that is either frozen or changing. It should be split into layers with different change contracts, and each layer answers a distinct question. One layer exists to detect regression and must never change. Another exists to represent current traffic and has to change. The third exists to guard against optimization and you are not even allowed to look at it.',
        },
        {
          type: 'diagram',
          value: `Evaluation set layers

  +-- FROZEN CORE (30-40% of cases) ------------------+
  |  Canonical cases, safety invariants,              |
  |  behaviors that must never regress.               |
  |  Changes only through an explicit RFC.            |
  |  Comparable across every system version.          |
  +---------------------------------------------------+

  +-- ROTATING WINDOW (40-50% of cases) --------------+
  |  Sample of traffic from the last N months.        |
  |  Renewed each cycle. Comparable only within       |
  |  the same version of the set.                     |
  +---------------------------------------------------+

  +-- SEALED HOLDOUT (20-30% of cases) ---------------+
  |  Never looked at during development.              |
  |  Opened only at the release decision.             |
  |  Detects optimizing against the ruler.            |
  +---------------------------------------------------+

  green core + green window + holdout far below
     -> the team optimized against the eval, did not improve the system`,
        },
        {
          type: 'paragraph',
          value:
            'The frozen core is what gives historical comparability. It holds the cases that define the acceptable minimum: the refusal the bot has to make, the sensitive data it must not repeat, the escalation it has to trigger, the calculation it cannot get wrong. Those cases do not change because traffic changed; they change when product policy changes, and then the change goes through explicit review and becomes a new core version, with the old number preserved.',
        },
        {
          type: 'paragraph',
          value:
            'The rotating window is the opposite: it must change, because its job is to answer "how does the system do on what customers are asking right now?". Sampling that window from real traffic, rather than from cases someone hand-wrote, is what prevents leakage through fixing. And the sealed holdout is the honesty instrument: if its score tracks the other two, the improvement is real; if it lags, the gain was memorized.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Three-layer evaluation set with distinct change contracts.
// The core freezes, the window rotates, the holdout opens only at release.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

export function loadEvalSuite({ allowHoldout = false } = {}) {
  const core = load('./core.frozen.json');       // changes only through an RFC
  const window = load('./window.current.json');  // rotates each cycle
  const holdout = load('./holdout.sealed.json'); // opened only at release

  // The core hash goes into every report: two numbers are only
  // comparable if they come from the same core hash.
  const coreHash = createHash('sha256')
    .update(JSON.stringify(core.cases))
    .digest('hex')
    .slice(0, 12);

  const suite = {
    coreVersion: core.version,
    coreHash,
    windowVersion: window.version,
    layers: { core: core.cases, window: window.cases },
  };

  // Explicit barrier: touching the holdout outside release is the mistake
  // that turns the honesty instrument into just another target.
  if (allowHoldout) {
    suite.layers.holdout = holdout.cases;
  }

  return suite;
}

export function assertComparable(reportA, reportB) {
  if (reportA.coreHash !== reportB.coreHash) {
    throw new Error(
      \`Different core (\${reportA.coreVersion} vs \${reportB.coreVersion}): \` +
        'the scores are not directly comparable.',
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'The comparability function at the end is not an engineering detail, it is the mechanism that prevents the most common mistake in renewal: swapping the set and continuing to plot the historical series as if nothing had happened. A five-point jump on the chart that was actually a set swap contaminates every decision made on top of it, and since the chart does not warn anyone, nobody notices.',
        },
      ],
    },
    {
      title: 'How to renew the window without breaking the historical series',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renewing the window means replacing old cases with a fresh traffic sample. The mistake that ruins comparability is doing it overnight and keeping an eye on the same number. The procedure that preserves the reading has one extra step: before retiring the old set, run both versions against the same system version and record the difference. That difference is the calibration between the two sets, and it separates "the system changed" from "the ruler changed".',
        },
        {
          type: 'ordered',
          items: [
            'Sample new traffic by stratum, not uniformly: preserve the proportion of intents, channels and languages of the period, otherwise the new set measures a biased slice.',
            'Label with the current policy, not the policy of the old set, and record the policy date alongside the case.',
            'Run the current system, unchanged, against both versions of the set and note the delta: that is the difficulty difference between sets, not a change in system quality.',
            'Publish the historical series with a visible set-swap marker at the renewal point, and the calibration delta next to it.',
            'Keep the old set executable, not merely archived: without being able to run it again, you lose the ability to reinterpret past decisions.',
            'Promote window cases that became de facto invariants into the core, but only through review, never automatically by age.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Item three is the one most teams skip out of haste, and the only one that costs almost nothing: one extra run of the current system against the old set, on the same day as the swap. Without that number, when the score drops three points next month nobody will know whether the system got worse or the new set is harder, and the discussion becomes opinion. With it, the answer is arithmetic.',
        },
        {
          type: 'table',
          columns: ['Layer', 'Change frequency', 'Who authorizes', 'Comparable with'],
          rows: [
            [
              'Frozen core',
              'Only when policy changes',
              'Explicit review with the reason recorded',
              'The entire history sharing the same hash',
            ],
            [
              'Rotating window',
              'Every defined cycle, typically monthly or quarterly',
              'The eval owner, following the sampling procedure',
              'Only the same window version',
            ],
            [
              'Sealed holdout',
              'Renewed when it is opened',
              'Opened only at the release decision',
              'Nothing: it is a point measure, not a series',
            ],
          ],
        },
      ],
    },
    {
      title: 'The triggers that say it is time',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renewing on a calendar works, but it is crude: it renews too early when the product is stable and too late when it moves fast. The triggers below are measurable signals that the set lost representativeness, and they are worth monitoring like production alerts, because that is exactly what they are.',
        },
        {
          type: 'list',
          items: [
            'Intent coverage below the threshold: a relevant slice of traffic falls into intents the set does not represent, typically when a launch creates a new family of questions.',
            'Score saturation: the set passed a high ceiling and stopped discriminating, meaning clearly different system versions get practically identical scores.',
            'Divergence between eval and reality: the score stays flat while complaints, handoffs to humans or ticket reopenings rise.',
            'Opening the holdout reveals distance: the gap between the window score and the holdout score grows, a sign of optimizing against the ruler.',
            'Recorded policy change: any business-rule change invalidates the affected labels, and that is an immediate trigger, not a next-cycle one.',
            'Model or provider swap: the change can shift the error profile and reveal failure classes the current set does not cover.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Saturation deserves extra care because it is usually mistaken for success. When the set is saturated, it stops answering the question it exists for, which is telling one version from another. An eval where every version scores 96% does not say the system is excellent, it says the instrument hit the end of its scale. The cheap check is discriminative power: take two versions you know are different, for example the current model and a notoriously weaker one, and see whether the set separates them. If it does not, the set stopped measuring.',
        },
        {
          type: 'code',
          value: `// eval/health.js
// Health of the evaluation set itself. An eval that cannot discriminate
// between different versions stopped answering the question it exists for.

export function evalHealth({ scores, trafficIntents, coveredIntents, weakBaseline }) {
  const covered = new Set(coveredIntents);
  const totalTraffic = trafficIntents.reduce((sum, i) => sum + i.volume, 0);
  const uncovered = trafficIntents
    .filter((i) => !covered.has(i.name))
    .reduce((sum, i) => sum + i.volume, 0);

  // How much real traffic falls into intents the set does not represent.
  const coverageGap = totalTraffic > 0 ? uncovered / totalTraffic : 0;

  // Discriminative power: distance between the current system and a baseline
  // we know is worse. If it shrinks, the set saturated.
  const discrimination = scores.current - weakBaseline;

  // Window vs holdout gap: grows when optimizing against the ruler.
  const overfitGap = scores.window - scores.holdout;

  return {
    coverageGap,
    discrimination,
    overfitGap,
    needsRenewal: coverageGap > 0.15 || discrimination < 0.1 || overfitGap > 0.08,
    reasons: [
      coverageGap > 0.15 && 'insufficient intent coverage',
      discrimination < 0.1 && 'saturated set, does not discriminate versions',
      overfitGap > 0.08 && 'optimizing against the ruler detected',
    ].filter(Boolean),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'The thresholds in that code are starting points, not universal constants: they depend on the size of the set and the variance of your domain, and the honest way to calibrate them is measuring the variance of repeated runs of the same system against the same set. If running the same system twice already produces three points of difference, an eight-point threshold for leakage is reasonable; if it produces half a point, eight is far too loose and you will be slow to see the problem.',
        },
      ],
    },
    {
      title: 'Governance: who changes what, and with what record',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The technical part of renewing an eval is simple. What usually fails is governance, because the evaluation set has a diffuse owner: everyone adds cases, nobody removes any, and no change is recorded. After a year, nobody knows why that case is there, whether the label still holds, or who decided the expected answer was that one. The set becomes sediment instead of an instrument.',
        },
        {
          type: 'paragraph',
          value:
            'The treatment is the same one you give any production artifact: the set lives in the repository, changes go through review, and every case carries provenance. A case with no origin, no labeling date and no rationale is a case nobody will be able to audit when it starts failing for a legitimate reason.',
        },
        {
          type: 'code',
          value: `// eval/core.frozen.json (excerpt)
{
  "version": "core-2026-03",
  "policyDate": "2026-03-14",
  "cases": [
    {
      "id": "core-refund-window-001",
      "layer": "core",
      "input": "i bought yesterday and want to cancel, am i still in time?",
      "expected": {
        "mustState": ["7 calendar day window"],
        "mustNotState": ["immediate refund guaranteed"],
        "mustCall": ["lookup_order"]
      },
      "rationale": "Statutory window: getting this wrong is legal risk, not just bad UX.",
      "source": "commercial-policy-v4",
      "labeledAt": "2026-03-14",
      "labeledBy": "support-lead",
      "frozenSince": "2026-03-14"
    }
  ]
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note that the expectation is not a string with an ideal answer. Comparing model output against exact text is brittle and fails good answers over wording differences. Describing what the answer must state, what it must not state and which tool it must call is a verifiable contract that survives changes in model style, and that is precisely what lets you freeze the case for a long time without it going stale.',
        },
        {
          type: 'ordered',
          items: [
            'A named owner per layer: someone answers for the core and someone for the window, with authority to reject a case addition.',
            'Every label change records the date and the reference policy, so you can reconstruct why the expectation was what it was.',
            'Removal is as legitimate as addition: an obsolete case leaves the set and goes to the executable archive instead of sitting there distorting the average.',
            'Every report stamps the set version and the core hash next to the score, with no exceptions.',
            'No holdout result goes into a continuous monitoring dashboard: the holdout appears only at the release decision.',
          ],
        },
      ],
    },
    {
      title: 'What a renewed eval should return',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A well-maintained evaluation set does not return a number, it returns a reading along three axes that say different things and must not be collapsed into a single average. The core score answers "did something that must never break, break?", and it should be a binary gate: any drop here blocks the release regardless of everything else. The window score answers "where do we stand on today traffic?", and it is a trend indicator, comparable only within the same window version. The holdout score answers "is the improvement real?", and it is consulted only when there is a decision to make.',
        },
        {
          type: 'table',
          columns: ['Axis', 'Question it answers', 'How to use it', 'Common mistake'],
          rows: [
            [
              'Core',
              'Did something that must never regress, regress?',
              'Binary release gate',
              'Diluting it into the overall average and letting a critical regression through',
            ],
            [
              'Window',
              'How is the system doing on current traffic?',
              'Trend within the same version',
              'Comparing across different versions without calibrating',
            ],
            [
              'Holdout',
              'Is the improvement real or memorized?',
              'Point check at the release decision',
              'Putting it on the daily dashboard and turning it into a new target',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The temptation to collapse the three into a single index is strong because one number is easier to report. But the average hides exactly what each axis exists to reveal: a safety regression in the core disappears inside a large window with good performance, and that is the failure you can least afford to let through. Reporting three numbers with distinct meanings costs one extra line in the report and preserves the whole signal.',
        },
        {
          type: 'paragraph',
          value:
            'In the end, freezing and renewing are not opposite phases of a cycle, they are simultaneous responsibilities of different parts of the same set. What needs to stay still stays still so you can compare today with last year. What needs to move moves so you keep measuring the customer who exists now. And the part nobody may look at exists so the other two keep telling the truth. An eval that only freezes becomes folklore; one that only renews becomes noise. The discipline is knowing which piece is which, and recording every time that boundary moves.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'How often should I renew the evaluation set?',
      answer:
        'Renewing purely on a calendar is crude, because it renews too early when the product is stable and too late when it moves fast. A monthly or quarterly reference cycle for the rotating window works as a baseline, but the real decision should come from measurable triggers: intent coverage below the threshold when a launch creates a new family of questions, score saturation when clearly different system versions produce practically identical results, divergence between a flat score and rising complaints or handoffs, and a growing gap between the window score and the holdout score. A product policy change and a model or provider swap are immediate triggers, not next-cycle ones, because the first invalidates labels and the second changes the error profile. The frozen core follows a different rule: it changes only when policy changes, through explicit review.',
    },
    {
      question: 'If I swap the set, do I lose comparison with previous results?',
      answer:
        'You do if you swap without calibrating, and that is the most common renewal mistake: replacing the cases and continuing to plot the same historical series as if nothing happened, which turns a difficulty difference between sets into false evidence of improvement or decline. The procedure that preserves the reading adds one cheap step: before retiring the old set, run the current system with no changes against both versions and record the delta. That delta is a difficulty difference, not a quality difference, and it lets you read the series across the swap. Alongside that, mark the swap point visibly on the chart, keep the old set executable rather than merely archived, and stamp the set version and core hash on every report, so two numbers are only compared directly when they come from the same ruler.',
    },
    {
      question: 'Why keep a holdout that is never looked at during development?',
      answer:
        'Because it is the only instrument that detects optimizing against the ruler. When the team tunes the prompt while watching the eval result, the set stops being an independent measurement and becomes a target, and the system learns to pass those specific cases instead of learning the task, which produces a high score that does not translate into perceived quality. The sealed holdout, sampled from the same traffic but never consulted during development, gives the answer: if its score tracks the others, the improvement is real; if it lags, the gain was memorized. That is why it can never go into a continuous monitoring dashboard, since a holdout looked at every week is just another target, and that is why it is renewed when it is opened, at the release decision.',
    },
  ],
  conclusion: {
    title: 'An eval stays useful only if you know which part may change',
    description:
      'An evaluation set is not an artifact you build once: it ages through traffic drift, through leakage of already fixed cases, through optimizing against the ruler and through labels tied to a policy that changed, and it ages silently, with the score rising while customers complain. Splitting the set into a frozen core, a rotating window and a sealed holdout, calibrating every swap by running the current system against both versions, stamping version and hash on every report and monitoring the health of the eval itself turns a number nobody trusts into three readings that decide releases. I can build and version that set in your AI system, define what freezes and what rotates, install the holdout and deliver a report with the three axes kept apart, so you know whether you really improved instead of celebrating a saturated instrument.',
    cta: 'Talk about evaluating my AI system',
  },
  related: [
    { label: 'Continuous bot evaluation with automated evals', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Detecting quality drift before customers complain', to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar' },
    { label: 'Chatbots and AI', to: '/servicos/chatbots-e-ia' },
  ],
};

const es = {
  intro:
    'Armaste un conjunto de evaluación para tu agente, acertaba el 78% de los casos, y seis meses después acierta el 94%. La lectura obvia es que el sistema mejoró. La lectura probable es que el conjunto envejeció: cada bug corregido se convirtió en un caso del eval, cada caso agregado fue uno que el sistema ya fallaba y pasó a acertar, y lo que quedó es un retrato del pasado. El eval sigue en verde mientras el cliente se queja de cosas que no mide. Ese es el problema central: un conjunto de evaluación necesita ser estable para poder comparar versiones a lo largo del tiempo, y necesita cambiar para seguir representando el tráfico real, y esas dos exigencias se contradicen. La salida no es elegir una, es separar el conjunto en partes con reglas de cambio distintas, versionar cada cambio como si fuera código, y nunca comparar números que vinieron de versiones diferentes sin decir que son diferentes. Este artículo muestra cómo hacerlo en la práctica: qué congelar, qué renovar, cómo saber que llegó el momento y cómo medir si el eval todavía tiene algo que decir sobre el sistema.',
  sections: [
    {
      title: 'Por qué el eval envejece aunque nadie lo toque',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un conjunto de evaluación es una muestra de un mundo que se mueve. Se pone viejo por tres caminos independientes, y los tres ocurren en paralelo en cualquier producto vivo. El primero es el cambio del tráfico: los clientes pasan a preguntar cosas que no preguntaban, entran productos nuevos al catálogo, una campaña cambia el perfil de quien llega, una feature nueva crea una clase entera de duda que no existía. El eval armado el trimestre pasado mide un público que ya no es el tuyo.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo camino es la filtración por corrección, y es el más insidioso porque es consecuencia directa de hacer lo correcto. Todo caso que entra al eval porque el sistema falló es un caso que alguien va a corregir enseguida. Con el tiempo, el conjunto se transforma en una lista de problemas ya resueltos, y la nota sube sin que la calidad percibida por el cliente cambie. El tercero es la optimización contra la regla: cuando el equipo ajusta el prompt mirando el resultado del eval, el eval deja de ser una medición independiente y se vuelve un objetivo, y el sistema aprende a acertar esos casos específicos en vez de aprender la tarea.',
        },
        {
          type: 'table',
          columns: ['Forma de envejecer', 'Síntoma en el panel', 'Qué pasa a significar el número'],
          rows: [
            [
              'Deriva de tráfico',
              'Nota estable mientras suben los reclamos',
              'Calidad en un público que ya no es el tuyo',
            ],
            [
              'Filtración por corrección',
              'La nota sube de forma monótona, sin meseta',
              'Cuántos bugs viejos siguen corregidos',
            ],
            [
              'Optimización contra la regla',
              'Nota alta en el eval, caída en una muestra nueva',
              'Adherencia a los casos del eval, no a la tarea',
            ],
            [
              'Etiqueta desactualizada',
              'Fallas que la revisión humana considera correctas',
              'Adherencia a una política que ya cambió',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La cuarta fila merece atención porque casi nunca se recuerda. Las respuestas esperadas del eval reflejan la política del producto del día en que fueron escritas. Si la empresa cambió la regla de reembolso, el eval sigue exigiendo la respuesta vieja y marcando como error la respuesta correcta. En ese punto el eval no solo está viejo, está activamente equivocado, y un equipo disciplinado que persigue un eval en verde va a empujar al sistema de vuelta al comportamiento que el producto abandonó.',
        },
      ],
    },
    {
      title: 'Congelar no es dejar quieto: las tres capas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La confusión que traba a la mayoría de los equipos es tratar al eval como un objeto único que o está congelado o está cambiando. Debe dividirse en capas con contratos de cambio distintos, y cada capa responde a una pregunta diferente. Una capa existe para detectar regresión y nunca puede cambiar. Otra existe para representar el tráfico actual y necesita cambiar. La tercera existe para proteger contra la optimización y ni siquiera podés mirarla.',
        },
        {
          type: 'diagram',
          value: `Capas del conjunto de evaluacion

  +-- NUCLEO CONGELADO (30-40% de los casos) ---------+
  |  Casos canonicos, invariantes de seguridad,       |
  |  comportamientos que nunca pueden regresar.       |
  |  Cambia solo por RFC explicita. Comparable        |
  |  entre todas las versiones del sistema.           |
  +---------------------------------------------------+

  +-- VENTANA ROTATIVA (40-50% de los casos) ---------+
  |  Muestra del trafico de los ultimos N meses.      |
  |  Renovada cada ciclo. Comparable solo dentro      |
  |  de la misma version del conjunto.                |
  +---------------------------------------------------+

  +-- HOLDOUT SELLADO (20-30% de los casos) ----------+
  |  Nunca mirado durante el desarrollo.              |
  |  Abierto solo en la decision de release.          |
  |  Detecta optimizacion contra la regla.            |
  +---------------------------------------------------+

  nucleo verde + ventana verde + holdout muy por debajo
     -> el equipo optimizo contra el eval, no mejoro el sistema`,
        },
        {
          type: 'paragraph',
          value:
            'El núcleo congelado es lo que da comparabilidad histórica. Contiene los casos que definen el mínimo aceptable: el rechazo que el bot tiene que hacer, el dato sensible que no puede repetir, el escalamiento que tiene que disparar, el cálculo que no puede errar. Esos casos no cambian porque el tráfico cambió; cambian cuando la política del producto cambia, y ahí el cambio pasa por revisión explícita y se convierte en una versión nueva del núcleo, con el número viejo preservado.',
        },
        {
          type: 'paragraph',
          value:
            'La ventana rotativa es lo opuesto: debe cambiar, porque su función es responder "cómo le va al sistema en lo que los clientes están preguntando ahora". Muestrear esa ventana del tráfico real, y no de casos que alguien escribió a mano, es lo que evita la filtración por corrección. Y el holdout sellado es el instrumento de honestidad: si su nota acompaña a las otras dos, la mejora es real; si se queda atrás, la ganancia fue memorizada.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Conjunto de evaluacion en tres capas con contratos de cambio distintos.
// El nucleo congela, la ventana rota, el holdout solo abre en el release.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const load = (file) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

export function loadEvalSuite({ allowHoldout = false } = {}) {
  const core = load('./core.frozen.json');       // cambia solo por RFC
  const window = load('./window.current.json');  // rota por ciclo
  const holdout = load('./holdout.sealed.json'); // abierto solo en el release

  // El hash del nucleo entra en todo reporte: dos numeros solo son
  // comparables si vienen del mismo hash de nucleo.
  const coreHash = createHash('sha256')
    .update(JSON.stringify(core.cases))
    .digest('hex')
    .slice(0, 12);

  const suite = {
    coreVersion: core.version,
    coreHash,
    windowVersion: window.version,
    layers: { core: core.cases, window: window.cases },
  };

  // Barrera explicita: acceder al holdout fuera del release es el error
  // que convierte al instrumento de honestidad en un objetivo mas.
  if (allowHoldout) {
    suite.layers.holdout = holdout.cases;
  }

  return suite;
}

export function assertComparable(reportA, reportB) {
  if (reportA.coreHash !== reportB.coreHash) {
    throw new Error(
      \`Nucleo diferente (\${reportA.coreVersion} vs \${reportB.coreVersion}): \` +
        'las notas no son comparables directamente.',
    );
  }
}`,
        },
        {
          type: 'paragraph',
          value:
            'La función de comparabilidad al final no es un detalle de ingeniería, es el mecanismo que impide el error más común en la renovación: cambiar el conjunto y seguir graficando la serie histórica como si nada hubiera pasado. Un salto de cinco puntos en el gráfico que en realidad fue un cambio de conjunto contamina toda decisión tomada encima, y como el gráfico no avisa, nadie se da cuenta.',
        },
      ],
    },
    {
      title: 'Cómo renovar la ventana sin romper la serie histórica',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renovar la ventana es sustituir casos viejos por una muestra nueva del tráfico. El error que arruina la comparabilidad es hacerlo de un día para el otro y seguir mirando el mismo número. El procedimiento que preserva la lectura tiene un paso más: antes de jubilar el conjunto viejo, corré las dos versiones contra la misma versión del sistema y registrá la diferencia. Esa diferencia es la calibración entre los dos conjuntos, y separa "el sistema cambió" de "la regla cambió".',
        },
        {
          type: 'ordered',
          items: [
            'Muestreá el tráfico nuevo por estrato, no uniformemente: preservá la proporción de intenciones, canales e idiomas del período, si no el conjunto nuevo mide un recorte sesgado.',
            'Etiquetá con la política vigente, no con la política del conjunto viejo, y registrá la fecha de la política junto al caso.',
            'Corré el sistema actual, sin cambios, en las dos versiones del conjunto y anotá el delta: esa es la diferencia de dificultad entre conjuntos, no de calidad del sistema.',
            'Publicá la serie histórica con una marca visible de cambio de conjunto en el punto de la renovación, y el delta de calibración al lado.',
            'Guardá el conjunto viejo ejecutable, no solo archivado: sin poder correrlo de nuevo, perdés la capacidad de reinterpretar decisiones pasadas.',
            'Promové al núcleo los casos de la ventana que se volvieron invariantes de hecho, pero solo vía revisión, nunca automáticamente por antigüedad.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El ítem tres es el que la mayoría se saltea por apuro, y es el único que casi no cuesta: una ejecución extra del sistema actual contra el conjunto viejo, el mismo día del cambio. Sin ese número, cuando la nota caiga tres puntos el mes siguiente nadie va a saber si el sistema empeoró o si el conjunto nuevo es más difícil, y la discusión se vuelve opinión. Con él, la respuesta es aritmética.',
        },
        {
          type: 'table',
          columns: ['Capa', 'Frecuencia de cambio', 'Quién autoriza', 'Comparable con'],
          rows: [
            [
              'Núcleo congelado',
              'Solo cuando cambia la política',
              'Revisión explícita con registro del motivo',
              'Todo el historial con el mismo hash',
            ],
            [
              'Ventana rotativa',
              'Cada ciclo definido, típicamente mensual o trimestral',
              'Dueño del eval, siguiendo el procedimiento de muestreo',
              'Solo la misma versión de la ventana',
            ],
            [
              'Holdout sellado',
              'Renovado cuando se abre',
              'Abierto solo en la decisión de release',
              'Nada: es medida puntual, no serie',
            ],
          ],
        },
      ],
    },
    {
      title: 'Los disparadores que dicen que llegó el momento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Renovar por calendario funciona, pero es grueso: renueva demasiado temprano cuando el producto está estable y demasiado tarde cuando se mueve rápido. Los disparadores de abajo son señales medibles de que el conjunto perdió representatividad, y vale monitorearlos como si fueran alertas de producción, porque es exactamente lo que son.',
        },
        {
          type: 'list',
          items: [
            'Cobertura de intención por debajo del límite: una porción relevante del tráfico cae en intenciones que el conjunto no representa, típicamente cuando un lanzamiento crea una familia nueva de preguntas.',
            'Saturación de la nota: el conjunto pasó un techo alto y dejó de discriminar, es decir, versiones claramente distintas del sistema sacan notas prácticamente iguales.',
            'Divergencia entre eval y realidad: la nota queda estable mientras suben los reclamos, los traspasos a humano o las reaperturas de ticket.',
            'La apertura del holdout revela distancia: la diferencia entre la nota de la ventana y la del holdout crece, señal de optimización contra la regla.',
            'Cambio de política registrado: cualquier alteración en la regla de negocio invalida las etiquetas afectadas, y eso es disparador inmediato, no del próximo ciclo.',
            'Cambio de modelo o de proveedor: el cambio puede alterar el perfil de error y revelar clases de falla que el conjunto actual no cubre.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La saturación merece un cuidado extra porque suele confundirse con éxito. Cuando el conjunto está saturado, deja de responder la pregunta para la cual existe, que es distinguir una versión de otra. Un eval en el que todas las versiones sacan 96% no dice que el sistema esté óptimo, dice que el instrumento llegó al final de la escala. El chequeo barato es el poder discriminatorio: tomá dos versiones que sabés que son distintas, por ejemplo el modelo actual y uno notoriamente más débil, y mirá si el conjunto las separa. Si no las separa, el conjunto dejó de medir.',
        },
        {
          type: 'code',
          value: `// eval/health.js
// Salud del propio conjunto de evaluacion. Un eval que no discrimina
// versiones distintas dejo de responder la pregunta para la cual existe.

export function evalHealth({ scores, trafficIntents, coveredIntents, weakBaseline }) {
  const covered = new Set(coveredIntents);
  const totalTraffic = trafficIntents.reduce((sum, i) => sum + i.volume, 0);
  const uncovered = trafficIntents
    .filter((i) => !covered.has(i.name))
    .reduce((sum, i) => sum + i.volume, 0);

  // Cuanto del trafico real cae en intenciones que el conjunto no representa.
  const coverageGap = totalTraffic > 0 ? uncovered / totalTraffic : 0;

  // Poder discriminatorio: distancia entre el sistema actual y una baseline
  // que sabemos peor. Si se achica, el conjunto saturo.
  const discrimination = scores.current - weakBaseline;

  // Distancia ventana vs holdout: crece cuando se optimiza contra la regla.
  const overfitGap = scores.window - scores.holdout;

  return {
    coverageGap,
    discrimination,
    overfitGap,
    needsRenewal: coverageGap > 0.15 || discrimination < 0.1 || overfitGap > 0.08,
    reasons: [
      coverageGap > 0.15 && 'cobertura de intencion insuficiente',
      discrimination < 0.1 && 'conjunto saturado, no discrimina versiones',
      overfitGap > 0.08 && 'optimizacion contra la regla detectada',
    ].filter(Boolean),
  };
}`,
        },
        {
          type: 'paragraph',
          value:
            'Los umbrales de ese código son puntos de partida, no constantes universales: dependen del tamaño del conjunto y de la varianza de tu dominio, y la forma honesta de calibrarlos es medir la varianza de ejecuciones repetidas del mismo sistema en el mismo conjunto. Si correr dos veces el mismo sistema ya produce tres puntos de diferencia, un umbral de ocho puntos para la filtración es razonable; si produce medio punto, ocho es demasiado flojo y vas a tardar en ver el problema.',
        },
      ],
    },
    {
      title: 'Gobernanza: quién cambia qué y con qué registro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La parte técnica de renovar un eval es simple. Lo que suele fallar es la gobernanza, porque el conjunto de evaluación tiene un dueño difuso: todos agregan casos, nadie remueve, y ningún cambio queda registrado. Después de un año, nadie sabe por qué ese caso está ahí, si la etiqueta todavía vale, ni quién decidió que la respuesta esperada es esa. El conjunto se convierte en un sedimento en vez de un instrumento.',
        },
        {
          type: 'paragraph',
          value:
            'El tratamiento es el mismo que se le da a cualquier artefacto de producción: el conjunto vive en el repositorio, los cambios pasan por revisión, y cada caso lleva procedencia. Un caso sin origen, sin fecha de etiquetado y sin justificación es un caso que nadie va a poder auditar cuando empiece a fallar por un motivo legítimo.',
        },
        {
          type: 'code',
          value: `// eval/core.frozen.json (fragmento)
{
  "version": "core-2026-03",
  "policyDate": "2026-03-14",
  "cases": [
    {
      "id": "core-refund-window-001",
      "layer": "core",
      "input": "compre ayer y quiero cancelar, todavia estoy a tiempo?",
      "expected": {
        "mustState": ["plazo de 7 dias corridos"],
        "mustNotState": ["reembolso inmediato garantizado"],
        "mustCall": ["consultar_pedido"]
      },
      "rationale": "Plazo legal: errar aca es riesgo juridico, no solo mala experiencia.",
      "source": "politica-comercial-v4",
      "labeledAt": "2026-03-14",
      "labeledBy": "lider-soporte",
      "frozenSince": "2026-03-14"
    }
  ]
}`,
        },
        {
          type: 'paragraph',
          value:
            'Fijate en que la expectativa no es un string con la respuesta ideal. Comparar la salida del modelo con un texto exacto es frágil y reprueba respuestas buenas por diferencia de redacción. Describir qué tiene que afirmar la respuesta, qué no puede afirmar y qué herramienta tiene que llamar es un contrato verificable que sobrevive a cambios de estilo del modelo, y es justamente lo que permite congelar el caso por mucho tiempo sin que quede falso.',
        },
        {
          type: 'ordered',
          items: [
            'Dueño nombrado por capa: alguien responde por el núcleo y alguien por la ventana, con autoridad para rechazar el agregado de un caso.',
            'Todo cambio de etiqueta registra la fecha y la política de referencia, para reconstruir por qué la expectativa era esa.',
            'La remoción es tan legítima como el agregado: un caso obsoleto sale del conjunto y va al archivo ejecutable, no queda ocupando espacio y distorsionando el promedio.',
            'Todo reporte estampa la versión del conjunto y el hash del núcleo junto a la nota, sin excepción.',
            'Ningún resultado de holdout entra en un panel de seguimiento continuo: el holdout solo aparece en la decisión de release.',
          ],
        },
      ],
    },
    {
      title: 'Qué debe devolver el eval renovado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un conjunto de evaluación bien mantenido no devuelve un número, devuelve una lectura con tres ejes que dicen cosas distintas y que no deben sumarse en un promedio único. La nota del núcleo responde "¿se rompió algo que nunca podía romperse?", y debe ser una compuerta binaria: cualquier caída ahí bloquea el release, independientemente del resto. La nota de la ventana responde "¿cómo estamos en el tráfico de hoy?", y es un indicador de tendencia, comparable solo dentro de la misma versión de ventana. La nota del holdout responde "¿la mejora es real?", y solo se consulta cuando hay una decisión que tomar.',
        },
        {
          type: 'table',
          columns: ['Eje', 'Pregunta que responde', 'Cómo usarlo', 'Error común'],
          rows: [
            [
              'Núcleo',
              '¿Regresó algo que nunca podía regresar?',
              'Compuerta binaria de release',
              'Diluirlo en el promedio general y dejar pasar una regresión crítica',
            ],
            [
              'Ventana',
              '¿Cómo va el sistema en el tráfico actual?',
              'Tendencia dentro de la misma versión',
              'Comparar entre versiones distintas sin calibrar',
            ],
            [
              'Holdout',
              '¿La mejora es real o memorizada?',
              'Consulta puntual en la decisión de release',
              'Ponerlo en el panel diario y convertirlo en un objetivo nuevo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tentación de colapsar los tres en un índice único es fuerte porque un número es más fácil de reportar. Pero el promedio esconde exactamente lo que cada eje existe para revelar: una regresión de seguridad en el núcleo desaparece dentro de una ventana grande con buen desempeño, y esa es la falla que menos podés dejar pasar. Reportar tres números con significados distintos cuesta una línea más en el reporte y preserva la información entera.',
        },
        {
          type: 'paragraph',
          value:
            'Al final, congelar y renovar no son fases opuestas de un ciclo, son responsabilidades simultáneas de partes distintas del mismo conjunto. Lo que necesita quedarse quieto se queda quieto para que puedas comparar hoy con el año pasado. Lo que necesita moverse se mueve para que sigas midiendo al cliente que existe ahora. Y la parte que nadie puede mirar existe para que las otras dos sigan diciendo la verdad. Un eval que solo congela se vuelve folclore; uno que solo renueva se vuelve ruido. La disciplina está en saber qué pedazo es cuál, y registrar cada vez que esa frontera se mueve.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cada cuánto debo renovar el conjunto de evaluación?',
      answer:
        'Renovar por calendario puro es grueso, porque renueva demasiado temprano cuando el producto está estable y demasiado tarde cuando se mueve rápido. Un ciclo de referencia mensual o trimestral para la ventana rotativa funciona como base, pero la decisión real debe venir de disparadores medibles: cobertura de intención por debajo del límite cuando un lanzamiento crea una familia nueva de preguntas, saturación de la nota cuando versiones claramente distintas del sistema sacan resultados prácticamente iguales, divergencia entre una nota estable y reclamos o traspasos que suben, y distancia creciente entre la nota de la ventana y la del holdout. El cambio de política del producto y el cambio de modelo o proveedor son disparadores inmediatos, no del próximo ciclo, porque el primero invalida etiquetas y el segundo cambia el perfil de error. El núcleo congelado sigue otra regla: solo cambia cuando cambia la política, y vía revisión explícita.',
    },
    {
      question: 'Si cambio el conjunto, ¿pierdo la comparación con los resultados anteriores?',
      answer:
        'La perdés si cambiás sin calibrar, y es el error más común de la renovación: sustituir los casos y seguir graficando la misma serie histórica como si nada hubiera pasado, lo que convierte una diferencia de dificultad entre conjuntos en falsa evidencia de mejora o empeoramiento. El procedimiento que preserva la lectura agrega un paso barato: antes de jubilar el conjunto viejo, corré el sistema actual sin ningún cambio en las dos versiones del conjunto y registrá el delta. Ese delta es diferencia de dificultad, no de calidad, y permite leer la serie después del cambio. Junto con eso, marcá visiblemente el punto de cambio en el gráfico, guardá el conjunto viejo ejecutable y no solo archivado, y estampá la versión del conjunto y el hash del núcleo en todo reporte, para que dos números solo se comparen directamente cuando vengan de la misma regla.',
    },
    {
      question: '¿Por qué mantener un holdout que nunca se mira durante el desarrollo?',
      answer:
        'Porque es el único instrumento que detecta la optimización contra la regla. Cuando el equipo ajusta el prompt mirando el resultado del eval, el conjunto deja de ser medición independiente y se vuelve objetivo, y el sistema aprende a acertar esos casos específicos en vez de aprender la tarea, lo que produce una nota alta que no se traduce en calidad percibida. El holdout sellado, muestreado del mismo tráfico pero nunca consultado durante el desarrollo, da la respuesta: si su nota acompaña a las demás, la mejora es real; si se queda atrás, la ganancia fue memorizada. Por eso nunca puede entrar en un panel de seguimiento continuo, ya que un holdout mirado todas las semanas se vuelve un objetivo más, y por eso se renueva cuando se abre, en la decisión de release.',
    },
  ],
  conclusion: {
    title: 'Un eval sigue siendo útil solo si sabés qué parte puede cambiar',
    description:
      'Un conjunto de evaluación no es un artefacto que se arma una vez: envejece por deriva de tráfico, por filtración de casos ya corregidos, por optimización contra la regla y por etiquetas atadas a una política que cambió, y envejece en silencio, con la nota subiendo mientras el cliente se queja. Separar el conjunto en núcleo congelado, ventana rotativa y holdout sellado, calibrar cada cambio corriendo el sistema actual en las dos versiones, estampar versión y hash en todo reporte y monitorear la salud del propio eval transforma un número que nadie confía en tres lecturas que deciden el release. Puedo armar y versionar ese conjunto en tu sistema de IA, definir qué congela y qué rota, instalar el holdout y dejar el reporte con los tres ejes separados, para que sepas si mejoraste de verdad en vez de festejar un instrumento saturado.',
    cta: 'Hablar sobre evaluación de mi sistema de IA',
  },
  related: [
    { label: 'Evaluación continua de bots con eval automático', to: '/blog/avaliacao-continua-bots-eval-automatico' },
    { label: 'Detectar deriva de calidad antes de que el cliente reclame', to: '/blog/detectar-deriva-qualidade-bot-atendimento-antes-do-cliente-reclamar' },
    { label: 'Chatbots e IA', to: '/servicos/chatbots-e-ia' },
  ],
};

export default { pt, en, es };
