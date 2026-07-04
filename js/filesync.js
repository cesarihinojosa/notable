"use strict";

// Optional write-through persistence to a real file via the File System Access
// API. IndexedDB stays the always-on store; when a file is linked it becomes
// the source of truth on startup and every save is mirrored into it.
// Browsers without the API (Firefox, Safari, stock Brave) never see the UI.
const FileSync = (() => {
  const pickerSupported = "showSaveFilePicker" in window;
  const PICKER_TYPES = [{ description: "Notable boards", accept: { "application/json": [".json"] } }];

  let handle = null;
  let status = "unlinked"; // unlinked | linked | saving | reconnect | error
  let writeTimer = null;

  const pill = document.getElementById("file-status");
  const label = document.getElementById("file-label");

  function setStatus(s) {
    status = s;
    pill.dataset.state = s;
    pill.hidden = !pickerSupported && !handle;
    const name = handle ? handle.name : "";
    label.textContent = {
      unlinked: "Save to file",
      linked: name,
      saving: name + "…",
      reconnect: name + " — reconnect",
      error: name + " — save failed",
    }[s];
    pill.title = {
      unlinked: "Back up your boards to a file on this computer",
      linked: "Auto-saving to " + name,
      saving: "Saving to " + name + "…",
      reconnect: "Click to reconnect your board file",
      error: "Could not write to " + name + " — click for options",
    }[s];
  }

  async function init() {
    try { handle = (await DB.get("state", "fileHandle")) || null; } catch { handle = null; }
    if (!handle) { setStatus("unlinked"); return; }
    try {
      const perm = handle.queryPermission ? await handle.queryPermission({ mode: "readwrite" }) : "granted";
      if (perm === "granted") await loadFromFile();
      else setStatus("reconnect");
    } catch (e) {
      console.warn("Board file unavailable", e);
      setStatus("error");
    }
  }

  async function loadFromFile() {
    const file = await handle.getFile();
    const text = await file.text();
    if (text.trim()) await Store.importData(JSON.parse(text));
    setStatus("linked");
  }

  async function reconnect() {
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") return;
    await loadFromFile();
    Board.renderBoard();
  }

  function scheduleWrite() {
    if (!handle || status === "reconnect") return;
    clearTimeout(writeTimer);
    writeTimer = setTimeout(write, 1000);
  }

  async function write() {
    if (!handle) return;
    try {
      setStatus("saving");
      const text = await Store.exportJSON();
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
      setStatus("linked");
    } catch (e) {
      console.warn("Board file write failed", e);
      setStatus("error");
    }
  }

  async function setHandle(h) {
    handle = h;
    await DB.put("state", "fileHandle", h);
  }

  async function linkNew() {
    const h = await window.showSaveFilePicker({ suggestedName: "notable-boards.json", types: PICKER_TYPES });
    await setHandle(h);
    await write();
  }

  const hasUnsavedWorkspace = () =>
    !handle && Object.values(Store.state.boards).some(b => Object.keys(b.items).length);

  async function openFile() {
    const [h] = await window.showOpenFilePicker({ types: PICKER_TYPES });
    if (hasUnsavedWorkspace() &&
        !confirm("Opening a file replaces your current boards (they are not saved to any file). Continue?")) return;
    await setHandle(h);
    await loadFromFile();
    Board.renderBoard();
  }

  async function newFile() {
    const h = await window.showSaveFilePicker({ suggestedName: "new-boards.json", types: PICKER_TYPES });
    if (hasUnsavedWorkspace() &&
        !confirm("Starting a new file replaces your current boards (they are not saved to any file). Continue?")) return;
    await setHandle(h);
    await Store.reset();
    await write();
    Board.renderBoard();
  }

  async function unlink() {
    handle = null;
    clearTimeout(writeTimer);
    await DB.del("state", "fileHandle");
    setStatus("unlinked");
  }

  // ---- pill + menu ----
  let menuEl = null;

  pill.addEventListener("click", () => {
    if (status === "reconnect") {
      reconnect().catch((e) => { console.warn(e); setStatus("error"); });
      return;
    }
    if (menuEl) closeMenu(); else openMenu();
  });

  function openMenu() {
    menuEl = document.createElement("div");
    menuEl.className = "popmenu";
    const items = [];
    if (pickerSupported) {
      if (!handle) items.push(["Save boards to file…", linkNew]);
      items.push(["Open board file…", openFile]);
      items.push(["New board file…", newFile]);
    }
    if (handle) {
      if (status === "error") items.push(["Retry save", write]);
      items.push(["Unlink file", unlink, "danger"]);
    }
    for (const [text, fn, cls] of items) {
      const b = document.createElement("button");
      b.textContent = text;
      if (cls) b.className = cls;
      b.addEventListener("click", () => {
        closeMenu();
        fn().catch((err) => {
          if (err && err.name === "AbortError") return; // user cancelled the picker
          console.warn(err);
          alert("File operation failed: " + err.message);
        });
      });
      menuEl.appendChild(b);
    }
    document.body.appendChild(menuEl);
    const r = pill.getBoundingClientRect();
    menuEl.style.top = (r.bottom + 6) + "px";
    menuEl.style.right = (window.innerWidth - r.right) + "px";
    setTimeout(() => window.addEventListener("mousedown", onDocDown), 0);
  }

  function onDocDown(e) {
    if (menuEl && !menuEl.contains(e.target) && !pill.contains(e.target)) closeMenu();
  }

  function closeMenu() {
    window.removeEventListener("mousedown", onDocDown);
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  return { init, scheduleWrite };
})();
