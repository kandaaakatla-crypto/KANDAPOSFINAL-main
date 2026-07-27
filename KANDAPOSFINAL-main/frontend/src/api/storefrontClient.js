import axios from "axios";

const BASE = `${process.env.REACT_APP_BACKEND_URL}/api/storefront`;

/** Fully public client — no staff/dash/owner token involved. Pickup order
 *  placement (and, optionally, table order placement + payments + account)
 *  passes its own short-lived storefront session token explicitly. */
export const storefrontApi = {
  menu: (slug) => axios.get(`${BASE}/${slug}/menu`).then((r) => r.data),
  table: (slug, number) => axios.get(`${BASE}/${slug}/table/${number}`).then((r) => r.data),
  placeTableOrder: (slug, number, payload, token) =>
    axios.post(`${BASE}/${slug}/table/${number}/order`, payload, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined).then((r) => r.data),
  requestOtp: (slug, name, phone) =>
    axios.post(`${BASE}/${slug}/otp/request`, { name, phone }).then((r) => r.data),
  verifyOtp: (slug, phone, code) =>
    axios.post(`${BASE}/${slug}/otp/verify`, { phone, code }).then((r) => r.data),
  placePickupOrder: (slug, token, payload) =>
    axios.post(`${BASE}/${slug}/pickup/order`, payload, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
  me: (slug, token) =>
    axios.get(`${BASE}/${slug}/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.data),
  createPaymentOrder: (slug, orderId, amount) =>
    axios.post(`${BASE}/${slug}/payments/order`, { order_id: orderId, amount }).then((r) => r.data),
  verifyPayment: (slug, payload) =>
    axios.post(`${BASE}/${slug}/payments/verify`, payload).then((r) => r.data),
};
