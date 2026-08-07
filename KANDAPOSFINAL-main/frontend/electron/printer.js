const net = require("net");

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

module.exports = { printEscposOverNetwork };
