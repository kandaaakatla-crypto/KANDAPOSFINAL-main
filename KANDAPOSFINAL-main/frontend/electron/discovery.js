const net = require("net");
const os = require("os");

// Auto-discovery of network thermal printers (and therefore the cash drawer
// wired into them): probe every address on the machine's own private /24
// subnets for the raw-print port. Only private ranges are ever probed, same
// rule as printer.js, so this can't be pointed at an arbitrary host.
const PRIVATE = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/** Local IPv4 /24 prefixes ("192.168.1") of this machine's private interfaces. */
function localSubnets(interfaces = os.networkInterfaces()) {
  const out = new Set();
  for (const list of Object.values(interfaces)) {
    for (const i of list || []) {
      if (i.family !== "IPv4" || i.internal || !PRIVATE.some((re) => re.test(i.address))) continue;
      out.add(i.address.split(".").slice(0, 3).join("."));
    }
  }
  return [...out];
}

function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Returns [{ host, port }] for every address answering on `port`.
 * `probeFn(host, port, timeoutMs) -> Promise<boolean>` is injectable for tests.
 */
async function discoverPrinters({ port = 9100, timeoutMs = 400, concurrency = 64, subnets = localSubnets(), probeFn = probe } = {}) {
  const hosts = [];
  for (const prefix of subnets) for (let n = 1; n <= 254; n++) hosts.push(`${prefix}.${n}`);
  const found = [];
  let next = 0;
  const worker = async () => {
    while (next < hosts.length) {
      const host = hosts[next++];
      if (await probeFn(host, port, timeoutMs)) found.push({ host, port });
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
  return found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
}

module.exports = { discoverPrinters, localSubnets };
