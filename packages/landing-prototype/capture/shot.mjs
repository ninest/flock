// PROTOTYPE. One still of the capture scene: node shot.mjs "<query>" out.png   (e.g. "t=4.5" or "over=50,10,20")
import { chromium } from 'playwright-core';
import { serve } from './server.mjs';
export const launch = () => chromium.launch({ executablePath: process.env.CHROME || (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-linux64/chrome-headless-shell'), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
if (import.meta.url === `file://${process.argv[1]}`) {
  const jobs = process.argv.slice(2);
  const s = await serve(0), b = await launch(), page = await b.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', m => { if (m.type() === 'error') console.log('page:', m.text()); }); page.on('pageerror', e => console.log('pageerror:', e.message));
  await page.goto(`http://localhost:${s.address().port}/?${jobs[0]}`, { waitUntil: 'commit' });
  await page.waitForFunction('window.READY', null, { timeout: 180000 });
  for (let i = 0; i < jobs.length; i += 2) {
    if (i) await page.evaluate(q => { const p = new URLSearchParams(q); if (p.has('t')) window.renderAt(+p.get('t')); if (p.has('over')) window.overAt(...p.get('over').split(',').map(Number)); }, jobs[i]);
    await page.locator('#c').screenshot({ path: jobs[i + 1] });
    console.log('wrote', jobs[i + 1]);
  }
  await b.close(); s.close();
}
