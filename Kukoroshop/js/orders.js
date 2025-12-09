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

// Estado local: mapa de pedidos renderizados (clave -> order)
let currentOrdersMap = {};

// ====== setup UI / modal de factura ======
(function setupInvoiceUI() {
  // evitar duplicados en hot-reload
  if (document.getElementById('invoice-overlay')) return;

  const style = document.createElement('style');
  style.innerHTML = `
    .invoice-modal-overlay {
      position: fixed; inset: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.6); z-index: 99999; display: none;
      justify-content: center; align-items: center; padding: 20px;
    }
    .invoice-modal { background: white; width: 100%; max-width: 720px; max-height: 90vh;
      border-radius: 12px; display: flex; flex-direction: column; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
      overflow: hidden;
    }
    .invoice-header { padding: 16px 20px; background: #f8f9fa; border-bottom: 1px solid #eee; display:flex;justify-content:space-between;align-items:center;}
    .invoice-body { padding: 18px; overflow-y:auto; max-height:calc(90vh - 160px); }
    .invoice-footer { padding: 12px 18px; border-top:1px solid #eee; text-align:right; background:#fff; }
    .invoice-items-table { width:100%; border-collapse:collapse; margin:12px 0; font-size:14px; }
    .invoice-items-table th{ text-align:left; border-bottom:2px solid #eee; padding:8px; color:#666; }
    .invoice-items-table td{ border-bottom:1px solid #eee; padding:8px; vertical-align:top; }
    .btn-close-invoice { background:none; border:none; font-size:24px; cursor:pointer; color:#555; }
    .btn-invoice-action { background:#111; color:#fff; padding:8px 14px; border-radius:8px; border:none; cursor:pointer; }
  `;
  document.head.appendChild(style);

  const modalHTML = `
    <div id="invoice-overlay" class="invoice-modal-overlay" aria-hidden="true" role="dialog" aria-modal="true">
      <div class="invoice-modal" role="document">
        <div class="invoice-header">
          <h3 style="margin:0;font-size:18px">Detalle de Factura</h3>
          <div>
            <button id="close-invoice-btn" class="btn-close-invoice" aria-label="Cerrar factura">&times;</button>
          </div>
        </div>
        <div id="invoice-content" class="invoice-body"></div>
        <div class="invoice-footer">
          <button id="print-invoice-btn" class="btn-invoice-action">Imprimir / Guardar PDF</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const overlay = document.getElementById('invoice-overlay');
  const closeBtn = document.getElementById('close-invoice-btn');
  const printBtn = document.getElementById('print-invoice-btn');

  // handler ESC (declarado aquí para poder añadir y remover)
  function handleEsc(ev) {
    if (ev.key === 'Escape') {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    }
  }

  if (closeBtn) closeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    window.removeEventListener('keydown', handleEsc);
  });

  // click fuera para cerrar
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      document.documentElement.style.overflow = '';
      window.removeEventListener('keydown', handleEsc);
    }
  });

  // print
  if (printBtn) printBtn.addEventListener('click', () => window.print());

  // expose helper to open modal from other functions
  window.__showInvoiceOverlay = function() {
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEsc);
  };

  window.__hideInvoiceOverlay = function() {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
    window.removeEventListener('keydown', handleEsc);
  };
})();

// Safety: ensure required nodes exist
if (!loadingEl || !listEl) {
  console.warn("Elementos de UI de pedidos no encontrados.");
}

// Optional handlers
cartBtn?.addEventListener("click", () => { /* abrir carrito */ });
adminBtn?.addEventListener("click", () => location.href = "admin.html");

// Escuchar estado de autenticación
onAuthStateChanged(auth, async (user) => {
  if (!user) return window.location.href = "index.html";

  if (userLabel) userLabel.textContent = user.email || "";

  try { await auth.currentUser.getIdToken(true); } catch (err) { console.warn("No se pudo refrescar token:", err); }

  listenUserOrders(user.uid, user.email || "");
});

// Obtener info actual del usuario
function getCurrentUserInfo() {
  const u = auth.currentUser;
  if (!u) return { uid: null, email: null, displayName: null };
  return { uid: u.uid || null, email: u.email || null, displayName: u.displayName || null };
}

// Escuchar y cargar pedidos del usuario (con fallback)
function listenUserOrders(uid, email) {
  loadingEl && (loadingEl.style.display = "block");
  listEl && (listEl.style.display = "none");
  if (listEl) listEl.innerHTML = "";

  const userOrdersRef = ref(db, `users/${uid}/orders`);

  onValue(userOrdersRef, async (snap) => {
    try {
      const val = snap.val();
      if (val && Object.keys(val).length) {
        renderOrdersObject(val);
        return;
      }

      // Fallback a /orders y filtrar por uid o email
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

      if (Object.keys(filtered).length) {
        renderOrdersObject(filtered);
      } else {
        renderEmpty();
      }
    } catch (err) {
      const ctx = getCurrentUserInfo();
      console.error("Error leyendo orders (fallback):", err, "requesting user:", ctx);
      renderError(err, ctx);
    }
  }, (err) => {
    const ctx = getCurrentUserInfo();
    console.error("Error listening user orders:", err, "requesting user:", ctx);
    renderError(err, ctx);
  });
}

// Renderiza pedidos (y guarda en currentOrdersMap)
function renderOrdersObject(obj) {
  currentOrdersMap = {}; // reset
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (!listEl) return;

  const entries = Object.entries(obj).sort((a, b) => {
    const ta = a[1]?.createdAt ? Date.parse(a[1].createdAt) || a[1].createdAt : (a[1]?.createdAt || 0);
    const tb = b[1]?.createdAt ? Date.parse(b[1].createdAt) || b[1].createdAt : (b[1]?.createdAt || 0);
    return tb - ta;
  });

  if (!entries.length) {
    return renderEmpty();
  }

  listEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  entries.forEach(([key, order]) => {
    currentOrdersMap[key] = order;

    const idPedido = order.idPedido || key;
    const cliente  = order.cliente || order.userEmail || "Sin cliente";
    const resumen  = order.resumen || summarizeOrder(order) || "Sin resumen";
    const estado   = order.estado || order.status || "pendiente";
    const total    = Number(order.total || 0);

    const createdAt = order.createdAt ? new Date(order.createdAt) : null;
    const createdTxt = createdAt && !isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : (typeof order.createdAt === 'number' ? new Date(order.createdAt).toLocaleString() : "—");

    // botón con data-order-key
    const item = document.createElement('article');
    item.className = "order-card";
    item.style.cssText = "border-radius:10px;padding:12px;margin-bottom:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);";
    item.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div style="font-weight:600">Pedido: ${escapeHtml(String(idPedido))}</div>
          <div style="color:#666;font-size:13px;margin-top:4px">Fecha: ${escapeHtml(createdTxt)} · Cliente: ${escapeHtml(cliente)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:700">${fmtPrice(total)}</div>
          <div style="margin-top:6px">
            <span class="estado" style="padding:6px 10px;border-radius:999px;background:#f0f0f0;font-size:12px;">${escapeHtml(estado)}</span>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;color:#444;font-size:14px;">${escapeHtml(resumen)}</div>
      <div style="margin-top:12px; border-top:1px solid #eee; padding-top:8px; text-align:right;">
        <button class="btn-view-invoice" data-order-key="${key}" style="background-color:#fff;border:1px solid #ccc;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:13px;">📄 Ver Factura</button>
      </div>
    `;
    fragment.appendChild(item);
  });

  listEl.appendChild(fragment);

  // Delegación: evento para botones "Ver Factura"
  listEl.onclick = (e) => {
    const btn = e.target.closest && e.target.closest('.btn-view-invoice');
    if (!btn) return;
    const orderKey = btn.dataset.orderKey;
    const order = currentOrdersMap[orderKey];
    if (!order) {
      console.error("Pedido no encontrado en mapa local para key:", orderKey);
      return;
    }
    // uso createdAt para mostrar fecha legible
    const createdTxt = order.createdAt ? (isNaN(Number(order.createdAt)) ? String(order.createdAt) : new Date(Number(order.createdAt)).toLocaleString()) : "—";
    showInvoiceDetails(order, order.idPedido || orderKey, createdTxt);
  };
}

// Mostrar modal con detalles (robusta)
// Mostrar modal con detalles (parsea resumen si no hay items individuales)
// Reemplaza tu showInvoiceDetails por esta versión
function showInvoiceDetails(order, idDisplay, dateDisplay) {
  try {
    if (!order || typeof order !== "object") return;

    const overlay = document.getElementById("invoice-overlay");
    const contentEl = document.getElementById("invoice-content");
    if (!overlay || !contentEl) return;

    // Obtener array de items (soporta order.items o order.cart)
    const rawItems = Array.isArray(order.items)
      ? order.items
      : (Array.isArray(order.cart) ? order.cart : []);

    // Normalizar cada item a { name, qty, price }
    const itemsToRender = rawItems.map(it => {
      const name = it.nombre || it.name || it.title || "Producto";
      // pueden venir como 'cantidad', 'qty' o 'quantity'
      const qtyRaw = (it.cantidad !== undefined) ? it.cantidad : (it.qty !== undefined ? it.qty : (it.quantity !== undefined ? it.quantity : null));
      const qty = (qtyRaw === null || qtyRaw === "" || isNaN(Number(qtyRaw))) ? null : Number(qtyRaw);

      // precio puede estar en 'precioUnitario' (tu caso), o 'precioUnitario' numérico, o 'price'
      const priceRaw = (it.precioUnitario !== undefined) ? it.precioUnitario : (it.precioUnitaria !== undefined ? it.precioUnitaria : (it.price !== undefined ? it.price : null));
      const price = (priceRaw === null || priceRaw === "" || isNaN(Number(priceRaw))) ? null : Number(priceRaw);

      return { name: String(name), qty, price, raw: it };
    });

    // Construir filas HTML
    let itemsHtml = "";
    if (itemsToRender.length) {
      // dentro de showInvoiceDetails, cuando creas las filas:
const rows = itemsToRender.map(it => {
  const nm = escapeHtml(it.name);
  const qtyTxt = (it.qty === null) ? "—" : escapeHtml(String(it.qty));
  const priceTxt = (typeof it.price === "number") ? fmtPrice(it.price) : "—";
  const lineTotalTxt = (typeof it.price === "number" && it.qty !== null) ? fmtPrice(it.price * it.qty) : "—";

  const refTxt = (it.raw && (it.raw.id || it.raw.row || it.raw.sku || it.raw.ref))
    ? escapeHtml(it.raw.id || it.raw.row || it.raw.sku || it.raw.ref)
    : null;

  return `
    <tr>
      <td>
        <strong>${nm}</strong>
        ${refTxt ? `<div style="font-size:12px;color:#888">Ref: ${refTxt}</div>` : ""}
      </td>
      <td style="text-align:center;">${qtyTxt}</td>
      <td style="text-align:right;">${priceTxt}</td>
      <td style="text-align:right;">${lineTotalTxt}</td>
    </tr>
  `;
}).join("");
      itemsHtml = `
        <table class="invoice-items-table">
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
      // fallback: parsear resumen si no hay array items
      const parts = String(order.resumen).split(/\s*\|\s*/).filter(Boolean);
      const rows = parts.map(p => {
        const m = p.match(/^(\d+)\s*x\s*(.+)$/i);
        if (m) {
          return `<tr><td><strong>${escapeHtml(m[2].trim())}</strong></td><td style="text-align:center;">${escapeHtml(m[1])}</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
        }
        return `<tr><td><strong>${escapeHtml(p)}</strong></td><td style="text-align:center;">—</td><td style="text-align:right;">—</td><td style="text-align:right;">—</td></tr>`;
      }).join("");
      itemsHtml = `
        <table class="invoice-items-table">
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
      itemsHtml = `<div style="text-align:center;padding:18px;color:#777">No hay detalle de items.</div>`;
    }

    // Cliente / totales
    const clienteNameDisplay = escapeHtml(order.cliente || order.userEmail || "Cliente");
    const direccionDisplay = escapeHtml(order.shipping?.address || order.address || order.direccion || "No especificada");
    const telefonoDisplay = escapeHtml(order.shipping?.phone || order.phone || order.telefono || "—");
    const shippingCost = Number(order.shipping?.cost || order.shippingCost || 0);
    const total = Number(order.total || 0);
    const subtotal = (Number(order.subtotal) || (shippingCost > 0 ? (total - shippingCost) : total)) || 0;

    const html = `
      <div style="margin-bottom:14px;border-bottom:1px solid #eee;padding-bottom:8px;">
        <h4 style="margin:0 0 6px 0;color:#222">Kukoro-shop</h4>
        <div style="font-size:13px;color:#666">Confirmación de Orden</div>
      </div>

      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:14px;">
        <div style="flex:1;min-width:180px;">
          <strong style="display:block;margin-bottom:6px;color:#333">Facturar a:</strong>
          <div style="color:#555;font-size:14px">
            ${clienteNameDisplay}<br>
            ${direccionDisplay}<br>
            ${telefonoDisplay}
          </div>
        </div>
        <div style="flex:1;min-width:180px;text-align:right;">
          <strong style="display:block;margin-bottom:6px;color:#333">Detalles:</strong>
          <div style="color:#555;font-size:14px">
            ID: <strong>${escapeHtml(String(idDisplay))}</strong><br>
            Fecha: ${escapeHtml(String(dateDisplay))}<br>
            Estado: ${escapeHtml(order.estado || order.status || "Pendiente")}
          </div>
        </div>
      </div>

      ${itemsHtml}

      <div style="border-top:2px solid #eee;padding-top:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Subtotal:</span><span>${fmtPrice(subtotal)}</span></div>
        ${shippingCost > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:6px"><span>Envío:</span><span>${fmtPrice(shippingCost)}</span></div>` : ""}
        <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;margin-top:6px"><span>TOTAL:</span><span>${fmtPrice(total)}</span></div>
      </div>
    `;

    contentEl.innerHTML = html;

    // mostrar modal y bloquear scroll
    overlay.style.display = "flex";
    overlay.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    overlay.scrollTop = 0;
    contentEl.scrollTop = 0;

  } catch (err) {
    // manejar silent fail si quieres
  }
}

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
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#777;text-align:center">No tienes pedidos registrados todavía.</div>`;
}

function renderError(err, userCtx = null) {
  loadingEl && (loadingEl.style.display = "none");
  listEl && (listEl.style.display = "block");
  const msg = (err && err.message) ? escapeHtml(err.message) : "Error desconocido";

  let userInfoHtml = "";
  if (userCtx) {
    const u = escapeHtml(String(userCtx.uid || "null"));
    const e = escapeHtml(String(userCtx.email || "null"));
    const d = escapeHtml(String(userCtx.displayName || "null"));
    userInfoHtml = `<div style="margin-top:8px;font-size:12px;color:#999">Request user — uid: ${u} · email: ${e} · name: ${d}</div>`;
  }

  if (listEl) listEl.innerHTML = `<div style="padding:18px;color:#f55;text-align:center">No se pudieron cargar tus pedidos: ${msg}${userInfoHtml}</div>`;
}
