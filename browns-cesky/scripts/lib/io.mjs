// Sdílené I/O: čtení/zápis JSON dat webu a evidence stavu jednotlivých úloh.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..');
export const DATA_DIR = path.join(ROOT, 'site', 'data');
export const CONFIG_DIR = path.join(ROOT, 'config');

export async function readJson(file, fallback = null) {
  const p = path.isAbsolute(file) ? file : path.join(DATA_DIR, file);
  if (!existsSync(p)) return fallback;
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch (err) {
    console.warn(`[io] Nelze přečíst ${p}: ${err.message}`);
    return fallback;
  }
}

/** Atomický zápis – web nikdy neuvidí napůl zapsaný soubor. */
export async function writeJson(file, data) {
  const p = path.isAbsolute(file) ? file : path.join(DATA_DIR, file);
  await mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await rename(tmp, p);
}

export async function loadConfig() {
  return readJson(path.join(CONFIG_DIR, 'sources.json'));
}

/**
 * Stav úloh (site/data/status.json). Každá úloha má:
 *  - lastAttemptAt, lastSuccessAt, ok, message, details
 * Při chybě se NEPŘEPISUJÍ data, jen se zapíše neúspěšný pokus –
 * web pak transparentně ukáže, že data jsou starší.
 */
export async function recordStatus(task, { ok, message = '', details = undefined, origin = 'automatika' }) {
  const status = (await readJson('status.json', null)) || { tasks: {} };
  const now = new Date().toISOString();
  const prev = status.tasks[task] || {};
  status.tasks[task] = {
    ...prev,
    lastAttemptAt: now,
    ok,
    message,
    origin,
    ...(ok ? { lastSuccessAt: now } : {}),
    ...(details !== undefined ? { details } : {}),
  };
  status.updatedAt = now;
  await writeJson('status.json', status);
  return status.tasks[task];
}

export function log(scope, ...args) {
  console.log(`[${new Date().toISOString()}] [${scope}]`, ...args);
}
