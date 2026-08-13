import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(rootDir, 'build');
const html = await readFile(path.join(buildDir, 'index.html'), 'utf8');

if (html.includes('UA-137534207-1') || html.includes('googletagmanager.com/gtag')) {
  throw new Error('O build voltou a carregar o Google Universal Analytics descontinuado.');
}

const polyfillPosition = html.indexOf('Array.prototype.at');
const entryMatch = html.match(/<script type="module"[^>]+src="([^"]+)"/);

if (polyfillPosition === -1 || !entryMatch || polyfillPosition > html.indexOf(entryMatch[0])) {
  throw new Error('O polyfill de Array.prototype.at precisa preceder o bundle principal.');
}

const entryPath = path.join(buildDir, entryMatch[1].replace(/^\//, ''));
const { size } = await stat(entryPath);
const maxEntryBytes = 320_000;

if (size > maxEntryBytes) {
  throw new Error(
    `Bundle de entrada com ${(size / 1024).toFixed(1)} KiB; limite: ${(maxEntryBytes / 1024).toFixed(1)} KiB.`,
  );
}

console.log(`Performance budget OK: bundle de entrada ${(size / 1024).toFixed(1)} KiB.`);
