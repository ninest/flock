// PROTOTYPE. Below the hero: one sentence on what Flock does, the capabilities as a bento board (tiles of different
// sizes, some showing a number, a snippet, or a small timeline; no heading, the tiles say what they are), the use
// cases as a plain grid, the way out to GitHub.
import { BEATS, EXAMPLES, FEATURES, GITHUB, STATEMENT } from './content.js';
import { h } from './drive.js';

const extra = x => (x.stat ? `<p class="stat">${x.stat}</p>` : '') + (x.code ? `<code>${x.code}</code>` : '')
  + (x.timeline ? `<ol class="mini">${BEATS.slice(0, 4).map(b => `<li><time>${b.time.slice(0, 4)}</time><span>${b.event}</span></li>`).join('')}</ol>` : '');

export function renderSections(root) {
  const main = h('main', 'below'); main.id = 'more';
  main.innerHTML = `
    <p class="statement">${STATEMENT}</p>
    <section aria-label="Capabilities"><ul class="feats">${FEATURES.map(([t, d, x]) => `<li class="tile ${x.size || ''}">${extra(x)}<h3>${t}</h3><p>${d}</p></li>`).join('')}</ul></section>
    <section><h2>Use cases</h2><ul class="uses">${EXAMPLES.map(([t, d]) => `<li class="tile"><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul></section>
    <footer class="end"><p>It is one person’s analytics, shared in case it is useful to you.</p><a class="btn" href="${GITHUB}">github.com/ninest/flock</a></footer>`;
  root.append(main);
}
