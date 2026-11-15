// HTTP pomocník: timeout, opakování s prodlevou, obecný User-Agent (bez osobních údajů).
const UA = 'Mozilla/5.0 (compatible; BrownsCeskyBot/0.1; nekomercni fanouskovsky projekt)';

export async function fetchWithRetry(url, { tries = 3, timeoutMs = 20000, accept = '*/*', headers = {} } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: accept, ...headers },
        signal: ctrl.signal,
        redirect: 'follow',
      });
      if (res.status === 404 || res.status === 410) {
        throw Object.assign(new Error(`HTTP ${res.status} ${url}`), { permanent: true });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (err) {
      const cause = err.cause?.code || err.cause?.message;
      if (cause && !err.message.includes(cause)) err.message = `${err.message} (${cause})`;
      if (err.name === 'AbortError') err.message = `Časový limit ${timeoutMs} ms vypršel: ${url}`;
      lastErr = err;
      if (err.permanent || attempt === tries) break;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts = {}) {
  const res = await fetchWithRetry(url, { accept: 'application/json', ...opts });
  return res.json();
}

export async function fetchText(url, opts = {}) {
  const res = await fetchWithRetry(url, opts);
  return { text: await res.text(), finalUrl: res.url };
}

/** Projde seznam URL a vrátí první, která odpoví. */
export async function fetchFirst(urls, opts = {}) {
  const errors = [];
  for (const url of urls) {
    try {
      const { text, finalUrl } = await fetchText(url, opts);
      return { url, finalUrl, text };
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    }
  }
  const e = new Error(`Žádná URL neodpověděla – ${errors.join(' | ')}`);
  e.errors = errors;
  throw e;
}
