// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import {
  ref,
  onValue,
  get,
  push,
  set
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// UI elements
const loadingEl = document.getElementById("orders-loading");
const listEl = document.getElementById("orders-list");
const userLabel = document.getElementById("user-label");
const cartBtn = document.getElementById("cart-icon-btn");
const adminBtn = document.getElementById("admin-panel-btn");

// Mapa local de pedidos cargados (key -> order)
let currentOrdersMap = {};

// ====== setup UI / modal de factura (inyecta estilos centralizados) ======
(function setupInvoiceUI() {
  if (document.getElementById("invoice-overlay")) return;

  const style = document.createElement("style");
  style.id = "invoice-styles";
  style.innerHTML = `
/* Modal factura: armonizado con styles.css (tema oscuro) */
.invoice-modal-overlay {
  position: fixed; inset: 0; z-index: 99999;
  display: none; justify-content: center; align-items: center;
  background: linear-gradient(180deg, rgba(2,6,23,0.8), rgba(2,6,23,0.8));
  padding: 20px;
}
.invoice-modal {
  width: 100%; max-width: 760px; max-height: 90vh;
  border-radius: 12px; display:flex; flex-direction:column;
  overflow: hidden;
  background:
    radial-gradient(circle at 20% 0%, rgba(37,99,235,0.04), transparent 55%),
    radial-gradient(circle at 80% 100%, rgba(168,85,247,0.02), transparent 60%),
    #020617;
  border: 1px solid rgba(148,163,184,0.06);
  box-shadow: 0 20px 60px rgba(2,6,23,0.9);
  color: #e5e7eb;
  font-family: "Poppins", system-ui, -apple-system, "Segoe UI", sans-serif;
}
.invoice-header {
  padding: 14px 18px; display:flex; justify-content:space-between; align-items:center;
  background: rgba(15,23,42,0.95); border-bottom: 1px solid rgba(148,163,184,0.03);
}
.invoice-header h3 { margin:0; font-size:18px; color:#e5e7eb; }
.invoice-body {
  padding: 16px 18px; overflow-y:auto; max-height: calc(90vh - 170px);
  color: #d1d5db; font-size:14px; line-height:1.45;
}
.invoice-items-table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
.invoice-items-table th {
  text-align:left; padding:8px; color:#9ca3af; font-weight:700;
  border-bottom: 1px solid rgba(148,163,184,0.03);
}
.invoice-items-table td {
  padding:10px 8px; color:#e9e9eb; border-bottom: 1px solid rgba(148,163,184,0.01);
}
.invoice-footer {
  padding: 12px 18px; border-top: 1px solid rgba(148,163,184,0.03); text-align:right;
  background: transparent;
}
.btn-invoice-action {
  background: linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; padding:8px 14px;
  border-radius:8px; border:none; cursor:pointer; font-weight:700;
}
.btn-close-invoice {
  background:transparent; border:none; font-size:22px; color:#e5e7eb; cursor:pointer;
}
.invoice-small { font-size:12px; color:#9ca3af; }

/* Modal reseñas */
.review-modal-overlay {
  position: fixed; inset:0; z-index:100000; display:none; align-items:center; justify-content:center;
  background: linear-gradient(180deg, rgba(2,6,23,0.7), rgba(2,6,23,0.7));
  padding:18px;
}
.review-modal {
  width:100%; max-width:760px; max-height:90vh; overflow:auto; border-radius:12px;
  background: #020617; border:1px solid rgba(148,163,184,0.06); color:#e5e7eb; padding:16px;
}
.review-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
.review-title { font-size:18px; font-weight:700; color:#e5e7eb; }
.review-list { display:flex; flex-direction:column; gap:12px; margin-top:8px; }
.review-item { padding:12px; border-radius:10px; background: rgba(255,255,255,0.02); border:1px solid rgba(148,163,184,0.02); }
.product-name { font-weight:700; color:#e5e7eb; margin-bottom:8px; }
.stars { display:inline-flex; gap:6px; align-items:center; }
.star { font-size:20px; color: rgba(255,255,255,0.25); cursor:pointer; user-select:none; }
.star.active { color: #ffffff; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
.review-comment { width:100%; margin-top:8px; padding:8px; border-radius:8px; background:#0f172a; color:#e5e7eb; border:1px solid rgba(31,41,55,0.9); display:none; }
.review-actions { display:flex; gap:8px; justify-content:flex-end; margin-top:12px; }
.review-save { background: linear-gradient(135deg,#4f46e5,#7c3aed); color:#fff; padding:8px 12px; border-radius:8px; border:none; cursor:pointer; font-weight:700; }
.review-cancel { background:transparent; border:1px solid rgba(148,163,184,0.06); color:#e5e7eb; padding:8px 12px; border-radius:8px; cursor:pointer; }
@media (max-width:640px) {
  .invoice-modal, .review-modal { max-width:95%; }
}
  `;
  document.head.appendChild(style);

  const modalHTML = `
    <div id="invoice-overlay" class="invoice-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="invoice-modal" role="document" aria-labelledby="invoice-title">
        <div class="invoice-header">
          <h3 id="invoice-title">Detalle de Factura</h3>
          <div><button id="close-invoice-btn" class="btn-close-invoice" aria-label="Cerrar">&times;</button></div>
        </div>
        <div id="invoice-content" class="invoice-body" tabindex="0"></div>
        <div class="invoice-footer">
          <button id="print-invoice-btn" class="btn-invoice-action">Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>

    <div id="review-overlay" class="review-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="review-modal" role="document" aria-labelledby="review-title">
        <div class="review-header">
          <div class="review-title" id="review-title">Dejar reseña</div>
          <div><button id="review-close-btn" class="btn-close-invoice" aria-label="Cerrar reseñas">&times;</button></div>
        </div>
        <div id="review-body" class="review-list" tabindex="0"></div>
        <div class="review-actions" style="margin-top:12px">
          <button id="review-cancel-btn" class="review-cancel">Cancelar</button>
          <button id="review-save-btn" class="review-save">Guardar reseñas</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  const invoiceOverlay = document.getElementById("invoice-overlay");
  const closeBtn = document.getElementById("close-invoice-btn");
  const printBtn = document.getElementById("print-invoice-btn");

  function closeInvoice() {
    if (!invoiceOverlay) return;
    invoiceOverlay.style.display = "none";
    invoiceOverlay.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    window.removeEventListener("keydown", invoiceKeyHandler);
  }
  function invoiceKeyHandler(e) { if (e.key === "Escape") closeInvoice(); }
  if (closeBtn) closeBtn.addEventListener("click", closeInvoice);
  if (invoiceOverlay) invoiceOverlay.addEventListener("click", (e) => { if (e.target === invoiceOverlay) closeInvoice(); });
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  window.__showInvoiceOverlay = function() {
    if (!invoiceOverlay) return;
    invoiceOverlay.style.display = "flex";
    invoiceOverlay.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", invoiceKeyHandler);
    const content = document.getElementById("invoice-content"); if (content) content.focus();
  };
  window.__hideInvoiceOverlay = closeInvoice;

  // Reviews modal handlers
  const reviewOverlay = document.getElementById("review-overlay");
  const reviewBody = document.getElementById("review-body");
  const reviewClose = document.getElementById("review-close-btn");
  const reviewCancel = document.getElementById("review-cancel-btn");
  const reviewSave = document.getElementById("review-save-btn");

  function closeReviewModal() {
    if (!reviewOverlay) return;
    reviewOverlay.style.display = "none";
    reviewOverlay.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    reviewBody.innerHTML = "";
    window.removeEventListener("keydown", reviewKeyHandler);
  }
  function reviewKeyHandler(e) { if (e.key === "Escape") closeReviewModal(); }

  if (reviewClose) reviewClose.addEventListener("click", closeReviewModal);
  if (reviewCancel) reviewCancel.addEventListener("click", closeReviewModal);
  if (reviewOverlay) reviewOverlay.addEventListener("click", (e) => { if (e.target === reviewOverlay) closeReviewModal(); });

  // Save handler (collected reviews)
  if (reviewSave) {
    reviewSave.addEventListener("click", async () => {
      try {
        reviewSave.disabled = true;
        const items = Array.from(reviewBody.querySelectorAll(".review-item"));
        const reviewsToSave = items.map(node => {
          const productName = node.dataset.productName;
          const productKey = node.dataset.productKey || null;
          const stars = Number(node.dataset.selectedStars || 0);
          const commentEl = node.querySelector(".review-comment");
          const comment = commentEl ? commentEl.value.trim() : "";
          return { productName, productKey, stars, comment };
        }).filter(r => r.stars > 0 || (r.comment && r.comment.length > 0));

        if (!reviewsToSave.length) {
          alert("No has dejado ninguna reseña. Selecciona al menos 1 estrella o escribe un comentario.");
          reviewSave.disabled = false;
          return;
        }

        // obtener usuario
        const user = auth.currentUser || null;
        const userMeta = { uid: user?.uid || null, email: user?.email || null };
        const now = Date.now();
        const orderKey = reviewBody.dataset.orderKey || null;

        // guardar cada reseña en DB: preferir reviewsByProduct/{productKey} si existe, sino reviewsBySlug/{slug}
        const results = [];
        for (const r of reviewsToSave) {
          const slug = slugify(r.productName);
          const payload = {
            productKey: r.productKey || null,
            productSlug: slug,
            productName: r.productName,
            stars: Number(r.stars || 0),
            comment: r.comment || "",
            user: userMeta,
            orderKey: orderKey,
            createdAt: now
          };

          if (r.productKey) {
            const path = `reviewsByProduct/${r.productKey}`;
            const nodeRef = await push(ref(db, path));
            await set(nodeRef, payload);
            results.push({ ok: true, path, key: nodeRef.key });
          } else {
            const path = `reviewsBySlug/${slug}`;
            const nodeRef = await push(ref(db, path));
            await set(nodeRef, payload);
            results.push({ ok: true, path, key: nodeRef.key });
          }
        }

        alert("Reseñas guardadas. ¡Gracias!");
        closeReviewModal();
      } catch (err) {
        console.error("Error guardando reseñas:", err);
        alert("Error guardando reseñas. Revisa la consola.");
      } finally {
        reviewSave.disabled = false;
      }
    });
  }

  // Expose helper to open review modal with items
  window.__openReviewModal = function(orderKey, products) {
    if (!reviewOverlay || !reviewBody) return;
    reviewBody.innerHTML = "";
    reviewBody.dataset.orderKey = orderKey || null;

    // Build UI rows
    products.forEach(p => {
      const keyAttr = p.productKey ? `data-product-key="${escapeHtml(p.productKey)}"` : "";
      const node = document.createElement("div");
      node.className = "review-item";
      node.dataset.productName = p.name;
      if (p.productKey) node.dataset.productKey = p.productKey;
      node.dataset.selectedStars = "0";

      const starsHtml = Array.from({length:5}).map((_, i) =>
        `<span class="star" data-star="${i+1}" title="${i+1} estrella(s)">★</span>`
      ).join("");

      node.innerHTML = `
        <div class="product-name">${escapeHtml(p.name)}</div>
        <div class="stars">${starsHtml}</div>
        <textarea class="review-comment" placeholder="Escribe un comentario opcional..." rows="3"></textarea>
      `;
      reviewBody.appendChild(node);

      // wiring stars
      const starEls = node.querySelectorAll(".star");
      starEls.forEach(s => {
        s.addEventListener("click", () => {
          const n = Number(s.dataset.star || 0);
          node.dataset.selectedStars = String(n);
          // update UI
          starEls.forEach(se => {
            const val = Number(se.dataset.star || 0);
            if (val <= n) se.classList.add("active"); else se.classList.remove("active");
          });
          // show textarea when at least 1 star
          const ta = node.querySelector(".review-comment");
          if (ta) ta.style.display = (n > 0) ? "block" : "none";
        });
      });

      // if product comes with preselected rating (optional), apply
      if (p.preStars && Number(p.preStars) > 0) {
        const n = Number(p.preStars);
        node.dataset.selectedStars = String(n);
        node.querySelectorAll(".star").forEach(se => {
          const val = Number(se.dataset.star || 0);
          if (val <= n) se.classList.add("active"); else se.classList.remove("active");
        });
        const ta = node.querySelector(".review-comment");
        if (ta) ta.style.display = "block";
      }
    });

    // show overlay
    reviewOverlay.style.display = "flex";
    reviewOverlay.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", reviewKeyHandler);
    const first = reviewBody.querySelector(".star");
    if (first) first.focus();
  };

  // small slug helper used by save
  function slugify(s) {
    return String(s || "").toLowerCase().trim()
      .replace(/[^a-z0-9\u00C0-\u017F -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
  }
})();

// Verificar elementos necesarios
if (!loadingEl || !listEl) {
  // silencioso: permitimos que la página cargue sin errores
}

// manejadores opcionales
cartBtn?.addEventListener("click", () => { /* abrir carrito */ });
adminBtn?.addEventListener("click", () => location.href = "admin.html");

// Escuchar estado auth
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "index.html";
  if (userLabel) userLabel.textContent = user.email || "";
  try { await auth.currentUser.getIdToken(true); } catch (e) { /* no crítico */ }
  listenUserOrders(user.uid, user.email || "");
});

// obtener info del usuario actual
function getCurrentUserInfo() {
  const u = auth.currentUser;
  if (!u) return { uid: null, email: null, displayName: null };
  return { uid: u.uid || null, email: u.email || null, displayName: u.displayName || null };
}

// Escuchar pedidos del usuario con fallback a /orders
function listenUserOrders(uid, email) {
  if (loadingEl) loadingEl.style.display = "block";
  if (listEl) { listEl.style.display = "none"; listEl.innerHTML = ""; }

  const userOrdersRef = ref(db, `users/${uid}/orders`);

  onValue(userOrdersRef, async (snap) => {
    try {
      const val = snap.val();
      if (val && Object.keys(val).length) {
        renderOrdersObject(val);
        return;
      }

      // fallback a /orders
      const ordersRef = ref(db, "orders");
      const ordersSnap = await get(ordersRef);
      const all = ordersSnap.val() || {};

      const filtered = Object.fromEntries(
        Object.entries(all).filter(([k, o]) => {
          if (!o) return false;
          if (o.uid && String(o.uid) === String(uid)) return true;
          if (o.userEmail && String(o.userEmail).toLowerCase() === String(email).toLowerCase()) return true;
          if (o.cliente && String(o.cliente).toLowerCase() === String(email).toLowerCase()) return true;
          return false;
        })
      );

      if (Object.keys(filtered).length) renderOrdersObject(filtered);
      else renderEmpty();
    } catch (err) {
      const ctx = getCurrentUserInfo();
      renderError(err, ctx);
    }
  }, (err) => {
    const ctx = getCurrentUserInfo();
    renderError(err, ctx);
  });
}

// Renderizar pedidos en lista (y construir mapa local)
function renderOrdersObject(obj) {
  currentOrdersMap = {};
  if (loadingEl) loadingEl.style.display = "none";
  if (listEl) listEl.style.display = "block";
  if (!listEl) return;

  const entries = Object.entries(obj).sort((a, b) => {
    const ta = a[1]?.createdAt ? Date.parse(a[1].createdAt) || a[1].createdAt : (a[1]?.createdAt || 0);
    const tb = b[1]?.createdAt ? Date.parse(b[1].createdAt) || b[1].createdAt : (b[1]?.createdAt || 0);
    return tb - ta;
  });

  if (!entries.length) return renderEmpty();

  listEl.innerHTML = "";
  const frag = document.createDocumentFragment();

  entries.forEach(([key, order]) => {
    currentOrdersMap[key] = order;

    const idPedido = order.idPedido || key;
    const cliente  = order.cliente || order.userEmail || "Sin cliente";
    const resumen  = order.resumen || summarizeOrder(order) || "Sin resumen";
    const estado   = (order.estado || order.status || "pendiente").toString();
    const total    = Number(order.total || 0);

    const createdTxt = order.createdAt
      ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString())
      : "—";

    const article = document.createElement("article");
    article.className = "order-card";
    article.style.cssText = "border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);";
    // "Dejar reseña" only if estado is 'entregado' (case-insensitive)
    const isEntregado = String(estado).toLowerCase() === "entregado";

    article.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600">Pedido: ${escapeHtml(String(idPedido))}</div>
          <div style="color:#9ca3af;font-size:13px;margin-top:4px">Fecha: ${escapeHtml(createdTxt)} · Cliente: ${escapeHtml(cliente)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${fmtPrice(total)}</div>
          <div style="margin-top:6px">
            <span class="estado" style="padding:6px 10px;border-radius:999px;background:rgba(255,255,255,0.06);font-size:12px;color:#e9e9eb">${escapeHtml(estado)}</span>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;color:#cbd5e1;font-size:14px;">${escapeHtml(resumen)}</div>
      <div style="margin-top:12px;border-top:1px solid rgba(148,163,184,0.03);padding-top:8px;text-align:right;">
        <button class="btn-view-invoice" data-order-key="${escapeHtml(String(key))}" style="background-color:rgba(255,255,255,0.95);border:1px solid rgba(148,163,184,0.06);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;color:#111">📄 Ver Factura</button>
        ${isEntregado ? `<button class="btn-leave-review" data-order-key="${escapeHtml(String(key))}" style="margin-left:8px;background:transparent;border:1px solid rgba(148,163,184,0.06);padding:6px 12px;border-radius:6px;color:#e5e7eb;cursor:pointer">⭐ Dejar reseña</button>` : ''}
      </div>
    `;
    frag.appendChild(article);
  });

  listEl.appendChild(frag);

  // delegación: un solo handler para todos los botones "Ver Factura" y "Dejar reseña"
  listEl.onclick = (e) => {
    const btn = e.target.closest ? e.target.closest(".btn-view-invoice, .btn-leave-review") : null;
    if (!btn) return;
    const orderKey = btn.dataset.orderKey;
    if (!orderKey) return;
    const order = currentOrdersMap[orderKey];
    if (!order) return;

    if (btn.classList.contains("btn-view-invoice")) {
      const createdTxt = order.createdAt ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString()) : "—";
      showInvoiceDetails(order, order.idPedido || orderKey, createdTxt);
      return;
    }

    if (btn.classList.contains("btn-leave-review")) {
      // build products list for review modal
      const products = buildProductsForReview(order);
      // open modal
      window.__openReviewModal(orderKey, products);
      return;
    }
  };
}

// Construye array de productos { name, qty, productKey? } desde order.items / cart / resumen
function buildProductsForReview(order) {
  let rawItems = Array.isArray(order.items) ? order.items
               : (Array.isArray(order.cart) ? order.cart : []);

  const products = [];

  if (rawItems && rawItems.length) {
    rawItems.forEach(it => {
      const name = it.nombre || it.name || it.title || "Producto";
      const qty = (it.cantidad !== undefined) ? Number(it.cantidad) : (it.qty !== undefined ? Number(it.qty) : (it.quantity !== undefined ? Number(it.quantity) : 1));
      // if sheetKey & row exist in item, create productKey
      const sheetKey = it.sheetKey || it.sheet || it.sheet_key || null;
      const row = it.row || it.rowId || it.r || null;
      const productKey = (sheetKey && row) ? `${sheetKey}::${row}` : (it.id ? String(it.id) : null);
      products.push({ name: String(name), qty: Number(qty || 1), productKey: productKey || null });
    });
    return products;
  }

  // fallback: parse resumen "1 x Nombre | 2 x Otro"
  if (order.resumen) {
    const parts = String(order.resumen).split(/\s*\|\s*/).filter(Boolean);
    parts.forEach(p => {
      const m = p.match(/^(\d+)\s*x\s*(.+)$/i);
      if (m) {
        products.push({ name: m[2].trim(), qty: Number(m[1]), productKey: null });
      } else {
        products.push({ name: p.trim(), qty: 1, productKey: null });
      }
    });
    return products;
  }

  // no items
  return [];
}

// Mostrar modal con detalles (items normalizados + fallback resumen)
function showInvoiceDetails(order, idDisplay, dateDisplay) {
  if (!order || typeof order !== "object") return;
  const overlay = document.getElementById("invoice-overlay");
  const contentEl = document.getElementById("invoice-content");
  if (!overlay || !contentEl) return;

  // Items: preferir order.items / order.cart
  let rawItems = Array.isArray(order.items) ? order.items
               : (Array.isArray(order.cart) ? order.cart : []);

  // Normalizar items si existen
  const itemsToRender = (rawItems || []).map(it => {
    const name = it.nombre || it.name || it.title || "Producto";
    const qtyRaw = (it.cantidad !== undefined) ? it.cantidad : (it.qty !== undefined ? it.qty : (it.quantity !== undefined ? it.quantity : null));
    const qty = (qtyRaw === null || qtyRaw === "" || isNaN(Number(qtyRaw))) ? null : Number(qtyRaw);
    const priceRaw = (it.precioUnitario !== undefined) ? it.precioUnitario : (it.precioUnitaria !== undefined ? it.precioUnitaria : (it.price !== undefined ? it.price : null));
    const price = (priceRaw === null || priceRaw === "" || isNaN(Number(priceRaw))) ? null : Number(priceRaw);
    return { name: String(name), qty, price, raw: it };
  });

  let itemsHtml = "";

  if (itemsToRender.length) {
    const rows = itemsToRender.map(it => {
      const nm = escapeHtml(it.name);
      const qtyTxt = (it.qty === null) ? "—" : escapeHtml(String(it.qty));
      const priceTxt = (typeof it.price === "number") ? fmtPrice(it.price) : "—";
      const lineTotalTxt = (typeof it.price === "number" && it.qty !== null) ? fmtPrice(it.price * it.qty) : "—";

      // ref: solo mostrar si existe y no es '-'/'null'/'undefined'/''
      let refCandidate = null;
      if (it.raw) {
        const possible = it.raw.id || it.raw.row || it.raw.sku || it.raw.ref;
        if (possible !== undefined && possible !== null) {
          const s = String(possible).trim();
          if (s !== "" && s !== "-" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") {
            refCandidate = s;
          }
        }
      }

      return `
        <tr>
          <td>
            <strong>${nm}</strong>
            ${refCandidate ? `<div class="invoice-small" style="margin-top:6px">Ref: ${escapeHtml(refCandidate)}</div>` : ""}
          </td>
          <td style="text-align:center;">${qtyTxt}</td>
          <td style="text-align:right;">${priceTxt}</td>
          <td style="text-align:right;">${lineTotalTxt}</td>
        </tr>
      `;
    }).join("");

    itemsHtml = `
      <table class="invoice-items-table" role="table" aria-label="Items">
        <thead>
          <tr>
            <th style="width:60%">Producto</th>
            <th style="text-align:center;">Cant.</th>
            <th style="text-align:right;">Precio</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else if (order.resumen) {
    // Fallback: parsear resumen string "1 x Nombre | 2 x Otro"
    const parts = String(order.resumen).split(/\s*\|\s*/).filter(Boolean);
    const rows = parts.map(p => {
      const m = p.match(/^(\d+)\s*x\s*(.+)$/i);
      if (m) {
        const qty = escapeHtml(m[1]);
        const name = escapeHtml(m[2].trim());
        return `<tr><td><strong>${name}</strong></td><td style="text-align:center;">${qty}</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
      }
      return `<tr><td><strong>${escapeHtml(p)}</strong></td><td style="text-align:center;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
    }).join("");
    itemsHtml = `
      <table class="invoice-items-table" role="table" aria-label="Items">
        <thead>
          <tr>
            <th style="width:60%">Producto</th>
            <th style="text-align:center;">Cant.</th>
            <th style="text-align:right;">Precio</th>
            <th style="text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  } else {
    itemsHtml = `<div style="text-align:center;padding:18px;color:#9ca3af">No hay detalle de items.</div>`;
  }

  // Totales/cliente
  const clienteNameDisplay = escapeHtml(order.cliente || order.userEmail || "Cliente");
  const direccionDisplay = escapeHtml(order.shipping?.address || order.address || order.direccion || "No especificada");
  const telefonoDisplay = escapeHtml(order.shipping?.phone || order.phone || order.telefono || "—");
  const shippingCost = Number(order.shipping?.cost || order.shippingCost || 0);
  const total = Number(order.total || 0);
  const subtotal = Number(order.subtotal || (shippingCost > 0 ? (total - shippingCost) : total)) || 0;

  const html = `
    <div style="margin-bottom:12px;border-bottom:1px solid rgba(148,163,184,0.03);padding-bottom:8px">
      <h4 style="margin:0 0 6px 0;color:#e5e7eb">Kukoro-shop</h4>
      <div class="invoice-small">Confirmación de Orden</div>
    </div>

    <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px">
      <div style="flex:1;min-width:180px">
        <strong style="display:block;margin-bottom:6px;color:#e5e7eb">Facturar a:</strong>
        <div style="color:#cbd5e1;font-size:14px">
          ${clienteNameDisplay}<br>
          ${direccionDisplay}<br>
          ${telefonoDisplay}
        </div>
      </div>
      <div style="flex:1;min-width:180px;text-align:right">
        <strong style="display:block;margin-bottom:6px;color:#e5e7eb">Detalles:</strong>
        <div style="color:#cbd5e1;font-size:14px">
          ID: <strong>${escapeHtml(String(idDisplay))}</strong><br>
          Fecha: ${escapeHtml(String(dateDisplay))}<br>
          Estado: ${escapeHtml(order.estado || order.status || "Pendiente")}
        </div>
      </div>
    </div>

    ${itemsHtml}

    <div style="border-top:1px solid rgba(148,163,184,0.03);padding-top:12px;margin-top:10px">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Subtotal:</span><span>${fmtPrice(subtotal)}</span></div>
      ${shippingCost > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Envío:</span><span>${fmtPrice(shippingCost)}</span></div>` : ""}
      <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;margin-top:6px"><span>TOTAL:</span><span>${fmtPrice(total)}</span></div>
    </div>
  `;

  contentEl.innerHTML = html;
  // mostrar modal
  window.__showInvoiceOverlay();
  // asegurar scroll top
  const overlayElem = document.getElementById("invoice-overlay");
  if (overlayElem) overlayElem.scrollTop = 0;
  if (contentEl) contentEl.scrollTop = 0;
}

// resumen para listar
function summarizeOrder(order) {
  if (!order) return "";
  if (order.resumen) return order.resumen;
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.slice(0,4).map(it => `${it.name || it.title || it.id || 'item'} x${it.qty||it.quantity||1}`).join(", ");
  }
  if (Array.isArray(order.cart) && order.cart.length) {
    return order.cart.slice(0,4).map(it => `${it.name || it.id || 'item'} x${it.qty||1}`).join(", ");
  }
  return "";
}

function renderEmpty() {
  if (loadingEl) loadingEl.style.display = "none";
  if (listEl) { listEl.style.display = "block"; listEl.innerHTML = `<div style="padding:18px;color:#9ca3af;text-align:center">No tienes pedidos registrados todavía.</div>`; }
}

function renderError(err, userCtx = null) {
  if (loadingEl) loadingEl.style.display = "none";
  if (listEl) listEl.style.display = "block";
  const msg = (err && err.message) ? escapeHtml(err.message) : "Error desconocido";

  let userInfoHtml = "";
  if (userCtx) {
    const u = escapeHtml(String(userCtx.uid || "null"));
    const e = escapeHtml(String(userCtx.email || "null"));
    const d = escapeHtml(String(userCtx.displayName || "null"));
    userInfoHtml = `<div style="margin-top:8px;font-size:12px;color:#999">Request user — uid: ${u} · email: ${e} · name: ${d}</div>`;
  }

  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#f97373;text-align:center">No se pudieron cargar tus pedidos: ${msg}${userInfoHtml}</div>`;
}

export {}; // evita export accidental de variables globales en módulo
