// Conteudo do artigo: timeout mal calibrado, quando tentar de novo piora o
// incidente.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const pt = {
  intro:
    'O timeout configurado era de trinta segundos e a mediana da chamada era de oitenta milissegundos. Ninguém escolheu esse número: ele veio do valor padrão da biblioteca HTTP e sobreviveu a quatro anos de deploys porque nunca causou um alerta. No dia em que a dependência degradou, cada requisição ficou trinta segundos ocupando uma conexão do pool, o pool esgotou em menos de um minuto e o serviço inteiro caiu por causa de uma dependência que ainda respondia a maior parte das chamadas. Este artigo mostra como derivar o valor do timeout a partir da distribuição de latência em vez de arredondar para um número confortável, por que o orçamento de retry precisa ser uma fração do tráfego e não um contador por requisição, qual conta define quantas tentativas cabem dentro do prazo do usuário, quando a requisição paralela antecipada resolve a cauda longa e quando ela dobra a fatura sem melhorar nada, e qual métrica prova que a calibração está certa antes do próximo incidente.',
  sections: [
    {
      title: 'O timeout não é uma margem de segurança, é uma declaração de desistência',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A intuição por trás de um timeout generoso é que ele evita cortar uma requisição que ainda ia dar certo. Essa intuição trata o timeout como uma rede de proteção, e é por isso que os valores tendem a subir com o tempo: cada vez que alguém vê um erro de prazo esgotado em um caso legítimo, o reflexo é aumentar o número. O que essa leitura ignora é que o timeout não protege a requisição individual, ele protege o recurso compartilhado que a requisição está segurando enquanto espera. Uma conexão do pool, uma thread do servidor, um slot de concorrência do cliente HTTP, memória com o corpo da requisição carregado.',
        },
        {
          type: 'paragraph',
          value:
            'A conta que torna isso concreto é a Lei de Little aplicada ao pool de conexões. Se o serviço recebe cem requisições por segundo, cada uma segura uma conexão pelo tempo de resposta da dependência, e o pool tem cinquenta conexões, então o tempo máximo de resposta que o sistema tolera sem esgotar o pool é de meio segundo. Com timeout de trinta segundos, basta que a dependência fique lenta por alguns segundos para que todas as cinquenta conexões estejam ocupadas esperando, e a partir daí o serviço rejeita tráfego que não tem nada a ver com aquela dependência. O timeout generoso não deu chance à requisição lenta, ele derrubou todas as outras.',
        },
        {
          type: 'paragraph',
          value:
            'Reformulando: o timeout responde a uma pergunta de negócio, não de infraestrutura. A pergunta é a partir de quanto tempo essa resposta deixa de ter valor para quem pediu. Para uma consulta de saldo em tela de checkout, isso é algo entre um e dois segundos, porque depois disso o usuário já decidiu que o site quebrou. Para um job noturno de reconciliação, isso pode ser dez minutos. Os dois casos podem chamar exatamente a mesma dependência, e configurar o mesmo timeout para os dois é um erro nas duas direções ao mesmo tempo.',
        },
        {
          type: 'table',
          columns: ['Sintoma observado', 'Diagnóstico errado comum', 'Causa real', 'Ajuste correto'],
          rows: [
            [
              'Pool de conexões esgotado sob dependência lenta',
              'Pool pequeno demais',
              'Timeout maior que o tempo de ocupação sustentável',
              'Reduzir timeout para o p99 mais margem, não aumentar o pool',
            ],
            [
              'Erro de prazo esgotado em requisição que ia funcionar',
              'Timeout curto demais',
              'Timeout abaixo do p99 real da dependência',
              'Medir a distribuição e recalibrar sobre o percentil',
            ],
            [
              'Dependência não se recupera depois do pico',
              'Dependência sem capacidade',
              'Retry do cliente multiplicando a carga durante a degradação',
              'Orçamento de retry como fração do tráfego',
            ],
            [
              'Latência do usuário muito acima da soma das etapas',
              'Rede lenta',
              'Tentativas sequenciais consumindo o prazo do usuário',
              'Prazo propagado com desconto a cada salto',
            ],
            [
              'Fatura da dependência sobe sem aumento de tráfego',
              'Preço reajustado',
              'Requisição paralela antecipada disparando sempre',
              'Disparar a segunda cópia só acima do p95',
            ],
          ],
        },
      ],
    },
    {
      title: 'Derivar o número da distribuição, não do número redondo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O procedimento que substitui o chute tem três entradas: a distribuição de latência da dependência em condição saudável, o prazo que o chamador tem disponível, e a decisão sobre quantas tentativas cabem dentro desse prazo. A primeira entrada exige histograma e não média. A média de latência de uma dependência com cauda longa é um número que quase nenhuma requisição real experimenta, e calibrar sobre ela produz um timeout que corta uma fatia grande do tráfego legítimo.',
        },
        {
          type: 'paragraph',
          value:
            'A regra prática que funciona é fixar o timeout de uma tentativa individual no percentil noventa e nove da latência saudável, multiplicado por um fator entre um vírgula três e um vírgula cinco. O percentil noventa e nove define o ponto a partir do qual a espera deixou de ser comportamento normal e passou a ser sinal de que algo está errado com aquela chamada específica. O fator de folga absorve a variação legítima de carga entre o dia da medição e o dia do incidente, sem chegar perto de um número que permita ocupação prolongada do pool.',
        },
        {
          type: 'paragraph',
          value:
            'Um detalhe que muda o resultado é que o timeout precisa ser dividido em fases, porque um timeout único de conexão mais leitura esconde onde o tempo foi gasto. Falha de conexão é sinal de instância indisponível e deve ser rápida, tipicamente algumas centenas de milissegundos, porque nesse caso tentar outra instância imediatamente é a resposta certa. Falha de leitura é sinal de que o servidor aceitou o trabalho e está demorando, e nesse caso repetir a chamada provavelmente vai encontrar o mesmo servidor no mesmo estado. Tratar os dois com o mesmo número faz o cliente repetir o que não deveria e desistir do que deveria esperar.',
        },
        {
          type: 'code',
          value: `// http/calibragem.js
// Deriva o timeout da distribuicao medida, nao de um numero redondo.
// A entrada e o histograma de latencia SAUDAVEL da dependencia, coletado
// numa janela sem incidente. Calibrar sobre janela com degradacao
// incorporada infla o p99 e produz um timeout que nunca protege nada.

const FOLGA_P99 = 1.4;        // absorve variacao de carga entre medicao e producao
const TETO_CONEXAO_MS = 400;  // falha de conexao e binaria: a instancia responde ou nao

/**
 * @param {object} perfil
 * @param {number} perfil.p99Ms            p99 da latencia saudavel, fim a fim
 * @param {number} perfil.prazoUsuarioMs   quanto tempo a resposta ainda vale
 * @param {number} perfil.tentativas       quantas tentativas se deseja permitir
 */
export const calibrarTimeout = ({ p99Ms, prazoUsuarioMs, tentativas = 2 }) => {
  const porTentativa = Math.ceil(p99Ms * FOLGA_P99);

  // O prazo do usuario e o teto absoluto: nao adianta permitir tres
  // tentativas de 250ms se o checkout desiste em 600ms. A divisao reserva
  // uma fatia para overhead de rede e serializacao entre as tentativas.
  const overheadPorTentativa = 30;
  const tetoPorTentativa = Math.floor(
    (prazoUsuarioMs - overheadPorTentativa * tentativas) / tentativas,
  );

  if (tetoPorTentativa < porTentativa) {
    // O prazo nao comporta o numero de tentativas pedido. Reduzir o timeout
    // ate caber e a escolha errada: ele passaria a cortar trafego legitimo.
    // O ajuste correto e reduzir tentativas, e essa decisao fica explicita.
    const tentativasPossiveis = Math.floor(
      prazoUsuarioMs / (porTentativa + overheadPorTentativa),
    );

    return {
      conexaoMs: Math.min(TETO_CONEXAO_MS, porTentativa),
      leituraMs: porTentativa,
      tentativas: Math.max(1, tentativasPossiveis),
      alerta: \`prazo de \${prazoUsuarioMs}ms comporta \${Math.max(1, tentativasPossiveis)} tentativa(s), nao \${tentativas}\`,
    };
  }

  return {
    conexaoMs: Math.min(TETO_CONEXAO_MS, porTentativa),
    leituraMs: porTentativa,
    tentativas,
    alerta: null,
  };
};

// Consulta de saldo no checkout: p99 de 180ms, usuario desiste em 1500ms.
// -> conexao 252ms, leitura 252ms, 2 tentativas, ainda com folga no prazo.
// Com o timeout padrao de 30s da biblioteca, uma unica tentativa lenta
// consome vinte vezes o prazo que o usuario aceita esperar.`,
        },
        {
          type: 'paragraph',
          value:
            'O caso interessante nessa função é o ramo que emite alerta. Quando o prazo do usuário não comporta o número de tentativas pedido, existe a tentação de resolver reduzindo o timeout de cada tentativa até caber. Esse é o movimento que transforma uma configuração razoável em uma máquina de erros: o timeout passa a cortar tráfego que estava saudável, o cliente enxerga falha, o retry dispara, e o sistema gera carga extra para chamadas que teriam funcionado. A escolha correta é reduzir o número de tentativas e deixar isso explícito, porque essa é uma decisão de produto sobre quanto o usuário espera, não um parâmetro de infraestrutura.',
        },
      ],
    },
    {
      title: 'Retry por requisição multiplica carga, retry por orçamento não',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A configuração clássica de três tentativas por requisição parece conservadora quando você olha uma requisição isolada. Ela deixa de ser conservadora no exato momento em que a taxa de erro sobe, porque nesse momento a carga sobre a dependência degradada é multiplicada por três. Uma dependência que estava a oitenta por cento de utilização e começou a errar dez por cento das chamadas recebe, com retry ingênuo, cento e vinte por cento da carga original. Ela não vai se recuperar sozinha, porque o cliente está adicionando carga na proporção exata da degradação.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é tratar o retry como um recurso escasso compartilhado entre todas as requisições, e não como um direito individual. O padrão de orçamento de retry mantém uma janela deslizante com a contagem de requisições originais e de tentativas adicionais, e só autoriza uma nova tentativa se a proporção estiver abaixo de um teto, tipicamente dez por cento. O efeito prático é que quando a taxa de falha é baixa, praticamente todo erro é repetido e o usuário nem percebe. Quando a taxa de falha explode, o orçamento se esgota nos primeiros instantes e o cliente para de repetir, entregando erro rápido em vez de amplificar o incidente.',
        },
        {
          type: 'code',
          value: `// resiliencia/orcamento-retry.js
// Retry como recurso compartilhado, nao como direito de cada requisicao.
// Janela deslizante: a razao entre tentativas extras e requisicoes originais
// nunca passa do teto. Sob falha generalizada o orcamento seca sozinho.

export const criarOrcamentoRetry = ({
  janelaMs = 10000,
  razaoMaxima = 0.1,     // no maximo 10% de carga extra sobre o trafego original
  minimoPorSegundo = 3,  // permite retry mesmo em rota de trafego muito baixo
  agora,
}) => {
  const originais = [];
  const extras = [];

  const podar = (t) => {
    const corte = t - janelaMs;
    while (originais.length && originais[0] <= corte) originais.shift();
    while (extras.length && extras[0] <= corte) extras.shift();
  };

  return {
    registrarOriginal() {
      const t = agora();
      podar(t);
      originais.push(t);
    },

    /**
     * Autoriza (ou nao) mais uma tentativa. Consome o orcamento quando
     * autoriza, para que duas requisicoes concorrentes nao gastem o mesmo
     * saldo. Retornar false rapido e uma resposta valida, nao uma falha.
     */
    tentarConsumir() {
      const t = agora();
      podar(t);

      const piso = (minimoPorSegundo * janelaMs) / 1000;
      const teto = Math.max(piso, originais.length * razaoMaxima);

      if (extras.length >= teto) return false;

      extras.push(t);
      return true;
    },

    estado() {
      const t = agora();
      podar(t);
      return {
        originais: originais.length,
        extras: extras.length,
        razao: originais.length ? extras.length / originais.length : 0,
      };
    },
  };
};

// Erros que NAO devem consumir orcamento nem gerar tentativa: qualquer
// resposta que o servidor produziu deliberadamente sobre o conteudo da
// requisicao. Repetir um 400 gera carga garantida sem chance de sucesso.
const REPETIVEL = new Set([408, 429, 500, 502, 503, 504]);

export const ehRepetivel = (erro) => {
  if (erro.codigo === 'ECONNREFUSED' || erro.codigo === 'ETIMEDOUT') return true;
  if (erro.status === undefined) return false;
  return REPETIVEL.has(erro.status);
};`,
        },
        {
          type: 'paragraph',
          value:
            'O piso de tentativas por segundo existe por um motivo que só aparece em serviços de baixo tráfego. Com dez por cento de razão máxima e uma rota que recebe três requisições por minuto, o orçamento nunca autorizaria nenhuma tentativa, porque dez por cento de um número muito pequeno arredonda para zero. O piso garante que a proteção contra amplificação não vire proibição total de retry em rotas pouco usadas, que são justamente as que mais se beneficiam de uma segunda chance.',
        },
        {
          type: 'paragraph',
          value:
            'A segunda peça é a separação entre erro repetível e erro determinístico. Repetir uma resposta de quatrocentos e um ou de quatrocentos e vinte e dois é gasto garantido sem chance de sucesso, porque o servidor avaliou a requisição e a recusou pelo conteúdo. O caso ambíguo é o quatrocentos e vinte e nove, que é uma recusa deliberada mas que carrega a instrução de quando tentar de novo. Ele deve ser repetido, mas honrando o cabeçalho de espera indicado pelo servidor, e nunca com o intervalo calculado pelo cliente.',
        },
      ],
    },
    {
      title: 'O prazo precisa atravessar a cadeia com desconto',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A calibração de um serviço isolado não sobrevive à composição. Quando a requisição do usuário atravessa quatro serviços e cada um define seu próprio timeout localmente, o resultado é uma soma que ninguém configurou e que quase sempre excede o prazo do usuário por uma margem grande. O problema fica visível no comportamento mais desperdiçador possível: o serviço mais profundo da cadeia continua processando uma requisição cujo chamador já desistiu, ocupando recurso para produzir uma resposta que ninguém vai ler.',
        },
        {
          type: 'paragraph',
          value:
            'A correção é propagar o prazo absoluto e não o tempo restante relativo. Cada serviço recebe um instante limite, subtrai o tempo que já consumiu localmente, e passa adiante um prazo menor. Antes de iniciar qualquer chamada, verifica se o prazo restante é suficiente para que a chamada tenha chance de terminar; se não for, falha imediatamente sem tocar na dependência. Essa verificação prévia é a que produz o maior ganho durante um incidente, porque ela transforma trabalho garantidamente inútil em erro instantâneo.',
        },
        {
          type: 'diagram',
          value: `Sem propagacao de prazo (cada servico com timeout local de 3s)

  usuario  desiste em 2s
     |
     v
  gateway ----3s----> pedidos ----3s----> estoque ----3s----> fornecedor
     |                   |                   |                    |
   [2s] X                |                   |                    |
   usuario ja foi        v                   v                    v
                    ainda trabalhando   ainda trabalhando   ainda trabalhando
                    ate 9s no pior caso, produzindo resposta para ninguem

Com prazo absoluto propagado (limite = t0 + 1900ms)

  t0         gateway consome 40ms   -> restante 1860ms
  t0+40ms    pedidos consome 120ms  -> restante 1740ms
  t0+160ms   estoque precisa de 250ms (p99 do fornecedor) -> cabe, segue
  t0+410ms   fornecedor responde
  t0+520ms   resposta chega ao usuario, dentro do prazo

Caso de corte antecipado

  t0+1800ms  estoque recebe requisicao com restante de 100ms
             p99 do fornecedor e 250ms -> nao cabe
             falha imediata, fornecedor nem chega a ser chamado
             economia: uma chamada de 250ms que seria descartada`,
        },
        {
          type: 'code',
          value: `// contexto/prazo.js
// Prazo ABSOLUTO propagado pela cadeia. Relativo nao funciona: o "restante"
// calculado no gateway ja esta velho quando chega no terceiro salto.

export const criarPrazo = ({ limiteEm, agora }) => ({
  limiteEm,
  restanteMs: () => Math.max(0, limiteEm - agora()),
  expirou: () => agora() >= limiteEm,
});

export const prazoDoCabecalho = (cabecalhos, { agora, padraoMs }) => {
  // Formato absoluto em epoch ms. Preferido a um "x-timeout-ms" relativo
  // porque nao acumula o tempo de rede de cada salto como erro.
  const bruto = cabecalhos['x-deadline-epoch-ms'];
  const analisado = bruto ? Number(bruto) : NaN;

  if (!Number.isFinite(analisado)) {
    return criarPrazo({ limiteEm: agora() + padraoMs, agora });
  }

  // Teto local: um chamador nao pode pedir um prazo maior do que este
  // servico esta disposto a segurar recurso. Sem esse teto, um cliente
  // mal configurado mantem conexoes ocupadas pelo tempo que quiser e
  // anula toda a calibragem feita aqui dentro.
  return criarPrazo({ limiteEm: Math.min(analisado, agora() + padraoMs), agora });
};

/**
 * Executa a chamada so se o prazo restante comporta o p99 dela.
 * Este e o corte que mais economiza durante incidente: trabalho que
 * seria descartado no fim nem chega a comecar.
 */
export const chamarComPrazo = async (prazo, { p99Ms, executar, nome }) => {
  const restante = prazo.restanteMs();

  if (restante < p99Ms) {
    const erro = new Error(\`prazo insuficiente para \${nome}\`);
    erro.codigo = 'DEADLINE_INSUFICIENTE';
    erro.restanteMs = restante;
    erro.necessarioMs = p99Ms;
    throw erro;
  }

  const controlador = new AbortController();
  const disparo = setTimeout(() => controlador.abort(), restante);

  try {
    return await executar({
      sinal: controlador.signal,
      timeoutMs: restante,
      cabecalhos: { 'x-deadline-epoch-ms': String(prazo.limiteEm) },
    });
  } finally {
    clearTimeout(disparo);
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'O teto local na leitura do cabeçalho é a parte que costuma faltar. Sem ele, o serviço confia no prazo que o chamador enviou, e um cliente mal configurado que pede sessenta segundos consegue manter conexões ocupadas por sessenta segundos, o que anula toda a calibração feita internamente. O prazo propagado é um limite superior negociável para baixo, nunca um pedido que o serviço é obrigado a atender.',
        },
      ],
    },
    {
      title: 'Requisição paralela antecipada: quando a cauda justifica a cópia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe uma classe de latência que nenhuma calibração de timeout resolve: a cauda que não vem de degradação sistêmica e sim de variação individual. Uma instância que acabou de sofrer uma pausa de coletor de lixo, uma que perdeu o cache local depois de reiniciar, uma que caiu num nó com vizinho barulhento. Nesses casos a chamada específica é lenta enquanto o serviço como um todo está saudável, e esperar o timeout para depois repetir significa somar o tempo de espera ao tempo da nova tentativa.',
        },
        {
          type: 'paragraph',
          value:
            'A técnica que ataca isso é disparar uma segunda cópia da requisição antes de a primeira falhar, aceitando a primeira resposta que chegar e cancelando a outra. O ponto crítico é o gatilho: disparar a cópia imediatamente dobra o tráfego e a fatura para ganhar quase nada, porque a maioria das chamadas termina rápido. Disparar no percentil noventa e cinco significa que apenas cinco por cento das chamadas geram uma segunda requisição, o custo extra fica na mesma ordem de grandeza, e a cauda acima do p95 passa a ser cortada pela cópia.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Custo extra de requisições', 'Efeito no p99 do usuário', 'Quando não usar'],
          rows: [
            [
              'Retry só depois do timeout',
              'Apenas em caso de erro',
              'Piora: soma o timeout inteiro à nova tentativa',
              'Nunca abrir mão, é a rede de segurança final',
            ],
            [
              'Cópia paralela imediata',
              'Cem por cento',
              'Melhora bastante',
              'Quase sempre, o custo raramente compensa',
            ],
            [
              'Cópia disparada no p95',
              'Cerca de cinco por cento',
              'Melhora, corta a cauda de variação individual',
              'Operações com efeito colateral não idempotente',
            ],
            [
              'Cópia disparada no p99',
              'Cerca de um por cento',
              'Melhora pouco, atua tarde demais',
              'Quando o alvo do trabalho é justamente o p99',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A restrição que elimina a técnica em boa parte dos casos é a idempotência. Duas cópias de uma leitura são inofensivas, duas cópias de uma cobrança são um incidente financeiro. Mesmo com cancelamento implementado, a corrida existe: a segunda cópia pode chegar ao servidor e ser processada antes de o cancelamento ser observado. Por isso a cópia paralela só é aplicável a operações de leitura ou a escritas protegidas por chave de idempotência de ponta a ponta.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar também a interação com o orçamento de retry. A cópia antecipada é carga adicional pela mesma lógica que o retry, e precisa consumir o mesmo orçamento. Um sistema com orçamento de retry bem configurado mas com cópia antecipada fora dele continua amplificando carga durante o incidente, só que por um caminho que o painel de retry não mostra.',
        },
      ],
    },
    {
      title: 'Provar a calibração antes do incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A calibração é uma hipótese sobre o comportamento do sistema sob uma condição que ainda não aconteceu, e existem exatamente três verificações que a transformam em fato. A primeira é comparar o timeout configurado com o p99 medido de forma automática e contínua, porque a latência da dependência muda com o tempo e um timeout que estava certo há seis meses pode ter ficado abaixo do p99 atual sem que ninguém tenha mexido em nada.',
        },
        {
          type: 'paragraph',
          value:
            'A segunda é medir o tempo de ocupação do pool sob a hipótese de degradação, e não sob tráfego normal. Isso é um teste de carga com a dependência substituída por um duplo que responde no timeout configurado em vez de na latência normal. O critério de aprovação é simples: com a dependência em degradação total, o serviço continua respondendo às rotas que não dependem dela. Se o pool esgota e rotas independentes começam a falhar, a calibração está errada, independentemente de o número parecer razoável.',
        },
        {
          type: 'code',
          value: `// test/calibragem-timeout.test.js
// Verifica as duas propriedades que a calibragem promete: o timeout nao
// corta trafego saudavel, e a degradacao da dependencia nao vira carga
// extra sobre ela justamente quando ela tem menos capacidade.

import { calibrarTimeout } from '../src/http/calibragem.js';
import { criarOrcamentoRetry } from '../src/resiliencia/orcamento-retry.js';

describe('calibragem de timeout', () => {
  it('mantem o timeout acima do p99 medido da dependencia', () => {
    // Valores vindos do histograma de producao da ultima semana saudavel.
    const perfil = { p99Ms: 180, prazoUsuarioMs: 1500, tentativas: 2 };
    const config = calibrarTimeout(perfil);

    expect(config.leituraMs).toBeGreaterThan(perfil.p99Ms);
    expect(config.alerta).toBeNull();
  });

  it('reduz tentativas em vez de encurtar o timeout quando o prazo aperta', () => {
    // Prazo curto: nao cabem 3 tentativas de 252ms. A resposta correta e
    // avisar e reduzir tentativas, nunca comprimir o timeout ate caber.
    const config = calibrarTimeout({ p99Ms: 180, prazoUsuarioMs: 600, tentativas: 3 });

    expect(config.leituraMs).toBeGreaterThan(180);
    expect(config.tentativas).toBeLessThan(3);
    expect(config.alerta).toContain('comporta');
  });

  it('esgota o orcamento de retry quando a falha e generalizada', () => {
    let relogio = 0;
    const orcamento = criarOrcamentoRetry({
      janelaMs: 10000,
      razaoMaxima: 0.1,
      minimoPorSegundo: 3,
      agora: () => relogio,
    });

    // 1000 requisicoes originais, todas falhando. Sem orcamento seriam
    // 1000 tentativas extras, ou seja, 100% de carga adicional sobre a
    // dependencia que ja esta caindo. Com orcamento, o teto e 100.
    let autorizadas = 0;
    for (let i = 0; i < 1000; i += 1) {
      relogio += 5;
      orcamento.registrarOriginal();
      if (orcamento.tentarConsumir()) autorizadas += 1;
    }

    expect(autorizadas).toBeLessThanOrEqual(100);
    expect(orcamento.estado().razao).toBeLessThanOrEqual(0.1);
  });

  it('nao bloqueia retry em rota de trafego muito baixo', () => {
    let relogio = 0;
    const orcamento = criarOrcamentoRetry({
      janelaMs: 10000,
      razaoMaxima: 0.1,
      minimoPorSegundo: 3,
      agora: () => relogio,
    });

    // 2 requisicoes na janela: 10% arredondaria para zero tentativas.
    // O piso garante que a rota pouco usada ainda tem segunda chance.
    relogio += 100;
    orcamento.registrarOriginal();
    relogio += 100;
    orcamento.registrarOriginal();

    expect(orcamento.tentarConsumir()).toBe(true);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'A terceira verificação fecha o ciclo e é observacional em vez de testável: acompanhar a razão entre tentativas extras e requisições originais como métrica de primeira classe no painel. Ela tem uma propriedade útil que a taxa de erro não tem. A taxa de erro sobe quando o incidente já está acontecendo, enquanto a razão de retry sobe no minuto anterior, quando a dependência começou a degradar mas o retry ainda está mascarando isso do usuário. Um alerta sobre essa razão dá o tempo de reação que a taxa de erro não dá.',
        },
        {
          type: 'list',
          items: [
            'Timeout de conexão e de leitura são configurados separadamente, porque a resposta correta para cada falha é diferente.',
            'O timeout de leitura é derivado do p99 medido e recalculado quando o histograma muda, não fixado numa constante do código.',
            'O orçamento de retry é global por dependência, e a cópia paralela antecipada consome o mesmo orçamento.',
            'O prazo é absoluto, propagado por cabeçalho e limitado por um teto local em cada serviço que o recebe.',
            'Antes de chamar a dependência, o serviço compara o prazo restante com o p99 dela e falha rápido quando não cabe.',
            'A razão de retry está no painel com alerta próprio, porque ela se move antes da taxa de erro.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Qual timeout usar quando a dependência não tem histórico de latência medido?',
      answer:
        'A ausência de medição é o problema a resolver primeiro, e existe um valor provisório que evita tanto o corte de tráfego legítimo quanto a ocupação prolongada do pool enquanto a medição não existe. O ponto de partida é derivar do prazo do usuário e não da dependência: se o chamador tem um segundo e meio, uma tentativa de setecentos milissegundos com uma segunda dentro do que sobra é uma configuração defensável sem nenhum dado sobre a dependência, porque ela respeita o único número que você conhece com certeza. Junto disso, instrumente a chamada com histograma desde o primeiro dia, não com média, e revise o valor depois de uma semana de tráfego real. O erro que precisa ser evitado nesse período é adotar o padrão da biblioteca HTTP, que costuma ficar entre dez e sessenta segundos e existe para não surpreender quem baixa arquivos grandes, não para proteger um serviço interativo. Se a dependência é externa e tem contrato de nível de serviço publicado, o número do contrato serve como teto de sanidade, mas raramente como valor de configuração, porque ele descreve o pior caso aceitável comercialmente e não a latência típica.',
    },
    {
      question: 'Circuit breaker substitui o orçamento de retry?',
      answer:
        'Não, e a confusão entre os dois deixa uma lacuna que aparece exatamente no cenário mais comum de degradação. O disjuntor atua sobre a decisão binária de continuar chamando ou parar de chamar uma dependência, e ele funciona bem quando a falha é total ou quase total, porque nesse caso a taxa de erro cruza o limiar e o circuito abre. O orçamento de retry atua sobre a amplificação, e é ele que protege no cenário de degradação parcial, quando a dependência erra dez ou quinze por cento das chamadas: essa taxa costuma ficar abaixo do limiar do disjuntor, o circuito permanece fechado, e sem orçamento cada erro vira três chamadas até que a degradação parcial se torne total por efeito do próprio cliente. Na prática os dois convivem em camadas: o orçamento limita a carga extra enquanto a dependência ainda atende a maior parte do tráfego, e o disjuntor corta a comunicação quando ela deixou de atender. Vale acrescentar que o disjuntor precisa de um estado intermediário que deixa passar poucas chamadas de teste, senão a recuperação nunca é detectada e o circuito só fecha por tempo decorrido, o que costuma reabrir na primeira rajada.',
    },
    {
      question: 'Como calibrar timeout de chamadas para modelos de linguagem, onde a variância é enorme?',
      answer:
        'Chamadas para modelos generativos quebram a premissa central do método porque a latência não é uma propriedade da dependência e sim do tamanho da saída, o que torna o p99 agregado quase inútil como base de cálculo. O ajuste que funciona é parar de calibrar sobre o tempo total e passar a calibrar sobre o tempo até o primeiro token, que é a métrica estável e que de fato reflete a saúde do provedor, complementada por um timeout de inatividade entre tokens em vez de um teto para a resposta inteira. Uma resposta longa que está sendo transmitida continuamente é uma resposta saudável mesmo aos quarenta segundos, enquanto uma pausa de oito segundos sem nenhum token é sinal de problema mesmo que o total ainda esteja dentro do limite. Junto disso, o prazo total precisa existir como teto absoluto derivado do produto, e é onde o limite de tokens de saída entra como instrumento de controle de latência, porque ele é o único parâmetro que limita o pior caso de forma previsível. Retry nesse contexto também muda de natureza: repetir uma geração custa a chamada inteira de novo e frequentemente produz uma saída diferente, então a decisão de repetir precisa considerar custo e não só latência, e em muitos casos a resposta certa é cair para um modelo mais rápido em vez de repetir no mesmo.',
    },
  ],
  conclusion: {
    title: 'O número do timeout é uma decisão de produto disfarçada de configuração',
    description:
      'O valor padrão da biblioteca sobrevive anos porque nunca causa alerta em condição normal, e cobra tudo de uma vez no dia em que a dependência degrada. A saída não é escolher um número menor no chute, é derivar o número da distribuição medida, limitar o retry por orçamento compartilhado e propagar o prazo com desconto por toda a cadeia. Posso medir a distribuição de latência das suas dependências e recalibrar os timeouts sobre o p99 real, implementar o orçamento de retry por dependência com separação entre erro repetível e determinístico, introduzir a propagação de prazo absoluto com corte antecipado nos serviços mais profundos, e deixar no painel a razão de retry com alerta que dispara antes da taxa de erro.',
    cta: 'Falar sobre a calibração de timeouts do meu sistema',
  },
  related: [
    {
      label: 'Timeout em cascata e retry: quando o cliente derruba o serviço que ia se recuperar',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The configured timeout was thirty seconds and the median call took eighty milliseconds. Nobody chose that number: it came from the HTTP library default and survived four years of deploys because it never triggered an alert. On the day the dependency degraded, every request spent thirty seconds holding a pool connection, the pool drained in under a minute, and the whole service went down because of a dependency that was still serving most of its calls. This article shows how to derive the timeout value from the latency distribution instead of rounding to a comfortable number, why the retry budget has to be a fraction of traffic rather than a per request counter, which calculation defines how many attempts fit inside the user deadline, when a hedged request fixes the long tail and when it doubles the bill without improving anything, and which metric proves the calibration is right before the next incident.',
  sections: [
    {
      title: 'A timeout is not a safety margin, it is a declaration of surrender',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The intuition behind a generous timeout is that it avoids cutting off a request that was still going to succeed. That intuition treats the timeout as a safety net, and it is why values tend to grow over time: every time someone sees a deadline exceeded error on a legitimate case, the reflex is to raise the number. What that reading ignores is that the timeout does not protect the individual request, it protects the shared resource the request is holding while it waits. A pool connection, a server thread, a concurrency slot in the HTTP client, memory with the request body loaded.',
        },
        {
          type: 'paragraph',
          value:
            'The calculation that makes this concrete is the Little law applied to the connection pool. If the service receives a hundred requests per second, each one holds a connection for the dependency response time, and the pool has fifty connections, then the maximum response time the system tolerates without draining the pool is half a second. With a thirty second timeout, the dependency only needs to be slow for a few seconds for all fifty connections to be busy waiting, and from that point on the service rejects traffic that has nothing to do with that dependency. The generous timeout did not give the slow request a chance, it took down all the others.',
        },
        {
          type: 'paragraph',
          value:
            'Put differently: the timeout answers a business question, not an infrastructure one. The question is at what point this response stops having value for whoever asked. For a balance lookup on a checkout screen, that is somewhere between one and two seconds, because after that the user has already decided the site is broken. For a nightly reconciliation job, it can be ten minutes. Both cases may call exactly the same dependency, and configuring the same timeout for both is a mistake in two directions at once.',
        },
        {
          type: 'table',
          columns: ['Observed symptom', 'Common wrong diagnosis', 'Real cause', 'Correct adjustment'],
          rows: [
            [
              'Connection pool drained under a slow dependency',
              'Pool is too small',
              'Timeout larger than the sustainable holding time',
              'Lower the timeout to p99 plus margin, do not grow the pool',
            ],
            [
              'Deadline exceeded on a request that was going to work',
              'Timeout is too short',
              'Timeout below the real p99 of the dependency',
              'Measure the distribution and recalibrate on the percentile',
            ],
            [
              'Dependency does not recover after the spike',
              'Dependency lacks capacity',
              'Client retries multiplying load during degradation',
              'Retry budget as a fraction of traffic',
            ],
            [
              'User latency far above the sum of the steps',
              'Slow network',
              'Sequential attempts eating the user deadline',
              'Deadline propagated with a discount at each hop',
            ],
            [
              'Dependency bill grows with no traffic increase',
              'Price went up',
              'Hedged request firing on every call',
              'Fire the second copy only above p95',
            ],
          ],
        },
      ],
    },
    {
      title: 'Derive the number from the distribution, not from a round figure',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The procedure that replaces guessing has three inputs: the latency distribution of the dependency under healthy conditions, the deadline the caller has available, and the decision about how many attempts fit inside that deadline. The first input requires a histogram, not an average. The average latency of a dependency with a long tail is a number almost no real request experiences, and calibrating on it produces a timeout that cuts a large slice of legitimate traffic.',
        },
        {
          type: 'paragraph',
          value:
            'The practical rule that works is to set the timeout of an individual attempt at the ninety ninth percentile of healthy latency, multiplied by a factor between one point three and one point five. The ninety ninth percentile defines the point beyond which waiting stopped being normal behavior and became a signal that something is wrong with that specific call. The slack factor absorbs legitimate load variation between the day of measurement and the day of the incident, without getting anywhere near a number that allows prolonged pool occupancy.',
        },
        {
          type: 'paragraph',
          value:
            'One detail that changes the result is that the timeout has to be split into phases, because a single connect plus read timeout hides where the time went. A connection failure signals an unavailable instance and should be fast, typically a few hundred milliseconds, because in that case trying another instance immediately is the right answer. A read failure signals that the server accepted the work and is taking its time, and in that case repeating the call will probably find the same server in the same state. Treating both with the same number makes the client retry what it should not and give up on what it should wait for.',
        },
        {
          type: 'code',
          value: `// http/calibration.js
// Derives the timeout from the measured distribution, not from a round
// number. The input is the HEALTHY latency histogram of the dependency,
// collected in a window with no incident. Calibrating on a window that
// already contains degradation inflates p99 and yields a timeout that
// never protects anything.

const P99_SLACK = 1.4;        // absorbs load variation between measurement and prod
const CONNECT_CAP_MS = 400;   // connection failure is binary: the instance answers or not

/**
 * @param {object} profile
 * @param {number} profile.p99Ms          p99 of healthy end to end latency
 * @param {number} profile.userDeadlineMs how long the response still has value
 * @param {number} profile.attempts       how many attempts we want to allow
 */
export const calibrateTimeout = ({ p99Ms, userDeadlineMs, attempts = 2 }) => {
  const perAttempt = Math.ceil(p99Ms * P99_SLACK);

  // The user deadline is the absolute cap: allowing three 250ms attempts is
  // pointless if checkout gives up at 600ms. The split reserves a slice for
  // network and serialization overhead between attempts.
  const overheadPerAttempt = 30;
  const capPerAttempt = Math.floor(
    (userDeadlineMs - overheadPerAttempt * attempts) / attempts,
  );

  if (capPerAttempt < perAttempt) {
    // The deadline does not fit the requested number of attempts. Shrinking
    // the timeout until it fits is the wrong move: it would start cutting
    // legitimate traffic. The correct adjustment is to reduce attempts, and
    // that decision is made explicit.
    const feasibleAttempts = Math.floor(
      userDeadlineMs / (perAttempt + overheadPerAttempt),
    );

    return {
      connectMs: Math.min(CONNECT_CAP_MS, perAttempt),
      readMs: perAttempt,
      attempts: Math.max(1, feasibleAttempts),
      warning: \`a \${userDeadlineMs}ms deadline fits \${Math.max(1, feasibleAttempts)} attempt(s), not \${attempts}\`,
    };
  }

  return {
    connectMs: Math.min(CONNECT_CAP_MS, perAttempt),
    readMs: perAttempt,
    attempts,
    warning: null,
  };
};

// Checkout balance lookup: p99 of 180ms, user gives up at 1500ms.
// -> connect 252ms, read 252ms, 2 attempts, still with slack in the deadline.
// With the library default of 30s, a single slow attempt consumes twenty
// times the deadline the user is willing to wait.`,
        },
        {
          type: 'paragraph',
          value:
            'The interesting case in that function is the branch that emits a warning. When the user deadline does not fit the requested number of attempts, there is a temptation to solve it by shrinking each attempt timeout until it fits. That is the move that turns a reasonable configuration into an error machine: the timeout starts cutting traffic that was healthy, the client sees a failure, the retry fires, and the system generates extra load for calls that would have worked. The correct choice is to reduce the number of attempts and make that explicit, because this is a product decision about how long the user waits, not an infrastructure parameter.',
        },
      ],
    },
    {
      title: 'Per request retry multiplies load, budgeted retry does not',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The classic configuration of three attempts per request looks conservative when you look at a single request in isolation. It stops being conservative at the exact moment the error rate rises, because at that moment the load on the degraded dependency is multiplied by three. A dependency that was at eighty percent utilization and started failing ten percent of calls receives, with naive retry, a hundred and twenty percent of the original load. It will not recover on its own, because the client is adding load in exact proportion to the degradation.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to treat retry as a scarce resource shared across all requests rather than an individual right. The retry budget pattern keeps a sliding window with the count of original requests and of extra attempts, and only authorizes a new attempt if the ratio is below a cap, typically ten percent. The practical effect is that when the failure rate is low, virtually every error is retried and the user never notices. When the failure rate explodes, the budget is exhausted within the first moments and the client stops retrying, delivering a fast error instead of amplifying the incident.',
        },
        {
          type: 'code',
          value: `// resilience/retry-budget.js
// Retry as a shared resource, not as a right of each request.
// Sliding window: the ratio of extra attempts to original requests never
// exceeds the cap. Under widespread failure the budget dries up on its own.

export const createRetryBudget = ({
  windowMs = 10000,
  maxRatio = 0.1,        // at most 10% extra load on top of original traffic
  minPerSecond = 3,      // still allows retry on very low traffic routes
  now,
}) => {
  const originals = [];
  const extras = [];

  const prune = (t) => {
    const cutoff = t - windowMs;
    while (originals.length && originals[0] <= cutoff) originals.shift();
    while (extras.length && extras[0] <= cutoff) extras.shift();
  };

  return {
    recordOriginal() {
      const t = now();
      prune(t);
      originals.push(t);
    },

    /**
     * Authorizes (or not) one more attempt. Consumes the budget when it
     * authorizes, so two concurrent requests do not spend the same balance.
     * Returning false fast is a valid answer, not a failure.
     */
    tryConsume() {
      const t = now();
      prune(t);

      const floor = (minPerSecond * windowMs) / 1000;
      const cap = Math.max(floor, originals.length * maxRatio);

      if (extras.length >= cap) return false;

      extras.push(t);
      return true;
    },

    state() {
      const t = now();
      prune(t);
      return {
        originals: originals.length,
        extras: extras.length,
        ratio: originals.length ? extras.length / originals.length : 0,
      };
    },
  };
};

// Errors that must NOT consume budget or generate an attempt: any response
// the server produced deliberately about the request content. Retrying a
// 400 generates guaranteed load with no chance of success.
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export const isRetryable = (error) => {
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') return true;
  if (error.status === undefined) return false;
  return RETRYABLE.has(error.status);
};`,
        },
        {
          type: 'paragraph',
          value:
            'The floor of attempts per second exists for a reason that only shows up on low traffic services. With a ten percent maximum ratio and a route that receives three requests per minute, the budget would never authorize a single attempt, because ten percent of a very small number rounds to zero. The floor makes sure that protection against amplification does not become a total ban on retries for rarely used routes, which are precisely the ones that benefit most from a second chance.',
        },
        {
          type: 'paragraph',
          value:
            'The second piece is the separation between retryable and deterministic errors. Retrying a four hundred and one or a four hundred and twenty two is guaranteed spend with no chance of success, because the server evaluated the request and refused it based on its content. The ambiguous case is four hundred and twenty nine, which is a deliberate refusal but carries the instruction for when to try again. It should be retried, but honoring the wait header indicated by the server, never with the interval computed by the client.',
        },
      ],
    },
    {
      title: 'The deadline has to cross the chain with a discount',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Calibrating one service in isolation does not survive composition. When the user request crosses four services and each one sets its own timeout locally, the result is a sum nobody configured and that almost always exceeds the user deadline by a wide margin. The problem becomes visible in the most wasteful behavior possible: the deepest service in the chain keeps processing a request whose caller already gave up, holding resources to produce a response nobody will read.',
        },
        {
          type: 'paragraph',
          value:
            'The fix is to propagate the absolute deadline rather than the relative remaining time. Each service receives a limit instant, subtracts the time it consumed locally, and passes a smaller deadline downstream. Before starting any call, it checks whether the remaining deadline is enough for that call to have a chance of finishing; if not, it fails immediately without touching the dependency. That upfront check is what produces the largest gain during an incident, because it turns guaranteed useless work into an instant error.',
        },
        {
          type: 'diagram',
          value: `Without deadline propagation (each service with a local 3s timeout)

  user  gives up at 2s
    |
    v
  gateway ----3s----> orders ----3s----> inventory ----3s----> supplier
    |                   |                    |                     |
  [2s] X                |                    |                     |
  user is gone          v                    v                     v
                   still working        still working        still working
                   up to 9s worst case, producing a response for nobody

With an absolute deadline propagated (limit = t0 + 1900ms)

  t0         gateway spends 40ms    -> 1860ms left
  t0+40ms    orders spends 120ms    -> 1740ms left
  t0+160ms   inventory needs 250ms (supplier p99) -> it fits, go ahead
  t0+410ms   supplier answers
  t0+520ms   response reaches the user, inside the deadline

Early cut case

  t0+1800ms  inventory receives a request with 100ms left
             supplier p99 is 250ms -> does not fit
             immediate failure, the supplier is never called
             saved: a 250ms call that would have been discarded`,
        },
        {
          type: 'code',
          value: `// context/deadline.js
// ABSOLUTE deadline propagated through the chain. Relative does not work:
// the "remaining" computed at the gateway is already stale by the third hop.

export const createDeadline = ({ limitAt, now }) => ({
  limitAt,
  remainingMs: () => Math.max(0, limitAt - now()),
  expired: () => now() >= limitAt,
});

export const deadlineFromHeaders = (headers, { now, defaultMs }) => {
  // Absolute format in epoch ms. Preferred over a relative "x-timeout-ms"
  // because it does not accumulate each hop network time as error.
  const raw = headers['x-deadline-epoch-ms'];
  const parsed = raw ? Number(raw) : NaN;

  if (!Number.isFinite(parsed)) {
    return createDeadline({ limitAt: now() + defaultMs, now });
  }

  // Local cap: a caller cannot ask for a longer deadline than this service
  // is willing to hold resources for. Without this cap, a misconfigured
  // client keeps connections busy for as long as it wants and cancels out
  // all the calibration done in here.
  return createDeadline({ limitAt: Math.min(parsed, now() + defaultMs), now });
};

/**
 * Runs the call only if the remaining deadline fits its p99.
 * This is the cut that saves the most during an incident: work that would
 * be discarded at the end never even starts.
 */
export const callWithDeadline = async (deadline, { p99Ms, run, name }) => {
  const remaining = deadline.remainingMs();

  if (remaining < p99Ms) {
    const error = new Error(\`insufficient deadline for \${name}\`);
    error.code = 'INSUFFICIENT_DEADLINE';
    error.remainingMs = remaining;
    error.requiredMs = p99Ms;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), remaining);

  try {
    return await run({
      signal: controller.signal,
      timeoutMs: remaining,
      headers: { 'x-deadline-epoch-ms': String(deadline.limitAt) },
    });
  } finally {
    clearTimeout(timer);
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'The local cap when reading the header is the part that usually goes missing. Without it, the service trusts the deadline the caller sent, and a misconfigured client asking for sixty seconds manages to keep connections busy for sixty seconds, which cancels out all the calibration done internally. The propagated deadline is an upper bound negotiable downward, never a request the service is obliged to honor.',
        },
      ],
    },
    {
      title: 'Hedged requests: when the tail justifies the copy',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There is a class of latency no timeout calibration solves: the tail that does not come from systemic degradation but from individual variance. An instance that just went through a garbage collection pause, one that lost its local cache after restarting, one that landed on a node with a noisy neighbor. In those cases the specific call is slow while the service as a whole is healthy, and waiting for the timeout before retrying means adding the wait time to the time of the new attempt.',
        },
        {
          type: 'paragraph',
          value:
            'The technique that attacks this is firing a second copy of the request before the first one fails, taking whichever response arrives first and cancelling the other. The critical point is the trigger: firing the copy immediately doubles traffic and the bill to gain almost nothing, because most calls finish fast. Firing at the ninety fifth percentile means only five percent of calls generate a second request, the extra cost stays in the same order of magnitude, and the tail above p95 gets cut by the copy.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'Extra request cost', 'Effect on user p99', 'When not to use it'],
          rows: [
            [
              'Retry only after the timeout',
              'Only on error',
              'Worse: adds the full timeout to the new attempt',
              'Never drop it, it is the final safety net',
            ],
            [
              'Immediate parallel copy',
              'One hundred percent',
              'Improves a lot',
              'Almost always, the cost rarely pays off',
            ],
            [
              'Copy fired at p95',
              'Around five percent',
              'Improves, cuts the individual variance tail',
              'Operations with non idempotent side effects',
            ],
            [
              'Copy fired at p99',
              'Around one percent',
              'Improves little, acts too late',
              'When the target of the work is precisely p99',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The constraint that rules the technique out in many cases is idempotency. Two copies of a read are harmless, two copies of a charge are a financial incident. Even with cancellation implemented, the race exists: the second copy may reach the server and be processed before the cancellation is observed. That is why the parallel copy only applies to read operations or to writes protected by an end to end idempotency key.',
        },
        {
          type: 'paragraph',
          value:
            'It is also worth noting the interaction with the retry budget. The hedged copy is additional load by the same logic as retry, and it has to consume the same budget. A system with a well configured retry budget but with hedging outside of it keeps amplifying load during the incident, only through a path the retry dashboard does not show.',
        },
      ],
    },
    {
      title: 'Proving the calibration before the incident',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Calibration is a hypothesis about system behavior under a condition that has not happened yet, and there are exactly three checks that turn it into fact. The first is comparing the configured timeout against the measured p99 automatically and continuously, because dependency latency changes over time and a timeout that was right six months ago may have drifted below the current p99 without anyone touching anything.',
        },
        {
          type: 'paragraph',
          value:
            'The second is measuring pool occupancy under the degradation hypothesis, not under normal traffic. That is a load test with the dependency replaced by a double that answers at the configured timeout instead of at normal latency. The acceptance criterion is simple: with the dependency in full degradation, the service keeps answering the routes that do not depend on it. If the pool drains and independent routes start failing, the calibration is wrong, regardless of how reasonable the number looks.',
        },
        {
          type: 'code',
          value: `// test/timeout-calibration.test.js
// Verifies the two properties calibration promises: the timeout does not
// cut healthy traffic, and dependency degradation does not turn into extra
// load on it exactly when it has the least capacity.

import { calibrateTimeout } from '../src/http/calibration.js';
import { createRetryBudget } from '../src/resilience/retry-budget.js';

describe('timeout calibration', () => {
  it('keeps the timeout above the measured dependency p99', () => {
    // Values taken from the production histogram of the last healthy week.
    const profile = { p99Ms: 180, userDeadlineMs: 1500, attempts: 2 };
    const config = calibrateTimeout(profile);

    expect(config.readMs).toBeGreaterThan(profile.p99Ms);
    expect(config.warning).toBeNull();
  });

  it('reduces attempts instead of shrinking the timeout when the deadline is tight', () => {
    // Tight deadline: three 252ms attempts do not fit. The correct answer is
    // to warn and reduce attempts, never to compress the timeout until it fits.
    const config = calibrateTimeout({ p99Ms: 180, userDeadlineMs: 600, attempts: 3 });

    expect(config.readMs).toBeGreaterThan(180);
    expect(config.attempts).toBeLessThan(3);
    expect(config.warning).toContain('fits');
  });

  it('exhausts the retry budget when failure is widespread', () => {
    let clock = 0;
    const budget = createRetryBudget({
      windowMs: 10000,
      maxRatio: 0.1,
      minPerSecond: 3,
      now: () => clock,
    });

    // 1000 original requests, all failing. Without a budget that would be
    // 1000 extra attempts, meaning 100% additional load on the dependency
    // that is already going down. With a budget, the cap is 100.
    let authorized = 0;
    for (let i = 0; i < 1000; i += 1) {
      clock += 5;
      budget.recordOriginal();
      if (budget.tryConsume()) authorized += 1;
    }

    expect(authorized).toBeLessThanOrEqual(100);
    expect(budget.state().ratio).toBeLessThanOrEqual(0.1);
  });

  it('does not block retry on a very low traffic route', () => {
    let clock = 0;
    const budget = createRetryBudget({
      windowMs: 10000,
      maxRatio: 0.1,
      minPerSecond: 3,
      now: () => clock,
    });

    // 2 requests in the window: 10% would round down to zero attempts.
    // The floor makes sure the rarely used route still gets a second chance.
    clock += 100;
    budget.recordOriginal();
    clock += 100;
    budget.recordOriginal();

    expect(budget.tryConsume()).toBe(true);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'The third check closes the loop and is observational rather than testable: tracking the ratio of extra attempts to original requests as a first class metric on the dashboard. It has a useful property the error rate does not have. The error rate rises when the incident is already happening, whereas the retry ratio rises a minute earlier, when the dependency started degrading but retries are still hiding it from the user. An alert on that ratio buys the reaction time the error rate does not give.',
        },
        {
          type: 'list',
          items: [
            'Connect and read timeouts are configured separately, because the correct response to each failure is different.',
            'The read timeout is derived from the measured p99 and recomputed when the histogram moves, not frozen in a code constant.',
            'The retry budget is global per dependency, and the hedged copy consumes the same budget.',
            'The deadline is absolute, propagated by header and bounded by a local cap in every service that receives it.',
            'Before calling the dependency, the service compares the remaining deadline against its p99 and fails fast when it does not fit.',
            'The retry ratio is on the dashboard with its own alert, because it moves before the error rate does.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Which timeout should I use when the dependency has no measured latency history?',
      answer:
        'The absence of measurement is the problem to solve first, and there is a provisional value that avoids both cutting legitimate traffic and holding the pool for too long while measurement does not exist. The starting point is to derive from the user deadline rather than from the dependency: if the caller has a second and a half, one seven hundred millisecond attempt with a second one inside what is left is a defensible configuration with no data about the dependency at all, because it respects the only number you know for sure. Alongside that, instrument the call with a histogram from day one, not with an average, and revisit the value after a week of real traffic. The mistake to avoid in that period is adopting the HTTP library default, which usually sits between ten and sixty seconds and exists so that people downloading large files are not surprised, not to protect an interactive service. If the dependency is external and has a published service level agreement, the contract number works as a sanity cap, but rarely as a configuration value, because it describes the worst commercially acceptable case and not typical latency.',
    },
    {
      question: 'Does a circuit breaker replace the retry budget?',
      answer:
        'No, and confusing the two leaves a gap that shows up in exactly the most common degradation scenario. The breaker acts on the binary decision to keep calling or stop calling a dependency, and it works well when the failure is total or nearly total, because in that case the error rate crosses the threshold and the circuit opens. The retry budget acts on amplification, and it is what protects in the partial degradation scenario, when the dependency fails ten or fifteen percent of calls: that rate usually stays below the breaker threshold, the circuit stays closed, and without a budget every error becomes three calls until partial degradation turns total through the fault of the client itself. In practice the two coexist in layers: the budget limits extra load while the dependency still serves most of the traffic, and the breaker cuts communication once it stopped serving. It is worth adding that the breaker needs an intermediate state that lets a few probe calls through, otherwise recovery is never detected and the circuit only closes on elapsed time, which tends to reopen on the first burst.',
    },
    {
      question: 'How do I calibrate timeouts for language model calls, where variance is enormous?',
      answer:
        'Calls to generative models break the central premise of the method because latency is not a property of the dependency but of the output size, which makes the aggregate p99 nearly useless as a basis for calculation. The adjustment that works is to stop calibrating on total time and start calibrating on time to first token, which is the stable metric and actually reflects provider health, complemented by an inactivity timeout between tokens instead of a cap on the whole response. A long response being streamed continuously is a healthy response even at forty seconds, whereas an eight second pause with no tokens is a sign of trouble even if the total is still within the limit. Alongside that, the total deadline still has to exist as an absolute cap derived from the product, and that is where the output token limit comes in as a latency control instrument, because it is the only parameter that bounds the worst case predictably. Retry in this context also changes nature: repeating a generation costs the entire call again and often produces a different output, so the decision to retry has to weigh cost and not only latency, and in many cases the right answer is to fall back to a faster model instead of retrying on the same one.',
    },
  ],
  conclusion: {
    title: 'The timeout number is a product decision disguised as configuration',
    description:
      'The library default survives for years because it never triggers an alert under normal conditions, and it charges for everything at once on the day the dependency degrades. The way out is not picking a smaller number by guesswork, it is deriving the number from the measured distribution, bounding retries with a shared budget and propagating the deadline with a discount across the whole chain. I can measure the latency distribution of your dependencies and recalibrate the timeouts on the real p99, implement the per dependency retry budget with separation between retryable and deterministic errors, introduce absolute deadline propagation with early cuts in the deepest services, and leave the retry ratio on the dashboard with an alert that fires before the error rate.',
    cta: 'Talk about the timeout calibration in my system',
  },
  related: [
    {
      label: 'Cascading timeouts and retries: when the client takes down the service that was recovering',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Backpressure in AI pipelines: when the consumer cannot keep up',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observability and reliability',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El timeout configurado era de treinta segundos y la mediana de la llamada era de ochenta milisegundos. Nadie eligió ese número: vino del valor por defecto de la biblioteca HTTP y sobrevivió a cuatro años de despliegues porque nunca provocó una alerta. El día en que la dependencia se degradó, cada petición pasó treinta segundos ocupando una conexión del pool, el pool se agotó en menos de un minuto y el servicio entero se cayó por una dependencia que todavía respondía la mayor parte de las llamadas. Este artículo muestra cómo derivar el valor del timeout a partir de la distribución de latencia en vez de redondear a un número cómodo, por qué el presupuesto de reintentos tiene que ser una fracción del tráfico y no un contador por petición, qué cuenta define cuántos intentos caben dentro del plazo del usuario, cuándo la petición paralela anticipada resuelve la cola larga y cuándo duplica la factura sin mejorar nada, y qué métrica demuestra que la calibración es correcta antes del próximo incidente.',
  sections: [
    {
      title: 'El timeout no es un margen de seguridad, es una declaración de rendición',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La intuición detrás de un timeout generoso es que evita cortar una petición que todavía iba a funcionar. Esa intuición trata al timeout como una red de protección, y por eso los valores tienden a subir con el tiempo: cada vez que alguien ve un error de plazo agotado en un caso legítimo, el reflejo es aumentar el número. Lo que esa lectura ignora es que el timeout no protege a la petición individual, protege al recurso compartido que la petición retiene mientras espera. Una conexión del pool, un hilo del servidor, un espacio de concurrencia del cliente HTTP, memoria con el cuerpo de la petición cargado.',
        },
        {
          type: 'paragraph',
          value:
            'La cuenta que vuelve esto concreto es la ley de Little aplicada al pool de conexiones. Si el servicio recibe cien peticiones por segundo, cada una retiene una conexión durante el tiempo de respuesta de la dependencia, y el pool tiene cincuenta conexiones, entonces el tiempo máximo de respuesta que el sistema tolera sin agotar el pool es de medio segundo. Con un timeout de treinta segundos, basta con que la dependencia se ponga lenta durante unos segundos para que las cincuenta conexiones estén ocupadas esperando, y a partir de ahí el servicio rechaza tráfico que no tiene nada que ver con esa dependencia. El timeout generoso no le dio una oportunidad a la petición lenta, tumbó a todas las demás.',
        },
        {
          type: 'paragraph',
          value:
            'Dicho de otro modo: el timeout responde a una pregunta de negocio, no de infraestructura. La pregunta es a partir de cuánto tiempo esa respuesta deja de tener valor para quien la pidió. Para una consulta de saldo en pantalla de checkout, eso está entre uno y dos segundos, porque después de ahí el usuario ya decidió que el sitio está roto. Para un proceso nocturno de conciliación, pueden ser diez minutos. Los dos casos pueden llamar exactamente a la misma dependencia, y configurar el mismo timeout para ambos es un error en las dos direcciones a la vez.',
        },
        {
          type: 'table',
          columns: ['Síntoma observado', 'Diagnóstico erróneo común', 'Causa real', 'Ajuste correcto'],
          rows: [
            [
              'Pool de conexiones agotado con dependencia lenta',
              'El pool es demasiado pequeño',
              'Timeout mayor que el tiempo de ocupación sostenible',
              'Bajar el timeout al p99 más margen, no agrandar el pool',
            ],
            [
              'Plazo agotado en una petición que iba a funcionar',
              'El timeout es demasiado corto',
              'Timeout por debajo del p99 real de la dependencia',
              'Medir la distribución y recalibrar sobre el percentil',
            ],
            [
              'La dependencia no se recupera después del pico',
              'La dependencia no tiene capacidad',
              'El reintento del cliente multiplica la carga durante la degradación',
              'Presupuesto de reintentos como fracción del tráfico',
            ],
            [
              'Latencia del usuario muy por encima de la suma de las etapas',
              'Red lenta',
              'Intentos secuenciales consumiendo el plazo del usuario',
              'Plazo propagado con descuento en cada salto',
            ],
            [
              'La factura de la dependencia sube sin aumento de tráfico',
              'Subieron el precio',
              'Petición paralela anticipada disparándose siempre',
              'Disparar la segunda copia solo por encima del p95',
            ],
          ],
        },
      ],
    },
    {
      title: 'Derivar el número de la distribución, no del número redondo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El procedimiento que reemplaza a la conjetura tiene tres entradas: la distribución de latencia de la dependencia en condición saludable, el plazo del que dispone quien llama, y la decisión sobre cuántos intentos caben dentro de ese plazo. La primera entrada exige histograma y no promedio. El promedio de latencia de una dependencia con cola larga es un número que casi ninguna petición real experimenta, y calibrar sobre él produce un timeout que corta una porción grande del tráfico legítimo.',
        },
        {
          type: 'paragraph',
          value:
            'La regla práctica que funciona es fijar el timeout de un intento individual en el percentil noventa y nueve de la latencia saludable, multiplicado por un factor entre uno coma tres y uno coma cinco. El percentil noventa y nueve define el punto a partir del cual la espera dejó de ser comportamiento normal y pasó a ser señal de que algo anda mal con esa llamada específica. El factor de holgura absorbe la variación legítima de carga entre el día de la medición y el día del incidente, sin acercarse a un número que permita ocupación prolongada del pool.',
        },
        {
          type: 'paragraph',
          value:
            'Un detalle que cambia el resultado es que el timeout tiene que dividirse en fases, porque un timeout único de conexión más lectura esconde dónde se fue el tiempo. Un fallo de conexión indica instancia no disponible y debe ser rápido, típicamente unos cientos de milisegundos, porque en ese caso probar con otra instancia de inmediato es la respuesta correcta. Un fallo de lectura indica que el servidor aceptó el trabajo y está tardando, y en ese caso repetir la llamada probablemente encuentre al mismo servidor en el mismo estado. Tratar a ambos con el mismo número hace que el cliente repita lo que no debería y se rinda con lo que debería esperar.',
        },
        {
          type: 'code',
          value: `// http/calibracion.js
// Deriva el timeout de la distribucion medida, no de un numero redondo.
// La entrada es el histograma de latencia SALUDABLE de la dependencia,
// recogido en una ventana sin incidente. Calibrar sobre una ventana con
// degradacion incorporada infla el p99 y produce un timeout que nunca
// protege nada.

const HOLGURA_P99 = 1.4;      // absorbe variacion de carga entre medicion y produccion
const TOPE_CONEXION_MS = 400; // el fallo de conexion es binario: la instancia responde o no

/**
 * @param {object} perfil
 * @param {number} perfil.p99Ms            p99 de la latencia saludable, de punta a punta
 * @param {number} perfil.plazoUsuarioMs   cuanto tiempo la respuesta sigue valiendo
 * @param {number} perfil.intentos         cuantos intentos se quiere permitir
 */
export const calibrarTimeout = ({ p99Ms, plazoUsuarioMs, intentos = 2 }) => {
  const porIntento = Math.ceil(p99Ms * HOLGURA_P99);

  // El plazo del usuario es el tope absoluto: no sirve permitir tres
  // intentos de 250ms si el checkout se rinde a los 600ms. La division
  // reserva una porcion para el overhead de red y serializacion.
  const overheadPorIntento = 30;
  const topePorIntento = Math.floor(
    (plazoUsuarioMs - overheadPorIntento * intentos) / intentos,
  );

  if (topePorIntento < porIntento) {
    // El plazo no admite la cantidad de intentos pedida. Reducir el timeout
    // hasta que quepa es la eleccion equivocada: empezaria a cortar trafico
    // legitimo. El ajuste correcto es reducir intentos, y esa decision
    // queda explicita.
    const intentosPosibles = Math.floor(
      plazoUsuarioMs / (porIntento + overheadPorIntento),
    );

    return {
      conexionMs: Math.min(TOPE_CONEXION_MS, porIntento),
      lecturaMs: porIntento,
      intentos: Math.max(1, intentosPosibles),
      alerta: \`un plazo de \${plazoUsuarioMs}ms admite \${Math.max(1, intentosPosibles)} intento(s), no \${intentos}\`,
    };
  }

  return {
    conexionMs: Math.min(TOPE_CONEXION_MS, porIntento),
    lecturaMs: porIntento,
    intentos,
    alerta: null,
  };
};

// Consulta de saldo en el checkout: p99 de 180ms, el usuario se rinde a
// los 1500ms. -> conexion 252ms, lectura 252ms, 2 intentos, con holgura.
// Con el timeout por defecto de 30s de la biblioteca, un unico intento
// lento consume veinte veces el plazo que el usuario acepta esperar.`,
        },
        {
          type: 'paragraph',
          value:
            'El caso interesante en esa función es la rama que emite alerta. Cuando el plazo del usuario no admite la cantidad de intentos pedida, existe la tentación de resolverlo reduciendo el timeout de cada intento hasta que quepa. Ese es el movimiento que convierte una configuración razonable en una máquina de errores: el timeout pasa a cortar tráfico que estaba sano, el cliente ve un fallo, el reintento se dispara, y el sistema genera carga extra para llamadas que habrían funcionado. La elección correcta es reducir la cantidad de intentos y dejarlo explícito, porque esta es una decisión de producto sobre cuánto espera el usuario, no un parámetro de infraestructura.',
        },
      ],
    },
    {
      title: 'El reintento por petición multiplica carga, el reintento por presupuesto no',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La configuración clásica de tres intentos por petición parece conservadora cuando se mira una petición aislada. Deja de ser conservadora en el momento exacto en que sube la tasa de error, porque en ese momento la carga sobre la dependencia degradada se multiplica por tres. Una dependencia que estaba al ochenta por ciento de utilización y empezó a fallar el diez por ciento de las llamadas recibe, con reintento ingenuo, el ciento veinte por ciento de la carga original. No se va a recuperar sola, porque el cliente está agregando carga en la proporción exacta de la degradación.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es tratar el reintento como un recurso escaso compartido entre todas las peticiones, y no como un derecho individual. El patrón de presupuesto de reintentos mantiene una ventana deslizante con el conteo de peticiones originales y de intentos adicionales, y solo autoriza un intento nuevo si la proporción está por debajo de un tope, típicamente el diez por ciento. El efecto práctico es que cuando la tasa de fallo es baja, prácticamente todo error se repite y el usuario ni lo nota. Cuando la tasa de fallo explota, el presupuesto se agota en los primeros instantes y el cliente deja de repetir, entregando un error rápido en vez de amplificar el incidente.',
        },
        {
          type: 'code',
          value: `// resiliencia/presupuesto-reintentos.js
// Reintento como recurso compartido, no como derecho de cada peticion.
// Ventana deslizante: la razon entre intentos extra y peticiones originales
// nunca supera el tope. Bajo fallo generalizado el presupuesto se seca solo.

export const crearPresupuestoReintentos = ({
  ventanaMs = 10000,
  razonMaxima = 0.1,     // como maximo 10% de carga extra sobre el trafico original
  minimoPorSegundo = 3,  // permite reintento incluso en rutas de trafico muy bajo
  ahora,
}) => {
  const originales = [];
  const extras = [];

  const podar = (t) => {
    const corte = t - ventanaMs;
    while (originales.length && originales[0] <= corte) originales.shift();
    while (extras.length && extras[0] <= corte) extras.shift();
  };

  return {
    registrarOriginal() {
      const t = ahora();
      podar(t);
      originales.push(t);
    },

    /**
     * Autoriza (o no) un intento mas. Consume el presupuesto cuando
     * autoriza, para que dos peticiones concurrentes no gasten el mismo
     * saldo. Devolver false rapido es una respuesta valida, no un fallo.
     */
    intentarConsumir() {
      const t = ahora();
      podar(t);

      const piso = (minimoPorSegundo * ventanaMs) / 1000;
      const tope = Math.max(piso, originales.length * razonMaxima);

      if (extras.length >= tope) return false;

      extras.push(t);
      return true;
    },

    estado() {
      const t = ahora();
      podar(t);
      return {
        originales: originales.length,
        extras: extras.length,
        razon: originales.length ? extras.length / originales.length : 0,
      };
    },
  };
};

// Errores que NO deben consumir presupuesto ni generar intento: cualquier
// respuesta que el servidor produjo deliberadamente sobre el contenido de
// la peticion. Repetir un 400 genera carga garantizada sin chance de exito.
const REPETIBLE = new Set([408, 429, 500, 502, 503, 504]);

export const esRepetible = (error) => {
  if (error.codigo === 'ECONNREFUSED' || error.codigo === 'ETIMEDOUT') return true;
  if (error.status === undefined) return false;
  return REPETIBLE.has(error.status);
};`,
        },
        {
          type: 'paragraph',
          value:
            'El piso de intentos por segundo existe por un motivo que solo aparece en servicios de bajo tráfico. Con un diez por ciento de razón máxima y una ruta que recibe tres peticiones por minuto, el presupuesto nunca autorizaría ningún intento, porque el diez por ciento de un número muy pequeño se redondea a cero. El piso garantiza que la protección contra la amplificación no se convierta en una prohibición total de reintentos en rutas poco usadas, que son justamente las que más se benefician de una segunda oportunidad.',
        },
        {
          type: 'paragraph',
          value:
            'La segunda pieza es la separación entre error repetible y error determinista. Repetir una respuesta de cuatrocientos uno o de cuatrocientos veintidós es gasto garantizado sin posibilidad de éxito, porque el servidor evaluó la petición y la rechazó por su contenido. El caso ambiguo es el cuatrocientos veintinueve, que es un rechazo deliberado pero que trae la instrucción de cuándo intentar de nuevo. Debe repetirse, pero honrando la cabecera de espera indicada por el servidor, y nunca con el intervalo calculado por el cliente.',
        },
      ],
    },
    {
      title: 'El plazo tiene que atravesar la cadena con descuento',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La calibración de un servicio aislado no sobrevive a la composición. Cuando la petición del usuario atraviesa cuatro servicios y cada uno define su propio timeout localmente, el resultado es una suma que nadie configuró y que casi siempre excede el plazo del usuario por un margen grande. El problema se vuelve visible en el comportamiento más desperdiciador posible: el servicio más profundo de la cadena sigue procesando una petición cuyo llamador ya se rindió, ocupando recursos para producir una respuesta que nadie va a leer.',
        },
        {
          type: 'paragraph',
          value:
            'La corrección es propagar el plazo absoluto y no el tiempo restante relativo. Cada servicio recibe un instante límite, resta el tiempo que ya consumió localmente, y pasa hacia adelante un plazo menor. Antes de iniciar cualquier llamada, verifica si el plazo restante alcanza para que esa llamada tenga chance de terminar; si no alcanza, falla de inmediato sin tocar la dependencia. Esa verificación previa es la que produce la mayor ganancia durante un incidente, porque convierte trabajo garantizadamente inútil en un error instantáneo.',
        },
        {
          type: 'diagram',
          value: `Sin propagacion de plazo (cada servicio con timeout local de 3s)

  usuario  se rinde a los 2s
     |
     v
  gateway ----3s----> pedidos ----3s----> stock ----3s----> proveedor
     |                   |                  |                   |
   [2s] X                |                  |                   |
   el usuario ya no esta v                  v                   v
                    sigue trabajando   sigue trabajando   sigue trabajando
                    hasta 9s en el peor caso, para nadie

Con plazo absoluto propagado (limite = t0 + 1900ms)

  t0         gateway consume 40ms   -> quedan 1860ms
  t0+40ms    pedidos consume 120ms  -> quedan 1740ms
  t0+160ms   stock necesita 250ms (p99 del proveedor) -> cabe, sigue
  t0+410ms   el proveedor responde
  t0+520ms   la respuesta llega al usuario, dentro del plazo

Caso de corte anticipado

  t0+1800ms  stock recibe la peticion con 100ms restantes
             el p99 del proveedor es 250ms -> no cabe
             fallo inmediato, al proveedor ni se lo llama
             ahorro: una llamada de 250ms que se iba a descartar`,
        },
        {
          type: 'code',
          value: `// contexto/plazo.js
// Plazo ABSOLUTO propagado por la cadena. El relativo no funciona: el
// "restante" calculado en el gateway ya esta viejo en el tercer salto.

export const crearPlazo = ({ limiteEn, ahora }) => ({
  limiteEn,
  restanteMs: () => Math.max(0, limiteEn - ahora()),
  expiro: () => ahora() >= limiteEn,
});

export const plazoDeCabeceras = (cabeceras, { ahora, pordefectoMs }) => {
  // Formato absoluto en epoch ms. Preferido a un "x-timeout-ms" relativo
  // porque no acumula el tiempo de red de cada salto como error.
  const bruto = cabeceras['x-deadline-epoch-ms'];
  const analizado = bruto ? Number(bruto) : NaN;

  if (!Number.isFinite(analizado)) {
    return crearPlazo({ limiteEn: ahora() + pordefectoMs, ahora });
  }

  // Tope local: quien llama no puede pedir un plazo mayor del que este
  // servicio esta dispuesto a retener recursos. Sin ese tope, un cliente
  // mal configurado mantiene conexiones ocupadas el tiempo que quiera y
  // anula toda la calibracion hecha aca adentro.
  return crearPlazo({ limiteEn: Math.min(analizado, ahora() + pordefectoMs), ahora });
};

/**
 * Ejecuta la llamada solo si el plazo restante admite su p99.
 * Este es el corte que mas ahorra durante un incidente: el trabajo que
 * seria descartado al final ni siquiera empieza.
 */
export const llamarConPlazo = async (plazo, { p99Ms, ejecutar, nombre }) => {
  const restante = plazo.restanteMs();

  if (restante < p99Ms) {
    const error = new Error(\`plazo insuficiente para \${nombre}\`);
    error.codigo = 'PLAZO_INSUFICIENTE';
    error.restanteMs = restante;
    error.necesarioMs = p99Ms;
    throw error;
  }

  const controlador = new AbortController();
  const disparo = setTimeout(() => controlador.abort(), restante);

  try {
    return await ejecutar({
      senal: controlador.signal,
      timeoutMs: restante,
      cabeceras: { 'x-deadline-epoch-ms': String(plazo.limiteEn) },
    });
  } finally {
    clearTimeout(disparo);
  }
};`,
        },
        {
          type: 'paragraph',
          value:
            'El tope local al leer la cabecera es la parte que suele faltar. Sin él, el servicio confía en el plazo que envió quien llama, y un cliente mal configurado que pide sesenta segundos consigue mantener conexiones ocupadas durante sesenta segundos, lo que anula toda la calibración hecha internamente. El plazo propagado es un límite superior negociable hacia abajo, nunca un pedido que el servicio esté obligado a atender.',
        },
      ],
    },
    {
      title: 'Petición paralela anticipada: cuándo la cola justifica la copia',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existe una clase de latencia que ninguna calibración de timeout resuelve: la cola que no viene de degradación sistémica sino de variación individual. Una instancia que acaba de sufrir una pausa del recolector de basura, una que perdió su caché local después de reiniciarse, una que cayó en un nodo con vecino ruidoso. En esos casos la llamada específica es lenta mientras el servicio en conjunto está sano, y esperar el timeout para después repetir significa sumar el tiempo de espera al tiempo del nuevo intento.',
        },
        {
          type: 'paragraph',
          value:
            'La técnica que ataca esto es disparar una segunda copia de la petición antes de que falle la primera, aceptando la primera respuesta que llegue y cancelando la otra. El punto crítico es el disparador: lanzar la copia de inmediato duplica el tráfico y la factura para ganar casi nada, porque la mayoría de las llamadas termina rápido. Dispararla en el percentil noventa y cinco significa que solo el cinco por ciento de las llamadas genera una segunda petición, el costo extra queda en el mismo orden de magnitud, y la cola por encima del p95 pasa a ser cortada por la copia.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Costo extra de peticiones', 'Efecto en el p99 del usuario', 'Cuándo no usarla'],
          rows: [
            [
              'Reintento solo después del timeout',
              'Solo en caso de error',
              'Empeora: suma el timeout entero al nuevo intento',
              'Nunca renunciar a ella, es la red de seguridad final',
            ],
            [
              'Copia paralela inmediata',
              'Cien por ciento',
              'Mejora bastante',
              'Casi siempre, el costo rara vez compensa',
            ],
            [
              'Copia disparada en el p95',
              'Alrededor del cinco por ciento',
              'Mejora, corta la cola de variación individual',
              'Operaciones con efecto colateral no idempotente',
            ],
            [
              'Copia disparada en el p99',
              'Alrededor del uno por ciento',
              'Mejora poco, actúa demasiado tarde',
              'Cuando el objetivo del trabajo es justamente el p99',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La restricción que elimina la técnica en buena parte de los casos es la idempotencia. Dos copias de una lectura son inofensivas, dos copias de un cobro son un incidente financiero. Incluso con la cancelación implementada, la carrera existe: la segunda copia puede llegar al servidor y ser procesada antes de que se observe la cancelación. Por eso la copia paralela solo es aplicable a operaciones de lectura o a escrituras protegidas por clave de idempotencia de punta a punta.',
        },
        {
          type: 'paragraph',
          value:
            'Vale registrar también la interacción con el presupuesto de reintentos. La copia anticipada es carga adicional por la misma lógica que el reintento, y necesita consumir el mismo presupuesto. Un sistema con presupuesto de reintentos bien configurado pero con la copia anticipada fuera de él sigue amplificando carga durante el incidente, solo que por un camino que el panel de reintentos no muestra.',
        },
      ],
    },
    {
      title: 'Demostrar la calibración antes del incidente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La calibración es una hipótesis sobre el comportamiento del sistema bajo una condición que todavía no ocurrió, y existen exactamente tres verificaciones que la convierten en un hecho. La primera es comparar el timeout configurado con el p99 medido de forma automática y continua, porque la latencia de la dependencia cambia con el tiempo y un timeout que estaba bien hace seis meses puede haber quedado por debajo del p99 actual sin que nadie haya tocado nada.',
        },
        {
          type: 'paragraph',
          value:
            'La segunda es medir el tiempo de ocupación del pool bajo la hipótesis de degradación, y no bajo tráfico normal. Eso es una prueba de carga con la dependencia sustituida por un doble que responde en el timeout configurado en vez de en la latencia normal. El criterio de aprobación es simple: con la dependencia en degradación total, el servicio sigue respondiendo las rutas que no dependen de ella. Si el pool se agota y rutas independientes empiezan a fallar, la calibración está mal, sin importar que el número parezca razonable.',
        },
        {
          type: 'code',
          value: `// test/calibracion-timeout.test.js
// Verifica las dos propiedades que promete la calibracion: el timeout no
// corta trafico saludable, y la degradacion de la dependencia no se vuelve
// carga extra sobre ella justo cuando tiene menos capacidad.

import { calibrarTimeout } from '../src/http/calibracion.js';
import { crearPresupuestoReintentos } from '../src/resiliencia/presupuesto-reintentos.js';

describe('calibracion de timeout', () => {
  it('mantiene el timeout por encima del p99 medido de la dependencia', () => {
    // Valores del histograma de produccion de la ultima semana saludable.
    const perfil = { p99Ms: 180, plazoUsuarioMs: 1500, intentos: 2 };
    const config = calibrarTimeout(perfil);

    expect(config.lecturaMs).toBeGreaterThan(perfil.p99Ms);
    expect(config.alerta).toBeNull();
  });

  it('reduce intentos en vez de acortar el timeout cuando el plazo aprieta', () => {
    // Plazo corto: no caben 3 intentos de 252ms. La respuesta correcta es
    // avisar y reducir intentos, nunca comprimir el timeout hasta que quepa.
    const config = calibrarTimeout({ p99Ms: 180, plazoUsuarioMs: 600, intentos: 3 });

    expect(config.lecturaMs).toBeGreaterThan(180);
    expect(config.intentos).toBeLessThan(3);
    expect(config.alerta).toContain('admite');
  });

  it('agota el presupuesto de reintentos cuando el fallo es generalizado', () => {
    let reloj = 0;
    const presupuesto = crearPresupuestoReintentos({
      ventanaMs: 10000,
      razonMaxima: 0.1,
      minimoPorSegundo: 3,
      ahora: () => reloj,
    });

    // 1000 peticiones originales, todas fallando. Sin presupuesto serian
    // 1000 intentos extra, es decir 100% de carga adicional sobre la
    // dependencia que ya se esta cayendo. Con presupuesto, el tope es 100.
    let autorizadas = 0;
    for (let i = 0; i < 1000; i += 1) {
      reloj += 5;
      presupuesto.registrarOriginal();
      if (presupuesto.intentarConsumir()) autorizadas += 1;
    }

    expect(autorizadas).toBeLessThanOrEqual(100);
    expect(presupuesto.estado().razon).toBeLessThanOrEqual(0.1);
  });

  it('no bloquea el reintento en una ruta de trafico muy bajo', () => {
    let reloj = 0;
    const presupuesto = crearPresupuestoReintentos({
      ventanaMs: 10000,
      razonMaxima: 0.1,
      minimoPorSegundo: 3,
      ahora: () => reloj,
    });

    // 2 peticiones en la ventana: el 10% redondearia a cero intentos.
    // El piso garantiza que la ruta poco usada tenga segunda oportunidad.
    reloj += 100;
    presupuesto.registrarOriginal();
    reloj += 100;
    presupuesto.registrarOriginal();

    expect(presupuesto.intentarConsumir()).toBe(true);
  });
});`,
        },
        {
          type: 'paragraph',
          value:
            'La tercera verificación cierra el ciclo y es observacional en vez de comprobable por prueba: seguir la razón entre intentos extra y peticiones originales como métrica de primera clase en el panel. Tiene una propiedad útil que la tasa de error no tiene. La tasa de error sube cuando el incidente ya está ocurriendo, mientras que la razón de reintentos sube un minuto antes, cuando la dependencia empezó a degradarse pero el reintento todavía se lo está ocultando al usuario. Una alerta sobre esa razón da el tiempo de reacción que la tasa de error no da.',
        },
        {
          type: 'list',
          items: [
            'Los timeouts de conexión y de lectura se configuran por separado, porque la respuesta correcta para cada fallo es distinta.',
            'El timeout de lectura se deriva del p99 medido y se recalcula cuando el histograma se mueve, no se fija en una constante del código.',
            'El presupuesto de reintentos es global por dependencia, y la copia paralela anticipada consume el mismo presupuesto.',
            'El plazo es absoluto, se propaga por cabecera y está limitado por un tope local en cada servicio que lo recibe.',
            'Antes de llamar a la dependencia, el servicio compara el plazo restante con su p99 y falla rápido cuando no cabe.',
            'La razón de reintentos está en el panel con alerta propia, porque se mueve antes que la tasa de error.',
          ],
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Qué timeout usar cuando la dependencia no tiene histórico de latencia medido?',
      answer:
        'La ausencia de medición es el problema a resolver primero, y existe un valor provisional que evita tanto el corte de tráfico legítimo como la ocupación prolongada del pool mientras la medición no existe. El punto de partida es derivarlo del plazo del usuario y no de la dependencia: si quien llama tiene un segundo y medio, un intento de setecientos milisegundos con un segundo dentro de lo que sobra es una configuración defendible sin ningún dato sobre la dependencia, porque respeta el único número que se conoce con certeza. Junto a eso, instrumente la llamada con histograma desde el primer día, no con promedio, y revise el valor después de una semana de tráfico real. El error que hay que evitar en ese período es adoptar el valor por defecto de la biblioteca HTTP, que suele estar entre diez y sesenta segundos y existe para no sorprender a quien descarga archivos grandes, no para proteger un servicio interactivo. Si la dependencia es externa y tiene un acuerdo de nivel de servicio publicado, el número del contrato sirve como tope de cordura, pero rara vez como valor de configuración, porque describe el peor caso aceptable comercialmente y no la latencia típica.',
    },
    {
      question: '¿El circuit breaker reemplaza al presupuesto de reintentos?',
      answer:
        'No, y confundir a los dos deja un hueco que aparece exactamente en el escenario más común de degradación. El interruptor actúa sobre la decisión binaria de seguir llamando o dejar de llamar a una dependencia, y funciona bien cuando el fallo es total o casi total, porque en ese caso la tasa de error cruza el umbral y el circuito se abre. El presupuesto de reintentos actúa sobre la amplificación, y es el que protege en el escenario de degradación parcial, cuando la dependencia falla el diez o el quince por ciento de las llamadas: esa tasa suele quedar por debajo del umbral del interruptor, el circuito permanece cerrado, y sin presupuesto cada error se convierte en tres llamadas hasta que la degradación parcial se vuelve total por obra del propio cliente. En la práctica los dos conviven en capas: el presupuesto limita la carga extra mientras la dependencia todavía atiende la mayor parte del tráfico, y el interruptor corta la comunicación cuando dejó de atender. Vale agregar que el interruptor necesita un estado intermedio que deje pasar unas pocas llamadas de prueba, si no la recuperación nunca se detecta y el circuito solo cierra por tiempo transcurrido, lo que suele reabrirse en la primera ráfaga.',
    },
    {
      question: '¿Cómo calibrar timeouts de llamadas a modelos de lenguaje, donde la varianza es enorme?',
      answer:
        'Las llamadas a modelos generativos rompen la premisa central del método porque la latencia no es una propiedad de la dependencia sino del tamaño de la salida, lo que vuelve al p99 agregado casi inútil como base de cálculo. El ajuste que funciona es dejar de calibrar sobre el tiempo total y pasar a calibrar sobre el tiempo hasta el primer token, que es la métrica estable y la que de verdad refleja la salud del proveedor, complementada por un timeout de inactividad entre tokens en vez de un tope para la respuesta entera. Una respuesta larga que se está transmitiendo de forma continua es una respuesta sana incluso a los cuarenta segundos, mientras que una pausa de ocho segundos sin ningún token es señal de problema aunque el total siga dentro del límite. Junto a eso, el plazo total tiene que existir como tope absoluto derivado del producto, y ahí es donde el límite de tokens de salida entra como instrumento de control de latencia, porque es el único parámetro que acota el peor caso de forma previsible. El reintento en este contexto también cambia de naturaleza: repetir una generación cuesta la llamada entera de nuevo y con frecuencia produce una salida distinta, así que la decisión de repetir tiene que considerar el costo y no solo la latencia, y en muchos casos la respuesta correcta es caer a un modelo más rápido en vez de repetir en el mismo.',
    },
  ],
  conclusion: {
    title: 'El número del timeout es una decisión de producto disfrazada de configuración',
    description:
      'El valor por defecto de la biblioteca sobrevive años porque nunca provoca una alerta en condición normal, y cobra todo de golpe el día en que la dependencia se degrada. La salida no es elegir un número menor a ojo, es derivar el número de la distribución medida, acotar el reintento con un presupuesto compartido y propagar el plazo con descuento por toda la cadena. Puedo medir la distribución de latencia de sus dependencias y recalibrar los timeouts sobre el p99 real, implementar el presupuesto de reintentos por dependencia con separación entre error repetible y determinista, introducir la propagación de plazo absoluto con corte anticipado en los servicios más profundos, y dejar en el panel la razón de reintentos con una alerta que se dispare antes que la tasa de error.',
    cta: 'Hablar sobre la calibración de timeouts de mi sistema',
  },
  related: [
    {
      label: 'Timeout en cascada y reintentos: cuando el cliente tumba el servicio que se iba a recuperar',
      to: '/blog/timeout-cascata-retry-cliente-derruba-servico-que-ia-se-recuperar',
    },
    {
      label: 'Backpressure en pipeline de IA: cuando el consumidor no acompaña',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
