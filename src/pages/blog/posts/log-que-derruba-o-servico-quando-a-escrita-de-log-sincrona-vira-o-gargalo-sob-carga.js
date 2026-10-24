// Conteudo do artigo: log que derruba o servico. Por que a escrita de log sincrona trava o
// event loop sob carga e a assincrona sem limite troca latencia por OOM, por onde a linha de
// log passa ate o disco, como medir o custo do log, como cortar volume na origem, como tirar
// a escrita do caminho da requisicao com fila limitada e descarte explicito e como provar em
// teste que um destino lento nao derruba o processo.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }] }

const loggerCode = `// logger.js
// A requisicao nunca espera o destino do log: a linha vai para uma fila em memoria
// com teto em bytes, e a escrita acontece em lotes, respeitando o backpressure do stream.
const NIVEIS = { debug: 20, info: 30, warn: 40, error: 50 };

export function criarLogger({
  destino = process.stdout,
  nivel = process.env.LOG_LEVEL || 'info',
  limiteBytes = 8 * 1024 * 1024, // acima disso, debug e info sao descartados
  limiteDuroBytes = 16 * 1024 * 1024, // acima disso, ate warn e error sao descartados
  tamanhoLote = 64 * 1024,
  intervaloResumoMs = 10_000,
} = {}) {
  const minimo = NIVEIS[nivel] ?? NIVEIS.info;
  const fila = [];
  let bytesNaFila = 0;
  let aguardandoDrain = false;
  let agendado = false;
  const descartadas = { debug: 0, info: 0, warn: 0, error: 0 };

  function escreverLotes() {
    agendado = false;
    while (fila.length > 0 && !aguardandoDrain) {
      let n = 0;
      let bytes = 0;
      while (n < fila.length && bytes < tamanhoLote) {
        bytes += fila[n].bytes;
        n += 1;
      }
      const lote = fila.splice(0, n);
      bytesNaFila -= bytes;
      // write() devolve false quando o buffer interno do stream passou do highWaterMark:
      // paramos de empurrar e so voltamos no 'drain', em vez de acumular sem limite.
      if (!destino.write(lote.map((l) => l.texto).join(''))) {
        aguardandoDrain = true;
        destino.once('drain', () => {
          aguardandoDrain = false;
          escreverLotes();
        });
      }
    }
  }

  function agendar() {
    if (agendado || aguardandoDrain) return;
    agendado = true;
    setImmediate(escreverLotes);
  }

  function enfileirar(texto, nomeNivel) {
    const bytes = Buffer.byteLength(texto);
    const teto = NIVEIS[nomeNivel] >= NIVEIS.warn ? limiteDuroBytes : limiteBytes;
    if (bytesNaFila + bytes > teto) {
      descartadas[nomeNivel] += 1;
      return;
    }
    fila.push({ texto, bytes });
    bytesNaFila += bytes;
    agendar();
  }

  function registrar(nomeNivel, msg, campos) {
    if (NIVEIS[nomeNivel] < minimo) return;
    let texto;
    try {
      texto = JSON.stringify({ time: Date.now(), level: nomeNivel, msg, ...campos }) + '\\n';
    } catch (erro) {
      texto = JSON.stringify({ time: Date.now(), level: nomeNivel, msg, erroSerializacao: erro.message }) + '\\n';
    }
    enfileirar(texto, nomeNivel);
  }

  // Descarte silencioso e pior que descarte: a cada intervalo, uma linha diz quanto se perdeu.
  const resumo = setInterval(() => {
    const total = Object.values(descartadas).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const texto = JSON.stringify({ time: Date.now(), level: 'warn', msg: 'logs descartados', ...descartadas }) + '\\n';
    for (const chave of Object.keys(descartadas)) descartadas[chave] = 0;
    fila.push({ texto, bytes: Buffer.byteLength(texto) });
    bytesNaFila += Buffer.byteLength(texto);
    agendar();
  }, intervaloResumoMs);
  resumo.unref();

  return {
    nivelAtivo: (nomeNivel) => NIVEIS[nomeNivel] >= minimo,
    debug: (msg, campos) => registrar('debug', msg, campos),
    info: (msg, campos) => registrar('info', msg, campos),
    warn: (msg, campos) => registrar('warn', msg, campos),
    error: (msg, campos) => registrar('error', msg, campos),
    estado: () => ({ bytesNaFila, linhasNaFila: fila.length, bufferDoStream: destino.writableLength, descartadas: { ...descartadas } }),
    // No desligamento: escreve o que restou e espera o stream confirmar, com prazo.
    encerrar(prazoMs = 5_000) {
      clearInterval(resumo);
      return new Promise((resolve) => {
        const limite = setTimeout(resolve, prazoMs);
        const verificar = () => {
          if (fila.length > 0 || aguardandoDrain) {
            escreverLotes();
            setTimeout(verificar, 10);
            return;
          }
          destino.write('', () => {
            clearTimeout(limite);
            resolve();
          });
        };
        verificar();
      });
    },
  };
}`;

const metricasCode = `// metricas-log.js
// Tres numeros respondem se o log esta custando caro: quanto o event loop atrasa,
// quantos bytes por segundo o processo produz e quanto ficou parado no buffer do stdout.
import { monitorEventLoopDelay } from 'node:perf_hooks';

const atraso = monitorEventLoopDelay({ resolution: 20 });
atraso.enable();

let bytesEscritos = 0;
const writeOriginal = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, ...resto) => {
  bytesEscritos += Buffer.byteLength(chunk);
  return writeOriginal(chunk, ...resto);
};

const INTERVALO_S = 10;
setInterval(() => {
  // stderr de proposito: a metrica sobre o stdout nao pode depender do stdout.
  process.stderr.write(
    JSON.stringify({
      msg: 'saude do log',
      eventLoopP99Ms: Number((atraso.percentile(99) / 1e6).toFixed(1)),
      eventLoopMaxMs: Number((atraso.max / 1e6).toFixed(1)),
      logBytesPorSegundo: Math.round(bytesEscritos / INTERVALO_S),
      stdoutBufferBytes: process.stdout.writableLength,
    }) + '\\n',
  );
  bytesEscritos = 0;
  atraso.reset();
}, INTERVALO_S * 1000).unref();`;

const testeCode = `// logger.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { criarLogger } from './logger.js';

// Destino que imita um coletor de log lento: aceita 64 KiB e leva 20 ms por escrita.
function destinoLento() {
  const linhas = [];
  const destino = new Writable({
    highWaterMark: 64 * 1024,
    write(chunk, _enc, cb) {
      linhas.push(...chunk.toString().split('\\n').filter(Boolean));
      setTimeout(cb, 20);
    },
  });
  return { destino, linhas };
}

test('destino lento nao bloqueia o event loop nem faz a memoria crescer sem limite', async () => {
  const { destino, linhas } = destinoLento();
  const log = criarLogger({ destino, limiteBytes: 1024 * 1024, limiteDuroBytes: 2 * 1024 * 1024 });
  const atraso = monitorEventLoopDelay({ resolution: 10 });
  atraso.enable();

  let picoFila = 0;
  for (let rodada = 0; rodada < 50; rodada += 1) {
    for (let i = 0; i < 2_000; i += 1) log.info('pedido processado', { pedidoId: \`\${rodada}-\${i}\`, itens: 3 });
    log.error('falha ao cobrar', { pedidoId: \`erro-\${rodada}\` });
    picoFila = Math.max(picoFila, log.estado().bytesNaFila);
    await new Promise((r) => setImmediate(r));
  }
  await log.encerrar();
  atraso.disable();

  assert.ok(picoFila <= 2 * 1024 * 1024, \`fila passou do teto: \${picoFila}\`);
  assert.ok(atraso.max / 1e6 < 200, \`event loop travou \${atraso.max / 1e6} ms\`);
  const erros = linhas.filter((l) => JSON.parse(l).level === 'error');
  assert.equal(erros.length, 50, 'nenhum error pode ser descartado abaixo do limite duro');
  assert.ok(linhas.length < 100_050, 'parte dos info deveria ter sido descartada');
});

test('encerrar escreve tudo o que estava na fila', async () => {
  const { destino, linhas } = destinoLento();
  const log = criarLogger({ destino });
  for (let i = 0; i < 5_000; i += 1) log.info('linha', { i });
  await log.encerrar();
  assert.equal(linhas.length, 5_000);
});

test('nivel abaixo do minimo nao serializa nada', () => {
  const { destino } = destinoLento();
  const log = criarLogger({ destino, nivel: 'info' });
  let chamado = false;
  log.debug('caro', { get payload() { chamado = true; return 1; } });
  assert.equal(chamado, false);
  assert.equal(log.estado().linhasNaFila, 0);
});`;

const diagnosticoCode = `# Para onde o fd 1 do processo aponta: arquivo, pipe ou socket mudam o comportamento.
ls -l /proc/$(pgrep -f "node server.js")/fd/1
# l-wx------ 1 node node 64 ... 1 -> pipe:[48213907]

# Quanto tempo cada write() leva de verdade (-T mostra a duracao da syscall).
strace -f -T -e trace=write -p $(pgrep -f "node server.js") 2>&1 | head -20
# write(1, "{\\"time\\":1729...", 4120) = 4120 <0.031244>

# Volume por nivel e as 10 mensagens que mais ocupam espaco na ultima hora.
kubectl logs deploy/api-pedidos --since=1h \\
  | jq -r '[.level, .msg] | @tsv' | sort | uniq -c | sort -rn | head -10`;

const diagramaPt = `Caminho de uma linha de log em um pod, e onde cada trecho pode empurrar a espera de volta.

  requisição ──► log.info() ──► JSON.stringify ──► write(fd 1)
                  (thread         (CPU na thread      │
                   principal)      principal)          ▼
                                              pipe do kernel (64 KiB)
                                                       │  cheio? write espera
                                                       ▼  ou o Node acumula em memória
                                              runtime do contêiner (containerd/docker)
                                                       │
                                                       ▼
                                              arquivo em /var/log/pods  ◄── disco do nó,
                                                       │                    dividido com
                                                       ▼                    os outros pods
                                              agente (Fluent Bit, Vector)
                                                       │
                                                       ▼
                                              backend (Loki, Elasticsearch, Datadog)

Qualquer trecho mais lento do que a taxa de produção vira fila.
A fila termina em um de dois lugares: no event loop (escrita síncrona) ou no heap (assíncrona sem limite).`;

const diagramaEn = `Path of one log line inside a pod, and where each stretch can push the wait back upstream.

  request ──► log.info() ──► JSON.stringify ──► write(fd 1)
               (main           (CPU on the         │
                thread)         main thread)        ▼
                                           kernel pipe (64 KiB)
                                                    │  full? write waits
                                                    ▼  or Node piles it up in memory
                                           container runtime (containerd/docker)
                                                    │
                                                    ▼
                                           file in /var/log/pods  ◄── node disk,
                                                    │                 shared with
                                                    ▼                 the other pods
                                           agent (Fluent Bit, Vector)
                                                    │
                                                    ▼
                                           backend (Loki, Elasticsearch, Datadog)

Any stretch slower than the production rate becomes a queue.
That queue ends up in one of two places: the event loop (synchronous writes) or the heap (unbounded asynchronous writes).`;

const diagramaEs = `Camino de una línea de log dentro de un pod, y dónde cada tramo puede devolver la espera hacia atrás.

  petición ──► log.info() ──► JSON.stringify ──► write(fd 1)
                (hilo           (CPU en el hilo      │
                 principal)      principal)           ▼
                                             pipe del kernel (64 KiB)
                                                      │  ¿lleno? write espera
                                                      ▼  o Node lo acumula en memoria
                                             runtime del contenedor (containerd/docker)
                                                      │
                                                      ▼
                                             archivo en /var/log/pods  ◄── disco del nodo,
                                                      │                    compartido con
                                                      ▼                    los demás pods
                                             agente (Fluent Bit, Vector)
                                                      │
                                                      ▼
                                             backend (Loki, Elasticsearch, Datadog)

Cualquier tramo más lento que la tasa de producción se convierte en cola.
Esa cola termina en uno de dos lugares: en el event loop (escritura síncrona) o en el heap (asíncrona sin límite).`;

const pt = {
  intro:
    'Na primeira hora da Black Friday, a API de pedidos de um e-commerce passa de 45 ms para 2,8 segundos de p99. A CPU das 12 instâncias está em 35%, o banco responde em 4 ms, o pool de conexões tem folga e nenhum erro aparece no painel. O profile da thread principal conta outra história: 61% do tempo dentro de writeSync. Duas semanas antes, alguém ligou o nível debug para investigar um bug de frete e esqueceu de desligar; cada requisição passou a gerar nove linhas, uma delas com o payload inteiro do carrinho, e o logger escrevia de forma síncrona em um arquivo em um volume que divide IOPS com outros 30 pods do nó. Com o tráfego multiplicado por seis, cada escrita passou a esperar o disco, e cada espera parou o event loop inteiro. O time trocou para escrita assíncrona no mesmo dia, a latência voltou e, 40 minutos depois, os pods começaram a reiniciar com OOMKilled: o disco continuava lento, e agora as linhas se acumulavam no heap. Este artigo mostra por onde a linha de log passa até chegar ao disco e onde a espera volta para o processo, como medir o custo do log antes de trocar de biblioteca, como cortar volume na origem, como tirar a escrita do caminho da requisição com uma fila limitada e descarte explícito, e como provar em teste que um destino lento não derruba o serviço.',
  sections: [
    {
      title: 'O serviço que ficou lento sem CPU, sem banco e sem erro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Log costuma ser tratado como efeito colateral grátis: uma chamada que não falha, não tem latência relevante e não entra no orçamento de nenhuma requisição. Isso só é verdade enquanto o destino do log é mais rápido do que a taxa com que o processo produz linhas. Quando deixa de ser, o log vira a dependência mais acoplada do serviço, porque toda requisição passa por ela, várias vezes, sem timeout, sem circuit breaker e sem que ninguém a liste no diagrama de arquitetura.',
        },
        {
          type: 'paragraph',
          value:
            'Em Node.js, o problema tem uma forma específica. A escrita síncrona em arquivo, que é o que um destino síncrono faz por baixo, executa a syscall write na thread principal e só volta quando o kernel aceitou os bytes. Com o page cache saudável, isso custa microssegundos. Com o disco saturado, com o volume de rede em throttling de IOPS ou com o kernel forçando writeback porque há páginas sujas demais, a mesma chamada leva dezenas de milissegundos. Nesse intervalo nenhuma outra requisição avança, nenhum timer dispara e nenhum health check responde. O sintoma é latência alta com CPU baixa, que é exatamente o padrão que faz o time procurar no banco primeiro.',
        },
        {
          type: 'paragraph',
          value:
            'A escrita assíncrona sem limite não resolve, só muda o lugar da fila. O processo entrega a linha ao stream, o stream devolve false porque o buffer interno passou do highWaterMark, ninguém verifica o retorno, e o stream continua aceitando e guardando tudo em memória. A latência fica ótima enquanto o heap cresce em linha reta, até o limite do cgroup. É o mesmo gargalo, agora com outro sintoma e um atraso de 40 minutos para aparecer.',
        },
        {
          type: 'table',
          columns: ['Estratégia de escrita', 'Destino lento causa', 'Sintoma visível', 'Quando aparece'],
          rows: [
            ['Síncrona direta', 'Thread principal parada na syscall', 'p99 alto com CPU baixa, health check falhando', 'Imediatamente, proporcional ao tráfego'],
            ['Assíncrona sem limite', 'Buffer do stream crescendo no heap', 'Memória em rampa, OOMKilled, perda do buffer inteiro', 'Minutos ou horas depois do pico'],
            ['Assíncrona com fila limitada e descarte', 'Linhas de baixa prioridade descartadas e contadas', 'Contador de descarte subindo, latência e memória estáveis', 'Só no indicador que você criou para isso'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A terceira linha é o objetivo do artigo. Não existe configuração que torne um disco lento rápido; o que dá para escolher é quem paga quando ele fica lento. A resposta certa para quase todo serviço de requisição é que o log paga, perdendo linhas de forma visível e controlada, e não o cliente.',
        },
      ],
    },
    {
      title: 'Por onde a linha de log passa até chegar ao disco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Em um pod de Kubernetes, o processo escreve no file descriptor 1, que normalmente é um pipe. Do outro lado está o runtime do contêiner, que lê o pipe, acrescenta timestamp e stream e grava em um arquivo em /var/log/pods no disco do nó. Um agente como Fluent Bit ou Vector lê esses arquivos e envia ao backend. Cada etapa tem sua própria capacidade, e a menor delas define a taxa máxima sustentável de log de todos os pods daquele nó juntos, não de um processo isolado.',
        },
        {
          type: 'diagram',
          value: diagramaPt,
        },
        {
          type: 'table',
          columns: ['Trecho', 'Capacidade típica', 'O que acontece quando enche'],
          rows: [
            ['Serialização (JSON.stringify)', 'Limitada pela CPU da thread principal; objetos grandes custam milissegundos', 'Tempo de CPU tirado das requisições, mesmo com destino rápido'],
            ['Pipe do kernel', '64 KiB por padrão no Linux', 'write bloqueia ou devolve EAGAIN, conforme o modo do fd'],
            ['Runtime do contêiner', 'Lê o pipe e grava arquivo; no Docker, o modo padrão do driver é blocking', 'Para de ler o pipe enquanto o disco não aceita; o pipe enche'],
            ['Disco do nó', 'IOPS e throughput divididos entre todos os pods', 'Latência de escrita sobe para todos ao mesmo tempo'],
            ['Agente de coleta', 'Lê arquivos com buffer próprio e limite de memória', 'Atrasa o envio ou pausa a leitura; os arquivos crescem até a rotação'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dois detalhes desse caminho explicam a maioria dos incidentes. O primeiro é que a capacidade é compartilhada: um pod vizinho com debug ligado consome o disco do nó e deixa o seu log lento, sem que nada tenha mudado no seu serviço. O segundo é que a rotação de arquivo e a compressão do log antigo acontecem no mesmo disco, em rajadas, e criam picos de latência que aparecem como travadas periódicas a cada poucos minutos. Quando o p99 de um serviço tem um serrilhado regular sem relação com o tráfego, a rotação de log é uma das primeiras suspeitas.',
        },
        {
          type: 'paragraph',
          value:
            'O comportamento do processo diante do pipe cheio depende do tipo de destino do fd 1 e da plataforma, e a própria documentação do Node.js dedica uma seção a isso, porque process.stdout não se comporta como os outros streams. Em vez de depender dessa tabela, trate os dois casos como possíveis e meça: ou o write bloqueia a thread, ou o stream acumula no writableLength. A próxima seção mostra como ver qual dos dois está acontecendo.',
        },
      ],
    },
    {
      title: 'Medir o custo do log antes de trocar a biblioteca',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Trocar de logger sem medir é o caminho mais comum e o menos eficaz, porque a biblioteca raramente é a causa. Três números respondem se o log está custando caro: o atraso do event loop, os bytes por segundo que o processo produz e quanto está parado no buffer do stdout. Se o atraso sobe junto com o volume de log e o buffer fica perto de zero, a escrita está bloqueando. Se o buffer cresce sem parar, a escrita é assíncrona e o destino não acompanha. Se nenhum dos dois se mexe, o problema está em outro lugar.',
        },
        {
          type: 'code',
          value: metricasCode,
        },
        {
          type: 'paragraph',
          value:
            'Em produção, esses valores vão para o sistema de métricas que o serviço já usa, e não para o próprio log. A métrica sai pelo stderr no exemplo para não depender do canal que está sendo medido. Fora do processo, o diagnóstico se completa em poucos comandos: descobrir para onde o fd 1 aponta, medir a duração real de cada write com strace e descobrir quais mensagens ocupam o volume.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'A conta de volume quase sempre surpreende. No incidente da introdução, cada instância atendia 250 requisições por segundo com nove linhas por requisição e média de 1,8 KB por linha, por causa do payload do carrinho. São 4 MB/s por processo, 48 MB/s para as 12 instâncias, mais de 170 GB por hora só de um serviço. Nenhuma biblioteca de log torna esse volume barato; a primeira correção é não produzi-lo.',
        },
      ],
    },
    {
      title: 'Cortar volume na origem: nível, amostragem e o que não deve virar log',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A linha mais barata é a que não é serializada. Antes de mexer no transporte, vale revisar o que o serviço registra por requisição e por quê. A maior parte do volume costuma vir de poucas mensagens: o log de entrada e saída de cada requisição, o payload completo de uma integração e o debug esquecido ligado. O comando de contagem da seção anterior mostra quais são em minutos.',
        },
        {
          type: 'list',
          items: [
            'Nível controlado em tempo de execução, não por deploy: o debug ligado para investigar precisa ter dono e prazo, por exemplo uma flag que volta para info sozinha depois de 30 minutos.',
            'Verificar o nível antes de montar o objeto: log.debug(msg, montarDetalhes()) executa montarDetalhes mesmo com debug desligado; o guard nivelAtivo(\'debug\') evita o custo inteiro.',
            'Registrar identificadores, não objetos: pedidoId, clienteId e quantidade de itens explicam o evento; o carrinho inteiro pertence ao banco ou ao trace, onde já existe.',
            'Amostrar o que é repetitivo e preservar o que é raro: 1 em cada 100 requisições bem-sucedidas, todas as que falharam ou passaram de um limite de latência.',
            'Uma linha por requisição no fim, com duração, status e os campos relevantes, em vez de uma linha a cada etapa do handler.',
            'Nunca registrar corpo de requisição, token, cabeçalho de autorização ou dado pessoal; além do volume, é o tipo de linha que vira incidente de privacidade.',
          ],
        },
        {
          type: 'table',
          columns: ['Mudança', 'Linhas por requisição', 'Bytes médios por linha', 'Volume por instância'],
          rows: [
            ['Situação do incidente (debug ligado, payload completo)', '9', '1.800', '4,0 MB/s'],
            ['Debug desligado', '4', '1.100', '1,1 MB/s'],
            ['Identificadores no lugar do payload', '4', '320', '320 KB/s'],
            ['Uma linha de resumo por requisição', '1', '450', '112 KB/s'],
            ['Amostragem de 1% nos sucessos, 100% nos erros', '0,05 em média', '450', '6 KB/s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A amostragem precisa ser determinística por requisição, não por linha: decidir uma vez, a partir do trace id, se aquela requisição será registrada, para que as linhas que sobrevivem contem uma história completa. Amostrar linha a linha produz fragmentos sem começo nem fim, que não servem para investigar nada.',
        },
      ],
    },
    {
      title: 'Tirar a escrita do caminho da requisição com fila limitada e descarte explícito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mesmo com volume baixo, o destino vai ficar lento em algum momento: rotação, disco do nó disputado, agente reiniciando. A defesa é garantir que a requisição nunca espere por ele e que a memória usada para absorver a lentidão tenha teto. O logger abaixo faz três coisas: coloca a linha em uma fila em memória e devolve na hora, escreve em lotes respeitando o retorno de write e o evento drain, e descarta linhas quando a fila passa do teto, com limites diferentes por nível e um resumo periódico do que foi perdido.',
        },
        {
          type: 'code',
          value: loggerCode,
        },
        {
          type: 'paragraph',
          value:
            'A política de descarte é a parte que mais exige decisão. Debug e info são descartados primeiro, porque são os mais volumosos e os menos necessários durante um incidente. Warn e error têm um limite duro maior, porque são justamente o que se quer ler depois. O que não pode acontecer é descarte silencioso: a linha "logs descartados", com a contagem por nível a cada 10 segundos, transforma a perda em fato observável e permite criar um alerta sobre ela. Uma lacuna nos logs sem essa linha parece ausência de evento; com ela, é uma lacuna explicada.',
        },
        {
          type: 'paragraph',
          value:
            'Esse logger resolve o caso assíncrono, mas não muda a natureza do destino. Se o fd 1 for um arquivo, cada write continua síncrono na thread principal, só que agora em lotes de 64 KB a cada volta do event loop em vez de uma syscall por linha, o que já reduz muito o custo. Quando o destino é inevitavelmente síncrono e lento, o passo seguinte é tirar a escrita da thread principal: o pino.transport, por exemplo, executa o destino em um worker thread e comunica as linhas por um buffer compartilhado. A mesma pergunta continua valendo nesse desenho: o que acontece quando o buffer entre as threads enche, e se essa perda fica visível.',
        },
        {
          type: 'table',
          columns: ['Desenho', 'Custo na thread principal', 'Teto de memória', 'Perda em destino lento', 'Quando usar'],
          rows: [
            ['console.log ou destino síncrono', 'Serialização + syscall por linha', 'Nenhum consumo extra', 'Nenhuma; quem perde é a latência', 'Scripts, CLIs e jobs curtos'],
            ['Stream assíncrono sem verificar write', 'Só serialização', 'Sem teto', 'Tudo, quando o processo morre por OOM', 'Nunca de propósito'],
            ['Fila limitada com descarte por nível', 'Serialização + syscall por lote', 'Configurado em bytes', 'Debug e info primeiro, contados', 'Serviços HTTP e consumidores de fila'],
            ['Worker thread (pino.transport)', 'Serialização + cópia para o buffer', 'Tamanho do buffer compartilhado', 'Depende da configuração do transporte', 'Destino síncrono ou caro, como arquivo ou rede'],
            ['Envio direto pela rede ao backend', 'Serialização + cliente HTTP', 'Buffer do cliente', 'Alta em falha de rede', 'Raramente; prefira stdout e agente'],
          ],
        },
      ],
    },
    {
      title: 'Desligar sem perder as últimas linhas e provar em teste',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma fila em memória cria uma obrigação nova: as linhas que estão nela quando o processo recebe SIGTERM precisam ser escritas antes da saída, e são justamente as que explicam por que o processo está saindo. Chamar process.exit logo depois de registrar o erro fatal descarta o que ainda não foi escrito. O método encerrar escreve o que restou, espera o stream confirmar com o callback de write e tem um prazo, para que um destino travado não impeça o desligamento. No handler de SIGTERM, ele entra depois de fechar o servidor HTTP e antes de process.exit.',
        },
        {
          type: 'paragraph',
          value:
            'O teste é o que impede a regressão silenciosa, porque nenhum ambiente de desenvolvimento tem destino lento. O destino falso abaixo aceita 64 KB e leva 20 ms por escrita, simulando um coletor que não acompanha. O teste produz 100 mil linhas de info e 50 de error contra ele e verifica as quatro propriedades que importam: a fila nunca passa do teto, o event loop não trava, nenhum error é perdido abaixo do limite duro e parte dos info é de fato descartada.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'Com isso, o comportamento sob destino lento deixa de ser um acidente e vira uma especificação. Em produção, o complemento é um alerta sobre a linha de descarte e um painel com os três números da seção de medição. No incidente da introdução, o mesmo pico de disco teria aparecido como alguns milhares de linhas info descartadas e contadas, com p99 de 45 ms e memória estável, em vez de uma hora de checkout lento seguida de pods reiniciando.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Trocar console.log por pino ou outro logger rápido resolve sozinho?',
      answer:
        'Resolve o custo de serialização, que é real, mas não resolve o destino lento. Um logger rápido produz linhas mais depressa e, com um disco saturado, chega mais rápido ao mesmo gargalo. O que resolve é a combinação de volume menor na origem, escrita fora do caminho da requisição e um limite explícito de memória com descarte contado. A biblioteca entra como implementação dessa política; sem a política, só muda a velocidade com que o problema aparece.',
    },
    {
      question: 'Descartar log não é perigoso durante um incidente?',
      answer:
        'É menos perigoso do que as alternativas. Sem descarte, o destino lento deixa o serviço lento ou derruba o processo por falta de memória, e aí se perdem os logs e as requisições. Com descarte por nível, o que sai primeiro é debug e info, e warn e error têm um teto maior. E o descarte é registrado: a linha com a contagem por nível diz exatamente quanto se perdeu e quando, o que permite separar "não aconteceu" de "aconteceu e não foi registrado".',
    },
    {
      question: 'Por que não mandar o log direto para o backend pela rede, sem stdout?',
      answer:
        'Porque isso coloca uma dependência de rede no caminho de cada requisição e move para dentro do processo responsabilidades que o agente de coleta já cumpre: buffer em disco, retentativa, backpressure e continuidade quando o backend cai. Escrever em stdout e deixar o agente enviar desacopla o ciclo de vida do serviço do ciclo de vida do backend de log. Envio direto só compensa em ambientes sem agente, como algumas plataformas serverless, e mesmo assim com fila limitada e descarte, pelos mesmos motivos deste artigo.',
    },
  ],
  conclusion: {
    title: 'O log é uma dependência do serviço; trate o destino lento como trata qualquer dependência lenta',
    description:
      'Toda requisição passa pelo log várias vezes, sem timeout e sem limite, e por isso um disco lento ou um pipe cheio afetam o serviço inteiro. A escrita síncrona transforma essa lentidão em event loop parado, e a assíncrona sem limite transforma em memória crescendo até o OOM. O caminho é medir antes de trocar de biblioteca, com atraso do event loop, bytes por segundo e buffer do stdout; cortar volume na origem com nível controlado, identificadores no lugar de objetos e amostragem por requisição; tirar a escrita do caminho da requisição com uma fila limitada em bytes, escrita em lotes que respeita o backpressure e descarte por nível sempre contado; escrever o que restou no desligamento com prazo; e provar em teste, com um destino falso lento, que a latência e a memória continuam estáveis quando o log não acompanha.',
    cta: 'Revisar a observabilidade e o log dos meus serviços',
  },
  related: [
    {
      label: 'Limite de memória em contêiner: o processo Node.js que morre por OOM sem nunca ter vazado memória',
      to: '/blog/limite-de-memoria-em-conteiner-o-processo-node-js-que-morre-por-oom-sem-nunca-ter-vazado-memoria',
    },
    {
      label: 'Graceful shutdown que ninguém testou: deploy que corta requisição no meio e derruba job em andamento',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Serviço de observabilidade e confiabilidade',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const en = {
  intro:
    'In the first hour of Black Friday, an e-commerce orders API goes from 45 ms to 2.8 seconds at p99. CPU on the 12 instances sits at 35%, the database answers in 4 ms, the connection pool has headroom and no error shows up on the dashboard. The main thread profile tells a different story: 61% of the time inside writeSync. Two weeks earlier, someone turned on debug level to chase a shipping bug and forgot to turn it off; every request started producing nine lines, one of them with the entire cart payload, and the logger wrote synchronously to a file on a volume that shares IOPS with 30 other pods on the node. With traffic six times higher, every write started waiting on the disk, and every wait stopped the whole event loop. The team switched to asynchronous writes the same day, latency came back and, 40 minutes later, pods started restarting with OOMKilled: the disk was still slow, and now the lines piled up on the heap. This article shows the path a log line takes to reach the disk and where the wait flows back into the process, how to measure what logging costs before switching libraries, how to cut volume at the source, how to take writes off the request path with a bounded queue and explicit dropping, and how to prove in a test that a slow destination does not take the service down.',
  sections: [
    {
      title: 'The service that got slow with no CPU, no database and no errors',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Logging is usually treated as a free side effect: a call that never fails, has no meaningful latency and is not part of any request budget. That only holds while the log destination is faster than the rate at which the process produces lines. Once it is not, logging becomes the most tightly coupled dependency of the service, because every request goes through it, several times, with no timeout, no circuit breaker and without anyone drawing it on the architecture diagram.',
        },
        {
          type: 'paragraph',
          value:
            'In Node.js, the problem has a specific shape. A synchronous file write, which is what a synchronous destination does under the hood, runs the write syscall on the main thread and only returns once the kernel has accepted the bytes. With a healthy page cache, that costs microseconds. With a saturated disk, a network volume being throttled on IOPS or the kernel forcing writeback because there are too many dirty pages, the same call takes tens of milliseconds. During that interval no other request makes progress, no timer fires and no health check answers. The symptom is high latency with low CPU, which is exactly the pattern that sends the team to look at the database first.',
        },
        {
          type: 'paragraph',
          value:
            'Unbounded asynchronous writes do not fix it, they only move the queue somewhere else. The process hands the line to the stream, the stream returns false because its internal buffer went past highWaterMark, nobody checks the return value, and the stream keeps accepting and holding everything in memory. Latency looks great while the heap grows in a straight line up to the cgroup limit. It is the same bottleneck, now with a different symptom and a 40 minute delay before it shows up.',
        },
        {
          type: 'table',
          columns: ['Write strategy', 'A slow destination causes', 'Visible symptom', 'When it shows up'],
          rows: [
            ['Direct synchronous', 'Main thread stuck in the syscall', 'High p99 with low CPU, failing health checks', 'Immediately, proportional to traffic'],
            ['Unbounded asynchronous', 'Stream buffer growing on the heap', 'Memory ramp, OOMKilled, the whole buffer lost', 'Minutes or hours after the peak'],
            ['Asynchronous with bounded queue and dropping', 'Low priority lines dropped and counted', 'Drop counter going up, stable latency and memory', 'Only on the indicator you built for it'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third row is the goal of this article. No configuration makes a slow disk fast; what you can choose is who pays when it gets slow. For almost every request-serving service, the right answer is that the log pays, by losing lines in a visible and controlled way, and not the customer.',
        },
      ],
    },
    {
      title: 'The path a log line takes to reach the disk',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In a Kubernetes pod, the process writes to file descriptor 1, which is usually a pipe. On the other end sits the container runtime, which reads the pipe, adds a timestamp and the stream name and writes to a file under /var/log/pods on the node disk. An agent such as Fluent Bit or Vector reads those files and ships them to the backend. Each stage has its own capacity, and the smallest one sets the maximum sustainable log rate for all pods on that node combined, not for a single process.',
        },
        {
          type: 'diagram',
          value: diagramaEn,
        },
        {
          type: 'table',
          columns: ['Stage', 'Typical capacity', 'What happens when it fills up'],
          rows: [
            ['Serialization (JSON.stringify)', 'Bound by main thread CPU; large objects cost milliseconds', 'CPU time taken from requests, even with a fast destination'],
            ['Kernel pipe', '64 KiB by default on Linux', 'write blocks or returns EAGAIN, depending on the fd mode'],
            ['Container runtime', 'Reads the pipe and writes a file; in Docker, the driver default mode is blocking', 'Stops reading the pipe while the disk does not accept writes; the pipe fills up'],
            ['Node disk', 'IOPS and throughput shared by every pod', 'Write latency goes up for everyone at the same time'],
            ['Collection agent', 'Reads files with its own buffer and memory limit', 'Delays shipping or pauses reading; files grow until rotation'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Two details of this path explain most incidents. The first is that capacity is shared: a neighboring pod with debug enabled eats the node disk and makes your logging slow, without anything having changed in your service. The second is that file rotation and compression of old logs happen on the same disk, in bursts, and create latency spikes that show up as periodic stalls every few minutes. When a service p99 has a regular sawtooth unrelated to traffic, log rotation is one of the first suspects.',
        },
        {
          type: 'paragraph',
          value:
            'How the process behaves when the pipe is full depends on what fd 1 points to and on the platform, and the Node.js documentation itself has a section about it, because process.stdout does not behave like other streams. Instead of relying on that table, treat both cases as possible and measure: either write blocks the thread, or the stream piles up in writableLength. The next section shows how to see which of the two is happening.',
        },
      ],
    },
    {
      title: 'Measuring what logging costs before switching libraries',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Switching loggers without measuring is the most common path and the least effective one, because the library is rarely the cause. Three numbers tell you whether logging is expensive: event loop delay, the bytes per second the process produces and how much is sitting in the stdout buffer. If the delay rises with log volume and the buffer stays near zero, writes are blocking. If the buffer keeps growing, writes are asynchronous and the destination cannot keep up. If neither moves, the problem is elsewhere.',
        },
        {
          type: 'code',
          value: metricasCode,
        },
        {
          type: 'paragraph',
          value:
            'In production, these values go to the metrics system the service already uses, not to the log itself. In the example the metric goes out through stderr so it does not depend on the channel being measured. Outside the process, the diagnosis takes a few commands: find out where fd 1 points, measure the real duration of each write with strace and find out which messages take up the volume.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'The volume math almost always surprises. In the incident from the introduction, each instance served 250 requests per second with nine lines per request and an average of 1.8 KB per line, because of the cart payload. That is 4 MB/s per process, 48 MB/s for the 12 instances, more than 170 GB per hour from a single service. No logging library makes that volume cheap; the first fix is not producing it.',
        },
      ],
    },
    {
      title: 'Cutting volume at the source: levels, sampling and what should not become a log',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The cheapest line is the one that is never serialized. Before touching the transport, it is worth reviewing what the service logs per request and why. Most of the volume usually comes from a handful of messages: the entry and exit log of every request, the full payload of an integration and the debug level someone forgot to turn off. The counting command from the previous section shows which ones in minutes.',
        },
        {
          type: 'list',
          items: [
            'Level controlled at runtime, not through a deploy: debug turned on for an investigation needs an owner and a deadline, for example a flag that goes back to info on its own after 30 minutes.',
            'Check the level before building the object: log.debug(msg, buildDetails()) runs buildDetails even with debug off; the nivelAtivo(\'debug\') guard avoids the whole cost.',
            'Log identifiers, not objects: order id, customer id and item count explain the event; the whole cart belongs in the database or in the trace, where it already exists.',
            'Sample what is repetitive and keep what is rare: 1 in every 100 successful requests, all of the ones that failed or crossed a latency threshold.',
            'One line per request at the end, with duration, status and the relevant fields, instead of one line at every step of the handler.',
            'Never log request bodies, tokens, authorization headers or personal data; besides the volume, that is the kind of line that turns into a privacy incident.',
          ],
        },
        {
          type: 'table',
          columns: ['Change', 'Lines per request', 'Average bytes per line', 'Volume per instance'],
          rows: [
            ['Incident state (debug on, full payload)', '9', '1,800', '4.0 MB/s'],
            ['Debug off', '4', '1,100', '1.1 MB/s'],
            ['Identifiers instead of the payload', '4', '320', '320 KB/s'],
            ['One summary line per request', '1', '450', '112 KB/s'],
            ['1% sampling on successes, 100% on errors', '0.05 on average', '450', '6 KB/s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Sampling must be deterministic per request, not per line: decide once, from the trace id, whether that request will be logged, so the lines that survive tell a complete story. Sampling line by line produces fragments with no beginning and no end, which are useless for investigating anything.',
        },
      ],
    },
    {
      title: 'Taking writes off the request path with a bounded queue and explicit dropping',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Even with low volume, the destination will get slow at some point: rotation, a contended node disk, the agent restarting. The defense is making sure the request never waits for it and that the memory used to absorb the slowness has a ceiling. The logger below does three things: it puts the line in an in-memory queue and returns right away, it writes in batches while respecting the return value of write and the drain event, and it drops lines when the queue goes past the ceiling, with different limits per level and a periodic summary of what was lost.',
        },
        {
          type: 'code',
          value: loggerCode,
        },
        {
          type: 'paragraph',
          value:
            'The drop policy is the part that demands the most judgment. Debug and info are dropped first, because they are the most voluminous and the least needed during an incident. Warn and error get a higher hard limit, because they are exactly what you want to read later. What cannot happen is silent dropping: the "logs descartados" line, with a per-level count every 10 seconds, turns the loss into an observable fact and lets you alert on it. A gap in the logs without that line looks like an absence of events; with it, it is an explained gap.',
        },
        {
          type: 'paragraph',
          value:
            'This logger solves the asynchronous case, but it does not change the nature of the destination. If fd 1 is a file, each write is still synchronous on the main thread, only now in 64 KB batches once per event loop turn instead of one syscall per line, which already cuts the cost a lot. When the destination is unavoidably synchronous and slow, the next step is moving the write off the main thread: pino.transport, for example, runs the destination in a worker thread and passes lines through a shared buffer. The same question still applies in that design: what happens when the buffer between the threads fills up, and whether that loss is visible.',
        },
        {
          type: 'table',
          columns: ['Design', 'Cost on the main thread', 'Memory ceiling', 'Loss with a slow destination', 'When to use it'],
          rows: [
            ['console.log or synchronous destination', 'Serialization + one syscall per line', 'No extra memory', 'None; latency pays instead', 'Scripts, CLIs and short jobs'],
            ['Asynchronous stream without checking write', 'Serialization only', 'No ceiling', 'Everything, when the process dies from OOM', 'Never on purpose'],
            ['Bounded queue with per-level dropping', 'Serialization + one syscall per batch', 'Configured in bytes', 'Debug and info first, counted', 'HTTP services and queue consumers'],
            ['Worker thread (pino.transport)', 'Serialization + copy into the buffer', 'Size of the shared buffer', 'Depends on the transport configuration', 'Synchronous or expensive destinations, such as files or network'],
            ['Shipping straight to the backend over the network', 'Serialization + HTTP client', 'Client buffer', 'High on network failure', 'Rarely; prefer stdout plus an agent'],
          ],
        },
      ],
    },
    {
      title: 'Shutting down without losing the last lines, and proving it in a test',
      blocks: [
        {
          type: 'paragraph',
          value:
            'An in-memory queue creates a new obligation: the lines sitting in it when the process receives SIGTERM must be written before exiting, and they are precisely the ones that explain why the process is exiting. Calling process.exit right after logging the fatal error throws away whatever has not been written yet. The encerrar method writes what is left, waits for the stream to confirm through the write callback and has a deadline, so a stuck destination cannot block shutdown. In the SIGTERM handler, it goes after closing the HTTP server and before process.exit.',
        },
        {
          type: 'paragraph',
          value:
            'The test is what prevents a silent regression, because no development environment has a slow destination. The fake destination below accepts 64 KB and takes 20 ms per write, simulating a collector that cannot keep up. The test produces 100 thousand info lines and 50 error lines against it and checks the four properties that matter: the queue never goes past the ceiling, the event loop does not stall, no error is lost below the hard limit and part of the info lines is in fact dropped.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'With that, behavior under a slow destination stops being an accident and becomes a specification. In production, the complement is an alert on the drop line and a dashboard with the three numbers from the measuring section. In the incident from the introduction, the same disk spike would have shown up as a few thousand info lines dropped and counted, with a 45 ms p99 and stable memory, instead of an hour of slow checkout followed by restarting pods.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Does replacing console.log with pino or another fast logger fix it on its own?',
      answer:
        'It fixes the serialization cost, which is real, but not the slow destination. A fast logger produces lines faster and, with a saturated disk, reaches the same bottleneck sooner. What fixes it is the combination of less volume at the source, writes off the request path and an explicit memory limit with counted dropping. The library is an implementation of that policy; without the policy, it only changes how fast the problem shows up.',
    },
    {
      question: 'Isn\'t dropping logs dangerous during an incident?',
      answer:
        'It is less dangerous than the alternatives. Without dropping, the slow destination makes the service slow or kills the process for lack of memory, and then you lose both the logs and the requests. With per-level dropping, debug and info go first, while warn and error get a higher ceiling. And the drop itself is recorded: the line with the per-level count says exactly how much was lost and when, which lets you tell "it did not happen" apart from "it happened and was not logged".',
    },
    {
      question: 'Why not ship logs straight to the backend over the network, without stdout?',
      answer:
        'Because that puts a network dependency on the path of every request and moves into the process responsibilities the collection agent already handles: disk buffering, retries, backpressure and continuity when the backend goes down. Writing to stdout and letting the agent ship decouples the service lifecycle from the log backend lifecycle. Shipping directly only pays off in environments without an agent, such as some serverless platforms, and even then with a bounded queue and dropping, for the same reasons as in this article.',
    },
  ],
  conclusion: {
    title: 'Logging is a dependency of the service; treat a slow destination like any other slow dependency',
    description:
      'Every request goes through the log several times, with no timeout and no limit, which is why a slow disk or a full pipe affects the whole service. Synchronous writes turn that slowness into a stopped event loop, and unbounded asynchronous writes turn it into memory growing until OOM. The way out is to measure before switching libraries, with event loop delay, bytes per second and the stdout buffer; cut volume at the source with runtime-controlled levels, identifiers instead of objects and per-request sampling; take writes off the request path with a queue bounded in bytes, batched writes that respect backpressure and per-level dropping that is always counted; write what is left on shutdown with a deadline; and prove in a test, with a slow fake destination, that latency and memory stay stable when the log cannot keep up.',
    cta: 'Review observability and logging in my services',
  },
  related: [
    {
      label: 'Container memory limits: the Node.js process killed by OOM without ever leaking memory',
      to: '/blog/limite-de-memoria-em-conteiner-o-processo-node-js-que-morre-por-oom-sem-nunca-ter-vazado-memoria',
    },
    {
      label: 'The graceful shutdown nobody tested: deploys that cut requests mid-flight and kill running jobs',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
    },
    {
      label: 'Observability and reliability service',
      to: '/servicos/observabilidade-e-confiabilidade',
    },
  ],
};

const es = {
  intro:
    'En la primera hora del Black Friday, la API de pedidos de un e-commerce pasa de 45 ms a 2,8 segundos de p99. La CPU de las 12 instancias está al 35%, la base de datos responde en 4 ms, el pool de conexiones tiene margen y no aparece ningún error en el panel. El profile del hilo principal cuenta otra historia: el 61% del tiempo dentro de writeSync. Dos semanas antes, alguien activó el nivel debug para investigar un bug de envíos y se olvidó de desactivarlo; cada petición pasó a generar nueve líneas, una de ellas con el payload completo del carrito, y el logger escribía de forma síncrona en un archivo dentro de un volumen que comparte IOPS con otros 30 pods del nodo. Con el tráfico multiplicado por seis, cada escritura empezó a esperar al disco, y cada espera detenía el event loop entero. El equipo cambió a escritura asíncrona ese mismo día, la latencia volvió y, 40 minutos después, los pods empezaron a reiniciarse con OOMKilled: el disco seguía lento, y ahora las líneas se acumulaban en el heap. Este artículo muestra por dónde pasa una línea de log hasta llegar al disco y dónde la espera vuelve al proceso, cómo medir lo que cuesta el log antes de cambiar de librería, cómo recortar volumen en el origen, cómo sacar la escritura del camino de la petición con una cola limitada y descarte explícito, y cómo demostrar en una prueba que un destino lento no tumba el servicio.',
  sections: [
    {
      title: 'El servicio que se volvió lento sin CPU, sin base de datos y sin errores',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El log suele tratarse como un efecto secundario gratuito: una llamada que no falla, no tiene latencia relevante y no forma parte del presupuesto de ninguna petición. Eso solo es cierto mientras el destino del log sea más rápido que la tasa a la que el proceso produce líneas. Cuando deja de serlo, el log se convierte en la dependencia más acoplada del servicio, porque todas las peticiones pasan por él, varias veces, sin timeout, sin circuit breaker y sin que nadie lo dibuje en el diagrama de arquitectura.',
        },
        {
          type: 'paragraph',
          value:
            'En Node.js, el problema tiene una forma concreta. La escritura síncrona en archivo, que es lo que hace por debajo un destino síncrono, ejecuta la syscall write en el hilo principal y solo regresa cuando el kernel aceptó los bytes. Con el page cache sano, eso cuesta microsegundos. Con el disco saturado, con el volumen de red limitado por IOPS o con el kernel forzando writeback porque hay demasiadas páginas sucias, la misma llamada tarda decenas de milisegundos. Durante ese intervalo ninguna otra petición avanza, ningún timer se dispara y ningún health check responde. El síntoma es latencia alta con CPU baja, que es justo el patrón que lleva al equipo a revisar primero la base de datos.',
        },
        {
          type: 'paragraph',
          value:
            'La escritura asíncrona sin límite no lo resuelve, solo cambia la cola de sitio. El proceso entrega la línea al stream, el stream devuelve false porque su buffer interno superó el highWaterMark, nadie revisa el valor de retorno, y el stream sigue aceptando y guardando todo en memoria. La latencia se ve excelente mientras el heap crece en línea recta hasta el límite del cgroup. Es el mismo cuello de botella, ahora con otro síntoma y 40 minutos de retraso en aparecer.',
        },
        {
          type: 'table',
          columns: ['Estrategia de escritura', 'Un destino lento provoca', 'Síntoma visible', 'Cuándo aparece'],
          rows: [
            ['Síncrona directa', 'Hilo principal detenido en la syscall', 'p99 alto con CPU baja, health checks fallando', 'De inmediato, en proporción al tráfico'],
            ['Asíncrona sin límite', 'Buffer del stream creciendo en el heap', 'Memoria en rampa, OOMKilled, pérdida del buffer completo', 'Minutos u horas después del pico'],
            ['Asíncrona con cola limitada y descarte', 'Líneas de baja prioridad descartadas y contadas', 'Contador de descarte subiendo, latencia y memoria estables', 'Solo en el indicador que creaste para eso'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La tercera fila es el objetivo de este artículo. Ninguna configuración vuelve rápido un disco lento; lo que se puede elegir es quién paga cuando se vuelve lento. Para casi cualquier servicio que atiende peticiones, la respuesta correcta es que pague el log, perdiendo líneas de forma visible y controlada, y no el cliente.',
        },
      ],
    },
    {
      title: 'Por dónde pasa una línea de log hasta llegar al disco',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En un pod de Kubernetes, el proceso escribe en el file descriptor 1, que normalmente es un pipe. Del otro lado está el runtime del contenedor, que lee el pipe, añade timestamp y nombre del stream y escribe en un archivo en /var/log/pods en el disco del nodo. Un agente como Fluent Bit o Vector lee esos archivos y los envía al backend. Cada etapa tiene su propia capacidad, y la menor de todas define la tasa máxima sostenible de log de todos los pods de ese nodo juntos, no de un proceso aislado.',
        },
        {
          type: 'diagram',
          value: diagramaEs,
        },
        {
          type: 'table',
          columns: ['Tramo', 'Capacidad típica', 'Qué ocurre cuando se llena'],
          rows: [
            ['Serialización (JSON.stringify)', 'Limitada por la CPU del hilo principal; los objetos grandes cuestan milisegundos', 'Tiempo de CPU quitado a las peticiones, incluso con un destino rápido'],
            ['Pipe del kernel', '64 KiB por defecto en Linux', 'write se bloquea o devuelve EAGAIN, según el modo del fd'],
            ['Runtime del contenedor', 'Lee el pipe y escribe un archivo; en Docker, el modo por defecto del driver es blocking', 'Deja de leer el pipe mientras el disco no acepta escrituras; el pipe se llena'],
            ['Disco del nodo', 'IOPS y throughput compartidos entre todos los pods', 'La latencia de escritura sube para todos a la vez'],
            ['Agente de recolección', 'Lee archivos con buffer propio y límite de memoria', 'Retrasa el envío o pausa la lectura; los archivos crecen hasta la rotación'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Dos detalles de este camino explican la mayoría de los incidentes. El primero es que la capacidad es compartida: un pod vecino con debug activado consume el disco del nodo y vuelve lento tu log, sin que nada haya cambiado en tu servicio. El segundo es que la rotación de archivos y la compresión de los logs antiguos ocurren en el mismo disco, en ráfagas, y generan picos de latencia que aparecen como bloqueos periódicos cada pocos minutos. Cuando el p99 de un servicio muestra un diente de sierra regular sin relación con el tráfico, la rotación de logs es una de las primeras sospechosas.',
        },
        {
          type: 'paragraph',
          value:
            'Cómo se comporta el proceso ante el pipe lleno depende de a qué apunta el fd 1 y de la plataforma, y la propia documentación de Node.js dedica una sección a eso, porque process.stdout no se comporta como los demás streams. En lugar de depender de esa tabla, trata los dos casos como posibles y mide: o write bloquea el hilo, o el stream acumula en writableLength. La siguiente sección muestra cómo ver cuál de los dos está ocurriendo.',
        },
      ],
    },
    {
      title: 'Medir lo que cuesta el log antes de cambiar de librería',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cambiar de logger sin medir es el camino más común y el menos eficaz, porque la librería rara vez es la causa. Tres números dicen si el log está saliendo caro: el retraso del event loop, los bytes por segundo que produce el proceso y cuánto queda detenido en el buffer de stdout. Si el retraso sube junto con el volumen de log y el buffer se mantiene cerca de cero, la escritura está bloqueando. Si el buffer crece sin parar, la escritura es asíncrona y el destino no da abasto. Si ninguno de los dos se mueve, el problema está en otro lugar.',
        },
        {
          type: 'code',
          value: metricasCode,
        },
        {
          type: 'paragraph',
          value:
            'En producción, estos valores van al sistema de métricas que el servicio ya usa, y no al propio log. En el ejemplo, la métrica sale por stderr para no depender del canal que se está midiendo. Fuera del proceso, el diagnóstico se completa con pocos comandos: averiguar a dónde apunta el fd 1, medir la duración real de cada write con strace y descubrir qué mensajes ocupan el volumen.',
        },
        {
          type: 'code',
          value: diagnosticoCode,
        },
        {
          type: 'paragraph',
          value:
            'La cuenta del volumen casi siempre sorprende. En el incidente de la introducción, cada instancia atendía 250 peticiones por segundo con nueve líneas por petición y una media de 1,8 KB por línea, por culpa del payload del carrito. Son 4 MB/s por proceso, 48 MB/s para las 12 instancias, más de 170 GB por hora de un solo servicio. Ninguna librería de log abarata ese volumen; la primera corrección es no producirlo.',
        },
      ],
    },
    {
      title: 'Recortar volumen en el origen: niveles, muestreo y lo que no debe convertirse en log',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La línea más barata es la que nunca se serializa. Antes de tocar el transporte, conviene revisar qué registra el servicio por petición y por qué. La mayor parte del volumen suele venir de unos pocos mensajes: el log de entrada y salida de cada petición, el payload completo de una integración y el debug que alguien olvidó desactivar. El comando de conteo de la sección anterior los identifica en minutos.',
        },
        {
          type: 'list',
          items: [
            'Nivel controlado en tiempo de ejecución, no mediante un despliegue: el debug activado para una investigación necesita un responsable y un plazo, por ejemplo una flag que vuelve sola a info después de 30 minutos.',
            'Comprobar el nivel antes de construir el objeto: log.debug(msg, construirDetalles()) ejecuta construirDetalles incluso con debug desactivado; la guarda nivelAtivo(\'debug\') evita todo el coste.',
            'Registrar identificadores, no objetos: el id del pedido, el id del cliente y la cantidad de artículos explican el evento; el carrito completo pertenece a la base de datos o al trace, donde ya existe.',
            'Muestrear lo repetitivo y conservar lo raro: 1 de cada 100 peticiones exitosas, todas las que fallaron o superaron un umbral de latencia.',
            'Una línea por petición al final, con duración, estado y los campos relevantes, en lugar de una línea en cada paso del handler.',
            'Nunca registrar cuerpos de petición, tokens, cabeceras de autorización ni datos personales; además del volumen, es el tipo de línea que termina en un incidente de privacidad.',
          ],
        },
        {
          type: 'table',
          columns: ['Cambio', 'Líneas por petición', 'Bytes medios por línea', 'Volumen por instancia'],
          rows: [
            ['Situación del incidente (debug activado, payload completo)', '9', '1.800', '4,0 MB/s'],
            ['Debug desactivado', '4', '1.100', '1,1 MB/s'],
            ['Identificadores en lugar del payload', '4', '320', '320 KB/s'],
            ['Una línea de resumen por petición', '1', '450', '112 KB/s'],
            ['Muestreo del 1% en éxitos, 100% en errores', '0,05 de media', '450', '6 KB/s'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El muestreo tiene que ser determinista por petición, no por línea: decidir una sola vez, a partir del trace id, si esa petición se registrará, para que las líneas que sobreviven cuenten una historia completa. Muestrear línea por línea produce fragmentos sin principio ni final, que no sirven para investigar nada.',
        },
      ],
    },
    {
      title: 'Sacar la escritura del camino de la petición con una cola limitada y descarte explícito',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Incluso con poco volumen, el destino se volverá lento en algún momento: rotación, disco del nodo disputado, el agente reiniciándose. La defensa es garantizar que la petición nunca lo espere y que la memoria usada para absorber la lentitud tenga techo. El logger de abajo hace tres cosas: pone la línea en una cola en memoria y regresa de inmediato, escribe en lotes respetando el valor de retorno de write y el evento drain, y descarta líneas cuando la cola supera el techo, con límites distintos por nivel y un resumen periódico de lo que se perdió.',
        },
        {
          type: 'code',
          value: loggerCode,
        },
        {
          type: 'paragraph',
          value:
            'La política de descarte es la parte que más criterio exige. Debug e info se descartan primero, porque son los más voluminosos y los menos necesarios durante un incidente. Warn y error tienen un límite duro mayor, porque son justo lo que se quiere leer después. Lo que no puede ocurrir es el descarte silencioso: la línea "logs descartados", con el conteo por nivel cada 10 segundos, convierte la pérdida en un hecho observable y permite crear una alerta sobre ella. Un hueco en los logs sin esa línea parece ausencia de eventos; con ella, es un hueco explicado.',
        },
        {
          type: 'paragraph',
          value:
            'Este logger resuelve el caso asíncrono, pero no cambia la naturaleza del destino. Si el fd 1 es un archivo, cada write sigue siendo síncrono en el hilo principal, solo que ahora en lotes de 64 KB por vuelta del event loop en lugar de una syscall por línea, lo que ya reduce mucho el coste. Cuando el destino es inevitablemente síncrono y lento, el siguiente paso es sacar la escritura del hilo principal: pino.transport, por ejemplo, ejecuta el destino en un worker thread y pasa las líneas por un buffer compartido. La misma pregunta sigue valiendo en ese diseño: qué ocurre cuando se llena el buffer entre los hilos, y si esa pérdida es visible.',
        },
        {
          type: 'table',
          columns: ['Diseño', 'Coste en el hilo principal', 'Techo de memoria', 'Pérdida con destino lento', 'Cuándo usarlo'],
          rows: [
            ['console.log o destino síncrono', 'Serialización + una syscall por línea', 'Sin memoria adicional', 'Ninguna; paga la latencia', 'Scripts, CLIs y jobs cortos'],
            ['Stream asíncrono sin revisar write', 'Solo serialización', 'Sin techo', 'Todo, cuando el proceso muere por OOM', 'Nunca a propósito'],
            ['Cola limitada con descarte por nivel', 'Serialización + una syscall por lote', 'Configurado en bytes', 'Debug e info primero, contados', 'Servicios HTTP y consumidores de colas'],
            ['Worker thread (pino.transport)', 'Serialización + copia al buffer', 'Tamaño del buffer compartido', 'Depende de la configuración del transporte', 'Destinos síncronos o caros, como archivo o red'],
            ['Envío directo por red al backend', 'Serialización + cliente HTTP', 'Buffer del cliente', 'Alta ante fallos de red', 'Rara vez; mejor stdout y un agente'],
          ],
        },
      ],
    },
    {
      title: 'Apagar sin perder las últimas líneas y demostrarlo en una prueba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una cola en memoria crea una obligación nueva: las líneas que están en ella cuando el proceso recibe SIGTERM tienen que escribirse antes de salir, y son justamente las que explican por qué el proceso está saliendo. Llamar a process.exit justo después de registrar el error fatal descarta lo que aún no se escribió. El método encerrar escribe lo que queda, espera a que el stream lo confirme con el callback de write y tiene un plazo, para que un destino bloqueado no impida el apagado. En el handler de SIGTERM, va después de cerrar el servidor HTTP y antes de process.exit.',
        },
        {
          type: 'paragraph',
          value:
            'La prueba es lo que impide la regresión silenciosa, porque ningún entorno de desarrollo tiene un destino lento. El destino falso de abajo acepta 64 KB y tarda 20 ms por escritura, simulando un recolector que no da abasto. La prueba produce 100 mil líneas info y 50 error contra él y verifica las cuatro propiedades que importan: la cola nunca supera el techo, el event loop no se bloquea, ningún error se pierde por debajo del límite duro y parte de las líneas info efectivamente se descarta.',
        },
        {
          type: 'code',
          value: testeCode,
        },
        {
          type: 'paragraph',
          value:
            'Con eso, el comportamiento ante un destino lento deja de ser un accidente y se convierte en una especificación. En producción, el complemento es una alerta sobre la línea de descarte y un panel con los tres números de la sección de medición. En el incidente de la introducción, el mismo pico de disco habría aparecido como unos miles de líneas info descartadas y contadas, con un p99 de 45 ms y memoria estable, en lugar de una hora de checkout lento seguida de pods reiniciándose.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Cambiar console.log por pino u otro logger rápido lo resuelve por sí solo?',
      answer:
        'Resuelve el coste de serialización, que es real, pero no el destino lento. Un logger rápido produce líneas más deprisa y, con un disco saturado, llega antes al mismo cuello de botella. Lo que lo resuelve es la combinación de menos volumen en el origen, escritura fuera del camino de la petición y un límite explícito de memoria con descarte contado. La librería es una implementación de esa política; sin la política, solo cambia la velocidad con la que aparece el problema.',
    },
    {
      question: '¿No es peligroso descartar logs durante un incidente?',
      answer:
        'Es menos peligroso que las alternativas. Sin descarte, el destino lento vuelve lento el servicio o mata el proceso por falta de memoria, y entonces se pierden los logs y las peticiones. Con descarte por nivel, lo primero que sale es debug e info, y warn y error tienen un techo mayor. Y el descarte queda registrado: la línea con el conteo por nivel dice exactamente cuánto se perdió y cuándo, lo que permite distinguir "no ocurrió" de "ocurrió y no se registró".',
    },
    {
      question: '¿Por qué no enviar el log directamente al backend por la red, sin stdout?',
      answer:
        'Porque eso pone una dependencia de red en el camino de cada petición y mete dentro del proceso responsabilidades que el agente de recolección ya cumple: buffer en disco, reintentos, backpressure y continuidad cuando el backend cae. Escribir en stdout y dejar que el agente envíe desacopla el ciclo de vida del servicio del ciclo de vida del backend de logs. El envío directo solo compensa en entornos sin agente, como algunas plataformas serverless, y aun así con cola limitada y descarte, por las mismas razones de este artículo.',
    },
  ],
  conclusion: {
    title: 'El log es una dependencia del servicio; trata un destino lento como tratas cualquier dependencia lenta',
    description:
      'Cada petición pasa por el log varias veces, sin timeout y sin límite, y por eso un disco lento o un pipe lleno afectan al servicio entero. La escritura síncrona convierte esa lentitud en un event loop detenido, y la asíncrona sin límite la convierte en memoria creciendo hasta el OOM. El camino es medir antes de cambiar de librería, con el retraso del event loop, los bytes por segundo y el buffer de stdout; recortar volumen en el origen con niveles controlados en tiempo de ejecución, identificadores en lugar de objetos y muestreo por petición; sacar la escritura del camino de la petición con una cola limitada en bytes, escritura por lotes que respeta el backpressure y descarte por nivel siempre contado; escribir lo que queda al apagar, con un plazo; y demostrar en una prueba, con un destino falso lento, que la latencia y la memoria se mantienen estables cuando el log no da abasto.',
    cta: 'Revisar la observabilidad y el log de mis servicios',
  },
  related: [
    {
      label: 'Límite de memoria en contenedor: el proceso Node.js que muere por OOM sin haber tenido nunca una fuga de memoria',
      to: '/blog/limite-de-memoria-em-conteiner-o-processo-node-js-que-morre-por-oom-sem-nunca-ter-vazado-memoria',
    },
    {
      label: 'El graceful shutdown que nadie probó: despliegues que cortan peticiones a medias y matan jobs en curso',
      to: '/blog/graceful-shutdown-que-ninguem-testou-deploy-que-corta-requisicao-no-meio-e-derruba-job-em-andamento',
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
