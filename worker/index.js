/**
 * StoryRower token service (Cloudflare Worker).
 *
 * Google only hands a web app a refresh token – the key that keeps someone signed in for good –
 * in exchange for the client secret, and a static site cannot keep a secret. This worker keeps it
 * and does the two calls that need it:
 *
 *   POST /token    { code, redirect_uri } → { access_token, expires_in, refresh_token, scope }
 *   POST /refresh  { refresh_token }      → { access_token, expires_in, scope }
 *
 * It stores nothing. The refresh token lives on the device; without the secret it is useless, and
 * this worker only answers the StoryRower pages (ALLOWED_ORIGINS).
 *
 * Settings: GOOGLE_CLIENT_ID and ALLOWED_ORIGINS in wrangler.toml, the secret with
 * `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
 */

const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export default {
  async fetch(request, env) {
    const origins = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') ?? '';
    const allowed = origins.includes(origin);
    const cors = allowed
      ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }
      : {};
    const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return reply({ error: 'origin_not_allowed' }, 403);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405);

    let body;
    try { body = await request.json(); } catch { return reply({ error: 'invalid_request' }, 400); }
    const path = new URL(request.url).pathname;

    const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
    if (path === '/token') {
      // the redirect must lead back to one of the StoryRower pages
      const uri = String(body.redirect_uri ?? '');
      if (!body.code || !origins.some((o) => uri.startsWith(o + '/'))) return reply({ error: 'invalid_request' }, 400);
      params.set('grant_type', 'authorization_code');
      params.set('code', String(body.code));
      params.set('redirect_uri', uri);
    } else if (path === '/refresh') {
      if (!body.refresh_token) return reply({ error: 'invalid_request' }, 400);
      params.set('grant_type', 'refresh_token');
      params.set('refresh_token', String(body.refresh_token));
    } else {
      return reply({ error: 'not_found' }, 404);
    }

    const res = await fetch(GOOGLE_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
    const data = await res.json().catch(() => ({ error: 'bad_response' }));
    // pass on only what the app needs (never an id_token or anything else Google adds)
    const { access_token, expires_in, refresh_token, scope, error, error_description } = data;
    return reply(res.ok ? { access_token, expires_in, refresh_token, scope } : { error, error_description }, res.ok ? 200 : res.status);
  },
};
