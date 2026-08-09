/**
 * Kleiner statischer Server zum Ausprobieren: `npm run serve`.
 *
 * Nötig, weil die App aus ES-Modulen besteht und Browser die über
 * `file://` nicht laden. Für den echten Betrieb reicht jedes statische
 * Hosting -- etwa GitHub Pages.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';

  // Kein Ausbruch aus dem Projektverzeichnis.
  const target = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(ROOT)) {
    res.writeHead(403).end('Verboten');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
  }
}).listen(PORT, () => {
  console.log(`Küchenvorrat läuft auf http://localhost:${PORT}`);
});
