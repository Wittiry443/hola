// js/utils.js
import { API_URL } from "./config.js";

export function firstKeyValue(obj, keys) {
  if (!obj) return undefined;
  const map = {};
  Object.keys(obj).forEach(k => (map[k.toLowerCase()] = obj[k]));
  for (const k of keys) {
    const v = map[k.toLowerCase()];
    if (v !== undefined && v !== null && String(v).trim() !== "") return v;
  }
  return undefined;
}

export function parsePriceNumber(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v === "number" && !isNaN(v)) return v;
  let s = String(v).trim();
  if (s === "") return 0;
  s = s
    .replace(/\s+/g, "")
    .replace(/\./g, "")
    .replace(/,/g, ".")
    .replace(/[^0-9.\-]/g, "");
  const n = Number(s);
  return isNaN(n) ? 0 : n;
}

export function fmtPrice(v) {
  const n = parsePriceNumber(v);
  return Number(n).toLocaleString("de-DE");
}

export function escapeHtml(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Lazy load
const lazyObserver =
  typeof IntersectionObserver === "undefined"
    ? null
    : new IntersectionObserver(
        (entries, obs) => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const img = entry.target;
            const src = img.dataset && img.dataset.src;
            if (src) {
              img.src = src;
              delete img.dataset.src;
            }
            obs.unobserve(img);
          });
        },
        { rootMargin: "300px 0px", threshold: 0.01 }
      );

export function observeLazyImages(rootEl) {
  if (!lazyObserver) return;
  const imgs = (rootEl || document).querySelectorAll("img[data-src]");
  imgs.forEach(img => {
    if (document.contains(img)) lazyObserver.observe(img);
  });
}

export function makeImgEl(url, alt, cls, eager = false) {
  const img = document.createElement("img");
  img.alt = alt || "";
  img.className = cls || "";
  img.loading = eager ? "eager" : "lazy";

  try {
    const proxied = url
      ? API_URL + "image-proxy?url=" + encodeURIComponent(url)
      : "";
    if (eager) {
      img.src = proxied;
    } else {
      img.dataset.src = proxied;
      img.src =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    }
  } catch (e) {
    img.src = "";
  }

  img.style.objectFit = "contain";
  img.onerror = () => img.remove();
  return img;
}
