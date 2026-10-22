import { newRegistration, RegistrationData, RegistrationStore, TranslationCache } from '../core/storage';

export async function registrations(): Promise<RegistrationStore> {
  const { oauthRegistration } = await chrome.storage.local.get('oauthRegistration');
  const saved = oauthRegistration as Partial<RegistrationData> | undefined;
  const data = newRegistration();
  if (saved && typeof saved.hostId === 'string' && /^urn:uuid:[a-f0-9-]{36}$/i.test(saved.hostId)) {
    data.hostId = saved.hostId;
    if (typeof saved.lastClientId === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(saved.lastClientId)) data.lastClientId = saved.lastClientId;
    if (typeof saved.pendingClientId === 'string' && /^[A-Za-z0-9_.-]{1,256}$/.test(saved.pendingClientId)) data.pendingClientId = saved.pendingClientId;
    if (saved.bindings && typeof saved.bindings === 'object') for (const [client, subject] of Object.entries(saved.bindings)) {
      if (/^[A-Za-z0-9_.-]{1,256}$/.test(client) && typeof subject === 'string' && /^[a-f0-9]{64}$/.test(subject)) data.bindings[client] = subject;
    }
  }
  const store: RegistrationStore = { data, save: () => chrome.storage.local.set({ oauthRegistration: data }) };
  await store.save(); return store;
}
export function translationCache(): TranslationCache {
  let database: Promise<IDBDatabase> | undefined;
  function open(): Promise<IDBDatabase> {
    return database ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('translatemypage-cache', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('translations');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  }
  return new TranslationCache({
    async read() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const request = db.transaction('translations').objectStore('translations').get('entries');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    },
    async write(entries) {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('translations', 'readwrite'); tx.objectStore('translations').put(entries, 'entries');
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    },
  });
}
