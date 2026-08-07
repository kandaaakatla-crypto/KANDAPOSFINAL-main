const { contextBridge, ipcRenderer } = require("electron");

// Renderer stays plain web code (same bundle as the browser/Android builds)
// — nodeIntegration is off, so this bridge is the only Node-side surface
// it can reach. `printEscpos` sends already-built ESC/POS bytes (see
// src/utils/escpos.js) to a networked thermal printer via the main
// process's raw TCP socket (electron/printer.js) — no server round trip.
contextBridge.exposeInMainWorld("kandaDesktop", {
  isElectron: true,
  printEscpos: (host, port, bytes) =>
    ipcRenderer.invoke("kanda:print-escpos", { host, port, bytes: Array.from(bytes) }),
});
