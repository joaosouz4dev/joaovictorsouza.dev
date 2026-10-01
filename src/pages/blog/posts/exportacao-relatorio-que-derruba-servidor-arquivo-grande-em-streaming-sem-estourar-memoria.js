// Conteudo do artigo: exportacao de relatorio que derruba o servidor, gerar
// arquivo grande em streaming do cursor do banco ao socket, backpressure,
// cliente que desiste, CSV seguro, XLSX incremental e exportacao assincrona.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const naiveCode = `// Versao que derruba o servidor: carrega tudo, monta tudo, envia tudo
app.get('/relatorios/pedidos.csv', async (req, res) => {
  const { rows } = await pool.query(SQL_PEDIDOS, [req.query.de, req.query.ate]);

  // Antes desta linha, rows ja tem 1,8 milhao de objetos no heap
  const linhas = rows.map((r) =>
    [r.id, r.criado_em.toISOString(), r.cliente, r.status, r.total].join(';'),
  );
  const csv = ['id;criado_em;cliente;status;total', ...linhas].join('\\n');

  // Agora existem tres copias dos mesmos dados: rows, linhas e csv.
  // res.send ainda cria uma quarta, o Buffer que vai para o socket.
  res.send(csv);
});`;

const streamCode = `import express from 'express';
import pg from 'pg';
import QueryStream from 'pg-query-stream';
import { pipeline } from 'node:stream/promises';

// Em producao, aponte para uma replica de leitura: a exportacao longa nao
// disputa CPU nem segura o vacuum do primario.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export const SQL_PEDIDOS =
  'SELECT p.id, p.criado_em, c.nome AS cliente, p.status, p.total ' +
  '  FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ' +
  ' WHERE p.criado_em >= $1 AND p.criado_em < $2 ' +
  ' ORDER BY p.criado_em, p.id';

export const COLUNAS = ['id', 'criado_em', 'cliente', 'status', 'total'];
const NUMERO = /^-?\\d+(\\.\\d+)?$/;
const DATA = /^\\d{4}-\\d{2}-\\d{2}$/;

// Uma celula de CSV para o Excel em pt-BR: separador ponto e virgula,
// aspas dobradas e protecao contra formula em texto digitado por usuario.
export function celula(valor) {
  if (valor === null || valor === undefined) return '';
  let texto = valor instanceof Date ? valor.toISOString() : String(valor);
  if (/^[=+\\-@\\t\\r]/.test(texto) && !NUMERO.test(texto)) texto = "'" + texto;
  if (/[";\\r\\n]/.test(texto)) texto = '"' + texto.replace(/"/g, '""') + '"';
  return texto;
}

// Transforma o fluxo de linhas do banco em fluxo de texto. Junta as linhas
// em blocos de cerca de 64 KB para nao entregar um pedaco minusculo por vez.
export async function* paraCsv(linhas) {
  let bloco = '\\uFEFF' + COLUNAS.join(';') + '\\r\\n';
  for await (const linha of linhas) {
    bloco += COLUNAS.map((c) => celula(linha[c])).join(';') + '\\r\\n';
    if (bloco.length >= 65536) {
      yield bloco;
      bloco = '';
    }
  }
  if (bloco) yield bloco;
}

const app = express();
const MAX_EXPORTACOES = 2;
const DIAS_MAX_DOWNLOAD_DIRETO = 31;
let ativas = 0;

app.get('/relatorios/pedidos.csv', async (req, res) => {
  const { de, ate } = req.query;
  if (!DATA.test(de || '') || !DATA.test(ate || '') || de >= ate) {
    return res.status(400).json({ erro: 'use de=AAAA-MM-DD e ate=AAAA-MM-DD, com de < ate' });
  }
  if ((Date.parse(ate) - Date.parse(de)) / 86400000 > DIAS_MAX_DOWNLOAD_DIRETO) {
    return res.status(422).json({ erro: 'periodo longo demais; use POST /exportacoes' });
  }
  // Cada exportacao segura uma conexao do pool e CPU de serializacao.
  // Acima do limite, o cliente tenta de novo em vez de derrubar a API.
  if (ativas >= MAX_EXPORTACOES) {
    res.set('Retry-After', '30');
    return res.status(429).json({ erro: 'muitas exportacoes em andamento' });
  }

  ativas += 1;
  let client;
  let descartar = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const linhas = client.query(new QueryStream(SQL_PEDIDOS, [de, ate], { batchSize: 1000 }));
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pedidos-' + de + '-a-' + ate + '.csv"',
      'Cache-Control': 'no-store',
    });
    // pipeline respeita backpressure: se o cliente baixa devagar, o socket
    // enche, o gerador para e o cursor deixa de pedir lotes ao banco.
    await pipeline(linhas, paraCsv, res);
    await client.query('COMMIT');
  } catch (err) {
    descartar = true;
    // Se o pipeline falhou, ele ja destruiu a resposta. Sem o bloco final do
    // chunked, o navegador marca o download como falho em vez de salvar um
    // CSV truncado que parece completo. Cliente que desistiu nao e erro.
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('exportacao falhou', err);
    if (!res.headersSent && !res.destroyed) res.status(500).json({ erro: 'falha na exportacao' });
  } finally {
    ativas -= 1;
    // Conexao com cursor interrompido volta em estado incerto: descarta.
    client?.release(descartar);
  }
});

app.listen(3000);`;

const xlsxCode = `import ExcelJS from 'exceljs';
import { COLUNAS } from './exportacao.js';

const LIMITE_EXCEL = 1048576 - 1; // linhas por aba, menos o cabecalho

// Escrita incremental: cada linha vira XML dentro do zip assim que recebe
// commit() e sai da memoria. useSharedStrings: false evita a tabela de
// textos repetidos, que cresce junto com o arquivo.
export async function escreverXlsx(linhas, destino) {
  const livro = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: destino,
    useStyles: false,
    useSharedStrings: false,
  });
  const aba = livro.addWorksheet('Pedidos');
  aba.columns = COLUNAS.map((c) => ({ header: c, key: c }));

  let total = 0;
  for await (const linha of linhas) {
    if (++total > LIMITE_EXCEL) {
      throw new RangeError('acima do limite de linhas do Excel; exporte em CSV');
    }
    // numeric chega do pg como string; converte para a celula ser numero
    aba.addRow({ ...linha, total: Number(linha.total) }).commit();
  }
  await aba.commit();
  await livro.commit();
}`;

const asyncCode = `import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import QueryStream from 'pg-query-stream';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { pool, SQL_PEDIDOS, paraCsv } from './exportacao.js';

const s3 = new S3Client({});
const BUCKET = process.env.EXPORTS_BUCKET;

// Roda no worker, fora do processo que atende a API. O job chega de uma
// fila com { id, de, ate } e devolve um link temporario para o arquivo.
export async function gerarExportacao(job) {
  const chave = 'exportacoes/' + job.id + '/pedidos.csv';
  const corpo = new PassThrough();
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: chave,
      Body: corpo,
      ContentType: 'text/csv; charset=utf-8',
      ContentEncoding: 'gzip',
      ContentDisposition: 'attachment; filename="pedidos-' + job.de + '-a-' + job.ate + '.csv"',
    },
    // Envio multipart: no maximo 2 partes de 8 MB em memoria ao mesmo tempo
    partSize: 8 * 1024 * 1024,
    queueSize: 2,
  });

  const client = await pool.connect();
  let descartar = false;
  try {
    await client.query('BEGIN READ ONLY');
    const linhas = client.query(new QueryStream(SQL_PEDIDOS, [job.de, job.ate], { batchSize: 1000 }));
    // Os dois lados precisam terminar: o pipeline que produz e o upload que
    // consome. Se um falha, o outro e interrompido e o erro sobe.
    await Promise.all([pipeline(linhas, paraCsv, createGzip(), corpo), upload.done()]);
    await client.query('COMMIT');
  } catch (err) {
    descartar = true;
    await upload.abort().catch(() => {});
    throw err;
  } finally {
    client.release(descartar);
  }

  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: chave }), {
    expiresIn: 3600,
  });
}`;

const testCode = `# 2 milhoes de pedidos sinteticos no banco de teste
psql "$DATABASE_URL" -c "
  INSERT INTO pedidos (cliente_id, criado_em, status, total)
  SELECT 1 + g % 50000, timestamptz '2026-07-01' + g * interval '3 seconds',
         'pago', (g % 900) + 0.99
    FROM generate_series(1, 2000000) g"

# Cliente lento de proposito, 2 MB/s, para exercitar o backpressure.
# Durante a execucao, o servidor registra process.memoryUsage().rss a cada segundo.
curl -s --limit-rate 2M -o /tmp/pedidos.csv -w '%{http_code} %{size_download}\\n' \\
  'http://localhost:3000/relatorios/pedidos.csv?de=2026-07-01&ate=2026-07-31'

# O arquivo precisa ter cabecalho + todas as linhas do periodo
wc -l /tmp/pedidos.csv
psql "$DATABASE_URL" -Atc "
  SELECT count(*) FROM pedidos
   WHERE criado_em >= '2026-07-01' AND criado_em < '2026-07-31'"`;

const flowDiagramPt = `Sem streaming (tudo em memória antes do primeiro byte)
------------------------------------------------------
banco --[1,8 mi linhas]--> rows[] --map--> linhas[] --join--> csv --send--> cliente
                           heap        heap               heap      Buffer
                           pico: soma das quatro cópias, cresce com o período

Com streaming (memória constante, independente do total)
--------------------------------------------------------
banco --cursor, lote de 1000--> paraCsv --bloco de 64 KB--> res --> cliente
   ^                               |                         |
   |       socket cheio: write() devolve false, pipeline espera 'drain'
   +---------- o gerador para e o cursor não pede o próximo lote ----------+`;

const flowDiagramEn = `Without streaming (everything in memory before the first byte)
---------------------------------------------------------------
db --[1.8M rows]--> rows[] --map--> lines[] --join--> csv --send--> client
                    heap          heap               heap      Buffer
                    peak: sum of the four copies, grows with the period

With streaming (constant memory, independent of the total)
-----------------------------------------------------------
db --cursor, batch of 1000--> paraCsv --64 KB chunk--> res --> client
 ^                               |                    |
 |     socket full: write() returns false, pipeline waits for 'drain'
 +------- the generator pauses and the cursor stops fetching batches ------+`;

const flowDiagramEs = `Sin streaming (todo en memoria antes del primer byte)
-----------------------------------------------------
base --[1,8 M filas]--> rows[] --map--> lineas[] --join--> csv --send--> cliente
                        heap          heap                heap      Buffer
                        pico: suma de las cuatro copias, crece con el periodo

Con streaming (memoria constante, independiente del total)
-----------------------------------------------------------
base --cursor, lote de 1000--> paraCsv --bloque de 64 KB--> res --> cliente
  ^                               |                           |
  |     socket lleno: write() devuelve false, pipeline espera 'drain'
  +-------- el generador se detiene y el cursor no pide el siguiente lote --------+`;

const pt = {
  intro:
    'No fechamento do terceiro trimestre, a analista do financeiro abriu o painel administrativo, escolheu o trimestre inteiro e clicou em exportar pedidos. Eram um milhão e oitocentas mil linhas. Por quarenta segundos a tela mostrou só o indicador de carregando, então ela clicou de novo, e depois mais uma vez. A API rodava em três pods de 1 GiB, e cada clique caiu em um pod diferente. Os três passaram de um gigabyte, foram encerrados pelo Kubernetes com OOMKilled e, durante quase quatro minutos, todos os clientes da loja receberam 502 no checkout. O relatório nunca chegou a ser baixado. O código da exportação estava correto no sentido mais estreito: buscava os pedidos certos, formatava as colunas certas e devolvia um CSV válido em homologação, onde o trimestre tinha oito mil linhas. O defeito era de forma, e não de regra: o código montava o arquivo inteiro na memória antes de enviar o primeiro byte, e o tamanho do relatório crescia junto com a empresa. Este artigo mostra por que a exportação ingênua derruba o processo inteiro e não só a si mesma, como gerar o arquivo em streaming do cursor do banco até o socket do cliente com memória constante, quais detalhes quebram essa solução em produção, como fazer o mesmo com XLSX, quando mover a exportação para um job assíncrono com upload direto para armazenamento de objetos e como provar com um teste que a memória não cresce mais com o tamanho do relatório.',
  sections: [
    {
      title: 'Por que um botão de exportar derruba o servidor inteiro',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A versão que quase todo sistema tem começa assim: uma consulta que devolve todas as linhas do período, um map que transforma cada linha em texto, um join que cola tudo e um res.send no final. Cada passo é simples e funciona com dados de teste. O problema é que cada passo guarda uma cópia completa do relatório e nenhum deles libera a anterior até a função terminar.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'O primeiro custo aparece antes de qualquer linha do código da aplicação: por padrão, o node-postgres, assim como a maioria dos drivers e ORMs, acumula o resultado inteiro e só então resolve a Promise. Um objeto JavaScript por linha, com uma string ou um Date para cada coluna, custa na prática algumas centenas de bytes por linha mesmo quando os dados brutos ocupam bem menos. Com catorze colunas, como no relatório real do incidente, o array de resultado sozinho passou de 800 MB.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'O que fica na memória', 'Ordem de grandeza com 1,8 milhão de linhas'],
          rows: [
            ['Resultado do driver', 'Um objeto por linha, cada valor como string, número ou Date', '700 MB a 1,2 GB'],
            ['Linhas formatadas', 'Um array com uma string por linha', '300 a 500 MB'],
            ['Arquivo montado', 'Uma única string com o CSV inteiro', '250 a 400 MB, em um bloco contíguo'],
            ['Envio', 'res.send converte a string em Buffer antes de escrever no socket', 'Mais 250 a 400 MB'],
            ['Streaming', 'Um lote do cursor e um bloco de texto por vez', 'Poucos MB, qualquer que seja o total'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O processo não morre só por falta de memória. Bem antes do OOM, o coletor de lixo do V8 passa a rodar ciclos completos de vários segundos tentando liberar espaço que não pode ser liberado, porque tudo ainda está referenciado. Durante esses ciclos, o event loop fica parado: o health check não responde, as requisições de checkout que estavam no mesmo processo estouram o timeout e o balanceador marca o pod como doente. A exportação de um usuário vira indisponibilidade para todos. E existe um teto que nem a memória resolve: o V8 não cria strings com mais de cerca de 512 milhões de caracteres, e o join de um relatório maior lança RangeError: Invalid string length, depois de ter consumido toda a memória para chegar lá.',
        },
        {
          type: 'paragraph',
          value:
            'Há um terceiro efeito, mais sutil: o usuário não recebe nada durante todo o processamento. Sem primeiro byte, o navegador mostra a página carregando, o balanceador com timeout de ociosidade de 60 segundos corta a conexão em relatórios grandes e a pessoa clica de novo, multiplicando a carga exatamente no momento em que o servidor está mais frágil. Foi isso que transformou um pod derrubado em três.',
        },
      ],
    },
    {
      title: 'Streaming de ponta a ponta: do cursor do banco ao socket do cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A correção é nunca ter o relatório inteiro em lugar nenhum. O banco entrega as linhas em lotes por um cursor, a aplicação transforma cada lote em texto e escreve no socket, e o próximo lote só é pedido quando o anterior saiu. A memória usada passa a depender do tamanho do lote, e não do tamanho do relatório. Uma exportação de dez mil linhas e uma de dez milhões usam praticamente a mesma quantidade de memória; a segunda só demora mais.',
        },
        {
          type: 'diagram',
          value: flowDiagramPt,
        },
        {
          type: 'paragraph',
          value:
            'A peça que torna isso seguro é o backpressure. Quando o cliente baixa mais devagar do que o servidor produz, o buffer do socket enche e res.write passa a devolver false. O stream.pipeline do Node respeita esse sinal: para de puxar dados do gerador até receber o evento drain, o gerador para no for await e o QueryStream deixa de pedir o próximo lote ao banco. Sem backpressure, um cliente lento em uma conexão móvel faria o servidor acumular o relatório inteiro no buffer de saída, e o problema voltaria por outro caminho.',
        },
        {
          type: 'code',
          value: streamCode,
        },
        {
          type: 'paragraph',
          value:
            'Algumas escolhas do código merecem explicação. O gerador paraCsv junta as linhas em blocos de cerca de 64 KB porque escrever uma linha por vez no socket gera milhões de chamadas pequenas e custa CPU sem ganhar nada em memória. O lote de mil linhas do cursor é um equilíbrio entre idas e voltas ao banco e memória por lote; acima de alguns milhares, o ganho de vazão é pequeno. A rota limita o período do download direto e o número de exportações simultâneas por instância, porque streaming resolve memória, mas não resolve CPU nem conexões do pool: cada exportação ainda serializa milhões de valores e segura uma conexão durante todo o download.',
        },
        {
          type: 'paragraph',
          value:
            'O mesmo vale para qualquer outra fonte. Em ORMs, procure o modo de iteração em lotes ou cursor, como stream no Knex, cursor no Prisma por meio de paginação por chave ou iterate no TypeORM com QueryRunner. Em MySQL, o mysql2 oferece query().stream(). O princípio é sempre o mesmo: se a função devolve um array, ela já carregou tudo.',
        },
      ],
    },
    {
      title: 'Os detalhes que quebram a exportação em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Trocar o array por um stream é a parte fácil. O que separa uma exportação que funciona no notebook de uma que aguenta produção são os casos em que algo dá errado no meio de um download de dez minutos.',
        },
        {
          type: 'list',
          items: [
            'Erro depois do primeiro byte. Os cabeçalhos com status 200 já foram enviados e não existe mais como responder 500. Se o servidor simplesmente encerrar a resposta normalmente, o cliente salva um CSV truncado que parece completo e alguém fecha o mês com metade dos pedidos. Por isso o código deixa o pipeline destruir a resposta sem o bloco final do Transfer-Encoding chunked: o navegador marca o download como falho e o curl termina com erro.',
            'Cliente que desiste. Quando a pessoa fecha a aba, o pipeline rejeita com ERR_STREAM_PREMATURE_CLOSE, destrói o cursor e libera a conexão. Sem isso, o banco continua lendo e o servidor continua formatando um arquivo que ninguém vai receber. A conexão com cursor interrompido volta ao pool com release(true), que a descarta em vez de reaproveitar uma sessão em estado incerto.',
            'CSV que o Excel abre errado. Excel em português espera ponto e vírgula como separador e só reconhece UTF-8 com o BOM no início; sem ele, João vira JoÃ£o. Campos com aspas, ponto e vírgula ou quebra de linha precisam ir entre aspas, com aspas internas dobradas.',
            'Injeção de fórmula. Um cliente que se cadastrou com o nome =HYPERLINK("https://...") vira uma fórmula ativa quando o financeiro abre o arquivo. Texto que começa com =, +, -, @, tabulação ou retorno de carro recebe um apóstrofo na frente, e números negativos legítimos ficam de fora da regra.',
            'Proxy e balanceador. Timeouts de ociosidade de 60 segundos, comuns em balanceadores e no proxy_read_timeout padrão do nginx, só derrubam a conexão quando nenhum byte trafega. Com streaming, o cabeçalho sai em milissegundos e os dados fluem continuamente, então o timeout de ociosidade deixa de ser um problema; o tempo total máximo da requisição, se existir, continua valendo e define o limite do download direto.',
            'Transação longa no primário. Um cursor aberto por dez minutos segura um snapshot, e enquanto ele existir o vacuum não remove versões mortas de linhas em nenhuma tabela. Exportações devem ler de uma réplica de leitura, e o atraso da réplica é aceitável para relatórios, desde que a tela informe até que horário os dados vão.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A consistência do arquivo vem de graça: no PostgreSQL, uma única instrução SELECT lê um snapshot só do início ao fim, mesmo que o cursor leve minutos para ser consumido. Pedidos criados durante o download não aparecem pela metade. Essa garantia se perde quando a exportação é feita em várias consultas paginadas, que é um dos motivos para preferir o cursor sempre que a infraestrutura permitir.',
        },
      ],
    },
    {
      title: 'XLSX sem carregar a planilha inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O pedido de exportar em Excel costuma reintroduzir o problema por dentro da biblioteca. A API mais conhecida das bibliotecas de planilha monta o workbook inteiro como objetos em memória e só gera o arquivo no final, com consumo ainda maior do que o CSV, porque cada célula vira um objeto com valor, tipo e estilo. Um arquivo XLSX é um zip de arquivos XML, e o XML de cada aba pode ser escrito linha a linha. As bibliotecas que suportam isso oferecem um modo de escrita incremental.',
        },
        {
          type: 'code',
          value: xlsxCode,
        },
        {
          type: 'paragraph',
          value:
            'Três limitações precisam estar claras antes de oferecer XLSX. A primeira é o limite do próprio Excel, de 1.048.576 linhas por aba: acima disso, a escolha honesta é recusar e oferecer CSV, ou dividir em abas, e não truncar em silêncio. A segunda é que o modo incremental do ExcelJS não espera o evento drain do destino, então ele deve escrever em um destino rápido, como um arquivo local ou um upload para armazenamento de objetos, e não diretamente na resposta para um cliente lento. A terceira é o custo de CPU: gerar XML e comprimir em zip custa várias vezes mais do que gerar CSV, o que é mais um motivo para a exportação grande rodar fora do processo da API.',
        },
      ],
    },
    {
      title: 'Quando o relatório não cabe em uma requisição: exportação assíncrona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Streaming resolve a memória, mas uma requisição HTTP de quinze minutos continua frágil: um deploy no meio reinicia o pod, uma troca de rede no celular derruba o download, e o usuário fica preso olhando a barra de progresso. Acima de um volume que você define medindo, a exportação deixa de ser uma resposta e passa a ser um trabalho.',
        },
        {
          type: 'ordered',
          items: [
            'O usuário pede a exportação e a API grava um job com status pendente e os filtros, devolvendo 202 com o identificador. A tela mostra que o arquivo está sendo gerado e que a pessoa será avisada.',
            'Um worker separado da API pega o job da fila, abre o cursor na réplica e escreve o arquivo em streaming direto para o armazenamento de objetos, com upload multipart e compressão.',
            'Ao terminar, o worker grava o status concluído e um link pré-assinado com validade curta, e avisa o usuário por e-mail ou notificação no painel.',
            'Uma regra de ciclo de vida no bucket apaga os arquivos depois de alguns dias, porque relatórios com dados de clientes não devem ficar armazenados para sempre.',
          ],
        },
        {
          type: 'code',
          value: asyncCode,
        },
        {
          type: 'paragraph',
          value:
            'O upload multipart com partes de 8 MB e fila de 2 limita a memória do worker a algumas dezenas de megabytes, e o PassThrough propaga o backpressure: se o envio para o bucket fica lento, o pipeline para e o cursor espera. O Promise.all garante que a função só termina quando os dois lados terminaram, e o abort no erro descarta as partes já enviadas, que de outro modo ficariam cobradas no bucket sem formar um arquivo. A compressão gzip com Content-Encoding reduz o arquivo de CSV em cinco a dez vezes, e o navegador descomprime de forma transparente ao baixar pelo link.',
        },
        {
          type: 'paragraph',
          value:
            'Esse desenho também resolve o clique repetido. Antes de criar um job, a API verifica se já existe um pendente com os mesmos filtros para o mesmo usuário e devolve o identificador existente. O worker processa poucos jobs em paralelo, e uma fila de exportações cheia significa espera maior, e não checkout fora do ar.',
        },
      ],
    },
    {
      title: 'Como provar que a memória ficou constante',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um teste que exporta cem linhas e confere o conteúdo não pega nada disso. O que precisa ser provado é que o pico de memória não depende do tamanho do relatório e que o arquivo chega completo mesmo com um cliente lento. O teste usa volume real, um cliente limitado de propósito e uma comparação de contagem.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Rode o mesmo teste com duzentas mil e com dois milhões de linhas e compare o pico de RSS registrado pelo servidor. Na versão com streaming, os dois picos ficam praticamente iguais; se o segundo for dez vezes maior, algo no caminho ainda está acumulando, e o suspeito mais comum é um middleware de compressão ou de log que guarda o corpo da resposta. Em seguida, interrompa o curl no meio e confirme na pg_stat_activity que a consulta foi cancelada e que a conexão saiu do pool. Por fim, rode três exportações ao mesmo tempo e confirme que a terceira recebe 429 enquanto a latência das outras rotas fica estável.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Depois'],
          rows: [
            ['Pico de RSS do pod em uma exportação do trimestre', 'Acima de 1 GiB, OOMKilled', '140 MiB'],
            ['Tempo até o primeiro byte', '48 s, quando chegava a terminar', '0,4 s'],
            ['p99 das outras rotas durante a exportação', '9 s', '210 ms'],
            ['Exportações simultâneas por instância', 'Nenhuma sem risco de derrubar o pod', '2, o restante em 429 ou na fila assíncrona'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Depois da mudança, a exportação do trimestre passou a sair pelo fluxo assíncrono em pouco mais de três minutos, com um arquivo de 38 MB comprimido, e os downloads diretos de até um mês começam em menos de meio segundo. Desde então, o painel de memória dos pods da API não mostra mais degraus na hora do fechamento do mês.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Não seria mais simples aumentar a memória do servidor?',
      answer:
        'Compra tempo, não resolve. O consumo da exportação ingênua cresce linearmente com o volume, e o volume cresce com a empresa: o relatório que hoje cabe em 4 GiB não cabe no ano que vem. Além disso, aumentar a memória de todos os pods da API para atender um uso raro é caro, e ainda há o teto do tamanho de string do V8, que nenhuma quantidade de memória remove. Com streaming, o mesmo pod de 1 GiB exporta qualquer volume, e o limite passa a ser o tempo, que você trata movendo a exportação para um job.',
    },
    {
      question: 'Uso PgBouncer em modo transação. O cursor continua funcionando?',
      answer:
        'Funciona, desde que todo o cursor fique dentro de uma única transação, como no código do artigo, porque o PgBouncer mantém a mesma conexão do servidor até o COMMIT. O custo é que essa conexão fica presa durante toda a exportação. Se isso pesar, a alternativa é paginação por chave: buscar lotes com WHERE (criado_em, id) > ($1, $2) ORDER BY criado_em, id LIMIT 5000, guardando a última chave de cada lote. Cada lote é uma transação curta, mas o arquivo deixa de ser um snapshot único, e pedidos alterados durante a exportação podem aparecer com valores de momentos diferentes.',
    },
    {
      question: 'Devo oferecer CSV, XLSX ou os dois?',
      answer:
        'CSV como padrão para volume, porque é gerado em streaming verdadeiro, comprime muito bem e é lido por qualquer ferramenta de análise. XLSX quando o destino é uma pessoa que vai abrir no Excel e precisa de tipos corretos, como datas e números formatados, e desde que o volume caiba no limite de linhas por aba. Na prática, muitos times oferecem XLSX até um limite de linhas e, acima dele, geram CSV automaticamente com um aviso na tela, em vez de deixar o usuário escolher um formato que vai falhar.',
    },
  ],
  conclusion: {
    title: 'Exportação grande não é um problema de memória, é um problema de forma',
    description:
      'Montar o relatório inteiro antes de enviar funciona em homologação e derruba o processo inteiro no dia em que o volume real chega, levando junto as rotas que não têm nada a ver com o relatório. A correção é tratar a exportação como fluxo: cursor no banco, transformação em blocos e escrita no socket com backpressure, com cuidado explícito para o cliente que desiste, o erro no meio do download, o CSV que o Excel precisa abrir e a transação longa que não pode ficar no primário. Acima de um volume medido, a exportação vira um job assíncrono que escreve direto no armazenamento de objetos e devolve um link. Posso revisar as exportações e relatórios do seu sistema, implementar o streaming e o fluxo assíncrono e montar o teste de carga que prova que a memória não cresce mais com o tamanho do arquivo.',
    cta: 'Falar sobre as exportações do meu sistema',
  },
  related: [
    {
      label: 'Paginação por offset em tabela grande: quando a página 500 derruba o banco',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Backpressure em pipeline de IA: quando o consumidor não acompanha',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'At the close of the third quarter, an analyst from the finance team opened the admin panel, picked the whole quarter and clicked export orders. It was one million eight hundred thousand rows. For forty seconds the screen showed nothing but a loading indicator, so she clicked again, and then once more. The API ran on three 1 GiB pods, and each click landed on a different pod. All three went past one gigabyte, were killed by Kubernetes with OOMKilled and, for almost four minutes, every customer of the store got a 502 at checkout. The report was never downloaded. The export code was correct in the narrowest sense: it fetched the right orders, formatted the right columns and returned a valid CSV in staging, where the quarter had eight thousand rows. The defect was one of shape, not of logic: the code built the whole file in memory before sending the first byte, and the size of the report grew along with the company. This article shows why the naive export takes down the entire process and not just itself, how to generate the file as a stream from the database cursor to the client socket with constant memory, which details break that solution in production, how to do the same with XLSX, when to move the export to an asynchronous job that uploads straight to object storage, and how to prove with a test that memory no longer grows with the size of the report.',
  sections: [
    {
      title: 'Why an export button takes down the whole server',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The version almost every system has starts like this: a query that returns every row in the period, a map that turns each row into text, a join that glues it all together and a res.send at the end. Each step is simple and works with test data. The problem is that each step holds a full copy of the report, and none of them releases the previous one until the function returns.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'The first cost shows up before any line of application code runs: by default, node-postgres, like most drivers and ORMs, buffers the entire result and only then resolves the Promise. One JavaScript object per row, with a string or a Date for each column, costs a few hundred bytes per row in practice, even when the raw data is much smaller. With fourteen columns, as in the real report from the incident, the result array alone went past 800 MB.',
        },
        {
          type: 'table',
          columns: ['Stage', 'What stays in memory', 'Order of magnitude for 1.8 million rows'],
          rows: [
            ['Driver result', 'One object per row, each value as a string, number or Date', '700 MB to 1.2 GB'],
            ['Formatted lines', 'An array with one string per row', '300 to 500 MB'],
            ['Assembled file', 'A single string holding the whole CSV', '250 to 400 MB, in one contiguous block'],
            ['Sending', 'res.send converts the string into a Buffer before writing to the socket', 'Another 250 to 400 MB'],
            ['Streaming', 'One cursor batch and one text chunk at a time', 'A few MB, whatever the total'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The process does not die only from lack of memory. Well before the OOM, the V8 garbage collector starts running full cycles of several seconds trying to free space that cannot be freed, because everything is still referenced. During those cycles, the event loop is blocked: the health check stops answering, the checkout requests living in the same process time out and the load balancer marks the pod as unhealthy. One user\'s export becomes an outage for everyone. And there is a ceiling that no amount of memory fixes: V8 does not create strings longer than roughly 512 million characters, and the join of a larger report throws RangeError: Invalid string length, after having consumed all the memory to get there.',
        },
        {
          type: 'paragraph',
          value:
            'There is a third, subtler effect: the user receives nothing during the whole processing time. With no first byte, the browser shows the page as loading, a load balancer with a 60 second idle timeout cuts the connection on large reports and the person clicks again, multiplying the load exactly when the server is most fragile. That is what turned one dead pod into three.',
        },
      ],
    },
    {
      title: 'End-to-end streaming: from the database cursor to the client socket',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The fix is to never have the whole report anywhere. The database delivers rows in batches through a cursor, the application turns each batch into text and writes it to the socket, and the next batch is only requested once the previous one has gone out. Memory usage now depends on the batch size, not on the report size. An export of ten thousand rows and one of ten million use practically the same amount of memory; the second one just takes longer.',
        },
        {
          type: 'diagram',
          value: flowDiagramEn,
        },
        {
          type: 'paragraph',
          value:
            'The piece that makes this safe is backpressure. When the client downloads more slowly than the server produces, the socket buffer fills up and res.write starts returning false. Node\'s stream.pipeline honors that signal: it stops pulling data from the generator until it receives the drain event, the generator pauses inside the for await and QueryStream stops asking the database for the next batch. Without backpressure, a slow client on a mobile connection would make the server accumulate the entire report in the output buffer, and the problem would come back through another door.',
        },
        {
          type: 'code',
          value: streamCode,
        },
        {
          type: 'paragraph',
          value:
            'A few choices in the code deserve an explanation. The paraCsv generator groups rows into chunks of about 64 KB because writing one row at a time to the socket creates millions of tiny calls and burns CPU without saving any memory. The cursor batch of one thousand rows balances database round trips against memory per batch; beyond a few thousand, the throughput gain is small. The route limits the period for direct downloads and the number of concurrent exports per instance, because streaming solves memory but not CPU or pool connections: each export still serializes millions of values and holds a connection for the entire download.',
        },
        {
          type: 'paragraph',
          value:
            'The same applies to any other data source. In ORMs, look for the batch iteration or cursor mode, such as stream in Knex, keyset pagination with a cursor in Prisma or iterate in TypeORM through a QueryRunner. In MySQL, mysql2 offers query().stream(). The principle is always the same: if the function returns an array, it has already loaded everything.',
        },
      ],
    },
    {
      title: 'The details that break exports in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Swapping the array for a stream is the easy part. What separates an export that works on a laptop from one that survives production is the set of cases where something goes wrong in the middle of a ten minute download.',
        },
        {
          type: 'list',
          items: [
            'An error after the first byte. The headers with status 200 have already been sent and there is no way to answer 500 anymore. If the server just ends the response normally, the client saves a truncated CSV that looks complete and someone closes the month with half of the orders. That is why the code lets pipeline destroy the response without the final chunk of Transfer-Encoding chunked: the browser marks the download as failed and curl exits with an error.',
            'A client that gives up. When the person closes the tab, pipeline rejects with ERR_STREAM_PREMATURE_CLOSE, destroys the cursor and frees the connection. Without that, the database keeps reading and the server keeps formatting a file nobody will receive. The connection with an interrupted cursor goes back to the pool with release(true), which discards it instead of reusing a session in an uncertain state.',
            'A CSV that Excel opens incorrectly. Excel in locales such as Portuguese expects a semicolon as the separator and only recognizes UTF-8 when the BOM is at the start; without it, João turns into JoÃ£o. Fields containing quotes, semicolons or line breaks must be quoted, with inner quotes doubled.',
            'Formula injection. A customer who signed up with the name =HYPERLINK("https://...") becomes a live formula when finance opens the file. Text starting with =, +, -, @, tab or carriage return gets an apostrophe in front, and legitimate negative numbers are excluded from the rule.',
            'Proxies and load balancers. Idle timeouts of 60 seconds, common in load balancers and in nginx\'s default proxy_read_timeout, only drop the connection when no bytes flow. With streaming, the headers go out in milliseconds and data flows continuously, so the idle timeout stops being a problem; any maximum total request time still applies and defines the limit for direct downloads.',
            'A long transaction on the primary. A cursor open for ten minutes holds a snapshot, and while it exists vacuum cannot remove dead row versions in any table. Exports should read from a read replica, and replica lag is acceptable for reports as long as the screen states up to what time the data goes.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'File consistency comes for free: in PostgreSQL, a single SELECT statement reads one snapshot from start to finish, even if the cursor takes minutes to be consumed. Orders created during the download never show up half written. That guarantee is lost when the export runs as several paginated queries, which is one of the reasons to prefer the cursor whenever the infrastructure allows it.',
        },
      ],
    },
    {
      title: 'XLSX without loading the whole spreadsheet',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The request to export to Excel often reintroduces the problem from inside the library. The best known API of spreadsheet libraries builds the whole workbook as in-memory objects and only generates the file at the end, consuming even more than CSV, because each cell becomes an object with value, type and style. An XLSX file is a zip of XML files, and the XML of each sheet can be written row by row. Libraries that support this offer an incremental writing mode.',
        },
        {
          type: 'code',
          value: xlsxCode,
        },
        {
          type: 'paragraph',
          value:
            'Three limitations need to be clear before offering XLSX. The first is Excel\'s own limit of 1,048,576 rows per sheet: beyond that, the honest choice is to refuse and offer CSV, or split into sheets, never truncate silently. The second is that ExcelJS\'s incremental mode does not wait for the destination\'s drain event, so it should write to a fast destination, such as a local file or an object storage upload, not directly to the response of a slow client. The third is CPU cost: generating XML and compressing it into a zip costs several times more than generating CSV, which is one more reason for large exports to run outside the API process.',
        },
      ],
    },
    {
      title: 'When the report does not fit in one request: asynchronous export',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Streaming solves memory, but a fifteen minute HTTP request is still fragile: a deploy in the middle restarts the pod, a network switch on the phone drops the download, and the user is stuck watching a progress bar. Above a volume you define by measuring, the export stops being a response and becomes a job.',
        },
        {
          type: 'ordered',
          items: [
            'The user requests the export and the API stores a job with pending status and the filters, returning 202 with its identifier. The screen says the file is being generated and that the person will be notified.',
            'A worker separate from the API picks the job from the queue, opens the cursor on the replica and streams the file straight to object storage, with multipart upload and compression.',
            'When it finishes, the worker stores the completed status and a short-lived presigned link, and notifies the user by email or by a notification in the panel.',
            'A lifecycle rule on the bucket deletes files after a few days, because reports containing customer data should not be stored forever.',
          ],
        },
        {
          type: 'code',
          value: asyncCode,
        },
        {
          type: 'paragraph',
          value:
            'The multipart upload with 8 MB parts and a queue of 2 keeps the worker\'s memory at a few dozen megabytes, and the PassThrough propagates backpressure: if the upload to the bucket slows down, the pipeline pauses and the cursor waits. Promise.all ensures the function only returns when both sides have finished, and abort on error discards the parts already sent, which would otherwise stay billed in the bucket without ever forming a file. Gzip compression with Content-Encoding shrinks a CSV file five to ten times, and the browser decompresses it transparently when downloading through the link.',
        },
        {
          type: 'paragraph',
          value:
            'This design also solves the repeated click. Before creating a job, the API checks whether a pending one already exists with the same filters for the same user and returns the existing identifier. The worker processes a few jobs in parallel, and a full export queue means a longer wait, not checkout going down.',
        },
      ],
    },
    {
      title: 'How to prove that memory stayed constant',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A test that exports a hundred rows and checks the content catches none of this. What needs proving is that peak memory does not depend on report size and that the file arrives complete even with a slow client. The test uses real volume, a deliberately throttled client and a count comparison.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Run the same test with two hundred thousand and with two million rows and compare the peak RSS logged by the server. In the streaming version, both peaks stay practically the same; if the second one is ten times larger, something along the path is still accumulating, and the usual suspect is a compression or logging middleware that keeps the response body. Next, interrupt curl halfway and confirm in pg_stat_activity that the query was cancelled and the connection left the pool. Finally, run three exports at the same time and confirm that the third gets a 429 while the latency of the other routes stays stable.',
        },
        {
          type: 'table',
          columns: ['Metric', 'Before', 'After'],
          rows: [
            ['Pod peak RSS during a quarterly export', 'Above 1 GiB, OOMKilled', '140 MiB'],
            ['Time to first byte', '48 s, when it finished at all', '0.4 s'],
            ['p99 of other routes during the export', '9 s', '210 ms'],
            ['Concurrent exports per instance', 'None without risking the pod', '2, the rest get 429 or go to the async queue'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'After the change, the quarterly export moved to the asynchronous flow and finishes in a little over three minutes, producing a 38 MB compressed file, and direct downloads of up to one month start in under half a second. Since then, the memory chart of the API pods no longer shows steps during month-end closing.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Would it not be simpler to give the server more memory?',
      answer:
        'It buys time, it does not fix anything. The naive export grows linearly with volume, and volume grows with the company: the report that fits in 4 GiB today will not fit next year. Raising the memory of every API pod to serve a rare use case is also expensive, and there is still V8\'s string length ceiling, which no amount of memory removes. With streaming, the same 1 GiB pod exports any volume, and the limit becomes time, which you handle by moving the export to a job.',
    },
    {
      question: 'I use PgBouncer in transaction mode. Does the cursor still work?',
      answer:
        'It does, as long as the whole cursor lives inside a single transaction, as in the article\'s code, because PgBouncer keeps the same server connection until COMMIT. The cost is that this connection is held for the entire export. If that hurts, the alternative is keyset pagination: fetch batches with WHERE (criado_em, id) > ($1, $2) ORDER BY criado_em, id LIMIT 5000, keeping the last key of each batch. Each batch is a short transaction, but the file is no longer a single snapshot, and orders changed during the export may show values from different moments.',
    },
    {
      question: 'Should I offer CSV, XLSX or both?',
      answer:
        'CSV as the default for volume, because it is generated with true streaming, compresses very well and can be read by any analysis tool. XLSX when the destination is a person who will open it in Excel and needs correct types, such as formatted dates and numbers, as long as the volume fits within the per-sheet row limit. In practice, many teams offer XLSX up to a row limit and, above it, automatically generate CSV with a notice on screen, instead of letting the user pick a format that is going to fail.',
    },
  ],
  conclusion: {
    title: 'A large export is not a memory problem, it is a shape problem',
    description:
      'Building the whole report before sending it works in staging and takes down the entire process on the day real volume arrives, dragging along routes that have nothing to do with the report. The fix is to treat the export as a flow: a database cursor, transformation in chunks and writing to the socket with backpressure, with explicit care for the client that gives up, the error in the middle of the download, the CSV that Excel has to open and the long transaction that cannot stay on the primary. Above a measured volume, the export becomes an asynchronous job that writes straight to object storage and returns a link. I can review the exports and reports in your system, implement streaming and the asynchronous flow, and set up the load test that proves memory no longer grows with file size.',
    cta: 'Talk about the exports in my system',
  },
  related: [
    {
      label: 'Offset pagination on a large table: when page 500 takes down the database',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Backpressure in an AI pipeline: when the consumer cannot keep up',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'En el cierre del tercer trimestre, una analista de finanzas abrió el panel de administración, eligió el trimestre completo e hizo clic en exportar pedidos. Eran un millón ochocientas mil filas. Durante cuarenta segundos la pantalla solo mostró el indicador de carga, así que volvió a hacer clic, y después una vez más. La API corría en tres pods de 1 GiB, y cada clic cayó en un pod distinto. Los tres pasaron de un gigabyte, Kubernetes los terminó con OOMKilled y, durante casi cuatro minutos, todos los clientes de la tienda recibieron 502 en el checkout. El informe nunca llegó a descargarse. El código de la exportación era correcto en el sentido más estrecho: buscaba los pedidos correctos, formateaba las columnas correctas y devolvía un CSV válido en el entorno de pruebas, donde el trimestre tenía ocho mil filas. El defecto era de forma y no de lógica: el código armaba el archivo entero en memoria antes de enviar el primer byte, y el tamaño del informe crecía junto con la empresa. Este artículo muestra por qué la exportación ingenua tumba el proceso entero y no solo a sí misma, cómo generar el archivo en streaming desde el cursor de la base de datos hasta el socket del cliente con memoria constante, qué detalles rompen esa solución en producción, cómo hacer lo mismo con XLSX, cuándo mover la exportación a un job asíncrono que sube el archivo directo al almacenamiento de objetos y cómo demostrar con una prueba que la memoria ya no crece con el tamaño del informe.',
  sections: [
    {
      title: 'Por qué un botón de exportar tumba el servidor entero',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La versión que tiene casi todo sistema empieza así: una consulta que devuelve todas las filas del periodo, un map que convierte cada fila en texto, un join que lo pega todo y un res.send al final. Cada paso es simple y funciona con datos de prueba. El problema es que cada paso guarda una copia completa del informe y ninguno libera la anterior hasta que la función termina.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'El primer costo aparece antes de cualquier línea del código de la aplicación: por defecto, node-postgres, como la mayoría de los drivers y ORMs, acumula el resultado entero y solo entonces resuelve la Promise. Un objeto JavaScript por fila, con un string o un Date por columna, cuesta en la práctica algunos cientos de bytes por fila aunque los datos brutos ocupen mucho menos. Con catorce columnas, como en el informe real del incidente, el array de resultados por sí solo superó los 800 MB.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Qué queda en memoria', 'Orden de magnitud con 1,8 millones de filas'],
          rows: [
            ['Resultado del driver', 'Un objeto por fila, cada valor como string, número o Date', '700 MB a 1,2 GB'],
            ['Líneas formateadas', 'Un array con un string por fila', '300 a 500 MB'],
            ['Archivo armado', 'Un único string con el CSV entero', '250 a 400 MB, en un bloque contiguo'],
            ['Envío', 'res.send convierte el string en Buffer antes de escribir en el socket', 'Otros 250 a 400 MB'],
            ['Streaming', 'Un lote del cursor y un bloque de texto a la vez', 'Pocos MB, sea cual sea el total'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El proceso no muere solo por falta de memoria. Mucho antes del OOM, el recolector de basura de V8 empieza a ejecutar ciclos completos de varios segundos intentando liberar espacio que no se puede liberar, porque todo sigue referenciado. Durante esos ciclos, el event loop queda bloqueado: el health check deja de responder, las peticiones de checkout que vivían en el mismo proceso agotan el timeout y el balanceador marca el pod como enfermo. La exportación de un usuario se convierte en una caída para todos. Y hay un techo que ninguna cantidad de memoria resuelve: V8 no crea strings de más de unos 512 millones de caracteres, y el join de un informe más grande lanza RangeError: Invalid string length, después de haber consumido toda la memoria para llegar ahí.',
        },
        {
          type: 'paragraph',
          value:
            'Hay un tercer efecto, más sutil: el usuario no recibe nada durante todo el procesamiento. Sin primer byte, el navegador muestra la página cargando, un balanceador con timeout de inactividad de 60 segundos corta la conexión en informes grandes y la persona vuelve a hacer clic, multiplicando la carga justo cuando el servidor está más frágil. Eso fue lo que convirtió un pod caído en tres.',
        },
      ],
    },
    {
      title: 'Streaming de punta a punta: del cursor de la base de datos al socket del cliente',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La corrección es no tener nunca el informe entero en ningún lugar. La base de datos entrega las filas en lotes a través de un cursor, la aplicación convierte cada lote en texto y lo escribe en el socket, y el siguiente lote solo se pide cuando el anterior ya salió. La memoria usada pasa a depender del tamaño del lote y no del tamaño del informe. Una exportación de diez mil filas y una de diez millones usan prácticamente la misma cantidad de memoria; la segunda solo tarda más.',
        },
        {
          type: 'diagram',
          value: flowDiagramEs,
        },
        {
          type: 'paragraph',
          value:
            'La pieza que hace esto seguro es el backpressure. Cuando el cliente descarga más despacio de lo que el servidor produce, el buffer del socket se llena y res.write empieza a devolver false. El stream.pipeline de Node respeta esa señal: deja de pedir datos al generador hasta recibir el evento drain, el generador se detiene en el for await y QueryStream deja de pedir el siguiente lote a la base de datos. Sin backpressure, un cliente lento en una conexión móvil haría que el servidor acumulara el informe entero en el buffer de salida, y el problema volvería por otro camino.',
        },
        {
          type: 'code',
          value: streamCode,
        },
        {
          type: 'paragraph',
          value:
            'Algunas decisiones del código merecen explicación. El generador paraCsv agrupa las filas en bloques de unos 64 KB porque escribir una fila a la vez en el socket genera millones de llamadas pequeñas y gasta CPU sin ahorrar memoria. El lote de mil filas del cursor equilibra los viajes de ida y vuelta a la base de datos con la memoria por lote; por encima de algunos miles, la ganancia de rendimiento es pequeña. La ruta limita el periodo de la descarga directa y el número de exportaciones simultáneas por instancia, porque el streaming resuelve la memoria pero no la CPU ni las conexiones del pool: cada exportación sigue serializando millones de valores y retiene una conexión durante toda la descarga.',
        },
        {
          type: 'paragraph',
          value:
            'Lo mismo vale para cualquier otra fuente. En los ORMs, busca el modo de iteración por lotes o cursor, como stream en Knex, paginación por clave con cursor en Prisma o iterate en TypeORM mediante un QueryRunner. En MySQL, mysql2 ofrece query().stream(). El principio es siempre el mismo: si la función devuelve un array, ya cargó todo.',
        },
      ],
    },
    {
      title: 'Los detalles que rompen la exportación en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Cambiar el array por un stream es la parte fácil. Lo que separa una exportación que funciona en el portátil de una que aguanta producción son los casos en que algo sale mal en medio de una descarga de diez minutos.',
        },
        {
          type: 'list',
          items: [
            'Error después del primer byte. Las cabeceras con estado 200 ya se enviaron y ya no hay forma de responder 500. Si el servidor simplemente termina la respuesta de forma normal, el cliente guarda un CSV truncado que parece completo y alguien cierra el mes con la mitad de los pedidos. Por eso el código deja que pipeline destruya la respuesta sin el bloque final del Transfer-Encoding chunked: el navegador marca la descarga como fallida y curl termina con error.',
            'Cliente que se rinde. Cuando la persona cierra la pestaña, pipeline rechaza con ERR_STREAM_PREMATURE_CLOSE, destruye el cursor y libera la conexión. Sin eso, la base de datos sigue leyendo y el servidor sigue formateando un archivo que nadie va a recibir. La conexión con el cursor interrumpido vuelve al pool con release(true), que la descarta en lugar de reutilizar una sesión en estado incierto.',
            'CSV que Excel abre mal. Excel en configuraciones regionales como la española o la portuguesa espera punto y coma como separador y solo reconoce UTF-8 si el BOM está al principio; sin él, João se convierte en JoÃ£o. Los campos con comillas, punto y coma o saltos de línea deben ir entre comillas, con las comillas internas duplicadas.',
            'Inyección de fórmulas. Un cliente que se registró con el nombre =HYPERLINK("https://...") se convierte en una fórmula activa cuando finanzas abre el archivo. El texto que empieza con =, +, -, @, tabulación o retorno de carro recibe un apóstrofo delante, y los números negativos legítimos quedan fuera de la regla.',
            'Proxy y balanceador. Los timeouts de inactividad de 60 segundos, comunes en balanceadores y en el proxy_read_timeout por defecto de nginx, solo cortan la conexión cuando no pasa ningún byte. Con streaming, las cabeceras salen en milisegundos y los datos fluyen de forma continua, así que el timeout de inactividad deja de ser un problema; el tiempo total máximo de la petición, si existe, sigue aplicando y define el límite de la descarga directa.',
            'Transacción larga en el primario. Un cursor abierto durante diez minutos retiene un snapshot, y mientras exista el vacuum no puede eliminar versiones muertas de filas en ninguna tabla. Las exportaciones deben leer de una réplica de lectura, y el retraso de la réplica es aceptable para informes siempre que la pantalla indique hasta qué hora llegan los datos.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La consistencia del archivo sale gratis: en PostgreSQL, una única sentencia SELECT lee un solo snapshot de principio a fin, aunque el cursor tarde minutos en consumirse. Los pedidos creados durante la descarga nunca aparecen a medias. Esa garantía se pierde cuando la exportación se hace en varias consultas paginadas, que es uno de los motivos para preferir el cursor siempre que la infraestructura lo permita.',
        },
      ],
    },
    {
      title: 'XLSX sin cargar la hoja de cálculo entera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La petición de exportar a Excel suele reintroducir el problema desde dentro de la librería. La API más conocida de las librerías de hojas de cálculo arma el libro entero como objetos en memoria y solo genera el archivo al final, con un consumo aún mayor que el del CSV, porque cada celda se convierte en un objeto con valor, tipo y estilo. Un archivo XLSX es un zip de archivos XML, y el XML de cada hoja puede escribirse fila por fila. Las librerías que lo soportan ofrecen un modo de escritura incremental.',
        },
        {
          type: 'code',
          value: xlsxCode,
        },
        {
          type: 'paragraph',
          value:
            'Hay tres limitaciones que deben estar claras antes de ofrecer XLSX. La primera es el límite del propio Excel, de 1.048.576 filas por hoja: por encima de eso, la opción honesta es rechazar y ofrecer CSV, o dividir en hojas, y nunca truncar en silencio. La segunda es que el modo incremental de ExcelJS no espera el evento drain del destino, así que debe escribir en un destino rápido, como un archivo local o una subida al almacenamiento de objetos, y no directamente en la respuesta a un cliente lento. La tercera es el costo de CPU: generar XML y comprimirlo en zip cuesta varias veces más que generar CSV, lo que es un motivo más para que la exportación grande corra fuera del proceso de la API.',
        },
      ],
    },
    {
      title: 'Cuando el informe no cabe en una petición: exportación asíncrona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El streaming resuelve la memoria, pero una petición HTTP de quince minutos sigue siendo frágil: un despliegue a mitad de camino reinicia el pod, un cambio de red en el móvil corta la descarga y el usuario queda atrapado mirando la barra de progreso. Por encima de un volumen que defines midiendo, la exportación deja de ser una respuesta y pasa a ser un trabajo.',
        },
        {
          type: 'ordered',
          items: [
            'El usuario pide la exportación y la API guarda un job con estado pendiente y los filtros, devolviendo 202 con su identificador. La pantalla indica que el archivo se está generando y que la persona recibirá un aviso.',
            'Un worker separado de la API toma el job de la cola, abre el cursor en la réplica y escribe el archivo en streaming directamente al almacenamiento de objetos, con subida multipart y compresión.',
            'Al terminar, el worker guarda el estado completado y un enlace prefirmado de validez corta, y avisa al usuario por correo o con una notificación en el panel.',
            'Una regla de ciclo de vida en el bucket borra los archivos después de unos días, porque los informes con datos de clientes no deben quedar guardados para siempre.',
          ],
        },
        {
          type: 'code',
          value: asyncCode,
        },
        {
          type: 'paragraph',
          value:
            'La subida multipart con partes de 8 MB y cola de 2 limita la memoria del worker a algunas decenas de megabytes, y el PassThrough propaga el backpressure: si la subida al bucket se vuelve lenta, el pipeline se detiene y el cursor espera. Promise.all garantiza que la función solo termina cuando ambos lados terminaron, y el abort en caso de error descarta las partes ya enviadas, que de otro modo quedarían cobradas en el bucket sin llegar a formar un archivo. La compresión gzip con Content-Encoding reduce un archivo CSV entre cinco y diez veces, y el navegador lo descomprime de forma transparente al descargar por el enlace.',
        },
        {
          type: 'paragraph',
          value:
            'Este diseño también resuelve el clic repetido. Antes de crear un job, la API verifica si ya existe uno pendiente con los mismos filtros para el mismo usuario y devuelve el identificador existente. El worker procesa pocos jobs en paralelo, y una cola de exportaciones llena significa más espera, no el checkout caído.',
        },
      ],
    },
    {
      title: 'Cómo demostrar que la memoria quedó constante',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba que exporta cien filas y verifica el contenido no detecta nada de esto. Lo que hay que demostrar es que el pico de memoria no depende del tamaño del informe y que el archivo llega completo incluso con un cliente lento. La prueba usa volumen real, un cliente limitado a propósito y una comparación de conteo.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'paragraph',
          value:
            'Ejecuta la misma prueba con doscientas mil y con dos millones de filas y compara el pico de RSS registrado por el servidor. En la versión con streaming, los dos picos quedan prácticamente iguales; si el segundo es diez veces mayor, algo en el camino sigue acumulando, y el sospechoso más común es un middleware de compresión o de log que guarda el cuerpo de la respuesta. Después, interrumpe curl a mitad de camino y confirma en pg_stat_activity que la consulta se canceló y que la conexión salió del pool. Por último, lanza tres exportaciones al mismo tiempo y confirma que la tercera recibe 429 mientras la latencia de las demás rutas se mantiene estable.',
        },
        {
          type: 'table',
          columns: ['Métrica', 'Antes', 'Después'],
          rows: [
            ['Pico de RSS del pod en una exportación trimestral', 'Más de 1 GiB, OOMKilled', '140 MiB'],
            ['Tiempo hasta el primer byte', '48 s, cuando llegaba a terminar', '0,4 s'],
            ['p99 de las demás rutas durante la exportación', '9 s', '210 ms'],
            ['Exportaciones simultáneas por instancia', 'Ninguna sin riesgo de tumbar el pod', '2, el resto recibe 429 o va a la cola asíncrona'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Después del cambio, la exportación trimestral pasó al flujo asíncrono y termina en poco más de tres minutos, con un archivo comprimido de 38 MB, y las descargas directas de hasta un mes empiezan en menos de medio segundo. Desde entonces, el gráfico de memoria de los pods de la API ya no muestra escalones durante el cierre de mes.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿No sería más simple darle más memoria al servidor?',
      answer:
        'Compra tiempo, no resuelve nada. El consumo de la exportación ingenua crece de forma lineal con el volumen, y el volumen crece con la empresa: el informe que hoy cabe en 4 GiB no cabrá el año que viene. Además, aumentar la memoria de todos los pods de la API para atender un uso poco frecuente es caro, y sigue existiendo el techo de tamaño de string de V8, que ninguna cantidad de memoria elimina. Con streaming, el mismo pod de 1 GiB exporta cualquier volumen, y el límite pasa a ser el tiempo, que se resuelve moviendo la exportación a un job.',
    },
    {
      question: 'Uso PgBouncer en modo transacción. ¿El cursor sigue funcionando?',
      answer:
        'Funciona, siempre que todo el cursor quede dentro de una única transacción, como en el código del artículo, porque PgBouncer mantiene la misma conexión al servidor hasta el COMMIT. El costo es que esa conexión queda retenida durante toda la exportación. Si eso pesa, la alternativa es la paginación por clave: pedir lotes con WHERE (criado_em, id) > ($1, $2) ORDER BY criado_em, id LIMIT 5000, guardando la última clave de cada lote. Cada lote es una transacción corta, pero el archivo deja de ser un único snapshot, y los pedidos modificados durante la exportación pueden aparecer con valores de momentos distintos.',
    },
    {
      question: '¿Debo ofrecer CSV, XLSX o ambos?',
      answer:
        'CSV por defecto para volumen, porque se genera con streaming real, comprime muy bien y lo lee cualquier herramienta de análisis. XLSX cuando el destino es una persona que lo va a abrir en Excel y necesita tipos correctos, como fechas y números con formato, siempre que el volumen quepa en el límite de filas por hoja. En la práctica, muchos equipos ofrecen XLSX hasta un límite de filas y, por encima de él, generan CSV automáticamente con un aviso en pantalla, en lugar de dejar que el usuario elija un formato que va a fallar.',
    },
  ],
  conclusion: {
    title: 'Una exportación grande no es un problema de memoria, es un problema de forma',
    description:
      'Armar el informe entero antes de enviarlo funciona en el entorno de pruebas y tumba el proceso completo el día en que llega el volumen real, arrastrando rutas que no tienen nada que ver con el informe. La corrección es tratar la exportación como un flujo: cursor en la base de datos, transformación por bloques y escritura en el socket con backpressure, con cuidado explícito para el cliente que se rinde, el error en medio de la descarga, el CSV que Excel tiene que abrir y la transacción larga que no puede quedarse en el primario. Por encima de un volumen medido, la exportación se convierte en un job asíncrono que escribe directo en el almacenamiento de objetos y devuelve un enlace. Puedo revisar las exportaciones e informes de tu sistema, implementar el streaming y el flujo asíncrono y montar la prueba de carga que demuestra que la memoria ya no crece con el tamaño del archivo.',
    cta: 'Hablar sobre las exportaciones de mi sistema',
  },
  related: [
    {
      label: 'Paginación por offset en una tabla grande: cuándo la página 500 tumba la base de datos',
      to: '/blog/paginacao-offset-tabela-grande-pagina-500-derruba-banco',
    },
    {
      label: 'Backpressure en un pipeline de IA: cuando el consumidor no da abasto',
      to: '/blog/backpressure-pipeline-ia-consumidor-nao-acompanha',
    },
    {
      label: 'Arquitectura y modernización de backend',
      to: '/servicios/arquitetura-e-modernizacao-backend',
    },
  ],
};

export default {
  pt,
  en,
  es,
};
