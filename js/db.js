// Tiny IndexedDB wrapper. Everything (accounts, posts, media blobs, goals) lives on this device.
const DB_NAME = 'petpost';
const VERSION = 1;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('users', { keyPath: 'username' });
      db.createObjectStore('posts', { keyPath: 'id' }).createIndex('author', 'author');
      db.createObjectStore('comments', { keyPath: 'id' }).createIndex('postId', 'postId');
      db.createObjectStore('goals', { keyPath: 'id' }).createIndex('owner', 'owner');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const get = (store, key) => run(store, 'readonly', s => s.get(key));
export const put = (store, value) => run(store, 'readwrite', s => s.put(value));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const all = store => run(store, 'readonly', s => s.getAll());
export const byIndex = (store, index, value) => run(store, 'readonly', s => s.index(index).getAll(value));
export const uid = () => crypto.randomUUID();
