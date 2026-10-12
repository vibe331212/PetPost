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
const saveMe = () => db.put('users', me);

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
  if (!media) return;
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
  if (!me) return renderAuth();
  if (!me.cameraAsked) return renderPermission();
  const [view = 'feed', a, b] = parts();
  const views = { feed: viewFeed, create: viewCreate, post: viewPost, profile: viewProfile, goals: viewGoals, modes: viewModes, care: viewCare, people: viewPeople, notifications: viewNotifications };
  const fn = views[view] || viewFeed;
  if (draft && view !== 'create') resetDraft();
  shell(views[view] ? view : 'feed', a);
  const main = document.getElementById('view');
  try {
    await fn(main, a, b);
    updateCareBadge();
    updateBell();
  } catch (err) {
    console.error(err);
    main.innerHTML = `<div class="card empty"><p>Something went wrong: ${esc(err.message)}</p></div>`;
  }
  window.scrollTo(0, 0);
}

function shell(active, arg) {
  const tab = (id, ic, label, href, on = active === id) =>
    `<a href="${href}" class="nav-item ${on ? 'active' : ''}" ${on ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`;
  $app.innerHTML = `
    <header class="topbar">
      <a href="#/feed" class="brand">${icon('paw')}<span>PetPost</span></a>
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
        <label class="field"><span>Your name</span><input name="displayName" autocomplete="name" maxlength="40" required></label>
        <label class="field"><span>Username</span><input name="username" autocomplete="username" required maxlength="24" autocapitalize="off" spellcheck="false" placeholder="eli_the_goat"><small class="username-hint muted">No spaces. Letters, numbers, _ and .</small></label>
      </div>
      <div class="two">
        <label class="field"><span>Pet's name</span><input name="petName" maxlength="40" required></label>
        <label class="field"><span>Pet type</span>
          <select name="petType">${PET_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
        </label>
      </div>
      <p class="sound-hint muted small">${soundHint('Dog')}</p>
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
  return `Comments will be called ${s.words}, like "${s.word} back..."`;
}
document.addEventListener('input', e => {
  if (e.target.name !== 'username' || !e.target.closest('form[data-form="signup"]')) return;
  const cleaned = auth.cleanUsername(e.target.value);
  const hint = e.target.parentElement.querySelector('.username-hint');
  if (hint) hint.textContent = cleaned ? `Your username will be @${cleaned}` : 'No spaces. Letters, numbers, _ and .';
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
  if (p.mediaType === 'video') {
    return `<video src="${src}#t=0.001" controls playsinline preload="metadata" ${autoplay ? 'autoplay' : ''} loop></video>`;
  }
  return `<img src="${src}" alt="Photo shared by ${esc(p.author)}" loading="lazy">`;
}

function postCard(p, author) {
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
          <a href="#/profile/${esc(author.username)}" class="name">${esc(author.displayName)}</a>
          <span class="sub">@${esc(author.username)}${author.petName ? ` · ${esc(author.petName)}` : ''} · ${ago(p.createdAt)}</span>
        </div>
        ${own ? `<button class="icon-btn" data-action="delete-post" data-id="${p.id}" aria-label="Delete post">${icon('trash')}</button>`
              : `<button class="icon-btn" data-action="report" data-post="${p.id}" data-user="${esc(p.author)}" aria-label="Report post" title="Report">${icon('flag')}</button>`}
      </header>
      <div class="media">${mediaEl(p)}<span class="lick-burst">${icon('lick')}</span></div>
      <div class="actions">
        <button class="act lick ${licked ? 'on' : ''}" data-action="lick" data-id="${p.id}" aria-pressed="${licked}">${icon('lick')}<span class="count">${n}</span><span class="lbl">${plural(n, 'Lick')}</span></button>
        <a class="act" href="#/post/${p.id}">${icon('bark')}<span class="count bark-count">${b}</span><span class="lbl">${countLabel(b, me.petType)}</span></a>
        <button class="act" data-action="share" data-id="${p.id}">${icon('share')}<span class="lbl">Share</span></button>
        <span class="spacer"></span>
        <button class="act" data-action="download" data-id="${p.id}" aria-label="Save to device" title="Save to device">${icon('download')}</button>
        <button class="act save ${saved ? 'on' : ''}" data-action="save" data-id="${p.id}" aria-pressed="${saved}" aria-label="Save post" title="Save">${icon('bookmark')}</button>
      </div>
      ${p.goalTitle ? `<a class="goal-tag" href="#/profile/${esc(p.author)}/goals">${icon('goal')}${esc(p.goalTitle)}</a>` : ''}
      ${p.caption ? `<p class="caption"><strong>${esc(author.displayName)}</strong> ${esc(p.caption)}</p>` : ''}
    </article>`;
}

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
  posts.filter(p => p.kind === 'moment' && p.expiresAt <= now && p.author === me.username).forEach(p => deletePost(p.id));

  const groups = new Map();
  posts.filter(p => p.kind === 'moment' && p.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach(m => { if (!groups.has(m.author)) groups.set(m.author, []); groups.get(m.author).push(m); });
  momentGroups = [...groups.entries()]
    .map(([u, list]) => ({ user: users.get(u) || { username: u, displayName: u }, list }))
    .sort((a, b) => (b.user.username === me.username) - (a.user.username === me.username) || b.list.at(-1).createdAt - a.list.at(-1).createdAt);

  main.innerHTML = `
    <section class="card moments" aria-label="Moments">
      <a class="moment-bubble" href="#/create/moment"><span class="ring add">${icon('plus')}</span><span class="mb-name">Add moment</span></a>
      ${momentGroups.map((g, i) => `
        <button class="moment-bubble" data-action="open-moments" data-index="${i}">
          <span class="ring">${avatar(g.user, 'lg')}</span>
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

function feedMode() {
  try { return localStorage.getItem('petpost.feed') === 'following' ? 'following' : 'all'; } catch { return 'all'; }
}
actions['feed-mode'] = el => {
  try { localStorage.setItem('petpost.feed', el.dataset.mode); } catch { /* remembered for this visit only */ }
  viewFeed(document.getElementById('view'));
};

// ---------- moments viewer
actions['open-moments'] = el => openViewer(+el.dataset.index);

function openViewer(gi) {
  closeViewer();
  const el = document.createElement('div');
  el.className = 'viewer';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Moments');
  document.body.append(el);
  viewer = { el, gi, i: 0, raf: 0 };
  document.addEventListener('keydown', viewerKeys);
  showMoment();
}

function viewerKeys(e) {
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowRight') stepMoment(1);
  if (e.key === 'ArrowLeft') stepMoment(-1);
}

function closeViewer() {
  if (!viewer) return;
  cancelAnimationFrame(viewer.raf);
  viewer.el.remove();
  viewer = null;
  document.removeEventListener('keydown', viewerKeys);
}

function showMoment() {
  const g = momentGroups[viewer.gi];
  if (!g) return closeViewer();
  const m = g.list[viewer.i];
  cancelAnimationFrame(viewer.raf);
  viewer.el.innerHTML = `
    <div class="viewer-inner">
      <div class="bars">${g.list.map((_, k) => `<span><i style="width:${k < viewer.i ? 100 : 0}%"></i></span>`).join('')}</div>
      <header>
        ${avatar(g.user, 'sm')}
        <strong>${esc(g.user.displayName)}</strong><span class="muted-light">${ago(m.createdAt)}</span>
        <span class="spacer"></span>
        ${m.author === me.username ? `<button class="icon-btn light" data-action="delete-moment" data-id="${m.id}" aria-label="Delete moment">${icon('trash')}</button>` : ''}
        <button class="icon-btn light" data-action="close-viewer" aria-label="Close">${icon('close')}</button>
      </header>
      <div class="viewer-media">${m.mediaType === 'video'
        ? `<video src="${blobURL(m.id, m.media)}" playsinline autoplay></video>`
        : `<img src="${blobURL(m.id, m.media)}" alt="Moment from ${esc(g.user.displayName)}">`}</div>
      ${m.caption ? `<p class="viewer-cap">${esc(m.caption)}</p>` : ''}
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
    const start = performance.now();
    const tick = now => {
      const f = Math.min(1, (now - start) / 5000);
      bar.style.width = `${f * 100}%`;
      if (f >= 1) stepMoment(1); else viewer.raf = requestAnimationFrame(tick);
    };
    viewer.raf = requestAnimationFrame(tick);
  }
}

function stepMoment(dir) {
  if (!viewer) return;
  const g = momentGroups[viewer.gi];
  viewer.i += dir;
  if (viewer.i >= g.list.length) { viewer.gi++; viewer.i = 0; }
  else if (viewer.i < 0) {
    viewer.gi--;
    if (viewer.gi < 0) { viewer.gi = 0; viewer.i = 0; }
    else viewer.i = momentGroups[viewer.gi].list.length - 1;
  }
  if (viewer.gi >= momentGroups.length) return closeViewer();
  showMoment();
}

actions['moment-next'] = () => stepMoment(1);
actions['moment-prev'] = () => stepMoment(-1);
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
        <p><a class="name" href="#/profile/${esc(c.author)}">${esc(author?.displayName || c.author)}</a> <span class="sub">${soundFor(author?.petType).past} · ${ago(c.createdAt)}</span></p>
        <p>${esc(c.text)}</p>
      </div>
      ${canDelete ? `<button class="icon-btn sm" data-action="delete-bark" data-id="${c.id}" data-post="${post.id}" aria-label="Delete comment">${icon('trash')}</button>` : ''}
    </div>`;
}

async function viewPost(main, id) {
  const p = await db.get('posts', id);
  if (!p) { main.innerHTML = `<div class="card empty"><p>This post is no longer here.</p><a class="btn ghost" href="#/feed">Back to feed</a></div>`; return; }
  const users = await usersMap();
  const barks = (await db.byIndex('comments', 'postId', id)).filter(c => !blockedSet.has(c.author)).sort((a, b) => a.createdAt - b.createdAt);
  const sound = soundFor(me.petType);
  main.innerHTML = `
    <button class="back" data-action="back">${icon('back')}Back</button>
    ${postCard(p, users.get(p.author))}
    <section class="card barks">
      <h2>${sound.words}</h2>
      <div class="bark-list">
        ${barks.length ? barks.map(c => barkRow(c, users.get(c.author), p)).join('') : `<p class="muted no-barks">No ${sound.words.toLowerCase()} yet. Start the conversation.</p>`}
      </div>
      <form data-form="bark" data-id="${p.id}" class="bark-form">
        ${avatar(me, 'sm')}
        <input name="text" maxlength="400" placeholder="${sound.word} back..." required autocomplete="off" aria-label="Write a comment">
        <button class="btn primary sm">${sound.word}</button>
      </form>
    </section>`;
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
  const box = document.querySelector('.bark-list');
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
  moment: 'A photo or short video that disappears after 24 hours.',
};

async function viewCreate(main, arg) {
  const goals = (await db.byIndex('goals', 'owner', me.username)).filter(g => !g.completedAt);
  const goalId = arg?.startsWith('goal-') ? arg.slice(5) : '';
  const goal = goals.find(g => g.id === goalId);
  draft = { kind: arg === 'moment' ? 'moment' : 'photo', file: null, result: null, busy: false, previewURL: null };
  main.innerHTML = `
    <section class="card create">
      <h1>New post</h1>
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
  input.addEventListener('change', () => input.files[0] && handleFile(input.files[0]));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
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
}

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
  if (file && draft && document.querySelector('.create')) handleFile(file);
};

function resetDraft() {
  if (draft?.previewURL) URL.revokeObjectURL(draft.previewURL);
  if (draft) { draft.result = null; draft.previewURL = null; draft.file = null; draft.baseBlob = null; draft.stickers = []; }
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
    showResult(root);
  } catch (err) {
    console.error(err);
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
  root.querySelector('.stage').innerHTML = `
    <div class="preview">${r.type === 'video'
      ? `<video src="${draft.previewURL}#t=0.001" controls playsinline autoplay loop muted></video>`
      : `<img src="${draft.previewURL}" alt="Preview">`}</div>
    ${r.type === 'image' ? `<button type="button" class="btn ghost sticker-btn" data-action="stickers">${icon('sparkle')}${count ? `Edit stickers (${count})` : 'Add stickers'}</button>` : ''}`;
  root.querySelector('.publish').hidden = false;
}

actions.stickers = async () => {
  if (!draft?.baseBlob || draft.busy) return;
  const out = await openStickerEditor(draft.baseBlob, draft.stickers, soundFor(me.petType).word);
  if (!out || !draft) return;
  draft.stickers = out.stickers;
  draft.result = { ...draft.result, blob: out.blob };
  const root = document.querySelector('.create');
  if (root) showResult(root);
};

forms.publish = async (form, fd) => {
  if (!draft?.result || draft.busy) return;
  const btn = form.querySelector('button.primary');
  btn.disabled = true;
  const goal = fd.get('goal') ? await db.get('goals', fd.get('goal')) : null;
  const now = Date.now();
  const isMoment = draft.kind === 'moment';
  const post = {
    id: db.uid(),
    author: me.username,
    kind: isMoment ? 'moment' : draft.result.type === 'video' ? 'video' : 'photo',
    mediaType: draft.result.type,
    media: draft.result.blob,
    caption: String(fd.get('caption') || '').trim(),
    licks: [],
    barkCount: 0,
    report: draft.result.report,
    goalId: goal?.id || null,
    goalTitle: goal?.title || null,
    createdAt: now,
    expiresAt: isMoment ? now + MOMENT_TTL : null,
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

// ---------- profile
async function viewProfile(main, username = me.username, tab = 'posts') {
  const u = username === me.username ? me : await db.get('users', username);
  if (!u) { main.innerHTML = `<div class="card empty"><p>That profile does not exist.</p></div>`; return; }
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
  const [mine, goals] = await Promise.all([db.byIndex('posts', 'author', u.username), db.byIndex('goals', 'owner', u.username)]);
  const posts = mine.filter(p => p.kind !== 'moment').sort((a, b) => b.createdAt - a.createdAt);
  const allUsers = await db.all('users');
  const followers = allUsers.filter(x => (x.following || []).includes(u.username)).length;
  const followingCount = (u.following || []).length;
  const iFollow = (me.following || []).includes(u.username);

  let content = '';
  if (tab === 'trophies') {
    content = trophies.length
      ? `<div class="trophies">${trophies.map((t, i) => trophyCard(t, i, own, u)).reverse().join('')}</div>`
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
          <a class="tile" href="#/post/${p.id}" aria-label="Open post">
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
        <h1>${esc(u.displayName)}</h1>
        <p class="muted">@${esc(u.username)}</p>
        ${u.petName ? `<p class="pet">${icon('paw')}${esc(u.petName)}${u.petType ? ` <span class="muted">· ${esc(u.petType)}</span>` : ''}</p>` : ''}
        ${u.bio ? `<p class="bio">${esc(u.bio)}</p>` : ''}
      </div>
      <div class="stats four">
        <div><strong>${posts.length}</strong><span>${plural(posts.length, 'Post')}</span></div>
        <button data-action="follow-list" data-user="${esc(u.username)}" data-kind="followers"><strong>${followers}</strong><span>${followers === 1 ? 'Follower' : 'Followers'}</span></button>
        <button data-action="follow-list" data-user="${esc(u.username)}" data-kind="following"><strong>${followingCount}</strong><span>Following</span></button>
        <div><strong>${trophies.length}</strong><span>${trophies.length === 1 ? 'Trophy' : 'Trophies'}</span></div>
      </div>
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
    <nav class="tabs">${tabLink('posts', 'Posts')}${tabLink('videos', 'Videos')}${own ? tabLink('saved', 'Saved') : ''}${tabLink('goals', 'Goals')}${tabLink('trophies', 'Trophies')}</nav>
    <section class="tab-body">${content}</section>`;
}

actions['edit-profile'] = () => {
  if (!me) return;
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = `
    <form data-form="profile" class="stack">
      <header class="row"><h2>Edit profile</h2><span class="spacer"></span><button type="button" class="icon-btn" data-action="close-dialog" aria-label="Close">${icon('close')}</button></header>
      <div class="avatar-edit">${avatar(me, 'xl')}<label class="btn ghost sm">${icon('photo')}Change photo<input type="file" name="avatar" accept="image/*" hidden></label></div>
      <div class="two">
        <label class="field"><span>Your name</span><input name="displayName" maxlength="40" value="${esc(me.displayName)}" required></label>
        <label class="field"><span>Pet's name</span><input name="petName" maxlength="40" value="${esc(me.petName)}"></label>
      </div>
      <label class="field"><span>Pet type</span><select name="petType">${[...new Set([...PET_TYPES, me.petType].filter(Boolean))].map(t => `<option ${t === me.petType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <p class="sound-hint muted small">${soundHint(me.petType)}</p>
      <label class="field"><span>Bio</span><textarea name="bio" maxlength="200" rows="3">${esc(me.bio)}</textarea></label>
      <h3 class="form-section">Pet card</h3>
      <div class="two">
        <label class="field"><span>Breed</span><input name="breed" maxlength="40" value="${esc(me.breed || '')}" placeholder="Golden retriever"></label>
        <label class="field"><span>Birthday</span><input type="date" name="birthday" value="${esc(me.birthday || '')}"></label>
      </div>
      <div class="two">
        <label class="field"><span>Favorite treat</span><input name="treat" maxlength="40" value="${esc(me.treat || '')}" placeholder="Peanut butter"></label>
        <label class="field"><span>Favorite toy</span><input name="toy" maxlength="40" value="${esc(me.toy || '')}" placeholder="Squeaky ball"></label>
      </div>
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
      <a class="person-link" href="#/profile/${esc(u.username)}">${avatar(u)}<span class="who"><span class="name">${esc(u.displayName)}</span><span class="sub">@${esc(u.username)}${u.petName ? ` · ${esc(u.petName)}` : ''}${u.petType ? ` · ${esc(u.petType)}` : ''}</span></span></a>
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
      ${['Spam', 'Mean or bullying', 'Not appropriate', 'Hurting an animal', 'Something else'].map(r => `<button type="button" class="btn ghost block" data-action="report-send" data-reason="${r}">${icon('flag')}${r}</button>`).join('')}
      <button type="button" class="btn ghost block danger" data-action="block-toggle" data-user="${esc(user)}">${icon('block')}${isBlocked ? `Unblock @${esc(user)}` : `Block @${esc(user)}`}</button>
    </div>`;
  d.dataset.post = post || '';
  d.dataset.user = user;
  document.body.append(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
};

actions['report-send'] = async el => {
  const d = el.closest('dialog');
  try {
    await db.report({ postId: d.dataset.post || null, username: d.dataset.user, reason: el.dataset.reason });
    d.close();
    toast('Thanks. Your report was sent.');
  } catch (err) { toast(`Could not send the report: ${err.message}`); }
};

actions['block-toggle'] = async el => {
  const user = el.dataset.user, on = !blockedSet.has(user);
  if (on && !confirm(`Block @${user}? You won't see their posts or comments, and you'll stop following them.`)) return;
  await db.setBlocked(user, on);
  if (on) { me.following = (me.following || []).filter(n => n !== user); blockedSet.add(user); } else blockedSet.delete(user);
  el.closest('dialog').close();
  toast(on ? `Blocked @${user}` : `Unblocked @${user}`);
  route();
};

// ---------- notifications
// Built from what is saved: licks and barks on your posts, new followers, and new posts from people you follow.
async function notifications() {
  const [posts, comments, users] = await Promise.all([db.all('posts'), db.all('comments'), db.all('users')]);
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
  const map = new Map(users.map(u => [u.username, u]));
  return items.filter(n => n.at).sort((a, b) => b.at - a.at).slice(0, 80).map(n => ({ ...n, user: map.get(n.who) || { username: n.who, displayName: n.who } }));
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
    const name = `<strong>${esc(n.user.displayName)}</strong>`;
    if (n.type === 'lick') return `${name} licked your post`;
    if (n.type === 'bark') return `${name} ${soundFor(n.user.petType).past}: “${esc(n.text.length > 80 ? n.text.slice(0, 80) + '…' : n.text)}”`;
    if (n.type === 'follow') return `${name} started following you`;
    return `${name} ${n.post.kind === 'moment' ? 'shared a moment' : n.post.mediaType === 'video' ? 'posted a new video' : 'posted a new photo'}`;
  };
  const iconFor = { lick: 'lick', bark: 'bark', follow: 'userPlus', post: 'photo' };
  main.innerHTML = `
    <section class="card">
      <h1>Notifications</h1>
      <p class="muted">Licks and ${esc(soundFor(me.petType).words.toLowerCase())} on your posts, new followers, and new posts from people you follow.</p>
    </section>
    <section class="card notif-card">
      ${list.length ? `<ul class="notifs">${list.map(n => {
        const href = n.type === 'follow' ? `#/profile/${esc(n.who)}` : n.post.kind === 'moment' ? '#/feed' : `#/post/${n.post.id}`;
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
  me.notifSeen = Date.now();
  await saveMe();
  updateBell();
}

// ---------- pet card
async function petCard(u) {
  const goals = await db.byIndex('goals', 'owner', u.username);
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
    line: [u.petType, u.breed].filter(Boolean).join(' · '),
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
  const goals = (await db.byIndex('goals', 'owner', me.username)).sort((a, b) => b.createdAt - a.createdAt);
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
  await db.put('goals', { id: db.uid(), owner: me.username, title, steps, target: fd.get('target') || null, createdAt: Date.now(), completedAt: null });
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
  if (t.kind === 'streak') return `${own ? 'You' : t.ownerName || 'They'} trained ${t.petName || 'your pet'} ${t.days} days in a row!`;
  const rest = t.title.replace(/^teach\s+/i, '');
  const said = rest === t.title ? `reached the goal "${t.title}"` : `taught ${rest}`;
  return `${own ? 'You' : t.ownerName || 'They'} ${said}!`;
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
function trophyCard(t, i, own, u) {
  const [tier, tierName] = t.kind === 'streak' ? ['streak', `${t.days}-day streak`] : TROPHY_TIERS[i % 3];
  return `
    <article class="card trophy ${tier}">
      <div class="trophy-icon">${icon(t.kind === 'streak' ? 'flame' : 'trophy')}</div>
      <div class="trophy-body">
        <span class="trophy-num">${tierName} · Trophy #${i + 1}</span>
        <h3>${esc(trophyHeadline({ ...t, ownerName: u.displayName }, own))}</h3>
        <p class="muted small">${t.kind === 'streak' ? 'Streak reached' : 'Goal reached'} ${fmtDate(t.earnedAt)}${t.steps ? ` · ${t.steps} ${t.steps === 1 ? 'step' : 'steps'}` : ''}</p>
      </div>
    </article>`;
}

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
  let best = 0, run = 0, prev = null;
  for (const k of [...set].sort()) {
    const d = new Date(`${k}T12:00:00`);
    run = prev && dayKey(shiftDay(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, today: set.has(dayKey(today)) };
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
    const others = (await db.byIndex('goals', 'owner', me.username)).some(x => x.id !== g.id && x.practice?.includes(today));
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
      id: db.uid(), author: me.username, kind: 'photo', mediaType: 'image', media: blob, caption,
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
    if (me) await refreshBlocked();
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
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
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
