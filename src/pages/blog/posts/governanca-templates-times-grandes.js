// Conteudo do artigo: governanca-templates-times-grandes
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Em uma empresa pequena, um time so cuida dos templates de WhatsApp e tudo funciona. Quando marketing, suporte e produto passam a criar templates no mesmo WABA, o namespace vira terra de ninguem: nomes conflitantes, definicoes duplicadas, rejeicoes da Meta por copy fora de politica e categoria errada que faz voce pagar marketing onde deveria ser utility. Governar templates em times grandes nao e burocracia, e o que mantem o canal previsivel e barato. Este artigo cobre convencao de nomenclatura, ciclo de vida e versionamento, processo de aprovacao, template as code e as metricas que dizem se um template merece continuar vivo.',
  sections: [
    {
      title: 'O problema: varios times, um WABA',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O WhatsApp Business Account (WABA) e compartilhado, e o namespace de templates tambem. Quando marketing, suporte e produto criam templates no mesmo painel sem coordenacao, os sintomas aparecem rapido. Dois times criam "atualizacao_pedido" com copy ligeiramente diferente e ninguem sabe qual usar. Alguem reaproveita o nome errado em producao. Marketing submete um template promocional classificado como utility para fugir da regra de cobranca e a Meta rejeita ou reclassifica. Produto cria um template de teste que nunca foi removido e polui a lista.',
        },
        {
          type: 'paragraph',
          value:
            'A raiz do problema e que o painel da Meta trata templates como recursos globais do WABA, sem nocao de dono, sem historico de versao e sem ambiente de homologacao. Cada criacao manual e uma decisao isolada que afeta todos os times. Sem governanca, o resultado e duplicacao, rejeicoes recorrentes, custo inflado por categoria errada e um namespace impossivel de auditar.',
        },
      ],
    },
    {
      title: 'Convencao de nomenclatura e namespace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira defesa e um padrao de nomes que torne o dono, a jornada e o idioma obvios no proprio nome do template. A Meta so aceita minusculas, numeros e underscore, entao o padrao precisa caber nessa restricao. Um esquema que funciona bem e prefixo por time, depois jornada, depois idioma, depois versao: time_jornada_idioma_versao. Exemplo: support_orderupdate_pt_v2.',
        },
        {
          type: 'table',
          columns: ['Segmento', 'Significado', 'Exemplo'],
          rows: [
            ['time', 'Time dono do template', 'support, marketing, product'],
            ['jornada', 'Fluxo ou evento que o template atende', 'orderupdate, otp, cartabandon'],
            ['idioma', 'Locale do conteudo', 'pt, en, es'],
            ['versao', 'Versao logica do template', 'v1, v2, v3'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com esse padrao, support_orderupdate_pt_v2 se le sozinho: e do suporte, trata atualizacao de pedido, em portugues, segunda versao. O prefixo de time elimina conflito de nomes entre equipes, porque cada uma so cria dentro do seu proprio espaco. As regras minimas que sustentam a convencao:',
        },
        {
          type: 'list',
          items: [
            'Prefixo de time obrigatorio: nenhum template existe sem dono explicito no nome.',
            'Uma jornada por template: nao misture confirmacao de pedido e pesquisa de satisfacao no mesmo nome.',
            'Idioma sempre no nome: variantes de locale sao templates distintos, nunca o mesmo template com texto trocado na mao.',
            'Versao no sufixo: mudou conteudo, estrutura ou categoria, sobe a versao em vez de editar o template antigo.',
            'Sem nomes de teste em producao: temp, teste, copy e final ficam fora do WABA de producao.',
          ],
        },
      ],
    },
    {
      title: 'Ciclo de vida e versionamento do template',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um template nao e estatico: ele nasce como rascunho, passa por revisao interna, vai para aprovacao da Meta, entra em uso e um dia e aposentado. Tratar esse ciclo de forma explicita evita que rascunhos vazem para producao e que templates mortos continuem na lista. Cada transicao tem um responsavel e um criterio claro de passagem.',
        },
        {
          type: 'diagram',
          value: `  draft
    |  copy escrita, revisao interna de texto e variaveis
    v
  review
    |  aprovacao de copy + checagem de categoria correta
    v
  submit Meta
    |  envio via Graph API; aguarda analise da Meta
    v
  approved
    |  Meta aprovou; ainda nao em uso
    v
  active
    |  em producao, recebendo trafego
    v
  deprecated
       substituido por nova versao; mantido so para auditoria`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto chave do versionamento e que aprovado pela Meta nao significa editavel. Mudou a copy de support_orderupdate_pt_v2? Crie support_orderupdate_pt_v3, submeta, valide e so entao mova o trafego. O v2 vira deprecated, nao desaparece: ele fica como registro do que estava no ar quando uma mensagem foi enviada. Editar template aprovado no painel quebra o historico e costuma forcar nova analise da Meta de qualquer forma.',
        },
      ],
    },
    {
      title: 'Processo de aprovacao',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governanca exige separar quem cria de quem submete. Qualquer pessoa do time dono pode propor um template, mas a submissao para a Meta passa por um portao com revisao de copy e checagem de categoria. Esse portao e o que impede tanto o texto fora de politica quanto o erro de categoria que estoura o custo.',
        },
        {
          type: 'ordered',
          items: [
            'Criacao (autor do time dono): redige a definicao no formato de codigo, define variaveis, idioma e a categoria pretendida. Nada vai direto para a Meta nesse passo.',
            'Revisao de copy (revisor designado): confere clareza, tom, conformidade com a politica do WhatsApp e ausencia de conteudo que motive rejeicao. Aprova ou devolve com comentarios.',
            'Checagem de categoria (responsavel de governanca): valida se a categoria esta correta. Confirmacao e atualizacao ligada a uma acao do usuario e utility; promocao e reengajamento e marketing. Classificar marketing como utility para pagar menos e reclassificado pela Meta e mina a confianca do WABA.',
            'Submissao (papel autorizado): so um conjunto restrito de pessoas tem permissao de submeter via API. Esse passo registra quem submeteu, quando e qual versao.',
            'Validacao pos-aprovacao (autor + governanca): ao voltar approved da Meta, faz um envio de teste, confere render de variaveis e botoes, e so entao promove para active.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A checagem de categoria merece destaque porque e onde governanca vira dinheiro. Utility costuma ser mais barata que marketing, e a tentacao de rotular tudo como utility e real. A Meta detecta o padrao, reclassifica e, em caso reincidente, pode prejudicar a qualidade do numero. O portao de categoria protege o orcamento e a reputacao ao mesmo tempo.',
        },
      ],
    },
    {
      title: 'Template as code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Criar template manualmente no painel da Meta nao escala nem audita. A alternativa e tratar template como codigo: a definicao vive em um repositorio versionado, passa por pull request (a revisao de copy e a checagem de categoria viram revisao de PR) e e sincronizada para a Meta via Graph API. O painel deixa de ser a fonte da verdade; o repositorio passa a ser. Cada mudanca tem autor, diff, historico e rollback.',
        },
        {
          type: 'code',
          value: `# templates/support_orderupdate_pt_v2.yaml
# A definicao versionada e a fonte da verdade. O painel da Meta
# e apenas um reflexo deste arquivo, sincronizado via Graph API.
name: support_orderupdate_pt_v2
language: pt_BR
category: UTILITY            # utility: atualizacao ligada a acao do usuario
owner: support
components:
  - type: BODY
    text: "Ola {{1}}, seu pedido {{2}} mudou para o status: {{3}}."
    example:
      body_text:
        - ["Joao", "#10482", "enviado"]
  - type: BUTTONS
    buttons:
      - type: URL
        text: "Acompanhar pedido"
        url: "https://exemplo.com/pedidos/{{1}}"
        example: ["https://exemplo.com/pedidos/10482"]`,
        },
        {
          type: 'paragraph',
          value:
            'A sincronizacao le o arquivo e cria ou atualiza o template no WABA via Graph API. O mesmo script roda em CI: ao mergear o PR, o template e submetido a Meta e o pipeline registra o status retornado.',
        },
        {
          type: 'code',
          value: `// sync-template.js
// Le a definicao YAML e submete o template a Meta via Graph API.
// Rode no CI apos o merge do PR que aprovou a copy e a categoria.
import fs from 'node:fs';
import yaml from 'js-yaml';

const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.META_TOKEN;

async function syncTemplate(path) {
  const def = yaml.load(fs.readFileSync(path, 'utf8'));

  const payload = {
    name: def.name,
    language: def.language,
    category: def.category,
    components: def.components,
  };

  const res = await fetch(
    \`https://graph.facebook.com/v21.0/\${WABA_ID}/message_templates\`,
    {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${TOKEN}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    // status de rejeicao da Meta volta aqui: logue e falhe o pipeline
    throw new Error(\`Falha ao sincronizar \${def.name}: \${JSON.stringify(data)}\`);
  }
  // data.status costuma ser PENDING ate a Meta analisar
  console.log(\`Submetido \${def.name}: status \${data.status}\`);
  return data;
}

syncTemplate(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Com essa base, todo o processo de aprovacao acontece na revisao do PR e a Meta recebe apenas o que ja passou pelos portoes. O namespace fica auditavel: para saber por que um template existe, quem o criou e o que mudou entre versoes, basta olhar o historico do repositorio.',
        },
      ],
    },
    {
      title: 'Metricas por template',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governanca nao termina na aprovacao. Cada template ativo precisa ser medido para saber se ainda merece existir. As metricas que importam vem da propria Meta (status de entrega e leitura) e do seu produto (resposta e bloqueio), e devem ser acompanhadas por template, nao em agregado.',
        },
        {
          type: 'list',
          items: [
            'Taxa de entrega: proporcao de mensagens entregues sobre enviadas. Queda persistente sugere numero invalido na base, bloqueio ou problema de qualidade do template.',
            'Taxa de leitura: proporcao de entregues que foram lidas. Leitura baixa em utility pode indicar copy irrelevante ou disparo na hora errada.',
            'Taxa de resposta: proporcao que gerou resposta do cliente. Em templates que esperam acao (confirmar, agendar), e o sinal mais direto de eficacia.',
            'Taxa de bloqueio e denuncia: proporcao de destinatarios que bloquearam ou marcaram como spam. Em templates de marketing, e o indicador critico: alto bloqueio derruba a qualidade do numero e ameaca todos os times do WABA.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura cruzada e o que orienta a decisao de manter, revisar ou aposentar. Um template de marketing com leitura ok mas bloqueio subindo deve ser pausado antes que prejudique o WABA inteiro. Um utility com entrega caindo aponta para higiene de base. Medir por template fecha o ciclo de governanca: o que entra pelo portao de aprovacao tambem sai por um criterio de dados quando para de servir.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso editar um template ja aprovado pela Meta?',
      answer:
        'Evite. Editar conteudo de um template aprovado costuma forcar nova analise da Meta e quebra o historico de versao. A pratica de governanca e criar uma nova versao (por exemplo, de _v2 para _v3), submeter, validar e so entao mover o trafego. A versao antiga vira deprecated e fica como registro do que estava no ar.',
    },
    {
      question: 'Por que nao deixar cada time criar templates direto no painel?',
      answer:
        'Porque o WABA e o namespace de templates sao compartilhados. Criacao livre no painel gera nomes conflitantes, definicoes duplicadas, categoria errada e rejeicoes da Meta, sem dono nem historico. Centralizar as definicoes em um repositorio versionado e submeter via API da a cada template um dono explicito, revisao e auditoria.',
    },
    {
      question: 'Como a categoria errada do template aumenta meu custo?',
      answer:
        'As categorias tem regras de cobranca diferentes e utility costuma ser mais barata que marketing. Rotular uma promocao como utility para pagar menos nao funciona: a Meta reclassifica e, em reincidencia, pode prejudicar a qualidade do numero. Por isso a checagem de categoria e um portao obrigatorio antes da submissao.',
    },
  ],
  conclusion: {
    title: 'Templates governados sao previsiveis, baratos e auditaveis',
    description:
      'Nomenclatura com dono, ciclo de vida com versao, processo de aprovacao com checagem de categoria, template as code e metricas por template transformam um namespace caotico em um canal sob controle. Se varios times disputam o mesmo WABA na sua operacao, posso ajudar a estruturar essa governanca de ponta a ponta.',
    cta: 'Falar sobre governanca de templates',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Custos da WhatsApp Cloud API', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Arquitetura multi-tenant para WhatsApp SaaS', to: '/blog/arquitetura-multi-tenant-whatsapp-saas' },
  ],
  repo: {
    name: 'whatsapp-templates-as-code',
    description:
      'Exemplo de governanca de templates de WhatsApp como codigo: definicoes versionadas em YAML, revisao por PR e sincronizacao para a Meta via Graph API.',
    url: 'https://github.com/joaosouz4dev/whatsapp-templates-as-code',
  },
};

const en = {
  intro:
    'In a small company, one team owns the WhatsApp templates and everything works. Once marketing, support and product all create templates in the same WABA, the namespace becomes no man\'s land: conflicting names, duplicated definitions, Meta rejections for off-policy copy, and the wrong category that makes you pay marketing where it should be utility. Governing templates in large teams is not bureaucracy, it is what keeps the channel predictable and cheap. This article covers naming convention, lifecycle and versioning, approval process, template as code and the metrics that tell you whether a template deserves to stay alive.',
  sections: [
    {
      title: 'The problem: many teams, one WABA',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The WhatsApp Business Account (WABA) is shared, and so is the template namespace. When marketing, support and product create templates in the same panel without coordination, the symptoms show up fast. Two teams create "order_update" with slightly different copy and nobody knows which to use. Someone reuses the wrong name in production. Marketing submits a promotional template classified as utility to dodge the billing rule, and Meta rejects or reclassifies it. Product creates a test template that never gets removed and pollutes the list.',
        },
        {
          type: 'paragraph',
          value:
            'The root of the problem is that the Meta panel treats templates as global WABA resources, with no notion of owner, no version history and no staging environment. Each manual creation is an isolated decision that affects every team. Without governance, the result is duplication, recurring rejections, inflated cost from wrong categories and a namespace impossible to audit.',
        },
      ],
    },
    {
      title: 'Naming convention and namespace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first defense is a naming standard that makes the owner, journey and language obvious in the template name itself. Meta only accepts lowercase, numbers and underscore, so the standard has to fit that restriction. A scheme that works well is team prefix, then journey, then language, then version: team_journey_language_version. Example: support_orderupdate_en_v2.',
        },
        {
          type: 'table',
          columns: ['Segment', 'Meaning', 'Example'],
          rows: [
            ['team', 'Team that owns the template', 'support, marketing, product'],
            ['journey', 'Flow or event the template serves', 'orderupdate, otp, cartabandon'],
            ['language', 'Content locale', 'pt, en, es'],
            ['version', 'Logical version of the template', 'v1, v2, v3'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'With this standard, support_orderupdate_en_v2 reads on its own: it belongs to support, handles order updates, in English, second version. The team prefix removes name clashes between teams, because each one only creates inside its own space. The minimum rules that hold the convention together:',
        },
        {
          type: 'list',
          items: [
            'Mandatory team prefix: no template exists without an explicit owner in the name.',
            'One journey per template: do not mix order confirmation and satisfaction survey under the same name.',
            'Language always in the name: locale variants are distinct templates, never the same template with text swapped by hand.',
            'Version in the suffix: if content, structure or category changed, bump the version instead of editing the old template.',
            'No test names in production: temp, test, copy and final stay out of the production WABA.',
          ],
        },
      ],
    },
    {
      title: 'Template lifecycle and versioning',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A template is not static: it starts as a draft, goes through internal review, moves to Meta approval, enters use and one day is retired. Treating this cycle explicitly prevents drafts from leaking into production and dead templates from lingering in the list. Each transition has an owner and a clear criterion to move forward.',
        },
        {
          type: 'diagram',
          value: `  draft
    |  copy written, internal review of text and variables
    v
  review
    |  copy approval + correct-category check
    v
  submit Meta
    |  sent via Graph API; awaits Meta review
    v
  approved
    |  Meta approved; not in use yet
    v
  active
    |  in production, receiving traffic
    v
  deprecated
       replaced by a new version; kept only for audit`,
        },
        {
          type: 'paragraph',
          value:
            'The key point of versioning is that Meta-approved does not mean editable. Did the copy of support_orderupdate_en_v2 change? Create support_orderupdate_en_v3, submit, validate and only then move the traffic. The v2 becomes deprecated, it does not vanish: it stays as a record of what was live when a message was sent. Editing an approved template in the panel breaks the history and usually forces a new Meta review anyway.',
        },
      ],
    },
    {
      title: 'Approval process',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governance requires separating who creates from who submits. Anyone on the owning team can propose a template, but submission to Meta passes through a gate with copy review and category check. That gate is what stops both off-policy text and the category mistake that blows up the cost.',
        },
        {
          type: 'ordered',
          items: [
            'Creation (author from the owning team): writes the definition in the code format, defines variables, language and the intended category. Nothing goes straight to Meta in this step.',
            'Copy review (designated reviewer): checks clarity, tone, compliance with WhatsApp policy and absence of content likely to be rejected. Approves or returns with comments.',
            'Category check (governance owner): validates that the category is correct. A confirmation or update tied to a user action is utility; promotion and re-engagement is marketing. Labeling marketing as utility to pay less gets reclassified by Meta and erodes WABA trust.',
            'Submission (authorized role): only a restricted set of people is allowed to submit via API. This step records who submitted, when and which version.',
            'Post-approval validation (author + governance): when Meta returns approved, run a test send, check variable and button rendering, and only then promote to active.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The category check deserves emphasis because it is where governance turns into money. Utility is usually cheaper than marketing, and the temptation to label everything as utility is real. Meta detects the pattern, reclassifies and, on repeat offense, can hurt the number quality. The category gate protects budget and reputation at the same time.',
        },
      ],
    },
    {
      title: 'Template as code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Creating templates by hand in the Meta panel neither scales nor audits. The alternative is to treat templates as code: the definition lives in a versioned repository, goes through a pull request (copy review and category check become PR review) and is synced to Meta via the Graph API. The panel stops being the source of truth; the repository becomes it. Every change has an author, a diff, history and rollback.',
        },
        {
          type: 'code',
          value: `# templates/support_orderupdate_en_v2.yaml
# The versioned definition is the source of truth. The Meta panel
# is just a reflection of this file, synced via the Graph API.
name: support_orderupdate_en_v2
language: en_US
category: UTILITY            # utility: update tied to a user action
owner: support
components:
  - type: BODY
    text: "Hi {{1}}, your order {{2}} moved to status: {{3}}."
    example:
      body_text:
        - ["John", "#10482", "shipped"]
  - type: BUTTONS
    buttons:
      - type: URL
        text: "Track order"
        url: "https://example.com/orders/{{1}}"
        example: ["https://example.com/orders/10482"]`,
        },
        {
          type: 'paragraph',
          value:
            'The sync reads the file and creates or updates the template in the WABA via the Graph API. The same script runs in CI: on PR merge, the template is submitted to Meta and the pipeline records the returned status.',
        },
        {
          type: 'code',
          value: `// sync-template.js
// Reads the YAML definition and submits the template to Meta via Graph API.
// Run it in CI after merging the PR that approved copy and category.
import fs from 'node:fs';
import yaml from 'js-yaml';

const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.META_TOKEN;

async function syncTemplate(path) {
  const def = yaml.load(fs.readFileSync(path, 'utf8'));

  const payload = {
    name: def.name,
    language: def.language,
    category: def.category,
    components: def.components,
  };

  const res = await fetch(
    \`https://graph.facebook.com/v21.0/\${WABA_ID}/message_templates\`,
    {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${TOKEN}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    // Meta rejection status comes back here: log it and fail the pipeline
    throw new Error(\`Failed to sync \${def.name}: \${JSON.stringify(data)}\`);
  }
  // data.status is usually PENDING until Meta reviews it
  console.log(\`Submitted \${def.name}: status \${data.status}\`);
  return data;
}

syncTemplate(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});`,
        },
        {
          type: 'paragraph',
          value:
            'With this foundation, the whole approval process happens in the PR review and Meta only receives what already passed the gates. The namespace becomes auditable: to know why a template exists, who created it and what changed between versions, you just look at the repository history.',
        },
      ],
    },
    {
      title: 'Per-template metrics',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governance does not end at approval. Every active template needs to be measured to know whether it still deserves to exist. The metrics that matter come from Meta itself (delivery and read status) and from your product (response and block), and should be tracked per template, not in aggregate.',
        },
        {
          type: 'list',
          items: [
            'Delivery rate: share of delivered messages over sent. A persistent drop suggests invalid numbers in the base, blocks or a template quality problem.',
            'Read rate: share of delivered messages that were read. Low read on utility may indicate irrelevant copy or sending at the wrong time.',
            'Response rate: share that triggered a customer reply. On templates that expect an action (confirm, schedule), it is the most direct signal of effectiveness.',
            'Block and report rate: share of recipients who blocked or marked as spam. On marketing templates it is the critical indicator: high blocking drags down number quality and threatens every team on the WABA.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Reading these together is what drives the decision to keep, revise or retire. A marketing template with ok read but rising blocks should be paused before it hurts the whole WABA. A utility with falling delivery points to base hygiene. Measuring per template closes the governance loop: what enters through the approval gate also exits by a data criterion when it stops serving.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I edit a template already approved by Meta?',
      answer:
        'Avoid it. Editing the content of an approved template usually forces a new Meta review and breaks the version history. The governance practice is to create a new version (for example, from _v2 to _v3), submit, validate and only then move the traffic. The old version becomes deprecated and stays as a record of what was live.',
    },
    {
      question: 'Why not let each team create templates directly in the panel?',
      answer:
        'Because the WABA and the template namespace are shared. Free creation in the panel produces conflicting names, duplicated definitions, wrong categories and Meta rejections, with no owner or history. Centralizing definitions in a versioned repository and submitting via API gives each template an explicit owner, review and audit trail.',
    },
    {
      question: 'How does the wrong template category increase my cost?',
      answer:
        'Categories have different billing rules and utility is usually cheaper than marketing. Labeling a promotion as utility to pay less does not work: Meta reclassifies it and, on repeat offense, can hurt number quality. That is why the category check is a mandatory gate before submission.',
    },
  ],
  conclusion: {
    title: 'Governed templates are predictable, cheap and auditable',
    description:
      'Naming with an owner, lifecycle with versions, an approval process with category check, template as code and per-template metrics turn a chaotic namespace into a channel under control. If several teams compete for the same WABA in your operation, I can help structure this governance end to end.',
    cta: 'Talk about template governance',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'WhatsApp Cloud API costs', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Multi-tenant architecture for WhatsApp SaaS', to: '/blog/arquitetura-multi-tenant-whatsapp-saas' },
  ],
  repo: {
    name: 'whatsapp-templates-as-code',
    description:
      'Example of WhatsApp template governance as code: versioned YAML definitions, PR review and sync to Meta via the Graph API.',
    url: 'https://github.com/joaosouz4dev/whatsapp-templates-as-code',
  },
};

const es = {
  intro:
    'En una empresa pequena, un solo equipo cuida las plantillas de WhatsApp y todo funciona. Cuando marketing, soporte y producto pasan a crear plantillas en el mismo WABA, el namespace se vuelve tierra de nadie: nombres conflictivos, definiciones duplicadas, rechazos de Meta por copy fuera de politica y categoria equivocada que te hace pagar marketing donde deberia ser utility. Gobernar plantillas en equipos grandes no es burocracia, es lo que mantiene el canal predecible y barato. Este articulo cubre convencion de nomenclatura, ciclo de vida y versionado, proceso de aprobacion, template as code y las metricas que dicen si una plantilla merece seguir viva.',
  sections: [
    {
      title: 'El problema: varios equipos, un WABA',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El WhatsApp Business Account (WABA) es compartido, y el namespace de plantillas tambien. Cuando marketing, soporte y producto crean plantillas en el mismo panel sin coordinacion, los sintomas aparecen rapido. Dos equipos crean "actualizacion_pedido" con copy ligeramente distinto y nadie sabe cual usar. Alguien reutiliza el nombre equivocado en produccion. Marketing envia una plantilla promocional clasificada como utility para esquivar la regla de cobro y Meta la rechaza o reclasifica. Producto crea una plantilla de prueba que nunca se elimino y ensucia la lista.',
        },
        {
          type: 'paragraph',
          value:
            'La raiz del problema es que el panel de Meta trata las plantillas como recursos globales del WABA, sin nocion de dueno, sin historial de version y sin ambiente de homologacion. Cada creacion manual es una decision aislada que afecta a todos los equipos. Sin gobernanza, el resultado es duplicacion, rechazos recurrentes, costo inflado por categoria equivocada y un namespace imposible de auditar.',
        },
      ],
    },
    {
      title: 'Convencion de nomenclatura y namespace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera defensa es un estandar de nombres que haga obvios el dueno, la jornada y el idioma en el propio nombre de la plantilla. Meta solo acepta minusculas, numeros y guion bajo, asi que el estandar debe caber en esa restriccion. Un esquema que funciona bien es prefijo por equipo, luego jornada, luego idioma, luego version: equipo_jornada_idioma_version. Ejemplo: support_orderupdate_es_v2.',
        },
        {
          type: 'table',
          columns: ['Segmento', 'Significado', 'Ejemplo'],
          rows: [
            ['equipo', 'Equipo dueno de la plantilla', 'support, marketing, product'],
            ['jornada', 'Flujo o evento que atiende la plantilla', 'orderupdate, otp, cartabandon'],
            ['idioma', 'Locale del contenido', 'pt, en, es'],
            ['version', 'Version logica de la plantilla', 'v1, v2, v3'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con este estandar, support_orderupdate_es_v2 se lee solo: es de soporte, trata actualizacion de pedido, en espanol, segunda version. El prefijo de equipo elimina el conflicto de nombres entre equipos, porque cada uno solo crea dentro de su propio espacio. Las reglas minimas que sostienen la convencion:',
        },
        {
          type: 'list',
          items: [
            'Prefijo de equipo obligatorio: ninguna plantilla existe sin dueno explicito en el nombre.',
            'Una jornada por plantilla: no mezcles confirmacion de pedido y encuesta de satisfaccion en el mismo nombre.',
            'Idioma siempre en el nombre: las variantes de locale son plantillas distintas, nunca la misma plantilla con texto cambiado a mano.',
            'Version en el sufijo: si cambio el contenido, la estructura o la categoria, sube la version en vez de editar la plantilla antigua.',
            'Sin nombres de prueba en produccion: temp, test, copy y final quedan fuera del WABA de produccion.',
          ],
        },
      ],
    },
    {
      title: 'Ciclo de vida y versionado de la plantilla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una plantilla no es estatica: nace como borrador, pasa por revision interna, va a aprobacion de Meta, entra en uso y un dia se retira. Tratar ese ciclo de forma explicita evita que los borradores se filtren a produccion y que las plantillas muertas sigan en la lista. Cada transicion tiene un responsable y un criterio claro de paso.',
        },
        {
          type: 'diagram',
          value: `  draft
    |  copy escrita, revision interna de texto y variables
    v
  review
    |  aprobacion de copy + chequeo de categoria correcta
    v
  submit Meta
    |  enviado via Graph API; espera analisis de Meta
    v
  approved
    |  Meta aprobo; aun no esta en uso
    v
  active
    |  en produccion, recibiendo trafico
    v
  deprecated
       reemplazada por una nueva version; conservada solo para auditoria`,
        },
        {
          type: 'paragraph',
          value:
            'El punto clave del versionado es que aprobada por Meta no significa editable. Cambio el copy de support_orderupdate_es_v2? Crea support_orderupdate_es_v3, envia, valida y solo entonces mueve el trafico. La v2 pasa a deprecated, no desaparece: queda como registro de lo que estaba en el aire cuando se envio un mensaje. Editar una plantilla aprobada en el panel rompe el historial y suele forzar un nuevo analisis de Meta de todos modos.',
        },
      ],
    },
    {
      title: 'Proceso de aprobacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La gobernanza exige separar quien crea de quien envia. Cualquier persona del equipo dueno puede proponer una plantilla, pero el envio a Meta pasa por una puerta con revision de copy y chequeo de categoria. Esa puerta es lo que frena tanto el texto fuera de politica como el error de categoria que dispara el costo.',
        },
        {
          type: 'ordered',
          items: [
            'Creacion (autor del equipo dueno): redacta la definicion en el formato de codigo, define variables, idioma y la categoria pretendida. Nada va directo a Meta en este paso.',
            'Revision de copy (revisor designado): verifica claridad, tono, cumplimiento de la politica de WhatsApp y ausencia de contenido que motive rechazo. Aprueba o devuelve con comentarios.',
            'Chequeo de categoria (responsable de gobernanza): valida que la categoria sea correcta. Una confirmacion o actualizacion ligada a una accion del usuario es utility; promocion y reenganche es marketing. Clasificar marketing como utility para pagar menos lo reclasifica Meta y mina la confianza del WABA.',
            'Envio (rol autorizado): solo un conjunto restringido de personas tiene permiso de enviar via API. Este paso registra quien envio, cuando y que version.',
            'Validacion pos-aprobacion (autor + gobernanza): cuando Meta devuelve approved, haz un envio de prueba, verifica el render de variables y botones, y solo entonces promueve a active.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El chequeo de categoria merece destaque porque es donde la gobernanza se vuelve dinero. Utility suele ser mas barata que marketing, y la tentacion de etiquetar todo como utility es real. Meta detecta el patron, reclasifica y, en caso reincidente, puede perjudicar la calidad del numero. La puerta de categoria protege el presupuesto y la reputacion al mismo tiempo.',
        },
      ],
    },
    {
      title: 'Template as code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Crear plantillas a mano en el panel de Meta no escala ni audita. La alternativa es tratar la plantilla como codigo: la definicion vive en un repositorio versionado, pasa por pull request (la revision de copy y el chequeo de categoria se vuelven revision de PR) y se sincroniza a Meta via Graph API. El panel deja de ser la fuente de la verdad; el repositorio pasa a serlo. Cada cambio tiene autor, diff, historial y rollback.',
        },
        {
          type: 'code',
          value: `# templates/support_orderupdate_es_v2.yaml
# La definicion versionada es la fuente de la verdad. El panel de Meta
# es solo un reflejo de este archivo, sincronizado via Graph API.
name: support_orderupdate_es_v2
language: es_ES
category: UTILITY            # utility: actualizacion ligada a accion del usuario
owner: support
components:
  - type: BODY
    text: "Hola {{1}}, tu pedido {{2}} cambio al estado: {{3}}."
    example:
      body_text:
        - ["Juan", "#10482", "enviado"]
  - type: BUTTONS
    buttons:
      - type: URL
        text: "Seguir pedido"
        url: "https://ejemplo.com/pedidos/{{1}}"
        example: ["https://ejemplo.com/pedidos/10482"]`,
        },
        {
          type: 'paragraph',
          value:
            'La sincronizacion lee el archivo y crea o actualiza la plantilla en el WABA via Graph API. El mismo script corre en CI: al mergear el PR, la plantilla se envia a Meta y el pipeline registra el estado devuelto.',
        },
        {
          type: 'code',
          value: `// sync-template.js
// Lee la definicion YAML y envia la plantilla a Meta via Graph API.
// Ejecutalo en CI tras el merge del PR que aprobo copy y categoria.
import fs from 'node:fs';
import yaml from 'js-yaml';

const WABA_ID = process.env.WABA_ID;
const TOKEN = process.env.META_TOKEN;

async function syncTemplate(path) {
  const def = yaml.load(fs.readFileSync(path, 'utf8'));

  const payload = {
    name: def.name,
    language: def.language,
    category: def.category,
    components: def.components,
  };

  const res = await fetch(
    \`https://graph.facebook.com/v21.0/\${WABA_ID}/message_templates\`,
    {
      method: 'POST',
      headers: {
        Authorization: \`Bearer \${TOKEN}\`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await res.json();
  if (!res.ok) {
    // el estado de rechazo de Meta vuelve aqui: registralo y falla el pipeline
    throw new Error(\`Fallo al sincronizar \${def.name}: \${JSON.stringify(data)}\`);
  }
  // data.status suele ser PENDING hasta que Meta lo analiza
  console.log(\`Enviado \${def.name}: estado \${data.status}\`);
  return data;
}

syncTemplate(process.argv[2]).catch((err) => {
  console.error(err);
  process.exit(1);
});`,
        },
        {
          type: 'paragraph',
          value:
            'Con esta base, todo el proceso de aprobacion ocurre en la revision del PR y Meta solo recibe lo que ya paso por las puertas. El namespace queda auditable: para saber por que existe una plantilla, quien la creo y que cambio entre versiones, basta mirar el historial del repositorio.',
        },
      ],
    },
    {
      title: 'Metricas por plantilla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La gobernanza no termina en la aprobacion. Cada plantilla activa necesita medirse para saber si aun merece existir. Las metricas que importan vienen de la propia Meta (estado de entrega y lectura) y de tu producto (respuesta y bloqueo), y deben seguirse por plantilla, no en agregado.',
        },
        {
          type: 'list',
          items: [
            'Tasa de entrega: proporcion de mensajes entregados sobre enviados. Una caida persistente sugiere numeros invalidos en la base, bloqueos o un problema de calidad de la plantilla.',
            'Tasa de lectura: proporcion de entregados que fueron leidos. Lectura baja en utility puede indicar copy irrelevante o envio en el momento equivocado.',
            'Tasa de respuesta: proporcion que genero respuesta del cliente. En plantillas que esperan accion (confirmar, agendar), es la senal mas directa de eficacia.',
            'Tasa de bloqueo y denuncia: proporcion de destinatarios que bloquearon o marcaron como spam. En plantillas de marketing es el indicador critico: un bloqueo alto derrumba la calidad del numero y amenaza a todos los equipos del WABA.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura cruzada es lo que orienta la decision de mantener, revisar o retirar. Una plantilla de marketing con lectura ok pero bloqueo en subida debe pausarse antes de que perjudique todo el WABA. Una utility con entrega cayendo apunta a higiene de base. Medir por plantilla cierra el ciclo de gobernanza: lo que entra por la puerta de aprobacion tambien sale por un criterio de datos cuando deja de servir.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Puedo editar una plantilla ya aprobada por Meta?',
      answer:
        'Evitalo. Editar el contenido de una plantilla aprobada suele forzar un nuevo analisis de Meta y rompe el historial de version. La practica de gobernanza es crear una nueva version (por ejemplo, de _v2 a _v3), enviar, validar y solo entonces mover el trafico. La version antigua pasa a deprecated y queda como registro de lo que estaba en el aire.',
    },
    {
      question: 'Por que no dejar que cada equipo cree plantillas directo en el panel?',
      answer:
        'Porque el WABA y el namespace de plantillas son compartidos. La creacion libre en el panel genera nombres conflictivos, definiciones duplicadas, categoria equivocada y rechazos de Meta, sin dueno ni historial. Centralizar las definiciones en un repositorio versionado y enviar via API da a cada plantilla un dueno explicito, revision y auditoria.',
    },
    {
      question: 'Como la categoria equivocada de la plantilla aumenta mi costo?',
      answer:
        'Las categorias tienen reglas de cobro distintas y utility suele ser mas barata que marketing. Etiquetar una promocion como utility para pagar menos no funciona: Meta la reclasifica y, en reincidencia, puede perjudicar la calidad del numero. Por eso el chequeo de categoria es una puerta obligatoria antes del envio.',
    },
  ],
  conclusion: {
    title: 'Las plantillas gobernadas son predecibles, baratas y auditables',
    description:
      'Nomenclatura con dueno, ciclo de vida con version, proceso de aprobacion con chequeo de categoria, template as code y metricas por plantilla transforman un namespace caotico en un canal bajo control. Si varios equipos disputan el mismo WABA en tu operacion, puedo ayudar a estructurar esa gobernanza de punta a punta.',
    cta: 'Hablar sobre gobernanza de plantillas',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Costos de la WhatsApp Cloud API', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Arquitectura multi-tenant para WhatsApp SaaS', to: '/blog/arquitetura-multi-tenant-whatsapp-saas' },
  ],
  repo: {
    name: 'whatsapp-templates-as-code',
    description:
      'Ejemplo de gobernanza de plantillas de WhatsApp como codigo: definiciones versionadas en YAML, revision por PR y sincronizacion a Meta via Graph API.',
    url: 'https://github.com/joaosouz4dev/whatsapp-templates-as-code',
  },
};

export default { pt, en, es };
