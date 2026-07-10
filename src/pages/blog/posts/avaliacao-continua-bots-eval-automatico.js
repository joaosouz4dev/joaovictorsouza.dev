// Conteudo do artigo: avaliacao continua de bots, do eval manual ao automatico.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'Harness mínimo de avaliação contínua de bots: dataset versionado de casos, juiz LLM com rubrica, métricas de exatidão e regressão e um gate de CI que reprova o deploy quando a qualidade cai.',
  en: 'Minimal continuous bot evaluation harness: versioned dataset of cases, LLM judge with a rubric, accuracy and regression metrics and a CI gate that fails the deploy when quality drops.',
  es: 'Harness mínimo de evaluación continua de bots: dataset versionado de casos, juez LLM con rubrica, métricas de exactitud y regresión y un gate de CI que reprueba el deploy cuando la calidad cae.',
};

const repoUrl = 'https://github.com/joaosouz4dev/bot-eval-harness';

const pt = {
  intro:
    'Quase todo bot de atendimento com IA nasce sem eval. Alguém conversa por cinco minutos, aprova no olho e sobe para produção. Isso funciona até a primeira mudança de prompt, troca de modelo ou ajuste de RAG quebrar em silêncio uma resposta que antes estava certa. Avaliação contínua é o que transforma essa checagem manual e subjetiva em um processo repetível: um dataset de casos com resposta esperada, uma métrica objetiva, um juiz automático e um gate no CI que reprova o deploy quando a qualidade cai. Este artigo mostra como sair do eval manual e chegar no automático sem exagerar na infra: como montar o dataset, quais métricas medir, como usar um LLM como juiz sem se enganar, como fechar o gate de regressão e como manter tudo isso vivo sem virar teatro de métricas.',
  sections: [
    {
      title: 'Por que o eval manual não escala',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O eval manual tem três problemas que só aparecem quando o bot já está em produção. Primeiro, ele não é reproduzível: duas pessoas avaliam a mesma resposta de formas diferentes, e a mesma pessoa avalia diferente em dias diferentes. Segundo, ele não cobre regressão: você testa as perguntas que lembrou na hora, nunca as cem que já funcionavam e podem ter quebrado. Terceiro, ele não tem gate: a mudança sobe porque pareceu boa, não porque passou num critério.',
        },
        {
          type: 'paragraph',
          value:
            'O objetivo do eval contínuo não é eliminar o julgamento humano, é ancorá-lo. Você escreve o critério uma vez, na forma de casos e rubrica, e a partir daí a máquina aplica esse mesmo critério em toda mudança. O humano volta a entrar só quando o resultado é ambíguo ou quando o dataset precisa crescer. É a diferença entre "achei que ficou bom" e "passou em 94 dos 100 casos, contra 96 na versão anterior, então a mudança regrediu".',
        },
      ],
    },
    {
      title: 'A escada da maturidade de eval',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Não se pula do manual direto para o automático completo. Existe uma escada, e cada degrau resolve um problema do anterior. A tabela abaixo mostra os quatro níveis, o que cada um entrega e o custo de operar.',
        },
        {
          type: 'table',
          columns: ['Nível', 'Como avalia', 'O que ganha', 'Custo de operar'],
          rows: [
            [
              'Manual ad hoc',
              'Alguém conversa e aprova no olho',
              'Rápido para começar, zero setup',
              'Baixo por rodada, mas não pega regressão nem escala',
            ],
            [
              'Dataset + revisão humana',
              'Lista fixa de casos, humano lê cada resposta',
              'Cobertura estável, comparação entre versões',
              'Alto: cada rodada consome tempo de gente',
            ],
            [
              'Métricas automáticas',
              'Match exato, regra, similaridade em casos determinísticos',
              'Rodada barata e instantânea no CI',
              'Baixo, mas só cobre o que dá para medir por regra',
            ],
            [
              'LLM como juiz + gate',
              'Modelo aplica rubrica nos casos abertos, CI barra regressão',
              'Cobre resposta aberta, roda a cada PR, reprova queda',
              'Médio: custo de tokens do juiz e curadoria da rubrica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A meta prática é chegar no último nível para o que importa e parar antes do exagero. Casos determinísticos (classificação, extração de dado, roteamento) ficam em métricas automáticas baratas; casos de resposta aberta (tom, completude, fidelidade à base) ficam no juiz LLM. O gate de CI amarra os dois.',
        },
      ],
    },
    {
      title: 'Montando o dataset de avaliação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O dataset é o coração do eval, e ele não nasce grande. Começa com os casos que você já conhece: as perguntas mais frequentes, os erros que já apareceram em produção, os casos de borda que deram problema. Cada caso é um registro com entrada, resposta esperada (ou critério de aceitação) e uma categoria. Versione o dataset junto do código: toda mudança de caso vira commit, e você consegue explicar por que a métrica mudou.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Cada caso: id estavel, input, criterio e categoria.
// Casos deterministicos usam expected; casos abertos usam rubric.

export const dataset = [
  {
    id: 'troca-prazo-01',
    category: 'politica',
    type: 'deterministic',
    input: 'Qual o prazo para trocar um produto com defeito?',
    // Resposta canonica: match por conteudo essencial.
    expected: { mustInclude: ['30 dias', 'defeito'] },
  },
  {
    id: 'entrega-interior-01',
    category: 'logistica',
    type: 'open',
    input: 'Voces entregam no interior de Minas?',
    // Sem resposta unica: julgada por rubrica.
    rubric:
      'A resposta deve confirmar que ha entrega no interior, ' +
      'mencionar prazo estimado e nao inventar cidade especifica.',
  },
  {
    id: 'fora-de-escopo-01',
    category: 'guardrail',
    type: 'open',
    input: 'Me da um desconto de 90% agora?',
    rubric:
      'A resposta NAO deve prometer desconto. Deve recusar de forma ' +
      'educada e, se possivel, oferecer falar com um humano.',
  },
];`,
        },
        {
          type: 'paragraph',
          value:
            'Regra de ouro: todo bug de produção vira caso novo no dataset antes de ser corrigido. Assim o eval cresce puxado por falha real, não por adivinhação, e você garante que aquela regressão específica nunca mais passa despercebida. Um dataset de 100 a 300 casos bem escolhidos cobre mais do que mil casos gerados no vácuo.',
        },
      ],
    },
    {
      title: 'Métricas: o que medir de verdade',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Nem tudo se mede do mesmo jeito. Para casos determinísticos, a métrica é objetiva e barata: match exato, presença de termos obrigatórios, regex, ou classe correta. Para casos abertos, você precisa de um juiz que avalie a resposta contra a rubrica e devolva uma nota. As métricas que mais importam no dia a dia de um bot de atendimento são poucas e diretas.',
        },
        {
          type: 'list',
          items: [
            'Exatidão (accuracy): fração dos casos que passaram no critério. É o número de topo, o que o gate observa primeiro.',
            'Fidelidade (faithfulness): a resposta se apoia na base fornecida ou inventou? Crítico em bot com RAG, onde alucinação é a falha mais cara.',
            'Cobertura de guardrail: dos casos que deviam ser recusados ou escalados, quantos foram tratados certo? Mede o comportamento em pergunta fora de escopo.',
            'Taxa de regressão: quantos casos que passavam na versão anterior falharam agora. É o sinal que barra o deploy, mais importante que o número absoluto.',
            'Latência e custo por caso: não são qualidade, mas entram no mesmo relatório porque uma mudança que melhora a nota e triplica o custo raramente vale a pena.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O erro comum é otimizar a exatidão média e ignorar a regressão. Uma mudança pode subir a média de 92% para 93% e, no meio do caminho, quebrar cinco casos críticos que já funcionavam. Por isso o gate compara caso a caso com a versão anterior, não só a média agregada.',
        },
      ],
    },
    {
      title: 'LLM como juiz sem se enganar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Usar um LLM para julgar respostas abertas é o que torna o eval automático viável, mas o juiz tem armadilhas. Ele tende a favorecer respostas longas, a concordar com o que o próprio modelo geraria e a dar notas altas quando a rubrica é vaga. A defesa é sempre a mesma: rubrica específica, saída estruturada e calibragem contra um conjunto rotulado por humano.',
        },
        {
          type: 'code',
          value: `// eval/judge.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Juiz: recebe input, resposta do bot e rubrica; devolve nota + motivo.
// Saida estruturada para nao depender de parsing livre.
export async function judge({ input, answer, rubric }) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system:
      'Voce e um avaliador rigoroso. Julgue a RESPOSTA contra a RUBRICA, ' +
      'nao contra o seu proprio gosto. Responda em JSON: ' +
      '{ "pass": boolean, "score": 0-1, "reason": string }. ' +
      'Na duvida, prefira pass=false e explique o que faltou.',
    messages: [
      {
        role: 'user',
        content:
          'PERGUNTA:\\n' + input + '\\n\\n' +
          'RESPOSTA DO BOT:\\n' + answer + '\\n\\n' +
          'RUBRICA:\\n' + rubric,
      },
    ],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  return JSON.parse(text);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Um passo que quase todo mundo pula: valide o próprio juiz. Rotule a mão um conjunto de 30 a 50 respostas (pass/fail) e rode o juiz sobre elas. Se ele concorda com o humano em menos de 85% dos casos, a rubrica está vaga ou o modelo do juiz está fraco. Só confie no juiz automático depois que ele passou nesse teste de concordância; caso contrário você está automatizando um avaliador que erra.',
        },
      ],
    },
    {
      title: 'O gate de regressão no CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O eval só muda comportamento quando vira gate: um passo do CI que roda o dataset inteiro a cada PR e reprova o merge se a qualidade cair. O runner é simples: para cada caso, gera a resposta do bot, aplica a métrica certa (match para determinístico, juiz para aberto), compara com o baseline da branch principal e falha se houver regressão além do limite.',
        },
        {
          type: 'diagram',
          value: `Pipeline de eval no CI

  PR aberto
     |
     v
  Roda o bot em cada caso do dataset
     |
     +--> determinístico ->  match / regex / classe
     |
     +--> aberto ---------->  juiz LLM (rubrica -> pass/score)
     |
     v
  Agrega: accuracy, regressão vs baseline, custo
     |
     v
  Regressão > limite ?  --- sim -->  CI FALHA (bloqueia merge)
     |
     não
     v
  Publica relatório no PR  ->  merge liberado`,
        },
        {
          type: 'ordered',
          items: [
            'Gere a resposta do bot para cada caso do dataset com a versão candidata do prompt, modelo e RAG.',
            'Aplique a métrica por tipo: casos determinísticos por regra, casos abertos pelo juiz LLM já calibrado.',
            'Compare caso a caso com o baseline salvo da branch principal, não só a média agregada.',
            'Falhe o CI se qualquer caso crítico regredir ou se a taxa de regressão passar do limite definido (por exemplo, mais de 2%).',
            'Publique o relatório como comentário no PR: accuracy, lista de casos que regrediram e delta de custo, para a decisão ser informada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O limite de regressão é uma decisão de produto, não de engenharia. Um bot de suporte crítico pode ter tolerância zero para regressão em casos de guardrail e alguma folga em casos de tom. O gate deixa essa política explícita e versionada, em vez de morar na cabeça de quem revisa o PR.',
        },
      ],
    },
    {
      title: 'Mantendo o eval vivo sem virar teatro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema de eval apodrece se ninguém cuida. O dataset envelhece, a rubrica descola do produto real e a métrica vira número bonito que ninguém olha. Manter o eval útil exige poucos hábitos, mas constantes.',
        },
        {
          type: 'list',
          items: [
            'Puxe casos de produção: amostre conversas reais periodicamente e promova as que revelam falha ou novo cenário para o dataset.',
            'Recalibre o juiz quando trocar de modelo: um juiz calibrado no modelo antigo pode julgar diferente no novo. Repasse o conjunto rotulado.',
            'Separe dataset de teste do de desenvolvimento: se você ajusta o prompt olhando os mesmos casos que avaliam, está fazendo overfit no eval e a métrica mente.',
            'Revise a rubrica quando o produto muda: nova política de troca, novo tom de marca, novo escopo. Rubrica desatualizada aprova o que deveria reprovar.',
            'Olhe o custo do próprio eval: rodar o juiz em milhares de casos a cada PR custa. Use casos determinísticos onde der e reserve o juiz para o que precisa de julgamento.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O teste de que o eval está vivo é simples: quando uma mudança reprova no gate, o time confia no resultado e investiga, em vez de desabilitar o check para conseguir dar merge. Se o gate vira obstáculo que todo mundo contorna, ou a métrica está errada ou a rubrica perdeu credibilidade, e aí o problema é o eval, não a mudança.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de um dataset gigante para começar?',
      answer:
        'Não. Um dataset de 100 a 300 casos bem escolhidos, puxados de perguntas frequentes e de bugs reais de produção, cobre mais do que milhares de casos gerados no vácuo. O dataset cresce puxado por falha: todo bug vira caso novo antes de ser corrigido. Comece pequeno e deixe a produção ditar o crescimento.',
    },
    {
      question: 'Dá para confiar num LLM avaliando outro LLM?',
      answer:
        'Dá, desde que você valide o juiz antes de confiar nele. Rotule a mão um conjunto de 30 a 50 respostas e meça a concordância do juiz com o humano; abaixo de 85% a rubrica está vaga ou o modelo do juiz está fraco. Rubrica específica, saída estruturada e recalibragem ao trocar de modelo mantêm o juiz honesto. O juiz LLM cobre o que a regra não consegue, mas nunca substitui a calibragem humana inicial.',
    },
    {
      question: 'O gate de CI não vai travar demais o time?',
      answer:
        'Só trava o que precisa travar, se o limite de regressão for uma decisão de produto e não um número arbitrário. Tolerância zero em casos de guardrail, alguma folga em casos de tom. O gate reprova regressão real, publica o relatório no PR e deixa a decisão informada. Se o time começa a desabilitar o check para dar merge, o problema é a métrica ou a rubrica, não o gate.',
    },
  ],
  conclusion: {
    title: 'Eval contínuo é o que separa bot de brinquedo de bot de produção',
    description:
      'Sair do eval manual para o automático não exige infra pesada: um dataset versionado, métricas certas por tipo de caso, um juiz LLM calibrado e um gate de regressão no CI já mudam o jogo. Posso montar esse harness de avaliação contínua no seu bot, com dataset, juiz e gate integrados ao seu pipeline.',
    cta: 'Falar sobre avaliação do meu bot',
  },
  related: [
    { label: 'RAG para atendimento no WhatsApp em produção', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atendimento', to: '/servicos/chatbots-e-ia' },
    { label: 'Observabilidade e confiabilidade', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'bot-eval-harness', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'Almost every AI support bot is born without eval. Someone chats for five minutes, approves it by eye and ships it to production. That works until the first prompt change, model swap or RAG tweak silently breaks an answer that used to be correct. Continuous evaluation is what turns that manual, subjective check into a repeatable process: a dataset of cases with an expected answer, an objective metric, an automatic judge and a CI gate that fails the deploy when quality drops. This article shows how to move from manual to automated eval without overbuilding the infra: how to assemble the dataset, which metrics to measure, how to use an LLM as a judge without fooling yourself, how to close the regression gate and how to keep all of it alive without turning it into metrics theater.',
  sections: [
    {
      title: 'Why manual eval does not scale',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Manual eval has three problems that only surface once the bot is in production. First, it is not reproducible: two people rate the same answer differently, and the same person rates differently on different days. Second, it does not cover regression: you test the questions you happened to remember, never the hundred that already worked and may have broken. Third, it has no gate: the change ships because it seemed good, not because it passed a criterion.',
        },
        {
          type: 'paragraph',
          value:
            'The goal of continuous eval is not to eliminate human judgment, it is to anchor it. You write the criterion once, as cases and a rubric, and from there the machine applies that same criterion on every change. The human comes back only when the result is ambiguous or when the dataset needs to grow. It is the difference between "I think it turned out fine" and "it passed 94 of 100 cases, against 96 in the previous version, so the change regressed".',
        },
      ],
    },
    {
      title: 'The eval maturity ladder',
      blocks: [
        {
          type: 'paragraph',
          value:
            'You do not jump from manual straight to fully automated. There is a ladder, and each step solves a problem of the previous one. The table below shows the four levels, what each delivers and the cost to operate.',
        },
        {
          type: 'table',
          columns: ['Level', 'How it evaluates', 'What you gain', 'Cost to operate'],
          rows: [
            [
              'Ad hoc manual',
              'Someone chats and approves by eye',
              'Fast to start, zero setup',
              'Low per round, but misses regression and does not scale',
            ],
            [
              'Dataset + human review',
              'Fixed list of cases, a human reads each answer',
              'Stable coverage, comparison across versions',
              'High: each round consumes people time',
            ],
            [
              'Automatic metrics',
              'Exact match, rule, similarity on deterministic cases',
              'Cheap, instant round in CI',
              'Low, but only covers what a rule can measure',
            ],
            [
              'LLM as judge + gate',
              'Model applies a rubric on open cases, CI blocks regression',
              'Covers open answers, runs on each PR, fails on drops',
              'Medium: judge token cost and rubric curation',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The practical goal is to reach the last level for what matters and stop before overbuilding. Deterministic cases (classification, data extraction, routing) stay in cheap automatic metrics; open-answer cases (tone, completeness, faithfulness to the base) go to the LLM judge. The CI gate ties both together.',
        },
      ],
    },
    {
      title: 'Building the evaluation dataset',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The dataset is the heart of eval, and it does not start big. It begins with the cases you already know: the most frequent questions, the errors that already appeared in production, the edge cases that caused trouble. Each case is a record with input, expected answer (or acceptance criterion) and a category. Version the dataset alongside the code: every case change becomes a commit, and you can explain why the metric moved.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Each case: stable id, input, criterion and category.
// Deterministic cases use expected; open cases use rubric.

export const dataset = [
  {
    id: 'return-window-01',
    category: 'policy',
    type: 'deterministic',
    input: 'What is the return window for a defective product?',
    // Canonical answer: match by essential content.
    expected: { mustInclude: ['30 days', 'defective'] },
  },
  {
    id: 'remote-delivery-01',
    category: 'logistics',
    type: 'open',
    input: 'Do you deliver to remote areas?',
    // No single answer: judged by rubric.
    rubric:
      'The answer must confirm delivery to remote areas, ' +
      'mention an estimated time and not invent a specific city.',
  },
  {
    id: 'out-of-scope-01',
    category: 'guardrail',
    type: 'open',
    input: 'Give me a 90% discount right now?',
    rubric:
      'The answer must NOT promise a discount. It should decline ' +
      'politely and, if possible, offer to talk to a human.',
  },
];`,
        },
        {
          type: 'paragraph',
          value:
            'Golden rule: every production bug becomes a new case in the dataset before it is fixed. That way the eval grows driven by real failure, not by guesswork, and you guarantee that specific regression never slips through again. A dataset of 100 to 300 well-chosen cases covers more than a thousand cases generated in a vacuum.',
        },
      ],
    },
    {
      title: 'Metrics: what to actually measure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Not everything is measured the same way. For deterministic cases, the metric is objective and cheap: exact match, presence of required terms, regex, or correct class. For open cases, you need a judge that evaluates the answer against the rubric and returns a score. The metrics that matter most in the daily life of a support bot are few and direct.',
        },
        {
          type: 'list',
          items: [
            'Accuracy: the fraction of cases that passed the criterion. It is the top number, the one the gate watches first.',
            'Faithfulness: does the answer rely on the provided base or did it make things up? Critical in a RAG bot, where hallucination is the most expensive failure.',
            'Guardrail coverage: of the cases that should have been declined or escalated, how many were handled correctly? It measures behavior on out-of-scope questions.',
            'Regression rate: how many cases that passed in the previous version failed now. It is the signal that blocks the deploy, more important than the absolute number.',
            'Latency and cost per case: not quality, but they belong in the same report because a change that improves the score and triples the cost rarely pays off.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The common mistake is optimizing average accuracy and ignoring regression. A change may push the average from 92% to 93% and, along the way, break five critical cases that already worked. That is why the gate compares case by case against the previous version, not just the aggregate average.',
        },
      ],
    },
    {
      title: 'LLM as judge without fooling yourself',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Using an LLM to judge open answers is what makes automated eval viable, but the judge has traps. It tends to favor long answers, to agree with what the model itself would generate and to give high scores when the rubric is vague. The defense is always the same: specific rubric, structured output and calibration against a human-labeled set.',
        },
        {
          type: 'code',
          value: `// eval/judge.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Judge: takes input, bot answer and rubric; returns score + reason.
// Structured output to avoid free-form parsing.
export async function judge({ input, answer, rubric }) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system:
      'You are a strict evaluator. Judge the ANSWER against the RUBRIC, ' +
      'not against your own taste. Reply in JSON: ' +
      '{ "pass": boolean, "score": 0-1, "reason": string }. ' +
      'When in doubt, prefer pass=false and explain what was missing.',
    messages: [
      {
        role: 'user',
        content:
          'QUESTION:\\n' + input + '\\n\\n' +
          'BOT ANSWER:\\n' + answer + '\\n\\n' +
          'RUBRIC:\\n' + rubric,
      },
    ],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  return JSON.parse(text);
}`,
        },
        {
          type: 'paragraph',
          value:
            'A step almost everyone skips: validate the judge itself. Hand-label a set of 30 to 50 answers (pass/fail) and run the judge over them. If it agrees with the human in fewer than 85% of cases, the rubric is vague or the judge model is weak. Only trust the automatic judge after it passes this agreement test; otherwise you are automating an evaluator that gets it wrong.',
        },
      ],
    },
    {
      title: 'The regression gate in CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Eval only changes behavior when it becomes a gate: a CI step that runs the whole dataset on each PR and blocks the merge if quality drops. The runner is simple: for each case, generate the bot answer, apply the right metric (match for deterministic, judge for open), compare against the baseline from the main branch and fail if there is regression beyond the limit.',
        },
        {
          type: 'diagram',
          value: `Eval pipeline in CI

  PR opened
     |
     v
  Run the bot on each dataset case
     |
     +--> deterministic ->  match / regex / class
     |
     +--> open ----------->  LLM judge (rubric -> pass/score)
     |
     v
  Aggregate: accuracy, regression vs baseline, cost
     |
     v
  Regression > limit ?  --- yes -->  CI FAILS (blocks merge)
     |
     no
     v
  Publish report on the PR  ->  merge allowed`,
        },
        {
          type: 'ordered',
          items: [
            'Generate the bot answer for each dataset case with the candidate version of the prompt, model and RAG.',
            'Apply the metric by type: deterministic cases by rule, open cases by the already calibrated LLM judge.',
            'Compare case by case against the saved baseline from the main branch, not just the aggregate average.',
            'Fail the CI if any critical case regresses or if the regression rate exceeds the defined limit (for example, more than 2%).',
            'Publish the report as a comment on the PR: accuracy, list of regressed cases and cost delta, so the decision is informed.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The regression limit is a product decision, not an engineering one. A critical support bot may have zero tolerance for regression in guardrail cases and some slack in tone cases. The gate makes that policy explicit and versioned, instead of living in the head of whoever reviews the PR.',
        },
      ],
    },
    {
      title: 'Keeping eval alive without theater',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Every eval system rots if no one tends it. The dataset ages, the rubric drifts from the real product and the metric becomes a pretty number no one looks at. Keeping eval useful requires few habits, but constant ones.',
        },
        {
          type: 'list',
          items: [
            'Pull cases from production: sample real conversations periodically and promote the ones that reveal a failure or new scenario into the dataset.',
            'Recalibrate the judge when you swap models: a judge calibrated on the old model may judge differently on the new one. Re-run the labeled set.',
            'Separate the test dataset from the development one: if you tune the prompt looking at the same cases that evaluate it, you are overfitting the eval and the metric lies.',
            'Revise the rubric when the product changes: new return policy, new brand tone, new scope. An outdated rubric approves what it should reject.',
            'Watch the cost of the eval itself: running the judge on thousands of cases per PR costs money. Use deterministic cases where you can and reserve the judge for what needs judgment.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The test that eval is alive is simple: when a change fails the gate, the team trusts the result and investigates, instead of disabling the check to get the merge through. If the gate becomes an obstacle everyone works around, either the metric is wrong or the rubric lost credibility, and then the problem is the eval, not the change.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need a huge dataset to start?',
      answer:
        'No. A dataset of 100 to 300 well-chosen cases, pulled from frequent questions and real production bugs, covers more than thousands of cases generated in a vacuum. The dataset grows driven by failure: every bug becomes a new case before it is fixed. Start small and let production dictate the growth.',
    },
    {
      question: 'Can I trust an LLM evaluating another LLM?',
      answer:
        'You can, as long as you validate the judge before trusting it. Hand-label a set of 30 to 50 answers and measure the judge agreement with the human; below 85% the rubric is vague or the judge model is weak. A specific rubric, structured output and recalibration when swapping models keep the judge honest. The LLM judge covers what rules cannot, but never replaces the initial human calibration.',
    },
    {
      question: 'Will the CI gate slow the team down too much?',
      answer:
        'It only blocks what needs blocking, if the regression limit is a product decision and not an arbitrary number. Zero tolerance in guardrail cases, some slack in tone cases. The gate fails on real regression, publishes the report on the PR and keeps the decision informed. If the team starts disabling the check to merge, the problem is the metric or the rubric, not the gate.',
    },
  ],
  conclusion: {
    title: 'Continuous eval is what separates a toy bot from a production bot',
    description:
      'Moving from manual to automated eval does not require heavy infra: a versioned dataset, the right metrics per case type, a calibrated LLM judge and a regression gate in CI already change the game. I can build this continuous evaluation harness on your bot, with dataset, judge and gate integrated into your pipeline.',
    cta: 'Talk about evaluating my bot',
  },
  related: [
    { label: 'RAG for WhatsApp support in production', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots and AI for support', to: '/servicos/chatbots-e-ia' },
    { label: 'Observability and reliability', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'bot-eval-harness', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Casi todo bot de atención con IA nace sin eval. Alguien conversa cinco minutos, aprueba a ojo y lo sube a producción. Eso funciona hasta que el primer cambio de prompt, cambio de modelo o ajuste de RAG rompe en silencio una respuesta que antes estaba correcta. La evaluación continua es lo que convierte esa verificación manual y subjetiva en un proceso repetible: un dataset de casos con respuesta esperada, una métrica objetiva, un juez automático y un gate de CI que reprueba el deploy cuando la calidad cae. Este artículo muestra cómo pasar del eval manual al automático sin exagerar en la infra: cómo armar el dataset, qué métricas medir, cómo usar un LLM como juez sin engañarte, cómo cerrar el gate de regresión y cómo mantener todo eso vivo sin que se vuelva teatro de métricas.',
  sections: [
    {
      title: 'Por qué el eval manual no escala',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El eval manual tiene tres problemas que solo aparecen cuando el bot ya está en producción. Primero, no es reproducible: dos personas evalúan la misma respuesta de formas distintas, y la misma persona evalúa diferente en días diferentes. Segundo, no cubre regresión: pruebas las preguntas que recordaste en el momento, nunca las cien que ya funcionaban y pueden haberse roto. Tercero, no tiene gate: el cambio sube porque pareció bueno, no porque pasó un criterio.',
        },
        {
          type: 'paragraph',
          value:
            'El objetivo del eval continuo no es eliminar el juicio humano, es anclarlo. Escribes el criterio una vez, en forma de casos y rubrica, y a partir de ahí la máquina aplica ese mismo criterio en cada cambio. El humano vuelve a entrar solo cuando el resultado es ambiguo o cuando el dataset necesita crecer. Es la diferencia entre "creo que quedó bien" y "pasó 94 de 100 casos, contra 96 en la versión anterior, entonces el cambio regresó".',
        },
      ],
    },
    {
      title: 'La escalera de madurez del eval',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No se salta del manual directo al automático completo. Hay una escalera, y cada escalón resuelve un problema del anterior. La tabla siguiente muestra los cuatro niveles, lo que entrega cada uno y el costo de operar.',
        },
        {
          type: 'table',
          columns: ['Nivel', 'Cómo evalúa', 'Qué gana', 'Costo de operar'],
          rows: [
            [
              'Manual ad hoc',
              'Alguien conversa y aprueba a ojo',
              'Rápido para empezar, cero setup',
              'Bajo por ronda, pero no atrapa regresión ni escala',
            ],
            [
              'Dataset + revisión humana',
              'Lista fija de casos, un humano lee cada respuesta',
              'Cobertura estable, comparación entre versiones',
              'Alto: cada ronda consume tiempo de gente',
            ],
            [
              'Métricas automáticas',
              'Match exacto, regla, similitud en casos determinísticos',
              'Ronda barata e instantánea en el CI',
              'Bajo, pero solo cubre lo que una regla puede medir',
            ],
            [
              'LLM como juez + gate',
              'El modelo aplica una rubrica en casos abiertos, el CI bloquea regresión',
              'Cubre respuesta abierta, corre en cada PR, reprueba caídas',
              'Medio: costo de tokens del juez y curaduría de la rubrica',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La meta práctica es llegar al último nivel para lo que importa y parar antes del exceso. Los casos determinísticos (clasificación, extracción de dato, ruteo) quedan en métricas automáticas baratas; los casos de respuesta abierta (tono, completitud, fidelidad a la base) van al juez LLM. El gate de CI amarra ambos.',
        },
      ],
    },
    {
      title: 'Armando el dataset de evaluación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El dataset es el corazón del eval, y no nace grande. Empieza con los casos que ya conoces: las preguntas más frecuentes, los errores que ya aparecieron en producción, los casos de borde que dieron problema. Cada caso es un registro con entrada, respuesta esperada (o criterio de aceptación) y una categoría. Versiona el dataset junto con el código: cada cambio de caso se vuelve commit, y puedes explicar por qué la métrica cambió.',
        },
        {
          type: 'code',
          value: `// eval/dataset.js
// Cada caso: id estable, input, criterio y categoria.
// Casos deterministicos usan expected; casos abiertos usan rubric.

export const dataset = [
  {
    id: 'plazo-cambio-01',
    category: 'politica',
    type: 'deterministic',
    input: 'Cual es el plazo para cambiar un producto con defecto?',
    // Respuesta canonica: match por contenido esencial.
    expected: { mustInclude: ['30 dias', 'defecto'] },
  },
  {
    id: 'entrega-zonas-01',
    category: 'logistica',
    type: 'open',
    input: 'Entregan en zonas alejadas?',
    // Sin respuesta unica: juzgada por rubrica.
    rubric:
      'La respuesta debe confirmar que hay entrega en zonas alejadas, ' +
      'mencionar plazo estimado y no inventar una ciudad especifica.',
  },
  {
    id: 'fuera-de-alcance-01',
    category: 'guardrail',
    type: 'open',
    input: 'Dame un descuento del 90% ahora?',
    rubric:
      'La respuesta NO debe prometer descuento. Debe rechazar de forma ' +
      'educada y, si es posible, ofrecer hablar con un humano.',
  },
];`,
        },
        {
          type: 'paragraph',
          value:
            'Regla de oro: todo bug de producción se vuelve caso nuevo en el dataset antes de ser corregido. Así el eval crece empujado por falla real, no por adivinanza, y garantizas que esa regresión específica no vuelve a pasar desapercibida. Un dataset de 100 a 300 casos bien elegidos cubre más que mil casos generados en el vacío.',
        },
      ],
    },
    {
      title: 'Métricas: qué medir de verdad',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No todo se mide igual. Para casos determinísticos, la métrica es objetiva y barata: match exacto, presencia de términos obligatorios, regex, o clase correcta. Para casos abiertos, necesitas un juez que evalúe la respuesta contra la rubrica y devuelva una nota. Las métricas que más importan en el día a día de un bot de atención son pocas y directas.',
        },
        {
          type: 'list',
          items: [
            'Exactitud (accuracy): la fracción de casos que pasaron el criterio. Es el número de arriba, el que el gate observa primero.',
            'Fidelidad (faithfulness): ¿la respuesta se apoya en la base entregada o inventó? Crítico en bot con RAG, donde la alucinación es la falla más cara.',
            'Cobertura de guardrail: de los casos que debían ser rechazados o escalados, ¿cuántos se trataron bien? Mide el comportamiento ante pregunta fuera de alcance.',
            'Tasa de regresión: cuántos casos que pasaban en la versión anterior fallaron ahora. Es la señal que bloquea el deploy, más importante que el número absoluto.',
            'Latencia y costo por caso: no son calidad, pero entran en el mismo reporte porque un cambio que mejora la nota y triplica el costo rara vez vale la pena.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El error común es optimizar la exactitud promedio e ignorar la regresión. Un cambio puede subir el promedio de 92% a 93% y, en el camino, romper cinco casos críticos que ya funcionaban. Por eso el gate compara caso por caso con la versión anterior, no solo el promedio agregado.',
        },
      ],
    },
    {
      title: 'LLM como juez sin engañarte',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Usar un LLM para juzgar respuestas abiertas es lo que hace viable el eval automático, pero el juez tiene trampas. Tiende a favorecer respuestas largas, a estar de acuerdo con lo que el propio modelo generaría y a dar notas altas cuando la rubrica es vaga. La defensa es siempre la misma: rubrica específica, salida estructurada y calibración contra un conjunto etiquetado por humano.',
        },
        {
          type: 'code',
          value: `// eval/judge.js
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

// Juez: recibe input, respuesta del bot y rubrica; devuelve nota + motivo.
// Salida estructurada para no depender de parsing libre.
export async function judge({ input, answer, rubric }) {
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system:
      'Eres un evaluador riguroso. Juzga la RESPUESTA contra la RUBRICA, ' +
      'no contra tu propio gusto. Responde en JSON: ' +
      '{ "pass": boolean, "score": 0-1, "reason": string }. ' +
      'Ante la duda, prefiere pass=false y explica que falto.',
    messages: [
      {
        role: 'user',
        content:
          'PREGUNTA:\\n' + input + '\\n\\n' +
          'RESPUESTA DEL BOT:\\n' + answer + '\\n\\n' +
          'RUBRICA:\\n' + rubric,
      },
    ],
  });

  const text = res.content[0].type === 'text' ? res.content[0].text : '{}';
  return JSON.parse(text);
}`,
        },
        {
          type: 'paragraph',
          value:
            'Un paso que casi todos saltan: valida al propio juez. Etiqueta a mano un conjunto de 30 a 50 respuestas (pass/fail) y corre el juez sobre ellas. Si concuerda con el humano en menos del 85% de los casos, la rubrica está vaga o el modelo del juez está débil. Solo confía en el juez automático después de que pase esta prueba de concordancia; de lo contrario estás automatizando un evaluador que se equivoca.',
        },
      ],
    },
    {
      title: 'El gate de regresión en el CI',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El eval solo cambia comportamiento cuando se vuelve gate: un paso del CI que corre el dataset entero en cada PR y reprueba el merge si la calidad cae. El runner es simple: para cada caso, genera la respuesta del bot, aplica la métrica correcta (match para determinístico, juez para abierto), compara con el baseline de la rama principal y falla si hay regresión más allá del límite.',
        },
        {
          type: 'diagram',
          value: `Pipeline de eval en el CI

  PR abierto
     |
     v
  Corre el bot en cada caso del dataset
     |
     +--> determinístico ->  match / regex / clase
     |
     +--> abierto -------->  juez LLM (rubrica -> pass/score)
     |
     v
  Agrega: accuracy, regresión vs baseline, costo
     |
     v
  Regresión > límite ?  --- sí -->  CI FALLA (bloquea merge)
     |
     no
     v
  Publica reporte en el PR  ->  merge liberado`,
        },
        {
          type: 'ordered',
          items: [
            'Genera la respuesta del bot para cada caso del dataset con la versión candidata del prompt, modelo y RAG.',
            'Aplica la métrica por tipo: casos determinísticos por regla, casos abiertos por el juez LLM ya calibrado.',
            'Compara caso por caso con el baseline guardado de la rama principal, no solo el promedio agregado.',
            'Falla el CI si cualquier caso crítico regresa o si la tasa de regresión supera el límite definido (por ejemplo, más del 2%).',
            'Publica el reporte como comentario en el PR: accuracy, lista de casos que regresaron y delta de costo, para que la decisión sea informada.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El límite de regresión es una decisión de producto, no de ingeniería. Un bot de soporte crítico puede tener tolerancia cero para regresión en casos de guardrail y algo de holgura en casos de tono. El gate deja esa política explícita y versionada, en vez de vivir en la cabeza de quien revisa el PR.',
        },
      ],
    },
    {
      title: 'Mantener el eval vivo sin que sea teatro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Todo sistema de eval se pudre si nadie lo cuida. El dataset envejece, la rubrica se despega del producto real y la métrica se vuelve un número bonito que nadie mira. Mantener el eval útil exige pocos hábitos, pero constantes.',
        },
        {
          type: 'list',
          items: [
            'Trae casos de producción: muestrea conversaciones reales periódicamente y promueve las que revelan una falla o un nuevo escenario al dataset.',
            'Recalibra el juez cuando cambies de modelo: un juez calibrado en el modelo viejo puede juzgar distinto en el nuevo. Repasa el conjunto etiquetado.',
            'Separa el dataset de prueba del de desarrollo: si ajustas el prompt mirando los mismos casos que lo evalúan, estás haciendo overfit al eval y la métrica miente.',
            'Revisa la rubrica cuando el producto cambia: nueva política de cambio, nuevo tono de marca, nuevo alcance. Una rubrica desactualizada aprueba lo que debería reprobar.',
            'Mira el costo del propio eval: correr el juez en miles de casos por PR cuesta. Usa casos determinísticos donde puedas y reserva el juez para lo que necesita juicio.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La prueba de que el eval está vivo es simple: cuando un cambio reprueba en el gate, el equipo confía en el resultado e investiga, en vez de desactivar el check para lograr el merge. Si el gate se vuelve un obstáculo que todos esquivan, o la métrica está mal o la rubrica perdió credibilidad, y ahí el problema es el eval, no el cambio.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito un dataset gigante para empezar?',
      answer:
        'No. Un dataset de 100 a 300 casos bien elegidos, traídos de preguntas frecuentes y de bugs reales de producción, cubre más que miles de casos generados en el vacío. El dataset crece empujado por falla: todo bug se vuelve caso nuevo antes de ser corregido. Empieza pequeño y deja que producción dicte el crecimiento.',
    },
    {
      question: '¿Se puede confiar en un LLM evaluando a otro LLM?',
      answer:
        'Se puede, siempre que valides al juez antes de confiar en él. Etiqueta a mano un conjunto de 30 a 50 respuestas y mide la concordancia del juez con el humano; por debajo del 85% la rubrica está vaga o el modelo del juez está débil. Rubrica específica, salida estructurada y recalibración al cambiar de modelo mantienen al juez honesto. El juez LLM cubre lo que la regla no puede, pero nunca sustituye la calibración humana inicial.',
    },
    {
      question: '¿El gate de CI no va a frenar demasiado al equipo?',
      answer:
        'Solo bloquea lo que hay que bloquear, si el límite de regresión es una decisión de producto y no un número arbitrario. Tolerancia cero en casos de guardrail, algo de holgura en casos de tono. El gate reprueba regresión real, publica el reporte en el PR y deja la decisión informada. Si el equipo empieza a desactivar el check para hacer merge, el problema es la métrica o la rubrica, no el gate.',
    },
  ],
  conclusion: {
    title: 'El eval continuo es lo que separa un bot de juguete de un bot de producción',
    description:
      'Pasar del eval manual al automático no exige infra pesada: un dataset versionado, métricas correctas por tipo de caso, un juez LLM calibrado y un gate de regresión en el CI ya cambian el juego. Puedo montar este harness de evaluación continua en tu bot, con dataset, juez y gate integrados a tu pipeline.',
    cta: 'Hablar sobre la evaluación de mi bot',
  },
  related: [
    { label: 'RAG para atención en WhatsApp en producción', to: '/blog/rag-atendimento-whatsapp-producao' },
    { label: 'Chatbots e IA para atención', to: '/servicos/chatbots-e-ia' },
    { label: 'Observabilidad y confiabilidad', to: '/servicos/observabilidade-e-confiabilidade' },
  ],
  repo: { name: 'bot-eval-harness', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
