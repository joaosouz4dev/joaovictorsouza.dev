// Conteudo do artigo: upload grande que falha nos 99%, tirar a API do caminho
// dos bytes com URL pre-assinada, multipart upload no S3, retomada depois de
// queda de rede ou aba fechada, conclusao verificada no servidor e teste.
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const naiveCode = `// Versao que falha nos 99%: o arquivo inteiro atravessa a API
import multer from 'multer';
import { createReadStream } from 'node:fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({});
const upload = multer({ dest: '/tmp/uploads', limits: { fileSize: 8 * 1024 ** 3 } });

app.post('/aulas/:id/video', upload.single('video'), async (req, res) => {
  // Quando esta linha roda, o navegador ja enviou 100% dos bytes e a barra
  // de progresso marca 99%. Agora a API precisa reenviar os mesmos 4 GB ao S3
  // antes de responder, e o balanceador corta a conexao ociosa em 60 segundos.
  await s3.send(new PutObjectCommand({
    Bucket: process.env.BUCKET,
    Key: \`aulas/\${req.params.id}.mp4\`,
    Body: createReadStream(req.file.path),
    ContentLength: req.file.size,
  }));
  res.json({ ok: true });
});`;

const serverCode = `import express from 'express';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// WHEN_REQUIRED evita que o SDK coloque na URL assinada um checksum calculado
// sobre um corpo vazio, o que faz o S3 recusar o PUT que vem do navegador.
const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const BUCKET = process.env.UPLOADS_BUCKET;

const MiB = 1024 * 1024;
const TAMANHO_MAX = 20 * 1024 * MiB; // 20 GiB, regra do produto
const MAX_PARTES = 10000; // limite do S3
const VALIDADE_URL = 15 * 60; // segundos

export function tamanhoDaParte(tamanhoTotal) {
  // 8 MiB por padrao; arquivos enormes pedem partes maiores para caber em
  // 10.000 partes. O S3 exige no minimo 5 MiB em todas, menos na ultima.
  const minimo = Math.ceil(tamanhoTotal / MAX_PARTES);
  return Math.max(8 * MiB, Math.ceil(minimo / MiB) * MiB);
}

const app = express(); // Express 5: erros de handlers async chegam ao middleware de erro
app.use(express.json());
// A autenticacao roda antes destas rotas e preenche req.user.

async function carregar(req, res) {
  const { rows } = await pool.query(
    "SELECT * FROM uploads WHERE id = $1 AND usuario_id = $2 AND status <> 'abortado'",
    [req.params.id, req.user.id],
  );
  if (!rows[0]) {
    res.sendStatus(404);
    return null;
  }
  return { ...rows[0], tamanho: Number(rows[0].tamanho) }; // bigint chega como string
}

// A fonte da verdade sobre o que ja foi enviado e o S3, nao o navegador.
async function partesEnviadas(upload) {
  const partes = [];
  let marcador;
  do {
    const r = await s3.send(new ListPartsCommand({
      Bucket: BUCKET,
      Key: upload.chave,
      UploadId: upload.upload_id,
      PartNumberMarker: marcador,
    }));
    for (const p of r.Parts ?? []) {
      partes.push({ numero: p.PartNumber, etag: p.ETag, tamanho: p.Size });
    }
    marcador = r.IsTruncated ? r.NextPartNumberMarker : undefined; // 1.000 por pagina
  } while (marcador);
  return partes;
}

app.post('/uploads', async (req, res) => {
  const tamanho = Number(req.body.tamanho);
  if (!Number.isSafeInteger(tamanho) || tamanho <= 0 || tamanho > TAMANHO_MAX) {
    return res.status(422).json({ erro: 'tamanho_invalido' });
  }
  // A chave e decidida pelo servidor: o nome do arquivo nunca vira caminho.
  const chave = \`uploads/\${req.user.id}/\${randomUUID()}\`;
  const { UploadId } = await s3.send(new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: chave,
    ContentType: 'application/octet-stream',
    Metadata: { 'nome-original': encodeURIComponent(String(req.body.nome).slice(0, 200)) },
  }));
  const tamanhoParte = tamanhoDaParte(tamanho);
  const { rows } = await pool.query(
    \`INSERT INTO uploads (usuario_id, chave, upload_id, tamanho, tamanho_parte, status)
     VALUES ($1, $2, $3, $4, $5, 'enviando') RETURNING id\`,
    [req.user.id, chave, UploadId, tamanho, tamanhoParte],
  );
  res.status(201).json({
    id: rows[0].id,
    tamanhoParte,
    totalPartes: Math.ceil(tamanho / tamanhoParte),
  });
});

// Assina so as partes pedidas agora, com validade curta.
app.post('/uploads/:id/partes', async (req, res) => {
  const upload = await carregar(req, res);
  if (!upload) return;
  const total = Math.ceil(upload.tamanho / upload.tamanho_parte);
  const numeros = [...new Set(req.body.numeros)].slice(0, 50);
  if (!numeros.every((n) => Number.isInteger(n) && n >= 1 && n <= total)) {
    return res.status(422).json({ erro: 'parte_invalida' });
  }
  const urls = {};
  for (const n of numeros) {
    urls[n] = await getSignedUrl(
      s3,
      new UploadPartCommand({ Bucket: BUCKET, Key: upload.chave, UploadId: upload.upload_id, PartNumber: n }),
      { expiresIn: VALIDADE_URL },
    );
  }
  res.json({ urls });
});

app.get('/uploads/:id/partes', async (req, res) => {
  const upload = await carregar(req, res);
  if (!upload) return;
  if (upload.status === 'concluido') return res.status(409).json({ erro: 'ja_concluido' });
  res.json(await partesEnviadas(upload));
});

app.post('/uploads/:id/concluir', async (req, res) => {
  const upload = await carregar(req, res);
  if (!upload) return;
  if (upload.status === 'concluido') return res.json({ chave: upload.chave }); // idempotente

  const partes = await partesEnviadas(upload);
  const total = Math.ceil(upload.tamanho / upload.tamanho_parte);
  const recebido = partes.reduce((soma, p) => soma + p.tamanho, 0);
  if (partes.length !== total || recebido !== upload.tamanho) {
    return res.status(409).json({ erro: 'partes_incompletas', recebidas: partes.map((p) => p.numero) });
  }

  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: upload.chave,
    UploadId: upload.upload_id,
    MultipartUpload: { Parts: partes.map((p) => ({ PartNumber: p.numero, ETag: p.etag })) },
  }));
  const { ContentLength } = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: upload.chave }));
  if (ContentLength !== upload.tamanho) throw new Error(\`upload \${upload.id}: tamanho divergente\`);

  await pool.query("UPDATE uploads SET status = 'concluido', concluido_em = now() WHERE id = $1", [upload.id]);
  // Daqui em diante, validacao de conteudo e processamento rodam em um job.
  res.json({ chave: upload.chave });
});

app.delete('/uploads/:id', async (req, res) => {
  const upload = await carregar(req, res);
  if (!upload) return;
  await s3.send(new AbortMultipartUploadCommand({
    Bucket: BUCKET,
    Key: upload.chave,
    UploadId: upload.upload_id,
  }));
  await pool.query("UPDATE uploads SET status = 'abortado' WHERE id = $1", [upload.id]);
  res.sendStatus(204);
});`;

const clientCode = `const CONCORRENCIA = 4;
const TENTATIVAS = 8;

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const voltarOnline = () =>
  navigator.onLine ? Promise.resolve() : new Promise((r) => addEventListener('online', r, { once: true }));

async function api(caminho, { method = 'GET', body } = {}) {
  const r = await fetch(caminho, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw Object.assign(new Error(\`\${caminho}: HTTP \${r.status}\`), { status: r.status });
  return r.json();
}

// O navegador nao reabre o arquivo sozinho depois de recarregar a pagina; o
// usuario escolhe de novo e esta impressao digital reencontra a sessao.
const chaveLocal = (arquivo) => \`upload:\${arquivo.name}:\${arquivo.size}:\${arquivo.lastModified}\`;

async function enviarParte(arquivo, upload, numero) {
  const inicio = (numero - 1) * upload.tamanhoParte;
  const pedaco = arquivo.slice(inicio, inicio + upload.tamanhoParte); // nao le o arquivo inteiro

  for (let tentativa = 1; ; tentativa++) {
    let status = 0;
    try {
      await voltarOnline();
      // URL nova a cada tentativa: uma parte que demorou nao falha por URL expirada.
      const { urls } = await api(\`/uploads/\${upload.id}/partes\`, { method: 'POST', body: { numeros: [numero] } });
      const r = await fetch(urls[numero], { method: 'PUT', body: pedaco });
      if (r.ok) return;
      status = r.status;
    } catch (erro) {
      status = erro.status ?? 0; // 0: queda de rede, troca de Wi-Fi para 4G, aba suspensa
    }
    const definitivo = status >= 400 && status < 500 && ![403, 408, 429].includes(status);
    if (definitivo || tentativa === TENTATIVAS) {
      throw new Error(\`parte \${numero} falhou depois de \${tentativa} tentativas (HTTP \${status})\`);
    }
    await espera(Math.random() * Math.min(30000, 1000 * 2 ** tentativa)); // backoff com jitter
  }
}

export async function enviarArquivo(arquivo, aoProgredir = () => {}) {
  const chave = chaveLocal(arquivo);
  let upload = JSON.parse(localStorage.getItem(chave) ?? 'null');
  let prontas = new Set();

  if (upload) {
    try {
      const partes = await api(\`/uploads/\${upload.id}/partes\`);
      prontas = new Set(partes.map((p) => p.numero));
    } catch {
      upload = null; // sessao abortada, expirada ou de outro usuario: recomeca
    }
  }
  if (!upload) {
    upload = await api('/uploads', {
      method: 'POST',
      body: { nome: arquivo.name, tamanho: arquivo.size },
    });
    localStorage.setItem(chave, JSON.stringify(upload));
  }

  const pendentes = [];
  for (let n = 1; n <= upload.totalPartes; n++) if (!prontas.has(n)) pendentes.push(n);
  let concluidas = upload.totalPartes - pendentes.length;
  aoProgredir(concluidas / upload.totalPartes);

  const trabalhador = async () => {
    while (pendentes.length > 0) {
      const numero = pendentes.shift();
      await enviarParte(arquivo, upload, numero);
      aoProgredir(++concluidas / upload.totalPartes);
    }
  };
  await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));

  const resultado = await api(\`/uploads/\${upload.id}/concluir\`, { method: 'POST' });
  localStorage.removeItem(chave);
  return resultado;
}`;

const infraCode = `# CORS do bucket: o navegador faz PUT direto no S3.
# Como o servidor lista as partes, o cliente nao precisa ler o ETag e nao e
# necessario expor esse cabecalho.
aws s3api put-bucket-cors --bucket "$UPLOADS_BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["https://app.exemplo.com.br"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }]
}'

# Partes de uploads nunca concluidos sao cobradas e nao aparecem na listagem
# de objetos. Esta regra apaga o que ficou para tras depois de 7 dias.
aws s3api put-bucket-lifecycle-configuration --bucket "$UPLOADS_BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "abortar-multipart-incompleto",
    "Status": "Enabled",
    "Filter": { "Prefix": "uploads/" },
    "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
  }]
}'`;

const testCode = `import { test, expect } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// MinIO local como S3 compativel:
//   docker run -d -p 9000:9000 -e MINIO_ROOT_USER=dev -e MINIO_ROOT_PASSWORD=devdevdev \\
//     minio/minio server /data
const ARQUIVO = 'tmp/video-200mb.bin';
const s3 = new S3Client({
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: { accessKeyId: 'dev', secretAccessKey: 'devdevdev' },
});
const sha256 = (dados) => createHash('sha256').update(dados).digest('hex');

test.beforeAll(() => {
  mkdirSync('tmp', { recursive: true });
  writeFileSync(ARQUIVO, randomBytes(200 * 1024 * 1024)); // 25 partes de 8 MiB
});

test('retoma de onde parou depois de queda de rede e recarga da pagina', async ({ page, context }) => {
  await page.goto('/enviar');
  await page.setInputFiles('input[type=file]', ARQUIVO);
  await expect(page.getByTestId('progresso')).toHaveText(/[4-9]\\d%/, { timeout: 120_000 });

  await context.setOffline(true); // a rede cai no meio do envio
  await page.waitForTimeout(3_000);
  await context.setOffline(false);
  await page.reload(); // o usuario fecha a aba e volta

  const partesReenviadas = new Set();
  page.on('request', (r) => {
    if (r.method() === 'PUT') partesReenviadas.add(new URL(r.url()).searchParams.get('partNumber'));
  });
  await page.setInputFiles('input[type=file]', ARQUIVO);
  await expect(page.getByTestId('status')).toHaveText('concluído', { timeout: 120_000 });

  // A retomada nao pode recomecar do zero
  expect(partesReenviadas.size).toBeLessThan(25);

  // E o objeto final tem que ser identico, byte a byte, ao arquivo original
  const chave = await page.getByTestId('chave').textContent();
  const objeto = await s3.send(new GetObjectCommand({ Bucket: 'uploads', Key: chave }));
  const hash = createHash('sha256');
  for await (const pedaco of objeto.Body) hash.update(pedaco);
  expect(hash.digest('hex')).toBe(sha256(readFileSync(ARQUIVO)));
});`;

const flowDiagramPt = `Antes: os bytes atravessam a API
  Navegador ──4 GB──> Balanceador ──4 GB──> API (disco) ──4 GB──> S3
                      timeout 60s ocioso    reenvia tudo antes de responder
  Uma queda em qualquer ponto = recomeçar do byte zero

Depois: a API só assina, os bytes vão direto ao armazenamento
  1. Navegador ──POST /uploads {tamanho}──────────> API ──CreateMultipartUpload──> S3
                <──{id, tamanhoParte, totalPartes}──
  2. Para cada parte (4 em paralelo):
       Navegador ──POST /uploads/:id/partes [n]──> API (assina, 15 min)
       Navegador ──PUT parte n (8 MiB)─────────────────────────────────────────> S3
  3. Caiu a rede ou fechou a aba?
       Navegador ──GET /uploads/:id/partes──> API ──ListParts──> S3
       reenvia só as partes que faltam
  4. Navegador ──POST /uploads/:id/concluir──> API ──ListParts + Complete + Head──> S3
       a API confere quantidade, soma dos tamanhos e tamanho final`;

const flowDiagramEn = `Before: the bytes go through the API
  Browser ──4 GB──> Load balancer ──4 GB──> API (disk) ──4 GB──> S3
                    60s idle timeout        re-sends everything before answering
  A drop anywhere = start over from byte zero

After: the API only signs, the bytes go straight to storage
  1. Browser ──POST /uploads {size}──────────────────> API ──CreateMultipartUpload──> S3
             <──{id, tamanhoParte, totalPartes}──
  2. For each part (4 in parallel):
       Browser ──POST /uploads/:id/partes [n]──> API (signs, 15 min)
       Browser ──PUT part n (8 MiB)──────────────────────────────────────────> S3
  3. Network dropped or tab closed?
       Browser ──GET /uploads/:id/partes──> API ──ListParts──> S3
       re-sends only the missing parts
  4. Browser ──POST /uploads/:id/concluir──> API ──ListParts + Complete + Head──> S3
       the API checks count, sum of sizes and final size`;

const flowDiagramEs = `Antes: los bytes atraviesan la API
  Navegador ──4 GB──> Balanceador ──4 GB──> API (disco) ──4 GB──> S3
                      timeout 60s inactivo  reenvía todo antes de responder
  Un corte en cualquier punto = empezar de nuevo desde el byte cero

Después: la API solo firma, los bytes van directo al almacenamiento
  1. Navegador ──POST /uploads {tamaño}─────────────> API ──CreateMultipartUpload──> S3
                <──{id, tamanhoParte, totalPartes}──
  2. Para cada parte (4 en paralelo):
       Navegador ──POST /uploads/:id/partes [n]──> API (firma, 15 min)
       Navegador ──PUT parte n (8 MiB)─────────────────────────────────────────> S3
  3. ¿Se cayó la red o se cerró la pestaña?
       Navegador ──GET /uploads/:id/partes──> API ──ListParts──> S3
       reenvía solo las partes que faltan
  4. Navegador ──POST /uploads/:id/concluir──> API ──ListParts + Complete + Head──> S3
       la API verifica cantidad, suma de tamaños y tamaño final`;

const pt = {
  intro:
    'Uma plataforma de cursos online tinha um painel onde os instrutores enviavam as videoaulas, arquivos de 2 a 6 GB gravados em casa. Durante meses, o suporte recebeu o mesmo chamado com palavras diferentes: o envio travou em 99%. Quando o time finalmente mediu, 31% das tentativas acima de 2 GB falhavam, a média era de 2,4 tentativas por aula publicada e um instrutor tinha tentado nove vezes o mesmo arquivo em um sábado à noite, cada vez recomeçando do zero. O código não tinha nenhum erro aparente: um formulário com campo de arquivo, um endpoint com multer gravando em disco e um PutObject para o S3 no final. Funcionava perfeitamente em homologação, com vídeos de 50 MB na rede do escritório. O defeito era de arquitetura: o arquivo inteiro atravessava a API em uma única requisição, e qualquer interrupção, em qualquer ponto de um envio de quarenta minutos, jogava tudo fora. Este artigo explica por que o upload grande falha justamente no fim, como tirar a API do caminho dos bytes com URLs pré-assinadas, como dividir o envio em partes com o multipart upload do S3, como retomar de onde parou depois de uma queda de rede ou de uma aba fechada, quais detalhes quebram essa solução em produção e como provar com um teste automatizado que a retomada realmente funciona.',
  sections: [
    {
      title: 'Por que o upload grande falha justamente nos 99%',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A versão que quase todo sistema começa usando é esta: o navegador envia o arquivo em um POST multipart/form-data, a API recebe, grava em disco e depois manda para o armazenamento de objetos. Para arquivos pequenos, é simples e suficiente. Para arquivos grandes, ela concentra três problemas no mesmo lugar.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'O primeiro é o que explica os 99%. A barra de progresso do navegador, alimentada pelo evento upload.onprogress, mede bytes entregues à pilha de rede, não bytes processados pelo servidor. Ela chega ao fim quando o último byte sai da máquina do usuário, mas a resposta só vem depois que a API reenvia os mesmos gigabytes ao S3. Nesse intervalo, a conexão entre o navegador e o balanceador fica parada, sem tráfego em nenhum sentido. Na plataforma de cursos, o balanceador tinha timeout de ociosidade de 60 segundos e reenviar 4 GB ao S3 levava de dois a quatro minutos. O usuário via 99%, depois um erro, e o vídeo às vezes até chegava ao bucket, mas sem registro no banco, porque a requisição tinha sido cortada antes do final do handler.',
        },
        {
          type: 'paragraph',
          value:
            'O segundo é a probabilidade. Um envio único precisa que a conexão sobreviva do primeiro ao último byte. Se a chance de uma interrupção em um minuto qualquer é pequena, como uma troca de Wi-Fi, um notebook que hiberna ou um proxy corporativo que derruba conexões longas, ela se acumula com a duração. A tabela usa uma chance de 2% de interrupção por minuto e uma conexão de upload de 5 Mbit/s, valores comuns em internet residencial.',
        },
        {
          type: 'table',
          columns: ['Arquivo', 'Tempo de envio a 5 Mbit/s', 'Chance de terminar em um envio único', 'Perda máxima por queda com partes de 8 MiB e 4 em paralelo'],
          rows: [
            ['100 MB', 'Cerca de 3 minutos', '95%', '32 MiB'],
            ['1 GB', 'Cerca de 27 minutos', '58%', '32 MiB'],
            ['2 GB', 'Cerca de 55 minutos', '33%', '32 MiB'],
            ['5 GB', 'Cerca de 2 horas e 16 minutos', '6%', '32 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O terceiro é o custo da falha. Sem retomada, cada tentativa recomeça do byte zero, e quem mais precisa tentar de novo é justamente quem tem a rede mais instável e o arquivo maior. Além disso, a API passa a carregar o peso de todos os uploads: conexões abertas por dezenas de minutos, disco temporário que enche e banda de saída paga duas vezes, uma para receber e outra para reenviar. A correção não é aumentar timeouts. É mudar a forma do envio em dois movimentos: tirar a API do caminho dos bytes e dividir o arquivo em partes que podem falhar e ser reenviadas de forma independente.',
        },
      ],
    },
    {
      title: 'Tirar a API do caminho dos bytes com URL pré-assinada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Uma URL pré-assinada é uma autorização temporária para uma única operação em um único objeto, assinada com as credenciais do servidor. A API decide quem pode enviar o quê, gera a URL e devolve ao navegador, que faz o PUT direto no S3. A API continua sendo dona das regras, como autenticação, tamanho máximo, quota e nome do objeto, mas não toca em nenhum byte do arquivo. O balanceador e os pods da aplicação deixam de ver conexões de quarenta minutos.',
        },
        {
          type: 'paragraph',
          value:
            'Uma URL pré-assinada para um PutObject simples já resolve o problema dos 99% e tira a carga da API, mas ainda é um envio único: a queda no minuto 38 continua jogando tudo fora. O multipart upload resolve a outra metade. O arquivo é dividido em partes numeradas, cada parte é um PUT independente com sua própria URL assinada, e o S3 guarda as partes recebidas até que alguém mande concluir ou abortar. Uma parte que falha é reenviada sozinha, e partes diferentes podem subir em paralelo.',
        },
        {
          type: 'diagram',
          value: flowDiagramPt,
        },
        {
          type: 'table',
          columns: ['Regra do multipart upload no S3', 'Valor', 'Consequência no desenho'],
          rows: [
            ['Tamanho mínimo de parte', '5 MiB, exceto a última', 'Partes pequenas demais são recusadas na conclusão, não no envio'],
            ['Tamanho máximo de parte', '5 GiB', 'Nunca é o limite prático: partes grandes perdem a vantagem de retomar'],
            ['Quantidade de partes', 'De 1 a 10.000', 'O tamanho da parte precisa crescer com o arquivo'],
            ['Partes por página no ListParts', 'Até 1.000', 'A listagem precisa paginar para arquivos com mais de 1.000 partes'],
            ['Partes de um upload não concluído', 'Ficam armazenadas e são cobradas', 'Exige regra de ciclo de vida para abortar o que ficou para trás'],
            ['Validade da URL assinada', 'Até 7 dias, limitada pela credencial que assinou', 'Com credencial temporária de role, a URL morre junto com a sessão'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'O tamanho da parte é uma troca entre retrabalho e quantidade de requisições. Partes de 8 MiB significam que uma queda perde no máximo 8 MiB por envio em andamento, e um arquivo de 4 GB gera 512 PUTs. Partes de 100 MiB reduzem as requisições, mas cada falha em uma rede lenta custa minutos. Para envios de navegador, 8 a 16 MiB costuma ser o ponto de equilíbrio, aumentando apenas quando o arquivo passaria de 10.000 partes.',
        },
      ],
    },
    {
      title: 'O servidor: sessão de upload, assinatura por parte e conclusão verificada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O servidor tem cinco responsabilidades: criar a sessão de upload e registrá-la no banco, assinar URLs para partes específicas, informar quais partes já chegaram, concluir conferindo o que está no S3 e abortar quando o usuário desiste. A sessão no banco guarda o UploadId do S3, a chave do objeto, o tamanho declarado e o tamanho de parte calculado, e é isso que permite retomar de outro dispositivo, de outra aba ou depois de dias.',
        },
        {
          type: 'code',
          value: serverCode,
        },
        {
          type: 'paragraph',
          value:
            'Três decisões desse código importam mais do que parecem. A primeira é que a conclusão usa ListParts e não os ETags enviados pelo navegador. O cliente não é fonte confiável sobre o que foi armazenado, e a conferência de quantidade de partes e soma dos tamanhos garante que o objeto final tem exatamente o tamanho declarado na criação, o que impede que alguém crie uma sessão de 10 MB para passar pela quota e envie 10 GB. A segunda é que a conclusão é idempotente: se a resposta se perder no caminho e o navegador repetir a chamada, a segunda devolve o mesmo resultado em vez de falhar porque o UploadId já não existe.',
        },
        {
          type: 'paragraph',
          value:
            'A terceira é que as URLs são assinadas sob demanda, para poucas partes por vez e com validade de 15 minutos. Assinar todas as 512 partes na criação parece mais eficiente, mas produz URLs que expiram antes de serem usadas em conexões lentas e entrega ao navegador autorização para escrever por horas. A opção requestChecksumCalculation: WHEN_REQUIRED também merece atenção: versões recentes do AWS SDK para JavaScript passaram a incluir parâmetros de checksum nas URLs assinadas de UploadPart, calculados sobre um corpo vazio, e o S3 recusa o PUT do navegador com o conteúdo real. É o tipo de quebra que aparece depois de uma atualização de dependência, sem nenhuma mudança no seu código.',
        },
      ],
    },
    {
      title: 'O cliente: enviar em partes, tentar de novo e retomar depois de fechar a aba',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No navegador, File.slice cria uma referência para um intervalo do arquivo sem ler o conteúdo para a memória, então enviar uma parte de 8 MiB de um vídeo de 6 GB custa 8 MiB, não 6 GB. O cliente abaixo envia quatro partes em paralelo, tenta de novo cada parte com backoff exponencial e jitter, espera a rede voltar antes de insistir e guarda a sessão no localStorage para retomar depois de uma recarga.',
        },
        {
          type: 'code',
          value: clientCode,
        },
        {
          type: 'list',
          items: [
            'A retomada pergunta ao servidor quais partes existem, em vez de confiar em um progresso salvo localmente. Uma parte pode ter chegado ao S3 com a resposta perdida no caminho, e um progresso local diria que ela falta; o ListParts diz a verdade.',
            'Cada tentativa pede uma URL nova. Isso custa uma chamada leve à API por parte, mas elimina a classe inteira de falhas por URL expirada em redes lentas ou depois de o notebook hibernar no meio do envio.',
            'Erros 4xx são definitivos, com exceção de 403, que aqui significa URL expirada ou relógio do cliente adiantado, 408 e 429. Tentar de novo um 400 ou um 413 só adia a mensagem de erro e esconde o defeito.',
            'O jitter no backoff evita que milhares de navegadores que perderam a conexão ao mesmo tempo, por exemplo durante uma instabilidade do provedor, voltem todos no mesmo segundo.',
            'A impressão digital usa nome, tamanho e data de modificação. Não é um hash do conteúdo, porque calcular SHA-256 de 6 GB no navegador antes de começar levaria minutos; é suficiente para reencontrar a sessão quando o usuário escolhe o mesmo arquivo de novo.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A concorrência de quatro partes não é arbitrária. Em conexões residenciais, a banda de upload costuma ser o gargalo, e mais conexões em paralelo apenas dividem a mesma banda, aumentando o retrabalho em caso de queda. Em redes corporativas rápidas, seis a oito partes em paralelo podem aproveitar melhor a banda. O ideal é medir o throughput das primeiras partes e ajustar, mas um valor fixo entre três e seis já resolve a maioria dos casos.',
        },
      ],
    },
    {
      title: 'Os detalhes que quebram o upload em produção',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O fluxo básico funciona no primeiro dia. Os problemas aparecem em semanas, em lugares que não estão no caminho feliz.',
        },
        {
          type: 'code',
          value: infraCode,
        },
        {
          type: 'list',
          items: [
            'CORS. O PUT sai do domínio da aplicação para o domínio do bucket, e sem regra de CORS o navegador bloqueia a requisição antes de enviar o corpo. A regra deve listar as origens reais da aplicação, não um asterisco. Se o cliente precisar ler o ETag da resposta, o cabeçalho tem que estar em ExposeHeaders; no desenho deste artigo isso não é necessário, porque o servidor lista as partes.',
            'Partes órfãs custam dinheiro. Um upload abandonado no meio não aparece na listagem de objetos do bucket, mas as partes continuam armazenadas e cobradas indefinidamente. A regra de ciclo de vida AbortIncompleteMultipartUpload é obrigatória, e o prazo dela define por quanto tempo o usuário consegue retomar.',
            'Relógio do cliente não importa, relógio do servidor sim. A assinatura usa o horário de quem assina. Um servidor com relógio atrasado gera URLs que o S3 considera expiradas ou ainda não válidas, e o sintoma é um 403 intermitente que só acontece em uma das instâncias.',
            'Credencial temporária encurta a validade. Se a API roda com uma role, como em ECS, EKS ou Lambda, a URL assinada deixa de valer quando a credencial temporária expira, mesmo que o expiresIn seja maior. É mais um motivo para assinar sob demanda e com validade curta.',
            'Concluir não significa validar. O objeto final pode ser qualquer coisa que o usuário quis enviar. Gere a chave no servidor, grave em um prefixo de quarentena, verifique tipo real pelos primeiros bytes e passe por antivírus em um job assíncrono antes de liberar o arquivo para outros usuários ou para processamento.',
            'Integridade de ponta a ponta. O TLS protege o trânsito e o S3 compara o Content-MD5 quando ele é enviado, mas nada no fluxo básico prova que o arquivo final é idêntico ao do disco do usuário. Quando isso importa, como em arquivos fiscais ou dados de saúde, use checksums por parte com o algoritmo de checksum do multipart e compare no servidor.',
            'Sessões presas no banco. Uploads com status enviando há mais tempo que o prazo da regra de ciclo de vida devem ser marcados como abortados por um job periódico, senão o painel mostra envios em andamento que já não existem no S3.',
          ],
        },
      ],
    },
    {
      title: 'Como provar que a retomada funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Um teste que envia um arquivo de 1 MB e confere que ele chegou não prova nada sobre o problema original. O que precisa ser provado é que uma interrupção no meio do envio não obriga a recomeçar, que uma recarga da página reencontra a sessão e que o objeto final é idêntico ao arquivo original. O teste usa um MinIO local como S3 compatível, um arquivo de 200 MB com conteúdo aleatório e o modo offline do Playwright para derrubar a rede no meio.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Cenário', 'Como simular', 'Resultado esperado'],
          rows: [
            ['Queda de rede no meio do envio', 'context.setOffline(true) por alguns segundos', 'Partes em andamento são repetidas; nenhuma parte concluída é reenviada'],
            ['Aba fechada e reaberta', 'page.reload() e nova seleção do mesmo arquivo', 'O cliente reencontra a sessão e envia só as partes que faltam'],
            ['URL expirada', 'Assinar com expiresIn de 1 segundo no ambiente de teste', '403 seguido de nova assinatura e sucesso na tentativa seguinte'],
            ['Resposta da conclusão perdida', 'Chamar concluir duas vezes seguidas', 'As duas chamadas devolvem a mesma chave, sem erro'],
            ['Tamanho declarado menor que o real', 'Criar a sessão com tamanho falso e enviar mais partes', 'A conclusão devolve 409 e o objeto não é criado'],
            ['Upload abandonado', 'Criar a sessão, enviar uma parte e não concluir', 'A regra de ciclo de vida remove as partes e o job marca a sessão como abortada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Em produção, a métrica que importa não é a quantidade de uploads concluídos, mas a taxa de conclusão por sessão criada e a quantidade de partes repetidas por upload. Na plataforma de cursos, depois da mudança, a taxa de conclusão de arquivos acima de 2 GB passou de 69% para 99,4%, o tempo médio entre o início e a publicação da aula caiu porque ninguém recomeçava do zero e os pods da API deixaram de precisar de disco temporário. Os 0,6% restantes eram sessões abandonadas de propósito, e a regra de ciclo de vida cuidou delas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'E se eu não usar S3?',
      answer:
        'A ideia é a mesma em qualquer armazenamento de objetos, só muda o protocolo. Google Cloud Storage oferece sessões de upload retomável: o servidor cria a sessão, o cliente envia com Content-Range e, depois de uma queda, consulta o offset aceito com um PUT vazio e Content-Range: bytes */tamanho. No Azure Blob Storage, o equivalente são os blocos de um block blob, enviados com Put Block e confirmados com Put Block List, autorizados por uma SAS. MinIO, Cloudflare R2 e outros compatíveis com S3 aceitam o código deste artigo quase sem mudanças. Se o arquivo precisa passar pelo seu próprio servidor, o protocolo aberto tus resolve a retomada sobre HTTP com implementações prontas de cliente e servidor.',
    },
    {
      question: 'Como mostrar progresso fino se o fetch não informa o progresso do envio?',
      answer:
        'Com partes de 8 MiB, o progresso por parte concluída já é suficientemente fino para a maioria das telas: um arquivo de 4 GB avança de 0,2% em 0,2%. Se for preciso atualizar durante cada parte, use XMLHttpRequest para o PUT, porque ele expõe upload.onprogress, e some os bytes em andamento de todas as partes ativas aos bytes das partes já concluídas. Lembre de descontar os bytes de uma parte que falhou, senão a barra anda para trás ou passa de 100%. Streaming de corpo no fetch existe em alguns navegadores, mas exige HTTP/2 e ainda não tem suporte amplo o bastante para ser a base de um fluxo crítico.',
    },
    {
      question: 'Vale a pena usar multipart para arquivos pequenos?',
      answer:
        'Não. Abaixo de algumas dezenas de megabytes, um PUT simples com URL pré-assinada é mais rápido, mais simples e tem chance de falha desprezível. O multipart adiciona pelo menos três chamadas à API e exige limpeza de partes órfãs. Uma regra comum é usar PUT único até 50 ou 100 MB e multipart acima disso, com o servidor decidindo na criação da sessão. O que vale para qualquer tamanho é tirar a API do caminho dos bytes, porque isso libera conexões, disco e banda da aplicação.',
    },
  ],
  conclusion: {
    title: 'Upload grande não é um problema de timeout, é um problema de forma',
    description:
      'Mandar o arquivo inteiro em uma requisição que atravessa a API funciona com arquivos de teste e falha, de forma silenciosa e repetida, para quem tem o arquivo maior e a rede pior. Aumentar timeouts só muda o lugar onde a conexão cai. A correção é mudar a forma do envio: URLs pré-assinadas para que os bytes vão direto ao armazenamento, multipart para que cada parte falhe e seja reenviada sozinha, uma sessão no servidor que torna o envio retomável de qualquer aba e uma conclusão que confere no S3 o que realmente chegou. Com CORS, ciclo de vida e validação de conteúdo resolvidos, e um teste que derruba a rede no meio, o 99% deixa de ser o lugar onde o envio morre. Posso revisar o fluxo de upload do seu sistema, implementar o envio direto e retomável e montar os testes que provam que ele sobrevive a uma rede ruim.',
    cta: 'Falar sobre os uploads do meu sistema',
  },
  related: [
    {
      label: 'Exportação de relatório que derruba o servidor: gerar arquivo grande em streaming sem estourar memória',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Limite de tamanho de payload: quando a requisição legítima passa a ser recusada',
      to: '/blog/limite-tamanho-payload-quando-requisicao-legitima-passa-a-ser-recusada',
    },
    {
      label: 'Arquitetura e modernização de backend',
      to: '/servicos/arquitetura-e-modernizacao-backend',
    },
  ],
};

const en = {
  intro:
    'An online course platform had a dashboard where instructors uploaded their video lessons, 2 to 6 GB files recorded at home. For months, support received the same ticket in different words: the upload got stuck at 99%. When the team finally measured it, 31% of attempts above 2 GB failed, the average was 2.4 attempts per published lesson, and one instructor had tried the same file nine times on a Saturday night, starting from zero every time. The code had no obvious bug: a form with a file field, an endpoint using multer to write to disk and a PutObject to S3 at the end. It worked perfectly in staging, with 50 MB videos on the office network. The defect was architectural: the whole file went through the API in a single request, and any interruption, at any point of a forty minute upload, threw everything away. This article explains why large uploads fail right at the end, how to take the API out of the byte path with presigned URLs, how to split the upload into parts with S3 multipart upload, how to resume where it stopped after a network drop or a closed tab, which details break this solution in production and how to prove with an automated test that resuming actually works.',
  sections: [
    {
      title: 'Why large uploads fail right at 99%',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The version almost every system starts with is this one: the browser sends the file in a multipart/form-data POST, the API receives it, writes it to disk and then sends it to object storage. For small files, it is simple and good enough. For large files, it concentrates three problems in the same place.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'The first one explains the 99%. The browser progress bar, fed by the upload.onprogress event, measures bytes handed to the network stack, not bytes processed by the server. It reaches the end when the last byte leaves the user\'s machine, but the response only comes after the API re-sends the same gigabytes to S3. During that interval, the connection between the browser and the load balancer sits idle, with no traffic in either direction. On the course platform, the load balancer had a 60 second idle timeout and re-sending 4 GB to S3 took two to four minutes. The user saw 99%, then an error, and the video sometimes even reached the bucket, but with no record in the database, because the request had been cut before the end of the handler.',
        },
        {
          type: 'paragraph',
          value:
            'The second is probability. A single upload needs the connection to survive from the first byte to the last. If the chance of an interruption in any given minute is small, such as a Wi-Fi switch, a laptop going to sleep or a corporate proxy that drops long connections, it accumulates with duration. The table assumes a 2% chance of interruption per minute and a 5 Mbit/s upload link, common values for home internet.',
        },
        {
          type: 'table',
          columns: ['File', 'Upload time at 5 Mbit/s', 'Chance of finishing in a single upload', 'Maximum loss per drop with 8 MiB parts and 4 in parallel'],
          rows: [
            ['100 MB', 'About 3 minutes', '95%', '32 MiB'],
            ['1 GB', 'About 27 minutes', '58%', '32 MiB'],
            ['2 GB', 'About 55 minutes', '33%', '32 MiB'],
            ['5 GB', 'About 2 hours and 16 minutes', '6%', '32 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'The third is the cost of failure. Without resuming, every attempt starts over from byte zero, and the people who most need to retry are precisely the ones with the most unstable network and the largest file. On top of that, the API carries the weight of every upload: connections open for tens of minutes, temporary disk filling up and outbound bandwidth paid twice, once to receive and once to re-send. The fix is not raising timeouts. It is changing the shape of the upload in two moves: taking the API out of the byte path and splitting the file into parts that can fail and be re-sent independently.',
        },
      ],
    },
    {
      title: 'Taking the API out of the byte path with presigned URLs',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A presigned URL is a temporary authorization for a single operation on a single object, signed with the server credentials. The API decides who can upload what, generates the URL and returns it to the browser, which sends the PUT straight to S3. The API remains the owner of the rules, such as authentication, maximum size, quota and object name, but does not touch a single byte of the file. The load balancer and the application pods stop seeing forty minute connections.',
        },
        {
          type: 'paragraph',
          value:
            'A presigned URL for a simple PutObject already solves the 99% problem and takes the load off the API, but it is still a single upload: a drop at minute 38 still throws everything away. Multipart upload solves the other half. The file is split into numbered parts, each part is an independent PUT with its own signed URL, and S3 keeps the received parts until someone asks it to complete or abort. A part that fails is re-sent on its own, and different parts can go up in parallel.',
        },
        {
          type: 'diagram',
          value: flowDiagramEn,
        },
        {
          type: 'table',
          columns: ['S3 multipart upload rule', 'Value', 'Consequence for the design'],
          rows: [
            ['Minimum part size', '5 MiB, except the last one', 'Parts that are too small are rejected at completion, not at upload'],
            ['Maximum part size', '5 GiB', 'Never the practical limit: large parts lose the benefit of resuming'],
            ['Number of parts', 'From 1 to 10,000', 'Part size has to grow with the file'],
            ['Parts per ListParts page', 'Up to 1,000', 'Listing has to paginate for files with more than 1,000 parts'],
            ['Parts of an upload never completed', 'Stay stored and are billed', 'Requires a lifecycle rule to abort what was left behind'],
            ['Signed URL validity', 'Up to 7 days, capped by the credential that signed it', 'With temporary role credentials, the URL dies with the session'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Part size is a trade-off between rework and number of requests. 8 MiB parts mean a drop loses at most 8 MiB per in-flight upload, and a 4 GB file generates 512 PUTs. 100 MiB parts reduce requests, but each failure on a slow network costs minutes. For browser uploads, 8 to 16 MiB is usually the sweet spot, increasing only when the file would exceed 10,000 parts.',
        },
      ],
    },
    {
      title: 'The server: upload session, per-part signing and verified completion',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The server has five responsibilities: create the upload session and record it in the database, sign URLs for specific parts, report which parts have already arrived, complete the upload by checking what is in S3 and abort when the user gives up. The session in the database stores the S3 UploadId, the object key, the declared size and the computed part size, and that is what makes it possible to resume from another device, another tab or days later.',
        },
        {
          type: 'code',
          value: serverCode,
        },
        {
          type: 'paragraph',
          value:
            'Three decisions in this code matter more than they seem. The first is that completion uses ListParts and not the ETags sent by the browser. The client is not a reliable source about what was stored, and checking the number of parts and the sum of their sizes guarantees the final object has exactly the size declared at creation, which prevents someone from creating a 10 MB session to pass the quota check and then uploading 10 GB. The second is that completion is idempotent: if the response is lost on the way back and the browser repeats the call, the second one returns the same result instead of failing because the UploadId no longer exists.',
        },
        {
          type: 'paragraph',
          value:
            'The third is that URLs are signed on demand, for a few parts at a time and valid for 15 minutes. Signing all 512 parts at creation looks more efficient, but it produces URLs that expire before they are used on slow connections and hands the browser write authorization for hours. The requestChecksumCalculation: WHEN_REQUIRED option also deserves attention: recent versions of the AWS SDK for JavaScript started adding checksum parameters to signed UploadPart URLs, computed over an empty body, and S3 rejects the browser PUT carrying the real content. It is the kind of breakage that shows up after a dependency update, with no change at all in your code.',
        },
      ],
    },
    {
      title: 'The client: upload in parts, retry and resume after closing the tab',
      blocks: [
        {
          type: 'paragraph',
          value:
            'In the browser, File.slice creates a reference to a range of the file without reading the content into memory, so sending an 8 MiB part of a 6 GB video costs 8 MiB, not 6 GB. The client below sends four parts in parallel, retries each part with exponential backoff and jitter, waits for the network to come back before insisting and stores the session in localStorage to resume after a reload.',
        },
        {
          type: 'code',
          value: clientCode,
        },
        {
          type: 'list',
          items: [
            'Resuming asks the server which parts exist, instead of trusting progress saved locally. A part may have reached S3 with the response lost on the way back, and local progress would say it is missing; ListParts tells the truth.',
            'Every attempt requests a fresh URL. That costs one lightweight API call per part, but it eliminates the whole class of failures caused by expired URLs on slow networks or after the laptop sleeps in the middle of the upload.',
            '4xx errors are final, except 403, which here means an expired URL or a client clock running ahead, 408 and 429. Retrying a 400 or a 413 only delays the error message and hides the defect.',
            'The jitter in the backoff prevents thousands of browsers that lost their connection at the same time, for example during a provider outage, from all coming back in the same second.',
            'The fingerprint uses name, size and modification date. It is not a content hash, because computing SHA-256 over 6 GB in the browser before starting would take minutes; it is enough to find the session again when the user picks the same file.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A concurrency of four parts is not arbitrary. On home connections, upload bandwidth is usually the bottleneck, and more parallel connections just split the same bandwidth, increasing rework when the connection drops. On fast corporate networks, six to eight parallel parts can make better use of the bandwidth. Ideally you measure the throughput of the first parts and adjust, but a fixed value between three and six already handles most cases.',
        },
      ],
    },
    {
      title: 'The details that break uploads in production',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The basic flow works on day one. The problems show up weeks later, in places that are not on the happy path.',
        },
        {
          type: 'code',
          value: infraCode,
        },
        {
          type: 'list',
          items: [
            'CORS. The PUT goes from the application domain to the bucket domain, and without a CORS rule the browser blocks the request before sending the body. The rule should list the real application origins, not an asterisk. If the client needs to read the ETag from the response, the header has to be in ExposeHeaders; in the design in this article that is not necessary, because the server lists the parts.',
            'Orphan parts cost money. An upload abandoned halfway does not show up in the bucket object listing, but its parts remain stored and billed indefinitely. The AbortIncompleteMultipartUpload lifecycle rule is mandatory, and its deadline defines how long the user can resume.',
            'The client clock does not matter, the server clock does. The signature uses the signer\'s time. A server with a clock running behind generates URLs that S3 considers expired or not yet valid, and the symptom is an intermittent 403 that only happens on one of the instances.',
            'Temporary credentials shorten validity. If the API runs with a role, as in ECS, EKS or Lambda, the signed URL stops working when the temporary credential expires, even if expiresIn is longer. That is one more reason to sign on demand with short validity.',
            'Completing is not validating. The final object can be anything the user wanted to upload. Generate the key on the server, write to a quarantine prefix, check the real type from the first bytes and run antivirus in an asynchronous job before releasing the file to other users or to processing.',
            'End-to-end integrity. TLS protects transit and S3 checks Content-MD5 when it is sent, but nothing in the basic flow proves the final file is identical to the one on the user\'s disk. When that matters, such as for tax files or health data, use per-part checksums with the multipart checksum algorithm and compare them on the server.',
            'Sessions stuck in the database. Uploads with status enviando for longer than the lifecycle rule deadline should be marked as aborted by a periodic job, otherwise the dashboard shows in-progress uploads that no longer exist in S3.',
          ],
        },
      ],
    },
    {
      title: 'How to prove that resuming works',
      blocks: [
        {
          type: 'paragraph',
          value:
            'A test that uploads a 1 MB file and checks that it arrived proves nothing about the original problem. What needs proving is that an interruption mid-upload does not force a restart, that a page reload finds the session again and that the final object is identical to the original file. The test uses a local MinIO as S3 compatible storage, a 200 MB file with random content and Playwright offline mode to drop the network halfway.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Scenario', 'How to simulate', 'Expected result'],
          rows: [
            ['Network drop mid-upload', 'context.setOffline(true) for a few seconds', 'In-flight parts are retried; no completed part is re-sent'],
            ['Tab closed and reopened', 'page.reload() and selecting the same file again', 'The client finds the session and sends only the missing parts'],
            ['Expired URL', 'Sign with expiresIn of 1 second in the test environment', '403 followed by a new signature and success on the next attempt'],
            ['Lost completion response', 'Call complete twice in a row', 'Both calls return the same key, with no error'],
            ['Declared size smaller than real size', 'Create the session with a fake size and send more parts', 'Completion returns 409 and the object is not created'],
            ['Abandoned upload', 'Create the session, send one part and never complete', 'The lifecycle rule removes the parts and the job marks the session as aborted'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'In production, the metric that matters is not the number of completed uploads, but the completion rate per created session and the number of retried parts per upload. On the course platform, after the change, the completion rate for files above 2 GB went from 69% to 99.4%, the average time between starting the upload and publishing the lesson dropped because nobody started from zero anymore, and the API pods no longer needed temporary disk. The remaining 0.6% were sessions abandoned on purpose, and the lifecycle rule took care of them.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'What if I do not use S3?',
      answer:
        'The idea is the same on any object storage, only the protocol changes. Google Cloud Storage offers resumable upload sessions: the server creates the session, the client uploads with Content-Range and, after a drop, queries the accepted offset with an empty PUT and Content-Range: bytes */size. In Azure Blob Storage, the equivalent is the blocks of a block blob, uploaded with Put Block and committed with Put Block List, authorized by a SAS. MinIO, Cloudflare R2 and other S3 compatible stores accept the code in this article with almost no changes. If the file has to go through your own server, the open tus protocol handles resuming over HTTP with ready-made client and server implementations.',
    },
    {
      question: 'How do I show fine-grained progress if fetch does not report upload progress?',
      answer:
        'With 8 MiB parts, progress per completed part is already fine-grained enough for most screens: a 4 GB file moves forward in 0.2% steps. If you need to update during each part, use XMLHttpRequest for the PUT, because it exposes upload.onprogress, and add the in-flight bytes of all active parts to the bytes of completed parts. Remember to subtract the bytes of a part that failed, otherwise the bar moves backwards or goes past 100%. Request body streaming in fetch exists in some browsers, but it requires HTTP/2 and does not yet have broad enough support to be the foundation of a critical flow.',
    },
    {
      question: 'Is multipart worth it for small files?',
      answer:
        'No. Below a few tens of megabytes, a simple PUT with a presigned URL is faster, simpler and has a negligible chance of failure. Multipart adds at least three API calls and requires cleaning up orphan parts. A common rule is to use a single PUT up to 50 or 100 MB and multipart above that, with the server deciding when the session is created. What applies at any size is taking the API out of the byte path, because that frees the application connections, disk and bandwidth.',
    },
  ],
  conclusion: {
    title: 'A large upload is not a timeout problem, it is a shape problem',
    description:
      'Sending the whole file in a single request that goes through the API works with test files and fails, silently and repeatedly, for the people with the largest file and the worst network. Raising timeouts only moves the place where the connection drops. The fix is changing the shape of the upload: presigned URLs so the bytes go straight to storage, multipart so each part fails and is re-sent on its own, a server-side session that makes the upload resumable from any tab and a completion step that checks in S3 what actually arrived. With CORS, lifecycle and content validation handled, and a test that drops the network halfway, 99% stops being the place where uploads die. I can review the upload flow in your system, implement direct and resumable uploads and build the tests that prove it survives a bad network.',
    cta: 'Talk about the uploads in my system',
  },
  related: [
    {
      label: 'The report export that takes the server down: streaming large files without running out of memory',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Payload size limits: when the legitimate request starts getting refused',
      to: '/blog/limite-tamanho-payload-quando-requisicao-legitima-passa-a-ser-recusada',
    },
    {
      label: 'Backend architecture and modernization',
      to: '/services/arquitetura-e-modernizacao-backend',
    },
  ],
};

const es = {
  intro:
    'Una plataforma de cursos en línea tenía un panel donde los instructores subían sus videoclases, archivos de 2 a 6 GB grabados en casa. Durante meses, soporte recibió el mismo ticket con distintas palabras: la subida se quedó trabada en el 99%. Cuando el equipo finalmente lo midió, el 31% de los intentos por encima de 2 GB fallaba, el promedio era de 2,4 intentos por clase publicada y un instructor había intentado nueve veces el mismo archivo un sábado por la noche, empezando de cero cada vez. El código no tenía ningún error evidente: un formulario con un campo de archivo, un endpoint con multer que grababa en disco y un PutObject a S3 al final. Funcionaba perfectamente en staging, con videos de 50 MB en la red de la oficina. El defecto era de arquitectura: el archivo entero atravesaba la API en una sola petición, y cualquier interrupción, en cualquier punto de una subida de cuarenta minutos, tiraba todo a la basura. Este artículo explica por qué la subida grande falla justo al final, cómo sacar la API del camino de los bytes con URL prefirmadas, cómo dividir la subida en partes con el multipart upload de S3, cómo reanudar desde donde se detuvo después de un corte de red o de una pestaña cerrada, qué detalles rompen esta solución en producción y cómo demostrar con una prueba automatizada que la reanudación realmente funciona.',
  sections: [
    {
      title: 'Por qué la subida grande falla justo en el 99%',
      blocks: [
        {
          type: 'paragraph',
          value:
            'La versión con la que casi todo sistema empieza es esta: el navegador envía el archivo en un POST multipart/form-data, la API lo recibe, lo graba en disco y después lo manda al almacenamiento de objetos. Para archivos pequeños, es simple y suficiente. Para archivos grandes, concentra tres problemas en el mismo lugar.',
        },
        {
          type: 'code',
          value: naiveCode,
        },
        {
          type: 'paragraph',
          value:
            'El primero es el que explica el 99%. La barra de progreso del navegador, alimentada por el evento upload.onprogress, mide bytes entregados a la pila de red, no bytes procesados por el servidor. Llega al final cuando el último byte sale de la máquina del usuario, pero la respuesta solo llega después de que la API reenvía los mismos gigabytes a S3. En ese intervalo, la conexión entre el navegador y el balanceador queda inactiva, sin tráfico en ningún sentido. En la plataforma de cursos, el balanceador tenía un timeout de inactividad de 60 segundos y reenviar 4 GB a S3 tardaba de dos a cuatro minutos. El usuario veía 99%, después un error, y a veces el video incluso llegaba al bucket, pero sin registro en la base de datos, porque la petición se había cortado antes del final del handler.',
        },
        {
          type: 'paragraph',
          value:
            'El segundo es la probabilidad. Una subida única necesita que la conexión sobreviva del primer al último byte. Si la probabilidad de una interrupción en un minuto cualquiera es pequeña, como un cambio de Wi-Fi, una laptop que entra en suspensión o un proxy corporativo que corta conexiones largas, se acumula con la duración. La tabla supone un 2% de probabilidad de interrupción por minuto y una conexión de subida de 5 Mbit/s, valores comunes en internet residencial.',
        },
        {
          type: 'table',
          columns: ['Archivo', 'Tiempo de subida a 5 Mbit/s', 'Probabilidad de terminar en una subida única', 'Pérdida máxima por corte con partes de 8 MiB y 4 en paralelo'],
          rows: [
            ['100 MB', 'Unos 3 minutos', '95%', '32 MiB'],
            ['1 GB', 'Unos 27 minutos', '58%', '32 MiB'],
            ['2 GB', 'Unos 55 minutos', '33%', '32 MiB'],
            ['5 GB', 'Unas 2 horas y 16 minutos', '6%', '32 MiB'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tercero es el costo del fallo. Sin reanudación, cada intento empieza de nuevo desde el byte cero, y quien más necesita reintentar es justamente quien tiene la red más inestable y el archivo más grande. Además, la API pasa a cargar con el peso de todas las subidas: conexiones abiertas durante decenas de minutos, disco temporal que se llena y ancho de banda de salida pagado dos veces, una para recibir y otra para reenviar. La corrección no es aumentar timeouts. Es cambiar la forma de la subida en dos movimientos: sacar la API del camino de los bytes y dividir el archivo en partes que pueden fallar y reenviarse de forma independiente.',
        },
      ],
    },
    {
      title: 'Sacar la API del camino de los bytes con URL prefirmadas',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una URL prefirmada es una autorización temporal para una única operación sobre un único objeto, firmada con las credenciales del servidor. La API decide quién puede subir qué, genera la URL y la devuelve al navegador, que hace el PUT directo a S3. La API sigue siendo dueña de las reglas, como autenticación, tamaño máximo, cuota y nombre del objeto, pero no toca ningún byte del archivo. El balanceador y los pods de la aplicación dejan de ver conexiones de cuarenta minutos.',
        },
        {
          type: 'paragraph',
          value:
            'Una URL prefirmada para un PutObject simple ya resuelve el problema del 99% y le quita carga a la API, pero sigue siendo una subida única: un corte en el minuto 38 sigue tirando todo a la basura. El multipart upload resuelve la otra mitad. El archivo se divide en partes numeradas, cada parte es un PUT independiente con su propia URL firmada, y S3 guarda las partes recibidas hasta que alguien pida completar o abortar. Una parte que falla se reenvía sola, y partes distintas pueden subir en paralelo.',
        },
        {
          type: 'diagram',
          value: flowDiagramEs,
        },
        {
          type: 'table',
          columns: ['Regla del multipart upload en S3', 'Valor', 'Consecuencia en el diseño'],
          rows: [
            ['Tamaño mínimo de parte', '5 MiB, excepto la última', 'Las partes demasiado pequeñas se rechazan al completar, no al subir'],
            ['Tamaño máximo de parte', '5 GiB', 'Nunca es el límite práctico: las partes grandes pierden la ventaja de reanudar'],
            ['Cantidad de partes', 'De 1 a 10.000', 'El tamaño de la parte tiene que crecer con el archivo'],
            ['Partes por página en ListParts', 'Hasta 1.000', 'El listado tiene que paginar para archivos con más de 1.000 partes'],
            ['Partes de una subida no completada', 'Quedan almacenadas y se cobran', 'Exige una regla de ciclo de vida para abortar lo que quedó atrás'],
            ['Validez de la URL firmada', 'Hasta 7 días, limitada por la credencial que firmó', 'Con credenciales temporales de un rol, la URL muere junto con la sesión'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'El tamaño de la parte es un equilibrio entre retrabajo y cantidad de peticiones. Partes de 8 MiB significan que un corte pierde como máximo 8 MiB por envío en curso, y un archivo de 4 GB genera 512 PUT. Partes de 100 MiB reducen las peticiones, pero cada fallo en una red lenta cuesta minutos. Para subidas desde el navegador, 8 a 16 MiB suele ser el punto de equilibrio, aumentando solo cuando el archivo superaría las 10.000 partes.',
        },
      ],
    },
    {
      title: 'El servidor: sesión de subida, firma por parte y finalización verificada',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El servidor tiene cinco responsabilidades: crear la sesión de subida y registrarla en la base de datos, firmar URL para partes específicas, informar qué partes ya llegaron, completar verificando lo que está en S3 y abortar cuando el usuario desiste. La sesión en la base de datos guarda el UploadId de S3, la clave del objeto, el tamaño declarado y el tamaño de parte calculado, y eso es lo que permite reanudar desde otro dispositivo, otra pestaña o días después.',
        },
        {
          type: 'code',
          value: serverCode,
        },
        {
          type: 'paragraph',
          value:
            'Tres decisiones de este código importan más de lo que parece. La primera es que la finalización usa ListParts y no los ETag enviados por el navegador. El cliente no es una fuente confiable sobre lo que se almacenó, y la verificación de la cantidad de partes y de la suma de los tamaños garantiza que el objeto final tiene exactamente el tamaño declarado al crearlo, lo que impide que alguien cree una sesión de 10 MB para pasar la cuota y suba 10 GB. La segunda es que la finalización es idempotente: si la respuesta se pierde en el camino y el navegador repite la llamada, la segunda devuelve el mismo resultado en lugar de fallar porque el UploadId ya no existe.',
        },
        {
          type: 'paragraph',
          value:
            'La tercera es que las URL se firman bajo demanda, para pocas partes a la vez y con validez de 15 minutos. Firmar las 512 partes al crear la sesión parece más eficiente, pero produce URL que caducan antes de usarse en conexiones lentas y le entrega al navegador autorización de escritura durante horas. La opción requestChecksumCalculation: WHEN_REQUIRED también merece atención: versiones recientes del AWS SDK para JavaScript empezaron a incluir parámetros de checksum en las URL firmadas de UploadPart, calculados sobre un cuerpo vacío, y S3 rechaza el PUT del navegador con el contenido real. Es el tipo de rotura que aparece después de actualizar una dependencia, sin ningún cambio en tu código.',
        },
      ],
    },
    {
      title: 'El cliente: subir en partes, reintentar y reanudar después de cerrar la pestaña',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En el navegador, File.slice crea una referencia a un intervalo del archivo sin leer el contenido a memoria, así que enviar una parte de 8 MiB de un video de 6 GB cuesta 8 MiB, no 6 GB. El cliente de abajo envía cuatro partes en paralelo, reintenta cada parte con backoff exponencial y jitter, espera a que vuelva la red antes de insistir y guarda la sesión en localStorage para reanudar después de recargar la página.',
        },
        {
          type: 'code',
          value: clientCode,
        },
        {
          type: 'list',
          items: [
            'La reanudación le pregunta al servidor qué partes existen, en lugar de confiar en un progreso guardado localmente. Una parte puede haber llegado a S3 con la respuesta perdida en el camino, y un progreso local diría que falta; ListParts dice la verdad.',
            'Cada intento pide una URL nueva. Eso cuesta una llamada ligera a la API por parte, pero elimina toda la clase de fallos por URL caducada en redes lentas o después de que la laptop se suspenda en medio de la subida.',
            'Los errores 4xx son definitivos, excepto 403, que aquí significa URL caducada o reloj del cliente adelantado, 408 y 429. Reintentar un 400 o un 413 solo retrasa el mensaje de error y esconde el defecto.',
            'El jitter en el backoff evita que miles de navegadores que perdieron la conexión al mismo tiempo, por ejemplo durante una inestabilidad del proveedor, vuelvan todos en el mismo segundo.',
            'La huella usa nombre, tamaño y fecha de modificación. No es un hash del contenido, porque calcular SHA-256 de 6 GB en el navegador antes de empezar tardaría minutos; es suficiente para reencontrar la sesión cuando el usuario elige el mismo archivo otra vez.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La concurrencia de cuatro partes no es arbitraria. En conexiones residenciales, el ancho de banda de subida suele ser el cuello de botella, y más conexiones en paralelo solo reparten el mismo ancho de banda, aumentando el retrabajo en caso de corte. En redes corporativas rápidas, seis a ocho partes en paralelo pueden aprovechar mejor el ancho de banda. Lo ideal es medir el throughput de las primeras partes y ajustar, pero un valor fijo entre tres y seis ya resuelve la mayoría de los casos.',
        },
      ],
    },
    {
      title: 'Los detalles que rompen la subida en producción',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El flujo básico funciona el primer día. Los problemas aparecen semanas después, en lugares que no están en el camino feliz.',
        },
        {
          type: 'code',
          value: infraCode,
        },
        {
          type: 'list',
          items: [
            'CORS. El PUT sale del dominio de la aplicación hacia el dominio del bucket, y sin una regla de CORS el navegador bloquea la petición antes de enviar el cuerpo. La regla debe listar los orígenes reales de la aplicación, no un asterisco. Si el cliente necesita leer el ETag de la respuesta, la cabecera tiene que estar en ExposeHeaders; en el diseño de este artículo no hace falta, porque el servidor lista las partes.',
            'Las partes huérfanas cuestan dinero. Una subida abandonada a la mitad no aparece en el listado de objetos del bucket, pero sus partes siguen almacenadas y cobradas indefinidamente. La regla de ciclo de vida AbortIncompleteMultipartUpload es obligatoria, y su plazo define durante cuánto tiempo el usuario puede reanudar.',
            'El reloj del cliente no importa, el del servidor sí. La firma usa la hora de quien firma. Un servidor con el reloj atrasado genera URL que S3 considera caducadas o todavía no válidas, y el síntoma es un 403 intermitente que solo ocurre en una de las instancias.',
            'Las credenciales temporales acortan la validez. Si la API corre con un rol, como en ECS, EKS o Lambda, la URL firmada deja de valer cuando caduca la credencial temporal, aunque el expiresIn sea mayor. Es un motivo más para firmar bajo demanda y con validez corta.',
            'Completar no es validar. El objeto final puede ser cualquier cosa que el usuario quiso subir. Genera la clave en el servidor, graba en un prefijo de cuarentena, verifica el tipo real por los primeros bytes y pasa un antivirus en un job asíncrono antes de liberar el archivo a otros usuarios o al procesamiento.',
            'Integridad de punta a punta. TLS protege el tránsito y S3 compara el Content-MD5 cuando se envía, pero nada en el flujo básico demuestra que el archivo final es idéntico al del disco del usuario. Cuando eso importa, como en archivos fiscales o datos de salud, usa checksums por parte con el algoritmo de checksum del multipart y compáralos en el servidor.',
            'Sesiones atascadas en la base de datos. Las subidas con estado enviando por más tiempo que el plazo de la regla de ciclo de vida deben marcarse como abortadas por un job periódico, o el panel mostrará subidas en curso que ya no existen en S3.',
          ],
        },
      ],
    },
    {
      title: 'Cómo demostrar que la reanudación funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Una prueba que sube un archivo de 1 MB y verifica que llegó no demuestra nada sobre el problema original. Lo que hay que demostrar es que una interrupción a mitad de la subida no obliga a empezar de nuevo, que recargar la página reencuentra la sesión y que el objeto final es idéntico al archivo original. La prueba usa un MinIO local como almacenamiento compatible con S3, un archivo de 200 MB con contenido aleatorio y el modo offline de Playwright para cortar la red a mitad de camino.',
        },
        {
          type: 'code',
          value: testCode,
        },
        {
          type: 'table',
          columns: ['Escenario', 'Cómo simularlo', 'Resultado esperado'],
          rows: [
            ['Corte de red a mitad de la subida', 'context.setOffline(true) durante unos segundos', 'Las partes en curso se repiten; ninguna parte completada se reenvía'],
            ['Pestaña cerrada y reabierta', 'page.reload() y nueva selección del mismo archivo', 'El cliente reencuentra la sesión y envía solo las partes que faltan'],
            ['URL caducada', 'Firmar con expiresIn de 1 segundo en el entorno de pruebas', '403 seguido de una nueva firma y éxito en el intento siguiente'],
            ['Respuesta de finalización perdida', 'Llamar a concluir dos veces seguidas', 'Las dos llamadas devuelven la misma clave, sin error'],
            ['Tamaño declarado menor que el real', 'Crear la sesión con un tamaño falso y enviar más partes', 'La finalización devuelve 409 y el objeto no se crea'],
            ['Subida abandonada', 'Crear la sesión, enviar una parte y no completar', 'La regla de ciclo de vida elimina las partes y el job marca la sesión como abortada'],
          ],
        },
        {
          type: 'paragraph',
          value:
            'En producción, la métrica que importa no es la cantidad de subidas completadas, sino la tasa de finalización por sesión creada y la cantidad de partes repetidas por subida. En la plataforma de cursos, después del cambio, la tasa de finalización de archivos de más de 2 GB pasó del 69% al 99,4%, el tiempo promedio entre el inicio de la subida y la publicación de la clase bajó porque nadie empezaba de cero y los pods de la API dejaron de necesitar disco temporal. El 0,6% restante eran sesiones abandonadas a propósito, y la regla de ciclo de vida se encargó de ellas.',
        },
      ],
    },
  ],
  faq: [
    {
      question: '¿Y si no uso S3?',
      answer:
        'La idea es la misma en cualquier almacenamiento de objetos, solo cambia el protocolo. Google Cloud Storage ofrece sesiones de subida reanudable: el servidor crea la sesión, el cliente envía con Content-Range y, después de un corte, consulta el offset aceptado con un PUT vacío y Content-Range: bytes */tamaño. En Azure Blob Storage, el equivalente son los bloques de un block blob, enviados con Put Block y confirmados con Put Block List, autorizados por una SAS. MinIO, Cloudflare R2 y otros compatibles con S3 aceptan el código de este artículo casi sin cambios. Si el archivo tiene que pasar por tu propio servidor, el protocolo abierto tus resuelve la reanudación sobre HTTP con implementaciones listas de cliente y servidor.',
    },
    {
      question: '¿Cómo muestro un progreso fino si fetch no informa el progreso de la subida?',
      answer:
        'Con partes de 8 MiB, el progreso por parte completada ya es lo bastante fino para la mayoría de las pantallas: un archivo de 4 GB avanza de 0,2% en 0,2%. Si hace falta actualizar durante cada parte, usa XMLHttpRequest para el PUT, porque expone upload.onprogress, y suma los bytes en curso de todas las partes activas a los bytes de las partes ya completadas. Recuerda descontar los bytes de una parte que falló, o la barra retrocede o pasa del 100%. El streaming del cuerpo en fetch existe en algunos navegadores, pero exige HTTP/2 y todavía no tiene soporte lo bastante amplio para ser la base de un flujo crítico.',
    },
    {
      question: '¿Vale la pena usar multipart para archivos pequeños?',
      answer:
        'No. Por debajo de algunas decenas de megabytes, un PUT simple con URL prefirmada es más rápido, más simple y tiene una probabilidad de fallo despreciable. El multipart agrega al menos tres llamadas a la API y exige limpiar partes huérfanas. Una regla común es usar PUT único hasta 50 o 100 MB y multipart por encima de eso, con el servidor decidiendo al crear la sesión. Lo que vale para cualquier tamaño es sacar la API del camino de los bytes, porque eso libera conexiones, disco y ancho de banda de la aplicación.',
    },
  ],
  conclusion: {
    title: 'Una subida grande no es un problema de timeout, es un problema de forma',
    description:
      'Enviar el archivo entero en una petición que atraviesa la API funciona con archivos de prueba y falla, de forma silenciosa y repetida, para quien tiene el archivo más grande y la peor red. Aumentar los timeouts solo cambia el lugar donde se cae la conexión. La corrección es cambiar la forma de la subida: URL prefirmadas para que los bytes vayan directo al almacenamiento, multipart para que cada parte falle y se reenvíe sola, una sesión en el servidor que vuelve la subida reanudable desde cualquier pestaña y una finalización que verifica en S3 lo que realmente llegó. Con CORS, ciclo de vida y validación de contenido resueltos, y una prueba que corta la red a mitad de camino, el 99% deja de ser el lugar donde la subida muere. Puedo revisar el flujo de subida de tu sistema, implementar la subida directa y reanudable y montar las pruebas que demuestran que sobrevive a una red mala.',
    cta: 'Hablar sobre las subidas de mi sistema',
  },
  related: [
    {
      label: 'Exportación de informes que tumba el servidor: generar archivos grandes en streaming sin agotar la memoria',
      to: '/blog/exportacao-relatorio-que-derruba-servidor-arquivo-grande-em-streaming-sem-estourar-memoria',
    },
    {
      label: 'Límite de tamaño del payload: cuándo la petición legítima empieza a ser rechazada',
      to: '/blog/limite-tamanho-payload-quando-requisicao-legitima-passa-a-ser-recusada',
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
