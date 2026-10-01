// Serves this folder the way GitHub Pages will, so what is tested is what ships.
//
// The sub-path matters more than it looks: on Pages the app lives at /VRL/, not
// at the root, and a manifest or a service worker whose scope assumes the root
// fails in ways that only show up on a phone. So this serves under a sub-path
// too, and over https, because the camera will not start without it.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BASE = '/VRL/';
const PORT = 4443;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.css': 'text/css; charset=utf-8',
};

const certDir = process.env['VRL_CERTS'] ?? join(ROOT, 'certs');
const server = createServer(
  {
    key: readFileSync(join(certDir, 'key.pem')),
    cert: readFileSync(join(certDir, 'cert.pem')),
  },
  (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (!path.startsWith(BASE)) {
      res.writeHead(302, { Location: BASE }).end();
      return;
    }

    const rest = path.slice(BASE.length) || 'index.html';
    const file = join(ROOT, normalize(rest).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('no such file');
      return;
    }

    const extension = file.slice(file.lastIndexOf('.'));
    res.writeHead(200, {
      'Content-Type': TYPES[extension] ?? 'application/octet-stream',
      // Pages sets a short cache; the service worker is what actually matters.
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  }
);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`  Solo  https://localhost:${PORT}${BASE}`);
});
