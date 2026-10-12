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

/**
 * A shareable picture of a training goal in progress (1080 wide, height fits the steps).
 * @param {{petName:string, avatar:Blob|string|null, title:string, steps:{text:string,done:boolean}[], pct:number, done:boolean, streak:number, owner:string, accent:string}} goal
 */
export async function goalImage(goal) {
  const font = (weight, size) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  // Size the picture to fit: taller for long titles and more steps, so there's no big empty gap.
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font(800, 64);
  const titleRows = measure.measureText(goal.title).width > 820 ? 2 : 1;
  const shown = Math.min(goal.steps.length, 6);
  const W = 1080, H = Math.max(1080, 880 + (titleRows - 1) * 74 + shown * 72 + (goal.steps.length > 6 ? 50 : 0));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const fit = (text, max, weight, size) => { // shrink long text until it fits on one line
    let s = size; ctx.font = font(weight, s);
    while (ctx.measureText(text).width > max && s > 28) { s -= 2; ctx.font = font(weight, s); }
    return s;
  };
  const wrap = (text, max) => {
    const words = String(text).split(/\s+/), lines = [];
    for (const w of words) {
      const last = lines[lines.length - 1];
      if (last && ctx.measureText(`${last} ${w}`).width <= max) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    return lines;
  };

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, goal.accent); bg.addColorStop(1, '#1B1F3B');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.08; ctx.fillStyle = '#fff';
  for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(120 + i * 190, 90 + (i % 2) * 60, 46, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;

  // Card
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  roundRect(ctx, 64, 150, W - 128, H - 260, 56); ctx.fill();
  ctx.shadowColor = 'transparent';

  // Header: photo, "Rex's training", status pill
  const img = await loadImage(goal.avatar);
  const ax = 140, ay = 250, ar = 58;
  ctx.save(); ctx.beginPath(); ctx.arc(ax, ay, ar, 0, Math.PI * 2); ctx.clip();
  if (img) {
    const s = Math.max((2 * ar) / img.width, (2 * ar) / img.height);
    ctx.drawImage(img, ax - (img.width * s) / 2, ay - (img.height * s) / 2, img.width * s, img.height * s);
  } else {
    ctx.fillStyle = goal.accent; ctx.fillRect(ax - ar, ay - ar, 2 * ar, 2 * ar);
    ctx.fillStyle = '#fff'; ctx.font = font(800, 56); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((goal.petName || '?').charAt(0).toUpperCase(), ax, ay + 3);
  }
  ctx.restore();
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#12151b'; ctx.font = font(800, 40);
  ctx.fillText(`${goal.petName || 'My pet'}'s training`, 220, 240, 520);
  ctx.fillStyle = '#7a8291'; ctx.font = font(600, 28);
  ctx.fillText(new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }), 220, 284);
  const pill = goal.done ? 'GOAL COMPLETE' : 'IN PROGRESS';
  ctx.font = font(800, 24);
  const pw = ctx.measureText(pill).width + 44;
  ctx.fillStyle = goal.done ? '#2fbf71' : goal.accent;
  roundRect(ctx, W - 128 - pw, 222, pw, 52, 26); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(pill, W - 128 - pw + 22, 257);

  // Goal title
  ctx.fillStyle = '#12151b';
  const ts = fit(goal.title, W - 260, 800, 64);
  const titleLines = wrap(goal.title, W - 260).slice(0, 2);
  titleLines.forEach((l, i) => ctx.fillText(l, 130, 400 + i * (ts + 10), W - 260));
  let y = 400 + (titleLines.length - 1) * (ts + 10) + 60;

  // Progress bar
  ctx.fillStyle = '#eef0f4'; roundRect(ctx, 130, y, W - 260, 30, 15); ctx.fill();
  if (goal.pct > 0) {
    const pg = ctx.createLinearGradient(130, 0, W - 130, 0);
    pg.addColorStop(0, goal.done ? '#2fbf71' : goal.accent); pg.addColorStop(1, goal.done ? '#51cf66' : '#ff4f7b');
    ctx.fillStyle = pg; roundRect(ctx, 130, y, Math.max(30, (W - 260) * goal.pct / 100), 30, 15); ctx.fill();
  }
  y += 82;
  ctx.fillStyle = '#12151b'; ctx.font = font(800, 46); ctx.fillText(`${goal.pct}%`, 130, y);
  const doneSteps = goal.steps.filter(s => s.done).length;
  ctx.fillStyle = '#7a8291'; ctx.font = font(600, 30);
  ctx.fillText(goal.steps.length ? `${doneSteps} of ${goal.steps.length} steps done` : (goal.done ? 'All done!' : 'Just getting started'), 260, y);
  y += 56;

  // Steps checklist
  ctx.font = font(600, 32);
  for (const step of goal.steps.slice(0, 6)) {
    const cy = y + 26;
    ctx.beginPath(); ctx.arc(152, cy, 22, 0, Math.PI * 2);
    if (step.done) { ctx.fillStyle = '#2fbf71'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(141, cy); ctx.lineTo(149, cy + 8); ctx.lineTo(164, cy - 9); ctx.stroke(); }
    else { ctx.strokeStyle = '#d5d9e0'; ctx.lineWidth = 4; ctx.stroke(); }
    ctx.fillStyle = step.done ? '#7a8291' : '#12151b';
    const t = step.text.length > 44 ? `${step.text.slice(0, 43)}…` : step.text;
    ctx.fillText(t, 196, cy + 11, W - 340);
    y += 72;
  }
  if (goal.steps.length > 6) { ctx.fillStyle = '#7a8291'; ctx.font = font(600, 28); ctx.fillText(`+ ${goal.steps.length - 6} more`, 196, y + 20); }

  // Streak
  const sy = H - 200;
  ctx.strokeStyle = '#eef0f4'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(130, sy - 40); ctx.lineTo(W - 130, sy - 40); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.fillStyle = goal.streak ? '#ff7a3d' : '#7a8291'; ctx.font = font(800, 36);
  ctx.fillText(goal.streak ? `${goal.streak}-day training streak` : 'Training today', 130, sy + 6);
  ctx.textAlign = 'right'; ctx.fillStyle = '#7a8291'; ctx.font = font(600, 28);
  ctx.fillText(`@${goal.owner}`, W - 130, sy + 4);

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.font = font(700, 34);
  ctx.fillText('PetPost', W / 2, H - 46);

  return new Promise(resolve => c.toBlob(resolve, 'image/jpeg', 0.92));
}
