"use strict";

const Store = (() => {
  const KEY = "notable.v1";

  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

  function blankBoard(name, parentId = null) {
    return { id: uid(), name, parentId, items: {}, edges: [], view: { x: 0, y: 0, z: 1 } };
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && s.boards && s.rootId) return s;
      }
    } catch (e) { console.warn("Failed to load saved state", e); }
    const root = blankBoard("My Board");
    return { boards: { [root.id]: root }, rootId: root.id, currentId: root.id };
  }

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
        console.error("Save failed (storage may be full)", e);
      }
    }, 200);
  }

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
    for (const id of ids) {
      const item = b.items[id];
      if (!item) continue;
      if (item.type === "board" && item.boardId) deleteBoardTree(item.boardId);
      delete b.items[id];
    }
    b.edges = b.edges.filter(e => !ids.includes(e.from) && !ids.includes(e.to));
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
    for (const id of ids) {
      const src = b.items[id];
      if (!src || src.type === "board") continue; // don't deep-copy boards
      const clone = JSON.parse(JSON.stringify(src));
      clone.id = uid();
      clone.x += 24; clone.y += 24; clone.z = nextZ();
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

  function exportJSON() {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(text) {
    const s = JSON.parse(text);
    if (!s || !s.boards || !s.rootId || !s.boards[s.rootId]) throw new Error("Not a valid export file");
    state = s;
    if (!state.boards[state.currentId]) state.currentId = state.rootId;
    undoStack.length = 0;
    redoStack.length = 0;
    save();
  }

  return {
    get state() { return state; },
    board, createItem, update, removeItems, duplicateItems,
    addEdge, removeEdge,
    navigate, breadcrumbs, boardStats,
    snapshot, save,
    undo: () => restore(undoStack, redoStack),
    redo: () => restore(redoStack, undoStack),
    exportJSON, importJSON,
  };
})();
