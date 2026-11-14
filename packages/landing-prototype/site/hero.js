// PROTOTYPE. The hero: the drive as a camera feed. Top left is the logo (the blinking record dot and "flock"), top
// right the GitHub link, bottom left the pitch. The car is always in the middle of the frame, so the reticle and tag
// are pinned there. Bottom right, a report card says what Sam is doing: what came before, then the event, what was
// observed, a note and the time.
import { BEATS, GITHUB, HEADLINE, SUB, VISITOR } from './content.js';
import { createDrive, h } from './drive.js';

const propsOf = b => Object.entries(b.props).map(([k, v]) => `${k}=${v}`).join(' ');
const short = t => t.slice(0, 4);

export function renderHero(root) {
  const hero = h('section', 'hero');
  const top = h('header', 'hero-top', `<a class="logo" href="/"><i></i>flock</a><a class="gh" href="${GITHUB}">GitHub</a>`);
  const mark = h('div', 'mark', `<div class="reticle"><i></i><i></i><i></i><i></i></div><div class="tag"><b>${VISITOR.toUpperCase()}</b><span data-event></span></div>`);
  mark.setAttribute('aria-hidden', 'true');
  const pitch = h('div', 'pitch', `<h1>${HEADLINE}</h1><p>${SUB}</p>
    <p class="cta"><a class="btn" href="${GITHUB}">View on GitHub</a><a class="more" href="#more">Learn more</a></p>`);
  const report = h('div', 'report', `<span class="report-n" data-n></span><ol data-log></ol>
    <dl><div><dt>Event</dt><dd data-e class="mono"></dd></div><div><dt>Observed</dt><dd data-l></dd></div><div><dt>Note</dt><dd data-a></dd></div><div><dt>Time</dt><dd data-t></dd></div></dl>`);
  report.setAttribute('aria-live', 'polite');
  const set = (k, v) => { report.querySelector(`[data-${k}]`).textContent = v; };
  const drive = createDrive({
    onBeat(i, b) {
      mark.querySelector('[data-event]').textContent = b.event;
      set('n', `${i + 1}/${BEATS.length}`); set('e', `${b.event} ${propsOf(b)}`); set('l', b.line); set('a', b.aside); set('t', b.time + ' AM');
      report.querySelector('[data-log]').innerHTML = BEATS.slice(0, i).map(p => `<li><time>${short(p.time)}</time>${p.line}</li>`).join('');
      for (const el of [mark, report]) { el.classList.remove('cut'); void el.offsetWidth; el.classList.add('cut'); }
    },
  });
  hero.append(drive.video, h('div', 'shade'), top, mark, report, pitch);
  root.append(hero);
}
