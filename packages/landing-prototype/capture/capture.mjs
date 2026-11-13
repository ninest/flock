// PROTOTYPE. Renders the drive frame by frame and encodes it: node capture.mjs  →  ../public/drive.mp4 + poster
//   FPS=30 W=1280 H=720 CRF=24 node capture.mjs
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';
import { serve } from './server.mjs';
import { launch } from './shot.mjs';

const NAME = process.env.NAME || 'drive';
const FPS = +(process.env.FPS || 30), W = +(process.env.W || 1280), H = +(process.env.H || 720), CRF = process.env.CRF || '24';
const out = new URL('../public/', import.meta.url).pathname; mkdirSync(out, { recursive: true });
const s = await serve(0), b = await launch(), page = await b.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto(`http://localhost:${s.address().port}/?w=${W}&h=${H}&${process.env.QUERY || ''}`, { waitUntil: 'commit' });
await page.waitForFunction('window.READY', null, { timeout: 300000 });
const meta = await page.evaluate('window.META'), n = Math.round(meta.duration * FPS), gop = Math.round(meta.shot * FPS);
// a keyframe at the start of every shot, so the page can jump to a beat and loop it
const enc = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-an',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0',
  '-movflags', '+faststart', out + NAME + '.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let i = 0; i < n; i++) {
  await page.evaluate(t => window.renderAt(t), i / FPS);
  const png = await page.locator('#c').screenshot({ type: 'png' });
  if (i === Math.round(FPS * 1.2)) writeFileSync(out + NAME + '-poster.png', png);
  if (!enc.stdin.write(png)) await new Promise(r => enc.stdin.once('drain', r));
  if (i % 60 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
enc.stdin.end(); await new Promise(r => enc.on('close', r));
writeFileSync(out + NAME + '.json', JSON.stringify({ ...meta, fps: FPS, width: W, height: H }, null, 2) + '\n');
console.log('wrote', out + NAME + '.mp4', meta);
await b.close(); s.close();
