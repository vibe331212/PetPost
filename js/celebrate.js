// Goal-complete celebration: a burst of confetti and a trophy card.
import { icon } from './icons.js';

const COLORS = ['#ff4f7b', '#ffb547', '#3b5bfd', '#2fbf71', '#a78bfa', '#4fc3f7', '#ffd43b'];

export function confetti({ count = 180, duration = 3500, parent = document.body } = {}) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  parent.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  // Two cannons in the bottom corners shooting up and inwards, plus one in the middle.
  const cannons = [[0.1, 1, -0.35], [0.9, 1, 0.35], [0.5, 1, 0]];
  const bits = Array.from({ length: count }, (_, i) => {
    const [cx, cy, lean] = cannons[i % cannons.length];
    const angle = -Math.PI / 2 - lean + (Math.random() - 0.5) * 0.9;
    const speed = h * (0.9 + Math.random() * 0.8);
    return {
      x: cx * w, y: cy * h + 10,
      vx: Math.cos(angle) * speed * (cx === 0.5 ? 0.5 : 0.6), vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 7, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
      color: COLORS[i % COLORS.length], shape: i % 3, wobble: Math.random() * 6,
    };
  });

  const start = performance.now();
  let last = start;
  const tick = now => {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
    for (const b of bits) {
      b.vy += h * 1.1 * dt;           // gravity
      b.vx *= 0.99; b.vy *= 0.99;     // air drag
      b.x += (b.vx + Math.sin(t / 200 + b.wobble) * 30) * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.fillStyle = b.color;
      if (b.shape === 0) ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
      else if (b.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, b.size / 2.6, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(0, -b.size / 2); ctx.lineTo(b.size / 2, b.size / 2); ctx.lineTo(-b.size / 2, b.size / 2); ctx.fill(); }
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(tick);
    else canvas.remove();
  };
  requestAnimationFrame(tick);
}

/**
 * Shows the trophy card. Resolves with 'trophies' if the person wants to see their trophies.
 * @param {{ headline: string, number: number, date: string }} trophy
 */
export function showTrophy({ headline, number, date }) {
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'modal trophy-modal';
    d.innerHTML = `
      <div class="trophy-burst">${icon('trophy')}</div>
      <p class="trophy-kicker">Goal complete</p>
      <h2 class="trophy-headline"></h2>
      <p class="muted">You earned trophy #${number} · ${date}</p>
      <div class="stack">
        <button class="btn primary block" data-choice="trophies">${icon('trophy')}See my trophies</button>
        <button class="btn ghost block" data-choice="done">Done</button>
      </div>`;
    d.querySelector('.trophy-headline').textContent = headline;
    document.body.append(d);
    let choice = 'done';
    d.addEventListener('click', e => {
      const b = e.target.closest('[data-choice]');
      if (b) { choice = b.dataset.choice; d.close(); }
    });
    d.addEventListener('close', () => { d.remove(); resolve(choice); });
    d.showModal();
    confetti({ parent: d }); // inside the dialog so it draws above the backdrop
  });
}
