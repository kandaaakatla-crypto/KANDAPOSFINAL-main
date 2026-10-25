import { getHardware, saveHardware, resolvePrinter, kickDrawerForCash, DRAWER_KICK_BYTES } from "./hardware";

beforeEach(() => { localStorage.clear(); delete window.kandaDesktop; });

test("defaults and persistence", () => {
  expect(getHardware()).toEqual({ printer: null, drawerOnCash: false });
  saveHardware({ printer: { host: "192.168.1.9", port: 9100 } });
  expect(getHardware().printer.host).toBe("192.168.1.9");
});

test("store-level printer wins over the device choice", () => {
  saveHardware({ printer: { host: "192.168.1.9", port: 9100 } });
  expect(resolvePrinter({ printer_host: "10.0.0.5" })).toEqual({ host: "10.0.0.5", port: 9100 });
  expect(resolvePrinter({})).toEqual({ host: "192.168.1.9", port: 9100 });
});

test("cash drawer only kicks when enabled and a printer exists", async () => {
  const printEscpos = jest.fn().mockResolvedValue();
  window.kandaDesktop = { isElectron: true, printEscpos };
  expect(await kickDrawerForCash({})).toBe(false);          // not enabled
  saveHardware({ drawerOnCash: true });
  expect(await kickDrawerForCash({})).toBe(false);          // no printer
  saveHardware({ printer: { host: "192.168.1.9", port: 9100 } });
  expect(await kickDrawerForCash({})).toBe(true);
  expect(printEscpos).toHaveBeenCalledWith("192.168.1.9", 9100, DRAWER_KICK_BYTES);
});

test("a failing printer never throws", async () => {
  window.kandaDesktop = { isElectron: true, printEscpos: jest.fn().mockRejectedValue(new Error("offline")) };
  saveHardware({ drawerOnCash: true, printer: { host: "192.168.1.9", port: 9100 } });
  expect(await kickDrawerForCash({})).toBe(false);
});
