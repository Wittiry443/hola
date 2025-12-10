// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import {
  ref,
  onValue,
  get,
  set
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

// importa el módulo de cancel-product (el que creamos antes)
import cancelModule from "./cancel-product.js";

// UI elements
const loadingEl = document.getElementById("orders-loading");
const listEl = document.getElementById("orders-list");
const userLabel = document.getElementById("user-label");
const cartBtn = document.getElementById("cart-icon-btn");
const adminBtn = document.getElementById("admin-panel-btn");

// Mapa local de pedidos cargados (key -> order)
let currentOrdersMap = {};

// ====== setup UI / modal (estilos centralizados) ======
(function setupUI() {
  if (document.getElementById("invoice-styles")) return;
  const style = document.createElement("style");
  style.id = "invoice-styles";
  style.innerHTML = `
/* Invoice + review modal (tema oscuro, coherente con styles.css) */
.invoice-modal-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(2,6,23,0.8),rgba(2,6,23,0.8));z-index:99999;padding:18px}
.invoice-modal{width:100%;max-width:760px;border-radius:12px;background:#020617;border:1px solid rgba(148,163,184,0.06);box-shadow:0 20px 60px rgba(2,6,23,0.9);color:#e5e7eb;overflow:hidden;font-family:"Poppins",system-ui,Segoe UI}
.invoice-header{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;background:rgba(15,23,42,0.95);border-bottom:1px solid rgba(148,163,184,0.03)}
.invoice-body{padding:16px 18px;max-height:60vh;overflow:auto;color:#d1d5db;font-size:14px}
.invoice-footer{padding:12px 18px;border-top:1px solid rgba(148,163,184,0.03);text-align:right}
.btn-invoice-action{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:8px 12px;border-radius:8px;border:none;cursor:pointer}
.btn-close-invoice{background:transparent;border:none;color:#e5e7eb;font-size:20px;cursor:pointer}
.invoice-items-table{width:100%;border-collapse:collapse;margin-top:12px}
.invoice-items-table th{color:#9ca3af;padding:8px;text-align:left;border-bottom:1px solid rgba(148,163,184,0.03)}
.invoice-items-table td{padding:10px 8px;border-bottom:1px solid rgba(148,163,184,0.01);color:#e9eeb}

/* Review modal */
.review-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:100000;padding:12px}
.review-box{width:100%;max-width:720px;background:#020617;border-radius:12px;padding:14px;border:1px solid rgba(148,163,184,0.06);box-shadow:0 20px 60px rgba(2,6,23,0.8);color:#e5e7eb}
.review-item{border-radius:8px;padding:10px;background:rgba(15,23,42,0.6);margin-bottom:10px;display:flex;gap:12px;align-items:flex-start}
.review-item h4{margin:0;font-size:15px}
.stars{display:flex;gap:6px;align-items:center}
.star{font-size:22px;cursor:pointer;opacity:0.35}
.star.filled{opacity:1;text-shadow:0 2px 8px rgba(125,90,255,0.2)}
.review-comment{width:100%;padding:8px;border-radius:8px;background:#0f172a;border:1px solid #1f2937;color:#e5e7eb;min-height:64px}
.review-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:10px}
.review-note{font-size:12px;color:#9ca3af;margin-top:6px}
.readonly-stars{color:#fff;opacity:0.95;font-size:18px}

/* Cancel/Refund product selector modal */
.cp-overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);z-index:110000;padding:12px}
.cp-modal{width:100%;max-width:760px;background:#020617;border-radius:10px;padding:14px;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb}
.cp-item{padding:10px;border-radius:8px;background:rgba(15,23,42,0.55);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
.cp-item .meta{font-size:14px;color:#cbd5e1}
.cp-actions {display:flex;gap:8px}

/* small responsive */
@media(max-width:640px){.invoice-modal,.review-box,.cp-modal{max-width:95%}}
  `;
  document.head.appendChild(style);

  const html = `
    <div id="invoice-overlay" class="invoice-modal-overlay" aria-hidden="true">
      <div class="invoice-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-title">
        <div class="invoice-header">
          <h3 id="invoice-title" style="margin:0;color:#e5e7eb">Detalle de Factura</h3>
          <button id="close-invoice-btn" class="btn-close-invoice" aria-label="Cerrar">&times;</button>
        </div>
        <div id="invoice-content" class="invoice-body" tabindex="0"></div>
        <div class="invoice-footer">
          <button id="print-invoice-btn" class="btn-invoice-action">Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>

    <div id="review-overlay" class="review-overlay" aria-hidden="true">
      <div class="review-box" role="dialog" aria-modal="true" id="review-box">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Dejar reseña</h3>
          <button id="close-review-btn" class="btn-close-invoice" aria-label="Cerrar reseñas">&times;</button>
        </div>
        <div id="review-body" style="margin-top:10px;max-height:60vh;overflow:auto"></div>
        <div class="review-actions" style="margin-top:8px">
          <button id="review-cancel-btn" class="btn-invoice-action" style="background:transparent;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb">Cerrar</button>
          <button id="review-save-btn" class="btn-invoice-action">Guardar reseñas</button>
        </div>
      </div>
    </div>

    <!-- selector para cancelar / solicitar reembolso por producto -->
    <div id="cp-overlay-selector" class="cp-overlay" aria-hidden="true">
      <div class="cp-modal" role="dialog" aria-modal="true" id="cp-modal-selector">
        <h3 id="cp-selector-title" style="margin:0 0 8px 0">Selecciona el producto</h3>
        <div id="cp-selector-body" style="max-height:60vh;overflow:auto"></div>
        <div style="display:flex;justify-content:flex-end;margin-top:8px">
          <button id="cp-selector-close" class="btn-close-invoice" style="border:1px solid rgba(148,163,184,0.06);padding:6px 10px;border-radius:8px">Cerrar</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML("beforeend", html);

  // handlers
  document.getElementById("close-invoice-btn").onclick = () => hideInvoice();
  document.getElementById("invoice-overlay").onclick = (e) => { if (e.target.id === "invoice-overlay") hideInvoice();};
  document.getElementById("print-invoice-btn").onclick = () => window.print();

  document.getElementById("close-review-btn").onclick = () => hideReview();
  document.getElementById("review-cancel-btn").onclick = () => hideReview();
  document.getElementById("review-overlay").onclick = (e) => { if (e.target.id === "review-overlay") hideReview(); };

  // selector modal handlers
  const cpOverlay = document.getElementById("cp-overlay-selector");
  const cpClose = document.getElementById("cp-selector-close");
  cpClose.onclick = () => { cpOverlay.style.display = "none"; cpOverlay.setAttribute("aria-hidden","true"); document.getElementById("cp-selector-body").innerHTML = ""; };
  cpOverlay.onclick = (e) => { if (e.target.id === "cp-overlay-selector") { cpOverlay.style.display = "none"; cpOverlay.setAttribute("aria-hidden","true"); document.getElementById("cp-selector-body").innerHTML = ""; } };
})();

// helpers de visibilidad
function showInvoice() { const o = document.getElementById("invoice-overlay"); if (o){ o.style.display="flex"; o.setAttribute("aria-hidden","false"); document.documentElement.style.overflow="hidden"; } }
function hideInvoice() { const o = document.getElementById("invoice-overlay"); if (o){ o.style.display="none"; o.setAttribute("aria-hidden","true"); document.documentElement.style.overflow=""; } }
function showReview() { const r = document.getElementById("review-overlay"); if (r){ r.style.display="flex"; r.setAttribute("aria-hidden","false"); document.documentElement.style.overflow="hidden"; } }
function hideReview() { const r = document.getElementById("review-overlay"); if (r){ r.style.display="none"; r.setAttribute("aria-hidden","true"); document.documentElement.style.overflow=""; const body = document.getElementById("review-body"); if (body) body.innerHTML=""; } }

// Verificar elementos necesarios
if (!loadingEl || !listEl) {
  console.warn("No se encontraron elementos DOM esperados para pedidos.");
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

// util: slugify simple
function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "");
}
// util: generar productKey a partir de item.raw o nombre (preferir id/sku/row)
function getProductKeyFromRaw(raw, name) {
  if (!raw) return slugify(name);
  const cand = raw.id || raw.sku || raw.row || raw.ref || raw.code;
  if (cand !== undefined && cand !== null) {
    const s = String(cand).trim();
    if (s !== "" && s !== "-" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") return s;
  }
  return slugify(name);
}

// DB helpers para reseñas (modificados anteriormente)
async function fetchExistingReview(productKey, uid) {
  if (!productKey || !uid) return null;
  try {
    const snap = await get(ref(db, `reviewsByProduct/${productKey}/${uid}`));
    if (!snap.exists()) return null;
    return { id: uid, data: snap.val() };
  } catch (e) {
    console.warn("fetchExistingReview error:", e);
    return null;
  }
}
async function fetchExistingReviewsForKeys(keys, uid) {
  const results = {};
  await Promise.all(keys.map(async (k) => {
    results[k] = await fetchExistingReview(k, uid);
  }));
  return results; // map productKey -> {id,data} or null
}

async function createReview(productKey, productName, stars, comment, orderKey = null) {
  const user = auth.currentUser;
  if (!user) throw new Error("not_authenticated");

  const payload = {
    productName: productName || "",
    stars: Number(stars || 0),
    comment: comment ? String(comment).trim() : "",
    user: { uid: user.uid, email: user.email || "" },
    orderKey: orderKey || "",
    createdAt: Date.now()
  };

  // Guardamos con la UID como clave: reviewsByProduct/{productKey}/{uid}
  const path = `reviewsByProduct/${productKey}/${user.uid}`;
  try {
    await set(ref(db, path), payload);
    console.debug("[reviews] created at", path);
    return { id: user.uid, data: payload };
  } catch (e) {
    console.error("createReview set error:", e);
    throw e;
  }
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
    const estadoLower = estado.toLowerCase();
    const total    = Number(order.total || 0);

    const createdTxt = order.createdAt
      ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString())
      : "—";

    // determinar cuándo mostrar botones
    // Mostrar "Cancelar" si estado es pendiente / en proceso
    const cancelMatch = /pendiente|pend|en proceso|proceso|procesando|processing/i;
    const showCancel = cancelMatch.test(estadoLower);
    // Mostrar "Solicitar reembolso" si entregado
    const showRefund = /entregado|entregad/i.test(estadoLower);

    // Build actions HTML:
    const cancelOrRefundBtnHtml = showCancel
      ? `<button class="btn-cancel-order" data-order-key="${escapeHtml(String(key))}" style="padding:6px 10px;border-radius:6px;background:#ef4444;color:white;border:none;cursor:pointer;font-size:13px">🛑 Cancelar</button>`
      : (showRefund
          ? `<button class="btn-refund-order" data-order-key="${escapeHtml(String(key))}" style="padding:6px 10px;border-radius:6px;background:#f59e0b;color:#111;border:none;cursor:pointer;font-size:13px">💸 Solicitar reembolso</button>`
          : ""
        );

    const reviewBtnHtml = (estadoLower === "entregado")
      ? `<button class="btn-open-reviews" data-order-key="${escapeHtml(String(key))}" style="padding:6px 10px;border-radius:6px;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;border:none;cursor:pointer;font-size:13px">✍️ Dejar reseña</button>`
      : "";

    const article = document.createElement("article");
    article.className = "order-card";
    article.style.cssText = "border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);";
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
      <div style="margin-top:12px;border-top:1px solid rgba(148,163,184,0.03);padding-top:8px;text-align:right;display:flex;gap:8px;justify-content:flex-end;align-items:center">
        <button class="btn-view-invoice" data-order-key="${escapeHtml(String(key))}" style="background-color:rgba(255,255,255,0.95);border:1px solid rgba(148,163,184,0.06);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;color:#111">📄 Ver Factura</button>
        ${cancelOrRefundBtnHtml}
        ${reviewBtnHtml}
      </div>
    `;
    frag.appendChild(article);
  });

  listEl.appendChild(frag);

  // delegación de eventos: Ver Factura, Dejar reseña, Cancel/Refund
  listEl.onclick = (e) => {
    const viewBtn = e.target.closest ? e.target.closest(".btn-view-invoice") : null;
    if (viewBtn) {
      const orderKey = viewBtn.dataset.orderKey;
      if (!orderKey) return;
      const order = currentOrdersMap[orderKey];
      if (!order) return;
      const createdTxt = order.createdAt ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString()) : "—";
      showInvoiceDetails(order, order.idPedido || orderKey, createdTxt);
      return;
    }

    const reviewBtn = e.target.closest ? e.target.closest(".btn-open-reviews") : null;
    if (reviewBtn) {
      const orderKey = reviewBtn.dataset.orderKey;
      if (!orderKey) return;
      const order = currentOrdersMap[orderKey];
      if (!order) return;
      openOrderReviewsModal(orderKey, order);
      return;
    }

    const cancelBtn = e.target.closest ? e.target.closest(".btn-cancel-order") : null;
    if (cancelBtn) {
      const orderKey = cancelBtn.dataset.orderKey;
      if (!orderKey) return;
      const order = currentOrdersMap[orderKey];
      if (!order) return;
      // abrir selector de productos en modo "cancel"
      openOrderCancelSelector(orderKey, order, "cancel");
      return;
    }

    const refundBtn = e.target.closest ? e.target.closest(".btn-refund-order") : null;
    if (refundBtn) {
      const orderKey = refundBtn.dataset.orderKey;
      if (!orderKey) return;
      const order = currentOrdersMap[orderKey];
      if (!order) return;
      // abrir selector de productos en modo "refund"
      openOrderCancelSelector(orderKey, order, "refund");
      return;
    }
  };
}

// Mostrar modal con detalle de factura (igual que antes, sin botones individuales de review)
function showInvoiceDetails(order, idDisplay, dateDisplay) {
  if (!order || typeof order !== "object") return;
  const overlay = document.getElementById("invoice-overlay");
  const contentEl = document.getElementById("invoice-content");
  if (!overlay || !contentEl) return;

  // normalizar items
  let rawItems = Array.isArray(order.items) ? order.items : (Array.isArray(order.cart) ? order.cart : []);
  const itemsToRender = (rawItems || []).map(it => {
    const name = it.nombre || it.name || it.title || "Producto";
    const qtyRaw = (it.cantidad !== undefined) ? it.cantidad : (it.qty !== undefined ? it.qty : (it.quantity !== undefined ? it.quantity : null));
    const qty = (qtyRaw === null || qtyRaw === "" || isNaN(Number(qtyRaw))) ? null : Number(qtyRaw);
    const priceRaw = (it.precioUnitario !== undefined) ? it.precioUnitario : (it.precioUnitaria !== undefined ? it.precioUnitaria : (it.price !== undefined ? it.price : null));
    const price = (priceRaw === null || priceRaw === "" || isNaN(Number(priceRaw))) ? null : Number(priceRaw);
    const productKey = getProductKeyFromRaw(it, name);
    return { name: String(name), qty, price, raw: it, productKey };
  });

  // construir tabla
  let itemsHtml = "";
  if (itemsToRender.length) {
    const rows = itemsToRender.map(it => {
      const nm = escapeHtml(it.name);
      const qtyTxt = (it.qty === null) ? "—" : escapeHtml(String(it.qty));
      const priceTxt = (typeof it.price === "number") ? fmtPrice(it.price) : "—";
      const lineTotalTxt = (typeof it.price === "number" && it.qty !== null) ? fmtPrice(it.price * it.qty) : "—";
      let refCandidate = null;
      if (it.raw) {
        const possible = it.raw.id || it.raw.row || it.raw.sku || it.raw.ref;
        if (possible !== undefined && possible !== null) {
          const s = String(possible).trim();
          if (s !== "" && s !== "-" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") refCandidate = s;
        }
      }
      return `
        <tr>
          <td>
            <strong>${nm}</strong>
            ${refCandidate ? `<div class="invoice-small" style="margin-top:6px">Ref: ${escapeHtml(refCandidate)}</div>` : ""}
          </td>
          <td style="text-align:center">${qtyTxt}</td>
          <td style="text-align:right">${priceTxt}</td>
          <td style="text-align:right">${lineTotalTxt}</td>
        </tr>
      `;
    }).join("");
    itemsHtml = `<table class="invoice-items-table" role="table"><thead><tr><th style="width:60%">Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else if (order.resumen) {
    const parts = String(order.resumen).split(/\s*\|\s*/).filter(Boolean);
    const rows = parts.map(p => {
      const m = p.match(/^(\d+)\s*x\s*(.+)$/i);
      if (m) return `<tr><td><strong>${escapeHtml(m[2].trim())}</strong></td><td style="text-align:center">${escapeHtml(m[1])}</td><td style="text-align:right">—</td><td style="text-align:right">—</td></tr>`;
      return `<tr><td><strong>${escapeHtml(p)}</strong></td><td style="text-align:center">—</td><td style="text-align:right">—</td><td style="text-align:right">—</td></tr>`;
    }).join("");
    itemsHtml = `<table class="invoice-items-table" role="table"><thead><tr><th style="width:60%">Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">Precio</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    itemsHtml = `<div style="text-align:center;padding:18px;color:#9ca3af">No hay detalle de items.</div>`;
  }

  // totales
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
        <div style="color:#cbd5e1">${clienteNameDisplay}<br>${direccionDisplay}<br>${telefonoDisplay}</div>
      </div>
      <div style="flex:1;min-width:180px;text-align:right">
        <strong style="display:block;margin-bottom:6px;color:#e5e7eb">Detalles:</strong>
        <div style="color:#cbd5e1">ID: <strong>${escapeHtml(String(idDisplay))}</strong><br>Fecha: ${escapeHtml(String(dateDisplay))}<br>Estado: ${escapeHtml(order.estado || order.status || "Pendiente")}</div>
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
  showInvoice();
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
/* =========================
   Modal de reseñas por pedido
   - muestra cada producto del pedido
   - si ya existe reseña (por uid) la muestra en read-only
   - si no existe, permite crear (no editar)
   ========================= */
async function openOrderReviewsModal(orderKey, order) {
  const user = auth.currentUser;
  if (!user) { alert("Debes iniciar sesión para dejar reseñas."); return; }
  if (!order) return;

  // normalizar items
  let rawItems = Array.isArray(order.items) ? order.items : (Array.isArray(order.cart) ? order.cart : []);
  const itemsToRender = (rawItems || []).map(it => {
    const name = it.nombre || it.name || it.title || "Producto";
    const productKey = getProductKeyFromRaw(it, name);
    return { name: String(name), raw: it, productKey, qty: it.cantidad || it.qty || it.quantity || null };
  });

  if (!itemsToRender.length) {
    alert("No hay productos para reseñar en este pedido.");
    return;
  }

  const reviewBody = document.getElementById("review-body");
  reviewBody.innerHTML = `<div style="color:#9ca3af">Cargando reseñas...</div>`;
  showReview();

  // fetch existing reviews para las keys
  const keys = [...new Set(itemsToRender.map(i => i.productKey))];
  const existingMap = await fetchExistingReviewsForKeys(keys, user.uid);

  // construir UI por item (no editable si existe)
  reviewBody.innerHTML = "";
  // map para estado local de cada item nuevo a crear
  const pendingMap = {}; // productKey -> {stars, comment, productName}
  itemsToRender.forEach((it, idx) => {
    const ex = existingMap[it.productKey];
    const itemDiv = document.createElement("div");
    itemDiv.className = "review-item";
    itemDiv.dataset.productKey = it.productKey;

    if (ex && ex.data) {
      // mostrar reseña existente (solo lectura)
      const stars = Number(ex.data.stars || 0);
      const starsHtml = renderStaticStars(stars);
      const commentHtml = ex.data.comment ? `<div style="margin-top:6px;color:#cbd5e1">${escapeHtml(ex.data.comment)}</div>` : `<div style="margin-top:6px;color:#9ca3af">Sin comentario</div>`;
      itemDiv.innerHTML = `
        <div style="flex:1">
          <h4>${escapeHtml(it.name)}</h4>
          <div class="readonly-stars">${starsHtml}</div>
          ${commentHtml}
          <div class="review-note">Ya dejaste esta reseña — no puede editarse.</div>
        </div>
      `;
    } else {
      // UI interactiva para crear reseña (solo si aún no existe)
      const starsInputs = [1,2,3,4,5].map(n => `<span class="star" data-value="${n}" aria-label="${n}">${"★"}</span>`).join("");
      itemDiv.innerHTML = `
        <div style="flex:1">
          <h4>${escapeHtml(it.name)}</h4>
          <div class="stars" role="group" aria-label="Seleccionar estrellas">${starsInputs}</div>
          <textarea class="review-comment" placeholder="Comentario (opcional)"></textarea>
          <div class="review-note">Puedes dejar una reseña pública para este producto. Solo una reseña por usuario.</div>
        </div>
      `;
      // inicializar estado vacío
      pendingMap[it.productKey] = { stars: 0, comment: "", productName: it.name };
    }

    reviewBody.appendChild(itemDiv);
  });

  // delegación: manejar clicks en stars interactivos y cambios en textarea
  reviewBody.onclick = (ev) => {
    const star = ev.target.closest ? ev.target.closest(".star") : null;
    if (!star) return;
    const val = Number(star.dataset.value || 0);
    const item = star.closest(".review-item");
    if (!item) return;
    const key = item.dataset.productKey;
    // pintar estrellas en este item
    item.querySelectorAll(".star").forEach(s => {
      const v = Number(s.dataset.value || 0);
      if (v <= val) s.classList.add("filled"); else s.classList.remove("filled");
    });
    if (!pendingMap[key]) pendingMap[key] = { stars: 0, comment: "", productName: item.querySelector("h4")?.textContent || "" };
    pendingMap[key].stars = val;
  };

  reviewBody.oninput = (ev) => {
    const ta = ev.target.closest ? ev.target.closest(".review-comment") : null;
    if (!ta) return;
    const item = ta.closest(".review-item");
    if (!item) return;
    const key = item.dataset.productKey;
    if (!pendingMap[key]) pendingMap[key] = { stars: 0, comment: "", productName: item.querySelector("h4")?.textContent || "" };
    pendingMap[key].comment = ta.value;
  };

  // guardar: crear reseñas solo para las keys que no tenían y para las que el usuario haya seleccionado algo
  const saveBtn = document.getElementById("review-save-btn");
  saveBtn.onclick = async () => {
    try {
      // re-check: evitar race conditions - obtener existentes otra vez
      const recheck = await fetchExistingReviewsForKeys(keys, auth.currentUser.uid);
      const toCreate = [];
      for (const k of keys) {
        if (recheck[k]) continue; // ya existe -> no crear
        const pending = pendingMap[k];
        if (!pending) continue;
        // only create if user gave stars or comment
        if ((Number(pending.stars || 0) > 0) || (String(pending.comment || "").trim() !== "")) {
          toCreate.push({ key: k, name: pending.productName, stars: Number(pending.stars || 0), comment: String(pending.comment || "").trim() });
        }
      }

      if (!toCreate.length) {
        alert("No hay reseñas nuevas para guardar.");
        return;
      }

      // create in series (secuencial)
      for (const r of toCreate) {
        try {
          // createReview ahora usa set en reviewsByProduct/{productKey}/{uid}
          await createReview(r.key, r.name, r.stars, r.comment, orderKey);
        } catch (e) {
          console.error("No se pudo crear reseña para", r.key, e);
        }
      }

      alert("Reseñas guardadas correctamente.");
      // cerrar modal
      hideReview();
    } catch (err) {
      console.error("Error guardando reseñas:", err);
      alert("No se pudo guardar reseñas. Revisa la consola.");
    }
  };
}

function openOrderCancelSelector(orderKey, order, mode = "cancel") {
  // mode "cancel" -> cancelar producto; "refund" -> solicitar reembolso
  const overlay = document.getElementById("cp-overlay-selector");
  const body = document.getElementById("cp-selector-body");
  const title = document.getElementById("cp-selector-title");
  if (!overlay || !body || !title) return;

  title.textContent = (mode === "refund") ? "Solicitar reembolso — selecciona el producto" : "Cancelar producto — selecciona el producto";
  body.innerHTML = "<div style='color:#9ca3af;padding:12px'>Cargando productos...</div>";
  overlay.style.display = "flex";
  overlay.setAttribute("aria-hidden", "false");
  document.documentElement.style.overflow = "hidden";

  // normalizar items
  let rawItems = Array.isArray(order.items) ? order.items : (Array.isArray(order.cart) ? order.cart : []);
  const itemsToRender = (rawItems || []).map(it => {
    const name = it.nombre || it.name || it.title || "Producto";
    const qty = it.cantidad || it.qty || it.quantity || 1;
    const productKey = getProductKeyFromRaw(it, name);
    return { name: String(name), qty, raw: it, productKey };
  });

  if (!itemsToRender.length) {
    body.innerHTML = `<div style="padding:12px;color:#9ca3af">No hay productos en este pedido.</div>`;
    return;
  }

  body.innerHTML = "";
  itemsToRender.forEach((it) => {
    const div = document.createElement("div");
    div.className = "cp-item";
    div.innerHTML = `
      <div class="meta">
        <div style="font-weight:600">${escapeHtml(it.name)}</div>
        <div class="rv-small" style="margin-top:6px">Cantidad: ${escapeHtml(String(it.qty))} · Key: ${escapeHtml(String(it.productKey))}</div>
      </div>
      <div class="cp-actions">
        <button class="cp-btn cp-action" data-product-key="${escapeHtml(it.productKey)}" style="padding:6px 10px;border-radius:6px;background:transparent;border:1px solid rgba(148,163,184,0.06);color:#e5e7eb;cursor:pointer">Seleccionar</button>
      </div>
    `;
    body.appendChild(div);

    // delegado por click sobre el botón dentro del div
    div.querySelector(".cp-action").addEventListener("click", (ev) => {
      ev.preventDefault();
      const pk = ev.currentTarget.dataset.productKey;
      const productObj = {
        productKey: pk,
        name: it.name,
        qty: it.qty,
        raw: it.raw
      };
      // Abrir modal de cancel-product para ese producto
      cancelModule.openCancelModalFor(orderKey, productObj);
      // Si venimos en modo refund, activar la casilla dentro del modal (pequeño timeout)
      if (mode === "refund") {
        setTimeout(() => {
          try {
            const cb = document.getElementById("cp-refund-checkbox");
            const evidenceArea = document.getElementById("cp-evidence-area");
            if (cb) { cb.checked = true; }
            if (evidenceArea) { evidenceArea.style.display = "block"; }
          } catch (e) { /* ignore */ }
        }, 160);
      }
      // cerrar selector
      overlay.style.display = "none";
      overlay.setAttribute("aria-hidden", "true");
      document.getElementById("cp-selector-body").innerHTML = "";
      document.documentElement.style.overflow = "";
    });
  });
}

// render estrellas estáticas (si falta, la volvemos a definir)
function renderStaticStars(n) {
  let out = "";
  for (let i=1;i<=5;i++) out += (i<=n) ? "★" : "☆";
  return out;
}

export {}; // evita export accidental de variables globales en módulo
