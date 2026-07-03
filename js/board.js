"use strict";

const Board = (() => {
  const viewport = document.getElementById("viewport");
  const world = document.getElementById("world");
  const itemsLayer = document.getElementById("items");
  const edgesSvg = document.getElementById("edges");
  const marqueeEl = document.getElementById("marquee");
  const crumbsEl = document.getElementById("breadcrumbs");
  const zoomLabel = document.getElementById("zoom-label");

  const EDGE_OFF = 20000; // svg layer offset so negative coords render

  let selection = new Set();
  let selectedEdge = null;
  let connectFrom = null; // item id while in connect mode
  const els = new Map();  // item id -> element

  // ---------- view transform ----------
  const view = () => Store.board().view;

  function applyView() {
    const v = view();
    world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.z})`;
    viewport.style.backgroundPosition = `${v.x}px ${v.y}px`;
    viewport.style.backgroundSize = `${24 * v.z}px ${24 * v.z}px`;
    zoomLabel.textContent = Math.round(v.z * 100) + "%";
  }

  function toWorld(sx, sy) {
    const r = viewport.getBoundingClientRect();
    const v = view();
    return { x: (sx - r.left - v.x) / v.z, y: (sy - r.top - v.y) / v.z };
  }

  function zoomAt(sx, sy, factor) {
    const v = view();
    const before = toWorld(sx, sy);
    v.z = Math.min(3, Math.max(0.15, v.z * factor));
    const r = viewport.getBoundingClientRect();
    v.x = sx - r.left - before.x * v.z;
    v.y = sy - r.top - before.y * v.z;
    Store.save();
    applyView();
    renderEdges();
  }

  function centerOn(sx, sy) {
    return toWorld(sx ?? viewport.clientWidth / 2 + viewport.getBoundingClientRect().left,
                   sy ?? viewport.clientHeight / 2 + viewport.getBoundingClientRect().top);
  }

  // ---------- rendering ----------
  function renderBoard() {
    selection.clear();
    selectedEdge = null;
    els.clear();
    itemsLayer.textContent = "";
    for (const item of Object.values(Store.board().items)) {
      const el = Cards.render(item);
      els.set(item.id, el);
      itemsLayer.appendChild(el);
    }
    applyView();
    renderEdges();
    renderBreadcrumbs();
    updateSelectionDom();
  }

  function renderItem(id, { focus = null } = {}) {
    const item = Store.board().items[id];
    const old = els.get(id);
    if (!item) { if (old) old.remove(); els.delete(id); return; }
    const el = Cards.render(item);
    if (selection.has(id)) el.classList.add("selected");
    if (old) old.replaceWith(el); else itemsLayer.appendChild(el);
    els.set(id, el);
    renderEdges();
    if (focus) {
      const f = el.querySelector(focus);
      if (f) { if (f.startEdit) f.startEdit(); else { f.focus(); placeCaretEnd(f); } }
    }
  }

  function placeCaretEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function renderBreadcrumbs() {
    crumbsEl.textContent = "";
    const trail = Store.breadcrumbs();
    trail.forEach((b, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "›";
        crumbsEl.appendChild(sep);
      }
      const isLast = i === trail.length - 1;
      const btn = document.createElement("button");
      btn.className = "crumb" + (isLast ? " current" : "");
      btn.textContent = b.name || "Untitled board";
      if (isLast) {
        btn.addEventListener("dblclick", () => renameBoard(btn, b));
      } else {
        btn.addEventListener("click", () => open(b.id));
      }
      crumbsEl.appendChild(btn);
    });
  }

  function renameBoard(btn, b) {
    btn.contentEditable = "true";
    btn.focus();
    placeCaretEnd(btn);
    const done = () => {
      btn.contentEditable = "false";
      const name = btn.innerText.trim() || "Untitled board";
      b.name = name;
      btn.textContent = name;
      // sync the board-card in the parent
      if (b.parentId) {
        const parent = Store.state.boards[b.parentId];
        for (const it of Object.values(parent.items)) {
          if (it.boardId === b.id) it.name = name;
        }
      }
      Store.save();
    };
    btn.addEventListener("blur", done, { once: true });
    btn.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); btn.blur(); }
    });
  }

  function open(boardId) {
    App.exitConnectMode();
    Store.navigate(boardId);
    renderBoard();
  }

  // ---------- edges ----------
  function itemRect(id) {
    const item = Store.board().items[id];
    const el = els.get(id);
    if (!item || !el) return null;
    return { x: item.x, y: item.y, w: el.offsetWidth, h: el.offsetHeight };
  }

  function edgeEndpoints(a, b) {
    const c1 = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const c2 = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    return [clipToRect(c1, c2, a), clipToRect(c2, c1, b)];
  }

  function clipToRect(from, toward, r) {
    const dx = toward.x - from.x, dy = toward.y - from.y;
    if (dx === 0 && dy === 0) return from;
    const tx = dx !== 0 ? (dx > 0 ? (r.x + r.w - from.x) : (r.x - from.x)) / dx : Infinity;
    const ty = dy !== 0 ? (dy > 0 ? (r.y + r.h - from.y) : (r.y - from.y)) / dy : Infinity;
    const t = Math.min(tx, ty);
    return { x: from.x + dx * t, y: from.y + dy * t };
  }

  function renderEdges() {
    edgesSvg.textContent = "";
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML =
      '<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0 0L10 5L0 10z" fill="#9aa1a9"/></marker>' +
      '<marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M0 0L10 5L0 10z" fill="#4a90d9"/></marker>';
    edgesSvg.appendChild(defs);

    for (const edge of Store.board().edges) {
      const ra = itemRect(edge.from), rb = itemRect(edge.to);
      if (!ra || !rb) continue;
      const [p1, p2] = edgeEndpoints(ra, rb);
      const d = `M ${p1.x + EDGE_OFF} ${p1.y + EDGE_OFF} L ${p2.x + EDGE_OFF} ${p2.y + EDGE_OFF}`;

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", d);
      hit.setAttribute("class", "edge-hit");
      hit.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        clearSelection();
        selectedEdge = edge.id;
        renderEdges();
      });
      edgesSvg.appendChild(hit);

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("class", "edge" + (selectedEdge === edge.id ? " selected" : ""));
      path.setAttribute("marker-end", selectedEdge === edge.id ? "url(#arrow-sel)" : "url(#arrow)");
      path.style.pointerEvents = "none";
      edgesSvg.appendChild(path);
    }

    if (pendingEdge) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${pendingEdge.x1 + EDGE_OFF} ${pendingEdge.y1 + EDGE_OFF} L ${pendingEdge.x2 + EDGE_OFF} ${pendingEdge.y2 + EDGE_OFF}`);
      path.setAttribute("class", "edge pending");
      path.setAttribute("marker-end", "url(#arrow)");
      path.style.pointerEvents = "none";
      edgesSvg.appendChild(path);
    }
  }

  let pendingEdge = null;

  // ---------- selection ----------
  function clearSelection() {
    selection.clear();
    selectedEdge = null;
    updateSelectionDom();
  }

  function select(ids, { additive = false } = {}) {
    if (!additive) selection.clear();
    selectedEdge = null;
    for (const id of ids) selection.add(id);
    updateSelectionDom();
  }

  function updateSelectionDom() {
    for (const [id, el] of els) el.classList.toggle("selected", selection.has(id));
  }

  // ---------- pointer interactions ----------
  let spaceDown = false;

  viewport.addEventListener("mousedown", (e) => {
    if (e.target.closest(".card")) return onCardMouseDown(e);
    // empty canvas
    if (e.button === 1 || (e.button === 0 && spaceDown)) return startPan(e);
    if (e.button === 0) {
      if (connectFrom) { App.exitConnectMode(); return; }
      startMarquee(e);
    }
  });

  function onCardMouseDown(e) {
    const cardEl = e.target.closest(".card");
    const id = cardEl.dataset.id;

    if (connectFrom !== null) {
      if (connectFrom !== id && connectFrom !== true) {
        Store.addEdge(connectFrom, id);
      }
      if (connectFrom === true) {
        // first click of connect mode
        connectFrom = id;
        cardEl.classList.add("connect-target");
        trackPendingEdge(id);
      } else {
        App.exitConnectMode();
        renderEdges();
      }
      e.preventDefault();
      return;
    }

    if (e.button === 1 || spaceDown) return startPan(e);
    if (e.button !== 0) return;

    if (e.target.classList.contains("resize-handle")) return startResize(e, id);

    if (e.shiftKey) {
      if (selection.has(id)) selection.delete(id); else selection.add(id);
      updateSelectionDom();
      return;
    }
    if (!selection.has(id)) select([id]);
    Store.update(id, { z: bringToFrontZ() });
    els.get(id).style.zIndex = Store.board().items[id].z;
    startDrag(e);
  }

  function bringToFrontZ() {
    const zs = Object.values(Store.board().items).map(i => i.z || 0);
    return (zs.length ? Math.max(...zs) : 0) + 1;
  }

  // drag selected cards
  function startDrag(e) {
    const startMouse = toWorld(e.clientX, e.clientY);
    const starts = new Map();
    for (const id of selection) {
      const it = Store.board().items[id];
      starts.set(id, { x: it.x, y: it.y });
    }
    let moved = false;

    const onMove = (ev) => {
      const m = toWorld(ev.clientX, ev.clientY);
      const dx = m.x - startMouse.x, dy = m.y - startMouse.y;
      if (!moved && Math.hypot(dx * view().z, dy * view().z) < 3) return;
      if (!moved) {
        moved = true;
        Store.snapshot();
        for (const id of selection) els.get(id)?.classList.add("dragging");
      }
      for (const [id, s] of starts) {
        const item = Store.board().items[id];
        if (!item) continue;
        item.x = Math.round(s.x + dx);
        item.y = Math.round(s.y + dy);
        const el = els.get(id);
        if (el) el.style.transform = `translate(${item.x}px, ${item.y}px)`;
      }
      renderEdges();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (moved) {
        for (const id of selection) els.get(id)?.classList.remove("dragging");
        Store.save();
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  }

  function startResize(e, id) {
    e.preventDefault();
    e.stopPropagation();
    const item = Store.board().items[id];
    const el = els.get(id);
    const start = toWorld(e.clientX, e.clientY);
    const w0 = el.offsetWidth, h0 = el.offsetHeight;
    const fixedHeight = item.type === "image" || item.type === "column" || item.h != null;
    Store.snapshot();

    const onMove = (ev) => {
      const m = toWorld(ev.clientX, ev.clientY);
      item.w = Math.max(120, Math.round(w0 + (m.x - start.x)));
      if (fixedHeight) item.h = Math.max(60, Math.round(h0 + (m.y - start.y)));
      Cards.position(el, item);
      renderEdges();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      Store.save();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startPan(e) {
    e.preventDefault();
    viewport.classList.add("panning");
    const v = view();
    const sx = e.clientX - v.x, sy = e.clientY - v.y;
    const onMove = (ev) => {
      v.x = ev.clientX - sx;
      v.y = ev.clientY - sy;
      applyView();
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      viewport.classList.remove("panning");
      Store.save();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function startMarquee(e) {
    const startX = e.clientX, startY = e.clientY;
    const vpRect = viewport.getBoundingClientRect();
    let active = false;
    if (!e.shiftKey) clearSelection();

    const onMove = (ev) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
      active = true;
      marqueeEl.hidden = false;
      const x = Math.min(startX, ev.clientX) - vpRect.left;
      const y = Math.min(startY, ev.clientY) - vpRect.top;
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      Object.assign(marqueeEl.style, { left: x + "px", top: y + "px", width: w + "px", height: h + "px" });

      const a = toWorld(Math.min(startX, ev.clientX), Math.min(startY, ev.clientY));
      const b = toWorld(Math.max(startX, ev.clientX), Math.max(startY, ev.clientY));
      const hits = [];
      for (const [id] of els) {
        const r = itemRect(id);
        if (r && r.x < b.x && r.x + r.w > a.x && r.y < b.y && r.y + r.h > a.y) hits.push(id);
      }
      select(hits, { additive: e.shiftKey });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      marqueeEl.hidden = true;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function trackPendingEdge(fromId) {
    const onMove = (ev) => {
      if (connectFrom !== fromId) {
        window.removeEventListener("mousemove", onMove);
        pendingEdge = null;
        renderEdges();
        return;
      }
      const r = itemRect(fromId);
      if (!r) return;
      const m = toWorld(ev.clientX, ev.clientY);
      const p = clipToRect({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, m, r);
      pendingEdge = { x1: p.x, y1: p.y, x2: m.x, y2: m.y };
      renderEdges();
    };
    window.addEventListener("mousemove", onMove);
  }

  // ---------- wheel: pan / zoom ----------
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01));
    } else {
      const v = view();
      v.x -= e.deltaX;
      v.y -= e.deltaY;
      Store.save();
      applyView();
    }
  }, { passive: false });

  window.addEventListener("keydown", (e) => { if (e.code === "Space" && !isTyping(e)) spaceDown = true; });
  window.addEventListener("keyup", (e) => { if (e.code === "Space") spaceDown = false; });

  const isTyping = (e) => e.target.isContentEditable || /^(input|textarea)$/i.test(e.target.tagName);

  return {
    renderBoard, renderItem, renderBreadcrumbs, renderEdges,
    open, select, clearSelection,
    get selection() { return selection; },
    get selectedEdge() { return selectedEdge; },
    set connectFrom(v) {
      connectFrom = v;
      if (v === null) {
        pendingEdge = null;
        for (const el of els.values()) el.classList.remove("connect-target");
        renderEdges();
      }
    },
    get connectFrom() { return connectFrom; },
    toWorld, centerOn, zoomAt, isTyping,
    els,
  };
})();
