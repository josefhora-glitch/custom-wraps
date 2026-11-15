// Sestaví statický snímek webu pro soukromý náhled (claude.ai Artifact):
// stránka bez <html>/<head>/<body> obalu + přiložené soubory. Použití: node scripts/build-artifact.mjs <výstupní-složka>
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './lib/io.mjs';

const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist-artifact'));
await mkdir(out, { recursive: true });
let html = await readFile(path.join(ROOT, 'site', 'index.html'), 'utf8');
html = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
await writeFile(path.join(out, 'index.html'), html);
await cp(path.join(ROOT, 'site', 'assets'), path.join(out, 'assets'), { recursive: true });
await cp(path.join(ROOT, 'site', 'data'), path.join(out, 'data'), { recursive: true });
console.log(out);
