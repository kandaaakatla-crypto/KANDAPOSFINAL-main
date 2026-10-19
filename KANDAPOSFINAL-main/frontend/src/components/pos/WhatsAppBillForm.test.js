import React, { act } from "react";
import { createRoot } from "react-dom/client";
import WhatsAppBillForm from "./WhatsAppBillForm";
import { receiptsApi } from "../../api/client";

jest.mock("../../api/client", () => ({ receiptsApi: { whatsapp: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const $ = (id) => container.querySelector(`[data-testid="${id}"]`);
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

it("WhatsApps the bill, with a review request when ticked", async () => {
  receiptsApi.whatsapp.mockResolvedValue({ ok: true, sent: ["bill", "review"] });
  act(() => root.render(<WhatsAppBillForm orderId="o1" defaultPhone="" canAskReview />));
  type($("wa-bill-phone"), "98765 43210");
  await click($("wa-bill-review"));
  await click($("wa-bill-send"));
  expect(receiptsApi.whatsapp).toHaveBeenCalledWith("o1", "98765 43210", true);
});

it("prefills the customer's number and hides the review option without a review link", () => {
  act(() => root.render(<WhatsAppBillForm orderId="o1" defaultPhone="+919876543210" canAskReview={false} />));
  expect($("wa-bill-phone").value).toBe("+919876543210");
  expect($("wa-bill-review")).toBeNull();
});
