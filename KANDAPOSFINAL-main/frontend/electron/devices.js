const { execFile } = require("child_process");
const fs = require("fs");
const { printEscposOverNetwork } = require("./printer");

// Everything plugged in or paired with this PC, in one list: installed
// printers (USB, Bluetooth and network queues), serial/Bluetooth COM ports,
// scanners and other USB/Bluetooth/HID devices. Windows is the supported
// desktop target, so enumeration is a single PowerShell call. On other
// systems only the network-printer scan (discovery.js) is available.

const PS_LIST = `
$ErrorActionPreference = 'SilentlyContinue'
$printers = @(Get-Printer | Select-Object Name, PortName, DriverName)
$serial = @(Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\(COM\\d+\\)' } | Select-Object Name, DeviceID)
$pnp = @(Get-PnpDevice -PresentOnly | Where-Object { $_.Class -in 'USB','Bluetooth','HIDClass','Keyboard','Printer','PrintQueue','Image','Camera' } | Select-Object FriendlyName, Class, InstanceId)
@{ printers = $printers; serial = $serial; pnp = $pnp } | ConvertTo-Json -Depth 4 -Compress
`;

const VIRTUAL_PRINTER = /(pdf|xps|onenote|fax|send to|document writer|snagit|microsoft print|anydesk|root print queue|teamviewer|remote desktop|rdp)/i;
const NOISE = /(root hub|generic usb hub|usb hub|composite device|host controller|enumerator|radio|bluetooth device \((rfcomm|personal area)|usb input device|usb mass storage|virtual|protocol tdi|le generic attribute|gatt|avrcp|a2dp)/i;
// Built-in laptop plumbing and Bluetooth service profiles: never something a shop plugs in.
const INTERNAL = /(hid-compliant|i2c hid|ps\/2|event filter|input configuration|interrupt driver|consumer control|portable device control|system controller|touch pad|touchpad|touch screen|generic attribute|generic access|device information service|wireless bluetooth|bluetooth adapter|bluetooth le|service discovery)/i;
const SCANNER_HINT = /(scanner|barcode|symbol|zebra|honeywell|datalogic|opticon|newland|motorola|metrologic|netum|eyoyo|tera|socket mobile)/i;
const PRINTER_HINT = /(printer|pos-|thermal|epson|tm-|star|bixolon|xprinter|citizen|rongta|sewoo|munbyn|gprinter|zjiang)/i;

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

/** How a Windows printer queue is physically attached, from its port name. */
function portTransport(port = "") {
  if (/^USB/i.test(port)) return "USB";
  if (/^COM\d+/i.test(port)) return "Serial";
  if (/^(BTH|BLUETOOTH)/i.test(port)) return "Bluetooth";
  if (/^(IP_|\d+\.\d+\.\d+\.\d+|WSD|http)/i.test(port)) return "Network";
  return "Port " + port;
}

/**
 * Raw PowerShell output -> flat device list:
 * { id, kind: printer|serial|scanner|bluetooth|usb|input, name, connection, transport, address, printable }
 * transport/address are what printRaw needs (queue/serial); null when not printable.
 */
function classify(raw) {
  const out = [];
  const seen = new Set();
  const push = (d) => {
    if (seen.has(d.id)) return;
    seen.add(d.id);
    out.push(d);
  };

  for (const p of asArray(raw.printers)) {
    if (!p.Name || VIRTUAL_PRINTER.test(p.Name)) continue;
    push({
      id: `queue:${p.Name}`, kind: "printer", name: p.Name,
      connection: portTransport(p.PortName), transport: "queue", address: p.Name, printable: true,
    });
  }

  for (const s of asArray(raw.serial)) {
    const m = /\((COM\d+)\)/i.exec(s.Name || "");
    if (!m) continue;
    const isBt = /bluetooth/i.test(s.Name) || /BTHENUM/i.test(s.DeviceID || "");
    push({
      id: `serial:${m[1].toUpperCase()}`, kind: "serial", name: s.Name.replace(/\s*\(COM\d+\)/i, "") || m[1],
      connection: isBt ? "Bluetooth" : "Serial", transport: "serial", address: m[1].toUpperCase(), printable: true,
    });
  }

  for (const d of asArray(raw.pnp)) {
    const name = d.FriendlyName || "";
    if (!name || NOISE.test(name) || INTERNAL.test(name)) continue;
    const cls = d.Class;
    if (cls === "Printer" || cls === "PrintQueue") {
      // Already covered by the installed-printer list; a printer that is plugged in but has no
      // driver/queue yet still deserves a row so the person knows it was seen.
      if (VIRTUAL_PRINTER.test(name)) continue;
      push({ id: `pnp:${d.InstanceId}`, kind: "printer", name, connection: /^BTH/i.test(d.InstanceId) ? "Bluetooth" : "USB", transport: null, address: null, printable: false, note: "Detected, but no printer driver is installed for it yet." });
      continue;
    }
    let kind = "usb";
    if (SCANNER_HINT.test(name)) kind = "scanner";
    else if (cls === "HIDClass" || cls === "Keyboard") kind = "input";
    else if (cls === "Bluetooth") kind = "bluetooth";
    else if (PRINTER_HINT.test(name)) kind = "printer";
    const connection = /^BTH/i.test(d.InstanceId || "") || cls === "Bluetooth" ? "Bluetooth" : "USB";
    push({ id: `pnp:${d.InstanceId}`, kind, name, connection, transport: null, address: null, printable: false });
  }
  return out;
}

function runPowerShell(script, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout)),
    );
  });
}

async function listSystemDevices() {
  if (process.platform !== "win32") return [];
  const stdout = await runPowerShell(PS_LIST);
  if (!stdout.trim()) return [];
  return classify(JSON.parse(stdout));
}

// ---- raw printing -------------------------------------------------------

const COM_RE = /^COM\d{1,3}$/i;
const MAX_BYTES = 65536;

// Sends bytes to an installed Windows printer queue in RAW mode (no driver
// rendering), which is how ESC/POS reaches a USB or Bluetooth receipt printer.
// Name and data arrive through the environment, never spliced into the script.
const PS_RAW = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class KandaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Ansi)] public class DOCINFO { [MarshalAs(UnmanagedType.LPStr)] public string pDocName; [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)] public static extern bool StartDocPrinter(IntPtr h, int l, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static void Send(string name, byte[] data) {
    IntPtr h; if (!OpenPrinter(name, out h, IntPtr.Zero)) throw new Exception("Cannot open printer");
    try {
      DOCINFO di = new DOCINFO(); di.pDocName = "Kanda POS"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("StartDoc failed");
      StartPagePrinter(h);
      IntPtr p = Marshal.AllocCoTaskMem(data.Length); Marshal.Copy(data, 0, p, data.Length);
      int w; bool ok = WritePrinter(h, p, data.Length, out w); Marshal.FreeCoTaskMem(p);
      EndPagePrinter(h); EndDocPrinter(h);
      if (!ok) throw new Exception("WritePrinter failed");
    } finally { ClosePrinter(h); }
  }
}
"@
[KandaRaw]::Send($env:KP_NAME, [Convert]::FromBase64String($env:KP_B64))
`;

function assertBytes(bytes) {
  if (!Array.isArray(bytes) || bytes.length === 0 || bytes.length > MAX_BYTES) {
    throw new Error(`Print payload must be between 1 and ${MAX_BYTES} bytes`);
  }
}

/** transport: "network" {host,port} | "queue" {address: printer name} | "serial" {address: COMn} */
async function printRaw({ transport, host, port, address, bytes }) {
  assertBytes(bytes);
  if (transport === "network") return printEscposOverNetwork({ host, port: port || 9100, bytes });
  if (process.platform !== "win32") throw new Error("USB, Bluetooth and serial printing is only available on Windows");
  if (transport === "serial") {
    if (!COM_RE.test(address || "")) throw new Error("Invalid serial port");
    return fs.promises.writeFile(`\\\\.\\${address.toUpperCase()}`, Buffer.from(bytes));
  }
  if (transport === "queue") {
    if (typeof address !== "string" || !address || address.length > 200) throw new Error("Invalid printer name");
    await runPowerShell(PS_RAW, { KP_NAME: address, KP_B64: Buffer.from(bytes).toString("base64") });
    return undefined;
  }
  throw new Error("Unknown printer transport");
}

module.exports = { classify, listSystemDevices, printRaw, portTransport };
