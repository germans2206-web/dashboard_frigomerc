// Dashboard de consumo por planta — Cloudflare Worker
//  GET /          -> dashboard (index.html)
//  GET /api/data  -> pestaña "Kpis" de Google Sheets normalizada a JSON (caché CACHE_SECONDS; ?fresh=1 relee)
// La planilla debe estar compartida como "Cualquier persona con el enlace · Lector".
import html from './index.html';

const DEFAULTS = {
  SHEET_ID: '',
  SHEET_GID: '290742623',
  METAS_SHEET: 'Metas',
  CACHE_SECONDS: '300',
};

// Columnas de la pestaña Kpis -> clave interna. Se buscan por nombre (sin acentos/mayúsculas).
const COLS = [
  ['d', (h) => h === 'fecha'],
  ['p', (h) => h.startsWith('planta')],
  ['agua', (h) => h.includes('agua')],
  ['eB', (h) => h.includes('energia') && h.includes('beef')],
  ['eG', (h) => h.includes('energia') && h.includes('graseria')],
  ['vB', (h) => h.includes('vapor') && h.includes('beef')],
  ['vG', (h) => h.includes('vapor') && h.includes('graseria')],
  ['cab', (h) => h.startsWith('cabezas')],
  ['mpf', (h) => h.includes('parada') && h.includes('faena')],
  ['hf', (h) => h.includes('horas') && h.includes('faena')],
  ['mpd', (h) => h.includes('parada') && h.includes('despostada')],
  ['hd', (h) => h.includes('horas') && h.includes('despostada')],
];
const OUT = ['d', 'p', 'agua', 'eB', 'eG', 'vB', 'vG', 'cab', 'mpf', 'hf', 'mpd', 'hd'];

const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

function parseCSV(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// Números en formato es-AR ("1.234,56") o plano ("1234.56")
function num(s) {
  let t = String(s ?? '').trim().replace(/\s/g, '');
  if (!t || /[#a-z]/i.test(t)) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// "17/11/2026", "2026-11-17" -> "2026-11-17" (descarta años fuera de 2020–2100)
function fecha(s) {
  const t = String(s ?? '').trim();
  let y, m, d;
  let r = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) [, y, m, d] = r;
  else if ((r = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) [, d, m, y] = r;
  else return null;
  y = +y; m = +m; d = +d;
  if (y < 2020 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

async function fetchText(url) {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'consumo-dashboard' } });
  if (!r.ok) throw new Error(`Google Sheets respondió ${r.status}`);
  const t = await r.text();
  if (/^\s*<(!doctype|html)/i.test(t)) throw new Error('La planilla no es pública (compartir como "Cualquier persona con el enlace")');
  return t;
}

function buildData(csv) {
  const rows = parseCSV(csv);
  const hIdx = rows.findIndex((r) => r.some((c) => norm(c) === 'fecha'));
  if (hIdx < 0) throw new Error('No se encontró la columna "Fecha" en la pestaña Kpis');
  const head = rows[hIdx].map(norm);
  const ix = {};
  for (const [k, test] of COLS) {
    const i = head.findIndex((h) => h && test(h));
    if (i >= 0) ix[k] = i;
  }
  if (ix.d == null || ix.p == null) throw new Error('Faltan las columnas "Fecha" o "Planta"');
  const out = [];
  let invalidDates = 0;
  for (const r of rows.slice(hIdx + 1)) {
    const p = num(r[ix.p]);
    if (p == null) continue;
    const d = fecha(r[ix.d]);
    if (!d) { if (String(r[ix.d] ?? '').trim()) invalidDates++; continue; }
    out.push(OUT.map((k) => (k === 'd' ? d : k === 'p' ? String(p) : ix[k] == null ? null : num(r[ix[k]]))));
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : +a[1] - +b[1]));
  return { cols: OUT, rows: out, invalidDates, missingCols: COLS.map(([k]) => k).filter((k) => ix[k] == null) };
}

// Pestaña opcional "Metas": planta | agua | energia beef | vapor beef (por cabeza)
async function fetchMetas(env) {
  try {
    const url = `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(env.METAS_SHEET)}`;
    const rows = parseCSV(await fetchText(url));
    const h = (rows[0] || []).map(norm);
    if (!h[0] || !h[0].startsWith('planta')) return null; // gviz devuelve la 1ª hoja si "Metas" no existe
    const find = (fn) => h.findIndex(fn);
    const ia = find((x) => x.includes('agua'));
    const ie = find((x) => x.includes('energia'));
    const iv = find((x) => x.includes('vapor'));
    const metas = {};
    for (const r of rows.slice(1)) {
      const p = num(r[0]);
      if (p == null) continue;
      metas[String(p)] = { agua: ia >= 0 ? num(r[ia]) : null, eB: ie >= 0 ? num(r[ie]) : null, vB: iv >= 0 ? num(r[iv]) : null };
    }
    return Object.keys(metas).length ? metas : null;
  } catch {
    return null;
  }
}

async function loadFromSheet(env) {
  const url = `https://docs.google.com/spreadsheets/d/${env.SHEET_ID}/export?format=csv&gid=${env.SHEET_GID}`;
  const [csv, metas] = await Promise.all([fetchText(url), fetchMetas(env)]);
  return { ...buildData(csv), metas, fetchedAt: new Date().toISOString() };
}

async function apiData(request, env, ctx) {
  const cache = caches.default;
  const ttl = Number(env.CACHE_SECONDS) || 300;
  const fresh = new Request(`https://cache.internal/kpis/${env.SHEET_ID}/${env.SHEET_GID}/fresh`);
  const stale = new Request(`https://cache.internal/kpis/${env.SHEET_ID}/${env.SHEET_GID}/stale`);
  const force = new URL(request.url).searchParams.has('fresh');
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

  if (!force) {
    const hit = await cache.match(fresh);
    if (hit) return new Response(hit.body, { headers: { ...headers, 'X-Cache': 'HIT' } });
  }
  try {
    const body = JSON.stringify(await loadFromSheet(env));
    ctx.waitUntil(Promise.all([
      cache.put(fresh, new Response(body, { headers: { 'Cache-Control': `max-age=${ttl}` } })),
      cache.put(stale, new Response(body, { headers: { 'Cache-Control': 'max-age=604800' } })),
    ]));
    return new Response(body, { headers: { ...headers, 'X-Cache': 'MISS' } });
  } catch (err) {
    const old = await cache.match(stale);
    if (old) {
      const data = await old.json();
      data.warning = `No se pudo leer Google Sheets (${err.message}); mostrando la última copia válida.`;
      return new Response(JSON.stringify(data), { headers: { ...headers, 'X-Cache': 'STALE' } });
    }
    return new Response(JSON.stringify({ error: err.message }), { status: 502, headers });
  }
}

export default {
  async fetch(request, env, ctx) {
    env = { ...DEFAULTS, ...env };
    const url = new URL(request.url);
    if (url.pathname === '/api/data') return apiData(request, env, ctx);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      });
    }
    return new Response('No encontrado', { status: 404 });
  },
};
