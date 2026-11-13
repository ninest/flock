// PROTOTYPE. Static server for the capture page: /air/* is the air-city checkout, everything else this folder.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const here = new URL('.', import.meta.url).pathname;
export const AIR = resolve(process.env.AIR_CITY || join(here, '../../../../air-city/air-city'));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.mp4': 'video/mp4' };

const PATCHES = {
  '/air/src/assets/stroads.js': ['const carAt = (a, c, dir, k) => {', 'const carAt = (a, c, dir, k) => { return;'],
  '/air/src/assets/bridges.js': ['function cars(g, x, z, axis) {', 'function cars(g, x, z, axis) { return;'],
  '/air/src/assets/trenches.js': ['if (r > 0.45) continue;', 'continue;'],
};

export function serve(port = +(process.env.PORT || 2190)) {
  return new Promise(done => {
    const s = createServer(async (req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p === '/') p = '/scene.html';
      const root = p.startsWith('/air/') ? AIR : here, file = normalize(join(root, p.replace(/^\/air\//, '/')));
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      try {
        let body = await readFile(file);
        // air-city stands cars in the lanes of stroads and highways; here traffic moves, so those go (route.js TRAFFIC)
        const patch = PATCHES[p];
        if (patch) { const src = String(body); body = src.replace(patch[0], patch[1]); if (body === src) throw new Error('patch no longer applies: ' + p); }
        res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
      }
      catch (e) { console.error(p, e.message); res.writeHead(404).end('not found'); }
    }).listen(port, '0.0.0.0', () => done(s));
  });
}
if (import.meta.url === `file://${process.argv[1]}`) serve().then(s => console.log(`Capture scene: http://hel:${s.address().port}/`));
