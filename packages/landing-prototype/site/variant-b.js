// PROTOTYPE. Variant B, "John's session": a light product page. The hero is a split: the video in a frame on one
// side, and beside it the drive written out as a Flock Session timeline that fills in as the car moves, so the joke
// is also the demo.
import { BEATS, FEATURES, EXAMPLES, GITHUB, DISCLAIMER, VISITOR, SHOT } from './content.js';
import { createDrive, h } from './drive.js';

export const name = 'John’s session';

export function render(root) {
  const top = h('header', 'b-top', `<a class="b-logo" href="/">flock</a><a class="b-gh" href="${GITHUB}">GitHub</a>`);
  const hero = h('section', 'b-hero');
  const intro = h('div', 'b-intro', `
    <h1>Follow every visitor from the moment they leave the house.</h1>
    <p>Flock is small, self-hosted analytics for the websites you run. Pageviews, custom events and sessions, on your own server.</p>
    <p class="b-cta"><a class="b-btn" href="${GITHUB}">Get it on GitHub</a><span>One Docker image. Free and open source.</span></p>`);
  const panel = h('div', 'b-panel');
  const frame = h('figure', 'b-frame');
  const pin = h('div', 'b-pin', `<span>${VISITOR}</span>`); pin.setAttribute('aria-hidden', 'true');
  const tl = h('div', 'b-tl', `
    <div class="b-tl-head"><div><b>Session timeline</b><span>Visitor <i>${VISITOR}</i> · production</span></div><span class="b-live">live</span></div>
    <ol>${BEATS.map(b => `<li><time>${b.time.slice(0, 4)}</time><div><b>${b.event}</b><span>${Object.entries(b.props).map(([k, v]) => `${k}: ${v}`).join(' · ')}</span><p>${b.line}</p></div></li>`).join('')}</ol>
    <div class="b-tl-foot"><span data-count>0 Events</span><span data-dur>0 min</span><span>1 Visitor</span></div>`);
  const rows = [...tl.querySelectorAll('li')];
  const mins = b => { const [hh, mm] = b.time.split(':').map(Number); return hh * 60 + mm; };
  const drive = createDrive({
    onBeat(i) {
      rows.forEach((r, k) => { r.classList.toggle('on', k === i); r.classList.toggle('done', k < i); });
      tl.querySelector('[data-count]').textContent = `${i + 1} Event${i ? 's' : ''}`;
      tl.querySelector('[data-dur]').textContent = `${mins(BEATS[i]) - mins(BEATS[0])} min`;
      const ol = tl.querySelector('ol'), r = rows[i];
      ol.scrollTo({ top: Math.max(0, r.offsetTop - ol.offsetTop - ol.clientHeight / 2 + r.clientHeight / 2), behavior: i ? 'smooth' : 'auto' });
    },
    onTick(t) { frame.style.setProperty('--b-p', (t / (SHOT * BEATS.length)).toFixed(4)); },
  });
  rows.forEach((r, i) => { r.onclick = () => drive.seek(i); });
  frame.append(drive.video, pin, h('div', 'b-bar'));
  panel.append(frame, tl);
  hero.append(intro, panel);

  const note = h('p', 'b-note', DISCLAIMER);
  const feats = h('section', 'b-feats', `<h2>What it does</h2><ul>${FEATURES.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ul>`);
  const uses = h('section', 'b-uses', `<h2>Questions it answers</h2><ol>${EXAMPLES.map(([t, d]) => `<li><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>`);
  const foot = h('footer', 'b-foot', `<p>It is one person’s analytics, shared in case it is useful to you.</p><a class="b-btn" href="${GITHUB}">Read the README on GitHub</a>`);
  root.append(top, hero, note, feats, uses, foot);
}

export const css = `
:root { --b-bg: #f6f1e4; --b-card: #fffdf7; --b-ink: #1d2420; --b-dim: #63695f; --b-line: #dfd7c2; --b-green: #2f6b3a; --b-greenbg: #e3edd6; --b-orange: #c95a16; }
body { background: var(--b-bg); color: var(--b-ink); font: 17px/1.55 "Avenir Next", "Segoe UI", ui-sans-serif, system-ui, sans-serif; }
.b-top, .b-hero, .b-note, .b-feats, .b-uses, .b-foot { max-width: 1180px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
.b-top { display: flex; justify-content: space-between; align-items: center; padding-top: 22px; padding-bottom: 6px; }
.b-logo { font: 700 22px/1 ui-serif, "Iowan Old Style", Palatino, Georgia, serif; letter-spacing: -.02em; text-decoration: none; }
.b-logo::before { content: ""; display: inline-block; width: 11px; height: 11px; margin-right: 8px; border-radius: 3px; background: var(--b-orange); }
.b-gh { font-size: 15px; }
.b-hero { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 48px; align-items: center; padding-top: 44px; padding-bottom: 56px; }
.b-intro h1 { font: 600 clamp(34px, 4.3vw, 56px)/1.06 ui-serif, "Iowan Old Style", Palatino, Georgia, serif; letter-spacing: -.025em; text-wrap: balance; }
.b-intro p { margin-top: 20px; color: var(--b-dim); max-width: 44ch; }
.b-cta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.b-cta span { font-size: 14px; }
.b-btn { display: inline-block; padding: 12px 18px; border-radius: 10px; background: var(--b-ink); color: var(--b-bg); font-weight: 600; text-decoration: none; }
.b-btn:hover { background: var(--b-green); }
.b-btn:focus-visible, .b-gh:focus-visible, .b-tl li:focus-visible { outline: 2px solid var(--b-orange); outline-offset: 3px; }
.b-panel { display: grid; grid-template-columns: minmax(0, 1fr) 250px; background: var(--b-card); border: 1px solid var(--b-line); border-radius: 18px; overflow: hidden; box-shadow: 0 1px 0 #fff inset, 0 24px 60px -30px rgba(60, 50, 20, .45); }
.b-frame { position: relative; min-height: 380px; background: #a7b7b3; }
.b-frame video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* the pin sits on the car: the car is the centre of the frame */
.b-pin { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -100%); padding-bottom: 30px; pointer-events: none; }
.b-pin span { display: block; padding: 4px 10px; border-radius: 999px; background: var(--b-ink); color: #fff; font-size: 13px; font-weight: 600; }
.b-pin::after { content: ""; position: absolute; left: 50%; bottom: 8px; width: 2px; height: 22px; margin-left: -1px; background: var(--b-ink); }
.b-bar { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(255,255,255,.35); }
.b-bar::after { content: ""; display: block; height: 100%; width: calc(var(--b-p, 0) * 100%); background: var(--b-orange); }
.b-tl { display: flex; flex-direction: column; border-left: 1px solid var(--b-line); font-size: 13px; min-height: 0; }
.b-tl-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; padding: 14px 14px 12px; border-bottom: 1px solid var(--b-line); }
.b-tl-head b { display: block; font-size: 14px; } .b-tl-head span { color: var(--b-dim); } .b-tl-head i { font-style: normal; color: var(--b-ink); font-weight: 600; }
.b-live { flex: none; padding: 1px 8px; border-radius: 999px; background: var(--b-greenbg); color: var(--b-green) !important; font-size: 12px; font-weight: 600; }
.b-tl ol { flex: 1; height: 0; min-height: 260px; overflow: hidden; padding: 6px 0; }
.b-tl li { display: grid; grid-template-columns: 34px 1fr; gap: 8px; padding: 8px 14px; cursor: pointer; opacity: .32; transition: opacity .3s, background .3s; }
.b-tl li.done { opacity: .75; } .b-tl li.on { opacity: 1; background: var(--b-greenbg); }
.b-tl time { color: var(--b-dim); font-variant-numeric: tabular-nums; }
.b-tl li b { display: block; font: 600 12.5px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.b-tl li span { display: block; color: var(--b-dim); font: 11.5px/1.4 ui-monospace, "SF Mono", Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.b-tl li p { display: none; margin-top: 4px; font-weight: 600; } .b-tl li.on p { display: block; }
.b-tl-foot { display: flex; justify-content: space-between; gap: 8px; padding: 10px 14px; border-top: 1px solid var(--b-line); color: var(--b-dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.b-note { padding-top: 8px; padding-bottom: 8px; font: italic 500 clamp(19px, 2.2vw, 25px)/1.35 ui-serif, "Iowan Old Style", Palatino, Georgia, serif; max-width: 760px; text-align: center; text-wrap: balance; }
.b-feats, .b-uses { padding-top: 72px; }
.b-feats h2, .b-uses h2 { font: 600 28px/1.2 ui-serif, "Iowan Old Style", Palatino, Georgia, serif; letter-spacing: -.015em; margin-bottom: 24px; }
.b-feats ul { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 28px 32px; }
.b-feats li { padding-top: 14px; border-top: 2px solid var(--b-ink); }
.b-feats h3, .b-uses h3 { font-size: 17px; font-weight: 650; line-height: 1.3; }
.b-feats p, .b-uses p { margin-top: 6px; color: var(--b-dim); font-size: 15px; }
.b-uses ol { counter-reset: q; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 48px; }
.b-uses li { counter-increment: q; display: grid; grid-template-columns: 36px 1fr; padding: 18px 0; border-top: 1px solid var(--b-line); }
.b-uses li::before { content: counter(q); grid-row: span 2; font: 600 22px/1.2 ui-serif, Georgia, serif; color: var(--b-orange); }
.b-uses li p { grid-column: 2; }
.b-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; margin-top: 72px; padding-top: 28px; padding-bottom: 120px; border-top: 1px solid var(--b-line); color: var(--b-dim); }

@media (max-width: 980px) {
  .b-hero { grid-template-columns: 1fr; gap: 32px; padding-top: 28px; }
  .b-feats ul { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .b-top, .b-hero, .b-note, .b-feats, .b-uses, .b-foot { padding-left: 16px; padding-right: 16px; }
  .b-panel { grid-template-columns: 1fr; }
  .b-frame { min-height: 0; aspect-ratio: 4 / 3; }
  .b-tl { border-left: 0; border-top: 1px solid var(--b-line); }
  .b-tl ol { height: 190px; min-height: 0; flex: none; }
  .b-feats ul, .b-uses ol { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .b-tl li { transition: none; } }
`;
