import React, { useState, useMemo, useEffect } from "react";
import { usePos } from "../../store/PosContext";
import { CATEGORIES, DELIVERY_FEE } from "../../data/mock";
import ItemModal from "./ItemModal";
import CartPanel from "./CartPanel";
import PaymentModal from "./PaymentModal";
import { CashDrawerPanel, TipPoolPanel } from "./OpsPanels";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Bike, ShoppingBag, UtensilsCrossed, Search, UserPlus, X, Phone, Info, DollarSign, Coins, ShoppingCart } from "lucide-react";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { toast } from "sonner";
import { loyaltyApi, ordersApi } from "../../api/client";
import { effectiveTaxRate, computeLineTax, computeOrderTax } from "../../utils/tax";

import { useSearchParams, useNavigate } from "react-router-dom";

const ORDER_TYPES = [
  { id: "delivery", label: "Delivery", icon: Bike },
  { id: "collection", label: "Collection", icon: ShoppingBag },
  { id: "dine-in", label: "Dine-In", icon: UtensilsCrossed },
];

export default function OrderScreen() {
  const { menuItems, categories, customers, upsertCustomer, tables, orders, placeOrder, appendToOrder, updateOrderStatus, staffUser } = usePos();
  const navigate = useNavigate();
  const [orderType, setOrderType] = useState("delivery");
  const [orderSource, setOrderSource] = useState("in-store");
  const [activeCat, setActiveCat] = useState("pizzas");
  const [cart, setCart] = useState([]);
  const [discount, setDiscount] = useState(0); // percent
  const [modalItem, setModalItem] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [zReportOpen, setZReportOpen] = useState(false);
  const [tipPoolOpen, setTipPoolOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  // new — checkout enhancements
  const [tipPct, setTipPct] = useState(0);
  const [coupon, setCoupon] = useState(null); // {code, kind, value, discount}
  const [customerEmail, setCustomerEmail] = useState("");
  const [sendReceipt, setSendReceipt] = useState(false);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(0);

  // customer state
  const [phoneQuery, setPhoneQuery] = useState("");
  const [customer, setCustomer] = useState(null);
  const [newCust, setNewCust] = useState(null); // {name, address, postcode}
  const [collectionName, setCollectionName] = useState("");
  const [tableNo, setTableNo] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);

  useEffect(() => { setSuggestOpen(false); }, [orderType]);

  const matchCustomers = (query) => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return customers.filter((c) =>
      c.name.toLowerCase().includes(q) || c.phone.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
    ).slice(0, 6);
  };
  const deliveryMatches = suggestOpen ? matchCustomers(phoneQuery) : [];
  const collectionMatches = suggestOpen ? matchCustomers(collectionName) : [];

  const pickCustomer = (found) => {
    setCustomer(found); setNewCust(null); setSuggestOpen(false);
    loyaltyApi.lookup(found.phone).then((r) => setLoyaltyBalance(r.found ? (r.loyalty_points || 0) : 0)).catch(() => setLoyaltyBalance(0));
  };

  // Editing an existing unpaid order (occupied table / running tab).
  const [editingOrderId, setEditingOrderId] = useState(null);
  const editingOrder = useMemo(
    () => (editingOrderId ? orders.find((o) => o.id === editingOrderId) : null),
    [editingOrderId, orders],
  );

  // Prefill from ?table=N and/or ?order=OID (used when jumping over from the Table Plan / Orders click).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const t = searchParams.get("table");
    const oid = searchParams.get("order");
    if (oid) {
      const existing = orders.find((o) => o.id === oid);
      if (existing && existing.payment === "unpaid" && !existing.voided && existing.status !== "completed") {
        setEditingOrderId(existing.id);
        setOrderType(existing.type);
        if (existing.type === "dine-in" && existing.table != null) setTableNo(String(existing.table));
        if (existing.type === "delivery" && existing.customer) {
          setCustomer(existing.customer);
        } else if (existing.type === "collection" && existing.customer) {
          setCollectionName(existing.customer.name?.replace(/^Walk-in — /, "") || "");
          setPhoneQuery(existing.customer.phone || "");
        }
        toast.info(`Reopened bill #${existing.number}`);
      } else if (existing) {
        toast.error("Order is already settled or voided");
      }
      searchParams.delete("order");
    }
    if (t && !oid) {
      setOrderType("dine-in");
      setTableNo(String(t));
    }
    if (t || oid) {
      // Clean the URL so a reload doesn't keep re-prefilling.
      searchParams.delete("table");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, orders.length]);

  const items = useMemo(() => menuItems.filter((m) => m.catId === activeCat), [menuItems, activeCat]);

  const lookupCustomer = () => {
    if (phoneQuery.trim().length < 5) { toast.error("Enter a phone number to search"); return; }
    const found = customers.find((c) => c.phone.replace(/\s/g, "").includes(phoneQuery.replace(/\s/g, "")));
    if (found) { pickCustomer(found); toast.success(`Customer found: ${found.name}`); }
    else { setCustomer(null); setNewCust({ phone: phoneQuery, name: "", address: "", postcode: "" }); toast.info("No customer found — add new"); }
  };

  const saveNewCustomer = () => {
    if (!newCust.name || !newCust.address) { toast.error("Name and address are required"); return; }
    const cust = { ...newCust, id: undefined, orders: 0, notes: "" };
    upsertCustomer(cust);
    setCustomer({ ...cust, id: `cu_tmp` });
    setNewCust(null);
    toast.success("New customer saved");
  };

  const addLine = (line) => {
    setCart((prev) => [...prev, { ...line, lineId: `l_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` }]);
    toast.success(`${line.name} added`);
  };

  const handleItemClick = (item) => {
    if (!item.available) { toast.error(`${item.name} is unavailable`); return; }
    if (item.isPizza || item.catId === "deals") { setModalItem(item); }
    else { addLine({ name: item.name, qty: 1, price: item.price, mods: [], note: "", catId: item.catId, taxRate: item.tax_rate }); }
  };

  const updateQty = (lineId, delta) => {
    setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  };
  const removeLine = (lineId) => setCart((prev) => prev.filter((l) => l.lineId !== lineId));

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  // GST is added on top of restaurant menu pricing (exclusive) — mirrors the
  // authoritative calculation the backend performs at order creation.
  const gst = useMemo(() => {
    const lineAmounts = cart.map((l) => {
      const cat = categories.find((c) => c.id === l.catId);
      const rate = effectiveTaxRate({ tax_rate: l.taxRate }, cat);
      return computeLineTax(l.price, l.qty, rate, false);
    });
    return computeOrderTax(lineAmounts);
  }, [cart, categories]);
  // In edit mode, delivery fee was already captured on the original order — don't double it.
  const deliveryFee = !editingOrderId && orderType === "delivery" && cart.length > 0 ? DELIVERY_FEE : 0;
  const discountAmt = (subtotal * discount) / 100;
  const tipAmt = +(subtotal * tipPct / 100).toFixed(2);
  const couponDisc = coupon?.discount || 0;
  const loyaltyDisc = Math.min(redeemPoints || 0, subtotal);
  const newRoundTotal = Math.max(0, subtotal + gst.taxTotal - discountAmt - couponDisc - loyaltyDisc + deliveryFee + tipAmt);
  const total = editingOrder ? +(newRoundTotal + editingOrder.total).toFixed(2) : newRoundTotal;

  const orderCustomer = () => {
    if (orderType === "delivery") return customer;
    if (orderType === "collection") return { name: collectionName ? `Walk-in — ${collectionName}` : "Walk-in", phone: phoneQuery || "" };
    return { name: `Table ${tableNo}` };
  };

  const validateOrder = () => {
    if (editingOrderId) return true;
    if (cart.length === 0) { toast.error("Cart is empty"); return false; }
    if (orderType === "delivery" && !customer) { toast.error("Select or add a delivery customer first"); return false; }
    if (orderType === "dine-in" && !tableNo) { toast.error("Select a table first"); return false; }
    return true;
  };

  const resetAll = () => {
    setCart([]); setDiscount(0); setCustomer(null); setNewCust(null);
    setPhoneQuery(""); setCollectionName(""); setTableNo("");
    setTipPct(0); setCoupon(null); setCustomerEmail(""); setSendReceipt(false);
    setLoyaltyBalance(0); setRedeemPoints(0);
    setEditingOrderId(null); setCartOpen(false); setSuggestOpen(false);
  };

  const sendToKitchen = async () => {
    if (editingOrderId) {
      if (cart.length === 0) { toast.info("No new items to add"); return; }
      try {
        const items = cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price, mods: l.mods || [], size: l.size || null }));
        const updated = await appendToOrder(editingOrderId, items);
        toast.success(`Added ${cart.length} item(s) to #${updated.number}`);
        setCart([]);
      } catch { /* error already toasted by appendToOrder */ }
      return;
    }
    if (!validateOrder()) return;
    const order = buildOrder("unpaid");
    placeOrder(order);
    toast.success(`Order #sent to kitchen — ₹${total.toFixed(2)}`);
    resetAll();
  };

  const buildOrder = (payment, splits = null) => ({
    type: orderType,
    status: "new",
    customer: orderCustomer(),
    table: orderType === "dine-in" ? Number(tableNo) : undefined,
    items: cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price, mods: l.mods || [], size: l.size || null })),
    deliveryFee, discount: discountAmt + couponDisc + loyaltyDisc, total, payment,
    source: orderSource,
    tip: tipAmt,
    coupon_code: coupon?.code || null,
    customer_email: customerEmail || null,
    send_email_receipt: !!(sendReceipt && customerEmail && customerEmail.includes("@")),
    redeem_loyalty_points: redeemPoints || 0,
    splits,
  });

  const onCreateOrder = async (method, splits = null) => {
    // Edit mode — settle an existing (unpaid) running-tab order.
    if (editingOrderId) {
      const existing = orders.find((o) => o.id === editingOrderId);
      if (!existing) { toast.error("Order no longer available"); return null; }
      try {
        let current = existing;
        // Append any new items first (they'll go to the KDS immediately).
        if (cart.length > 0) {
          const items = cart.map((l) => ({ name: l.name, qty: l.qty, price: l.price, mods: l.mods || [], size: l.size || null }));
          current = await appendToOrder(editingOrderId, items);
        }
        // For non-card methods, mark payment now. Card is set by the Razorpay verify step.
        if (method === "cash") {
          try {
            current = await ordersApi.setPayment(editingOrderId, "cash");
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Could not mark order paid");
            return null;
          }
        }
        return current;
      } catch {
        return null;
      }
    }
    // For card path the backend will flip payment to "card" after Razorpay verify.
    const initialPayment = method === "card" ? "unpaid" : method;
    const order = buildOrder(initialPayment, splits);
    try {
      return await placeOrder(order);
    } catch {
      return null;
    }
  };

  const onPaid = async (method, placed) => {
    setPayOpen(false);
    if (editingOrderId) {
      // Finalise the running-tab order: mark completed so the table is released.
      try { await updateOrderStatus(editingOrderId, "completed"); } catch { /* best-effort */ }
      toast.success(`Bill #${placed.number} settled by ${method} — ₹${total.toFixed(2)}`);
      resetAll();
      navigate("/tables");
      return;
    }
    toast.success(`Order #${placed.number} paid by ${method} — ₹${total.toFixed(2)}`);
    resetAll();
  };

  const availableTables = tables.filter((t) => t.status === "available");

  return (
    <div className="flex flex-col md:flex-row h-full overflow-y-auto md:overflow-hidden pos-scroll pb-24 md:pb-0" data-testid="order-screen">
      {/* Left: order type + customer */}
      <div className="w-full md:w-[270px] md:shrink-0 flex flex-col gap-3 p-3 overflow-visible md:overflow-y-auto pos-scroll border-b md:border-b-0 md:border-r" style={{ borderColor: "var(--pos-border)" }}>
        {editingOrder && (
          <div className="rounded-xl p-3 flex items-start gap-2 fade-in" data-testid="reopen-banner"
            style={{ background: "#14233f", border: "1px solid #3b82f6" }}>
            <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "#7ea3d1" }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white">Reopened Bill #{editingOrder.number}</div>
              <div className="text-[11px] mt-0.5" style={{ color: "#c7d4e6" }}>
                {editingOrder.type === "dine-in" && editingOrder.table != null ? `Table ${editingOrder.table} · ` : ""}
                {editingOrder.items?.length} sent · ₹{editingOrder.total.toFixed(2)}
              </div>
              <div className="text-[10px] mt-1" style={{ color: "#7ea3d1" }}>Add more items or hit Pay to settle.</div>
            </div>
            <button data-testid="close-reopen" onClick={() => { resetAll(); navigate("/tables"); }}
              className="pos-btn p-1 rounded" style={{ color: "#7ea3d1" }} title="Back to tables">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          {ORDER_TYPES.map(({ id, label, icon: Icon }) => (
            <button key={id} data-testid={`order-type-${id}`} onClick={() => !editingOrder && setOrderType(id)}
              disabled={!!editingOrder}
              className="pos-btn flex flex-col items-center gap-1.5 py-3 rounded-xl text-xs font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: orderType === id ? "var(--pos-accent)" : "var(--pos-panel)", color: orderType === id ? "#fff" : "var(--pos-muted)", border: `1px solid ${orderType === id ? "var(--pos-accent)" : "var(--pos-border)"}` }}>
              <Icon className="w-5 h-5" />
              {label}
            </button>
          ))}
        </div>

        {staffUser?.role === "Manager" && (
          <div className="grid grid-cols-2 gap-2">
            <button data-testid="open-zreport" onClick={() => setZReportOpen(true)}
              className="pos-btn flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold"
              style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <DollarSign className="w-3.5 h-3.5" /> Z-Report
            </button>
            <button data-testid="open-tippool" onClick={() => setTipPoolOpen(true)}
              className="pos-btn flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold"
              style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <Coins className="w-3.5 h-3.5" /> Tip Pool
            </button>
          </div>
        )}

        <div className="rounded-xl p-2" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="text-[10px] uppercase tracking-wider mb-1.5 font-semibold px-1" style={{ color: "var(--pos-muted)" }}>Source</div>
          <div className="grid grid-cols-5 gap-1">
            {[
              { id: "in-store", label: "Store" },
              { id: "phone", label: "Phone" },
              { id: "swiggy", label: "Swiggy", color: "#fc8019" },
              { id: "zomato", label: "Zomato", color: "#cb202d" },
              { id: "other", label: "Other" },
            ].map((s) => (
              <button key={s.id} data-testid={`order-source-${s.id}`} type="button" onClick={() => setOrderSource(s.id)}
                className="pos-btn h-8 rounded-md text-[10px] font-bold capitalize"
                style={{
                  background: orderSource === s.id ? (s.color || "var(--pos-accent)") : "var(--pos-panel-2)",
                  color: orderSource === s.id ? "#fff" : "var(--pos-muted)",
                  border: "1px solid var(--pos-border)",
                }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Delivery: phone lookup */}
        {orderType === "delivery" && (
          <div className="rounded-xl p-3 fade-in" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Customer Lookup</div>
            <div className="relative">
              <div className="flex gap-2">
                <Input data-testid="phone-input" value={phoneQuery}
                  onChange={(e) => { setPhoneQuery(e.target.value); setSuggestOpen(true); }}
                  onFocus={() => setSuggestOpen(true)}
                  placeholder="Name or phone number..."
                  onKeyDown={(e) => e.key === "Enter" && lookupCustomer()}
                  className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                <button data-testid="phone-search-btn" onClick={lookupCustomer} className="pos-btn h-10 w-10 shrink-0 rounded-lg flex items-center justify-center" style={{ background: "var(--pos-blue)" }}>
                  <Search className="w-4 h-4 text-white" />
                </button>
              </div>
              {suggestOpen && !customer && deliveryMatches.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 z-10 rounded-lg overflow-hidden fade-in" data-testid="customer-suggestions"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  {deliveryMatches.map((c) => (
                    <button key={c.id} data-testid={`customer-suggestion-${c.id}`} type="button" onClick={() => pickCustomer(c)}
                      className="pos-btn w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2"
                      style={{ color: "white", borderBottom: "1px solid var(--pos-border)" }}>
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs shrink-0" style={{ color: "var(--pos-muted)" }}>{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {customer && (
              <div className="mt-3 rounded-lg p-3 fade-in" data-testid="customer-card" style={{ background: "var(--pos-panel-2)", border: "1px solid #2e4a2e" }}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-white text-sm">{customer.name}</div>
                    <div className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--pos-muted)" }}><Phone className="w-3 h-3" />{customer.phone}</div>
                    <div className="text-xs mt-1" style={{ color: "var(--pos-muted)" }}>{customer.address}, {customer.postcode}</div>
                    {customer.notes && <div className="text-xs mt-1 italic text-amber-400">⚠ {customer.notes}</div>}
                  </div>
                  <button data-testid="clear-customer" onClick={() => setCustomer(null)} className="pos-btn p-1 rounded" style={{ color: "var(--pos-muted)" }}><X className="w-4 h-4" /></button>
                </div>
                <div className="text-[11px] mt-2 px-2 py-0.5 rounded-full inline-block" style={{ background: "#1c2a1c", color: "#7cc97c" }}>{customer.orders || 0} previous orders</div>
              </div>
            )}

            {newCust && (
              <div className="mt-3 space-y-2 fade-in" data-testid="new-customer-form">
                <div className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--pos-accent)" }}><UserPlus className="w-3.5 h-3.5" /> New Customer</div>
                <Input data-testid="new-cust-name" placeholder="Full name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} className="h-9 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                <Input data-testid="new-cust-address" placeholder="Address" value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} className="h-9 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                <Input data-testid="new-cust-postcode" placeholder="Postcode" value={newCust.postcode} onChange={(e) => setNewCust({ ...newCust, postcode: e.target.value })} className="h-9 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
                <button data-testid="save-new-customer" onClick={saveNewCustomer} className="pos-btn w-full h-9 rounded-lg text-sm font-semibold text-white" style={{ background: "var(--pos-accent)" }}>Save Customer</button>
              </div>
            )}
          </div>
        )}

        {orderType === "collection" && (
          <div className="rounded-xl p-3 fade-in space-y-2" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)" }}>Collection Details</div>
            <div className="relative">
              <Input data-testid="collection-name" placeholder="Customer name (optional)" value={collectionName}
                onChange={(e) => { setCollectionName(e.target.value); setSuggestOpen(true); }}
                onFocus={() => setSuggestOpen(true)}
                className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
              {suggestOpen && collectionMatches.length > 0 && (
                <div className="absolute left-0 right-0 mt-1 z-10 rounded-lg overflow-hidden fade-in" data-testid="collection-suggestions"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  {collectionMatches.map((c) => (
                    <button key={c.id} data-testid={`collection-suggestion-${c.id}`} type="button"
                      onClick={() => { setCollectionName(c.name); setPhoneQuery(c.phone); setSuggestOpen(false); }}
                      className="pos-btn w-full text-left px-3 py-2.5 text-sm flex items-center justify-between gap-2"
                      style={{ color: "white", borderBottom: "1px solid var(--pos-border)" }}>
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs shrink-0" style={{ color: "var(--pos-muted)" }}>{c.phone}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input data-testid="collection-phone" placeholder="Phone (optional)" value={phoneQuery} onChange={(e) => setPhoneQuery(e.target.value)} className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }} />
            <div className="text-xs" style={{ color: "var(--pos-muted)" }}>Est. ready in <span className="text-white font-semibold">15–20 min</span></div>
          </div>
        )}

        {orderType === "dine-in" && (
          <div className="rounded-xl p-3 fade-in space-y-2" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
            <div className="text-xs uppercase tracking-wider font-semibold" style={{ color: "var(--pos-muted)" }}>Select Table</div>
            <Select value={tableNo} onValueChange={setTableNo}>
              <SelectTrigger data-testid="table-select" className="h-10 text-white" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)" }}>
                <SelectValue placeholder="Choose available table" />
              </SelectTrigger>
              <SelectContent>
                {availableTables.map((t) => (
                  <SelectItem key={t.id} value={String(t.number)}>Table {t.number} · {t.seats} seats</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tableNo && <div className="text-xs" style={{ color: "#7cc97c" }}>Table {tableNo} selected</div>}
          </div>
        )}

        {/* Categories — horizontal chip scroll on mobile, vertical list on desktop */}
        <div className="rounded-xl p-3 md:flex-1" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
          <div className="text-xs uppercase tracking-wider mb-2 font-semibold" style={{ color: "var(--pos-muted)" }}>Categories</div>
          <div className="flex gap-1.5 overflow-x-auto pos-scroll pb-1 -mx-1 px-1 md:mx-0 md:px-0 md:flex-col md:gap-0 md:space-y-1.5 md:overflow-visible md:pb-0">
            {CATEGORIES.map((c) => (
              <button key={c.id} data-testid={`cat-${c.id}`} onClick={() => setActiveCat(c.id)}
                className="cat-btn shrink-0 md:w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-sm font-semibold text-left whitespace-nowrap md:whitespace-normal"
                style={{ background: activeCat === c.id ? "var(--pos-panel-2)" : "transparent", color: activeCat === c.id ? "#fff" : "var(--pos-muted)", border: `1px solid ${activeCat === c.id ? c.color : "var(--pos-border)"}` }}>
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Center: item grid */}
      <div className="w-full md:flex-1 md:min-w-0 p-3 overflow-visible md:overflow-y-auto pos-scroll">
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3" data-testid="item-grid">
          {items.map((item) => {
            const cat = CATEGORIES.find((c) => c.id === item.catId);
            const priceLabel = item.isPizza ? `₹${item.sizes.sm.toFixed(2)} – ₹${item.sizes.lg.toFixed(2)}` : `₹${item.price.toFixed(2)}`;
            return (
              <div key={item.id} data-testid={`menu-item-${item.id}`} onClick={() => handleItemClick(item)}
                className="menu-tile rounded-xl p-3.5 flex flex-col justify-between min-h-[110px]"
                style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)", opacity: item.available ? 1 : 0.45 }}>
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-semibold text-white text-sm leading-snug">{item.name}</div>
                    <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: cat?.color }} />
                  </div>
                  {item.desc && <div className="text-[11px] mt-1 leading-snug" style={{ color: "var(--pos-muted)" }}>{item.desc}</div>}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm font-bold" style={{ color: "var(--pos-accent)" }}>{priceLabel}</span>
                  {!item.available && <span className="text-[10px] uppercase font-bold text-red-400">86&apos;d</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile-only: persistent bar to open the cart sheet */}
      {(cart.length > 0 || editingOrder) && !cartOpen && (
        <button data-testid="open-cart-bar" onClick={() => setCartOpen(true)}
          className="md:hidden fixed bottom-16 inset-x-0 z-40 h-14 flex items-center justify-between px-5 font-bold text-white"
          style={{ background: "var(--pos-accent)" }}>
          <span className="flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> {cart.length} item{cart.length === 1 ? "" : "s"}</span>
          <span>₹{total.toFixed(2)} · View Cart</span>
        </button>
      )}

      {/* Right: cart */}
      <CartPanel
        open={cartOpen} onClose={() => setCartOpen(false)}
        cart={cart} orderType={orderType} customer={orderCustomer()}
        subtotal={subtotal} deliveryFee={deliveryFee} discount={discount} discountAmt={discountAmt} total={total} gst={gst}
        onQty={updateQty} onRemove={removeLine} onDiscount={setDiscount}
        onClear={() => { setCart([]); setDiscount(0); setTipPct(0); setCoupon(null); setRedeemPoints(0); }}
        onSend={sendToKitchen}
        onPay={() => { if (validateOrder()) setPayOpen(true); }}
        tipPct={tipPct} onTipPct={setTipPct}
        coupon={coupon} onCoupon={setCoupon}
        customerEmail={customerEmail} onCustomerEmail={setCustomerEmail}
        sendReceipt={sendReceipt} onSendReceiptToggle={setSendReceipt}
        loyaltyBalance={loyaltyBalance} redeemPoints={redeemPoints} onRedeemPoints={setRedeemPoints}
        runningBill={editingOrder}
      />

      <ItemModal item={modalItem} menuItems={menuItems} onClose={() => setModalItem(null)} onAdd={addLine} />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} total={total} customerName={orderCustomer()?.name} onCreateOrder={onCreateOrder} onPaid={onPaid} />

      <Dialog open={zReportOpen} onOpenChange={setZReportOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto pos-scroll border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Z-Report · Cash Drawer</DialogTitle></DialogHeader>
          <CashDrawerPanel />
        </DialogContent>
      </Dialog>
      <Dialog open={tipPoolOpen} onOpenChange={setTipPoolOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto pos-scroll border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }}>
          <DialogHeader><DialogTitle className="text-white">Tip Pool</DialogTitle></DialogHeader>
          <TipPoolPanel />
        </DialogContent>
      </Dialog>
    </div>
  );
}
