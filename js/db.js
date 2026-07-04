"use strict";

// Minimal promise wrapper around IndexedDB. Two object stores:
//   state  — single record (key "state") holding the whole board tree
//   images — image Blobs keyed by id; items reference them as "idb:<id>"
const DB = (() => {
  const NAME = "notable";
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
        if (!db.objectStoreNames.contains("images")) db.createObjectStore("images");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  return {
    get: (store, key) => tx(store, "readonly", (s) => s.get(key)),
    put: (store, key, value) => tx(store, "readwrite", (s) => s.put(value, key)),
    del: (store, key) => tx(store, "readwrite", (s) => s.delete(key)),
    keys: (store) => tx(store, "readonly", (s) => s.getAllKeys()),
  };
})();
