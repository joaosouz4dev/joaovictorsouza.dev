// Conteudo do artigo: Integracao ERP + CRM sem retrabalho operacional.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections, faq, conclusion, related, repo }.

const pt = {
  intro:
    'O vendedor cadastra o cliente no CRM. O financeiro cadastra o mesmo cliente no ERP. ' +
    'Duas fichas nascem do nada, com CNPJ digitado de jeitos diferentes e endereco divergente. ' +
    'A partir dai todo relatorio mente e alguem gasta a tarde reconciliando planilha. ' +
    'Este guia mostra como ligar ERP e CRM com padroes de sincronizacao, fonte da verdade por ' +
    'entidade e idempotencia, para que o dado entre uma vez e nunca mais precise de cadastro manual.',
  sections: [
    {
      title: 'O problema: dois cadastros do mesmo cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sem integracao, cada area opera sua propria base. O CRM tem o cliente do ponto de ' +
            'vista comercial; o ERP tem o mesmo cliente do ponto de vista fiscal e financeiro. ' +
            'Como ninguem combinou quem cria o registro primeiro, o mesmo cliente aparece duas ' +
            'vezes, com pequenas diferencas: nome com ou sem acento, telefone com ou sem DDD, ' +
            'CNPJ com ou sem pontuacao. O resultado e retrabalho cronico.',
        },
        {
          type: 'list',
          items: [
            'Cadastro em dobro: o mesmo cliente vira dois IDs, um no CRM e outro no ERP, sem ligacao entre eles.',
            'Dado divergente: endereco de cobranca atualizado no ERP nunca chega ao CRM, e o vendedor liga para o lugar errado.',
            'Digitacao manual repetida: alguem reescreve no ERP o que ja existia no CRM, abrindo espaco para erro de digitacao.',
            'Relatorio que nao fecha: faturamento por cliente no ERP nao bate com pipeline no CRM porque sao chaves diferentes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A solucao nao e escolher um sistema e abandonar o outro. E definir regras claras de ' +
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
            'O erro mais comum e tentar sincronizar tudo nos dois sentidos. O caminho saudavel e ' +
            'decidir, campo a campo, qual sistema e o dono. O dono escreve; o outro apenas le e ' +
            'reflete. Isso elimina a briga de quem sobrescreve quem.',
        },
        {
          type: 'table',
          columns: ['Entidade', 'Campo', 'Dono (fonte da verdade)', 'Sistema que reflete'],
          rows: [
            ['Cliente', 'Dados de contato e oportunidade', 'CRM', 'ERP le para emitir nota'],
            ['Cliente', 'CNPJ, regime fiscal, limite de credito', 'ERP', 'CRM le para qualificar'],
            ['Produto', 'Nome comercial e descricao de venda', 'CRM', 'ERP reflete no catalogo'],
            ['Produto', 'Preco, estoque e codigo fiscal', 'ERP', 'CRM le para cotar'],
            ['Pedido', 'Negociacao e proposta', 'CRM', 'ERP recebe ao fechar'],
            ['Pedido', 'Faturamento, status fiscal e pagamento', 'ERP', 'CRM le para acompanhar'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Com a tabela acima documentada, qualquer divergencia tem resposta objetiva: o valor ' +
            'correto e sempre o do sistema dono daquele campo. Reconciliacao deixa de ser debate ' +
            'e vira regra.',
        },
      ],
    },
    {
      title: 'Estrategias de sincronizacao',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Definido o dono de cada campo, escolha como o dado viaja. Tres eixos importam: ' +
            'sentido (one-way ou two-way), gatilho (batch ou orientado a evento) e latencia ' +
            '(periodico ou near-real-time).',
        },
        {
          type: 'diagram',
          value:
            'One-way (recomendado por campo):\n' +
            '  CRM ==(contato, proposta)==> ERP\n' +
            '  ERP ==(preco, estoque, fiscal)==> CRM\n' +
            '\n' +
            'Event-driven near-real-time:\n' +
            '  CRM --webhook--> [Middleware] --upsert--> ERP\n' +
            '  ERP --webhook--> [Middleware] --upsert--> CRM\n' +
            '                       |\n' +
            '                 mapping table\n' +
            '\n' +
            'Batch (fallback noturno):\n' +
            '  [Job 02:00] --le delta--> compara --> aplica diferencas',
        },
        {
          type: 'list',
          items: [
            'One-way por campo: cada campo flui em um unico sentido a partir do seu dono. Simples, previsivel e evita loop de sobrescrita.',
            'Two-way: so quando os dois sistemas precisam editar a mesma entidade. Exige regra de conflito explicita, nunca improvise.',
            'Batch: job periodico que le um delta e aplica diferencas. Barato e tolerante a falha, porem com atraso de minutos a horas.',
            'Event-driven via webhook: o sistema dono emite um evento na mudanca e o middleware propaga em segundos, near-real-time.',
            'Padrao pratico: event-driven para o fluxo principal e um batch noturno de reconciliacao como rede de seguranca.',
          ],
        },
      ],
    },
    {
      title: 'Chave de correlacao e idempotencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para nunca duplicar, cada entidade precisa de uma chave que ligue o registro do CRM ' +
            'ao do ERP. Guarde esse vinculo numa mapping table: external_id de um lado, external_id ' +
            'do outro. Toda escrita vira um upsert por essa chave, nao um insert cego. Assim, ' +
            'reprocessar o mesmo evento dez vezes produz o mesmo resultado: idempotencia.',
        },
        {
          type: 'list',
          items: [
            'Mapping table: tabela que relaciona crm_id, erp_id e a chave natural (CNPJ, SKU) para resolver o par sem ambiguidade.',
            'Chave natural: quando nao ha mapping ainda, casa pelo CNPJ do cliente ou SKU do produto, normalizados antes de comparar.',
            'Upsert por chave: insere se nao existe, atualiza se existe. Nunca um insert direto que cria duplicata em retry.',
            'Idempotencia: a mesma mensagem aplicada N vezes deixa o sistema no mesmo estado, essencial porque webhook reenvia.',
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
            'Repare que o codigo nunca faz insert direto: ele resolve o par antes, casa por CNPJ ' +
            'quando o vinculo ainda nao existe e usa um dedupeKey baseado na versao do evento. ' +
            'Esse trio (mapping, chave natural e dedupe) e o que mata a duplicata na origem.',
        },
      ],
    },
    {
      title: 'Reconciliacao e deteccao de divergencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com sincronizacao em tempo real, eventos se perdem: webhook que falhou, deploy ' +
            'no meio de um lote, registro editado direto no banco. Por isso um job de reconciliacao ' +
            'periodico e obrigatorio. Ele compara os dois lados, alerta o que divergiu e, quando ' +
            'seguro, corrige sozinho.',
        },
        {
          type: 'ordered',
          items: [
            'Selecione o conjunto a comparar: todos os clientes ativos com atividade nas ultimas 24 horas, por exemplo.',
            'Para cada registro, resolva o par pela mapping table e busque o estado atual nos dois sistemas.',
            'Compare apenas os campos que tem dono definido, normalizando antes (CNPJ sem pontuacao, texto em caixa unica).',
            'Classifique a divergencia: ausente de um lado, valor diferente ou par quebrado (mapping sem correspondente).',
            'Para campo com dono claro, reaplique o valor do dono via upsert idempotente e registre a correcao.',
            'Para casos ambiguos, gere um alerta e envie para a fila de revisao humana em vez de adivinhar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Registre cada reconciliacao com contagem de divergencias encontradas e corrigidas. ' +
            'Se esse numero comeca a subir, e sinal de que o fluxo event-driven esta perdendo ' +
            'eventos e merece investigacao antes de virar incidente.',
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
            'A fonte da verdade por campo elimina a maioria dos casos, mas em fluxo two-way voce ' +
            'precisa de uma politica explicita. Escolha conforme o risco do campo.',
        },
        {
          type: 'list',
          items: [
            'Last-write-wins: vence a escrita mais recente por timestamp. Simples, bom para campos de baixo risco como observacao livre.',
            'Resolucao campo-a-campo: cada campo segue seu dono mesmo no two-way, ignorando a alteracao do lado que nao manda naquele campo.',
            'Fila de revisao humana: campos criticos (limite de credito, regime fiscal) param em uma fila e um humano decide, sem auto-correcao.',
            'Versionamento otimista: cada registro carrega uma versao; escrita com versao defasada e rejeitada e reenfileirada para reavaliar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regra geral: quanto maior o impacto financeiro ou fiscal do campo, menos automatica ' +
            'deve ser a resolucao. Observacao comercial pode ser last-write-wins; limite de credito ' +
            'merece revisao humana.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso sincronizar tudo nos dois sentidos para garantir que nada falte?',
      answer:
        'Nao e recomendado. Two-way em todos os campos cria loops de sobrescrita e conflitos ' +
        'constantes: o CRM escreve, o ERP devolve, e os dois ficam piscando. Defina o dono por ' +
        'campo e deixe a maioria dos fluxos one-way. Reserve o two-way apenas para as poucas ' +
        'entidades que os dois sistemas realmente precisam editar, sempre com regra de conflito explicita.',
    },
    {
      question: 'O que uso como chave de correlacao se os IDs dos dois sistemas sao diferentes?',
      answer:
        'Use uma mapping table que guarda crm_id, erp_id e uma chave natural estavel, como CNPJ ' +
        'para cliente ou SKU para produto. No primeiro encontro, voce casa pela chave natural ' +
        'normalizada e grava o vinculo; nas proximas vezes, resolve direto pelo mapping. Assim os ' +
        'IDs internos podem ser diferentes sem nunca gerar duplicata.',
    },
    {
      question: 'Por que preciso de reconciliacao se ja tenho sincronizacao via webhook?',
      answer:
        'Porque webhook falha. Entrega perdida, timeout, deploy no meio de um lote ou edicao ' +
        'direta no banco deixam os dois lados fora de sincronia sem ninguem perceber. O job de ' +
        'reconciliacao e a rede de seguranca: compara periodicamente, alerta divergencias e ' +
        'corrige o que tem dono claro. Webhook entrega velocidade; reconciliacao entrega confianca.',
    },
  ],
  conclusion: {
    title: 'Dado entra uma vez e nunca mais',
    description:
      'Integrar ERP e CRM sem retrabalho nao depende de mais ferramenta, depende de tres ' +
      'decisoes: definir a fonte da verdade por campo, ligar os sistemas com upsert idempotente ' +
      'sobre uma mapping table e fechar a conta com reconciliacao periodica. Com isso o cliente ' +
      'entra uma unica vez, o relatorio fecha e ninguem mais reescreve cadastro a mao. Posso ' +
      'ajudar a desenhar essa integracao na sua operacao.',
    cta: 'Falar sobre integrar meu ERP e CRM',
  },
  related: [
    { label: 'Testes de contrato para webhooks e APIs', to: '/blog/testes-contrato-webhooks-apis' },
    { label: 'Monitoramento e alertas em integracoes', to: '/blog/monitoramento-alertas-integracoes' },
    { label: 'Fale comigo', to: '/contato' },
  ],
  repo: {
    name: 'erp-crm-sync-patterns',
    description:
      'Padroes de sincronizacao entre ERP e CRM: fonte da verdade por campo, mapping table, ' +
      'upsert idempotente e job de reconciliacao com deteccao de divergencia.',
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
    'fichas de la nada, con el RUC escrito de formas distintas y una direccion divergente. A ' +
    'partir de ahi todo reporte miente y alguien pasa la tarde reconciliando una planilla. Esta ' +
    'guia muestra como conectar ERP y CRM con patrones de sincronizacion, fuente de la verdad por ' +
    'entidad e idempotencia, para que el dato entre una vez y nunca mas necesite carga manual.',
  sections: [
    {
      title: 'El problema: dos fichas del mismo cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sin integracion, cada area opera su propia base. El CRM tiene al cliente desde la ' +
            'vista comercial; el ERP tiene al mismo cliente desde la vista fiscal y financiera. ' +
            'Como nadie acordo quien crea el registro primero, el mismo cliente aparece dos veces, ' +
            'con pequenas diferencias: nombre con o sin acento, telefono con o sin codigo de area, ' +
            'RUC con o sin puntuacion. El resultado es retrabajo cronico.',
        },
        {
          type: 'list',
          items: [
            'Ficha duplicada: el mismo cliente se vuelve dos IDs, uno en el CRM y otro en el ERP, sin enlace entre ellos.',
            'Dato divergente: una direccion de cobro actualizada en el ERP nunca llega al CRM, y el vendedor llama al lugar equivocado.',
            'Carga manual repetida: alguien reescribe en el ERP lo que ya existia en el CRM, abriendo espacio a errores de tipeo.',
            'Reportes que no cuadran: la facturacion por cliente en el ERP no coincide con el pipeline del CRM porque son claves distintas.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La solucion no es elegir un sistema y abandonar el otro. Es definir reglas claras de ' +
            'quien manda en cada campo y hacer que los dos conversen sin duplicar.',
        },
      ],
    },
    {
      title: 'Fuente de la verdad por entidad y por campo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error mas comun es intentar sincronizar todo en ambos sentidos. El camino sano es ' +
            'decidir, campo a campo, cual sistema es el dueno. El dueno escribe; el otro solo lee y ' +
            'refleja. Esto elimina la pelea de quien sobrescribe a quien.',
        },
        {
          type: 'table',
          columns: ['Entidad', 'Campo', 'Dueno (fuente de la verdad)', 'Sistema que refleja'],
          rows: [
            ['Cliente', 'Datos de contacto y oportunidad', 'CRM', 'ERP lee para emitir factura'],
            ['Cliente', 'RUC, regimen fiscal, limite de credito', 'ERP', 'CRM lee para calificar'],
            ['Producto', 'Nombre comercial y descripcion de venta', 'CRM', 'ERP refleja en el catalogo'],
            ['Producto', 'Precio, stock y codigo fiscal', 'ERP', 'CRM lee para cotizar'],
            ['Pedido', 'Negociacion y propuesta', 'CRM', 'ERP recibe al cerrar'],
            ['Pedido', 'Facturacion, estado fiscal y pago', 'ERP', 'CRM lee para dar seguimiento'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Con la tabla de arriba documentada, cualquier divergencia tiene respuesta objetiva: el ' +
            'valor correcto siempre es el del sistema dueno de ese campo. La reconciliacion deja de ' +
            'ser un debate y se vuelve una regla.',
        },
      ],
    },
    {
      title: 'Estrategias de sincronizacion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Definido el dueno de cada campo, elige como viaja el dato. Tres ejes importan: sentido ' +
            '(one-way o two-way), disparador (batch u orientado a evento) y latencia (periodico o ' +
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
            'One-way por campo: cada campo fluye en un solo sentido desde su dueno. Simple, previsible y evita bucles de sobrescritura.',
            'Two-way: solo cuando los dos sistemas deben editar la misma entidad. Exige una regla de conflicto explicita, nunca improvises.',
            'Batch: job periodico que lee un delta y aplica diferencias. Barato y tolerante a fallos, pero con retraso de minutos a horas.',
            'Event-driven via webhook: el sistema dueno emite un evento al cambiar y el middleware propaga en segundos, near-real-time.',
            'Patron practico: event-driven para el flujo principal y un batch nocturno de reconciliacion como red de seguridad.',
          ],
        },
      ],
    },
    {
      title: 'Clave de correlacion e idempotencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para nunca duplicar, cada entidad necesita una clave que enlace el registro del CRM con ' +
            'el del ERP. Guarda ese vinculo en una mapping table: external_id de un lado, external_id ' +
            'del otro. Toda escritura se vuelve un upsert por esa clave, no un insert ciego. Asi, ' +
            'reprocesar el mismo evento diez veces produce el mismo resultado: idempotencia.',
        },
        {
          type: 'list',
          items: [
            'Mapping table: tabla que relaciona crm_id, erp_id y la clave natural (RUC, SKU) para resolver el par sin ambiguedad.',
            'Clave natural: cuando aun no hay mapping, casa por el RUC del cliente o el SKU del producto, normalizados antes de comparar.',
            'Upsert por clave: inserta si no existe, actualiza si existe. Nunca un insert directo que cree un duplicado en el reintento.',
            'Idempotencia: el mismo mensaje aplicado N veces deja el sistema en el mismo estado, esencial porque el webhook reenvia.',
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
            'Observa que el codigo nunca hace un insert directo: resuelve el par antes, casa por RUC ' +
            'cuando el vinculo aun no existe y usa un dedupeKey basado en la version del evento. Ese ' +
            'trio (mapping, clave natural y dedupe) es lo que mata el duplicado en el origen.',
        },
      ],
    },
    {
      title: 'Reconciliacion y deteccion de divergencia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aun con sincronizacion en tiempo real, los eventos se pierden: un webhook que fallo, un ' +
            'deploy en medio de un lote, un registro editado directo en la base. Por eso un job de ' +
            'reconciliacion periodico es obligatorio. Compara ambos lados, alerta lo que divergio y, ' +
            'cuando es seguro, corrige solo.',
        },
        {
          type: 'ordered',
          items: [
            'Selecciona el conjunto a comparar: todos los clientes activos con actividad en las ultimas 24 horas, por ejemplo.',
            'Para cada registro, resuelve el par por la mapping table y obtiene el estado actual en los dos sistemas.',
            'Compara solo los campos con dueno definido, normalizando antes (RUC sin puntuacion, texto en una sola caja).',
            'Clasifica la divergencia: ausente de un lado, valor diferente o par roto (mapping sin correspondiente).',
            'Para un campo con dueno claro, reaplica el valor del dueno via upsert idempotente y registra la correccion.',
            'Para los casos ambiguos, genera una alerta y envialo a la cola de revision humana en vez de adivinar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Registra cada reconciliacion con el conteo de divergencias encontradas y corregidas. Si ' +
            'ese numero empieza a subir, es senal de que el flujo event-driven esta perdiendo eventos ' +
            'y merece investigacion antes de volverse incidente.',
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
            'sincronizar. La fuente de la verdad por campo elimina la mayoria de los casos, pero en ' +
            'un flujo two-way necesitas una politica explicita. Elige segun el riesgo del campo.',
        },
        {
          type: 'list',
          items: [
            'Last-write-wins: gana la escritura mas reciente por timestamp. Simple, bueno para campos de bajo riesgo como una nota libre.',
            'Resolucion campo a campo: cada campo sigue a su dueno incluso en two-way, ignorando el cambio del lado que no manda en ese campo.',
            'Cola de revision humana: campos criticos (limite de credito, regimen fiscal) paran en una cola y un humano decide, sin autocorreccion.',
            'Versionado optimista: cada registro lleva una version; una escritura con version desfasada se rechaza y se reencola para reevaluar.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Regla general: cuanto mayor sea el impacto financiero o fiscal del campo, menos ' +
            'automatica debe ser la resolucion. Una nota comercial puede ser last-write-wins; un ' +
            'limite de credito merece revision humana.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Puedo sincronizar todo en ambos sentidos para asegurarme de que nada falte?',
      answer:
        'No es recomendable. Two-way en todos los campos crea bucles de sobrescritura y conflictos ' +
        'constantes: el CRM escribe, el ERP lo devuelve, y los dos quedan parpadeando. Define el ' +
        'dueno por campo y deja la mayoria de los flujos en one-way. Reserva el two-way solo para ' +
        'las pocas entidades que ambos sistemas realmente necesitan editar, siempre con una regla ' +
        'de conflicto explicita.',
    },
    {
      question: 'Que uso como clave de correlacion si los IDs de los dos sistemas son distintos?',
      answer:
        'Usa una mapping table que guarda crm_id, erp_id y una clave natural estable, como el RUC ' +
        'para el cliente o el SKU para el producto. En el primer encuentro casas por la clave ' +
        'natural normalizada y grabas el vinculo; en las siguientes resuelves directo por el ' +
        'mapping. Asi los IDs internos pueden ser distintos sin jamas generar un duplicado.',
    },
    {
      question: 'Por que necesito reconciliacion si ya tengo sincronizacion via webhook?',
      answer:
        'Porque el webhook falla. Una entrega perdida, un timeout, un deploy en medio de un lote o ' +
        'una edicion directa en la base dejan los dos lados fuera de sincronia sin que nadie lo ' +
        'note. El job de reconciliacion es la red de seguridad: compara periodicamente, alerta ' +
        'divergencias y corrige lo que tiene dueno claro. El webhook entrega velocidad; la ' +
        'reconciliacion entrega confianza.',
    },
  ],
  conclusion: {
    title: 'El dato entra una vez y nunca mas',
    description:
      'Integrar ERP y CRM sin retrabajo no depende de mas herramientas, depende de tres ' +
      'decisiones: definir la fuente de la verdad por campo, conectar los sistemas con upsert ' +
      'idempotente sobre una mapping table y cerrar la cuenta con reconciliacion periodica. Con eso ' +
      'el cliente entra una sola vez, el reporte cuadra y nadie reescribe fichas a mano. Puedo ' +
      'ayudarte a disenar esta integracion en tu operacion.',
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
      'Patrones de sincronizacion entre ERP y CRM: fuente de la verdad por campo, mapping table, ' +
      'upsert idempotente y un job de reconciliacion con deteccion de divergencia.',
    url: 'https://github.com/joaosouz4dev/erp-crm-sync-patterns',
  },
};

export default { pt, en, es };
