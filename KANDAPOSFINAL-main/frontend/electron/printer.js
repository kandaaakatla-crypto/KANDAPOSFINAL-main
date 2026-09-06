const net = require("net");

// Thermal printers on a store's LAN only ever have a private/loopback
// address — never a public IP. Restricting to these ranges closes off using
// this IPC as an arbitrary-host TCP-write primitive (the host/port come from
// tenant-configured store settings, i.e. renderer-controlled input) while
// still covering every real printer setup.
const PRIVATE_HOST_PATTERNS = [
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
];

// A full ESC/POS ticket (text + barcode/QR commands) is a few KB at most;
// 64KB is generous headroom without leaving the socket write unbounded.
const MAX_PAYLOAD_BYTES = 65536;

function assertValidPrintTarget({ host, port, bytes }) {
  if (typeof host !== "string" || !PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    throw new Error("Printer host must be a private network address");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Printer port must be an integer between 1 and 65535");
  }
  if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > MAX_PAYLOAD_BYTES) {
    throw new Error(`Print payload must be between 1 and ${MAX_PAYLOAD_BYTES} bytes`);
  }
}

// Thermal POS printers overwhelmingly expose either a raw TCP socket on
// port 9100 (network/WiFi printers — the common setup for restaurants,
// including cheap Epson/Xprinter clones) or a USB/serial port. This only
// implements the network transport: it needs zero native dependencies (no
// node-gyp prebuild matrix to maintain across Electron's ABI versions,
// unlike `serialport`/`node-usb`), and this environment has no real
// hardware to verify either path against — USB/serial is a documented
// extension point here, not built speculatively ahead of a confirmed need.
//
// Barcode scanners aren't handled here at all: the ones used with this app
// are keyboard-wedge HID devices, which the existing web UI already reads
// through normal input focus — no native bridge needed unless that proves
// insufficient.
function printEscposOverNetwork({ host, port = 9100, bytes }) {
  assertValidPrintTarget({ host, port, bytes });
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out connecting to printer at ${host}:${port}`));
    }, 5000);
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.connect(port, host, () => {
      socket.write(Buffer.from(bytes), (err) => {
        clearTimeout(timer);
        if (err) {
          socket.destroy();
          reject(err);
          return;
        }
        socket.end();
        resolve();
      });
    });
  });
}

module.exports = { printEscposOverNetwork, assertValidPrintTarget };
