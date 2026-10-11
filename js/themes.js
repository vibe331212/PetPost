// 15 animated "modes". Each one draws a living background on a full-screen canvas.
const TAU = Math.PI * 2;
const R = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));

function bg(ctx, w, h, stops) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
function glow(ctx, x, y, r, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function ridge(ctx, w, h, base, amp, freq, phase, color) {
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, h);
  for (let x = 0; x <= w + 8; x += 8) {
    ctx.lineTo(x, base + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 2.3 + phase * 1.7) * amp * 0.4);
  }
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
}
function bird(ctx, x, y, s, flap, color) {
  ctx.strokeStyle = color; ctx.lineWidth = Math.max(1.2, s * 0.16); ctx.lineCap = 'round';
  const wy = Math.sin(flap) * s * 0.5;
  ctx.beginPath();
  ctx.moveTo(x - s, y - wy); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.25, x, y);
  ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.25, x + s, y - wy);
  ctx.stroke();
}
function cloud(ctx, x, y, s, color) {
  ctx.fillStyle = color; ctx.beginPath();
  for (const [dx, dy, r] of [[0, 0, 1], [0.9, -0.4, 0.85], [1.8, 0, 0.9], [0.9, 0.25, 0.9], [-0.85, 0.2, 0.7], [2.6, 0.25, 0.6]]) {
    ctx.moveTo(x + dx * s + r * s, y + dy * s);
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU);
  }
  ctx.fill();
}
function leaf(ctx, x, y, s, rot, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(-s, 0);
  ctx.quadraticCurveTo(0, -s * 0.7, s, 0); ctx.quadraticCurveTo(0, s * 0.7, -s, 0);
  ctx.fill(); ctx.restore();
}
function pine(ctx, x, base, s) {
  ctx.fillRect(x - s * 0.04, base - s * 0.2, s * 0.08, s * 0.2);
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const bottom = base - s * 0.15 - k * s * 0.25, half = s * 0.28 * (1 - k * 0.22);
    ctx.moveTo(x - half, bottom); ctx.lineTo(x, bottom - s * 0.42); ctx.lineTo(x + half, bottom);
  }
  ctx.fill();
}
function fall(p, w, h, dt, t, sway = 18) {
  p.y += p.v * dt;
  p.x += Math.sin(t * 1.3 + p.p) * sway * dt;
  p.rot = (p.rot || 0) + (p.vr || 0) * dt;
  if (p.y > h + 12) { p.y = -12; p.x = R(0, w); }
  if (p.x > w + 12) p.x = -12;
  if (p.x < -12) p.x = w + 12;
}
function wander(p, w, h, dt, turn = 2) {
  p.a += R(-1, 1) * turn * dt * 3;
  p.x += Math.cos(p.a) * p.v * dt;
  p.y += Math.sin(p.a) * p.v * dt;
  if (p.x < -20) p.x = w + 20; if (p.x > w + 20) p.x = -20;
  if (p.y < p.minY) p.a = Math.abs(p.a); if (p.y > p.maxY) p.a = -Math.abs(p.a);
}
const stars = (n, w, h, top = 1) => many(n, () => ({ x: R(0, w), y: R(0, h * top), r: R(0.3, 1.6), p: R(0, TAU), sp: R(0.5, 2) }));
function drawStars(ctx, list, t) {
  ctx.fillStyle = '#fff';
  for (const s of list) {
    ctx.globalAlpha = 0.25 + 0.75 * Math.abs(Math.sin(t * s.sp + s.p));
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export const THEMES = [
  {
    id: 'clean', name: 'Clean', desc: 'Calm, bright and minimal', tone: 'light', accent: '#3b5bfd',
    setup: () => ({ blobs: [
      { x: 0.15, y: 0.2, r: 0.45, c: 'rgba(110,130,255,0.13)', s: 0.07 },
      { x: 0.85, y: 0.35, r: 0.4, c: 'rgba(255,140,185,0.10)', s: 0.05 },
      { x: 0.5, y: 0.9, r: 0.5, c: 'rgba(80,200,185,0.10)', s: 0.06 },
    ] }),
    frame(ctx, w, h, t, dt, s) {
      ctx.fillStyle = '#f5f6f8'; ctx.fillRect(0, 0, w, h);
      const m = Math.max(w, h);
      s.blobs.forEach((b, i) => glow(ctx, (b.x + Math.sin(t * b.s + i) * 0.08) * w, (b.y + Math.cos(t * b.s * 1.3 + i) * 0.06) * h, b.r * m, b.c));
    },
  },
  {
    id: 'ocean', name: 'Ocean', desc: 'Bubbles, fish and swaying seaweed', tone: 'dark', accent: '#4fc3f7',
    setup: (w, h) => ({
      bubbles: many(50, () => ({ x: R(0, w), y: R(0, h), r: R(2, 9), v: R(20, 60), p: R(0, TAU) })),
      fish: many(7, () => ({ x: R(0, w), y: R(h * 0.25, h * 0.8), v: R(25, 60) * pick([-1, 1]), s: R(10, 22), c: pick(['#ffb347', '#7fd3ff', '#ff8fa8', '#c7f464', '#ffe66d']) })),
      weeds: many(Math.ceil(w / 60), i => ({ x: i * 60 + R(-20, 20), len: R(0.08, 0.22) * h, p: R(0, TAU) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#2a8fc1', '#0c4d78', '#062a47']);
      ctx.save(); ctx.globalAlpha = 0.07; ctx.fillStyle = '#fff';
      for (let i = 0; i < 6; i++) {
        const x = w * (i / 6) + Math.sin(t * 0.3 + i) * 40;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 60, 0); ctx.lineTo(x + 240, h); ctx.lineTo(x + 90, h); ctx.fill();
      }
      ctx.restore();
      for (const f of s.fish) {
        f.x += f.v * dt;
        if (f.x > w + 40) f.x = -40; if (f.x < -40) f.x = w + 40;
        const y = f.y + Math.sin(t + f.s) * 6, d = Math.sign(f.v);
        ctx.fillStyle = f.c; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.ellipse(f.x, y, f.s, f.s * 0.5, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(f.x - d * f.s * 0.8, y);
        ctx.lineTo(f.x - d * f.s * 1.6, y - f.s * 0.5 + Math.sin(t * 8) * 2); ctx.lineTo(f.x - d * f.s * 1.6, y + f.s * 0.5 + Math.sin(t * 8) * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.fillStyle = '#0a2a40';
        ctx.beginPath(); ctx.arc(f.x + d * f.s * 0.5, y - f.s * 0.1, f.s * 0.1, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = '#1f7a5a'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (const wd of s.weeds) {
        ctx.beginPath(); ctx.moveTo(wd.x, h);
        for (let k = 1; k <= 7; k++) ctx.lineTo(wd.x + Math.sin(t * 1.2 + wd.p + k * 0.6) * k * 3, h - wd.len * k / 7);
        ctx.stroke();
      }
      ridge(ctx, w, h, h - 16, 5, 0.01, 0, '#c9b27c');
      ctx.lineWidth = 1.2;
      for (const b of s.bubbles) {
        b.y -= b.v * dt;
        if (b.y < -10) { b.y = h + 10; b.x = R(0, w); }
        const x = b.x + Math.sin(t * 2 + b.p) * 4;
        ctx.strokeStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.25, 0, TAU); ctx.fill();
      }
    },
  },
  {
    id: 'forest', name: 'Forest', desc: 'Pine trees, birds and falling leaves', tone: 'light', accent: '#2e7d4f',
    setup: (w, h) => ({
      layers: [
        { c: '#a4cdb0', base: 0.6, n: Math.ceil(w / 55), sz: [60, 100] },
        { c: '#5f9c6d', base: 0.72, n: Math.ceil(w / 80), sz: [90, 150] },
        { c: '#2f6a43', base: 0.86, n: Math.ceil(w / 110), sz: [130, 210] },
      ].map(L => ({ ...L, trees: many(L.n, i => ({ x: (i + R(-0.3, 0.3)) * w / L.n, s: R(...L.sz) })) })),
      birds: many(6, () => ({ x: R(0, w), y: R(h * 0.08, h * 0.35), v: R(30, 60), s: R(6, 11), p: R(0, TAU) })),
      leaves: many(24, () => ({ x: R(0, w), y: R(0, h), v: R(20, 45), p: R(0, TAU), rot: R(0, TAU), vr: R(-2, 2), s: R(4, 8), c: pick(['#7cb342', '#9ccc65', '#c0ca33', '#558b2f']) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#eaf6ee', '#d3ead8', '#b2d4ba']);
      glow(ctx, w * 0.78, h * 0.14, Math.min(w, h) * 0.4, 'rgba(255,240,190,.75)');
      for (const b of s.birds) {
        b.x += b.v * dt;
        if (b.x > w + 20) { b.x = -20; b.y = R(h * 0.08, h * 0.35); }
        bird(ctx, b.x, b.y + Math.sin(t + b.p) * 5, b.s, t * 8 + b.p, 'rgba(40,60,50,.7)');
      }
      for (const L of s.layers) {
        ctx.fillStyle = L.c;
        const base = L.base * h;
        ctx.fillRect(0, base, w, h - base);
        for (const tr of L.trees) pine(ctx, tr.x, base + 2, tr.s);
      }
      for (const l of s.leaves) { fall(l, w, h, dt, t, 30); leaf(ctx, l.x, l.y, l.s, l.rot, l.c); }
    },
  },
  {
    id: 'snow', name: 'Snow Day', desc: 'Soft snowfall over quiet hills', tone: 'light', accent: '#3a7bd5',
    setup: (w, h) => ({
      flakes: many(150, () => ({ x: R(0, w), y: R(0, h), v: R(18, 55), r: R(1, 3.6), p: R(0, TAU) })),
      pines: many(Math.ceil(w / 90), i => ({ x: i * 90 + R(-25, 25), s: R(50, 90) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#d6e4f2', '#c5d7ea', '#e9f0f7']);
      ridge(ctx, w, h, h * 0.68, 22, 0.006, 1, '#eef4fa');
      ctx.fillStyle = '#6f8ea3';
      for (const p of s.pines) pine(ctx, p.x, h * 0.7 + Math.sin(p.x * 0.006 + 1) * 22, p.s);
      ridge(ctx, w, h, h * 0.8, 18, 0.004, 3, '#fbfdff');
      ctx.fillStyle = '#fff';
      for (const f of s.flakes) {
        fall(f, w, h, dt, t, 20);
        ctx.globalAlpha = 0.6 + f.r / 9;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  },
  {
    id: 'space', name: 'Space', desc: 'Twinkling stars and shooting comets', tone: 'dark', accent: '#a78bfa',
    setup: (w, h) => ({ stars: stars(240, w, h), shoot: { life: 0 } }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#05061a', '#120d33', '#24124a']);
      glow(ctx, w * 0.25, h * 0.6, Math.max(w, h) * 0.45, 'rgba(140,80,255,.16)');
      glow(ctx, w * 0.75, h * 0.3, Math.max(w, h) * 0.35, 'rgba(60,140,255,.12)');
      drawStars(ctx, s.stars, t);
      const px = w * 0.8, py = h * 0.24 + Math.sin(t * 0.2) * 6, pr = Math.min(w, h) * 0.08;
      const g = ctx.createLinearGradient(px - pr, py - pr, px + pr, py + pr);
      g.addColorStop(0, '#f8b4d9'); g.addColorStop(1, '#6d4bff');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,220,255,.6)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(px, py, pr * 1.7, pr * 0.45, -0.35, 0, TAU); ctx.stroke();
      const sh = s.shoot;
      if (sh.life <= 0 && Math.random() < dt * 0.4) Object.assign(sh, { x: R(0, w), y: R(0, h * 0.4), life: 1 });
      if (sh.life > 0) {
        sh.life -= dt * 1.2; sh.x += 520 * dt; sh.y += 260 * dt;
        const lg = ctx.createLinearGradient(sh.x, sh.y, sh.x - 120, sh.y - 60);
        lg.addColorStop(0, `rgba(255,255,255,${sh.life})`); lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = lg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(sh.x - 120, sh.y - 60); ctx.stroke();
      }
    },
  },
  {
    id: 'desert', name: 'Desert', desc: 'Warm dunes, cacti and drifting sand', tone: 'light', accent: '#d9822b',
    setup: (w, h) => ({
      sand: many(70, () => ({ x: R(0, w), y: R(h * 0.55, h), v: R(40, 110), r: R(0.6, 1.8) })),
      cacti: many(Math.max(2, Math.ceil(w / 400)), i => ({ x: (i + 0.5) * w / Math.max(2, Math.ceil(w / 400)) + R(-60, 60), s: R(60, 110) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#fde7c3', '#f9d1a2', '#f2ad70']);
      glow(ctx, w * 0.25, h * 0.25, Math.min(w, h) * 0.35, 'rgba(255,250,220,.9)');
      ctx.fillStyle = '#fff6dc'; ctx.beginPath(); ctx.arc(w * 0.25, h * 0.25, Math.min(w, h) * 0.07, 0, TAU); ctx.fill();
      ridge(ctx, w, h, h * 0.66, 18, 0.004, t * 0.03, '#ecbc80');
      ctx.strokeStyle = '#5f8a48'; ctx.lineCap = 'round';
      for (const c of s.cacti) {
        const base = h * 0.78 + 6, x = c.x, k = c.s;
        ctx.lineWidth = k * 0.24;
        ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - k); ctx.stroke();
        ctx.lineWidth = k * 0.16;
        ctx.beginPath(); ctx.moveTo(x, base - k * 0.4); ctx.lineTo(x - k * 0.3, base - k * 0.4); ctx.lineTo(x - k * 0.3, base - k * 0.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, base - k * 0.55); ctx.lineTo(x + k * 0.28, base - k * 0.55); ctx.lineTo(x + k * 0.28, base - k * 0.85); ctx.stroke();
      }
      ridge(ctx, w, h, h * 0.78, 14, 0.005, 2 + t * 0.02, '#dc9c5c');
      ridge(ctx, w, h, h * 0.9, 10, 0.007, 4, '#c88447');
      ctx.fillStyle = 'rgba(255,240,210,.6)';
      for (const p of s.sand) {
        p.x += p.v * dt; p.y += Math.sin(t * 3 + p.x * 0.02) * 6 * dt;
        if (p.x > w + 5) { p.x = -5; p.y = R(h * 0.55, h); }
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    },
  },
  {
    id: 'autumn', name: 'Autumn', desc: 'Golden trees and tumbling leaves', tone: 'light', accent: '#d4572a',
    setup: (w, h) => ({
      trees: many(Math.ceil(w / 120), i => ({ x: i * 120 + R(-30, 30), s: R(40, 70), c: pick(['#e8590c', '#f08c00', '#d9480f', '#e67700']) })),
      leaves: many(40, () => ({ x: R(0, w), y: R(0, h), v: R(25, 55), p: R(0, TAU), rot: R(0, TAU), vr: R(-3, 3), s: R(5, 10), c: pick(['#e8590c', '#f08c00', '#c92a2a', '#fab005', '#d9480f']) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#fff3e0', '#fcd9ae', '#f3b07c']);
      for (const tr of s.trees) {
        const base = h * 0.8;
        ctx.fillStyle = '#7a4a2a'; ctx.fillRect(tr.x - 4, base - tr.s * 1.2, 8, tr.s * 1.2);
        ctx.fillStyle = tr.c; ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.arc(tr.x, base - tr.s * 1.4, tr.s * 0.8, 0, TAU);
        ctx.arc(tr.x - tr.s * 0.6, base - tr.s * 1.1, tr.s * 0.55, 0, TAU);
        ctx.arc(tr.x + tr.s * 0.6, base - tr.s * 1.1, tr.s * 0.55, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ridge(ctx, w, h, h * 0.8, 8, 0.006, 0, '#c97b48');
      for (const l of s.leaves) { fall(l, w, h, dt, t, 40); leaf(ctx, l.x, l.y, l.s, l.rot, l.c); }
    },
  },
  {
    id: 'sakura', name: 'Sakura', desc: 'Cherry blossoms on the breeze', tone: 'light', accent: '#e05a8a',
    setup: (w, h) => ({
      blossoms: many(40, () => { const k = Math.random(); return { k, off: R(-18, 18), r: R(5, 10) }; }),
      petals: many(45, () => ({ x: R(0, w), y: R(0, h), v: R(18, 40), p: R(0, TAU), rot: R(0, TAU), vr: R(-2, 2), s: R(4, 7) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#fff1f6', '#fcdde8', '#f7c6d8']);
      ctx.fillStyle = '#efc0d2';
      ctx.beginPath(); ctx.moveTo(w * 0.35, h); ctx.lineTo(w * 0.62, h * 0.62); ctx.lineTo(w * 0.68, h * 0.6); ctx.lineTo(w * 0.95, h); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(w * 0.585, h * 0.67); ctx.lineTo(w * 0.62, h * 0.62); ctx.lineTo(w * 0.68, h * 0.6); ctx.lineTo(w * 0.71, h * 0.65); ctx.fill();
      const sway = Math.sin(t * 0.6) * 6;
      const bx = k => (1 - k) * (1 - k) * -20 + 2 * (1 - k) * k * w * 0.25 + k * k * w * 0.6;
      const by = k => (1 - k) * (1 - k) * h * 0.18 + 2 * (1 - k) * k * h * 0.02 + k * k * (h * 0.1 + sway);
      ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 7; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(bx(0), by(0)); for (let k = 0.05; k <= 1; k += 0.05) ctx.lineTo(bx(k), by(k)); ctx.stroke();
      for (const b of s.blossoms) {
        const x = bx(b.k), y = by(b.k) + b.off;
        ctx.fillStyle = '#f7a1c4'; ctx.beginPath(); ctx.arc(x, y, b.r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffe3ee'; ctx.beginPath(); ctx.arc(x, y, b.r * 0.35, 0, TAU); ctx.fill();
      }
      for (const p of s.petals) {
        p.x += 25 * dt; fall(p, w, h, dt, t, 30);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = '#f9b4cc';
        ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55 * Math.abs(Math.cos(t * 2 + p.p)) + 1, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
    },
  },
  {
    id: 'fireflies', name: 'Firefly Night', desc: 'Glowing fireflies under the moon', tone: 'dark', accent: '#ffd166',
    setup: (w, h) => ({
      stars: stars(90, w, h, 0.5),
      flies: many(45, () => ({ x: R(0, w), y: R(h * 0.35, h * 0.95), a: R(0, TAU), v: R(10, 30), p: R(0, TAU), minY: h * 0.3, maxY: h * 0.97 })),
      grass: many(Math.ceil(w / 7), i => ({ x: i * 7 + R(-3, 3), len: R(18, 50), p: R(0, TAU) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#0a1230', '#13224a', '#1d3358']);
      drawStars(ctx, s.stars, t * 0.6);
      glow(ctx, w * 0.8, h * 0.17, Math.min(w, h) * 0.25, 'rgba(255,245,210,.3)');
      ctx.fillStyle = '#fdf6d8'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.17, Math.min(w, h) * 0.05, 0, TAU); ctx.fill();
      ridge(ctx, w, h, h * 0.78, 26, 0.004, 1, '#0f1d38');
      ctx.strokeStyle = '#0a1428'; ctx.lineWidth = 2;
      for (const g of s.grass) {
        ctx.beginPath(); ctx.moveTo(g.x, h);
        ctx.quadraticCurveTo(g.x, h - g.len * 0.6, g.x + Math.sin(t + g.p) * 6, h - g.len); ctx.stroke();
      }
      for (const f of s.flies) {
        wander(f, w, h, dt);
        const a = (Math.sin(t * 2 + f.p) + 1) / 2;
        glow(ctx, f.x, f.y, 14, `rgba(255,220,100,${0.35 * a})`);
        ctx.fillStyle = `rgba(255,240,170,${0.4 + 0.6 * a})`;
        ctx.beginPath(); ctx.arc(f.x, f.y, 2, 0, TAU); ctx.fill();
      }
    },
  },
  {
    id: 'rain', name: 'Rainy Day', desc: 'Cozy rain with rippling puddles', tone: 'dark', accent: '#7fb7ff',
    setup: (w, h) => ({
      drops: many(240, () => ({ x: R(0, w), y: R(0, h), l: R(10, 22), v: R(500, 800) })),
      clouds: many(5, i => ({ x: (i / 5) * w, y: R(0, h * 0.1), s: R(40, 70), v: R(6, 14) })),
      ripples: [],
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#5e7186', '#465668', '#2f3a48']);
      for (const c of s.clouds) { c.x += c.v * dt; if (c.x > w + 200) c.x = -200; cloud(ctx, c.x, c.y, c.s, 'rgba(50,62,78,.85)'); }
      ctx.fillStyle = '#26303c'; ctx.fillRect(0, h * 0.88, w, h * 0.12);
      ctx.strokeStyle = 'rgba(200,220,240,.45)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of s.drops) {
        d.y += d.v * dt; d.x -= d.v * 0.12 * dt;
        if (d.y > h * 0.9) {
          if (Math.random() < 0.08) s.ripples.push({ x: d.x, y: R(h * 0.9, h * 0.99), r: 0, life: 1 });
          d.y = R(-40, 0); d.x = R(0, w + 60);
        }
        ctx.moveTo(d.x, d.y); ctx.lineTo(d.x + d.l * 0.12, d.y - d.l);
      }
      ctx.stroke();
      s.ripples = s.ripples.filter(r => r.life > 0);
      for (const r of s.ripples) {
        r.r += 30 * dt; r.life -= dt * 1.2;
        ctx.strokeStyle = `rgba(200,220,240,${r.life * 0.6})`;
        ctx.beginPath(); ctx.ellipse(r.x, r.y, r.r, r.r * 0.3, 0, 0, TAU); ctx.stroke();
      }
    },
  },
  {
    id: 'aurora', name: 'Aurora', desc: 'Northern lights over the mountains', tone: 'dark', accent: '#5ef2c2',
    setup: (w, h) => ({ stars: stars(150, w, h, 0.7) }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#020814', '#04162a', '#0a2a3d']);
      drawStars(ctx, s.stars, t * 0.5);
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const bands = [['80,255,180', 0], ['60,200,255', 1], ['180,110,255', 2]];
      for (const [rgb, i] of bands) {
        for (let x = 0; x < w; x += 6) {
          const y = h * (0.18 + i * 0.07) + Math.sin(x * 0.005 + t * 0.4 + i * 2) * h * 0.06 + Math.sin(x * 0.013 + t * 0.7) * h * 0.02;
          const len = h * (0.16 + 0.06 * Math.sin(x * 0.01 + t + i));
          ctx.fillStyle = `rgba(${rgb},0.05)`; ctx.fillRect(x, y, 6, len);
          ctx.fillStyle = `rgba(${rgb},0.07)`; ctx.fillRect(x, y, 6, len * 0.35);
        }
      }
      ctx.restore();
      ctx.fillStyle = '#0a1a2a';
      ctx.beginPath(); ctx.moveTo(0, h);
      for (let x = 0; x <= w + 40; x += 40) ctx.lineTo(x, h * 0.72 - Math.abs(Math.sin(x * 0.011)) * h * 0.14 - Math.sin(x * 0.003) * 20);
      ctx.lineTo(w, h); ctx.fill();
      ridge(ctx, w, h, h * 0.86, 10, 0.008, 2, '#040c15');
    },
  },
  {
    id: 'sunset', name: 'Sunset Beach', desc: 'Golden hour waves and gliding gulls', tone: 'light', accent: '#f05a3c',
    setup: (w, h) => ({ gulls: many(5, () => ({ x: R(0, w), y: R(h * 0.1, h * 0.4), v: R(20, 40), s: R(7, 12), p: R(0, TAU) })) }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#ff8a65', '#ffb38a', '#ffe0b8']);
      const hz = h * 0.62, sr = Math.min(w, h) * 0.1;
      glow(ctx, w * 0.5, hz, sr * 4, 'rgba(255,240,200,.7)');
      ctx.fillStyle = '#fff1c1'; ctx.beginPath(); ctx.arc(w * 0.5, hz, sr, Math.PI, 0); ctx.fill();
      const sea = ctx.createLinearGradient(0, hz, 0, h);
      sea.addColorStop(0, '#5878b0'); sea.addColorStop(1, '#2c3e6b');
      ctx.fillStyle = sea; ctx.fillRect(0, hz, w, h - hz);
      for (let i = 0; i < 14; i++) {
        const y = hz + 6 + i * 9, half = sr * (1.1 - i * 0.05) + Math.sin(t * 2 + i) * 8;
        ctx.fillStyle = `rgba(255,230,180,${0.5 - i * 0.03})`; ctx.fillRect(w * 0.5 - half, y, half * 2, 2);
      }
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 5; i++) {
        const y = hz + (h - hz) * (0.25 + i * 0.13);
        ctx.beginPath();
        for (let x = 0; x <= w; x += 10) ctx.lineTo(x, y + Math.sin(x * 0.03 + t * 1.5 + i) * 2);
        ctx.stroke();
      }
      ridge(ctx, w, h, h * 0.92, 6, 0.006, t * 0.5, '#f3d2a2');
      for (const g of s.gulls) {
        g.x += g.v * dt; if (g.x > w + 20) { g.x = -20; g.y = R(h * 0.1, h * 0.4); }
        bird(ctx, g.x, g.y + Math.sin(t * 0.8 + g.p) * 8, g.s, Math.sin(t * 3 + g.p) * 0.8 + 0.6, 'rgba(70,40,40,.6)');
      }
    },
  },
  {
    id: 'meadow', name: 'Meadow', desc: 'Wildflowers and fluttering butterflies', tone: 'light', accent: '#2f9e44',
    setup: (w, h) => ({
      clouds: many(4, () => ({ x: R(0, w), y: R(h * 0.05, h * 0.3), s: R(18, 32), v: R(6, 14) })),
      flowers: many(Math.ceil(w / 14), () => ({ x: R(0, w), y: R(h * 0.8, h), c: pick(['#ff6b8b', '#ffd43b', '#ffffff', '#b197fc', '#ff922b']), r: R(2.5, 5) })),
      flies: many(8, () => ({ x: R(0, w), y: R(h * 0.4, h * 0.85), a: R(0, TAU), v: R(30, 55), p: R(0, TAU), c: pick(['#ff922b', '#748ffc', '#f06595', '#fcc419']), minY: h * 0.3, maxY: h * 0.9 })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#a9dcff', '#d8f0ff', '#f3fbff']);
      glow(ctx, w * 0.15, h * 0.12, Math.min(w, h) * 0.3, 'rgba(255,250,210,.9)');
      for (const c of s.clouds) { c.x += c.v * dt; if (c.x > w + 120) c.x = -120; cloud(ctx, c.x, c.y, c.s, 'rgba(255,255,255,.9)'); }
      ridge(ctx, w, h, h * 0.68, 20, 0.005, 0.5, '#a8d98a');
      ridge(ctx, w, h, h * 0.8, 14, 0.007, 2, '#74c25e');
      for (const f of s.flowers) {
        const sw = Math.sin(t * 1.5 + f.x * 0.05) * 2;
        ctx.strokeStyle = '#3f8f3a'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(f.x, f.y + 10); ctx.lineTo(f.x + sw, f.y); ctx.stroke();
        ctx.fillStyle = f.c; ctx.beginPath(); ctx.arc(f.x + sw, f.y, f.r, 0, TAU); ctx.fill();
      }
      for (const b of s.flies) {
        wander(b, w, h, dt, 3);
        const flap = Math.abs(Math.sin(t * 12 + b.p));
        ctx.fillStyle = b.c;
        for (const d of [-1, 1]) {
          ctx.beginPath(); ctx.ellipse(b.x + d * 5 * flap, b.y - 2, 6 * flap + 0.5, 7, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.ellipse(b.x + d * 4 * flap, b.y + 5, 4 * flap + 0.5, 4, 0, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#333'; ctx.fillRect(b.x - 1, b.y - 5, 2, 12);
      }
    },
  },
  {
    id: 'jungle', name: 'Jungle', desc: 'Hanging vines and giant leaves', tone: 'dark', accent: '#3ddc84',
    setup: (w, h) => ({
      vines: many(Math.ceil(w / 110), i => ({ x: i * 110 + R(10, 60), len: R(0.25, 0.6) * h, p: R(0, TAU) })),
      specks: many(40, () => ({ x: R(0, w), y: R(0, h), v: R(5, 15), p: R(0, TAU) })),
      leaves: [...many(4, i => ({ x: 0, y: h * (0.55 + i * 0.12), len: R(120, 200), ang: R(-0.7, 0.1), p: R(0, TAU) })),
        ...many(4, i => ({ x: w, y: h * (0.5 + i * 0.13), len: R(120, 200), ang: Math.PI + R(-0.1, 0.7), p: R(0, TAU) }))],
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#145c3f', '#0f4a33', '#0a2e22']);
      ctx.save(); ctx.globalAlpha = 0.06; ctx.fillStyle = '#f5ffd0';
      for (let i = 0; i < 4; i++) { const x = w * (0.2 + i * 0.22); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 50, 0); ctx.lineTo(x + 160, h); ctx.lineTo(x + 70, h); ctx.fill(); }
      ctx.restore();
      for (const v of s.vines) {
        const sway = Math.sin(t * 0.8 + v.p) * 14;
        ctx.strokeStyle = '#1f6b3f'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(v.x, 0); ctx.quadraticCurveTo(v.x + sway, v.len * 0.5, v.x + sway * 1.5, v.len); ctx.stroke();
        for (let k = 0.15; k < 1; k += 0.14) {
          const x = v.x + sway * 1.5 * k * k, y = v.len * k;
          leaf(ctx, x + (k * 20 % 2 > 1 ? 8 : -8), y, 9, k * 7 + sway * 0.02, '#2a9461');
        }
      }
      for (const p of s.specks) {
        p.y -= p.v * dt; p.x += Math.sin(t + p.p) * 6 * dt;
        if (p.y < -5) { p.y = h + 5; p.x = R(0, w); }
        ctx.fillStyle = `rgba(230,255,160,${0.3 + 0.3 * Math.sin(t * 2 + p.p)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, TAU); ctx.fill();
      }
      for (const L of s.leaves) {
        const a = L.ang + Math.sin(t * 0.7 + L.p) * 0.05;
        ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(a);
        ctx.fillStyle = '#1a7448';
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(L.len * 0.5, -L.len * 0.38, L.len, 0); ctx.quadraticCurveTo(L.len * 0.5, L.len * 0.38, 0, 0); ctx.fill();
        ctx.strokeStyle = '#0f4f30'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L.len, 0); ctx.stroke();
        ctx.restore();
      }
    },
  },
  {
    id: 'sky', name: 'Sky', desc: 'Drifting clouds and hot air balloons', tone: 'light', accent: '#3d7eff',
    setup: (w, h) => ({
      clouds: many(9, i => ({ x: R(0, w), y: R(h * 0.05, h * 0.9), s: [14, 22, 32][i % 3], v: [8, 14, 22][i % 3] })),
      balloons: many(3, () => ({ x: R(0.1, 0.9) * w, y: R(h * 0.2, h), v: R(8, 16), s: R(16, 28), p: R(0, TAU), c: pick([['#ff6b6b', '#ffd93d'], ['#4d96ff', '#ffffff'], ['#6bcb77', '#fff3b0'], ['#c77dff', '#ffd6ff']]) })),
    }),
    frame(ctx, w, h, t, dt, s) {
      bg(ctx, w, h, ['#8ec5ff', '#bfe0ff', '#eaf5ff']);
      glow(ctx, w * 0.85, h * 0.12, Math.min(w, h) * 0.3, 'rgba(255,250,220,.85)');
      const sorted = s.clouds;
      for (const c of sorted.filter(c => c.s < 25)) { c.x += c.v * dt; if (c.x > w + 120) c.x = -120; cloud(ctx, c.x, c.y, c.s, 'rgba(255,255,255,.7)'); }
      for (const b of s.balloons) {
        b.y -= b.v * dt; if (b.y < -80) { b.y = h + 80; b.x = R(0.1, 0.9) * w; }
        const x = b.x + Math.sin(t * 0.5 + b.p) * 20, y = b.y, r = b.s;
        ctx.save(); ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.15, 0, 0, TAU); ctx.clip();
        for (let i = -3; i <= 3; i++) { ctx.fillStyle = b.c[(i + 3) % 2]; ctx.fillRect(x + i * r * 0.32 - r * 0.16, y - r * 1.2, r * 0.32, r * 2.4); }
        ctx.restore();
        ctx.strokeStyle = 'rgba(80,60,40,.6)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x - r * 0.5, y + r * 0.95); ctx.lineTo(x - r * 0.2, y + r * 1.6); ctx.moveTo(x + r * 0.5, y + r * 0.95); ctx.lineTo(x + r * 0.2, y + r * 1.6); ctx.stroke();
        ctx.fillStyle = '#8b5e3c'; ctx.fillRect(x - r * 0.22, y + r * 1.6, r * 0.44, r * 0.32);
      }
      for (const c of sorted.filter(c => c.s >= 25)) { c.x += c.v * dt; if (c.x > w + 120) c.x = -120; cloud(ctx, c.x, c.y, c.s, 'rgba(255,255,255,.92)'); }
    },
  },
];

export const findTheme = id => THEMES.find(t => t.id === id) || THEMES[0];

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.theme = null;
    this.t = 0;
    this.last = performance.now();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    addEventListener('resize', () => this.resize());
    this.resize();
    if (!this.reduced) requestAnimationFrame(this.loop);
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth; this.h = innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.theme) { this.state = this.theme.setup(this.w, this.h); this.draw(0); }
  }
  set(theme) {
    if (this.theme?.id === theme.id) return;
    this.theme = theme;
    this.state = theme.setup(this.w, this.h);
    this.draw(0);
  }
  draw(dt) {
    if (!this.theme) return;
    this.ctx.save();
    this.theme.frame(this.ctx, this.w, this.h, this.t, dt, this.state);
    this.ctx.restore();
  }
  loop = now => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    this.draw(dt);
    requestAnimationFrame(this.loop);
  };
}

export function renderPreview(theme, canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const state = theme.setup(w, h);
  ctx.save();
  theme.frame(ctx, w, h, 2, 0, state);
  ctx.restore();
}
