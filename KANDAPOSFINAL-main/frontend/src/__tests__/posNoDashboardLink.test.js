// Rohit (launch scope): the POS app should not open the restaurant dashboard.
// The dashboard has its own sign-in at /dashboard; the POS left rail and the
// phone "More" sheet each had a link straight to it for managers.
const fs = require("fs");
const path = require("path");

test("POS layout has no link to the dashboard", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "components", "pos", "POSLayout.jsx"), "utf8");
  expect(src).not.toMatch(/href="\/dashboard"/);
  expect(src).not.toMatch(/nav-dashboard-link|mmore-dashboard/);
});
