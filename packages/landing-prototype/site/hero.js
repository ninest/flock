// PROTOTYPE. The hero: the drive as a camera feed. Top left is the logo (the blinking record dot and "flock"), top
// right the GitHub link, bottom left the pitch. The car is always in the middle of the frame, so the reticle and tag
// are pinned there. How each beat is put into words is the `caption` style:
//   toast    notifications stacking up in the corner, the way a tracking app would tell you
//   callout  the sentence hangs off the car itself, on a leader line
//   report   a filed report in the corner: subject, time, event, note
import { BEATS, GITHUB, HEADLINE, SUB, VISITOR } from './content.js';
import { createDrive, h } from './drive.js';

export const CAPTIONS = { toast: 'Notifications', callout: 'Callout on the car', report: 'Field report' };

const propsOf = b => Object.entries(b.props).map(([k, v]) => `${k}=${v}`).join(' ');
const short = t => t.slice(0, 4);

export function renderHero(root, caption) {
  const hero = h('section', `hero cap-${caption}`);
  const top = h('header', 'hero-top', `<a class="logo" href="/"><i></i>flock</a><a class="gh" href="${GITHUB}">GitHub</a>`);
  const mark = h('div', 'mark', `<div class="reticle"><i></i><i></i><i></i><i></i></div><div class="tag"><b>${VISITOR.toUpperCase()}</b><span data-event></span></div>`);
  mark.setAttribute('aria-hidden', 'true');
  const pitch = h('div', 'pitch', `<h1>${HEADLINE}</h1><p>${SUB}</p>
    <p class="cta"><a class="btn" href="${GITHUB}">View on GitHub</a><a class="more" href="#what">What it does ↓</a></p>`);
  const cap = h('div', 'cap'); cap.setAttribute('aria-live', 'polite');
  const say = SAY[caption](cap, mark);
  const drive = createDrive({
    onBeat(i, b) {
      mark.querySelector('[data-event]').textContent = b.event;
      mark.classList.remove('cut'); void mark.offsetWidth; mark.classList.add('cut');
      say(i, b);
    },
  });
  hero.append(drive.video, h('div', 'shade'), top, mark, cap, pitch);
  root.append(hero);
}

const SAY = {
  // the last three notifications, newest at the bottom
  toast(cap) {
    return (i, b) => {
      if (i === 0) cap.innerHTML = '';
      const t = h('div', 'toast', `<div class="toast-head"><i></i><span>Flock</span><time>${short(b.time)} AM</time></div><b>${b.line}</b><p>${b.aside}</p>`);
      cap.append(t);
      while (cap.children.length > 3) cap.firstChild.remove();
    };
  },
  // one sentence on a leader line from the car; the tag above the car is folded into it
  callout(cap) {
    cap.innerHTML = `<div class="callout"><p class="callout-meta"><b>${VISITOR.toUpperCase()}</b><span data-m></span></p><p class="callout-line" data-l></p><p class="callout-aside" data-a></p></div>`;
    const el = cap.firstChild;
    return (i, b) => {
      el.querySelector('[data-m]').textContent = `${short(b.time)} AM · ${b.event}`;
      el.querySelector('[data-l]').textContent = b.line; el.querySelector('[data-a]').textContent = b.aside;
      el.classList.remove('cut'); void el.offsetWidth; el.classList.add('cut');
    };
  },
  // a report being filled in, with the earlier entries listed under it
  report(cap) {
    cap.innerHTML = `<div class="report"><p class="report-head"><span>Field report</span><span data-n></span></p>
      <dl><div><dt>Subject</dt><dd>${VISITOR}</dd></div><div><dt>Time</dt><dd data-t></dd></div><div><dt>Event</dt><dd data-e class="mono"></dd></div><div><dt>Observed</dt><dd data-l></dd></div><div><dt>Note</dt><dd data-a></dd></div></dl>
      <ol data-log></ol></div>`;
    const el = cap.firstChild, set = (k, v) => { el.querySelector(`[data-${k}]`).textContent = v; };
    return (i, b) => {
      set('n', `${i + 1} of ${BEATS.length}`); set('t', b.time + ' AM'); set('e', `${b.event} ${propsOf(b)}`); set('l', b.line); set('a', b.aside);
      el.querySelector('[data-log]').innerHTML = BEATS.slice(0, i).map(p => `<li><time>${short(p.time)}</time>${p.line}</li>`).join('');
      el.classList.remove('cut'); void el.offsetWidth; el.classList.add('cut');
    };
  },
};
