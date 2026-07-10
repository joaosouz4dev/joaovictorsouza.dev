// Conteudo do artigo: Integracao ERP + CRM sem retrabalho operacional.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }.

const pt = {
  intro:
    'O vendedor cadastra o cliente no CRM. O financeiro cadastra o mesmo cliente no ERP. ' +
    'Duas fichas nascem do nada, com CNPJ digitado de jeitos diferentes e endereço divergente. ' +
    'A partir daí todo relatório mente e alguém gasta a tarde reconciliando planilha. ' +
    'Este guia mostra como ligar ERP e CRM com padrões de sincronização, fonte da verdade por ' +
    'entidade e idempotência, para que o dado entre uma vez e nunca mais precise de cadastro manual.',
  sections: [
    {
      title: 'O problema: dois cadastros do mesmo cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sem integração, cada área opera sua própria base. O CRM tem o cliente do ponto de ' +
            'vista comercial; o ERP tem o mesmo cliente do ponto de vista fiscal e financeiro. ' +
            'Como ninguém combinou quem cria o registro primeiro, o mesmo cliente aparece duas ' +
            'vezes, com pequenas diferenças: nome com ou sem acento, telefone com ou sem DDD, ' +
            'CNPJ com ou sem pontuação. O resultado é retrabalho crônico.',
        },
        {
          type: 'list',
          items: [
            'Cadastro em dobro: o mesmo cliente vira dois IDs, um no CRM e outro no ERP, sem ligação entre eles.',
            'Dado divergente: endereço de cobrança atualizado no ERP nunca chega ao CRM, e o vendedor liga para o lugar errado.',
            'Digitação manual repetida: alguém reescreve no ERP o que já existia no CRM, abrindo espaço para erro de digitação.',
            'Relatório que não fecha: faturamento por cliente no ERP não bate com pipeline no CRM porque são chaves diferentes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A solução não é escolher um sistema e abandonar o outro. É definir regras claras de ' +
            'quem manda em cada campo e fazer os dois conversarem sem duplicar.',
        },
      ],
    },
    {
      title: 'Fonte da verdade por entidade e por campo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro mais comum é tentar sincronizar tudo nos dois sentidos. O caminho saudável é ' +
            'decidir, campo a campo, qual sistema é o dono. O dono escreve; o outro apenas lê e ' +
            'reflete. Isso elimina a briga de quem sobrescreve quem.',
        },
        {
          type: 'table',
          columns: ['Entidade', 'Campo', 'Dono (fonte da verdade)', 'Sistema que reflete'],
          rows: [
            ['Cliente', 'Dados de contato e oportunidade', 'CRM', 'ERP lê para emitir nota'],
            ['Cliente', 'CNPJ, regime fiscal, limite de crédito', 'ERP', 'CRM lê para qualificar'],
            ['Produto', 'Nome comercial e descrição de venda', 'CRM', 'ERP reflete no catálogo'],
            ['Produto', 'Preço, estoque e código fiscal', 'ERP', 'CRM lê para cotar'],
            ['Pedido', 'Negociação e proposta', 'CRM', 'ERP recebe ao fechar'],
            ['Pedido', 'Faturamento, status fiscal e pagamento', 'ERP', 'CRM lê para acompanhar'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com a tabela acima documentada, qualquer divergência tem resposta objetiva: o valor ' +
            'correto é sempre o do sistema dono daquele campo. Reconciliação deixa de ser debate ' +
            'e vira regra.',
        },
      ],
    },
    {
      title: 'Estratégias de sincronização',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Definido o dono de cada campo, escolha como o dado viaja. Três eixos importam: ' +
            'sentido (one-way ou two-way), gatilho (batch ou orientado a evento) e latência ' +
            '(periódico ou near-real-time).',
        },
        {
          type: 'diagram',
          value:
            'One-way (recomendado por campo):\n' +
            '  CRM ==(contato, proposta)==> ERP\n' +
            '  ERP ==(preço, estoque, fiscal)==> CRM\n' +
            '\n' +
            'Event-driven near-real-time:\n' +
            '  CRM --webhook--> [Middleware] --upsert--> ERP\n' +
            '  ERP --webhook--> [Middleware] --upsert--> CRM\n' +
            '                       |\n' +
            '                 mapping table\n' +
            '\n' +
            'Batch (fallback noturno):\n' +
            '  [Job 02:00] --lê delta--> compara --> aplica diferenças',
        },
        {
          type: 'list',
          items: [
            'One-way por campo: cada campo flui em um único sentido a partir do seu dono. Simples, previsível e evita loop de sobrescrita.',
            'Two-way: só quando os dois sistemas precisam editar a mesma entidade. Exige regra de conflito explícita, nunca improvise.',
            'Batch: job periódico que lê um delta e aplica diferenças. Barato e tolerante a falha, porém com atraso de minutos a horas.',
            'Event-driven via webhook: o sistema dono emite um evento na mudança e o middleware propaga em segundos, near-real-time.',
            'Padrão prático: event-driven para o fluxo principal e um batch noturno de reconciliação como rede de segurança.',
          ],
        },
      ],
    },
    {
      title: 'Chave de correlação e idempotência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para nunca duplicar, cada entidade precisa de uma chave que ligue o registro do CRM ' +
            'ao do ERP. Guarde esse vínculo numa mapping table: external_id de um lado, external_id ' +
            'do outro. Toda escrita vira um upsert por essa chave, não um insert cego. Assim, ' +
            'reprocessar o mesmo evento dez vezes produz o mesmo resultado: idempotência.',
        },
        {
          type: 'list',
          items: [
            'Mapping table: tabela que relaciona crm_id, erp_id e a chave natural (CNPJ, SKU) para resolver o par sem ambiguidade.',
            'Chave natural: quando não há mapping ainda, casa pelo CNPJ do cliente ou SKU do produto, normalizados antes de comparar.',
            'Upsert por chave: insere se não existe, atualiza se existe. Nunca um insert direto que cria duplicata em retry.',
            'Idempotência: a mesma mensagem aplicada N vezes deixa o sistema no mesmo estado, essencial porque webhook reenvia.',
          ],
        },
        {
          type: 'code',
          value: `// sync-customer.js
// Upsert idempotente de cliente entre CRM e ERP usando mapping table.
// Roda no middleware ao receber um evento "customer.updated" do CRM.

async function syncCustomerFromCrm(event) {
  const crmId = event.data.id;
  const cnpj = normalizeCnpj(event.data.cnpj); // remove pontuacao, valida

  // 1. Resolve o par via mapping table; cai para chave natural se nao houver vinculo
  let mapping = await db.mapping.findOne({ crm_id: crmId });
  if (!mapping) {
    const erp = await erpApi.findCustomerByCnpj(cnpj);
    if (erp) {
      // Cliente ja existe no ERP, so faltava o vinculo: nao duplica
      mapping = await db.mapping.upsert({ crm_id: crmId, erp_id: erp.id, cnpj });
    }
  }

  // 2. Monta apenas os campos que o CRM e dono (contato e proposta)
  const payload = {
    nome: event.data.nome,
    email: event.data.email,
    telefone: event.data.telefone,
  };

  // 3. Upsert idempotente: chave de negocio = erp_id (se existe) ou CNPJ
  const erpCustomer = await erpApi.upsertCustomer({
    matchBy: mapping?.erp_id ? { id: mapping.erp_id } : { cnpj },
    data: payload,
    // dedupe_key garante que reprocessar o mesmo evento nao gere efeito duplo
    dedupeKey: \`crm:\${crmId}:\${event.version}\`,
  });

  // 4. Persiste/atualiza o vinculo para a proxima sincronizacao
  await db.mapping.upsert({ crm_id: crmId, erp_id: erpCustomer.id, cnpj });
  return erpCustomer.id;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Repare que o código nunca faz insert direto: ele resolve o par antes, casa por CNPJ ' +
            'quando o vínculo ainda não existe e usa um dedupeKey baseado na versão do evento. ' +
            'Esse trio (mapping, chave natural e dedupe) é o que mata a duplicata na origem.',
        },
      ],
    },
    {
      title: 'Reconciliação e detecção de divergência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com sincronização em tempo real, eventos se perdem: webhook que falhou, deploy ' +
            'no meio de um lote, registro editado direto no banco. Por isso um job de reconciliação ' +
            'periódico é obrigatório. Ele compara os dois lados, alerta o que divergiu e, quando ' +
            'seguro, corrige sozinho.',
        },
        {
          type: 'ordered',
          items: [
            'Selecione o conjunto a comparar: todos os clientes ativos com atividade nas últimas 24 horas, por exemplo.',
            'Para cada registro, resolva o par pela mapping table e busque o estado atual nos dois sistemas.',
            'Compare apenas os campos que têm dono definido, normalizando antes (CNPJ sem pontuação, texto em caixa única).',
            'Classifique a divergência: ausente de um lado, valor diferente ou par quebrado (mapping sem correspondente).',
            'Para campo com dono claro, reaplique o valor do dono via upsert idempotente e registre a correção.',
            'Para casos ambíguos, gere um alerta e envie para a fila de revisão humana em vez de adivinhar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Registre cada reconciliação com contagem de divergências encontradas e corrigidas. ' +
            'Se esse número começa a subir, é sinal de que o fluxo event-driven está perdendo ' +
            'eventos e merece investigação antes de virar incidente.',
        },
      ],
    },
    {
      title: 'Tratamento de conflito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Conflito acontece quando os dois sistemas mudam o mesmo campo antes de sincronizar. ' +
            'A fonte da verdade por campo elimina a maioria dos casos, mas em fluxo two-way você ' +
            'precisa de uma política explícita. Escolha conforme o risco do campo.',
        },
        {
          type: 'list',
          items: [
            'Last-write-wins: vence a escrita mais recente por timestamp. Simples, bom para campos de baixo risco como observação livre.',
            'Resolução campo-a-campo: cada campo segue seu dono mesmo no two-way, ignorando a alteração do lado que não manda naquele campo.',
            'Fila de revisão humana: campos críticos (limite de crédito, regime fiscal) param em uma fila e um humano decide, sem auto-correção.',
            'Versionamento otimista: cada registro carrega uma versão; escrita com versão defasada é rejeitada e reenfileirada para reavaliar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regra geral: quanto maior o impacto financeiro ou fiscal do campo, menos automática ' +
            'deve ser a resolução. Observação comercial pode ser last-write-wins; limite de crédito ' +
            'merece revisão humana.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso sincronizar tudo nos dois sentidos para garantir que nada falte?',
      answer:
        'Não é recomendado. Two-way em todos os campos cria loops de sobrescrita e conflitos ' +
        'constantes: o CRM escreve, o ERP devolve, e os dois ficam piscando. Defina o dono por ' +
        'campo e deixe a maioria dos fluxos one-way. Reserve o two-way apenas para as poucas ' +
        'entidades que os dois sistemas realmente precisam editar, sempre com regra de conflito explícita.',
    },
    {
      question: 'O que uso como chave de correlação se os IDs dos dois sistemas são diferentes?',
      answer:
        'Use uma mapping table que guarda crm_id, erp_id e uma chave natural estável, como CNPJ ' +
        'para cliente ou SKU para produto. No primeiro encontro, você casa pela chave natural ' +
        'normalizada e grava o vínculo; nas próximas vezes, resolve direto pelo mapping. Assim os ' +
        'IDs internos podem ser diferentes sem nunca gerar duplicata.',
    },
    {
      question: 'Por que preciso de reconciliação se já tenho sincronização via webhook?',
      answer:
        'Porque webhook falha. Entrega perdida, timeout, deploy no meio de um lote ou edição ' +
        'direta no banco deixam os dois lados fora de sincronia sem ninguém perceber. O job de ' +
        'reconciliação é a rede de segurança: compara periodicamente, alerta divergências e ' +
        'corrige o que tem dono claro. Webhook entrega velocidade; reconciliação entrega confiança.',
    },
  ],
  conclusion: {
    title: 'Dado entra uma vez e nunca mais',
    description:
      'Integrar ERP e CRM sem retrabalho não depende de mais ferramenta, depende de três ' +
      'decisões: definir a fonte da verdade por campo, ligar os sistemas com upsert idempotente ' +
      'sobre uma mapping table e fechar a conta com reconciliação periódica. Com isso o cliente ' +
      'entra uma única vez, o relatório fecha e ninguém mais reescreve cadastro a mão. Posso ' +
      'ajudar a desenhar essa integração na sua operação.',
    cta: 'Falar sobre integrar meu ERP e CRM',
  },
  related: [
    { label: 'Testes de contrato para webhooks e APIs', to: '/blog/testes-contrato-webhooks-apis' },
    { label: 'Monitoramento e alertas em integrações', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Fale comigo', to: '/contato' },
  ],
  repo: {
    name: 'erp-crm-sync-patterns',
    description:
      'Padrões de sincronização entre ERP e CRM: fonte da verdade por campo, mapping table, ' +
      'upsert idempotente e job de reconciliação com detecção de divergência.',
    url: 'https://github.com/joaosouz4dev/erp-crm-sync-patterns',
  },
};

const en = {
  intro:
    'The salesperson creates the customer in the CRM. Finance creates the same customer in the ' +
    'ERP. Two records are born out of nowhere, with the tax ID typed differently and a divergent ' +
    'address. From then on every report lies and someone spends the afternoon reconciling a ' +
    'spreadsheet. This guide shows how to connect ERP and CRM with sync patterns, source of ' +
    'truth per entity and idempotency, so data enters once and never needs manual entry again.',
  sections: [
    {
      title: 'The problem: two records of the same customer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Without integration, each team runs its own base. The CRM holds the customer from a ' +
            'sales angle; the ERP holds the same customer from a tax and finance angle. Since ' +
            'nobody agreed on who creates the record first, the same customer shows up twice, ' +
            'with small differences: name with or without accents, phone with or without area ' +
            'code, tax ID with or without punctuation. The result is chronic rework.',
        },
        {
          type: 'list',
          items: [
            'Duplicate records: the same customer becomes two IDs, one in the CRM and one in the ERP, with no link between them.',
            'Divergent data: a billing address updated in the ERP never reaches the CRM, and the rep calls the wrong place.',
            'Repeated manual entry: someone retypes in the ERP what already existed in the CRM, opening room for typos.',
            'Reports that do not match: revenue per customer in the ERP does not line up with the CRM pipeline because the keys differ.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The fix is not to pick one system and drop the other. It is to define clear rules for ' +
            'who owns each field and make the two talk without duplicating.',
        },
      ],
    },
    {
      title: 'Source of truth per entity and per field',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common mistake is trying to sync everything in both directions. The healthy ' +
            'path is to decide, field by field, which system is the owner. The owner writes; the ' +
            'other only reads and reflects. This removes the fight over who overwrites whom.',
        },
        {
          type: 'table',
          columns: ['Entity', 'Field', 'Owner (source of truth)', 'System that reflects'],
          rows: [
            ['Customer', 'Contact and opportunity data', 'CRM', 'ERP reads to issue invoice'],
            ['Customer', 'Tax ID, tax regime, credit limit', 'ERP', 'CRM reads to qualify'],
            ['Product', 'Commercial name and sales description', 'CRM', 'ERP reflects in catalog'],
            ['Product', 'Price, stock and tax code', 'ERP', 'CRM reads to quote'],
            ['Order', 'Negotiation and proposal', 'CRM', 'ERP receives on close'],
            ['Order', 'Billing, tax status and payment', 'ERP', 'CRM reads to track'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'With the table above documented, any divergence has an objective answer: the correct ' +
            'value is always the one from the system that owns that field. Reconciliation stops ' +
            'being a debate and becomes a rule.',
        },
      ],
    },
    {
      title: 'Synchronization strategies',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the owner of each field defined, choose how the data travels. Three axes matter: ' +
            'direction (one-way or two-way), trigger (batch or event-driven) and latency ' +
            '(periodic or near-real-time).',
        },
        {
          type: 'diagram',
          value:
            'One-way (recommended per field):\n' +
            '  CRM ==(contact, proposal)==> ERP\n' +
            '  ERP ==(price, stock, tax)==> CRM\n' +
            '\n' +
            'Event-driven near-real-time:\n' +
            '  CRM --webhook--> [Middleware] --upsert--> ERP\n' +
            '  ERP --webhook--> [Middleware] --upsert--> CRM\n' +
            '                       |\n' +
            '                 mapping table\n' +
            '\n' +
            'Batch (nightly fallback):\n' +
            '  [Job 02:00] --read delta--> compare --> apply diffs',
        },
        {
          type: 'list',
          items: [
            'One-way per field: each field flows in a single direction from its owner. Simple, predictable and avoids overwrite loops.',
            'Two-way: only when both systems must edit the same entity. Requires an explicit conflict rule, never improvise.',
            'Batch: a periodic job that reads a delta and applies diffs. Cheap and fault-tolerant, but with a delay of minutes to hours.',
            'Event-driven via webhook: the owning system emits an event on change and the middleware propagates in seconds, near-real-time.',
            'Practical default: event-driven for the main flow and a nightly reconciliation batch as a safety net.',
          ],
        },
      ],
    },
    {
      title: 'Correlation key and idempotency',
      blocks: [
        {
          type: 'paragraph',
          value:
            'To never duplicate, each entity needs a key that links the CRM record to the ERP one. ' +
            'Store that link in a mapping table: external_id on one side, external_id on the other. ' +
            'Every write becomes an upsert by that key, not a blind insert. That way, reprocessing ' +
            'the same event ten times produces the same result: idempotency.',
        },
        {
          type: 'list',
          items: [
            'Mapping table: a table relating crm_id, erp_id and the natural key (tax ID, SKU) to resolve the pair without ambiguity.',
            'Natural key: when there is no mapping yet, match by the customer tax ID or product SKU, normalized before comparing.',
            'Upsert by key: insert if absent, update if present. Never a direct insert that creates a duplicate on retry.',
            'Idempotency: the same message applied N times leaves the system in the same state, essential because webhooks resend.',
          ],
        },
        {
          type: 'code',
          value: `// sync-customer.js
// Idempotent customer upsert between CRM and ERP using a mapping table.
// Runs in the middleware when receiving a "customer.updated" event from the CRM.

async function syncCustomerFromCrm(event) {
  const crmId = event.data.id;
  const taxId = normalizeTaxId(event.data.taxId); // strip punctuation, validate

  // 1. Resolve the pair via mapping table; fall back to natural key if no link
  let mapping = await db.mapping.findOne({ crm_id: crmId });
  if (!mapping) {
    const erp = await erpApi.findCustomerByTaxId(taxId);
    if (erp) {
      // Customer already exists in the ERP, only the link was missing: no duplicate
      mapping = await db.mapping.upsert({ crm_id: crmId, erp_id: erp.id, tax_id: taxId });
    }
  }

  // 2. Build only the fields the CRM owns (contact and proposal)
  const payload = {
    name: event.data.name,
    email: event.data.email,
    phone: event.data.phone,
  };

  // 3. Idempotent upsert: business key = erp_id (if present) or tax ID
  const erpCustomer = await erpApi.upsertCustomer({
    matchBy: mapping?.erp_id ? { id: mapping.erp_id } : { taxId },
    data: payload,
    // dedupeKey ensures reprocessing the same event has no double effect
    dedupeKey: \`crm:\${crmId}:\${event.version}\`,
  });

  // 4. Persist/update the link for the next sync
  await db.mapping.upsert({ crm_id: crmId, erp_id: erpCustomer.id, tax_id: taxId });
  return erpCustomer.id;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Note the code never does a direct insert: it resolves the pair first, matches by tax ' +
            'ID when the link does not exist yet, and uses a dedupeKey based on the event version. ' +
            'This trio (mapping, natural key and dedupe) is what kills the duplicate at the source.',
        },
      ],
    },
    {
      title: 'Reconciliation and divergence detection',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with real-time sync, events get lost: a failed webhook, a deploy mid-batch, a ' +
            'record edited straight in the database. That is why a periodic reconciliation job is ' +
            'mandatory. It compares both sides, alerts on what diverged and, when safe, fixes it ' +
            'on its own.',
        },
        {
          type: 'ordered',
          items: [
            'Select the set to compare: all active customers with activity in the last 24 hours, for example.',
            'For each record, resolve the pair via the mapping table and fetch the current state in both systems.',
            'Compare only the fields with a defined owner, normalizing first (tax ID without punctuation, text in a single case).',
            'Classify the divergence: missing on one side, different value or broken pair (mapping with no counterpart).',
            'For a field with a clear owner, reapply the owner value via idempotent upsert and log the correction.',
            'For ambiguous cases, raise an alert and send it to the human review queue instead of guessing.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Log each reconciliation with the count of divergences found and corrected. If that ' +
            'number starts climbing, it is a sign the event-driven flow is dropping events and ' +
            'deserves investigation before it turns into an incident.',
        },
      ],
    },
    {
      title: 'Conflict handling',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A conflict happens when both systems change the same field before syncing. Source of ' +
            'truth per field removes most cases, but in a two-way flow you need an explicit policy. ' +
            'Choose according to the risk of the field.',
        },
        {
          type: 'list',
          items: [
            'Last-write-wins: the most recent write by timestamp wins. Simple, good for low-risk fields like free-form notes.',
            'Field-level resolution: each field follows its owner even in two-way, ignoring the change from the side that does not own it.',
            'Human review queue: critical fields (credit limit, tax regime) stop in a queue and a human decides, with no auto-correction.',
            'Optimistic versioning: each record carries a version; a write with a stale version is rejected and requeued for reevaluation.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'General rule: the higher the financial or tax impact of the field, the less automatic ' +
            'the resolution should be. A sales note can be last-write-wins; a credit limit deserves ' +
            'human review.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I sync everything both ways to make sure nothing is missing?',
      answer:
        'Not recommended. Two-way on every field creates overwrite loops and constant conflicts: ' +
        'the CRM writes, the ERP bounces it back, and the two keep flickering. Define the owner ' +
        'per field and keep most flows one-way. Reserve two-way only for the few entities both ' +
        'systems truly need to edit, always with an explicit conflict rule.',
    },
    {
      question: 'What do I use as a correlation key if the two systems have different IDs?',
      answer:
        'Use a mapping table that stores crm_id, erp_id and a stable natural key, such as the tax ' +
        'ID for a customer or the SKU for a product. On the first encounter you match by the ' +
        'normalized natural key and record the link; from then on you resolve straight through the ' +
        'mapping. That way the internal IDs can differ without ever creating a duplicate.',
    },
    {
      question: 'Why do I need reconciliation if I already have webhook sync?',
      answer:
        'Because webhooks fail. A lost delivery, a timeout, a deploy mid-batch or a direct edit in ' +
        'the database leave both sides out of sync without anyone noticing. The reconciliation job ' +
        'is the safety net: it compares periodically, alerts on divergences and corrects what has a ' +
        'clear owner. Webhooks deliver speed; reconciliation delivers trust.',
    },
  ],
  conclusion: {
    title: 'Data enters once and never again',
    description:
      'Integrating ERP and CRM without rework does not depend on more tooling, it depends on three ' +
      'decisions: define the source of truth per field, link the systems with an idempotent upsert ' +
      'over a mapping table and close the loop with periodic reconciliation. With that the customer ' +
      'enters a single time, the report adds up and nobody retypes records by hand. I can help you ' +
      'design this integration in your operation.',
    cta: 'Talk about integrating my ERP and CRM',
  },
  related: [
    { label: 'Contract testing for webhooks and APIs', to: '/blog/testes-contrato-webhooks-apis' },
    { label: 'Monitoring and alerting for integrations', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Get in touch', to: '/contato' },
  ],
  repo: {
    name: 'erp-crm-sync-patterns',
    description:
      'Synchronization patterns between ERP and CRM: source of truth per field, mapping table, ' +
      'idempotent upsert and a reconciliation job with divergence detection.',
    url: 'https://github.com/joaosouz4dev/erp-crm-sync-patterns',
  },
};

const es = {
  intro:
    'El vendedor crea el cliente en el CRM. Finanzas crea el mismo cliente en el ERP. Nacen dos ' +
    'fichas de la nada, con el RUC escrito de formas distintas y una dirección divergente. A ' +
    'partir de ahí todo reporte miente y alguien pasa la tarde reconciliando una planilla. Esta ' +
    'guía muestra cómo conectar ERP y CRM con patrones de sincronización, fuente de la verdad por ' +
    'entidad e idempotencia, para que el dato entre una vez y nunca más necesite carga manual.',
  sections: [
    {
      title: 'El problema: dos fichas del mismo cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sin integración, cada área opera su propia base. El CRM tiene al cliente desde la ' +
            'vista comercial; el ERP tiene al mismo cliente desde la vista fiscal y financiera. ' +
            'Como nadie acordó quién crea el registro primero, el mismo cliente aparece dos veces, ' +
            'con pequeñas diferencias: nombre con o sin acento, teléfono con o sin código de área, ' +
            'RUC con o sin puntuación. El resultado es retrabajo crónico.',
        },
        {
          type: 'list',
          items: [
            'Ficha duplicada: el mismo cliente se vuelve dos IDs, uno en el CRM y otro en el ERP, sin enlace entre ellos.',
            'Dato divergente: una dirección de cobro actualizada en el ERP nunca llega al CRM, y el vendedor llama al lugar equivocado.',
            'Carga manual repetida: alguien reescribe en el ERP lo que ya existía en el CRM, abriendo espacio a errores de tipeo.',
            'Reportes que no cuadran: la facturación por cliente en el ERP no coincide con el pipeline del CRM porque son claves distintas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La solución no es elegir un sistema y abandonar el otro. Es definir reglas claras de ' +
            'quién manda en cada campo y hacer que los dos conversen sin duplicar.',
        },
      ],
    },
    {
      title: 'Fuente de la verdad por entidad y por campo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error más común es intentar sincronizar todo en ambos sentidos. El camino sano es ' +
            'decidir, campo a campo, cuál sistema es el dueño. El dueño escribe; el otro solo lee y ' +
            'refleja. Esto elimina la pelea de quién sobrescribe a quién.',
        },
        {
          type: 'table',
          columns: ['Entidad', 'Campo', 'Dueño (fuente de la verdad)', 'Sistema que refleja'],
          rows: [
            ['Cliente', 'Datos de contacto y oportunidad', 'CRM', 'ERP lee para emitir factura'],
            ['Cliente', 'RUC, régimen fiscal, límite de crédito', 'ERP', 'CRM lee para calificar'],
            ['Producto', 'Nombre comercial y descripción de venta', 'CRM', 'ERP refleja en el catálogo'],
            ['Producto', 'Precio, stock y código fiscal', 'ERP', 'CRM lee para cotizar'],
            ['Pedido', 'Negociación y propuesta', 'CRM', 'ERP recibe al cerrar'],
            ['Pedido', 'Facturación, estado fiscal y pago', 'ERP', 'CRM lee para dar seguimiento'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con la tabla de arriba documentada, cualquier divergencia tiene respuesta objetiva: el ' +
            'valor correcto siempre es el del sistema dueño de ese campo. La reconciliación deja de ' +
            'ser un debate y se vuelve una regla.',
        },
      ],
    },
    {
      title: 'Estrategias de sincronización',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Definido el dueño de cada campo, elige cómo viaja el dato. Tres ejes importan: sentido ' +
            '(one-way o two-way), disparador (batch u orientado a evento) y latencia (periódico o ' +
            'near-real-time).',
        },
        {
          type: 'diagram',
          value:
            'One-way (recomendado por campo):\n' +
            '  CRM ==(contacto, propuesta)==> ERP\n' +
            '  ERP ==(precio, stock, fiscal)==> CRM\n' +
            '\n' +
            'Event-driven near-real-time:\n' +
            '  CRM --webhook--> [Middleware] --upsert--> ERP\n' +
            '  ERP --webhook--> [Middleware] --upsert--> CRM\n' +
            '                       |\n' +
            '                 mapping table\n' +
            '\n' +
            'Batch (respaldo nocturno):\n' +
            '  [Job 02:00] --lee delta--> compara --> aplica diferencias',
        },
        {
          type: 'list',
          items: [
            'One-way por campo: cada campo fluye en un solo sentido desde su dueño. Simple, previsible y evita bucles de sobrescritura.',
            'Two-way: solo cuando los dos sistemas deben editar la misma entidad. Exige una regla de conflicto explícita, nunca improvises.',
            'Batch: job periódico que lee un delta y aplica diferencias. Barato y tolerante a fallos, pero con retraso de minutos a horas.',
            'Event-driven via webhook: el sistema dueño emite un evento al cambiar y el middleware propaga en segundos, near-real-time.',
            'Patrón práctico: event-driven para el flujo principal y un batch nocturno de reconciliación como red de seguridad.',
          ],
        },
      ],
    },
    {
      title: 'Clave de correlación e idempotencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para nunca duplicar, cada entidad necesita una clave que enlace el registro del CRM con ' +
            'el del ERP. Guarda ese vínculo en una mapping table: external_id de un lado, external_id ' +
            'del otro. Toda escritura se vuelve un upsert por esa clave, no un insert ciego. Así, ' +
            'reprocesar el mismo evento diez veces produce el mismo resultado: idempotencia.',
        },
        {
          type: 'list',
          items: [
            'Mapping table: tabla que relaciona crm_id, erp_id y la clave natural (RUC, SKU) para resolver el par sin ambigüedad.',
            'Clave natural: cuando aún no hay mapping, casa por el RUC del cliente o el SKU del producto, normalizados antes de comparar.',
            'Upsert por clave: inserta si no existe, actualiza si existe. Nunca un insert directo que cree un duplicado en el reintento.',
            'Idempotencia: el mismo mensaje aplicado N veces deja el sistema en el mismo estado, esencial porque el webhook reenvía.',
          ],
        },
        {
          type: 'code',
          value: `// sync-customer.js
// Upsert idempotente de cliente entre CRM y ERP usando mapping table.
// Corre en el middleware al recibir un evento "customer.updated" del CRM.

async function syncCustomerFromCrm(event) {
  const crmId = event.data.id;
  const ruc = normalizeRuc(event.data.ruc); // quita puntuacion, valida

  // 1. Resuelve el par via mapping table; cae a la clave natural si no hay vinculo
  let mapping = await db.mapping.findOne({ crm_id: crmId });
  if (!mapping) {
    const erp = await erpApi.findCustomerByRuc(ruc);
    if (erp) {
      // El cliente ya existe en el ERP, solo faltaba el vinculo: no duplica
      mapping = await db.mapping.upsert({ crm_id: crmId, erp_id: erp.id, ruc });
    }
  }

  // 2. Arma solo los campos que el CRM posee (contacto y propuesta)
  const payload = {
    nombre: event.data.nombre,
    email: event.data.email,
    telefono: event.data.telefono,
  };

  // 3. Upsert idempotente: clave de negocio = erp_id (si existe) o RUC
  const erpCustomer = await erpApi.upsertCustomer({
    matchBy: mapping?.erp_id ? { id: mapping.erp_id } : { ruc },
    data: payload,
    // dedupeKey garantiza que reprocesar el mismo evento no genere efecto doble
    dedupeKey: \`crm:\${crmId}:\${event.version}\`,
  });

  // 4. Persiste/actualiza el vinculo para la proxima sincronizacion
  await db.mapping.upsert({ crm_id: crmId, erp_id: erpCustomer.id, ruc });
  return erpCustomer.id;
}`,
        },
        {
          type: 'paragraph',
          value:
            'Observa que el código nunca hace un insert directo: resuelve el par antes, casa por RUC ' +
            'cuando el vínculo aún no existe y usa un dedupeKey basado en la versión del evento. Ese ' +
            'trío (mapping, clave natural y dedupe) es lo que mata el duplicado en el origen.',
        },
      ],
    },
    {
      title: 'Reconciliación y detección de divergencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aún con sincronización en tiempo real, los eventos se pierden: un webhook que falló, un ' +
            'deploy en medio de un lote, un registro editado directo en la base. Por eso un job de ' +
            'reconciliación periódico es obligatorio. Compara ambos lados, alerta lo que divergió y, ' +
            'cuando es seguro, corrige solo.',
        },
        {
          type: 'ordered',
          items: [
            'Selecciona el conjunto a comparar: todos los clientes activos con actividad en las últimas 24 horas, por ejemplo.',
            'Para cada registro, resuelve el par por la mapping table y obtiene el estado actual en los dos sistemas.',
            'Compara solo los campos con dueño definido, normalizando antes (RUC sin puntuación, texto en una sola caja).',
            'Clasifica la divergencia: ausente de un lado, valor diferente o par roto (mapping sin correspondiente).',
            'Para un campo con dueño claro, reaplica el valor del dueño via upsert idempotente y registra la corrección.',
            'Para los casos ambiguos, genera una alerta y envíalo a la cola de revisión humana en vez de adivinar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Registra cada reconciliación con el conteo de divergencias encontradas y corregidas. Si ' +
            'ese número empieza a subir, es señal de que el flujo event-driven está perdiendo eventos ' +
            'y merece investigación antes de volverse incidente.',
        },
      ],
    },
    {
      title: 'Manejo de conflicto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El conflicto ocurre cuando los dos sistemas cambian el mismo campo antes de ' +
            'sincronizar. La fuente de la verdad por campo elimina la mayoría de los casos, pero en ' +
            'un flujo two-way necesitas una política explícita. Elige según el riesgo del campo.',
        },
        {
          type: 'list',
          items: [
            'Last-write-wins: gana la escritura más reciente por timestamp. Simple, bueno para campos de bajo riesgo como una nota libre.',
            'Resolución campo a campo: cada campo sigue a su dueño incluso en two-way, ignorando el cambio del lado que no manda en ese campo.',
            'Cola de revisión humana: campos críticos (límite de crédito, régimen fiscal) paran en una cola y un humano decide, sin autocorrección.',
            'Versionado optimista: cada registro lleva una versión; una escritura con versión desfasada se rechaza y se reencola para reevaluar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regla general: cuanto mayor sea el impacto financiero o fiscal del campo, menos ' +
            'automática debe ser la resolución. Una nota comercial puede ser last-write-wins; un ' +
            'límite de crédito merece revisión humana.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo sincronizar todo en ambos sentidos para asegurarme de que nada falte?',
      answer:
        'No es recomendable. Two-way en todos los campos crea bucles de sobrescritura y conflictos ' +
        'constantes: el CRM escribe, el ERP lo devuelve, y los dos quedan parpadeando. Define el ' +
        'dueño por campo y deja la mayoría de los flujos en one-way. Reserva el two-way solo para ' +
        'las pocas entidades que ambos sistemas realmente necesitan editar, siempre con una regla ' +
        'de conflicto explícita.',
    },
    {
      question: '¿Qué uso como clave de correlación si los IDs de los dos sistemas son distintos?',
      answer:
        'Usa una mapping table que guarda crm_id, erp_id y una clave natural estable, como el RUC ' +
        'para el cliente o el SKU para el producto. En el primer encuentro casas por la clave ' +
        'natural normalizada y grabas el vínculo; en las siguientes resuelves directo por el ' +
        'mapping. Así los IDs internos pueden ser distintos sin jamás generar un duplicado.',
    },
    {
      question: '¿Por qué necesito reconciliación si ya tengo sincronización via webhook?',
      answer:
        'Porque el webhook falla. Una entrega perdida, un timeout, un deploy en medio de un lote o ' +
        'una edición directa en la base dejan los dos lados fuera de sincronía sin que nadie lo ' +
        'note. El job de reconciliación es la red de seguridad: compara periódicamente, alerta ' +
        'divergencias y corrige lo que tiene dueño claro. El webhook entrega velocidad; la ' +
        'reconciliación entrega confianza.',
    },
  ],
  conclusion: {
    title: 'El dato entra una vez y nunca más',
    description:
      'Integrar ERP y CRM sin retrabajo no depende de más herramientas, depende de tres ' +
      'decisiones: definir la fuente de la verdad por campo, conectar los sistemas con upsert ' +
      'idempotente sobre una mapping table y cerrar la cuenta con reconciliación periódica. Con eso ' +
      'el cliente entra una sola vez, el reporte cuadra y nadie reescribe fichas a mano. Puedo ' +
      'ayudarte a diseñar esta integración en tu operación.',
    cta: 'Hablar sobre integrar mi ERP y CRM',
  },
  related: [
    { label: 'Pruebas de contrato para webhooks y APIs', to: '/blog/testes-contrato-webhooks-apis' },
    { label: 'Monitoreo y alertas en integraciones', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Hablemos', to: '/contato' },
  ],
  repo: {
    name: 'erp-crm-sync-patterns',
    description:
      'Patrones de sincronización entre ERP y CRM: fuente de la verdad por campo, mapping table, ' +
      'upsert idempotente y un job de reconciliación con detección de divergencia.',
    url: 'https://github.com/joaosouz4dev/erp-crm-sync-patterns',
  },
};

export default { pt, en, es };
