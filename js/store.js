"use strict";

const Store = (() => {
  const LEGACY_KEY = "notable.v1"; // pre-IndexedDB localStorage key

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function blankBoard(name, parentId = null) {
    return { id: uid(), name, parentId, items: {}, edges: [], view: { x: 0, y: 0, z: 1 } };
  }

  let state = null;

  async function init() {
    let s = null;
    try { s = await DB.get("state", "state"); }
    catch (e) { console.warn("IndexedDB unavailable, starting fresh", e); }
    if (!s) s = await migrateFromLocalStorage();
    if (!s || !s.boards || !s.rootId || !s.boards[s.rootId]) {
      const root = blankBoard("My Board");
      s = { boards: { [root.id]: root }, rootId: root.id, currentId: root.id };
    }
    if (!s.boards[s.currentId]) s.currentId = s.rootId;
    state = s;
    gcImages().catch(() => {});
  }

  async function migrateFromLocalStorage() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch { return null; }
    if (!s || !s.boards || !s.rootId) return null;
    try {
      await internImages(s);
      await DB.put("state", "state", s);
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) { console.warn("Migration to IndexedDB failed", e); }
    return s;
  }

  // Convert any inline data-URL images to Blobs in the images store.
  async function internImages(s) {
    for (const b of Object.values(s.boards)) {
      for (const it of Object.values(b.items)) {
        if (it.type === "image" && typeof it.src === "string" && it.src.startsWith("data:")) {
          const blob = await (await fetch(it.src)).blob();
          it.src = "idb:" + await putImage(blob);
        }
      }
    }
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      DB.put("state", "state", state).catch((e) => console.error("Save failed", e));
    }, 200);
  }

  // ---- images ----
  const urlCache = new Map(); // image id -> object URL

  async function putImage(blob) {
    const id = uid();
    await DB.put("images", id, blob);
    return id;
  }

  async function getImageURL(id) {
    if (urlCache.has(id)) return urlCache.get(id);
    const blob = await DB.get("images", id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urlCache.set(id, url);
    return url;
  }

  // Blobs are kept when their card is deleted so in-session undo can restore
  // them; orphans are swept on the next startup instead.
  async function gcImages() {
    const referenced = new Set();
    for (const b of Object.values(state.boards))
      for (const it of Object.values(b.items))
        if (it.type === "image" && typeof it.src === "string" && it.src.startsWith("idb:"))
          referenced.add(it.src.slice(4));
    for (const key of await DB.keys("images"))
      if (!referenced.has(key)) await DB.del("images", key);
  }

  const blobToDataURL = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  // ---- undo/redo: snapshot current board's content ----
  const undoStack = [];
  const redoStack = [];
  const MAX_UNDO = 100;

  function snapshot() {
    const b = board();
    undoStack.push(JSON.stringify({ id: b.id, items: b.items, edges: b.edges }));
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack.length = 0;
  }

  function restore(fromStack, toStack) {
    const snap = fromStack.pop();
    if (!snap) return false;
    const data = JSON.parse(snap);
    const b = state.boards[data.id];
    if (!b) return false;
    toStack.push(JSON.stringify({ id: b.id, items: b.items, edges: b.edges }));
    b.items = data.items;
    b.edges = data.edges;
    state.currentId = data.id;
    save();
    return true;
  }

  // ---- accessors ----
  const board = (id) => state.boards[id || state.currentId];

  function createItem(type, props) {
    snapshot();
    const item = { id: uid(), type, x: 0, y: 0, w: 220, h: null, color: null, z: nextZ(), ...props };
    if (type === "column" && !item.children) item.children = [];
    if (type === "board") {
      const child = blankBoard(props.name || "", state.currentId);
      state.boards[child.id] = child;
      item.boardId = child.id;
    }
    board().items[item.id] = item;
    save();
    return item;
  }

  function nextZ() {
    const zs = Object.values(board().items).map(i => i.z || 0);
    return (zs.length ? Math.max(...zs) : 0) + 1;
  }

  function update(id, props, { withSnapshot = false } = {}) {
    const item = board().items[id];
    if (!item) return;
    if (withSnapshot) snapshot();
    Object.assign(item, props);
    save();
  }

  function removeItems(ids) {
    snapshot();
    const b = board();
    const toRemove = new Set(ids);
    for (const id of ids) {
      const item = b.items[id];
      if (item?.type === "column") for (const c of item.children || []) toRemove.add(c);
    }
    for (const id of toRemove) {
      const item = b.items[id];
      if (!item) continue;
      if (item.type === "board" && item.boardId) deleteBoardTree(item.boardId);
      delete b.items[id];
    }
    for (const it of Object.values(b.items))
      if (it.type === "column" && it.children) it.children = it.children.filter(c => !toRemove.has(c));
    b.edges = b.edges.filter(e => !toRemove.has(e.from) && !toRemove.has(e.to));
    save();
  }

  // ---- columns ----
  function findColumnOf(id) {
    for (const it of Object.values(board().items))
      if (it.type === "column" && it.children && it.children.includes(id)) return it;
    return null;
  }

  // No snapshot here: callers snapshot once around the whole gesture.
  function dockItem(id, colId, index) {
    const b = board();
    const item = b.items[id], col = b.items[colId];
    if (!item || !col || col.type !== "column" || item.type === "column") return;
    undockItem(id);
    col.children = col.children || [];
    index = Math.max(0, Math.min(index, col.children.length));
    col.children.splice(index, 0, id);
    save();
  }

  function undockItem(id) {
    const col = findColumnOf(id);
    if (!col) return;
    col.children = col.children.filter(c => c !== id);
    save();
  }

  function deleteBoardTree(boardId) {
    const b = state.boards[boardId];
    if (!b) return;
    for (const item of Object.values(b.items)) {
      if (item.type === "board" && item.boardId) deleteBoardTree(item.boardId);
    }
    delete state.boards[boardId];
  }

  function addEdge(from, to) {
    if (from === to) return;
    const b = board();
    if (b.edges.some(e => (e.from === from && e.to === to) || (e.from === to && e.to === from))) return;
    snapshot();
    b.edges.push({ id: uid(), from, to });
    save();
  }

  function removeEdge(id) {
    snapshot();
    const b = board();
    b.edges = b.edges.filter(e => e.id !== id);
    save();
  }

  function duplicateItems(ids) {
    snapshot();
    const b = board();
    const clones = [];
    const idSet = new Set(ids);
    for (const id of ids) {
      const src = b.items[id];
      if (!src || src.type === "board") continue; // don't deep-copy boards
      const parentCol = findColumnOf(id);
      if (parentCol && idSet.has(parentCol.id)) continue; // cloned along with its column
      const clone = JSON.parse(JSON.stringify(src));
      clone.id = uid();
      clone.x += 24; clone.y += 24; clone.z = nextZ();
      if (src.type === "column") {
        clone.children = [];
        for (const cid of src.children || []) {
          const child = b.items[cid];
          if (!child || child.type === "board") continue;
          const cc = JSON.parse(JSON.stringify(child));
          cc.id = uid(); cc.z = nextZ();
          b.items[cc.id] = cc;
          clone.children.push(cc.id);
        }
      }
      b.items[clone.id] = clone;
      clones.push(clone);
    }
    save();
    return clones;
  }

  function navigate(boardId) {
    if (!state.boards[boardId]) return;
    state.currentId = boardId;
    save();
  }

  function breadcrumbs() {
    const trail = [];
    let b = board();
    while (b) {
      trail.unshift(b);
      b = b.parentId ? state.boards[b.parentId] : null;
    }
    return trail;
  }

  function boardStats(boardId) {
    const b = state.boards[boardId];
    if (!b) return { count: 0 };
    return { count: Object.keys(b.items).length };
  }

  // Export inlines idb: images as data URLs so the file is self-contained.
  async function exportJSON() {
    const clone = JSON.parse(JSON.stringify(state));
    for (const b of Object.values(clone.boards)) {
      for (const it of Object.values(b.items)) {
        if (it.type === "image" && typeof it.src === "string" && it.src.startsWith("idb:")) {
          const blob = await DB.get("images", it.src.slice(4));
          if (blob) it.src = await blobToDataURL(blob);
        }
      }
    }
    return JSON.stringify(clone, null, 2);
  }

  async function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || !s.boards || !s.rootId || !s.boards[s.rootId]) throw new Error("Not a valid export file");
    await internImages(s);
    if (!s.boards[s.currentId]) s.currentId = s.rootId;
    state = s;
    undoStack.length = 0;
    redoStack.length = 0;
    await DB.put("state", "state", state);
    gcImages().catch(() => {});
  }

  return {
    get state() { return state; },
    init,
    board, createItem, update, removeItems, duplicateItems,
    findColumnOf, dockItem, undockItem,
    addEdge, removeEdge,
    navigate, breadcrumbs, boardStats,
    snapshot, save,
    putImage, getImageURL,
    undo: () => restore(undoStack, redoStack),
    redo: () => restore(redoStack, undoStack),
    exportJSON, importJSON,
  };
})();
