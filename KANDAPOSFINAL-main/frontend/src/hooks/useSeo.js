import { useEffect } from "react";

const SITE_URL = "https://kandapos.com";

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!href) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * Sets a page's <title>, meta description, canonical URL, robots directive
 * and Open Graph tags. CRA has no server-side rendering, so this reaches
 * crawlers that execute JavaScript (Google's does) but not link-unfurl bots
 * that read raw HTML only — those still see the site-wide tags baked into
 * public/index.html, which is why that file's tags describe the homepage.
 */
export default function useSeo({ title, description, path, noindex }) {
  useEffect(() => {
    const fullTitle = title ? `${title} | Kanda POS` : "Kanda POS";
    document.title = fullTitle;
    if (description) upsertMeta("name", "description", description);
    upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
    const url = path ? `${SITE_URL}${path}` : null;
    upsertCanonical(url);
    upsertMeta("property", "og:title", fullTitle);
    if (description) upsertMeta("property", "og:description", description);
    if (url) upsertMeta("property", "og:url", url);
  }, [title, description, path, noindex]);
}

/** Injects a JSON-LD structured-data block, replacing it on unmount so
 *  pages don't accumulate stale schema from a previous route. */
export function useStructuredData(id, data) {
  useEffect(() => {
    if (!data) return;
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement("script");
      el.type = "application/ld+json";
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
    return () => { el && el.remove(); };
  }, [id, data]);
}
