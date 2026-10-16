// Everything is stored online (Supabase) so friends on other phones can follow each other.
import * as db from './cloud.js';
import * as auth from './cloud.js';
import { processPhoto, processVideo, MAX_VIDEO_SECONDS } from './media.js';
import { THEMES, Scene, findTheme, renderPreview } from './themes.js';
import { icon } from './icons.js';
import { openCamera, cameraBlockedHelp } from './camera.js';
import { soundFor, countLabel, PET_TYPES } from './sounds.js';
import { showTrophy } from './celebrate.js';
import { openStickerEditor } from './stickers.js';
import { ageText, trickName, cardImage, goalImage } from './petcard.js';
import { PUSH_PUBLIC_KEY } from './config.js';

const $app = document.getElementById('app');
const scene = new Scene(document.getElementById('scene'));
const MOMENT_TTL = 24 * 60 * 60 * 1000;
const PRIVACY_URL = 'https://vibe331212.github.io/PetPost/privacy.html';
const actions = {};
const forms = {};
let me = null;
let draft = null;
let momentGroups = [];
let viewer = null;

// ---------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plural = (n, word) => `${word}${n === 1 ? '' : 's'}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 604800) return `${Math.floor(s / 86400)}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const blobURLs = new Map();
function blobURL(key, blob) {
  if (typeof blob === 'string') return blob; // already an online link
  let url = blobURLs.get(key);
  if (!url) { url = URL.createObjectURL(blob); blobURLs.set(key, url); }
  return url;
}
function dropURL(key) {
  const url = blobURLs.get(key);
  if (url) { URL.revokeObjectURL(url); blobURLs.delete(key); }
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function avatar(u, size = 'md') {
  const inner = u?.avatar
    ? `<img src="${blobURL(`av:${u.username}:${u.avatarAt}`, u.avatar)}" alt="">`
    : `<span>${esc((u?.petName || u?.displayName || '?').charAt(0).toUpperCase())}</span>`;
  return `<span class="avatar ${size}">${inner}</span>`;
}

// When PetPost runs inside the iPhone app, it can ask the phone for things a website can't do.
const Native = (() => {
  const h = window.webkit?.messageHandlers?.petpost;
  return { on: !!h, send(m) { try { h?.postMessage(m); } catch { /* not in the app */ } } };
})();
const blobToBase64 = blob => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

const extFor = type => type.includes('mp4') ? 'mp4' : type.includes('webm') ? 'webm' : type.includes('png') ? 'png' : 'jpg';
async function downloadBlob(blob, name, text = '') {
  if (typeof blob === 'string') blob = await (await fetch(blob)).blob();
  if (Native.on) { blobToBase64(blob).then(data => Native.send({ type: 'share', data, name, text })); return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileName = p => `petpost-${p.author}-${p.id.slice(0, 8)}.${extFor(p.mediaMime || p.media?.type || '')}`;

async function usersMap() {
  const map = new Map();
  (await db.all('users')).forEach(u => map.set(u.username, u));
  return map;
}
// Sample accounts run by PetPost (not real people) get a small AI tag next to their name.
const aiTag = u => (u?.ai ? ' <span class="ai-tag" title="A sample account made by PetPost, not a real person">AI</span>' : '');

// ---------- more than one pet
// Each pet has its own name, type, pet card details, streak and goals. The pet you picked is copied into
// the account's top-level fields (petName, petType...), so the rest of the app just uses those.
// petCount is for groups: "The chickens" with a petCount of 10.
const PET_FIELDS = ['petName', 'petType', 'petCount', 'breed', 'birthday', 'treat', 'toy', 'practiceDays', 'streakTrophies'];
const petFields = u => Object.fromEntries(PET_FIELDS.map(k => [k, u?.[k]]));
const petsOf = u => (Array.isArray(u?.pets) && u.pets.length ? u.pets : [{ id: 'pet-1', ...petFields(u) }]);
const activePetId = u => (petsOf(u).some(p => p.id === u?.activePet) ? u.activePet : petsOf(u)[0].id);
// Goals made before there were several pets belong to the first pet.
const goalForPet = (g, u, petId = activePetId(u)) => (g.petId || petsOf(u)[0].id) === petId;
function syncActivePet(u) {
  const id = activePetId(u);
  u.pets = petsOf(u).map(p => (p.id === id ? { ...p, ...petFields(u) } : p));
  u.activePet = id;
}
function usePet(u, id) {
  syncActivePet(u);
  const pet = u.pets.find(p => p.id === id);
  if (!pet) return;
  for (const k of PET_FIELDS) u[k] = pet[k] ?? (k === 'practiceDays' || k === 'streakTrophies' ? [] : '');
  u.activePet = id;
}
// The same person, showing one of their other pets (for looking at someone else's profile).
const withPet = (u, id) => ({ ...u, ...petFields(petsOf(u).find(p => p.id === id) || u) });
// "Dog", or "10 Chickens" for a group.
const IRREGULAR = { mouse: 'Mice', goose: 'Geese', sheep: 'Sheep', fish: 'Fish', deer: 'Deer' };
const typePlural = t => IRREGULAR[t.toLowerCase()] || (/(s|sh|ch|x)$/i.test(t) ? `${t}es` : `${t}s`);
const petKind = p => (+p?.petCount > 1 && p.petType ? `${p.petCount} ${typePlural(p.petType)}` : p?.petType || '');
// "Rosie", "Rosie & Pip", "Rosie, Pip & The chickens".
const joinNames = names => (names.length < 3 ? names.join(' & ') : `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`);
// Which of your pets a post is about: the ones ticked on the post page, or the pet you're posting as.
// petId stays the first one for older code; petIds lists them all; petName reads "Rosie & The chickens".
function petTag(ids = [activePetId(me)]) {
  syncActivePet(me);
  const pets = me.pets.filter(p => ids.includes(p.id));
  if (!pets.length) return { petId: activePetId(me), petIds: [activePetId(me)], petName: me.petName || '' };
  return { petId: pets[0].id, petIds: pets.map(p => p.id), petName: joinNames(pets.map(p => p.petName).filter(Boolean)) };
}
const saveMe = () => { syncActivePet(me); return db.put('users', me); };

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function applyTheme(id) {
  const theme = findTheme(id);
  document.body.dataset.tone = theme.tone;
  Native.send({ type: 'tone', tone: theme.tone });
  document.documentElement.style.setProperty('--accent', theme.accent);
  scene.set(theme);
  const chip = document.querySelector('.mode-chip span');
  if (chip) chip.textContent = theme.name;
}

// ---------- event delegation
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !actions[el.dataset.action]) return;
  if (el.tagName !== 'INPUT') e.preventDefault();
  actions[el.dataset.action](el, e);
});
document.addEventListener('submit', e => {
  const form = e.target;
  if (!forms[form.dataset.form]) return;
  e.preventDefault();
  forms[form.dataset.form](form, new FormData(form));
});
document.addEventListener('dblclick', e => {
  const media = e.target.closest('.post .media');
  if (!media || e.target.closest('button, .vid-bar, .interact')) return;
  const btn = media.closest('.post').querySelector('[data-action="lick"]');
  media.classList.remove('burst'); void media.offsetWidth; media.classList.add('burst');
  if (!btn.classList.contains('on')) actions.lick(btn);
});

// On phones the fixed bottom bar rides up on top of the keyboard; hide it while typing.
const isTyping = el => el?.matches?.('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea, select');
document.addEventListener('focusin', e => { if (isTyping(e.target)) document.body.classList.add('typing'); });
document.addEventListener('focusout', () => setTimeout(() => {
  if (!isTyping(document.activeElement)) document.body.classList.remove('typing');
}, 50));

function formError(form, msg) {
  const el = form.querySelector('.form-error');
  if (el) el.textContent = msg;
}

// ---------- routing
function parts() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
}

async function route() {
  closeViewer();
  document.body.classList.remove('scroll-mode');
  if (!me) return renderAuth();
  if (!me.cameraAsked) return renderPermission();
  const [view = 'feed', a, b] = parts();
  const views = { feed: viewFeed, create: viewCreate, post: viewPost, profile: viewProfile, goals: viewGoals, modes: viewModes, care: viewCare, people: viewPeople, notifications: viewNotifications, reports: viewReports, scroll: viewScroll };
  const fn = views[view] || viewFeed;
  if (draft && view !== 'create') resetDraft();
  shell(views[view] ? view : 'feed', a);
  const main = document.getElementById('view');
  try {
    await fn(main, a, b);
    hydrateInteractives(main);
    updateCareBadge();
    updateBell();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card empty"><p>Something went wrong: ${esc(err.message)}</p></div>`;
  }
  if (!main.dataset.keepScroll) window.scrollTo(0, 0);
}

function shell(active, arg) {
  const tab = (id, ic, label, href, on = active === id) =>
    `<a href="${href}" class="nav-item ${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  $app.innerHTML = `
    <header class="topbar ${db.isAdmin() ? 'admin' : ''}">
      <div class="row top-left">
        <a href="#/feed" class="brand">${icon('paw')}<span>PetPost</span></a>
        ${db.isAdmin() ? `<a class="mode-chip icon-chip ${active === 'reports' ? 'on' : ''}" href="#/reports" aria-label="Reports" title="Reports">${icon('flag')}</a>` : ''}
      </div>
      <div class="row top-actions">
        <a class="mode-chip icon-chip" href="#/people" aria-label="Find people" title="Find people">${icon('users')}</a>
        <a class="mode-chip icon-chip bell ${active === 'notifications' ? 'on' : ''}" href="#/notifications" aria-label="Notifications" title="Notifications">${icon('bell')}<span class="bell-badge" hidden></span></a>
        ${isInstalled() ? '' : `<button class="mode-chip install-chip" data-action="install">${icon('download')}<span>Install app</span></button>`}
        <a class="mode-chip" href="#/modes">${icon('mode')}<span>${esc(findTheme(me.theme).name)}</span></a>
      </div>
    </header>
    <main id="view" class="shell"></main>
    <nav class="nav" aria-label="Main">
      ${tab('feed', 'home', 'Home', '#/feed')}
      ${tab('goals', 'goal', 'Goals', '#/goals')}
      ${tab('create', 'plus', 'Post', '#/create')}
      ${tab('care', 'care', 'Care', '#/care')}
      ${tab('profile', 'user', 'Profile', `#/profile/${me.username}`, active === 'profile' && (!arg || arg === me.username))}
    </nav>`;
}

// ---------- auth
function renderAuth(mode = 'signin') {
  const signin = `
    <form data-form="signin" class="stack">
      <label class="field"><span>Username</span><input name="username" autocomplete="username" required autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label>
      <p class="form-error" role="alert"></p>
      <button class="btn primary block">Sign in</button>
    </form>`;
  const signup = `
    <form data-form="signup" class="stack">
      <div class="two">
        <label class="field"><span>Your name</span><input name="displayName" autocomplete="name" maxlength="40" required placeholder="Sam"><small class="muted">Your own name. Shown in bold on your posts.</small></label>
        <label class="field"><span>Username</span><input name="username" autocomplete="username" required maxlength="24" autocapitalize="off" spellcheck="false" placeholder="sam_and_biscuit"><small class="username-hint muted">Shown as @username on your posts. No spaces.</small></label>
      </div>
      <div class="two">
        <label class="field"><span>Pet's name</span><input name="petName" maxlength="40" required placeholder="Biscuit"><small class="muted">Shown after your @username</small></label>
        <label class="field"><span>Pet type</span>
          <select name="petType">${PET_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
          <small class="sound-hint muted">${soundHint('Dog')}</small>
        </label>
      </div>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="At least 8 characters"></label>
      <label class="field"><span>Confirm password</span><input name="confirm" type="password" autocomplete="new-password" minlength="8" required></label>
      <p class="form-error" role="alert"></p>
      <button class="btn primary block">Create account</button>
    </form>`;
  $app.innerHTML = `
    <main class="auth">
      <div class="card auth-card">
        <div class="brand big">${icon('paw')}<span>PetPost</span></div>
        <p class="muted center">Share your pet's best moments.</p>
        <div class="seg" role="tablist">
          <button role="tab" aria-selected="${mode === 'signin'}" class="${mode === 'signin' ? 'on' : ''}" data-action="auth-mode" data-mode="signin">Sign in</button>
          <button role="tab" aria-selected="${mode === 'signup'}" class="${mode === 'signup' ? 'on' : ''}" data-action="auth-mode" data-mode="signup">Create account</button>
        </div>
        ${mode === 'signin' ? signin : signup}
        <p class="fine">${icon('shield')} <span>Your password is encrypted. Sign in on any phone or computer to see your PetPost. <a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy policy</a></span></p>
      </div>
    </main>`;
  $app.querySelector('input')?.focus();
}

actions['auth-mode'] = el => renderAuth(el.dataset.mode);

function soundHint(petType) {
  const s = soundFor(petType);
  return s.word === 'Comment' ? 'Comments will just be called Comments.' : `Comments will be called ${s.words}, like "${s.prompt}"`;
}
document.addEventListener('input', e => {
  if (e.target.name !== 'username' || !e.target.closest('form[data-form="signup"]')) return;
  const cleaned = auth.cleanUsername(e.target.value);
  const hint = e.target.parentElement.querySelector('.username-hint');
  if (hint) hint.textContent = cleaned ? `Your username will be @${cleaned}` : 'Shown as @username on your posts. No spaces.';
});
document.addEventListener('change', e => {
  if (e.target.name === 'username' && e.target.closest('form[data-form="signup"]')) e.target.value = auth.cleanUsername(e.target.value);
  if (e.target.name !== 'petType') return;
  const hint = e.target.form?.querySelector('.sound-hint');
  if (hint) hint.textContent = soundHint(e.target.value);
});

// ---------- first-run camera permission
async function cameraState() {
  try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch { return 'prompt'; }
}

async function renderPermission() {
  if (!navigator.mediaDevices?.getUserMedia || (await cameraState()) === 'granted') return finishPermission();
  $app.innerHTML = `
    <main class="auth">
      <div class="card auth-card permission">
        <div class="perm-icon">${icon('camera')}</div>
        <h1 class="center">Allow camera access</h1>
        <p class="muted center">PetPost uses your camera so you can snap photos and record videos of ${esc(me.petName || 'your pet')} right in the app.</p>
        <ul class="perm-list">
          <li>${icon('photo')}<span>Take photos, record videos and share moments without leaving the app.</span></li>
          <li>${icon('mute')}<span>Your microphone is only used while you record, and voices are removed by default.</span></li>
        </ul>
        <p class="form-error perm-msg" role="alert"></p>
        <button class="btn primary block" data-action="allow-camera">${icon('camera')}Allow camera</button>
        <button class="btn ghost block" data-action="skip-camera">Not now</button>
      </div>
    </main>`;
}

async function finishPermission() {
  me.cameraAsked = true;
  await saveMe();
  route();
}

actions['allow-camera'] = async el => {
  el.disabled = true;
  try {
    // This call is what makes the browser show its "Allow camera?" popup.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .catch(() => navigator.mediaDevices.getUserMedia({ video: true }));
    stream.getTracks().forEach(t => t.stop());
    toast('Camera ready');
    finishPermission();
  } catch (err) {
    el.disabled = false;
    document.querySelector('.perm-msg').textContent = err.name === 'NotFoundError'
      ? 'No camera was found on this device. You can still choose files to post.'
      : `${await cameraBlockedHelp()} Or tap Not now and choose files instead.`;
    el.textContent = 'Try again';
  }
};

actions['skip-camera'] = () => finishPermission();

async function withBusy(form, fn) {
  const btn = form.querySelector('button.primary');
  btn.disabled = true;
  try { await fn(); } catch (err) { formError(form, err.message); } finally { btn.disabled = false; }
}

forms.signin = (form, fd) => withBusy(form, async () => {
  me = await auth.signIn(fd.get('username'), fd.get('password'));
  await refreshBlocked();
  syncPush();
  syncNativeCare();
  applyTheme(me.theme);
  go('#/feed');
});

forms.signup = (form, fd) => withBusy(form, async () => {
  if (fd.get('password') !== fd.get('confirm')) throw new Error('Those passwords do not match.');
  me = await auth.signUp({
    username: fd.get('username'), password: fd.get('password'),
    displayName: fd.get('displayName'), petName: fd.get('petName'), petType: fd.get('petType'),
  });
  applyTheme(me.theme);
  toast(`Welcome to PetPost, ${me.petName || me.displayName}`);
  go('#/feed');
});

actions['sign-out'] = async () => {
  await turnOffPush().catch(() => {}); // the next person on this phone shouldn't get your notifications
  await auth.signOut();
  me = null;
  syncNativeCare();
  applyTheme('clean');
  history.replaceState(null, '', location.pathname);
  renderAuth();
};

// ---------- posts
function mediaEl(p, { autoplay = false } = {}) {
  const src = blobURL(p.id, p.media);
  // Reserving the picture's shape stops the page jumping as photos load.
  const shape = p.width && p.height ? ` style="aspect-ratio:${p.width}/${p.height}"` : '';
  if (p.mediaType === 'video') {
    // Feed videos play by themselves when they scroll into view (see "videos in the feed" below).
    return `<video src="${src}#t=0.001" class="feed-video" muted playsinline preload="metadata" ${autoplay ? 'autoplay' : ''} loop${shape}></video>
      <span class="vid-paused" hidden>${icon('play')}</span>
      <button type="button" class="vid-sound" data-action="video-sound" aria-label="${soundOn ? 'Turn sound off' : 'Turn sound on'}">${icon(soundOn ? 'sound' : 'mute')}</button>
      <div class="vid-bar" role="slider" tabindex="0" aria-label="Video position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span class="vid-bar-fill"></span></div>`;
  }
  return `<img src="${src}" alt="Photo shared by ${esc(p.author)}" loading="lazy"${shape}>`;
}

// ---------- videos in the feed, like Instagram and TikTok:
// the video you scroll to plays by itself, it stops when you scroll away, a tap pauses it,
// and the speaker button turns sound on or off for every video until you turn it off again.
let soundOn = false;
const visible = new Map(); // video -> how much of it is on screen (0 to 1)
const videoWatcher = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) visible.set(e.target, e.intersectionRatio);
    else { visible.delete(e.target); e.target.dataset.userPaused = ''; }
  }
  playMostVisible();
}, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });

function playMostVisible() {
  let best = null, bestRatio = 0.6; // at least 60% on screen
  for (const [v, r] of visible) {
    if (!v.isConnected) { visible.delete(v); continue; }
    if (r >= bestRatio && !v.dataset.userPaused) { best = v; bestRatio = r; }
  }
  document.querySelectorAll('video.feed-video').forEach(v => { if (v !== best && !v.paused) v.pause(); });
  if (best && best.paused && !document.hidden) playVideo(best);
}

function playVideo(v) {
  v.muted = !soundOn;
  v.play().catch(() => {
    // Phones only allow sound after a tap; fall back to playing silently.
    if (!v.muted) { v.muted = true; setSound(false); v.play().catch(() => {}); }
  });
}

function setSound(on) {
  soundOn = on;
  document.querySelectorAll('video.feed-video').forEach(v => { v.muted = !on || v.paused; });
  document.querySelectorAll('.vid-sound').forEach(b => {
    b.innerHTML = icon(on ? 'sound' : 'mute');
    b.setAttribute('aria-label', on ? 'Turn sound off' : 'Turn sound on');
  });
}

actions['video-sound'] = el => {
  setSound(!soundOn);
  const v = el.closest('.media')?.querySelector('video');
  if (v && soundOn) { delete v.dataset.userPaused; playVideo(v); }
  playMostVisible();
};

// Show the play sign on paused videos, and only ever let one video make sound.
document.addEventListener('play', e => {
  if (!e.target.matches?.('video.feed-video')) return;
  e.target.parentElement.querySelector('.vid-paused')?.setAttribute('hidden', '');
  document.querySelectorAll('video.feed-video').forEach(v => { if (v !== e.target) v.pause(); });
}, true);
document.addEventListener('pause', e => {
  if (!e.target.matches?.('video.feed-video')) return;
  if (e.target.dataset.userPaused) e.target.parentElement.querySelector('.vid-paused')?.removeAttribute('hidden');
}, true);

// One tap pauses or plays. Two quick taps are a Lick, so wait a moment to see if a second tap comes.
let tapTimer = null;
document.addEventListener('click', e => {
  const v = e.target.closest('.media')?.querySelector('video.feed-video');
  if (!v || e.target.closest('button, a, .vid-bar, .interact')) return;
  clearTimeout(tapTimer);
  if (e.detail > 1) return;
  tapTimer = setTimeout(() => {
    if (v.paused) { delete v.dataset.userPaused; playVideo(v); }
    else { v.dataset.userPaused = '1'; v.pause(); }
  }, 260);
});

// Watch every feed video as it appears on the page.
new MutationObserver(() => {
  document.querySelectorAll('video.feed-video:not([data-watched])').forEach(v => { v.dataset.watched = '1'; videoWatcher.observe(v); });
}).observe(document.body, { childList: true, subtree: true });

// The thin bar along the bottom shows how far through the video is. Drag it (or tap it) to skip.
const barOf = v => v.parentElement?.querySelector('.vid-bar');
function showProgress(v) {
  const bar = barOf(v);
  if (!bar || !v.duration) return;
  const pct = (v.currentTime / v.duration) * 100;
  bar.firstElementChild.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', Math.round(pct));
}
// Smooth while a video plays (timeupdate alone only fires a few times a second), idle otherwise.
let ticking = false;
function tick() {
  const v = [...document.querySelectorAll('video.feed-video')].find(x => !x.paused);
  if (!v) { ticking = false; return; }
  showProgress(v);
  requestAnimationFrame(tick);
}
document.addEventListener('playing', e => {
  if (e.target.matches?.('video.feed-video') && !ticking) { ticking = true; requestAnimationFrame(tick); }
}, true);
document.addEventListener('loadedmetadata', e => { if (e.target.matches?.('video.feed-video')) showProgress(e.target); }, true);
document.addEventListener('seeked', e => { if (e.target.matches?.('video.feed-video')) showProgress(e.target); }, true);

function seekTo(bar, clientX) {
  const v = bar.parentElement.querySelector('video');
  if (!v?.duration) return;
  const box = bar.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  v.currentTime = ratio * v.duration;
  showProgress(v);
}
document.addEventListener('pointerdown', e => {
  const bar = e.target.closest('.vid-bar');
  if (!bar) return;
  e.preventDefault();
  bar.setPointerCapture(e.pointerId);
  bar.classList.add('dragging');
  seekTo(bar, e.clientX);
});
document.addEventListener('pointermove', e => {
  const bar = e.target.closest?.('.vid-bar.dragging');
  if (bar) seekTo(bar, e.clientX);
});
const stopDrag = e => e.target.closest?.('.vid-bar')?.classList.remove('dragging');
document.addEventListener('pointerup', stopDrag);
document.addEventListener('pointercancel', stopDrag);
document.addEventListener('keydown', e => {
  const bar = e.target.closest?.('.vid-bar');
  const v = bar?.parentElement.querySelector('video');
  if (!v?.duration || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + (e.key === 'ArrowRight' ? 5 : -5)));
});

// Stop when you switch apps or lock the phone; carry on when you come back.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.querySelectorAll('video.feed-video').forEach(v => v.pause());
  else playMostVisible();
});

function postCard(p, author, from = 'feed') {
  author = author || { username: p.author, displayName: p.author };
  const licked = p.licks.includes(me.username);
  const saved = me.saved.includes(p.id);
  const own = p.author === me.username;
  const n = p.licks.length, b = p.barkCount || 0;
  return `
    <article class="card post" data-post="${p.id}">
      <header class="post-head">
        <a href="#/profile/${esc(author.username)}">${avatar(author)}</a>
        <div class="who">
          <a href="#/profile/${esc(author.username)}" class="name">${esc(author.displayName)}${aiTag(author)}</a>
          <span class="sub">@${esc(author.username)}${p.petName || author.petName ? ` · ${esc(p.petName || author.petName)}` : ''} · ${ago(p.createdAt)}</span>
        </div>
        ${own ? `<button class="icon-btn" data-action="delete-post" data-id="${p.id}" aria-label="Delete post">${icon('trash')}</button>`
              : `<button class="icon-btn" data-action="report" data-post="${p.id}" data-user="${esc(p.author)}" aria-label="Report post" title="Report">${icon('flag')}</button>`}
      </header>
      <div class="media">${mediaEl(p)}<span class="lick-burst">${icon('lick')}</span>
        <button type="button" class="scroll-open" data-action="scroll-mode" data-id="${p.id}" data-from="${esc(from)}" aria-label="Full screen" title="Full screen">${icon('expand')}</button>
        ${interactCard(p)}
      </div>
      <div class="actions">
        <button class="act lick ${licked ? 'on' : ''}" data-action="lick" data-id="${p.id}" aria-pressed="${licked}">${icon('lick')}<span class="count">${n}</span><span class="lbl">${plural(n, 'Lick')}</span></button>
        <a class="act" href="#/post/${p.id}/${encodeURIComponent(from)}" data-action="toggle-barks" data-id="${p.id}">${icon('bark')}<span class="count bark-count">${b}</span><span class="lbl">${countLabel(b, me.petType)}</span></a>
        <button class="act" data-action="share" data-id="${p.id}">${icon('share')}<span class="lbl">Share</span></button>
        <span class="spacer"></span>
        <button class="act" data-action="download" data-id="${p.id}" aria-label="Save to device" title="Save to device">${icon('download')}</button>
        <button class="act save ${saved ? 'on' : ''}" data-action="save" data-id="${p.id}" aria-pressed="${saved}" aria-label="Save post" title="Save">${icon('bookmark')}</button>
      </div>
      ${p.goalTitle ? `<a class="goal-tag" href="#/profile/${esc(p.author)}/goals">${icon('goal')}${esc(p.goalTitle)}</a>` : ''}
      ${p.caption ? `<p class="caption"><strong>${esc(author.displayName)}</strong> ${esc(p.caption)}</p>` : ''}
    </article>`;
}

// ---------- polls, quizzes, question boxes and rating sliders on posts
// The card is drawn blank first; hydrateInteractives fills in your vote, answer or rating and the
// totals for every card on the page in two requests. The post's owner sees totals and who responded.
const interactPosts = new Map();
const clampPos = v => Math.min(0.92, Math.max(0.08, +v || 0.5));
const clampSize = v => Math.min(1.5, Math.max(0.6, +v || 1));
// Turned by this many degrees (-180 to 180); snaps straight when it's within a few degrees of level.
const clampTurn = v => { const d = ((((+v || 0) + 180) % 360) + 360) % 360 - 180; return Math.abs(d) < 4 ? 0 : Math.round(d); };
function interactCard(p) {
  const own = p.author === me.username;
  // A sticker on top of the photo or video, where (and how big) the poster put it.
  const pos = p.iPos || {};
  const place = `left:${clampPos(pos.x ?? 0.5) * 100}%;top:${clampPos(pos.y ?? 0.72) * 100}%;--s:${clampSize(pos.s ?? 1)};--r:${clampTurn(pos.r)}deg`;
  const card = (type, body) => { interactPosts.set(p.id, p); return `<div class="interact" data-post="${p.id}" data-type="${type}" style="${place}">${body}<p class="i-foot"></p></div>`; };
  if (p.poll || p.quiz) {
    const it = p.poll || p.quiz;
    return card(p.poll ? 'poll' : 'quiz', `
      <p class="i-q">${p.quiz ? '<span class="i-tag">Quiz</span>' : ''}${esc(it.question)}</p>
      ${it.options.map((o, k) => `<button type="button" class="i-choice" data-action="post-vote" data-id="${p.id}" data-choice="${k}" ${own ? 'disabled' : ''}><span class="i-fill"></span><span class="i-label">${esc(o)}</span><span class="i-pct"></span></button>`).join('')}`);
  }
  if (p.ask) return card('ask', `
    <p class="i-q">${esc(p.ask.prompt)}</p>
    ${own ? '' : `<form data-form="post-answer" data-id="${p.id}" class="i-answer"><input name="answer" maxlength="300" placeholder="Type your answer" autocomplete="off" aria-label="Your answer"><button class="btn primary sm">Send</button></form>`}`);
  if (p.rate) return card('rate', `
    <p class="i-q">${esc(p.rate.question)}</p>
    ${own ? '' : `<div class="i-rate"><input type="range" min="1" max="10" step="1" value="5" aria-label="Your rating, 1 to 10"><output>5</output><button type="button" class="btn primary sm" data-action="post-rate" data-id="${p.id}">Rate</button></div>`}`);
  return '';
}

async function hydrateInteractives(root) {
  const cards = [...root.querySelectorAll('.interact:not([data-ready])')];
  if (!cards.length) return;
  const ids = [...new Set(cards.map(c => c.dataset.post))];
  const [rows, totals] = await Promise.all([db.responsesFor(ids), db.postResults(ids)]);
  for (const c of cards) {
    c.dataset.ready = '1';
    renderInteract(c, rows.filter(r => r.postId === c.dataset.post), totals[c.dataset.post]);
  }
}

function renderInteract(card, rows, totals = {}) {
  const p = interactPosts.get(card.dataset.post);
  if (!p) return;
  card.responses = rows;
  const own = p.author === me.username;
  const mineOf = kind => rows.find(r => r.user === me.username && r.kind === kind)?.value;
  const others = kind => rows.filter(r => r.user !== me.username && r.kind === kind).length;
  const words = (n, w) => (n === 1 ? w : w.endsWith('s') ? `${w}es` : `${w}s`);
  const seeWho = (n, word) => n ? `${n} ${words(n, word)} · <button type="button" class="i-link" data-action="post-responses" data-id="${p.id}">See who</button>` : `No ${words(2, word)} yet`;
  const foot = card.querySelector('.i-foot');
  const type = card.dataset.type;
  if (type === 'poll' || type === 'quiz') {
    const vote = mineOf('vote');
    if (own || vote != null) showChoiceResults(card, p, totals.votes || {}, vote);
    if (own) foot.innerHTML = seeWho(others('vote'), type === 'quiz' ? 'guess' : 'vote');
  } else if (type === 'ask') {
    const answer = mineOf('answer');
    if (answer != null) card.querySelector('.i-answer')?.replaceWith(Object.assign(document.createElement('p'), { className: 'i-done', textContent: `You answered: “${answer}”` }));
    if (own) foot.innerHTML = seeWho(others('answer'), 'answer');
  } else if (type === 'rate') {
    const rating = mineOf('rating');
    if (own || rating != null) showRating(card, totals, rating);
    if (own) foot.innerHTML = seeWho(others('rating'), 'rating');
  }
}

function showChoiceResults(card, p, votes, myVote) {
  const it = p.poll || p.quiz;
  const total = it.options.reduce((n, _, k) => n + (votes[k] || 0), 0);
  card.classList.add('answered');
  card.querySelectorAll('.i-choice').forEach(b => {
    const k = b.dataset.choice, pct = total ? Math.round(((votes[k] || 0) / total) * 100) : 0;
    b.querySelector('.i-fill').style.width = `${pct}%`;
    b.querySelector('.i-pct').textContent = `${pct}%`;
    b.classList.toggle('mine', myVote != null && String(myVote) === k);
    if (p.quiz) {
      b.classList.toggle('right', +k === p.quiz.answer);
      b.classList.toggle('wrong', myVote != null && String(myVote) === k && +k !== p.quiz.answer);
    }
  });
  if (p.quiz && myVote != null && p.author !== me.username) {
    const right = +myVote === p.quiz.answer;
    const pctRight = total ? Math.round(((votes[p.quiz.answer] || 0) / total) * 100) : 0;
    card.querySelector('.i-foot').textContent = `${right ? 'You got it right!' : `Not quite. The answer was “${p.quiz.options[p.quiz.answer]}”.`} ${pctRight}% of people got it right.`;
  } else if (!p.quiz && p.author !== me.username) {
    card.querySelector('.i-foot').textContent = `${total} ${plural(total, 'vote')}`;
  }
}

function showRating(card, totals, mine) {
  card.querySelector('.i-rate')?.remove();
  const avg = totals.average != null ? Math.round(totals.average * 10) / 10 : null;
  const n = totals.ratings || 0;
  card.classList.add('answered');
  card.querySelector('.i-score')?.remove();
  card.querySelector('.i-q').insertAdjacentHTML('afterend', `
    <div class="i-score"><div class="i-meter"><span style="width:${avg ? avg * 10 : 0}%"></span></div><strong>${avg ?? '–'}<small>/10</small></strong></div>`);
  card.querySelector('.i-foot').textContent = `${n ? `Average from ${n} ${plural(n, 'rating')}` : 'No ratings yet'}${mine != null ? ` · You gave ${mine}` : ''}`;
}

actions['post-vote'] = async el => {
  const card = el.closest('.interact'), p = interactPosts.get(el.dataset.id);
  if (!p || p.author === me.username || card.classList.contains('answered')) return;
  card.classList.add('answered'); // no second vote while this one saves
  try {
    await db.respondToMoment(p.id, 'vote', el.dataset.choice);
    const totals = (await db.postResults([p.id]))[p.id] || {};
    showChoiceResults(card, p, totals.votes || {}, el.dataset.choice);
  } catch (err) { card.classList.remove('answered'); toast(`Could not save it: ${err.message}`); }
};

forms['post-answer'] = async (form, fd) => {
  const text = String(fd.get('answer') || '').trim();
  if (!text || form.dataset.sending) return;
  form.dataset.sending = '1';
  try {
    await db.respondToMoment(form.dataset.id, 'answer', text);
    form.replaceWith(Object.assign(document.createElement('p'), { className: 'i-done', textContent: `You answered: “${text}”` }));
    toast('Answer sent');
  } catch (err) { delete form.dataset.sending; toast(`Could not send it: ${err.message}`); }
};

document.addEventListener('input', e => {
  if (e.target.matches?.('.i-rate input[type="range"]')) e.target.nextElementSibling.textContent = e.target.value;
});
actions['post-rate'] = async el => {
  const card = el.closest('.interact');
  const value = card.querySelector('.i-rate input').value;
  el.disabled = true;
  try {
    await db.respondToMoment(el.dataset.id, 'rating', value);
    showRating(card, (await db.postResults([el.dataset.id]))[el.dataset.id] || {}, value);
  } catch (err) { el.disabled = false; toast(`Could not save it: ${err.message}`); }
};

// On your own post: who voted, guessed, answered or rated.
actions['post-responses'] = el => {
  const card = el.closest('.interact'), p = interactPosts.get(el.dataset.id);
  const rows = (card.responses || []).filter(r => r.user !== me.username).sort((a, b) => b.at - a.at);
  const it = p.poll || p.quiz;
  const what = r => r.kind === 'vote' ? `${p.quiz ? 'Guessed' : 'Voted'} “${esc(it?.options[r.value] ?? '')}”${p.quiz ? (+r.value === p.quiz.answer ? ' (right)' : ' (wrong)') : ''}`
    : r.kind === 'rating' ? `Rated ${esc(r.value)}/10` : `“${esc(r.value)}”`;
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `
    <header class="row"><h2>Responses</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
    <ul class="i-who">${rows.map(r => `<li><a href="#/profile/${esc(r.user)}" data-action="close-dialog-to" data-href="#/profile/${esc(r.user)}">@${esc(r.user)}</a><span>${what(r)}</span><span class="muted small">${ago(r.at)}</span></li>`).join('')}</ul>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};
actions['close-dialog-to'] = el => { el.closest('dialog').close(); go(el.dataset.href); };

// ---------- scroll mode: full screen, one post at a time, and each swipe snaps to the next post (like TikTok)
actions['scroll-mode'] = el => go(`#/scroll/${el.dataset.id}/${encodeURIComponent(el.dataset.from || 'feed')}`);
actions['close-scroll'] = () => actions.back();

async function viewScroll(main, id, from = 'feed') {
  const p = await db.get('posts', id);
  if (!p) { main.innerHTML = `<div class="card empty"><p>This post is no longer here.</p><a class="btn ghost" href="#/feed">Back to feed</a></div>`; return; }
  const [users, list] = await Promise.all([usersMap(), postsFor(from, p)]);
  const slide = x => {
    const author = users.get(x.author) || { username: x.author, displayName: x.author };
    const licked = x.licks.includes(me.username), n = x.licks.length, b = x.barkCount || 0;
    return `
      <article class="post slide" data-post="${x.id}">
        <div class="media">${mediaEl(x)}<span class="lick-burst">${icon('lick')}</span>${interactCard(x)}</div>
        <div class="slide-info">
          <a class="slide-who" href="#/profile/${esc(author.username)}">${avatar(author, 'sm')}<span><strong>${esc(author.displayName)}</strong> <span class="sub">@${esc(author.username)} · ${ago(x.createdAt)}</span></span></a>
          ${x.caption ? `<p class="slide-caption">${esc(x.caption)}</p>` : ''}
        </div>
        <div class="slide-rail">
          <button class="act lick ${licked ? 'on' : ''}" data-action="lick" data-id="${x.id}" aria-pressed="${licked}">${icon('lick')}<span class="count">${n}</span><span class="lbl sr-only">${plural(n, 'Lick')}</span></button>
          <button class="act" data-action="toggle-barks" data-id="${x.id}">${icon('bark')}<span class="count bark-count">${b}</span><span class="lbl sr-only">${countLabel(b, me.petType)}</span></button>
          <button class="act" data-action="share" data-id="${x.id}" aria-label="Share">${icon('share')}</button>
        </div>
      </article>`;
  };
  main.innerHTML = `
    <div class="scroller" tabindex="-1" aria-label="Scroll mode">
      <button class="icon-btn scroll-close" data-action="close-scroll" aria-label="Leave scroll mode">${icon('close')}</button>
      ${list.map(slide).join('')}
    </div>`;
  document.body.classList.add('scroll-mode');
  const scroller = main.querySelector('.scroller');
  main.querySelector(`.slide[data-post="${id}"]`)?.scrollIntoView({ block: 'start' });
  scroller.focus({ preventScroll: true }); // so the arrow keys move between posts on a computer
  // Remember which post you're on, so coming back (say, from its comments) lands on the same one.
  const seen = new IntersectionObserver(entries => {
    const e = entries.find(x => x.isIntersecting);
    if (e && location.hash.startsWith('#/scroll/')) history.replaceState(null, '', `#/scroll/${e.target.dataset.post}/${encodeURIComponent(from)}`);
  }, { root: scroller, threshold: 0.6 });
  scroller.querySelectorAll('.slide').forEach(s => seen.observe(s));
}

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !document.body.classList.contains('scroll-mode') || document.querySelector('dialog[open]')) return;
  const sheet = document.querySelector('.barks.sheet');
  if (sheet) actions['close-barks'](sheet); else actions.back();
});

actions.lick = async el => {
  const p = await db.get('posts', el.dataset.id);
  if (!p) return;
  const i = p.licks.indexOf(me.username);
  p.lickedAt ||= {};
  if (i >= 0) { p.licks.splice(i, 1); delete p.lickedAt[me.username]; }
  else { p.licks.push(me.username); p.lickedAt[me.username] = Date.now(); }
  await db.put('posts', p);
  const on = i < 0;
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', on);
  el.querySelector('.count').textContent = p.licks.length;
  el.querySelector('.lbl').textContent = plural(p.licks.length, 'Lick');
  if (on) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
};

actions.save = async el => {
  const id = el.dataset.id;
  const i = me.saved.indexOf(id);
  if (i >= 0) me.saved.splice(i, 1); else me.saved.unshift(id);
  await saveMe();
  el.classList.toggle('on', i < 0);
  el.setAttribute('aria-pressed', i < 0);
  toast(i < 0 ? 'Saved to your profile' : 'Removed from saved');
};

actions.download = async el => {
  const p = await db.get('posts', el.dataset.id);
  if (!p) return;
  downloadBlob(p.media, fileName(p));
  if (!Native.on) toast(p.mediaType === 'video' ? 'Video saved to your device' : 'Photo saved to your device');
};

actions.share = async el => {
  const p = await db.get('posts', el.dataset.id);
  if (!p) return;
  const text = p.caption || `A post from @${p.author} on PetPost`;
  if (Native.on) return downloadBlob(p.media, fileName(p), text);
  const blob = typeof p.media === 'string' ? await (await fetch(p.media)).blob() : p.media;
  const file = new File([blob], fileName(p), { type: blob.type });
  const data = { title: 'PetPost', text, files: [file] };
  if (navigator.canShare?.(data)) {
    try { await navigator.share(data); }
    catch (err) { if (err.name !== 'AbortError') toast('Sharing did not work. Try saving it instead.'); }
  } else {
    downloadBlob(blob, fileName(p));
    toast('This browser cannot share files, so it was saved to your device to share from there.');
  }
};

async function deletePost(id) {
  const comments = await db.byIndex('comments', 'postId', id);
  await Promise.all(comments.map(c => db.del('comments', c.id)));
  await db.del('posts', id);
  dropURL(id);
  const i = me.saved.indexOf(id);
  if (i >= 0) { me.saved.splice(i, 1); await saveMe(); }
}

actions['delete-post'] = async el => {
  if (!confirm('Delete this post? This cannot be undone.')) return;
  await deletePost(el.dataset.id);
  toast('Post deleted');
  if (parts()[0] === 'post') go('#/feed');
  else el.closest('.post')?.remove();
};

actions.back = () => (history.length > 1 ? history.back() : go('#/feed'));

// ---------- feed
async function viewFeed(main) {
  const [posts, users] = await Promise.all([db.all('posts'), usersMap()]);
  const now = Date.now();
  const following = new Set([...(me.following || []), me.username]);
  posts.splice(0, posts.length, ...posts.filter(p => !blockedSet.has(p.author)));
  const mode = feedMode();
  const feed = posts.filter(p => p.kind !== 'moment' && (mode === 'all' || following.has(p.author))).sort((a, b) => b.createdAt - a.createdAt);

  // clean up expired moments
  posts.filter(p => p.kind === 'moment' && p.expiresAt <= now && p.author === me.username && !p.highlight).forEach(p => deletePost(p.id));

  const groups = new Map();
  posts.filter(p => p.kind === 'moment' && p.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach(m => { if (!groups.has(m.author)) groups.set(m.author, []); groups.get(m.author).push(m); });
  momentGroups = [...groups.entries()]
    .map(([u, list]) => ({ user: users.get(u) || { username: u, displayName: u }, list }))
    .sort((a, b) => (b.user.username === me.username) - (a.user.username === me.username)
      || groupSeen(a) - groupSeen(b) // moments you haven't watched come first
      || b.list.at(-1).createdAt - a.list.at(-1).createdAt);

  // Profiles you dragged up here, for getting to them fast.
  const shortcuts = (me.shortcuts || []).map(n => users.get(n)).filter(u => u && !blockedSet.has(u.username));

  main.innerHTML = `
    <section class="card moments" aria-label="Moments">
      <a class="moment-bubble" href="#/create/moment"><span class="ring add">${icon('plus')}</span><span class="mb-name">Add moment</span></a>
      ${shortcuts.map(u => `
        <a class="moment-bubble shortcut" href="#/profile/${esc(u.username)}" data-shortcut="${esc(u.username)}">
          <span class="ring pin">${avatar(u, 'lg')}</span>
          <span class="mb-name">${esc(u.username === me.username ? 'You' : u.displayName)}</span>
        </a>`).join('')}
      ${momentGroups.map((g, i) => `
        <button class="moment-bubble" data-action="open-moments" data-index="${i}">
          <span class="ring ${groupSeen(g) ? 'seen' : ''}">${avatar(g.user, 'lg')}</span>
          <span class="mb-name">${esc(g.user.username === me.username ? 'You' : g.user.displayName)}</span>
        </button>`).join('')}
    </section>
    <div class="seg feed-seg">
      <button class="${mode === 'all' ? 'on' : ''}" data-action="feed-mode" data-mode="all">Everyone</button>
      <button class="${mode === 'following' ? 'on' : ''}" data-action="feed-mode" data-mode="following">Following</button>
    </div>
    ${feed.length ? feed.map(p => postCard(p, users.get(p.author))).join('') : mode === 'following' && !(me.following || []).length ? `
      <div class="card empty">
        ${icon('users', 'big')}
        <h2>Follow some pets</h2>
        <p class="muted">Posts from people you follow show up here.</p>
        <a class="btn primary" href="#/people">${icon('users')}Find people</a>
      </div>` : `
      <div class="card empty">
        ${icon('paw', 'big')}
        <h2>Your feed is waiting</h2>
        <p class="muted">Share a photo, video or moment of your pet.</p>
        <a class="btn primary" href="#/create">${icon('plus')}Create your first post</a>
      </div>`}`;
}

// ---------- profile shortcuts
// Press and hold someone's picture on a post, drag it up to the top row, and let go: a circle appears
// there that takes you straight to their profile. Press and hold a circle to remove it.
const HOLD_MS = 280;
let press = null;
let dragged = false; // swallow the tap that ends a drag
const swallowTap = () => { dragged = true; setTimeout(() => { dragged = false; }, 450); };

function startPress(e) {
  if (e.button > 0 || !document.querySelector('#view .moments')) return;
  const shortcut = e.target.closest('.moments .shortcut');
  const av = !shortcut && e.target.closest('.post-head .avatar');
  if (!shortcut && !av) return;
  const user = shortcut ? shortcut.dataset.shortcut : decodeURIComponent(av.closest('a[href^="#/profile/"]').getAttribute('href').split('/').pop());
  press = { x: e.clientX, y: e.clientY, user, shortcut, av, timer: setTimeout(() => held(), HOLD_MS) };
}

function held() {
  if (!press) return;
  Native.send({ type: 'haptic', style: 'light' });
  if (press.shortcut) {
    const user = press.user; press = null; swallowTap();
    const remove = confirm(`Remove @${user} from your shortcuts?`);
    dragged = false; // the question box already took the touch, so the next tap is a real one
    if (remove) {
      me.shortcuts = (me.shortcuts || []).filter(n => n !== user);
      saveMe(); viewFeed(document.getElementById('view'));
    }
    return;
  }
  const r = press.av.getBoundingClientRect();
  const ghost = press.av.cloneNode(true);
  ghost.className = `${press.av.className} drag-ghost`;
  ghost.style.width = ghost.style.height = `${r.width * 1.3}px`;
  document.body.append(ghost);
  press.ghost = ghost;
  document.body.classList.add('dragging-profile');
  moveGhost(press.x, press.y);
}

function moveGhost(x, y) {
  press.ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  const row = document.querySelector('#view .moments');
  const r = row?.getBoundingClientRect();
  press.over = !!r && y < r.bottom + 30 && y > r.top - 30;
  row?.classList.toggle('drop-here', press.over);
  // Near the top of the screen, scroll up so the row comes into view.
  const top = document.querySelector('.topbar')?.getBoundingClientRect().bottom || 0;
  if (y < top + 70 && window.scrollY > 0) window.scrollBy(0, -14);
}

function movePress(e) {
  if (!press) return;
  if (!press.ghost) {
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(); // they're scrolling, not holding
    return;
  }
  e.preventDefault();
  moveGhost(e.clientX, e.clientY);
}

function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  const { ghost, over, user } = press;
  press = null;
  if (!ghost) return;
  swallowTap();
  ghost.remove();
  document.body.classList.remove('dragging-profile');
  document.querySelector('#view .moments')?.classList.remove('drop-here');
  if (!over) return;
  const list = (me.shortcuts || []).filter(n => n !== user);
  me.shortcuts = [user, ...list].slice(0, 20);
  saveMe();
  Native.send({ type: 'haptic', style: 'success' });
  viewFeed(document.getElementById('view'));
  toast(`Added @${user} to your shortcuts`);
}

document.addEventListener('pointerdown', startPress);
document.addEventListener('pointermove', movePress, { passive: false });
document.addEventListener('pointerup', endPress);
document.addEventListener('pointercancel', () => { if (press && !press.ghost) endPress(); });
// On phones, follow the finger with touch events too, and keep the page from scrolling under it.
document.addEventListener('touchmove', e => {
  if (!press?.ghost) return;
  e.preventDefault();
  moveGhost(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });
document.addEventListener('touchend', endPress);
document.addEventListener('click', e => {
  if (!dragged) return;
  dragged = false;
  e.preventDefault(); e.stopPropagation();
}, true);
document.addEventListener('contextmenu', e => { if (e.target.closest('.post-head .avatar, .moments .shortcut')) e.preventDefault(); });

function feedMode() {
  try { return localStorage.getItem('petpost.feed') === 'following' ? 'following' : 'all'; } catch { return 'all'; }
}
actions['feed-mode'] = el => {
  try { localStorage.setItem('petpost.feed', el.dataset.mode); } catch { /* remembered for this visit only */ }
  viewFeed(document.getElementById('view'));
};

// ---------- moments viewer
// Moments play one after another: photos for a few seconds, videos to the end. Polls, questions and
// reactions sit on top; the person who posted sees who reacted, voted and answered.
const REACTIONS = [['lick', 'Lick'], ['flame', 'Fire'], ['sparkle', 'Wow'], ['paw', 'Paws up']];
actions['open-moments'] = el => openViewer(momentGroups, +el.dataset.index, firstUnseen(momentGroups[+el.dataset.index]));

// Which moments you've watched, kept with your account (as id -> when it disappears) so your other
// devices know too. A ring turns grey once you've seen all of that person's moments.
let seenMap = null, seenFor = null, seenChanged = false;
function seen() {
  if (seenFor !== me.username) { seenMap = new Map(Object.entries(me.seenMoments || {})); seenFor = me.username; }
  return seenMap;
}
const groupSeen = g => g.list.every(m => seen().has(m.id));
const firstUnseen = g => Math.max(0, g.list.findIndex(m => !seen().has(m.id)));
function markSeen(m) {
  if (m.kind !== 'moment' || !(m.expiresAt > Date.now()) || seen().has(m.id)) return;
  seen().set(m.id, m.expiresAt);
  seenChanged = true;
}
function saveSeen() {
  if (!seenChanged || !me) return;
  seenChanged = false;
  const now = Date.now();
  me.seenMoments = Object.fromEntries([...seen()].filter(([, gone]) => gone > now));
  saveMe().catch(() => {});
  document.querySelectorAll('.moments [data-action="open-moments"]').forEach(b => {
    const g = momentGroups[+b.dataset.index];
    if (g) b.querySelector('.ring').classList.toggle('seen', groupSeen(g));
  });
}

function openViewer(groups, gi, i = 0) {
  closeViewer();
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Moments');
  document.body.append(el);
  viewer = { el, groups, gi, i, raf: 0, paused: 0 };
  document.addEventListener('keydown', viewerKeys);
  showMoment();
}

function viewerKeys(e) {
  if (e.target.closest?.('input, textarea')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') stepMoment(1);
  if (e.key === 'ArrowLeft') stepMoment(-1);
}

function closeViewer() {
  if (!viewer) return;
  cancelAnimationFrame(viewer.raf);
  clearTimeout(viewer.holdTimer);
  viewer.el.remove();
  viewer = null;
  document.removeEventListener('keydown', viewerKeys);
  saveSeen();
}

// Press and hold to pause a moment (the bars and buttons fade so you can see it). Letting go
// carries on, and doesn't count as a tap to the next one.
document.addEventListener('pointerdown', e => {
  if (!viewer || !e.target.closest?.('.viewer .tap, .viewer .viewer-media')) return;
  clearTimeout(viewer.holdTimer);
  viewer.holdTimer = setTimeout(() => {
    if (!viewer) return;
    viewer.holding = true;
    viewer.el.classList.add('holding');
    pauseMoment();
  }, 220);
});
function endHold() {
  if (!viewer) return;
  clearTimeout(viewer.holdTimer);
  if (!viewer.holding) return;
  viewer.holding = false;
  viewer.heldAt = Date.now();
  viewer.el.classList.remove('holding');
  resumeMoment();
}
document.addEventListener('pointerup', endHold);
document.addEventListener('pointercancel', endHold);
document.addEventListener('contextmenu', e => { if (e.target.closest?.('.viewer')) e.preventDefault(); });
const justHeld = () => viewer && Date.now() - (viewer.heldAt || 0) < 400;

// Pausing is counted, so typing an answer while the activity list is open still keeps it paused.
function pauseMoment() {
  if (!viewer) return;
  viewer.paused++;
  viewer.el.querySelector('.viewer-media video')?.pause();
}
function resumeMoment() {
  if (!viewer || !viewer.paused) return;
  if (--viewer.paused) return;
  viewer.el.querySelector('.viewer-media video')?.play().catch(() => {});
}

function showMoment() {
  const g = viewer.groups[viewer.gi];
  if (!g) return closeViewer();
  const m = g.list[viewer.i];
  const own = m.author === me.username;
  cancelAnimationFrame(viewer.raf);
  viewer.paused = 0;
  viewer.holding = false;
  viewer.el.classList.remove('holding');
  markSeen(m);
  viewer.el.innerHTML = `
    <div class="viewer-inner" data-post="${m.id}">
      <div class="bars">${g.list.map((_, k) => `<span><i style="width:${k < viewer.i ? 100 : 0}%"></i></span>`).join('')}</div>
      <header>
        ${avatar(g.user, 'sm')}
        <strong>${esc(g.user.displayName)}</strong><span class="muted-light">${ago(m.createdAt)}</span>
        <span class="spacer"></span>
        ${own ? `<button class="icon-btn light" data-action="delete-moment" data-id="${m.id}" aria-label="Delete moment">${icon('trash')}</button>` : ''}
        <button class="icon-btn light" data-action="close-viewer" aria-label="Close">${icon('close')}</button>
      </header>
      <div class="viewer-media">${m.mediaType === 'video'
        ? `<video src="${blobURL(m.id, m.media)}" playsinline autoplay></video>`
        : `<img src="${blobURL(m.id, m.media)}" alt="Moment from ${esc(g.user.displayName)}">`}</div>
      ${m.poll ? `
        <div class="m-card m-poll">
          <strong>${esc(m.poll.question)}</strong>
          ${m.poll.options.map((o, k) => `<button type="button" class="m-choice" data-action="moment-vote" data-choice="${k}"><span class="m-fill"></span><span class="m-label">${esc(o)}</span><span class="m-pct"></span></button>`).join('')}
        </div>` : ''}
      ${m.ask ? `
        <div class="m-card m-ask">
          <strong>${esc(m.ask.prompt)}</strong>
          ${own ? '<p class="m-note">Answers show up in your activity.</p>' : `
            <form data-form="moment-answer" class="m-answer">
              <input name="answer" maxlength="300" placeholder="Type your answer" autocomplete="off" aria-label="Your answer">
              <button class="btn primary sm">Send</button>
            </form>`}
        </div>` : ''}
      <div class="viewer-foot">
        ${m.caption ? `<p class="viewer-cap">${esc(m.caption)}</p>` : ''}
        ${own ? `
          <div class="m-bar">
            <button type="button" class="m-pill" data-action="moment-activity">${icon('users')}<span>Activity</span><span class="m-count"></span></button>
            <button type="button" class="m-pill ${m.highlight ? 'on' : ''}" data-action="moment-highlight" aria-pressed="${!!m.highlight}">${icon('sparkle')}<span>${m.highlight ? 'In highlights' : 'Add to highlights'}</span></button>
          </div>` : `
          <div class="m-bar m-reactions">
            ${REACTIONS.map(([k, label]) => `<button type="button" class="m-react" data-action="moment-react" data-reaction="${k}" aria-label="${label}" aria-pressed="false">${icon(k)}</button>`).join('')}
          </div>`}
      </div>
      <button class="tap prev" data-action="moment-prev" aria-label="Previous"></button>
      <button class="tap next" data-action="moment-next" aria-label="Next"></button>
    </div>`;
  const bar = viewer.el.querySelectorAll('.bars i')[viewer.i];
  const video = viewer.el.querySelector('video');
  if (video) {
    video.play().catch(() => { video.muted = true; video.play(); });
    video.ontimeupdate = () => { bar.style.width = `${(video.currentTime / video.duration) * 100 || 0}%`; };
    video.onended = () => stepMoment(1);
  } else {
    // Longer when there's a poll or question to read.
    const length = m.poll || m.ask ? 9000 : 5000;
    let elapsed = 0, last = performance.now();
    const tick = now => {
      if (!viewer) return;
      if (!viewer.paused) elapsed += now - last;
      last = now;
      const f = Math.min(1, elapsed / length);
      bar.style.width = `${f * 100}%`;
      if (f >= 1) stepMoment(1); else viewer.raf = requestAnimationFrame(tick);
    };
    viewer.raf = requestAnimationFrame(tick);
  }
  loadMomentResponses(m);
}

// Fill in your vote, answer and reaction (and, on your own moment, everyone's) once they load.
async function loadMomentResponses(m) {
  let rows;
  try { rows = await db.momentResponses(m.id); } catch { return; } // database not updated yet
  const root = viewer?.el.querySelector(`.viewer-inner[data-post="${m.id}"]`);
  if (!root) return;
  const mine = Object.fromEntries(rows.filter(r => r.user === me.username).map(r => [r.kind, r.value]));
  m.responses = rows;
  if (mine.reaction) root.querySelector(`[data-reaction="${mine.reaction}"]`)?.classList.add('on');
  if (mine.answer) showAnswered(root);
  if (m.author === me.username) {
    const others = rows.filter(r => r.user !== me.username).length;
    root.querySelector('.m-count').textContent = others ? others : '';
    if (m.poll) showPollResults(root, m, countVotes(rows));
  } else if (m.poll && mine.vote != null) {
    showPollResults(root, m, await db.pollResults(m.id).catch(() => ({})), mine.vote);
  }
}

const countVotes = rows => rows.filter(r => r.kind === 'vote').reduce((acc, r) => ({ ...acc, [r.value]: (acc[r.value] || 0) + 1 }), {});

function showPollResults(root, m, counts, myChoice) {
  const total = m.poll.options.reduce((n, _, k) => n + (counts[k] || 0), 0);
  root.querySelector('.m-poll')?.classList.add('voted');
  root.querySelectorAll('.m-choice').forEach(b => {
    const k = b.dataset.choice, pct = total ? Math.round(((counts[k] || 0) / total) * 100) : 0;
    b.querySelector('.m-fill').style.width = `${pct}%`;
    b.querySelector('.m-pct').textContent = `${pct}%`;
    b.classList.toggle('mine', myChoice != null && String(myChoice) === k);
  });
}

function showAnswered(root) {
  const form = root.querySelector('.m-answer');
  if (form) form.outerHTML = '<p class="m-note">Answer sent</p>';
}

actions['moment-vote'] = async el => {
  const root = el.closest('.viewer-inner');
  const m = currentMoment();
  if (!m || m.author === me.username || root.querySelector('.m-poll.voted')) return;
  try {
    await db.respondToMoment(m.id, 'vote', el.dataset.choice);
    showPollResults(root, m, await db.pollResults(m.id), el.dataset.choice);
  } catch (err) { toast(`Could not vote: ${err.message}`); }
};

forms['moment-answer'] = async (form, fd) => {
  const text = String(fd.get('answer') || '').trim();
  const m = currentMoment();
  if (!text || !m || form.dataset.sending) return;
  form.dataset.sending = '1';
  try {
    await db.respondToMoment(m.id, 'answer', text);
    form.querySelector('input').blur();
    showAnswered(form.closest('.viewer-inner'));
    toast('Answer sent');
  } catch (err) {
    delete form.dataset.sending;
    toast(`Could not send it: ${err.message}`);
  }
};

actions['moment-react'] = async el => {
  const m = currentMoment();
  if (!m) return;
  const on = !el.classList.contains('on');
  el.parentElement.querySelectorAll('.m-react').forEach(b => { b.classList.toggle('on', b === el && on); b.setAttribute('aria-pressed', b === el && on); });
  if (on) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
  try { await db.respondToMoment(m.id, 'reaction', on ? el.dataset.reaction : null); }
  catch (err) { toast(`Could not react: ${err.message}`); }
};

actions['moment-highlight'] = async el => {
  const m = currentMoment();
  if (!m || m.author !== me.username) return;
  m.highlight = !m.highlight;
  try {
    await db.put('posts', m);
    el.classList.toggle('on', m.highlight);
    el.setAttribute('aria-pressed', m.highlight);
    el.querySelector('span').textContent = m.highlight ? 'In highlights' : 'Add to highlights';
    toast(m.highlight ? 'Added to your highlights. It stays on your profile.' : 'Removed from your highlights');
  } catch (err) { m.highlight = !m.highlight; toast(`Could not save: ${err.message}`); }
};

// Who reacted, voted and answered, on your own moment.
actions['moment-activity'] = el => {
  const m = currentMoment();
  const root = el.closest('.viewer-inner');
  if (!m || root.querySelector('.m-activity')) return;
  const rows = (m.responses || []).filter(r => r.user !== me.username).sort((a, b) => b.at - a.at);
  const line = r => r.kind === 'reaction' ? `${icon(r.value)}<span>${esc(REACTIONS.find(([k]) => k === r.value)?.[1] || 'Reacted')}</span>`
    : r.kind === 'vote' ? `${icon('check')}<span>Voted “${esc(m.poll?.options[r.value] ?? '')}”</span>`
    : `${icon('bark')}<span>“${esc(r.value)}”</span>`;
  pauseMoment();
  root.insertAdjacentHTML('beforeend', `
    <div class="m-activity">
      <header class="row"><h2>Activity</h2><span class="spacer"></span><button class="icon-btn light" data-action="moment-activity-close" aria-label="Close activity">${icon('close')}</button></header>
      ${rows.length ? `<ul>${rows.map(r => `<li><a href="#/profile/${esc(r.user)}" data-action="close-viewer-to" data-href="#/profile/${esc(r.user)}"><strong>@${esc(r.user)}</strong></a><span class="m-what">${line(r)}</span><span class="muted-light">${ago(r.at)}</span></li>`).join('')}</ul>`
        : '<p class="m-note">No reactions, votes or answers yet.</p>'}
    </div>`);
};
actions['moment-activity-close'] = el => { el.closest('.m-activity').remove(); resumeMoment(); };
actions['close-viewer-to'] = el => { closeViewer(); go(el.dataset.href); };

const currentMoment = () => viewer?.groups[viewer.gi]?.list[viewer.i];

// Typing an answer pauses the moment until you're done.
document.addEventListener('focusin', e => { if (e.target.closest?.('.viewer .m-answer')) pauseMoment(); });
document.addEventListener('focusout', e => { if (e.target.closest?.('.viewer .m-answer')) resumeMoment(); });

function stepMoment(dir) {
  if (!viewer) return;
  const g = viewer.groups[viewer.gi];
  viewer.i += dir;
  if (viewer.i >= g.list.length) { viewer.gi++; viewer.i = viewer.groups[viewer.gi] ? firstUnseen(viewer.groups[viewer.gi]) : 0; }
  else if (viewer.i < 0) {
    viewer.gi--;
    if (viewer.gi < 0) { viewer.gi = 0; viewer.i = 0; }
    else viewer.i = viewer.groups[viewer.gi].list.length - 1;
  }
  if (viewer.gi >= viewer.groups.length) return closeViewer();
  showMoment();
}

actions['moment-next'] = () => { if (!justHeld()) stepMoment(1); };
actions['moment-prev'] = () => { if (!justHeld()) stepMoment(-1); };
actions['close-viewer'] = () => closeViewer();
actions['delete-moment'] = async el => {
  if (!confirm('Delete this moment?')) return;
  await deletePost(el.dataset.id);
  closeViewer();
  route();
};

// ---------- single post + barks
function barkRow(c, author, post) {
  const canDelete = c.author === me.username || post.author === me.username;
  return `
    <div class="bark" data-bark="${c.id}">
      <a href="#/profile/${esc(c.author)}">${avatar(author, 'sm')}</a>
      <div class="bark-body">
        <p><a class="name" href="#/profile/${esc(c.author)}">${esc(author?.displayName || c.author)}${aiTag(author)}</a> <span class="sub">${soundFor(author?.petType).past} · ${ago(c.createdAt)}</span></p>
        <p>${esc(c.text)}</p>
      </div>
      ${canDelete ? `<button class="icon-btn sm" data-action="delete-bark" data-id="${c.id}" data-post="${post.id}" aria-label="Delete comment">${icon('trash')}</button>` : ''}
    </div>`;
}

// The posts a tapped photo belongs to: a profile ("u:name"), its videos ("v:name"), your saved posts, or the home feed.
async function postsFor(scope, post) {
  const [kind, name] = scope.split(':');
  let list;
  if (kind === 'u' || kind === 'v') list = await db.byIndex('posts', 'author', name);
  else if (kind === 'saved') list = (await Promise.all((me.saved || []).map(id => db.get('posts', id)))).filter(Boolean);
  else {
    const following = new Set([...(me.following || []), me.username]);
    list = (await db.all('posts')).filter(p => feedMode() === 'all' || following.has(p.author));
  }
  list = list.filter(p => p.kind !== 'moment' && !blockedSet.has(p.author) && (kind !== 'v' || p.mediaType === 'video'));
  if (kind !== 'saved') list.sort((a, b) => b.createdAt - a.createdAt);
  return list.some(p => p.id === post.id) ? list : [post];
}

function barksSection(p, barks, users, sheet = false) {
  const sound = soundFor(me.petType);
  return `
    <section class="card barks${sheet ? ' sheet' : ''}" data-post="${p.id}">
      <header class="row barks-head">
        <h2>${sound.words}</h2>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-action="close-barks" aria-label="Close ${esc(sound.words.toLowerCase())}">${icon('close')}</button>
      </header>
      <div class="bark-list">
        ${barks.length ? barks.map(c => barkRow(c, users.get(c.author), p)).join('') : `<p class="muted no-barks">No ${sound.words.toLowerCase()} yet. Start the conversation.</p>`}
      </div>
      <form data-form="bark" data-id="${p.id}" class="bark-form">
        ${avatar(me, 'sm')}
        <input name="text" maxlength="400" placeholder="${sound.prompt}" required autocomplete="off" aria-label="Write a comment">
        <button class="btn primary sm">${sound.word}</button>
      </form>
    </section>`;
}

async function viewPost(main, id, from) {
  const p = await db.get('posts', id);
  if (!p) { main.innerHTML = `<div class="card empty"><p>This post is no longer here.</p><a class="btn ghost" href="#/feed">Back to feed</a></div>`; return; }
  const scope = from || `u:${p.author}`;
  const [users, list, barks] = await Promise.all([
    usersMap(), postsFor(scope, p),
    db.byIndex('comments', 'postId', id).then(l => l.filter(c => !blockedSet.has(c.author)).sort((a, b) => a.createdAt - b.createdAt)),
  ]);
  const [kind, name] = scope.split(':');
  const owner = users.get(name);
  const title = kind === 'saved' ? 'Saved' : kind === 'feed' || !name ? 'Home' : kind === 'v' ? `${owner?.displayName || name}'s videos` : `${owner?.displayName || name}'s posts`;
  main.innerHTML = `
    <div class="list-head"><button class="back" data-action="back">${icon('back')}Back</button><span class="list-title">${esc(title)}</span></div>
    ${list.map(x => postCard(x, users.get(x.author), scope) + (x.id === id ? barksSection(x, barks, users) : '')).join('')}`;
  // Start at the post you tapped; you can scroll up for newer posts and down for older ones.
  main.dataset.keepScroll = '1';
  const jump = () => {
    const card = main.querySelector(`.post[data-post="${id}"]`);
    if (card) window.scrollTo(0, card.getBoundingClientRect().top + window.scrollY - (document.querySelector('.topbar')?.offsetHeight || 70) - 8);
  };
  jump();
  // Photos above may still be loading; settle the position once they have.
  const above = [...main.querySelectorAll('.post')].slice(0, list.findIndex(x => x.id === id)).flatMap(c => [...c.querySelectorAll('img')]);
  await Promise.race([Promise.all(above.map(img => img.complete ? null : new Promise(r => { img.loading = 'eager'; img.onload = img.onerror = r; }))), new Promise(r => setTimeout(r, 2500))]);
  if (location.hash.startsWith(`#/post/${id}`)) jump();
}

forms.bark = async (form, fd) => {
  const text = String(fd.get('text') || '').trim();
  // Sending takes a moment online; ignore extra taps or Enter presses until it's done.
  if (!text || form.dataset.sending) return;
  form.dataset.sending = '1';
  const btn = form.querySelector('button');
  btn.disabled = true;
  try {
    await db.put('comments', { id: db.uid(), postId: form.dataset.id, author: me.username, text, createdAt: Date.now() });
    form.reset();
    await refreshBarks(form.dataset.id);
  } catch (err) {
    toast(`Could not send it: ${err.message}`);
  } finally {
    delete form.dataset.sending;
    btn.disabled = false;
  }
};

// Redraw the comments from what's actually saved, so nothing shows up twice.
async function refreshBarks(postId) {
  const [p, list, users] = await Promise.all([db.get('posts', postId), db.byIndex('comments', 'postId', postId), usersMap()]);
  if (!p) return;
  const barks = list.filter(c => !blockedSet.has(c.author)).sort((a, b) => a.createdAt - b.createdAt);
  const box = document.querySelector(`.barks[data-post="${postId}"] .bark-list`);
  if (box) box.innerHTML = barks.length ? barks.map(c => barkRow(c, users.get(c.author), p)).join('')
    : `<p class="muted no-barks">No ${soundFor(me.petType).words.toLowerCase()} yet. Start the conversation.</p>`;
  p.barkCount = list.length;
  updateBarkCount(p);
}

function updateBarkCount(p) {
  const card = document.querySelector(`.post[data-post="${p.id}"]`);
  if (!card) return;
  card.querySelector('.bark-count').textContent = p.barkCount;
  card.querySelector('.bark-count + .lbl').textContent = countLabel(p.barkCount, me.petType);
}

// The comment button opens a post's comments right under it, and closes them again.
actions['toggle-barks'] = async el => {
  const id = el.dataset.id;
  const open = document.querySelector(`.barks[data-post="${id}"]`);
  if (open) { open.remove(); return; }
  document.querySelectorAll('.barks').forEach(s => s.remove()); // one open at a time
  const card = el.closest('.post');
  const [p, list, users] = await Promise.all([db.get('posts', id), db.byIndex('comments', 'postId', id), usersMap()]);
  if (!p || !card?.isConnected) return;
  const barks = list.filter(c => !blockedSet.has(c.author)).sort((a, b) => a.createdAt - b.createdAt);
  // In scroll mode they slide up from the bottom over the post, so you stay in scroll mode.
  if (card.classList.contains('slide')) {
    card.closest('.scroller').insertAdjacentHTML('beforeend', `<div class="sheet-backdrop" data-action="close-barks"></div>${barksSection(p, barks, users, true)}`);
  } else {
    card.insertAdjacentHTML('afterend', barksSection(p, barks, users));
  }
};

actions['close-barks'] = el => {
  (el.closest('.barks') || document.querySelector('.barks.sheet'))?.remove();
  document.querySelector('.sheet-backdrop')?.remove();
};

actions['delete-bark'] = async el => {
  if (el.disabled) return;
  el.disabled = true;
  await db.del('comments', el.dataset.id);
  await refreshBarks(el.dataset.post);
};

// ---------- create
const KIND_HINTS = {
  photo: 'Snap or upload a photo of your pet.',
  video: `Record or upload a video up to ${MAX_VIDEO_SECONDS} seconds long.`,
  moment: 'Up to 5 photos or short videos that disappear after 24 hours. You can add a poll or a question.',
};

async function viewCreate(main, arg) {
  const goals = (await db.byIndex('goals', 'owner', me.username)).filter(g => !g.completedAt && goalForPet(g, me));
  const goalId = arg?.startsWith('goal-') ? arg.slice(5) : '';
  const goal = goals.find(g => g.id === goalId);
  draft = { kind: arg === 'moment' ? 'moment' : 'photo', file: null, result: null, busy: false, previewURL: null, items: [], cur: 0, extra: '', iPos: { x: 0.5, y: 0.72, s: 1, r: 0 }, petIds: [activePetId(me)] };
  main.innerHTML = `
    <section class="card create">
      <h1>New post</h1>
      ${petsOf(me).length > 1 ? `
        <div class="field tag-pets"><span>Who's in it?</span>
          <div class="pet-chips">${petsOf(me).map(p => `<button type="button" class="pet-chip ${draft.petIds.includes(p.id) ? 'on' : ''}" data-action="tag-pet" data-id="${esc(p.id)}" aria-pressed="${draft.petIds.includes(p.id)}">${icon('paw')}${esc(p.petName || 'Pet')}</button>`).join('')}</div>
        </div>` : ''}
      <div class="seg kinds">
        ${['photo', 'video', 'moment'].map(k => `<button type="button" data-action="kind" data-kind="${k}">${icon(k)}${cap(k)}</button>`).join('')}
      </div>
      <p class="muted kind-hint"></p>
      <div class="source">
        <button type="button" class="source-btn camera-btn" data-action="open-camera">
          ${icon('camera', 'big')}
          <strong class="camera-label">Take a photo</strong>
          <span class="muted">Use your camera</span>
        </button>
        <label class="source-btn drop">
          <input type="file" class="file-input" hidden>
          ${icon('upload', 'big')}
          <strong>Choose a file</strong>
          <span class="muted">or drop it here</span>
        </label>
      </div>
      <div class="stage"></div>
      <form data-form="publish" class="publish stack" hidden>
        <label class="field"><span>Caption</span><textarea name="caption" maxlength="500" rows="3" placeholder="What is ${esc(me.petName || 'your pet')} up to?">${goal ? esc(`Progress on: ${goal.title}`) : ''}</textarea></label>
        <div class="extras stack">
          <div class="field"><span class="extras-label">Add to your post</span>
            <div class="seg extras-seg">
              <button type="button" data-action="moment-extra" data-extra="">Nothing</button>
              <button type="button" data-action="moment-extra" data-extra="poll">Poll</button>
              <button type="button" data-action="moment-extra" data-extra="quiz" data-posts-only>Quiz</button>
              <button type="button" data-action="moment-extra" data-extra="ask">Question</button>
              <button type="button" data-action="moment-extra" data-extra="rate" data-posts-only>Rating</button>
            </div>
          </div>
          <div class="extra-choices stack" hidden>
            <label class="field"><span>Question</span><input name="iQuestion" maxlength="80"></label>
            ${[1, 2, 3, 4].map(n => `
              <div class="choice-row">
                <label class="field"><span>Choice ${n}${n > 2 ? ' (optional)' : ''}</span><input name="iOpt${n}" maxlength="30" ${n === 1 ? 'value="Yes"' : n === 2 ? 'value="No"' : ''}></label>
                <label class="quiz-right"><input type="radio" name="quizAnswer" value="${n - 1}" ${n === 1 ? 'checked' : ''}>Right answer</label>
              </div>`).join('')}
          </div>
          <div class="extra-ask" hidden>
            <label class="field"><span>Your question</span><input name="askPrompt" maxlength="80"></label>
          </div>
          <div class="extra-rate" hidden>
            <label class="field"><span>Rating question</span><input name="rateQuestion" maxlength="80" value="How cute is this?"></label>
            <p class="muted small">People slide from 1 to 10 and see the average.</p>
          </div>
        </div>
        ${goals.length ? `<label class="field"><span>Link to a training goal</span><select name="goal"><option value="">None</option>${goals.map(g => `<option value="${g.id}" ${g.id === goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}</select></label>` : ''}
        <div class="row wrap">
          <button type="button" class="btn ghost" data-action="reset-create">Choose another</button>
          <button type="button" class="btn ghost" data-action="download-draft">${icon('download')}Save to device</button>
          <span class="spacer"></span>
          <button class="btn primary">${icon('paw')}Post</button>
        </div>
      </form>
    </section>`;

  const input = main.querySelector('.file-input');
  const drop = main.querySelector('.drop');
  input.addEventListener('change', () => input.files.length && handleFiles([...input.files]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) handleFiles([...e.dataTransfer.files]);
  });
  updateKindUI();
}

function updateKindUI() {
  const root = document.querySelector('.create');
  if (!root) return;
  root.querySelectorAll('.kinds button').forEach(b => b.classList.toggle('on', b.dataset.kind === draft.kind));
  root.querySelector('.kind-hint').textContent = KIND_HINTS[draft.kind];
  root.querySelector('.file-input').accept = { photo: 'image/*', video: 'video/*', moment: 'image/*,video/*' }[draft.kind];
  root.querySelector('.camera-label').textContent = { photo: 'Take a photo', video: 'Record a video', moment: 'Open camera' }[draft.kind];
  root.querySelector('.file-input').multiple = draft.kind === 'moment';
  // Moments can have a poll or a question; normal posts can also have a quiz or a rating slider.
  const moment = draft.kind === 'moment';
  if (moment && ['quiz', 'rate'].includes(draft.extra)) draft.extra = '';
  root.querySelector('.extras-label').textContent = moment ? 'Add to your moment' : 'Add to your post';
  root.querySelectorAll('.extras-seg button').forEach(b => {
    b.classList.toggle('on', b.dataset.extra === draft.extra);
    b.hidden = moment && b.hasAttribute('data-posts-only');
  });
  const choices = root.querySelector('.extra-choices');
  choices.hidden = !['poll', 'quiz'].includes(draft.extra);
  choices.classList.toggle('quiz', draft.extra === 'quiz');
  const pet = me.petName || 'my pet';
  choices.querySelector('[name="iQuestion"]').placeholder = draft.extra === 'quiz' ? `How old is ${pet}?` : `Which toy should ${pet} play with?`;
  // Left blank, the question box uses this example as its question.
  root.querySelector('[name="askPrompt"]').placeholder = askExample();
  root.querySelector('.extra-ask').hidden = draft.extra !== 'ask';
  root.querySelector('.extra-rate').hidden = draft.extra !== 'rate';
  renderStickerPreview();
}

// While making a post, the poll, quiz, question or rating shows on the picture as it will look.
// Drag it to move it; drag its corner (or use the slider) to resize it.
const askExample = () => `Ask me anything about ${me.petName || 'my pet'}`;
function previewInteractive(fd) {
  const t = name => String(fd.get(name) || '').trim();
  if (draft.extra === 'poll' || draft.extra === 'quiz') {
    const filled = [1, 2, 3, 4].map(n => t(`iOpt${n}`)).filter(Boolean);
    const it = { question: t('iQuestion') || 'Your question', options: filled.length ? filled : ['Yes', 'No'] };
    return draft.extra === 'poll' ? { poll: it } : { quiz: { ...it, answer: 0 } };
  }
  if (draft.extra === 'ask') return { ask: { prompt: t('askPrompt') || askExample() } };
  if (draft.extra === 'rate') return { rate: { question: t('rateQuestion') || 'How cute is this?' } };
  return null;
}

function renderStickerPreview() {
  const root = document.querySelector('.create');
  const preview = root?.querySelector('.preview');
  if (!preview) return;
  preview.querySelector('.interact')?.remove();
  const it = draft.kind === 'moment' ? null : previewInteractive(new FormData(root.querySelector('form[data-form="publish"]')));
  root.querySelectorAll('.i-size, .i-size-hint').forEach(el => { el.hidden = !it; });
  if (!it) return;
  preview.insertAdjacentHTML('beforeend', interactCard({ id: 'draft', author: '', ...it, iPos: draft.iPos }));
  const card = preview.querySelector('.interact');
  card.classList.add('editing');
  card.insertAdjacentHTML('beforeend', '<span class="i-handle" aria-hidden="true"></span>');
  root.querySelector('.i-size:not(.i-turn) input').value = Math.round(draft.iPos.s * 100);
  root.querySelector('.i-turn input').value = draft.iPos.r || 0;
}

function placeSticker(card) {
  card.style.left = `${draft.iPos.x * 100}%`;
  card.style.top = `${draft.iPos.y * 100}%`;
  card.style.setProperty('--s', draft.iPos.s);
  card.style.setProperty('--r', `${draft.iPos.r || 0}deg`);
  const slider = document.querySelector('.create .i-size:not(.i-turn) input');
  if (slider) slider.value = Math.round(draft.iPos.s * 100);
  const turn = document.querySelector('.create .i-turn input');
  if (turn) turn.value = draft.iPos.r || 0;
}

let stickerDrag = null;
document.addEventListener('pointerdown', e => {
  const card = e.target.closest?.('.preview .interact.editing');
  if (!card) return;
  e.preventDefault();
  const box = card.parentElement.getBoundingClientRect();
  const center = { x: box.left + draft.iPos.x * box.width, y: box.top + draft.iPos.y * box.height };
  stickerDrag = {
    card, box, center, resize: !!e.target.closest('.i-handle'),
    from: {
      x: e.clientX, y: e.clientY, pos: { ...draft.iPos },
      dist: Math.hypot(e.clientX - center.x, e.clientY - center.y) || 1,
      angle: Math.atan2(e.clientY - center.y, e.clientX - center.x),
    },
  };
  card.setPointerCapture(e.pointerId);
});
document.addEventListener('pointermove', e => {
  if (!stickerDrag) return;
  const { card, box, center, resize, from } = stickerDrag;
  if (resize) {
    // The corner handle resizes and turns at once, the way it works on Instagram.
    draft.iPos.s = clampSize(from.pos.s * Math.hypot(e.clientX - center.x, e.clientY - center.y) / from.dist);
    const turned = (Math.atan2(e.clientY - center.y, e.clientX - center.x) - from.angle) * 180 / Math.PI;
    draft.iPos.r = clampTurn((from.pos.r || 0) + turned);
  } else {
    draft.iPos.x = clampPos(from.pos.x + (e.clientX - from.x) / box.width);
    draft.iPos.y = clampPos(from.pos.y + (e.clientY - from.y) / box.height);
  }
  placeSticker(card);
});
const endStickerDrag = () => { stickerDrag = null; };
document.addEventListener('pointerup', endStickerDrag);
document.addEventListener('pointercancel', endStickerDrag);
document.addEventListener('input', e => {
  if (e.target.matches?.('.create .i-size input, .create .i-turn input')) {
    if (e.target.closest('.i-turn')) draft.iPos.r = clampTurn(e.target.value);
    else draft.iPos.s = clampSize(e.target.value / 100);
    const card = document.querySelector('.create .preview .interact');
    if (card) placeSticker(card);
  } else if (e.target.closest?.('.create form[data-form="publish"] .extras')) renderStickerPreview();
});

// Tick which of your pets are in the post. The pet you're posting as starts ticked; at least one stays ticked.
actions['tag-pet'] = el => {
  const id = el.dataset.id, on = !draft.petIds.includes(id);
  if (!on && draft.petIds.length === 1) return toast('Tick at least one pet.');
  draft.petIds = on ? [...draft.petIds, id] : draft.petIds.filter(x => x !== id);
  el.classList.toggle('on', on);
  el.setAttribute('aria-pressed', on);
};

// The poll, quiz, question or rating picked on the create page, ready to save on the post.
// Returns null (after saying what's missing) if it isn't filled in properly.
function readInteractive(form, fd) {
  const t = name => String(fd.get(name) || '').trim();
  const fail = (msg, field) => { toast(msg); if (field) form.querySelector(`[name="${field}"]`)?.focus(); return null; };
  const extra = draft.extra;
  if (extra === 'poll' || extra === 'quiz') {
    const question = t('iQuestion');
    const filled = [1, 2, 3, 4].map(n => [n - 1, t(`iOpt${n}`)]).filter(([, o]) => o);
    if (!question) return fail('Write a question first.', 'iQuestion');
    if (filled.length < 2) return fail('Fill in at least 2 choices.', 'iOpt1');
    const options = filled.map(([, o]) => o);
    if (extra === 'poll') return { poll: { question, options } };
    const answer = filled.findIndex(([k]) => k === +fd.get('quizAnswer'));
    if (answer < 0) return fail('Mark one of the choices you filled in as the right answer.');
    return { quiz: { question, options, answer } };
  }
  if (extra === 'ask') return { ask: { prompt: t('askPrompt') || askExample() } };
  if (extra === 'rate') return { rate: { question: t('rateQuestion') || 'How cute is this?' } };
  return {};
}

actions['moment-extra'] = el => { draft.extra = el.dataset.extra; updateKindUI(); };

// A moment can hold up to 5 photos or videos. Each one is kept as its own item while you make it.
const MOMENT_MAX = 5;
function saveCurrentItem() {
  const it = draft?.items?.[draft.cur];
  if (it) Object.assign(it, { result: draft.result, baseBlob: draft.baseBlob, stickers: draft.stickers });
}
function useItem(i) {
  const it = draft.items[i];
  if (it) Object.assign(draft, { cur: i, result: it.result, baseBlob: it.baseBlob, stickers: it.stickers });
}
function loadItem(i) { saveCurrentItem(); useItem(i); }
function dropItemThumbs(items = []) { items.forEach(it => it.thumbURL && URL.revokeObjectURL(it.thumbURL)); }

async function handleFiles(files) {
  if (draft.kind !== 'moment') return handleFile(files[0]);
  const room = MOMENT_MAX - draft.items.length;
  if (!room) return toast(`A moment can have up to ${MOMENT_MAX} photos or videos.`);
  if (files.length > room) toast(`A moment can have up to ${MOMENT_MAX}. Adding the first ${room}.`);
  for (const f of files.slice(0, room)) await handleFile(f);
}

actions['moment-item'] = el => {
  if (draft.busy) return;
  loadItem(+el.dataset.index);
  showResult(document.querySelector('.create'));
};
actions['moment-remove'] = el => {
  if (draft.busy) return;
  saveCurrentItem();
  const i = +el.dataset.index;
  dropItemThumbs(draft.items.splice(i, 1));
  if (!draft.items.length) return resetDraft();
  useItem(Math.min(i, draft.items.length - 1));
  showResult(document.querySelector('.create'));
};
document.addEventListener('change', e => {
  if (e.target.matches?.('.m-add-input') && e.target.files.length) handleFiles([...e.target.files]);
});

actions['open-camera'] = async () => {
  if (!draft || draft.busy) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    const input = document.querySelector('.create .file-input');
    input.setAttribute('capture', 'environment');
    input.click();
    setTimeout(() => input.removeAttribute('capture'), 1000);
    return;
  }
  const modes = { photo: ['photo'], video: ['video'], moment: ['photo', 'video'] }[draft.kind];
  const file = await openCamera({ modes, maxSeconds: MAX_VIDEO_SECONDS });
  if (file && draft && document.querySelector('.create')) handleFiles([file]);
};

function resetDraft() {
  if (draft?.previewURL) URL.revokeObjectURL(draft.previewURL);
  if (draft) { dropItemThumbs(draft.items); draft.items = []; draft.cur = 0; draft.result = null; draft.previewURL = null; draft.file = null; draft.baseBlob = null; draft.stickers = []; }
  const root = document.querySelector('.create');
  if (!root) return;
  root.querySelector('.stage').innerHTML = '';
  root.querySelector('.publish').hidden = true;
  root.querySelector('.source').hidden = false;
  root.querySelector('.file-input').value = '';
}

actions.kind = el => {
  if (draft?.busy) return toast('Still processing, hang on a moment.');
  draft.kind = el.dataset.kind;
  resetDraft();
  updateKindUI();
};
actions['reset-create'] = () => { if (!draft?.busy) resetDraft(); };
actions['download-draft'] = () => {
  if (!draft?.result) return;
  downloadBlob(draft.result.blob, `petpost-${Date.now()}.${extFor(draft.result.blob.type)}`);
  toast('Saved to your device');
};

async function handleFile(file) {
  if (draft.busy) return;
  const root = document.querySelector('.create');
  const isVideo = file.type.startsWith('video/');
  const isImage = file.type.startsWith('image/');
  if ((draft.kind === 'photo' && !isImage) || (draft.kind === 'video' && !isVideo) || (!isImage && !isVideo)) {
    toast(draft.kind === 'photo' ? 'Please choose a photo.' : draft.kind === 'video' ? 'Please choose a video.' : 'Please choose a photo or video.');
    return;
  }
  if (file.size > 300 * 1024 * 1024) return toast('That file is too large (300 MB max).');

  const moment = draft.kind === 'moment', had = moment ? draft.items.length : 0;
  if (moment) saveCurrentItem();
  draft.busy = true;
  draft.file = file;
  draft.baseBlob = null;
  draft.stickers = [];
  if (draft.previewURL) { URL.revokeObjectURL(draft.previewURL); draft.previewURL = null; }
  draft.result = null;
  const stage = root.querySelector('.stage');
  root.querySelector('.source').hidden = true;
  root.querySelector('.publish').hidden = true;
  stage.innerHTML = `
    <div class="processing">
      ${icon('paw', 'big spin-soft')}
      <strong class="p-label"></strong>
      <div class="progress"><i></i></div>
      <span class="muted p-sub"></span>
    </div>`;
  const label = stage.querySelector('.p-label'), sub = stage.querySelector('.p-sub'), bar = stage.querySelector('.progress');
  const set = (text, frac, note) => {
    label.textContent = text;
    if (note !== undefined) sub.textContent = note;
    bar.classList.toggle('indeterminate', frac == null);
    bar.firstElementChild.style.width = frac == null ? '' : `${Math.round(frac * 100)}%`;
  };

  try {
    if (isImage) {
      set('Preparing your photo...', null, '');
      draft.result = await processPhoto(file);
    } else {
      set('Preparing your video...', null, '');
      draft.result = await processVideo(file);
    }
    if (!document.body.contains(stage)) return;
    if (moment) { draft.items.push({ result: draft.result, baseBlob: null, stickers: [] }); draft.cur = draft.items.length - 1; }
    showResult(root);
  } catch (err) {
    console.error(err);
    if (moment && had) {
      // Keep the photos and videos already added; just say this one didn't work.
      toast(err.message || 'This file could not be processed.');
      useItem(Math.min(draft.cur, had - 1));
      draft.busy = false;
      showResult(root);
      return;
    }
    stage.innerHTML = `<div class="error-box">${esc(err.message || 'This file could not be processed.')}</div>`;
    root.querySelector('.source').hidden = false;
    draft.file = null;
  } finally {
    draft.busy = false;
  }
}

function showResult(root) {
  const r = draft.result;
  if (draft.previewURL) URL.revokeObjectURL(draft.previewURL);
  draft.previewURL = URL.createObjectURL(r.blob);
  if (r.type === 'image' && !draft.baseBlob) { draft.baseBlob = r.blob; draft.stickers = []; }
  const count = draft.stickers?.length || 0;
  let strip = '';
  if (draft.kind === 'moment') {
    saveCurrentItem();
    for (const it of draft.items) {
      if (it.thumbBlob !== it.result.blob) { if (it.thumbURL) URL.revokeObjectURL(it.thumbURL); it.thumbURL = URL.createObjectURL(it.result.blob); it.thumbBlob = it.result.blob; }
    }
    strip = `
      <div class="m-strip">
        ${draft.items.map((it, i) => `
          <div class="m-thumb ${i === draft.cur ? 'on' : ''}">
            <button type="button" data-action="moment-item" data-index="${i}" aria-label="Show ${i + 1} of ${draft.items.length}">${it.result.type === 'video'
              ? `<video src="${it.thumbURL}#t=0.1" muted playsinline preload="metadata"></video>` : `<img src="${it.thumbURL}" alt="">`}</button>
            <button type="button" class="m-thumb-x" data-action="moment-remove" data-index="${i}" aria-label="Remove ${i + 1}">${icon('close')}</button>
          </div>`).join('')}
        ${draft.items.length < MOMENT_MAX ? `<label class="m-thumb add" title="Add another">${icon('plus')}<input type="file" class="m-add-input" accept="image/*,video/*" multiple hidden></label>` : ''}
      </div>
      <p class="muted small">${draft.items.length} of ${MOMENT_MAX}. They play one after another.</p>`;
  }
  root.querySelector('.stage').innerHTML = `${strip}
    <div class="preview">${r.type === 'video'
      ? `<video src="${draft.previewURL}#t=0.001" controls playsinline autoplay loop muted></video>`
      : `<img src="${draft.previewURL}" alt="Preview">`}</div>
    ${r.type === 'image' ? `<button type="button" class="btn ghost sticker-btn" data-action="stickers">${icon('sparkle')}${count ? `Edit stickers (${count})` : 'Add stickers'}</button>` : ''}
    <label class="field i-size" hidden><span>Size</span><input type="range" min="60" max="150" step="5" value="100"></label>
    <label class="field i-size i-turn" hidden><span>Turn</span><input type="range" min="-180" max="180" step="1" value="0"></label>
    <p class="muted small i-size-hint" hidden>Drag it on the picture to move it. Drag its corner to make it bigger, smaller or turned, or use the sliders.</p>`;
  root.querySelector('.publish').hidden = false;
  renderStickerPreview();
}

actions.stickers = async () => {
  if (!draft?.baseBlob || draft.busy) return;
  const out = await openStickerEditor(draft.baseBlob, draft.stickers, soundFor(me.petType).sticker);
  if (!out || !draft) return;
  draft.stickers = out.stickers;
  draft.result = { ...draft.result, blob: out.blob };
  const root = document.querySelector('.create');
  if (root) showResult(root);
};

forms.publish = async (form, fd) => {
  if (!draft?.result || draft.busy) return;
  if (draft.kind === 'moment') return publishMoment(form, fd);
  const interactive = readInteractive(form, fd);
  if (!interactive) return;
  const btn = form.querySelector('button.primary');
  btn.disabled = true;
  const goal = fd.get('goal') ? await db.get('goals', fd.get('goal')) : null;
  const now = Date.now();
  const isMoment = draft.kind === 'moment';
  const post = {
    id: db.uid(),
    author: me.username,
    ...petTag(draft.petIds),
    kind: isMoment ? 'moment' : draft.result.type === 'video' ? 'video' : 'photo',
    mediaType: draft.result.type,
    width: draft.result.width || null,
    height: draft.result.height || null,
    media: draft.result.blob,
    caption: String(fd.get('caption') || '').trim(),
    licks: [],
    barkCount: 0,
    report: draft.result.report,
    goalId: goal?.id || null,
    goalTitle: goal?.title || null,
    createdAt: now,
    expiresAt: isMoment ? now + MOMENT_TTL : null,
    ...interactive,
    iPos: Object.keys(interactive).length ? { ...draft.iPos } : null,
  };
  try {
    await db.put('posts', post);
  } catch (err) {
    btn.disabled = false;
    return toast('Could not save. Your device may be out of space.');
  }
  resetDraft();
  draft = null;
  toast(isMoment ? 'Moment shared for 24 hours' : 'Posted');
  go('#/feed');
};

// Each photo or video in a moment is saved as its own post, in order. The caption and any poll
// or question go on the first one.
async function publishMoment(form, fd) {
  saveCurrentItem();
  const interactive = readInteractive(form, fd);
  if (!interactive) return;
  const { poll = null, ask = null } = interactive;
  const btn = form.querySelector('button.primary');
  btn.disabled = true;
  draft.busy = true;
  const now = Date.now();
  const items = draft.items;
  try {
    for (const [i, it] of items.entries()) {
      if (items.length > 1) toast(`Sharing ${i + 1} of ${items.length}...`);
      await db.put('posts', {
        id: db.uid(), author: me.username, ...petTag(draft.petIds), kind: 'moment', mediaType: it.result.type,
        width: it.result.width || null, height: it.result.height || null, media: it.result.blob,
        caption: i === 0 ? String(fd.get('caption') || '').trim() : '',
        poll: i === 0 ? poll : null, ask: i === 0 ? ask : null,
        licks: [], barkCount: 0, report: it.result.report, goalId: null, goalTitle: null,
        createdAt: now + i, expiresAt: now + MOMENT_TTL,
      });
    }
  } catch (err) {
    btn.disabled = false;
    draft.busy = false;
    return toast(`Could not share it: ${err.message}`);
  }
  draft.busy = false;
  resetDraft();
  draft = null;
  toast('Moment shared for 24 hours');
  go('#/feed');
}

// ---------- profile
const profilePet = {}; // which of someone else's pets you're looking at, by username

// One button per pet under the profile name. On your profile, tapping one switches to that pet.
function petChips(u, own, shown) {
  const pets = petsOf(u);
  if (pets.length < 2 && !own) return '';
  return `
    <div class="pet-chips" role="group" aria-label="${own ? 'Your pets' : 'Pets'}">
      ${pets.length > 1 || own ? pets.map(p => `
        <button class="pet-chip ${p.id === shown ? 'on' : ''}" data-action="${own ? 'switch-pet' : 'view-pet'}" data-user="${esc(u.username)}" data-pet="${esc(p.id)}" aria-pressed="${p.id === shown}">${icon('paw')}${esc(p.petName || 'Pet')}</button>`).join('') : ''}
      ${own ? `<button class="pet-chip add" data-action="add-pet">${icon('plus')}Add pet</button>` : ''}
    </div>`;
}

actions['view-pet'] = el => { profilePet[el.dataset.user] = el.dataset.pet; route(); };
actions['switch-pet'] = async el => {
  if (el.dataset.pet === activePetId(me)) return;
  usePet(me, el.dataset.pet);
  await saveMe();
  applyTheme(me.theme);
  toast(`Switched to ${me.petName || 'your pet'}`);
  route();
};

const countFrom = fd => Math.max(1, Math.min(999, Math.round(+fd.get('petCount') || 1)));

actions['add-pet'] = () => {
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `
    <form data-form="add-pet" class="stack">
      <header class="row"><h2>Add a pet</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
      <p class="muted">Each pet gets its own goals, streak and pet card. Switch between them on your profile.</p>
      <label class="field"><span>Pet's name</span><input name="petName" maxlength="40" required></label>
      <label class="field"><span>Pet type</span><select name="petType">${PET_TYPES.map(t => `<option>${esc(t)}</option>`).join('')}</select><small class="sound-hint muted">${soundHint(PET_TYPES[0])}</small></label>
      <div class="two">
        <label class="field"><span>How many?</span><input type="number" name="petCount" min="1" max="999" value="1"><small class="muted">More than 1 makes it a group, like "The chickens" and 10.</small></label>
        <label class="field"><span>Breed</span><input name="breed" maxlength="40" placeholder="Optional"></label>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="row"><span class="spacer"></span><button type="button" class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary">Add pet</button></div>
    </form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};
forms['add-pet'] = (form, fd) => withBusy(form, async () => {
  if (petsOf(me).length >= 12) throw new Error('You can have up to 12 pets.');
  const name = String(fd.get('petName') || '').trim();
  if (!name) throw new Error("Type your pet's name.");
  syncActivePet(me);
  const id = `pet-${db.uid().slice(0, 8)}`;
  me.pets.push({ id, petName: name, petType: String(fd.get('petType') || '').trim(), petCount: countFrom(fd), breed: String(fd.get('breed') || '').trim(), practiceDays: [], streakTrophies: [] });
  usePet(me, id);
  await saveMe();
  form.closest('dialog').close();
  toast(`Added ${name}. You're now posting as ${name}.`);
  route();
});

actions['remove-pet'] = async el => {
  const name = me.petName || 'this pet';
  if (!confirm(`Remove ${name}? ${name}'s goals and streak will be deleted. Posts about ${name} stay.`)) return;
  el.disabled = true;
  const gone = activePetId(me);
  const goals = (await db.byIndex('goals', 'owner', me.username)).filter(g => goalForPet(g, me, gone));
  for (const g of goals) await db.del('goals', g.id);
  syncActivePet(me);
  // Goals with no pet belonged to the first pet; give them to it for good before it moves.
  const first = me.pets[0].id;
  if (first !== gone) for (const g of (await db.byIndex('goals', 'owner', me.username)).filter(g => !g.petId)) await db.put('goals', { ...g, petId: first });
  me.pets = me.pets.filter(p => p.id !== gone);
  me.activePet = me.pets[0].id;
  for (const k of PET_FIELDS) me[k] = me.pets[0][k] ?? (k === 'practiceDays' || k === 'streakTrophies' ? [] : '');
  await saveMe();
  el.closest('dialog')?.close();
  toast(`Removed ${name}`);
  route();
};
async function viewProfile(main, username = me.username, tab = 'posts') {
  let u = username === me.username ? me : await db.get('users', username);
  if (!u) { main.innerHTML = `<div class="card empty"><p>That profile does not exist.</p></div>`; return; }
  const shownPet = u === me ? activePetId(me) : (petsOf(u).some(p => p.id === profilePet[u.username]) ? profilePet[u.username] : activePetId(u));
  if (u !== me) u = withPet(u, shownPet);
  const own = u.username === me.username;
  if (tab === 'saved' && !own) tab = 'posts';
  if (own) {
    // Give trophies for goals finished before trophies existed.
    me.trophies ||= [];
    const before = me.trophies.length;
    (await db.byIndex('goals', 'owner', me.username)).filter(g => g.completedAt).forEach(g => awardTrophy(me, g));
    if (me.trophies.length !== before) await saveMe();
  }
  const trophies = [...(u.trophies || [])].sort((a, b) => a.earnedAt - b.earnedAt);
  const [mine, allGoals] = await Promise.all([db.byIndex('posts', 'author', u.username), db.byIndex('goals', 'owner', u.username)]);
  const goals = allGoals.filter(g => goalForPet(g, u, shownPet));
  const posts = mine.filter(p => p.kind !== 'moment').sort((a, b) => b.createdAt - a.createdAt);
  // Moments saved to highlights stay on the profile after their 24 hours are up.
  profileHighlights = { user: u, list: mine.filter(p => p.kind === 'moment' && p.highlight).sort((a, b) => a.createdAt - b.createdAt) };
  const allUsers = await db.all('users');
  const followers = allUsers.filter(x => (x.following || []).includes(u.username)).length;
  const followingCount = (u.following || []).length;
  const iFollow = (me.following || []).includes(u.username);

  let content = '';
  if (tab === 'trophies') {
    const [reactions, records] = await Promise.all([db.trophyReactions(u.username), recordTrophiesFor(u)]);
    allUsers.forEach(x => userCache.set(x.username, x));
    content = trophies.length || records.length
      ? `<div class="trophies">${records.map(t => trophyCard(t, -1, own, u, reactions)).join('')}${trophies.map((t, i) => trophyCard(t, i, own, u, reactions)).reverse().join('')}</div>`
      : `<div class="card empty">${icon('trophy', 'big')}<p class="muted">${own ? 'Finish a training goal to earn your first trophy.' : 'No trophies yet.'}</p>${own ? '<a class="btn primary" href="#/goals">Set a goal</a>' : ''}</div>`;
  } else if (tab === 'goals') {
    content = (own && goals.length ? `<a class="btn primary new-goal" href="#/goals">${icon('plus')}New goal</a>` : '') + (goals.length
      ? goals.sort((a, b) => !!a.completedAt - !!b.completedAt || b.createdAt - a.createdAt).map(g => goalCard(g, own)).join('')
      : `<div class="card empty"><p class="muted">No training goals yet.</p>${own ? '<a class="btn primary" href="#/goals">Set a goal</a>' : ''}</div>`);
  } else {
    const list = tab === 'saved'
      ? (await Promise.all(me.saved.map(id => db.get('posts', id)))).filter(p => p && p.kind !== 'moment')
      : tab === 'videos' ? posts.filter(p => p.mediaType === 'video') : posts;
    content = list.length
      ? `<div class="grid">${list.map(p => `
          <a class="tile" href="#/post/${p.id}/${encodeURIComponent(tab === 'saved' ? 'saved' : `${tab === 'videos' ? 'v' : 'u'}:${u.username}`)}" aria-label="Open post">
            ${p.mediaType === 'video'
              ? `<video src="${blobURL(p.id, p.media)}#t=0.1" muted playsinline preload="metadata"></video><span class="tile-badge">${icon('play')}</span>`
              : `<img src="${blobURL(p.id, p.media)}" alt="" loading="lazy">`}
          </a>`).join('')}</div>`
      : tab === 'videos'
        ? `<div class="card empty">${icon('video', 'big')}<p class="muted">${own ? 'Videos you post show up here.' : 'No videos yet.'}</p>${own ? '<a class="btn primary" href="#/create">Post a video</a>' : ''}</div>`
        : `<div class="card empty"><p class="muted">${tab === 'saved' ? 'Posts you save show up here.' : own ? 'You have not posted yet.' : 'No posts yet.'}</p></div>`;
  }

  const tabLink = (id, label) => `<a href="#/profile/${esc(u.username)}/${id}" class="${tab === id ? 'on' : ''}">${label}</a>`;
  main.innerHTML = `
    <section class="card profile-head">
      ${avatar(u, 'xl')}
      <div class="pinfo">
        <h1>${esc(u.displayName)}${aiTag(u)}</h1>
        ${u.ai ? '<p class="muted small">A sample account made by PetPost to show what posts can look like. Not a real person.</p>' : ''}
        <p class="muted">@${esc(u.username)}</p>
        ${u.petName ? `<p class="pet">${icon('paw')}${esc(u.petName)}${petKind(u) ? ` <span class="muted">· ${esc(petKind(u))}</span>` : ''}</p>` : ''}
        ${petChips(u, own, shownPet)}
        ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ''}
      </div>
      <div class="stats four">
        <div><strong>${posts.length}</strong><span>${plural(posts.length, 'Post')}</span></div>
        <button data-action="follow-list" data-user="${esc(u.username)}" data-kind="followers"><strong>${followers}</strong><span>${followers === 1 ? 'Follower' : 'Followers'}</span></button>
        <button data-action="follow-list" data-user="${esc(u.username)}" data-kind="following"><strong>${followingCount}</strong><span>Following</span></button>
        <div><strong>${trophies.length}</strong><span>${trophies.length === 1 ? 'Trophy' : 'Trophies'}</span></div>
      </div>
      ${profileStreak(u, own)}
      <div class="row wrap profile-actions">
        ${own ? `
          <button class="btn ghost" data-action="edit-profile">${icon('edit')}Edit profile</button>
          <button class="btn ghost" data-action="pet-card" data-user="${esc(u.username)}">${icon('card')}Pet card</button>
          <button class="btn ghost" data-action="sign-out">${icon('logout')}Sign out</button>` : `
          <button class="btn ${iFollow ? 'ghost' : 'primary'}" data-action="follow" data-user="${esc(u.username)}">${icon(iFollow ? 'check' : 'userPlus')}${iFollow ? 'Following' : 'Follow'}</button>
          <button class="btn ghost" data-action="pet-card" data-user="${esc(u.username)}">${icon('card')}Pet card</button>
          <button class="icon-btn" data-action="report" data-user="${esc(u.username)}" aria-label="Report or block @${esc(u.username)}" title="Report or block">${icon('more')}</button>`}
      </div>
    </section>
    ${profileHighlights.list.length ? `
      <section class="card highlights" aria-label="Highlights">
        ${profileHighlights.list.map((h, i) => `
          <button class="highlight" data-action="open-highlights" data-index="${i}" aria-label="Highlight ${i + 1}">
            <span class="ring">${h.mediaType === 'video'
              ? `<video src="${blobURL(h.id, h.media)}#t=0.1" muted playsinline preload="metadata"></video>`
              : `<img src="${blobURL(h.id, h.media)}" alt="" loading="lazy">`}</span>
            ${h.caption ? `<span class="mb-name">${esc(h.caption)}</span>` : ''}
          </button>`).join('')}
      </section>` : ''}
    <nav class="tabs">${tabLink('posts', 'Posts')}${tabLink('videos', 'Videos')}${own ? tabLink('saved', 'Saved') : ''}${tabLink('goals', 'Goals')}${tabLink('trophies', 'Trophies')}</nav>
    <section class="tab-body">${content}</section>`;
}

let profileHighlights = { user: null, list: [] };
actions['open-highlights'] = el => openViewer([profileHighlights], 0, +el.dataset.index);

actions['edit-profile'] = () => {
  if (!me) return;
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `
    <form data-form="profile" class="stack">
      <header class="row"><h2>Edit profile</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
      <div class="avatar-edit">${avatar(me, 'xl')}<label class="btn ghost sm">${icon('photo')}Change photo<input type="file" name="avatar" accept="image/*" hidden></label></div>
      <div class="two">
        <label class="field"><span>Your name</span><input name="displayName" maxlength="40" value="${esc(me.displayName)}" required><small class="muted">Your own name. Shown in bold on your posts.</small></label>
        <label class="field"><span>Pet's name</span><input name="petName" maxlength="40" value="${esc(me.petName)}"><small class="muted">Shown after your @username</small></label>
      </div>
      <div class="two">
        <label class="field"><span>Pet type</span><select name="petType">${[...new Set([...PET_TYPES, me.petType].filter(Boolean))].map(t => `<option ${t === me.petType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select><small class="sound-hint muted">${soundHint(me.petType)}</small></label>
        <label class="field"><span>How many?</span><input type="number" name="petCount" min="1" max="999" value="${+me.petCount || 1}"><small class="muted">More than 1 for a group</small></label>
      </div>
      <label class="field"><span>Bio</span><textarea name="bio" maxlength="200" rows="3">${esc(me.bio)}</textarea></label>
      ${petsOf(me).length > 1 ? `<p class="muted small">You're editing ${esc(me.petName || 'this pet')}. Switch pets on your profile to edit another one.</p>` : ''}
      <h3 class="form-section">Pet card</h3>
      <div class="two">
        <label class="field"><span>Breed</span><input name="breed" maxlength="40" value="${esc(me.breed || '')}" placeholder="Golden retriever"></label>
        <label class="field"><span>Birthday</span><input type="date" name="birthday" value="${esc(me.birthday || '')}"></label>
      </div>
      <div class="two">
        <label class="field"><span>Favorite treat</span><input name="treat" maxlength="40" value="${esc(me.treat || '')}" placeholder="Peanut butter"></label>
        <label class="field"><span>Favorite toy</span><input name="toy" maxlength="40" value="${esc(me.toy || '')}" placeholder="Squeaky ball"></label>
      </div>
      ${petsOf(me).length > 1 ? `<button type="button" class="btn ghost danger" data-action="remove-pet">${icon('trash')}Remove ${esc(me.petName || 'this pet')}</button>` : ''}
      <details>
        <summary>Change password</summary>
        <div class="stack pad-top">
          <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="8"></label>
        </div>
      </details>
      <details class="danger-zone">
        <summary>Delete account</summary>
        <div class="stack pad-top">
          <p class="muted small">This erases your account and everything in it: posts, moments, photos, videos, comments, goals, trophies and care needs. It cannot be undone.</p>
          <button type="button" class="btn ghost danger" data-action="delete-account">${icon('trash')}Delete my account</button>
        </div>
      </details>
      <p class="muted small"><a href="${PRIVACY_URL}" target="_blank" rel="noopener">Privacy policy</a></p>
      <p class="form-error" role="alert"></p>
      <div class="row"><span class="spacer"></span><button type="button" class="btn ghost" data-action="close-dialog">Cancel</button><button class="btn primary">Save</button></div>
    </form>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.querySelector('input[name="avatar"]').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) d.querySelector('.avatar').innerHTML = `<img src="${URL.createObjectURL(f)}" alt="" class="pending">`;
  });
  d.showModal();
};

actions['delete-account'] = async el => {
  if (!confirm(`Delete @${me.username} and everything in it? This cannot be undone.`)) return;
  el.disabled = true;
  try {
    await auth.deleteAccount();
  } catch (err) {
    el.disabled = false;
    toast(`Could not delete the account: ${err.message}`);
    return;
  }
  el.closest('dialog')?.close();
  me = null;
  syncNativeCare();
  applyTheme('clean');
  history.replaceState(null, '', location.pathname);
  renderAuth();
  toast('Your account was deleted');
};

actions['close-dialog'] = el => el.closest('dialog')?.close();

forms.profile = (form, fd) => withBusy(form, async () => {
  const current = String(fd.get('current') || ''), next = String(fd.get('next') || '');
  if (next || current) await auth.changePassword(me, current, next);
  const file = fd.get('avatar');
  if (file && file.size) {
    const r = await processPhoto(file, { max: 512 });
    me.avatar = r.blob;
    me.avatarAt = Date.now();
  }
  me.displayName = String(fd.get('displayName')).trim() || me.username;
  me.petName = String(fd.get('petName') || '').trim();
  me.petType = String(fd.get('petType') || '').trim();
  me.petCount = countFrom(fd);
  me.bio = String(fd.get('bio') || '').trim();
  me.breed = String(fd.get('breed') || '').trim();
  me.birthday = String(fd.get('birthday') || '');
  me.treat = String(fd.get('treat') || '').trim();
  me.toy = String(fd.get('toy') || '').trim();
  await saveMe();
  form.closest('dialog').close();
  toast(next ? 'Profile and password updated' : 'Profile updated');
  route();
});

// ---------- people and following
// Everyone on PetPost, on any phone or computer.
async function viewPeople(main) {
  const users = (await db.all('users')).filter(u => u.username !== me.username).sort((a, b) => a.displayName.localeCompare(b.displayName));
  main.innerHTML = `
    <section class="card">
      <h1>Find people</h1>
      <p class="muted">Follow pets to see their posts in your Following feed.</p>
      <label class="field search"><span class="sr-only">Search</span><input type="search" class="people-search" placeholder="Search names, usernames or pets" autocomplete="off"></label>
    </section>
    <section class="card people-card">
      ${users.length ? `<ul class="people">${users.map(personRow).join('')}</ul>` : `
        <div class="empty">${icon('users', 'big')}<p class="muted">No one else is on PetPost yet. Send your friends the link so they can join and follow you.</p></div>`}
    </section>`;
  main.querySelector('.people-search').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    main.querySelectorAll('.person').forEach(li => { li.hidden = q && !li.dataset.search.includes(q); });
  });
}

function personRow(u) {
  const on = (me.following || []).includes(u.username);
  return `
    <li class="person" data-search="${esc(`${u.displayName} ${u.username} ${u.petName} ${u.petType}`.toLowerCase())}">
      <a class="person-link" href="#/profile/${esc(u.username)}">${avatar(u)}<span class="who"><span class="name">${esc(u.displayName)}${aiTag(u)}</span><span class="sub">@${esc(u.username)}${u.petName ? ` · ${esc(u.petName)}` : ''}${u.petType ? ` · ${esc(u.petType)}` : ''}</span></span></a>
      ${u.username === me.username ? '' : `<button class="btn sm ${on ? 'ghost' : 'primary'}" data-action="follow" data-user="${esc(u.username)}">${on ? 'Following' : 'Follow'}</button>`}
    </li>`;
}

actions.follow = async el => {
  const name = el.dataset.user;
  if (!name || name === me.username) return;
  me.following ||= [];
  const i = me.following.indexOf(name);
  me.followedAt ||= {};
  if (i >= 0) { me.following.splice(i, 1); delete me.followedAt[name]; }
  else { me.following.push(name); me.followedAt[name] = Date.now(); }
  await saveMe();
  toast(i >= 0 ? `Unfollowed @${name}` : `Following @${name}`);
  if (el.closest('.people') || el.closest('dialog')) {
    const on = i < 0;
    el.textContent = on ? 'Following' : 'Follow';
    el.classList.toggle('primary', !on); el.classList.toggle('ghost', on);
  } else route();
};

actions['follow-list'] = async el => {
  const name = el.dataset.user, kind = el.dataset.kind;
  const users = await db.all('users');
  const u = users.find(x => x.username === name);
  if (!u) return;
  const list = kind === 'followers'
    ? users.filter(x => (x.following || []).includes(name))
    : users.filter(x => (u.following || []).includes(x.username));
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `
    <header class="row"><h2>${kind === 'followers' ? 'Followers' : 'Following'}</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
    ${list.length ? `<ul class="people">${list.map(personRow).join('')}</ul>` : `<p class="muted pad-top">${kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>`}`;
  d.addEventListener('click', e => { if (e.target.closest('.person-link')) d.close(); });
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};

const REPORT_REASONS = ['Spam', 'Mean or bullying', 'Not appropriate', 'Hurting an animal', 'Not an animal', 'Something else'];

// ---------- report and block (people who share posts with each other need a way to stay safe)
let blockedSet = new Set();
async function refreshBlocked() {
  try { blockedSet = new Set(await db.blocked()); } catch { /* offline: keep the last list */ }
}

actions.report = el => {
  const post = el.dataset.post || null, user = el.dataset.user;
  const isBlocked = blockedSet.has(user);
  const d = document.createElement('dialog');
  d.className = 'modal report-modal';
  d.innerHTML = `
    <header class="row"><h2>${post ? 'Report this post' : `@${esc(user)}`}</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
    <p class="muted">${post ? 'Why are you reporting it? The people who run PetPost will take a look.' : 'Report this account, or block it so you no longer see each other’s posts.'}</p>
    <div class="stack pad-top report-reasons">
      ${REPORT_REASONS.map(r => `<button type="button" class="btn ghost block" data-action="report-pick" data-reason="${r}" aria-pressed="false">${icon('flag')}${r}</button>`).join('')}
      <form data-form="report" class="stack report-details" hidden>
        <label class="field"><span class="report-details-label">Add a description (optional)</span><textarea name="details" rows="3" maxlength="300" placeholder="Anything that helps explain the problem"></textarea></label>
        <button class="btn primary block">Send report</button>
      </form>
      <button type="button" class="btn ghost block danger" data-action="block-toggle" data-user="${esc(user)}">${icon('block')}${isBlocked ? `Unblock @${esc(user)}` : `Block @${esc(user)}`}</button>
    </div>`;
  d.dataset.post = post || '';
  d.dataset.user = user;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};

async function sendReport(d, reason) {
  try {
    await db.report({ postId: d.dataset.post || null, username: d.dataset.user, reason });
    d.close();
    toast('Thanks. Your report was sent.');
  } catch (err) { toast(`Could not send the report: ${err.message}`); }
}

// Pick a reason, add a description if you like (Something else needs one), then send.
actions['report-pick'] = el => {
  const d = el.closest('dialog');
  d.querySelectorAll('[data-action="report-pick"]').forEach(b => {
    b.classList.toggle('on', b === el);
    b.setAttribute('aria-pressed', b === el);
  });
  const form = d.querySelector('.report-details');
  const other = el.dataset.reason === 'Something else';
  form.dataset.reason = el.dataset.reason;
  form.hidden = false;
  form.querySelector('.report-details-label').textContent = other ? "What's wrong?" : 'Add a description (optional)';
  const box = form.querySelector('textarea');
  box.required = other;
  box.placeholder = other ? 'Tell the people who run PetPost what the problem is' : 'Anything that helps explain the problem';
  if (other) box.focus();
};

forms.report = (form, fd) => {
  const details = String(fd.get('details') || '').trim();
  if (!form.dataset.reason) return;
  if (form.dataset.reason === 'Something else' && !details) { form.querySelector('textarea').focus(); return; }
  sendReport(form.closest('dialog'), details ? `${form.dataset.reason}: ${details}` : form.dataset.reason);
};

actions['block-toggle'] = async el => {
  const user = el.dataset.user, on = !blockedSet.has(user);
  if (on && !confirm(`Block @${user}? You won't see each other's posts or comments, and you'll both stop following each other.`)) return;
  await db.setBlocked(user, on);
  if (on) { me.following = (me.following || []).filter(n => n !== user); blockedSet.add(user); } else blockedSet.delete(user);
  el.closest('dialog').close();
  toast(on ? `Blocked @${user}` : `Unblocked @${user}`);
  route();
};

// ---------- notifications
// Built from what is saved: licks and barks on your posts, new followers, and new posts from people you follow.
async function notifications() {
  const [posts, comments, users, reports, momentActivity] = await Promise.all([db.all('posts'), db.all('comments'), db.all('users'), db.reportsAboutMe(), db.momentActivityForMe()]);
  const mine = new Map(posts.filter(p => p.author === me.username).map(p => [p.id, p]));
  const items = [];
  for (const p of mine.values()) {
    for (const [who, at] of Object.entries(p.lickedAt || {})) if (who !== me.username) items.push({ type: 'lick', who, post: p, at });
  }
  for (const c of comments) {
    const p = mine.get(c.postId);
    if (p && c.author !== me.username) items.push({ type: 'bark', who: c.author, post: p, text: c.text, at: c.createdAt });
  }
  for (const u of users) {
    if (u.username !== me.username && (u.following || []).includes(me.username)) items.push({ type: 'follow', who: u.username, at: u.followedAt?.[me.username] || u.createdAt });
  }
  const since = me.followedAt || {};
  for (const p of posts) {
    if (!(me.following || []).includes(p.author)) continue;
    if (p.kind === 'moment' && p.expiresAt <= Date.now()) continue;
    if (p.createdAt > (since[p.author] || 0)) items.push({ type: 'post', who: p.author, post: p, at: p.createdAt });
  }
  // Reactions, poll votes and answers on your moments.
  for (const r of momentActivity) {
    const p = mine.get(r.postId);
    if (p) items.push({ type: `moment-${r.kind}`, who: r.user, post: p, value: r.value, at: r.at });
  }
  // Reports about you or your posts. Who sent them stays private.
  // Only the reason ("Spam"), never the reporter's own description after it.
  for (const r of reports) items.push({ type: 'report', who: null, post: r.postId ? mine.get(r.postId) : null, reason: r.reason.split(': ')[0], at: r.createdAt });
  const map = new Map(users.map(u => [u.username, u]));
  const petpost = { username: 'petpost', displayName: 'PetPost' };
  return items.filter(n => n.at).sort((a, b) => b.at - a.at).slice(0, 80).map(n => ({ ...n, user: n.type === 'report' ? petpost : map.get(n.who) || { username: n.who, displayName: n.who } }));
}

async function updateBell() {
  const badge = document.querySelector('.bell-badge');
  if (!badge || !me) return;
  const fresh = (await notifications()).filter(n => n.at > (me.notifSeen || 0)).length;
  badge.hidden = !fresh;
  badge.textContent = fresh > 9 ? '9+' : fresh;
}

async function viewNotifications(main) {
  const list = await notifications();
  const seen = me.notifSeen || 0;
  const thumb = p => p.mediaType === 'video'
    ? `<video src="${blobURL(p.id, p.media)}#t=0.1" muted playsinline preload="metadata"></video>`
    : `<img src="${blobURL(p.id, p.media)}" alt="" loading="lazy">`;
  const line = n => {
    const name = `<strong>${esc(n.user.displayName)}</strong>${aiTag(n.user)}`;
    if (n.type === 'lick') return `${name} licked your post`;
    if (n.type === 'bark') return `${name} ${soundFor(n.user.petType).past}: “${esc(n.text.length > 80 ? n.text.slice(0, 80) + '…' : n.text)}”`;
    if (n.type === 'follow') return `${name} started following you`;
    if (n.type === 'moment-reaction') return `${name} reacted to your moment: ${esc(REACTIONS.find(([k]) => k === n.value)?.[1] || 'Lick')}`;
    if (n.type === 'moment-vote' && n.post.quiz) return `${name} took your quiz and got it ${+n.value === n.post.quiz.answer ? 'right' : 'wrong'}`;
    if (n.type === 'moment-vote') return `${name} voted “${esc(n.post.poll?.options[n.value] ?? '')}” on your poll`;
    if (n.type === 'moment-answer') return `${name} answered your question: “${esc(n.value.length > 80 ? n.value.slice(0, 80) + '…' : n.value)}”`;
    if (n.type === 'moment-rating') return `${name} rated your post ${esc(n.value)}/10`;
    if (n.type === 'report') return `Someone reported ${n.post ? 'your post' : 'your account'} for <strong>${esc(n.reason)}</strong>. The people who run PetPost will take a look.`;
    return `${name} ${n.post.kind === 'moment' ? 'shared a moment' : n.post.mediaType === 'video' ? 'posted a new video' : 'posted a new photo'}`;
  };
  const iconFor = { lick: 'lick', bark: 'bark', follow: 'userPlus', post: 'photo', report: 'flag', 'moment-reaction': 'sparkle', 'moment-vote': 'check', 'moment-answer': 'bark', 'moment-rating': 'trophy' };
  main.innerHTML = `
    <section class="card">
      <h1>Notifications</h1>
      <p class="muted">Licks and ${esc(soundFor(me.petType).words.toLowerCase())} on your posts, new followers, new posts from people you follow, and reports about you.</p>
      <div class="push-slot"></div>
    </section>
    <section class="card notif-card">
      ${list.length ? `<ul class="notifs">${list.map(n => {
        const href = n.type === 'report' && !n.post ? `#/profile/${esc(me.username)}` : n.type === 'follow' ? `#/profile/${esc(n.who)}` : n.post.kind === 'moment' ? '#/feed' : `#/post/${n.post.id}`;
        const followBack = n.type === 'follow' && !(me.following || []).includes(n.who);
        return `
          <li class="notif ${n.at > seen ? 'new' : ''}">
            <a class="notif-link" href="${href}">
              <span class="notif-av">${avatar(n.user)}<span class="notif-ic ${n.type}">${icon(iconFor[n.type])}</span></span>
              <span class="notif-text"><span>${line(n)}</span><span class="sub">${ago(n.at)}</span></span>
              ${n.post ? `<span class="notif-thumb">${thumb(n.post)}</span>` : ''}
            </a>
            ${followBack ? `<button class="btn primary sm" data-action="follow" data-user="${esc(n.who)}">Follow back</button>` : ''}
          </li>`;
      }).join('')}</ul>` : `
        <div class="empty">${icon('bell', 'big')}<h2>Nothing yet</h2><p class="muted">When someone licks or ${esc(soundFor(me.petType).word.toLowerCase())}s on your posts or follows you, it shows up here.</p><a class="btn primary" href="#/people">${icon('users')}Find people</a></div>`}
    </section>`;
  renderPushCard();
  me.notifSeen = Date.now();
  await saveMe();
  updateBell();
}

// ---------- real phone notifications (web push)
// Your phone buzzes for licks, barks, follows, new posts and reports, even when PetPost is closed.
// The database tells the `push` function (supabase/functions/push), which sends them.
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const onHomeScreen = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushWorks = () => !Native.on && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

async function pushRegistration() {
  // Gives up after a few seconds if offline mode never started (so buttons don't hang).
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('PetPost is still loading. Try again in a moment.')), 6000))]);
}
async function currentPush() {
  if (!pushWorks()) return null;
  return (await pushRegistration()).pushManager.getSubscription();
}

async function pushState() {
  if (Native.on) return 'native';
  if (!pushWorks()) return isIOS && !onHomeScreen() ? 'homescreen' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try { return Notification.permission === 'granted' && await currentPush() ? 'on' : 'off'; } catch { return 'off'; }
}

async function turnOnPush() {
  const answer = await Notification.requestPermission();
  if (answer !== 'granted') return false;
  const reg = await pushRegistration();
  const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUSH_PUBLIC_KEY) });
  await db.savePush(sub.toJSON());
  return true;
}
async function turnOffPush() {
  const sub = await currentPush();
  if (!sub) return;
  await db.removePush(sub.endpoint);
  await sub.unsubscribe();
}
// If this phone already has notifications on, make sure they go to whoever is signed in.
async function syncPush() {
  try {
    if (!pushWorks() || Notification.permission !== 'granted') return;
    const sub = await currentPush();
    if (sub) await db.savePush(sub.toJSON());
  } catch { /* try again next time */ }
}

async function renderPushCard() {
  const slot = document.querySelector('.push-slot');
  if (!slot) return;
  const state = await pushState();
  const body = {
    on: `<span class="push-text"><strong>Phone notifications are on</strong><span class="muted small">Your phone will buzz when something happens, even when PetPost is closed.</span></span>
         <button class="btn ghost sm" data-action="push-off">Turn off</button>`,
    off: `<span class="push-text"><strong>Get phone notifications</strong><span class="muted small">Find out right away when someone licks, barks, follows you or posts.</span></span>
          <button class="btn primary sm" data-action="push-on">Turn on</button>`,
    blocked: `<span class="push-text"><strong>Notifications are blocked</strong><span class="muted small">Turn them on for PetPost in your phone's Settings, then come back here.</span></span>`,
    homescreen: `<span class="push-text"><strong>Want phone notifications?</strong><span class="muted small">On iPhone, add PetPost to your Home Screen first: tap Share, then Add to Home Screen, and open it from there.</span></span>`,
  }[state];
  slot.innerHTML = body ? `<div class="push-card ${state}">${icon('bell')}${body}</div>` : '';
}

actions['push-on'] = async el => {
  el.disabled = true;
  try {
    if (await turnOnPush()) { toast('Phone notifications are on'); Native.send({ type: 'haptic', style: 'success' }); }
    else toast('Notifications were not allowed');
  } catch (err) { toast(`Could not turn on notifications: ${err.message}`); }
  renderPushCard();
};
actions['push-off'] = async el => {
  el.disabled = true;
  try { await turnOffPush(); toast('Phone notifications are off'); } catch (err) { toast(`Could not turn them off: ${err.message}`); }
  renderPushCard();
};

// Tapping a notification opens PetPost on the right screen.
navigator.serviceWorker?.addEventListener('message', e => {
  if (e.data?.type === 'open' && typeof e.data.url === 'string' && e.data.url.startsWith('#/')) go(e.data.url);
});

// ---------- reports (only admins see this tab)
let reportGroups = [];
async function viewReports(main) {
  if (!db.isAdmin()) { main.innerHTML = `<div class="card empty"><p>Only people who run PetPost can see reports.</p></div>`; return; }
  // One card per reported post (or per reported account), with every report about it.
  const groups = new Map();
  for (const r of await db.adminReports()) {
    const key = r.post ? `post:${r.post.id}` : `user:${r.reportedUser || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, { post: r.post, user: r.post?.author || r.reportedUser, reports: [] });
    groups.get(key).reports.push(r);
  }
  reportGroups = [...groups.values()];
  const media = p => !p.media ? '' : p.mediaType === 'video'
    ? `<video src="${esc(p.media)}" controls playsinline preload="metadata"></video>`
    : `<img src="${esc(p.media)}" alt="Reported post" loading="lazy">`;
  main.innerHTML = `
    <section class="card">
      <h1>Reports</h1>
      <p class="muted">Posts and accounts people reported. Dismiss a report once you have looked at it, or remove the post.</p>
    </section>
    ${reportGroups.length ? reportGroups.map((g, i) => `
      <section class="card report-group">
        <header class="row">
          <h2>${g.post ? 'Post by' : 'Account'} <a href="#/profile/${esc(g.user)}">@${esc(g.user || 'deleted account')}</a></h2>
          <span class="spacer"></span>
          <span class="report-count">${g.reports.length} ${plural(g.reports.length, 'report')}</span>
        </header>
        ${g.post ? `
          <div class="report-post">
            ${media(g.post)}
            ${g.post.caption ? `<p>${esc(g.post.caption)}</p>` : ''}
            <p class="muted small">${g.post.kind === 'moment' ? 'Moment' : g.post.mediaType === 'video' ? 'Video' : 'Photo'} posted ${ago(g.post.createdAt)}</p>
          </div>` : ''}
        <ul class="report-list">
          ${g.reports.map(r => {
            // A description, if the reporter wrote one, comes after the reason and a colon.
            const known = REPORT_REASONS.find(x => r.reason.startsWith(`${x}: `));
            const [reason, ...rest] = known ? [known, r.reason.slice(known.length + 2)] : [r.reason];
            return `<li><strong>${esc(reason)}</strong>${rest.length ? `<span class="report-words">“${esc(rest[0])}”</span>` : ''}<span class="muted small">by @${esc(r.reporter || 'deleted account')} · ${ago(r.createdAt)}</span></li>`;
          }).join('')}
        </ul>
        <div class="row wrap">
          <button class="btn ghost sm" data-action="dismiss-reports" data-group="${i}">${icon('check')}Dismiss</button>
          ${g.post ? `<button class="btn ghost sm danger" data-action="remove-reported-post" data-group="${i}">${icon('trash')}Remove post</button>` : ''}
        </div>
      </section>`).join('') : `
      <section class="card empty">${icon('flag', 'big')}<h2>No reports</h2><p class="muted">When someone reports a post or an account, it shows up here.</p></section>`}`;
}

actions['dismiss-reports'] = async el => {
  const g = reportGroups[el.dataset.group];
  try {
    await db.dismissReports(g.reports.map(r => r.id));
    toast('Report dismissed');
    route();
  } catch (err) { toast(`Could not dismiss it: ${err.message}`); }
};

actions['remove-reported-post'] = async el => {
  const g = reportGroups[el.dataset.group];
  if (!confirm(`Remove this post by @${g.user}? This cannot be undone.`)) return;
  try {
    await db.adminDeletePost(g.post.id);
    toast('Post removed');
    route();
  } catch (err) { toast(`Could not remove it: ${err.message}`); }
};

// ---------- pet card
async function petCard(u) {
  const goals = (await db.byIndex('goals', 'owner', u.username)).filter(g => goalForPet(g, u));
  const tricks = goals.filter(g => g.completedAt).sort((a, b) => a.completedAt - b.completedAt).map(g => trickName(g.title)).filter(Boolean);
  const best = streakStats(u.practiceDays).best;
  const facts = [
    ['Age', ageText(u.birthday)],
    ['Birthday', u.birthday ? new Date(`${u.birthday}T12:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : ''],
    ['Favorite treat', u.treat],
    ['Favorite toy', u.toy],
  ].filter(([, v]) => v);
  return {
    petName: u.petName || u.displayName,
    line: [petKind(u), u.breed].filter(Boolean).join(' · '),
    facts,
    tricks,
    stats: [[String((u.trophies || []).length), (u.trophies || []).length === 1 ? 'Trophy' : 'Trophies'], [String(tricks.length), tricks.length === 1 ? 'Trick' : 'Tricks'], [String(best), 'Best streak']],
    owner: u.username,
    avatar: u.avatar || null,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b5bfd',
  };
}

actions['pet-card'] = async el => {
  const u = el.dataset.user === me.username ? me : await db.get('users', el.dataset.user);
  if (!u) return;
  const card = await petCard(u);
  const own = u.username === me.username;
  const d = document.createElement('dialog');
  d.className = 'modal pet-card-modal';
  d.innerHTML = `
    <div class="pet-card">
      <div class="pc-photo">${avatar(u, 'xl')}</div>
      <h2>${esc(card.petName)}</h2>
      ${card.line ? `<p class="pc-line">${esc(card.line)}</p>` : ''}
      ${card.facts.length ? `<div class="pc-facts">${card.facts.map(([k, v]) => `<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}</div>` : ''}
      <div class="pc-tricks"><span class="pc-label">Tricks learned</span>
        <div class="chips">${card.tricks.length ? card.tricks.map(t => `<span class="chip trick">${icon('check')}${esc(t)}</span>`).join('') : '<span class="chip">Still learning</span>'}</div>
      </div>
      <div class="pc-stats">${card.stats.map(([v, k]) => `<div><strong>${esc(v)}</strong><span>${esc(k)}</span></div>`).join('')}</div>
      <p class="pc-owner">${icon('paw')}@${esc(u.username)} on PetPost</p>
    </div>
    ${own && !card.facts.length ? `<p class="muted small center pad-top">Add a breed, birthday and favorites in Edit profile to fill in the card.</p>` : ''}
    <div class="row wrap pad-top">
      <button type="button" class="btn ghost" data-action="close-dialog">Close</button>
      <span class="spacer"></span>
      ${own ? `<button type="button" class="btn ghost" data-action="pet-card-edit">${icon('edit')}Edit details</button>` : ''}
      ${own ? `<button type="button" class="btn primary" data-action="pet-card-share">${icon('share')}Share card</button>` : ''}
    </div>`;
  d.petCard = card;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};

actions['pet-card-edit'] = el => { el.closest('dialog').close(); actions['edit-profile'](); };

actions['pet-card-share'] = async el => {
  const d = el.closest('dialog');
  if (d.petCard.owner !== me.username) return;
  el.disabled = true;
  const blob = await cardImage(d.petCard);
  el.disabled = false;
  const name = `${(d.petCard.petName || 'pet').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-pet-card.png`;
  const text = `Meet ${d.petCard.petName} on PetPost`;
  if (Native.on) return downloadBlob(blob, name, text);
  const file = new File([blob], name, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'PetPost', text }); } catch { /* cancelled */ }
  } else {
    downloadBlob(blob, name);
    toast('Pet card saved to your device');
  }
};

// ---------- goals
// Training goal ideas, picked by the kind of pet. Each idea is "teach <pet> to ..." plus small steps.
const DOG_GOALS = {
  'sit': ['Hold a treat just above their nose', 'Slowly move it back over their head', 'Say "sit" the moment they sit, then reward', 'Practice 5 minutes, twice a day', 'Try it without the treat in your hand'],
  'come when called': ['Pick a happy recall word', 'Say it from a few steps away and reward big', 'Add distance a little at a time', 'Practice with mild distractions', 'Try it in a safe, enclosed outdoor space'],
  'walk nicely on a leash': ['Get them comfortable wearing the leash', 'Reward every few steps at your side', 'Stop moving when they pull', 'Change direction to keep their focus', 'Practice on a short, quiet route'],
  'shake paw': ['Hold a treat in a closed fist low down', 'Reward when they paw at your hand', 'Add the word "shake"', 'Offer an open hand instead of a fist'],
  'stay': ['Ask for a sit first', 'Show a flat palm and say "stay"', 'Step back once, return and reward', 'Slowly add more distance and time'],
  'roll over': ['Start with them lying down', 'Lure the treat from nose to shoulder', 'Keep luring until they roll', 'Add the cue "roll over"'],
  'high five': ['Teach "shake paw" first', 'Raise your hand a little higher each time', 'Add the cue "high five"'],
  'go to their bed': ['Toss a treat onto the bed', 'Reward when all four paws are on it', 'Add the cue "bed"', 'Ask from further away', 'Have them stay there for a few seconds'],
};
const GOAL_IDEAS = [
  [/dog|pupp/, DOG_GOALS],
  [/cat|kitten/, {
    'use the litter box': ['Pick a quiet, easy-to-reach spot', 'Place them in the box after meals and naps', 'Reward right after they use it', 'Scoop it every day'],
    'come when called': ['Shake a treat bag and give a treat when they come', 'Add their name before the shake', 'Call from another room', 'Fade out the shake, keep the treat'],
    'use the scratching post': ['Put the post next to their favorite scratching spot', 'Rub catnip or a toy on it', 'Reward when they scratch it', 'Cover the old spot for a while'],
    'sit': ['Hold a treat just above their head', 'Reward the moment they sit', 'Add the word "sit"', 'Practice for a minute at a time'],
    'high five': ['Hold a treat just out of reach', 'Reward when they lift a paw', 'Raise your hand a little higher', 'Add the cue "high five"'],
    'walk on a harness': ['Leave the harness next to their food', 'Put it on for a minute, then treat', 'Let them walk around inside wearing it', 'Try a short, calm trip outside'],
    'get in the carrier calmly': ['Leave the carrier open with a blanket inside', 'Feed treats near, then inside it', 'Close the door for a few seconds', 'Pick it up and carry it a short way'],
  }],
  [/horse|pony|donkey/, {
    'lead nicely': ['Walk beside their shoulder, not in front', 'Stop and reward when they stop with you', 'Practice turns both ways', 'Lead past something new and calm them'],
    'pick up their feet': ['Run your hand down the leg slowly', 'Reward any small lift', 'Hold the hoof for a second, then a few', 'Practice all four feet'],
    'stand still for grooming': ['Tie safely in a quiet spot', 'Groom a little, then give a scratch they like', 'Groom for longer each day', 'Add the fly spray once they are calm'],
    'load into the trailer': ['Let them sniff the trailer with the door open', 'Reward one hoof on the ramp', 'Walk all the way in, then right out', 'Close the door for a few seconds, then open'],
    'come to the gate when called': ['Call their name at feeding time', 'Reward at the gate every time', 'Call from further across the field', 'Call at other times, still reward'],
  }],
  [/chicken|hen|rooster/, {
    'come when called': ['Use the same call every time you bring treats', 'Scatter a few treats right after calling', 'Call from further away', 'Call when they are busy scratching'],
    'eat from my hand': ['Sit still in the run with treats', 'Drop treats near your feet', 'Hold treats in an open flat hand', 'Let them come to you, never grab'],
    'go back to the coop at dusk': ['Keep a light on in the coop at first', 'Put a treat inside at bedtime', 'Call them over with your treat call', 'Close the door once everyone is in'],
    'be picked up calmly': ['Sit with them on your lap with treats', 'Hold their wings gently against their body', 'Pick up, hold for a few seconds, set down', 'Hold a little longer each time'],
    'lay in the nest box': ['Add soft bedding to the nest boxes', 'Put a fake or wooden egg in each box', 'Collect eggs from the floor quickly', 'Keep the boxes darker and quiet'],
  }],
  [/duck|goose/, {
    'come when called': ['Use the same call with peas or lettuce', 'Toss treats right after the call', 'Call from further away', 'Call when they are on the water'],
    'go into the shelter at night': ['Put their food just inside the door', 'Walk behind them calmly with arms out', 'Use your call at bedtime', 'Close up once all are inside'],
    'eat from my hand': ['Float treats in a shallow dish', 'Hold the dish near you', 'Offer treats on a flat hand', 'Stay still and let them come'],
  }],
  [/bird|parrot|budgie|parakeet|canary|cockatiel/, {
    'step up onto my finger': ['Let them get used to your hand near the cage', 'Offer a treat from your fingers', 'Hold a finger just above their feet', 'Say "step up" as they climb on, then reward'],
    'come out of the cage calmly': ['Open the door and wait quietly', 'Put a treat on a perch by the door', 'Reward any step outside', 'Practice going back in for a treat too'],
    'say a word': ['Pick one short, happy word', 'Say it every time you do the same thing', 'Repeat it calmly a few times a day', 'Reward any sound that is close'],
    'turn around': ['Hold a treat by their head', 'Move it slowly around behind them', 'Reward when they turn all the way', 'Add a hand signal'],
    'wave': ['Teach "step up" first', 'Lift your finger near their foot, reward any lift', 'Add the word "wave"', 'Reward only higher waves'],
  }],
  [/rabbit|bunny/, {
    'use the litter box': ['Put hay at one end of the box', 'Move droppings into the box', 'Clean other spots with vinegar', 'Reward when they use it'],
    'come when called': ['Shake a treat cup, then give a treat', 'Add their name before the shake', 'Call from further away', 'Call from another room'],
    'jump onto a step': ['Use a low, sturdy step', 'Lure them up with a treat', 'Add a word like "up"', 'Try a slightly higher step'],
    'be picked up calmly': ['Sit on the floor and let them come to you', 'Stroke their back and give a treat', 'Lift a little with support under the back legs', 'Hold close and low, then set down'],
  }],
  [/guinea|hamster|mouse|rat|gerbil|ferret/, {
    'come to my hand': ['Rest your hand in the cage without moving', 'Hold a treat between your fingers', 'Let them climb on to take it', 'Lift a little while they eat'],
    'be held calmly': ['Scoop with both hands from underneath', 'Hold low over a soft surface', 'Offer a treat while holding', 'Hold a little longer each day'],
    'go through a tunnel': ['Put a treat at the end of the tunnel', 'Start with a short tunnel', 'Add a word as they go through', 'Use a longer tunnel'],
    'stand up for a treat': ['Hold a treat just above their nose', 'Reward when they rise up', 'Add a word like "up"', 'Hold it a little higher'],
  }],
  [/fish/, {
    'eat from my fingertips': ['Feed at the same spot and time every day', 'Hold food just above the water', 'Lower your fingers to the surface', 'Wait still until they come'],
    'come to the glass when I wave': ['Wave the same way right before feeding', 'Feed only after the wave', 'Wave without feeding sometimes, then feed', 'Check if they come to the wave alone'],
    'swim through a hoop': ['Put a small hoop in the tank', 'Hold food on the other side of it', 'Feed only after they swim through', 'Move the hoop to new spots'],
  }],
  [/snake|reptile|lizard|turtle|tortoise|gecko|dragon/, {
    'be handled calmly': ['Let them see your hand before you touch', 'Support their whole body when lifting', 'Hold for a minute, then return them', 'Handle a little longer each time'],
    'eat from tongs': ['Use the same tongs every time', 'Wiggle food slowly in front of them', 'Feed at the same time of day', 'Wait patiently, don’t force it'],
    'come to the front of the tank': ['Feed at the front at the same time', 'Tap the glass gently before feeding', 'Reward any move toward you', 'Try the tap without food first'],
  }],
  [/cow|cattle|calf|goat|sheep|lamb|pig/, {
    'come when called': ['Use the same call with a small treat', 'Reward at the gate every time', 'Call from further across the field', 'Call at other times, still reward'],
    'walk on a halter or lead': ['Let them wear the halter in the pen', 'Lead a few steps, then reward', 'Practice stopping and starting', 'Walk outside the pen together'],
    'stand still to be brushed': ['Brush their favorite itchy spot first', 'Reward for standing calmly', 'Brush a bit longer each day', 'Brush the legs and belly too'],
    'go into the trailer or barn': ['Feed near the door, then just inside', 'Walk in with them a few times', 'Close the door for a few seconds', 'Practice before you really need it'],
  }],
  [/frog|toad|axolotl/, {
    'eat from tongs': ['Use soft-tipped tongs', 'Wiggle food slowly near them', 'Feed at the same time each day', 'Be patient and still'],
    'come to the feeding spot': ['Always feed in the same spot', 'Feed at the same time each day', 'Wait a moment before offering food', 'Check if they wait there for you'],
  }],
];
const GENERIC_GOALS = {
  'come when called': ['Pick one call or sound', 'Reward the moment they come', 'Practice a few times a day', 'Call from further away'],
  'be handled calmly': ['Let them get used to your hand nearby', 'Touch gently, then reward', 'Hold for a few seconds, then let go', 'Hold a little longer each day'],
  'eat from my hand': ['Sit still nearby with treats', 'Drop treats close to you', 'Offer treats on a flat hand', 'Let them come to you'],
  'learn a new trick': ['Pick one small trick', 'Reward every tiny step toward it', 'Add a word or signal', 'Practice a few minutes a day'],
};
const goalIdeas = petType => (GOAL_IDEAS.find(([re]) => re.test(String(petType || '').toLowerCase())) || [null, GENERIC_GOALS])[1];

function dueLabel(g) {
  if (!g.target || g.completedAt) return '';
  const days = Math.ceil((new Date(`${g.target}T23:59:59`) - Date.now()) / 864e5);
  const text = days > 1 ? `${days} days left` : days === 1 ? '1 day left' : days === 0 ? 'Due today' : `${-days} ${-days === 1 ? 'day' : 'days'} overdue`;
  return `<span class="due ${days < 0 ? 'late' : ''}">${text}</span>`;
}

function goalCard(g, own) {
  const total = g.steps.length, done = g.steps.filter(s => s.done).length;
  const pct = g.completedAt ? 100 : total ? Math.round(done / total * 100) : 0;
  const editable = own && !g.completedAt;
  return `
    <article class="card goal ${g.completedAt ? 'done' : ''}" data-goal="${g.id}">
      <header class="row">
        <h3>${g.completedAt ? icon('check', 'done-ic') : ''}${esc(g.title)}</h3>
        <span class="spacer"></span>${dueLabel(g)}
      </header>
      <div class="progress"><i style="width:${pct}%"></i></div>
      <p class="muted small">${g.completedAt ? `Completed ${ago(g.completedAt)} ago`.replace('just now ago', 'just now') : total ? `${done} of ${total} steps · ${pct}%` : 'No steps added'}${g.practice?.length ? ` · practiced ${g.practice.length} ${g.practice.length === 1 ? 'day' : 'days'}` : ''}</p>
      ${total ? `<ul class="steps">${g.steps.map((s, i) => `
        <li><label class="${s.done ? 'checked' : ''}"><input type="checkbox" ${s.done ? 'checked' : ''} ${editable ? '' : 'disabled'} data-action="goal-step" data-id="${g.id}" data-i="${i}"><span>${esc(s.text)}</span></label></li>`).join('')}</ul>` : ''}
      ${own ? `
        <div class="row wrap">
          ${!g.completedAt ? (g.practice?.includes(dayKey())
            ? `<button class="btn ghost sm practiced" data-action="goal-practice" data-id="${g.id}" aria-pressed="true">${icon('check')}Practiced today</button>`
            : `<button class="btn ghost sm" data-action="goal-practice" data-id="${g.id}" aria-pressed="false">${icon('flame')}Practice today</button>`) : ''}
          ${!g.completedAt ? `<button class="btn primary sm" data-action="goal-complete" data-id="${g.id}">${icon('check')}Mark complete</button>` : ''}
          <button class="btn ghost sm" data-action="goal-share" data-id="${g.id}">${icon('share')}${g.completedAt ? 'Share it' : 'Post progress'}</button>
          <span class="spacer"></span>
          <button class="icon-btn" data-action="goal-delete" data-id="${g.id}" aria-label="Delete goal">${icon('trash')}</button>
        </div>` : ''}
    </article>`;
}

async function viewGoals(main) {
  const goals = (await db.byIndex('goals', 'owner', me.username)).filter(g => goalForPet(g, me)).sort((a, b) => b.createdAt - a.createdAt);
  const active = goals.filter(g => !g.completedAt), done = goals.filter(g => g.completedAt);
  const pet = me.petName || 'my pet';
  main.innerHTML = `
    <section class="card">
      <h1>Training goals</h1>
      <p class="muted">Pick something to teach ${esc(pet)}, break it into small steps, and share progress along the way.</p>
      <form data-form="goal" class="stack goal-form" novalidate>
        <label class="field"><span>Teach ${esc(pet)} to...</span><input name="title" required maxlength="80" placeholder="sit, shake paw, come when called"></label>
        <div class="chips">${Object.keys(goalIdeas(me.petType)).map(k => `<button type="button" class="chip pick" data-action="goal-template" data-name="${esc(k)}">${esc(cap(k))}</button>`).join('')}</div>
        <label class="field"><span>Steps <small class="muted">one per line, optional</small></span><textarea name="steps" rows="4"></textarea></label>
        <div class="row wrap">
          <label class="field grow"><span>Target date <small class="muted">optional</small></span><input type="date" name="target"></label>
          <button class="btn primary">${icon('plus')}Add goal</button>
        </div>
        <p class="form-error" role="alert"></p>
      </form>
    </section>
    <div class="streak-slot">${streakCard()}</div>
    ${active.length ? `<h2 class="section-title">In progress</h2>${active.map(g => goalCard(g, true)).join('')}` : ''}
    ${done.length ? `<h2 class="section-title">Completed</h2>${done.map(g => goalCard(g, true)).join('')}` : ''}
    ${!goals.length ? `<div class="card empty">${icon('goal', 'big')}<p class="muted">No goals yet. Tap a suggestion above to start.</p></div>` : ''}`;
}

actions['goal-template'] = el => {
  const form = el.closest('form');
  form.title.value = el.dataset.name;
  form.steps.value = (goalIdeas(me.petType)[el.dataset.name] || []).join('\n');
  form.querySelectorAll('.chip.pick').forEach(c => c.classList.toggle('on', c === el));
};

forms.goal = async (form, fd) => {
  let what = String(fd.get('title') || '').trim().replace(/^to\s+/i, '');
  if (!what) {
    formError(form, `Type what you want to teach ${me.petName || 'your pet'}, or tap one of the ideas.`);
    form.querySelector('input[name="title"]').focus();
    return;
  }
  if (form.querySelector('input[name="target"]').validity.badInput) {
    formError(form, 'That date is not finished. Fill in the month, day and year, or clear it.');
    return;
  }
  formError(form, '');
  const title = /^teach\b/i.test(what) ? what : `Teach ${me.petName || 'my pet'} to ${what}`;
  const steps = String(fd.get('steps') || '').split('\n').map(s => s.trim()).filter(Boolean).map(text => ({ text, done: false }));
  await db.put('goals', { id: db.uid(), owner: me.username, petId: activePetId(me), title, steps, target: fd.get('target') || null, createdAt: Date.now(), completedAt: null });
  toast('Goal added. Add another any time.');
  await route();
  document.querySelector('.goal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelector('.goal')?.classList.add('just-added');
};

async function refreshGoal(id) {
  const g = await db.get('goals', id);
  const card = document.querySelector(`.goal[data-goal="${id}"]`);
  if (g && card) card.outerHTML = goalCard(g, true);
  return g;
}

actions['goal-step'] = async el => {
  const g = await db.get('goals', el.dataset.id);
  if (!g || g.completedAt) return;
  g.steps[+el.dataset.i].done = el.checked;
  const newDay = el.checked && !g.practice?.includes(dayKey());
  if (newDay) (g.practice ||= []).push(dayKey());
  await db.put('goals', g);
  await refreshGoal(g.id);
  if (newDay) await recordPractice();
  else if (g.steps.every(s => s.done)) toast('Every step done. Mark the goal complete when you are ready.');
};

actions['goal-complete'] = async el => {
  const g = await db.get('goals', el.dataset.id);
  if (!g) return;
  g.completedAt = Date.now();
  g.steps.forEach(s => (s.done = true));
  await db.put('goals', g);
  const trophy = awardTrophy(me, g);
  await saveMe();
  const choice = await showTrophy({ kicker: 'Goal complete', headline: trophyHeadline(trophy, true), number: me.trophies.length, date: fmtDate(trophy.earnedAt) });
  if (choice === 'trophies') go(`#/profile/${me.username}/trophies`);
  else route();
};

// ---------- trophies
const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

// "Teach Biscuit to sit" -> "You taught Biscuit to sit!"
function trophyHeadline(t, own) {
  if (t.kind === 'record') {
    const what = t.record === 'licks' ? 'licks' : soundFor(t.petType).words.toLowerCase();
    const who = own ? (t.shared ? 'You share' : 'You have') : `${t.ownerName || 'They'} ${t.shared ? 'shares' : 'has'}`;
    return `${who} the record for the most ${what} on PetPost!`;
  }
  if (t.kind === 'streak') return `${own ? 'You' : t.ownerName || 'They'} trained ${t.petName || 'your pet'} ${t.days} days in a row!`;
  const rest = t.title.replace(/^teach\s+/i, '');
  const said = rest === t.title ? `reached the goal "${t.title}"` : `taught ${rest}`;
  return `${own ? 'You' : t.ownerName || 'They'} ${said}!`;
}

// ---------- record trophies
// Whoever's posts got the most licks, and the most barks, on all of PetPost. They aren't saved: they
// move to whoever beats the record. AI sample accounts can't hold records.
async function recordHolders() {
  const [posts, users, comments] = await Promise.all([db.all('posts'), db.all('users'), db.all('comments')]);
  const ai = new Set(users.filter(u => u.ai).map(u => u.username));
  const totals = {};
  const authorOf = new Map(posts.map(p => [p.id, p.author]));
  for (const p of posts) {
    if (ai.has(p.author)) continue;
    const t = totals[p.author] ||= { licks: 0, barks: 0 };
    t.licks += (p.licks || []).filter(n => !ai.has(n)).length; // licks from AI accounts don't count
  }
  for (const c of comments) {
    const t = totals[authorOf.get(c.postId)];
    if (t && !ai.has(c.author)) t.barks++;
  }
  const top = key => {
    const best = Math.max(0, ...Object.values(totals).map(t => t[key]));
    return { count: best, users: best ? Object.keys(totals).filter(n => totals[n][key] === best) : [] };
  };
  return { licks: top('licks'), barks: top('barks') };
}
async function recordTrophiesFor(u) {
  const r = await recordHolders();
  const out = [];
  if (r.licks.users.includes(u.username)) out.push({ id: 'record-licks', kind: 'record', record: 'licks', count: r.licks.count, shared: r.licks.users.length > 1 });
  if (r.barks.users.includes(u.username)) out.push({ id: 'record-barks', kind: 'record', record: 'barks', count: r.barks.count, shared: r.barks.users.length > 1 });
  return out;
}

function awardTrophy(user, goal) {
  user.trophies ||= [];
  let t = user.trophies.find(x => x.goalId && x.goalId === goal.id);
  if (!t) {
    t = { id: db.uid(), goalId: goal.id, title: goal.title, steps: goal.steps.length, earnedAt: goal.completedAt || Date.now() };
    user.trophies.push(t);
  }
  return t;
}

const TROPHY_TIERS = [['gold', 'Gold'], ['silver', 'Silver'], ['bronze', 'Bronze']];
function trophyCard(t, i, own, u, reactions = []) {
  const record = t.kind === 'record';
  const [tier, tierName] = record ? ['record', 'Record'] : t.kind === 'streak' ? ['streak', `${t.days}-day streak`] : TROPHY_TIERS[i % 3];
  const what = t.record === 'licks' ? plural(t.count, 'lick') : countLabel(t.count, u.petType).toLowerCase();
  const detail = record ? `${t.count} ${what} on ${own ? 'your' : 'their'} posts${t.shared ? ' · tied for first' : ''}`
    : `${t.kind === 'streak' ? 'Streak reached' : 'Goal reached'} ${fmtDate(t.earnedAt)}${t.steps ? ` · ${t.steps} ${t.steps === 1 ? 'step' : 'steps'}` : ''}`;
  const mine = reactions.filter(r => r.trophyId === t.id);
  const licks = mine.filter(r => r.kind === 'lick'), barks = mine.filter(r => r.kind === 'comment');
  const licked = licks.some(r => r.user === me.username);
  return `
    <article class="card trophy-card" data-owner="${esc(u.username)}" data-trophy="${esc(t.id)}">
      <div class="trophy ${tier}">
        <div class="trophy-icon">${icon(record ? (t.record === 'licks' ? 'lick' : 'bark') : t.kind === 'streak' ? 'flame' : 'trophy')}</div>
        <div class="trophy-body">
          <span class="trophy-num">${record ? 'PetPost record' : `${tierName} · Trophy #${i + 1}`}</span>
          <h3>${esc(trophyHeadline({ ...t, ownerName: u.displayName, petType: u.petType }, own))}</h3>
          <p class="muted small">${detail}</p>
        </div>
      </div>
      <div class="actions trophy-acts">
        <button class="act lick ${licked ? 'on' : ''}" data-action="trophy-lick" aria-pressed="${licked}">${icon('lick')}<span class="count">${licks.length}</span><span class="lbl">${plural(licks.length, 'Lick')}</span></button>
        <button class="act" data-action="trophy-barks">${icon('bark')}<span class="count">${barks.length}</span><span class="lbl">${countLabel(barks.length, me.petType)}</span></button>
      </div>
      <div class="trophy-barks" hidden>${trophyBarks(barks, u)}</div>
    </article>`;
}

function trophyBarks(barks, owner) {
  const sound = soundFor(me.petType);
  return `
    <div class="bark-list">${barks.map(c => {
      const who = userCache.get(c.user) || { username: c.user, displayName: c.user };
      const canDelete = c.user === me.username || owner.username === me.username;
      return `
        <div class="bark">
          <a href="#/profile/${esc(c.user)}">${avatar(who, 'sm')}</a>
          <div class="bark-body">
            <p><a class="name" href="#/profile/${esc(c.user)}">${esc(who.displayName)}${aiTag(who)}</a> <span class="sub">${soundFor(who.petType).past} · ${ago(c.createdAt)}</span></p>
            <p>${esc(c.text)}</p>
          </div>
          ${canDelete ? `<button class="icon-btn sm" data-action="trophy-bark-delete" data-id="${esc(c.id)}" aria-label="Delete">${icon('trash')}</button>` : ''}
        </div>`;
    }).join('') || `<p class="muted small no-barks">No ${sound.words.toLowerCase()} yet.</p>`}</div>
    <form data-form="trophy-bark" class="bark-form">
      ${avatar(me, 'sm')}
      <input name="text" maxlength="400" placeholder="${esc(sound.prompt)}" required autocomplete="off" aria-label="Write a comment">
      <button class="btn primary sm">${sound.word}</button>
    </form>`;
}
const userCache = new Map();

// Redraw one trophy card from what's saved, keeping its comments open if they were.
async function refreshTrophy(card) {
  const owner = card.dataset.owner, open = !card.querySelector('.trophy-barks').hidden;
  const [u, reactions] = await Promise.all([owner === me.username ? me : db.get('users', owner), db.trophyReactions(owner)]);
  const all = [...(u.trophies || [])].sort((a, b) => a.earnedAt - b.earnedAt);
  const i = all.findIndex(t => t.id === card.dataset.trophy);
  const t = i >= 0 ? all[i] : (await recordTrophiesFor(u)).find(x => x.id === card.dataset.trophy);
  if (!t) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = trophyCard(t, i, owner === me.username, u, reactions);
  const fresh = tmp.firstElementChild;
  fresh.querySelector('.trophy-barks').hidden = !open;
  card.replaceWith(fresh);
}

actions['trophy-lick'] = async el => {
  const card = el.closest('.trophy-card');
  const on = !el.classList.contains('on');
  el.classList.toggle('on', on);
  try { await db.trophyLick(card.dataset.owner, card.dataset.trophy, on); } catch (err) { toast(`Could not lick it: ${err.message}`); }
  refreshTrophy(card);
};
actions['trophy-barks'] = el => {
  const box = el.closest('.trophy-card').querySelector('.trophy-barks');
  box.hidden = !box.hidden;
  if (!box.hidden) box.querySelector('input')?.focus();
};
actions['trophy-bark-delete'] = async el => {
  if (!confirm('Delete this comment?')) return;
  const card = el.closest('.trophy-card');
  try { await db.deleteTrophyReaction(el.dataset.id); } catch (err) { toast(`Could not delete it: ${err.message}`); }
  refreshTrophy(card);
};
forms['trophy-bark'] = async (form, fd) => {
  const text = String(fd.get('text') || '').trim();
  if (!text || form.dataset.sending) return;
  form.dataset.sending = '1';
  const card = form.closest('.trophy-card');
  try {
    await db.trophyComment(card.dataset.owner, card.dataset.trophy, text);
    await refreshTrophy(card);
  } catch (err) { toast(`Could not send it: ${err.message}`); delete form.dataset.sending; }
};

// ---------- daily streaks
// Practising any goal on a day keeps the streak going; skipping a whole day resets it.
const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100, 365];
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const shiftDay = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function streakStats(days = []) {
  const set = new Set(days);
  const today = new Date();
  let cursor = set.has(dayKey(today)) ? today : shiftDay(today, -1);
  let current = 0;
  while (set.has(dayKey(cursor))) { current++; cursor = shiftDay(cursor, -1); }
  const start = current ? shiftDay(cursor, 1) : null; // the first day of the streak going on now
  let best = 0, run = 0, prev = null;
  for (const k of [...set].sort()) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && dayKey(shiftDay(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, start, today: set.has(dayKey(today)) };
}

function streakCard() {
  const { current, best, today } = streakStats(me.practiceDays);
  const next = STREAK_MILESTONES.find(m => m > current);
  const week = Array.from({ length: 7 }, (_, i) => shiftDay(new Date(), i - 6));
  const set = new Set(me.practiceDays || []);
  const pet = esc(me.petName || 'your pet');
  const message = today
    ? `Done for today. Come back tomorrow to keep it going.`
    : current
      ? `Practice any goal today to keep your streak alive.`
      : `Practice any goal with ${pet} today to start a streak.`;
  return `
    <section class="card streak-card ${current ? 'lit' : ''}">
      <div class="streak-top">
        <div class="streak-flame">${icon('flame')}</div>
        <div class="streak-count"><strong>${current}</strong><span>${current === 1 ? 'day' : 'day'} streak</span></div>
        <div class="streak-meta muted small">Best ${best} ${best === 1 ? 'day' : 'days'}${next ? `<br>Next trophy at ${next} days` : ''}</div>
      </div>
      <div class="week" aria-label="Last 7 days">
        ${week.map(d => {
          const k = dayKey(d), isToday = k === dayKey();
          return `<span class="day ${set.has(k) ? 'on' : ''} ${isToday ? 'today' : ''}" title="${d.toLocaleDateString(undefined, { weekday: 'long' })}"><i>${set.has(k) ? icon('check') : ''}</i><small>${d.toLocaleDateString(undefined, { weekday: 'narrow' })}</small></span>`;
        }).join('')}
      </div>
      <p class="muted small">${message}</p>
    </section>`;
}

function refreshStreakCard() {
  const slot = document.querySelector('.streak-slot');
  if (slot) slot.innerHTML = streakCard();
}

// The streak bar on a profile: how long the streak is, when it started, and the best one.
function profileStreak(u, own) {
  const { current, best, start } = streakStats(u.practiceDays);
  const who = own ? 'You' : esc(u.displayName || u.username);
  const pet = esc(u.petName || (own ? 'your pet' : 'their pet'));
  const started = start && (dayKey(start) === dayKey() ? 'today' : start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: start.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }));
  const [title, line] = current
    ? [`${current}-day streak`, `Started ${started}`]
    : best
      ? ['No streak right now', own ? 'Practice any goal today to start a new one' : 'Their last streak ended']
      : ['No streak yet', own ? `Practice any goal with ${pet} to start one` : `${who} hasn't started one yet`];
  return `
    <div class="profile-streak ${current ? 'lit' : ''}">
      <span class="ps-flame">${icon('flame')}</span>
      <span class="ps-text"><strong>${title}</strong><span class="muted small">${line}</span></span>
      ${best ? `<span class="ps-best"><strong>${best}</strong><span class="muted small">Best</span></span>` : ''}
    </div>`;
}

// Adds today to the streak, then awards any streak trophy just reached.
async function recordPractice() {
  me.practiceDays ||= [];
  if (!me.practiceDays.includes(dayKey())) me.practiceDays.push(dayKey());
  const { current } = streakStats(me.practiceDays);
  me.streakTrophies ||= [];
  const reached = STREAK_MILESTONES.filter(m => m <= current && !me.streakTrophies.includes(m));
  let trophy = null;
  for (const m of reached) {
    me.streakTrophies.push(m);
    trophy = { id: db.uid(), kind: 'streak', days: m, petName: me.petName, title: `${m}-day streak`, earnedAt: Date.now() };
    (me.trophies ||= []).push(trophy);
  }
  await saveMe();
  refreshStreakCard();
  if (trophy) {
    const choice = await showTrophy({ badge: 'flame', kicker: `${trophy.days}-day streak`, headline: trophyHeadline(trophy, true), number: me.trophies.length, date: fmtDate(trophy.earnedAt) });
    if (choice === 'trophies') go(`#/profile/${me.username}/trophies`);
  } else {
    toast(current === 1 ? 'Streak started. See you tomorrow!' : `${current}-day streak. Keep it up!`);
  }
}

actions['goal-practice'] = async el => {
  const g = await db.get('goals', el.dataset.id);
  if (!g || g.completedAt) return;
  g.practice ||= [];
  const today = dayKey();
  if (g.practice.includes(today)) {
    // Undo: only drop today from the streak if no other goal was practised today.
    g.practice = g.practice.filter(d => d !== today);
    await db.put('goals', g);
    const others = (await db.byIndex('goals', 'owner', me.username)).some(x => x.id !== g.id && goalForPet(x, me) && x.practice?.includes(today));
    if (!others) { me.practiceDays = (me.practiceDays || []).filter(d => d !== today); await saveMe(); }
    await refreshGoal(g.id);
    refreshStreakCard();
    return;
  }
  g.practice.push(today);
  await db.put('goals', g);
  await refreshGoal(g.id);
  await recordPractice();
};

// One tap: make a picture of the goal's progress and post it to your profile.
actions['goal-share'] = async el => {
  const g = await db.get('goals', el.dataset.id);
  if (!g || el.disabled) return;
  el.disabled = true;
  const label = el.innerHTML;
  el.textContent = 'Posting...';
  try {
    const total = g.steps.length, done = g.steps.filter(s => s.done).length;
    const pct = g.completedAt ? 100 : total ? Math.round(done / total * 100) : 0;
    const blob = await goalImage({
      petName: me.petName, avatar: me.avatar, title: g.title, steps: g.steps, pct, done: !!g.completedAt,
      streak: streakStats(me.practiceDays).current, owner: me.username,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b5bfd',
    });
    const caption = g.completedAt
      ? `Goal complete: ${g.title}!`
      : `Working on: ${g.title}${total ? ` \u00b7 ${done} of ${total} steps` : ''}`;
    await db.put('posts', {
      id: db.uid(), author: me.username, ...petTag(), kind: 'photo', mediaType: 'image', media: blob, caption,
      licks: [], barkCount: 0, report: {}, goalId: g.id, goalTitle: g.title, createdAt: Date.now(), expiresAt: null,
    });
    toast('Progress posted to your profile');
    go(`#/profile/${me.username}`);
  } catch (err) {
    el.disabled = false;
    el.innerHTML = label;
    toast(`Could not post it: ${err.message}`);
  }
};

actions['goal-delete'] = async el => {
  if (!confirm('Delete this goal?')) return;
  await db.del('goals', el.dataset.id);
  el.closest('.goal').remove();
  toast('Goal deleted');
};

// ---------- pet care
// Needs repeat daily, on chosen weekdays, monthly, or happen once (like a vet visit).
// Done marks are kept per day in me.careLog = { 'YYYY-MM-DD': { needId: doneAt } }.
const CARE_KINDS = {
  food: ['bowl', 'Food'], walk: ['paw', 'Walk'], water: ['drop', 'Water'], meds: ['pill', 'Medicine'],
  groom: ['brush', 'Grooming'], play: ['ball', 'Play'], vet: ['vet', 'Vet'], other: ['bell', 'Other'],
};
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const need = (name, kind, time, repeat = 'daily', extra = {}) => ({ name, kind, time, repeat, ...extra });

function careTemplates(petType) {
  const t = String(petType || '').toLowerCase();
  if (/dog|pupp/.test(t)) return [
    need('Breakfast', 'food', '07:30'), need('Morning walk', 'walk', '08:00'), need('Fresh water', 'water', '09:00'),
    need('Dinner', 'food', '18:00'), need('Evening walk', 'walk', '19:00'),
    need('Brush coat', 'groom', '17:00', 'weekly', { days: [6] }), need('Flea and tick medicine', 'meds', '09:00', 'monthly', { date: dayKey() }),
  ];
  if (/cat|kitten/.test(t)) return [
    need('Breakfast', 'food', '07:30'), need('Fresh water', 'water', '09:00'), need('Dinner', 'food', '18:00'),
    need('Play time', 'play', '19:00'), need('Clean litter box', 'other', '20:00'),
    need('Brush coat', 'groom', '17:00', 'weekly', { days: [0] }), need('Flea medicine', 'meds', '09:00', 'monthly', { date: dayKey() }),
  ];
  if (/horse|pony|donkey/.test(t)) return [
    need('Morning hay', 'food', '07:00'), need('Fill water trough', 'water', '07:30'), need('Turnout', 'walk', '09:00'),
    need('Evening feed', 'food', '17:30'), need('Pick hooves', 'groom', '18:00'), need('Muck out stall', 'other', '18:30'),
  ];
  if (/fish/.test(t)) return [
    need('Morning feeding', 'food', '08:00'), need('Evening feeding', 'food', '18:00'),
    need('Check water temperature', 'water', '09:00'), need('Partial water change', 'water', '10:00', 'weekly', { days: [6] }),
  ];
  return [
    need('Morning feeding', 'food', '08:00'), need('Fresh water', 'water', '09:00'), need('Play time', 'play', '17:00'),
    need('Evening feeding', 'food', '18:00'), need('Clean the habitat', 'other', '10:00', 'weekly', { days: [6] }),
  ];
}

function occursOn(n, date) {
  if (n.repeat === 'daily') return true;
  if (n.repeat === 'weekly') return (n.days || []).includes(date.getDay());
  if (n.repeat === 'once') return n.date === dayKey(date);
  if (n.repeat === 'monthly') {
    const want = Number((n.date || dayKey()).slice(8));
    const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return date.getDate() === Math.min(want, last);
  }
  return false;
}

const fmtTime = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
const minutesOf = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

function scheduleText(n) {
  const at = fmtTime(n.time);
  if (n.repeat === 'daily') return `Every day at ${at}`;
  if (n.repeat === 'weekly') {
    const days = [...(n.days || [])].sort();
    return `${days.length === 7 ? 'Every day' : days.map(d => WEEKDAYS[d]).join(', ')} at ${at}`;
  }
  if (n.repeat === 'monthly') return `Monthly on day ${Number(n.date.slice(8))} at ${at}`;
  return `${new Date(`${n.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${at}`;
}

function todaysCare() {
  const today = new Date(), log = me.careLog?.[dayKey(today)] || {};
  return (me.care || []).filter(n => occursOn(n, today))
    .sort((a, b) => minutesOf(a.time) - minutesOf(b.time))
    .map(n => ({ ...n, doneAt: log[n.id] || null, overdue: !log[n.id] && minutesOf(n.time) < nowMinutes() }));
}

function upcomingCare(days = 14) {
  const out = [];
  for (let i = 1; i <= days; i++) {
    const d = shiftDay(new Date(), i);
    for (const n of me.care || []) if (n.repeat === 'once' || n.repeat === 'monthly') if (occursOn(n, d)) out.push({ n, d });
  }
  return out;
}

function careRow(n) {
  const [ic] = CARE_KINDS[n.kind] || CARE_KINDS.other;
  const state = n.doneAt ? 'done' : n.overdue ? 'overdue' : '';
  return `
    <li class="care-row ${state}" data-need="${n.id}">
      <button class="care-check" data-action="care-toggle" data-id="${n.id}" aria-pressed="${!!n.doneAt}" aria-label="${n.doneAt ? 'Mark not done' : 'Mark done'}: ${esc(n.name)}">${n.doneAt ? icon('check') : ''}</button>
      <span class="care-ic ${n.kind}">${icon(ic)}</span>
      <div class="care-text">
        <strong>${esc(n.name)}</strong>
        <span class="muted small">${fmtTime(n.time)}${n.doneAt || n.overdue ? ` · <span class="care-tag">${n.doneAt ? `done ${new Date(n.doneAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'overdue'}</span>` : ''}${n.note ? ` · ${esc(n.note)}` : ''}</span>
      </div>
    </li>`;
}

async function viewCare(main) {
  const pet = esc(me.petName || 'your pet');
  const items = me.care || [];
  if (!items.length) {
    const ideas = careTemplates(me.petType);
    main.innerHTML = `
      <section class="card care-setup">
        <div class="care-hero">${icon('care', 'big')}</div>
        <h1>Set up ${pet}'s needs</h1>
        <p class="muted">Pick what ${pet} needs and when. PetPost makes a checklist for each day and reminds you when it is time.</p>
        <form data-form="care-setup" class="stack">
          <ul class="care-pick">
            ${ideas.map((n, i) => `
              <li><label>
                <input type="checkbox" name="pick" value="${i}" checked>
                <span class="care-ic ${n.kind}">${icon(CARE_KINDS[n.kind][0])}</span>
                <span class="care-text"><strong>${esc(n.name)}</strong><span class="muted small">${scheduleText(n)}</span></span>
              </label></li>`).join('')}
          </ul>
          <p class="muted small">You can change the times and add more afterwards.</p>
          <div class="row wrap">
            <button class="btn primary">${icon('check')}Add these needs</button>
            <button type="button" class="btn ghost" data-action="care-new">${icon('plus')}Make my own</button>
          </div>
        </form>
      </section>`;
    return;
  }

  const today = todaysCare();
  const done = today.filter(n => n.doneAt).length;
  const pct = today.length ? Math.round(done / today.length * 100) : 100;
  const upcoming = upcomingCare();
  const perm = Native.on ? (nativeRemindersOn ? 'granted' : 'default') : 'Notification' in window ? Notification.permission : 'unsupported';
  main.innerHTML = `
    <section class="card care-head">
      <div class="row">
        <div>
          <h1>${pet}'s care</h1>
          <p class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
        <span class="spacer"></span>
        <div class="ring" style="--pct:${pct}"><span>${done}/${today.length}</span></div>
      </div>
      <p class="care-summary">${!today.length ? `Nothing scheduled for today.` : done === today.length ? `All done for today. ${pet} is well looked after.` : `${today.length - done} left today${today.some(n => n.overdue) ? `, ${today.filter(n => n.overdue).length} overdue` : ''}.`}</p>
      <div class="row wrap">
        ${perm === 'granted'
          ? `<span class="chip on">${icon('bell')}Reminders on</span>`
          : perm === 'unsupported' ? '' : `<button class="btn ghost sm" data-action="care-notify">${icon('bell')}Turn on reminders</button>`}
        <button class="btn ghost sm daybloom-btn" data-action="care-daybloom">${icon('calendar')}Send to Daybloom</button>
        <button class="btn primary sm" data-action="care-new">${icon('plus')}New need</button>
      </div>
      <p class="muted small care-note">${Native.on
        ? 'Reminders go off on your iPhone at each time, even when PetPost is closed.'
        : 'Reminders pop up while PetPost is open. Send them to Daybloom to get them even when PetPost is closed.'}</p>
    </section>

    <h2 class="section-title">Today</h2>
    <section class="card care-list-card">
      ${today.length ? `<ul class="care-list">${today.map(careRow).join('')}</ul>` : `<p class="muted">No needs scheduled for today.</p>`}
    </section>

    ${upcoming.length ? `
      <h2 class="section-title">Coming up</h2>
      <section class="card care-list-card">
        <ul class="care-list">${upcoming.slice(0, 6).map(({ n, d }) => `
          <li class="care-row">
            <span class="care-ic ${n.kind}">${icon(CARE_KINDS[n.kind][0])}</span>
            <div class="care-text"><strong>${esc(n.name)}</strong><span class="muted small">${d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} at ${fmtTime(n.time)}</span></div>
          </li>`).join('')}</ul>
      </section>` : ''}

    <h2 class="section-title">All of ${pet}'s needs</h2>
    <section class="card care-list-card">
      <ul class="care-list">
        ${[...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time)).map(n => `
          <li class="care-row">
            <span class="care-ic ${n.kind}">${icon(CARE_KINDS[n.kind][0])}</span>
            <div class="care-text"><strong>${esc(n.name)}</strong><span class="muted small">${scheduleText(n)}${n.note ? ` · ${esc(n.note)}` : ''}</span></div>
            <button class="icon-btn" data-action="care-edit" data-id="${n.id}" aria-label="Edit ${esc(n.name)}">${icon('edit')}</button>
          </li>`).join('')}
      </ul>
    </section>`;
}

forms['care-setup'] = async (form, fd) => {
  const ideas = careTemplates(me.petType);
  const picks = fd.getAll('pick').map(Number);
  if (!picks.length) return toast('Pick at least one, or tap Make my own.');
  me.care = picks.map(i => ({ id: db.uid(), ...ideas[i], note: '' }));
  await saveMe();
  syncNativeCare(true);
  toast(`${picks.length} needs added`);
  route();
};

actions['care-toggle'] = async el => {
  const key = dayKey();
  me.careLog ||= {};
  const log = (me.careLog[key] ||= {});
  if (log[el.dataset.id]) delete log[el.dataset.id];
  else log[el.dataset.id] = Date.now();
  // Keep about two months of history.
  for (const k of Object.keys(me.careLog)) if (k < dayKey(shiftDay(new Date(), -60))) delete me.careLog[k];
  await saveMe();
  const all = todaysCare();
  if (log[el.dataset.id] && all.every(n => n.doneAt)) toast(`All done for today. ${me.petName || 'Your pet'} says thanks!`);
  viewCare(document.getElementById('view'));
  updateCareBadge();
};

function careDialog(n) {
  const editing = !!n;
  n ||= { name: '', kind: 'food', time: '08:00', repeat: 'daily', days: [], date: dayKey(), note: '' };
  const d = document.createElement('dialog');
  d.className = 'modal care-modal';
  d.innerHTML = `
    <form data-form="care-save" class="stack" data-id="${editing ? n.id : ''}" novalidate>
      <header class="row"><h2>${editing ? 'Edit need' : 'New need'}</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
      <label class="field"><span>What does ${esc(me.petName || 'your pet')} need?</span><input name="name" maxlength="50" value="${esc(n.name)}" placeholder="Breakfast, evening walk, vet checkup"></label>
      <div class="field"><span>Type</span>
        <div class="chips">${Object.entries(CARE_KINDS).map(([k, [ic, label]]) => `
          <label class="chip pick-radio"><input type="radio" name="kind" value="${k}" ${n.kind === k ? 'checked' : ''}>${icon(ic)}${label}</label>`).join('')}</div>
      </div>
      <div class="two">
        <label class="field"><span>Time</span><input type="time" name="time" value="${n.time}"></label>
        <label class="field"><span>Repeats</span>
          <select name="repeat">
            ${[['daily', 'Every day'], ['weekly', 'On certain days'], ['monthly', 'Once a month'], ['once', 'Just once']].map(([v, l]) => `<option value="${v}" ${n.repeat === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="field care-days" ${n.repeat === 'weekly' ? '' : 'hidden'}><span>Which days?</span>
        <div class="chips">${WEEKDAYS.map((w, i) => `<label class="chip pick-radio"><input type="checkbox" name="days" value="${i}" ${(n.days || []).includes(i) ? 'checked' : ''}>${w}</label>`).join('')}</div>
      </div>
      <label class="field care-date" ${n.repeat === 'monthly' || n.repeat === 'once' ? '' : 'hidden'}><span class="care-date-label">${n.repeat === 'once' ? 'Date' : 'Starting on (repeats on this day each month)'}</span><input type="date" name="date" value="${n.date || dayKey()}"></label>
      <label class="field"><span>Note <small class="muted">optional</small></span><input name="note" maxlength="80" value="${esc(n.note || '')}" placeholder="1 cup of kibble, half a pill"></label>
      <p class="form-error" role="alert"></p>
      <div class="row">
        ${editing ? `<button type="button" class="btn ghost danger" data-action="care-delete" data-id="${n.id}">${icon('trash')}Delete</button>` : ''}
        <span class="spacer"></span>
        <button type="button" class="btn ghost" data-action="close-dialog">Cancel</button>
        <button class="btn primary">Save</button>
      </div>
    </form>`;
  document.body.append(d);
  const repeat = d.querySelector('select[name="repeat"]');
  repeat.addEventListener('change', () => {
    d.querySelector('.care-days').hidden = repeat.value !== 'weekly';
    d.querySelector('.care-date').hidden = !['monthly', 'once'].includes(repeat.value);
    d.querySelector('.care-date-label').textContent = repeat.value === 'once' ? 'Date' : 'Starting on (repeats on this day each month)';
  });
  d.addEventListener('close', () => d.remove());
  d.showModal();
}

actions['care-new'] = () => careDialog(null);
actions['care-edit'] = el => careDialog((me.care || []).find(n => n.id === el.dataset.id));

forms['care-save'] = async (form, fd) => {
  const name = String(fd.get('name') || '').trim();
  const repeat = fd.get('repeat');
  const days = fd.getAll('days').map(Number);
  const time = fd.get('time');
  if (!name) return formError(form, 'Give this need a name, like "Breakfast".');
  if (!time) return formError(form, 'Choose a time.');
  if (repeat === 'weekly' && !days.length) return formError(form, 'Pick at least one day.');
  if ((repeat === 'once' || repeat === 'monthly') && !fd.get('date')) return formError(form, 'Choose a date.');
  const item = { id: form.dataset.id || db.uid(), name, kind: fd.get('kind') || 'other', time, repeat, days, date: fd.get('date') || dayKey(), note: String(fd.get('note') || '').trim() };
  me.care ||= [];
  const i = me.care.findIndex(n => n.id === item.id);
  if (i >= 0) me.care[i] = item; else me.care.push(item);
  await saveMe();
  form.closest('dialog').close();
  syncNativeCare(true);
  toast(i >= 0 ? 'Need updated' : 'Need added');
  if (parts()[0] === 'care') viewCare(document.getElementById('view')); else go('#/care');
  updateCareBadge();
};

actions['care-delete'] = async el => {
  if (!confirm('Delete this need?')) return;
  me.care = (me.care || []).filter(n => n.id !== el.dataset.id);
  await saveMe();
  el.closest('dialog').close();
  syncNativeCare();
  toast('Need deleted');
  route();
};

// In the iPhone app every need is scheduled as a repeating phone notification.
let nativeRemindersOn = false;
function syncNativeCare(ask = false) {
  if (!Native.on) return;
  Native.send({ type: 'care', items: me ? me.care || [] : [], pet: me?.petName || 'Your pet', ask });
}
window.petpostNativeReminders = allowed => {
  const changed = nativeRemindersOn !== allowed;
  nativeRemindersOn = allowed;
  if (changed && parts()[0] === 'care') viewCare(document.getElementById('view'));
};

actions['care-notify'] = async () => {
  if (Native.on) {
    syncNativeCare(true);
    toast('If reminders stay off, turn on notifications for PetPost in the iPhone Settings app.');
    return;
  }
  const result = await Notification.requestPermission();
  toast(result === 'granted' ? 'Reminders on. They pop up while PetPost is open.' : 'Reminders were not allowed. You can still use Add to calendar.');
  if (parts()[0] === 'care') viewCare(document.getElementById('view'));
};

// Sends every need to Daybloom (the schedule app) as events with reminders.
// Daybloom repeats weekly events on one weekday, so a need on several days becomes one event per day.
const DAYBLOOM_URL = 'https://vibe331212.github.io/daybloom/';
const DAYBLOOM_COLORS = { food: '#f59e0b', walk: '#22c55e', water: '#3b82f6', meds: '#ec4899', groom: '#7c5cff', play: '#14b8a6', vet: '#ef4444', other: '#94a3b8' };

function careForDaybloom() {
  const pet = me.petName || 'Pet', today = dayKey();
  const nextWeekday = wd => { const d = new Date(); d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7)); return dayKey(d); };
  return (me.care || []).flatMap(n => {
    const base = { title: `${pet}: ${n.name}`, time: n.time, remind: '0', private: true,
      color: DAYBLOOM_COLORS[n.kind] || DAYBLOOM_COLORS.other, notes: [n.note, 'Added from PetPost'].filter(Boolean).join('\n') };
    if (n.repeat === 'daily') return [{ ...base, date: today, repeat: 'daily' }];
    if (n.repeat === 'weekly') return (n.days || []).map(d => ({ ...base, date: nextWeekday(d), repeat: 'weekly' }));
    if (n.repeat === 'monthly') return [{ ...base, date: n.date, repeat: 'monthly' }];
    return n.date >= today ? [{ ...base, date: n.date, repeat: 'none' }] : [];
  });
}

actions['care-daybloom'] = () => {
  const events = careForDaybloom();
  if (!events.length) return toast('Add a need first, then send it to Daybloom.');
  const json = JSON.stringify({ from: 'PetPost', events });
  const payload = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.open(`${DAYBLOOM_URL}?import=${payload}`, '_blank', 'noopener');
  toast(`Opening Daybloom with ${events.length} ${events.length === 1 ? 'event' : 'events'}`);
};

// While the app is open, check every 30 seconds for needs that just came due.
const remindedToday = new Set();
async function checkCareReminders() {
  if (!me?.care?.length) return;
  const now = nowMinutes();
  for (const n of todaysCare()) {
    const key = `${dayKey()}:${n.id}`;
    const due = minutesOf(n.time);
    if (n.doneAt || remindedToday.has(key) || now < due || now - due > 30) continue;
    remindedToday.add(key);
    const title = /time$/i.test(n.name) ? n.name : `Time for ${n.name.toLowerCase()}`;
    const body = `${me.petName || 'Your pet'} is counting on you${n.note ? ` · ${n.note}` : ''}`;
    toast(`${title}. ${body}`);
    if ('Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      const options = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: key };
      if (reg) reg.showNotification(title, options); else if (!Native.on) new Notification(title, options);
    }
  }
  updateCareBadge();
}
setInterval(checkCareReminders, 30000);

function updateCareBadge() {
  const item = document.querySelector('.nav-item[href="#/care"]');
  if (!item || !me) return;
  const overdue = todaysCare().filter(n => n.overdue).length;
  item.classList.toggle('has-badge', overdue > 0);
  item.dataset.badge = overdue || '';
}

// ---------- modes
function viewModes(main) {
  main.innerHTML = `
    <section class="card">
      <h1>Modes</h1>
      <p class="muted">Choose a world for PetPost. It is saved to your profile and comes back when you sign in.</p>
    </section>
    <div class="modes">
      ${THEMES.map(t => `
        <button class="mode ${t.id === me.theme ? 'active' : ''}" data-action="set-mode" data-id="${t.id}" aria-pressed="${t.id === me.theme}">
          <canvas width="320" height="200" data-preview="${t.id}"></canvas>
          <span class="mode-text"><strong>${t.name}</strong><small>${t.desc}</small></span>
          ${t.id === me.theme ? `<span class="badge">${icon('check')}</span>` : ''}
        </button>`).join('')}
    </div>`;
  main.querySelectorAll('canvas[data-preview]').forEach(c => renderPreview(findTheme(c.dataset.preview), c));
}

actions['set-mode'] = async el => {
  me.theme = el.dataset.id;
  await saveMe();
  applyTheme(me.theme);
  viewModes(document.getElementById('view'));
  toast(`${findTheme(me.theme).name} mode on`);
};

// ---------- install as an app
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
addEventListener('appinstalled', () => { installPrompt = null; document.querySelector('.install-chip')?.remove(); toast('PetPost is on your home screen'); });

function isInstalled() {
  return Native.on || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

actions.install = async () => {
  if (installPrompt) {
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    if (outcome === 'accepted') document.querySelector('.install-chip')?.remove();
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const steps = ios
    ? ['Tap the <strong>Share</strong> button at the bottom of Safari (the square with an arrow).', 'Scroll down and tap <strong>Add to Home Screen</strong>.', 'Tap <strong>Add</strong>. PetPost now opens like any other app.']
    : /android/i.test(navigator.userAgent)
      ? ['Tap the <strong>three dots</strong> menu in Chrome.', 'Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.', 'Tap <strong>Install</strong>.']
      : ['In Safari, open the <strong>File</strong> menu and choose <strong>Add to Dock</strong>.', 'In Chrome or Edge, click the <strong>install</strong> icon at the right end of the address bar.', 'PetPost then opens in its own window, like any other app.'];
  const d = document.createElement('dialog');
  d.className = 'modal install-modal';
  d.innerHTML = `
    <div class="install-head"><img src="icons/icon-192.png" alt="" width="64" height="64"><div><h2>Install PetPost</h2><p class="muted">Get the app on your ${ios || /android/i.test(navigator.userAgent) ? 'home screen' : 'computer'}.</p></div></div>
    <ol class="install-steps">${steps.map(t => `<li>${t}</li>`).join('')}</ol>
    <button class="btn primary block" data-action="close-dialog">Got it</button>`;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};

// ---------- boot
(async function boot() {
  try {
    me = await auth.currentUser();
    if (me) { await refreshBlocked(); syncPush(); }
  } catch (err) {
    console.error(err);
  }
  applyTheme(me?.theme || 'clean');
  addEventListener('hashchange', route);
  await route();
  $app.dataset.started = '1';
  syncNativeCare();
  if ('serviceWorker' in navigator && !Native.on) setUpUpdates();
})();

// ---------- if your account is deleted elsewhere (or by a clean-up), go back to sign in
function accountGone() {
  if (!me) return;
  me = null;
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  syncNativeCare();
  applyTheme('clean');
  history.replaceState(null, '', location.pathname);
  renderAuth('signup');
  toast('That account no longer exists. Make a new one to keep using PetPost.');
}
window.addEventListener('petpost:account-gone', accountGone);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && me && !(await db.stillSignedIn())) accountGone();
});

// ---------- automatic updates
// Checks for a new version on launch and whenever the app comes back to the front.
// When one arrives it reloads, unless you are in the middle of something, then it offers a button.
function setUpUpdates() {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    // Look for a newer version often (but at most once a minute), so a screen left open still updates.
    let lastCheck = 0;
    const check = () => {
      if (Date.now() - lastCheck < 60 * 1000) return;
      lastCheck = Date.now();
      reg.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    ['hashchange', 'focus', 'pageshow'].forEach(type => window.addEventListener(type, check, true));
    setInterval(check, 5 * 60 * 1000);
  }).catch(err => console.warn('Offline mode unavailable', err));

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return; // first install, nothing old to replace
    const busy = draft?.file || draft?.busy || document.querySelector('dialog[open]') || viewer;
    if (!busy) { reloading = true; location.reload(); return; }
    if (document.querySelector('.update-bar')) return;
    const bar = document.createElement('button');
    bar.className = 'update-bar';
    bar.innerHTML = `${icon('download')}<span>PetPost was updated. Tap to refresh.</span>`;
    bar.onclick = () => location.reload();
    document.body.append(bar);
  });
}
