const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const { printEscposOverNetwork } = require("./printer");

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
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  // Only meaningful for a packaged, installed build — checks the GitHub
  // Releases feed configured in package.json's `build.publish` (see
  // .github/workflows/build-windows.yml, which is what actually publishes
  // a release) and silently no-ops in dev, matching electron-updater's own
  // guidance for `electron .`/unpackaged runs.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Best-effort — no update server reachable is not fatal to running the app.
    });
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
