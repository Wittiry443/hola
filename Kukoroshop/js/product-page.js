// js/product-page.js
import { API_URL } from "./config.js";
import { firstKeyValue, fmtPrice, makeImgEl, escapeHtml } from "./utils.js";
import { lastProductsCache, setLastProductsCache } from "./state.js";
import { mapToAvailableSheetKey } from "./stock.js";
import { db } from "./firebase.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

/*
  product.html?pk=<sheetKey>::<row>
  pk preferiblemente igual al que genera products.js (sheetKey::row)
*/

const container = document.getElementById("product-page-root") || document.body;

// estilos (si tu css ya cubre todo, puedes eliminar esto)
(function injectStyles() {
  if (document.getElementById("product-page-styles")) return;
  const s = document.createElement("style");
  s.id = "product-page-styles";
  s.textContent = `
    .pp-wrap{max-width:1200px;margin:28px auto;padding:20px;display:flex;gap:24px;flex-wrap:wrap;color:#e5e7eb;font-family:"Poppins",system-ui;}
    .pp-left{flex:1 1 420px;display:flex;align-items:center;justify-content:center;background:#020617;border-radius:12px;padding:18px;border:1px solid rgba(148,163,184,0.04)}
    .pp-left img{max-width:100%;max-height:72vh;object-fit:contain;border-radius:8px}
    .pp-right{flex:1 1 360px;min-width:260px}
    .pp-title{font-size:1.7rem;font-weight:800;margin-bottom:8px;color:#e5e7eb}
    .pp-desc{color:#cbd5e1;margin:12px 0;font-size:0.98rem;line-height:1.5}
    .pp-price{font-size:1.4rem;font-weight:800;color:#f97316;margin-bottom:8px}
    .pp-stock{display:inline-block;padding:6px 10px;border-radius:8px;background:rgba(15,23,42,0.8);border:1px solid rgba(148,163,184,0.05);color:#e5e7eb}
    .pp-reviews{margin-top:22px;border-radius:10px;padding:14px;background:rgba(15,23,42,0.6);border:1px solid rgba(148,163,184,0.04)}
    .review-entry{padding:10px;border-bottom:1px dashed rgba(148,163,184,0.03);display:flex;gap:12px;align-items:flex-start}
    .review-entry:last-child{border-bottom:none}
    .review-stars{color:#fff;font-size:16px;opacity:0.95;min-width:72px}
    .review-comment{color:#d1d5db}
    .review-meta{font-size:12px;color:#9ca3af;margin-top:6px}
    .no-reviews{color:#9ca3af;padding:14px;text-align:center}

    /* estilo para la respuesta del admin: debe verse distinto */
    .review-response {
      margin-top:10px;
      padding:10px;
      border-radius:8px;
      background: linear-gradient(90deg, rgba(34,36,46,0.6), rgba(16,18,27,0.45));
      border-left: 3px solid rgba(124,58,237,0.9);
      color: #dbeafe;
      font-size:13px;
      line-height:1.4;
    }
    .review-response .resp-by { font-weight:700; color:#e9d5ff; margin-bottom:6px; }
    .review-response .resp-date { font-size:12px; color:#9ca3af; margin-top:6px; }

    @media(max-width:900px){ .pp-wrap{flex-direction:column} .pp-left{order:0} .pp-right{order:1} }
  `;
  document.head.appendChild(s);
})();

// utilitarios
function parsePK(pk) {
  if (!pk) return null;
  const parts = pk.split("::");
  if (parts.length >= 2) {
    const row = parts.pop();
    const sheetKey = parts.join("::");
    return { sheetKey, row };
  }
  return null;
}

async function fetchProductFromAPI(sheetKey, row) {
  try {
    const r = await fetch(`${API_URL}?sheetKey=${encodeURIComponent(sheetKey)}&_=${Date.now()}`, { cache: "no-store" });
    const data = await r.json();
    const products = data.products || [];
    const found = products.find(p => String(p.row) === String(row));
    if (found) {
      if (!found.sheetKey) found.sheetKey = sheetKey;
      found.data = found.data || {};
      return found;
    }
    return null;
  } catch (e) {
    console.error("fetchProductFromAPI error", e);
    return null;
  }
}

function normalizeProductEntry(p, sheetKey) {
  const d = p.data || {};
  const name = firstKeyValue(d, ["name","nombre","producto","Nombre"]) || d.Nombre || d.nombre || "Sin nombre";
  const price = firstKeyValue(d, ["price","precio","Precio"]) || d.Precio || "";
  const stock = Number(firstKeyValue(d, ["stock","cantidad","Stock"]) || d.Stock || 0);
  const imgUrl = firstKeyValue(d, ["img","Img","imagen","image","url","Imagen"]) || d.Img || "";
  const description = firstKeyValue(d, ["descripcion","Descripcion","description","desc","nota","Nota"]) || d.descripcion || d.Descripcion || "";
  const sheet = (sheetKey || (p.sheetKey || d.Categoria || d.categoria || "UNKNOWN"));
  // productKey en el mismo formato que usas en tarjetas: sheet::row (sheet en minúsculas)
  const productKey = `${String(sheet).trim().toLowerCase()}::${String(p.row)}`;
  return { row: p.row, sheetKey: sheet, data: d, name, price, stock, imgUrl, description, productKey };
}

// slug helper para fallback (reviewsBySlug)
function slugify(str) {
  if (!str) return "";
  return String(str).toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // quitar diacríticos
    .replace(/[^\w\s-]/g, "") // quitar caracteres extraños
    .trim()
    .replace(/\s+/g, "-");
}

// Lee reseñas: intenta reviewsByProduct/{productKey}, luego reviewsByProduct/{slug}, luego reviewsBySlug/{slug}
async function loadReviews(productKey, productName) {
  console.groupCollapsed("[reviews] loadReviews start");
  console.debug("Inputs:", { productKey, productName });

  function pathReviewsByProduct(p) { return `reviewsByProduct/${p}`; }
  try {
    const tried = [];

    if (productKey) tried.push(pathReviewsByProduct(productKey));

    // si productKey tiene formato sheet::row, también probar slug (parte antes de ::)
    if (productKey && productKey.includes("::")) {
      const before = productKey.split("::")[0];
      if (before && before !== productKey) tried.push(pathReviewsByProduct(before));
    }

    // slug desde nombre
    const slugFromName = slugify(productName || "");
    if (slugFromName) {
      // intentar reviewsByProduct/<slug> y reviewsBySlug/<slug>
      tried.push(pathReviewsByProduct(slugFromName));
      tried.push(`reviewsBySlug/${slugFromName}`);
    }

    // limpiar duplicados y falsos
    const uniq = [...new Set(tried.filter(Boolean))];
    console.debug("[reviews] candidate paths:", uniq);

    for (const p of uniq) {
      console.debug(`[reviews] querying path: ${p}`);
      const snap = await get(ref(db, p));
      console.debug(`[reviews] path ${p} exists?`, !!(snap && snap.exists && snap.exists()));
      if (snap && snap.exists && snap.exists()) {
        const val = snap.val() || {};
        console.debug(`[reviews] fetched keys (${Object.keys(val).length}):`, Object.keys(val).slice(0, 20));
        const arr = Object.keys(val).map(k => ({ id: k, ...val[k] }));
        arr.forEach(r => { r.createdAt = Number(r.createdAt || 0); });
        arr.sort((a,b) => b.createdAt - a.createdAt);
        console.debug(`[reviews] returning ${arr.length} reviews from ${p}`);
        console.groupEnd();
        return arr;
      }
    }

    console.debug("[reviews] no reviews found for any path");
    console.groupEnd();
    return [];
  } catch (err) {
    console.error("[reviews] error reading reviews:", err);
    console.groupEnd();
    return [];
  }
}

function renderStars(n) {
  let s = "";
  for (let i=1;i<=5;i++) s += (i<=n) ? "★" : "☆";
  return s;
}

// montaje DOM principal
export async function mountProductPage() {
  try {
    const params = new URLSearchParams(location.search);
    const pk = params.get("pk");
    console.debug("[product-page] mounting, pk:", pk);
    if (!pk) {
      container.innerHTML = `<div style="padding:28px;text-align:center;color:#f88">Producto no especificado (pk faltante en URL).</div>`;
      return;
    }

    // estructura base
    container.innerHTML = `<div class="pp-wrap" id="pp-wrap">
      <div class="pp-left" id="pp-left"><div style="color:#9ca3af">Cargando imagen...</div></div>
      <div class="pp-right" id="pp-right">
        <div class="pp-title" id="pp-title"></div>
        <div class="pp-desc" id="pp-desc"></div>
        <div style="margin:12px 0">
          <div class="pp-price" id="pp-price"></div>
          <div style="margin-top:8px"><span class="pp-stock" id="pp-stock"></span></div>
        </div>

        <div id="pp-extra"></div>
      </div>
    </div>

    <div class="pp-wrap" style="max-width:1200px;">
      <div style="width:100%" class="pp-reviews" id="pp-reviews">
        <h3 style="margin:0 0 12px 0">Reseñas</h3>
        <div id="pp-reviews-list" aria-live="polite"></div>
      </div>
    </div>`;

    // resolver producto
    const product = await resolveProduct(pk);
    console.debug("[product-page] resolved product:", { productKey: product.productKey, name: product.name, row: product.row, sheetKey: product.sheetKey });

    // render imagen grande
    const left = document.getElementById("pp-left");
    left.innerHTML = "";
    if (product.imgUrl && /^https?:\/\//i.test(product.imgUrl)) {
      const img = makeImgEl(product.imgUrl, product.name || "Imagen del producto", "product-page-image", true);
      img.style.maxHeight = "72vh";
      img.style.width = "auto";
      left.appendChild(img);
    } else {
      left.innerHTML = `<div style="color:#9ca3af">Sin imagen</div>`;
    }

    // derecha: nombre/desc/price/stock
    document.getElementById("pp-title").innerText = product.name || "Sin nombre";
    document.getElementById("pp-desc").innerText = product.description || "Sin descripción";
    document.getElementById("pp-price").innerText = product.price ? ("$ " + fmtPrice(product.price)) : "-";
    document.getElementById("pp-stock").innerText = `Stock: ${Math.max(0, Number(product.stock || 0))}`;

    // cargar reseñas (usa loadReviews que prueba productKey y fallback slug)
    const reviewsList = document.getElementById("pp-reviews-list");
    reviewsList.innerHTML = `<div class="no-reviews">Cargando reseñas...</div>`;

    console.debug("[product-page] requesting reviews for", product.productKey);
    const reviews = await loadReviews(product.productKey, product.name);

    console.debug("[product-page] reviews result length:", reviews.length);
    if (!reviews || !reviews.length) {
      reviewsList.innerHTML = `<div class="no-reviews">Aún no hay reseñas para este producto.</div>`;
    } else {
      reviewsList.innerHTML = "";
      reviews.forEach(r => {
        // ------------- robust parsing of comment and user -------------
        // comment field can be named comment, coment, comentario, etc.
        const rawComment = (r.comment ?? r.coment ?? r.comentario ?? "");
        const commentTrim = String(rawComment || "").trim();
        const commentHtml = commentTrim !== "" ? escapeHtml(rawComment) : "<i style='color:#9ca3af'>Sin comentario</i>";

        // user object robustness
        const userObj = r.user || {};
        const userLabel = userObj.email || userObj.uid || (typeof userObj === "string" ? userObj : "Usuario");

        // createdAt safety
        const createdNum = Number(r.createdAt || r.timestamp || 0);
        const createdTxt = createdNum ? new Date(createdNum).toLocaleDateString() : "";

        // build response block if exists
        const resp = r.response || null;
        let respHtml = "";
        if (resp) {
          const respMessage = (resp.message === "" || resp.message === null || resp.message === undefined) ? "<i style='color:#9ca3af'>Sin contenido</i>" : escapeHtml(resp.message);
          const respBy = escapeHtml(resp.by || "Kukoro-support");
          const respDate = resp.createdAt ? new Date(Number(resp.createdAt)).toLocaleDateString() : "";
          respHtml = `
            <div class="review-response" role="note" aria-label="Respuesta del equipo">
              <div class="resp-by">Respuesta — ${respBy}</div>
              <div class="resp-message">${respMessage}</div>
              <div class="resp-date">${respDate ? escapeHtml(respDate) : ""}</div>
            </div>
          `;
        }

        // render
        const entry = document.createElement("div");
        entry.className = "review-entry";
        entry.innerHTML = `
          <div style="min-width:100px">
            <div class="review-stars">${renderStars(Number(r.stars||0))}</div>
            <div class="review-meta">${escapeHtml(String(userLabel))}${createdTxt ? " · " + escapeHtml(createdTxt) : ""}</div>
          </div>
          <div style="flex:1">
            <div class="review-comment">${commentHtml}</div>
            ${respHtml}
          </div>
        `;
        reviewsList.appendChild(entry);
      });
    }
  } catch (err) {
    console.error("mountProductPage error", err);
    container.innerHTML = `<div style="padding:28px;text-align:center;color:#f88">Error cargando producto: ${escapeHtml(String(err && err.message || err))}</div>`;
  }
}

// helpers que ya existían
async function resolveProduct(pk) {
  const parsed = parsePK(pk);
  if (!parsed) throw new Error("product key inválido");
  const { sheetKey, row } = parsed;

  // intentar cache local
  const cache = lastProductsCache || [];
  let p = cache.find(x => String(x.sheetKey) === String(sheetKey) && String(x.row) === String(row));
  if (p) return normalizeProductEntry(p, sheetKey);

  // si no está en cache, pedir al API
  const remote = await fetchProductFromAPI(sheetKey, row);
  if (remote) {
    const normalized = { row: remote.row, sheetKey: remote.sheetKey || sheetKey, data: remote.data || {} };
    setLastProductsCache([...(lastProductsCache || []), normalized]);
    return normalizeProductEntry(remote, sheetKey);
  }

  throw new Error("Producto no encontrado");
}

// Autostart
if (typeof window !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const params = new URLSearchParams(location.search);
    if (params.get("pk")) {
      mountProductPage().catch(e => console.error(e));
    }
  });
}
