// Conteudo do artigo: governanca-templates-times-grandes
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }

const pt = {
  intro:
    'Em uma empresa pequena, um time só cuida dos templates de WhatsApp e tudo funciona. Quando marketing, suporte e produto passam a criar templates no mesmo WABA, o namespace vira terra de ninguém: nomes conflitantes, definições duplicadas, rejeições da Meta por copy fora de política e categoria errada que faz você pagar marketing onde deveria ser utility. Governar templates em times grandes não é burocracia, é o que mantém o canal previsível e barato. Este artigo cobre convenção de nomenclatura, ciclo de vida e versionamento, processo de aprovação, template as code e as métricas que dizem se um template merece continuar vivo.',
  sections: [
    {
      title: 'O problema: vários times, um WABA',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O WhatsApp Business Account (WABA) é compartilhado, e o namespace de templates também. Quando marketing, suporte e produto criam templates no mesmo painel sem coordenação, os sintomas aparecem rápido. Dois times criam "atualizacao_pedido" com copy ligeiramente diferente e ninguém sabe qual usar. Alguém reaproveita o nome errado em produção. Marketing submete um template promocional classificado como utility para fugir da regra de cobrança e a Meta rejeita ou reclassifica. Produto cria um template de teste que nunca foi removido e polui a lista.',
        },
        {
          type: 'paragraph',
          value:
            'A raiz do problema é que o painel da Meta trata templates como recursos globais do WABA, sem noção de dono, sem histórico de versão e sem ambiente de homologação. Cada criação manual é uma decisão isolada que afeta todos os times. Sem governança, o resultado é duplicação, rejeições recorrentes, custo inflado por categoria errada e um namespace impossível de auditar.',
        },
      ],
    },
    {
      title: 'Convenção de nomenclatura e namespace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A primeira defesa é um padrão de nomes que torne o dono, a jornada e o idioma óbvios no próprio nome do template. A Meta só aceita minúsculas, números e underscore, então o padrão precisa caber nessa restrição. Um esquema que funciona bem é prefixo por time, depois jornada, depois idioma, depois versão: time_jornada_idioma_versao. Exemplo: support_orderupdate_pt_v2.',
        },
        {
          type: 'table',
          columns: ['Segmento', 'Significado', 'Exemplo'],
          rows: [
            ['time', 'Time dono do template', 'support, marketing, product'],
            ['jornada', 'Fluxo ou evento que o template atende', 'orderupdate, otp, cartabandon'],
            ['idioma', 'Locale do conteúdo', 'pt, en, es'],
            ['versao', 'Versão lógica do template', 'v1, v2, v3'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com esse padrão, support_orderupdate_pt_v2 se lê sozinho: é do suporte, trata atualização de pedido, em português, segunda versão. O prefixo de time elimina conflito de nomes entre equipes, porque cada uma só cria dentro do seu próprio espaço. As regras mínimas que sustentam a convenção:',
        },
        {
          type: 'list',
          items: [
            'Prefixo de time obrigatório: nenhum template existe sem dono explícito no nome.',
            'Uma jornada por template: não misture confirmação de pedido e pesquisa de satisfação no mesmo nome.',
            'Idioma sempre no nome: variantes de locale são templates distintos, nunca o mesmo template com texto trocado na mão.',
            'Versão no sufixo: mudou conteúdo, estrutura ou categoria, sobe a versão em vez de editar o template antigo.',
            'Sem nomes de teste em produção: temp, teste, copy e final ficam fora do WABA de produção.',
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
            'Um template não é estático: ele nasce como rascunho, passa por revisão interna, vai para aprovação da Meta, entra em uso e um dia é aposentado. Tratar esse ciclo de forma explícita evita que rascunhos vazem para produção e que templates mortos continuem na lista. Cada transição tem um responsável e um critério claro de passagem.',
        },
        {
          type: 'diagram',
          value: `  draft
    |  copy escrita, revisão interna de texto e variáveis
    v
  review
    |  aprovação de copy + checagem de categoria correta
    v
  submit Meta
    |  envio via Graph API; aguarda análise da Meta
    v
  approved
    |  Meta aprovou; ainda não em uso
    v
  active
    |  em produção, recebendo tráfego
    v
  deprecated
       substituído por nova versão; mantido só para auditoria`,
        },
        {
          type: 'paragraph',
          value:
            'O ponto chave do versionamento é que aprovado pela Meta não significa editável. Mudou a copy de support_orderupdate_pt_v2? Crie support_orderupdate_pt_v3, submeta, valide e só então mova o tráfego. O v2 vira deprecated, não desaparece: ele fica como registro do que estava no ar quando uma mensagem foi enviada. Editar template aprovado no painel quebra o histórico e costuma forçar nova análise da Meta de qualquer forma.',
        },
      ],
    },
    {
      title: 'Processo de aprovação',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governança exige separar quem cria de quem submete. Qualquer pessoa do time dono pode propor um template, mas a submissão para a Meta passa por um portão com revisão de copy e checagem de categoria. Esse portão é o que impede tanto o texto fora de política quanto o erro de categoria que estoura o custo.',
        },
        {
          type: 'ordered',
          items: [
            'Criação (autor do time dono): redige a definição no formato de código, define variáveis, idioma e a categoria pretendida. Nada vai direto para a Meta nesse passo.',
            'Revisão de copy (revisor designado): confere clareza, tom, conformidade com a política do WhatsApp e ausência de conteúdo que motive rejeição. Aprova ou devolve com comentários.',
            'Checagem de categoria (responsável de governança): valida se a categoria está correta. Confirmação e atualização ligada a uma ação do usuário é utility; promoção e reengajamento é marketing. Classificar marketing como utility para pagar menos é reclassificado pela Meta e mina a confiança do WABA.',
            'Submissão (papel autorizado): só um conjunto restrito de pessoas tem permissão de submeter via API. Esse passo registra quem submeteu, quando e qual versão.',
            'Validação pós-aprovação (autor + governança): ao voltar approved da Meta, faz um envio de teste, confere render de variáveis e botões, e só então promove para active.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A checagem de categoria merece destaque porque é onde governança vira dinheiro. Utility costuma ser mais barata que marketing, e a tentação de rotular tudo como utility é real. A Meta detecta o padrão, reclassifica e, em caso reincidente, pode prejudicar a qualidade do número. O portão de categoria protege o orçamento e a reputação ao mesmo tempo.',
        },
      ],
    },
    {
      title: 'Template as code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Criar template manualmente no painel da Meta não escala nem audita. A alternativa é tratar template como código: a definição vive em um repositório versionado, passa por pull request (a revisão de copy e a checagem de categoria viram revisão de PR) e é sincronizada para a Meta via Graph API. O painel deixa de ser a fonte da verdade; o repositório passa a ser. Cada mudança tem autor, diff, histórico e rollback.',
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
            'A sincronização lê o arquivo e cria ou atualiza o template no WABA via Graph API. O mesmo script roda em CI: ao mergear o PR, o template é submetido à Meta e o pipeline registra o status retornado.',
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
            'Com essa base, todo o processo de aprovação acontece na revisão do PR e a Meta recebe apenas o que já passou pelos portões. O namespace fica auditável: para saber por que um template existe, quem o criou e o que mudou entre versões, basta olhar o histórico do repositório.',
        },
      ],
    },
    {
      title: 'Métricas por template',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Governança não termina na aprovação. Cada template ativo precisa ser medido para saber se ainda merece existir. As métricas que importam vêm da própria Meta (status de entrega e leitura) e do seu produto (resposta e bloqueio), e devem ser acompanhadas por template, não em agregado.',
        },
        {
          type: 'list',
          items: [
            'Taxa de entrega: proporção de mensagens entregues sobre enviadas. Queda persistente sugere número inválido na base, bloqueio ou problema de qualidade do template.',
            'Taxa de leitura: proporção de entregues que foram lidas. Leitura baixa em utility pode indicar copy irrelevante ou disparo na hora errada.',
            'Taxa de resposta: proporção que gerou resposta do cliente. Em templates que esperam ação (confirmar, agendar), é o sinal mais direto de eficácia.',
            'Taxa de bloqueio e denúncia: proporção de destinatários que bloquearam ou marcaram como spam. Em templates de marketing, é o indicador crítico: alto bloqueio derruba a qualidade do número e ameaça todos os times do WABA.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A leitura cruzada é o que orienta a decisão de manter, revisar ou aposentar. Um template de marketing com leitura ok mas bloqueio subindo deve ser pausado antes que prejudique o WABA inteiro. Um utility com entrega caindo aponta para higiene de base. Medir por template fecha o ciclo de governança: o que entra pelo portão de aprovação também sai por um critério de dados quando para de servir.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso editar um template já aprovado pela Meta?',
      answer:
        'Evite. Editar conteúdo de um template aprovado costuma forçar nova análise da Meta e quebra o histórico de versão. A prática de governança é criar uma nova versão (por exemplo, de _v2 para _v3), submeter, validar e só então mover o tráfego. A versão antiga vira deprecated e fica como registro do que estava no ar.',
    },
    {
      question: 'Por que não deixar cada time criar templates direto no painel?',
      answer:
        'Porque o WABA e o namespace de templates são compartilhados. Criação livre no painel gera nomes conflitantes, definições duplicadas, categoria errada e rejeições da Meta, sem dono nem histórico. Centralizar as definições em um repositório versionado e submeter via API dá a cada template um dono explícito, revisão e auditoria.',
    },
    {
      question: 'Como a categoria errada do template aumenta meu custo?',
      answer:
        'As categorias têm regras de cobrança diferentes e utility costuma ser mais barata que marketing. Rotular uma promoção como utility para pagar menos não funciona: a Meta reclassifica e, em reincidência, pode prejudicar a qualidade do número. Por isso a checagem de categoria é um portão obrigatório antes da submissão.',
    },
  ],
  conclusion: {
    title: 'Templates governados são previsíveis, baratos e auditáveis',
    description:
      'Nomenclatura com dono, ciclo de vida com versão, processo de aprovação com checagem de categoria, template as code e métricas por template transformam um namespace caótico em um canal sob controle. Se vários times disputam o mesmo WABA na sua operação, posso ajudar a estruturar essa governança de ponta a ponta.',
    cta: 'Falar sobre governança de templates',
  },
  related: [
    { label: 'WhatsApp Cloud API', to: '/servicos/whatsapp-cloud-api' },
    { label: 'Custos da WhatsApp Cloud API', to: '/blog/custos-whatsapp-cloud-api-otimizacao' },
    { label: 'Arquitetura multi-tenant para WhatsApp SaaS', to: '/blog/arquitetura-multi-tenant-whatsapp-saas' },
  ],
  repo: {
    name: 'whatsapp-templates-as-code',
    description:
      'Exemplo de governança de templates de WhatsApp como código: definições versionadas em YAML, revisão por PR e sincronização para a Meta via Graph API.',
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
    'En una empresa pequeña, un solo equipo cuida las plantillas de WhatsApp y todo funciona. Cuando marketing, soporte y producto pasan a crear plantillas en el mismo WABA, el namespace se vuelve tierra de nadie: nombres conflictivos, definiciones duplicadas, rechazos de Meta por copy fuera de política y categoría equivocada que te hace pagar marketing donde debería ser utility. Gobernar plantillas en equipos grandes no es burocracia, es lo que mantiene el canal predecible y barato. Este artículo cubre convención de nomenclatura, ciclo de vida y versionado, proceso de aprobación, template as code y las métricas que dicen si una plantilla merece seguir viva.',
  sections: [
    {
      title: 'El problema: varios equipos, un WABA',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El WhatsApp Business Account (WABA) es compartido, y el namespace de plantillas también. Cuando marketing, soporte y producto crean plantillas en el mismo panel sin coordinación, los síntomas aparecen rápido. Dos equipos crean "actualizacion_pedido" con copy ligeramente distinto y nadie sabe cuál usar. Alguien reutiliza el nombre equivocado en producción. Marketing envía una plantilla promocional clasificada como utility para esquivar la regla de cobro y Meta la rechaza o reclasifica. Producto crea una plantilla de prueba que nunca se eliminó y ensucia la lista.',
        },
        {
          type: 'paragraph',
          value:
            'La raíz del problema es que el panel de Meta trata las plantillas como recursos globales del WABA, sin noción de dueño, sin historial de versión y sin ambiente de homologación. Cada creación manual es una decisión aislada que afecta a todos los equipos. Sin gobernanza, el resultado es duplicación, rechazos recurrentes, costo inflado por categoría equivocada y un namespace imposible de auditar.',
        },
      ],
    },
    {
      title: 'Convención de nomenclatura y namespace',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La primera defensa es un estándar de nombres que haga obvios el dueño, la jornada y el idioma en el propio nombre de la plantilla. Meta solo acepta minúsculas, números y guion bajo, así que el estándar debe caber en esa restricción. Un esquema que funciona bien es prefijo por equipo, luego jornada, luego idioma, luego versión: equipo_jornada_idioma_version. Ejemplo: support_orderupdate_es_v2.',
        },
        {
          type: 'table',
          columns: ['Segmento', 'Significado', 'Ejemplo'],
          rows: [
            ['equipo', 'Equipo dueño de la plantilla', 'support, marketing, product'],
            ['jornada', 'Flujo o evento que atiende la plantilla', 'orderupdate, otp, cartabandon'],
            ['idioma', 'Locale del contenido', 'pt, en, es'],
            ['version', 'Versión lógica de la plantilla', 'v1, v2, v3'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con este estándar, support_orderupdate_es_v2 se lee solo: es de soporte, trata actualización de pedido, en español, segunda versión. El prefijo de equipo elimina el conflicto de nombres entre equipos, porque cada uno solo crea dentro de su propio espacio. Las reglas mínimas que sostienen la convención:',
        },
        {
          type: 'list',
          items: [
            'Prefijo de equipo obligatorio: ninguna plantilla existe sin dueño explícito en el nombre.',
            'Una jornada por plantilla: no mezcles confirmación de pedido y encuesta de satisfacción en el mismo nombre.',
            'Idioma siempre en el nombre: las variantes de locale son plantillas distintas, nunca la misma plantilla con texto cambiado a mano.',
            'Versión en el sufijo: si cambió el contenido, la estructura o la categoría, sube la versión en vez de editar la plantilla antigua.',
            'Sin nombres de prueba en producción: temp, test, copy y final quedan fuera del WABA de producción.',
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
            'Una plantilla no es estática: nace como borrador, pasa por revisión interna, va a aprobación de Meta, entra en uso y un día se retira. Tratar ese ciclo de forma explícita evita que los borradores se filtren a producción y que las plantillas muertas sigan en la lista. Cada transición tiene un responsable y un criterio claro de paso.',
        },
        {
          type: 'diagram',
          value: `  draft
    |  copy escrita, revisión interna de texto y variables
    v
  review
    |  aprobación de copy + chequeo de categoría correcta
    v
  submit Meta
    |  enviado via Graph API; espera análisis de Meta
    v
  approved
    |  Meta aprobó; aún no está en uso
    v
  active
    |  en producción, recibiendo tráfico
    v
  deprecated
       reemplazada por una nueva versión; conservada solo para auditoría`,
        },
        {
          type: 'paragraph',
          value:
            'El punto clave del versionado es que aprobada por Meta no significa editable. ¿Cambió el copy de support_orderupdate_es_v2? Crea support_orderupdate_es_v3, envía, valida y solo entonces mueve el tráfico. La v2 pasa a deprecated, no desaparece: queda como registro de lo que estaba en el aire cuando se envió un mensaje. Editar una plantilla aprobada en el panel rompe el historial y suele forzar un nuevo análisis de Meta de todos modos.',
        },
      ],
    },
    {
      title: 'Proceso de aprobación',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La gobernanza exige separar quien crea de quien envía. Cualquier persona del equipo dueño puede proponer una plantilla, pero el envío a Meta pasa por una puerta con revisión de copy y chequeo de categoría. Esa puerta es lo que frena tanto el texto fuera de política como el error de categoría que dispara el costo.',
        },
        {
          type: 'ordered',
          items: [
            'Creación (autor del equipo dueño): redacta la definición en el formato de código, define variables, idioma y la categoría pretendida. Nada va directo a Meta en este paso.',
            'Revisión de copy (revisor designado): verifica claridad, tono, cumplimiento de la política de WhatsApp y ausencia de contenido que motive rechazo. Aprueba o devuelve con comentarios.',
            'Chequeo de categoría (responsable de gobernanza): valida que la categoría sea correcta. Una confirmación o actualización ligada a una acción del usuario es utility; promoción y reenganche es marketing. Clasificar marketing como utility para pagar menos lo reclasifica Meta y mina la confianza del WABA.',
            'Envío (rol autorizado): solo un conjunto restringido de personas tiene permiso de enviar via API. Este paso registra quién envió, cuándo y qué versión.',
            'Validación pos-aprobación (autor + gobernanza): cuando Meta devuelve approved, haz un envío de prueba, verifica el render de variables y botones, y solo entonces promueve a active.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El chequeo de categoría merece destaque porque es donde la gobernanza se vuelve dinero. Utility suele ser más barata que marketing, y la tentación de etiquetar todo como utility es real. Meta detecta el patrón, reclasifica y, en caso reincidente, puede perjudicar la calidad del número. La puerta de categoría protege el presupuesto y la reputación al mismo tiempo.',
        },
      ],
    },
    {
      title: 'Template as code',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Crear plantillas a mano en el panel de Meta no escala ni audita. La alternativa es tratar la plantilla como código: la definición vive en un repositorio versionado, pasa por pull request (la revisión de copy y el chequeo de categoría se vuelven revisión de PR) y se sincroniza a Meta via Graph API. El panel deja de ser la fuente de la verdad; el repositorio pasa a serlo. Cada cambio tiene autor, diff, historial y rollback.',
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
            'La sincronización lee el archivo y crea o actualiza la plantilla en el WABA via Graph API. El mismo script corre en CI: al mergear el PR, la plantilla se envía a Meta y el pipeline registra el estado devuelto.',
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
            'Con esta base, todo el proceso de aprobación ocurre en la revisión del PR y Meta solo recibe lo que ya pasó por las puertas. El namespace queda auditable: para saber por qué existe una plantilla, quién la creó y qué cambió entre versiones, basta mirar el historial del repositorio.',
        },
      ],
    },
    {
      title: 'Métricas por plantilla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La gobernanza no termina en la aprobación. Cada plantilla activa necesita medirse para saber si aún merece existir. Las métricas que importan vienen de la propia Meta (estado de entrega y lectura) y de tu producto (respuesta y bloqueo), y deben seguirse por plantilla, no en agregado.',
        },
        {
          type: 'list',
          items: [
            'Tasa de entrega: proporción de mensajes entregados sobre enviados. Una caída persistente sugiere números inválidos en la base, bloqueos o un problema de calidad de la plantilla.',
            'Tasa de lectura: proporción de entregados que fueron leídos. Lectura baja en utility puede indicar copy irrelevante o envío en el momento equivocado.',
            'Tasa de respuesta: proporción que generó respuesta del cliente. En plantillas que esperan acción (confirmar, agendar), es la señal más directa de eficacia.',
            'Tasa de bloqueo y denuncia: proporción de destinatarios que bloquearon o marcaron como spam. En plantillas de marketing es el indicador crítico: un bloqueo alto derrumba la calidad del número y amenaza a todos los equipos del WABA.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La lectura cruzada es lo que orienta la decisión de mantener, revisar o retirar. Una plantilla de marketing con lectura ok pero bloqueo en subida debe pausarse antes de que perjudique todo el WABA. Una utility con entrega cayendo apunta a higiene de base. Medir por plantilla cierra el ciclo de gobernanza: lo que entra por la puerta de aprobación también sale por un criterio de datos cuando deja de servir.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo editar una plantilla ya aprobada por Meta?',
      answer:
        'Evítalo. Editar el contenido de una plantilla aprobada suele forzar un nuevo análisis de Meta y rompe el historial de versión. La práctica de gobernanza es crear una nueva versión (por ejemplo, de _v2 a _v3), enviar, validar y solo entonces mover el tráfico. La versión antigua pasa a deprecated y queda como registro de lo que estaba en el aire.',
    },
    {
      question: '¿Por qué no dejar que cada equipo cree plantillas directo en el panel?',
      answer:
        'Porque el WABA y el namespace de plantillas son compartidos. La creación libre en el panel genera nombres conflictivos, definiciones duplicadas, categoría equivocada y rechazos de Meta, sin dueño ni historial. Centralizar las definiciones en un repositorio versionado y enviar via API da a cada plantilla un dueño explícito, revisión y auditoría.',
    },
    {
      question: '¿Cómo la categoría equivocada de la plantilla aumenta mi costo?',
      answer:
        'Las categorías tienen reglas de cobro distintas y utility suele ser más barata que marketing. Etiquetar una promoción como utility para pagar menos no funciona: Meta la reclasifica y, en reincidencia, puede perjudicar la calidad del número. Por eso el chequeo de categoría es una puerta obligatoria antes del envío.',
    },
  ],
  conclusion: {
    title: 'Las plantillas gobernadas son predecibles, baratas y auditables',
    description:
      'Nomenclatura con dueño, ciclo de vida con versión, proceso de aprobación con chequeo de categoría, template as code y métricas por plantilla transforman un namespace caótico en un canal bajo control. Si varios equipos disputan el mismo WABA en tu operación, puedo ayudar a estructurar esa gobernanza de punta a punta.',
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
      'Ejemplo de gobernanza de plantillas de WhatsApp como código: definiciones versionadas en YAML, revisión por PR y sincronización a Meta via Graph API.',
    url: 'https://github.com/joaosouz4dev/whatsapp-templates-as-code',
  },
};

export default { pt, en, es };
