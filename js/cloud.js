// PetPost's online data, stored in Supabase so friends on other phones can follow each other.
// It offers the same calls the app used with the on-device database (get, put, del, all, byIndex),
// working with the same shapes: users keyed by username, posts with media, comments and goals.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'petpost.auth' },
});

const BUCKET = 'media';
const email = username => `${username}@users.petpost.app`;
const PUBLIC_FIELDS = ['displayName', 'petName', 'petType', 'bio', 'avatarPath', 'avatarAt', 'trophies', 'practiceDays', 'streakTrophies', 'breed', 'birthday', 'treat', 'toy'];
const PRIVATE_FIELDS = ['saved', 'care', 'careLog', 'notifSeen', 'cameraAsked', 'theme'];
const POST_FIELDS = ['kind', 'mediaType', 'mediaPath', 'mediaMime', 'width', 'height', 'caption', 'report', 'goalId', 'goalTitle', 'expiresAt'];

const pick = (obj, keys) => Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));
const iso = ts => new Date(ts || Date.now()).toISOString();
const ms = t => Date.parse(t) || 0;
export const mediaUrl = path => (path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : null);

function check({ data, error }) {
  if (error) {
    // The account was deleted while this device was still signed in to it.
    if (/(private_data|profiles)_id_fkey|User from sub claim in JWT does not exist/i.test(error.message || '')) accountGone();
    // Licking, commenting on or following someone you blocked, or who blocked you.
    if (/row-level security policy for table "(licks|comments|follows)"/i.test(error.message || '')) throw new Error('That post or account is not available.');
    throw new Error(error.message || 'Something went wrong talking to PetPost');
  }
  return data;
}

// Signs out and tells the app, so it can show the sign-in screen with a clear message.
function accountGone() {
  signOut();
  window.dispatchEvent(new CustomEvent('petpost:account-gone'));
}

// ---------- signed-in person
let myId = null;
let myName = null;
let privateCache = {};
let amAdmin = false;

// ---------- profiles (cached briefly, since almost every screen needs them)
let profileCache = null;
let profileCacheAt = 0;
const nameOf = id => profileCache?.byId.get(id)?.username;
const idOf = name => profileCache?.byName.get(name)?.id;
function invalidate() { profileCacheAt = 0; }

async function loadProfiles(force = false) {
  if (!force && profileCache && Date.now() - profileCacheAt < 4000) return profileCache;
  const [profiles, follows] = await Promise.all([
    sb.from('profiles').select('id,username,data,created_at').then(check),
    sb.from('follows').select('follower,followee,created_at').then(check),
  ]);
  const byId = new Map(profiles.map(p => [p.id, p]));
  const byName = new Map(profiles.map(p => [p.username, p]));
  profileCache = { profiles, follows, byId, byName };
  profileCacheAt = Date.now();
  return profileCache;
}

function toUser(row, follows) {
  const mine = follows.filter(f => f.follower === row.id && profileCache.byId.has(f.followee));
  const user = {
    username: row.username,
    ...row.data,
    avatar: mediaUrl(row.data.avatarPath),
    createdAt: ms(row.created_at),
    following: mine.map(f => nameOf(f.followee)),
    followedAt: Object.fromEntries(mine.map(f => [nameOf(f.followee), ms(f.created_at)])),
  };
  if (row.id === myId) Object.assign(user, { saved: [], ...privateCache });
  return user;
}

// ---------- posts
function toPost(row, licks, commentCounts) {
  const mine = licks.filter(l => l.post_id === row.id);
  return {
    id: row.id,
    author: nameOf(row.author) || 'unknown',
    ...row.data,
    media: mediaUrl(row.data.mediaPath),
    licks: mine.map(l => nameOf(l.user_id)).filter(Boolean),
    lickedAt: Object.fromEntries(mine.map(l => [nameOf(l.user_id), ms(l.created_at)])),
    barkCount: commentCounts.get(row.id) || 0,
    createdAt: ms(row.created_at),
  };
}

async function loadPosts(filter) {
  await loadProfiles();
  let q = sb.from('posts').select('id,author,data,created_at').order('created_at', { ascending: false }).limit(300);
  if (filter?.id) q = q.eq('id', filter.id);
  if (filter?.author) q = q.eq('author', filter.author);
  const rows = check(await q);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [licks, comments] = await Promise.all([
    sb.from('licks').select('post_id,user_id,created_at').in('post_id', ids).then(check),
    sb.from('comments').select('post_id').in('post_id', ids).then(check),
  ]);
  const counts = new Map();
  for (const c of comments) counts.set(c.post_id, (counts.get(c.post_id) || 0) + 1);
  return rows.map(r => toPost(r, licks, counts));
}

const extFor = type => (type.includes('mp4') ? 'mp4' : type.includes('quicktime') ? 'mov' : type.includes('webm') ? 'webm' : type.includes('png') ? 'png' : 'jpg');

async function upload(path, blob) {
  check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false }));
  return path;
}

// ---------- the same calls the app already uses
export const uid = () => crypto.randomUUID();

export async function get(store, key) {
  if (store === 'users') {
    const { byName, follows } = await loadProfiles();
    const row = byName.get(key) || (await loadProfiles(true)).byName.get(key);
    return row ? toUser(row, profileCache.follows || follows) : undefined;
  }
  if (store === 'posts') return (await loadPosts({ id: key }))[0];
  if (store === 'goals') {
    const rows = check(await sb.from('goals').select('id,owner,data,created_at').eq('id', key));
    await loadProfiles();
    return rows[0] ? toGoal(rows[0]) : undefined;
  }
  throw new Error(`Unknown store ${store}`);
}

export async function all(store) {
  if (store === 'users') {
    const { profiles, follows } = await loadProfiles();
    return profiles.map(p => toUser(p, follows));
  }
  if (store === 'posts') return loadPosts();
  if (store === 'comments') {
    await loadProfiles();
    return check(await sb.from('comments').select('id,post_id,author,text,created_at').order('created_at').limit(1000)).map(toComment);
  }
  throw new Error(`Unknown store ${store}`);
}

export async function byIndex(store, index, value) {
  await loadProfiles();
  if (store === 'posts' && index === 'author') {
    const id = idOf(value);
    return id ? loadPosts({ author: id }) : [];
  }
  if (store === 'comments' && index === 'postId') {
    return check(await sb.from('comments').select('id,post_id,author,text,created_at').eq('post_id', value).order('created_at')).map(toComment);
  }
  if (store === 'goals' && index === 'owner') {
    const id = idOf(value);
    return id ? check(await sb.from('goals').select('id,owner,data,created_at').eq('owner', id)).map(toGoal) : [];
  }
  throw new Error(`Unknown index ${store}.${index}`);
}

const toComment = c => ({ id: c.id, postId: c.post_id, author: nameOf(c.author) || 'unknown', text: c.text, createdAt: ms(c.created_at) });
const toGoal = g => ({ id: g.id, owner: nameOf(g.owner), ...g.data, createdAt: ms(g.created_at) });

export async function put(store, value) {
  if (!myId) throw new Error('Please sign in again.');
  if (store === 'users') {
    if (value.username !== myName) return; // you can only change your own profile
    if (value.avatar instanceof Blob) {
      value.avatarPath = await upload(`${myId}/avatar-${Date.now()}.${extFor(value.avatar.type)}`, value.avatar);
      value.avatar = mediaUrl(value.avatarPath);
    }
    privateCache = pick(value, PRIVATE_FIELDS);
    const updated = check(await sb.from('profiles').update({ data: pick(value, PUBLIC_FIELDS) }).eq('id', myId).select('id'));
    if (!updated.length) { accountGone(); throw new Error('This account no longer exists. Please make a new one.'); }
    await Promise.all([
      sb.from('private_data').upsert({ id: myId, data: privateCache }).then(check),
      syncFollows(value),
    ]);
    invalidate();
    return;
  }
  if (store === 'posts') {
    if (value.media instanceof Blob) {
      value.mediaMime = value.media.type || (value.mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
      value.mediaPath = await upload(`${myId}/${value.id}.${extFor(value.mediaMime)}`, value.media);
      check(await sb.from('posts').insert({ id: value.id, author: myId, data: pick(value, POST_FIELDS), created_at: iso(value.createdAt) }));
      value.media = mediaUrl(value.mediaPath);
    } else if (value.author === myName) {
      check(await sb.from('posts').update({ data: pick(value, POST_FIELDS) }).eq('id', value.id));
    }
    // Licks: only your own lick can be added or removed.
    if ((value.licks || []).includes(myName)) {
      check(await sb.from('licks').upsert({ post_id: value.id, user_id: myId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true }));
    } else {
      check(await sb.from('licks').delete().eq('post_id', value.id).eq('user_id', myId));
    }
    return;
  }
  if (store === 'comments') {
    check(await sb.from('comments').insert({ id: value.id, post_id: value.postId, author: myId, text: value.text, created_at: iso(value.createdAt) }));
    return;
  }
  if (store === 'goals') {
    if (value.owner !== myName) return;
    const { id, owner, createdAt, ...data } = value;
    check(await sb.from('goals').upsert({ id, owner: myId, data, created_at: iso(createdAt) }));
    return;
  }
  throw new Error(`Unknown store ${store}`);
}

async function syncFollows(user) {
  const { follows } = await loadProfiles(true);
  const now = new Set(follows.filter(f => f.follower === myId).map(f => f.followee));
  const want = new Set((user.following || []).map(idOf).filter(Boolean));
  const add = [...want].filter(id => !now.has(id)).map(id => ({ follower: myId, followee: id }));
  const remove = [...now].filter(id => !want.has(id));
  if (add.length) check(await sb.from('follows').insert(add));
  if (remove.length) check(await sb.from('follows').delete().eq('follower', myId).in('followee', remove));
}

export async function del(store, key) {
  if (store === 'posts') {
    const post = (await loadPosts({ id: key }))[0];
    if (post?.mediaPath && post.author === myName) await sb.storage.from(BUCKET).remove([post.mediaPath]);
    check(await sb.from('posts').delete().eq('id', key));
  } else if (store === 'comments') {
    check(await sb.from('comments').delete().eq('id', key));
  } else if (store === 'goals') {
    check(await sb.from('goals').delete().eq('id', key));
  } else if (store === 'users') {
    if (key === myName) await deleteAccount();
  } else {
    throw new Error(`Unknown store ${store}`);
  }
  invalidate();
}

// ---------- safety
export async function report({ postId = null, username = null, reason }) {
  check(await sb.from('reports').insert({ reporter: myId, post_id: postId, user_id: username ? idOf(username) : null, reason }));
}
// Reports about your account or posts. Never says who sent them.
export async function reportsAboutMe() {
  if (!myId) return [];
  const { data, error } = await sb.rpc('reports_about_me');
  if (error) return []; // older database without this yet
  return data.map(r => ({ id: r.id, reason: r.reason, createdAt: ms(r.created_at), postId: r.post_id }));
}
export async function blocked() {
  if (!myId) return [];
  await loadProfiles();
  return check(await sb.from('blocks').select('blocked').eq('blocker', myId)).map(b => nameOf(b.blocked)).filter(Boolean);
}
export async function setBlocked(username, on) {
  const id = idOf(username);
  if (!id) return;
  if (on) {
    // The database also stops them following you.
    check(await sb.from('blocks').upsert({ blocker: myId, blocked: id }, { onConflict: 'blocker,blocked', ignoreDuplicates: true }));
    await sb.from('follows').delete().eq('follower', myId).eq('followee', id);
  } else {
    check(await sb.from('blocks').delete().eq('blocker', myId).eq('blocked', id));
  }
  invalidate();
}

// ---------- admins (people who run PetPost and look at reports)
export const isAdmin = () => amAdmin;
export async function adminReports() {
  return check(await sb.rpc('admin_reports')).map(r => ({
    id: r.id, reason: r.reason, createdAt: ms(r.created_at),
    reporter: r.reporter, reportedUser: r.reported_user,
    post: r.post_id ? {
      id: r.post_id, author: r.post_author, ...r.post_data,
      media: mediaUrl(r.post_data?.mediaPath), createdAt: ms(r.post_created_at),
    } : null,
  }));
}
export async function dismissReports(ids) {
  check(await sb.from('reports').delete().in('id', ids));
}
export async function adminDeletePost(postId) {
  check(await sb.rpc('admin_delete_post', { target: postId }));
}

// ---------- accounts
async function loadMe(session) {
  myId = session.user.id;
  const [profile, priv, admin] = await Promise.all([
    sb.from('profiles').select('id,username,data,created_at').eq('id', myId).maybeSingle().then(check),
    sb.from('private_data').select('data').eq('id', myId).maybeSingle().then(check),
    // Before the admins table exists this just fails, which means "not an admin".
    sb.from('admins').select('user_id').eq('user_id', myId).maybeSingle(),
  ]);
  if (!profile) return null;
  myName = profile.username;
  privateCache = priv?.data || {};
  amAdmin = !!admin.data;
  await loadProfiles(true);
  return toUser(profile, profileCache.follows);
}

// "Sam and Biscuit" -> "sam_and_biscuit": lowercase, spaces become underscores, other symbols are dropped.
export const cleanUsername = name => String(name || '').trim().toLowerCase().replace(/^@/, '')
  .replace(/\s+/g, '_').replace(/[^a-z0-9_.]/g, '').slice(0, 20);
const clean = cleanUsername;

export async function signUp({ username, password, displayName, petName, petType }) {
  username = clean(username);
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw new Error('Pick a username with at least 3 letters or numbers.');
  if (password.length < 8) throw new Error('Passwords need at least 8 characters.');
  const { data, error } = await sb.auth.signUp({ email: email(username), password });
  if (error) throw new Error(/registered|exists/i.test(error.message) ? 'That username is already taken.' : error.message);
  if (!data.session) throw new Error('Your account was made but could not sign in. Try signing in.');
  myId = data.user.id;
  const profile = { displayName: displayName?.trim() || username, petName: petName?.trim() || '', petType: petType || '', bio: '', trophies: [] };
  const { error: e2 } = await sb.from('profiles').insert({ id: myId, username, data: profile });
  if (e2) { await sb.auth.signOut(); throw new Error(/duplicate|unique/i.test(e2.message) ? 'That username is already taken.' : e2.message); }
  check(await sb.from('private_data').insert({ id: myId, data: { theme: 'clean', saved: [] } }));
  return loadMe(data.session);
}

export async function signIn(username, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email(clean(username)), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'That username and password do not match.' : error.message);
  const me = await loadMe(data.session);
  if (!me) throw new Error('This account has no profile. Make a new account.');
  return me;
}

export async function changePassword(user, current, next) {
  if (next.length < 8) throw new Error('New passwords need at least 8 characters.');
  const { error } = await sb.auth.signInWithPassword({ email: email(user.username), password: current });
  if (error) throw new Error('Your current password is not right.');
  check(await sb.auth.updateUser({ password: next }));
}

export async function signOut() {
  myId = null; myName = null; privateCache = {}; profileCache = null; amAdmin = false;
  await sb.auth.signOut().catch(() => {});
}

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  // Ask the server too: the saved sign-in might belong to an account that has since been deleted.
  const { data: check, error } = await sb.auth.getUser();
  if (error || !check?.user) { await signOut(); return null; }
  try {
    const me = await loadMe(data.session);
    if (!me) await signOut();
    return me;
  } catch (err) { console.error(err); return null; }
}

/** True if the signed-in account still exists online. */
export async function stillSignedIn() {
  if (!myId) return false;
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return false;
  const { data: row } = await sb.from('profiles').select('id').eq('id', myId).maybeSingle();
  return !!row;
}

export async function deleteAccount() {
  // Remove your photos and videos first, then the account (which removes everything else).
  const files = check(await sb.storage.from(BUCKET).list(myId, { limit: 1000 }));
  if (files.length) await sb.storage.from(BUCKET).remove(files.map(f => `${myId}/${f.name}`));
  check(await sb.rpc('delete_my_account'));
  await signOut();
}
