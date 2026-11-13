// PROTOTYPE. Variant A, "Surveillance feed": the video fills the screen like a camera feed, the car sits in a
// reticle, and each beat is stamped into an event log over the footage. Dark, monospace, deadpan.
import { BEATS, FEATURES, EXAMPLES, GITHUB, DISCLAIMER, VISITOR } from './content.js';
import { createDrive, h } from './drive.js';

export const name = 'Surveillance feed';

export function render(root) {
  const hero = h('section', 'a-hero');
  const hud = h('div', 'a-hud', `
    <div class="a-top"><span class="a-rec">REC</span><span>FLOCK · CAM <b data-cam>01</b></span><span class="a-clock" data-clock></span></div>
    <div class="a-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="a-tag" aria-hidden="true"><b>${VISITOR.toUpperCase()}</b><span data-tagline></span></div>
    <div class="a-caption" aria-live="polite"><p class="a-line" data-line></p><p class="a-aside" data-aside></p></div>
    <ol class="a-log" data-log aria-hidden="true"></ol>`);
  const pitch = h('div', 'a-pitch', `
    <h1>We know where ${VISITOR} is.</h1>
    <p>Flock is analytics you host yourself. It is exactly this thorough, about your website.</p>
    <p class="a-cta"><a class="a-btn" href="${GITHUB}">View on GitHub</a><a class="a-more" href="#a-files">What it actually does ↓</a></p>`);
  const q = s => hud.querySelector(s), log = q('[data-log]');
  const drive = createDrive({
    onBeat(i, b) {
      q('[data-cam]').textContent = String(i + 1).padStart(2, '0');
      q('[data-clock]').textContent = b.time + ' AM';
      q('[data-tagline]').textContent = 'visitor 8f3a · ' + b.event;
      q('[data-line]').textContent = b.line; q('[data-aside]').innerHTML = `<span>${b.aside}</span>`;
      hud.classList.remove('a-cut'); void hud.offsetWidth; hud.classList.add('a-cut');
      if (i === 0) log.innerHTML = '';
      const li = h('li', '', `<time>${b.time}</time> <b>${b.event}</b> <span>${Object.entries(b.props).map(([k, v]) => `${k}=${v}`).join(' ')}</span>`);
      log.append(li);
    },
  });
  hero.append(drive.video, h('div', 'a-shade'), hud, pitch);

  const files = h('section', 'a-files'); files.id = 'a-files';
  files.innerHTML = `
    <p class="a-disclaimer">${DISCLAIMER}</p>
    <div class="a-cols">
      <div>
        <h2>Capabilities</h2>
        <dl class="a-list">${FEATURES.map(([t, d], i) => `<div><dt><span>${String(i + 1).padStart(2, '0')}</span>${t}</dt><dd>${d}</dd></div>`).join('')}</dl>
      </div>
      <div>
        <h2>Case files</h2>
        <ol class="a-cases">${EXAMPLES.map(([t, d], i) => `<li><span>CASE ${String(i + 1).padStart(3, '0')}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
        <p class="a-end"><a class="a-btn" href="${GITHUB}">github.com/ninest/flock</a></p>
      </div>
    </div>`;
  root.append(hero, files);
}

export const css = `
:root { --a-bg: #0c0e0d; --a-ink: #e9efe6; --a-dim: #8d9a8c; --a-line: #263029; --a-hot: #ff7a2f; --a-ok: #9be36a;
  --a-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace; }
body { background: var(--a-bg); color: var(--a-ink); font: 16px/1.5 var(--a-mono); }
.a-hero { position: relative; height: 100svh; min-height: 560px; overflow: hidden; background: #111; }
.a-hero video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.a-shade { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(180deg, rgba(8,10,9,.55) 0, rgba(8,10,9,0) 22%, rgba(8,10,9,0) 48%, rgba(8,10,9,.86) 100%),
    repeating-linear-gradient(0deg, rgba(0,0,0,.10) 0 1px, transparent 1px 3px); }
.a-hud { position: absolute; inset: 0; pointer-events: none; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; }
.a-top { position: absolute; top: 0; left: 0; right: 0; display: flex; gap: 18px; align-items: center; padding: 16px 20px; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.6); }
.a-top b { font-weight: 600; }
.a-clock { margin-left: auto; font-variant-numeric: tabular-nums; }
.a-rec { display: inline-flex; align-items: center; gap: 7px; color: #ff5a4d; font-weight: 700; }
.a-rec::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; animation: a-blink 1.2s steps(2) infinite; }
@keyframes a-blink { 50% { opacity: .15; } }
/* the car is at the centre of the frame, so the reticle is too */
.a-reticle { position: absolute; left: 50%; top: 50%; width: 92px; height: 92px; margin: -46px 0 0 -46px; }
.a-reticle i { position: absolute; width: 16px; height: 16px; border: 2px solid var(--a-hot); }
.a-reticle i:nth-child(1) { left: 0; top: 0; border-right: 0; border-bottom: 0; } .a-reticle i:nth-child(2) { right: 0; top: 0; border-left: 0; border-bottom: 0; }
.a-reticle i:nth-child(3) { left: 0; bottom: 0; border-right: 0; border-top: 0; } .a-reticle i:nth-child(4) { right: 0; bottom: 0; border-left: 0; border-top: 0; }
.a-cut .a-reticle { animation: a-lock .45s cubic-bezier(.2,.8,.2,1); }
@keyframes a-lock { from { transform: scale(2.2); opacity: 0; } }
.a-tag { position: absolute; left: calc(50% + 56px); top: calc(50% - 46px); display: grid; gap: 2px; padding: 5px 8px; background: var(--a-hot); color: #160a02; white-space: nowrap; }
.a-tag b { font-size: 13px; } .a-tag span { font-size: 10px; text-transform: none; letter-spacing: 0; }
.a-caption { position: absolute; left: 50%; top: calc(50% + 66px); transform: translateX(-50%); width: min(92vw, 560px); text-align: center; text-transform: none; letter-spacing: 0; }
.a-line { display: inline; font-size: clamp(17px, 2.3vw, 24px); font-weight: 600; line-height: 1.5; color: #fff; background: rgba(8,10,9,.82); padding: 3px 10px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.a-aside { margin-top: 10px; font-size: 13px; line-height: 1.7; }
.a-aside span { color: #e9efe6; background: rgba(8,10,9,.72); padding: 2px 8px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.a-cut .a-caption { animation: a-in .35s ease-out; }
@keyframes a-in { from { opacity: 0; transform: translate(-50%, 6px); } }
.a-log { position: absolute; right: 20px; bottom: 22px; width: min(44vw, 430px); display: grid; gap: 3px; font-size: 11px; text-transform: none; letter-spacing: 0; color: var(--a-dim); text-align: left; }
.a-log li { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; animation: a-in2 .3s ease-out; }
.a-log li:last-child { color: var(--a-ok); }
.a-log b { color: var(--a-ink); font-weight: 600; } .a-log li:last-child b { color: inherit; }
@keyframes a-in2 { from { opacity: 0; transform: translateX(8px); } }
.a-pitch { position: absolute; left: 20px; bottom: 22px; width: min(46vw, 560px); }
.a-pitch h1 { font: 700 clamp(34px, 5.4vw, 68px)/1.02 ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif; letter-spacing: -.03em; color: #fff; text-wrap: balance; }
.a-pitch p { margin-top: 14px; max-width: 46ch; color: #d5ddd2; font-size: 15px; }
.a-cta { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; }
.a-btn { display: inline-block; padding: 11px 16px; background: var(--a-ink); color: #0c0e0d; font-weight: 700; text-decoration: none; }
.a-btn:hover { background: var(--a-hot); }
.a-more { font-size: 13px; color: #d5ddd2; }
.a-btn:focus-visible, .a-more:focus-visible { outline: 2px solid var(--a-hot); outline-offset: 3px; }

.a-files { max-width: 1120px; margin: 0 auto; padding: 72px 20px 120px; }
.a-disclaimer { font: 600 clamp(20px, 2.6vw, 30px)/1.3 ui-sans-serif, system-ui, sans-serif; letter-spacing: -.01em; max-width: 30ch; text-wrap: balance; padding-left: 16px; border-left: 3px solid var(--a-hot); }
.a-cols { display: grid; grid-template-columns: 1.15fr 1fr; gap: 56px; margin-top: 64px; }
.a-files h2 { font-size: 12px; letter-spacing: .12em; text-transform: uppercase; color: var(--a-dim); font-weight: 500; padding-bottom: 12px; border-bottom: 1px solid var(--a-line); }
.a-list > div { display: grid; grid-template-columns: 210px 1fr; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--a-line); }
.a-list dt { font-weight: 600; } .a-list dt span { color: var(--a-dim); margin-right: 10px; font-weight: 400; }
.a-list dd, .a-cases p { color: #b9c4b7; font-size: 14px; }
.a-cases li { padding: 16px 0; border-bottom: 1px solid var(--a-line); }
.a-cases span { font-size: 11px; letter-spacing: .1em; color: var(--a-hot); }
.a-cases h3 { font: 600 18px/1.3 ui-sans-serif, system-ui, sans-serif; margin: 4px 0 6px; }
.a-end { margin-top: 28px; }

@media (max-width: 760px) {
  .a-log { display: none; }
  .a-pitch { width: auto; right: 20px; bottom: 76px; }
  .a-caption { top: calc(50% + 58px); }
  .a-reticle { width: 76px; height: 76px; margin: -38px 0 0 -38px; }
  .a-tag { left: 50%; top: calc(50% - 84px); transform: translateX(-50%); }
  .a-top { gap: 12px; padding: 14px 16px; }
  .a-cols { grid-template-columns: 1fr; gap: 48px; }
  .a-list > div { grid-template-columns: 1fr; gap: 4px; }
}
@media (max-height: 620px) and (min-width: 761px) { .a-pitch p:not(.a-cta) { display: none; } }
@media (prefers-reduced-motion: reduce) { .a-rec::before, .a-cut .a-reticle, .a-cut .a-caption, .a-log li { animation: none; } }
`;
