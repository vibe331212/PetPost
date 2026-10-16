// Sends real phone notifications. The database calls this (see the push_notify trigger) whenever
// someone licks, barks, follows, reports or posts. It works out who should hear about it and sends
// a web push to each of their phones. Secrets (VAPID keys, hook secret) are Supabase secrets, never in code.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails('https://vibe331212.github.io/PetPost/', Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

// Same words as js/sounds.js: dogs barked, cats meowed...
const SOUNDS: [RegExp, string][] = [
  [/dog|pupp/, 'barked'], [/cat|kitten/, 'meowed'], [/horse|pony|donkey/, 'neighed'], [/guinea/, 'wheeked'],
  [/duck/, 'quacked'], [/chicken|hen|rooster/, 'clucked'], [/bird|parrot|budgie|parakeet|canary/, 'tweeted'],
  [/cow|cattle/, 'mooed'], [/pig/, 'oinked'], [/sheep|lamb/, 'baaed'], [/goat/, 'bleated'], [/rabbit|bunny/, 'thumped'],
  [/hamster|mouse|rat|gerbil|ferret/, 'squeaked'], [/fish/, 'blubbed'], [/snake|reptile|lizard|turtle|tortoise|gecko/, 'hissed'],
  [/frog|toad/, 'ribbited'], [/^other$/, 'commented'],
];
const pastFor = (petType = '') => SOUNDS.find(([re]) => re.test(petType.trim().toLowerCase()))?.[1] || 'barked';

type Person = { id: string; username: string; name: string; petType: string };
async function person(id: string): Promise<Person | null> {
  const { data } = await sb.from('profiles').select('id, username, data').eq('id', id).maybeSingle();
  return data ? { id: data.id, username: data.username, name: data.data?.displayName || data.username, petType: data.data?.petType || '' } : null;
}
async function post(id: string) {
  const { data } = await sb.from('posts').select('id, author, data').eq('id', id).maybeSingle();
  return data;
}
async function blockedBetween(a: string, b: string) {
  const { count } = await sb.from('blocks').select('*', { count: 'exact', head: true })
    .or(`and(blocker.eq.${a},blocked.eq.${b}),and(blocker.eq.${b},blocked.eq.${a})`);
  return !!count;
}

type Note = { to: string; body: string; url: string; tag: string };

async function notesFor(table: string, r: any): Promise<Note[]> {
  if (table === 'licks') {
    const p = await post(r.post_id);
    if (!p || p.author === r.user_id || await blockedBetween(p.author, r.user_id)) return [];
    const who = await person(r.user_id);
    return who ? [{ to: p.author, body: `${who.name} licked your post`, url: `#/post/${p.id}`, tag: `lick-${p.id}` }] : [];
  }
  if (table === 'comments') {
    const p = await post(r.post_id);
    if (!p || p.author === r.author || await blockedBetween(p.author, r.author)) return [];
    const who = await person(r.author);
    const text = String(r.text || '');
    return who ? [{ to: p.author, body: `${who.name} ${pastFor(who.petType)}: "${text.length > 90 ? text.slice(0, 90) + '...' : text}"`, url: `#/post/${p.id}`, tag: `bark-${r.id}` }] : [];
  }
  if (table === 'follows') {
    if (await blockedBetween(r.follower, r.followee)) return [];
    const who = await person(r.follower);
    return who ? [{ to: r.followee, body: `${who.name} started following you`, url: `#/profile/${who.username}`, tag: `follow-${who.id}` }] : [];
  }
  if (table === 'reports') {
    // Says what it was for, never who sent it. Descriptions after the reason stay for admins only.
    const p = r.post_id ? await post(r.post_id) : null;
    const to = p?.author || r.user_id;
    if (!to) return [];
    const reason = String(r.reason || '').split(': ')[0];
    const me = await person(to);
    return [{ to, body: `Someone reported your ${p ? 'post' : 'account'} for ${reason}. The people who run PetPost will take a look.`, url: p ? `#/post/${p.id}` : `#/profile/${me?.username || ''}`, tag: `report-${r.id}` }];
  }
  if (table === 'moment_responses') {
    const p = await post(r.post_id);
    if (!p || p.author === r.user_id || await blockedBetween(p.author, r.user_id)) return [];
    const who = await person(r.user_id);
    if (!who) return [];
    const value = String(r.value || '');
    const body = r.kind === 'vote' ? `${who.name} voted on your poll`
      : r.kind === 'answer' ? `${who.name} answered your question: "${value.length > 90 ? value.slice(0, 90) + '...' : value}"`
      : `${who.name} reacted to your moment`;
    return [{ to: p.author, body, url: '#/notifications', tag: `moment-${r.kind}-${r.post_id}-${who.id}` }];
  }
  if (table === 'posts') {
    const who = await person(r.author);
    if (!who) return [];
    const d = r.data || {};
    const what = d.kind === 'moment' ? 'shared a moment' : d.mediaType === 'video' ? 'posted a new video' : 'posted a new photo';
    const { data: fans } = await sb.from('follows').select('follower').eq('followee', r.author);
    const notes: Note[] = [];
    for (const f of fans || []) {
      if (await blockedBetween(f.follower, r.author)) continue;
      notes.push({ to: f.follower, body: `${who.name} ${what}`, url: d.kind === 'moment' ? '#/feed' : `#/post/${r.id}`, tag: `post-${r.id}` });
    }
    return notes;
  }
  return [];
}

async function send(note: Note) {
  const { data: subs } = await sb.from('push_subscriptions').select('endpoint, subscription').eq('user_id', note.to);
  const payload = JSON.stringify({ title: 'PetPost', body: note.body, url: note.url, tag: note.tag });
  let sent = 0;
  const failed: (number | string)[] = [];
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(s.subscription, payload, { TTL: 60 * 60 * 24 });
      sent++;
    } catch (err: any) {
      failed.push(err?.statusCode || String(err?.message || err).slice(0, 80));
      // The phone turned notifications off or the address expired: forget it.
      if (err?.statusCode === 404 || err?.statusCode === 410) await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      else console.error('push failed', err?.statusCode, err?.body);
    }
  }
  return { sent, failed };
}

Deno.serve(async req => {
  if (req.method !== 'POST' || req.headers.get('x-hook-secret') !== Deno.env.get('PUSH_HOOK_SECRET')) {
    return new Response('Not allowed', { status: 401 });
  }
  try {
    const { table, record } = await req.json();
    const notes = await notesFor(table, record);
    let sent = 0;
    const failed: (number | string)[] = [];
    for (const n of notes) { const r = await send(n); sent += r.sent; failed.push(...r.failed); }
    return Response.json({ notes: notes.length, sent, failed });
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 500 });
  }
});
