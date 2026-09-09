import React, { useEffect, useState } from "react";
import { usePos } from "../../store/PosContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Search, UserPlus, Pencil, Trash2, Phone, MapPin, Undo2, MessageSquare, Cake } from "lucide-react";
import { toast } from "sonner";
import { customersApi } from "../../api/client";
import SmsComposer from "../SmsComposer";

const EMPTY = { name: "", phone: "", address: "", postcode: "", notes: "", birthday: "" };

function fmtBirthday(md) {
  if (!md) return null;
  const [m, d] = md.split("-").map(Number);
  if (!m || !d) return null;
  return new Date(2000, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function CustomersScreen() {
  const { customers, upsertCustomer, deleteCustomer, refreshCustomers, staffUser } = usePos();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState([]);
  const [trashLoading, setTrashLoading] = useState(false);
  const isManager = staffUser?.role === "Manager";
  const [smsTarget, setSmsTarget] = useState(null);

  const filtered = customers.filter((c) =>
    (c.name + c.phone + (c.address || "") + (c.postcode || "")).toLowerCase().includes(query.toLowerCase())
  );

  const save = () => {
    if (!editing.name || !editing.phone) { toast.error("Name and phone are required"); return; }
    upsertCustomer(editing);
    toast.success(editing.id ? "Customer updated" : "Customer added");
    setEditing(null);
  };

  const openTrash = async () => {
    setTrashOpen(true); setTrashLoading(true);
    try { setTrash(await customersApi.trash()); }
    catch (e) { toast.error(e?.response?.data?.detail || "Could not load trash"); }
    finally { setTrashLoading(false); }
  };

  const restore = async (id) => {
    try {
      await customersApi.restore(id);
      setTrash((t) => t.filter((c) => c.id !== id));
      if (refreshCustomers) await refreshCustomers();
      toast.success("Customer restored");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not restore");
    }
  };

  return (
    <div className="h-full flex flex-col p-4 gap-4" data-testid="customers-screen">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: "var(--pos-text)" }}>Customers</h2>
        <div className="flex flex-wrap gap-2">
          <div className="relative flex-1 min-w-[180px] sm:flex-none">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--pos-muted)" }} />
            <Input data-testid="customer-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, address..."
              className="h-10 pl-9 w-full sm:w-72" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
          </div>
          <button data-testid="add-customer-btn" onClick={() => setEditing({ ...EMPTY })}
            className="pos-btn h-10 px-4 rounded-lg text-sm font-bold text-white flex items-center gap-2 shrink-0" style={{ background: "var(--pos-accent)" }}>
            <UserPlus className="w-4 h-4" /> Add Customer
          </button>
          {isManager && (
            <button data-testid="open-trash-btn" onClick={openTrash}
              className="pos-btn h-10 px-3 rounded-lg text-sm font-bold flex items-center gap-2 shrink-0"
              style={{ background: "var(--pos-panel)", color: "var(--pos-muted)", border: "1px solid var(--pos-border)" }}>
              <Undo2 className="w-4 h-4" /> Recently deleted
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pos-scroll">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-xl p-4 fade-in" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }} data-testid={`customer-${c.id}`}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-semibold" style={{ color: "var(--pos-text)" }}>{c.name}</div>
                  <div className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}><Phone className="w-3 h-3" /> {c.phone}</div>
                  <div className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}><MapPin className="w-3 h-3" /> {c.address}{c.postcode ? `, ${c.postcode}` : ""}</div>
                  {c.birthday && <div className="text-xs mt-1 flex items-center gap-1.5" style={{ color: "var(--pos-muted)" }}><Cake className="w-3 h-3" /> {fmtBirthday(c.birthday)}</div>}
                  {c.notes && <div className="text-xs mt-1.5 italic text-amber-400">⚠ {c.notes}</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  {isManager && c.phone && (
                    <button data-testid={`sms-customer-${c.id}`} onClick={() => setSmsTarget(c)}
                      className="pos-btn p-2 rounded-lg" style={{ background: "var(--pos-panel-2)", color: "#a78bfa" }}
                      title="Send SMS">
                      <MessageSquare className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button data-testid={`edit-customer-${c.id}`} onClick={() => setEditing({ ...c })} className="pos-btn p-2 rounded-lg" style={{ background: "var(--pos-panel-2)", color: "var(--pos-muted)" }}><Pencil className="w-3.5 h-3.5" /></button>
                  <button data-testid={`delete-customer-${c.id}`} onClick={() => { deleteCustomer(c.id); toast.success("Customer deleted"); }} className="pos-btn p-2 rounded-lg" style={{ background: "var(--pos-panel-2)", color: "#f87171" }}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="text-[11px] mt-3 px-2 py-0.5 rounded-full inline-block" style={{ background: "#1c2a1c", color: "#7cc97c" }}>{c.orders || 0} orders placed</div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-sm py-10" style={{ color: "var(--pos-muted)" }}>No customers match your search.</div>}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="customer-modal">
          <DialogHeader><DialogTitle style={{ color: "var(--pos-text)" }}>{editing?.id ? "Edit Customer" : "New Customer"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              {[
                { key: "name", ph: "Full name *" },
                { key: "phone", ph: "Phone number *" },
                { key: "address", ph: "Address" },
                { key: "postcode", ph: "Postcode" },
                { key: "notes", ph: "Delivery notes / allergies" },
              ].map((f) => (
                <Input key={f.key} data-testid={`cust-field-${f.key}`} placeholder={f.ph} value={editing[f.key] || ""}
                  onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}
                  className="h-10" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              ))}
              <div>
                <label className="text-xs" style={{ color: "var(--pos-muted)" }}>Birthday (optional)</label>
                <Input data-testid="cust-field-birthday" type="date"
                  value={editing.birthday ? `2000-${editing.birthday}` : ""}
                  onChange={(e) => setEditing({ ...editing, birthday: e.target.value ? e.target.value.slice(5) : "" })}
                  className="h-10" style={{ background: "var(--pos-panel-2)", borderColor: "var(--pos-border)", color: "var(--pos-text)" }} />
              </div>
              <button data-testid="save-customer-btn" onClick={save} className="pos-btn w-full h-11 rounded-lg font-bold text-white" style={{ background: "var(--pos-accent)" }}>Save</button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={trashOpen} onOpenChange={setTrashOpen}>
        <DialogContent className="max-w-xl border" style={{ background: "var(--pos-panel)", borderColor: "var(--pos-border)" }} data-testid="customer-trash-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: "var(--pos-text)" }}>
              <Undo2 className="w-4 h-4" /> Recently deleted customers
            </DialogTitle>
          </DialogHeader>
          {trashLoading ? (
            <div className="text-sm py-6 text-center" style={{ color: "var(--pos-muted)" }}>Loading…</div>
          ) : trash.length === 0 ? (
            <div className="text-sm py-6 text-center" style={{ color: "var(--pos-muted)" }}>The trash is empty.</div>
          ) : (
            <div className="space-y-2 max-h-[60vh] overflow-y-auto">
              {trash.map((c) => (
                <div key={c.id} data-testid={`trash-row-${c.id}`} className="rounded-lg p-3 flex items-center justify-between"
                  style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }}>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: "var(--pos-text)" }}>{c.name}</div>
                    <div className="text-[11px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                      {c.phone}{c.address ? ` · ${c.address}` : ""}
                    </div>
                    <div className="text-[10px] mt-0.5" style={{ color: "var(--pos-muted)" }}>
                      Deleted {c.deleted_at ? new Date(c.deleted_at).toLocaleString() : "—"}
                    </div>
                  </div>
                  <button data-testid={`restore-${c.id}`} onClick={() => restore(c.id)}
                    className="pos-btn h-8 px-3 rounded-md text-xs font-bold flex items-center gap-1.5 text-white"
                    style={{ background: "var(--pos-accent)" }}>
                    <Undo2 className="w-3 h-3" /> Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SmsComposer open={!!smsTarget} onClose={() => setSmsTarget(null)}
        to={smsTarget?.phone} name={smsTarget?.name} customerId={smsTarget?.id} />
    </div>
  );
}
