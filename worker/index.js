// radiologyos.tech — Cloudflare Worker of the public site (made by radiology-next: scripts/export-site.mjs, edge/).
// Public pages: the snapshot (public/: pages already filled with hours, texts and prices from the CRM, and the
// read-only public APIs as JSON) — they open even when the department's server is off.
// Through the department's server (env.ORIGIN — its Cloudflare Tunnel address), when it is configured:
//   live booking parts (free hours, saving a request, visit statistics) — without cookies;
//   the staff cabinet (sign-in, /admin, its APIs and the site editor's frame ?edit=1) — with its session cookie,
//   on this same address. Server not reachable → booking by messenger, the cabinet says it is unavailable.

// Live booking paths → the server.
const LIVE = /^\/(api\/(availability|site-requests|analytics)$|stats\/)/;
// Staff cabinet → the server (with cookies).
const STAFF_PROXY = /^\/(admin(\/.*)?|login(\.html)?|api\/(auth|admin)\/.+|brand\/.+|_external\/.+)$/;
// Read-only public APIs → snapshot files.
const SNAPSHOT_APIS = new Set(['/api/public-services', '/api/public-hours', '/api/public-content', '/api/site-content', '/api/department-profile', '/api/tariffs']);
// Old addresses of the site.
const REDIRECTS = {
  '/index.html': '/', '/site': '/', '/site/': '/', '/site/index.html': '/',
  '/fluorography': '/site/price.html#fluorography', '/xray': '/site/price.html#xray',
  '/ct': '/site/price.html#ct', '/ct/contrast': '/site/price.html#ct-contrast',
  '/favicon.ico': '/site/assets/icon.svg', '/price': '/site/price.html', '/military': '/site/military.html'
};
// Old application's staff and patient-cabinet addresses (not part of the new site).
const STAFF = /^\/(admin|app|login|cabinet)(\/|$)|^\/site\/cabinet\.html$/;
const OFFLINE_STATUS = [502, 503, 504, 521, 522, 523, 524, 530];

const SECURITY = {
  'content-security-policy': [
    "default-src 'self'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "object-src 'none'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:", "connect-src 'self' https://cloudflareinsights.com", "font-src 'self' data: https://fonts.gstatic.com"
  ].join('; '),
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

function secure(response, { cache } = {}) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
  if (cache) r.headers.set('cache-control', cache);
  return r;
}
const json = (status, body) => secure(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } }), { cache: 'no-store' });
const html = (status, body) => secure(new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' } }), { cache: 'no-store' });

async function asset(env, request, pathname, { type, cache = 'no-cache' } = {}) {
  const url = new URL(request.url);
  url.pathname = pathname; url.search = '';
  const res = await env.ASSETS.fetch(new Request(url.toString(), { method: request.method === 'HEAD' ? 'HEAD' : 'GET', headers: request.headers }));
  if (res.status === 404) return null;
  const out = secure(res, { cache });
  if (type) out.headers.set('content-type', type);
  return out;
}

// Pass a request on to the department's server. The server checks that a write comes from its own address: a
// request from this site gets the server's origin instead (only when the browser said it came from here).
// The visitor's address goes along for the server's rate limits. null — the server is not reachable.
// timeoutMs: how long to wait for the server — a stuck server must not keep the patient's form «checking» for minutes;
// after it the site falls back (booking by messenger / «кабінет недоступний»).
async function toServer(request, env, url, { cookies, timeoutMs = 8000 }) {
  const target = new URL(url.pathname + url.search, env.ORIGIN);
  const headers = new Headers();
  for (const h of ['content-type', 'accept', 'accept-language', 'user-agent', 'referer', ...(cookies ? ['cookie'] : [])]) if (request.headers.has(h)) headers.set(h, request.headers.get(h));
  const from = request.headers.get('origin');
  if (from && from !== url.origin) return 'cross-site';
  if (from) headers.set('origin', target.origin);
  headers.set('x-site-client-ip', request.headers.get('cf-connecting-ip') || '');
  const init = { method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  try {
    const r = await fetch(target.toString(), init);
    if (OFFLINE_STATUS.includes(r.status)) return null;
    const out = new Response(r.body, r);
    if (!cookies) out.headers.delete('set-cookie');
    // Redirects inside the cabinet stay on this address.
    const loc = out.headers.get('location');
    if (loc && loc.startsWith(target.origin)) out.headers.set('location', url.origin + loc.slice(target.origin.length));
    out.headers.set('strict-transport-security', 'max-age=31536000');
    return out;
  } catch {
    return null;
  }
}

const STAFF_PAGE = (text) => `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Вхід для персоналу</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#eef4f1;color:#18221f;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{background:#fff;border-radius:18px;padding:28px;max-width:440px;box-shadow:0 10px 30px rgba(0,0,0,.08)}a{color:#0f6b6f;font-weight:700}</style></head>
<body><main><h1 style="margin-top:0;font-size:22px">Вхід для персоналу</h1><p>${text}</p><p><a href="/">← На головну сторінку</a></p></main></body></html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (url.hostname.startsWith('www.')) { url.hostname = url.hostname.slice(4); return Response.redirect(url.toString(), 301); }

    if (LIVE.test(p)) {
      if (!env.ORIGIN) return json(503, { error: 'offline', message: 'Live booking is not connected.' });
      const r = await toServer(request, env, url, { cookies: false });
      if (r === 'cross-site') return json(403, { error: 'cross_site_request' });
      return r ? secure(r) : json(503, { error: 'offline', message: 'The department server is not reachable right now.' });
    }
    if (env.ORIGIN && (STAFF_PROXY.test(p) || (url.searchParams.has('edit') && request.method === 'GET'))) {
      const r = await toServer(request, env, url, { cookies: true, timeoutMs: 25000 });
      if (r === 'cross-site') return json(403, { error: 'cross_site_request' });
      if (r) return r;
      return p.startsWith('/api/') ? json(503, { error: 'offline', message: 'Сервер відділення зараз недоступний.' })
        : html(503, STAFF_PAGE('Робочий кабінет зараз недоступний: сервер відділення не відповідає. Спробуйте пізніше або увійдіть з комп’ютера у мережі відділення.'));
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(405, { error: 'method_not_allowed' });
    if (SNAPSHOT_APIS.has(p)) return (await asset(env, request, `/snapshot${p}.json`, { type: 'application/json; charset=utf-8' })) || json(404, { error: 'not_found' });
    if (REDIRECTS[p]) return secure(Response.redirect(new URL(REDIRECTS[p], url.origin).toString(), 301));
    if (STAFF.test(p)) return html(200, STAFF_PAGE('Робочий кабінет відділення (розклад, заявки, прайс) доступний лише з комп’ютерів у мережі відділення.'));
    if (p === '/') return (await asset(env, request, '/site/index.html', { type: 'text/html; charset=utf-8' }));
    if (p.startsWith('/snapshot/')) return json(404, { error: 'not_found' });
    const found = await asset(env, request, p);
    if (found) return found;
    return html(404, 'Сторінку не знайдено. <a href="/">На головну</a>');
  }
};
