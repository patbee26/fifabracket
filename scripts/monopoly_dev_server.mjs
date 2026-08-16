// Local dev server for Emerald City: serves web/ and implements the same
// /api/game endpoint the Netlify function exposes, backed by an in-memory
// store instead of Netlify Blobs.
//
//   node scripts/monopoly_dev_server.mjs [port]
//   open http://localhost:4319/monopoly/
//
// Rooms live only as long as the process. For production behaviour (and
// persistence across restarts) use `netlify dev` instead.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { handle } from '../netlify/lib/rooms.mjs';

const PORT = Number(process.argv[2]) || 4319;
const ROOT = resolve(new URL('../web', import.meta.url).pathname);

const rooms = new Map();
let etagCounter = 0;

const store = {
  async get(key) {
    const row = rooms.get(key);
    return row ? { data: structuredClone(row.value), etag: row.etag } : null;
  },
  async set(key, value, opts = {}) {
    const row = rooms.get(key);
    if (opts.onlyIfNew && row) return false;
    if (opts.onlyIfMatch && (!row || row.etag !== opts.onlyIfMatch)) return false;
    rooms.set(key, { value: structuredClone(value), etag: `e${++etagCounter}` });
    return true;
  },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/game') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'POST only.' }));
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Expected JSON.' }));
      return;
    }
    try {
      const out = await handle(store, body);
      res.writeHead(out.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out.body));
    } catch (err) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Server error.', detail: String(err?.message ?? err) }));
    }
    return;
  }

  // Static files, confined to web/.
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const target = join(ROOT, normalize(pathname));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Emerald City dev server: http://localhost:${PORT}/monopoly/`);
});
