// PROTOTYPE. Picks the variant from ?variant= and mounts the floating switcher. Variants share words (content.js),
// the video (drive.js) and nothing else: each brings its own layout and its own stylesheet.
import * as A from './variant-a.js';
import * as B from './variant-b.js';
import * as C from './variant-c.js';

const VARIANTS = { A, B, C }, keys = Object.keys(VARIANTS);
const current = (new URLSearchParams(location.search).get('variant') || 'A').toUpperCase();
const key = VARIANTS[current] ? current : 'A', v = VARIANTS[key];

const style = document.createElement('style'); style.textContent = v.css; document.head.append(style);
document.documentElement.dataset.variant = key;
v.render(document.getElementById('root'));

// ---- the switcher: not part of any design, and the whole folder is a prototype, so it is always shown
const go = d => { const u = new URL(location.href); u.searchParams.set('variant', keys[(keys.indexOf(key) + d + keys.length) % keys.length]); location.replace(u); };
const bar = document.createElement('div'); bar.className = 'proto-switch';
bar.innerHTML = `<button aria-label="Previous variant">←</button><span><b>${key}</b> ${v.name}</span><button aria-label="Next variant">→</button>`;
const [prev, next] = bar.querySelectorAll('button'); prev.onclick = () => go(-1); next.onclick = () => go(1);
document.body.append(bar);
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
  if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
});
