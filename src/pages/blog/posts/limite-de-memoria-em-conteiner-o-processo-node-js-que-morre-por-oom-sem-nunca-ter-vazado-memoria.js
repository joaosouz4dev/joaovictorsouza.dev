// Conteudo do artigo: limite de memoria em conteiner. Por que um processo Node.js sem
// vazamento morre por OOM, como o V8 dimensiona o heap e por que ele pode olhar para a
// maquina errada, o que conta no limite do cgroup alem do heap, como derivar as flags do
// V8 a partir do limite do conteiner, como limitar o que vive fora do heap e como provar
// em teste que o processo cabe no limite.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const entrypointCode = `#!/bin/sh
# entrypoint.sh: deriva as flags de heap do V8 a partir do limite de memoria do cgroup
# e so entao sobe o Node. No Dockerfile: ENTRYPOINT ["sh", "./entrypoint.sh", "server.js"]
set -eu

ler_limite_bytes() {
  if [ -r /sys/fs/cgroup/memory.max ]; then
    cat /sys/fs/cgroup/memory.max                    # cgroup v2: bytes ou "max"
  elif [ -r /sys/fs/cgroup/memory/memory.limit_in_bytes ]; then
    cat /sys/fs/cgroup/memory/memory.limit_in_bytes  # cgroup v1: bytes; sem limite vira um numero gigante
  else
    echo max
  fi
}

SEMI_SPACE_MB="\${SEMI_SPACE_MB:-16}"   # espaco jovem = 3 x semi-space
limite="$(ler_limite_bytes)"

if [ -z "\${MAX_OLD_SPACE_MB:-}" ]; then
  if [ "$limite" = "max" ] || [ "\${#limite}" -gt 15 ]; then
    MAX_OLD_SPACE_MB=512                           # sem limite de cgroup: valor fixo e explicito
  else
    limite_mb=$((limite / 1024 / 1024))
    reserva_mb=$((limite_mb / 4))                  # 25% para tudo que vive fora do heap...
    if [ "$reserva_mb" -lt 96 ]; then reserva_mb=96; fi   # ...e nunca menos que 96 MiB
    MAX_OLD_SPACE_MB=$((limite_mb - reserva_mb - SEMI_SPACE_MB * 3))
  fi
fi

export NODE_OPTIONS="\${NODE_OPTIONS:-} --max-old-space-size=\${MAX_OLD_SPACE_MB} --max-semi-space-size=\${SEMI_SPACE_MB}"
echo "memoria: limite_cgroup=\${limite} max_old_space=\${MAX_OLD_SPACE_MB}MiB semi_space=\${SEMI_SPACE_MB}MiB" >&2

exec node "$@"`;

const retratoCode = `// memoria.js
import v8 from 'node:v8';

const MiB = 1024 * 1024;
const emMiB = (bytes) => Math.round(bytes / MiB);

// Limite imposto pelo cgroup, quando o Node consegue ler (18.15 ou mais novo).
// Zero significa "sem limite" ou "esta versao nao sabe ler".
const limiteDoConteiner = () =>
  typeof process.constrainedMemory === 'function' ? process.constrainedMemory() || 0 : 0;

export function retratoDeMemoria() {
  const uso = process.memoryUsage();
  const heap = v8.getHeapStatistics();
  const limite = limiteDoConteiner();
  return {
    limiteConteinerMiB: limite ? emMiB(limite) : null,
    limiteHeapMiB: emMiB(heap.heap_size_limit), // old space + espaco jovem
    rssMiB: emMiB(uso.rss), // o unico numero que o kernel compara com o limite
    heapUsadoMiB: emMiB(uso.heapUsed),
    heapTotalMiB: emMiB(uso.heapTotal),
    externoMiB: emMiB(uso.external),
    arrayBuffersMiB: emMiB(uso.arrayBuffers),
    foraDoHeapMiB: emMiB(uso.rss - uso.heapTotal),
  };
}

// Roda uma vez na subida: configuracao errada tem que aparecer no log do deploy,
// nao no pos-incidente.
export function verificarConfiguracao(retrato = retratoDeMemoria()) {
  const problemas = [];
  const { limiteConteinerMiB, limiteHeapMiB, rssMiB } = retrato;
  if (!limiteConteinerMiB) {
    problemas.push('sem limite de cgroup visivel: o heap foi dimensionado pela memoria do host');
  } else if (limiteHeapMiB > limiteConteinerMiB * 0.8) {
    problemas.push(
      \`heap_size_limit de \${limiteHeapMiB} MiB passa de 80% do limite de \${limiteConteinerMiB} MiB\`,
    );
  } else if (limiteHeapMiB < limiteConteinerMiB * 0.4) {
    problemas.push(
      \`heap_size_limit de \${limiteHeapMiB} MiB usa menos de 40% do limite de \${limiteConteinerMiB} MiB\`,
    );
  }
  if (limiteConteinerMiB && rssMiB > limiteConteinerMiB * 0.85) {
    problemas.push(\`rss de \${rssMiB} MiB ja esta a menos de 15% do limite\`);
  }
  return problemas;
}

// Gauges para o coletor de metricas. O alerta que importa e a razao rss/limite:
// e o unico sinal que existe antes de o kernel matar o processo.
export function registrarMetricas(gauge, intervaloMs = 15_000) {
  const coletar = () => {
    const r = retratoDeMemoria();
    gauge('node_memoria_rss_mib', r.rssMiB);
    gauge('node_memoria_heap_usado_mib', r.heapUsadoMiB);
    gauge('node_memoria_fora_do_heap_mib', r.foraDoHeapMiB);
    if (r.limiteConteinerMiB) {
      gauge('node_memoria_uso_do_limite', r.rssMiB / r.limiteConteinerMiB);
    }
  };
  coletar();
  return setInterval(coletar, intervaloMs).unref();
}`;

const orcamentoCode = `// orcamento-de-bytes.js
// O heap tem --max-old-space-size. Buffers, streams de zlib e TLS nao tem nada:
// o unico limite deles e o do cgroup. Este orcamento cria esse limite em espaco
// de usuario e faz a requisicao esperar em vez de deixar o processo morrer.
export class OrcamentoDeBytes {
  constructor({ limiteBytes }) {
    this.limiteBytes = limiteBytes;
    this.emUsoBytes = 0;
    this.esperando = [];
  }

  async reservar(bytes) {
    if (bytes > this.limiteBytes) {
      throw new Error(\`reserva de \${bytes} bytes maior que o orcamento de \${this.limiteBytes}\`);
    }
    while (this.emUsoBytes + bytes > this.limiteBytes) {
      await new Promise((resolve) => this.esperando.push(resolve));
    }
    this.emUsoBytes += bytes;
    let liberado = false;
    return () => {
      if (liberado) return;
      liberado = true;
      this.emUsoBytes -= bytes;
      const acordar = this.esperando;
      this.esperando = [];
      for (const resolve of acordar) resolve(); // todos reavaliam a condicao
    };
  }
}

// upload.js: parsers de ZIP e PDF precisam do arquivo inteiro em memoria.
// A reserva garante que N uploads simultaneos nunca somam mais que o orcamento,
// e cobre o processamento, nao so a leitura.
const orcamento = new OrcamentoDeBytes({ limiteBytes: 96 * 1024 * 1024 });

export async function processarArquivo(req, processar) {
  const tamanho = Number(req.headers['content-length']);
  if (!Number.isFinite(tamanho) || tamanho <= 0) {
    throw new Error('Content-Length obrigatorio');
  }
  const liberar = await orcamento.reservar(tamanho);
  try {
    const partes = [];
    let lidos = 0;
    for await (const parte of req) {
      lidos += parte.length;
      if (lidos > tamanho) throw new Error('corpo maior que o Content-Length declarado');
      partes.push(parte);
    }
    return await processar(Buffer.concat(partes, lidos));
  } finally {
    liberar();
  }
}`;

const churnCode = `// scripts/churn.js: simula lotes de pedidos parseados que viram lixo depois de
// processados. Mantem VIVOS lotes na memoria e descarta o resto; o total alocado
// e LOTES vezes o tamanho do lote, muito acima de qualquer limite de conteiner.
import v8 from 'node:v8';

const LOTES = Number(process.env.LOTES || 300);
const VIVOS = Number(process.env.VIVOS || 6);
const MiB = 1024 * 1024;

const janela = [];
let picoRssMiB = 0;

for (let i = 0; i < LOTES; i += 1) {
  janela.push(
    Array.from({ length: 100_000 }, (_, j) => ({
      id: i * 100_000 + j,
      status: 'pago',
      total: (j % 500) * 1.5,
    })),
  );
  if (janela.length > VIVOS) janela.shift();
  picoRssMiB = Math.max(picoRssMiB, process.memoryUsage.rss() / MiB);
}

console.log(
  JSON.stringify({
    picoRssMiB: Math.round(picoRssMiB),
    heapLimiteMiB: Math.round(v8.getHeapStatistics().heap_size_limit / MiB),
    lotesVivos: janela.length,
  }),
);`;

const testeCode = `// memoria.test.js: roda o churn dentro de um conteiner com 256 MiB e sem swap.
// Exige Docker no ambiente de CI e leva alguns segundos: e um teste de integracao.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const LIMITE_MIB = 256;

const rodarNoConteiner = (...comando) =>
  exec('docker', [
    'run', '--rm',
    \`--memory=\${LIMITE_MIB}m\`, \`--memory-swap=\${LIMITE_MIB}m\`, // sem swap: ou cabe, ou morre
    '-v', \`\${process.cwd()}:/app\`, '-w', '/app',
    'node:22-alpine', ...comando,
  ]);

test('o entrypoint deixa o heap abaixo de 80% do limite e o processo sobrevive', async () => {
  const { stdout } = await rodarNoConteiner('sh', './entrypoint.sh', 'scripts/churn.js');
  const resultado = JSON.parse(stdout.trim().split('\\n').at(-1));

  assert.ok(resultado.heapLimiteMiB >= 128, \`heap pequeno demais: \${resultado.heapLimiteMiB} MiB\`);
  assert.ok(
    resultado.heapLimiteMiB <= LIMITE_MIB * 0.8,
    \`heap grande demais: \${resultado.heapLimiteMiB} MiB\`,
  );
  assert.ok(resultado.picoRssMiB < LIMITE_MIB, \`rss chegou a \${resultado.picoRssMiB} MiB\`);
  assert.equal(resultado.lotesVivos, 6);
});

test('o mesmo churn com heap maior que o conteiner nao termina com sucesso', async () => {
  // Quando o kernel mata o processo, o docker devolve 137 (128 + SIGKILL).
  await assert.rejects(
    rodarNoConteiner('node', '--max-old-space-size=2048', 'scripts/churn.js'),
    (erro) => erro.code === 137,
  );
});`;

const diagramaPt = `Contêiner com memory.max = 512 MiB. O kernel compara o RSS inteiro com esse número; o V8 só conhece o heap.

+------------------------------------------------------------------+
| heap do V8                                                        |
|   old space  ....... limitado por --max-old-space-size            |
|   espaço jovem ..... 3 x --max-semi-space-size (até 192 MiB por   |
|                      padrão em versões recentes de 64 bits)       |
|   dentro do heap: objetos vivos + lixo que o GC ainda não coletou |
+------------------------------------------------------------------+
| fora do heap (nenhuma flag limita)                                |
|   Buffers e ArrayBuffers: uploads, zlib, TLS, crypto              |
|   código compilado, metadados do V8, pilhas de threads            |
|   módulos nativos, malloc do próprio processo                     |
|   cerca de 40 MiB num processo vazio, sem nenhum tráfego          |
+------------------------------------------------------------------+
  RSS acima de memory.max: SIGKILL, exit code 137, nenhum log do Node`;

const diagramaEn = `Container with memory.max = 512 MiB. The kernel compares the whole RSS against that number; V8 only knows about the heap.

+------------------------------------------------------------------+
| V8 heap                                                           |
|   old space  ....... bounded by --max-old-space-size              |
|   young space ...... 3 x --max-semi-space-size (up to 192 MiB by  |
|                      default on recent 64-bit versions)           |
|   inside the heap: live objects + garbage the GC has not collected|
+------------------------------------------------------------------+
| outside the heap (no flag bounds it)                              |
|   Buffers and ArrayBuffers: uploads, zlib, TLS, crypto            |
|   compiled code, V8 metadata, thread stacks                       |
|   native modules, the process own malloc                          |
|   about 40 MiB in an empty process, with no traffic at all        |
+------------------------------------------------------------------+
  RSS above memory.max: SIGKILL, exit code 137, no log line from Node`;

const diagramaEs = `Contenedor con memory.max = 512 MiB. El kernel compara el RSS completo con ese número; V8 solo conoce el heap.

+------------------------------------------------------------------+
| heap de V8                                                        |
|   old space  ....... limitado por --max-old-space-size            |
|   espacio joven .... 3 x --max-semi-space-size (hasta 192 MiB por |
|                      defecto en versiones recientes de 64 bits)   |
|   dentro del heap: objetos vivos + basura que el GC aún no recogió|
+------------------------------------------------------------------+
| fuera del heap (ninguna flag lo limita)                           |
|   Buffers y ArrayBuffers: uploads, zlib, TLS, crypto              |
|   código compilado, metadatos de V8, pilas de threads             |
|   módulos nativos, malloc del propio proceso                      |
|   unos 40 MiB en un proceso vacío, sin ningún tráfico             |
+------------------------------------------------------------------+
  RSS por encima de memory.max: SIGKILL, exit code 137, ningún log de Node`;

const pt = {
  intro:
    'O pod reinicia três vezes por dia com OOMKilled e exit code 137. O time abre o heap snapshot, compara dois instantes, procura o array que cresce para sempre, e não encontra nada: o heapUsed sobe e desce em serra, como deve. Não existe vazamento. O processo morreu porque o V8 e o kernel medem coisas diferentes. O kernel compara o RSS inteiro do processo com o limite do cgroup; o V8 só governa o heap, dimensiona esse heap olhando para a memória que acredita existir, e deixa o lixo acumular até perto desse limite antes de coletar com força. Quando o limite que o V8 enxerga é maior do que o limite que o kernel aplica, o processo é morto cheio de lixo coletável, sem nunca ter vazado um byte. Este artigo mostra como diferenciar essa morte de um vazamento real, como o V8 decide o tamanho do heap e por que a decisão pode olhar para a máquina errada, o que entra na conta do cgroup além do heap, como derivar as flags a partir do limite do contêiner, como limitar o que vive fora do heap e como provar em teste que o processo cabe no limite.',
  sections: [
    {
      title: 'Exit code 137 não é vazamento: duas mortes com sintomas diferentes',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Existem duas maneiras de um processo Node morrer por memória, e elas deixam rastros opostos. Quando o heap do V8 chega ao próprio limite e o coletor não consegue liberar espaço, o Node escreve "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" no stderr, imprime um resumo dos espaços do heap e encerra com um código de saída próprio. É uma morte que o processo vê chegando: dá para gerar um heap snapshot perto do limite, dá para registrar o estado. Quando o RSS do processo passa do limite do cgroup, é o kernel que decide, de fora, com SIGKILL. Não há sinal a tratar, não há handler que rode, não há linha de log. O processo simplesmente para de existir, e a única evidência é o exit code 137 no orquestrador e uma linha no dmesg do nó.',
        },
        {
          type: 'table',
          columns: ['Sintoma', 'Quem decidiu', 'O que o processo viu', 'Causa mais provável'],
          rows: [
            [
              'FATAL ERROR: Reached heap limit no stderr',
              'O V8, ao falhar uma alocação no heap',
              'Tudo: o erro sai no log com estatísticas dos espaços',
              'Vazamento de objetos JavaScript ou heap configurado pequeno demais para a carga',
            ],
            [
              'OOMKilled, exit code 137, nenhuma linha final no log',
              'O kernel, ao comparar o RSS com memory.max',
              'Nada: SIGKILL não é entregue ao processo',
              'Heap dimensionado acima do limite do contêiner, ou memória fora do heap sem teto',
            ],
            [
              'ENOMEM em chamadas nativas, Buffer.alloc lançando erro',
              'O alocador, ao pedir memória ao sistema',
              'Uma exceção na chamada que falhou',
              'Limite de memória virtual ou alocação única grande demais; raro em contêiner',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A segunda linha é o caso deste artigo. E o teste que diferencia os dois é simples: no gráfico de heapUsed, um vazamento aparece como vales que sobem ao longo das horas, porque a cada coleta completa sobra mais memória viva. Um processo mal dimensionado mostra vales estáveis e picos altos, porque o lixo acumula até onde o V8 permite, e o V8 permite mais do que o cgroup. Se os vales não sobem e o processo morreu mesmo assim, não adianta procurar o array que cresce. O problema está na configuração.',
        },
      ],
    },
    {
      title: 'Como o V8 decide o tamanho do heap, e para qual máquina ele olha',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sem flags, o Node pede ao V8 que dimensione o heap a partir da memória física disponível. Em uma máquina de 16 GB, o limite do old space fica em torno de 4 GB, e o coletor usa esse teto para decidir quando vale a pena uma coleta completa: enquanto há folga, ele deixa o lixo acumular, porque coletar menos vezes custa menos CPU. A pergunta que define o incidente é de onde vem o número da memória física. O Node tenta ler o limite do cgroup e usar o menor entre ele e a memória total do host. Quando consegue, o heap padrão fica em cerca de um quarto do limite do contêiner. Quando não consegue, o heap é dimensionado pela memória do nó inteiro.',
        },
        {
          type: 'paragraph',
          value:
            'Esse "quando consegue" depende de três coisas que mudam de cluster para cluster: a versão do Node, a versão do libuv embutida nele e se o nó usa cgroup v1 ou v2. Versões do libuv anteriores ao suporte a cgroup v2 devolvem zero em nós v2, que hoje são o padrão em distribuições recentes e em Kubernetes atual, e o Node cai para a memória do host. O resultado é um processo com heap de 4 GB dentro de um contêiner de 512 MiB: o coletor vai deixar o lixo chegar a centenas de megabytes antes de uma coleta completa, e o kernel mata antes. Em vez de decorar a matriz de versões, meça na própria imagem, com o mesmo limite que a produção usa.',
        },
        {
          type: 'code',
          value: `docker run --rm --memory=512m node:22-alpine node -e "
  const v8 = require('node:v8');
  console.log('heap_size_limit MiB:', Math.round(v8.getHeapStatistics().heap_size_limit / 1048576));
  console.log('constrainedMemory MiB:', Math.round((process.constrainedMemory?.() || 0) / 1048576));
"`,
        },
        {
          type: 'paragraph',
          value:
            'Dois números importam na saída. Se constrainedMemory vem zerado, o Node não enxergou o limite e o heap foi dimensionado pelo host. Se heap_size_limit vem perto ou acima de 512, o heap sozinho já pode ocupar o contêiner inteiro. E mesmo quando o Node lê o limite certo, um quarto dele é um palpite conservador que não considera a aplicação: um serviço que mantém cache em memória pode precisar de mais, e um que lida com uploads precisa de menos heap e mais espaço fora dele. A heurística é um ponto de partida, nunca a configuração de produção.',
        },
        { type: 'diagram', value: diagramaPt },
      ],
    },
    {
      title: 'O que entra na conta do cgroup e nenhuma flag do V8 controla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O erro de modelo mais comum é tratar --max-old-space-size como limite do processo. Ele limita um espaço do heap. O RSS que o kernel mede inclui o espaço jovem, que em versões recentes do Node em 64 bits pode chegar a 192 MiB por padrão, e tudo o que vive fora do heap: Buffers, estado nativo de streams, código compilado, pilhas das threads e as alocações do próprio alocador de C. Um processo Node vazio, antes de receber a primeira requisição, já tem cerca de 40 MiB fora do heap. Cada componente cresce com um tipo diferente de carga, e nenhum aparece em heapUsed.',
        },
        {
          type: 'table',
          columns: ['Componente', 'Onde aparece em process.memoryUsage()', 'O que o faz crescer'],
          rows: [
            [
              'Old space do V8',
              'heapUsed e heapTotal',
              'Objetos de vida longa e lixo acumulado entre coletas completas; limitado por --max-old-space-size',
            ],
            [
              'Espaço jovem do V8',
              'heapTotal',
              'Taxa de alocação de objetos curtos; cresce até 3 x --max-semi-space-size',
            ],
            [
              'Buffers e ArrayBuffers',
              'external e arrayBuffers',
              'Corpos de requisição lidos inteiros, arquivos em memória, respostas grandes de banco',
            ],
            [
              'Estado nativo de zlib, TLS e crypto',
              'Parte em external, o resto só no rss',
              'Cada stream de deflate reserva cerca de 256 KiB de janela e tabelas assim que começa a comprimir; cada conexão TLS tem seus próprios buffers',
            ],
            [
              'Código compilado e metadados do V8',
              'Só no rss',
              'Tamanho do código carregado e quantidade de funções otimizadas',
            ],
            [
              'Pilhas de threads e workers',
              'Só no rss, e cada worker_thread tem um heap inteiro à parte',
              'Thread pool do libuv, módulos nativos, cada new Worker sem resourceLimits',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A última linha costuma ser a surpresa do pós-incidente. Um worker_thread é um isolate completo, com heap próprio dimensionado pela mesma heurística do processo principal. Quatro workers sem resourceLimits em um contêiner de 1 GiB são cinco heaps, cada um acreditando que pode crescer até o teto do host. O mesmo vale para o módulo cluster: cada fork é um processo inteiro, com o mesmo NODE_OPTIONS, e o limite do cgroup é compartilhado por todos. Em um pod com quatro forks, a flag precisa ser calculada para um quarto do limite, não para o limite.',
        },
      ],
    },
    {
      title: 'Derivar as flags do limite do contêiner, não do tamanho do nó',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção é deixar de depender da heurística e calcular as flags a partir do número que o kernel vai usar. O lugar certo para isso é o entrypoint do contêiner: ele lê o limite do cgroup, reserva uma fatia para o que vive fora do heap, desconta o espaço jovem e entrega o resto ao old space. Fazer isso em shell, antes de o Node subir, resolve um problema que não dá para resolver em JavaScript: as flags do V8 precisam existir antes do isolate ser criado, e nenhuma chamada de dentro do processo muda o tamanho do heap depois disso.',
        },
        { type: 'code', value: entrypointCode },
        {
          type: 'paragraph',
          value:
            'Três decisões no script merecem explicação. A reserva fora do heap é 25% do limite com piso de 96 MiB: o piso cobre os 40 MiB do processo vazio mais código e pilhas em contêineres pequenos, e a porcentagem acompanha o crescimento de Buffers e conexões em contêineres grandes. O semi-space é fixado em 16 MiB em vez de confiar no padrão, porque o padrão varia entre versões e pode consumir sozinho 192 MiB; serviços de alta taxa de alocação podem subir para 32 ou 64 e descontar o triplo do old space. E as duas variáveis de ambiente permitem sobrescrever o cálculo por serviço, sem trocar a imagem, para o caso em que a proporção padrão não serve.',
        },
        {
          type: 'table',
          columns: [
            'Limite do contêiner',
            'Reserva fora do heap',
            'Espaço jovem (semi 16 MiB)',
            'max-old-space-size resultante',
          ],
          rows: [
            ['256 MiB', '96 MiB', '48 MiB', '112 MiB'],
            ['512 MiB', '128 MiB', '48 MiB', '336 MiB'],
            ['1 GiB', '256 MiB', '48 MiB', '720 MiB'],
            ['2 GiB', '512 MiB', '48 MiB', '1488 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No Kubernetes, o que aparece em memory.max dentro do contêiner é o limite do contêiner, não o request. Por isso request e limit de memória devem ser iguais: com request menor, o pod entra na classe Burstable e pode ser despejado por pressão de memória do nó antes mesmo de chegar ao próprio limite, e o cálculo do entrypoint, que só vê o limit, passa a estar errado para o pior caso. Para workers, a mesma conta vale com resourceLimits.maxOldGenerationSizeMb e maxYoungGenerationSizeMb no construtor do Worker, descontando cada heap da fatia do processo principal.',
        },
      ],
    },
    {
      title: 'Ver a configuração na subida e a pressão antes da morte',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como a morte por cgroup não deixa log, a observação precisa acontecer antes. Dois momentos importam. Na subida, o processo deve comparar o limite de heap que o V8 realmente adotou com o limite do cgroup que o Node consegue ler, e registrar qualquer desproporção: um heap acima de 80% do contêiner vai morrer sob carga, e um heap abaixo de 40% vai falhar com "heap out of memory" com metade do contêiner livre. Em execução, a única métrica que antecipa o SIGKILL é a razão entre RSS e limite, porque é exatamente a conta que o kernel faz.',
        },
        { type: 'code', value: retratoCode },
        {
          type: 'list',
          items: [
            'Alertar quando a razão rss/limite passa de 85% por mais de dois minutos: é o aviso que o kernel não vai dar.',
            'Alertar quando o número de reinícios com motivo OOMKilled cresce, lido do orquestrador, e não só quando o pod está fora: um reinício a cada seis horas passa despercebido no gráfico de disponibilidade.',
            'Gravar a diferença rss menos heapTotal como série própria: se ela sobe enquanto heapUsed fica estável, o crescimento está em Buffers ou em código nativo, e o heap snapshot não vai mostrar nada.',
            'Usar --heapsnapshot-near-heap-limit=1 com --diagnostic-dir apontando para um volume: ele só dispara para a morte por heap, não para a morte por cgroup, mas é o que transforma a primeira em evidência.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'Em nós com cgroup v2 existe ainda um recurso intermediário: memory.high, um teto abaixo de memory.max a partir do qual o kernel passa a reclamar memória e frear o processo em vez de matá-lo. Orquestradores recentes expõem isso como qualidade de serviço de memória. Ele não substitui o dimensionamento, porque um processo freado por reclamação de página fica lento de uma forma difícil de diagnosticar, mas transforma uma morte instantânea em uma degradação com tempo para o alerta disparar.',
        },
      ],
    },
    {
      title: 'Limitar o que vive fora do heap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Depois de dimensionar o heap, a parte sem teto é a memória nativa. Um endpoint que lê o corpo da requisição inteiro em um Buffer, para passar a um parser de ZIP ou PDF que precisa de acesso aleatório, aloca fora do heap e fora de qualquer flag. Com 20 uploads simultâneos de 30 MB, são 600 MB que o coletor não vê, que heapUsed não mostra e que o cgroup conta. A proteção é tratar bytes fora do heap como um recurso finito com orçamento explícito: a requisição reserva o que vai precisar, espera se não houver espaço, e libera quando o processamento termina.',
        },
        { type: 'code', value: orcamentoCode },
        {
          type: 'paragraph',
          value:
            'O orçamento precisa cobrir o processamento, não só a leitura, porque o Buffer continua vivo enquanto o parser trabalha; por isso o callback roda dentro do try e a liberação fica no finally. O tamanho do orçamento sai da mesma conta do entrypoint: ele é uma fração da reserva fora do heap, nunca a reserva inteira, porque TLS, zlib e o próprio runtime também vivem ali. E o Content-Length mentiroso é cortado em duas camadas: a leitura rejeita o corpo que passa do declarado, e o limite de tamanho de payload na borda rejeita o declarado que passa do aceitável. O mesmo padrão se aplica a qualquer coisa que aloque fora do heap por requisição, de imagens redimensionadas a respostas de banco materializadas inteiras.',
        },
      ],
    },
    {
      title: 'Como provar que o processo cabe no limite',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A prova que importa não roda na máquina do desenvolvedor, onde o heap é dimensionado por 32 GB de RAM e nada morre. Ela roda dentro de um contêiner com o mesmo limite da produção e sem swap, executando um script que aloca muito mais do que o limite enquanto mantém um conjunto vivo modesto. Se o entrypoint estiver certo, o coletor segura o lixo abaixo do teto e o processo termina com sucesso; se estiver errado, o docker devolve 137. O script de churn simula o padrão mais comum em serviços de integração: lotes de objetos parseados que são processados e descartados.',
        },
        { type: 'code', value: churnCode },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'O segundo teste é o que mostra o problema original: o mesmo script, com heap configurado acima do contêiner, é morto pelo kernel sem nenhum vazamento. Ele depende da heurística de crescimento do V8, que deixa o heap chegar a algumas vezes o conjunto vivo antes de uma coleta completa, por isso a janela de lotes vivos é mantida pequena e o total alocado grande. Vale rodar esse par de testes na pipeline sempre que a imagem base, a versão do Node ou o limite do pod mudarem: são exatamente as três mudanças que invalidam a configuração sem alterar uma linha de código da aplicação.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Se o Node já lê o limite do cgroup, ainda preciso das flags?',
      answer:
        'Precisa, por dois motivos. O primeiro é que a leitura depende da versão do Node, do libuv e do tipo de cgroup do nó, e uma atualização de cluster pode fazer um processo que lia o limite passar a ler a memória do host. O segundo é que, mesmo lendo certo, a heurística usa um quarto do limite, sem saber se a aplicação mantém cache em memória ou processa uploads. As flags explícitas tornam o tamanho do heap uma decisão versionada junto com o limite do pod, e a verificação na subida denuncia quando as duas deixam de combinar.',
    },
    {
      question: 'Por que o RSS não cai depois que o coletor roda?',
      answer:
        'Porque o V8 e o alocador de C devolvem memória ao sistema com preguiça. Depois de uma coleta completa, heapUsed cai, mas heapTotal pode ficar reservado para a próxima rajada de alocação, e páginas liberadas pelo malloc podem continuar mapeadas por fragmentação. Um RSS em patamar estável abaixo do limite é normal e não indica problema. O sinal de vazamento é heapUsed logo após coletas completas subindo ao longo das horas; o sinal de memória nativa crescendo é rss menos heapTotal subindo enquanto heapUsed fica estável.',
    },
    {
      question: 'Não é mais simples aumentar o limite do contêiner?',
      answer:
        'Aumentar o limite sem ajustar o heap só muda o momento da morte, porque o V8 continua dimensionando o heap pela memória que enxerga e deixando o lixo acumular até perto desse teto. Em um nó onde o Node lê a memória do host, um contêiner de 2 GiB morre do mesmo jeito que um de 512 MiB, apenas mais tarde e com mais lixo acumulado. O limite deve ser definido pelo conjunto vivo real da aplicação mais a reserva nativa, e o heap derivado dele. Aumentar o limite é a resposta certa quando a medição mostra conjunto vivo alto, não quando mostra lixo acumulado.',
    },
  ],
  conclusion: {
    title: 'O kernel mede o processo inteiro; o V8 só governa o heap',
    description:
      'Um processo Node sem vazamento morre por OOM quando o limite que o V8 usa para adiar a coleta é maior do que o limite que o cgroup aplica, ou quando a memória fora do heap cresce sem nenhum teto. A correção é derivar as flags do V8 do limite do contêiner no entrypoint, fixar o espaço jovem, dar orçamento explícito ao que vive fora do heap, alertar pela razão entre RSS e limite, e provar em um contêiner com o mesmo limite da produção que o processo sobrevive a um churn maior do que a memória disponível.',
    cta: 'Revisar o dimensionamento de memória dos meus serviços',
  },
  related: [
    {
      label: 'Graceful shutdown que ninguém testou: deploy que corta requisição no meio e derruba job em andamento',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Exportação de relatório que derruba o servidor: arquivo grande em streaming sem estourar memória',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Serviço de observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'The pod restarts three times a day with OOMKilled and exit code 137. The team opens a heap snapshot, compares two moments, hunts for the array that grows forever, and finds nothing: heapUsed rises and falls in a sawtooth, exactly as it should. There is no leak. The process died because V8 and the kernel measure different things. The kernel compares the whole RSS of the process against the cgroup limit; V8 only governs the heap, sizes that heap by looking at the memory it believes exists, and lets garbage pile up close to that limit before collecting hard. When the limit V8 sees is larger than the limit the kernel enforces, the process is killed full of collectable garbage without ever having leaked a byte. This article shows how to tell that death apart from a real leak, how V8 decides the heap size and why the decision may look at the wrong machine, what counts against the cgroup besides the heap, how to derive the flags from the container limit, how to bound what lives outside the heap, and how to prove in a test that the process fits the limit.',
  sections: [
    {
      title: 'Exit code 137 is not a leak: two deaths with different symptoms',
      blocks: [
        {
          type: 'paragraph',
          value:
            'There are two ways for a Node process to die of memory, and they leave opposite traces. When the V8 heap reaches its own limit and the collector cannot free space, Node writes "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" to stderr, prints a summary of the heap spaces and exits with its own exit code. It is a death the process sees coming: a heap snapshot can be taken near the limit, state can be logged. When the RSS of the process exceeds the cgroup limit, the kernel decides, from the outside, with SIGKILL. There is no signal to handle, no handler runs, no log line is written. The process simply stops existing, and the only evidence is exit code 137 in the orchestrator and one line in the dmesg of the node.',
        },
        {
          type: 'table',
          columns: ['Symptom', 'Who decided', 'What the process saw', 'Most likely cause'],
          rows: [
            [
              'FATAL ERROR: Reached heap limit on stderr',
              'V8, when a heap allocation failed',
              'Everything: the error is logged with space statistics',
              'A leak of JavaScript objects, or a heap configured too small for the workload',
            ],
            [
              'OOMKilled, exit code 137, no final log line',
              'The kernel, comparing RSS against memory.max',
              'Nothing: SIGKILL is not delivered to the process',
              'Heap sized above the container limit, or memory outside the heap with no ceiling',
            ],
            [
              'ENOMEM in native calls, Buffer.alloc throwing',
              'The allocator, when asking the system for memory',
              'An exception in the call that failed',
              'Virtual memory limit or a single allocation that is too large; rare in containers',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The second row is the case of this article. And the check that separates the two is simple: on the heapUsed graph, a leak shows up as valleys that climb over the hours, because every full collection leaves more live memory behind. A badly sized process shows stable valleys and high peaks, because garbage accumulates as far as V8 allows, and V8 allows more than the cgroup does. If the valleys do not climb and the process died anyway, there is no point hunting for the growing array. The problem is in the configuration.',
        },
      ],
    },
    {
      title: 'How V8 decides the heap size, and which machine it looks at',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Without flags, Node asks V8 to size the heap from the available physical memory. On a 16 GB machine the old space limit lands around 4 GB, and the collector uses that ceiling to decide when a full collection is worth it: while there is room, it lets garbage pile up, because collecting less often costs less CPU. The question that defines the incident is where the physical memory number comes from. Node tries to read the cgroup limit and use the smaller of that and the total host memory. When it succeeds, the default heap lands at about a quarter of the container limit. When it fails, the heap is sized by the memory of the whole node.',
        },
        {
          type: 'paragraph',
          value:
            'That "when it succeeds" depends on three things that change from cluster to cluster: the Node version, the libuv version bundled with it, and whether the node runs cgroup v1 or v2. libuv versions older than the cgroup v2 support return zero on v2 nodes, which are now the default on recent distributions and current Kubernetes, and Node falls back to host memory. The result is a process with a 4 GB heap inside a 512 MiB container: the collector will let garbage reach hundreds of megabytes before a full collection, and the kernel kills first. Instead of memorizing the version matrix, measure on the actual image, with the same limit production uses.',
        },
        {
          type: 'code',
          value: `docker run --rm --memory=512m node:22-alpine node -e "
  const v8 = require('node:v8');
  console.log('heap_size_limit MiB:', Math.round(v8.getHeapStatistics().heap_size_limit / 1048576));
  console.log('constrainedMemory MiB:', Math.round((process.constrainedMemory?.() || 0) / 1048576));
"`,
        },
        {
          type: 'paragraph',
          value:
            'Two numbers matter in the output. If constrainedMemory comes back as zero, Node did not see the limit and the heap was sized by the host. If heap_size_limit comes back near or above 512, the heap alone can already fill the whole container. And even when Node reads the right limit, a quarter of it is a conservative guess that knows nothing about the application: a service that keeps an in-memory cache may need more, and one that handles uploads needs less heap and more room outside it. The heuristic is a starting point, never the production configuration.',
        },
        { type: 'diagram', value: diagramaEn },
      ],
    },
    {
      title: 'What counts against the cgroup and no V8 flag controls',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The most common modelling mistake is treating --max-old-space-size as the process limit. It bounds one heap space. The RSS the kernel measures includes the young space, which on recent 64-bit Node versions can reach 192 MiB by default, and everything that lives outside the heap: Buffers, native stream state, compiled code, thread stacks and the allocations of the C allocator itself. An empty Node process, before its first request, already has about 40 MiB outside the heap. Each component grows with a different kind of load, and none of them shows up in heapUsed.',
        },
        {
          type: 'table',
          columns: ['Component', 'Where it appears in process.memoryUsage()', 'What makes it grow'],
          rows: [
            [
              'V8 old space',
              'heapUsed and heapTotal',
              'Long-lived objects and garbage accumulated between full collections; bounded by --max-old-space-size',
            ],
            [
              'V8 young space',
              'heapTotal',
              'Allocation rate of short-lived objects; grows up to 3 x --max-semi-space-size',
            ],
            [
              'Buffers and ArrayBuffers',
              'external and arrayBuffers',
              'Request bodies read whole, files held in memory, large database responses',
            ],
            [
              'Native state of zlib, TLS and crypto',
              'Partly in external, the rest only in rss',
              'Each deflate stream reserves about 256 KiB of window and tables as soon as it starts compressing; each TLS connection has its own buffers',
            ],
            [
              'Compiled code and V8 metadata',
              'Only in rss',
              'Size of the loaded code and number of optimized functions',
            ],
            [
              'Thread and worker stacks',
              'Only in rss, and each worker_thread has an entire separate heap',
              'libuv thread pool, native modules, every new Worker without resourceLimits',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The last row is usually the surprise of the post-mortem. A worker_thread is a complete isolate, with its own heap sized by the same heuristic as the main process. Four workers without resourceLimits in a 1 GiB container are five heaps, each believing it can grow to the host ceiling. The same applies to the cluster module: each fork is a whole process, with the same NODE_OPTIONS, and the cgroup limit is shared by all of them. In a pod with four forks, the flag has to be computed for a quarter of the limit, not for the limit.',
        },
      ],
    },
    {
      title: 'Derive the flags from the container limit, not from the node size',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is to stop depending on the heuristic and compute the flags from the number the kernel is going to use. The right place for that is the container entrypoint: it reads the cgroup limit, reserves a slice for what lives outside the heap, subtracts the young space and hands the rest to the old space. Doing it in shell, before Node starts, solves a problem that cannot be solved in JavaScript: V8 flags must exist before the isolate is created, and no call from inside the process changes the heap size after that.',
        },
        { type: 'code', value: entrypointCode },
        {
          type: 'paragraph',
          value:
            'Three decisions in the script deserve an explanation. The reserve outside the heap is 25% of the limit with a floor of 96 MiB: the floor covers the 40 MiB of the empty process plus code and stacks in small containers, and the percentage follows the growth of Buffers and connections in large ones. The semi-space is pinned at 16 MiB instead of trusting the default, because the default varies between versions and can consume 192 MiB on its own; services with a high allocation rate can raise it to 32 or 64 and subtract three times that from the old space. And the two environment variables allow overriding the computation per service, without changing the image, for the case where the default proportion does not fit.',
        },
        {
          type: 'table',
          columns: [
            'Container limit',
            'Reserve outside the heap',
            'Young space (semi 16 MiB)',
            'Resulting max-old-space-size',
          ],
          rows: [
            ['256 MiB', '96 MiB', '48 MiB', '112 MiB'],
            ['512 MiB', '128 MiB', '48 MiB', '336 MiB'],
            ['1 GiB', '256 MiB', '48 MiB', '720 MiB'],
            ['2 GiB', '512 MiB', '48 MiB', '1488 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In Kubernetes, what appears in memory.max inside the container is the container limit, not the request. That is why memory request and limit should be equal: with a smaller request the pod lands in the Burstable class and can be evicted under node memory pressure before it even reaches its own limit, and the entrypoint computation, which only sees the limit, becomes wrong for the worst case. For workers, the same arithmetic applies through resourceLimits.maxOldGenerationSizeMb and maxYoungGenerationSizeMb in the Worker constructor, subtracting each heap from the main process share.',
        },
      ],
    },
    {
      title: 'See the configuration at startup and the pressure before the death',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Since a cgroup death leaves no log, observation has to happen beforehand. Two moments matter. At startup, the process should compare the heap limit V8 actually adopted with the cgroup limit Node can read, and log any mismatch: a heap above 80% of the container will die under load, and a heap below 40% will fail with "heap out of memory" with half the container free. At runtime, the only metric that anticipates the SIGKILL is the ratio between RSS and limit, because it is exactly the arithmetic the kernel does.',
        },
        { type: 'code', value: retratoCode },
        {
          type: 'list',
          items: [
            'Alert when the rss/limit ratio stays above 85% for more than two minutes: it is the warning the kernel will not give.',
            'Alert when the number of restarts with reason OOMKilled grows, read from the orchestrator, and not only when the pod is down: one restart every six hours goes unnoticed on the availability graph.',
            'Record rss minus heapTotal as its own series: if it climbs while heapUsed stays flat, the growth is in Buffers or native code, and the heap snapshot will show nothing.',
            'Use --heapsnapshot-near-heap-limit=1 with --diagnostic-dir pointing at a volume: it only fires for the heap death, not for the cgroup death, but it is what turns the former into evidence.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'On cgroup v2 nodes there is also an intermediate mechanism: memory.high, a ceiling below memory.max from which the kernel starts reclaiming memory and throttling the process instead of killing it. Recent orchestrators expose it as memory quality of service. It does not replace sizing, because a process throttled by page reclaim becomes slow in a way that is hard to diagnose, but it turns an instant death into a degradation with time for the alert to fire.',
        },
      ],
    },
    {
      title: 'Bound what lives outside the heap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'After sizing the heap, the part with no ceiling is native memory. An endpoint that reads the whole request body into a Buffer, to hand it to a ZIP or PDF parser that needs random access, allocates outside the heap and outside any flag. With 20 concurrent uploads of 30 MB, that is 600 MB the collector does not see, heapUsed does not show and the cgroup counts. The protection is to treat bytes outside the heap as a finite resource with an explicit budget: the request reserves what it will need, waits if there is no room, and releases when processing is done.',
        },
        { type: 'code', value: orcamentoCode },
        {
          type: 'paragraph',
          value:
            'The budget has to cover processing, not just reading, because the Buffer stays alive while the parser works; that is why the callback runs inside the try and the release sits in the finally. The size of the budget comes from the same arithmetic as the entrypoint: it is a fraction of the reserve outside the heap, never the whole reserve, because TLS, zlib and the runtime itself also live there. And a lying Content-Length is cut at two layers: the read rejects a body that exceeds the declared size, and the payload size limit at the edge rejects a declared size that exceeds the acceptable one. The same pattern applies to anything that allocates outside the heap per request, from resized images to database responses materialized whole.',
        },
      ],
    },
    {
      title: 'How to prove the process fits the limit',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The proof that matters does not run on the developer machine, where the heap is sized by 32 GB of RAM and nothing dies. It runs inside a container with the same limit as production and no swap, executing a script that allocates far more than the limit while keeping a modest live set. If the entrypoint is right, the collector keeps garbage below the ceiling and the process exits successfully; if it is wrong, docker returns 137. The churn script simulates the most common pattern in integration services: batches of parsed objects that are processed and discarded.',
        },
        { type: 'code', value: churnCode },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'The second test is the one that shows the original problem: the same script, with the heap configured above the container, is killed by the kernel without any leak. It depends on the V8 growth heuristic, which lets the heap reach a few times the live set before a full collection, which is why the window of live batches is kept small and the total allocation large. Run this pair of tests in the pipeline whenever the base image, the Node version or the pod limit changes: those are exactly the three changes that invalidate the configuration without touching a line of application code.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'If Node already reads the cgroup limit, do I still need the flags?',
      answer:
        'Yes, for two reasons. The first is that the read depends on the Node version, the libuv version and the cgroup type of the node, and a cluster upgrade can turn a process that read the limit into one that reads host memory. The second is that, even reading correctly, the heuristic uses a quarter of the limit without knowing whether the application keeps an in-memory cache or processes uploads. Explicit flags make the heap size a decision versioned together with the pod limit, and the startup check reports when the two stop matching.',
    },
    {
      question: 'Why does RSS not drop after the collector runs?',
      answer:
        'Because V8 and the C allocator return memory to the system lazily. After a full collection heapUsed drops, but heapTotal may stay reserved for the next allocation burst, and pages freed by malloc may remain mapped due to fragmentation. An RSS at a stable plateau below the limit is normal and does not indicate a problem. The leak signal is heapUsed right after full collections climbing over the hours; the native memory signal is rss minus heapTotal climbing while heapUsed stays flat.',
    },
    {
      question: 'Is it not simpler to raise the container limit?',
      answer:
        'Raising the limit without adjusting the heap only changes the moment of death, because V8 keeps sizing the heap by the memory it sees and letting garbage pile up near that ceiling. On a node where Node reads host memory, a 2 GiB container dies the same way a 512 MiB one does, only later and with more garbage accumulated. The limit should be set from the real live set of the application plus the native reserve, and the heap derived from it. Raising the limit is the right answer when measurement shows a high live set, not when it shows accumulated garbage.',
    },
  ],
  conclusion: {
    title: 'The kernel measures the whole process; V8 only governs the heap',
    description:
      'A Node process with no leak dies of OOM when the limit V8 uses to postpone collection is larger than the limit the cgroup enforces, or when memory outside the heap grows with no ceiling. The fix is to derive the V8 flags from the container limit in the entrypoint, pin the young space, give an explicit budget to what lives outside the heap, alert on the ratio between RSS and limit, and prove in a container with the same limit as production that the process survives a churn larger than the available memory.',
    cta: 'Review the memory sizing of my services',
  },
  related: [
    {
      label: 'The graceful shutdown nobody tested: a deploy that cuts requests mid-flight and kills running jobs',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'The report export that takes the server down: streaming a large file without blowing up memory',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Observability and reliability service',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'El pod se reinicia tres veces al día con OOMKilled y exit code 137. El equipo abre el heap snapshot, compara dos instantes, busca el array que crece para siempre y no encuentra nada: heapUsed sube y baja en sierra, como debe. No hay fuga. El proceso murió porque V8 y el kernel miden cosas distintas. El kernel compara el RSS completo del proceso con el límite del cgroup; V8 solo gobierna el heap, dimensiona ese heap mirando la memoria que cree que existe y deja que la basura se acumule hasta cerca de ese límite antes de recolectar con fuerza. Cuando el límite que V8 ve es mayor que el límite que el kernel aplica, el proceso muere lleno de basura recolectable, sin haber fugado nunca un byte. Este artículo muestra cómo distinguir esa muerte de una fuga real, cómo V8 decide el tamaño del heap y por qué la decisión puede mirar a la máquina equivocada, qué entra en la cuenta del cgroup además del heap, cómo derivar las flags del límite del contenedor, cómo acotar lo que vive fuera del heap y cómo demostrar en una prueba que el proceso cabe en el límite.',
  sections: [
    {
      title: 'Exit code 137 no es una fuga: dos muertes con síntomas distintos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Hay dos maneras de que un proceso Node muera por memoria, y dejan rastros opuestos. Cuando el heap de V8 llega a su propio límite y el recolector no consigue liberar espacio, Node escribe "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory" en stderr, imprime un resumen de los espacios del heap y termina con un código de salida propio. Es una muerte que el proceso ve venir: se puede generar un heap snapshot cerca del límite, se puede registrar el estado. Cuando el RSS del proceso supera el límite del cgroup, es el kernel quien decide, desde fuera, con SIGKILL. No hay señal que atender, no corre ningún handler, no hay línea de log. El proceso simplemente deja de existir, y la única evidencia es el exit code 137 en el orquestador y una línea en el dmesg del nodo.',
        },
        {
          type: 'table',
          columns: ['Síntoma', 'Quién decidió', 'Qué vio el proceso', 'Causa más probable'],
          rows: [
            [
              'FATAL ERROR: Reached heap limit en stderr',
              'V8, al fallar una asignación en el heap',
              'Todo: el error sale en el log con estadísticas de los espacios',
              'Fuga de objetos JavaScript o heap configurado demasiado pequeño para la carga',
            ],
            [
              'OOMKilled, exit code 137, ninguna línea final en el log',
              'El kernel, al comparar el RSS con memory.max',
              'Nada: SIGKILL no se entrega al proceso',
              'Heap dimensionado por encima del límite del contenedor, o memoria fuera del heap sin techo',
            ],
            [
              'ENOMEM en llamadas nativas, Buffer.alloc lanzando error',
              'El asignador, al pedir memoria al sistema',
              'Una excepción en la llamada que falló',
              'Límite de memoria virtual o una asignación única demasiado grande; raro en contenedores',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La segunda fila es el caso de este artículo. Y la comprobación que distingue los dos es simple: en la gráfica de heapUsed, una fuga aparece como valles que suben a lo largo de las horas, porque cada recolección completa deja más memoria viva. Un proceso mal dimensionado muestra valles estables y picos altos, porque la basura se acumula hasta donde V8 permite, y V8 permite más que el cgroup. Si los valles no suben y el proceso murió igual, no sirve buscar el array que crece. El problema está en la configuración.',
        },
      ],
    },
    {
      title: 'Cómo V8 decide el tamaño del heap, y a qué máquina mira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Sin flags, Node le pide a V8 que dimensione el heap a partir de la memoria física disponible. En una máquina de 16 GB, el límite del old space queda alrededor de 4 GB, y el recolector usa ese techo para decidir cuándo vale la pena una recolección completa: mientras hay holgura, deja que la basura se acumule, porque recolectar menos veces cuesta menos CPU. La pregunta que define el incidente es de dónde sale el número de memoria física. Node intenta leer el límite del cgroup y usar el menor entre ese valor y la memoria total del host. Cuando lo consigue, el heap por defecto queda en cerca de un cuarto del límite del contenedor. Cuando no lo consigue, el heap se dimensiona con la memoria del nodo entero.',
        },
        {
          type: 'paragraph',
          value:
            'Ese "cuando lo consigue" depende de tres cosas que cambian de clúster a clúster: la versión de Node, la versión de libuv incluida en él y si el nodo usa cgroup v1 o v2. Las versiones de libuv anteriores al soporte de cgroup v2 devuelven cero en nodos v2, que hoy son el valor por defecto en distribuciones recientes y en Kubernetes actual, y Node cae a la memoria del host. El resultado es un proceso con heap de 4 GB dentro de un contenedor de 512 MiB: el recolector dejará que la basura llegue a cientos de megabytes antes de una recolección completa, y el kernel mata antes. En vez de memorizar la matriz de versiones, mide en la propia imagen, con el mismo límite que usa producción.',
        },
        {
          type: 'code',
          value: `docker run --rm --memory=512m node:22-alpine node -e "
  const v8 = require('node:v8');
  console.log('heap_size_limit MiB:', Math.round(v8.getHeapStatistics().heap_size_limit / 1048576));
  console.log('constrainedMemory MiB:', Math.round((process.constrainedMemory?.() || 0) / 1048576));
"`,
        },
        {
          type: 'paragraph',
          value:
            'Dos números importan en la salida. Si constrainedMemory viene en cero, Node no vio el límite y el heap se dimensionó con el host. Si heap_size_limit viene cerca o por encima de 512, el heap solo ya puede ocupar el contenedor entero. Y aun cuando Node lee el límite correcto, un cuarto de él es una suposición conservadora que no sabe nada de la aplicación: un servicio que mantiene caché en memoria puede necesitar más, y uno que procesa uploads necesita menos heap y más espacio fuera de él. La heurística es un punto de partida, nunca la configuración de producción.',
        },
        { type: 'diagram', value: diagramaEs },
      ],
    },
    {
      title: 'Qué entra en la cuenta del cgroup y ninguna flag de V8 controla',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El error de modelo más común es tratar --max-old-space-size como límite del proceso. Limita un espacio del heap. El RSS que mide el kernel incluye el espacio joven, que en versiones recientes de Node en 64 bits puede llegar a 192 MiB por defecto, y todo lo que vive fuera del heap: Buffers, estado nativo de streams, código compilado, pilas de threads y las asignaciones del propio asignador de C. Un proceso Node vacío, antes de recibir la primera petición, ya tiene unos 40 MiB fuera del heap. Cada componente crece con un tipo distinto de carga, y ninguno aparece en heapUsed.',
        },
        {
          type: 'table',
          columns: ['Componente', 'Dónde aparece en process.memoryUsage()', 'Qué lo hace crecer'],
          rows: [
            [
              'Old space de V8',
              'heapUsed y heapTotal',
              'Objetos de vida larga y basura acumulada entre recolecciones completas; limitado por --max-old-space-size',
            ],
            [
              'Espacio joven de V8',
              'heapTotal',
              'Tasa de asignación de objetos cortos; crece hasta 3 x --max-semi-space-size',
            ],
            [
              'Buffers y ArrayBuffers',
              'external y arrayBuffers',
              'Cuerpos de petición leídos enteros, archivos en memoria, respuestas grandes de base de datos',
            ],
            [
              'Estado nativo de zlib, TLS y crypto',
              'Parte en external, el resto solo en rss',
              'Cada stream de deflate reserva unos 256 KiB de ventana y tablas en cuanto empieza a comprimir; cada conexión TLS tiene sus propios buffers',
            ],
            [
              'Código compilado y metadatos de V8',
              'Solo en rss',
              'Tamaño del código cargado y cantidad de funciones optimizadas',
            ],
            [
              'Pilas de threads y workers',
              'Solo en rss, y cada worker_thread tiene un heap entero aparte',
              'Thread pool de libuv, módulos nativos, cada new Worker sin resourceLimits',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La última fila suele ser la sorpresa del post-mortem. Un worker_thread es un isolate completo, con heap propio dimensionado por la misma heurística que el proceso principal. Cuatro workers sin resourceLimits en un contenedor de 1 GiB son cinco heaps, cada uno creyendo que puede crecer hasta el techo del host. Lo mismo vale para el módulo cluster: cada fork es un proceso entero, con el mismo NODE_OPTIONS, y el límite del cgroup lo comparten todos. En un pod con cuatro forks, la flag tiene que calcularse para un cuarto del límite, no para el límite.',
        },
      ],
    },
    {
      title: 'Derivar las flags del límite del contenedor, no del tamaño del nodo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección es dejar de depender de la heurística y calcular las flags a partir del número que el kernel va a usar. El lugar correcto para eso es el entrypoint del contenedor: lee el límite del cgroup, reserva una porción para lo que vive fuera del heap, descuenta el espacio joven y entrega el resto al old space. Hacerlo en shell, antes de que Node arranque, resuelve un problema que no se puede resolver en JavaScript: las flags de V8 tienen que existir antes de crear el isolate, y ninguna llamada desde dentro del proceso cambia el tamaño del heap después de eso.',
        },
        { type: 'code', value: entrypointCode },
        {
          type: 'paragraph',
          value:
            'Tres decisiones del script merecen explicación. La reserva fuera del heap es el 25% del límite con un piso de 96 MiB: el piso cubre los 40 MiB del proceso vacío más código y pilas en contenedores pequeños, y el porcentaje acompaña el crecimiento de Buffers y conexiones en contenedores grandes. El semi-space se fija en 16 MiB en vez de confiar en el valor por defecto, porque ese valor varía entre versiones y puede consumir por sí solo 192 MiB; los servicios con alta tasa de asignación pueden subirlo a 32 o 64 y descontar el triple del old space. Y las dos variables de entorno permiten sobrescribir el cálculo por servicio, sin cambiar la imagen, para el caso en que la proporción por defecto no sirve.',
        },
        {
          type: 'table',
          columns: [
            'Límite del contenedor',
            'Reserva fuera del heap',
            'Espacio joven (semi 16 MiB)',
            'max-old-space-size resultante',
          ],
          rows: [
            ['256 MiB', '96 MiB', '48 MiB', '112 MiB'],
            ['512 MiB', '128 MiB', '48 MiB', '336 MiB'],
            ['1 GiB', '256 MiB', '48 MiB', '720 MiB'],
            ['2 GiB', '512 MiB', '48 MiB', '1488 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En Kubernetes, lo que aparece en memory.max dentro del contenedor es el límite del contenedor, no el request. Por eso request y limit de memoria deben ser iguales: con un request menor, el pod entra en la clase Burstable y puede ser desalojado por presión de memoria del nodo antes incluso de llegar a su propio límite, y el cálculo del entrypoint, que solo ve el limit, pasa a estar equivocado para el peor caso. Para workers, la misma cuenta vale con resourceLimits.maxOldGenerationSizeMb y maxYoungGenerationSizeMb en el constructor del Worker, descontando cada heap de la porción del proceso principal.',
        },
      ],
    },
    {
      title: 'Ver la configuración al arrancar y la presión antes de la muerte',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Como la muerte por cgroup no deja log, la observación tiene que ocurrir antes. Importan dos momentos. Al arrancar, el proceso debe comparar el límite de heap que V8 adoptó realmente con el límite del cgroup que Node consigue leer, y registrar cualquier desproporción: un heap por encima del 80% del contenedor va a morir bajo carga, y un heap por debajo del 40% va a fallar con "heap out of memory" con la mitad del contenedor libre. En ejecución, la única métrica que anticipa el SIGKILL es la razón entre RSS y límite, porque es exactamente la cuenta que hace el kernel.',
        },
        { type: 'code', value: retratoCode },
        {
          type: 'list',
          items: [
            'Alertar cuando la razón rss/límite supera el 85% durante más de dos minutos: es el aviso que el kernel no va a dar.',
            'Alertar cuando el número de reinicios con motivo OOMKilled crece, leído del orquestador, y no solo cuando el pod está caído: un reinicio cada seis horas pasa desapercibido en la gráfica de disponibilidad.',
            'Registrar la diferencia rss menos heapTotal como serie propia: si sube mientras heapUsed se mantiene estable, el crecimiento está en Buffers o en código nativo, y el heap snapshot no va a mostrar nada.',
            'Usar --heapsnapshot-near-heap-limit=1 con --diagnostic-dir apuntando a un volumen: solo se dispara en la muerte por heap, no en la muerte por cgroup, pero es lo que convierte la primera en evidencia.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'En nodos con cgroup v2 existe además un recurso intermedio: memory.high, un techo por debajo de memory.max a partir del cual el kernel empieza a reclamar memoria y frenar el proceso en vez de matarlo. Los orquestadores recientes lo exponen como calidad de servicio de memoria. No sustituye al dimensionamiento, porque un proceso frenado por reclamación de páginas se vuelve lento de una forma difícil de diagnosticar, pero convierte una muerte instantánea en una degradación con tiempo para que la alerta se dispare.',
        },
      ],
    },
    {
      title: 'Acotar lo que vive fuera del heap',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Después de dimensionar el heap, la parte sin techo es la memoria nativa. Un endpoint que lee el cuerpo de la petición entero en un Buffer, para pasárselo a un parser de ZIP o PDF que necesita acceso aleatorio, asigna fuera del heap y fuera de cualquier flag. Con 20 uploads simultáneos de 30 MB, son 600 MB que el recolector no ve, que heapUsed no muestra y que el cgroup cuenta. La protección es tratar los bytes fuera del heap como un recurso finito con presupuesto explícito: la petición reserva lo que va a necesitar, espera si no hay espacio y libera cuando el procesamiento termina.',
        },
        { type: 'code', value: orcamentoCode },
        {
          type: 'paragraph',
          value:
            'El presupuesto tiene que cubrir el procesamiento, no solo la lectura, porque el Buffer sigue vivo mientras el parser trabaja; por eso el callback corre dentro del try y la liberación queda en el finally. El tamaño del presupuesto sale de la misma cuenta del entrypoint: es una fracción de la reserva fuera del heap, nunca la reserva entera, porque TLS, zlib y el propio runtime también viven ahí. Y el Content-Length mentiroso se corta en dos capas: la lectura rechaza el cuerpo que supera lo declarado, y el límite de tamaño de payload en el borde rechaza lo declarado que supera lo aceptable. El mismo patrón se aplica a cualquier cosa que asigne fuera del heap por petición, desde imágenes redimensionadas hasta respuestas de base de datos materializadas enteras.',
        },
      ],
    },
    {
      title: 'Cómo demostrar que el proceso cabe en el límite',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La prueba que importa no corre en la máquina del desarrollador, donde el heap se dimensiona con 32 GB de RAM y nada muere. Corre dentro de un contenedor con el mismo límite que producción y sin swap, ejecutando un script que asigna mucho más que el límite mientras mantiene un conjunto vivo modesto. Si el entrypoint está bien, el recolector mantiene la basura por debajo del techo y el proceso termina con éxito; si está mal, docker devuelve 137. El script de churn simula el patrón más común en servicios de integración: lotes de objetos parseados que se procesan y se descartan.',
        },
        { type: 'code', value: churnCode },
        { type: 'code', value: testeCode },
        {
          type: 'paragraph',
          value:
            'La segunda prueba es la que muestra el problema original: el mismo script, con el heap configurado por encima del contenedor, es matado por el kernel sin ninguna fuga. Depende de la heurística de crecimiento de V8, que deja que el heap llegue a varias veces el conjunto vivo antes de una recolección completa, por eso la ventana de lotes vivos se mantiene pequeña y el total asignado grande. Conviene ejecutar este par de pruebas en la pipeline siempre que cambien la imagen base, la versión de Node o el límite del pod: son exactamente los tres cambios que invalidan la configuración sin tocar una línea de código de la aplicación.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Si Node ya lee el límite del cgroup, ¿sigo necesitando las flags?',
      answer:
        'Sí, por dos motivos. El primero es que la lectura depende de la versión de Node, de libuv y del tipo de cgroup del nodo, y una actualización del clúster puede hacer que un proceso que leía el límite pase a leer la memoria del host. El segundo es que, aun leyendo bien, la heurística usa un cuarto del límite sin saber si la aplicación mantiene caché en memoria o procesa uploads. Las flags explícitas convierten el tamaño del heap en una decisión versionada junto con el límite del pod, y la verificación al arrancar denuncia cuando las dos dejan de coincidir.',
    },
    {
      question: '¿Por qué el RSS no baja después de que corre el recolector?',
      answer:
        'Porque V8 y el asignador de C devuelven memoria al sistema con pereza. Después de una recolección completa, heapUsed baja, pero heapTotal puede quedar reservado para la próxima ráfaga de asignación, y las páginas liberadas por malloc pueden seguir mapeadas por fragmentación. Un RSS en una meseta estable por debajo del límite es normal y no indica problema. La señal de fuga es heapUsed justo después de recolecciones completas subiendo a lo largo de las horas; la señal de memoria nativa creciendo es rss menos heapTotal subiendo mientras heapUsed se mantiene estable.',
    },
    {
      question: '¿No es más simple subir el límite del contenedor?',
      answer:
        'Subir el límite sin ajustar el heap solo cambia el momento de la muerte, porque V8 sigue dimensionando el heap con la memoria que ve y dejando que la basura se acumule hasta cerca de ese techo. En un nodo donde Node lee la memoria del host, un contenedor de 2 GiB muere igual que uno de 512 MiB, solo más tarde y con más basura acumulada. El límite debe definirse a partir del conjunto vivo real de la aplicación más la reserva nativa, y el heap derivarse de él. Subir el límite es la respuesta correcta cuando la medición muestra un conjunto vivo alto, no cuando muestra basura acumulada.',
    },
  ],
  conclusion: {
    title: 'El kernel mide el proceso entero; V8 solo gobierna el heap',
    description:
      'Un proceso Node sin fuga muere por OOM cuando el límite que V8 usa para postergar la recolección es mayor que el límite que aplica el cgroup, o cuando la memoria fuera del heap crece sin ningún techo. La corrección es derivar las flags de V8 del límite del contenedor en el entrypoint, fijar el espacio joven, dar presupuesto explícito a lo que vive fuera del heap, alertar por la razón entre RSS y límite, y demostrar en un contenedor con el mismo límite que producción que el proceso sobrevive a un churn mayor que la memoria disponible.',
    cta: 'Revisar el dimensionamiento de memoria de mis servicios',
  },
  related: [
    {
      label: 'El graceful shutdown que nadie probó: un despliegue que corta peticiones a medias y tumba jobs en curso',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'La exportación de informe que tumba el servidor: archivo grande en streaming sin reventar la memoria',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Servicio de observabilidad y confiabilidad',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
