// PROTOTYPE. Round two: everything is the "surveillance feed" page; what varies is
//   ?variant=bento|grid|plain        how the capabilities and use cases are laid out below the hero
//   ?caption=toast|callout|report    how the hero says what John is doing
// The two are independent, so any layout can be seen with any caption. Round one's other two pages (John's
// session, Scroll to follow John) are at commit f4e7186.
import { renderHero, CAPTIONS } from './hero.js';
import { renderSections, LAYOUTS } from './sections.js';

const q = new URLSearchParams(location.search);
const pick = (table, v) => (table[v] ? v : Object.keys(table)[0]);
const layout = pick(LAYOUTS, q.get('variant')), caption = pick(CAPTIONS, q.get('caption'));
document.documentElement.dataset.variant = layout; document.documentElement.dataset.caption = caption;
const root = document.getElementById('root');
renderHero(root, caption); renderSections(root, layout);

// ---- the switcher: not part of the design, and the whole folder is a prototype, so it is always shown
const go = (param, table, cur, d) => { const k = Object.keys(table), u = new URL(location.href); u.searchParams.set(param, k[(k.indexOf(cur) + d + k.length) % k.length]); location.replace(u); };
const bar = document.createElement('div'); bar.className = 'proto-switch';
const group = (label, param, table, cur) => {
  const g = document.createElement('div');
  g.innerHTML = `<button aria-label="Previous ${label}">←</button><span><b>${label}</b> ${table[cur]}</span><button aria-label="Next ${label}">→</button>`;
  const [p, n] = g.querySelectorAll('button'); p.onclick = () => go(param, table, cur, -1); n.onclick = () => go(param, table, cur, 1);
  return g;
};
bar.append(group('Layout', 'variant', LAYOUTS, layout), group('Caption', 'caption', CAPTIONS, caption));
document.body.append(bar);
// ← → change the layout, ↑ ↓ with Shift the caption
addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') go('variant', LAYOUTS, layout, e.key === 'ArrowLeft' ? -1 : 1);
  if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) go('caption', CAPTIONS, caption, e.key === 'ArrowUp' ? -1 : 1);
});
