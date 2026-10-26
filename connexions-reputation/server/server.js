/* Connexions Reputation server: serves the app and sends SMS through Twilio or Txtria.
 * Zero dependencies (Node 20.12+). Provider and credentials come from server/.env:
 *   SMS_PROVIDER=twilio | txtria | test     (test = log only, nothing is sent)
 * Run: node server/server.js   (from the connexions-reputation folder or anywhere)
 *
 * Routes
 *   GET  /api/sms/status            provider + whether it's configured (needs access key)
 *   POST /api/sms/send  {to, body}  send one text (needs access key)
 *   GET  /api/sms/optouts           numbers that replied STOP (needs access key)
 *   POST /api/sms/inbound?token=..  provider webhook for replies (STOP / START handling)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const APP_DIR = path.resolve(SERVER_DIR, '..');
const ENV_FILE = path.join(SERVER_DIR, '.env');
const OPTOUT_FILE = path.join(SERVER_DIR, 'optouts.json');
const SEND_LOG = path.join(SERVER_DIR, 'sends.log');
const INBOUND_LOG = path.join(SERVER_DIR, 'inbound.log');

if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const env = (k, d = '') => (process.env[k] || d).trim();
const PORT = Number(env('PORT', '8820'));
const HOST = env('HOST', '127.0.0.1');
const ACCESS_KEY = env('ACCESS_KEY');
const INBOUND_TOKEN = env('INBOUND_TOKEN');
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);

// CTIA standard keywords.
const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];

// ---------- helpers ----------
function e164(num) {
  const s = String(num || '').trim();
  const d = s.replace(/\D/g, '');
  if (s.startsWith('+') && d.length >= 8) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return null;
}
function readJSON(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function logLine(file, obj) { fs.appendFile(file, JSON.stringify(Object.assign({ at: new Date().toISOString() }, obj)) + '\n', () => {}); }
function maskNum(n) { return n ? String(n).replace(/\d(?=\d{4})/g, '*') : ''; }

function send(res, code, obj, headers) {
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function parseBody(raw, type) {
  if (!raw) return {};
  if (/json/i.test(type || '')) { try { return JSON.parse(raw); } catch (e) { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (ALLOWED_ORIGINS.length && !ALLOWED_ORIGINS.includes(origin)) return {};
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'content-type,x-cx-key', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
}
function authed(req) { return ACCESS_KEY && req.headers['x-cx-key'] === ACCESS_KEY; }

// ---------- providers ----------
const PROVIDERS = {
  twilio: {
    label: 'Twilio',
    config: () => ({ sid: env('TWILIO_ACCOUNT_SID'), token: env('TWILIO_AUTH_TOKEN'), from: env('TWILIO_FROM') }),
    missing: (c) => ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'].filter((k, i) => !Object.values(c)[i]),
    async send(c, to, body) {
      const form = new URLSearchParams({ To: to, Body: body });
      // A Messaging Service SID (MG...) goes in MessagingServiceSid instead of From.
      if (/^MG/.test(c.from)) form.set('MessagingServiceSid', c.from); else form.set('From', e164(c.from) || c.from);
      const r = await fetch('https://api.twilio.com/2010-04-01/Accounts/' + encodeURIComponent(c.sid) + '/Messages.json', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + Buffer.from(c.sid + ':' + c.token).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: j.message || 'Twilio HTTP ' + r.status, code: j.code || r.status };
      return { ok: true, id: j.sid, status: j.status };
    }
  },
  txtria: {
    label: 'Txtria',
    config: () => ({ sysId: env('TXTRIA_SYS_ID'), token: env('TXTRIA_AUTH_TOKEN'), from: env('TXTRIA_FROM') }),
    missing: (c) => ['TXTRIA_SYS_ID', 'TXTRIA_AUTH_TOKEN', 'TXTRIA_FROM'].filter((k, i) => !Object.values(c)[i]),
    async send(c, to, body) {
      // Per developer.txtria.com/sendsms: POST form fields; From is the 10-digit TxTRIA number.
      const form = new URLSearchParams({ cmd: 'send_sms', To: to, From: c.from.replace(/\D/g, '').slice(-10), Body: body, sys_id: c.sysId, auth_token: c.token });
      const r = await fetch('https://txtria.com/api/sendsms', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
      const j = await r.json().catch(() => ({}));
      if (String(j.success) === '1') return { ok: true, id: j.tracking_id, status: j.status || 'queued' };
      return { ok: false, error: j.message || 'Txtria HTTP ' + r.status, code: j.error || r.status };
    }
  },
  test: {
    label: 'Test mode (nothing is sent)',
    config: () => ({}),
    missing: () => [],
    async send(c, to, body) { return { ok: true, id: 'test-' + Date.now().toString(36), status: 'logged' }; }
  }
};
function provider() { return env('SMS_PROVIDER', 'test').toLowerCase(); }

// Retry once, but only if the connection never opened (the provider never saw the request),
// so a retry can't double-send. Seen 2026-10-25: txtria.com DNS briefly handed out dead IPs.
const CONNECT_ERRORS = ['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'];
async function sendWithRetry(P, c, to, body) {
  try { return await P.send(c, to, body); }
  catch (e) {
    const code = e.cause && e.cause.code;
    if (!CONNECT_ERRORS.includes(code)) throw e;
    return await P.send(c, to, body);
  }
}

// ---------- API ----------
async function api(req, res, url) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }

  if (url.pathname === '/api/sms/inbound' && req.method === 'POST') {
    if (!INBOUND_TOKEN || url.searchParams.get('token') !== INBOUND_TOKEN) return send(res, 403, { ok: false, error: 'bad token' });
    const raw = await readBody(req).catch(() => '');
    const p = parseBody(raw, req.headers['content-type']);
    // Twilio sends From/Body. Txtria doesn't document its field names, so accept the common ones
    // and log the raw payload so the first real message confirms the format.
    const from = e164(p.From || p.from || p.sender || p.src || p.phone || p.msisdn);
    const text = String(p.Body || p.body || p.message || p.text || p.msg || '').trim();
    const word = text.toUpperCase().replace(/[^A-Z]/g, '');
    logLine(INBOUND_LOG, { provider: provider(), contentType: req.headers['content-type'] || '', raw: raw.slice(0, 2000), from, text: text.slice(0, 300) });
    if (from && (STOP_WORDS.includes(word) || START_WORDS.includes(word))) {
      const list = readJSON(OPTOUT_FILE, {});
      if (STOP_WORDS.includes(word)) list[from] = { at: new Date().toISOString(), keyword: word };
      else delete list[from];
      fs.writeFileSync(OPTOUT_FILE, JSON.stringify(list, null, 2));
    }
    // Empty TwiML is a valid "no reply" for Twilio; other providers ignore the body.
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    return res.end('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  }

  if (!ACCESS_KEY) return send(res, 503, { ok: false, error: 'Server has no ACCESS_KEY set in server/.env' }, cors);
  if (!authed(req)) return send(res, 401, { ok: false, error: 'Wrong or missing access key' }, cors);

  if (url.pathname === '/api/sms/status' && req.method === 'GET') {
    const name = provider(), P = PROVIDERS[name];
    if (!P) return send(res, 200, { ok: false, provider: name, error: 'Unknown SMS_PROVIDER "' + name + '" (use twilio, txtria or test)' }, cors);
    const c = P.config(), missing = P.missing(c);
    return send(res, 200, { ok: !missing.length, provider: name, label: P.label, from: maskNum(c.from), missing, inbound: !!INBOUND_TOKEN }, cors);
  }

  if (url.pathname === '/api/sms/optouts' && req.method === 'GET') {
    return send(res, 200, { ok: true, numbers: Object.keys(readJSON(OPTOUT_FILE, {})) }, cors);
  }

  if (url.pathname === '/api/sms/send' && req.method === 'POST') {
    const p = parseBody(await readBody(req).catch(() => ''), req.headers['content-type']);
    const to = e164(p.to), body = String(p.body || '').trim();
    if (!to) return send(res, 400, { ok: false, error: 'Invalid phone number', code: 'bad_number' }, cors);
    if (!body) return send(res, 400, { ok: false, error: 'Empty message', code: 'empty' }, cors);
    if (body.length > 1600) return send(res, 400, { ok: false, error: 'Message over 1600 characters', code: 'too_long' }, cors);
    if (readJSON(OPTOUT_FILE, {})[to]) return send(res, 409, { ok: false, error: 'This number replied STOP', code: 'opted_out' }, cors);
    const name = provider(), P = PROVIDERS[name];
    if (!P) return send(res, 500, { ok: false, error: 'Unknown SMS_PROVIDER "' + name + '"' }, cors);
    const c = P.config(), missing = P.missing(c);
    if (missing.length) return send(res, 500, { ok: false, error: 'Missing in server/.env: ' + missing.join(', '), code: 'not_configured' }, cors);
    let out;
    try { out = await sendWithRetry(P, c, to, body); }
    catch (e) {
      const code = (e.cause && e.cause.code) || e.message;
      out = { ok: false, code: 'network', error: CONNECT_ERRORS.includes(code)
        ? P.label + ' unreachable (' + code + '). Nothing was sent; try again.'
        : P.label + ' connection broke (' + code + '). The text may or may not have gone out; check the ' + P.label + ' log before resending.' };
    }
    logLine(SEND_LOG, { provider: name, to: maskNum(to), chars: body.length, ok: out.ok, id: out.id || null, status: out.status || null, error: out.error || null });
    return send(res, out.ok ? 200 : 502, Object.assign({ provider: name }, out), cors);
  }

  return send(res, 404, { ok: false, error: 'Not found' }, cors);
}

// ---------- static app files ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.resolve(APP_DIR, '.' + rel);
  const type = TYPES[path.extname(file).toLowerCase()];
  // Only app files: nothing from server/ (secrets), evidence/, or dotfiles.
  if (!type || !file.startsWith(APP_DIR + path.sep) || file.startsWith(SERVER_DIR) || file.startsWith(path.join(APP_DIR, 'evidence')) || /[\\/]\./.test(rel)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch((e) => send(res, 500, { ok: false, error: e.message }));
  } else if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, url);
  } else {
    res.writeHead(405); res.end();
  }
}).listen(PORT, HOST, () => {
  const name = provider(), P = PROVIDERS[name];
  console.log('Connexions Reputation on http://' + HOST + ':' + PORT);
  console.log('SMS provider: ' + (P ? P.label : 'UNKNOWN "' + name + '"') + (P && P.missing(P.config()).length ? ' (missing: ' + P.missing(P.config()).join(', ') + ')' : ''));
  if (!ACCESS_KEY) console.log('WARNING: ACCESS_KEY is not set in server/.env, so the SMS API is disabled.');
});
