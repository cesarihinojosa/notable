"use strict";

// Renders items into DOM elements. All user content is set via textContent /
// innerText, never innerHTML, so stored text can't inject markup.
const Cards = (() => {

  const DEFAULTS = {
    note:   { w: 220 },
    todo:   { w: 230 },
    link:   { w: 260 },
    image:  { w: 260, h: 180 },
    board:  { w: 170, h: 110 },
    column: { w: 300, h: 420 },
  };

  function render(item) {
    const el = document.createElement("div");
    el.className = "card " + cssClass(item.type);
    el.dataset.id = item.id;
    if (item.color) el.dataset.color = item.color;
    position(el, item);

    builders[item.type](el, item);

    const handle = document.createElement("div");
    handle.className = "resize-handle";
    el.appendChild(handle);
    return el;
  }

  function cssClass(type) {
    return { note: "note", todo: "todo", link: "link-card", image: "image", board: "board-card", column: "column" }[type];
  }

  function position(el, item) {
    el.style.transform = `translate(${item.x}px, ${item.y}px)`;
    el.style.width = item.w + "px";
    el.style.height = item.h ? item.h + "px" : "auto";
    el.style.zIndex = item.z || 1;
  }

  // ---- shared editable helper ----
  // Single click selects/drags the card; double-click (or startEdit()) enters
  // edit mode. While editing, events stay inside the field.
  function editable(tag, className, text, onCommit, { multiline = true } = {}) {
    const el = document.createElement(tag);
    el.className = className;
    el.contentEditable = "false";
    el.spellcheck = false;
    if (text) el.innerText = text;
    let editing = false;
    el.startEdit = () => {
      editing = true;
      el.contentEditable = "true";
      el.style.userSelect = "text";
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    };
    el.addEventListener("mousedown", (e) => { if (editing) e.stopPropagation(); });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      if (!editing) el.startEdit();
    });
    el.addEventListener("keydown", (e) => {
      e.stopPropagation(); // don't trigger canvas shortcuts while typing
      if (e.key === "Escape") { e.preventDefault(); el.blur(); }
      if (!multiline && e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    });
    el.addEventListener("blur", () => {
      editing = false;
      el.contentEditable = "false";
      el.style.userSelect = "";
      onCommit(el.innerText.replace(/\n+$/, ""));
    });
    return el;
  }

  const commit = (id, key) => (value) => {
    const item = Store.board().items[id];
    if (item && item[key] !== value) Store.update(id, { [key]: value }, { withSnapshot: true });
  };

  // ---- builders per type ----
  const builders = {

    note(el, item) {
      el.appendChild(editable("div", "text", item.text || "", commit(item.id, "text")));
    },

    todo(el, item) {
      el.appendChild(editable("div", "card-title", item.title || "", commit(item.id, "title"), { multiline: false }));
      const list = document.createElement("div");
      list.className = "todo-list";
      (item.todos || []).forEach((t, i) => list.appendChild(todoRow(item, i, t)));
      el.appendChild(list);

      const add = document.createElement("button");
      add.className = "todo-add";
      add.textContent = "+ Add task";
      add.addEventListener("mousedown", (e) => e.stopPropagation());
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        const todos = [...(Store.board().items[item.id].todos || []), { text: "", done: false }];
        Store.update(item.id, { todos }, { withSnapshot: true });
        Board.renderItem(item.id, { focus: `.todo-item:nth-child(${todos.length}) .todo-text` });
      });
      el.appendChild(add);
    },

    link(el, item) {
      el.appendChild(editable("div", "link-title", item.title || "", commit(item.id, "title"), { multiline: false }));
      const a = document.createElement("a");
      a.textContent = item.url;
      a.title = item.url;
      if (/^https?:\/\//i.test(item.url)) {
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }
      a.addEventListener("mousedown", (e) => e.stopPropagation());
      el.appendChild(a);
    },

    image(el, item) {
      const img = document.createElement("img");
      img.src = item.src;
      img.draggable = false;
      el.appendChild(img);
      el.appendChild(editable("div", "img-caption", item.caption || "", commit(item.id, "caption"), { multiline: false }));
    },

    board(el, item) {
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 24 24");
      icon.classList.add("board-icon");
      icon.innerHTML = '<rect x="3" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13" y="13" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/>';
      el.appendChild(icon);

      const title = editable("div", "card-title", item.name || "", (v) => {
        Store.update(item.id, { name: v }, { withSnapshot: true });
        const child = Store.state.boards[item.boardId];
        if (child) { child.name = v; Store.save(); }
        Board.renderBreadcrumbs();
      }, { multiline: false });
      el.appendChild(title);

      const count = document.createElement("div");
      count.className = "board-count";
      const n = Store.boardStats(item.boardId).count;
      count.textContent = n === 1 ? "1 item" : `${n} items`;
      el.appendChild(count);

      el.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        Board.open(item.boardId);
      });
    },

    column(el, item) {
      el.appendChild(editable("div", "card-title", item.title || "", commit(item.id, "title"), { multiline: false }));
    },
  };

  function todoRow(item, index, todo) {
    const row = document.createElement("div");
    row.className = "todo-item" + (todo.done ? " done" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = todo.done;
    cb.addEventListener("mousedown", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      const todos = Store.board().items[item.id].todos.map((t, i) => i === index ? { ...t, done: cb.checked } : t);
      Store.update(item.id, { todos }, { withSnapshot: true });
      Board.renderItem(item.id);
    });
    row.appendChild(cb);

    const text = editable("div", "todo-text", todo.text, (v) => {
      const cur = Store.board().items[item.id];
      if (!cur) return;
      let todos;
      if (v.trim() === "") {
        todos = cur.todos.filter((_, i) => i !== index);
      } else {
        todos = cur.todos.map((t, i) => i === index ? { ...t, text: v } : t);
      }
      if (JSON.stringify(todos) !== JSON.stringify(cur.todos)) {
        Store.update(item.id, { todos }, { withSnapshot: true });
        Board.renderItem(item.id);
      }
    }, { multiline: false });

    // Enter on a task adds the next one
    text.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const cur = Store.board().items[item.id];
        const todos = cur.todos.map((t, i) => i === index ? { ...t, text: text.innerText.trim() } : t);
        todos.splice(index + 1, 0, { text: "", done: false });
        Store.update(item.id, { todos }, { withSnapshot: true });
        Board.renderItem(item.id, { focus: `.todo-item:nth-child(${index + 2}) .todo-text` });
      }
    });
    row.appendChild(text);
    return row;
  }

  return { render, position, DEFAULTS };
})();
