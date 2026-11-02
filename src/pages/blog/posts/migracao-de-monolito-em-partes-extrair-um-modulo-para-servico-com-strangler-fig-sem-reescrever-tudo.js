// Conteudo do artigo: migracao de monolito em partes com strangler fig. Por que a reescrita total
// falha, como escolher o primeiro modulo, criar uma costura unica dentro do monolito, comparar a
// implementacao nova em sombra, cortar o trafego por tenant, transferir a posse dos dados sem copiar
// tabelas e, por fim, apagar o codigo antigo sem criar um monolito distribuido.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const mapearCode = `-- Quem toca as tabelas de faturamento hoje, e quantas vezes. Exige pg_stat_statements.
SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 140) AS consulta,
       calls,
       round(mean_exec_time::numeric, 2) AS media_ms
  FROM pg_stat_statements
 WHERE query ILIKE ANY (ARRAY['%faturas%', '%itens_fatura%', '%pagamentos%'])
 ORDER BY calls DESC
 LIMIT 30;

-- Chaves estrangeiras que cruzam a fronteira: cada uma vira uma decisao de contrato.
SELECT conrelid::regclass  AS tabela,
       confrelid::regclass AS referencia,
       conname
  FROM pg_constraint
 WHERE contype = 'f'
   AND (conrelid::regclass::text IN ('faturas', 'itens_fatura', 'pagamentos')
        OR confrelid::regclass::text IN ('faturas', 'itens_fatura', 'pagamentos'));`;

const costuraCode = `// faturamento/porta.js - unico ponto pelo qual o resto do monolito fala com faturamento.
import * as local from './local.js';
import { criarClienteRemoto } from './remoto.js';
import { flags } from '../config/flags.js';

const remoto = criarClienteRemoto({
  baseUrl: process.env.FATURAMENTO_URL,
  timeoutMs: 800,
});

const implementacaoPara = (tenantId) =>
  flags.ativo('faturamento-remoto', { tenantId }) ? remoto : local;

export const faturamento = {
  emitirFatura: (tenantId, pedido) => implementacaoPara(tenantId).emitirFatura(tenantId, pedido),
  buscarFatura: (tenantId, faturaId) => implementacaoPara(tenantId).buscarFatura(tenantId, faturaId),
  listarEmAberto: (tenantId, clienteId) =>
    implementacaoPara(tenantId).listarEmAberto(tenantId, clienteId),
};

// faturamento/remoto.js - mesma interface de local.js, falando HTTP com o servico novo.
export function criarClienteRemoto({ baseUrl, timeoutMs }) {
  async function chamar(caminho, { method = 'GET', body, idempotencyKey } = {}) {
    const resposta = await fetch(new URL(caminho, baseUrl), {
      method,
      headers: {
        'content-type': 'application/json',
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (resposta.status === 404) return null;
    if (!resposta.ok) throw new Error(\`faturamento respondeu \${resposta.status} em \${caminho}\`);
    return resposta.json();
  }

  return {
    emitirFatura: (tenantId, pedido) =>
      chamar(\`/tenants/\${tenantId}/faturas\`, {
        method: 'POST',
        body: pedido,
        idempotencyKey: \`pedido-\${pedido.id}\`,
      }),
    buscarFatura: (tenantId, faturaId) => chamar(\`/tenants/\${tenantId}/faturas/\${faturaId}\`),
    listarEmAberto: (tenantId, clienteId) =>
      chamar(\`/tenants/\${tenantId}/clientes/\${clienteId}/faturas?status=aberta\`),
  };
}`;

const sombraCode = `// faturamento/sombra.js - responde com a implementacao antiga e compara a nova em segundo plano.
// So leituras passam pela sombra: duplicar escrita duplicaria cobranca.
import * as local from './local.js';

const CAMPOS = ['status', 'total_centavos', 'vencimento', 'cliente_id'];

const normalizar = (valor) =>
  valor instanceof Date ? valor.toISOString().slice(0, 10) : String(valor ?? '');

function compararCampos(antigo, novo) {
  if (!antigo || !novo) {
    return Boolean(antigo) === Boolean(novo)
      ? []
      : [{ campo: '*', antigo: Boolean(antigo), novo: Boolean(novo) }];
  }
  return CAMPOS.filter((campo) => normalizar(antigo[campo]) !== normalizar(novo[campo])).map(
    (campo) => ({ campo, antigo: antigo[campo], novo: novo[campo] }),
  );
}

export function comSombra(remoto, { amostra = 0.1, registrar }) {
  return {
    ...local,
    async buscarFatura(tenantId, faturaId) {
      const atual = await local.buscarFatura(tenantId, faturaId);
      if (Math.random() < amostra) {
        remoto
          .buscarFatura(tenantId, faturaId)
          .then((novo) => {
            const diferencas = compararCampos(atual, novo);
            if (diferencas.length) registrar({ tenantId, faturaId, diferencas });
          })
          .catch((erro) => registrar({ tenantId, faturaId, erro: erro.message }));
      }
      return atual;
    },
  };
}`;

const posseCode = `-- Transferir a posse sem copiar dados: schema proprio no mesmo banco, papeis separados
-- e views somente leitura para o codigo antigo que ainda consulta as tabelas.
SET lock_timeout = '2s';

BEGIN;
CREATE SCHEMA faturamento;
ALTER TABLE public.faturas      SET SCHEMA faturamento;
ALTER TABLE public.itens_fatura SET SCHEMA faturamento;
ALTER TABLE public.pagamentos   SET SCHEMA faturamento;

-- O monolito continua lendo public.faturas, mas so o que precisa e so lendo.
CREATE VIEW public.faturas AS
  SELECT id, tenant_id, pedido_id, cliente_id, status, total_centavos, vencimento, criado_em
    FROM faturamento.faturas;
COMMIT;

-- O servico e o unico que escreve.
GRANT USAGE ON SCHEMA faturamento TO svc_faturamento;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA faturamento TO svc_faturamento;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA faturamento TO svc_faturamento;

-- O monolito perde a escrita: qualquer INSERT esquecido falha em teste, nao em producao.
REVOKE ALL ON ALL TABLES IN SCHEMA faturamento FROM app_monolito;
REVOKE ALL ON public.faturas FROM app_monolito;
GRANT SELECT ON public.faturas TO app_monolito;`;

const diagramaPt = `Fases da extracao do faturamento (cada fase e reversivel ate a seguinte)

  1. Costura   rotas do monolito --> porta.js --> local.js --> tabelas em public
  2. Sombra    porta.js --> local.js (responde)
                        \\-> remoto (compara e descarta, 10% das leituras)
  3. Corte     porta.js --flag por tenant--> remoto --> servico faturamento
                        \\-> local.js (recuo imediato: desligar a flag)
  4. Posse     servico --> schema faturamento   |   monolito --> view somente leitura
  5. Remocao   local.js, sombra e views apagados; banco separado so se houver motivo medido`;

const diagramaEn = `Phases of the billing extraction (each phase is reversible until the next one)

  1. Seam      monolith routes --> porta.js --> local.js --> tables in public
  2. Shadow    porta.js --> local.js (answers)
                        \\-> remote (compares and discards, 10% of reads)
  3. Cutover   porta.js --flag per tenant--> remote --> billing service
                        \\-> local.js (instant fallback: turn the flag off)
  4. Ownership service --> faturamento schema   |   monolith --> read-only view
  5. Removal   local.js, shadow and views deleted; separate database only for a measured reason`;

const diagramaEs = `Fases de la extracción de facturación (cada fase es reversible hasta la siguiente)

  1. Costura   rutas del monolito --> porta.js --> local.js --> tablas en public
  2. Sombra    porta.js --> local.js (responde)
                        \\-> remoto (compara y descarta, 10% de las lecturas)
  3. Corte     porta.js --flag por tenant--> remoto --> servicio de facturación
                        \\-> local.js (retroceso inmediato: apagar la flag)
  4. Propiedad servicio --> schema faturamento   |   monolito --> vista de solo lectura
  5. Remoción  local.js, sombra y vistas eliminados; base separada solo por un motivo medido`;

const pt = {
  intro:
    'Uma plataforma de pedidos B2B roda há seis anos em um monólito Node.js com 410 mil linhas, um deploy de 45 minutos e uma suíte de testes de 38. O time de faturamento precisa lançar regras fiscais toda semana e espera a fila de deploy de 14 pessoas. A primeira tentativa de resolver isso foi reescrever o faturamento do zero em um serviço novo: nove meses depois, a versão nova ainda não emitia as mesmas faturas que a antiga e foi abandonada. Este artigo mostra o caminho que funcionou na segunda vez, em 11 semanas: escolher o módulo pelos dados, criar uma costura única dentro do monólito, comparar o serviço novo em sombra, cortar o tráfego por tenant com recuo imediato, transferir a posse das tabelas sem copiar nada e só então apagar o código antigo.',
  sections: [
    {
      title: 'Por que a reescrita total falha e o que o strangler fig muda',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A reescrita total aposta que é possível reproduzir, de uma vez, o comportamento de um sistema que ninguém documentou por inteiro. O monólito acumula regras que só existem no código: arredondamento de desconto por item, vencimento que pula feriado municipal, fatura que não é emitida para cliente com crédito. A versão nova nasce sem elas, e cada uma é descoberta em produção ou numa homologação que nunca termina. Enquanto isso, o sistema antigo continua mudando, e a reescrita persegue um alvo móvel.',
        },
        {
          type: 'paragraph',
          value:
            'O strangler fig inverte a aposta. Em vez de trocar tudo no fim, o sistema novo cresce ao redor do antigo e assume uma responsabilidade por vez, com o tráfego real decidindo quando cada parte está pronta. O nome vem da figueira que envolve a árvore hospedeira até substituí-la. Na prática, isso exige três coisas: um ponto onde o tráfego pode ser desviado, um jeito de comparar o comportamento antigo com o novo, e a disciplina de remover o antigo assim que ele deixa de ser usado.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Reescrita total', 'Strangler fig'],
          rows: [
            ['Primeiro valor em produção', 'No fim, depois de meses', 'Na primeira fase, em semanas'],
            ['Regras não documentadas', 'Descobertas no corte', 'Descobertas pela comparação em sombra'],
            ['Recuo', 'Voltar o sistema inteiro', 'Desligar uma flag por tenant'],
            ['Sistema antigo durante a obra', 'Congelado ou divergindo', 'Continua evoluindo, por uma costura única'],
            ['Risco de abandono', 'Alto: nada entregue até o fim', 'Baixo: cada fase já entrega valor'],
          ],
        },
      ],
    },
    {
      title: 'Escolher o primeiro módulo pelos dados, não pelo organograma',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro módulo define se a estratégia ganha credibilidade ou vira mais uma iniciativa parada. O critério mais citado, o módulo que mais muda, é necessário mas não suficiente. O que decide a dificuldade é quantas partes do sistema leem e escrevem nas tabelas do módulo, e quantas chaves estrangeiras cruzam a fronteira. Essas duas respostas saem do próprio banco, sem depender da memória de ninguém.',
        },
        {
          type: 'code',
          value: mapearCode,
        },
        {
          type: 'paragraph',
          value:
            'No cenário do artigo, o levantamento comparou três candidatos. Faturamento venceu porque tinha tabelas próprias, poucas escritas de fora e um motivo de negócio claro para deploy independente. Catálogo mudava mais, mas era lido por quase toda consulta do sistema, e extraí-lo primeiro criaria chamadas de rede no caminho de cada página.',
        },
        {
          type: 'table',
          columns: ['Critério', 'Faturamento', 'Notificações', 'Catálogo'],
          rows: [
            ['Tabelas próprias', '3 (faturas, itens_fatura, pagamentos)', '1', '7'],
            ['Pontos de escrita fora do módulo', '4', '0', '19'],
            ['Consultas com JOIN entre módulos', '6', '0', '41'],
            ['Chaves estrangeiras na fronteira', '2', '0', '11'],
            ['Deploys por semana desejados', '5', '1', '3'],
            ['Decisão', 'Primeiro', 'Fácil, mas pouco valor', 'Depois, com cache de leitura'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Notificações seria o módulo mais fácil, e por isso é a escolha comum para "aprender o processo". O problema é que ele não resolve a dor que justificou o projeto, e o time sai da primeira extração sem ter enfrentado dados compartilhados, que é exatamente onde a migração costuma travar.',
        },
      ],
    },
    {
      title: 'A costura: um único ponto de entrada dentro do monólito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de existir qualquer serviço, o monólito precisa parar de falar com o faturamento de 23 lugares diferentes. A primeira entrega é uma porta: um módulo com uma interface pequena, por onde passam todas as chamadas, com a implementação atual movida para trás dela sem mudar comportamento. Essa técnica, chamada branch by abstraction, é o que torna o desvio possível sem tocar nos chamadores de novo.',
        },
        {
          type: 'code',
          value: costuraCode,
        },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem diferença. A decisão de rota é por tenant, não por requisição, para que um mesmo cliente não veja faturas emitidas por dois sistemas no mesmo dia. A chave de idempotência derivada do pedido garante que um retry depois de timeout não emita fatura duplicada, desde que o serviço novo honre o cabeçalho. E o timeout de 800 ms é explícito: uma chamada que antes era uma função local agora pode esperar a rede, e o orçamento de latência da rota precisa contar com isso.',
        },
        {
          type: 'list',
          items: [
            'Um lint que proíbe importar faturamento/local.js fora de faturamento/ impede que a costura vaze de novo.',
            'Os testes existentes passam a rodar contra a porta, e servem depois como contrato da implementação remota.',
            'A interface nasce com as operações que o negócio usa, como emitirFatura e listarEmAberto, e não com o formato das tabelas.',
          ],
        },
      ],
    },
    {
      title: 'Sombra e corte por tenant: deixar o tráfego real decidir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a porta no lugar, o serviço novo pode receber tráfego real sem responder a ninguém. Na fase de sombra, uma amostra das leituras é enviada aos dois lados: o monólito responde ao cliente, e a resposta do serviço novo é comparada campo a campo e descartada. Escritas não entram na sombra, porque executar duas vezes uma emissão de fatura é exatamente o erro que se quer evitar.',
        },
        {
          type: 'code',
          value: sombraCode,
        },
        {
          type: 'paragraph',
          value:
            'Em duas semanas de sombra com 10% das leituras, a comparação encontrou duas regras que a especificação não mencionava. O serviço novo arredondava o desconto no total, e o antigo arredondava por item, gerando diferença de um centavo em 0,4% das faturas com desconto. E o vencimento era calculado em UTC no serviço novo e no fuso do tenant no antigo, o que mudava a data de faturas criadas depois das 21h. Na reescrita abandonada, as duas teriam aparecido como reclamação de cliente.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'ordered',
          items: [
            'Zerar as divergências da sombra por sete dias seguidos, incluindo um fechamento de mês.',
            'Ligar a flag para tenants internos e de teste, com emissão real.',
            'Avançar para 1%, 10%, 50% e 100% dos tenants, com pelo menos dois dias em cada etapa.',
            'Em cada etapa, comparar taxa de erro, p95 da rota de checkout e faturas emitidas por hora contra a etapa anterior.',
            'Manter local.js funcional até a fase de posse: o recuo é desligar a flag, e precisa continuar funcionando.',
          ],
        },
      ],
    },
    {
      title: 'Dados: transferir a posse sem copiar tabelas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'É aqui que a maioria das extrações vira um monólito distribuído. Se o serviço novo tem seu próprio código mas o monólito continua escrevendo nas mesmas tabelas, qualquer mudança de esquema exige deploy coordenado dos dois, e a independência prometida não existe. A regra que resolve é simples de enunciar: cada tabela tem um único dono que escreve, e os outros leem por um contrato.',
        },
        {
          type: 'paragraph',
          value:
            'Isso não exige banco separado no primeiro dia. Mover as tabelas para um schema próprio no mesmo banco, com papéis distintos, já impõe a fronteira e mantém backup, réplicas e transações locais funcionando. O ALTER TABLE SET SCHEMA é uma operação de catálogo, não copia linhas, e as chaves estrangeiras existentes continuam válidas porque referenciam a tabela pelo identificador interno, não pelo nome.',
        },
        {
          type: 'code',
          value: posseCode,
        },
        {
          type: 'paragraph',
          value:
            'As seis consultas com JOIN entre pedidos e faturas foram o trabalho real desta fase. Quatro passaram a ler a view, o que é aceitável enquanto o contrato for só leitura e as colunas expostas forem estáveis. Duas, usadas no relatório de inadimplência, foram reescritas para consumir eventos fatura_emitida e fatura_paga publicados pelo serviço através de um outbox transacional, mantendo uma projeção local no monólito.',
        },
        {
          type: 'table',
          columns: ['Necessidade do monólito', 'Solução', 'Quando usar'],
          rows: [
            ['Ler status de uma fatura no fluxo do pedido', 'Chamada à API do serviço', 'Leitura pontual, tolera 800 ms no pior caso'],
            ['Listar faturas em telas internas', 'View somente leitura com colunas estáveis', 'Transição, enquanto o mesmo banco for compartilhado'],
            ['Relatórios com JOIN e agregação', 'Projeção local alimentada por eventos', 'Consultas pesadas, tolerância a segundos de atraso'],
            ['Criar ou alterar fatura', 'Somente pela API do serviço', 'Sempre: escrita tem um dono só'],
          ],
        },
      ],
    },
    {
      title: 'Remover o antigo e saber quando parar',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A extração só termina quando o código antigo sai do repositório. Enquanto local.js, a sombra e a flag existirem, o monólito carrega duas implementações, e a próxima regra fiscal acaba sendo escrita nas duas. O critério de remoção deve ser objetivo: 100% dos tenants no serviço novo por quatro semanas, nenhum uso da flag para recuo nesse período e nenhuma leitura de faturamento.* pelo papel do monólito, verificável em pg_stat_statements.',
        },
        {
          type: 'ordered',
          items: [
            'Apagar local.js, sombra.js e a flag, deixando a porta como cliente fino da API.',
            'Remover as views à medida que as leituras migram para a API ou para a projeção, uma por vez.',
            'Remover as chaves estrangeiras que cruzam a fronteira e substituir por validação no contrato, quando o banco for separado.',
            'Separar o banco apenas se houver motivo medido: carga concorrente, requisito de isolamento ou ciclo de manutenção diferente.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'No cenário, o deploy do faturamento caiu de 45 para 6 minutos, o time passou a lançar quatro vezes por semana e o p95 do checkout subiu 7 ms pela chamada de rede, valor que ficou dentro do orçamento. O sinal de que é hora de parar de extrair é quando o próximo candidato exige chamadas síncronas em cadeia para responder uma única tela. Nesse ponto, um módulo bem isolado dentro do monólito entrega mais do que outro serviço.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Preciso de um API gateway ou service mesh para aplicar o strangler fig?',
      answer:
        'Não. Para rotas expostas diretamente ao cliente, um proxy reverso que já existe, como Nginx ou o balanceador da nuvem, consegue desviar por caminho. Para chamadas internas, que são a maioria num monólito, o ponto de desvio é a costura no próprio código, com uma flag por tenant. Ferramentas maiores podem ajudar quando houver vários serviços, mas não são pré-requisito para o primeiro.',
    },
    {
      question: 'E as transações que hoje envolvem pedido e fatura no mesmo COMMIT?',
      answer:
        'Elas deixam de ser uma transação única e passam a ser um fluxo com consistência eventual. O pedido é gravado junto com um evento no outbox, o serviço de faturamento consome o evento e emite a fatura com idempotência pela chave do pedido, e falhas são tratadas com compensação ou reprocessamento. Antes de extrair, liste essas transações: se forem muitas e críticas, o módulo talvez não seja o melhor primeiro candidato.',
    },
    {
      question: 'Quanto tempo a fase de sombra deve durar?',
      answer:
        'O suficiente para cobrir os ciclos do negócio, não um número fixo de dias. Para faturamento, isso inclui pelo menos um fechamento de mês, um feriado e o volume de pico. O critério de saída é ter divergência zero por um período contínuo depois da última correção, com cada divergência anterior explicada e coberta por teste.',
    },
  ],
  conclusion: {
    title: 'Extrair um módulo é mover a fronteira dos dados, não copiar código',
    description:
      'A reescrita de nove meses falhou porque tentou reproduzir de uma vez regras que só o tráfego real revela. A extração que funcionou criou uma costura única, comparou o serviço novo em sombra até a divergência zerar, cortou por tenant com recuo de uma flag, transferiu a posse das tabelas para um schema com dono único e só então apagou o código antigo. O resultado foi deploy independente em 11 semanas, sem janela de manutenção e sem fatura errada chegando ao cliente.',
    cta: 'Planejar a extração de um módulo do meu monólito',
  },
  related: [
    {
      label: 'Outbox transacional: gravar no banco e publicar o evento sem perder nenhum dos dois',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Migração de banco sem janela: expandir, migrar e contrair sem derrubar escrita',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Serviço de arquitetura e modernização backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A B2B ordering platform has been running for six years on a Node.js monolith with 410 thousand lines, a 45 minute deploy and a 38 minute test suite. The billing team needs to ship tax rules every week and waits in a deploy queue shared by 14 people. The first attempt to fix this was rewriting billing from scratch as a new service: nine months later, the new version still did not issue the same invoices as the old one and was abandoned. This article shows the path that worked the second time, in 11 weeks: choosing the module by its data, creating a single seam inside the monolith, comparing the new service in shadow mode, cutting traffic over per tenant with instant fallback, transferring ownership of the tables without copying anything and only then deleting the old code.',
  sections: [
    {
      title: 'Why the full rewrite fails and what the strangler fig changes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A full rewrite bets that it is possible to reproduce, all at once, the behavior of a system nobody has fully documented. The monolith accumulates rules that only exist in code: discount rounding per line item, due dates that skip municipal holidays, invoices that are not issued for customers with credit. The new version is born without them, and each one is discovered in production or in a QA phase that never ends. Meanwhile the old system keeps changing, and the rewrite chases a moving target.',
        },
        {
          type: 'paragraph',
          value:
            'The strangler fig inverts the bet. Instead of swapping everything at the end, the new system grows around the old one and takes over one responsibility at a time, with real traffic deciding when each part is ready. The name comes from the fig tree that wraps its host tree until it replaces it. In practice, it requires three things: a point where traffic can be diverted, a way to compare old and new behavior, and the discipline to remove the old code as soon as it stops being used.',
        },
        {
          type: 'table',
          columns: ['Aspect', 'Full rewrite', 'Strangler fig'],
          rows: [
            ['First value in production', 'At the end, after months', 'In the first phase, within weeks'],
            ['Undocumented rules', 'Discovered at cutover', 'Discovered by shadow comparison'],
            ['Rollback', 'Revert the entire system', 'Turn off a flag per tenant'],
            ['Old system during the work', 'Frozen or diverging', 'Keeps evolving, through a single seam'],
            ['Risk of abandonment', 'High: nothing delivered until the end', 'Low: each phase already delivers value'],
          ],
        },
      ],
    },
    {
      title: 'Choosing the first module by its data, not by the org chart',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first module decides whether the strategy gains credibility or becomes another stalled initiative. The most cited criterion, the module that changes the most, is necessary but not sufficient. What determines the difficulty is how many parts of the system read and write the tables of the module, and how many foreign keys cross the boundary. Both answers come from the database itself, without relying on what anyone remembers.',
        },
        {
          type: 'code',
          value: mapearCode,
        },
        {
          type: 'paragraph',
          value:
            'In the scenario of this article, the survey compared three candidates. Billing won because it had its own tables, few writes from outside and a clear business reason for independent deploys. Catalog changed more often, but it was read by almost every query in the system, and extracting it first would put network calls in the path of every page.',
        },
        {
          type: 'table',
          columns: ['Criterion', 'Billing', 'Notifications', 'Catalog'],
          rows: [
            ['Own tables', '3 (faturas, itens_fatura, pagamentos)', '1', '7'],
            ['Write points outside the module', '4', '0', '19'],
            ['Queries with cross-module JOIN', '6', '0', '41'],
            ['Foreign keys on the boundary', '2', '0', '11'],
            ['Desired deploys per week', '5', '1', '3'],
            ['Decision', 'First', 'Easy, but little value', 'Later, with a read cache'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Notifications would be the easiest module, and that is why it is the usual choice to "learn the process". The problem is that it does not solve the pain that justified the project, and the team leaves the first extraction without having faced shared data, which is exactly where migrations tend to stall.',
        },
      ],
    },
    {
      title: 'The seam: a single entry point inside the monolith',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Before any service exists, the monolith has to stop talking to billing from 23 different places. The first deliverable is a port: a module with a small interface through which every call passes, with the current implementation moved behind it without changing behavior. This technique, called branch by abstraction, is what makes the diversion possible without touching the callers again.',
        },
        {
          type: 'code',
          value: costuraCode,
        },
        {
          type: 'paragraph',
          value:
            'Three details make a difference. The routing decision is per tenant, not per request, so the same customer does not see invoices issued by two systems on the same day. The idempotency key derived from the order ensures that a retry after a timeout does not issue a duplicate invoice, as long as the new service honors the header. And the 800 ms timeout is explicit: a call that used to be a local function can now wait on the network, and the route latency budget has to account for it.',
        },
        {
          type: 'list',
          items: [
            'A lint rule that forbids importing faturamento/local.js outside faturamento/ keeps the seam from leaking again.',
            'The existing tests start running against the port, and later serve as the contract for the remote implementation.',
            'The interface is born with the operations the business uses, such as emitirFatura and listarEmAberto, not with the shape of the tables.',
          ],
        },
      ],
    },
    {
      title: 'Shadow mode and per-tenant cutover: letting real traffic decide',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the port in place, the new service can receive real traffic without answering anyone. In the shadow phase, a sample of reads is sent to both sides: the monolith answers the client, and the response from the new service is compared field by field and discarded. Writes do not go through the shadow, because issuing an invoice twice is exactly the mistake we want to avoid.',
        },
        {
          type: 'code',
          value: sombraCode,
        },
        {
          type: 'paragraph',
          value:
            'In two weeks of shadow mode with 10% of reads, the comparison found two rules the specification never mentioned. The new service rounded the discount on the total, while the old one rounded per item, producing a one cent difference in 0.4% of discounted invoices. And the due date was calculated in UTC in the new service and in the tenant time zone in the old one, which shifted the date of invoices created after 9 PM. In the abandoned rewrite, both would have shown up as customer complaints.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'ordered',
          items: [
            'Keep shadow divergences at zero for seven consecutive days, including a month-end close.',
            'Turn the flag on for internal and test tenants, with real invoice issuing.',
            'Move to 1%, 10%, 50% and 100% of tenants, with at least two days at each step.',
            'At each step, compare error rate, checkout route p95 and invoices issued per hour against the previous step.',
            'Keep local.js working until the ownership phase: rollback means turning the flag off, and it has to keep working.',
          ],
        },
      ],
    },
    {
      title: 'Data: transferring ownership without copying tables',
      blocks: [
        {
          type: 'paragraph',
          value:
            'This is where most extractions turn into a distributed monolith. If the new service has its own code but the monolith keeps writing to the same tables, any schema change requires a coordinated deploy of both, and the promised independence does not exist. The rule that solves it is simple to state: each table has a single owner that writes to it, and everyone else reads through a contract.',
        },
        {
          type: 'paragraph',
          value:
            'This does not require a separate database on day one. Moving the tables to their own schema in the same database, with distinct roles, already enforces the boundary and keeps backups, replicas and local transactions working. ALTER TABLE SET SCHEMA is a catalog operation, it does not copy rows, and existing foreign keys stay valid because they reference the table by its internal identifier, not by name.',
        },
        {
          type: 'code',
          value: posseCode,
        },
        {
          type: 'paragraph',
          value:
            'The six queries joining orders and invoices were the real work of this phase. Four started reading from the view, which is acceptable while the contract is read-only and the exposed columns are stable. Two, used in the delinquency report, were rewritten to consume fatura_emitida and fatura_paga events published by the service through a transactional outbox, keeping a local projection in the monolith.',
        },
        {
          type: 'table',
          columns: ['Monolith need', 'Solution', 'When to use'],
          rows: [
            ['Read an invoice status in the order flow', 'Call the service API', 'Point read, tolerates 800 ms in the worst case'],
            ['List invoices on internal screens', 'Read-only view with stable columns', 'Transition, while the same database is shared'],
            ['Reports with JOIN and aggregation', 'Local projection fed by events', 'Heavy queries, tolerance for seconds of lag'],
            ['Create or change an invoice', 'Only through the service API', 'Always: writes have a single owner'],
          ],
        },
      ],
    },
    {
      title: 'Removing the old code and knowing when to stop',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The extraction only ends when the old code leaves the repository. While local.js, the shadow and the flag exist, the monolith carries two implementations, and the next tax rule ends up being written in both. The removal criterion should be objective: 100% of tenants on the new service for four weeks, no use of the flag for rollback in that period and no reads of faturamento.* by the monolith role, verifiable in pg_stat_statements.',
        },
        {
          type: 'ordered',
          items: [
            'Delete local.js, sombra.js and the flag, leaving the port as a thin API client.',
            'Remove the views as reads migrate to the API or to the projection, one at a time.',
            'Drop the foreign keys that cross the boundary and replace them with contract validation, when the database is split.',
            'Split the database only for a measured reason: competing load, isolation requirement or a different maintenance cycle.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the scenario, the billing deploy went from 45 to 6 minutes, the team started shipping four times a week and the checkout p95 rose by 7 ms due to the network call, a value that stayed within budget. The sign that it is time to stop extracting is when the next candidate requires chained synchronous calls to answer a single screen. At that point, a well isolated module inside the monolith delivers more than another service.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do I need an API gateway or a service mesh to apply the strangler fig?',
      answer:
        'No. For routes exposed directly to clients, a reverse proxy you already have, such as Nginx or the cloud load balancer, can divert by path. For internal calls, which are the majority in a monolith, the diversion point is the seam in the code itself, with a flag per tenant. Bigger tools can help once there are several services, but they are not a prerequisite for the first one.',
    },
    {
      question: 'What about transactions that today include order and invoice in the same COMMIT?',
      answer:
        'They stop being a single transaction and become a flow with eventual consistency. The order is written together with an event in the outbox, the billing service consumes the event and issues the invoice idempotently using the order key, and failures are handled with compensation or reprocessing. Before extracting, list these transactions: if they are many and critical, the module may not be the best first candidate.',
    },
    {
      question: 'How long should the shadow phase last?',
      answer:
        'Long enough to cover the business cycles, not a fixed number of days. For billing, that includes at least one month-end close, a holiday and peak volume. The exit criterion is zero divergence for a continuous period after the last fix, with every previous divergence explained and covered by a test.',
    },
  ],
  conclusion: {
    title: 'Extracting a module means moving the data boundary, not copying code',
    description:
      'The nine month rewrite failed because it tried to reproduce at once rules that only real traffic reveals. The extraction that worked created a single seam, compared the new service in shadow mode until divergence reached zero, cut over per tenant with a one-flag rollback, transferred table ownership to a schema with a single owner and only then deleted the old code. The result was independent deploys in 11 weeks, with no maintenance window and no wrong invoice reaching a customer.',
    cta: 'Plan the extraction of a module from my monolith',
  },
  related: [
    {
      label: 'Transactional outbox: writing to the database and publishing the event without losing either one',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Zero downtime database migration: expand, migrate and contract without stopping writes',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Backend architecture and modernization service',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma de pedidos B2B lleva seis años funcionando sobre un monolito Node.js con 410 mil líneas, un deploy de 45 minutos y una suite de pruebas de 38. El equipo de facturación necesita lanzar reglas fiscales cada semana y espera en una cola de deploy compartida por 14 personas. El primer intento de resolverlo fue reescribir la facturación desde cero en un servicio nuevo: nueve meses después, la versión nueva todavía no emitía las mismas facturas que la antigua y fue abandonada. Este artículo muestra el camino que funcionó la segunda vez, en 11 semanas: elegir el módulo por sus datos, crear una costura única dentro del monolito, comparar el servicio nuevo en modo sombra, migrar el tráfico por tenant con retroceso inmediato, transferir la propiedad de las tablas sin copiar nada y solo entonces eliminar el código antiguo.',
  sections: [
    {
      title: 'Por qué la reescritura total fracasa y qué cambia el strangler fig',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La reescritura total apuesta a que es posible reproducir, de una sola vez, el comportamiento de un sistema que nadie documentó por completo. El monolito acumula reglas que solo existen en el código: redondeo del descuento por ítem, vencimientos que saltan feriados municipales, facturas que no se emiten para clientes con crédito. La versión nueva nace sin ellas, y cada una se descubre en producción o en una fase de homologación que nunca termina. Mientras tanto, el sistema antiguo sigue cambiando, y la reescritura persigue un blanco móvil.',
        },
        {
          type: 'paragraph',
          value:
            'El strangler fig invierte la apuesta. En lugar de cambiarlo todo al final, el sistema nuevo crece alrededor del antiguo y asume una responsabilidad a la vez, con el tráfico real decidiendo cuándo cada parte está lista. El nombre viene de la higuera estranguladora que envuelve al árbol huésped hasta reemplazarlo. En la práctica, exige tres cosas: un punto donde el tráfico pueda desviarse, una forma de comparar el comportamiento antiguo con el nuevo, y la disciplina de eliminar lo antiguo en cuanto deja de usarse.',
        },
        {
          type: 'table',
          columns: ['Aspecto', 'Reescritura total', 'Strangler fig'],
          rows: [
            ['Primer valor en producción', 'Al final, después de meses', 'En la primera fase, en semanas'],
            ['Reglas no documentadas', 'Descubiertas en el corte', 'Descubiertas por la comparación en sombra'],
            ['Retroceso', 'Revertir el sistema entero', 'Apagar una flag por tenant'],
            ['Sistema antiguo durante la obra', 'Congelado o divergiendo', 'Sigue evolucionando, por una costura única'],
            ['Riesgo de abandono', 'Alto: nada entregado hasta el final', 'Bajo: cada fase ya entrega valor'],
          ],
        },
      ],
    },
    {
      title: 'Elegir el primer módulo por los datos, no por el organigrama',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer módulo define si la estrategia gana credibilidad o se convierte en otra iniciativa detenida. El criterio más citado, el módulo que más cambia, es necesario pero no suficiente. Lo que decide la dificultad es cuántas partes del sistema leen y escriben en las tablas del módulo, y cuántas claves foráneas cruzan la frontera. Ambas respuestas salen de la propia base de datos, sin depender de la memoria de nadie.',
        },
        {
          type: 'code',
          value: mapearCode,
        },
        {
          type: 'paragraph',
          value:
            'En el escenario del artículo, el relevamiento comparó tres candidatos. Facturación ganó porque tenía tablas propias, pocas escrituras desde fuera y un motivo de negocio claro para deploys independientes. Catálogo cambiaba más, pero lo leía casi toda consulta del sistema, y extraerlo primero pondría llamadas de red en el camino de cada página.',
        },
        {
          type: 'table',
          columns: ['Criterio', 'Facturación', 'Notificaciones', 'Catálogo'],
          rows: [
            ['Tablas propias', '3 (faturas, itens_fatura, pagamentos)', '1', '7'],
            ['Puntos de escritura fuera del módulo', '4', '0', '19'],
            ['Consultas con JOIN entre módulos', '6', '0', '41'],
            ['Claves foráneas en la frontera', '2', '0', '11'],
            ['Deploys por semana deseados', '5', '1', '3'],
            ['Decisión', 'Primero', 'Fácil, pero poco valor', 'Después, con caché de lectura'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Notificaciones sería el módulo más fácil, y por eso es la elección habitual para "aprender el proceso". El problema es que no resuelve el dolor que justificó el proyecto, y el equipo sale de la primera extracción sin haber enfrentado datos compartidos, que es justamente donde la migración suele trabarse.',
        },
      ],
    },
    {
      title: 'La costura: un único punto de entrada dentro del monolito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Antes de que exista cualquier servicio, el monolito tiene que dejar de hablar con facturación desde 23 lugares distintos. La primera entrega es un puerto: un módulo con una interfaz pequeña por donde pasan todas las llamadas, con la implementación actual movida detrás de él sin cambiar el comportamiento. Esta técnica, llamada branch by abstraction, es lo que hace posible el desvío sin volver a tocar a quienes llaman.',
        },
        {
          type: 'code',
          value: costuraCode,
        },
        {
          type: 'paragraph',
          value:
            'Tres detalles marcan la diferencia. La decisión de ruta es por tenant, no por solicitud, para que un mismo cliente no vea facturas emitidas por dos sistemas el mismo día. La clave de idempotencia derivada del pedido garantiza que un reintento después de un timeout no emita una factura duplicada, siempre que el servicio nuevo respete el encabezado. Y el timeout de 800 ms es explícito: una llamada que antes era una función local ahora puede esperar a la red, y el presupuesto de latencia de la ruta debe contemplarlo.',
        },
        {
          type: 'list',
          items: [
            'Una regla de lint que prohíbe importar faturamento/local.js fuera de faturamento/ impide que la costura vuelva a filtrarse.',
            'Las pruebas existentes pasan a ejecutarse contra el puerto, y luego sirven como contrato de la implementación remota.',
            'La interfaz nace con las operaciones que usa el negocio, como emitirFatura y listarEmAberto, y no con la forma de las tablas.',
          ],
        },
      ],
    },
    {
      title: 'Sombra y corte por tenant: dejar que el tráfico real decida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con el puerto en su lugar, el servicio nuevo puede recibir tráfico real sin responderle a nadie. En la fase de sombra, una muestra de las lecturas se envía a ambos lados: el monolito responde al cliente, y la respuesta del servicio nuevo se compara campo por campo y se descarta. Las escrituras no pasan por la sombra, porque ejecutar dos veces la emisión de una factura es exactamente el error que se quiere evitar.',
        },
        {
          type: 'code',
          value: sombraCode,
        },
        {
          type: 'paragraph',
          value:
            'En dos semanas de sombra con el 10% de las lecturas, la comparación encontró dos reglas que la especificación no mencionaba. El servicio nuevo redondeaba el descuento sobre el total, y el antiguo lo redondeaba por ítem, lo que generaba una diferencia de un centavo en el 0,4% de las facturas con descuento. Y el vencimiento se calculaba en UTC en el servicio nuevo y en la zona horaria del tenant en el antiguo, lo que cambiaba la fecha de las facturas creadas después de las 21 h. En la reescritura abandonada, ambas habrían aparecido como reclamos de clientes.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'ordered',
          items: [
            'Mantener en cero las divergencias de la sombra durante siete días seguidos, incluyendo un cierre de mes.',
            'Encender la flag para tenants internos y de prueba, con emisión real.',
            'Avanzar al 1%, 10%, 50% y 100% de los tenants, con al menos dos días en cada etapa.',
            'En cada etapa, comparar tasa de error, p95 de la ruta de checkout y facturas emitidas por hora contra la etapa anterior.',
            'Mantener local.js funcional hasta la fase de propiedad: el retroceso es apagar la flag, y tiene que seguir funcionando.',
          ],
        },
      ],
    },
    {
      title: 'Datos: transferir la propiedad sin copiar tablas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Aquí es donde la mayoría de las extracciones se convierte en un monolito distribuido. Si el servicio nuevo tiene su propio código pero el monolito sigue escribiendo en las mismas tablas, cualquier cambio de esquema exige un deploy coordinado de ambos, y la independencia prometida no existe. La regla que lo resuelve es simple de enunciar: cada tabla tiene un único dueño que escribe, y los demás leen a través de un contrato.',
        },
        {
          type: 'paragraph',
          value:
            'Esto no exige una base de datos separada desde el primer día. Mover las tablas a un schema propio en la misma base, con roles distintos, ya impone la frontera y mantiene funcionando backups, réplicas y transacciones locales. ALTER TABLE SET SCHEMA es una operación de catálogo, no copia filas, y las claves foráneas existentes siguen siendo válidas porque referencian la tabla por su identificador interno, no por el nombre.',
        },
        {
          type: 'code',
          value: posseCode,
        },
        {
          type: 'paragraph',
          value:
            'Las seis consultas con JOIN entre pedidos y facturas fueron el trabajo real de esta fase. Cuatro pasaron a leer la vista, lo que es aceptable mientras el contrato sea de solo lectura y las columnas expuestas sean estables. Dos, usadas en el reporte de morosidad, se reescribieron para consumir los eventos fatura_emitida y fatura_paga publicados por el servicio a través de un outbox transaccional, manteniendo una proyección local en el monolito.',
        },
        {
          type: 'table',
          columns: ['Necesidad del monolito', 'Solución', 'Cuándo usarla'],
          rows: [
            ['Leer el estado de una factura en el flujo del pedido', 'Llamada a la API del servicio', 'Lectura puntual, tolera 800 ms en el peor caso'],
            ['Listar facturas en pantallas internas', 'Vista de solo lectura con columnas estables', 'Transición, mientras se comparta la misma base'],
            ['Reportes con JOIN y agregación', 'Proyección local alimentada por eventos', 'Consultas pesadas, tolerancia a segundos de retraso'],
            ['Crear o modificar una factura', 'Solo por la API del servicio', 'Siempre: la escritura tiene un único dueño'],
          ],
        },
      ],
    },
    {
      title: 'Eliminar lo antiguo y saber cuándo detenerse',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La extracción solo termina cuando el código antiguo sale del repositorio. Mientras local.js, la sombra y la flag existan, el monolito carga dos implementaciones, y la próxima regla fiscal termina escrita en ambas. El criterio de eliminación debe ser objetivo: el 100% de los tenants en el servicio nuevo durante cuatro semanas, ningún uso de la flag para retroceder en ese período y ninguna lectura de faturamento.* por el rol del monolito, verificable en pg_stat_statements.',
        },
        {
          type: 'ordered',
          items: [
            'Eliminar local.js, sombra.js y la flag, dejando el puerto como un cliente delgado de la API.',
            'Quitar las vistas a medida que las lecturas migran a la API o a la proyección, una por vez.',
            'Eliminar las claves foráneas que cruzan la frontera y reemplazarlas por validación en el contrato, cuando se separe la base.',
            'Separar la base solo si hay un motivo medido: carga concurrente, requisito de aislamiento o ciclo de mantenimiento distinto.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el escenario, el deploy de facturación bajó de 45 a 6 minutos, el equipo pasó a lanzar cuatro veces por semana y el p95 del checkout subió 7 ms por la llamada de red, un valor que quedó dentro del presupuesto. La señal de que es hora de dejar de extraer aparece cuando el próximo candidato exige llamadas síncronas encadenadas para responder una sola pantalla. En ese punto, un módulo bien aislado dentro del monolito entrega más que otro servicio.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Necesito un API gateway o un service mesh para aplicar el strangler fig?',
      answer:
        'No. Para las rutas expuestas directamente al cliente, un proxy inverso que ya exista, como Nginx o el balanceador de la nube, puede desviar por ruta. Para las llamadas internas, que son la mayoría en un monolito, el punto de desvío es la costura en el propio código, con una flag por tenant. Las herramientas más grandes pueden ayudar cuando haya varios servicios, pero no son un requisito para el primero.',
    },
    {
      question: '¿Y las transacciones que hoy incluyen pedido y factura en el mismo COMMIT?',
      answer:
        'Dejan de ser una transacción única y pasan a ser un flujo con consistencia eventual. El pedido se graba junto con un evento en el outbox, el servicio de facturación consume el evento y emite la factura de forma idempotente con la clave del pedido, y las fallas se tratan con compensación o reprocesamiento. Antes de extraer, lista esas transacciones: si son muchas y críticas, quizá el módulo no sea el mejor primer candidato.',
    },
    {
      question: '¿Cuánto tiempo debe durar la fase de sombra?',
      answer:
        'Lo suficiente para cubrir los ciclos del negocio, no un número fijo de días. Para facturación, eso incluye al menos un cierre de mes, un feriado y el volumen pico. El criterio de salida es tener divergencia cero durante un período continuo después de la última corrección, con cada divergencia anterior explicada y cubierta por una prueba.',
    },
  ],
  conclusion: {
    title: 'Extraer un módulo es mover la frontera de los datos, no copiar código',
    description:
      'La reescritura de nueve meses fracasó porque intentó reproducir de una vez reglas que solo el tráfico real revela. La extracción que funcionó creó una costura única, comparó el servicio nuevo en sombra hasta que la divergencia llegó a cero, migró por tenant con un retroceso de una flag, transfirió la propiedad de las tablas a un schema con un único dueño y solo entonces eliminó el código antiguo. El resultado fueron deploys independientes en 11 semanas, sin ventana de mantenimiento y sin ninguna factura incorrecta llegando al cliente.',
    cta: 'Planificar la extracción de un módulo de mi monolito',
  },
  related: [
    {
      label: 'Outbox transaccional: guardar en la base de datos y publicar el evento sin perder ninguno de los dos',
      to: '/blog/outbox-transacional-gravar-no-banco-e-publicar-o-evento-sem-perder-nenhum-dos-dois',
    },
    {
      label: 'Migración de base de datos sin ventana: expandir, migrar y contraer sin detener la escritura',
      to: '/blog/migracao-banco-sem-janela-expandir-migrar-contrair',
    },
    {
      label: 'Servicio de arquitectura y modernización backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
