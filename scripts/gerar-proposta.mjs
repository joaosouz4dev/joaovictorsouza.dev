import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const propostasDir = path.join(rootDir, 'propostas');
const clientesDir = path.join(propostasDir, 'clientes');
const modelo = path.join(propostasDir, 'modelo', 'proposta.html');

const uso = `Uso:
  npm run proposta -- nova <slug>     cria propostas/clientes/<slug>.html a partir do modelo
  npm run proposta -- <slug|arquivo>  gera o PDF ao lado do HTML`;

function encontrarNavegador() {
  const candidatos = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const navegador = candidatos.find((caminho) => caminho && existsSync(caminho));
  if (!navegador) {
    throw new Error('Chrome ou Edge não encontrado. Defina CHROME_PATH com o caminho do executável.');
  }
  return navegador;
}

function resolverHtml(alvo) {
  const candidatos = [
    path.resolve(alvo),
    path.join(clientesDir, alvo),
    path.join(clientesDir, `${alvo}.html`),
  ];
  const html = candidatos.find((caminho) => existsSync(caminho) && statSync(caminho).isFile());
  if (!html) throw new Error(`Proposta não encontrada: ${alvo}`);
  return html;
}

const [comando, argumento] = process.argv.slice(2);

if (!comando) {
  console.log(uso);
  process.exit(1);
}

if (comando === 'nova') {
  if (!argumento || !/^[a-z0-9-]+$/.test(argumento)) {
    throw new Error('Informe um slug em kebab-case, por exemplo: npm run proposta -- nova cliente-projeto');
  }
  const destino = path.join(clientesDir, `${argumento}.html`);
  if (existsSync(destino)) throw new Error(`Já existe: ${path.relative(rootDir, destino)}`);
  copyFileSync(modelo, destino);
  console.log(`Proposta criada: ${path.relative(rootDir, destino)}`);
  process.exit(0);
}

const html = resolverHtml(comando);
const pdf = html.replace(/\.html$/, '.pdf');
const navegador = encontrarNavegador();
const url = pathToFileURL(html).href;
const flags = ['--headless=new', '--disable-gpu', '--allow-file-access-from-files', '--virtual-time-budget=5000'];

execFileSync(navegador, [...flags, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, url], { stdio: 'ignore' });
console.log(`PDF gerado: ${path.relative(rootDir, pdf)} (${(statSync(pdf).size / 1024).toFixed(0)} KiB)`);

// proposta.js marca no <html> as páginas cujo conteúdo passou da área útil e seria cortado.
const dom = execFileSync(navegador, [...flags, '--dump-dom', url], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
  maxBuffer: 64 * 1024 * 1024,
});
const estouradas = dom.match(/data-estouradas="([^"]*)"/)?.[1];

if (estouradas === undefined) {
  console.warn('Aviso: proposta.js não rodou; cabeçalho, rodapé e ícones podem estar faltando.');
  process.exitCode = 1;
} else if (estouradas) {
  console.warn(`Aviso: conteúdo cortado na(s) página(s) ${estouradas}. Mova uma seção para outra página.`);
  process.exitCode = 1;
}
