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
  // ---- toys
  ball: () => `<circle cx="50" cy="50" r="38" fill="#cddc39"/><path d="M20 26c16 10 16 38 0 48M80 26c-16 10-16 38 0 48" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><circle cx="38" cy="36" r="6" fill="#fff" fill-opacity=".35"/>`,
  bone: () => `<g transform="rotate(-30 50 50)" fill="#fff4dc" stroke="#d9b98a" stroke-width="3"><path d="M30 42h40a9 9 0 1 1 9 8 9 9 0 1 1-9 8H30a9 9 0 1 1-9-8 9 9 0 1 1 9-8z"/></g>`,
  frisbee: () => `<ellipse cx="50" cy="54" rx="42" ry="18" fill="#c92a2a"/><ellipse cx="50" cy="48" rx="42" ry="18" fill="#ff6b6b"/><ellipse cx="50" cy="48" rx="24" ry="9" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3"/>`,
  rope: () => `<path d="M22 70 78 30" stroke="#e03131" stroke-width="16" stroke-linecap="round"/><path d="M22 70 78 30" stroke="#fff" stroke-width="16" stroke-dasharray="7 7" stroke-linecap="butt"/><circle cx="18" cy="73" r="11" fill="#5c7cfa"/><circle cx="82" cy="27" r="11" fill="#5c7cfa"/><path d="M10 82l-6 8M14 84l-2 10M86 18l6-8M88 22l10-2" stroke="#5c7cfa" stroke-width="3" stroke-linecap="round"/>`,
  duck: () => `<path d="M18 60c0-14 14-20 26-18-4-6-5-12-2-18 4-9 18-10 24-2 4 5 3 12 0 16 12 0 22 8 22 22 0 14-14 24-36 24S18 74 18 60z" fill="#ffd43b"/><path d="M66 30l14-2-12 8z" fill="#ff922b"/><circle cx="58" cy="26" r="3.5" fill="#212529"/><path d="M30 62c8 6 22 6 30 0" stroke="#f59f00" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  yarn: () => `<circle cx="48" cy="48" r="34" fill="#b197fc"/><path d="M20 36c18 4 38 22 46 40M24 62c14-14 34-26 54-24M40 16c6 18 4 44-8 64" fill="none" stroke="#7048e8" stroke-width="3.5" stroke-linecap="round"/><path d="M76 66c8 6 10 14 6 24" fill="none" stroke="#b197fc" stroke-width="4" stroke-linecap="round"/>`,
  mouse: () => `<path d="M14 64c4-20 22-32 44-28 16 3 24 14 24 24 0 8-8 12-20 12H22c-6 0-9-3-8-8z" fill="#adb5bd"/><circle cx="62" cy="40" r="10" fill="#ced4da"/><circle cx="70" cy="56" r="3" fill="#212529"/><path d="M14 66C6 70 4 80 12 86" fill="none" stroke="#868e96" stroke-width="3" stroke-linecap="round"/><circle cx="84" cy="62" r="3" fill="#ff8787"/>`,
  stick: () => `<path d="M12 74 88 30" stroke="#8d5b35" stroke-width="10" stroke-linecap="round"/><path d="M46 54l10 16M64 44l-2-14" stroke="#8d5b35" stroke-width="6" stroke-linecap="round"/><circle cx="62" cy="28" r="6" fill="#51cf66"/>`,
  // ---- food
  bowl: () => `<circle cx="36" cy="40" r="7" fill="#a0522d"/><circle cx="50" cy="36" r="7" fill="#b5651d"/><circle cx="64" cy="41" r="7" fill="#a0522d"/><circle cx="43" cy="45" r="6" fill="#8b4513"/><circle cx="57" cy="46" r="6" fill="#b5651d"/><path d="M10 48h80l-8 26a6 6 0 0 1-6 4H24a6 6 0 0 1-6-4z" fill="#3b5bfd"/><rect x="8" y="44" width="84" height="9" rx="4.5" fill="#5c7cfa"/><path d="M42 64c0-3 3-5 5-3 2-2 5 0 5 3 0 4-5 6-5 6s-5-2-5-6z" fill="#fff"/>`,
  kibble: () => `<g fill="#a0522d"><circle cx="30" cy="70" r="11"/><circle cx="52" cy="72" r="11"/><circle cx="74" cy="69" r="11"/><circle cx="41" cy="54" r="11"/><circle cx="63" cy="54" r="11"/><circle cx="52" cy="37" r="11"/></g><g fill="#7a3e14"><circle cx="30" cy="70" r="3"/><circle cx="52" cy="72" r="3"/><circle cx="74" cy="69" r="3"/><circle cx="41" cy="54" r="3"/><circle cx="63" cy="54" r="3"/><circle cx="52" cy="37" r="3"/></g>`,
  biscuit: () => `<g transform="rotate(-20 50 50)"><path d="M26 40h48a10 10 0 1 1 8 10 10 10 0 1 1-8 10H26a10 10 0 1 1-8-10 10 10 0 1 1 8-10z" fill="#d9a25f"/><circle cx="40" cy="48" r="2.5" fill="#a86b2d"/><circle cx="52" cy="53" r="2.5" fill="#a86b2d"/><circle cx="62" cy="47" r="2.5" fill="#a86b2d"/></g>`,
  fish: () => `<path d="M14 50c14-20 42-22 58 0-16 22-44 20-58 0z" fill="#ff922b"/><path d="M70 50l18-16v32z" fill="#fd7e14"/><circle cx="30" cy="46" r="4" fill="#212529"/><path d="M42 40c4 6 4 14 0 20" fill="none" stroke="#e8590c" stroke-width="3"/>`,
  carrot: () => `<path d="M58 30 22 84c-2 3 1 6 4 4l44-46z" fill="#ff922b"/><path d="M40 52l6 4M34 62l6 4M46 44l6 4" stroke="#e8590c" stroke-width="3" stroke-linecap="round"/><path d="M60 32c-2-12 2-20 10-24-2 8 0 14 4 18 4-6 12-8 18-6-6 4-8 10-8 16-8-2-16-2-24-4z" fill="#51cf66"/>`,
  cupcake: () => `<path d="M24 54h52l-8 34H32z" fill="#ffd8a8"/><path d="M34 56l4 30M50 56v30M66 56l-4 30" stroke="#f0a35e" stroke-width="2.5"/><path d="M20 56c-6-16 10-26 18-20 2-12 22-14 26-2 10-6 24 4 16 22z" fill="#f783ac"/><circle cx="50" cy="22" r="7" fill="#e03131"/><path d="M50 15c2-6 6-8 10-8" stroke="#2b8a3e" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  // ---- faces
  googly: () => `<circle cx="29" cy="50" r="20" fill="#fff" stroke="#212529" stroke-width="3"/><circle cx="71" cy="50" r="20" fill="#fff" stroke="#212529" stroke-width="3"/><circle cx="34" cy="56" r="9" fill="#212529"/><circle cx="66" cy="44" r="9" fill="#212529"/><circle cx="37" cy="53" r="2.5" fill="#fff"/><circle cx="69" cy="41" r="2.5" fill="#fff"/>`,
  hearteyes: () => `<path d="M28 66S8 54 8 41a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 13-20 25-20 25z" fill="#ff4f7b"/><path d="M72 66S52 54 52 41a10 10 0 0 1 20-3 10 10 0 0 1 20 3c0 13-20 25-20 25z" fill="#ff4f7b"/><circle cx="20" cy="40" r="3" fill="#fff" fill-opacity=".7"/><circle cx="64" cy="40" r="3" fill="#fff" fill-opacity=".7"/>`,
  tongue: () => `<path d="M30 28h40v28a20 20 0 0 1-40 0z" fill="#ff6b9a"/><path d="M50 30v26" stroke="#e64980" stroke-width="3" stroke-linecap="round"/><path d="M24 28c8 6 44 6 52 0" stroke="#c2255c" stroke-width="5" fill="none" stroke-linecap="round"/>`,
  blush: () => `<ellipse cx="24" cy="50" rx="16" ry="10" fill="#ff8fab" fill-opacity=".75"/><ellipse cx="76" cy="50" rx="16" ry="10" fill="#ff8fab" fill-opacity=".75"/><path d="M16 46l4 4M24 44l4 4M68 46l4 4M76 44l4 4" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`,
  wink: () => `<path d="M16 50q13-12 26 0" stroke="#212529" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="71" cy="50" r="14" fill="#212529"/><circle cx="75" cy="45" r="4" fill="#fff"/>`,
  // ---- wear
  bandana: () => `<path d="M8 30h84L50 82z" fill="#e03131"/><path d="M8 30h84" stroke="#c92a2a" stroke-width="6" stroke-linecap="round"/><g fill="#fff"><circle cx="30" cy="40" r="3"/><circle cx="50" cy="42" r="3"/><circle cx="70" cy="40" r="3"/><circle cx="40" cy="54" r="3"/><circle cx="60" cy="54" r="3"/><circle cx="50" cy="66" r="3"/></g>`,
  flowers: () => `<path d="M8 62q42-34 84 0" stroke="#2f9e44" stroke-width="5" fill="none"/>${[[16,56,'#ff8fab'],[32,44,'#ffd43b'],[50,40,'#b197fc'],[68,44,'#ff8fab'],[84,56,'#ffd43b']].map(([x,y,c]) => `<g transform="translate(${x} ${y})"><circle r="5" cx="0" cy="-6" fill="${c}"/><circle r="5" cx="6" cy="0" fill="${c}"/><circle r="5" cx="0" cy="6" fill="${c}"/><circle r="5" cx="-6" cy="0" fill="${c}"/><circle r="3.5" fill="#fff3bf"/></g>`).join('')}`,
  tophat: () => `<rect x="28" y="16" width="44" height="50" rx="4" fill="#212529"/><rect x="28" y="52" width="44" height="9" fill="#e03131"/><ellipse cx="50" cy="70" rx="40" ry="9" fill="#343a40"/>`,
  // ---- fun
  paw: () => `<g fill="#8d5b35"><path d="M50 50c-11 0-21 12-21 20 0 6 4 9 10 9 4 0 7-2 11-2s7 2 11 2c6 0 10-3 10-9 0-8-10-20-21-20z"/><ellipse cx="25" cy="44" rx="7" ry="9"/><ellipse cx="39" cy="28" rx="7" ry="9"/><ellipse cx="61" cy="28" rx="7" ry="9"/><ellipse cx="75" cy="44" rx="7" ry="9"/></g>`,
  sun: () => `<g stroke="#fab005" stroke-width="6" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return `<path d="M${50 + Math.cos(a) * 30} ${50 + Math.sin(a) * 30}L${50 + Math.cos(a) * 42} ${50 + Math.sin(a) * 42}"/>`; }).join('')}</g><circle cx="50" cy="50" r="20" fill="#ffd43b"/>`,
  rainbow: () => `${['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa'].map((c, i) => `<path d="M${10 + i * 5} 72a${40 - i * 5} ${40 - i * 5} 0 0 1 ${80 - i * 10} 0" fill="none" stroke="${c}" stroke-width="5"/>`).join('')}<circle cx="16" cy="74" r="8" fill="#fff"/><circle cx="84" cy="74" r="8" fill="#fff"/>`,
  birthday: () => `<path d="M6 30h88v34H6l8-17z" fill="#7c5cff"/><text x="52" y="53" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="15" font-weight="800" fill="#fff">HAPPY BIRTHDAY</text>`,
  // ---- words
  say: (word, text) => {
    const lines = wrapWords(text || `${word}!`, 11);
    const longest = Math.max(...lines.map(l => l.length));
    const size = Math.min(22, Math.floor(86 / (0.6 * longest)));
    const top = 46 - ((lines.length - 1) * size * 1.1) / 2;
    return `<path d="M12 16h76a10 10 0 0 1 10 10v38a10 10 0 0 1-10 10H40L22 90l2-16H12A10 10 0 0 1 2 64V26a10 10 0 0 1 10-10z" fill="#fff" stroke="#12151b" stroke-width="4" stroke-linejoin="round"/>`
      + lines.map((l, i) => `<text x="50" y="${(top + i * size * 1.1 + size * 0.35).toFixed(1)}" text-anchor="middle" font-family="-apple-system, Segoe UI, Roboto, sans-serif" font-size="${size}" font-weight="800" fill="#12151b">${escapeXml(l)}</text>`).join('');
  },
  sound: word => STICKERS.say(word, `${word}!`),
};

function wrapWords(text, max) {
  const out = [];
  for (const w of String(text).split(/\s+/)) {
    const last = out[out.length - 1];
    if (last && (last + ' ' + w).length <= max) out[out.length - 1] = last + ' ' + w;
    else out.push(w);
  }
  return out.slice(0, 3);
}
const escapeXml = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SAYINGS = ['Hi!', 'Treat please?', 'Walk?', 'Play with me!', 'Feed me!', 'I love you', 'Zzz', 'Who, me?', 'Best day ever', 'Good boy', 'Good girl', 'Squirrel!', 'Not my fault', 'Bath? No thanks', 'Is that for me?', 'Nap time', 'Throw it!', 'Mine!'];

// Sticker tray tabs. Each entry is [type, label, text?]
const CATEGORIES = word => [
  ['Fun', [['heart', 'Heart'], ['star', 'Star'], ['sparkles', 'Sparkles'], ['paw', 'Paw print'], ['sun', 'Sun'], ['rainbow', 'Rainbow'], ['cutie', 'Cutie label'], ['birthday', 'Happy birthday']]],
  ['Wear', [['hat', 'Party hat'], ['crown', 'Crown'], ['tophat', 'Top hat'], ['bowtie', 'Bow tie'], ['bow', 'Hair bow'], ['bandana', 'Bandana'], ['flowers', 'Flower crown']]],
  ['Faces', [['googly', 'Googly eyes'], ['hearteyes', 'Heart eyes'], ['sunglasses', 'Sunglasses'], ['glasses', 'Glasses'], ['wink', 'Wink'], ['tongue', 'Tongue out'], ['blush', 'Blush'], ['mustache', 'Mustache']]],
  ['Toys', [['ball', 'Tennis ball'], ['bone', 'Bone'], ['frisbee', 'Frisbee'], ['rope', 'Rope toy'], ['duck', 'Rubber duck'], ['yarn', 'Ball of yarn'], ['mouse', 'Toy mouse'], ['stick', 'Stick']]],
  ['Food', [['bowl', 'Food bowl'], ['kibble', 'Kibble'], ['biscuit', 'Dog biscuit'], ['fish', 'Fish'], ['carrot', 'Carrot'], ['cupcake', 'Cupcake']]],
  ['Words', [['say', `${word}!`, `${word}!`], ...SAYINGS.map(t => ['say', t, t])]],
];


const svgFor = (type, word, text) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">${(STICKERS[type] || STICKERS.heart)(word, text)}</svg>`;

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
    const img = await loadImg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgFor(s.type, word, s.text))}`);
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
      <div class="se-cats" role="tablist">${CATEGORIES(word).map(([name], i) => `<button type="button" class="se-cat ${i === 0 ? 'on' : ''}" data-cat="${i}">${name}</button>`).join('')}</div>
      <div class="se-tray" role="toolbar" aria-label="Stickers"></div>`;
    document.body.append(d);
    const stage = d.querySelector('.se-stage');
    const layer = d.querySelector('.se-layer');

    const cats = CATEGORIES(word);
    function renderTray(i) {
      d.querySelectorAll('.se-cat').forEach(b => b.classList.toggle('on', +b.dataset.cat === i));
      d.querySelector('.se-tray').innerHTML = cats[i][1].map(([t, label, text]) =>
        `<button type="button" class="se-pick" data-add="${t}" ${text ? `data-text="${escapeXml(text)}"` : ''} aria-label="Add ${escapeXml(label)}" title="${escapeXml(label)}">${svgFor(t, word, text).replace(' width="512" height="512"', '')}</button>`).join('');
    }

    function render() {
      layer.innerHTML = stickers.map((s, i) => `
        <div class="stk ${i === selected ? 'on' : ''}" data-i="${i}"
          style="left:${s.x * 100}%; top:${s.y * 100}%; width:${s.size * 100}%; transform: translate(-50%, -50%) rotate(${s.rot}rad) ${s.flip ? 'scaleX(-1)' : ''}">
          ${svgFor(s.type, word, s.text).replace(' width="512" height="512"', '')}
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
      const cat = e.target.closest('[data-cat]');
      if (cat) { renderTray(+cat.dataset.cat); return; }
      const add = e.target.closest('[data-add]');
      if (add) {
        // Spread new stickers around the middle so they don't land on top of each other.
        const spots = [[0.5, 0.4], [0.3, 0.25], [0.7, 0.25], [0.3, 0.65], [0.7, 0.65], [0.5, 0.75]];
        const [x, y] = spots[stickers.length % spots.length];
        stickers.push({ type: add.dataset.add, text: add.dataset.text || undefined, x, y, size: add.dataset.add === 'say' ? 0.36 : 0.3, rot: 0, flip: false });
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
    renderTray(0);
    render();
  });
}
