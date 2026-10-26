import { getHardware, saveHardware, resolvePrinter, kickDrawerForCash, canSendTo, sendBytes, printerLabel, DRAWER_KICK_BYTES } from "./hardware";

beforeEach(() => { localStorage.clear(); delete window.kandaDesktop; });

test("defaults and persistence", () => {
  expect(getHardware()).toEqual({ printer: null, drawerOnCash: false });
  saveHardware({ printer: { host: "192.168.1.9", port: 9100 } });
  expect(getHardware().printer.host).toBe("192.168.1.9");
});

test("old { host, port } saves are treated as network printers", () => {
  saveHardware({ printer: { host: "192.168.1.9", port: 9100 } });
  expect(resolvePrinter({})).toMatchObject({ transport: "network", host: "192.168.1.9", port: 9100 });
});

test("store-level printer wins over the device choice", () => {
  saveHardware({ printer: { transport: "queue", address: "EPSON TM-T82" } });
  expect(resolvePrinter({ printer_host: "10.0.0.5" })).toMatchObject({ transport: "network", host: "10.0.0.5", port: 9100 });
  expect(resolvePrinter({})).toMatchObject({ transport: "queue", address: "EPSON TM-T82" });
});

test("labels", () => {
  expect(printerLabel({ transport: "network", host: "10.0.0.5", port: 9100 })).toBe("10.0.0.5:9100");
  expect(printerLabel({ transport: "queue", address: "EPSON TM-T82", name: "EPSON TM-T82" })).toBe("EPSON TM-T82");
});

test("USB, Bluetooth and serial printers are sent through printRaw", async () => {
  const printRaw = jest.fn().mockResolvedValue();
  window.kandaDesktop = { isElectron: true, printRaw };
  for (const printer of [
    { transport: "queue", address: "EPSON TM-T82" },
    { transport: "serial", address: "COM7" },
    { transport: "network", host: "192.168.1.9", port: 9100 },
  ]) {
    expect(canSendTo(printer)).toBe(true);
    await sendBytes(printer, [1, 2, 3]);
  }
  expect(printRaw).toHaveBeenCalledWith({ transport: "queue", host: undefined, port: undefined, address: "EPSON TM-T82" }, [1, 2, 3]);
  expect(printRaw).toHaveBeenCalledWith({ transport: "serial", host: undefined, port: undefined, address: "COM7" }, [1, 2, 3]);
  expect(printRaw).toHaveBeenCalledTimes(3);
});

test("queue / serial printers need the Windows app", async () => {
  expect(canSendTo({ transport: "queue", address: "x" })).toBe(false);
  await expect(sendBytes({ transport: "queue", address: "x" }, [1])).rejects.toThrow(/Windows app/);
});

test("cash drawer only kicks when enabled and a printer exists", async () => {
  const printRaw = jest.fn().mockResolvedValue();
  window.kandaDesktop = { isElectron: true, printRaw };
  expect(await kickDrawerForCash({})).toBe(false);          // not enabled
  saveHardware({ drawerOnCash: true });
  expect(await kickDrawerForCash({})).toBe(false);          // no printer
  saveHardware({ printer: { transport: "queue", address: "EPSON TM-T82" } });
  expect(await kickDrawerForCash({})).toBe(true);
  expect(printRaw).toHaveBeenCalledWith(expect.objectContaining({ transport: "queue", address: "EPSON TM-T82" }), DRAWER_KICK_BYTES);
});

test("a failing printer never throws", async () => {
  window.kandaDesktop = { isElectron: true, printRaw: jest.fn().mockRejectedValue(new Error("offline")) };
  saveHardware({ drawerOnCash: true, printer: { transport: "serial", address: "COM7" } });
  expect(await kickDrawerForCash({})).toBe(false);
});
