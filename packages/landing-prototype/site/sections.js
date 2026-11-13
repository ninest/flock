// PROTOTYPE. Below the hero: one sentence on what Flock does, the capabilities, the use cases, the way out to GitHub.
// Three layouts of the same words:
//   bento   tiles of different sizes, some showing a number, a snippet or a small timeline
//   grid    even cards in rows
//   plain   no boxes at all: type and rules
import { BEATS, EXAMPLES, FEATURES, GITHUB, STATEMENT } from './content.js';
import { h } from './drive.js';

export const LAYOUTS = { bento: 'Bento', grid: 'Regular grid', plain: 'No boxes' };

const extra = x => (x.stat ? `<p class="stat">${x.stat}</p>` : '') + (x.code ? `<code>${x.code}</code>` : '')
  + (x.timeline ? `<ol class="mini">${BEATS.slice(0, 4).map(b => `<li><time>${b.time.slice(0, 4)}</time><span>${b.event}</span></li>`).join('')}</ol>` : '');

const FEATS = {
  bento: () => `<ul class="feats">${FEATURES.map(([t, d, x]) => `<li class="tile ${x.size || ''}">${extra(x)}<h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`,
  grid: () => `<ul class="feats">${FEATURES.map(([t, d]) => `<li class="tile"><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`,
  plain: () => `<dl class="feats">${FEATURES.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>`,
};
const USES = {
  bento: () => `<ul class="uses">${EXAMPLES.map(([t, d], i) => `<li class="tile ${i === 0 ? 'wide' : ''}"><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`,
  grid: () => `<ul class="uses">${EXAMPLES.map(([t, d]) => `<li class="tile"><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`,
  plain: () => `<ul class="uses">${EXAMPLES.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`,
};

export function renderSections(root, layout) {
  const main = h('main', `below lay-${layout}`); main.id = 'what';
  main.innerHTML = `
    <p class="statement">${STATEMENT}</p>
    <section><h2>Capabilities</h2>${FEATS[layout]()}</section>
    <section><h2>Use cases</h2>${USES[layout]()}</section>
    <footer class="end"><p>It is one person’s analytics, shared in case it is useful to you.</p><a class="btn" href="${GITHUB}">github.com/ninest/flock</a></footer>`;
  root.append(main);
}
