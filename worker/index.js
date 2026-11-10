// radiologyos.tech — Cloudflare Worker of the public site (made by radiology-next: scripts/export-site.mjs, edge/).
// Serves the snapshot of the site (public/: pages already filled with hours, texts and prices from the CRM, and the
// read-only public APIs as JSON). Live parts go on to the department server (env.ORIGIN, its gate) when it is
// configured; otherwise (the current setup) they answer «offline».
// If the server cannot be reached, the site still opens; the booking form then sends the request by messenger only.

// Live paths → the department's server.
const LIVE = /^\/(api\/(availability|site-requests|analytics)$|stats\/)/;
// Read-only public APIs → snapshot files.
const SNAPSHOT_APIS = new Set(['/api/public-services', '/api/public-hours', '/api/public-content', '/api/site-content', '/api/department-profile', '/api/tariffs']);
// Old addresses of the site.
const REDIRECTS = {
  '/index.html': '/', '/site': '/', '/site/': '/', '/site/index.html': '/',
  '/fluorography': '/site/price.html#fluorography', '/xray': '/site/price.html#xray',
  '/ct': '/site/price.html#ct', '/ct/contrast': '/site/price.html#ct-contrast',
  '/favicon.ico': '/site/assets/icon.svg', '/price': '/site/price.html', '/military': '/site/military.html'
};
// Staff pages live only in the department's network.
const STAFF = /^\/(admin|app|login|cabinet)(\/|$)|^\/site\/cabinet\.html$/;

const SECURITY = {
  'content-security-policy': [
    "default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "object-src 'none'",
    "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:", "connect-src 'self'", "font-src 'self' data: https://fonts.gstatic.com"
  ].join('; '),
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

function secure(response, { cache } = {}) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
  if (cache) r.headers.set('cache-control', cache);
  return r;
}
const json = (status, body) => secure(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }), { cache: 'no-store' });

async function asset(env, request, pathname, { type, cache = 'no-cache' } = {}) {
  const url = new URL(request.url);
  url.pathname = pathname; url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: request.headers }));
  if (res.status === 404) return null;
  const out = secure(res, { cache });
  if (type) out.headers.set('content-type', type);
  return out;
}

const STAFF_PAGE = `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Вхід для персоналу</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#eef4f1;color:#18221f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border-radius:18px;padding:28px;max-width:440px;box-shadow:0 10px 30px rgba(0,0,0,.08)}a{color:#0f6b6f;font-weight:700}</style></head>
<body><main><h1 style="margin-top:0;font-size:22px">Вхід для персоналу</h1><p>Робочий кабінет відділення (розклад, заявки, прайс) доступний лише з комп’ютерів у мережі відділення.</p><p><a href="/">← На головну сторінку</a></p></main></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (url.hostname.startsWith('www.')) { url.hostname = url.hostname.slice(4); return Response.redirect(url.toString(), 301); }

    if (LIVE.test(p)) {
      // Pass on to the department's server (env.ORIGIN — its public gate). Not configured, server down → «offline»:
      // the booking form then sends the request by messenger.
      if (!env.ORIGIN) return json(503, { error: 'offline', message: 'Live booking is not connected.' });
      try {
        const target = new URL(p + url.search, env.ORIGIN);
        // The server checks that a write comes from its own address: a request from this site gets the server's
        // origin instead (only when the browser said it came from here); the patient's address for rate limits.
        const headers = new Headers();
        for (const h of ['content-type', 'accept', 'accept-language', 'user-agent', 'referer']) if (request.headers.has(h)) headers.set(h, request.headers.get(h));
        const from = request.headers.get('origin');
        if (from && from !== url.origin) return json(403, { error: 'cross_site_request' });
        if (from) headers.set('origin', target.origin);
        headers.set('x-site-client-ip', request.headers.get('cf-connecting-ip') || '');
        const init = { method: request.method, headers, redirect: 'manual' };
        if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
        const r = await fetch(target.toString(), init);
        if ([502, 503, 504, 521, 522, 523, 524, 530].includes(r.status)) return json(503, { error: 'offline', message: 'The department server is not reachable right now.' });
        const out = secure(r); out.headers.delete('set-cookie'); return out;
      } catch {
        return json(503, { error: 'offline', message: 'The department server is not reachable right now.' });
      }
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' });
    if (SNAPSHOT_APIS.has(p)) return (await asset(env, request, `/snapshot${p}.json`, { type: 'application/json; charset=utf-8' })) || json(404, { error: 'not_found' });
    if (REDIRECTS[p]) return secure(Response.redirect(new URL(REDIRECTS[p], url.origin).toString(), 301));
    // Staff sign-in and the CRM: on the department's server (its address from the internet) when connected.
    if (STAFF.test(p) && env.ORIGIN && !p.includes('cabinet')) return secure(Response.redirect(new URL(p + url.search, env.ORIGIN).toString(), 302), { cache: 'no-store' });
    if (STAFF.test(p)) return secure(new Response(STAFF_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } }), { cache: 'no-store' });
    if (p === '/') return (await asset(env, request, '/site/index.html', { type: 'text/html; charset=utf-8' }));
    if (p.startsWith('/snapshot/')) return json(404, { error: 'not_found' });
    const found = await asset(env, request, p);
    if (found) return found;
    return secure(new Response('Сторінку не знайдено. <a href="/">На головну</a>', { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }), { cache: 'no-store' });
  }
};
