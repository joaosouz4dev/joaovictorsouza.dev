// Conteudo do artigo: processar arquivo enviado pelo usuario sem travar a API,
// separar receber de processar com fila e resposta 202, worker com teto de
// memoria e de tempo em processo filho, inspecao de arquivo malicioso (tipo
// real, bomba de descompressao, zip slip), justica entre clientes e testes.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const naiveCode = `// Versão que trava a API: o arquivo é lido e importado dentro da requisição
import express from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import { gravarLancamento, validarLinha } from './lancamentos.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() }); // sem limite de tamanho

app.post('/importacoes', upload.single('arquivo'), async (req, res) => {
  // Descompacta o XLSX e monta a planilha inteira na memória,
  // no mesmo processo que atende todas as outras rotas da API
  const planilha = XLSX.read(req.file.buffer);
  const linhas = XLSX.utils.sheet_to_json(planilha.Sheets[planilha.SheetNames[0]]);

  for (const linha of linhas) {
    await gravarLancamento(validarLinha(linha)); // 410 mil INSERTs com a conexão HTTP aberta
  }
  res.json({ importadas: linhas.length });
});`;

const schemaCode = `CREATE TABLE importacoes (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  sha256      text NOT NULL,
  chave       text NOT NULL,          -- chave do objeto no bucket, gerada pelo servidor
  extensao    text NOT NULL,          -- '.csv' ou '.xlsx', já validada na entrada
  tamanho     bigint NOT NULL,
  status      text NOT NULL,          -- na_fila | processando | concluida | rejeitada | falhou
  motivo      text,
  linhas_ok   integer,
  linhas_erro integer,
  criada_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sha256)          -- o mesmo arquivo do mesmo cliente vira a mesma importação
);`;

const apiCode = `import express from 'express';
import multer from 'multer';
import IORedis from 'ioredis';
import pg from 'pg';
import { Queue } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import path from 'node:path';
import { autenticar } from './autenticacao.js'; // preenche req.tenantId

const MiB = 1024 * 1024;
const EXTENSOES_ACEITAS = new Set(['.csv', '.xlsx']);
const BUCKET = process.env.IMPORTACOES_BUCKET;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({});
const conexao = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const fila = new Queue('importacoes', { connection: conexao });

// Disco temporário em vez de memória, e limites que o multer aplica enquanto lê o corpo
const upload = multer({
  dest: '/tmp/recebidos',
  limits: { fileSize: 50 * MiB, files: 1, fields: 4, parts: 5 },
});

async function sha256DoArquivo(caminho) {
  const hash = createHash('sha256');
  for await (const pedaco of createReadStream(caminho)) hash.update(pedaco);
  return hash.digest('hex');
}

const buscarExistente = (tenantId, sha256) =>
  pool.query('SELECT id, status FROM importacoes WHERE tenant_id = $1 AND sha256 = $2', [
    tenantId,
    sha256,
  ]);

async function receberImportacao(req, res) {
  const arquivo = req.file;
  if (!arquivo) return res.status(400).json({ erro: 'arquivo_ausente' });

  try {
    const extensao = path.extname(arquivo.originalname).toLowerCase();
    if (!EXTENSOES_ACEITAS.has(extensao)) {
      return res.status(415).json({ erro: 'tipo_nao_aceito' });
    }

    // Duplo clique, retentativa do navegador ou reenvio no dia seguinte: mesma importação
    const sha256 = await sha256DoArquivo(arquivo.path);
    const existente = await buscarExistente(req.tenantId, sha256);
    if (existente.rowCount) return res.status(200).json(existente.rows[0]);

    // A chave é do servidor; o nome original nunca vira caminho
    const id = randomUUID();
    const chave = \`quarentena/\${req.tenantId}/\${id}\${extensao}\`;
    await new Upload({
      client: s3,
      params: { Bucket: BUCKET, Key: chave, Body: createReadStream(arquivo.path) },
    }).done();

    const inserida = await pool.query(
      \`INSERT INTO importacoes (id, tenant_id, sha256, chave, extensao, tamanho, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'na_fila')
       ON CONFLICT (tenant_id, sha256) DO NOTHING
       RETURNING id, status\`,
      [id, req.tenantId, sha256, chave, extensao, arquivo.size],
    );
    if (!inserida.rowCount) {
      // Corrida entre dois envios do mesmo arquivo: o objeto duplicado expira pela
      // regra de ciclo de vida do prefixo de quarentena
      const { rows } = await buscarExistente(req.tenantId, sha256);
      return res.status(200).json(rows[0]);
    }

    // jobId igual ao id da importação: reenfileirar a mesma importação não cria job novo
    await fila.add(
      'importar',
      { importacaoId: id },
      { jobId: id, attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
    );
    res.status(202).location(\`/importacoes/\${id}\`).json({ id, status: 'na_fila' });
  } finally {
    await unlink(arquivo.path).catch(() => {});
  }
}

const app = express();
app.post('/importacoes', autenticar, upload.single('arquivo'), receberImportacao);

app.get('/importacoes/:id', autenticar, async (req, res) => {
  if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(404).end();
  const { rows } = await pool.query(
    \`SELECT id, status, motivo, linhas_ok, linhas_erro
       FROM importacoes WHERE id = $1 AND tenant_id = $2\`,
    [req.params.id, req.tenantId],
  );
  if (!rows.length) return res.status(404).end();
  res.json(rows[0]);
});

// Limites do multer viram respostas claras, não 500
app.use((erro, req, res, next) => {
  if (erro instanceof multer.MulterError) {
    const status = erro.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ erro: erro.code });
  }
  next(erro);
});

app.listen(3000);`;

const workerCode = `import { Worker, UnrecoverableError } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { inspecionar } from './inspecionar.js';

const execFileAsync = promisify(execFile);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const s3 = new S3Client({});
const BUCKET = process.env.IMPORTACOES_BUCKET;
const conexao = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
const SCRIPT_FILHO = fileURLToPath(new URL('./importar-csv.js', import.meta.url));

const marcar = (id, status, motivo = null) =>
  pool.query('UPDATE importacoes SET status = $2, motivo = $3 WHERE id = $1', [id, status, motivo]);

// Baixa para o disco conferindo o tamanho: o objeto não pode ser maior do que o registrado
async function baixar(chave, destino, tamanhoEsperado) {
  const { Body } = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: chave }));
  let recebidos = 0;
  const conferir = new Transform({
    transform(pedaco, _codificacao, pronto) {
      recebidos += pedaco.length;
      if (recebidos > tamanhoEsperado) return pronto(new UnrecoverableError('tamanho_divergente'));
      pronto(null, pedaco);
    },
  });
  await pipeline(Body, conferir, createWriteStream(destino));
}

// O parser roda em um processo filho com teto de heap e de tempo.
// Se o arquivo estourar a memória ou travar o parser, morre o filho, não o worker.
async function processarIsolado(caminho, importacaoId) {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--max-old-space-size=384', SCRIPT_FILHO, caminho, importacaoId],
      {
        timeout: 5 * 60_000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024,
        env: { DATABASE_URL: process.env.DATABASE_URL },
      },
    );
    return JSON.parse(stdout);
  } catch (erro) {
    if (erro.killed) throw new UnrecoverableError('tempo_esgotado');
    // SIGABRT: o V8 abortou ao atingir o teto de heap. SIGKILL sem killed: o kernel matou por memória.
    if (erro.signal === 'SIGABRT' || erro.signal === 'SIGKILL') {
      throw new UnrecoverableError('memoria_esgotada');
    }
    if (erro.stderr?.includes('linhas_demais')) throw new UnrecoverableError('linhas_demais');
    throw erro; // banco fora do ar, rede: vale tentar de novo
  }
}

const worker = new Worker(
  'importacoes',
  async (job) => {
    const { rows } = await pool.query('SELECT * FROM importacoes WHERE id = $1', [
      job.data.importacaoId,
    ]);
    const importacao = rows[0];
    // Reentrega de um job já resolvido não reprocessa nada
    if (!importacao || ['concluida', 'rejeitada'].includes(importacao.status)) return;

    await marcar(importacao.id, 'processando');
    const caminho = path.join(tmpdir(), \`\${importacao.id}\${importacao.extensao}\`);
    try {
      await baixar(importacao.chave, caminho, Number(importacao.tamanho));

      const veredito = await inspecionar(caminho, importacao.extensao);
      if (!veredito.ok) {
        await marcar(importacao.id, 'rejeitada', veredito.motivo);
        throw new UnrecoverableError(veredito.motivo);
      }

      const { ok, erros } = await processarIsolado(caminho, importacao.id);
      await pool.query(
        "UPDATE importacoes SET status = 'concluida', linhas_ok = $2, linhas_erro = $3 WHERE id = $1",
        [importacao.id, ok, erros],
      );
    } finally {
      await rm(caminho, { force: true });
    }
  },
  { connection: conexao, concurrency: 2 },
);

// Falha definitiva: erro irrecuperável ou tentativas esgotadas
worker.on('failed', async (job, erro) => {
  if (!job) return;
  const definitiva =
    erro.name === 'UnrecoverableError' || job.attemptsMade >= (job.opts.attempts ?? 1);
  if (!definitiva) return;
  await pool.query(
    "UPDATE importacoes SET status = 'falhou', motivo = $2 WHERE id = $1 AND status = 'processando'",
    [job.data.importacaoId, erro.message],
  );
});`;

const childCode = `// importar-csv.js: roda no processo filho, com heap e tempo limitados pelo worker
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import pg from 'pg';

const [caminho, importacaoId] = process.argv.slice(2);
const MAX_LINHAS = 500_000;
const TAMANHO_LOTE = 1_000;

function validar(registro) {
  const data = registro.data ?? '';
  const dataValida =
    /^\\d{4}-\\d{2}-\\d{2}$/.test(data) &&
    new Date(\`\${data}T00:00:00Z\`).toISOString().slice(0, 10) === data;
  const valor = /^-?\\d{1,12}(\\.\\d{1,2})?$/.test(registro.valor ?? '') ? registro.valor : null;
  const conta = (registro.conta ?? '').trim();
  if (!dataValida || valor === null || !conta || conta.length > 40) return null;
  return { data, conta, valor };
}

const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();

let ok = 0;
let erros = 0;
let lote = [];

async function gravarLote() {
  if (!lote.length) return;
  await cliente.query(
    \`INSERT INTO lancamentos (importacao_id, linha, data, conta, valor)
     SELECT $1::uuid, * FROM unnest($2::int[], $3::date[], $4::text[], $5::numeric[])\`,
    [
      importacaoId,
      lote.map((l) => l.linha),
      lote.map((l) => l.data),
      lote.map((l) => l.conta),
      lote.map((l) => l.valor),
    ],
  );
  lote = [];
}

try {
  await cliente.query('BEGIN');
  // Uma retentativa recomeça do zero sem duplicar o que a tentativa anterior gravou
  await cliente.query('DELETE FROM lancamentos WHERE importacao_id = $1', [importacaoId]);

  const registros = createReadStream(caminho).pipe(
    parse({ columns: true, bom: true, skip_empty_lines: true, max_record_size: 64 * 1024 }),
  );
  let linha = 1; // a linha 1 é o cabeçalho
  for await (const registro of registros) {
    linha += 1;
    if (linha - 1 > MAX_LINHAS) throw new Error('linhas_demais');
    const valido = validar(registro);
    if (!valido) {
      erros += 1;
      continue;
    }
    lote.push({ linha, ...valido });
    ok += 1;
    if (lote.length >= TAMANHO_LOTE) await gravarLote();
  }
  await gravarLote();
  await cliente.query('COMMIT');
  process.stdout.write(JSON.stringify({ ok, erros }));
} catch (erro) {
  await cliente.query('ROLLBACK').catch(() => {});
  process.stderr.write(String(erro.message));
  process.exitCode = 1;
} finally {
  await cliente.end();
}`;

const inspectCode = `// inspecionar.js: verificações baratas, feitas antes de qualquer parser abrir o arquivo
import { fileTypeFromFile } from 'file-type';
import { open } from 'node:fs/promises';
import yauzl from 'yauzl';

const MiB = 1024 * 1024;
const LIMITES_ZIP = {
  entradas: 2_000,
  totalDescompactado: 200 * MiB,
  razaoMaxima: 200, // calibrada com arquivos reais dos clientes, não com um chute
};

export function inspecionarZip(caminho) {
  return new Promise((resolve) => {
    yauzl.open(caminho, { lazyEntries: true, validateEntrySizes: true }, (erroAbertura, zip) => {
      if (erroAbertura) return resolve({ ok: false, motivo: 'zip_corrompido' });
      let entradas = 0;
      let total = 0;
      const recusar = (motivo) => {
        zip.close();
        resolve({ ok: false, motivo });
      };

      zip.on('entry', (entrada) => {
        entradas += 1;
        total += entrada.uncompressedSize;
        if (entradas > LIMITES_ZIP.entradas) return recusar('entradas_demais');
        if (total > LIMITES_ZIP.totalDescompactado) return recusar('descompactado_grande_demais');
        const razao = entrada.uncompressedSize / Math.max(entrada.compressedSize, 1);
        if (entrada.uncompressedSize > MiB && razao > LIMITES_ZIP.razaoMaxima) {
          return recusar('razao_de_compressao_suspeita');
        }
        if (entrada.fileName.startsWith('/') || entrada.fileName.split('/').includes('..')) {
          return recusar('caminho_invalido');
        }
        zip.readEntry();
      });
      zip.on('end', () => resolve({ ok: true }));
      zip.on('error', () => resolve({ ok: false, motivo: 'zip_corrompido' }));
      zip.readEntry();
    });
  });
}

async function inspecionarTexto(caminho) {
  // Um CSV não tem assinatura binária: se file-type reconhece algo, é outro tipo renomeado
  if (await fileTypeFromFile(caminho)) return { ok: false, motivo: 'csv_com_conteudo_binario' };
  const arquivo = await open(caminho);
  try {
    const { buffer, bytesRead } = await arquivo.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0);
    const inicio = buffer.subarray(0, bytesRead);
    if (inicio.includes(0)) return { ok: false, motivo: 'csv_com_byte_nulo' };
    try {
      // stream: true tolera um caractere multibyte cortado no fim do trecho lido
      new TextDecoder('utf-8', { fatal: true }).decode(inicio, { stream: true });
    } catch {
      return { ok: false, motivo: 'csv_nao_e_utf8' };
    }
    return { ok: true };
  } finally {
    await arquivo.close();
  }
}

export async function inspecionar(caminho, extensao) {
  if (extensao === '.csv') return inspecionarTexto(caminho);
  if (extensao === '.xlsx') {
    const tipo = await fileTypeFromFile(caminho);
    if (tipo?.ext !== 'xlsx') return { ok: false, motivo: 'conteudo_nao_e_xlsx' };
    return inspecionarZip(caminho);
  }
  return { ok: false, motivo: 'tipo_nao_aceito' };
}`;

const fairnessCode = `const EM_ANDAMENTO_POR_CLIENTE = 5;

// Roda antes do multer: recusa sem ler os 50 MB do corpo
async function limitarPorCliente(req, res, next) {
  const { rows } = await pool.query(
    \`SELECT count(*)::int AS n FROM importacoes
      WHERE tenant_id = $1 AND status IN ('na_fila', 'processando')\`,
    [req.tenantId],
  );
  if (rows[0].n >= EM_ANDAMENTO_POR_CLIENTE) {
    return res.status(429).set('Retry-After', '60').json({ erro: 'importacoes_em_andamento' });
  }
  next();
}

app.post('/importacoes', autenticar, limitarPorCliente, upload.single('arquivo'), receberImportacao);`;

const testCode = `import { test, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import yazl from 'yazl';
import { inspecionarZip } from '../src/inspecionar.js';

const MiB = 1024 * 1024;

function* blocos(total, gerar) {
  for (let enviado = 0; enviado < total; enviado += MiB) yield gerar();
}

// Os arquivos hostis são gerados no teste, não versionados no repositório
async function criarZip(nome, entradas) {
  const pasta = await mkdtemp(path.join(tmpdir(), 'inspecao-'));
  const destino = path.join(pasta, nome);
  const zip = new yazl.ZipFile();
  for (const { caminho, bytes, aleatorio } of entradas) {
    const gerar = aleatorio ? () => randomBytes(MiB) : () => Buffer.alloc(MiB);
    zip.addReadStream(Readable.from(blocos(bytes, gerar)), caminho);
  }
  zip.end();
  await finished(zip.outputStream.pipe(createWriteStream(destino)));
  return destino;
}

test('recusa bomba de descompressão pelo total declarado', async () => {
  const arquivo = await criarZip('bomba.xlsx', [{ caminho: 'xl/sharedStrings.xml', bytes: 300 * MiB }]);
  expect(await inspecionarZip(arquivo)).toEqual({ ok: false, motivo: 'descompactado_grande_demais' });
}, 30_000);

test('recusa entrada com razão de compressão suspeita', async () => {
  const arquivo = await criarZip('razao.xlsx', [{ caminho: 'xl/worksheets/sheet1.xml', bytes: 50 * MiB }]);
  expect(await inspecionarZip(arquivo)).toEqual({ ok: false, motivo: 'razao_de_compressao_suspeita' });
}, 30_000);

test('aceita arquivo com conteúdo pouco compressível', async () => {
  const arquivo = await criarZip('normal.xlsx', [
    { caminho: 'xl/worksheets/sheet1.xml', bytes: 4 * MiB, aleatorio: true },
    { caminho: 'xl/sharedStrings.xml', bytes: 2 * MiB, aleatorio: true },
  ]);
  expect(await inspecionarZip(arquivo)).toEqual({ ok: true });
});`;

const flowDiagramPt = `Antes: tudo dentro da requisição
  navegador --POST 38 MB--> API: lê, descompacta, valida e grava 410 mil linhas --> 200 depois de 3 min
                            (o mesmo processo atende todas as outras rotas)

Depois: receber e processar são etapas diferentes
  navegador --POST--> API: limite de tamanho, hash, objeto em quarentena --> 202 + Location
                       |
                       +--> fila (jobId = id da importação)
                              |
                              v
                       worker (concorrência 2 por instância)
                         1. baixa e confere o tamanho
                         2. inspeciona: tipo real, zip, texto
                         3. processo filho: heap de 384 MB, 5 min, leitura em streaming
                         4. grava em lotes, em uma transação
                              |
                              v
                       status: concluida | rejeitada | falhou
  navegador --GET /importacoes/:id (2 s, depois 10 s)--> status e contagem de linhas`;

const flowDiagramEn = `Before: everything inside the request
  browser --POST 38 MB--> API: reads, unzips, validates and writes 410k rows --> 200 after 3 min
                          (the same process serves every other route)

After: receiving and processing are different steps
  browser --POST--> API: size limit, hash, object in quarantine --> 202 + Location
                     |
                     +--> queue (jobId = import id)
                            |
                            v
                     worker (concurrency 2 per instance)
                       1. downloads and checks the size
                       2. inspects: real type, zip, text
                       3. child process: 384 MB heap, 5 min, streaming read
                       4. writes in batches, in one transaction
                            |
                            v
                     status: concluida | rejeitada | falhou
  browser --GET /importacoes/:id (2 s, then 10 s)--> status and row counts`;

const flowDiagramEs = `Antes: todo dentro de la petición
  navegador --POST 38 MB--> API: lee, descomprime, valida y graba 410 mil filas --> 200 después de 3 min
                            (el mismo proceso atiende todas las demás rutas)

Después: recibir y procesar son etapas distintas
  navegador --POST--> API: límite de tamaño, hash, objeto en cuarentena --> 202 + Location
                       |
                       +--> cola (jobId = id de la importación)
                              |
                              v
                       worker (concurrencia 2 por instancia)
                         1. descarga y verifica el tamaño
                         2. inspecciona: tipo real, zip, texto
                         3. proceso hijo: heap de 384 MB, 5 min, lectura en streaming
                         4. graba por lotes, en una transacción
                              |
                              v
                       estado: concluida | rejeitada | falhou
  navegador --GET /importacoes/:id (2 s, luego 10 s)--> estado y conteo de filas`;

const pt = {
  intro:
    'Um sistema de gestão para escritórios de contabilidade permitia que cada cliente importasse lançamentos por planilha: o usuário escolhia um CSV ou XLSX exportado do banco ou do ERP, clicava em importar e esperava a tela confirmar. Funcionou por dois anos. No quinto dia útil de um mês de fechamento, um escritório grande enviou uma planilha de 38 MB com 410 mil linhas, e o p95 de toda a API, não só da importação, subiu de 180 milissegundos para 14 segundos. O pod que recebeu o arquivo passou do limite de memória e foi encerrado pelo kernel, o usuário clicou de novo, o arquivo caiu em outro pod e a cena se repetiu três vezes em vinte minutos. Duas semanas depois, um teste de intrusão contratado pelo maior cliente mostrou que um XLSX de 220 KB, montado para descompactar em 3,8 GB, derrubava qualquer instância com uma única requisição. Nenhum dos dois casos era um bug de lógica: a importação estava correta, só estava no lugar errado. Este artigo mostra por que processar o arquivo dentro da requisição derruba a API inteira, como separar receber de processar com fila e resposta 202, como dar ao worker um teto de memória e de tempo que não depende de o arquivo se comportar, o que verificar antes de abrir um arquivo que pode ser hostil, como impedir que um cliente ocupe a fila de todos e como provar com testes que esses limites seguram.',
  sections: [
    {
      title: 'Por que processar o arquivo dentro da requisição derruba a API inteira',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A versão que quase todo sistema começa usando cabe em quinze linhas: o multer guarda o arquivo em memória, uma biblioteca de planilhas lê tudo e um laço grava cada linha. Com os arquivos de homologação, de algumas centenas de linhas, a resposta vem em menos de um segundo e ninguém tem motivo para desconfiar.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'O primeiro problema é de CPU. No Node.js, descompactar um XLSX e converter o XML em objetos é trabalho síncrono, executado na mesma thread que atende todas as rotas. Enquanto XLSX.read processa 38 MB, o event loop não roda mais nada: o login, a listagem de clientes e o health check daquele pod esperam na fila do sistema operacional. É por isso que o p95 da API inteira subiu, e não só o da importação. Em runtimes com pool de threads, como Java ou Go, o mecanismo é outro, mas o efeito é parecido: algumas importações pesadas ocupam threads, conexões com o banco e memória que o resto do serviço compartilha.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo é de memória, e ele é sempre maior do que o tamanho do arquivo. Um XLSX é um zip de arquivos XML, e cada etapa da leitura cria uma nova representação do mesmo conteúdo. A tabela mostra o que foi medido no incidente, com a planilha de 38 MB.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Memória aproximada', 'Por que cresce'],
          rows: [
            ['Arquivo recebido em buffer pelo memoryStorage', '38 MB', 'O corpo inteiro fica no heap antes de qualquer validação'],
            ['XML descompactado das planilhas', 'Cerca de 310 MB', 'A taxa de compressão de XML repetitivo passa de 8 para 1'],
            ['Estrutura da planilha montada pela biblioteca', 'Cerca de 900 MB', 'Cada célula vira um objeto com tipo, valor e formatação'],
            ['Array gerado por sheet_to_json', 'Cerca de 420 MB', 'Mais um objeto por linha, com uma string por coluna'],
            ['Pico no processo', 'Mais de 1,6 GB', 'Tudo coexiste até o fim do handler; o limite do pod era 1,5 GiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro é de tempo e de repetição. A requisição levava cerca de três minutos, e o balanceador cortava conexões ociosas em 60 segundos. O usuário via um erro, clicava de novo, e a segunda tentativa começava enquanto a primeira ainda gravava linhas em outro pod, sem nada que impedisse lançamentos duplicados. A falha parecia um travamento para quem estava na tela e era, na verdade, trabalho dobrado no servidor. Aumentar timeouts, memória ou réplicas só move o ponto de ruptura para o próximo arquivo maior. A correção é mudar a forma: a requisição aceita e guarda o arquivo, e o trabalho pesado acontece em outro lugar, com limites próprios.',
        },
      ],
    },
    {
      title: 'Separar receber de processar: aceitar, guardar e responder 202',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Na nova forma, a API faz apenas o que é barato e previsível: aplica limites de tamanho enquanto lê o corpo, grava em disco temporário em vez de memória, calcula o hash, guarda o arquivo em um prefixo de quarentena no bucket com uma chave gerada pelo servidor, registra a importação, enfileira um job e responde 202 com o endereço onde o status pode ser consultado. O custo dessa requisição é de entrada e saída, cresce de forma linear com o tamanho do arquivo e a memória fica constante, porque nada é montado no heap.',
        },
        {
          type: 'diagram',
          value: flowDiagramPt,
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'list',
          items: [
            'O limite de tamanho precisa existir em todas as camadas. O multer interrompe a leitura no primeiro byte acima de 50 MB e devolve 413, mas o proxy ou o balanceador deve ter um limite parecido, para que um corpo de 5 GB não chegue nem a ocupar um processo da aplicação.',
            'A chave do objeto é gerada pelo servidor. O nome original serve apenas para exibição e nunca vira caminho de arquivo, o que elimina de uma vez sobrescrita de objetos e travessia de diretório com nomes como ../../config.',
            'O hash torna o envio idempotente. Duplo clique, retentativa do navegador e reenvio do mesmo arquivo no dia seguinte devolvem a mesma importação, e a restrição única no banco resolve a corrida entre dois envios simultâneos.',
            'A ordem é objeto, linha, job. Se o enfileiramento falhar depois do INSERT, a importação fica na_fila sem job; um processo de reconciliação reenfileira importações nesse estado há mais de cinco minutos, e o jobId igual ao id da importação torna o reenvio inofensivo.',
            'A extensão é só a primeira triagem, e é barata. Ela não prova nada sobre o conteúdo, que é verificado no worker antes de qualquer parser abrir o arquivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'O 202 muda o contrato com a interface, e essa é a parte que costuma gerar resistência. A tela passa a mostrar a importação como recebida e consulta o status no endereço do cabeçalho Location, com intervalo crescente: a cada 2 segundos no início e a cada 10 depois do primeiro minuto. O ganho é que a resposta deixa de depender do tamanho do arquivo. Um envio de 50 MB responde em segundos, o usuário pode fechar a aba, e o resultado continua disponível na lista de importações, com a contagem de linhas aceitas e recusadas.',
        },
      ],
    },
    {
      title: 'O worker com teto: processo isolado, tempo e memória limitados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mover o processamento para um worker resolve a latência da API, mas não resolve o arquivo hostil. Sem limites, a bomba de 220 KB derruba o worker em vez da API. Pior: como o job não foi concluído, a fila o entrega de novo a outra instância, que também morre, e um único arquivo derruba a frota inteira de workers, um de cada vez. Por isso o worker precisa de tetos que não dependem de o arquivo se comportar bem, e de uma regra clara sobre o que vale tentar de novo.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'paragraph',
          value:
            'O processo filho lê o CSV em streaming, valida cada linha e grava em lotes de mil com unnest, tudo dentro de uma transação que começa apagando o que uma tentativa anterior tenha gravado. A memória fica proporcional ao lote, não ao arquivo, e uma retentativa nunca duplica lançamentos. A versão para XLSX troca o csv-parse pelo leitor em streaming do ExcelJS e mantém o resto igual.',
        },
        {
          type: 'code',
          value: childCode,
        },
        {
          type: 'table',
          columns: ['Limite', 'Onde é aplicado', 'Quando estoura', 'Tentar de novo?'],
          rows: [
            ['Tamanho do arquivo', 'Proxy, multer na API e conferência no download', '413 na API ou rejeitada no worker', 'Não: o mesmo arquivo tem o mesmo tamanho'],
            ['Heap do parser', '--max-old-space-size no processo filho', 'O V8 aborta o filho e o job vira memoria_esgotada', 'Não: o resultado é determinístico'],
            ['Memória total do contêiner', 'Limite de memória do pod', 'O kernel mata o processo que mais consome, normalmente o filho', 'Não, e o limite precisa ser dimensionado'],
            ['Tempo de processamento', 'timeout do execFile com SIGKILL', 'tempo_esgotado', 'Não: o parser que travou com um arquivo trava de novo'],
            ['Quantidade de linhas', 'Contador no processo filho', 'linhas_demais, com mensagem ao usuário', 'Não: é regra de produto'],
            ['Tamanho de um registro', 'max_record_size do csv-parse', 'Erro de leitura no filho', 'Não: uma linha de 64 KB em um extrato é defeito ou ataque'],
            ['Banco ou rede indisponível', 'Erro comum no filho ou no worker', 'O job volta para a fila com backoff', 'Sim: até 3 tentativas'],
          ],
        },
        {
          type: 'list',
          items: [
            'Processo filho e não worker_threads, neste caso. Um worker thread com resourceLimits também limita o heap e é mais leve, e serve bem para parsers escritos só em JavaScript. O processo separado isola também a memória nativa e uma eventual falha de biblioteca nativa, e o SIGKILL no fim do prazo é garantido, sem depender de o código cooperar.',
            'O teto de heap não é o teto de memória. --max-old-space-size limita o heap do V8, mas Buffers e alocações nativas ficam fora dele. O limite do contêiner é a última barreira e precisa ser calculado: concorrência vezes o teto do filho com margem para memória nativa, mais o consumo do próprio worker. Com concorrência 2 e heap de 384 MB, um limite de 1,5 GiB deixa folga.',
            'Classificar a falha é o que impede a cascata. UnrecoverableError faz o BullMQ mover o job direto para falhos, sem as três tentativas. Repetir um arquivo que estourou memória só derruba mais dois filhos e atrasa a resposta ao usuário. Repetir uma queda do banco faz sentido, porque ela passa.',
            'Para importações muito grandes, a transação longa vira um problema próprio: segura locks e infla o WAL. A alternativa é gravar em uma tabela de staging e promover para a tabela final em uma única operação no fim, mantendo a mesma garantia de tudo ou nada.',
          ],
        },
      ],
    },
    {
      title: 'Arquivo malicioso: o que verificar antes de abrir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um arquivo enviado pelo usuário é entrada controlada por quem envia, e o parser que vai abri-lo é um dos códigos mais complexos do sistema. A estratégia é verificar o que é barato antes de chamar o que é caro, em camadas, sabendo que nenhuma verificação isolada é suficiente. O módulo abaixo roda no worker depois do download e antes do processo filho.',
        },
        {
          type: 'code',
          value: inspectCode,
        },
        {
          type: 'table',
          columns: ['Ameaça', 'Como aparece', 'Defesa'],
          rows: [
            ['Tipo falso', 'Executável renomeado para .csv, HTML enviado como .xlsx', 'Assinatura pelos primeiros bytes; CSV sem assinatura binária, sem byte nulo e em UTF-8 válido'],
            ['Bomba de descompressão', 'XLSX de 220 KB com 3,8 GB de XML repetitivo', 'Soma dos tamanhos declarados, razão de compressão, quantidade de entradas e teto de heap no filho'],
            ['Zip slip', 'Entrada com nome ../../app/config.js', 'Nunca extrair para o disco; se extrair, recusar caminhos absolutos e com ..'],
            ['Entidades XML', 'DOCTYPE com entidade externa ou expansão em cascata', 'Parser que não resolve entidades externas nem expande DTD; recusar DOCTYPE em XLSX'],
            ['Injeção de fórmula', 'Célula começando com =, +, - ou @ que vira fórmula quando alguém abre a exportação', 'Neutralizar com apóstrofo nas células de texto ao exportar, não ao importar'],
            ['Malware conhecido', 'Anexo que depois é baixado por outros usuários', 'ClamAV em serviço separado, assinaturas atualizadas e resultado gravado no status'],
            ['Imagem bomba', 'PNG de 50 KB declarando 50.000 por 50.000 pixels', 'Limitar pixels antes de decodificar, como faz o limitInputPixels do sharp'],
          ],
        },
        {
          type: 'list',
          items: [
            'Os tamanhos do diretório central de um zip são declarados por quem montou o arquivo e podem mentir. A inspeção barra o caso comum em milissegundos, sem descompactar nada; o arquivo forjado com tamanhos falsos passa por ela e é barrado pelo teto de heap do filho. É defesa em camadas, não uma verificação definitiva.',
            'O arquivo fica em quarentena até ser aprovado. Só depois da inspeção e do processamento ele é copiado para o prefixo definitivo ou disponibilizado para outros usuários, e nunca é servido com o Content-Type informado pelo cliente: use Content-Disposition attachment e X-Content-Type-Options nosniff.',
            'O antivírus também é um parser. Rode o clamd em um contêiner próprio, com StreamMaxLength, MaxScanSize e MaxFileSize configurados, e trate o tempo esgotado do antivírus como rejeição, não como aprovação.',
            'A biblioteca também é superfície de ataque. A versão do pacote xlsx publicada no registro do npm parou na 0.18.5 e tem vulnerabilidades conhecidas de prototype pollution e de ReDoS; o código ingênuo do início estava exposto a elas sem ninguém saber. Fixe versões, acompanhe alertas de dependência e prefira bibliotecas com leitura em streaming.',
          ],
        },
      ],
    },
    {
      title: 'Um cliente não pode ocupar a fila de todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Com a API protegida e os workers limitados, o incidente seguinte foi de outro tipo. No fechamento do mês seguinte, um escritório enviou 60 planilhas em sequência. A fila era FIFO, com três workers de concorrência 2, e a planilha de 200 KB de outro cliente esperou 25 minutos atrás das 60. Nada caiu e nenhum limite estourou, mas para quem esperava o sistema estava fora do ar. Fila compartilhada sem regra de justiça transforma o maior cliente no gargalo de todos.',
        },
        {
          type: 'code',
          value: fairnessCode,
        },
        {
          type: 'paragraph',
          value:
            'O teto de importações em andamento por cliente é a defesa mais barata e roda antes do multer, então recusa sem ler o corpo. Ele é um limite suave: duas requisições simultâneas podem passar pela contagem ao mesmo tempo, e isso é aceitável, porque o objetivo é impedir sessenta, não garantir exatamente cinco. Ele não resolve tudo, e as outras estratégias se combinam com ele.',
        },
        {
          type: 'table',
          columns: ['Estratégia', 'Como funciona', 'Quando usar', 'Custo'],
          rows: [
            ['Teto por cliente', 'A API conta importações na_fila e processando do cliente e responde 429 com Retry-After', 'Sempre: é barato e protege contra o pior caso', 'Quem envia lotes grandes precisa esperar ou enviar aos poucos'],
            ['Filas por classe de tamanho', 'Arquivos até 2 MB em uma fila, maiores em outra, cada uma com workers próprios', 'Quando arquivos pequenos são maioria e precisam de resposta rápida', 'Duas filas para monitorar e dimensionar'],
            ['Prioridade por carga recente', 'Job de cliente com muitas importações na última hora entra com prioridade menor', 'Quando o volume por cliente varia muito ao longo do mês', 'Prioridade não é garantia, e jobs de baixa prioridade podem envelhecer'],
            ['Fila no PostgreSQL com escolha por cliente', 'O worker pega o job do cliente com menos itens em andamento, usando FOR UPDATE SKIP LOCKED', 'Quando a justiça precisa ser exata', 'Consulta mais cara e mais código próprio'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'A métrica que denuncia esse problema não é o tamanho da fila, é a idade do job mais antigo, separada por classe de tamanho, e o tempo de espera p95 por cliente. Uma fila de 60 jobs pode estar saudável; um job de 200 KB esperando há 25 minutos nunca está. Acompanhe também as rejeições por motivo, porque um aumento súbito de razao_de_compressao_suspeita é sinal de ataque, e um aumento de linhas_demais é sinal de que a regra de produto ficou pequena para os clientes reais.',
        },
      ],
    },
    {
      title: 'Como provar que os limites seguram',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um teste que importa um CSV de dez linhas e confere o resultado não prova nada sobre os incidentes. O que precisa ser provado é que o arquivo hostil é recusado antes de abrir, que o parser que estoura memória morre sozinho e não leva o worker, e que a API continua respondendo enquanto importações pesadas acontecem. Os arquivos hostis devem ser gerados no próprio teste, e não versionados: uma bomba de descompressão no repositório é um risco para qualquer ferramenta que o indexe.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Cenário', 'Como simular', 'Resultado esperado'],
          rows: [
            ['Bomba de descompressão', 'Zip com 300 MiB de zeros gerado no teste', 'rejeitada com descompactado_grande_demais, sem processo filho'],
            ['Razão de compressão suspeita', 'Entrada única com 50 MiB de zeros', 'rejeitada com razao_de_compressao_suspeita'],
            ['Parser que estoura memória', 'Teto de heap de 64 MB no ambiente de teste e uma planilha que precisa de mais', 'falhou com memoria_esgotada, worker vivo, job não repetido'],
            ['Parser travado', 'Timeout de 1 segundo no teste e um CSV de 2 milhões de linhas', 'falhou com tempo_esgotado em cerca de 1 segundo'],
            ['Duplo clique', 'Dois POST simultâneos com o mesmo arquivo', 'A mesma importação nas duas respostas e um único job'],
            ['API durante importação pesada', 'Teste de carga nas rotas comuns com dez importações de 50 MB em andamento', 'p95 das rotas comuns igual ao da linha de base'],
            ['Cliente com 60 arquivos', '60 envios seguidos do mesmo cliente', 'A partir do sexto, 429 com Retry-After; arquivo de outro cliente concluído em segundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'No sistema contábil, os números depois da mudança contam a história. No fechamento seguinte, o p95 da API ficou em 190 milissegundos com importações pesadas em andamento. O arquivo do teste de intrusão passou a ser recusado em 40 milissegundos pela inspeção, sem que nenhum parser fosse chamado. A maior importação levou três minutos em segundo plano, e o tempo de espera p95 de arquivos pequenos ficou abaixo de dez segundos mesmo com o escritório das 60 planilhas ativo. O código de importação, aquele que valida e grava as linhas, praticamente não mudou: o que mudou foi onde ele roda e quais limites o cercam.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Posso usar uma função serverless acionada pelo upload no bucket em vez de fila e worker?',
      answer:
        'Pode, e é uma boa forma de separar receber de processar: o cliente envia direto ao bucket com URL pré-assinada e o evento de criação do objeto aciona a função. Os mesmos limites continuam necessários, só mudam de nome. A memória configurada da função é o teto de memória, o timeout dela é o teto de tempo e a concorrência reservada é o que impede mil arquivos de dispararem mil execuções contra o banco. A inspeção antes do parser continua obrigatória, e eventos de armazenamento podem ser entregues mais de uma vez, então a idempotência pelo hash ou pela chave do objeto também continua.',
    },
    {
      question: 'Um antivírus não resolve o problema do arquivo malicioso?',
      answer:
        'Resolve uma parte. O ClamAV e ferramentas parecidas detectam malware conhecido por assinatura, o que importa quando o arquivo vai ser baixado por outras pessoas. Eles não detectam uma bomba de descompressão feita sob medida, uma entidade XML que expande dentro do seu parser, uma fórmula maliciosa em uma célula de texto ou um CSV válido com 40 milhões de linhas. Essas ameaças atacam o seu processamento, não o computador de quem baixa, e por isso a defesa está nos limites e na inspeção do formato. Use o antivírus como mais uma camada, isolado e com limites próprios.',
    },
    {
      question: 'Como avisar o usuário que a importação terminou sem consulta agressiva ao servidor?',
      answer:
        'A consulta ao endereço de status com intervalo crescente é simples, funciona atrás de qualquer proxy e custa pouco, porque a rota faz uma leitura por chave primária. Se a tela precisa reagir na hora, Server-Sent Events é o próximo passo natural, com a consulta como alternativa quando a conexão cai. Para importações longas, um aviso por e-mail ou notificação no sistema evita que o usuário precise ficar na tela. Em todos os casos, o registro no banco continua sendo a fonte da verdade: o aviso informa, e a tela confirma lendo o status.',
    },
  ],
  conclusion: {
    title: 'O arquivo do usuário não pode decidir quanto recurso a sua API usa',
    description:
      'Processar um arquivo dentro da requisição entrega ao usuário o controle sobre CPU, memória e tempo do processo que atende todo o sistema, e funciona apenas enquanto os arquivos forem pequenos e bem-intencionados. A correção não é aumentar limites, é mudar a forma: a API aceita, guarda em quarentena e responde 202; o worker inspeciona antes de abrir e processa em um processo filho com teto de heap e de tempo; falhas determinísticas não são repetidas; e cada cliente tem um teto que impede que ele ocupe a fila de todos. Com testes que geram arquivos hostis e medem a latência da API durante importações pesadas, esses limites deixam de ser suposição. Posso revisar como o seu sistema recebe e processa arquivos, separar a importação da API e montar a inspeção, os limites e os testes que mantêm o serviço de pé no dia do maior arquivo.',
    cta: 'Falar sobre o processamento de arquivos do meu sistema',
  },
  related: [
    {
      label: 'Upload grande que falha nos 99%: envio retomável em partes com URL pré-assinada',
      to: '/blog/upload-grande-que-falha-nos-99-envio-retomavel-em-partes-com-url-pre-assinada',
    },
    {
      label: 'Fila morta que ninguém lê: transformar mensagem descartada em correção de verdade',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'A management system for accounting firms let each customer import ledger entries from a spreadsheet: the user picked a CSV or XLSX exported from the bank or the ERP, clicked import and waited for the screen to confirm. It worked for two years. On the fifth business day of a month-end close, a large firm uploaded a 38 MB spreadsheet with 410 thousand rows, and the p95 of the entire API, not just the import, went from 180 milliseconds to 14 seconds. The pod that received the file went over its memory limit and was killed by the kernel, the user clicked again, the file landed on another pod and the scene repeated three times in twenty minutes. Two weeks later, a penetration test commissioned by the largest customer showed that a 220 KB XLSX, crafted to decompress into 3.8 GB, took down any instance with a single request. Neither case was a logic bug: the import was correct, it was just in the wrong place. This article shows why processing the file inside the request takes down the whole API, how to separate receiving from processing with a queue and a 202 response, how to give the worker memory and time ceilings that do not depend on the file behaving, what to check before opening a file that may be hostile, how to stop one customer from taking over everyone\'s queue, and how to prove with tests that those limits hold.',
  sections: [
    {
      title: 'Why processing the file inside the request takes down the whole API',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The version almost every system starts with fits in fifteen lines: multer keeps the file in memory, a spreadsheet library reads all of it and a loop writes each row. With staging files of a few hundred rows, the response comes back in under a second and nobody has a reason to be suspicious.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'The first problem is CPU. In Node.js, unzipping an XLSX and turning the XML into objects is synchronous work, executed on the same thread that serves every route. While XLSX.read processes 38 MB, the event loop runs nothing else: login, the customer list and the health check of that pod all wait in the operating system queue. That is why the p95 of the entire API went up, not only the import. In runtimes with thread pools, such as Java or Go, the mechanism is different but the effect is similar: a few heavy imports hold threads, database connections and memory that the rest of the service shares.',
        },
        {
          type: 'paragraph',
          value:
            'The second is memory, and it is always larger than the file size. An XLSX is a zip of XML files, and each stage of reading creates a new representation of the same content. The table shows what was measured during the incident, with the 38 MB spreadsheet.',
        },
        {
          type: 'table',
          columns: ['Stage', 'Approximate memory', 'Why it grows'],
          rows: [
            ['File received into a buffer by memoryStorage', '38 MB', 'The whole body sits on the heap before any validation'],
            ['Unzipped worksheet XML', 'About 310 MB', 'Repetitive XML compresses at better than 8 to 1'],
            ['Workbook structure built by the library', 'About 900 MB', 'Each cell becomes an object with type, value and formatting'],
            ['Array produced by sheet_to_json', 'About 420 MB', 'One more object per row, with one string per column'],
            ['Peak in the process', 'Over 1.6 GB', 'Everything coexists until the handler ends; the pod limit was 1.5 GiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third is time and repetition. The request took about three minutes, and the load balancer cut idle connections at 60 seconds. The user saw an error, clicked again, and the second attempt started while the first one was still writing rows on another pod, with nothing preventing duplicate entries. To the person on the screen the failure looked like a freeze; on the server it was double the work. Raising timeouts, memory or replicas only moves the breaking point to the next larger file. The fix is to change the shape: the request accepts and stores the file, and the heavy work happens somewhere else, with its own limits.',
        },
      ],
    },
    {
      title: 'Separating receiving from processing: accept, store and respond 202',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In the new shape, the API does only what is cheap and predictable: it enforces size limits while reading the body, writes to temporary disk instead of memory, computes the hash, stores the file under a quarantine prefix in the bucket with a server-generated key, records the import, enqueues a job and responds 202 with the address where the status can be checked. The cost of this request is input and output, it grows linearly with file size and memory stays flat, because nothing is built on the heap.',
        },
        {
          type: 'diagram',
          value: flowDiagramEn,
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'list',
          items: [
            'The size limit has to exist at every layer. Multer stops reading at the first byte above 50 MB and returns 413, but the proxy or load balancer should have a similar limit, so that a 5 GB body never even occupies an application process.',
            'The object key is generated by the server. The original name is only for display and never becomes a file path, which removes object overwrites and directory traversal with names like ../../config in one move.',
            'The hash makes the upload idempotent. A double click, a browser retry and the same file sent again the next day return the same import, and the unique constraint in the database settles the race between two simultaneous uploads.',
            'The order is object, row, job. If enqueueing fails after the INSERT, the import stays na_fila without a job; a reconciliation process re-enqueues imports that have been in that state for more than five minutes, and a jobId equal to the import id makes the resend harmless.',
            'The extension is only the first screening, and it is cheap. It proves nothing about the content, which is checked in the worker before any parser opens the file.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The 202 changes the contract with the interface, and that is the part that usually meets resistance. The screen now shows the import as received and polls the status at the address in the Location header, with a growing interval: every 2 seconds at first and every 10 after the first minute. The gain is that the response no longer depends on file size. A 50 MB upload responds in seconds, the user can close the tab, and the result stays available in the import list, with the count of accepted and rejected rows.',
        },
      ],
    },
    {
      title: 'A worker with ceilings: isolated process, bounded time and memory',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Moving processing to a worker fixes the API latency, but it does not fix the hostile file. Without limits, the 220 KB bomb takes down the worker instead of the API. Worse: since the job did not finish, the queue delivers it again to another instance, which also dies, and a single file takes down the whole worker fleet, one instance at a time. That is why the worker needs ceilings that do not depend on the file behaving well, and a clear rule about what is worth retrying.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'paragraph',
          value:
            'The child process reads the CSV as a stream, validates each row and writes batches of a thousand with unnest, all inside a transaction that starts by deleting whatever a previous attempt may have written. Memory stays proportional to the batch, not to the file, and a retry never duplicates entries. The XLSX version swaps csv-parse for the ExcelJS streaming reader and keeps everything else the same.',
        },
        {
          type: 'code',
          value: childCode,
        },
        {
          type: 'table',
          columns: ['Limit', 'Where it is enforced', 'When it is exceeded', 'Retry?'],
          rows: [
            ['File size', 'Proxy, multer in the API and the check during download', '413 in the API or rejected in the worker', 'No: the same file has the same size'],
            ['Parser heap', '--max-old-space-size in the child process', 'V8 aborts the child and the job becomes memoria_esgotada', 'No: the outcome is deterministic'],
            ['Total container memory', 'Pod memory limit', 'The kernel kills the largest consumer, usually the child', 'No, and the limit has to be sized'],
            ['Processing time', 'execFile timeout with SIGKILL', 'tempo_esgotado', 'No: a parser that hung on a file will hang again'],
            ['Row count', 'Counter in the child process', 'linhas_demais, with a message to the user', 'No: it is a product rule'],
            ['Record size', 'csv-parse max_record_size', 'Read error in the child', 'No: a 64 KB line in a bank statement is a defect or an attack'],
            ['Database or network unavailable', 'Ordinary error in the child or the worker', 'The job goes back to the queue with backoff', 'Yes: up to 3 attempts'],
          ],
        },
        {
          type: 'list',
          items: [
            'A child process rather than worker_threads, in this case. A worker thread with resourceLimits also caps the heap and is lighter, and it works well for parsers written purely in JavaScript. A separate process also isolates native memory and a possible crash in a native library, and the SIGKILL at the deadline is guaranteed, without relying on the code to cooperate.',
            'The heap ceiling is not the memory ceiling. --max-old-space-size limits the V8 heap, but Buffers and native allocations live outside it. The container limit is the last barrier and has to be calculated: concurrency times the child ceiling with a margin for native memory, plus what the worker itself uses. With concurrency 2 and a 384 MB heap, a 1.5 GiB limit leaves headroom.',
            'Classifying the failure is what stops the cascade. UnrecoverableError makes BullMQ move the job straight to failed, without the three attempts. Retrying a file that blew the memory only kills two more children and delays the answer to the user. Retrying a database outage makes sense, because it passes.',
            'For very large imports, the long transaction becomes a problem of its own: it holds locks and inflates the WAL. The alternative is to write into a staging table and promote to the final table in a single operation at the end, keeping the same all-or-nothing guarantee.',
          ],
        },
      ],
    },
    {
      title: 'Malicious files: what to check before opening',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A file uploaded by a user is input controlled by the sender, and the parser that will open it is one of the most complex pieces of code in the system. The strategy is to check what is cheap before calling what is expensive, in layers, knowing that no single check is enough. The module below runs in the worker after the download and before the child process.',
        },
        {
          type: 'code',
          value: inspectCode,
        },
        {
          type: 'table',
          columns: ['Threat', 'How it shows up', 'Defense'],
          rows: [
            ['Fake type', 'Executable renamed to .csv, HTML sent as .xlsx', 'Signature from the first bytes; CSV with no binary signature, no null byte and valid UTF-8'],
            ['Decompression bomb', '220 KB XLSX with 3.8 GB of repetitive XML', 'Sum of declared sizes, compression ratio, entry count and heap ceiling in the child'],
            ['Zip slip', 'Entry named ../../app/config.js', 'Never extract to disk; if you must, reject absolute paths and paths with ..'],
            ['XML entities', 'DOCTYPE with an external entity or cascading expansion', 'A parser that does not resolve external entities or expand DTDs; reject DOCTYPE in XLSX'],
            ['Formula injection', 'Cell starting with =, +, - or @ that becomes a formula when someone opens the export', 'Neutralize text cells with an apostrophe on export, not on import'],
            ['Known malware', 'Attachment later downloaded by other users', 'ClamAV as a separate service, updated signatures and the result stored in the status'],
            ['Image bomb', '50 KB PNG declaring 50,000 by 50,000 pixels', 'Cap pixels before decoding, as sharp does with limitInputPixels'],
          ],
        },
        {
          type: 'list',
          items: [
            'The sizes in a zip central directory are declared by whoever built the file and can lie. The inspection stops the common case in milliseconds, without decompressing anything; a file forged with fake sizes gets past it and is stopped by the heap ceiling in the child. This is defense in depth, not a definitive check.',
            'The file stays in quarantine until it is approved. Only after inspection and processing is it copied to the final prefix or made available to other users, and it is never served with the Content-Type the client declared: use Content-Disposition attachment and X-Content-Type-Options nosniff.',
            'The antivirus is a parser too. Run clamd in its own container, with StreamMaxLength, MaxScanSize and MaxFileSize configured, and treat an antivirus timeout as a rejection, not an approval.',
            'The library is attack surface as well. The xlsx package published on the npm registry stopped at 0.18.5 and has known prototype pollution and ReDoS vulnerabilities; the naive code at the start was exposed to them without anyone knowing. Pin versions, follow dependency alerts and prefer libraries with streaming readers.',
          ],
        },
      ],
    },
    {
      title: 'One customer cannot take over everyone\'s queue',
      blocks: [
        {
          type: 'paragraph',
          value:
            'With the API protected and the workers bounded, the next incident was of a different kind. At the following month-end close, one firm uploaded 60 spreadsheets in a row. The queue was FIFO, with three workers at concurrency 2, and another customer\'s 200 KB spreadsheet waited 25 minutes behind the 60. Nothing crashed and no limit was exceeded, but for whoever was waiting the system was down. A shared queue without a fairness rule turns the largest customer into everyone\'s bottleneck.',
        },
        {
          type: 'code',
          value: fairnessCode,
        },
        {
          type: 'paragraph',
          value:
            'A cap on in-flight imports per customer is the cheapest defense, and it runs before multer, so it rejects without reading the body. It is a soft limit: two simultaneous requests may pass the count at the same time, and that is acceptable, because the goal is to prevent sixty, not to guarantee exactly five. It does not solve everything, and the other strategies combine with it.',
        },
        {
          type: 'table',
          columns: ['Strategy', 'How it works', 'When to use it', 'Cost'],
          rows: [
            ['Per-customer cap', 'The API counts the customer\'s na_fila and processando imports and responds 429 with Retry-After', 'Always: it is cheap and protects against the worst case', 'Customers sending large batches have to wait or send gradually'],
            ['Queues by size class', 'Files up to 2 MB in one queue, larger ones in another, each with its own workers', 'When small files are the majority and need a fast answer', 'Two queues to monitor and size'],
            ['Priority by recent load', 'Jobs from a customer with many imports in the last hour get lower priority', 'When per-customer volume varies a lot over the month', 'Priority is not a guarantee, and low-priority jobs can age'],
            ['PostgreSQL queue with per-customer selection', 'The worker takes the job of the customer with the fewest items in flight, using FOR UPDATE SKIP LOCKED', 'When fairness has to be exact', 'A more expensive query and more in-house code'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The metric that exposes this problem is not queue length, it is the age of the oldest job, split by size class, and the p95 wait time per customer. A queue of 60 jobs can be healthy; a 200 KB job waiting for 25 minutes never is. Also track rejections by reason, because a sudden rise in razao_de_compressao_suspeita signals an attack, and a rise in linhas_demais signals that the product rule has become too small for real customers.',
        },
      ],
    },
    {
      title: 'How to prove the limits hold',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A test that imports a ten-row CSV and checks the result proves nothing about the incidents. What has to be proven is that the hostile file is rejected before it is opened, that a parser that blows the memory dies alone without taking the worker with it, and that the API keeps responding while heavy imports run. Hostile files should be generated by the test itself, not committed: a decompression bomb in the repository is a hazard for any tool that indexes it.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Scenario', 'How to simulate', 'Expected result'],
          rows: [
            ['Decompression bomb', 'Zip with 300 MiB of zeros generated in the test', 'rejeitada with descompactado_grande_demais, no child process'],
            ['Suspicious compression ratio', 'Single entry with 50 MiB of zeros', 'rejeitada with razao_de_compressao_suspeita'],
            ['Parser that blows the memory', '64 MB heap ceiling in the test environment and a spreadsheet that needs more', 'falhou with memoria_esgotada, worker alive, job not retried'],
            ['Hung parser', '1 second timeout in the test and a CSV with 2 million rows', 'falhou with tempo_esgotado in about 1 second'],
            ['Double click', 'Two simultaneous POSTs with the same file', 'The same import in both responses and a single job'],
            ['API during heavy imports', 'Load test on common routes with ten 50 MB imports in flight', 'p95 of common routes equal to the baseline'],
            ['Customer with 60 files', '60 uploads in a row from the same customer', 'From the sixth on, 429 with Retry-After; another customer\'s file done in seconds'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In the accounting system, the numbers after the change tell the story. At the next month-end close, the API p95 stayed at 190 milliseconds with heavy imports running. The penetration test file started being rejected in 40 milliseconds by the inspection, without any parser being called. The largest import took three minutes in the background, and the p95 wait for small files stayed under ten seconds even with the 60-spreadsheet firm active. The import code itself, the part that validates and writes rows, barely changed: what changed was where it runs and which limits surround it.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Can I use a serverless function triggered by the bucket upload instead of a queue and a worker?',
      answer:
        'Yes, and it is a good way to separate receiving from processing: the client uploads straight to the bucket with a presigned URL and the object creation event triggers the function. The same limits are still needed, they just change names. The configured function memory is the memory ceiling, its timeout is the time ceiling and reserved concurrency is what stops a thousand files from firing a thousand executions against the database. Inspection before the parser is still mandatory, and storage events can be delivered more than once, so idempotency by hash or object key is still required too.',
    },
    {
      question: 'Doesn\'t an antivirus solve the malicious file problem?',
      answer:
        'It solves part of it. ClamAV and similar tools detect known malware by signature, which matters when the file will be downloaded by other people. They do not detect a custom decompression bomb, an XML entity that expands inside your parser, a malicious formula in a text cell or a valid CSV with 40 million rows. Those threats attack your processing, not the computer of whoever downloads the file, so the defense lies in the limits and in format inspection. Use the antivirus as one more layer, isolated and with its own limits.',
    },
    {
      question: 'How do I tell the user the import finished without hammering the server with polling?',
      answer:
        'Polling the status address with a growing interval is simple, works behind any proxy and costs little, because the route does a primary key lookup. If the screen has to react immediately, Server-Sent Events is the natural next step, with polling as a fallback when the connection drops. For long imports, an email or an in-app notification spares the user from staying on the screen. In every case, the database record remains the source of truth: the notification informs, and the screen confirms by reading the status.',
    },
  ],
  conclusion: {
    title: 'The user\'s file cannot decide how many resources your API uses',
    description:
      'Processing a file inside the request hands the user control over the CPU, memory and time of the process that serves the whole system, and it only works while files are small and well-intentioned. The fix is not to raise limits, it is to change the shape: the API accepts, stores in quarantine and responds 202; the worker inspects before opening and processes in a child process with heap and time ceilings; deterministic failures are not retried; and each customer has a cap that stops them from taking over everyone\'s queue. With tests that generate hostile files and measure API latency during heavy imports, those limits stop being an assumption. I can review how your system receives and processes files, move imports out of the API and build the inspection, limits and tests that keep the service up on the day of the largest file.',
    cta: 'Talk about file processing in my system',
  },
  related: [
    {
      label: 'Large uploads that fail at 99%: resumable multipart uploads with presigned URLs',
      to: '/blog/upload-grande-que-falha-nos-99-envio-retomavel-em-partes-com-url-pre-assinada',
    },
    {
      label: 'The dead letter queue nobody reads: turning discarded messages into real fixes',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Un sistema de gestión para despachos contables permitía que cada cliente importara asientos desde una hoja de cálculo: el usuario elegía un CSV o XLSX exportado del banco o del ERP, pulsaba importar y esperaba a que la pantalla confirmara. Funcionó durante dos años. En el quinto día hábil de un cierre de mes, un despacho grande subió una hoja de 38 MB con 410 mil filas, y el p95 de toda la API, no solo de la importación, pasó de 180 milisegundos a 14 segundos. El pod que recibió el archivo superó su límite de memoria y el kernel lo terminó, el usuario volvió a pulsar, el archivo cayó en otro pod y la escena se repitió tres veces en veinte minutos. Dos semanas después, una prueba de intrusión contratada por el mayor cliente mostró que un XLSX de 220 KB, preparado para descomprimirse en 3,8 GB, tumbaba cualquier instancia con una sola petición. Ninguno de los dos casos era un bug de lógica: la importación era correcta, solo estaba en el lugar equivocado. Este artículo muestra por qué procesar el archivo dentro de la petición tumba la API entera, cómo separar recibir de procesar con una cola y una respuesta 202, cómo darle al worker un techo de memoria y de tiempo que no dependa de que el archivo se porte bien, qué verificar antes de abrir un archivo que puede ser hostil, cómo impedir que un cliente ocupe la cola de todos y cómo demostrar con pruebas que esos límites aguantan.',
  sections: [
    {
      title: 'Por qué procesar el archivo dentro de la petición tumba la API entera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La versión con la que empieza casi todo sistema cabe en quince líneas: multer guarda el archivo en memoria, una biblioteca de hojas de cálculo lo lee entero y un bucle graba cada fila. Con los archivos de preproducción, de unos cientos de filas, la respuesta llega en menos de un segundo y nadie tiene motivos para sospechar.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'El primer problema es de CPU. En Node.js, descomprimir un XLSX y convertir el XML en objetos es trabajo síncrono, ejecutado en el mismo hilo que atiende todas las rutas. Mientras XLSX.read procesa 38 MB, el event loop no ejecuta nada más: el login, el listado de clientes y el health check de ese pod esperan en la cola del sistema operativo. Por eso subió el p95 de toda la API, y no solo el de la importación. En runtimes con pool de hilos, como Java o Go, el mecanismo es otro, pero el efecto es parecido: unas pocas importaciones pesadas ocupan hilos, conexiones a la base de datos y memoria que el resto del servicio comparte.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo es de memoria, y siempre es mayor que el tamaño del archivo. Un XLSX es un zip de archivos XML, y cada etapa de la lectura crea una nueva representación del mismo contenido. La tabla muestra lo que se midió en el incidente, con la hoja de 38 MB.',
        },
        {
          type: 'table',
          columns: ['Etapa', 'Memoria aproximada', 'Por qué crece'],
          rows: [
            ['Archivo recibido en buffer por memoryStorage', '38 MB', 'El cuerpo entero queda en el heap antes de cualquier validación'],
            ['XML descomprimido de las hojas', 'Unos 310 MB', 'El XML repetitivo se comprime a más de 8 a 1'],
            ['Estructura del libro montada por la biblioteca', 'Unos 900 MB', 'Cada celda se vuelve un objeto con tipo, valor y formato'],
            ['Array generado por sheet_to_json', 'Unos 420 MB', 'Un objeto más por fila, con un string por columna'],
            ['Pico en el proceso', 'Más de 1,6 GB', 'Todo convive hasta que termina el handler; el límite del pod era 1,5 GiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercero es de tiempo y de repetición. La petición tardaba unos tres minutos, y el balanceador cortaba las conexiones inactivas a los 60 segundos. El usuario veía un error, volvía a pulsar, y el segundo intento empezaba mientras el primero seguía grabando filas en otro pod, sin nada que impidiera asientos duplicados. Para quien estaba frente a la pantalla, el fallo parecía un bloqueo; en el servidor era trabajo doble. Aumentar timeouts, memoria o réplicas solo mueve el punto de ruptura al siguiente archivo más grande. La corrección es cambiar la forma: la petición acepta y guarda el archivo, y el trabajo pesado ocurre en otro lugar, con límites propios.',
        },
      ],
    },
    {
      title: 'Separar recibir de procesar: aceptar, guardar y responder 202',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la nueva forma, la API hace solo lo barato y predecible: aplica límites de tamaño mientras lee el cuerpo, escribe en disco temporal en lugar de memoria, calcula el hash, guarda el archivo bajo un prefijo de cuarentena en el bucket con una clave generada por el servidor, registra la importación, encola un job y responde 202 con la dirección donde se puede consultar el estado. El coste de esta petición es de entrada y salida, crece de forma lineal con el tamaño del archivo y la memoria se mantiene constante, porque no se monta nada en el heap.',
        },
        {
          type: 'diagram',
          value: flowDiagramEs,
        },
        {
          type: 'code',
          value: schemaCode,
        },
        {
          type: 'code',
          value: apiCode,
        },
        {
          type: 'list',
          items: [
            'El límite de tamaño tiene que existir en todas las capas. Multer interrumpe la lectura en el primer byte por encima de 50 MB y devuelve 413, pero el proxy o el balanceador debe tener un límite parecido, para que un cuerpo de 5 GB ni siquiera llegue a ocupar un proceso de la aplicación.',
            'La clave del objeto la genera el servidor. El nombre original sirve solo para mostrarlo y nunca se convierte en ruta de archivo, lo que elimina de una vez la sobrescritura de objetos y el recorrido de directorios con nombres como ../../config.',
            'El hash vuelve idempotente la subida. Un doble clic, un reintento del navegador y el mismo archivo enviado al día siguiente devuelven la misma importación, y la restricción única en la base de datos resuelve la carrera entre dos subidas simultáneas.',
            'El orden es objeto, fila, job. Si el encolado falla después del INSERT, la importación queda en na_fila sin job; un proceso de reconciliación vuelve a encolar las importaciones que llevan más de cinco minutos en ese estado, y un jobId igual al id de la importación vuelve inofensivo el reenvío.',
            'La extensión es solo el primer filtro, y es barato. No prueba nada sobre el contenido, que se verifica en el worker antes de que cualquier parser abra el archivo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'El 202 cambia el contrato con la interfaz, y esa es la parte que suele generar resistencia. La pantalla pasa a mostrar la importación como recibida y consulta el estado en la dirección de la cabecera Location, con un intervalo creciente: cada 2 segundos al principio y cada 10 después del primer minuto. La ganancia es que la respuesta deja de depender del tamaño del archivo. Una subida de 50 MB responde en segundos, el usuario puede cerrar la pestaña y el resultado sigue disponible en la lista de importaciones, con el conteo de filas aceptadas y rechazadas.',
        },
      ],
    },
    {
      title: 'Un worker con techo: proceso aislado, tiempo y memoria acotados',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Mover el procesamiento a un worker resuelve la latencia de la API, pero no resuelve el archivo hostil. Sin límites, la bomba de 220 KB tumba el worker en lugar de la API. Peor aún: como el job no terminó, la cola lo entrega de nuevo a otra instancia, que también muere, y un solo archivo tumba toda la flota de workers, una instancia tras otra. Por eso el worker necesita techos que no dependan de que el archivo se porte bien, y una regla clara sobre qué merece reintento.',
        },
        {
          type: 'code',
          value: workerCode,
        },
        {
          type: 'paragraph',
          value:
            'El proceso hijo lee el CSV en streaming, valida cada fila y graba por lotes de mil con unnest, todo dentro de una transacción que empieza borrando lo que un intento anterior haya grabado. La memoria queda proporcional al lote, no al archivo, y un reintento nunca duplica asientos. La versión para XLSX cambia csv-parse por el lector en streaming de ExcelJS y mantiene el resto igual.',
        },
        {
          type: 'code',
          value: childCode,
        },
        {
          type: 'table',
          columns: ['Límite', 'Dónde se aplica', 'Cuando se supera', '¿Reintentar?'],
          rows: [
            ['Tamaño del archivo', 'Proxy, multer en la API y verificación en la descarga', '413 en la API o rechazada en el worker', 'No: el mismo archivo tiene el mismo tamaño'],
            ['Heap del parser', '--max-old-space-size en el proceso hijo', 'V8 aborta el hijo y el job pasa a memoria_esgotada', 'No: el resultado es determinista'],
            ['Memoria total del contenedor', 'Límite de memoria del pod', 'El kernel mata al proceso que más consume, normalmente el hijo', 'No, y el límite hay que dimensionarlo'],
            ['Tiempo de procesamiento', 'timeout de execFile con SIGKILL', 'tempo_esgotado', 'No: un parser que se colgó con un archivo se cuelga otra vez'],
            ['Cantidad de filas', 'Contador en el proceso hijo', 'linhas_demais, con mensaje al usuario', 'No: es una regla de producto'],
            ['Tamaño de un registro', 'max_record_size de csv-parse', 'Error de lectura en el hijo', 'No: una línea de 64 KB en un extracto es un defecto o un ataque'],
            ['Base de datos o red no disponibles', 'Error común en el hijo o en el worker', 'El job vuelve a la cola con backoff', 'Sí: hasta 3 intentos'],
          ],
        },
        {
          type: 'list',
          items: [
            'Proceso hijo y no worker_threads, en este caso. Un worker thread con resourceLimits también limita el heap y es más ligero, y sirve bien para parsers escritos solo en JavaScript. El proceso separado aísla además la memoria nativa y un posible fallo de una biblioteca nativa, y el SIGKILL al vencer el plazo está garantizado, sin depender de que el código coopere.',
            'El techo de heap no es el techo de memoria. --max-old-space-size limita el heap de V8, pero los Buffers y las asignaciones nativas quedan fuera. El límite del contenedor es la última barrera y hay que calcularlo: concurrencia por el techo del hijo con margen para memoria nativa, más lo que consume el propio worker. Con concurrencia 2 y heap de 384 MB, un límite de 1,5 GiB deja holgura.',
            'Clasificar el fallo es lo que evita la cascada. UnrecoverableError hace que BullMQ mueva el job directamente a fallidos, sin los tres intentos. Reintentar un archivo que agotó la memoria solo mata dos hijos más y retrasa la respuesta al usuario. Reintentar una caída de la base de datos tiene sentido, porque pasa.',
            'En importaciones muy grandes, la transacción larga se vuelve un problema en sí: retiene locks e infla el WAL. La alternativa es grabar en una tabla de staging y promover a la tabla final en una sola operación al final, con la misma garantía de todo o nada.',
          ],
        },
      ],
    },
    {
      title: 'Archivos maliciosos: qué verificar antes de abrir',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Un archivo subido por el usuario es una entrada controlada por quien lo envía, y el parser que lo va a abrir es uno de los códigos más complejos del sistema. La estrategia es verificar lo barato antes de llamar a lo caro, por capas, sabiendo que ninguna verificación aislada basta. El módulo siguiente se ejecuta en el worker después de la descarga y antes del proceso hijo.',
        },
        {
          type: 'code',
          value: inspectCode,
        },
        {
          type: 'table',
          columns: ['Amenaza', 'Cómo aparece', 'Defensa'],
          rows: [
            ['Tipo falso', 'Ejecutable renombrado a .csv, HTML enviado como .xlsx', 'Firma por los primeros bytes; CSV sin firma binaria, sin byte nulo y en UTF-8 válido'],
            ['Bomba de descompresión', 'XLSX de 220 KB con 3,8 GB de XML repetitivo', 'Suma de tamaños declarados, razón de compresión, cantidad de entradas y techo de heap en el hijo'],
            ['Zip slip', 'Entrada llamada ../../app/config.js', 'Nunca extraer a disco; si hay que hacerlo, rechazar rutas absolutas y con ..'],
            ['Entidades XML', 'DOCTYPE con entidad externa o expansión en cascada', 'Un parser que no resuelva entidades externas ni expanda DTD; rechazar DOCTYPE en XLSX'],
            ['Inyección de fórmulas', 'Celda que empieza con =, +, - o @ y se vuelve fórmula cuando alguien abre la exportación', 'Neutralizar con apóstrofo las celdas de texto al exportar, no al importar'],
            ['Malware conocido', 'Adjunto que luego descargan otros usuarios', 'ClamAV como servicio aparte, firmas actualizadas y resultado guardado en el estado'],
            ['Bomba de imagen', 'PNG de 50 KB que declara 50.000 por 50.000 píxeles', 'Limitar píxeles antes de decodificar, como hace limitInputPixels de sharp'],
          ],
        },
        {
          type: 'list',
          items: [
            'Los tamaños del directorio central de un zip los declara quien armó el archivo y pueden mentir. La inspección frena el caso común en milisegundos, sin descomprimir nada; un archivo falsificado con tamaños falsos pasa por ella y lo frena el techo de heap del hijo. Es defensa en profundidad, no una verificación definitiva.',
            'El archivo queda en cuarentena hasta ser aprobado. Solo después de la inspección y del procesamiento se copia al prefijo definitivo o se pone a disposición de otros usuarios, y nunca se sirve con el Content-Type que declaró el cliente: usa Content-Disposition attachment y X-Content-Type-Options nosniff.',
            'El antivirus también es un parser. Ejecuta clamd en su propio contenedor, con StreamMaxLength, MaxScanSize y MaxFileSize configurados, y trata el tiempo agotado del antivirus como rechazo, no como aprobación.',
            'La biblioteca también es superficie de ataque. La versión del paquete xlsx publicada en el registro de npm se quedó en la 0.18.5 y tiene vulnerabilidades conocidas de prototype pollution y ReDoS; el código ingenuo del principio estaba expuesto a ellas sin que nadie lo supiera. Fija versiones, sigue las alertas de dependencias y prefiere bibliotecas con lectura en streaming.',
          ],
        },
      ],
    },
    {
      title: 'Un cliente no puede ocupar la cola de todos',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Con la API protegida y los workers acotados, el incidente siguiente fue de otro tipo. En el cierre del mes siguiente, un despacho subió 60 hojas seguidas. La cola era FIFO, con tres workers de concurrencia 2, y la hoja de 200 KB de otro cliente esperó 25 minutos detrás de las 60. No se cayó nada y no se superó ningún límite, pero para quien esperaba el sistema estaba caído. Una cola compartida sin regla de equidad convierte al cliente más grande en el cuello de botella de todos.',
        },
        {
          type: 'code',
          value: fairnessCode,
        },
        {
          type: 'paragraph',
          value:
            'El techo de importaciones en curso por cliente es la defensa más barata y se ejecuta antes de multer, así que rechaza sin leer el cuerpo. Es un límite suave: dos peticiones simultáneas pueden pasar el conteo a la vez, y eso es aceptable, porque el objetivo es impedir sesenta, no garantizar exactamente cinco. No lo resuelve todo, y las demás estrategias se combinan con él.',
        },
        {
          type: 'table',
          columns: ['Estrategia', 'Cómo funciona', 'Cuándo usarla', 'Coste'],
          rows: [
            ['Techo por cliente', 'La API cuenta las importaciones na_fila y processando del cliente y responde 429 con Retry-After', 'Siempre: es barato y protege contra el peor caso', 'Quien envía lotes grandes tiene que esperar o enviar poco a poco'],
            ['Colas por clase de tamaño', 'Archivos de hasta 2 MB en una cola y los mayores en otra, cada una con sus workers', 'Cuando los archivos pequeños son mayoría y necesitan respuesta rápida', 'Dos colas que monitorizar y dimensionar'],
            ['Prioridad por carga reciente', 'Los jobs de un cliente con muchas importaciones en la última hora entran con menor prioridad', 'Cuando el volumen por cliente varía mucho a lo largo del mes', 'La prioridad no es una garantía, y los jobs de baja prioridad pueden envejecer'],
            ['Cola en PostgreSQL con elección por cliente', 'El worker toma el job del cliente con menos elementos en curso, usando FOR UPDATE SKIP LOCKED', 'Cuando la equidad tiene que ser exacta', 'Consulta más cara y más código propio'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'La métrica que delata este problema no es el tamaño de la cola, es la edad del job más antiguo, separada por clase de tamaño, y el tiempo de espera p95 por cliente. Una cola de 60 jobs puede estar sana; un job de 200 KB que lleva 25 minutos esperando nunca lo está. Sigue también los rechazos por motivo, porque un aumento repentino de razao_de_compressao_suspeita es señal de ataque, y un aumento de linhas_demais es señal de que la regla de producto se quedó corta para los clientes reales.',
        },
      ],
    },
    {
      title: 'Cómo demostrar que los límites aguantan',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba que importa un CSV de diez filas y comprueba el resultado no demuestra nada sobre los incidentes. Lo que hay que demostrar es que el archivo hostil se rechaza antes de abrirse, que el parser que agota la memoria muere solo sin llevarse el worker, y que la API sigue respondiendo mientras ocurren importaciones pesadas. Los archivos hostiles deben generarse en la propia prueba, no versionarse: una bomba de descompresión en el repositorio es un riesgo para cualquier herramienta que lo indexe.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Escenario', 'Cómo simularlo', 'Resultado esperado'],
          rows: [
            ['Bomba de descompresión', 'Zip con 300 MiB de ceros generado en la prueba', 'rejeitada con descompactado_grande_demais, sin proceso hijo'],
            ['Razón de compresión sospechosa', 'Una sola entrada con 50 MiB de ceros', 'rejeitada con razao_de_compressao_suspeita'],
            ['Parser que agota la memoria', 'Techo de heap de 64 MB en el entorno de prueba y una hoja que necesita más', 'falhou con memoria_esgotada, worker vivo, job sin reintento'],
            ['Parser colgado', 'Timeout de 1 segundo en la prueba y un CSV de 2 millones de filas', 'falhou con tempo_esgotado en cerca de 1 segundo'],
            ['Doble clic', 'Dos POST simultáneos con el mismo archivo', 'La misma importación en ambas respuestas y un único job'],
            ['API durante importaciones pesadas', 'Prueba de carga en las rutas comunes con diez importaciones de 50 MB en curso', 'p95 de las rutas comunes igual al de la línea base'],
            ['Cliente con 60 archivos', '60 subidas seguidas del mismo cliente', 'A partir de la sexta, 429 con Retry-After; el archivo de otro cliente termina en segundos'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En el sistema contable, los números después del cambio cuentan la historia. En el cierre siguiente, el p95 de la API se mantuvo en 190 milisegundos con importaciones pesadas en curso. El archivo de la prueba de intrusión pasó a rechazarse en 40 milisegundos en la inspección, sin que se llamara a ningún parser. La importación más grande tardó tres minutos en segundo plano, y el tiempo de espera p95 de los archivos pequeños quedó por debajo de diez segundos incluso con el despacho de las 60 hojas activo. El código de importación, el que valida y graba las filas, casi no cambió: lo que cambió fue dónde se ejecuta y qué límites lo rodean.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Puedo usar una función serverless disparada por la subida al bucket en lugar de cola y worker?',
      answer:
        'Sí, y es una buena forma de separar recibir de procesar: el cliente sube directo al bucket con una URL prefirmada y el evento de creación del objeto dispara la función. Los mismos límites siguen siendo necesarios, solo cambian de nombre. La memoria configurada de la función es el techo de memoria, su timeout es el techo de tiempo y la concurrencia reservada es lo que impide que mil archivos disparen mil ejecuciones contra la base de datos. La inspección antes del parser sigue siendo obligatoria, y los eventos de almacenamiento pueden entregarse más de una vez, así que la idempotencia por hash o por clave del objeto también se mantiene.',
    },
    {
      question: '¿Un antivirus no resuelve el problema del archivo malicioso?',
      answer:
        'Resuelve una parte. ClamAV y herramientas parecidas detectan malware conocido por firma, lo que importa cuando otras personas van a descargar el archivo. No detectan una bomba de descompresión hecha a medida, una entidad XML que se expande dentro de tu parser, una fórmula maliciosa en una celda de texto ni un CSV válido con 40 millones de filas. Esas amenazas atacan tu procesamiento, no el ordenador de quien descarga, y por eso la defensa está en los límites y en la inspección del formato. Usa el antivirus como una capa más, aislado y con límites propios.',
    },
    {
      question: '¿Cómo aviso al usuario de que la importación terminó sin consultas agresivas al servidor?',
      answer:
        'Consultar la dirección de estado con un intervalo creciente es simple, funciona detrás de cualquier proxy y cuesta poco, porque la ruta hace una lectura por clave primaria. Si la pantalla tiene que reaccionar al instante, Server-Sent Events es el siguiente paso natural, con la consulta periódica como alternativa cuando se cae la conexión. Para importaciones largas, un aviso por correo o una notificación en el sistema evita que el usuario tenga que quedarse en la pantalla. En todos los casos, el registro en la base de datos sigue siendo la fuente de verdad: el aviso informa y la pantalla confirma leyendo el estado.',
    },
  ],
  conclusion: {
    title: 'El archivo del usuario no puede decidir cuántos recursos usa tu API',
    description:
      'Procesar un archivo dentro de la petición le entrega al usuario el control sobre la CPU, la memoria y el tiempo del proceso que atiende todo el sistema, y solo funciona mientras los archivos sean pequeños y bienintencionados. La corrección no es subir los límites, es cambiar la forma: la API acepta, guarda en cuarentena y responde 202; el worker inspecciona antes de abrir y procesa en un proceso hijo con techo de heap y de tiempo; los fallos deterministas no se reintentan; y cada cliente tiene un techo que le impide ocupar la cola de todos. Con pruebas que generan archivos hostiles y miden la latencia de la API durante importaciones pesadas, esos límites dejan de ser una suposición. Puedo revisar cómo tu sistema recibe y procesa archivos, sacar la importación de la API y montar la inspección, los límites y las pruebas que mantienen el servicio en pie el día del archivo más grande.',
    cta: 'Hablar sobre el procesamiento de archivos de mi sistema',
  },
  related: [
    {
      label: 'Subidas grandes que fallan al 99%: carga reanudable por partes con URL prefirmada',
      to: '/blog/upload-grande-que-falha-nos-99-envio-retomavel-em-partes-com-url-pre-assinada',
    },
    {
      label: 'La cola muerta que nadie lee: convertir el mensaje descartado en una corrección real',
      to: '/blog/fila-morta-que-ninguem-le-mensagem-descartada-vira-correcao',
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
