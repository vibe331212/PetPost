// Pet profile card: a summary of a pet (photo, breed, age, favorites, tricks, trophies)
// that shows on screen and can be saved or shared as a picture.

/** "2 years old", "7 months old", "3 weeks old" from a YYYY-MM-DD birthday. */
export function ageText(birthday) {
  if (!birthday) return '';
  const born = new Date(`${birthday}T12:00:00`), now = new Date();
  if (Number.isNaN(born.getTime()) || born > now) return '';
  let months = (now.getFullYear() - born.getFullYear()) * 12 + now.getMonth() - born.getMonth();
  if (now.getDate() < born.getDate()) months--;
  if (months >= 12) { const y = Math.floor(months / 12); return `${y} ${y === 1 ? 'year' : 'years'} old`; }
  if (months >= 1) return `${months} ${months === 1 ? 'month' : 'months'} old`;
  const weeks = Math.max(0, Math.floor((now - born) / (7 * 864e5)));
  return weeks ? `${weeks} ${weeks === 1 ? 'week' : 'weeks'} old` : 'Brand new';
}

/** "Teach Biscuit to sit" -> "Sit" */
export function trickName(title) {
  const t = String(title || '').replace(/^teach\s+.+?\s+(how\s+)?to\s+/i, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function loadImage(source) {
  return new Promise(resolve => {
    if (!source) return resolve(null);
    const online = typeof source === 'string';
    const url = online ? source : URL.createObjectURL(source);
    const img = new Image();
    if (online) img.crossOrigin = 'anonymous'; // lets the photo be drawn into the shareable picture
    const done = ok => { if (!online) URL.revokeObjectURL(url); resolve(ok ? img : null); };
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/**
 * Draws the card as a 1080x1440 PNG.
 * @param {{petName:string, line:string, facts:[string,string][], tricks:string[], stats:[string,string][], owner:string, avatar:Blob|null, accent:string}} card
 */
export async function cardImage(card) {
  const W = 1080, H = 1440;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, card.accent);
  bg.addColorStop(1, '#1B1F3B');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // White card
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, 70, 170, W - 140, H - 290, 56); ctx.fill();
  ctx.shadowColor = 'transparent';

  // Photo
  const cx = W / 2, cy = 190, r = 140;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, r + 14, 0, Math.PI * 2); ctx.fill();
  const img = await loadImage(card.avatar);
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (img) {
    const s = Math.max((2 * r) / img.width, (2 * r) / img.height);
    ctx.drawImage(img, cx - (img.width * s) / 2, cy - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    g.addColorStop(0, card.accent); g.addColorStop(1, '#ff4f7b');
    ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 130); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((card.petName || '?').charAt(0).toUpperCase(), cx, cy + 6);
  }
  ctx.restore();

  // Name and type
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#12151b'; ctx.font = font(800, 84);
  ctx.fillText(card.petName || 'My pet', cx, 440, W - 220);
  ctx.fillStyle = '#5c6472'; ctx.font = font(500, 40);
  if (card.line) ctx.fillText(card.line, cx, 500, W - 220);

  // Facts, two per row
  let y = 570;
  const colW = (W - 260) / 2;
  card.facts.forEach(([label, value], i) => {
    const x = 130 + (i % 2) * (colW + 20);
    if (i % 2 === 0 && i) y += 150;
    ctx.fillStyle = '#f2f4f8'; roundRect(ctx, x, y, colW, 128, 28); ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#7a8291'; ctx.font = font(700, 26); ctx.fillText(label.toUpperCase(), x + 28, y + 46);
    ctx.fillStyle = '#12151b'; ctx.font = font(700, 38); ctx.fillText(value, x + 28, y + 98, colW - 56);
  });
  if (card.facts.length) y += 170;

  // Tricks learned as chips
  ctx.textAlign = 'left';
  ctx.fillStyle = '#7a8291'; ctx.font = font(700, 26); ctx.fillText('TRICKS LEARNED', 130, y + 10);
  y += 34;
  ctx.font = font(700, 34);
  let x = 130;
  const tricks = card.tricks.length ? card.tricks : ['Still learning'];
  for (const t of tricks.slice(0, 8)) {
    const w = Math.min(ctx.measureText(t).width + 56, W - 260);
    if (x + w > W - 130) { x = 130; y += 76; }
    if (y > H - 330) break;
    ctx.fillStyle = card.tricks.length ? card.accent : '#e7eaf0';
    roundRect(ctx, x, y, w, 62, 31); ctx.fill();
    ctx.fillStyle = card.tricks.length ? '#ffffff' : '#5c6472';
    ctx.fillText(t, x + 28, y + 43, w - 56);
    x += w + 14;
  }

  // Stats along the bottom of the card
  const sy = H - 270, sw = (W - 260) / card.stats.length;
  ctx.strokeStyle = '#e7eaf0'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(130, sy - 30); ctx.lineTo(W - 130, sy - 30); ctx.stroke();
  card.stats.forEach(([value, label], i) => {
    const mx = 130 + sw * i + sw / 2;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#12151b'; ctx.font = font(800, 60); ctx.fillText(value, mx, sy + 40);
    ctx.fillStyle = '#7a8291'; ctx.font = font(600, 28); ctx.fillText(label, mx, sy + 82);
  });

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = font(700, 34);
  ctx.fillText(`PetPost  ·  @${card.owner}`, cx, H - 50);

  return new Promise(resolve => c.toBlob(resolve, 'image/png'));
}
