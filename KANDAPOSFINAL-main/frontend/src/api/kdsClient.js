import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

/** Stateless KDS client — token is appended to every call.
 *  Auth is by long-lived tenant `kds_token` (issued by the Platform Owner), so
 *  no axios interceptor / Authorization header is needed.
 */
export const kdsApi = {
  tickets: (token, station = "all") =>
    axios.get(`${API}/kds/tickets`, { params: { token, station } }).then((r) => r.data),
  setItemStatus: (token, orderId, itemIndex, status) =>
    axios.patch(`${API}/kds/orders/${orderId}/items/${itemIndex}`, { status }, { params: { token } }).then((r) => r.data),
  recall: (token, orderId) =>
    axios.patch(`${API}/kds/orders/${orderId}/recall`, {}, { params: { token } }).then((r) => r.data),
};

export const KDS_WS_URL = (token) => {
  // We re-use the same WebSocket endpoint as the POS so KDS hears every order.upserted +
  // kds.ticket event for its tenant. Auth on /ws is via a JWT `token=` query — KDS doesn't
  // have a JWT, so it polls instead. We keep this helper exported for a future per-tenant
  // KDS-channel WS upgrade.
  return null;
};
