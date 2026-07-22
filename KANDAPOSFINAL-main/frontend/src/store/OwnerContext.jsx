import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { ownerAuth, ownerToken, pre2faToken } from "../api/ownerClient";

const OwnerContext = createContext(null);

export function OwnerProvider({ children }) {
  const [boot, setBoot] = useState("loading");
  const [owner, setOwner] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ownerToken.get()) { setBoot("ready"); return; }
      try {
        const me = await ownerAuth.me();
        if (!cancelled) setOwner(me);
      } catch {
        ownerToken.clear();
      } finally {
        if (!cancelled) setBoot("ready");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email, password) => {
    const r = await ownerAuth.login(email, password);
    pre2faToken.set(r.pre2faToken);
    return r;
  }, []);

  const verify = useCallback(async (code) => {
    const r = await ownerAuth.verify(code);
    ownerToken.set(r.token);
    pre2faToken.clear();
    setOwner(r.owner);
    return r;
  }, []);

  const logout = useCallback(() => {
    ownerToken.clear();
    pre2faToken.clear();
    setOwner(null);
  }, []);

  return (
    <OwnerContext.Provider value={{ boot, owner, login, verify, logout }}>
      {children}
    </OwnerContext.Provider>
  );
}

export const useOwner = () => {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error("useOwner must be inside <OwnerProvider>");
  return ctx;
};
