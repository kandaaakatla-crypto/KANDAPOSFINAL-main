// CRA/craco has no server-side rendering — every per-page title/canonical/
// description/OG tag that useSeo() sets (src/hooks/useSeo.js) only lands in
// the DOM after React mounts. Google's crawler executes JS and sees it fine,
// but anything reading raw HTML — link-preview unfurlers (WhatsApp, iMessage,
// Slack, Twitter/X), some SEO tools — only ever sees build/index.html's
// site-wide (homepage) tags, on every route.
//
// This runs after `craco build` and bakes a real, page-specific index.html
// for each public route below, by copying the built index.html (so the
// correct hashed JS/CSS bundle references come along) and swapping just the
// per-page meta values. firebase.json's rewrites for these routes point at
// the generated files instead of the generic index.html. React still
// hydrates and takes over client-side exactly as before — this only changes
// what's in the initial HTML response.
//
// Keep this list's title/description in sync with the useSeo() calls in the
// corresponding page component (see src/components/legal/*.jsx) — there's
// no automated link between the two.
const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build");
const SITE_URL = "https://kandapos.com";

const PAGES = [
  {
    route: "privacy",
    title: "Privacy policy",
    description:
      "How Kanda POS collects, uses and protects data for the businesses and customers using our restaurant and retail point of sale platform.",
  },
  {
    route: "terms",
    title: "Terms and conditions",
    description:
      "The terms that govern use of the Kanda POS restaurant and retail point of sale platform.",
  },
];

function replaceOne(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`prerender-seo: pattern not found in build/index.html: ${pattern}`);
  }
  return html.replace(pattern, replacement);
}

const indexHtml = fs.readFileSync(path.join(BUILD_DIR, "index.html"), "utf8");

for (const { route, title, description } of PAGES) {
  const fullTitle = `${title} | Kanda POS`;
  const url = `${SITE_URL}/${route}`;

  let html = indexHtml;
  html = replaceOne(html, /<title>[^<]*<\/title>/, `<title>${fullTitle}</title>`);
  html = replaceOne(html, /(<meta name="description" content=")[^"]*(")/, `$1${description}$2`);
  html = replaceOne(html, /(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`);
  html = replaceOne(html, /(<meta property="og:title" content=")[^"]*(")/, `$1${fullTitle}$2`);
  html = replaceOne(html, /(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`);
  html = replaceOne(html, /(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`);
  html = replaceOne(html, /(<meta name="twitter:title" content=")[^"]*(")/, `$1${fullTitle}$2`);
  html = replaceOne(html, /(<meta name="twitter:description" content=")[^"]*(")/, `$1${description}$2`);

  const outDir = path.join(BUILD_DIR, route);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html);
  console.log(`prerender-seo: wrote build/${route}/index.html`);
}
