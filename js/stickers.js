// Photo sticker editor: add hats, glasses, bows and more on top of a photo, then bake them in.
// Positions are stored relative to the photo (0..1) so they survive any screen size.
import { icon } from './icons.js';

const STICKERS = {
  hat: () => `<path d="M50 8 22 86h56z" fill="#7c5cff"/><path d="M50 8 36 47h28zM29 67h42l-4 11H33z" fill="#ffd43b"/><circle cx="50" cy="8" r="7" fill="#ff5a8a"/><ellipse cx="50" cy="88" rx="32" ry="7" fill="#5b3fd6"/>`,
  crown: () => `<path d="M12 72 18 26l20 22 12-30 12 30 20-22 6 46z" fill="#ffc93c" stroke="#e89b0c" stroke-width="3" stroke-linejoin="round"/><rect x="12" y="72" width="76" height="12" rx="3" fill="#e89b0c"/><circle cx="30" cy="62" r="5" fill="#ff4f7b"/><circle cx="50" cy="58" r="6" fill="#3b5bfd"/><circle cx="70" cy="62" r="5" fill="#2fbf71"/>`,
  sunglasses: () => `<path d="M6 38h88" stroke="#111" stroke-width="6" stroke-linecap="round"/><path d="M10 38h32l-3 18a10 10 0 0 1-10 8H22a10 10 0 0 1-10-8zM58 38h32l-2 18a10 10 0 0 1-10 8h-7a10 10 0 0 1-10-8z" fill="#111"/><path d="M18 43h10M64 43h10" stroke="#fff" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>`,
  glasses: () => `<circle cx="28" cy="50" r="17" fill="#fff" fill-opacity=".25" stroke="#2b2f3a" stroke-width="5"/><circle cx="72" cy="50" r="17" fill="#fff" fill-opacity=".25" stroke="#2b2f3a" stroke-width="5"/><path d="M45 48q5-5 10 0M11 46 3 42M89 46l8-4" stroke="#2b2f3a" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  bowtie: () => `<path d="M50 50 12 28v44zM50 50l38-22v44z" fill="#e5484d"/><rect x="41" y="39" width="18" height="22" rx="5" fill="#b42328"/><circle cx="24" cy="40" r="3" fill="#fff" fill-opacity=".6"/><circle cx="24" cy="60" r="3" fill="#fff" fill-opacity=".6"/><circle cx="76" cy="40" r="3" fill="#fff" fill-opacity=".6"/><circle cx="76" cy="60" r="3" fill="#fff" fill-opacity=".6"/>`,
  bow: () => `<path d="M50 50C34 24 10 26 12 46s26 22 38 4zM50 50c16-26 40-24 38-4s-26 22-38 4z" fill="#ff7eb3"/><path d="M46 52 34 84l10-4 6 8 4-36z" fill="#ff5a9a"/><circle cx="50" cy="50" r="9" fill="#e83e8c"/>`,
  mustache: () => `<path d="M50 44c-6-8-20-12-30-4-6 5-8 14-16 14 6 8 22 10 32 2 6-5 10-8 14-8s8 3 14 8c10 8 26 6 32-2-8 0-10-9-16-14-10-8-24-4-30 4z" fill="#3a2a1f"/>`,
  heart: () => `<path d="M50 86S10 62 10 34a20 20 0 0 1 40-6 20 20 0 0 1 40 6c0 28-40 52-40 52z" fill="#ff4f7b"/><path d="M26 30a10 10 0 0 1 10-8" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  star: () => `<path d="m50 8 12 27 29 3-22 20 7 29-26-15-26 15 7-29L9 38l29-3z" fill="#ffd43b" stroke="#f0a400" stroke-width="3" stroke-linejoin="round"/>`,
  sparkles: () => `<path d="M38 14c3 18 8 23 26 26-18 3-23 8-26 26-3-18-8-23-26-26 18-3 23-8 26-26z" fill="#ffd43b"/><path d="M74 52c2 11 5 14 16 16-11 2-14 5-16 16-2-11-5-14-16-16 11-2 14-5 16-16z" fill="#ffe680"/><path d="M76 10c1.5 7 3.5 9 10 10-6.5 1-8.5 3-10 10-1.5-7-3.5-9-10-10 6.5-1 8.5-3 10-10z" fill="#fff3b0"/>`,
  cutie: () => `<rect x="6" y="32" width="88" height="36" rx="18" fill="#ff4f7b"/><text x="50" y="57" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="22" font-weight="800" fill="#fff">Cutie</text>`,
  sound: word => `<path d="M14 18h72a10 10 0 0 1 10 10v34a10 10 0 0 1-10 10H40L22 88l2-16H14A10 10 0 0 1 4 62V28a10 10 0 0 1 10-10z" fill="#fff" stroke="#12151b" stroke-width="4" stroke-linejoin="round"/><text x="50" y="54" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="${word.length > 6 ? 17 : 22}" font-weight="800" fill="#12151b">${word}!</text>`,
};
const ORDER = ['hat', 'crown', 'sunglasses', 'glasses', 'bowtie', 'bow', 'mustache', 'heart', 'star', 'sparkles', 'cutie', 'sound'];
const LABELS = { hat: 'Party hat', crown: 'Crown', sunglasses: 'Sunglasses', glasses: 'Glasses', bowtie: 'Bow tie', bow: 'Hair bow', mustache: 'Mustache', heart: 'Heart', star: 'Star', sparkles: 'Sparkles', cutie: 'Cutie label', sound: 'Speech bubble' };

const svgFor = (type, word) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">${STICKERS[type](word)}</svg>`;

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function bake(baseBlob, stickers, word) {
  const base = await loadImg(URL.createObjectURL(baseBlob));
  const W = base.naturalWidth, H = base.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(base, 0, 0);
  URL.revokeObjectURL(base.src);
  for (const s of stickers) {
    const img = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(s.type, word))}`);
    const size = s.size * W;
    ctx.save();
    ctx.translate(s.x * W, s.y * H);
    ctx.rotate(s.rot);
    if (s.flip) ctx.scale(-1, 1);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  return new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
}

/**
 * @param {Blob} baseBlob photo without stickers
 * @param {{type:string,x:number,y:number,size:number,rot:number,flip?:boolean}[]} initial stickers to start with
 * @param {string} word the pet's sound, for the speech bubble
 * @returns {Promise<{blob: Blob, stickers: object[]}|null>} null when cancelled
 */
export function openStickerEditor(baseBlob, initial = [], word = 'Bark') {
  return new Promise(resolve => {
    let stickers = initial.map(s => ({ ...s }));
    let selected = stickers.length ? stickers.length - 1 : -1;
    const url = URL.createObjectURL(baseBlob);
    const d = document.createElement('dialog');
    d.className = 'sticker-editor';
    d.innerHTML = `
      <header class="se-top">
        <button type="button" class="btn ghost sm" data-se="cancel">Cancel</button>
        <strong>Stickers</strong>
        <button type="button" class="btn primary sm" data-se="done">Done</button>
      </header>
      <div class="se-stage-wrap"><div class="se-stage"><img src="${url}" alt="Your photo" draggable="false"><div class="se-layer"></div></div></div>
      <p class="se-tip muted small">Tap a sticker to add it. Drag to move. Drag the corner to resize and turn.</p>
      <div class="se-tray" role="toolbar" aria-label="Stickers">
        ${ORDER.map(t => `<button type="button" class="se-pick" data-add="${t}" aria-label="Add ${LABELS[t]}" title="${LABELS[t]}">${svgFor(t, word).replace(' width="512" height="512"', '')}</button>`).join('')}
      </div>`;
    document.body.append(d);
    const stage = d.querySelector('.se-stage');
    const layer = d.querySelector('.se-layer');

    function render() {
      layer.innerHTML = stickers.map((s, i) => `
        <div class="stk ${i === selected ? 'on' : ''}" data-i="${i}"
          style="left:${s.x * 100}%; top:${s.y * 100}%; width:${s.size * 100}%; transform: translate(-50%, -50%) rotate(${s.rot}rad) ${s.flip ? 'scaleX(-1)' : ''}">
          ${svgFor(s.type, word).replace(' width="512" height="512"', '')}
          ${i === selected ? `
            <button type="button" class="stk-btn stk-del" data-del="${i}" aria-label="Remove sticker">${icon('close')}</button>
            <button type="button" class="stk-btn stk-flip" data-flip="${i}" aria-label="Flip sticker">${icon('flip')}</button>
            <span class="stk-btn stk-handle" data-handle="${i}" aria-label="Resize and turn"></span>` : ''}
        </div>`).join('');
    }

    function close(result) {
      URL.revokeObjectURL(url);
      d.close();
      resolve(result);
    }

    // ---- pointer gestures: drag to move, corner handle (or two fingers) to scale and rotate
    const pointers = new Map();
    let gesture = null;
    const rect = () => stage.getBoundingClientRect();
    const centerPx = s => { const r = rect(); return { x: r.left + s.x * r.width, y: r.top + s.y * r.height }; };

    function startGesture() {
      const s = stickers[selected];
      if (!s) return;
      const pts = [...pointers.values()];
      if (pts.length >= 2 || gesture?.kind === 'handle') {
        const [a, b] = pts.length >= 2 ? pts : [centerPx(s), pts[0]];
        gesture = { kind: pts.length >= 2 ? 'pinch' : 'handle', dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x), size: s.size, rot: s.rot };
      } else {
        const c = centerPx(s);
        gesture = { kind: 'move', dx: pts[0].x - c.x, dy: pts[0].y - c.y };
      }
    }

    layer.addEventListener('pointerdown', e => {
      const btn = e.target.closest('[data-del], [data-flip]');
      if (btn) return;
      const el = e.target.closest('.stk');
      const handle = e.target.closest('[data-handle]');
      if (!el && pointers.size === 0) { selected = -1; render(); return; }
      if (el && pointers.size === 0) {
        const i = +el.dataset.i;
        if (i !== selected) {
          selected = i;
          stickers.push(stickers.splice(i, 1)[0]); // bring to front
          selected = stickers.length - 1;
          render();
        }
      }
      e.preventDefault();
      layer.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (handle && pointers.size === 1) gesture = { kind: 'handle' };
      startGesture();
    });

    layer.addEventListener('pointermove', e => {
      if (!pointers.has(e.pointerId) || !gesture) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const s = stickers[selected];
      if (!s) return;
      const r = rect();
      const pts = [...pointers.values()];
      if (gesture.kind === 'move') {
        s.x = Math.min(1, Math.max(0, (pts[0].x - gesture.dx - r.left) / r.width));
        s.y = Math.min(1, Math.max(0, (pts[0].y - gesture.dy - r.top) / r.height));
      } else {
        const [a, b] = gesture.kind === 'pinch' ? pts : [centerPx(s), pts[0]];
        if (!b) return;
        const dist = Math.hypot(b.x - a.x, b.y - a.y), angle = Math.atan2(b.y - a.y, b.x - a.x);
        s.size = Math.min(1.5, Math.max(0.06, gesture.size * dist / (gesture.dist || 1)));
        s.rot = gesture.rot + angle - gesture.angle;
      }
      const el = layer.querySelector(`.stk[data-i="${selected}"]`);
      if (el) {
        el.style.left = `${s.x * 100}%`; el.style.top = `${s.y * 100}%`; el.style.width = `${s.size * 100}%`;
        el.style.transform = `translate(-50%, -50%) rotate(${s.rot}rad) ${s.flip ? 'scaleX(-1)' : ''}`;
      }
    });

    const end = e => {
      pointers.delete(e.pointerId);
      if (pointers.size) startGesture(); else gesture = null;
    };
    layer.addEventListener('pointerup', end);
    layer.addEventListener('pointercancel', end);

    d.addEventListener('click', async e => {
      const add = e.target.closest('[data-add]');
      if (add) {
        // Spread new stickers around the middle so they don't land on top of each other.
        const spots = [[0.5, 0.4], [0.3, 0.25], [0.7, 0.25], [0.3, 0.65], [0.7, 0.65], [0.5, 0.75]];
        const [x, y] = spots[stickers.length % spots.length];
        stickers.push({ type: add.dataset.add, x, y, size: 0.3, rot: 0, flip: false });
        selected = stickers.length - 1;
        render();
        return;
      }
      const del = e.target.closest('[data-del]');
      if (del) { stickers.splice(+del.dataset.del, 1); selected = stickers.length - 1; render(); return; }
      const flip = e.target.closest('[data-flip]');
      if (flip) { const s = stickers[+flip.dataset.flip]; s.flip = !s.flip; render(); return; }
      const what = e.target.closest('[data-se]')?.dataset.se;
      if (what === 'cancel') close(null);
      if (what === 'done') {
        const btn = e.target.closest('[data-se]');
        btn.disabled = true;
        btn.textContent = 'Saving...';
        const blob = stickers.length ? await bake(baseBlob, stickers, word) : baseBlob;
        close({ blob, stickers });
      }
    });
    d.addEventListener('cancel', e => { e.preventDefault(); close(null); });
    d.addEventListener('close', () => d.remove());

    d.showModal();
    render();
  });
}
