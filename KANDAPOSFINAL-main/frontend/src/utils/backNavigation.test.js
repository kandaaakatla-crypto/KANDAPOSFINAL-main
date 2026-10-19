import fs from "fs";
import path from "path";
import { backActionFor } from "./backNavigation";

describe("backActionFor", () => {
  it("treats the till as home, so back asks before leaving the app", () => {
    expect(backActionFor("/spice-hub/pos")).toEqual({ type: "home" });
    expect(backActionFor("/spice-hub/pos/")).toEqual({ type: "home" });
  });

  it("sends every other POS section back to the till", () => {
    for (const section of ["orders", "tables", "menu", "dispatch", "workforce"]) {
      expect(backActionFor(`/spice-hub/${section}`)).toEqual({ type: "navigate", to: "/spice-hub/pos" });
    }
  });

  it("sends the time clock back to the till", () => {
    expect(backActionFor("/pos/spice-hub/clock")).toEqual({ type: "navigate", to: "/spice-hub/pos" });
  });

  it("treats the staff PIN screen and restaurant picker as home", () => {
    expect(backActionFor("/pos/spice-hub/login")).toEqual({ type: "home" });
    expect(backActionFor("/pos/login")).toEqual({ type: "home" });
    expect(backActionFor("/")).toEqual({ type: "home" });
  });

  it("falls back to browser history anywhere else", () => {
    expect(backActionFor("/kds")).toEqual({ type: "history" });
    expect(backActionFor("/spice-hub/driver")).toEqual({ type: "history" });
  });
});

describe("POS back controls are wired in", () => {
  const src = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

  it("App listens for the Android hardware back button", () => {
    expect(src("App.js")).toMatch(/useAndroidBackButton\(\)/);
  });

  it("the POS header shows an on-screen back arrow off the till", () => {
    expect(src("components/pos/POSLayout.jsx")).toMatch(/data-testid="header-back"/);
  });
});
