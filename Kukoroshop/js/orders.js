// js/pedidos.js
import { auth, onAuthStateChanged, db } from "./firebase.js";
import { fmtPrice, escapeHtml } from "./utils.js";
import { ref, onValue, get } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";

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
@media (max-width:640px) {
  .invoice-modal { max-width: 95%; }
  .invoice-body { padding:12px; max-height: calc(90vh - 160px); }
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
  `;
  document.body.insertAdjacentHTML("beforeend", modalHTML);

  const overlay = document.getElementById("invoice-overlay");
  const closeBtn = document.getElementById("close-invoice-btn");
  const printBtn = document.getElementById("print-invoice-btn");

  function closeModal() {
    if (!overlay) return;
    overlay.style.display = "none";
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    window.removeEventListener("keydown", onKeyDown);
  }
  function onKeyDown(e) { if (e.key === "Escape") closeModal(); }

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (overlay) {
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
  }
  if (printBtn) printBtn.addEventListener("click", () => window.print());

  // helpers para abrir/cerrar desde showInvoiceDetails
  window.__showInvoiceOverlay = function() {
    if (!overlay) return;
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    // focus contenido para accesibilidad
    const content = document.getElementById("invoice-content");
    if (content) content.focus();
  };
  window.__hideInvoiceOverlay = closeModal;
})();

// Verificar elementos necesarios
if (!loadingEl || !listEl) {
  // no hacemos throw, solo evitamos fallos posteriores
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
    const estado   = order.estado || order.status || "pendiente";
    const total    = Number(order.total || 0);

    const createdTxt = order.createdAt
      ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString())
      : "—";

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
      <div style="margin-top:12px;border-top:1px solid rgba(148,163,184,0.03);padding-top:8px;text-align:right;">
        <button class="btn-view-invoice" data-order-key="${escapeHtml(String(key))}" style="background-color:rgba(255,255,255,0.95);border:1px solid rgba(148,163,184,0.06);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;color:#111">📄 Ver Factura</button>
      </div>
    `;
    frag.appendChild(article);
  });

  listEl.appendChild(frag);

  // delegación: un solo handler para todos los botones "Ver Factura"
  listEl.onclick = (e) => {
    const btn = e.target.closest ? e.target.closest(".btn-view-invoice") : null;
    if (!btn) return;
    const orderKey = btn.dataset.orderKey;
    if (!orderKey) return;
    const order = currentOrdersMap[orderKey];
    if (!order) return;
    const createdTxt = order.createdAt ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString()) : "—";
    showInvoiceDetails(order, order.idPedido || orderKey, createdTxt);
  };
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
