// Kleiner Promise-Wrapper um IndexedDB. Alles bleibt lokal auf dem Gerät.
// Stores: projects, media (Metadaten), folders, songs, blobs (Dateiinhalte), cache (Analysen, Vorschaubilder).

const DB_NAME = 'reel-studio';
const DB_VERSION = 1;
export type StoreName = 'projects' | 'media' | 'folders' | 'songs' | 'luts' | 'blobs' | 'cache';
const STORES: StoreName[] = ['projects', 'media', 'folders', 'songs', 'luts', 'blobs', 'cache'];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: StoreName, mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function dbGet<T>(name: StoreName, key: string): Promise<T | undefined> {
  return wrap((await store(name, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function dbPut<T>(name: StoreName, key: string, value: T): Promise<void> {
  await wrap((await store(name, 'readwrite')).put(value, key));
}

export async function dbDelete(name: StoreName, key: string): Promise<void> {
  await wrap((await store(name, 'readwrite')).delete(key));
}

export async function dbAll<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name, 'readonly')).getAll()) as Promise<T[]>;
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen (wichtig auf dem iPhone). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
