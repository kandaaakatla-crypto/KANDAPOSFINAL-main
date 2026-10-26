// Run with: node --test electron/devices.test.js
const test = require("node:test");
const assert = require("node:assert");
const { classify, portTransport } = require("./devices");

test("portTransport reads how a queue is attached", () => {
  assert.strictEqual(portTransport("USB001"), "USB");
  assert.strictEqual(portTransport("COM5"), "Serial");
  assert.strictEqual(portTransport("IP_192.168.1.9"), "Network");
  assert.strictEqual(portTransport("BTHPRINT"), "Bluetooth");
});

const RAW = {
  printers: [
    { Name: "EPSON TM-T82", PortName: "USB001", DriverName: "x" },
    { Name: "Microsoft Print to PDF", PortName: "PORTPROMPT:", DriverName: "y" },
    { Name: "Rongta BT", PortName: "COM7", DriverName: "z" },
  ],
  serial: [
    { Name: "Standard Serial over Bluetooth link (COM7)", DeviceID: "BTHENUM\\{00001101}" },
    { Name: "USB Serial Port (COM3)", DeviceID: "USB\\VID_1A86" },
  ],
  pnp: [
    { FriendlyName: "USB Root Hub (USB 3.0)", Class: "USB", InstanceId: "USB\\ROOT" },
    { FriendlyName: "Honeywell Voyager 1250g", Class: "HIDClass", InstanceId: "HID\\VID_0C2E" },
    { FriendlyName: "HID Keyboard Device", Class: "Keyboard", InstanceId: "HID\\KBD1" },
    { FriendlyName: "JBL Flip 5", Class: "Bluetooth", InstanceId: "BTHENUM\\DEV_1" },
    { FriendlyName: "Bluetooth Radio", Class: "Bluetooth", InstanceId: "USB\\RADIO" },
    { FriendlyName: "POS-80 Thermal Printer", Class: "Printer", InstanceId: "USB\\VID_0416" },
  ],
};

test("classify builds one tidy list", () => {
  const out = classify(RAW);
  const byId = Object.fromEntries(out.map((d) => [d.id, d]));
  assert.ok(byId["queue:EPSON TM-T82"].printable);
  assert.strictEqual(byId["queue:EPSON TM-T82"].connection, "USB");
  assert.strictEqual(byId["queue:Microsoft Print to PDF"], undefined, "virtual printers hidden");
  assert.strictEqual(byId["serial:COM7"].connection, "Bluetooth");
  assert.strictEqual(byId["serial:COM3"].connection, "Serial");
  assert.strictEqual(byId["pnp:HID\\VID_0C2E"].kind, "scanner");
  assert.strictEqual(byId["pnp:HID\\KBD1"].kind, "input");
  assert.strictEqual(byId["pnp:BTHENUM\\DEV_1"].kind, "bluetooth");
  assert.strictEqual(byId["pnp:USB\\ROOT"], undefined, "hubs are noise");
  assert.strictEqual(byId["pnp:USB\\RADIO"], undefined, "the PC's own radio is noise");
  const unpaired = byId["pnp:USB\\VID_0416"];
  assert.strictEqual(unpaired.kind, "printer");
  assert.strictEqual(unpaired.printable, false);
});

test("a single object (PowerShell collapses 1-item arrays) is accepted", () => {
  const out = classify({ printers: { Name: "Star TSP100", PortName: "USB002" }, serial: null, pnp: undefined });
  assert.strictEqual(out.length, 1);
});
