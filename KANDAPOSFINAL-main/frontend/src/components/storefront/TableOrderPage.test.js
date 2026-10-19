import React, { act } from "react";
import { createRoot } from "react-dom/client";
import TableOrderPage from "./TableOrderPage";
import { storefrontApi } from "../../api/storefrontClient";

// Jest can't resolve react-router v7's package exports here; the page only
// needs useParams.
jest.mock("react-router-dom", () => ({ useParams: () => ({ slug: "spice-hub", number: "4" }) }), { virtual: true });

// The options modal pulls in shadcn's "@/" alias, which Jest doesn't map.
jest.mock("./StorefrontItemModal", () => () => null);

jest.mock("../../api/storefrontClient", () => ({
  storefrontApi: {
    menu: jest.fn(),
    table: jest.fn(),
    tableBill: jest.fn(),
    placeTableOrder: jest.fn(),
    requestOtp: jest.fn(),
    verifyOtp: jest.fn(),
    me: jest.fn(),
    createPaymentOrder: jest.fn(),
    verifyPayment: jest.fn(),
  },
}));

const MENU = {
  tenant: { name: "Spice Hub", onlinePayments: true },
  categories: [{ id: "c1", name: "Starters" }],
  items: [{ id: "i1", catId: "c1", name: "Paneer Tikka", price: 200, available: true }],
};

let container;
let root;

beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  storefrontApi.menu.mockResolvedValue(MENU);
  storefrontApi.table.mockResolvedValue({ number: 4 });
  storefrontApi.placeTableOrder.mockResolvedValue({ orderId: "o1", orderNumber: 12, total: 210 });
  storefrontApi.createPaymentOrder.mockRejectedValue({ response: { data: { detail: "no razorpay in tests" } } });
  window.Razorpay = function Razorpay() {};
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.Razorpay;
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

async function renderAndCheckout() {
  act(() => {
    root.render(<TableOrderPage />);
  });
  await flush();
  await click(byTestId("sf-item-i1"));
  await click(byTestId("sf-view-cart"));
  await click(byTestId("sf-checkout-btn"));
}

describe("QR table ordering when the store doesn't require a phone code", () => {
  it("pays online straight away, with no phone verification step", async () => {
    await renderAndCheckout();
    await click(byTestId("table-pay-online"));
    await flush();

    expect(byTestId("table-auth-step")).toBeNull();
    expect(storefrontApi.requestOtp).not.toHaveBeenCalled();
    expect(storefrontApi.placeTableOrder).toHaveBeenCalledTimes(1);
    expect(storefrontApi.createPaymentOrder).toHaveBeenCalledWith("spice-hub", "o1", 210);
  });

  it("has no sign-in button in the header", async () => {
    await renderAndCheckout();
    expect(byTestId("sf-account-btn")).toBeNull();
  });
});

describe("Your bill tab", () => {
  const BILL = {
    open: true, orderId: "o9", orderNumber: 31, paid: false,
    items: [{ name: "Paneer Tikka", qty: 2, price: 200, mods: [] }],
    subtotal: 400, taxTotal: 20, cgst: 10, sgst: 10, serviceCharge: 0, discount: 0, total: 420,
  };

  async function openBill() {
    act(() => { root.render(<TableOrderPage />); });
    await flush();
    await click(byTestId("sf-tab-bill"));
    await flush();
  }

  it("shows the table's running bill and pays it online", async () => {
    storefrontApi.tableBill.mockResolvedValue(BILL);
    await openBill();
    expect(storefrontApi.tableBill).toHaveBeenCalledWith("spice-hub", "4");
    expect(byTestId("table-bill").textContent).toContain("Paneer Tikka");
    expect(byTestId("table-bill-total").textContent).toContain("420.00");

    await click(byTestId("table-bill-pay"));
    await flush();
    expect(storefrontApi.createPaymentOrder).toHaveBeenCalledWith("spice-hub", "o9", 420);
  });

  it("says when nothing has been ordered yet", async () => {
    storefrontApi.tableBill.mockResolvedValue({ open: false });
    await openBill();
    expect(byTestId("table-bill-empty")).not.toBeNull();
    expect(byTestId("table-bill-pay")).toBeNull();
  });
});

describe("Item notes in the cart", () => {
  const type = (el, value) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  it("lets the guest add a short note to a line and sends it with the order", async () => {
    act(() => { root.render(<TableOrderPage />); });
    await flush();
    await click(byTestId("sf-item-i1"));
    await click(byTestId("sf-view-cart"));

    const lineId = document.querySelector('[data-testid^="sf-line-note-btn-"]').dataset.testid.replace("sf-line-note-btn-", "");
    await click(byTestId(`sf-line-note-btn-${lineId}`));
    const input = byTestId(`sf-line-note-${lineId}`);
    expect(input.maxLength).toBe(140);
    await type(input, "less spicy");
    await act(async () => { input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    expect(byTestId(`sf-line-note-btn-${lineId}`).textContent).toBe("Note: less spicy");

    await click(byTestId("sf-checkout-btn"));
    await click(byTestId("table-pay-later"));
    await flush();
    const sent = storefrontApi.placeTableOrder.mock.calls[0][2];
    expect(sent.items[0].note).toBe("less spicy");
  });

  it("sends no note when none was added", async () => {
    await renderAndCheckout();
    await click(byTestId("table-pay-later"));
    await flush();
    expect(storefrontApi.placeTableOrder.mock.calls[0][2].items[0].note).toBeUndefined();
  });
});

describe("QR table ordering with phone verification", () => {
  const MENU_OTP = { ...MENU, tenant: { ...MENU.tenant, qrOtpRequired: true } };
  const type = (el, value) => act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  beforeEach(() => {
    storefrontApi.menu.mockResolvedValue(MENU_OTP);
    storefrontApi.requestOtp.mockResolvedValue({ ok: true, phone: "+919876543210", channel: "whatsapp", resendIn: 30 });
    storefrontApi.verifyOtp.mockResolvedValue({
      token: "tok123", name: "Ravi", phone: "+919876543210",
      expiresAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    });
  });

  it("asks for name, phone and code before the first order, then places it verified", async () => {
    await renderAndCheckout();
    expect(byTestId("table-auth-step")).not.toBeNull();
    expect(byTestId("table-payment-step")).toBeNull();

    await type(byTestId("table-auth-name"), "Ravi");
    await type(byTestId("table-auth-phone"), "98765 43210");
    await click(byTestId("table-auth-send"));
    await flush();
    expect(storefrontApi.requestOtp).toHaveBeenCalledWith("spice-hub", "Ravi", "98765 43210");
    const resend = byTestId("table-auth-resend");
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toMatch(/Resend code in \d+s/);

    await type(byTestId("table-auth-code"), "123456");
    await click(byTestId("table-auth-verify"));
    await flush();
    expect(storefrontApi.verifyOtp).toHaveBeenCalledWith("spice-hub", "98765 43210", "123456");
    expect(JSON.parse(window.localStorage.getItem("kanda_sf_session_spice-hub")).token).toBe("tok123");

    await click(byTestId("table-pay-later"));
    await flush();
    expect(storefrontApi.placeTableOrder).toHaveBeenCalledWith("spice-hub", "4", expect.objectContaining({ items: expect.any(Array) }), "tok123");
    expect(byTestId("table-order-confirmed")).not.toBeNull();
  });

  it("doesn't ask again on this device while the session is valid", async () => {
    window.localStorage.setItem("kanda_sf_session_spice-hub", JSON.stringify({
      token: "tokOld", name: "Ravi", phone: "+919876543210",
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    }));
    await renderAndCheckout();
    expect(byTestId("table-auth-step")).toBeNull();
    await click(byTestId("table-pay-later"));
    await flush();
    expect(storefrontApi.requestOtp).not.toHaveBeenCalled();
    expect(storefrontApi.placeTableOrder.mock.calls[0][3]).toBe("tokOld");
  });

  it("asks again when the server says the session is no longer valid", async () => {
    window.localStorage.setItem("kanda_sf_session_spice-hub", JSON.stringify({ token: "tokBad", name: "Ravi", phone: "+919876543210" }));
    storefrontApi.placeTableOrder.mockRejectedValueOnce({ response: { status: 401, data: { detail: "Session expired" } } });
    await renderAndCheckout();
    await click(byTestId("table-pay-later"));
    await flush();
    expect(byTestId("table-auth-step")).not.toBeNull();
    expect(window.localStorage.getItem("kanda_sf_session_spice-hub")).toBeNull();
  });
});
