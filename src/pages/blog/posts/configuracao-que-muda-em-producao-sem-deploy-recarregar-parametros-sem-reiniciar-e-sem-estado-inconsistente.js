// Conteudo do artigo: configuracao que muda em producao sem deploy. Por que ler a
// configuracao campo a campo produz requisicoes que misturam duas versoes, como um
// snapshot imutavel com troca atomica elimina o estado inconsistente, como fixar o
// snapshot por requisicao com AsyncLocalStorage, como recarregar da fonte com validacao
// e ultima versao boa conhecida, como reconstruir componentes que derivam da configuracao
// e como provar em teste que nenhuma requisicao ve duas versoes.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const leituraPorCampoCode = `// cobranca.js (versao com problema)
import { config } from './config-global.js';

export async function cobrar(pedido) {
  // leitura 1: no inicio da requisicao
  if (pedido.valor > config.get('limiteSemRevisao')) {
    await enviarParaRevisao(pedido);
    return { status: 'em_revisao' };
  }

  const resultado = await gateway.cobrar(pedido); // 300 ms de espera

  // leitura 2: depois do await, a configuracao pode ter sido recarregada
  const limite = config.get('limiteSemRevisao');
  await registrarAuditoria({
    pedidoId: pedido.id,
    limiteAplicado: limite, // grava um limite que nao foi o usado na decisao
    revisado: pedido.valor > limite,
  });
  return resultado;
}`;

const configStoreCode = `// config-store.js
import { AsyncLocalStorage } from 'node:async_hooks';

const congelar = (objeto) => {
  for (const valor of Object.values(objeto)) {
    if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) congelar(valor);
  }
  return Object.freeze(objeto);
};

export class ConfigStore {
  #atual;
  #ouvintes = new Set();
  #contexto = new AsyncLocalStorage();

  constructor({ inicial, validar }) {
    this.validar = validar; // (bruto) => config normalizada, ou lanca erro
    this.#atual = congelar({ ...this.validar(inicial), versao: 1 });
  }

  // Snapshot imutavel e completo: um objeto, uma versao, lido uma vez.
  get snapshot() {
    return this.#contexto.getStore() ?? this.#atual;
  }

  // Fixa o snapshot atual para tudo que rodar dentro de fn, inclusive apos awaits.
  fixarPara(fn) {
    return this.#contexto.run(this.#atual, fn);
  }

  // Troca atomica: ou a nova versao inteira passa a valer, ou nada muda.
  aplicar(bruto) {
    const validada = this.validar(bruto); // lanca antes de tocar em #atual
    const anterior = this.#atual;
    this.#atual = congelar({ ...validada, versao: anterior.versao + 1 });
    for (const ouvinte of this.#ouvintes) {
      try {
        ouvinte(this.#atual, anterior);
      } catch (erro) {
        console.error('ouvinte de configuracao falhou', erro);
      }
    }
    return this.#atual;
  }

  aoMudar(ouvinte) {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }
}

// cobranca.js (versao corrigida)
export async function cobrar(pedido, { config }) {
  const { limiteSemRevisao, versao } = config.snapshot; // uma leitura, uma versao
  if (pedido.valor > limiteSemRevisao) {
    await enviarParaRevisao(pedido);
    return { status: 'em_revisao' };
  }
  const resultado = await gateway.cobrar(pedido);
  await registrarAuditoria({
    pedidoId: pedido.id,
    limiteAplicado: limiteSemRevisao,
    configVersao: versao, // a auditoria diz qual versao decidiu
    revisado: false,
  });
  return resultado;
}

// middleware HTTP: cada requisicao enxerga uma unica versao do inicio ao fim
export const comConfigFixa = (config) => (req, res, next) => {
  config.fixarPara(() => {
    res.setHeader('x-config-version', String(config.snapshot.versao));
    next();
  });
};`;

const recarregadorCode = `// recarregador.js
const esquema = {
  limiteSemRevisao: { tipo: 'number', min: 0, max: 1_000_000 },
  timeoutGatewayMs: { tipo: 'number', min: 100, max: 30_000 },
  poolMaxConexoes: { tipo: 'number', min: 1, max: 200 },
  provedorPagamento: { tipo: 'string', valores: ['stripe', 'adyen', 'pagarme'] },
};

export function validarConfig(bruto) {
  const saida = {};
  for (const [chave, regra] of Object.entries(esquema)) {
    const valor = bruto[chave];
    if (typeof valor !== regra.tipo) throw new Error(\`\${chave}: esperado \${regra.tipo}\`);
    if (regra.min !== undefined && valor < regra.min) throw new Error(\`\${chave}: abaixo de \${regra.min}\`);
    if (regra.max !== undefined && valor > regra.max) throw new Error(\`\${chave}: acima de \${regra.max}\`);
    if (regra.valores && !regra.valores.includes(valor)) throw new Error(\`\${chave}: valor invalido\`);
    saida[chave] = valor;
  }
  // regras entre campos: uma config valida campo a campo ainda pode ser incoerente
  if (saida.timeoutGatewayMs < 500 && saida.provedorPagamento === 'adyen') {
    throw new Error('timeoutGatewayMs abaixo de 500 ms nao e compativel com adyen');
  }
  return saida;
}

// Fonte generica: qualquer coisa que devolva { etag, corpo } (SSM, Consul, S3, arquivo)
export function iniciarRecarregador({ fonte, config, intervaloMs = 15_000, metricas }) {
  let etagAtual = null;
  let parado = false;

  const ciclo = async () => {
    if (parado) return;
    try {
      const { etag, corpo } = await fonte.ler({ seDiferenteDe: etagAtual });
      if (etag !== etagAtual) {
        const aplicada = config.aplicar(corpo); // valida e so entao troca
        etagAtual = etag;
        metricas.gauge('config_version', aplicada.versao);
        metricas.gauge('config_last_success_timestamp', Date.now() / 1000);
        console.info('configuracao aplicada', { versao: aplicada.versao, etag });
      }
    } catch (erro) {
      // versao invalida ou fonte fora do ar: a ultima boa conhecida continua valendo
      metricas.counter('config_reload_failures_total').inc();
      console.error('configuracao rejeitada, mantendo a anterior', { erro: erro.message });
    } finally {
      if (!parado) setTimeout(ciclo, intervaloMs).unref();
    }
  };

  ciclo();
  return () => {
    parado = true;
  };
}`;

const reconstruirPoolCode = `// pool-gerenciado.js
import { Pool } from 'pg';

export function criarPoolGerenciado({ config, urlBanco }) {
  let atual = new Pool({ connectionString: urlBanco, max: config.snapshot.poolMaxConexoes });

  config.aoMudar((nova, anterior) => {
    if (nova.poolMaxConexoes === anterior.poolMaxConexoes) return; // nada a reconstruir

    const antigo = atual;
    atual = new Pool({ connectionString: urlBanco, max: nova.poolMaxConexoes });
    // o pool antigo so fecha depois que as consultas em andamento terminarem:
    // pool.end() espera os clientes emprestados voltarem antes de encerrar
    antigo
      .end()
      .then(() => console.info('pool antigo drenado', { versao: anterior.versao }))
      .catch((erro) => console.error('falha ao drenar pool antigo', erro));
  });

  // quem consulta sempre pega o pool atual; uma consulta em voo mantem o seu
  return {
    query: (...args) => atual.query(...args),
    conectar: () => atual.connect(),
  };
}`;

const testeCode = `// config-store.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigStore } from './config-store.js';
import { validarConfig } from './recarregador.js';

const base = {
  limiteSemRevisao: 1000,
  timeoutGatewayMs: 3000,
  poolMaxConexoes: 10,
  provedorPagamento: 'stripe',
};

test('uma requisicao em voo nao enxerga a versao aplicada no meio dela', async () => {
  const config = new ConfigStore({ inicial: base, validar: validarConfig });
  const leituras = [];

  const requisicao = config.fixarPara(async () => {
    leituras.push(config.snapshot.limiteSemRevisao);
    await new Promise((resolver) => setTimeout(resolver, 10)); // simula o await do gateway
    leituras.push(config.snapshot.limiteSemRevisao);
  });

  config.aplicar({ ...base, limiteSemRevisao: 50 }); // chega enquanto a requisicao espera
  await requisicao;

  assert.deepEqual(leituras, [1000, 1000]); // as duas leituras vieram da mesma versao
  assert.equal(config.snapshot.limiteSemRevisao, 50); // fora da requisicao, a nova ja vale
});

test('versao invalida e rejeitada e a anterior continua valendo', () => {
  const config = new ConfigStore({ inicial: base, validar: validarConfig });

  assert.throws(() => config.aplicar({ ...base, poolMaxConexoes: 0 }), /poolMaxConexoes/);
  assert.throws(
    () => config.aplicar({ ...base, provedorPagamento: 'adyen', timeoutGatewayMs: 200 }),
    /adyen/,
  );

  assert.equal(config.snapshot.versao, 1);
  assert.equal(config.snapshot.poolMaxConexoes, 10);
});

test('snapshot e imutavel', () => {
  const config = new ConfigStore({ inicial: base, validar: validarConfig });
  assert.throws(() => {
    'use strict';
    config.snapshot.limiteSemRevisao = 0;
  }, TypeError);
});`;

const diagramaPt = `Serviço de cobrança com limite de revisão manual lido de um parâmetro remoto. Operação baixa o limite de R$ 1.000 para R$ 50 no meio do tráfego.

t=0         pedido 8841 de R$ 300 entra; leitura 1: limite = 1.000; não precisa de revisão
t=0,02 s    chamada ao gateway de pagamento começa (300 ms)
t=0,10 s    recarregador aplica a nova versão: limite = 50
t=0,32 s    gateway confirma a cobrança de R$ 300
t=0,33 s    leitura 2: limite = 50; auditoria grava "revisado = true, limite = 50"
            resultado: pedido cobrado sem revisão, auditoria dizendo que foi revisado
            nenhuma linha errada; duas versões de configuração na mesma requisição`;

const diagramaEn = `Billing service with a manual review threshold read from a remote parameter. Operations lowers the threshold from 1,000 to 50 in the middle of traffic.

t=0         order 8841 worth 300 comes in; read 1: threshold = 1,000; no review needed
t=0.02 s    call to the payment gateway starts (300 ms)
t=0.10 s    the reloader applies the new version: threshold = 50
t=0.32 s    the gateway confirms the 300 charge
t=0.33 s    read 2: threshold = 50; audit log records "reviewed = true, threshold = 50"
            outcome: order charged without review, audit log saying it was reviewed
            no wrong line of code; two configuration versions inside one request`;

const diagramaEs = `Servicio de cobros con un umbral de revisión manual leído de un parámetro remoto. Operaciones baja el umbral de 1.000 a 50 en medio del tráfico.

t=0         el pedido 8841 de 300 entra; lectura 1: umbral = 1.000; no necesita revisión
t=0,02 s    empieza la llamada a la pasarela de pago (300 ms)
t=0,10 s    el recargador aplica la nueva versión: umbral = 50
t=0,32 s    la pasarela confirma el cobro de 300
t=0,33 s    lectura 2: umbral = 50; la auditoría registra "revisado = true, umbral = 50"
            resultado: pedido cobrado sin revisión, auditoría diciendo que fue revisado
            ninguna línea incorrecta; dos versiones de configuración en la misma petición`;

const pt = {
  intro:
    'Um limite de cobrança, um timeout, o tamanho de um pool, o provedor ativo de pagamento: parâmetros assim mudam com frequência muito maior do que o código, e exigir um deploy para cada ajuste transforma operação em fila de espera. A alternativa de recarregar em tempo de execução parece simples até a primeira requisição que lê o parâmetro duas vezes e recebe dois valores diferentes, ou até a instância que aplica uma versão quebrada e passa a recusar tudo. Este artigo mostra por que a leitura campo a campo produz estado inconsistente, como um snapshot imutável com troca atômica elimina o problema, como fixar o snapshot por requisição com AsyncLocalStorage, como recarregar da fonte com validação e última versão boa conhecida, como reconstruir componentes que derivam da configuração sem derrubar o que está em voo e como provar em teste que nenhuma requisição vê duas versões.',
  sections: [
    {
      title: 'O que muda sem deploy e por que reiniciar não é resposta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em um serviço de cobrança, o código muda algumas vezes por semana; o limite acima do qual um pedido vai para revisão manual muda algumas vezes por dia, conforme a fraude do momento. Tratar os dois com o mesmo processo cria um problema de ritmo: a operação precisa de um ajuste em minutos e recebe um pipeline de quarenta. A primeira solução que aparece é reiniciar o processo com a variável de ambiente nova, o que resolve a consistência, porque o processo nasce inteiro com a versão nova, mas custa um rolling restart por ajuste, com drenagem de conexões, aquecimento de cache e janela de capacidade reduzida. Em uma frota de trinta instâncias, dez ajustes por dia viram trezentos reinícios.',
        },
        {
          type: 'table',
          columns: ['Tipo de parâmetro', 'Frequência de mudança', 'Custo de um valor errado', 'Precisa de reinício?'],
          rows: [
            [
              'Limites de negócio (valor para revisão, cota por cliente)',
              'Diária',
              'Cobrança indevida ou fraude liberada',
              'Não: lido por requisição',
            ],
            [
              'Timeouts e tentativas de dependências',
              'Semanal, e a cada incidente',
              'Cascata de lentidão ou desistência precoce',
              'Não: lido por chamada',
            ],
            [
              'Tamanho de pool e limites de concorrência',
              'Mensal',
              'Esgotamento ou subutilização do banco',
              'Não, se o componente for reconstruído',
            ],
            [
              'Endpoint ou provedor ativo',
              'Rara, e em emergência',
              'Tráfego indo para o provedor errado',
              'Não, com cliente reconstruído',
            ],
            [
              'Porta de escuta, modo de cluster, flags do runtime',
              'Rara',
              'Processo não sobe',
              'Sim: faz parte da inicialização',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'As quatro primeiras linhas justificam recarregar em tempo de execução. A última lembra que nem tudo deve ser recarregável: parâmetros consumidos uma única vez na inicialização continuam exigindo reinício, e fingir o contrário gera uma configuração que diz uma coisa enquanto o processo faz outra.',
        },
      ],
    },
    {
      title: 'A leitura campo a campo é o que cria o estado inconsistente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O primeiro recarregador que se escreve é um objeto global com um método get por chave, atualizado por um temporizador. Funciona enquanto cada requisição lê cada parâmetro uma única vez. Deixa de funcionar quando a mesma chave é lida duas vezes com um await entre elas, ou quando duas chaves que só fazem sentido juntas, como provedor e timeout, são lidas em momentos diferentes. A requisição passa a enxergar uma mistura de versões que nunca existiu em lugar nenhum.',
        },
        { type: 'code', value: leituraPorCampoCode },
        { type: 'diagram', value: diagramaPt },
        {
          type: 'paragraph',
          value:
            'A linha de tempo mostra o pior tipo de defeito: nenhum erro, nenhum log de exceção, e um registro de auditoria que afirma algo falso. O mesmo padrão aparece quando um retry lê o timeout de novo e passa a esperar um valor diferente do que a primeira tentativa esperou, ou quando o provedor muda entre a autorização e a captura. Não é um bug da lógica de negócio. É a ausência de uma unidade de consistência: a requisição precisa de uma versão só, do começo ao fim.',
        },
      ],
    },
    {
      title: 'Snapshot imutável, troca atômica e fixação por requisição',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção tem três partes. A configuração deixa de ser um conjunto de chaves e vira um objeto único, congelado e numerado: um snapshot. Recarregar não altera campos; produz um novo snapshot e troca a referência em uma atribuição, que em JavaScript é atômica por natureza do modelo de execução. E cada requisição fixa a referência que estava valendo quando ela começou, de modo que qualquer leitura dentro dela, antes ou depois de um await, cai no mesmo objeto. Em Node.js, AsyncLocalStorage carrega esse snapshot por toda a cadeia assíncrona sem precisar passá-lo como argumento em cada função.',
        },
        { type: 'code', value: configStoreCode },
        {
          type: 'paragraph',
          value:
            'Três detalhes fazem diferença. O congelamento profundo garante que ninguém altera o snapshot no lugar e cria uma versão intermediária que só aquela instância vê. A versão incremental vai para o cabeçalho de resposta, para o log e para a auditoria, e com isso um pedido estranho de ontem pode ser lido junto da configuração que de fato o decidiu. E o ouvinte que falha não impede a troca: a nova versão já está valendo quando os ouvintes rodam, e o erro de um deles vira log, não rollback parcial.',
        },
        {
          type: 'paragraph',
          value:
            'Trabalhos de longa duração seguem a mesma regra com uma nuance: um job que roda por vinte minutos fixa o snapshot no início de cada unidade de trabalho, como cada lote de mil linhas, e não no início do job inteiro. Assim a mudança de configuração entra entre lotes, nunca no meio de um, e o job não fica preso a uma versão de vinte minutos atrás.',
        },
      ],
    },
    {
      title: 'Recarregar da fonte: validar antes, manter a última boa conhecida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A fonte pode ser o Parameter Store, o Consul, um objeto no S3 ou um arquivo montado por ConfigMap. Para o recarregador, tudo isso é uma função que devolve um corpo e um identificador de versão, como ETag ou número de revisão, para que o ciclo não reaplique a mesma configuração a cada intervalo. O ponto que não pode faltar é a validação completa antes de aplicar: tipo, faixa, valores permitidos e regras entre campos. Uma versão que passa por campo mas é incoerente como conjunto, como um timeout de 200 ms para um provedor que nunca responde abaixo de 500 ms, precisa ser rejeitada inteira.',
        },
        { type: 'code', value: recarregadorCode },
        {
          type: 'paragraph',
          value:
            'Quando a validação falha, ou a fonte está fora do ar, o processo continua com a última versão boa conhecida e sobe um contador. É a diferença entre uma mudança errada que afeta ninguém e uma que derruba a frota. Em uma instância recém-iniciada o mesmo princípio vale com um complemento: o processo deve subir com um snapshot válido, vindo da fonte ou de uma cópia local gravada na última aplicação bem-sucedida, e só então começar a aceitar tráfego. Subir com valores padrão silenciosos porque a fonte demorou é a forma mais comum de ter uma instância diferente das outras sem ninguém perceber.',
        },
        {
          type: 'table',
          columns: ['Mecanismo de detecção', 'Latência até aplicar', 'Carga na fonte', 'Quando usar'],
          rows: [
            [
              'Polling com ETag ou revisão',
              'Até um intervalo (15 a 60 s)',
              'Uma leitura condicional por instância por intervalo',
              'Padrão: simples, previsível, funciona com qualquer fonte',
            ],
            [
              'Watch ou stream (etcd, Consul, SSE)',
              'Segundos',
              'Uma conexão aberta por instância',
              'Quando a latência de minutos não serve, como kill switch',
            ],
            [
              'Sinal SIGHUP com arquivo local',
              'Imediata, manual',
              'Nenhuma',
              'Processo único ou poucos hosts com orquestração própria',
            ],
            [
              'Push por fila ou webhook',
              'Segundos',
              'Mensagem por mudança',
              'Quando já existe fila; exige polling de segurança para instâncias que perderam a mensagem',
            ],
          ],
        },
      ],
    },
    {
      title: 'Componentes que guardam estado derivado da configuração',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um limite lido por requisição muda sozinho quando o snapshot muda. Um pool de conexões, um cliente HTTP com keep-alive, um rate limiter com janela em memória e um temporizador já criado não mudam: eles leram a configuração uma vez na construção e guardaram o resultado. Para esses componentes, recarregar significa reconstruir, e reconstruir sem derrubar o que está em voo significa criar o novo antes de encerrar o antigo e deixar o antigo drenar no próprio ritmo.',
        },
        { type: 'code', value: reconstruirPoolCode },
        {
          type: 'table',
          columns: ['Componente', 'Estratégia', 'Cuidado'],
          rows: [
            [
              'Limites, timeouts, chaves de decisão',
              'Ler do snapshot a cada uso',
              'Ler uma vez por requisição, nunca por campo em momentos diferentes',
            ],
            [
              'Pool de conexões, cliente HTTP',
              'Criar o novo, trocar a referência, drenar o antigo',
              'Garantir que o antigo fecha de verdade; dois pools cheios dobram as conexões no banco',
            ],
            [
              'Rate limiter, cache em memória',
              'Reconstruir com os limites novos; aceitar perder a janela corrente',
              'Durante a troca há um instante sem histórico; documentar que é esperado',
            ],
            [
              'Temporizadores e agendamentos',
              'Cancelar o antigo e registrar o novo no ouvinte',
              'Intervalo em voo termina com o valor antigo; a próxima execução usa o novo',
            ],
            [
              'Porta, modo de cluster, flags de runtime',
              'Marcar como somente inicialização',
              'Rejeitar a mudança no validador em vez de aceitá-la e ignorá-la',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha é a que evita a confusão mais cara: um parâmetro que o validador aceita mas o processo nunca aplica. Se um campo só tem efeito na inicialização, o validador deve recusar a mudança em tempo de execução com uma mensagem explícita, para que a operação saiba que aquele ajuste exige deploy.',
        },
      ],
    },
    {
      title: 'Operar e provar: versão visível, rollout gradual e o teste da requisição em voo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma configuração que muda sem deploy precisa da mesma rastreabilidade de um deploy. Isso quer dizer versão no log de cada requisição, no cabeçalho de resposta e numa métrica por instância: um gráfico de config_version por réplica mostra em segundos se uma instância ficou presa numa versão antiga porque a fonte falhou só para ela. Vale também o rollout gradual: aplicar uma mudança a uma fração da frota primeiro, por chave de instância ou por percentual, e só então ao restante. E vale um caminho de reversão que não dependa da fonte estar saudável: a última versão boa conhecida gravada localmente serve de ponto de retorno.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'O primeiro teste é o que importa: uma requisição em voo lê o mesmo valor antes e depois de um await, mesmo com uma versão nova aplicada no meio, enquanto o código fora da requisição já enxerga a nova. É esse teste que transforma a frase "nossa configuração é recarregável" em uma propriedade verificada. Os outros dois garantem que uma versão inválida nunca substitui a válida e que ninguém altera o snapshot no lugar. Nenhum deles precisa de infraestrutura: rodam com node:test em milissegundos.',
        },
        {
          type: 'list',
          items: [
            'Versão da configuração em cada log de requisição, no cabeçalho de resposta e numa métrica por instância.',
            'Contador de falhas de recarga com alerta quando passa de zero por mais de um ciclo.',
            'Idade da última aplicação bem-sucedida por instância, para detectar réplica presa numa versão antiga.',
            'Rollout por fração da frota antes de aplicar ao restante, com o mesmo cuidado de um deploy.',
            'Cópia local da última versão boa conhecida, para subir instâncias novas sem depender da fonte.',
            'Teste automatizado da requisição em voo que não enxerga a versão aplicada no meio dela.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Feature flags não resolvem o mesmo problema?',
      answer:
        'Resolvem uma parte e sofrem do mesmo defeito quando mal usadas. Uma feature flag é um parâmetro booleano com rollout por público; um limite numérico, um timeout ou um provedor ativo são parâmetros com domínio maior, e muitas ferramentas de flag os suportam como variáveis. O que importa é a leitura: um SDK de flags avaliado duas vezes na mesma requisição, com um await entre elas, produz exatamente a mistura de versões descrita aqui. A regra do snapshot fixado por requisição vale para flags e para qualquer outro parâmetro que muda em tempo de execução.',
    },
    {
      question: 'Fixar a configuração por requisição não atrasa a aplicação de um kill switch?',
      answer:
        'Atrasa pelo tempo de uma requisição, que é o atraso correto. Uma requisição que começou com o provedor A deve terminar com o provedor A; interrompê-la no meio produz estados parciais piores do que deixá-la concluir. O kill switch passa a valer para toda requisição nova no instante da troca, e as em voo terminam em milissegundos ou segundos. Se um trabalho de longa duração precisa reagir mais rápido, ele deve fixar o snapshot por unidade de trabalho, como por lote, e não por execução inteira.',
    },
    {
      question: 'Com várias instâncias, como garantir que todas aplicam a mesma versão ao mesmo tempo?',
      answer:
        'Não se garante, e o desenho não deve depender disso. Com polling, as instâncias aplicam a nova versão dentro de um intervalo, em momentos diferentes; com watch, em segundos, ainda em momentos diferentes. O sistema precisa tolerar a convivência de duas versões por um curto período, da mesma forma que tolera um rolling deploy. O que precisa existir é visibilidade: versão por instância numa métrica, alerta para réplica presa numa versão antiga e, para mudanças que não podem conviver, como trocar o formato de uma chave, um parâmetro intermediário que aceita os dois formatos, aplicado primeiro, como num expandir e contrair de banco.',
    },
  ],
  conclusion: {
    title: 'Recarregar sem reiniciar é uma questão de unidade de consistência, não de temporizador',
    description:
      'Qualquer serviço consegue reler um arquivo a cada trinta segundos. O que separa um recarregador confiável de um gerador de incidentes silenciosos é a unidade de consistência: um snapshot imutável com versão, trocado atomicamente, fixado por requisição ou por unidade de trabalho, validado inteiro antes de valer, com a última versão boa conhecida como rede de segurança e com componentes derivados reconstruídos sem derrubar o que está em voo. Sem o teste da requisição em voo, a propriedade continua sendo uma suposição.',
    cta: 'Revisar a configuração dinâmica do meu serviço',
  },
  related: [
    {
      label: 'Feature flag que virou dívida: como remover a bandeira sem quebrar produção',
      to: '/blog/feature-flag-que-virou-divida-remover-bandeira-sem-quebrar-producao',
    },
    {
      label: 'Graceful shutdown que ninguém testou: deploy que corta requisição no meio e derruba job em andamento',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A billing threshold, a timeout, a pool size, the active payment provider: parameters like these change far more often than code, and requiring a deploy for every adjustment turns operations into a waiting line. The alternative of reloading at runtime looks simple until the first request reads a parameter twice and gets two different values, or until one instance applies a broken version and starts rejecting everything. This article shows why field-by-field reads produce inconsistent state, how an immutable snapshot with an atomic swap removes the problem, how to pin the snapshot per request with AsyncLocalStorage, how to reload from the source with validation and a last known good version, how to rebuild components that derive from configuration without dropping what is in flight, and how to prove in a test that no request ever sees two versions.',
  sections: [
    {
      title: 'What changes without a deploy and why restarting is not the answer',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a billing service, code changes a few times a week; the threshold above which an order goes to manual review changes a few times a day, following the fraud pattern of the moment. Handling both with the same process creates a rhythm problem: operations needs an adjustment in minutes and gets a forty-minute pipeline. The first solution that shows up is restarting the process with the new environment variable, which solves consistency, because the process is born whole with the new version, but costs a rolling restart per adjustment, with connection draining, cache warm-up and a window of reduced capacity. In a fleet of thirty instances, ten adjustments a day become three hundred restarts.',
        },
        {
          type: 'table',
          columns: ['Parameter type', 'Change frequency', 'Cost of a wrong value', 'Needs a restart?'],
          rows: [
            [
              'Business limits (review threshold, per-customer quota)',
              'Daily',
              'Undue charge or fraud let through',
              'No: read per request',
            ],
            [
              'Dependency timeouts and retries',
              'Weekly, and at every incident',
              'Latency cascade or premature give-up',
              'No: read per call',
            ],
            [
              'Pool size and concurrency limits',
              'Monthly',
              'Database exhaustion or underuse',
              'No, if the component is rebuilt',
            ],
            [
              'Active endpoint or provider',
              'Rare, and in emergencies',
              'Traffic going to the wrong provider',
              'No, with a rebuilt client',
            ],
            [
              'Listen port, cluster mode, runtime flags',
              'Rare',
              'Process does not start',
              'Yes: part of initialization',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The first four rows justify reloading at runtime. The last one is a reminder that not everything should be reloadable: parameters consumed once at startup still require a restart, and pretending otherwise produces a configuration that says one thing while the process does another.',
        },
      ],
    },
    {
      title: 'Field-by-field reads are what create the inconsistent state',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The first reloader anyone writes is a global object with a get method per key, refreshed by a timer. It works as long as each request reads each parameter exactly once. It stops working when the same key is read twice with an await in between, or when two keys that only make sense together, such as provider and timeout, are read at different moments. The request starts seeing a mix of versions that never existed anywhere.',
        },
        { type: 'code', value: leituraPorCampoCode },
        { type: 'diagram', value: diagramaEn },
        {
          type: 'paragraph',
          value:
            'The timeline shows the worst kind of defect: no error, no exception log, and an audit record that states something false. The same pattern appears when a retry reads the timeout again and waits for a different value than the first attempt did, or when the provider changes between authorization and capture. It is not a business logic bug. It is the absence of a unit of consistency: the request needs a single version, from start to finish.',
        },
      ],
    },
    {
      title: 'Immutable snapshot, atomic swap and per-request pinning',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix has three parts. Configuration stops being a set of keys and becomes a single, frozen, numbered object: a snapshot. Reloading does not mutate fields; it produces a new snapshot and swaps the reference in one assignment, which in JavaScript is atomic by nature of the execution model. And each request pins the reference that was current when it started, so any read inside it, before or after an await, lands on the same object. In Node.js, AsyncLocalStorage carries that snapshot through the whole async chain without passing it as an argument to every function.',
        },
        { type: 'code', value: configStoreCode },
        {
          type: 'paragraph',
          value:
            'Three details matter. Deep freezing guarantees nobody mutates the snapshot in place and creates an intermediate version only that instance sees. The incremental version goes into the response header, the log and the audit record, so a strange order from yesterday can be read next to the configuration that actually decided it. And a failing listener does not block the swap: the new version is already current when listeners run, and an error in one of them becomes a log line, not a partial rollback.',
        },
        {
          type: 'paragraph',
          value:
            'Long-running jobs follow the same rule with a nuance: a job that runs for twenty minutes pins the snapshot at the start of each unit of work, such as each batch of a thousand rows, not at the start of the whole job. That way a configuration change lands between batches, never in the middle of one, and the job is not stuck on a version from twenty minutes ago.',
        },
      ],
    },
    {
      title: 'Reloading from the source: validate first, keep the last known good',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The source can be Parameter Store, Consul, an object in S3 or a file mounted from a ConfigMap. To the reloader, all of them are a function that returns a body and a version identifier, such as an ETag or a revision number, so the cycle does not reapply the same configuration every interval. The part that cannot be missing is full validation before applying: type, range, allowed values and cross-field rules. A version that passes field by field but is incoherent as a whole, such as a 200 ms timeout for a provider that never answers under 500 ms, has to be rejected entirely.',
        },
        { type: 'code', value: recarregadorCode },
        {
          type: 'paragraph',
          value:
            'When validation fails, or the source is down, the process keeps the last known good version and bumps a counter. That is the difference between a wrong change that affects nobody and one that takes down the fleet. On a freshly started instance the same principle applies with one addition: the process must come up with a valid snapshot, from the source or from a local copy written at the last successful apply, and only then start accepting traffic. Coming up with silent defaults because the source was slow is the most common way to have one instance different from the others without anyone noticing.',
        },
        {
          type: 'table',
          columns: ['Detection mechanism', 'Latency to apply', 'Load on the source', 'When to use'],
          rows: [
            [
              'Polling with ETag or revision',
              'Up to one interval (15 to 60 s)',
              'One conditional read per instance per interval',
              'Default: simple, predictable, works with any source',
            ],
            [
              'Watch or stream (etcd, Consul, SSE)',
              'Seconds',
              'One open connection per instance',
              'When minutes of latency will not do, such as a kill switch',
            ],
            [
              'SIGHUP with a local file',
              'Immediate, manual',
              'None',
              'Single process or a few hosts with their own orchestration',
            ],
            [
              'Push via queue or webhook',
              'Seconds',
              'One message per change',
              'When a queue already exists; requires safety polling for instances that missed the message',
            ],
          ],
        },
      ],
    },
    {
      title: 'Components that hold state derived from configuration',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A limit read per request changes by itself when the snapshot changes. A connection pool, an HTTP client with keep-alive, a rate limiter with an in-memory window and an already created timer do not: they read the configuration once at construction and kept the result. For these components, reloading means rebuilding, and rebuilding without dropping what is in flight means creating the new one before closing the old one and letting the old one drain at its own pace.',
        },
        { type: 'code', value: reconstruirPoolCode },
        {
          type: 'table',
          columns: ['Component', 'Strategy', 'Caveat'],
          rows: [
            [
              'Limits, timeouts, decision keys',
              'Read from the snapshot on every use',
              'Read once per request, never per field at different moments',
            ],
            [
              'Connection pool, HTTP client',
              'Create the new one, swap the reference, drain the old one',
              'Make sure the old one really closes; two full pools double the connections on the database',
            ],
            [
              'Rate limiter, in-memory cache',
              'Rebuild with the new limits; accept losing the current window',
              'During the swap there is an instant with no history; document that it is expected',
            ],
            [
              'Timers and schedules',
              'Cancel the old one and register the new one in the listener',
              'An interval in flight finishes with the old value; the next run uses the new one',
            ],
            [
              'Port, cluster mode, runtime flags',
              'Mark as startup-only',
              'Reject the change in the validator instead of accepting and ignoring it',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is the one that prevents the most expensive confusion: a parameter the validator accepts but the process never applies. If a field only has effect at startup, the validator should refuse the runtime change with an explicit message, so operations knows that adjustment requires a deploy.',
        },
      ],
    },
    {
      title: 'Operating and proving: visible version, gradual rollout and the in-flight request test',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Configuration that changes without a deploy needs the same traceability as a deploy. That means the version in every request log, in the response header and in a per-instance metric: a chart of config_version per replica shows in seconds whether an instance got stuck on an old version because the source failed only for it. Gradual rollout matters too: apply a change to a fraction of the fleet first, by instance key or by percentage, and only then to the rest. And so does a rollback path that does not depend on the source being healthy: the last known good version written locally serves as the return point.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'The first test is the one that matters: an in-flight request reads the same value before and after an await, even with a new version applied in between, while code outside the request already sees the new one. That test is what turns the sentence "our configuration is reloadable" into a verified property. The other two guarantee that an invalid version never replaces the valid one and that nobody mutates the snapshot in place. None of them needs infrastructure: they run with node:test in milliseconds.',
        },
        {
          type: 'list',
          items: [
            'Configuration version in every request log, in the response header and in a per-instance metric.',
            'Reload failure counter with an alert when it stays above zero for more than one cycle.',
            'Age of the last successful apply per instance, to detect a replica stuck on an old version.',
            'Rollout to a fraction of the fleet before applying to the rest, with the same care as a deploy.',
            'Local copy of the last known good version, to bring up new instances without depending on the source.',
            'Automated test of the in-flight request that does not see the version applied in the middle of it.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Do feature flags not solve the same problem?',
      answer:
        'They solve part of it and suffer from the same defect when misused. A feature flag is a boolean parameter with audience-based rollout; a numeric limit, a timeout or an active provider are parameters with a larger domain, and many flag tools support them as variables. What matters is the read: a flag SDK evaluated twice in the same request, with an await in between, produces exactly the version mix described here. The rule of a snapshot pinned per request applies to flags and to any other parameter that changes at runtime.',
    },
    {
      question: 'Does pinning configuration per request not delay a kill switch?',
      answer:
        'It delays it by the duration of one request, which is the correct delay. A request that started with provider A must finish with provider A; interrupting it midway produces partial states worse than letting it complete. The kill switch takes effect for every new request at the instant of the swap, and in-flight ones finish in milliseconds or seconds. If a long-running job needs to react faster, it should pin the snapshot per unit of work, such as per batch, not per whole execution.',
    },
    {
      question: 'With several instances, how do you guarantee they all apply the same version at the same time?',
      answer:
        'You do not, and the design must not depend on it. With polling, instances apply the new version within one interval, at different moments; with watch, within seconds, still at different moments. The system has to tolerate two versions coexisting for a short period, the same way it tolerates a rolling deploy. What has to exist is visibility: version per instance in a metric, an alert for a replica stuck on an old version and, for changes that cannot coexist, such as changing a key format, an intermediate parameter that accepts both formats, applied first, like an expand and contract on a database.',
    },
  ],
  conclusion: {
    title: 'Reloading without restarting is about the unit of consistency, not the timer',
    description:
      'Any service can reread a file every thirty seconds. What separates a reliable reloader from a generator of silent incidents is the unit of consistency: an immutable snapshot with a version, swapped atomically, pinned per request or per unit of work, validated whole before it takes effect, with the last known good version as a safety net and with derived components rebuilt without dropping what is in flight. Without the in-flight request test, the property remains an assumption.',
    cta: 'Review the dynamic configuration of my service',
  },
  related: [
    {
      label: 'The feature flag that became debt: removing the flag without breaking production',
      to: '/blog/feature-flag-que-virou-divida-remover-bandeira-sem-quebrar-producao',
    },
    {
      label: 'The graceful shutdown nobody tested: deploys that cut requests mid-flight and kill running jobs',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un umbral de cobro, un timeout, el tamaño de un pool, el proveedor de pago activo: parámetros así cambian con mucha más frecuencia que el código, y exigir un despliegue por cada ajuste convierte la operación en una fila de espera. La alternativa de recargar en tiempo de ejecución parece simple hasta la primera petición que lee el parámetro dos veces y recibe dos valores distintos, o hasta la instancia que aplica una versión rota y empieza a rechazar todo. Este artículo muestra por qué la lectura campo a campo produce estado inconsistente, cómo un snapshot inmutable con intercambio atómico elimina el problema, cómo fijar el snapshot por petición con AsyncLocalStorage, cómo recargar desde la fuente con validación y última versión buena conocida, cómo reconstruir componentes que derivan de la configuración sin tumbar lo que está en vuelo y cómo demostrar en una prueba que ninguna petición ve dos versiones.',
  sections: [
    {
      title: 'Qué cambia sin despliegue y por qué reiniciar no es la respuesta',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un servicio de cobros, el código cambia algunas veces por semana; el umbral por encima del cual un pedido pasa a revisión manual cambia algunas veces al día, según el fraude del momento. Tratar ambos con el mismo proceso crea un problema de ritmo: operaciones necesita un ajuste en minutos y recibe un pipeline de cuarenta. La primera solución que aparece es reiniciar el proceso con la nueva variable de entorno, lo que resuelve la consistencia, porque el proceso nace entero con la versión nueva, pero cuesta un rolling restart por ajuste, con drenaje de conexiones, calentamiento de caché y una ventana de capacidad reducida. En una flota de treinta instancias, diez ajustes al día se convierten en trescientos reinicios.',
        },
        {
          type: 'table',
          columns: ['Tipo de parámetro', 'Frecuencia de cambio', 'Coste de un valor incorrecto', '¿Necesita reinicio?'],
          rows: [
            [
              'Límites de negocio (valor para revisión, cuota por cliente)',
              'Diaria',
              'Cobro indebido o fraude que pasa',
              'No: se lee por petición',
            ],
            [
              'Timeouts y reintentos de dependencias',
              'Semanal, y en cada incidente',
              'Cascada de lentitud o abandono prematuro',
              'No: se lee por llamada',
            ],
            [
              'Tamaño de pool y límites de concurrencia',
              'Mensual',
              'Agotamiento o infrautilización de la base de datos',
              'No, si el componente se reconstruye',
            ],
            [
              'Endpoint o proveedor activo',
              'Rara, y en emergencias',
              'Tráfico yendo al proveedor equivocado',
              'No, con el cliente reconstruido',
            ],
            [
              'Puerto de escucha, modo de clúster, flags del runtime',
              'Rara',
              'El proceso no arranca',
              'Sí: forma parte de la inicialización',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Las cuatro primeras filas justifican recargar en tiempo de ejecución. La última recuerda que no todo debe ser recargable: los parámetros consumidos una sola vez al arrancar siguen exigiendo reinicio, y fingir lo contrario genera una configuración que dice una cosa mientras el proceso hace otra.',
        },
      ],
    },
    {
      title: 'La lectura campo a campo es lo que crea el estado inconsistente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El primer recargador que uno escribe es un objeto global con un método get por clave, actualizado por un temporizador. Funciona mientras cada petición lea cada parámetro una sola vez. Deja de funcionar cuando la misma clave se lee dos veces con un await en medio, o cuando dos claves que solo tienen sentido juntas, como proveedor y timeout, se leen en momentos distintos. La petición pasa a ver una mezcla de versiones que nunca existió en ningún sitio.',
        },
        { type: 'code', value: leituraPorCampoCode },
        { type: 'diagram', value: diagramaEs },
        {
          type: 'paragraph',
          value:
            'La línea de tiempo muestra el peor tipo de defecto: ningún error, ningún log de excepción y un registro de auditoría que afirma algo falso. El mismo patrón aparece cuando un reintento vuelve a leer el timeout y espera un valor distinto del que esperó el primer intento, o cuando el proveedor cambia entre la autorización y la captura. No es un bug de la lógica de negocio. Es la ausencia de una unidad de consistencia: la petición necesita una sola versión, de principio a fin.',
        },
      ],
    },
    {
      title: 'Snapshot inmutable, intercambio atómico y fijación por petición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección tiene tres partes. La configuración deja de ser un conjunto de claves y se convierte en un objeto único, congelado y numerado: un snapshot. Recargar no altera campos; produce un snapshot nuevo e intercambia la referencia en una asignación, que en JavaScript es atómica por la naturaleza del modelo de ejecución. Y cada petición fija la referencia que estaba vigente cuando empezó, de modo que cualquier lectura dentro de ella, antes o después de un await, cae en el mismo objeto. En Node.js, AsyncLocalStorage lleva ese snapshot por toda la cadena asíncrona sin tener que pasarlo como argumento en cada función.',
        },
        { type: 'code', value: configStoreCode },
        {
          type: 'paragraph',
          value:
            'Tres detalles marcan la diferencia. El congelamiento profundo garantiza que nadie altera el snapshot en el sitio y crea una versión intermedia que solo esa instancia ve. La versión incremental va a la cabecera de respuesta, al log y a la auditoría, y así un pedido extraño de ayer puede leerse junto a la configuración que realmente lo decidió. Y el oyente que falla no impide el intercambio: la versión nueva ya está vigente cuando los oyentes se ejecutan, y el error de uno de ellos se convierte en una línea de log, no en un rollback parcial.',
        },
        {
          type: 'paragraph',
          value:
            'Los trabajos de larga duración siguen la misma regla con un matiz: un job que corre veinte minutos fija el snapshot al inicio de cada unidad de trabajo, como cada lote de mil filas, y no al inicio del job completo. Así el cambio de configuración entra entre lotes, nunca a mitad de uno, y el job no queda atado a una versión de hace veinte minutos.',
        },
      ],
    },
    {
      title: 'Recargar desde la fuente: validar antes, conservar la última buena conocida',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La fuente puede ser Parameter Store, Consul, un objeto en S3 o un archivo montado desde un ConfigMap. Para el recargador, todo eso es una función que devuelve un cuerpo y un identificador de versión, como un ETag o un número de revisión, para que el ciclo no vuelva a aplicar la misma configuración en cada intervalo. Lo que no puede faltar es la validación completa antes de aplicar: tipo, rango, valores permitidos y reglas entre campos. Una versión que pasa campo a campo pero es incoherente como conjunto, como un timeout de 200 ms para un proveedor que nunca responde por debajo de 500 ms, tiene que rechazarse entera.',
        },
        { type: 'code', value: recarregadorCode },
        {
          type: 'paragraph',
          value:
            'Cuando la validación falla, o la fuente está caída, el proceso sigue con la última versión buena conocida y sube un contador. Es la diferencia entre un cambio incorrecto que no afecta a nadie y uno que tumba la flota. En una instancia recién arrancada vale el mismo principio con un complemento: el proceso debe arrancar con un snapshot válido, venido de la fuente o de una copia local escrita en la última aplicación exitosa, y solo entonces empezar a aceptar tráfico. Arrancar con valores por defecto silenciosos porque la fuente tardó es la forma más común de tener una instancia distinta de las demás sin que nadie lo note.',
        },
        {
          type: 'table',
          columns: ['Mecanismo de detección', 'Latencia hasta aplicar', 'Carga en la fuente', 'Cuándo usarlo'],
          rows: [
            [
              'Polling con ETag o revisión',
              'Hasta un intervalo (15 a 60 s)',
              'Una lectura condicional por instancia por intervalo',
              'Por defecto: simple, predecible, funciona con cualquier fuente',
            ],
            [
              'Watch o stream (etcd, Consul, SSE)',
              'Segundos',
              'Una conexión abierta por instancia',
              'Cuando minutos de latencia no sirven, como un kill switch',
            ],
            [
              'Señal SIGHUP con archivo local',
              'Inmediata, manual',
              'Ninguna',
              'Proceso único o pocos hosts con orquestación propia',
            ],
            [
              'Push por cola o webhook',
              'Segundos',
              'Un mensaje por cambio',
              'Cuando ya existe una cola; exige polling de seguridad para instancias que perdieron el mensaje',
            ],
          ],
        },
      ],
    },
    {
      title: 'Componentes que guardan estado derivado de la configuración',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un límite leído por petición cambia solo cuando cambia el snapshot. Un pool de conexiones, un cliente HTTP con keep-alive, un rate limiter con ventana en memoria y un temporizador ya creado no cambian: leyeron la configuración una vez en la construcción y guardaron el resultado. Para esos componentes, recargar significa reconstruir, y reconstruir sin tumbar lo que está en vuelo significa crear el nuevo antes de cerrar el antiguo y dejar que el antiguo se drene a su propio ritmo.',
        },
        { type: 'code', value: reconstruirPoolCode },
        {
          type: 'table',
          columns: ['Componente', 'Estrategia', 'Cuidado'],
          rows: [
            [
              'Límites, timeouts, claves de decisión',
              'Leer del snapshot en cada uso',
              'Leer una vez por petición, nunca por campo en momentos distintos',
            ],
            [
              'Pool de conexiones, cliente HTTP',
              'Crear el nuevo, intercambiar la referencia, drenar el antiguo',
              'Asegurarse de que el antiguo se cierra de verdad; dos pools llenos duplican las conexiones en la base de datos',
            ],
            [
              'Rate limiter, caché en memoria',
              'Reconstruir con los límites nuevos; aceptar perder la ventana actual',
              'Durante el intercambio hay un instante sin historial; documentar que es esperado',
            ],
            [
              'Temporizadores y programaciones',
              'Cancelar el antiguo y registrar el nuevo en el oyente',
              'Un intervalo en vuelo termina con el valor antiguo; la siguiente ejecución usa el nuevo',
            ],
            [
              'Puerto, modo de clúster, flags del runtime',
              'Marcar como solo de inicialización',
              'Rechazar el cambio en el validador en vez de aceptarlo e ignorarlo',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila es la que evita la confusión más cara: un parámetro que el validador acepta pero el proceso nunca aplica. Si un campo solo tiene efecto al arrancar, el validador debe rechazar el cambio en tiempo de ejecución con un mensaje explícito, para que operaciones sepa que ese ajuste exige un despliegue.',
        },
      ],
    },
    {
      title: 'Operar y demostrar: versión visible, rollout gradual y la prueba de la petición en vuelo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una configuración que cambia sin despliegue necesita la misma trazabilidad que un despliegue. Eso significa la versión en el log de cada petición, en la cabecera de respuesta y en una métrica por instancia: una gráfica de config_version por réplica muestra en segundos si una instancia se quedó atascada en una versión antigua porque la fuente falló solo para ella. También importa el rollout gradual: aplicar un cambio primero a una fracción de la flota, por clave de instancia o por porcentaje, y solo después al resto. Y hace falta un camino de reversión que no dependa de que la fuente esté sana: la última versión buena conocida escrita localmente sirve de punto de retorno.',
        },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'La primera prueba es la que importa: una petición en vuelo lee el mismo valor antes y después de un await, incluso con una versión nueva aplicada en medio, mientras el código fuera de la petición ya ve la nueva. Esa prueba es la que convierte la frase "nuestra configuración es recargable" en una propiedad verificada. Las otras dos garantizan que una versión inválida nunca sustituye a la válida y que nadie altera el snapshot en el sitio. Ninguna necesita infraestructura: se ejecutan con node:test en milisegundos.',
        },
        {
          type: 'list',
          items: [
            'Versión de la configuración en cada log de petición, en la cabecera de respuesta y en una métrica por instancia.',
            'Contador de fallos de recarga con alerta cuando se mantiene por encima de cero más de un ciclo.',
            'Antigüedad de la última aplicación exitosa por instancia, para detectar una réplica atascada en una versión antigua.',
            'Rollout a una fracción de la flota antes de aplicar al resto, con el mismo cuidado que un despliegue.',
            'Copia local de la última versión buena conocida, para arrancar instancias nuevas sin depender de la fuente.',
            'Prueba automatizada de la petición en vuelo que no ve la versión aplicada a mitad de ella.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Los feature flags no resuelven el mismo problema?',
      answer:
        'Resuelven una parte y sufren el mismo defecto cuando se usan mal. Un feature flag es un parámetro booleano con rollout por audiencia; un límite numérico, un timeout o un proveedor activo son parámetros con un dominio mayor, y muchas herramientas de flags los soportan como variables. Lo que importa es la lectura: un SDK de flags evaluado dos veces en la misma petición, con un await en medio, produce exactamente la mezcla de versiones descrita aquí. La regla del snapshot fijado por petición vale para los flags y para cualquier otro parámetro que cambie en tiempo de ejecución.',
    },
    {
      question: '¿Fijar la configuración por petición no retrasa la aplicación de un kill switch?',
      answer:
        'La retrasa lo que dura una petición, que es el retraso correcto. Una petición que empezó con el proveedor A debe terminar con el proveedor A; interrumpirla a medias produce estados parciales peores que dejarla terminar. El kill switch pasa a valer para toda petición nueva en el instante del intercambio, y las que están en vuelo terminan en milisegundos o segundos. Si un trabajo de larga duración necesita reaccionar más rápido, debe fijar el snapshot por unidad de trabajo, como por lote, y no por ejecución completa.',
    },
    {
      question: 'Con varias instancias, ¿cómo garantizar que todas aplican la misma versión al mismo tiempo?',
      answer:
        'No se garantiza, y el diseño no debe depender de ello. Con polling, las instancias aplican la nueva versión dentro de un intervalo, en momentos distintos; con watch, en segundos, todavía en momentos distintos. El sistema tiene que tolerar la convivencia de dos versiones durante un periodo corto, igual que tolera un rolling deploy. Lo que tiene que existir es visibilidad: versión por instancia en una métrica, alerta para una réplica atascada en una versión antigua y, para cambios que no pueden convivir, como cambiar el formato de una clave, un parámetro intermedio que acepte ambos formatos, aplicado primero, como en un expandir y contraer de base de datos.',
    },
  ],
  conclusion: {
    title: 'Recargar sin reiniciar es una cuestión de unidad de consistencia, no de temporizador',
    description:
      'Cualquier servicio puede releer un archivo cada treinta segundos. Lo que separa un recargador fiable de un generador de incidentes silenciosos es la unidad de consistencia: un snapshot inmutable con versión, intercambiado atómicamente, fijado por petición o por unidad de trabajo, validado entero antes de entrar en vigor, con la última versión buena conocida como red de seguridad y con los componentes derivados reconstruidos sin tumbar lo que está en vuelo. Sin la prueba de la petición en vuelo, la propiedad sigue siendo una suposición.',
    cta: 'Revisar la configuración dinámica de mi servicio',
  },
  related: [
    {
      label: 'El feature flag que se volvió deuda: quitar la bandera sin romper producción',
      to: '/blog/feature-flag-que-virou-divida-remover-bandeira-sem-quebrar-producao',
    },
    {
      label: 'El graceful shutdown que nadie probó: despliegues que cortan peticiones a medias y matan jobs en curso',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
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
