// PROTOTYPE. Variant C, "Scroll to follow John": an editorial long read. The video stays pinned while six steps
// scroll past it; each step loops its own shot, says what "we" saw, then says what the same thing is on a website.
// The feature list is the story, so there is no separate feature grid.
import { BEATS, EXAMPLES, FEATURES, GITHUB, DISCLAIMER, VISITOR } from './content.js';
import { createDrive, h } from './drive.js';

export const name = 'Scroll to follow John';

export function render(root) {
  const open = h('header', 'c-open', `
    <p class="c-kicker">Flock · self-hosted analytics</p>
    <h1>This is ${VISITOR}. <em>We are going to follow him to work.</em></h1>
    <p class="c-lede">It takes six steps and about half an hour of his morning. Scroll.</p>
    <p><a class="c-link" href="${GITHUB}">Or skip to GitHub →</a></p>`);

  const story = h('section', 'c-story');
  const stage = h('div', 'c-stage');
  const screen = h('figure', 'c-screen');
  const label = h('div', 'c-label', `<span data-n></span><b data-t></b>`); label.setAttribute('aria-hidden', 'true');
  const dots = h('div', 'c-dots', BEATS.map(() => '<i></i>').join('')); dots.setAttribute('aria-hidden', 'true');
  const drive = createDrive({ onTick(t, i, p) { dots.style.setProperty('--c-p', p.toFixed(3)); } });
  screen.append(drive.video, label, dots);
  stage.append(screen);

  const steps = h('ol', 'c-steps', BEATS.map((b, i) => `
    <li data-i="${i}">
      <p class="c-time">${b.time} AM</p>
      <h2>${b.line}</h2>
      <p class="c-aside">${b.aside}</p>
      <div class="c-real"><p class="c-on">On your website, this is a</p><h3>${b.feature}</h3><p>${b.maps}</p>
        <code>${b.event} ${JSON.stringify(b.props).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')}</code></div>
    </li>`).join(''));
  story.append(stage, steps);

  let active = -1;
  const items = [...steps.children];
  function set(i) {
    if (i === active) return; active = i;
    items.forEach((el, k) => el.classList.toggle('on', k === i));
    [...dots.children].forEach((d, k) => { d.classList.toggle('on', k === i); d.classList.toggle('done', k < i); });
    label.querySelector('[data-n]').textContent = `${i + 1} / ${BEATS.length}`;
    label.querySelector('[data-t]').textContent = BEATS[i].event;
    drive.hold(i);
  }
  // the step nearest the middle of the viewport is the one playing
  const pick = () => {
    const mid = innerHeight * (matchMedia('(max-width: 860px)').matches ? 0.68 : 0.5);
    let best = 0, d = Infinity;
    items.forEach((el, k) => { const r = el.getBoundingClientRect(), c = Math.abs((r.top + r.bottom) / 2 - mid); if (c < d) { d = c; best = k; } });
    set(best);
  };
  addEventListener('scroll', pick, { passive: true }); addEventListener('resize', pick); requestAnimationFrame(pick);

  const rest = h('section', 'c-rest', `
    <p class="c-disclaimer">${DISCLAIMER}</p>
    <div class="c-also"><h2>Also in the box</h2><ul>${FEATURES.filter(([t]) => !/Custom events|Sessions/.test(t)).map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join('')}</ul></div>
    <div class="c-uses"><h2>What people ask it</h2><ul>${EXAMPLES.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul></div>
    <p class="c-end"><a class="c-btn" href="${GITHUB}">Get Flock on GitHub</a><span>It is my own analytics, shared. Take it if it is useful.</span></p>`);
  root.append(open, story, rest);
}

export const css = `
:root { --c-bg: #1f3a2c; --c-paper: #f2ead6; --c-ink: #17241c; --c-dim: #5c6a5e; --c-line: #d6cbb0; --c-hot: #e2702a; --c-leaf: #a9d27a;
  --c-serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; --c-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
body { background: var(--c-paper); color: var(--c-ink); font: 18px/1.6 var(--c-serif); }
.c-open { background: var(--c-bg); color: var(--c-paper); padding: clamp(56px, 12vh, 140px) 24px clamp(48px, 9vh, 96px); }
.c-open > * { max-width: 980px; margin-left: auto; margin-right: auto; }
.c-kicker { font: 500 13px/1 var(--c-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--c-leaf); }
.c-open h1 { margin-top: 22px; font: 500 clamp(40px, 7.2vw, 96px)/1 var(--c-serif); letter-spacing: -.035em; text-wrap: balance; }
.c-open h1 em { font-style: italic; color: var(--c-leaf); }
.c-lede { margin-top: 28px; font-size: 20px; opacity: .85; }
.c-link { display: inline-block; margin-top: 10px; font: 500 15px/1.4 var(--c-mono); color: var(--c-paper); }
.c-link:focus-visible, .c-btn:focus-visible { outline: 2px solid var(--c-hot); outline-offset: 3px; }

.c-story { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 56px; max-width: 1240px; margin: 0 auto; padding: 0 24px; }
.c-stage { position: sticky; top: 0; height: 100svh; display: flex; align-items: center; }
.c-screen { position: relative; width: 100%; aspect-ratio: 4 / 3; max-height: 82svh; border-radius: 6px; overflow: hidden; background: #a7b7b3; box-shadow: 0 0 0 1px var(--c-ink), 10px 10px 0 var(--c-ink); }
.c-screen video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.c-label { position: absolute; left: 50%; top: 50%; transform: translate(-50%, 26px); display: flex; gap: 8px; align-items: center; padding: 4px 9px; background: var(--c-paper); color: var(--c-ink); font: 600 12px/1.3 var(--c-mono); white-space: nowrap; box-shadow: 3px 3px 0 var(--c-ink); }
.c-label::before { content: ""; position: absolute; left: 50%; top: -14px; width: 2px; height: 14px; margin-left: -1px; background: var(--c-paper); }
.c-label span { color: var(--c-dim); font-weight: 500; }
.c-dots { position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; gap: 6px; }
.c-dots i { flex: 1; height: 4px; background: rgba(255,255,255,.4); overflow: hidden; }
.c-dots i.done { background: #fff; }
.c-dots i.on::after { content: ""; display: block; height: 100%; width: calc(var(--c-p, 0) * 100%); background: #fff; }
.c-steps { padding: 18vh 0 22vh; }
.c-steps li { min-height: 78vh; display: flex; flex-direction: column; justify-content: center; padding: 24px 0; opacity: .28; transition: opacity .35s; }
.c-steps li.on { opacity: 1; }
.c-time { font: 500 13px/1 var(--c-mono); letter-spacing: .06em; color: var(--c-hot); }
.c-steps h2 { margin-top: 12px; font: 500 clamp(32px, 4.2vw, 54px)/1.05 var(--c-serif); letter-spacing: -.025em; text-wrap: balance; }
.c-aside { margin-top: 12px; font-style: italic; font-size: 20px; color: var(--c-dim); max-width: 32ch; }
.c-real { margin-top: 32px; padding: 18px 20px 20px; border: 1px solid var(--c-ink); border-radius: 6px; background: #fbf6e8; font: 16px/1.5 "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
.c-on { font: 500 12px/1 var(--c-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--c-dim); }
.c-real h3 { margin: 6px 0 6px; font: 600 24px/1.2 var(--c-serif); letter-spacing: -.01em; }
.c-real code { display: block; margin-top: 12px; padding: 8px 10px; border-radius: 4px; background: var(--c-ink); color: var(--c-leaf); font: 13px/1.5 var(--c-mono); overflow-wrap: anywhere; }

.c-rest { max-width: 980px; margin: 0 auto; padding: 24px 24px 130px; }
.c-disclaimer { font: 500 clamp(26px, 4vw, 46px)/1.12 var(--c-serif); letter-spacing: -.025em; text-wrap: balance; padding: 40px 0 48px; border-top: 2px solid var(--c-ink); border-bottom: 2px solid var(--c-ink); }
.c-rest h2 { font: 500 13px/1 var(--c-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--c-dim); margin: 56px 0 18px; }
.c-also ul { columns: 2; column-gap: 48px; font: 16px/1.55 "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
.c-also li { break-inside: avoid; padding: 0 0 14px; }
.c-uses li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px 40px; padding: 18px 0; border-top: 1px solid var(--c-line); }
.c-uses h3 { font: 500 24px/1.2 var(--c-serif); letter-spacing: -.015em; }
.c-uses p { font: 16px/1.55 "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif; color: var(--c-dim); }
.c-end { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 24px; margin-top: 56px; font-style: italic; color: var(--c-dim); }
.c-btn { display: inline-block; padding: 14px 22px; background: var(--c-hot); color: #1b0d03; font: 600 17px/1 "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif; font-style: normal; text-decoration: none; border-radius: 4px; box-shadow: 4px 4px 0 var(--c-ink); }
.c-btn:hover { transform: translate(2px, 2px); box-shadow: 2px 2px 0 var(--c-ink); }

@media (max-width: 860px) {
  .c-story { grid-template-columns: 1fr; gap: 0; padding: 0; }
  .c-stage { height: auto; z-index: 2; background: var(--c-paper); padding: 0; }
  .c-screen { aspect-ratio: auto; height: 40svh; max-height: none; border-radius: 0; box-shadow: 0 2px 0 var(--c-ink); }
  .c-steps { padding: 6vh 16px 12vh; }
  .c-steps li { min-height: 56svh; justify-content: flex-start; }
  .c-open { padding-left: 16px; padding-right: 16px; }
  .c-rest { padding-left: 16px; padding-right: 16px; }
  .c-also ul { columns: 1; }
  .c-uses li { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .c-steps li { transition: none; } }
`;
