import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Cake, CheckCircle2, Loader2, PartyPopper } from "lucide-react";
import { publicLoyaltyApi } from "../../api/client";

/**
 * Public, no-login page a customer lands on after tapping the "tell us your
 * birthday" link texted to them (see loyaltyApi.requestBirthdays). The link
 * itself is the only credential — a short-lived signed token minted server
 * side, scoped to that one customer.
 */
export default function BirthdayLinkPage() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [existing, setExisting] = useState(null);
  const [value, setValue] = useState(""); // "YYYY-MM-DD" from the date input
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    publicLoyaltyApi.getBirthdayLink(token)
      .then((r) => {
        setName(r.name || "");
        setExisting(r.birthday || null);
        if (r.birthday) setValue(`2000-${r.birthday}`);
      })
      .catch((e) => setError(e?.response?.data?.detail || "This link isn't valid anymore."))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    if (!value) return;
    setSaving(true);
    setError("");
    try {
      await publicLoyaltyApi.submitBirthday(token, value.slice(5));
      setDone(true);
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not save — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--pos-bg)" }}>
      <div className="w-full max-w-sm rounded-2xl p-6" style={{ background: "var(--pos-panel)", border: "1px solid var(--pos-border)" }}>
        {loading && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--pos-muted)" }} />
            <div className="text-sm" style={{ color: "var(--pos-muted)" }}>Loading…</div>
          </div>
        )}

        {!loading && error && !done && (
          <div className="text-center py-6">
            <div className="text-sm" style={{ color: "#f87171" }}>{error}</div>
          </div>
        )}

        {!loading && !error && !done && (
          <>
            <div className="flex flex-col items-center text-center gap-2 mb-5">
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "#fb718522" }}>
                <Cake className="w-6 h-6" style={{ color: "#fb7185" }} />
              </div>
              <h1 className="text-lg font-bold text-white">Hi {name.split(" ")[0] || "there"}!</h1>
              <p className="text-sm" style={{ color: "var(--pos-muted)" }}>
                {existing ? "You've already told us your birthday — update it below if it's wrong." : "When's your birthday? We'll send you a treat every year."}
              </p>
            </div>

            <label className="text-[11px] uppercase tracking-wider" style={{ color: "var(--pos-muted)" }}>Birthday</label>
            <input data-testid="birthday-date-input" type="date" value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full h-11 rounded-lg px-3 mt-1.5 text-sm text-white outline-none"
              style={{ background: "var(--pos-panel-2)", border: "1px solid var(--pos-border)" }} />
            <p className="text-[10px] mt-1.5" style={{ color: "var(--pos-muted)" }}>We only keep the month and day — not the year.</p>

            <button data-testid="birthday-submit-btn" onClick={submit} disabled={!value || saving}
              className="pos-btn w-full h-11 rounded-lg font-bold text-white flex items-center justify-center gap-2 mt-4"
              style={{ background: "var(--pos-accent)", opacity: (!value || saving) ? 0.5 : 1 }}>
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save my birthday"}
            </button>
          </>
        )}

        {done && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <PartyPopper className="w-10 h-10" style={{ color: "#fcd34d" }} />
            <h1 className="text-lg font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" style={{ color: "#4ade80" }} /> Got it!
            </h1>
            <p className="text-sm" style={{ color: "var(--pos-muted)" }}>Thanks — see you on your birthday 🎉</p>
          </div>
        )}
      </div>
    </div>
  );
}
