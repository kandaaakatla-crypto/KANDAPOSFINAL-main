import { listWebDevices, pairWebDevice, webSupport } from "./webDevices";

const setNav = (props) => {
  Object.defineProperty(global.navigator, "usb", { value: props.usb, configurable: true });
  Object.defineProperty(global.navigator, "serial", { value: props.serial, configurable: true });
  Object.defineProperty(global.navigator, "hid", { value: props.hid, configurable: true });
  Object.defineProperty(global.navigator, "bluetooth", { value: props.bluetooth, configurable: true });
};

afterEach(() => setNav({}));

test("support reflects what the browser exposes", () => {
  setNav({ usb: {}, serial: undefined });
  expect(webSupport()).toMatchObject({ usb: true, serial: false });
});

test("granted USB, serial and HID devices appear in one list", async () => {
  setNav({
    usb: {
      getDevices: async () => [
        { vendorId: 0x04b8, productId: 0x0e15, productName: "TM-T82", deviceClass: 0, configurations: [{ interfaces: [{ alternates: [{ interfaceClass: 7 }] }] }] },
        { vendorId: 1, productId: 2, productName: "Webcam", deviceClass: 239, configurations: [] },
      ],
    },
    serial: { getPorts: async () => [{ getInfo: () => ({}) }] },
    hid: { getDevices: async () => [{ vendorId: 3, productId: 4, productName: "Honeywell Scanner" }] },
  });
  const list = await listWebDevices();
  const by = Object.fromEntries(list.map((d) => [d.name, d]));
  expect(by["TM-T82"]).toMatchObject({ kind: "printer", transport: "webusb", printable: true });
  expect(by["Webcam"]).toMatchObject({ kind: "usb", printable: false });
  expect(by["Bluetooth / serial port"]).toMatchObject({ transport: "webserial", connection: "Bluetooth" });
  expect(by["Honeywell Scanner"].kind).toBe("scanner");
});

test("a browser that throws still returns what it can", async () => {
  setNav({ usb: { getDevices: async () => { throw new Error("blocked"); } }, serial: { getPorts: async () => [] } });
  expect(await listWebDevices()).toEqual([]);
});

test("pairing opens the chooser and reports a dismissed one as false", async () => {
  const requestDevice = jest.fn().mockResolvedValue({});
  setNav({ usb: { requestDevice } });
  expect(await pairWebDevice("usb")).toBe(true);
  expect(requestDevice).toHaveBeenCalled();
  setNav({ usb: { requestDevice: jest.fn().mockRejectedValue(new Error("NotFoundError")) } });
  expect(await pairWebDevice("usb")).toBe(false);
});
