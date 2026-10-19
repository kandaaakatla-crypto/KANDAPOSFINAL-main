// The dashboard sign-in page printed the demo owner/manager passwords, and the
// payment screens printed Razorpay test-card details, to every real restaurant.
// Nothing shipped in the UI may carry those strings.
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..");
const BANNED = ["OwnerPass#2025", "DemoMgr#2025", "DemoArea#2025", "4111 1111 1111 1111"];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : files(p);
    return /\.(js|jsx)$/.test(e.name) && !/\.test\.js$/.test(e.name) ? [p] : [];
  });
}

test.each(BANNED)("no UI file shows %s", (needle) => {
  const hits = files(SRC).filter((f) => fs.readFileSync(f, "utf8").includes(needle));
  expect(hits.map((f) => path.relative(SRC, f))).toEqual([]);
});
