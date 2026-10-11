// Accounts: passwords are never stored, only a salted PBKDF2 hash.
import * as db from './db.js';

const SESSION_KEY = 'petpost.session';
const enc = new TextEncoder();
const toHex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = hex => new Uint8Array(hex.match(/../g).map(h => parseInt(h, 16)));

async function hash(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: 210000, hash: 'SHA-256' }, key, 256);
  return toHex(bits);
}

const newSalt = () => toHex(crypto.getRandomValues(new Uint8Array(16)));
const normalize = name => String(name || '').trim().toLowerCase().replace(/^@/, '');

function setSession(username) {
  try { localStorage.setItem(SESSION_KEY, username); } catch { /* private mode: session lasts this tab only */ }
}

export async function signUp({ username, password, displayName, petName, petType }) {
  username = normalize(username);
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) throw new Error('Usernames are 3 to 20 letters, numbers, dots or underscores.');
  if (password.length < 8) throw new Error('Passwords need at least 8 characters.');
  if (await db.get('users', username)) throw new Error('That username is already taken.');
  const salt = newSalt();
  const user = {
    username,
    displayName: displayName?.trim() || username,
    petName: petName?.trim() || '',
    petType: petType || '',
    bio: '',
    avatar: null,
    avatarAt: 0,
    theme: 'clean',
    saved: [],
    salt,
    hash: await hash(password, salt),
    createdAt: Date.now(),
  };
  await db.put('users', user);
  setSession(username);
  return user;
}

export async function signIn(username, password) {
  const user = await db.get('users', normalize(username));
  if (!user || (await hash(password, user.salt)) !== user.hash) throw new Error('That username and password do not match.');
  setSession(user.username);
  return user;
}

export async function changePassword(user, current, next) {
  if ((await hash(current, user.salt)) !== user.hash) throw new Error('Your current password is not right.');
  if (next.length < 8) throw new Error('New passwords need at least 8 characters.');
  user.salt = newSalt();
  user.hash = await hash(next, user.salt);
}

export function signOut() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

export async function currentUser() {
  let name = null;
  try { name = localStorage.getItem(SESSION_KEY); } catch { /* ignore */ }
  return name ? (await db.get('users', name)) || null : null;
}
