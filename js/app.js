"use strict";

const App = (() => {
  const viewport = document.getElementById("viewport");
  const connectBtn = document.getElementById("tool-connect");

  // ---------- creating items ----------
  function addItem(type, worldPos) {
    const pos = worldPos || Board.centerOn();
    const def = Cards.DEFAULTS[type] || {};
    const props = {
      x: Math.round(pos.x - (def.w || 220) / 2),
      y: Math.round(pos.y - 40),
      w: def.w || 220,
      h: def.h || null,
    };
    if (type === "todo") props.todos = [{ text: "", done: false }];
    if (type === "link") {
      const url = prompt("URL:", "https://");
      if (!url || url === "https://") return null;
      props.url = url.trim();
      props.title = "";
    }
    if (type === "image") {
      const src = prompt("Image URL (or just paste/drag an image onto the board):");
      if (!src) return null;
      props.src = src.trim();
    }
    const item = Store.createItem(type, props);
    const focusMap = {
      note: ".text",
      todo: ".todo-item .todo-text",
      board: ".card-title",
      column: ".card-title",
      link: ".link-title",
    };
    Board.renderItem(item.id, { focus: focusMap[type] });
    Board.select([item.id]);
    return item;
  }

  document.querySelectorAll("#toolbar .tool[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => addItem(btn.dataset.add));
  });

  viewport.addEventListener("dblclick", (e) => {
    if (e.target.closest(".card")) return;
    addItem("note", Board.toWorld(e.clientX, e.clientY));
  });

  // ---------- connect mode ----------
  connectBtn.addEventListener("click", () => {
    if (Board.connectFrom !== null) exitConnectMode();
    else enterConnectMode();
  });

  function enterConnectMode() {
    Board.connectFrom = true; // waiting for first card click
    connectBtn.classList.add("active");
    viewport.classList.add("connect-mode");
  }

  function exitConnectMode() {
    Board.connectFrom = null;
    connectBtn.classList.remove("active");
    viewport.classList.remove("connect-mode");
  }

  // ---------- keyboard ----------
  window.addEventListener("keydown", (e) => {
    if (Board.isTyping(e)) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); if (Store.undo()) Board.renderBoard(); return; }
    if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); if (Store.redo()) Board.renderBoard(); return; }
    if (mod && e.key === "d") {
      e.preventDefault();
      const clones = Store.duplicateItems([...Board.selection]);
      Board.renderBoard();
      Board.select(clones.map(c => c.id));
      return;
    }
    if (mod && e.key === "0") { e.preventDefault(); resetZoom(); return; }
    if (mod && (e.key === "=" || e.key === "+")) { e.preventDefault(); zoomCenter(1.2); return; }
    if (mod && e.key === "-") { e.preventDefault(); zoomCenter(1 / 1.2); return; }
    if (mod) return;

    switch (e.key) {
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (Board.selectedEdge) { Store.removeEdge(Board.selectedEdge); Board.clearSelection(); Board.renderEdges(); }
        else if (Board.selection.size) { Store.removeItems([...Board.selection]); Board.renderBoard(); }
        break;
      case "Escape":
        exitConnectMode();
        Board.clearSelection();
        hideMenu();
        break;
      case "n": addItem("note"); break;
      case "t": addItem("todo"); break;
      case "l": addItem("link"); break;
      case "i": addItem("image"); break;
      case "b": addItem("board"); break;
      case "c": addItem("column"); break;
      case "a": Board.connectFrom === null ? enterConnectMode() : exitConnectMode(); break;
    }
  });

  function zoomCenter(f) {
    const r = viewport.getBoundingClientRect();
    Board.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  function resetZoom() {
    const v = Store.board().view;
    v.x = 0; v.y = 0; v.z = 1;
    Store.save();
    Board.renderBoard();
  }

  // ---------- paste & drop ----------
  window.addEventListener("paste", (e) => {
    if (Board.isTyping(e)) return;
    const cd = e.clipboardData;
    for (const f of cd.files) {
      if (f.type.startsWith("image/")) { addImageFile(f); return; }
    }
    const text = cd.getData("text/plain").trim();
    if (!text) return;
    const pos = Board.centerOn();
    if (/^https?:\/\/\S+$/i.test(text)) {
      if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(text)) {
        Store.createItem("image", { x: pos.x - 130, y: pos.y - 90, w: 260, h: 180, src: text });
      } else {
        Store.createItem("link", { x: pos.x - 130, y: pos.y - 30, w: 260, url: text, title: "" });
      }
    } else {
      Store.createItem("note", { x: pos.x - 110, y: pos.y - 30, w: 220, text });
    }
    Board.renderBoard();
  });

  viewport.addEventListener("dragover", (e) => e.preventDefault());
  viewport.addEventListener("drop", (e) => {
    e.preventDefault();
    const pos = Board.toWorld(e.clientX, e.clientY);
    for (const f of e.dataTransfer.files) {
      if (f.type.startsWith("image/")) addImageFile(f, pos);
    }
    const url = e.dataTransfer.getData("text/uri-list") || "";
    if (url && !e.dataTransfer.files.length) {
      Store.createItem("link", { x: pos.x, y: pos.y, w: 260, url: url.trim(), title: "" });
      Board.renderBoard();
    }
  });

  function addImageFile(file, pos) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(320, img.naturalWidth || 320);
        const h = Math.round(w * (img.naturalHeight / img.naturalWidth)) || 200;
        const p = pos || Board.centerOn();
        Store.createItem("image", { x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, src: reader.result });
        Board.renderBoard();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  // ---------- context menu ----------
  let menuEl = null;
  const COLORS = { white: "#ffffff", yellow: "#fef9dd", blue: "#e3eefb", green: "#e4f5e6", pink: "#fce8ef", purple: "#eee7fa", gray: "#eceff1" };

  window.addEventListener("contextmenu", (e) => {
    const cardEl = e.target.closest(".card");
    if (!cardEl || Board.isTyping(e)) return;
    e.preventDefault();
    const id = cardEl.dataset.id;
    if (!Board.selection.has(id)) Board.select([id]);
    showMenu(e.clientX, e.clientY, id);
  });

  function showMenu(x, y, id) {
    hideMenu();
    const item = Store.board().items[id];
    menuEl = document.createElement("div");
    menuEl.id = "ctxmenu";

    if (item.type !== "image") {
      const swatches = document.createElement("div");
      swatches.className = "swatches";
      for (const [name, hex] of Object.entries(COLORS)) {
        const s = document.createElement("button");
        s.className = "swatch";
        s.style.background = hex;
        s.title = name;
        s.addEventListener("click", () => {
          const color = name === "white" ? null : name;
          Store.snapshot();
          for (const sid of Board.selection) Store.update(sid, { color });
          for (const sid of Board.selection) Board.renderItem(sid);
          Board.select([...Board.selection]);
          hideMenu();
        });
        swatches.appendChild(s);
      }
      menuEl.appendChild(swatches);
    }

    const actions = [];
    if (item.type !== "board") {
      actions.push(["Duplicate", () => {
        const clones = Store.duplicateItems([...Board.selection]);
        Board.renderBoard();
        Board.select(clones.map(c => c.id));
      }]);
    }
    if (item.type === "board") {
      actions.push(["Open board", () => Board.open(item.boardId)]);
    }
    actions.push(["Bring to front", () => {
      Store.snapshot();
      for (const sid of Board.selection) {
        const zs = Object.values(Store.board().items).map(i => i.z || 0);
        Store.update(sid, { z: Math.max(...zs) + 1 });
        Board.renderItem(sid);
      }
      Board.select([...Board.selection]);
    }]);
    actions.push(["Delete", () => {
      Store.removeItems([...Board.selection]);
      Board.renderBoard();
    }, "danger"]);

    for (const [label, fn, cls] of actions) {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener("click", () => { hideMenu(); fn(); });
      menuEl.appendChild(b);
    }

    document.body.appendChild(menuEl);
    const r = menuEl.getBoundingClientRect();
    menuEl.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
    menuEl.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
  }

  function hideMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }
  window.addEventListener("mousedown", (e) => {
    if (menuEl && !menuEl.contains(e.target)) hideMenu();
  });

  // ---------- export / import ----------
  document.getElementById("btn-export").addEventListener("click", () => {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "notable-boards-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const importInput = document.getElementById("import-file");
  document.getElementById("btn-import").addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    const f = importInput.files[0];
    if (!f) return;
    f.text().then((text) => {
      if (!confirm("Importing replaces all current boards. Continue?")) return;
      try {
        Store.importJSON(text);
        Board.renderBoard();
      } catch (err) {
        alert("Import failed: " + err.message);
      }
    });
    importInput.value = "";
  });

  // ---------- hint ----------
  setTimeout(() => document.getElementById("hint").classList.add("faded"), 8000);

  // ---------- init ----------
  Board.renderBoard();

  return { exitConnectMode, addItem };
})();
