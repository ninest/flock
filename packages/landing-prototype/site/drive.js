// PROTOTYPE. The hero video and its clock. The car is always in the middle of the frame, so a label pinned to the
// middle of the element stays on it however the video is cropped.
import { BEATS, SHOT } from './content.js';

export const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// onBeat(i, beat) fires whenever the shot changes; hold(i) loops one shot, hold(null) plays the whole drive.
export function createDrive({ onBeat, onTick } = {}) {
  const video = h('video');
  Object.assign(video, { src: '/drive.mp4', poster: '/drive-poster.png', muted: true, loop: true, autoplay: true, playsInline: true, preload: 'auto' });
  video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('aria-label', 'A small orange car drives from a house in the suburbs to an office downtown.');
  let beat = -1, held = null;
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function tick() {
    const t = video.currentTime;
    if (held != null && (t >= (held + 1) * SHOT - 0.04 || t < held * SHOT - 0.2)) video.currentTime = held * SHOT + 0.01;
    const i = Math.min(BEATS.length - 1, Math.floor(video.currentTime / SHOT + 1e-3));
    if (i !== beat) { beat = i; onBeat && onBeat(i, BEATS[i]); }
    onTick && onTick(video.currentTime, i, (video.currentTime - i * SHOT) / SHOT);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  if (still) { video.autoplay = false; video.controls = true; } else video.play().catch(() => {});
  return {
    video,
    hold(i) { if (i === held) return; held = i; if (i != null) { video.currentTime = i * SHOT + 0.01; if (!still) video.play().catch(() => {}); } },
    seek(i) { video.currentTime = i * SHOT + 0.01; },
  };
}
