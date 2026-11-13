// PROTOTYPE, throwaway. Serves the landing page variants: `pnpm landing:prototype` → http://hel:2110/?variant=A
// Plain files, no build. Byte ranges are answered so Safari will play and seek the hero video.
import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const here = new URL('.', import.meta.url).pathname, port = +(process.env.PORT || 2110);
const roots = [join(here, 'site'), join(here, 'public')];
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };

createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  for (const root of roots) {
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) continue;
    let size;
    try { const st = statSync(file); if (!st.isFile()) continue; size = st.size; } catch { continue; }
    const head = { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m) {
      const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else { res.writeHead(200, { ...head, 'content-length': size }); createReadStream(file).pipe(res); }
    return;
  }
  res.writeHead(404).end('not found');
}).listen(port, '0.0.0.0', () => console.log(`Landing prototype: http://hel:${port}/?variant=A  (B, C)`));
