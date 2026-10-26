const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { printEscposOverNetwork } = require("./printer");
const { discoverPrinters } = require("./discovery");
const { listSystemDevices, printRaw } = require("./devices");

// Scans this machine's own private subnets for raw-print (port 9100) devices.
ipcMain.handle("kanda:discover-printers", async () => discoverPrinters());

// Everything plugged in or paired (printers, COM/Bluetooth ports, scanners, USB devices).
ipcMain.handle("kanda:list-devices", async () => listSystemDevices());

// Raw bytes to a network, USB/Bluetooth (Windows queue) or serial printer.
ipcMain.handle("kanda:print-raw", async (_evt, args) => printRaw(args));

ipcMain.handle("kanda:print-escpos", async (_evt, { host, port, bytes }) => {
  await printEscposOverNetwork({ host, port, bytes });
});

// Dev: loads the CRA dev server so HMR keeps working. Packaged: loads the
// same static `build/` output the web/Firebase deploy ships, straight off
// disk — no separate build step for Electron beyond `npm run build`.
const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    win.loadURL("http://localhost:3000");
  } else {
    win.loadFile(path.join(__dirname, "..", "build", "index.html"));
  }

  // The app never navigates itself to a new top-level URL or opens
  // popups — every screen is a client-side React Router route within the
  // page the window already loaded. Block both so a link in customer-facing
  // content (e.g. QR-ordering pages rendered in this same bundle) can't
  // carry the desktop window to an external site.
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // Reloading is never useful on this till: the app is a client-side-routed
  // SPA loaded from a file:// URL with no fallback handler, so a reload
  // triggered while on a nested route (e.g. /demo/orders) tries to load that
  // path as a literal file and blanks the window with a load error.
  // setApplicationMenu(null) below already removes the menu that normally
  // carries the Ctrl+R/Ctrl+Shift+R "reload" accelerators; this is
  // defense-in-depth in case a key still reaches the page (F5 isn't a menu
  // role at all, and before-input-event fires ahead of any menu shortcut).
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const key = input.key.toLowerCase();
    if (key === "f5" || ((input.control || input.meta) && key === "r")) {
      event.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  // Kiosk till: no menu bar, no reload/devtools accelerators for staff to hit.
  Menu.setApplicationMenu(null);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Only meaningful for a packaged, installed build — checks the feed
  // configured in package.json's `build.publish` (a dedicated public
  // Firebase Hosting site, kandapos-desktop-releases, kept separate from
  // this private source repo so end users' apps can check for updates
  // without needing repo access; see .github/workflows/build-windows.yml,
  // which is what actually publishes a release there) and silently no-ops
  // in dev, matching electron-updater's own guidance for `electron .`/
  // unpackaged runs.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Best-effort — no update server reachable is not fatal to running the app.
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
