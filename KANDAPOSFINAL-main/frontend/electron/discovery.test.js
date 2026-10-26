// Run with: node --test electron/discovery.test.js
const test = require("node:test");
const assert = require("node:assert");
const { discoverPrinters, localSubnets } = require("./discovery");

test("localSubnets keeps only private non-internal IPv4", () => {
  const subnets = localSubnets({
    eth0: [{ family: "IPv4", address: "192.168.1.20", internal: false }],
    lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }],
    wan: [{ family: "IPv4", address: "8.8.8.8", internal: false }],
    v6: [{ family: "IPv6", address: "fe80::1", internal: false }],
    eth1: [{ family: "IPv4", address: "192.168.1.55", internal: false }],
  });
  assert.deepStrictEqual(subnets, ["192.168.1"]);
});

test("discoverPrinters returns the hosts that answer, sorted", async () => {
  const answering = new Set(["192.168.1.9", "192.168.1.120"]);
  const found = await discoverPrinters({
    subnets: ["192.168.1"],
    probeFn: async (host) => answering.has(host),
  });
  assert.deepStrictEqual(found.map((f) => f.host), ["192.168.1.9", "192.168.1.120"]);
  assert.strictEqual(found[0].port, 9100);
});

test("no subnets means nothing probed", async () => {
  let calls = 0;
  const found = await discoverPrinters({ subnets: [], probeFn: async () => { calls++; return true; } });
  assert.deepStrictEqual(found, []);
  assert.strictEqual(calls, 0);
});
