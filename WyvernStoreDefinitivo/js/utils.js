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

function isAlreadyProxied(url) {
  if (!url) return false;
  try {
    const su = String(url);
    // Si ya apunta al proxy del worker o contiene image-proxy?url= evitamos proxificar
    return su.startsWith(API_URL) || su.indexOf('image-proxy?url=') !== -1;
  } catch (e) { return false; }
}

export function makeImgEl(url, alt, cls, eager = false) {
  const img = document.createElement('img');
  img.alt = alt || '';
  img.className = cls || '';
  img.loading = eager ? 'eager' : 'lazy';

  try {
    let finalUrl = url || '';
    if (finalUrl) {
      // Solo proxificamos si no está ya proxificado
      if (!isAlreadyProxied(finalUrl)) {
        finalUrl = API_URL + 'image-proxy?url=' + encodeURIComponent(finalUrl);
      }
    }

    if (eager) {
      img.src = finalUrl;
    } else {
      img.dataset.src = finalUrl;
      img.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    }
  } catch (e) {
    // fallback: usar la url original sin proxificar
    img.src = url || '';
  }

  img.style.objectFit = 'contain';
  // No elimines la imagen en error — ocultamos y dejamos que el caller muestre placeholder
  img.addEventListener('error', () => {
    img.style.display = 'none';
    img.removeAttribute('data-src');
  });

  return img;
}
