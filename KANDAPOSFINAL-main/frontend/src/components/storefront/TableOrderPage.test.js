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

describe("QR table ordering without sign-in", () => {
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
